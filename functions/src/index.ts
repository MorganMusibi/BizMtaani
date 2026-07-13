/**
 * BizMtaani Firebase Cloud Functions — CONSOLIDATED BACKEND
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
// Update these to reflect the plans actually used in your frontend (mpesa.ts)
const PLAN_AMOUNTS: Record<string, number> = { 
  free: 0, 
  premium_weekly: 100, 
  premium_monthly: 350 
};

// If you are using limits in your backend, update them here:
const MAX_PHOTO_LIMIT: Record<string, number> = {
  free: 1,
  premium_weekly: Infinity,
  premium_monthly: Infinity,
};
// Add this in your Constants section
const LISTING_DURATIONS: Record<string, number> = {
  free: 7,
  premium_weekly: 7,
  premium_monthly: 30,
};
const SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

function isSandbox(): boolean {
  return (process.env.MPESA_ENVIRONMENT ?? "sandbox") !== "production";
}

function darajaBase(): string {
  return isSandbox() ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
}

function mpesaTimestamp(): string {
  const n = new Date();
  return [n.getFullYear(), String(n.getMonth() + 1).padStart(2, "0"), String(n.getDate()).padStart(2, "0"), String(n.getHours()).padStart(2, "0"), String(n.getMinutes()).padStart(2, "0"), String(n.getSeconds()).padStart(2, "0")].join("");
}

function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s\-+]/g, "");
  if (p.startsWith("254") && p.length === 12) return p;
  if ((p.startsWith("07") || p.startsWith("01")) && p.length === 10) return "254" + p.slice(1);
  if (p.startsWith("7") && p.length === 9) return "254" + p;
  throw new Error(`Invalid Kenyan number: ${raw}`);
}

let _darajaToken: { token: string; expiresAt: number } | null = null;
async function getDarajaToken(key: string, secret: string): Promise<string> {
  if (_darajaToken && Date.now() < _darajaToken.expiresAt - 60_000) return _darajaToken.token;
  const creds = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${creds}` } });
  if (!res.ok) { const text = await res.text(); throw new Error(`Daraja token failed: ${text.slice(0, 200)}`); }
  const data = (await res.json()) as { access_token: string; expires_in: string };
  _darajaToken = { token: data.access_token, expiresAt: Date.now() + parseInt(data.expires_in) * 1000 };
  return _darajaToken.token;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. IMAGE UPLOADS
// ═══════════════════════════════════════════════════════════════════════════
export const getCloudinarySignature = onCall({ secrets: [cloudinaryApiKey, cloudinaryApiSecret, cloudinaryCloudName], cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uploadType = ((request.data as Record<string, unknown>).uploadType as string | undefined) ?? "product";
  const folder = FOLDER_MAP[uploadType] ?? FOLDER_MAP["product"];
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${cloudinaryApiSecret.value()}`).digest("hex");
  return { signature, timestamp, folder, apiKey: cloudinaryApiKey.value(), cloudName: cloudinaryCloudName.value() };
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. M-PESA PAYMENTS & CALLBACK
// ═══════════════════════════════════════════════════════════════════════════
export const initiateMpesaPayment = onCall({ secrets: [mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey], cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const { phone, plan, productId } = request.data as { phone: string; plan: string; productId: string };
  const formattedPhone = normalizePhone(phone);
  const token = await getDarajaToken(mpesaConsumerKey.value(), mpesaConsumerSecret.value());
  const ts = mpesaTimestamp();
  const callbackToken = crypto.randomBytes(24).toString("hex");
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  const stkBody = {
    BusinessShortCode: process.env.MPESA_SHORTCODE ?? "174379",
    Password: Buffer.from(`${process.env.MPESA_SHORTCODE ?? "174379"}${mpesaPasskey.value() || SANDBOX_PASSKEY}${ts}`).toString("base64"),
    Timestamp: ts,
    TransactionType: "CustomerPayBillOnline",
    Amount: PLAN_AMOUNTS[plan],
    PartyA: formattedPhone, PartyB: process.env.MPESA_SHORTCODE ?? "174379", PhoneNumber: formattedPhone,
    CallBackURL: `${process.env.MPESA_CALLBACK_URL ?? `https://us-central1-${projectId}.cloudfunctions.net/mpesaCallback`}?cbtoken=${callbackToken}`,
    AccountReference: productId.slice(0, 12), TransactionDesc: `BizMtaani ${plan} listing`,
  };
  const darajaRes = await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(stkBody) });
  const darajaData = await darajaRes.json() as any;
  if (!darajaRes.ok || darajaData.ResponseCode !== "0") throw new HttpsError("internal", darajaData.errorMessage ?? "Daraja error");
  await db.collection("payments").doc(darajaData.CheckoutRequestID).set({ checkoutRequestId: darajaData.CheckoutRequestID, callbackToken, plan, productId, buyerId: request.auth.uid, status: "pending", createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return { checkoutRequestId: darajaData.CheckoutRequestID, customerMessage: darajaData.CustomerMessage };
});

export const mpesaCallback = onRequest(async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) { res.json({ ResultCode: 0, ResultDesc: "Accepted" }); return; }
    const paymentRef = db.collection("payments").doc(callback.CheckoutRequestID);
    const paymentSnap = await paymentRef.get();
    if (paymentSnap.exists && paymentSnap.data()?.callbackToken === req.query["cbtoken"]) {
      if (callback.ResultCode === 0) {
        await paymentRef.update({ status: "completed", completedAt: admin.firestore.FieldValue.serverTimestamp() });
        const productRef = db.collection("products").doc(paymentSnap.data()?.productId);
        await productRef.update({ status: "active", expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + LISTING_DURATION_DAYS * 86_400_000)) });
      }
    }
  } catch (err) { console.error(err); }
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CLEANUP
// ═══════════════════════════════════════════════════════════════════════════
async function runCleanup() {
  const now = new Date();
  const snap = await db.collection("products").where("status", "==", "active").where("expiresAt", "<", now).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.update(d.ref, { status: "archived", archivedAt: admin.firestore.Timestamp.fromDate(now) }));
  await batch.commit();
  return { archived: snap.size };
}

// Fixed
export const scheduledCleanup = onSchedule({ schedule: "0 21 * * *" }, async (_event) => {
  await runCleanup();
});
export const triggerCleanup = onRequest(async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) { res.status(403).send(); return; }
  await runCleanup();
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
export const sendNotification = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  await admin.messaging().send({ token: request.data.token, notification: { title: request.data.title, body: request.data.body ?? "" }, data: request.data.data ?? {} });
  return { success: true };
  });
// ═══════════════════════════════════════════════════════════════════════════
// 5. SUBSCRIPTION GATEKEEPER
// ═══════════════════════════════════════════════════════════════════════════

export const publishAdvert = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  // 1. Data Prep
  const productData = request.data;
  
  // 2. Logic: If plan is 'free', it is active immediately. 
  // If it's a paid plan, it stays 'pending_payment' until M-Pesa is done.
  const status = productData.plan === 'free' ? 'active' : 'pending_payment';

  // 3. Save to Firestore
  const newProductRef = await db.collection("products").add({
  ...productData,
  ownerId: request.auth.uid,
  sellerId: request.auth.uid,
  status,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
});

  return { success: true, productId: newProductRef.id };
});

