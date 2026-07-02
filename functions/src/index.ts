/**
 * BizMtaani Firebase Cloud Functions
 *
 * Handles two operations that require secret keys:
 *   1. getCloudinarySignature — signs a direct browser upload to Cloudinary
 *   2. initiateMpesaPayment  — STK push via Daraja API
 *   3. mpesaCallback         — Safaricom webhook, activates paid listings
 *
 * Secrets (set via `firebase functions:secrets:set <NAME>`):
 *   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY
 *
 * Env vars (set in firebase.json or GCP console):
 *   MPESA_SHORTCODE (default: 174379 sandbox)
 *   MPESA_ENVIRONMENT (default: sandbox)
 *   MPESA_CALLBACK_URL (optional full URL override)
 */

import * as crypto from "crypto";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

// ─── Secrets ────────────────────────────────────────────────────────────────
const cloudinaryApiKey = defineSecret("CLOUDINARY_API_KEY");
const cloudinaryApiSecret = defineSecret("CLOUDINARY_API_SECRET");
const cloudinaryCloudName = defineSecret("CLOUDINARY_CLOUD_NAME");
const mpesaConsumerKey = defineSecret("MPESA_CONSUMER_KEY");
const mpesaConsumerSecret = defineSecret("MPESA_CONSUMER_SECRET");
const mpesaPasskey = defineSecret("MPESA_PASSKEY");

// ─── Constants ──────────────────────────────────────────────────────────────
const FOLDER_MAP: Record<string, string> = {
  avatar: "bizmtaani/avatars",
  product: "bizmtaani/products",
  community: "bizmtaani/community",
};

const PLAN_AMOUNTS: Record<string, number> = { basic: 60, premium: 120 };
const PLAN_PHOTO_LIMITS: Record<string, number> = { basic: 2, premium: 4 };
const LISTING_DURATION_DAYS = 7;
const SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

function isSandbox(): boolean {
  return (process.env.MPESA_ENVIRONMENT ?? "sandbox") !== "production";
}

function darajaBase(): string {
  return isSandbox()
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

function mpesaTimestamp(): string {
  const n = new Date();
  return [
    n.getFullYear(),
    String(n.getMonth() + 1).padStart(2, "0"),
    String(n.getDate()).padStart(2, "0"),
    String(n.getHours()).padStart(2, "0"),
    String(n.getMinutes()).padStart(2, "0"),
    String(n.getSeconds()).padStart(2, "0"),
  ].join("");
}

function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s\-+]/g, "");
  if (p.startsWith("254") && p.length === 12) return p;
  if ((p.startsWith("07") || p.startsWith("01")) && p.length === 10)
    return "254" + p.slice(1);
  if (p.startsWith("7") && p.length === 9) return "254" + p;
  throw new Error(`Invalid Kenyan number: ${raw}`);
}

let _darajaToken: { token: string; expiresAt: number } | null = null;

async function getDarajaToken(key: string, secret: string): Promise<string> {
  if (_darajaToken && Date.now() < _darajaToken.expiresAt - 60_000)
    return _darajaToken.token;
  const creds = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(
    `${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${creds}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Daraja token failed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: string };
  _darajaToken = {
    token: data.access_token,
    expiresAt: Date.now() + parseInt(data.expires_in) * 1000,
  };
  return _darajaToken.token;
}

// ─── 1. getCloudinarySignature ───────────────────────────────────────────────
// Returns a signed upload signature so the browser can POST the image file
// directly to Cloudinary. Only `folder` and `timestamp` are signed — these
// are the only upload params the browser sends (beyond `file` and `api_key`,
// which Cloudinary excludes from the signature).
export const getCloudinarySignature = onCall(
  {
    secrets: [cloudinaryApiKey, cloudinaryApiSecret, cloudinaryCloudName],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in to upload images");
    }

    const uploadType =
      ((request.data as Record<string, unknown>).uploadType as string | undefined) ??
      "product";
    const folder = FOLDER_MAP[uploadType] ?? FOLDER_MAP["product"];
    const timestamp = Math.floor(Date.now() / 1000);
    const apiSecret = cloudinaryApiSecret.value();

    // Signature: SHA1 of sorted params string + apiSecret.
    // MUST match exactly the params sent in the browser upload request
    // (excluding: file, api_key, resource_type).
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash("sha1")
      .update(paramsToSign + apiSecret)
      .digest("hex");

    return {
      signature,
      timestamp,
      folder,
      apiKey: cloudinaryApiKey.value(),
      cloudName: cloudinaryCloudName.value(),
    };
  }
);

// ─── 2. initiateMpesaPayment ─────────────────────────────────────────────────
// Initiates an M-Pesa STK push for a paid listing plan.
// A per-payment callback token is generated and embedded in the callback URL.
// This token is also stored in the payment Firestore doc and verified by
// mpesaCallback before processing any payment completion.
export const initiateMpesaPayment = onCall(
  {
    secrets: [mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const { phone, plan, productId } = request.data as {
      phone: string;
      plan: string;
      productId: string;
    };

    if (!phone || !plan || !productId) {
      throw new HttpsError(
        "invalid-argument",
        "phone, plan and productId are required"
      );
    }
    if (plan !== "basic" && plan !== "premium") {
      throw new HttpsError(
        "invalid-argument",
        "plan must be 'basic' or 'premium'"
      );
    }

    let formattedPhone: string;
    try {
      formattedPhone = normalizePhone(phone);
    } catch (e) {
      throw new HttpsError("invalid-argument", (e as Error).message);
    }

    const shortcode = process.env.MPESA_SHORTCODE ?? "174379";
    const passkey =
      mpesaPasskey.value() || (isSandbox() ? SANDBOX_PASSKEY : "");
    const amount = PLAN_AMOUNTS[plan];
    const photoLimit = PLAN_PHOTO_LIMITS[plan];

    const token = await getDarajaToken(
      mpesaConsumerKey.value(),
      mpesaConsumerSecret.value()
    );
    const ts = mpesaTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString(
      "base64"
    );

    // Generate a cryptographically random token for this payment.
    // Embedded in the callback URL and stored in Firestore — mpesaCallback
    // verifies it matches before processing any completion event.
    const callbackToken = crypto.randomBytes(24).toString("hex");

    const projectId = process.env.GCLOUD_PROJECT ?? "";
    const baseCallbackUrl =
      process.env.MPESA_CALLBACK_URL ??
      (projectId
        ? `https://us-central1-${projectId}.cloudfunctions.net/mpesaCallback`
        : "https://example.com/mpesa/callback");

    const callbackUrl = `${baseCallbackUrl}?cbtoken=${callbackToken}`;

    const stkBody = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      AccountReference: productId.slice(0, 12),
      TransactionDesc: `BizMtaani ${plan} listing`,
    };

    const darajaRes = await fetch(
      `${darajaBase()}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stkBody),
      }
    );

    const rawText = await darajaRes.text();
    let darajaData: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResponseCode?: string;
      CustomerMessage?: string;
      errorCode?: string;
      errorMessage?: string;
      ResponseDescription?: string;
    };
    try {
      darajaData = JSON.parse(rawText) as typeof darajaData;
    } catch {
      throw new HttpsError(
        "internal",
        `Daraja response not JSON (HTTP ${darajaRes.status}): ${rawText.slice(0, 200)}`
      );
    }

    if (!darajaRes.ok || darajaData.errorCode || darajaData.ResponseCode !== "0") {
      throw new HttpsError(
        "internal",
        darajaData.errorMessage ??
          darajaData.ResponseDescription ??
          "Daraja error"
      );
    }

    const checkoutRequestId = darajaData.CheckoutRequestID!;
    const merchantRequestId = darajaData.MerchantRequestID!;

    // Write payment doc including the callback token for later verification.
    await db.collection("payments").doc(checkoutRequestId).set({
      checkoutRequestId,
      merchantRequestId,
      callbackToken,
      type: `listing_${plan}`,
      plan,
      photoLimit,
      productId,
      buyerId: request.auth.uid,
      buyerPhone: formattedPhone,
      amount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      checkoutRequestId,
      merchantRequestId,
      customerMessage: darajaData.CustomerMessage,
    };
  }
);

// ─── 3. mpesaCallback ────────────────────────────────────────────────────────
// HTTP endpoint called by Safaricom after the user completes or cancels.
//
// Security: the callback URL includes a ?cbtoken= generated per-payment in
// initiateMpesaPayment and stored in the Firestore payment doc. We look up the
// payment doc first and verify the token matches before acting on the result.
// This prevents unauthenticated callers from forging a successful callback
// and activating listings without payment.
//
// Reliability: all Firestore writes are awaited before responding so that
// no state updates are lost in the serverless execution model.
export const mpesaCallback = onRequest(async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback as
      | {
          CheckoutRequestID: string;
          ResultCode: number;
          ResultDesc: string;
          CallbackMetadata?: {
            Item: Array<{ Name: string; Value: unknown }>;
          };
        }
      | undefined;

    if (!callback?.CheckoutRequestID) {
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    const checkoutRequestId = callback.CheckoutRequestID;
    const receivedToken = req.query["cbtoken"] as string | undefined;

    // Fetch the payment doc and verify the per-payment callback token.
    const paymentRef = db.collection("payments").doc(checkoutRequestId);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) {
      // Unknown payment — respond OK so Safaricom stops retrying.
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    const paymentData = paymentSnap.data()!;

    if (!receivedToken || paymentData.callbackToken !== receivedToken) {
      // Token mismatch — silently reject to avoid leaking info.
      res.status(400).json({ ResultCode: 1, ResultDesc: "Invalid token" });
      return;
    }

    if (callback.ResultCode === 0) {
      const items = callback.CallbackMetadata?.Item ?? [];
      const get = (name: string) =>
        items.find((i) => i.Name === name)?.Value;
      const mpesaCode = get("MpesaReceiptNumber") as string | undefined;

      await paymentRef.update({
        status: "completed",
        mpesaCode: mpesaCode ?? null,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (paymentData.productId) {
        const productRef = db
          .collection("products")
          .doc(paymentData.productId as string);
        const productSnap = await productRef.get();
        const productData = productSnap.data();

        const now = new Date();
        const currentExpiry = productData?.expiresAt?.toDate?.() as
          | Date
          | undefined;
        const baseDate =
          currentExpiry && currentExpiry > now ? currentExpiry : now;
        const expiresAt = new Date(baseDate);
        expiresAt.setDate(expiresAt.getDate() + LISTING_DURATION_DAYS);

        await productRef.update({
          status: "active",
          expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
          plan: paymentData.plan,
          photoLimit: paymentData.photoLimit,
          verified: true,
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } else {
      await paymentRef.update({
        status: callback.ResultCode === 1032 ? "cancelled" : "failed",
        failureReason: callback.ResultDesc,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("Error processing M-Pesa callback:", err);
  }

  // Respond after all writes are complete.
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});
