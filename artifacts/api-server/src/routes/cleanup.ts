/**
 * Automated cleanup — expires listings, deletes stale pending products,
 * times out abandoned payments. Scheduled daily from index.ts.
 *
 * POST /api/cleanup/run — manual trigger (requires x-cron-secret header)
 */
import { Router } from "express";
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

export async function runCleanup() {
  const db = getFirestore();
  const now = new Date();
  let expired = 0, deleted = 0, paymentsCleaned = 0;

  // 1. Mark active listings past expiresAt as "expired"
  try {
    const snap = await db.collection("products")
      .where("status", "==", "active").where("expiresAt", "<", now).limit(500).get();
    if (snap.size > 0) {
      const batch = db.batch();
      snap.docs.forEach((d) => { batch.update(d.ref, { status: "expired" }); expired++; });
      await batch.commit();
    }
    logger.info({ expired }, "Cleanup: listings expired");
  } catch (err) { logger.error({ err }, "Cleanup: expire listings failed"); }

  // 2. Delete pending_payment products older than 24h + their Cloudinary images
  const cutoff24h = new Date(Date.now() - 86_400_000);
  try {
    const snap = await db.collection("products")
      .where("status", "==", "pending_payment").where("createdAt", "<", cutoff24h).limit(200).get();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const urls: string[] = data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : []);
      for (const url of urls) {
        try {
          const m = url.match(/\/bizmtaani\/([^/]+)\/([^/.]+)(?:\.[a-z]+)?$/i);
          if (m) await cloudinary.uploader.destroy(`bizmtaani/${m[1]}/${m[2]}`);
        } catch (e) { logger.warn({ e, url }, "Cleanup: image delete failed (non-fatal)"); }
      }
      await docSnap.ref.delete();
      deleted++;
    }
    logger.info({ deleted }, "Cleanup: stale pending listings deleted");
  } catch (err) { logger.error({ err }, "Cleanup: delete pending failed"); }

  // 3. Time out pending payments older than 2h
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

  return { expired, deleted, paymentsCleaned };
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
