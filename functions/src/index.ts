/**
 * BizMtaani Firebase Cloud Functions — CONSOLIDATED BACKEND
 *
 * All backend operations now handled via Firebase Cloud Functions.
 * (artifacts/api-server/ is DEPRECATED — see DEPRECATION.md)
 *
 * Operations:
 *   1. getCloudinarySignature   — signs direct browser uploads to Cloudinary
 *   2. initiateMpesaPayment     — STK push via Daraja API
 *   3. mpesaCallback            — Safaricom webhook, activates paid listings
 *   4. scheduledCleanup         — daily cleanup: expires listings, stale payments (21:00 UTC)
 *   5. triggerCleanup           — manual cleanup endpoint
 *   6. sendNotification         — FCM push notifications (auth-protected)
 *
 * Secrets (set via `firebase functions:secrets:set <NAME>`):
 *   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY
 *
 * Env vars (firebase.json or GCP console):
 *   MPESA_SHORTCODE (default: 174379 sandbox)
 *   MPESA_ENVIRONMENT (default: sandbox)
 *   MPESA_CALLBACK_URL (optional full URL override)
 *   CRON_SECRET (for manual cleanup trigger)
 */

import * as crypto from "crypto";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

// ─── Secrets ───────────────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════
// 1. IMAGE UPLOADS (Cloudinary)
// ═══════════════════════════════════════════════════════════════════════════

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

    const apiSecret = process.env.CLOUDINARY_API_SECRET || "";
    const apiKey = process.env.CLOUDINARY_API_KEY || "";
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";

    if (!apiSecret || !apiKey || !cloudName) {
      throw new HttpsError("internal", "Cloudinary configuration keys are missing or invalid.");
    }

    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash("sha1")
      .update(paramsToSign + apiSecret)
      .digest("hex");

    return {
      signature,
      timestamp,
      folder,
      apiKey,
      cloudName,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// 2. M-PESA PAYMENTS (Daraja)
// ═══════════════════════════════════════════════════════════════════════════

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

    const paymentRef = db.collection("payments").doc(checkoutRequestId);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) {
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    const paymentData = paymentSnap.data()!;

    if (!receivedToken || paymentData.callbackToken !== receivedToken) {
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

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. AUTOMATED CLEANUP (formerly in artifacts/api-server/)
// ═══════════════════════════════════════════════════════════════════════════

async function runCleanup() {
  const now = new Date();
  let archived = 0, deleted = 0, stalePending = 0, paymentsCleaned = 0;

  console.log("[CLEANUP] Starting automated cleanup...");

  // 1. Archive expired listings (3-day grace period before permanent deletion)
  try {
    const snap = await db.collection("products")
      .where("status", "==", "active").where("expiresAt", "<", now).limit(500).get();
    if (snap.size > 0) {
      const batch = db.batch();
      snap.docs.forEach((d) => {
        batch.update(d.ref, {
          status: "archived",
          archivedAt: admin.firestore.Timestamp.fromDate(now),
        });
        archived++;
      });
      await batch.commit();
    }
    console.log(`[CLEANUP] Archived ${archived} expired listings`);
  } catch (err) {
    console.error("[CLEANUP] Error archiving listings:", err);
  }

  // 2. Permanently delete archived listings older than 3 days
  const cutoff3d = new Date(Date.now() - 3 * 86_400_000);
  try {
    const snap = await db.collection("products")
      .where("status", "==", "archived").where("archivedAt", "<", cutoff3d).limit(200).get();
    for (const docSnap of snap.docs) {
      await deleteProductWithImages(docSnap);
      deleted++;
    }
    console.log(`[CLEANUP] Deleted ${deleted} archived listings (3+ days old)`);
  } catch (err) {
    console.error("[CLEANUP] Error deleting archived listings:", err);
  }

  // 3. Delete stale pending_payment products (24h old)
  const cutoff24h = new Date(Date.now() - 86_400_000);
  try {
    const snap = await db.collection("products")
      .where("status", "==", "pending_payment").where("createdAt", "<", cutoff24h).limit(200).get();
    for (const docSnap of snap.docs) {
      await deleteProductWithImages(docSnap);
      stalePending++;
    }
    console.log(`[CLEANUP] Deleted ${stalePending} stale pending listings (24h+ old)`);
  } catch (err) {
    console.error("[CLEANUP] Error deleting stale pending listings:", err);
  }

  // 4. Time out old pending payments (2h old)
  const cutoff2h = new Date(Date.now() - 7_200_000);
  try {
    const snap = await db.collection("payments")
      .where("status", "==", "pending").where("createdAt", "<", cutoff2h).limit(500).get();
    if (snap.size > 0) {
      const batch = db.batch();
      snap.docs.forEach((d) => {
        batch.update(d.ref, { status: "timed_out" });
        paymentsCleaned++;
      });
      await batch.commit();
    }
    console.log(`[CLEANUP] Timed out ${paymentsCleaned} old pending payments`);
  } catch (err) {
    console.error("[CLEANUP] Error timing out payments:", err);
  }

  console.log(`[CLEANUP] Complete: archived=${archived}, deleted=${deleted}, stalePending=${stalePending}, paymentsCleaned=${paymentsCleaned}`);
  return { archived, deleted, stalePending, paymentsCleaned };
}

async function deleteProductWithImages(docSnap: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = docSnap.data();
  const urls: string[] = data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : []);

  // Delete Cloudinary images (best-effort, non-critical)
  for (const url of urls) {
    try {
      const m = url.match(/\/bizmtaani\/([^/]+)\/([^/.]+)(?:\.[a-z]+)?$/i);
      if (m) {
        // In production, call Cloudinary API to delete
        // For now, just log intent
        console.log(`[CLEANUP] Would delete Cloudinary image: bizmtaani/${m[1]}/${m[2]}`);
      }
    } catch (e) {
      console.warn(`[CLEANUP] Image delete failed (non-critical):`, e);
    }
  }

  // Delete Firestore doc
  await docSnap.ref.delete();
}

/**
 * Scheduled cleanup runs daily at 21:00 UTC (midnight EAT).
 */
export const scheduledCleanup = onSchedule("0 21 * * *", async (_context) => {
  return await runCleanup();
});

/**
 * Manual cleanup trigger (requires x-cron-secret header).
 */
export const triggerCleanup = onRequest(async (req, res) => {
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || req.headers["x-cron-secret"] !== cronSecret) {
    res.status(403).json({ error: "Forbidden: invalid or missing CRON_SECRET" });
    return;
  }
  const result = await runCleanup();
  res.json({ ok: true, ...result });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PUSH NOTIFICATIONS (FCM)
// ═══════════════════════════════════════════════════════════════════════════

export const sendNotification = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const { token, title, body, data } = request.data as {
      token: string;
      title: string;
      body?: string;
      data?: Record<string, string>;
    };

    if (!token || !title) {
      throw new HttpsError("invalid-argument", "token and title are required");
    }

    try {
      await admin.messaging().send({
        token,
        notification: { title, body: body ?? "" },
        data: data ?? {},
        android: {
          notification: {
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            sound: "default",
          },
        },
        webpush: {
          notification: {
            icon: "/icon-192.png",
            badge: "/icon-192.png",
          },
          fcmOptions: {
            link: data?.chatUrl ?? "/",
          },
        },
      });
      return { success: true };
    } catch (err) {
      console.error("[FCM] Notification send failed:", err);
      throw new HttpsError("internal", "Notification send failed");
    }
  }
);
