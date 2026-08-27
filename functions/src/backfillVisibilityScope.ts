/**
 * ONE-OFF MIGRATION — backfillVisibilityScope
 *
 * Run this once, BEFORE deploying the updated useHomeFeed.ts that adds
 * the server-side premium filter for radius stage >= 1.
 *
 * Scans every product in batches, and for any doc missing
 * visibilityScope, sets it based on the same logic
 * getProductVisibilityScope() already uses client-side:
 *   - plan in [premium_weekly, premium_monthly] or isPremium === true
 *       -> visibilityScope = "county"
 *   - otherwise
 *       -> visibilityScope = "local"
 * Idempotent — safe to run more than once, skips docs already set.
 */

import * as crypto from "crypto";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

const backfillAdminKey = defineSecret("BACKFILL_ADMIN_KEY");

const BACKFILL_BATCH_SIZE = 400;

export const backfillVisibilityScope = onRequest(
  {
    secrets: [backfillAdminKey],
    maxInstances: 1,
    timeoutSeconds: 540,
  },
  async (req, res) => {
    const providedKey = Buffer.from(String(req.query.key ?? ""));
    const expectedKey = Buffer.from(backfillAdminKey.value());
    const keyIsValid =
      providedKey.length === expectedKey.length &&
      crypto.timingSafeEqual(providedKey, expectedKey);

    if (!keyIsValid) {
      res.status(403).send("Forbidden");
      return;
    }

    const db = admin.firestore();
    const productsRef = db.collection("products");

    let migrated = 0;
    let scanned = 0;
    let cursorDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const pageQuery = cursorDoc
          ? productsRef.orderBy("__name__").startAfter(cursorDoc).limit(BACKFILL_BATCH_SIZE)
          : productsRef.orderBy("__name__").limit(BACKFILL_BATCH_SIZE);

        const snap = await pageQuery.get();
        if (snap.empty) break;

        const batch = db.batch();
        let batchWrites = 0;

        for (const doc of snap.docs) {
          scanned++;
          const data = doc.data();
          if (data.visibilityScope) continue;

          const isPremium =
            data.plan === "premium_weekly" ||
            data.plan === "premium_monthly" ||
            data.isPremium === true;

          batch.update(doc.ref, {
            visibilityScope: isPremium ? "county" : "local",
          });
          batchWrites++;
          migrated++;
        }

        if (batchWrites > 0) {
          await batch.commit();
        }

        cursorDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < BACKFILL_BATCH_SIZE) break;
      }

      res.status(200).json({ scanned, migrated, done: true });
    } catch (error) {
      console.error("Backfill failed:", error);
      res.status(500).json({ scanned, migrated, done: false, error: String(error) });
    }
  }
);
