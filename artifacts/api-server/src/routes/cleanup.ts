/**
 * Automated cleanup — archives expired listings, permanently deletes archived
 * listings after 3 days, cleans stale pending products, times out old payments.
 *
 * POST /api/cleanup/run — manual trigger (requires x-cron-secret header)
 */
import { Router } from "express";
import admin from "firebase-admin";
import { getFirestore } from "../lib/firebase-admin.js";
import cloudinary from "../lib/cloudinary.js";
import { logger } from "../lib/logger.js";

const router = Router();

function requireCronSecret(req: any, res: any, next: any) {
  if (!process.env.CRON_SECRET || req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  next();
}

async function deleteProductWithImages(docSnap: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = docSnap.data();
  const urls: string[] = data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : []);
  for (const url of urls) {
    try {
      const m = url.match(/\/bizmtaani\/([^/]+)\/([^/.]+)(?:\.[a-z]+)?$/i);
      if (m) await cloudinary.uploader.destroy(`bizmtaani/${m[1]}/${m[2]}`);
    } catch (e) { logger.warn({ e, url }, "Cleanup: image delete failed (non-fatal)"); }
  }
  await docSnap.ref.delete();
}

export async function runCleanup() {
  const db = getFirestore();
  const now = new Date();
  let archived = 0, deleted = 0, stalePending = 0, paymentsCleaned = 0;

  // 1. Move active listings past expiresAt → "archived" (3-day grace before deletion)
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
    logger.info({ archived }, "Cleanup: listings archived");
  } catch (err) { logger.error({ err }, "Cleanup: archive listings failed"); }

  // 2. Permanently delete archived listings older than 3 days + their Cloudinary images
  const cutoff3d = new Date(Date.now() - 3 * 86_400_000);
  try {
    const snap = await db.collection("products")
      .where("status", "==", "archived").where("archivedAt", "<", cutoff3d).limit(200).get();
    for (const docSnap of snap.docs) {
      await deleteProductWithImages(docSnap);
      deleted++;
    }
    logger.info({ deleted }, "Cleanup: archived listings permanently deleted");
  } catch (err) { logger.error({ err }, "Cleanup: delete archived failed"); }

  // 3. Delete pending_payment products older than 24h + their Cloudinary images
  const cutoff24h = new Date(Date.now() - 86_400_000);
  try {
    const snap = await db.collection("products")
      .where("status", "==", "pending_payment").where("createdAt", "<", cutoff24h).limit(200).get();
    for (const docSnap of snap.docs) {
      await deleteProductWithImages(docSnap);
      stalePending++;
    }
    logger.info({ stalePending }, "Cleanup: stale pending listings deleted");
  } catch (err) { logger.error({ err }, "Cleanup: delete pending failed"); }

  // 4. Time out pending payments older than 2h
  const cutoff2h = new Date(Date.now() - 7_200_000);
  try {
    const snap = await db.collection("payments")
      .where("status", "==", "pending").where("createdAt", "<", cutoff2h).limit(500).get();
    if (snap.size > 0) {
      const batch = db.batch();
      snap.docs.forEach((d) => { batch.update(d.ref, { status: "timed_out" }); paymentsCleaned++; });
      await batch.commit();
    }
    logger.info({ paymentsCleaned }, "Cleanup: payments timed out");
  } catch (err) { logger.error({ err }, "Cleanup: payments cleanup failed"); }

  return { archived, deleted, stalePending, paymentsCleaned };
}

router.post("/cleanup/run", requireCronSecret, async (_req: any, res: any) => {
  try {
    res.json({ ok: true, ...(await runCleanup()) });
  } catch (err) {
    logger.error({ err }, "Cleanup route failed");
    res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
