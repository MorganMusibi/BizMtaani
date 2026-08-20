/**
 * BizMtaani Firebase Cloud Functions — CONSOLIDATED BACKEND
 */

import * as crypto from "crypto";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
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
const recaptchaSecretKey = defineSecret("RECAPTCHA_SECRET_KEY");

// Single source of truth for the owner UID — referenced by every
// admin-only function instead of repeating the literal string.
const OWNER_UID = "MdkkpY3BkMNdTYChcR2TaNtK08W2";
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
  premium_weekly: 3,
  premium_monthly: 3,
};

const MAX_ACTIVE_ADS: Record<string, number> = {
  free: 3,
  premium_weekly: 8,
  premium_monthly: 10,
};
// Add this in your Constants section
const LISTING_DURATIONS: Record<string, number> = {
  free: 7,
  premium_weekly: 7,
  premium_monthly: 30,
};
const CLEANUP_LIMIT = 150;
const ARCHIVE_RETENTION_DAYS = 45;
const MINIMUM_PAYOUT_KES = 100; // adjust to whatever makes sense for your M-Pesa costs

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

async function verifyRecaptcha(token: unknown, expectedAction: string): Promise<void> {
  if (typeof token !== "string" || !token.trim()) {
    throw new HttpsError("invalid-argument", "Missing reCAPTCHA token.");
  }
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${recaptchaSecretKey.value()}&response=${token}`,
  });
  if (!res.ok) {
    throw new HttpsError("internal", "reCAPTCHA verification service unavailable.");
  }
  const data = (await res.json()) as { success: boolean; score?: number; action?: string };
  if (!data.success || data.action !== expectedAction || (data.score ?? 0) < 0.5) {
    throw new HttpsError("permission-denied", "reCAPTCHA verification failed.");
  }
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

/**
 * Records an admin action to a permanent, unmodifiable audit log.
 * Never throws — a logging failure should never block the actual
 * admin action from completing.
 */
async function logAdminAction(
  adminUid: string,
  action: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.collection("adminAuditLog").add({
      adminUid,
      action,
      ...details,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error(`Failed to log admin action "${action}":`, error);
  }
}

/**
 * Shared push helper — looks up the user's saved FCM token and sends,
 * silently no-op-ing if they have none registered. Never throws —
 * a failed notification should never break the calling flow.
 */
async function sendPushToUid(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<void> {
  try {
    const tokenSnap = await db.collection("fcmTokens").doc(uid).get();
    const token = tokenSnap.exists ? tokenSnap.data()?.token : null;
    if (!token) return;

    await admin.messaging().send({
      token,
      notification: { title, body },
      data,
    });
  } catch (error) {
    console.error(`Failed to send notification to ${uid}:`, error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. IMAGE UPLOADS
// ═══════════════════════════════════════════════════════════════════════════
// 8 MB covers your app's existing 4-5MB client-side limits with
// headroom, while still blocking anything wildly oversized.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_UPLOAD_FORMATS = "jpg,jpeg,png,webp";

export const getCloudinarySignature = onCall({ secrets: [cloudinaryApiKey, cloudinaryApiSecret, cloudinaryCloudName], cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uploadType = ((request.data as Record<string, unknown>).uploadType as string | undefined) ?? "product";
  const folder = FOLDER_MAP[uploadType] ?? FOLDER_MAP["product"];
  const timestamp = Math.floor(Date.now() / 1000);

  // Every parameter included in the signature is enforced by
  // Cloudinary server-side — a client cannot alter these without
  // invalidating the signature, so this closes the gap left by an
  // unsigned preset (which your app doesn't use anyway).
  // NOTE: Cloudinary's real parameter name is max_file_size, not
  // bytes_limit (which isn't a recognized upload parameter and
  // gets silently dropped from Cloudinary's own signature check).
  const signature = crypto
    .createHash("sha1")
    .update(
      `allowed_formats=${ALLOWED_UPLOAD_FORMATS}&folder=${folder}&max_file_size=${MAX_UPLOAD_BYTES}&timestamp=${timestamp}${cloudinaryApiSecret.value()}`
    )
    .digest("hex");

  const draftId = crypto.randomBytes(12).toString("hex");
  await db.collection("draftUploads").doc(draftId).set({
    uid: request.auth.uid,
    folder,
    claimed: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    signature,
    timestamp,
    folder,
    apiKey: cloudinaryApiKey.value(),
    cloudName: cloudinaryCloudName.value(),
    draftId,
    allowedFormats: ALLOWED_UPLOAD_FORMATS,
    maxFileSize: MAX_UPLOAD_BYTES,
  };
});

/**
 * Attaches an uploaded image's Cloudinary public_id to its draft
 * record, so it can be deleted automatically if the advert it was
 * meant for is never published.
 */
export const attachDraftUploadImage = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { draftId, publicId } = request.data as { draftId?: string; publicId?: string };
  if (!draftId || !publicId) {
    throw new HttpsError("invalid-argument", "draftId and publicId are required.");
  }

  const draftRef = db.collection("draftUploads").doc(draftId);
  const draftSnap = await draftRef.get();
  if (!draftSnap.exists || draftSnap.data()?.uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Invalid draft upload.");
  }

  await draftRef.update({
    publicIds: admin.firestore.FieldValue.arrayUnion(publicId),
  });

  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. M-PESA PAYMENTS & CALLBACK
// ═══════════════════════════════════════════════════════════════════════════
const MPESA_INITIATION_COOLDOWN_MS = 30_000;

export const initiateMpesaPayment = onCall({ secrets: [mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey, recaptchaSecretKey], cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const { phone, plan, productId, recaptchaToken } = request.data as { phone: string; plan: string; productId: string; recaptchaToken?: string };
  await verifyRecaptcha(recaptchaToken, "initiate_payment");

  // Cooldown guard — stops repeated STK push spam (accidental double-taps
  // or a script) from hammering Daraja and annoying the buyer's phone
  // with duplicate prompts.
  const cooldownRef = db.collection("paymentCooldowns").doc(request.auth.uid);
  const cooldownSnap = await cooldownRef.get();
  const lastInitiatedAt = cooldownSnap.exists ? cooldownSnap.data()?.lastInitiatedAt?.toMillis() : null;

  if (lastInitiatedAt && Date.now() - lastInitiatedAt < MPESA_INITIATION_COOLDOWN_MS) {
    throw new HttpsError(
      "resource-exhausted",
      "Please wait a moment before trying to pay again."
    );
  }

  await cooldownRef.set({ lastInitiatedAt: admin.firestore.FieldValue.serverTimestamp() });
  if (typeof plan !== "string" || !PLAN_AMOUNTS.hasOwnProperty(plan)) {
    throw new HttpsError("invalid-argument", "Invalid plan selected.");
  }

  if (typeof productId !== "string" || !productId.trim()) {
    throw new HttpsError("invalid-argument", "Product ID is required.");
  }

  const productSnap = await db.collection("products").doc(productId).get();

  if (!productSnap.exists) {
    throw new HttpsError("not-found", "Advert not found.");
  }

  const productData = productSnap.data()!;

  if (productData.sellerId !== request.auth.uid) {
    throw new HttpsError(
      "permission-denied",
      "You can only initiate payment for your own adverts."
    );
  }

  const formattedPhone = normalizePhone(phone);
  const token = await getDarajaToken(mpesaConsumerKey.value(), mpesaConsumerSecret.value());
  const ts = mpesaTimestamp();
  const callbackToken = crypto.randomBytes(24).toString("hex");
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  const stkBody = {
    BusinessShortCode: process.env.MPESA_SHORTCODE ?? "174379",
    Password: Buffer.from(`${process.env.MPESA_SHORTCODE ?? "174379"}${mpesaPasskey.value()}${ts}`).toString("base64"),
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
      const existingStatus = paymentSnap.data()?.status;

      // Idempotency guard: Safaricom may deliver the same callback
      // more than once. If we've already processed this payment,
      // acknowledge and exit without repeating any updates.
      if (existingStatus === "completed" || existingStatus === "failed") {
        res.json({ ResultCode: 0, ResultDesc: "Already processed" });
        return;
      }

      if (callback.ResultCode === 0) {
  const paymentData = paymentSnap.data()!;

  // Retrieve the plan from the payment record to determine duration
  const plan = paymentData.plan ?? "free";
  const durationDays = LISTING_DURATIONS[plan] ?? 7;

  // Extract M-Pesa receipt number from Safaricom callback
  const callbackMetadata =
    callback.CallbackMetadata?.Item ?? [];

  const mpesaCode =
    callbackMetadata.find(
      (item: { Name: string; Value?: unknown }) =>
        item.Name === "MpesaReceiptNumber"
    )?.Value ?? null;

  // Mark payment as completed and save M-Pesa receipt
  await paymentRef.update({
    status: "completed",
    mpesaCode,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
        // Activate the advert
await db.collection("products").doc(paymentData.productId).update({
  status: "active",
  paidAt: admin.firestore.FieldValue.serverTimestamp(),
  expiresAt: admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + durationDays * 86_400_000)
  )
});

await sendPushToUid(
  paymentData.buyerId,
  "Your advert is live! 🎉",
  "Payment confirmed — your listing is now visible to buyers.",
  { type: "advert_activated", productId: paymentData.productId }
);

        // Pay marketer commission, once per referred user, on their
        // first successful premium payment only.
        try {
  const referralSnap = await db.collection("referrals").doc(paymentData.buyerId).get();

  if (referralSnap.exists && !referralSnap.data()?.commissionPaidOut) {
    const { marketerUid } = referralSnap.data()!;
    const amountPaid = PLAN_AMOUNTS[plan] ?? 0;
    const commission = Math.round(amountPaid * COMMISSION_RATE);

    const now = new Date();
const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const marketerRef = db.collection("marketers").doc(marketerUid);

await db.runTransaction(async (tx) => {
  const marketerSnap = await tx.get(marketerRef);
  const data = marketerSnap.data() ?? {};
  const carriedCount = data.signupsMonthKey === monthKey ? (data.signupsThisMonth ?? 0) : 0;
  const carriedEarnings = data.earningsMonthKey === monthKey ? (data.earningsThisMonth ?? 0) : 0;

  tx.update(marketerRef, {
    totalEarnedKES: admin.firestore.FieldValue.increment(commission),
    signupsThisMonth: carriedCount + 1,
    signupsMonthKey: monthKey,
    earningsThisMonth: carriedEarnings + commission,
    earningsMonthKey: monthKey,
  });
});

    await db.collection("referralCommissions").add({
      marketerUid,
      referredUserUid: paymentData.buyerId,
      paymentId: callback.CheckoutRequestID,
      amountPaidKES: amountPaid,
      commissionKES: commission,
      type: "first_premium_payment",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await referralSnap.ref.update({ commissionPaidOut: true });
    try {
  const marketerTokenSnap = await db.collection("fcmTokens").doc(marketerUid).get();
  const marketerToken = marketerTokenSnap.exists ? marketerTokenSnap.data()?.token : null;
  if (marketerToken) {
    await admin.messaging().send({
      token: marketerToken,
      notification: {
        title: "You earned a commission! 🎉",
        body: `Someone you referred went premium — KES ${commission} added to your earnings.`,
      },
      data: { type: "referral_commission" },
    });
  }
} catch (notifyError) {
  console.error("Failed to notify marketer of commission:", notifyError);
    }
  }
} catch (error) {
  console.error("Failed to process referral commission:", error);
}

        // Extend existing premium subscription instead of resetting it
const userRef = db.collection("users").doc(paymentData.buyerId);
const userSnap = await userRef.get();

const userData = userSnap.exists ? userSnap.data() : null;

const existingPremiumEndsAt =
  userData?.premiumEndsAt?.toDate?.() ?? null;

const now = new Date();

// If the user already has an active subscription,
// add the new duration to the existing expiry date.
// Otherwise, start from now.
const subscriptionStartDate =
  existingPremiumEndsAt && existingPremiumEndsAt > now
    ? existingPremiumEndsAt
    : now;

const newPremiumEndsAt = new Date(
  subscriptionStartDate.getTime() +
    durationDays * 86_400_000
);

const premiumEndsTimestamp =
  admin.firestore.Timestamp.fromDate(newPremiumEndsAt);

// Update main user subscription fields
await userRef.set(
  {
    subscriptionPlan: plan,
    premiumEndsAt: premiumEndsTimestamp,
  },
  { merge: true }
);

// Update detailed subscription document
await userRef
  .collection("subscription")
  .doc("active")
  .set({
    planType: plan,
    premiumEndsAt: premiumEndsTimestamp,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
        // Reactivate any archived hotel menu adverts now that the
        // subscription has renewed. Bounded to 50 reads so this stays
        // cheap even if it never needs to write anything.
        const archivedAds = await db
          .collection("products")
          .where("sellerId", "==", paymentData.buyerId)
          .where("status", "==", "archived")
          .limit(50)
          .get();

        const reactivateBatch = db.batch();
        let reactivatedCount = 0;
        archivedAds.docs.forEach((doc) => {
          const data = doc.data();
          if (data.hotelMenu !== undefined && data.hotelMenu !== null) {
            reactivateBatch.update(doc.ref, {
              status: "active",
              expiresAt: premiumEndsTimestamp,
            });
            reactivatedCount++;
          }
        });
        if (reactivatedCount > 0) {
          await reactivateBatch.commit();
        }
      } else {
        // Payment failed or was cancelled by the user
        await paymentRef.update({
          status: "failed",
          failureReason: callback.ResultDesc ?? "Payment failed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
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
    .limit(CLEANUP_LIMIT)
    .get();

  // Delete abandoned pending payment adverts older than 1 hour
  const oneHourAgo = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 60 * 60 * 1000)
  );

  const expiredPending = await db.collection("products")
    .where("status", "==", "pending_payment")
    .where("createdAt", "<", oneHourAgo)
    .limit(CLEANUP_LIMIT)
    .get();

  const expiredPayments = await db.collection("payments")
    .where("status", "==", "pending")
    .where("createdAt", "<", oneHourAgo)
    .limit(CLEANUP_LIMIT)
    .get();

  // Permanently delete adverts that have sat archived past retention
  const archiveCutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - ARCHIVE_RETENTION_DAYS * 86_400_000)
  );

  const staleArchived = await db.collection("products")
    .where("status", "==", "archived")
    .where("archivedAt", "<", archiveCutoff)
    .limit(CLEANUP_LIMIT)
    .get();

  const batch = db.batch();

  // Archive expired active adverts — stamp archivedAt so we can
  // later purge them once ARCHIVE_RETENTION_DAYS has passed.
  expiredActive.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: "archived",
      archivedAt: now,
    });
  });

  // Delete abandoned pending adverts and their Cloudinary images
  for (const doc of expiredPending.docs) {
    const data = doc.data();

    if (Array.isArray(data.imageUrls)) {
      for (const img of data.imageUrls) {
        const publicId = typeof img === "string" ? null : img.public_id;
        if (publicId) {
          try {
            await deleteCloudinaryImage(publicId);
          } catch (error) {
            console.error(`Cloudinary delete failed for ${publicId}:`, error);
          }
        }
      }
    }

    batch.delete(doc.ref);
  }

  // Delete abandoned pending payment records
  expiredPayments.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  // Clean up unclaimed draft uploads — images uploaded to Cloudinary
  // but never turned into an advert (user abandoned the form).
  const staleDrafts = await db.collection("draftUploads")
    .where("claimed", "==", false)
    .where("createdAt", "<", oneHourAgo)
    .limit(CLEANUP_LIMIT)
    .get();

  let purgedDraftImages = 0;
  for (const draftDoc of staleDrafts.docs) {
    const data = draftDoc.data();
    const publicIds: string[] = Array.isArray(data.publicIds) ? data.publicIds : [];
    for (const publicId of publicIds) {
      try {
        await deleteCloudinaryImage(publicId);
        purgedDraftImages++;
      } catch (error) {
        console.error(`Cloudinary delete failed for orphaned draft image ${publicId}:`, error);
      }
    }
    batch.delete(draftDoc.ref);
  }

  // Permanently purge adverts archived past retention — delete their
  // Cloudinary images, their chats (and messages), then the advert itself
  let purgedChats = 0;
  for (const doc of staleArchived.docs) {
    const data = doc.data();

    if (Array.isArray(data.imageUrls)) {
      for (const img of data.imageUrls) {
        const publicId = typeof img === "string" ? null : img.public_id;
        if (publicId) {
          try {
            await deleteCloudinaryImage(publicId);
          } catch (error) {
            console.error(`Cloudinary delete failed for ${publicId}:`, error);
          }
        }
      }
    }

    const relatedChats = await db.collection("chats")
      .where("productId", "==", doc.id)
      .get();

    for (const chatDoc of relatedChats.docs) {
      await db.recursiveDelete(chatDoc.ref);
      purgedChats++;
    }

    batch.delete(doc.ref);
  }

  // Orphaned chats — the product or job they reference no longer
  // exists (e.g. deleted outside the normal deleteAdvert/deleteJob
  // path). Ordered by createdAt with an age filter so each run
  // advances through the collection instead of re-scanning the
  // same first page forever.
  const orphanCandidates = await db.collection("chats")
    .where("createdAt", "<", oneHourAgo)
    .orderBy("createdAt")
    .limit(CLEANUP_LIMIT)
    .get();

  let orphanedChats = 0;
  for (const chatDoc of orphanCandidates.docs) {
    const chat = chatDoc.data();
    let stillReferenced = true;

    if (chat.productId) {
      const productSnap = await db.collection("products").doc(chat.productId).get();
      stillReferenced = productSnap.exists;
    } else if (chat.jobId) {
      const jobSnap = await db.collection("jobs").doc(chat.jobId).get();
      stillReferenced = jobSnap.exists;
    }

    if (!stillReferenced) {
      await db.recursiveDelete(chatDoc.ref);
      orphanedChats++;
    }
  }

  await batch.commit();

  return {
    archived: expiredActive.size,
    deletedPending: expiredPending.size,
    deletedPayments: expiredPayments.size,
    purgedArchived: staleArchived.size,
    purgedChatsFromPurgedAds: purgedChats,
    orphanedChatsDeleted: orphanedChats,
    purgedDraftImages,
  };
}

export const scheduledCleanup = onSchedule(
  {
    schedule: "every 6 hours",
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
  `Cleanup complete. Archived: ${result.archived}, Deleted pending adverts: ${result.deletedPending}, Deleted pending payments: ${result.deletedPayments}, Purged old archived adverts: ${result.purgedArchived}, Chats removed with purged adverts: ${result.purgedChatsFromPurgedAds}, Orphaned chats removed: ${result.orphanedChatsDeleted}, Purged orphaned draft images: ${result.purgedDraftImages}`
);
    } catch (error) {
      console.error("Cleanup failed:", error);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// 3B. EXPIRING ADVERT REMINDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs every 6 hours (aligned with scheduledCleanup). Notifies sellers
 * whose active advert expires within the next 24 hours — once per
 * advert, tracked via expiringNotified so it never repeats.
 */
export const notifyExpiringAdverts = onSchedule("every 6 hours", async () => {
  const now = admin.firestore.Timestamp.now();
  const in24h = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const expiringSoon = await db.collection("products")
    .where("status", "==", "active")
    .where("expiresAt", ">", now)
    .where("expiresAt", "<=", in24h)
    .where("expiringNotified", "==", false)
    .limit(CLEANUP_LIMIT)
    .get();

  const batch = db.batch();
  let notified = 0;

  for (const doc of expiringSoon.docs) {
    const data = doc.data();
    if (!data.sellerId) continue;

    await sendPushToUid(
      data.sellerId,
      "Your advert expires soon",
      `"${data.title ?? "Your listing"}" expires within 24 hours. Renew it to keep it visible.`,
      { type: "advert_expiring", productId: doc.id }
    );

    batch.update(doc.ref, { expiringNotified: true });
    notified++;
  }

  if (notified > 0) await batch.commit();
  console.log(`Expiring advert reminders sent: ${notified}`);
});
export const closeMonthlyEarnings = onSchedule(
  { schedule: "0 0 1 * *", timeZone: "Africa/Nairobi" }, // 00:00 on the 1st of each month
  async () => {
    const now = new Date();
    const closedMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const closedMonthKey = `${closedMonth.getFullYear()}-${String(closedMonth.getMonth() + 1).padStart(2, "0")}`;
    const newMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const marketersSnap = await db.collection("marketers").get();
    const batch = db.batch();

    marketersSnap.docs.forEach((doc) => {
  const data = doc.data();
  const earnedThatMonth = data.earningsMonthKey === closedMonthKey
    ? (data.earningsThisMonth ?? 0)
    : 0;
  const signupsThatMonth = data.signupsMonthKey === closedMonthKey
    ? (data.signupsThisMonth ?? 0)
    : 0;

  if (earnedThatMonth < MINIMUM_PAYOUT_KES) {
    // Below threshold — carry the amount into the new month instead
    // of creating a payable snapshot, so it accumulates until it's
    // worth paying out.
    batch.update(doc.ref, {
      earningsThisMonth: earnedThatMonth,
      earningsMonthKey: newMonthKey,
      signupsThisMonth: 0,
      signupsMonthKey: newMonthKey,
    });
    return;
  }

  const payoutRef = db.collection("payouts").doc(closedMonthKey)
    .collection("marketers").doc(doc.id);

  batch.set(payoutRef, {
    marketerUid: doc.id,
    referralCode: data.referralCode ?? null,
    earningsKES: earnedThatMonth,
    signups: signupsThatMonth,
    monthKey: closedMonthKey,
    paid: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  batch.update(doc.ref, {
    earningsThisMonth: 0,
    earningsMonthKey: newMonthKey,
    signupsThisMonth: 0,
    signupsMonthKey: newMonthKey,
  });
});

    await batch.commit();
    console.log(`Closed earnings for ${closedMonthKey}: ${marketersSnap.size} marketers snapshotted.`);
  }
);

/**
 * Admin-only: fetch the payout list for a given month (e.g. "2026-07").
 */
export const getMonthlyPayouts = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError("permission-denied", "Only the owner can view payouts.");
  }

  const { monthKey } = request.data as { monthKey?: string };
  if (!monthKey) throw new HttpsError("invalid-argument", "monthKey is required, e.g. '2026-07'.");

  const snap = await db.collection("payouts").doc(monthKey).collection("marketers").get();

  const payouts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  return { monthKey, payouts };
});

/**
 * Admin-only: mark a marketer's payout for a given month as paid.
 */
export const markPayoutPaid = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError("permission-denied", "Only the owner can update payouts.");
  }

  const { monthKey, marketerUid } = request.data as { monthKey?: string; marketerUid?: string };
  if (!monthKey || !marketerUid) {
    throw new HttpsError("invalid-argument", "monthKey and marketerUid are required.");
  }

  const payoutRef = db.collection("payouts").doc(monthKey)
    .collection("marketers").doc(marketerUid);
  const marketerRef = db.collection("marketers").doc(marketerUid);

  await db.runTransaction(async (tx) => {
    const payoutSnap = await tx.get(payoutRef);
    if (!payoutSnap.exists) {
      throw new HttpsError("not-found", "Payout record not found.");
    }
    const payoutData = payoutSnap.data()!;
    if (payoutData.paid) return; // already processed — avoid double-counting

    tx.update(payoutRef, { paid: true, paidAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(marketerRef, {
      totalWithdrawnKES: admin.firestore.FieldValue.increment(payoutData.earningsKES ?? 0),
    });
  });

  return { success: true };
});

   export const getTopMarketers = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError("permission-denied", "Only the owner can view the leaderboard.");
  }

  const snap = await db.collection("marketers")
    .orderBy("earningsThisMonth", "desc")
    .limit(10)
    .get();

  const leaderboard = snap.docs.map((d) => ({
    id: d.id,
    referralCode: d.data().referralCode ?? null,
    earningsThisMonth: d.data().earningsThisMonth ?? 0,
    signupsThisMonth: d.data().signupsThisMonth ?? 0,
  }));

  return { leaderboard };
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fires on every new chat message. Notifies the other participant,
 * unless they've muted this specific chat.
 */
export const onNewChatMessage = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    if (!message) return;

    const chatId = event.params.chatId;
    const chatSnap = await db.collection("chats").doc(chatId).get();
    if (!chatSnap.exists) return;

    const chat = chatSnap.data()!;
    const senderId = message.senderId as string | undefined;
    if (!senderId) return;

    const participants: string[] = Array.isArray(chat.participants) ? chat.participants : [];
    const recipientId = participants.find((p) => p !== senderId);
    if (!recipientId) return;

    // Respect per-user chat mute.
    const mutedBy: string[] = Array.isArray(chat.mutedBy) ? chat.mutedBy : [];
    if (mutedBy.includes(recipientId)) return;

    await sendPushToUid(
      recipientId,
      message.senderName ?? "New message",
      typeof message.text === "string" ? message.text.slice(0, 100) : "Sent you a message",
      { type: "chat_message", chatUrl: `/chat/${chatId}` }
    );
  }
);

export const sendNotification = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { token, title, body, data } = request.data as {
    token?: unknown;
    title?: unknown;
    body?: unknown;
    data?: unknown;
  };

  if (typeof token !== "string" || !token.trim()) {
    throw new HttpsError("invalid-argument", "A valid FCM token is required.");
  }

  if (typeof title !== "string" || !title.trim() || title.length > 100) {
    throw new HttpsError("invalid-argument", "A valid title (max 100 characters) is required.");
  }

  if (body !== undefined && (typeof body !== "string" || body.length > 500)) {
    throw new HttpsError("invalid-argument", "Body must be a string under 500 characters.");
  }

  // Only allow the recipient to be notified about themselves,
  // or a chat/product they are actually part of — this stops any
  // signed-in user from blasting arbitrary notifications to anyone.
  const recipientTokenDoc = await db
    .collection("fcmTokens")
    .doc(request.auth.uid)
    .get();

  if (!recipientTokenDoc.exists || recipientTokenDoc.data()?.token !== token) {
    throw new HttpsError(
      "permission-denied",
      "You can only send notifications to your own registered device."
    );
  }

  await admin.messaging().send({
    token,
    notification: { title, body: typeof body === "string" ? body : "" },
    data: data && typeof data === "object" ? (data as Record<string, string>) : {},
  });

  return { success: true };
});

/**
 * Admin-only: send a notification to any user by uid — for support
 * replies, announcements, or manual follow-ups.
 */
export const adminSendNotification = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError("permission-denied", "Only the owner can send admin notifications.");
  }

  const { uid, title, body } = request.data as { uid?: string; title?: string; body?: string };

  if (!uid) throw new HttpsError("invalid-argument", "A target user UID is required.");
  if (typeof title !== "string" || !title.trim() || title.length > 100) {
    throw new HttpsError("invalid-argument", "A valid title (max 100 characters) is required.");
  }
  if (typeof body !== "string" || !body.trim() || body.length > 500) {
    throw new HttpsError("invalid-argument", "A valid message (max 500 characters) is required.");
  }

  await sendPushToUid(uid, title.trim(), body.trim(), { type: "admin_message" });

  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════
// 4B. REVERSE GEOCODING (Nominatim proxy with cache + rate limiting)
// ═══════════════════════════════════════════════════════════════════════════

let lastNominatimCallAt = 0;

async function throttleNominatim() {
  const minGapMs = 1100; // stay safely under Nominatim's 1 req/sec policy
  const elapsed = Date.now() - lastNominatimCallAt;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastNominatimCallAt = Date.now();
}
export const reverseGeocode = onCall(
  {
    cors: true,
    maxInstances: 1, // forces all calls through one instance, serializing requests
    concurrency: 1,  // ensures that one instance only processes one call at a time
    secrets: [recaptchaSecretKey],
  },
  async (request) => {
    const { lat, lng, recaptchaToken } = request.data as { lat?: number; lng?: number; recaptchaToken?: string };
    await verifyRecaptcha(recaptchaToken, "reverse_geocode");

    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new HttpsError("invalid-argument", "lat and lng are required numbers.");
    }

    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
    const cacheRef = db.collection("geocodeCache").doc(cacheKey);

    // 1. Check persistent cache first — avoids hitting Nominatim at all
    const cached = await cacheRef.get();
    if (cached.exists) {
      return cached.data();
    }

    // 2. Not cached — throttle, then call Nominatim
    await throttleNominatim();

    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=14`;

    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
        // Nominatim's usage policy requires a real identifying User-Agent
        "User-Agent": "BizMtaani/1.0 (contact: morganmusibi@gmail.com)",
      },
    });

    if (!res.ok) {
      throw new HttpsError("internal", "Reverse geocoding failed.");
    }

    const data = (await res.json()) as { address?: Record<string, string> };
    const addr = data.address ?? {};

    const result = {
      suburb: addr.suburb ?? null,
      neighbourhood: addr.neighbourhood ?? null,
      quarter: addr.quarter ?? null,
      village: addr.village ?? null,
      hamlet: addr.hamlet ?? null,
      town: addr.town ?? null,
      municipality: addr.municipality ?? null,
      city_district: addr.city_district ?? null,
      county_district: addr.county_district ?? null,
      state: addr.state ?? null,
      county: addr.county ?? null,
    };

    // 3. Save to cache permanently — ward boundaries don't move
    await cacheRef.set(result);

    return result;
  }
);
// ═══════════════════════════════════════════════════════════════════════════
// 5. SUBSCRIPTION GATEKEEPER
// ═══════════════════════════════════════════════════════════════════════════

export const publishAdvert = onCall({ cors: true, secrets: [recaptchaSecretKey] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { plan, title, price, imageUrls, draftId, recaptchaToken, ...otherData } = request.data;
  await verifyRecaptcha(recaptchaToken, "publish_advert");
  const uid = request.auth.uid;
  
  // Check if the user has an active premium subscription
const userSnap = await db.collection("users").doc(uid).get();

// Block suspended/scammer accounts from posting
if (userSnap.exists && userSnap.data()?.blocked === true) {
  throw new HttpsError(
    "permission-denied",
    "Your account has been suspended and cannot post adverts. Contact support if you believe this is a mistake."
  );
}

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
  if (
  !title ||
  price === undefined ||
  price === null ||
  !Array.isArray(imageUrls)
) {
  throw new HttpsError(
    "invalid-argument",
    "Missing required product details."
  );
}

  // 3. Validation: Photo Limits
  const limit = MAX_PHOTO_LIMIT[effectivePlan] ?? 0;
  if (imageUrls.length > limit) {
    throw new HttpsError("failed-precondition", `Your plan allows a maximum of ${limit} photos.`);
  }

  // 4. Logic: Active Ad Limit Enforcement (applies to every plan)
  const activeAdLimit = MAX_ACTIVE_ADS[effectivePlan] ?? 3;

  const activeCountSnap = await db
  .collection("products")
  .where("sellerId", "==", uid)
  .where("status", "==", "active")
  .count()
  .get();

if (activeCountSnap.data().count >= activeAdLimit) {
  throw new HttpsError(
    "failed-precondition",
    `You have reached the maximum of ${activeAdLimit} active adverts for your current plan.`
  );
}

  // 5. Logic: Status Determination
  // Paid plans start as 'pending_payment'; Free plans start as 'active'
  const status =
  effectivePlan === "free" || hasActiveSubscription
    ? "active"
    : "pending_payment";

  // Visibility scope is derived server-side from the verified plan —
  // never trusted from the client — so a free-tier client can't spoof
  // nationwide reach. Free stays local-radius; any premium tier gets
  // all_areas, discoverable via the nationwide feed stage once the
  // normal geohash radius (up to 50km) is exhausted.
  const visibilityScope = effectivePlan === "free" ? "local" : "all_areas";

  // 6. Logic: Dynamic Expiry (Only if active immediately)
  // Hotel menu adverts follow the seller's subscription instead of a fixed
  // listing duration — archived (never deleted) when premium lapses,
  // reactivated automatically on renewal (see mpesaCallback).
  const isHotelMenu = otherData.hotelMenu !== undefined && otherData.hotelMenu !== null;
  const durationDays = LISTING_DURATIONS[effectivePlan] ?? 7;

  let expiresAt: admin.firestore.Timestamp | null = null;
  if (status === "active") {
    if (isHotelMenu && hasActiveSubscription) {
      expiresAt = userSnap.data()?.premiumEndsAt
        ?? admin.firestore.Timestamp.fromDate(new Date(Date.now() + durationDays * 86_400_000));
    } else {
      expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + durationDays * 86_400_000));
    }
  }

  // 7. Save Ad — explicitly allowlist every field instead of
  // spreading otherData, so a malicious client can't inject
  // unexpected fields (e.g. verified, isPremium, visibilityScope).
  let newProductRef;

try {
  newProductRef = await db.collection("products").add({
    title,
    description: typeof otherData.description === "string" ? otherData.description : "",
    price,
    priceRaw: typeof otherData.priceRaw === "string" ? otherData.priceRaw : "",
    priceText: typeof otherData.priceText === "string" ? otherData.priceText : "",
    rentPerMonthRaw: typeof otherData.rentPerMonthRaw === "string" ? otherData.rentPerMonthRaw : "",

    category: typeof otherData.category === "string" ? otherData.category : "",
    subcategory: typeof otherData.subcategory === "string" ? otherData.subcategory : "",

    imageUrl: typeof otherData.imageUrl === "string" ? otherData.imageUrl : "",
    imageUrls,

    lat: typeof otherData.lat === "number" ? otherData.lat : null,
    lng: typeof otherData.lng === "number" ? otherData.lng : null,

    ward: typeof otherData.ward === "string" ? otherData.ward : "",
    constituency: typeof otherData.constituency === "string" ? otherData.constituency : "",
    county: typeof otherData.county === "string" ? otherData.county : "",

    geohash: typeof otherData.geohash === "string" ? otherData.geohash : "",

    sellerName: typeof otherData.sellerName === "string" ? otherData.sellerName : "",
    sellerType: otherData.sellerType === "business" ? "business" : "individual",

    priceDisplay: typeof otherData.priceDisplay === "string" ? otherData.priceDisplay : "fixed",
    pricingBasis: typeof otherData.pricingBasis === "string" ? otherData.pricingBasis : null,

    hotelMenu: otherData.hotelMenu ?? null,
    eateryPayment: otherData.eateryPayment ?? null,
    priceList: Array.isArray(otherData.priceList) ? otherData.priceList : null,
    phone: typeof otherData.phone === "string" ? otherData.phone : "",

    jobDetails: otherData.jobDetails ?? null,
    vehicleDetails: otherData.vehicleDetails ?? null,
    serviceDetails: otherData.serviceDetails ?? null,
    accommodationDetails: otherData.accommodationDetails ?? null,
    commercialPropertyDetails: otherData.commercialPropertyDetails ?? null,

    plan: effectivePlan,
    visibilityScope,
    ownerId: uid,
    sellerId: uid,
    status,
    expiringNotified: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  } catch (error) {

  // Delete uploaded Cloudinary images
  for (const image of imageUrls) {
    if (image?.public_id) {
      await deleteCloudinaryImage(image.public_id);
    }
  }

  console.error("Advert creation failed:", error);

  throw new HttpsError(
    "internal",
    "Failed to create advert."
  );
}

// 8. Mark the draft upload as claimed, if one was tracked
  if (typeof draftId === "string") {
    await db.collection("draftUploads").doc(draftId).update({ claimed: true }).catch(() => {});
  }

  // 9. Return the generated productId
  return {
  success: true,
  productId: newProductRef.id,
  status,
  requiresPayment: status === "pending_payment",
  plan: effectivePlan,
};
  });
 

export const deleteAdvert = onCall({ cors: true, secrets: [cloudinaryApiKey, cloudinaryApiSecret, cloudinaryCloudName] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in");
  }

  const { productId } = request.data as { productId: string };
  if (!productId) throw new HttpsError("invalid-argument", "Product ID is required.");

  const productRef = db.collection("products").doc(productId);
  const productSnap = await productRef.get();

  if (!productSnap.exists) throw new HttpsError("not-found", "Advert not found.");
  const product = productSnap.data()!;

  // Check ownership
  if (product.sellerId !== request.auth.uid && product.ownerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "You can only delete your own adverts.");
  }

  // 1. Delete Cloudinary Images
  if (Array.isArray(product.imageUrls)) {
    for (const image of product.imageUrls) {
      const publicId = typeof image === "string" ? null : image.public_id;
      if (publicId) await deleteCloudinaryImage(publicId);
    }
  }

  // 2. NEW: Delete associated chats (Avoid ghost chats)
  const chatQuery = await db.collection("chats").where("productId", "==", productId).get();
  const batch = db.batch();
  chatQuery.docs.forEach((doc) => batch.delete(doc.ref));

  // 3. Delete the advert
  batch.delete(productRef);
  
  await batch.commit();

  return { success: true, message: "Advert and associated data removed." };
});
export const deleteJob = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in");
  }

  const { jobId } = request.data as { jobId: string };
  if (!jobId) throw new HttpsError("invalid-argument", "Job ID is required.");

  const jobRef = db.collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = jobSnap.data()!;

  // Check ownership — admins can delete any job.
  const isOwner = job.posterId === request.auth.uid;
  let callerIsAdmin = false;
  if (!isOwner) {
    const callerToken = request.auth.token as Record<string, unknown>;
    callerIsAdmin = callerToken?.admin === true;
  }

  if (!isOwner && !callerIsAdmin) {
    throw new HttpsError("permission-denied", "You can only delete your own job listings.");
  }

  // Delete associated application chats (avoid ghost chats)
  const chatQuery = await db.collection("chats").where("jobId", "==", jobId).get();
  const batch = db.batch();
  chatQuery.docs.forEach((doc) => batch.delete(doc.ref));

  batch.delete(jobRef);
  await batch.commit();

  return { success: true, message: "Job and associated chats removed." };
});

// ═══════════════════════════════════════════════════════════════════════════
// 5B. REPORT SUBMISSION (rate-limited)
// ═══════════════════════════════════════════════════════════════════════════

const REPORT_COOLDOWN_MS = 60_000;

/**
 * Creates a product report on the user's behalf, with a per-user
 * cooldown to stop repeated-click or scripted spam. Firestore rules
 * for the `reports` collection can then deny direct client writes
 * entirely, since this function is the only legitimate path.
 */
export const submitProductReport = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { productId, productTitle, sellerId, reason } = request.data as {
    productId?: string;
    productTitle?: string;
    sellerId?: string;
    reason?: string;
  };

  if (typeof productId !== "string" || !productId.trim()) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }
  if (typeof sellerId !== "string" || !sellerId.trim()) {
    throw new HttpsError("invalid-argument", "sellerId is required.");
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new HttpsError("invalid-argument", "A reason is required.");
  }

  const cooldownRef = db.collection("reportCooldowns").doc(request.auth.uid);
  const cooldownSnap = await cooldownRef.get();
  const lastReportedAt = cooldownSnap.exists ? cooldownSnap.data()?.lastReportedAt?.toMillis() : null;

  if (lastReportedAt && Date.now() - lastReportedAt < REPORT_COOLDOWN_MS) {
    throw new HttpsError(
      "resource-exhausted",
      "Please wait a moment before submitting another report."
    );
  }

  await cooldownRef.set({ lastReportedAt: admin.firestore.FieldValue.serverTimestamp() });

  await db.collection("reports").add({
    productId: productId.trim(),
    productTitle: typeof productTitle === "string" ? productTitle.trim() : "",
    sellerId: sellerId.trim(),
    reporterId: request.auth.uid,
    reason: reason.trim().slice(0, 300),
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

                                          /**
 * Creates a support report on the user's behalf, with the same
 * per-user cooldown pattern as submitProductReport.
 */
export const submitSupportReport = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { type, advertId, description, contact, priority } = request.data as {
    type?: string;
    advertId?: string | null;
    description?: string;
    contact?: string | null;
    priority?: string;
  };

  if (typeof type !== "string" || !type.trim()) {
    throw new HttpsError("invalid-argument", "A report type is required.");
  }
  if (typeof description !== "string" || description.trim().length < 10 || description.trim().length > 3000) {
    throw new HttpsError("invalid-argument", "Description must be between 10 and 3000 characters.");
  }

  const cooldownRef = db.collection("reportCooldowns").doc(request.auth.uid);
  const cooldownSnap = await cooldownRef.get();
  const lastReportedAt = cooldownSnap.exists ? cooldownSnap.data()?.lastReportedAt?.toMillis() : null;

  if (lastReportedAt && Date.now() - lastReportedAt < REPORT_COOLDOWN_MS) {
    throw new HttpsError(
      "resource-exhausted",
      "Please wait a moment before submitting another report."
    );
  }

  await cooldownRef.set({ lastReportedAt: admin.firestore.FieldValue.serverTimestamp() });

  await db.collection("supportReports").add({
    userId: request.auth.uid,
    userEmail: request.auth.token.email ?? null,
    type: type.trim(),
    advertId: typeof advertId === "string" && advertId.trim() ? advertId.trim() : null,
    description: description.trim(),
    contact: typeof contact === "string" && contact.trim() ? contact.trim() : null,
    priority: priority === "high" ? "high" : "normal",
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/**
 * Creates a message report on the user's behalf. Verifies the
 * reporter is actually a participant in the chat the message belongs
 * to (a direct client write could not check this), and shares the
 * same per-user cooldown as the other report types.
 */
export const submitMessageReport = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { chatId, messageId, reportedUserId, messageText, reason } = request.data as {
    chatId?: string;
    messageId?: string;
    reportedUserId?: string;
    messageText?: string;
    reason?: string;
  };

  if (
    typeof chatId !== "string" || !chatId.trim() ||
    typeof messageId !== "string" || !messageId.trim() ||
    typeof reportedUserId !== "string" || !reportedUserId.trim() ||
    typeof messageText !== "string" ||
    typeof reason !== "string" || !reason.trim()
  ) {
    throw new HttpsError("invalid-argument", "Missing or invalid report details.");
  }

  // Verify the reporter is actually a participant in this chat —
  // a direct client write couldn't enforce this.
  const chatSnap = await db.collection("chats").doc(chatId).get();
  if (!chatSnap.exists) {
    throw new HttpsError("not-found", "Chat not found.");
  }
  const participants: string[] = Array.isArray(chatSnap.data()?.participants)
    ? chatSnap.data()!.participants
    : [];
  if (!participants.includes(request.auth.uid)) {
    throw new HttpsError("permission-denied", "You are not a participant in this chat.");
  }

  const cooldownRef = db.collection("reportCooldowns").doc(request.auth.uid);
  const cooldownSnap = await cooldownRef.get();
  const lastReportedAt = cooldownSnap.exists ? cooldownSnap.data()?.lastReportedAt?.toMillis() : null;

  if (lastReportedAt && Date.now() - lastReportedAt < REPORT_COOLDOWN_MS) {
    throw new HttpsError(
      "resource-exhausted",
      "Please wait a moment before submitting another report."
    );
  }

  await cooldownRef.set({ lastReportedAt: admin.firestore.FieldValue.serverTimestamp() });

  await db.collection("messageReports").add({
    reporterId: request.auth.uid,
    chatId: chatId.trim(),
    messageId: messageId.trim(),
    reportedUserId: reportedUserId.trim(),
    messageText: messageText.slice(0, 1000),
    reason: reason.trim().slice(0, 300),
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ADMIN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export const setAdminRole = onCall({ cors: true }, async (request) => {
  // The caller must be signed in
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in."
    );
  }

  // Only the initial owner account is allowed to grant admin access.
  // (OWNER_UID is defined once near the top of this file.)
  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError(
      "permission-denied",
      "Only the BizMtaani owner can manage administrator access."
    );
  }

  const { uid } = request.data as { uid?: string };

  if (!uid) {
    throw new HttpsError(
      "invalid-argument",
      "A user UID is required."
    );
  }

  try {
    // Preserve any existing custom claims (e.g. future roles like
    // moderator, verified) instead of overwriting them entirely.
    const targetUser = await admin.auth().getUser(uid);

    await admin.auth().setCustomUserClaims(uid, {
      ...(targetUser.customClaims || {}),
      admin: true,
    });

    // Also record the role in Firestore for easy display/management.
    // Security rules should still rely on the custom claim.
    await db.collection("users").doc(uid).set(
      {
        role: "admin",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logAdminAction(request.auth.uid, "grant_admin", { targetUid: uid });

    return {
      success: true,
      message: "Admin role granted successfully.",
      uid,
    };

  } catch (error) {
    console.error("Failed to set admin role:", error);

    throw new HttpsError(
      "internal",
      "Failed to grant administrator access."
    );
  }
});

/**
 * Owner-only: revoke a user's admin access. The owner account itself
 * can never be revoked — every admin check in this file keys off
 * OWNER_UID directly, not the "admin" custom claim, so attempting to
 * revoke the owner is rejected outright rather than silently no-op'ing.
 */
export const revokeAdminRole = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError(
      "permission-denied",
      "Only the BizMtaani owner can manage administrator access."
    );
  }

  const { uid } = request.data as { uid?: string };

  if (!uid) {
    throw new HttpsError("invalid-argument", "A user UID is required.");
  }

  if (uid === OWNER_UID) {
    throw new HttpsError(
      "invalid-argument",
      "The owner account cannot be revoked."
    );
  }

  try {
    const targetUser = await admin.auth().getUser(uid);

    await admin.auth().setCustomUserClaims(uid, {
      ...(targetUser.customClaims || {}),
      admin: false,
    });

    await db.collection("users").doc(uid).set(
      {
        role: "user",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logAdminAction(request.auth.uid, "revoke_admin", { targetUid: uid });

    return {
      success: true,
      message: "Admin role revoked successfully.",
      uid,
    };
  } catch (error) {
    console.error("Failed to revoke admin role:", error);

    throw new HttpsError(
      "internal",
      "Failed to revoke administrator access."
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. REFERRALS — MARKETER COMMISSIONS + USER POINTS
// ═══════════════════════════════════════════════════════════════════════════

const COMMISSION_RATE = 0.142;

function generateReferralCode(name: string, uid: string): string {
  // Take the first name only, strip anything that isn't a letter,
  // and cap length so the final code stays short and speakable.
  const cleanName = (name || "USER")
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 6) || "USER";

  // Mix of letters and numbers for the suffix — much larger space
  // than digits alone, so two people with the same first name still
  // get distinct, easy-to-say codes like JANE7K2 or JANEQ94.
  const suffixChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 — avoids confusion
  let suffix = "";
  for (let i = 0; i < 3; i++) {
    suffix += suffixChars[Math.floor(Math.random() * suffixChars.length)];
  }

  return `${cleanName}${suffix}`;
}

/**
 * Admin-only: approve a marketer and issue their referral code.
 */
export const approveMarketer = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError("permission-denied", "Only the owner can approve marketers.");
  }

  const { uid } = request.data as { uid?: string };
  if (!uid) throw new HttpsError("invalid-argument", "A user UID is required.");

  // Pull payout details from their application, if one exists — this is
  // now the source of truth for name/ID/M-Pesa number used for payouts.
  const applicationSnap = await db.collection("marketerApplications").doc(uid).get();
  const applicationData = applicationSnap.exists ? applicationSnap.data() : null;

  const marketerUserSnap = await db.collection("users").doc(uid).get();
  const fallbackName = marketerUserSnap.exists
    ? (marketerUserSnap.data()?.displayName as string | undefined) ?? ""
    : "";
  const fallbackEmail = marketerUserSnap.exists
    ? (marketerUserSnap.data()?.email as string | undefined) ?? ""
    : "";

  const marketerName = applicationData?.fullName || fallbackName;

  const code = generateReferralCode(marketerName, uid);

  await db.collection("marketers").doc(uid).set({
    referralCode: code,
    status: "active",
    totalEarnedKES: 0,
    totalWithdrawnKES: 0,
    fullName: applicationData?.fullName ?? fallbackName,
    email: applicationData?.email ?? fallbackEmail,
    idNumber: applicationData?.idNumber ?? "",
    mpesaNumber: applicationData?.mpesaNumber ?? "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Mark the application as approved, if it exists, so it doesn't
  // show up as pending anywhere and its data stays as a record.
  if (applicationSnap.exists) {
    await applicationSnap.ref.update({ status: "approved" });
  }

  await sendPushToUid(
    uid,
    "You're approved as a marketer! 🎉",
    `Your referral code is ${code}. Start sharing it to earn commissions.`,
    { type: "marketer_approved", referralCode: code }
  );

  await logAdminAction(request.auth.uid, "approve_marketer", { targetUid: uid, referralCode: code });

  return { success: true, referralCode: code };
});

 export const getMyReferrals = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const referralsSnap = await db.collection("referrals")
    .where("marketerUid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const referrals = await Promise.all(
    referralsSnap.docs.map(async (docSnap) => {
      const data = docSnap.data();
      const userSnap = await db.collection("users").doc(docSnap.id).get();
      const userData = userSnap.exists ? userSnap.data() : null;
      const isPremium = !!(userData?.premiumEndsAt && userData.premiumEndsAt.toDate() > new Date());

      return {
        uid: docSnap.id,
        displayName: userData?.displayName ?? "Unknown",
        joinedAt: data.createdAt ?? null,
        commissionPaidOut: data.commissionPaidOut ?? false,
        isPremium,
      };
    })
  );

  return { referrals };
});

/**
 * Called when a user submits a referral code (e.g. from Profile).
 * Determines whether it's a marketer code or another user's own code,
 * and records the relationship. A user can only be referred once, ever.
 */
export const submitReferralCode = onCall({ cors: true, secrets: [recaptchaSecretKey] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { code, recaptchaToken } = request.data as { code?: string; recaptchaToken?: string };
  await verifyRecaptcha(recaptchaToken, "submit_referral");
  if (!code || typeof code !== "string") {
    throw new HttpsError("invalid-argument", "A referral code is required.");
  }

  const uid = request.auth.uid;
  const trimmedCode = code.trim().toUpperCase();

  // A user cannot be referred twice, by either track.
  const existingReferral = await db.collection("referrals").doc(uid).get();
  const existingUserReferral = await db.collection("userReferrals").doc(uid).get();
  if (existingReferral.exists || existingUserReferral.exists) {
    throw new HttpsError("failed-precondition", "A referral code has already been applied to this account.");
  }

  // 1. Check if it's a marketer code.
  const marketerSnap = await db
    .collection("marketers")
    .where("referralCode", "==", trimmedCode)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!marketerSnap.empty) {
    const marketerDoc = marketerSnap.docs[0];
    if (marketerDoc.id === uid) {
      throw new HttpsError("failed-precondition", "You cannot use your own referral code.");
    }

    await db.collection("referrals").doc(uid).set({
      marketerUid: marketerDoc.id,
      referralCode: trimmedCode,
      commissionPaidOut: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("users").doc(uid).set(
      { referredBy: marketerDoc.id },
      { merge: true }
    );

    return { success: true, type: "marketer" };
  }

  throw new HttpsError("not-found", "Invalid referral code.");
});
  /**
 * A user applies to become a marketer. Creates one small pending
 * application doc — cheap, and prevents duplicate applications by
 * using the user's own uid as the document ID (upsert, not append).
 */
export const applyForMarketer = onCall({ cors: true, secrets: [recaptchaSecretKey] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const uid = request.auth.uid;
  await verifyRecaptcha((request.data as { recaptchaToken?: string })?.recaptchaToken, "apply_marketer");

  // Already a marketer — no need to apply again.
  const existingMarketer = await db.collection("marketers").doc(uid).get();
  if (existingMarketer.exists) {
    throw new HttpsError("failed-precondition", "You are already an approved marketer.");
  }

  // Already has a pending application — avoid duplicate spam.
  const existingApplication = await db.collection("marketerApplications").doc(uid).get();
  if (existingApplication.exists && existingApplication.data()?.status === "pending") {
    throw new HttpsError("failed-precondition", "You already have a pending application.");
  }

  const { fullName, idNumber, mpesaNumber, reason } = request.data as {
    fullName?: string;
    idNumber?: string;
    mpesaNumber?: string;
    reason?: string;
  };

  if (typeof fullName !== "string" || !fullName.trim()) {
    throw new HttpsError("invalid-argument", "Your full name is required.");
  }

  if (typeof idNumber !== "string" || !idNumber.trim()) {
    throw new HttpsError("invalid-argument", "Your ID number is required.");
  }

  if (typeof mpesaNumber !== "string" || !mpesaNumber.trim()) {
    throw new HttpsError("invalid-argument", "An M-Pesa number is required.");
  }

  if (typeof reason !== "string" || !reason.trim()) {
    throw new HttpsError("invalid-argument", "Please tell us why you want to be a marketer.");
  }

  // Pull email from the user's own account/profile — never trust a
  // client-supplied email field, since request.auth.token.email is
  // verified by Firebase Auth itself.
  const userSnap = await db.collection("users").doc(uid).get();
  const email = request.auth.token.email ?? userSnap.data()?.email ?? "";

  await db.collection("marketerApplications").doc(uid).set({
    uid,
    fullName: fullName.trim(),
    email,
    idNumber: idNumber.trim(),
    mpesaNumber: mpesaNumber.trim(),
    reason: reason.trim().slice(0, 300),
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});


/**
 * Admin-only: reject a pending marketer application.
 */
export const rejectMarketerApplication = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  if (request.auth.uid !== OWNER_UID) {
    throw new HttpsError("permission-denied", "Only the owner can manage marketer applications.");
  }

  const { uid } = request.data as { uid?: string };
  if (!uid) throw new HttpsError("invalid-argument", "A user UID is required.");

  await db.collection("marketerApplications").doc(uid).update({
    status: "rejected",
  });

  await sendPushToUid(
    uid,
    "Marketer application update",
    "Your marketer application wasn't approved this time. Contact support if you'd like to know more.",
    { type: "marketer_rejected" }
  );

  await logAdminAction(request.auth.uid, "reject_marketer_application", { targetUid: uid });

  return { success: true };
});
