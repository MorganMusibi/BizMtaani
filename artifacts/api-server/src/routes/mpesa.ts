/**
 * M-Pesa Daraja API — STK Push (Lipa Na M-Pesa) integration.
 *
 * Required env vars:
 *   MPESA_CONSUMER_KEY      — Daraja app consumer key
 *   MPESA_CONSUMER_SECRET   — Daraja app consumer secret
 *   MPESA_SHORTCODE         — Business short code (Paybill) or Till number
 *   MPESA_PASSKEY           — Lipa Na M-Pesa passkey (from Daraja portal)
 *   MPESA_ENVIRONMENT       — "sandbox" (default) | "production"
 *   MPESA_TRANSACTION_TYPE  — "CustomerPayBillOnline" (default) | "CustomerBuyGoodsOnline"
 *   MPESA_CALLBACK_URL      — Override callback URL (optional; auto-detected from REPLIT_DOMAINS)
 */
import { Router } from "express";
import admin from "firebase-admin";
import { getFirebaseAdmin, getFirestore } from "../lib/firebase-admin.js";

const router = Router();

// ---------- helpers ----------

interface DarajaToken { token: string; expiresAt: number }
let _token: DarajaToken | null = null;

function darajaBase(): string {
  return process.env.MPESA_ENVIRONMENT === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getDarajaToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.token;
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error("MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not set");
  const creds = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Daraja token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: string };
  _token = { token: data.access_token, expiresAt: Date.now() + parseInt(data.expires_in) * 1000 };
  return _token.token;
}

/** Normalize a Kenyan phone number to 254XXXXXXXXX format */
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
  throw new Error("Cannot determine callback URL — set MPESA_CALLBACK_URL");
}

// ---------- verify Firebase ID token ----------
async function verifyToken(authHeader: string | undefined): Promise<admin.auth.DecodedIdToken> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing auth token");
  const idToken = authHeader.slice(7);
  return getFirebaseAdmin().auth().verifyIdToken(idToken);
}

// ---------- routes ----------

/**
 * POST /api/mpesa/stkpush
 * Body: { phone, amount, productId, productTitle, sellerId }
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

  const { phone, amount, productId, productTitle, sellerId } = req.body as {
    phone: string; amount: number; productId: string; productTitle: string; sellerId: string;
  };

  if (!phone || !amount || !productId || !sellerId) {
    res.status(400).json({ error: "phone, amount, productId and sellerId are required" });
    return;
  }

  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!shortcode || !passkey) {
    res.status(503).json({ error: "M-Pesa not configured on this server (missing MPESA_SHORTCODE / MPESA_PASSKEY)" });
    return;
  }

  let formattedPhone: string;
  try {
    formattedPhone = normalizePhone(phone);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  try {
    const token = await getDarajaToken();
    const ts = timestamp();
    const password = stkPassword(shortcode, passkey, ts);
    const txType = process.env.MPESA_TRANSACTION_TYPE ?? "CustomerPayBillOnline";
    const cbUrl = callbackUrl();

    const body = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: txType,
      Amount: Math.ceil(amount),
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: cbUrl,
      AccountReference: productId.slice(0, 12),
      TransactionDesc: `Pay for ${(productTitle ?? "item").slice(0, 40)}`,
    };

    const darajaRes = await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const darajaData = (await darajaRes.json()) as {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
      CustomerMessage?: string;
      errorCode?: string;
      errorMessage?: string;
    };

    if (!darajaRes.ok || darajaData.errorCode) {
      req.log.warn({ darajaData }, "Daraja STK push error");
      res.status(502).json({ error: darajaData.errorMessage ?? darajaData.ResponseDescription ?? "Daraja error" });
      return;
    }

    const checkoutRequestId = darajaData.CheckoutRequestID!;
    const merchantRequestId = darajaData.MerchantRequestID!;

    // Save payment record to Firestore
    const db = getFirestore();
    await db.collection("payments").doc(checkoutRequestId).set({
      checkoutRequestId,
      merchantRequestId,
      productId,
      productTitle: productTitle ?? "",
      buyerId: uid,
      buyerPhone: formattedPhone,
      sellerId,
      amount: Math.ceil(amount),
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    req.log.info({ checkoutRequestId, uid, productId, amount }, "STK push initiated");
    res.json({
      success: true,
      checkoutRequestId,
      merchantRequestId,
      customerMessage: darajaData.CustomerMessage,
    });
  } catch (err) {
    req.log.error({ err }, "STK push failed");
    res.status(500).json({ error: "Failed to initiate payment" });
  }
});

/**
 * POST /api/mpesa/callback
 * Called by Safaricom after the user completes or cancels the STK prompt.
 */
router.post("/mpesa/callback", async (req, res) => {
  // Always respond 200 immediately (Safaricom expects quick acknowledgement)
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback as {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: Array<{ Name: string; Value: unknown }> };
    };

    if (!callback?.CheckoutRequestID) return;

    const db = getFirestore();
    const docRef = db.collection("payments").doc(callback.CheckoutRequestID);

    if (callback.ResultCode === 0) {
      // Success — extract receipt details from CallbackMetadata
      const items = callback.CallbackMetadata?.Item ?? [];
      const get = (name: string) => items.find((i) => i.Name === name)?.Value;
      const mpesaCode = get("MpesaReceiptNumber") as string | undefined;
      const txAmount = get("Amount") as number | undefined;
      const txPhone = get("PhoneNumber") as string | undefined;

      await docRef.update({
        status: "completed",
        mpesaCode: mpesaCode ?? null,
        txAmount: txAmount ?? null,
        txPhone: String(txPhone ?? ""),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      req.log.info({ checkoutRequestId: callback.CheckoutRequestID, mpesaCode }, "M-Pesa payment completed");
    } else {
      // Failed or cancelled by user
      await docRef.update({
        status: callback.ResultCode === 1032 ? "cancelled" : "failed",
        failureReason: callback.ResultDesc,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      req.log.info({ checkoutRequestId: callback.CheckoutRequestID, resultCode: callback.ResultCode }, "M-Pesa payment failed/cancelled");
    }
  } catch (err) {
    req.log.error({ err }, "Error processing M-Pesa callback");
  }
});

/**
 * GET /api/mpesa/status/:checkoutRequestId
 * Query Daraja for live transaction status (optional — Firestore listener is preferred).
 * Header: Authorization: Bearer <firebaseIdToken>
 */
router.get("/mpesa/status/:checkoutRequestId", async (req, res) => {
  try {
    await verifyToken(req.headers.authorization);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { checkoutRequestId } = req.params;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!shortcode || !passkey) {
    res.status(503).json({ error: "M-Pesa not configured" });
    return;
  }

  try {
    const token = await getDarajaToken();
    const ts = timestamp();
    const darajaRes = await fetch(`${darajaBase()}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: stkPassword(shortcode, passkey, ts),
        Timestamp: ts,
        CheckoutRequestID: checkoutRequestId,
      }),
    });
    const data = await darajaRes.json();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Status query failed");
    res.status(500).json({ error: "Status query failed" });
  }
});

export default router;
