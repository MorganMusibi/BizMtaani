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
  premium_weekly: Infinity, // Unlimited
  premium_monthly: Infinity, // Unlimited
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
        const paymentData = paymentSnap.data()!;
        // Retrieve the plan from the payment record to determine duration
        const plan = paymentData.plan ?? "free";
        const durationDays = LISTING_DURATIONS[plan] ?? 7;

        await paymentRef.update({ 
            status: "completed", 
            completedAt: admin.firestore.FieldValue.serverTimestamp() 
        });
        // Activate the advert
await db.collection("products").doc(paymentData.productId).update({
  status: "active",
  paidAt: admin.firestore.FieldValue.serverTimestamp(),
  expiresAt: admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + durationDays * 86_400_000)
  )
});

        // Add this in mpesaCallback
await db.collection("users").doc(paymentData.buyerId)
  .collection("subscription").doc("active").set({
    planType: plan,
    premiumEndsAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + durationDays * 86_400_000)
    ),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
        await db.collection("users").doc(paymentData.buyerId).set(
  {
    subscriptionPlan: plan,
    premiumEndsAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + durationDays * 86_400_000)
    ),
  },
  { merge: true }
);
      }
    }
  } catch (err) { console.error(err); }
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

async function deleteCloudinaryImage(publicId: string) {
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = crypto
    .createHash("sha1")
    .update(`public_id=${publicId}&timestamp=${timestamp}${cloudinaryApiSecret.value()}`)
    .digest("hex");

  const form = new URLSearchParams();

  form.append("public_id", publicId);
  form.append("timestamp", String(timestamp));
  form.append("api_key", cloudinaryApiKey.value());
  form.append("signature", signature);

  await fetch(
    `https://api.cloudinary.com/v1_1/${cloudinaryCloudName.value()}/image/destroy`,
    {
      method: "POST",
      body: form,
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CLEANUP
// ═══════════════════════════════════════════════════════════════════════════
async function runCleanup() {
  const now = admin.firestore.Timestamp.now();

  // Archive expired active adverts
  const expiredActive = await db.collection("products")
    .where("status", "==", "active")
    .where("expiresAt", "<", now)
    .get();

  // Delete abandoned pending payment adverts older than 1 hour
  const oneHourAgo = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 60 * 60 * 1000)
  );

  const expiredPending = await db.collection("products")
    .where("status", "==", "pending_payment")
    .where("createdAt", "<", oneHourAgo)
    .get();
  const expiredPayments = await db.collection("payments")
  .where("status", "==", "pending")
  .where("createdAt", "<", oneHourAgo)
  .get();

  const batch = db.batch();

  // Archive expired active adverts
  expiredActive.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: "archived",
    });
  });

  // Delete abandoned pending adverts and their Cloudinary images
for (const doc of expiredPending.docs) {

  const data = doc.data();

  if (Array.isArray(data.imageUrls)) {

    for (const img of data.imageUrls) {

      const publicId =
        typeof img === "string"
          ? null
          : img.public_id;

      if (publicId) {
        await deleteCloudinaryImage(publicId);
      }
    }
  }

  batch.delete(doc.ref);
}
  // Delete abandoned pending payment records
expiredPayments.docs.forEach((doc) => {
  batch.delete(doc.ref);
});

  await batch.commit();

  return {
  archived: expiredActive.size,
  deletedPending: expiredPending.size,
  deletedPayments: expiredPayments.size,
};
}

export const scheduledCleanup = onSchedule(
  {
    schedule: "every 1 hours",
    secrets: [
      cloudinaryApiKey,
      cloudinaryApiSecret,
      cloudinaryCloudName,
    ],
  },
  async () => {
    try {
      const result = await runCleanup();
      console.log(
  `Cleanup complete. Archived: ${result.archived}, Deleted pending adverts: ${result.deletedPending}, Deleted pending payments: ${result.deletedPayments}`
);
    } catch (error) {
      console.error("Cleanup failed:", error);
    }
  }
);

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

  const { plan, title, price, imageUrls, ...otherData } = request.data;
  const uid = request.auth.uid;
  
  // Check if the user has an active premium subscription
const userSnap = await db.collection("users").doc(uid).get();

let effectivePlan = plan;
let hasActiveSubscription = false;

if (userSnap.exists) {
  const userData = userSnap.data();

  if (
    userData?.subscriptionPlan &&
    userData?.premiumEndsAt &&
    userData.premiumEndsAt.toDate() > new Date()
  ) {
    effectivePlan = userData.subscriptionPlan;
    hasActiveSubscription = true;
  }
}

  // 1. Validation: Plan Existence
  if (!PLAN_AMOUNTS.hasOwnProperty(effectivePlan)) {
    throw new HttpsError("invalid-argument", "Invalid plan selected.");
  }

  // 2. Validation: Required Fields
  if (!title || !price || !imageUrls || !Array.isArray(imageUrls)) {
    throw new HttpsError("invalid-argument", "Missing required product details.");
  }

  // 3. Validation: Photo Limits
  const limit = MAX_PHOTO_LIMIT[effectivePlan] ?? 0;
  if (imageUrls.length > limit) {
    throw new HttpsError("failed-precondition", `Your plan allows a maximum of ${limit} photos.`);
  }

  // 4. Logic: Free Ad Limit Enforcement
  if (effectivePlan === "free") {
  const userAds = await db
    .collection("products")
    .where("ownerId", "==", uid)
    .where("status", "==", "active")
    .get();

  if (userAds.size >= 5) {
    throw new HttpsError(
      "failed-precondition",
      "You have reached the maximum of 5 free ads."
    );
  }
}

  // 5. Logic: Status Determination
  // Paid plans start as 'pending_payment'; Free plans start as 'active'
  const status =
  effectivePlan === "free" || hasActiveSubscription
    ? "active"
    : "pending_payment";

  // 6. Logic: Dynamic Expiry (Only if active immediately)
  const durationDays = LISTING_DURATIONS[effectivePlan] ?? 7;
  const expiresAt = status === 'active' 
    ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + durationDays * 86_400_000))
    : null;

  // 7. Save Ad
  const newProductRef = await db.collection("products").add({
    ...otherData,
    title,
    price,
    imageUrls,
    plan: effectivePlan,
    ownerId: uid,
    sellerId: uid,
    status,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt
  });

  // 8. Return the generated productId
  return { success: true, productId: newProductRef.id };
});
