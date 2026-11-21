/**
 * BizMtaani Firebase Cloud Functions — CONSOLIDATED BACKEND
 */

import * as crypto from "crypto";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { resolveWardServerSide } from "./locationResolver";
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";

admin.initializeApp();
const db = admin.firestore();

// Global ceiling for every function in this file — without this, an
// abuse loop or traffic spike on any single function scales instances
// unbounded, which is unbounded cost. Individual functions below can
// still override these via their own options object (e.g. mpesaCallback).
setGlobalOptions({ maxInstances: 20, memory: "256MiB", timeoutSeconds: 60 });

// ─── Secrets ───────────────────────────────────────────────────────────────
const cloudinaryApiKey = defineSecret("CLOUDINARY_API_KEY");
const cloudinaryApiSecret = defineSecret("CLOUDINARY_API_SECRET");
const cloudinaryCloudName = defineSecret("CLOUDINARY_CLOUD_NAME");
const mpesaConsumerKey = defineSecret("MPESA_CONSUMER_KEY");
const mpesaConsumerSecret = defineSecret("MPESA_CONSUMER_SECRET");
const mpesaPasskey = defineSecret("MPESA_PASSKEY");

// Single source of truth for the owner UID — referenced by every
// admin-only function instead of repeating the literal string.
const OWNER_UID = "MdkkpY3BkMNdTYChcR2TaNtK08W2";

function requireAdmin(
  request: { auth?: { uid: string; token: Record<string, unknown> } | null }
): asserts request is { auth: { uid: string; token: Record<string, unknown> } } {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
}
// ─── Constants ──────────────────────────────────────────────────────────────
const FOLDER_MAP: Record<string, string> = {
  avatar: "bizmtaani/avatars",
  product: "bizmtaani/products",
  community: "bizmtaani/community",
};
// Update these to reflect the plans actually used in your frontend (mpesa.ts)
const PLAN_AMOUNTS: Record<string, number> = { 
  free: 0, 
  premium_weekly: 120, 
  premium_monthly: 400 
};

const PREMIUM_ONLY_CATEGORIES = [
  "Accommodation",
  "Commercial Property",
  "Entertainment & Events",
  "Leisure & Activities",
  "Vehicles",
  "Home, Furniture & Appliances",
];

// If you are using limits in your backend, update them here:
const MAX_PHOTO_LIMIT: Record<string, number> = {
  free: 1,
  premium_weekly: 3,
  premium_monthly: 3,
};

const MAX_ACTIVE_ADS: Record<string, number> = {
  free: 5,
  premium_weekly: 10,
  premium_monthly: 10,
};
// Add this in your Constants section
const LISTING_DURATIONS: Record<string, number> = {
  free: 7,
  premium_weekly: 7,
  premium_monthly: 30,
};
const CLEANUP_LIMIT = 150;
const ARCHIVE_RETENTION_HOURS = 48;
const MINIMUM_PAYOUT_KES = 500; // adjust to whatever makes sense for your M-Pesa costs

// ═══════════════════════════════════════════════════════════════════════════
// BATCH COMMITTER HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-commits Firestore batches when they reach the limit (400 ops,
 * safely under Firestore's 500 hard limit). Use this instead of
 * db.batch() in loops that can exceed 500 writes.
 */
class BatchCommitter {
  private batch: FirebaseFirestore.WriteBatch;
  private opCount: number = 0;
  private commitCount: number = 0;
  private readonly maxOps: number;
  private pendingCommits: Promise<unknown>[] = [];

  constructor(maxOps: number = 400) {
    this.batch = db.batch();
    this.maxOps = maxOps;
  }

  set(
    docRef: FirebaseFirestore.DocumentReference,
    data: any,
    options?: FirebaseFirestore.SetOptions
  ): void {
    if (options) {
      this.batch.set(docRef, data, options);
    } else {
      this.batch.set(docRef, data);
    }
    this.opCount++;
    this.checkAndCommit();
  }

  update(
    docRef: FirebaseFirestore.DocumentReference,
    data: any
  ): void {
    this.batch.update(docRef, data);
    this.opCount++;
    this.checkAndCommit();
  }

  delete(docRef: FirebaseFirestore.DocumentReference): void {
    this.batch.delete(docRef);
    this.opCount++;
    this.checkAndCommit();
  }

  private checkAndCommit(): void {
    if (this.opCount >= this.maxOps) {
      const batchToCommit = this.batch;
      this.commitCount++;
      this.pendingCommits.push(
        batchToCommit.commit().catch((err) => {
          console.error(`Batch ${this.commitCount} commit failed:`, err);
          throw err;
        })
      );
      this.opCount = 0;
      this.batch = db.batch();
    }
  }

  async finalize(): Promise<void> {
    if (this.opCount > 0) {
      this.pendingCommits.push(this.batch.commit());
      this.commitCount++;
      this.opCount = 0;
    }
    // Surfaces any failed intermediate commit to the caller instead
    // of letting it vanish as an unhandled rejection.
    await Promise.all(this.pendingCommits);
    this.pendingCommits = [];
  }

  get totalCommits(): number {
    return this.commitCount;
  }
}

function isSandbox(): boolean {
  return (process.env.MPESA_ENVIRONMENT ?? "sandbox") !== "production";
}

function darajaBase(): string {
  return isSandbox() ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
}


function mpesaTimestamp(): string {
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  return [
    eat.getUTCFullYear(),
    String(eat.getUTCMonth() + 1).padStart(2, "0"),
    String(eat.getUTCDate()).padStart(2, "0"),
    String(eat.getUTCHours()).padStart(2, "0"),
    String(eat.getUTCMinutes()).padStart(2, "0"),
    String(eat.getUTCSeconds()).padStart(2, "0"),
  ].join("");
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    console.log(`Daraja token request starting: ${darajaBase()}/oauth/v1/generate`);
    res = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${creds}` },
      signal: controller.signal,
    });
    console.log("Daraja token request completed, status:", res.status);
  } catch (err) {
    console.error("Daraja token request FAILED or timed out:", err);
    throw new Error(`Daraja token request failed or timed out: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) { const text = await res.text(); throw new Error(`Daraja token failed (${res.status}): ${text.slice(0, 200)}`); }
  const data = (await res.json()) as { access_token: string; expires_in: string };
  _darajaToken = { token: data.access_token, expiresAt: Date.now() + parseInt(data.expires_in) * 1000 };
  return _darajaToken.token;
}

async function sendDarajaStkPush(
  formattedPhone: string,
  plan: string,
  productId: string,
  mpesaConsumerKey: ReturnType<typeof defineSecret>,
  mpesaConsumerSecret: ReturnType<typeof defineSecret>,
  mpesaPasskey: ReturnType<typeof defineSecret>
): Promise<{ checkoutRequestId: string; customerMessage: string; callbackTokenHash: string }> {
  const token = await getDarajaToken(mpesaConsumerKey.value(), mpesaConsumerSecret.value());

  const ts = mpesaTimestamp();
  const callbackToken = crypto.randomBytes(24).toString("hex");
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  const shortcode = process.env.MPESA_SHORTCODE;
  const tillNumber = process.env.MPESA_TILL_NUMBER;

  const stkBody = {
    BusinessShortCode: shortcode,
    Password: Buffer.from(`${shortcode}${mpesaPasskey.value()}${ts}`).toString("base64"),
    Timestamp: ts,
    TransactionType: "CustomerBuyGoodsOnline",
    Amount: PLAN_AMOUNTS[plan],
    PartyA: formattedPhone,
    PartyB: tillNumber,
    PhoneNumber: formattedPhone,
    CallBackURL: `${process.env.MPESA_CALLBACK_URL ?? `https://europe-west1-${projectId}.cloudfunctions.net/mpesaCallback`}/${callbackToken}`,
    AccountReference: productId.slice(0, 12),
    TransactionDesc: `BizMtaani ${plan} listing`,
  };

  const stkUrl = `${darajaBase()}/mpesa/stkpush/v1/processrequest`;
  const response = await fetch(stkUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(stkBody),
    signal: AbortSignal.timeout(90000),
  });

  const responseText = await response.text();
  let darajaData: any;
  try {
    darajaData = JSON.parse(responseText);
  } catch {
    throw new Error(`Safaricom returned non-JSON response: ${responseText.slice(0, 500)}`);
  }

  if (darajaData.ResponseCode !== "0") {
    throw new Error(darajaData.errorMessage ?? "Daraja error");
  }

  const callbackTokenHash = crypto.createHash("sha256").update(callbackToken).digest("hex");

  return {
    checkoutRequestId: darajaData.CheckoutRequestID,
    customerMessage: darajaData.CustomerMessage,
    callbackTokenHash,
  };
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

const UPLOAD_SIGNATURE_COOLDOWN_MS = 3_000; // stops a script from minting signatures/draftUploads docs faster than a real user ever could

export const getCloudinarySignature = onCall({ region: "europe-west1", secrets: [cloudinaryApiKey, cloudinaryApiSecret, cloudinaryCloudName], cors: true, maxInstances: 200 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  // Per-user cooldown — each call writes a draftUploads doc, so an
  // unthrottled endpoint is write amplification waiting to happen.
  const uploadCooldownRef = db.collection("uploadSignatureCooldowns").doc(request.auth.uid);
  const uploadCooldownSnap = await uploadCooldownRef.get();
  const lastSignatureAt = uploadCooldownSnap.exists ? uploadCooldownSnap.data()?.lastRequestedAt?.toMillis() : null;
  if (lastSignatureAt && Date.now() - lastSignatureAt < UPLOAD_SIGNATURE_COOLDOWN_MS) {
    throw new HttpsError(
      "resource-exhausted",
      "Please wait a moment before uploading another photo."
    );
  }
  await uploadCooldownRef.set({
    lastRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 60 * 1000)),
  });

  const reqData = request.data as Record<string, unknown>;
  const uploadType = (reqData.uploadType as string | undefined) ?? "product";

  // Scope every upload under the uploader's own uid — ties ownership
  // directly into the Cloudinary folder path, so two users' uploads
  // can never collide and any later audit/cleanup can filter by
  // folder prefix per user.
  const baseFolder = FOLDER_MAP[uploadType] ?? FOLDER_MAP["product"];
  const folder = `${baseFolder}/${request.auth.uid}`;
  const timestamp = Math.floor(Date.now() / 1000);

  // Every parameter included in the signature is enforced by
  // Cloudinary server-side — a client cannot alter these without
  // invalidating the signature. max_file_size is now actually signed
  // (previously only claimed to be) and MUST also be sent as a form
  // field in the actual upload request (see uploadImage.ts) — if
  // either side is missing or mismatched, Cloudinary rejects with
  // "Invalid Signature". Params must appear in alphabetical order in
  // the signed string per Cloudinary's requirement.
  const signature = crypto
  .createHash("sha1")
  .update(
    `allowed_formats=${ALLOWED_UPLOAD_FORMATS}&folder=${folder}&timestamp=${timestamp}${cloudinaryApiSecret.value()}`
  )
  .digest("hex");

  // Use the client-supplied draftId if given, so every photo in this
  // posting session attaches to the SAME draft record. Fall back to
  // generating one only if the client didn't send one.
  const clientDraftId = reqData.draftId as string | undefined;
  const draftId = clientDraftId && clientDraftId.trim() ? clientDraftId : crypto.randomBytes(12).toString("hex");

  await db.collection("draftUploads").doc(draftId).set({
  uid: request.auth.uid,
  folder,
  claimed: false,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
}, { merge: true });
  return {
  signature,
  timestamp,
  folder,
  apiKey: cloudinaryApiKey.value(),
  cloudName: cloudinaryCloudName.value(),
  draftId,
  allowedFormats: ALLOWED_UPLOAD_FORMATS,
};
});

/**
 * Attaches an uploaded image's Cloudinary public_id to its draft
 * record, so it can be deleted automatically if the advert it was
 * meant for is never published.
 */
export const attachDraftUploadImage = onCall({ region: "europe-west1", cors: true, maxInstances: 200 }, async (request) => {
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

/**
 * Batched version of attachDraftUploadImage — attaches every photo
 * from one posting session in a single read + single write, instead
 * of one read + one write per photo. Callers should prefer this over
 * calling attachDraftUploadImage once per image.
 */
export const attachDraftUploadImages = onCall({ region: "europe-west1", cors: true, maxInstances: 200 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { draftId, publicIds } = request.data as { draftId?: string; publicIds?: string[] };
  if (!draftId || !Array.isArray(publicIds) || publicIds.length === 0) {
    throw new HttpsError("invalid-argument", "draftId and a non-empty publicIds array are required.");
  }
  if (!publicIds.every((id) => typeof id === "string" && id.trim())) {
    throw new HttpsError("invalid-argument", "publicIds must all be non-empty strings.");
  }

  const draftRef = db.collection("draftUploads").doc(draftId);
  const draftSnap = await draftRef.get();
  if (!draftSnap.exists || draftSnap.data()?.uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Invalid draft upload.");
  }

  await draftRef.update({
    publicIds: admin.firestore.FieldValue.arrayUnion(...publicIds),
  });

  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. M-PESA PAYMENTS & CALLBACK
// ═══════════════════════════════════════════════════════════════════════════
const MPESA_INITIATION_COOLDOWN_MS = 30_000;
export const initiateMpesaPayment = onCall({ region: "europe-west1", memory: "512MiB", secrets: [mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey], cors: true, maxInstances: 10, timeoutSeconds: 120 }, async (request) => {
  console.log("STEP 1: function started");
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const { phone, productId, recaptchaToken } = request.data as { phone: string; productId: string; recaptchaToken?: string };

  if (typeof productId !== "string" || !productId.trim()) {
    throw new HttpsError("invalid-argument", "Product ID is required.");
  }

  console.log("STEP 2: kicking off daraja token fetch");
  const darajaTokenPromise = getDarajaToken(mpesaConsumerKey.value(), mpesaConsumerSecret.value());

  const cooldownRef = db.collection("paymentCooldowns").doc(request.auth.uid);

  console.log("STEP 3: starting recaptcha + firestore reads");
  const [cooldownSnap, productSnap] = await Promise.all([
    cooldownRef.get(),
    db.collection("products").doc(productId).get(),
  ]);
  console.log("STEP 4: recaptcha + firestore reads done");

  const lastInitiatedAt = cooldownSnap.exists ? cooldownSnap.data()?.lastInitiatedAt?.toMillis() : null;

  if (lastInitiatedAt && Date.now() - lastInitiatedAt < MPESA_INITIATION_COOLDOWN_MS) {
    throw new HttpsError("resource-exhausted", "Please wait a moment before trying to pay again.");
  }

  await cooldownRef.set({
    lastInitiatedAt: admin.firestore.FieldValue.serverTimestamp(),
    expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)),
  });

  if (!productSnap.exists) throw new HttpsError("not-found", "Advert not found.");
  const productData = productSnap.data()!;
  if (productData.sellerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "You can only initiate payment for your own adverts.");
  }
  if (productData.status !== "pending_payment") {
    throw new HttpsError("failed-precondition", "This advert is not awaiting payment.");
  }

  const plan = productData.plan;
  if (typeof plan !== "string" || !PLAN_AMOUNTS.hasOwnProperty(plan)) {
    throw new HttpsError("invalid-argument", "This advert has no valid plan on record.");
  }

  // Clean up previous pending payments in the background.
// This is not required before sending the new STK Push.
db.collection("payments")
  .where("productId", "==", productId)
  .where("status", "==", "pending")
  .get()
  .then((stalePayments) => {
    if (stalePayments.empty) return;

    const batch = db.batch();

    stalePayments.docs.forEach((doc) => {
      batch.update(doc.ref, { status: "cancelled" });
    });

    return batch.commit();
  })
  .then(() => {
    console.log("STEP 5: stale payment cleanup completed");
  })
  .catch((err) => {
    console.error("STEP 5: stale payment cleanup failed:", err);
  });

  const formattedPhone = normalizePhone(phone);
  console.log("STEP 7: phone normalized:", formattedPhone);

  console.log("STEP 8: fetching fresh token");
  const token = await darajaTokenPromise;
 console.log("STEP 9: token received successfully");


  const ts = mpesaTimestamp();
  const callbackToken = crypto.randomBytes(24).toString("hex");
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  const shortcode = process.env.MPESA_SHORTCODE;
  const tillNumber = process.env.MPESA_TILL_NUMBER;

  const stkBody = {
    BusinessShortCode: shortcode,
    Password: Buffer.from(`${shortcode}${mpesaPasskey.value()}${ts}`).toString("base64"),
    Timestamp: ts,
    TransactionType: "CustomerBuyGoodsOnline",
    Amount: PLAN_AMOUNTS[plan],
    PartyA: formattedPhone,
    PartyB: tillNumber,
    PhoneNumber: formattedPhone,
    CallBackURL: `${process.env.MPESA_CALLBACK_URL ?? `https://europe-west1-${projectId}.cloudfunctions.net/mpesaCallback`}/${callbackToken}`,
    AccountReference: productId.slice(0, 12),
    TransactionDesc: `BizMtaani ${plan} listing`,
  };
  
  const stkResult = await sendDarajaStkPush(formattedPhone, plan, productId, mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey);

  await db.collection("payments").doc(stkResult.checkoutRequestId).set({
    checkoutRequestId: stkResult.checkoutRequestId,
    callbackTokenHash: stkResult.callbackTokenHash,
    plan, productId,
    buyerId: request.auth.uid,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
return { checkoutRequestId: stkResult.checkoutRequestId, customerMessage: stkResult.customerMessage };
});

export const mpesaCallback = onRequest({ region: "europe-west1", maxInstances: 100 }, async (req, res) => {
  try {
    // Token now arrives as the last path segment (e.g. /mpesaCallback/abc123...)
    // instead of a query parameter — a raw query string on CallBackURL was
    // empirically causing STK push requests to hang (STEP 11), so this avoids
    // query strings entirely while still authenticating the callback.
    const pathToken = req.path.split("/").filter(Boolean).pop() ?? "";
    const callback = req.body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) { res.json({ ResultCode: 0, ResultDesc: "Accepted" }); return; }

    const paymentRef = db.collection("payments").doc(callback.CheckoutRequestID);

    // Extract M-Pesa receipt number from Safaricom callback, if present —
    // cheap synchronous work on data already in memory, safe to do
    // before responding.
    const callbackMetadata = callback.CallbackMetadata?.Item ?? [];
    const mpesaCode =
      callbackMetadata.find(
        (item: { Name: string; Value?: unknown }) => item.Name === "MpesaReceiptNumber"
      )?.Value ?? null;
    const confirmedAmount =
      callbackMetadata.find(
        (item: { Name: string; Value?: unknown }) => item.Name === "Amount"
      )?.Value ?? null;

    // Idempotency guard: Safaricom may deliver the same callback more
    // than once. Claim the payment atomically — only one concurrent
    // delivery can win the transaction and proceed past this point.
    // All heavy follow-up work (activation, commission, subscription
    // extension, reactivation) is handled separately by
    // processCompletedPayment, triggered off this status change — so
    // this function can respond to Safaricom immediately, before any
    // of that runs, rather than risk it being cut off mid-way once
    // the response is sent.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(paymentRef);
      const incomingHash = crypto.createHash("sha256").update(pathToken).digest("hex");
      if (!snap.exists || snap.data()?.callbackTokenHash !== incomingHash) {
        return;
      }
      const existingStatus = snap.data()?.status;
      if (existingStatus === "completed" || existingStatus === "failed" || existingStatus === "cancelled") {
        return;
      }

      if (callback.ResultCode === 0) {
        tx.update(paymentRef, {
          status: "completed",
          mpesaCode,
          confirmedAmountKES: typeof confirmedAmount === "number" ? confirmedAmount : null,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        tx.update(paymentRef, {
          status: "failed",
          failureReason: callback.ResultDesc ?? "Payment failed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (err) { console.error(err); }
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/**
 * Fires when a payment doc's status changes to "completed" (set by
 * mpesaCallback's fast claim transaction above). Does all the heavy
 * follow-up work — advert activation, buyer notification, marketer
 * commission, subscription extension, hotel-menu ad reactivation —
 * outside the HTTP request/response cycle, so none of it risks being
 * cut off by Cloud Run's post-response CPU throttling.
 */
export const processCompletedPayment = onDocumentUpdated(
  "payments/{paymentId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    if (before?.status === "completed" || after.status !== "completed") return;

    const paymentData = after;
    const checkoutRequestId = event.params.paymentId;

    // Idempotency guard — Firestore triggers are at-least-once, so this
    // function can fire more than once for the same completed payment.
    // Claim it atomically before doing any non-idempotent work below
    // (subscription extension, ad reactivation).
    const paymentRef = db.collection("payments").doc(checkoutRequestId);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(paymentRef);
      if (snap.data()?.postProcessed === true) return false;
      tx.update(paymentRef, { postProcessed: true });
      return true;
    });
    if (!claimed) return;

    const plan = paymentData.plan ?? "free";
    const durationDays = LISTING_DURATIONS[plan] ?? 7;

    // Activate the advert
    await db.collection("products").doc(paymentData.productId).update({
      status: "active",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + durationDays * 86_400_000)
      ),
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
      const referralRef = db.collection("referrals").doc(paymentData.buyerId);
      // Prefer the amount Safaricom actually confirmed in the
      // callback over the static plan price — falls back to
      // PLAN_AMOUNTS only if the callback didn't include it for
      // some reason.
      const amountPaid =
        typeof paymentData.confirmedAmountKES === "number"
          ? paymentData.confirmedAmountKES
          : PLAN_AMOUNTS[plan] ?? 0;
      const commission = Math.round(amountPaid * COMMISSION_RATE);
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      let commissionJustPaid: { marketerUid: string } | null = null;
      let commissionFailureReason: string | null = null;

      await db.runTransaction(async (tx) => {
        const referralSnap = await tx.get(referralRef);
        if (!referralSnap.exists || referralSnap.data()?.commissionPaidOut) return;

        const { marketerUid } = referralSnap.data()!;
        const marketerRef = db.collection("marketers").doc(marketerUid);
        const marketerSnap = await tx.get(marketerRef);

        if (!marketerSnap.exists) {
          // Marketer record is gone (deleted, or the referral row is
          // stale/inconsistent). Don't let tx.update() throw here —
          // that would abort the whole transaction and swallow the
          // commission with zero trace. Flag it on the referral doc
          // instead, visible for manual reconciliation.
          tx.update(referralRef, {
            commissionPaidOut: false,
            commissionFailedAt: admin.firestore.FieldValue.serverTimestamp(),
            commissionFailureReason: "marketer_not_found",
          });
          commissionFailureReason = "marketer_not_found";
          return;
        }

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
        tx.update(referralRef, { commissionPaidOut: true });

        commissionJustPaid = { marketerUid };
      });

      if (commissionFailureReason) {
        console.error(
          `Commission payout failed for referral ${paymentData.buyerId}: ${commissionFailureReason}. Flagged on the referral doc for manual review.`
        );
      }

      if (commissionJustPaid) {
                const { marketerUid } = commissionJustPaid;
                await db.collection("referralCommissions").add({
                    marketerUid,
                    referredUserUid: paymentData.buyerId,
                    paymentId: checkoutRequestId,
                    amountPaidKES: amountPaid,
                    commissionKES: commission,
                    type: "first_premium_payment",
                    paymentStatus: "completed", // ✅ ADDED: Denormalized to prevent future N+1 reads
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

        try {
          const marketerTokenSnap = await db.collection("fcmTokens").doc(marketerUid).get();
          const marketerToken = marketerTokenSnap.exists ? marketerTokenSnap.data()?.token : null;
          if (marketerToken) {
            await admin.messaging().send({
              token: marketerToken,
              notification: {
                title: "Congrats🥳 Umepata commission! 🎉",
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

    const existingPremiumEndsAt = userData?.premiumEndsAt?.toDate?.() ?? null;

    const now = new Date();

    const subscriptionStartDate =
      existingPremiumEndsAt && existingPremiumEndsAt > now ? existingPremiumEndsAt : now;

    const newPremiumEndsAt = new Date(
      subscriptionStartDate.getTime() + durationDays * 86_400_000
    );

    const premiumEndsTimestamp = admin.firestore.Timestamp.fromDate(newPremiumEndsAt);

    await userRef.set(
      {
        subscriptionPlan: plan,
        premiumEndsAt: premiumEndsTimestamp,
      },
      { merge: true }
    );

    await userRef.collection("subscription").doc("active").set({
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
  }
);
/**
 * Fires when a payment doc's status changes to "failed" or
 * "cancelled" (set by mpesaCallback when Safaricom reports a
 * non-zero ResultCode — e.g. the user cancelled the STK prompt).
 * Immediately reverts a RENEWAL's product status back to what it
 * was before the renewal attempt, instead of leaving it stuck in
 * "pending_payment" until the next scheduledCleanup run (up to ~6
 * hours later) — during which the advert is invisible both to the
 * seller (wrong tab) and to buyers (not active).
 *
 * Fresh adverts (publishAdvert path, no previousStatus set) are
 * deliberately left untouched here — an abandoned brand-new pending
 * advert is correctly handled by the existing cleanup-delete path,
 * since nothing was previously live to restore.
 */
export const revertProductOnPaymentFailure = onDocumentUpdated(
  "payments/{paymentId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    if (before?.status === after.status) return;
    if (after.status !== "failed" && after.status !== "cancelled") return;

    const productId = after.productId;
    if (typeof productId !== "string" || !productId.trim()) return;

    const productRef = db.collection("products").doc(productId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(productRef);
      if (!snap.exists) return;
      const data = snap.data()!;

      // Only act if this product is still sitting in the exact
      // pending state this payment attempt put it in — if the user
      // already retried (new pending attempt) or it resolved some
      // other way, leave it alone.
      if (data.status !== "pending_payment") return;
      if (!data.previousStatus) return;

      tx.update(productRef, {
        status: data.previousStatus,
        previousStatus: admin.firestore.FieldValue.delete(),
        pendingPaymentStartedAt: admin.firestore.FieldValue.delete(),
      });
    });
  }
);
// ═══════════════════════════════════════════════════════════════════════════
// 9. LANDING PAGES (ward + category combos with live listings)
//
// Keeps a small landingPages collection in sync with exactly which
// county+ward+category combinations currently have at least one
// active, unexpired advert. This is what the sitemap function reads
// from — it lets the sitemap list only combinations that genuinely
// have content, instead of every possible combination in Kenya
// (~1,450 wards × ~15 categories), most of which are empty. Listing
// empty pages is the "thin content" problem that actively hurts SEO.
//
// A doc is deleted entirely once its count reaches zero, so the
// sitemap query is always just "read every doc in this collection" —
// no filtering needed on the read side.
// ═══════════════════════════════════════════════════════════════════════════

function slugifyForLandingPage(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[/]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function landingPageKey(county: string, ward: string, category: string): string {
  return `${slugifyForLandingPage(county)}__${slugifyForLandingPage(ward)}__${slugifyForLandingPage(category)}`;
}

async function adjustLandingPageCount(
  county: string | undefined,
  ward: string | undefined,
  category: string | undefined,
  delta: number
): Promise<void> {
  if (!county?.trim() || !ward?.trim() || !category?.trim()) return;

  const key = landingPageKey(county, ward, category);
  const ref = db.collection("landingPages").doc(key);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data()?.activeCount ?? 0) : 0;
      const next = current + delta;

      if (next <= 0) {
        if (snap.exists) tx.delete(ref);
        return;
      }

      tx.set(
        ref,
        {
          county,
          ward,
          category,
          countySlug: slugifyForLandingPage(county),
          wardSlug: slugifyForLandingPage(ward),
          categorySlug: slugifyForLandingPage(category),
          activeCount: next,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  } catch (error) {
    // Never let a landing-page bookkeeping failure affect the actual
    // product write that triggered it — this is a derived index, not
    // the source of truth.
    console.error(`Failed to adjust landing page count for ${key}:`, error);
  }
}

export const onProductCreatedForLandingPages = onDocumentCreated(
  "products/{productId}",
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "active") return;
    await adjustLandingPageCount(data.county, data.ward, data.category, 1);
  }
);

export const onProductUpdatedForLandingPages = onDocumentUpdated(
  "products/{productId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const wasActive = before.status === "active";
    const isActive = after.status === "active";

    if (!wasActive && isActive) {
      await adjustLandingPageCount(after.county, after.ward, after.category, 1);
      return;
    }

    if (wasActive && !isActive) {
      await adjustLandingPageCount(before.county, before.ward, before.category, -1);
      return;
    }

    if (wasActive && isActive) {
      const locationOrCategoryChanged =
        before.county !== after.county ||
        before.ward !== after.ward ||
        before.category !== after.category;

      if (locationOrCategoryChanged) {
        await adjustLandingPageCount(before.county, before.ward, before.category, -1);
        await adjustLandingPageCount(after.county, after.ward, after.category, 1);
      }
    }
  }
);

export const onProductDeletedForLandingPages = onDocumentDeleted(
  "products/{productId}",
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "active") return;
    await adjustLandingPageCount(data.county, data.ward, data.category, -1);
  }
);

/**
 * Admin-only, one-off: populates landingPages from every currently
 * active product — necessary because the triggers above only fire on
 * FUTURE writes. Run this once after deploying the triggers, then
 * never again (new activity keeps the collection in sync from then on).
 */
export const backfillLandingPages = onCall({ cors: true, timeoutSeconds: 300 }, async (request) => {
  requireAdmin(request);

  const counts = new Map<string, { county: string; ward: string; category: string; count: number }>();
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;
  const PAGE = 500;

  while (true) {
    let q = db
      .collection("products")
      .where("status", "==", "active")
      .orderBy(admin.firestore.FieldPath.documentId())
      .select("county", "ward", "category")
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data.county?.trim() || !data.ward?.trim() || !data.category?.trim()) continue;
      const key = landingPageKey(data.county, data.ward, data.category);
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { county: data.county, ward: data.ward, category: data.category, count: 1 });
      }
    }

    scanned += snap.docs.length;
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }

  const committer = new BatchCommitter(400);
  counts.forEach(({ county, ward, category, count }, key) => {
    committer.set(
      db.collection("landingPages").doc(key),
      {
        county,
        ward,
        category,
        countySlug: slugifyForLandingPage(county),
        wardSlug: slugifyForLandingPage(ward),
        categorySlug: slugifyForLandingPage(category),
        activeCount: count,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  await committer.finalize();

  return { success: true, productsScanned: scanned, landingPagesCreated: counts.size };
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

async function deleteCloudinaryImagesBatched(publicIds: string[], batchSize = 10) {
  for (let i = 0; i < publicIds.length; i += batchSize) {
    await Promise.all(
      publicIds.slice(i, i + batchSize).map((id) =>
        deleteCloudinaryImage(id).catch((error) =>
          console.error(`Cloudinary delete failed for ${id}:`, error)
        )
      )
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

async function runCleanup() {
  const now = admin.firestore.Timestamp.now();
  const oneHourAgo = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 60 * 60 * 1000)
  );
  const archiveCutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - ARCHIVE_RETENTION_HOURS * 60 * 60 * 1000)
  );

  // ─── Fetch all documents to process ──────────────────────────────────

  const expiredActive = await db.collection("products")
    .where("status", "==", "active")
    .where("expiresAt", "<", now)
    .limit(CLEANUP_LIMIT)
    .get();

  const expiredPending = await db.collection("products")
    .where("status", "==", "pending_payment")
    .where("pendingPaymentStartedAt", "<", oneHourAgo)
    .limit(CLEANUP_LIMIT)
    .get();

  const expiredPayments = await db.collection("payments")
    .where("status", "==", "pending")
    .where("createdAt", "<", oneHourAgo)
    .limit(CLEANUP_LIMIT)
    .get();

  const staleArchived = await db.collection("products")
    .where("status", "==", "archived")
    .where("archivedAt", "<", archiveCutoff)
    .limit(CLEANUP_LIMIT)
    .get();

  const staleDrafts = await db.collection("draftUploads")
    .where("claimed", "==", false)
    .where("createdAt", "<", oneHourAgo)
    .limit(CLEANUP_LIMIT)
    .get();

  // ─── Use BatchCommitter instead of a single batch ──────────────────

  const committer = new BatchCommitter(400);
  let purgedDraftImages = 0;
  let purgedChats = 0;

  // 1. Archive expired active adverts
  expiredActive.docs.forEach((doc) => {
    committer.update(doc.ref, {
      status: "archived",
      archivedAt: now,
    });
  });

  // 2. Delete abandoned FRESH pending adverts — but a stalled
  // RENEWAL (has previousStatus) must be reverted, never deleted,
  // since the advert already existed before this pending attempt.
  let revertedRenewals = 0;
  for (const doc of expiredPending.docs) {
    const data = doc.data();

    if (data.previousStatus) {
      committer.update(doc.ref, {
        status: data.previousStatus,
        previousStatus: admin.firestore.FieldValue.delete(),
        pendingPaymentStartedAt: admin.firestore.FieldValue.delete(),
      });
      revertedRenewals++;
      continue;
    }

    if (Array.isArray(data.imageUrls)) {
      const publicIds = data.imageUrls
        .map((img: any) => (typeof img === "string" ? null : img.public_id))
        .filter((id: any): id is string => !!id);
      await deleteCloudinaryImagesBatched(publicIds);
    }
    committer.delete(doc.ref);
  }

  // 3. Delete abandoned pending payment records
  expiredPayments.docs.forEach((doc) => {
    committer.delete(doc.ref);
  });

  // 4. Clean up unclaimed draft uploads
  for (const draftDoc of staleDrafts.docs) {
    const data = draftDoc.data();
    const publicIds: string[] = Array.isArray(data.publicIds) ? data.publicIds : [];
    await deleteCloudinaryImagesBatched(publicIds);
    purgedDraftImages += publicIds.length;
    committer.delete(draftDoc.ref);
  }

  // 5. Permanently purge adverts archived past retention
  for (const doc of staleArchived.docs) {
    const data = doc.data();

    if (Array.isArray(data.imageUrls)) {
      const publicIds = data.imageUrls
        .map((img: any) => (typeof img === "string" ? null : img.public_id))
        .filter((id: any): id is string => !!id);
      await deleteCloudinaryImagesBatched(publicIds);
    }

    const relatedChats = await db.collection("chats")
      .where("productId", "==", doc.id)
      .get();

    for (const chatDoc of relatedChats.docs) {
      await db.recursiveDelete(chatDoc.ref);
      purgedChats++;
    }

    committer.delete(doc.ref);
  }

  // 6. Delete orphaned chats
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

  // 7. Finalize — commit any remaining operations
  await committer.finalize();

  return {
    archived: expiredActive.size,
    deletedPending: expiredPending.size - revertedRenewals,
    revertedRenewals,
    deletedPayments: expiredPayments.size,
    purgedArchived: staleArchived.size,
    purgedChatsFromPurgedAds: purgedChats,
    orphanedChatsDeleted: orphanedChats,
    purgedDraftImages,
    batchCommits: committer.totalCommits,
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
`Cleanup complete. Archived: ${result.archived}, ` +
`Deleted pending adverts: ${result.deletedPending}, ` +
`Reverted stalled renewals: ${result.revertedRenewals}, ` +
`Deleted pending payments: ${result.deletedPayments}, ` +
`Purged old archived adverts: ${result.purgedArchived}, ` +
`Chats removed with purged adverts: ${result.purgedChatsFromPurgedAds}, ` +
`Orphaned chats removed: ${result.orphanedChatsDeleted}, ` +
`Purged orphaned draft images: ${result.purgedDraftImages}, ` +
`Batch commits: ${result.batchCommits}`
);
    } catch (error) {
      console.error("Cleanup failed:", error);
    }

    // Merged from the former separate notifyExpiringAdverts scheduled
    // function — same 6-hour cadence, now sharing one invocation
    // instead of two, to cut scheduled Cloud Function invocation cost.
    try {
      await runExpiringAdvertReminders();
    } catch (error) {
      console.error("Expiring advert reminders failed:", error);
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
async function runExpiringAdvertReminders() {
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
}

export const closeMonthlyEarnings = onSchedule(
  { schedule: "0 0 1 * *", timeZone: "Africa/Nairobi" },
  async () => {
    const now = new Date();
    const closedMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const closedMonthKey = `${closedMonth.getFullYear()}-${String(closedMonth.getMonth() + 1).padStart(2, "0")}`;
    const newMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let processedCount = 0;
    let payoutCount = 0;
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    const pageSize = 100; // Just for pagination — each marketer is still closed out individually below

    while (true) {
      let listQuery = db.collection("marketers").orderBy("__name__").limit(pageSize);
      if (lastDoc) {
        listQuery = listQuery.startAfter(lastDoc);
      }

      const marketersSnap = await listQuery.get();
      if (marketersSnap.empty) break;
      lastDoc = marketersSnap.docs[marketersSnap.docs.length - 1];

      // Each marketer is closed out in its OWN transaction, re-reading
      // the doc fresh at write time — a commission landing mid-run
      // (processCompletedPayment incrementing this same doc
      // concurrently) causes Firestore to retry this transaction
      // against the new value instead of the earlier page-level read
      // silently overwriting it and losing the commission.
      for (const docRef of marketersSnap.docs.map((d) => d.ref)) {
        try {
          const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            if (!snap.exists) return null;
            const data = snap.data()!;

            const earnedThatMonth = data.earningsMonthKey === closedMonthKey
              ? (data.earningsThisMonth ?? 0)
              : 0;
            const signupsThatMonth = data.signupsMonthKey === closedMonthKey
              ? (data.signupsThisMonth ?? 0)
              : 0;

            if (earnedThatMonth < MINIMUM_PAYOUT_KES) {
              // Below threshold — roll the month key forward only.
              // Deliberately NOT resetting earningsThisMonth/
              // signupsThisMonth: leaving both untouched carries them
              // together into the new month, so the signup count
              // never drifts out of sync with the carried balance.
              tx.update(docRef, {
                earningsMonthKey: newMonthKey,
                signupsMonthKey: newMonthKey,
              });
              return { paidOut: false };
            }

            const payoutRef = db.collection("payouts").doc(closedMonthKey)
              .collection("marketers").doc(docRef.id);

            tx.set(payoutRef, {
              marketerUid: docRef.id,
              referralCode: data.referralCode ?? null,
              earningsKES: earnedThatMonth,
              signups: signupsThatMonth,
              monthKey: closedMonthKey,
              paid: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // Decrement by exactly what was just read and paid out —
            // never reset to a literal 0. Any commission that
            // increments this doc between this transaction's read and
            // commit forces a retry against the new value, so nothing
            // gets silently lost.
            tx.update(docRef, {
              earningsThisMonth: admin.firestore.FieldValue.increment(-earnedThatMonth),
              signupsThisMonth: admin.firestore.FieldValue.increment(-signupsThatMonth),
              earningsMonthKey: newMonthKey,
              signupsMonthKey: newMonthKey,
            });

            return { paidOut: true };
          });

          if (result) {
            processedCount++;
            if (result.paidOut) payoutCount++;
          }
        } catch (error) {
          console.error(`Failed to close monthly earnings for marketer ${docRef.id}:`, error);
        }
      }

      if (marketersSnap.docs.length < pageSize) break;
    }

    console.log(
      `Closed earnings for ${closedMonthKey}: ${processedCount} marketers processed, ${payoutCount} payouts created.`
    );
  }
);

/**
 * Admin-only: fetch the payout list for a given month (e.g. "2026-07").
 */
export const getMonthlyPayouts = onCall({ cors: true }, async (request) => {
  requireAdmin(request);


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

  requireAdmin(request);

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

    const marketerSnap = await tx.get(marketerRef);
    if (!marketerSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "The marketer record for this payout no longer exists. This payout was not marked as paid — resolve manually."
      );
    }

    tx.update(payoutRef, { paid: true, paidAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(marketerRef, {
      totalWithdrawnKES: admin.firestore.FieldValue.increment(payoutData.earningsKES ?? 0),
    });
  });

  return { success: true };
});

   let _leaderboardCache: { leaderboard: any[]; timestamp: number } | null = null;
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — leaderboard doesn't need to be real-time

export const getTopMarketers = onCall({ cors: true }, async (request) => {
  requireAdmin(request);

  if (_leaderboardCache && Date.now() - _leaderboardCache.timestamp < LEADERBOARD_CACHE_TTL_MS) {
    return { leaderboard: _leaderboardCache.leaderboard };
  }

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const snap = await db.collection("marketers")
    .where("earningsMonthKey", "==", currentMonthKey)
    .orderBy("earningsThisMonth", "desc")
    .limit(10)
    .get();

  const leaderboard = snap.docs.map((d) => ({
    id: d.id,
    referralCode: d.data().referralCode ?? null,
    earningsThisMonth: d.data().earningsThisMonth ?? 0,
    signupsThisMonth: d.data().signupsThisMonth ?? 0,
  }));

  _leaderboardCache = { leaderboard, timestamp: Date.now() };

  return { leaderboard };
});
/**
 * Admin-only: for a list of marketer UIDs, returns each marketer's
 * total onboarded users (everyone who signed up with their referral
 * code, premium or not) and how many of those ever converted to
 * premium. Uses count() aggregation queries — 1 Firestore read per
 * query regardless of collection size, cheap even at scale.
 */
export const getMarketerOnboardingStats = onCall({ cors: true }, async (request) => {
  requireAdmin(request);

  const { uids } = request.data as { uids?: string[] };
  if (!Array.isArray(uids) || uids.length === 0) {
    throw new HttpsError("invalid-argument", "A non-empty uids array is required.");
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayTs = admin.firestore.Timestamp.fromDate(startOfToday);

  const results: Record<string, { today: number; totalOnboarded: number; premiumCount: number }> = {};

  await Promise.all(
    uids.map(async (uid) => {
      const base = db.collection("referrals").where("marketerUid", "==", uid);
      const [todaySnap, totalSnap, premiumSnap] = await Promise.all([
        base.where("createdAt", ">=", todayTs).count().get(),
        base.count().get(),
        base.where("commissionPaidOut", "==", true).count().get(),
      ]);
      results[uid] = {
        today: todaySnap.data().count,
        totalOnboarded: totalSnap.data().count,
        premiumCount: premiumSnap.data().count,
      };
    })
  );

  return { stats: results };
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

  requireAdmin(request);

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

/**
 * Mirrors changes to a chat's per-participant unreadCount map into a
 * single denormalized totalUnreadCount field on each affected user's
 * own /users/{uid} doc — one document to read instead of scanning
 * every chat a user has ever had. Runs via Admin SDK, so it can write
 * to another user's doc regardless of what client-side security rules
 * allow. Client code (sendChatMessage, forwardChatMessage,
 * markChatAsRead) should never attempt this kind of cross-user write
 * directly — that's exactly what just broke message sending.
 */
export const onChatUnreadCountChanged = onDocumentUpdated(
  "chats/{chatId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const beforeUnread: Record<string, number> = before.unreadCount ?? {};
    const afterUnread: Record<string, number> = after.unreadCount ?? {};

    const affectedUids = new Set([
      ...Object.keys(beforeUnread),
      ...Object.keys(afterUnread),
    ]);

    const batch = db.batch();
    let hasWrites = false;

    for (const uid of affectedUids) {
      const delta = (afterUnread[uid] ?? 0) - (beforeUnread[uid] ?? 0);
      if (delta === 0) continue;

      batch.set(
        db.collection("users").doc(uid),
        { totalUnreadCount: admin.firestore.FieldValue.increment(delta) },
        { merge: true }
      );
      hasWrites = true;
    }

    if (hasWrites) {
      await batch.commit();
    }
  }
);

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
    maxInstances: 1,
    concurrency: 1,
  },
  async (request) => {
    const { lat, lng } = request.data as { lat?: number; lng?: number };

    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new HttpsError("invalid-argument", "lat and lng are required numbers.");
    }

    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
    const cacheRef = db.collection("geocodeCache").doc(cacheKey);

    const cached = await cacheRef.get();
    if (cached.exists) {
      return cached.data();
    }

    await throttleNominatim();

    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=14`;

    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
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

    await cacheRef.set(result);
    return result;
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// 5. SUBSCRIPTION GATEKEEPER
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// MARKETER PROGRAM — "Open to marketers" commission on an advert
// BizMtaani never handles the sale money: the seller pays the marketer
// directly. This only validates and stores what the seller chose.
// ═══════════════════════════════════════════════════════════════════════════
const AFFILIATE_TYPES = ["fixed", "percentage", "half_month_rent", "one_month_rent"] as const;
type AffiliateType = (typeof AFFILIATE_TYPES)[number];
const AFFILIATE_MIN_PERCENT = 1;
const AFFILIATE_MAX_PERCENT = 50;

function sanitizeAffiliate(
  otherData: Record<string, any>,
  price: unknown,
  effectivePlan: string,
  isMasterAdmin: boolean
): { enabled: true; type: AffiliateType; amount: number } | null {
  const raw = otherData.affiliate;
  if (!raw || typeof raw !== "object" || raw.enabled !== true) return null;

  // Not offered for jobs, eateries, services, events or transport —
  // there is no item or house for a marketer to sell. Mirrors the UI.
  if (
    otherData.jobDetails ||
    otherData.hotelMenu ||
    otherData.serviceDetails ||
    otherData.eventDetails ||
    typeof otherData.pricingBasis === "string"
  ) {
    return null;
  }

  // Phase 1: Premium only. The UI hides the switch for free sellers,
  // but this is the check that actually counts.
  if (effectivePlan === "free" && !isMasterAdmin) {
    throw new HttpsError(
      "failed-precondition",
      "Open to marketers is available on Premium plans."
    );
  }

  const type = raw.type;
  if (!(AFFILIATE_TYPES as readonly string[]).includes(type)) {
    throw new HttpsError("invalid-argument", "Invalid commission type.");
  }

  // `price` is the sale price, or the monthly rent for rentals (the
  // client sends the rent as `price` for those categories).
  const basePrice = Number(price);

  let amount: number;
  if (type === "half_month_rent") {
    amount = Math.round(basePrice * 0.5);
  } else if (type === "one_month_rent") {
    amount = Math.round(basePrice);
  } else {
    amount = Number(raw.amount);
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "Enter a valid commission amount.");
  }

  if (type === "percentage") {
    if (amount < AFFILIATE_MIN_PERCENT || amount > AFFILIATE_MAX_PERCENT) {
      throw new HttpsError(
        "invalid-argument",
        `Commission percentage must be between ${AFFILIATE_MIN_PERCENT} and ${AFFILIATE_MAX_PERCENT}.`
      );
    }
  } else if (Number.isFinite(basePrice) && basePrice > 0 && amount > basePrice) {
    throw new HttpsError("invalid-argument", "The commission can't be more than the price.");
  }

  return {
    enabled: true,
    type: type as AffiliateType,
    amount: type === "percentage" ? Math.round(amount * 100) / 100 : Math.round(amount),
  };
}


export const publishAdvert = onCall({ region: "europe-west1", cors: true, maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { plan, title, price, imageUrls, draftId, productId: existingProductId, ...otherData } = request.data;
  const uid = request.auth.uid;

  const draftSnapPromise =
    typeof draftId === "string" && draftId.trim()
      ? db.collection("draftUploads").doc(draftId).get()
      : Promise.resolve(null);

  // Location must be resolved SERVER-SIDE from coordinates — never
  // trust ward/constituency/county/geohash strings supplied by the
  // client, since those directly control who can see this advert
  // (free = exact-ward match) and how far premium reach extends.
  const submittedLat = typeof otherData.lat === "number" ? otherData.lat : null;
  const submittedLng = typeof otherData.lng === "number" ? otherData.lng : null;

  if (submittedLat === null || submittedLng === null) {
    throw new HttpsError(
      "invalid-argument",
      "A location is required to publish an advert."
    );
  }

  const resolvedLocation = resolveWardServerSide(submittedLat, submittedLng);

  if (!resolvedLocation) {
    throw new HttpsError(
      "failed-precondition",
      "We couldn't match this location to a known ward. Please pick your area manually and try again."
    );
  }

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
  // Master admin posts are unrestricted: no active-ad-count cap, no
// payment requirement, and always broadcast to every viewer
// (visibilityScope "all_areas"), regardless of chosen plan.
const isMasterAdmin = uid === OWNER_UID;

  // 0. Validation: Category requires Premium
  const category = typeof otherData.category === "string" ? otherData.category : "";
  if (PREMIUM_ONLY_CATEGORIES.includes(category) && effectivePlan === "free") {
    throw new HttpsError(
      "failed-precondition",
      `${category} adverts require an active Premium plan.`
    );
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

  // 3b. Validation: every image must have actually come through the
  // signed upload flow (getCloudinarySignature -> attachDraftUploadImage,
  // now awaited client-side), not be arbitrary client-supplied URLs/
  // public_ids. Cross-check each public_id against the draft this
  // session already recorded as belonging to this uploader.
  if (imageUrls.length > 0) {
    if (typeof draftId !== "string" || !draftId.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "Missing upload session for the submitted photos."
      );
    }

    const draftSnap = await draftSnapPromise;
    if (!draftSnap || !draftSnap.exists || draftSnap.data()?.uid !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Invalid upload session for the submitted photos."
      );
    }

    const verifiedPublicIds: string[] = Array.isArray(draftSnap.data()?.publicIds)
      ? draftSnap.data()!.publicIds
      : [];
    const verifiedSet = new Set(verifiedPublicIds);

    for (const image of imageUrls) {
      const publicId = typeof image === "object" && image !== null ? image.public_id : undefined;
      if (typeof publicId !== "string" || !verifiedSet.has(publicId)) {
        throw new HttpsError(
          "permission-denied",
          "One or more photos were not uploaded through the app and cannot be used."
        );
      }
    }
  }

  // 4. Logic: Active Ad Limit Enforcement (applies to every plan
  // except the master admin, who has no cap — "unlimited posts").
  if (!isMasterAdmin) {
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
  }

  // 5. Logic: Status Determination
  // Paid plans start as 'pending_payment'; Free plans start as 'active'
  // Master admin adverts are always active immediately — never
  // gated on payment, regardless of which plan was selected.
  const status =
    isMasterAdmin || effectivePlan === "free" || hasActiveSubscription
      ? "active"
      : "pending_payment";

  // Visibility scope is derived server-side from the verified plan —
  // never trusted from the client. Free stays local-radius (2.5km);
  // premium gets wider area-based reach, capped at the feed's
  // HOME_FEED_MAX_RADIUS_KM (30km) — never countywide or nationwide.
  // Master admin adverts broadcast everywhere, not just within the
  // normal free (ward) / premium (30km) reach.
  const visibilityScope = isMasterAdmin
    ? "all_areas"
    : effectivePlan === "free"
      ? "local"
      : "county";

  // 6. Logic: Dynamic Expiry (Only if active immediately)
  // Hotel menu adverts follow the seller's subscription instead of a fixed
  // listing duration — archived (never deleted) when premium lapses,
  // reactivated automatically on renewal (see mpesaCallback).
  const isHotelMenu = otherData.hotelMenu !== undefined && otherData.hotelMenu !== null;
  const durationDays = LISTING_DURATIONS[effectivePlan] ?? 7;

  let expiresAt: admin.firestore.Timestamp | null = null;
  if (status === "active") {
    if (isMasterAdmin) {
      // Never expires — scheduledCleanup's `where("expiresAt", "<", now)`
      // query excludes documents with no expiresAt value, so this is
      // never auto-archived. Delete manually if it should come down.
      expiresAt = null;
    } else if (isHotelMenu && hasActiveSubscription) {
      expiresAt = userSnap.data()?.premiumEndsAt
        ?? admin.firestore.Timestamp.fromDate(new Date(Date.now() + durationDays * 86_400_000));
    } else {
      expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + durationDays * 86_400_000));
    }
  }

  // 7. Save Ad — explicitly allowlist every field instead of
  // spreading otherData, so a malicious client can't inject
  // unexpected fields (e.g. verified, isPremium, visibilityScope).
  let newProductRef: FirebaseFirestore.DocumentReference | null = null;
  let reusingExisting = false;

  if (typeof existingProductId === "string" && existingProductId.trim()) {
    const existingRef = db.collection("products").doc(existingProductId);
    const existingSnap = await existingRef.get();
    if (
      existingSnap.exists &&
      existingSnap.data()?.sellerId === uid &&
      existingSnap.data()?.status === "pending_payment"
    ) {
      newProductRef = existingRef;
      reusingExisting = true;
    }
  }

// Validated server-side — never trust the client's affiliate object as-is.
const affiliate = sanitizeAffiliate(otherData, price, effectivePlan, isMasterAdmin);

try {
  const productPayload = {
    affiliate,
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

    lat: submittedLat,
    lng: submittedLng,

    ward: resolvedLocation.wardName,
    constituency: resolvedLocation.constituency,
    county: resolvedLocation.county,

    geohash: resolvedLocation.geohash,

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
    eventDetails: otherData.eventDetails ?? null,

    plan: effectivePlan,
    visibilityScope,
    ownerId: uid,
    sellerId: uid,
    status,
    expiringNotified: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    pendingPaymentStartedAt: status === "pending_payment"
      ? admin.firestore.FieldValue.serverTimestamp()
      : null,
  };

  if (reusingExisting && newProductRef) {
    await newProductRef.update(productPayload);
  } else {
    newProductRef = await db.collection("products").add(productPayload);
  }

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

// 8. Mark the draft upload as claimed, if one was tracked — doesn't
// need to complete before returning; the response to the user isn't
// affected by whether this write has landed yet.
  if (typeof draftId === "string") {
    db.collection("draftUploads").doc(draftId).update({ claimed: true }).catch(() => {});
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

    export const publishAdvertAndPay = onCall({ region: "europe-west1", secrets: [mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey], cors: true, maxInstances: 10, timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { plan, title, price, imageUrls, draftId, productId: existingProductId, phone, ...otherData } = request.data;
  const uid = request.auth.uid;

  // Kick off the Daraja OAuth fetch immediately, in parallel with
  // everything below — by the time sendDarajaStkPush runs later,
  // the token is usually already cached (getDarajaToken checks its
  // own module-level cache first), instead of adding its own
  // round-trip on top of all the validation/creation work.
  const earlyDarajaTokenPromise = getDarajaToken(
    mpesaConsumerKey.value(),
    mpesaConsumerSecret.value()
  ).catch((err) => {
    console.error("Early Daraja token prefetch failed (STK push will retry):", err);
  });

  const draftSnapPromise =
    typeof draftId === "string" && draftId.trim()
      ? db.collection("draftUploads").doc(draftId).get()
      : Promise.resolve(null);

  const submittedLat = typeof otherData.lat === "number" ? otherData.lat : null;
  const submittedLng = typeof otherData.lng === "number" ? otherData.lng : null;

  if (submittedLat === null || submittedLng === null) {
    throw new HttpsError("invalid-argument", "A location is required to publish an advert.");
  }

  const resolvedLocation = resolveWardServerSide(submittedLat, submittedLng);
  if (!resolvedLocation) {
    throw new HttpsError(
      "failed-precondition",
      "We couldn't match this location to a known ward. Please pick your area manually and try again."
    );
  }

  const userSnap = await db.collection("users").doc(uid).get();

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

    // Master admin posts are unrestricted: no active-ad-count cap, no
// payment requirement, and always broadcast to every viewer
// (visibilityScope "all_areas"), regardless of chosen plan.
const isMasterAdmin = uid === OWNER_UID;

  const category = typeof otherData.category === "string" ? otherData.category : "";
  if (PREMIUM_ONLY_CATEGORIES.includes(category) && effectivePlan === "free") {
    throw new HttpsError("failed-precondition", `${category} adverts require an active Premium plan.`);
  }

  if (!PLAN_AMOUNTS.hasOwnProperty(effectivePlan)) {
    throw new HttpsError("invalid-argument", "Invalid plan selected.");
  }

  if (!title || price === undefined || price === null || !Array.isArray(imageUrls)) {
    throw new HttpsError("invalid-argument", "Missing required product details.");
  }

  const limit = MAX_PHOTO_LIMIT[effectivePlan] ?? 0;
  if (imageUrls.length > limit) {
    throw new HttpsError("failed-precondition", `Your plan allows a maximum of ${limit} photos.`);
  }

  if (imageUrls.length > 0) {
    if (typeof draftId !== "string" || !draftId.trim()) {
      throw new HttpsError("invalid-argument", "Missing upload session for the submitted photos.");
    }

    const draftSnap = await draftSnapPromise;
    if (!draftSnap || !draftSnap.exists || draftSnap.data()?.uid !== uid) {
      throw new HttpsError("permission-denied", "Invalid upload session for the submitted photos.");
    }

    const verifiedPublicIds: string[] = Array.isArray(draftSnap.data()?.publicIds)
      ? draftSnap.data()!.publicIds
      : [];
    const verifiedSet = new Set(verifiedPublicIds);

    for (const image of imageUrls) {
      const publicId = typeof image === "object" && image !== null ? image.public_id : undefined;
      if (typeof publicId !== "string" || !verifiedSet.has(publicId)) {
        throw new HttpsError(
          "permission-denied",
          "One or more photos were not uploaded through the app and cannot be used."
        );
      }
    }
  }

  // Master admin posts are unrestricted: no active-ad-count cap —
  // matches the same isMasterAdmin gate already applied in publishAdvert.
  if (!isMasterAdmin) {
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
  }

  // Master admin adverts are always active immediately — never
  // gated on payment, regardless of which plan was selected.
  const status =
    isMasterAdmin || effectivePlan === "free" || hasActiveSubscription
      ? "active"
      : "pending_payment";

  // Master admin adverts broadcast everywhere, not just within the
  // normal free (ward) / premium (30km) reach.
  const visibilityScope = isMasterAdmin
    ? "all_areas"
    : effectivePlan === "free"
      ? "local"
      : "county";

  const isHotelMenu = otherData.hotelMenu !== undefined && otherData.hotelMenu !== null;
  const durationDays = LISTING_DURATIONS[effectivePlan] ?? 7;

  let expiresAt: admin.firestore.Timestamp | null = null;
  if (status === "active") {
    if (isMasterAdmin) {
      // Never expires — scheduledCleanup's `where("expiresAt", "<", now)`
      // query excludes documents with no expiresAt value, so this is
      // never auto-archived. Delete manually if it should come down.
      expiresAt = null;
    } else if (isHotelMenu && hasActiveSubscription) {
      expiresAt = userSnap.data()?.premiumEndsAt
        ?? admin.firestore.Timestamp.fromDate(new Date(Date.now() + durationDays * 86_400_000));
    } else {
      expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + durationDays * 86_400_000));
    }
  }

  let newProductRef: FirebaseFirestore.DocumentReference | null = null;
  let reusingExisting = false;

  if (typeof existingProductId === "string" && existingProductId.trim()) {
    const existingRef = db.collection("products").doc(existingProductId);
    const existingSnap = await existingRef.get();
    if (
      existingSnap.exists &&
      existingSnap.data()?.sellerId === uid &&
      existingSnap.data()?.status === "pending_payment"
    ) {
      newProductRef = existingRef;
      reusingExisting = true;
    }
  }

    // Validated server-side — never trust the client's affiliate object as-is.
  const affiliate = sanitizeAffiliate(otherData, price, effectivePlan, isMasterAdmin);

  try {
    const productPayload = {
      affiliate,
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

      lat: submittedLat,
      lng: submittedLng,

      ward: resolvedLocation.wardName,
      constituency: resolvedLocation.constituency,
      county: resolvedLocation.county,

      geohash: resolvedLocation.geohash,

      sellerName: typeof otherData.sellerName === "string" ? otherData.sellerName : "",
      sellerType: otherData.sellerType === "business" ? "business" : "individual",

      priceDisplay: typeof otherData.priceDisplay === "string" ? otherData.priceDisplay : "fixed",
      pricingBasis: typeof otherData.pricingBasis === "string" ? otherData.pricingBasis : null,

      hotelMenu: otherData.hotelMenu ?? null,
      eateryPayment: otherData.eateryPayment ?? null,
      priceList: Array.isArray(otherData.priceList) ? otherData.priceList : null,
      phone: typeof phone === "string" ? phone : "",

      jobDetails: otherData.jobDetails ?? null,
      vehicleDetails: otherData.vehicleDetails ?? null,
      serviceDetails: otherData.serviceDetails ?? null,
      accommodationDetails: otherData.accommodationDetails ?? null,
      commercialPropertyDetails: otherData.commercialPropertyDetails ?? null,
      eventDetails: otherData.eventDetails ?? null,

      plan: effectivePlan,
      visibilityScope,
      ownerId: uid,
      sellerId: uid,
      status,
      expiringNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      pendingPaymentStartedAt: status === "pending_payment"
        ? admin.firestore.FieldValue.serverTimestamp()
        : null,
    };

    if (reusingExisting && newProductRef) {
      await newProductRef.update(productPayload);
    } else {
      newProductRef = await db.collection("products").add(productPayload);
    }
  } catch (error) {
    for (const image of imageUrls) {
      if (image?.public_id) {
        await deleteCloudinaryImage(image.public_id);
      }
    }
    console.error("Advert creation failed:", error);
    throw new HttpsError("internal", "Failed to create advert.");
  }

  if (typeof draftId === "string") {
    db.collection("draftUploads").doc(draftId).update({ claimed: true }).catch(() => {});
  }

  if (status !== "pending_payment") {
    return {
      success: true,
      productId: newProductRef.id,
      status,
      requiresPayment: false,
      paymentInitiated: false,
      plan: effectivePlan,
    };
  }

  // Product is created and committed — from here on, NEVER throw.
  // A payment-initiation failure must still return the productId so
  // the client can retry against the same product instead of
  // creating a duplicate on retry.
  try {
    const formattedPhone = normalizePhone(typeof phone === "string" ? phone : "");
    const stkResult = await sendDarajaStkPush(formattedPhone, effectivePlan, newProductRef.id, mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey);

    await db.collection("payments").doc(stkResult.checkoutRequestId).set({
      checkoutRequestId: stkResult.checkoutRequestId,
      callbackTokenHash: stkResult.callbackTokenHash,
      plan: effectivePlan,
      productId: newProductRef.id,
      buyerId: uid,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      productId: newProductRef.id,
      status,
      requiresPayment: true,
      paymentInitiated: true,
      checkoutRequestId: stkResult.checkoutRequestId,
      customerMessage: stkResult.customerMessage,
      plan: effectivePlan,
    };
  } catch (err) {
    console.error("Payment initiation failed inside publishAdvertAndPay:", err);
    return {
      success: true,
      productId: newProductRef.id,
      status,
      requiresPayment: true,
      paymentInitiated: false,
      paymentError: err instanceof Error ? err.message : "Payment could not be started.",
      plan: effectivePlan,
    };
  }
});
 

export const deleteAdvert = onCall({ region: "europe-west1", cors: true, secrets: [cloudinaryApiKey, cloudinaryApiSecret, cloudinaryCloudName] }, async (request) => {
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

  // 2. Delete associated chats and their messages (avoid ghost chats
  // and orphaned message subcollections — recursiveDelete removes both).
  const chatQuery = await db.collection("chats").where("productId", "==", productId).get();
  for (const chatDoc of chatQuery.docs) {
    await db.recursiveDelete(chatDoc.ref);
  }

  // 3. Delete the advert
  await productRef.delete();

  return { success: true, message: "Advert and associated data removed." };
});

/**
 * Renews an existing advert (active, expired, or archived) by moving
 * it into pending_payment so initiateMpesaPayment's precondition
 * passes, then recording the plan being paid for. On successful
 * payment, processCompletedPayment reactivates it exactly as it
 * would a fresh paid listing — same status/expiresAt/subscription
 * logic, no special-casing needed there.
 */
export const renewAdvert = onCall({ region: "europe-west1", cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { productId, plan } = request.data as {
    productId?: string;
    plan?: string;
  };

  if (typeof productId !== "string" || !productId.trim()) {
    throw new HttpsError("invalid-argument", "Product ID is required.");
  }
  if (plan !== "premium_weekly" && plan !== "premium_monthly") {
    throw new HttpsError("invalid-argument", "Renewal requires a premium plan.");
  }

  const uid = request.auth.uid;
  const productRef = db.collection("products").doc(productId);
  const productSnap = await productRef.get();

  if (!productSnap.exists) {
    throw new HttpsError(
      "not-found",
      "This listing has expired permanently and can no longer be renewed. Please post a new advert."
    );
  }

  const productData = productSnap.data()!;

  if (productData.sellerId !== uid) {
    throw new HttpsError("permission-denied", "You can only renew your own adverts.");
  }

  if (productData.status === "pending_payment") {
    // Don't trust this status blindly — a previous attempt may have
    // already failed, been cancelled, or never received a callback
    // at all, none of which currently reverts this field. Check the
    // most recent payment attempt for this product and only block if
    // one is genuinely still in flight.
    const latestPaymentSnap = await db.collection("payments")
      .where("productId", "==", productId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    const latestPayment = latestPaymentSnap.docs[0]?.data();
    const STALE_PENDING_MS = 5 * 60 * 1000; // Safaricom's own STK window is far shorter than this
    const stillGenuinelyPending =
      latestPayment?.status === "pending" &&
      latestPayment?.createdAt &&
      Date.now() - latestPayment.createdAt.toMillis() < STALE_PENDING_MS;

    if (stillGenuinelyPending) {
      throw new HttpsError(
        "failed-precondition",
        "A payment is already in progress for this advert."
      );
    }
    // Otherwise: safe to let the user try again below.
  }

  // If the seller already has an active premium subscription, this
  // specific listing is covered by it — reactivate directly, no
  // payment, no STK push. Never reactivate anything else; this only
  // touches the one product the user explicitly chose to renew.
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : null;
  const hasActiveSubscription =
    !!userData?.subscriptionPlan &&
    !!userData?.premiumEndsAt &&
    userData.premiumEndsAt.toDate() > new Date();

  if (hasActiveSubscription) {
    const durationDays = LISTING_DURATIONS[userData!.subscriptionPlan] ?? 7;
    await productRef.update({
      status: "active",
      plan: userData!.subscriptionPlan,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + durationDays * 86_400_000)
      ),
    });
    return { success: true, requiresPayment: false };
  }

  // No active subscription — proceed to payment as before. Record
  // what to revert to (and when this attempt started), so a stuck
  // or abandoned renewal can be safely recovered by cleanup instead
  // of being force-deleted.
  await productRef.update({
    status: "pending_payment",
    plan,
    previousStatus: productData.status,
    pendingPaymentStartedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, requiresPayment: true };
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

  // Delete associated application chats and their messages (avoid ghost
  // chats and orphaned message subcollections)
  const chatQuery = await db.collection("chats").where("jobId", "==", jobId).get();
  for (const chatDoc of chatQuery.docs) {
    await db.recursiveDelete(chatDoc.ref);
  }

  await jobRef.delete();

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

  await cooldownRef.set({
  lastReportedAt: admin.firestore.FieldValue.serverTimestamp(),
  expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)),
});
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

  await cooldownRef.set({
  lastReportedAt: admin.firestore.FieldValue.serverTimestamp(),
  expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)),
});

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
await cooldownRef.set({
  lastReportedAt: admin.firestore.FieldValue.serverTimestamp(),
  expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)),
});

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
// 5C. PASSWORD RESET (PHONE OTP)
// ═══════════════════════════════════════════════════════════════════════════
// Flow: client verifies phone ownership via Firebase Phone Auth (SMS OTP)
// client-side, which signs them into a temporary/ephemeral phone-auth
// session. That session's ID token carries a verified `phone_number`
// claim. This function trusts that claim, looks up the REAL account (the
// one created via the synthetic-email trick at signup) by phone number,
// and resets ITS password using the Admin SDK — the ephemeral phone-auth
// session is a proof-of-ownership mechanism only, not the account itself.

const PHONE_AUTH_DOMAIN = "bizmtaani.local"; // must match phoneIdentity.ts exactly

function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^(07|01)\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^(7|1)\d{8}$/.test(digits)) return "254" + digits;
  return null;
}

export const resetPasswordViaPhoneOtp = onCall(async (request) => {
  const { auth: callerAuth, data } = request;

  if (!callerAuth) {
    throw new HttpsError(
      "unauthenticated",
      "You must verify your phone number first."
    );
  }

  // Firebase sets this claim only when the caller signed in via a verified
  // phone-auth SMS OTP — this is the actual proof, not something the
  // client can fake by just passing a phone number in `data`.
  const verifiedPhone = callerAuth.token.phone_number as string | undefined;
  if (!verifiedPhone) {
    throw new HttpsError(
      "failed-precondition",
      "This request wasn't made with a phone-verified session."
    );
  }

  const newPassword = (data?.newPassword ?? "") as string;
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    throw new HttpsError(
      "invalid-argument",
      "Password must be at least 6 characters."
    );
  }

  const normalizedPhone = normalizeKenyanPhone(verifiedPhone);
  if (!normalizedPhone) {
    throw new HttpsError(
      "failed-precondition",
      "Could not read a valid phone number from the verification."
    );
  }

  const syntheticEmail = `${normalizedPhone}@${PHONE_AUTH_DOMAIN}`;

  let targetUser;
  try {
    targetUser = await admin.auth().getUserByEmail(syntheticEmail);
  } catch {
    throw new HttpsError(
      "not-found",
      "No BizMtaani account is registered with this phone number."
    );
  }

  await admin.auth().updateUser(targetUser.uid, { password: newPassword });

  // Clean up the ephemeral phone-auth account created just to prove
  // ownership — it's a throwaway verification artifact, not a real
  // account, and shouldn't accumulate in the Auth user list.
  if (callerAuth.uid !== targetUser.uid) {
    admin.auth().deleteUser(callerAuth.uid).catch(() => {});
  }

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
// 7. REFERRALS — MARKETER COMMISSIONS
// ═══════════════════════════════════════════════════════════════════════════
/**

 * Atomically reserves a referral code by creating a
 * referralCodes/{CODE} doc inside a transaction — the transaction
 * only succeeds if that doc doesn't already exist, so two concurrent
 * approveMarketer calls can never both win the same code. Throws
 * after maxAttempts instead of silently falling through to a
 * duplicate, unlike the old query-then-write approach.
 */
async function reserveReferralCode(uid: string, name: string): Promise<string> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateReferralCode(name, uid);
    const codeRef = db.collection("referralCodes").doc(code);
    try {
      const reserved = await db.runTransaction(async (tx) => {
        const codeSnap = await tx.get(codeRef);
        if (codeSnap.exists) return false;
        tx.set(codeRef, {
          marketerUid: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (reserved) return code;
    } catch (err) {
      console.error("Referral code reservation transaction failed:", err);
    }
  }
  throw new HttpsError(
    "resource-exhausted",
    "Could not generate a unique referral code. Please try again."
  );
}

const COMMISSION_RATE = 0.25;

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
  requireAdmin(request);

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
  const marketerRef = db.collection("marketers").doc(uid);
  const existingMarketerSnap = await marketerRef.get();

  let code: string;

  if (existingMarketerSnap.exists && existingMarketerSnap.data()?.referralCode) {
    // Re-approval (e.g. reactivating a suspended marketer, or
    // re-running approval after their application details changed) —
    // NEVER touch their existing code or earnings. A fresh set()
    // here would reset totalEarnedKES/totalWithdrawnKES to 0 and
    // issue a brand-new code, orphaning the one already printed on
    // their flyers/shared publicly.
    code = existingMarketerSnap.data()!.referralCode;

    await marketerRef.set(
      {
        status: "active",
        fullName: applicationData?.fullName ?? fallbackName,
        email: applicationData?.email ?? fallbackEmail,
        idNumber: applicationData?.idNumber ?? existingMarketerSnap.data()?.idNumber ?? "",
        mpesaNumber: applicationData?.mpesaNumber ?? existingMarketerSnap.data()?.mpesaNumber ?? "",
      },
      { merge: true }
    );
  } else {
    // New marketer — reserve a genuinely unique code via the
    // transactional lock, throwing rather than silently writing a
    // clash if every attempt is taken.
    code = await reserveReferralCode(uid, marketerName);

    await marketerRef.set({
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
  }

  // Mark the application as approved, if it exists, so it doesn't
  // show up as pending anywhere and its data stays as a record.
  if (applicationSnap.exists) {
    await applicationSnap.ref.update({ status: "approved" });
  }

  await sendPushToUid(
    uid,
    "You're approved as a Brand Ambassador! 🎉",
    `Your referral code is ${code}. Start sharing it to earn commissions.`,
    { type: "marketer_approved", referralCode: code }
  );

  await logAdminAction(request.auth.uid, "approve_brand_ambassador", { targetUid: uid, referralCode: code });

  return { success: true, referralCode: code };
});

      /**
 * Admin-only: suspend or reactivate a marketer. Suspending stops
 * their referral code from being usable (submitReferralCode only
 * matches marketers with status == "active") without deleting their
 * earnings history.
 */
export const setMarketerStatus = onCall({ cors: true }, async (request) => {
  requireAdmin(request);

  const { uid, status } = request.data as { uid?: string; status?: string };
  if (!uid) throw new HttpsError("invalid-argument", "A marketer UID is required.");
  if (status !== "active" && status !== "suspended") {
    throw new HttpsError("invalid-argument", "status must be 'active' or 'suspended'.");
  }

  const marketerRef = db.collection("marketers").doc(uid);
  const marketerSnap = await marketerRef.get();
  if (!marketerSnap.exists) {
    throw new HttpsError("not-found", "Marketer not found.");
  }

  await marketerRef.update({ status });

  await logAdminAction(
    request.auth.uid,
    status === "suspended" ? "suspend_brand_ambassador" : "reactivate_brand_ambassador",
    { targetUid: uid }
  );

  return { success: true, status };
});

 export const getMyReferrals = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const referralsSnap = await db.collection("referrals")
    .where("marketerUid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const referralDocs = referralsSnap.docs;
  const referredUids = referralDocs.map((d) => d.id);
  const userDataMap = new Map<string, FirebaseFirestore.DocumentData>();

  for (let i = 0; i < referredUids.length; i += 30) {
    const chunk = referredUids.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const chunkSnap = await db.collection("users")
      .where(admin.firestore.FieldPath.documentId(), "in", chunk)
      .get();
    chunkSnap.docs.forEach((d) => userDataMap.set(d.id, d.data()));
  }

  const referrals = referralDocs.map((docSnap) => {
    const data = docSnap.data();
    const userData = userDataMap.get(docSnap.id) ?? null;
    const isPremium = !!(userData?.premiumEndsAt && userData.premiumEndsAt.toDate() > new Date());

    return {
      uid: docSnap.id,
      displayName: userData?.displayName ?? "Unknown",
      joinedAt: data.createdAt ?? null,
      commissionPaidOut: data.commissionPaidOut ?? false,
      isPremium,
    };
  });

  return { referrals };
});

/**
 * Called when a user submits a referral code (e.g. from Profile).
 * Determines whether it's a marketer code or another user's own code,
 * and records the relationship. A user can only be referred once, ever.
 */
export const submitReferralCode = onCall({ cors: true, }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { code } = request.data as { code?: string };
  if (!code || typeof code !== "string") {
    throw new HttpsError("invalid-argument", "A referral code is required.");
  }

  const uid = request.auth.uid;
  const trimmedCode = code.trim().toUpperCase();

  // A user cannot be referred twice.
  const existingReferral = await db.collection("referrals").doc(uid).get();
  if (existingReferral.exists) {
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
export const applyForMarketer = onCall({ cors: true, }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const uid = request.auth.uid;

  // Already a marketer — no need to apply again.

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
    throw new HttpsError("invalid-argument", "Please tell us why you want to be a Brand Ambassador.");
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
  requireAdmin(request);


  const { uid } = request.data as { uid?: string };
  if (!uid) throw new HttpsError("invalid-argument", "A user UID is required.");

  await db.collection("marketerApplications").doc(uid).update({
    status: "rejected",
  });

  await sendPushToUid(
    uid,
    "Brand Ambassador application update",
    "Your Brand Ambassador application wasn't approved this time. Contact support if you'd like to know more.",
    { type: "marketer_rejected" }
  );

  await logAdminAction(request.auth.uid, "reject_brand_ambassador_application", { targetUid: uid });

  return { success: true };
});

    export * from "./backfillVisibilityScope";

export const backfillMissingCreatedAt = onCall({ cors: true }, async (request) => {
  requireAdmin(request);

  const snap = await db.collection("products").get();
  const batch = db.batch();
  let fixedCount = 0;

  snap.docs.forEach((doc) => {
    const data = doc.data();
    if (!data.createdAt) {
      // No original timestamp to recover — best available fallback is
      // "now", which is far better than the doc being invisible to
      // any orderBy("createdAt") query forever.
      batch.update(doc.ref, { createdAt: admin.firestore.FieldValue.serverTimestamp() });
      fixedCount++;
    }
  });

  if (fixedCount > 0) await batch.commit();

  return { success: true, fixedCount, totalChecked: snap.size };
});
// ═══════════════════════════════════════════════════════════════════════════
// 8. SITEMAP (served at /sitemap.xml via a Vercel rewrite)
// ═══════════════════════════════════════════════════════════════════════════
const SITEMAP_SITE_URL = "https://www.bizmtaani.site";
const SITEMAP_MAX_URLS = 45_000; // hard protocol limit is 50,000
const SITEMAP_PAGE = 1000;
const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000;
let _sitemapCache: { xml: string; timestamp: number } | null = null;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sitemapEntry(path: string, lastmod?: Date | null): string {
  const lastmodTag = lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : "";
  return `<url><loc>${xmlEscape(SITEMAP_SITE_URL + path)}</loc>${lastmodTag}</url>`;
}

// Pages through every active doc in a collection, fetching only the
// fields the sitemap needs (cheaper than full documents).
async function forEachActiveDoc(
  collectionName: string,
  fields: string[],
  visit: (doc: FirebaseFirestore.QueryDocumentSnapshot) => boolean | void
): Promise<void> {
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q: FirebaseFirestore.Query = db
      .collection(collectionName)
      .where("status", "==", "active")
      .orderBy(admin.firestore.FieldPath.documentId())
      .select(...fields)
      .limit(SITEMAP_PAGE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) {
      if (visit(d) === false) return;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < SITEMAP_PAGE) return;
  }
}

async function forEachActiveLandingPage(
  visit: (doc: FirebaseFirestore.QueryDocumentSnapshot) => boolean | void
): Promise<void> {
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q: FirebaseFirestore.Query = db
      .collection("landingPages")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(SITEMAP_PAGE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) {
      if (visit(d) === false) return;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < SITEMAP_PAGE) return;
  }
}

export const sitemap = onRequest(
  { region: "europe-west1", maxInstances: 3, memory: "512MiB", timeoutSeconds: 120 },
  async (_req, res) => {
    try {
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.set("Cache-Control", "public, max-age=300, s-maxage=3600");

      if (_sitemapCache && Date.now() - _sitemapCache.timestamp < SITEMAP_CACHE_TTL_MS) {
        res.status(200).send(_sitemapCache.xml);
        return;
      }

      const entries: string[] = [
        sitemapEntry("/"),
        sitemapEntry("/jobs"),
        sitemapEntry("/about"),
        sitemapEntry("/privacy"),
        sitemapEntry("/terms"),
      ];
      const nowSec = Date.now() / 1000;
      const sellerIds = new Set<string>();

      // Active, unexpired adverts. Master-admin adverts have no
      // expiresAt and are always included.
      await forEachActiveDoc("products", ["createdAt", "expiresAt", "sellerId"], (d) => {
        if (entries.length >= SITEMAP_MAX_URLS) return false;
        const data = d.data();
        if (data.expiresAt && data.expiresAt.seconds <= nowSec) return;
        entries.push(sitemapEntry(`/product/${d.id}`, data.createdAt?.toDate?.() ?? null));
        if (typeof data.sellerId === "string") sellerIds.add(data.sellerId);
      });

      // Active jobs whose deadline (YYYY-MM-DD) hasn't passed.
      const today = new Date().toISOString().slice(0, 10);
      await forEachActiveDoc("jobs", ["createdAt", "deadline"], (d) => {
        if (entries.length >= SITEMAP_MAX_URLS) return false;
        const data = d.data();
        if (typeof data.deadline === "string" && data.deadline < today) return;
        entries.push(sitemapEntry(`/jobs/${d.id}`, data.createdAt?.toDate?.() ?? null));
      });

      // Ward+category landing pages — only ones with at least one
      // live listing exist in this collection at all (see the
      // landingPages triggers above), so no extra filtering needed.
      await forEachActiveLandingPage((d) => {
        if (entries.length >= SITEMAP_MAX_URLS) return false;
        const data = d.data();
        entries.push(
          sitemapEntry(
            `/${data.countySlug}/${data.wardSlug}/${data.categorySlug}`,
            data.updatedAt?.toDate?.() ?? null
          )
        );
      });

      // Shop pages for sellers with at least one live advert.
      for (const sellerId of sellerIds) {
        if (entries.length >= SITEMAP_MAX_URLS) break;
        entries.push(sitemapEntry(`/shop/${sellerId}`));
      }

      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        entries.join("\n") +
        `\n</urlset>`;

      _sitemapCache = { xml, timestamp: Date.now() };
      res.status(200).send(xml);
    } catch (error) {
      console.error("Sitemap generation failed:", error);
      res.status(500).send("Sitemap temporarily unavailable.");
    }
  }
);
// ═══════════════════════════════════════════════════════════════════════════
// 10. SOCIAL SHARE PREVIEW (Facebook/WhatsApp/Twitter crawlers only)
//
// Facebook's crawler (and WhatsApp's, which reuses it) never runs
// JavaScript, so it can't see the per-page meta tags usePageMeta()
// sets client-side — it only reads whatever is already in the raw
// HTML response. This endpoint serves THOSE crawlers a minimal,
// pre-rendered page with the real product's title/image/url baked
// in as static tags. Real visitors never see this — they're routed
// to the normal React app (see the vercel.json change below).
// ═══════════════════════════════════════════════════════════════════════════
const SHARE_SITE_URL = "https://www.bizmtaani.site";

function shareHtmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shareDetailImageUrl(url: string): string {
  if (url && url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_1200,c_limit/");
  }
  return url;
}

export const productShareMeta = onRequest(
  { region: "europe-west1", maxInstances: 20 },
  async (req, res) => {
    const productId = req.path.split("/").filter(Boolean).pop() ?? "";
    const pageUrl = `${SHARE_SITE_URL}/product/${productId}`;

    let title = "BizMtaani — Buy, Sell & Find Jobs Near You in Kenya";
    let description = "Browse local adverts, services, and jobs on BizMtaani.";
    let image = `${SHARE_SITE_URL}/bizmtaani-icon.png`;

    try {
      const snap = await db.collection("products").doc(productId).get();
      const data = snap.exists ? snap.data() : null;

      if (data && (!data.status || data.status === "active")) {
        const place = data.areaLabel || data.ward || data.county || "Kenya";
        title = `${String(data.title ?? "").slice(0, 60)} in ${place} | BizMtaani`;

        const cleanDescription = String(data.description ?? "").replace(/\s+/g, " ").trim();
        description = cleanDescription
          ? cleanDescription.slice(0, 155)
          : `${data.subcategory ?? data.category ?? ""} in ${place}. Chat with the seller on BizMtaani.`;

        const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
        const firstImage = imageUrls[0];
        const rawImage =
          (typeof firstImage === "string" ? firstImage : firstImage?.url) || data.imageUrl || "";
        if (rawImage) image = shareDetailImageUrl(rawImage);
      }
    } catch (error) {
      console.error(`productShareMeta failed for ${productId}:`, error);
      // Falls through to the generic BizMtaani preview set above.
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${shareHtmlEscape(title)}</title>
<meta property="og:type" content="product" />
<meta property="og:title" content="${shareHtmlEscape(title)}" />
<meta property="og:description" content="${shareHtmlEscape(description)}" />
<meta property="og:image" content="${shareHtmlEscape(image)}" />
<meta property="og:url" content="${shareHtmlEscape(pageUrl)}" />
<meta property="og:site_name" content="BizMtaani" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${shareHtmlEscape(title)}" />
<meta name="twitter:description" content="${shareHtmlEscape(description)}" />
<meta name="twitter:image" content="${shareHtmlEscape(image)}" />
<link rel="canonical" href="${shareHtmlEscape(pageUrl)}" />
</head>
<body>
<p>If you're not redirected, <a href="${shareHtmlEscape(pageUrl)}">view this advert on BizMtaani</a>.</p>
</body>
</html>`;

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, s-maxage=3600");
    res.status(200).send(html);
  }
);
// ═══════════════════════════════════════════════════════════════════════════
// 11. JOB SHARE PREVIEW (Facebook/WhatsApp/Twitter crawlers only)
// Same purpose as productShareMeta above, for /jobs/:id instead.
// ═══════════════════════════════════════════════════════════════════════════

export const jobShareMeta = onRequest(
  { region: "europe-west1", maxInstances: 20 },
  async (req, res) => {
    const jobId = req.path.split("/").filter(Boolean).pop() ?? "";
    const pageUrl = `${SHARE_SITE_URL}/jobs/${jobId}`;

    let title = "BizMtaani — Buy, Sell & Find Jobs Near You in Kenya";
    let description = "Browse local jobs and gigs on BizMtaani.";
    const image = `${SHARE_SITE_URL}/bizmtaani-icon.png`;

    try {
      const snap = await db.collection("jobs").doc(jobId).get();
      const data = snap.exists ? snap.data() : null;

      const isExpired =
        typeof data?.deadline === "string" &&
        new Date(`${data.deadline}T23:59:59`) < new Date();

      if (data && (!data.status || data.status === "active") && !isExpired) {
        const place = data.areaLabel || data.ward || data.county || "Kenya";
        title = `${String(data.title ?? "").slice(0, 60)} at ${data.company ?? "BizMtaani"} | BizMtaani`;

        const cleanDescription = String(data.description ?? "").replace(/\s+/g, " ").trim();
        description = cleanDescription
          ? cleanDescription.slice(0, 155)
          : `${data.jobType ?? ""} ${data.category ?? ""} role at ${data.company ?? ""}, ${place}. Apply on BizMtaani.`;
      }
    } catch (error) {
      console.error(`jobShareMeta failed for ${jobId}:`, error);
      // Falls through to the generic BizMtaani preview set above.
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${shareHtmlEscape(title)}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${shareHtmlEscape(title)}" />
<meta property="og:description" content="${shareHtmlEscape(description)}" />
<meta property="og:image" content="${shareHtmlEscape(image)}" />
<meta property="og:url" content="${shareHtmlEscape(pageUrl)}" />
<meta property="og:site_name" content="BizMtaani" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${shareHtmlEscape(title)}" />
<meta name="twitter:description" content="${shareHtmlEscape(description)}" />
<meta name="twitter:image" content="${shareHtmlEscape(image)}" />
<link rel="canonical" href="${shareHtmlEscape(pageUrl)}" />
</head>
<body>
<p>If you're not redirected, <a href="${shareHtmlEscape(pageUrl)}">view this job on BizMtaani</a>.</p>
</body>
</html>`;

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, s-maxage=3600");
    res.status(200).send(html);
  }
);


// ═══════════════════════════════════════════════════════════════════════════
// 12. MARKETER PROGRAM — "I have a buyer" claims
// An approved marketer taps "I have a buyer" on an advert that is open to
// marketers. This records a timestamped claim (one per marketer per advert)
// and returns the seller's WhatsApp number, so the number is only handed
// out through an accountable, logged action. BizMtaani never handles the
// sale money — the seller pays the marketer's commission directly.
// ═══════════════════════════════════════════════════════════════════════════
const AFFILIATE_MAX_CLAIMS_PER_DAY = 10;

export const createAffiliateClaim = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const { productId, viewingTime } = request.data as {
    productId?: string;
    viewingTime?: string;
  };

  if (typeof productId !== "string" || !productId.trim()) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  const marketerRef = db.collection("marketers").doc(uid);
  const productRef = db.collection("products").doc(productId.trim());

  const [marketerSnap, productSnap] = await Promise.all([marketerRef.get(), productRef.get()]);

  if (!marketerSnap.exists || marketerSnap.data()?.status !== "active") {
    throw new HttpsError("permission-denied", "Only approved marketers can claim a buyer.");
  }
  if (!productSnap.exists) {
    throw new HttpsError("not-found", "Advert not found.");
  }

  const product = productSnap.data()!;

  if (product.status !== "active") {
    throw new HttpsError("failed-precondition", "This advert is no longer active.");
  }
  if (product.affiliate?.enabled !== true) {
    throw new HttpsError("failed-precondition", "This advert is not open to marketers.");
  }
  if (product.sellerId === uid) {
    throw new HttpsError("failed-precondition", "You cannot claim your own advert.");
  }

  // One claim per marketer per advert: the claim id is deterministic, so
  // a repeat tap (or a retry after a network drop) can never duplicate it.
  const claimRef = db.collection("affiliateClaims").doc(`${productRef.id}_${uid}`);

  // Daily cap, tracked on the marketer doc itself (EAT day) so it needs no
  // extra index or query.
  const dayKey = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const cleanViewingTime =
    typeof viewingTime === "string" && viewingTime.trim() ? viewingTime.trim().slice(0, 100) : null;

  let alreadyClaimed = false;

  await db.runTransaction(async (tx) => {
    const [claimSnap, freshMarketerSnap] = await Promise.all([tx.get(claimRef), tx.get(marketerRef)]);

    if (claimSnap.exists) {
      alreadyClaimed = true;
      return;
    }

    const marketerData = freshMarketerSnap.data() ?? {};
    const claimsToday = marketerData.claimsDayKey === dayKey ? (marketerData.claimsToday ?? 0) : 0;

    if (claimsToday >= AFFILIATE_MAX_CLAIMS_PER_DAY) {
      throw new HttpsError(
        "resource-exhausted",
        `You can make up to ${AFFILIATE_MAX_CLAIMS_PER_DAY} claims per day. Try again tomorrow.`
      );
    }

    tx.set(claimRef, {
      advertId: productRef.id,
      advertTitle: typeof product.title === "string" ? product.title.slice(0, 120) : "",
      marketerUid: uid,
      sellerUid: product.sellerId,
      status: "claimed",
      // Snapshot of the commission at claim time, so a later edit to the
      // advert can't change what the marketer was promised.
      affiliate: {
        type: product.affiliate.type ?? null,
        amount: typeof product.affiliate.amount === "number" ? product.affiliate.amount : null,
      },
      viewingTime: cleanViewingTime,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(marketerRef, {
      claimsToday: claimsToday + 1,
      claimsDayKey: dayKey,
      totalClaims: admin.firestore.FieldValue.increment(1),
    });
  });

  // Tell the seller (never blocks or fails the claim).
  if (!alreadyClaimed && typeof product.sellerId === "string") {
    await sendPushToUid(
      product.sellerId,
      "A marketer has a buyer for you 🎉",
      `A marketer says they have a buyer for "${product.title ?? "your advert"}". Expect a WhatsApp message.`,
      { type: "affiliate_claim", productId: productRef.id }
    );
  }

  let sellerPhone: string | null = null;
  try {
    sellerPhone = typeof product.phone === "string" && product.phone.trim()
      ? normalizePhone(product.phone)
      : null;
  } catch {
    sellerPhone = null;
  }

  return {
    success: true,
    claimId: claimRef.id,
    sellerPhone,
    referralCode: marketerSnap.data()?.referralCode ?? "",
    alreadyClaimed,
  };
});
// ═══════════════════════════════════════════════════════════════════════════
// 13. MARKETER PROGRAM — Sold / Occupied marking with marketer tagging
// The seller marks an advert sold (or occupied) and, if a marketer brought
// the buyer, picks that marketer. The pick is the seller's confirmation:
// the claim becomes "confirmed" and counts toward the marketer's record.
// BizMtaani never handles the sale money.
// ═══════════════════════════════════════════════════════════════════════════

// Lists the marketers who tapped "I have a buyer" on one of the caller's
// adverts, so the seller can pick who to credit.
export const getAdvertClaims = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const { productId } = request.data as { productId?: string };
  if (typeof productId !== "string" || !productId.trim()) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  const productSnap = await db.collection("products").doc(productId.trim()).get();
  if (!productSnap.exists || productSnap.data()?.sellerId !== uid) {
    throw new HttpsError("permission-denied", "This is not your advert.");
  }

  const claimsSnap = await db
    .collection("affiliateClaims")
    .where("advertId", "==", productSnap.id)
    .where("sellerUid", "==", uid)
    .limit(20)
    .get();

  const claims = await Promise.all(
    claimsSnap.docs.map(async (c) => {
      const d = c.data();
      let name = "Marketer";
      let referralCode = "";
      try {
        const [mSnap, uSnap] = await Promise.all([
          db.collection("marketers").doc(d.marketerUid).get(),
          db.collection("users").doc(d.marketerUid).get(),
        ]);
        referralCode = mSnap.data()?.referralCode ?? "";
        const u = uSnap.data() ?? {};
        name = u.displayName || u.name || u.fullName || "Marketer";
      } catch {
        // fall back to defaults
      }
      return {
        claimId: c.id,
        marketerName: String(name).slice(0, 60),
        referralCode,
        status: d.status ?? "claimed",
        viewingTime: d.viewingTime ?? null,
        createdAtMs: d.createdAt?.toMillis ? d.createdAt.toMillis() : null,
        affiliate: d.affiliate ?? null,
      };
    })
  );

  claims.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return { claims };
});

// Marks the caller's advert sold/occupied. If claimId is given, that
// marketer is credited (claim -> "confirmed"), all other open claims on
// the advert are closed.
export const markAdvertSold = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const { productId, claimId } = request.data as { productId?: string; claimId?: string | null };
  if (typeof productId !== "string" || !productId.trim()) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  const productRef = db.collection("products").doc(productId.trim());
  let creditedMarketerUid: string | null = null;
  let advertTitle = "";

  await db.runTransaction(async (tx) => {
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists) throw new HttpsError("not-found", "Advert not found.");
    const product = productSnap.data()!;

    if (product.sellerId !== uid) {
      throw new HttpsError("permission-denied", "This is not your advert.");
    }
    if (product.status !== "active") {
      throw new HttpsError("failed-precondition", "Only live adverts can be marked sold.");
    }
    advertTitle = typeof product.title === "string" ? product.title : "";

    const claimsQuery = db
      .collection("affiliateClaims")
      .where("advertId", "==", productRef.id)
      .where("sellerUid", "==", uid)
      .limit(20);
    const claimsSnap = await tx.get(claimsQuery);

    let chosenRef: FirebaseFirestore.DocumentReference | null = null;
    if (claimId) {
      const chosen = claimsSnap.docs.find((c) => c.id === claimId);
      if (!chosen) throw new HttpsError("invalid-argument", "That marketer did not claim this advert.");
      if (chosen.data().status !== "claimed") {
        throw new HttpsError("failed-precondition", "That claim is already settled.");
      }
      chosenRef = chosen.ref;
      creditedMarketerUid = chosen.data().marketerUid as string;
    }

    const marketerRef = creditedMarketerUid ? db.collection("marketers").doc(creditedMarketerUid) : null;
    const marketerSnap = marketerRef ? await tx.get(marketerRef) : null;

    tx.update(productRef, {
      status: "sold",
      soldAt: admin.firestore.FieldValue.serverTimestamp(),
      soldViaMarketer: creditedMarketerUid,
    });

    for (const c of claimsSnap.docs) {
      if (chosenRef && c.ref.path === chosenRef.path) {
        tx.update(c.ref, {
          status: "confirmed",
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (c.data().status === "claimed") {
        tx.update(c.ref, { status: "closed", closedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

    if (marketerRef && marketerSnap?.exists) {
      tx.update(marketerRef, { confirmedSales: admin.firestore.FieldValue.increment(1) });
    }
  });

  if (creditedMarketerUid) {
    await sendPushToUid(
      creditedMarketerUid,
      "Sale confirmed 🎉",
      `The seller confirmed you brought the buyer for "${advertTitle || "an advert"}". Agree payment of your commission with them directly.`,
      { type: "affiliate_confirmed", productId: productRef.id }
    );
  }

  return { success: true, credited: !!creditedMarketerUid };
});
// ═══════════════════════════════════════════════════════════════════════════
// 14. MARKETER PROGRAM — "Seller didn't pay" report
// Only on a claim the seller confirmed, and only after 48 hours.
// ═══════════════════════════════════════════════════════════════════════════
export const reportNonPayment = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const { claimId } = request.data as { claimId?: string };
  if (typeof claimId !== "string" || !claimId.trim()) {
    throw new HttpsError("invalid-argument", "claimId is required.");
  }

  const claimRef = db.collection("affiliateClaims").doc(claimId.trim());
  const snap = await claimRef.get();
  if (!snap.exists || snap.data()?.marketerUid !== uid) {
    throw new HttpsError("permission-denied", "This is not your claim.");
  }
  const claim = snap.data()!;

  if (claim.status !== "confirmed") {
    throw new HttpsError("failed-precondition", "Only confirmed sales can be reported.");
  }
  const confirmedMs = claim.confirmedAt?.toMillis ? claim.confirmedAt.toMillis() : 0;
  if (confirmedMs && Date.now() - confirmedMs < 48 * 60 * 60 * 1000) {
    throw new HttpsError(
      "failed-precondition",
      "Please wait 48 hours after the sale was confirmed before reporting non-payment."
    );
  }

  await claimRef.update({
    status: "disputed",
    disputedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection("nonPaymentReports").add({
    claimId: claimRef.id,
    advertId: claim.advertId ?? null,
    advertTitle: claim.advertTitle ?? "",
    marketerUid: uid,
    sellerUid: claim.sellerUid ?? null,
    affiliate: claim.affiliate ?? null,
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (typeof claim.sellerUid === "string") {
    await sendPushToUid(
      claim.sellerUid,
      "Commission reminder",
      `A marketer says your agreed commission for "${claim.advertTitle || "your advert"}" is still unpaid. Please settle it directly.`,
      { type: "affiliate_nonpayment", productId: String(claim.advertId ?? "") }
    );
  }

  return { success: true };
});
