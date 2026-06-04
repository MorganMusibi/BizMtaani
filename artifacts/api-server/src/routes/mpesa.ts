/**
 * M-Pesa Daraja API — STK Push for listing activation.
 *
 * Business model: advertisers pay KES 60 (basic, 2 photos, 7 days)
 *                 or KES 120 (premium, 4 photos, 7 days) to post a listing.
 *
 * Required env vars:
 *   MPESA_CONSUMER_KEY      — Daraja app consumer key
 *   MPESA_CONSUMER_SECRET   — Daraja app consumer secret
 *   MPESA_SHORTCODE         — Paybill / Till number (sandbox default: 174379)
 *   MPESA_PASSKEY           — Lipa Na M-Pesa passkey (sandbox default provided)
 *   MPESA_ENVIRONMENT       — "sandbox" (default) | "production"
 *   MPESA_CALLBACK_URL      — Override callback URL (optional)
 */
import { Router } from "express";
import admin from "firebase-admin";
import { getFirebaseAdmin, getFirestore } from "../lib/firebase-admin.js";

const router = Router();

// ---------- plan config ----------
const PLAN_AMOUNTS = { basic: 60, premium: 120 } as const;
const PLAN_PHOTO_LIMITS = { basic: 2, premium: 4 } as const;
const LISTING_DURATION_DAYS = 7;

// Safaricom sandbox public test passkey for shortcode 174379
const SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

// ---------- helpers ----------
interface DarajaToken { token: string; expiresAt: number }
let _token: DarajaToken | null = null;

function isSandbox(): boolean {
  return process.env.MPESA_ENVIRONMENT !== "production";
}

function darajaBase(): string {
  return isSandbox()
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

/** Fetch with a hard timeout (ms). Throws on timeout. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(tid);
  }
}

async function getDarajaToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.token;
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error("MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not set");
  const creds = Buffer.from(`${key}:${secret}`).toString("base64");

  const url = `${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { Authorization: `Basic ${creds}` } }, 15_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Daraja token request timed out or failed: ${msg}`);
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Daraja token request failed HTTP ${res.status}: ${rawText}`);
  }

  let data: { access_token: string; expires_in: string };
  try {
    data = JSON.parse(rawText) as { access_token: string; expires_in: string };
  } catch {
    throw new Error(`Daraja token response not JSON: ${rawText.slice(0, 200)}`);
  }

  if (!data.access_token) {
    throw new Error(`Daraja token response missing access_token: ${rawText.slice(0, 200)}`);
  }

  _token = { token: data.access_token, expiresAt: Date.now() + parseInt(data.expires_in) * 1000 };
  return _token.token;
}

function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s\-+]/g, "");
  if (p.startsWith("254") && p.length === 12) return p;
  if ((p.startsWith("07") || p.startsWith("01")) && p.length === 10) return "254" + p.slice(1);
  if (p.startsWith("7") && p.length === 9) return "254" + p;
  throw new Error(`Invalid phone number: ${raw}`);
}

function timestamp(): string {
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

function stkPassword(shortcode: string, passkey: string, ts: string): string {
  return Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
}

function callbackUrl(): string {
  if (process.env.MPESA_CALLBACK_URL) return process.env.MPESA_CALLBACK_URL;
  const domains = process.env.REPLIT_DOMAINS ?? "";
  const first = domains.split(",")[0]?.trim();
  if (first) return `https://${first}/api/mpesa/callback`;
  // In sandbox mode, Safaricom doesn't validate the callback URL strictly,
  // so use a placeholder that won't crash. In production this must be a real URL.
  if (isSandbox()) {
    return "https://example.com/api/mpesa/callback";
  }
  throw new Error("Cannot determine callback URL — set MPESA_CALLBACK_URL");
}

async function verifyToken(authHeader: string | undefined): Promise<admin.auth.DecodedIdToken> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing auth token");
  return getFirebaseAdmin().auth().verifyIdToken(authHeader.slice(7));
}

// ---------- routes ----------

/**
 * POST /api/mpesa/stkpush
 * Initiate STK push for a listing activation payment.
 * Body: { phone, plan: 'basic'|'premium', productId }
 * Header: Authorization: Bearer <firebaseIdToken>
 */
router.post("/mpesa/stkpush", async (req, res) => {
  let uid: string;
  try {
    const decoded = await verifyToken(req.headers.authorization);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { phone, plan, productId } = req.body as {
    phone: string; plan: "basic" | "premium"; productId: string;
  };

  if (!phone || !plan || !productId) {
    res.status(400).json({ error: "phone, plan and productId are required" });
    return;
  }
  if (plan !== "basic" && plan !== "premium") {
    res.status(400).json({ error: "plan must be 'basic' or 'premium'" });
    return;
  }

  const shortcode = process.env.MPESA_SHORTCODE
    ?? (isSandbox() ? "174379" : undefined);
  const passkey = process.env.MPESA_PASSKEY
    ?? (isSandbox() ? SANDBOX_PASSKEY : undefined);

  if (!shortcode) {
    req.log.error("MPESA_SHORTCODE not configured");
    res.status(503).json({ error: "M-Pesa not configured on this server (missing MPESA_SHORTCODE)" });
    return;
  }
  if (!passkey) {
    req.log.error("MPESA_PASSKEY not configured");
    res.status(503).json({ error: "M-Pesa not configured on this server (missing MPESA_PASSKEY)" });
    return;
  }

  let formattedPhone: string;
  try {
    formattedPhone = normalizePhone(phone);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const amount = PLAN_AMOUNTS[plan];
  const photoLimit = PLAN_PHOTO_LIMITS[plan];

  req.log.info(
    { uid, plan, amount, productId, phone: formattedPhone, env: process.env.MPESA_ENVIRONMENT ?? "sandbox" },
    "STK push initiated"
  );

  try {
    req.log.info("Fetching Daraja access token...");
    const token = await getDarajaToken();
    req.log.info("Daraja access token obtained");

    const ts = timestamp();
    const password = stkPassword(shortcode, passkey, ts);
    const txType = process.env.MPESA_TRANSACTION_TYPE ?? "CustomerPayBillOnline";
    const cbUrl = callbackUrl();

    const stkBody = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: txType,
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: cbUrl,
      AccountReference: productId.slice(0, 12),
      TransactionDesc: `BizMtaani ${plan} listing`,
    };

    req.log.info({ stkBody: { ...stkBody, Password: "[redacted]" } }, "Sending STK push to Daraja");

    let darajaRes: Response;
    try {
      darajaRes = await fetchWithTimeout(
        `${darajaBase()}/mpesa/stkpush/v1/processrequest`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(stkBody),
        },
        30_000
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Daraja STK push timed out or failed: ${msg}`);
    }

    const rawText = await darajaRes.text();
    req.log.info({ status: darajaRes.status, body: rawText.slice(0, 500) }, "Daraja STK push response");

    let darajaData: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
      CustomerMessage?: string;
      errorCode?: string;
      errorMessage?: string;
    };
    try {
      darajaData = JSON.parse(rawText);
    } catch {
      throw new Error(`Daraja response not JSON (HTTP ${darajaRes.status}): ${rawText.slice(0, 200)}`);
    }

    if (!darajaRes.ok || darajaData.errorCode || darajaData.ResponseCode !== "0") {
      req.log.warn({ darajaData, httpStatus: darajaRes.status }, "Daraja STK push error response");
      res.status(502).json({
        error: darajaData.errorMessage ?? darajaData.ResponseDescription ?? "Daraja error",
        darajaCode: darajaData.errorCode ?? darajaData.ResponseCode,
      });
      return;
    }

    const checkoutRequestId = darajaData.CheckoutRequestID!;
    const merchantRequestId = darajaData.MerchantRequestID!;

    const db = getFirestore();
    await db.collection("payments").doc(checkoutRequestId).set({
      checkoutRequestId,
      merchantRequestId,
      type: `listing_${plan}`,
      plan,
      photoLimit,
      productId,
      buyerId: uid,
      buyerPhone: formattedPhone,
      amount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    req.log.info({ checkoutRequestId, uid, productId, plan, amount }, "STK push created, payment doc written");
    res.json({
      success: true,
      checkoutRequestId,
      merchantRequestId,
      customerMessage: darajaData.CustomerMessage,
    });
  } catch (err) {
    req.log.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, "STK push failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to initiate payment" });
  }
});

/**
 * POST /api/mpesa/callback
 * Called by Safaricom after the user completes or cancels the STK prompt.
 * On success: activates the pending listing with a 7-day expiry.
 */
router.post("/mpesa/callback", async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback as {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: Array<{ Name: string; Value: unknown }> };
    };

    req.log.info({ callback }, "M-Pesa callback received");

    if (!callback?.CheckoutRequestID) return;

    const db = getFirestore();
    const checkoutRequestId = callback.CheckoutRequestID;
    const paymentRef = db.collection("payments").doc(checkoutRequestId);

    if (callback.ResultCode === 0) {
      const items = callback.CallbackMetadata?.Item ?? [];
      const get = (name: string) => items.find((i) => i.Name === name)?.Value;
      const mpesaCode = get("MpesaReceiptNumber") as string | undefined;

      await paymentRef.update({
        status: "completed",
        mpesaCode: mpesaCode ?? null,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const paymentSnap = await paymentRef.get();
      const paymentData = paymentSnap.data();

      if (paymentData?.productId) {
        const productRef = db.collection("products").doc(paymentData.productId as string);
        const productSnap = await productRef.get();
        const productData = productSnap.data();

        const now = new Date();
        const currentExpiry = productData?.expiresAt?.toDate?.() as Date | undefined;
        const baseDate = (currentExpiry && currentExpiry > now) ? currentExpiry : now;
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

        req.log.info({ productId: paymentData.productId, mpesaCode, expiresAt }, "Listing activated after payment");
      }
    } else {
      await paymentRef.update({
        status: callback.ResultCode === 1032 ? "cancelled" : "failed",
        failureReason: callback.ResultDesc,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      req.log.info({ checkoutRequestId, resultCode: callback.ResultCode, desc: callback.ResultDesc }, "M-Pesa payment failed/cancelled");
    }
  } catch (err) {
    req.log.error({ err }, "Error processing M-Pesa callback");
  }
});

/**
 * GET /api/mpesa/status/:checkoutRequestId
 * Query Daraja for live transaction status.
 */
router.get("/mpesa/status/:checkoutRequestId", async (req, res) => {
  try {
    await verifyToken(req.headers.authorization);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { checkoutRequestId } = req.params;
  const shortcode = process.env.MPESA_SHORTCODE
    ?? (isSandbox() ? "174379" : undefined);
  const passkey = process.env.MPESA_PASSKEY
    ?? (isSandbox() ? SANDBOX_PASSKEY : undefined);

  if (!shortcode || !passkey) {
    res.status(503).json({ error: "M-Pesa not configured" });
    return;
  }

  try {
    const token = await getDarajaToken();
    const ts = timestamp();
    const darajaRes = await fetchWithTimeout(
      `${darajaBase()}/mpesa/stkpushquery/v1/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: stkPassword(shortcode, passkey, ts),
          Timestamp: ts,
          CheckoutRequestID: checkoutRequestId,
        }),
      },
      15_000
    );
    const data = await darajaRes.json();
    req.log.info({ checkoutRequestId, data }, "STK status query result");
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Status query failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Status query failed" });
  }
});

export default router;
