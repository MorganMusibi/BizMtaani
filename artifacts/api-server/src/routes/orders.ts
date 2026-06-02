/**
 * Orders API — buyers place orders; sellers manage them.
 *
 * POST   /api/orders              — buyer creates order
 * GET    /api/orders/seller       — seller fetches incoming orders
 * GET    /api/orders/buyer        — buyer fetches their own orders
 * PATCH  /api/orders/:id/status   — seller updates status
 */
import { Router } from "express";
import { getFirebaseAdmin, getFirestore } from "../lib/firebase-admin.js";
import { logger } from "../lib/logger.js";

const router = Router();
type OrderStatus = "pending" | "confirmed" | "rejected" | "completed";

async function requireAuth(req: any, res: any, next: any) {
  const header = req.headers.authorization as string | undefined;
  if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const decoded = await getFirebaseAdmin().auth().verifyIdToken(header.slice(7));
    req.uid = decoded.uid;
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

router.post("/orders", requireAuth, async (req: any, res: any) => {
  const { listingId, listingTitle, listingImage, sellerId, amount, note, buyerName, buyerPhone } = req.body;
  if (!listingId || !sellerId || !amount) { res.status(400).json({ error: "listingId, sellerId, amount required" }); return; }
  if (req.uid === sellerId) { res.status(400).json({ error: "Cannot order your own listing" }); return; }
  try {
    const ref = await getFirestore().collection("orders").add({
      listingId, listingTitle: listingTitle || "", listingImage: listingImage || null,
      buyerId: req.uid, buyerName: buyerName || "", buyerPhone: buyerPhone || "",
      sellerId, amount, note: note || "",
      status: "pending" as OrderStatus,
      createdAt: new Date(), updatedAt: new Date(),
    });
    req.log.info({ orderId: ref.id }, "Order created");
    res.status(201).json({ orderId: ref.id });
  } catch (err) {
    logger.error({ err }, "Failed to create order");
    res.status(500).json({ error: "Failed to create order" });
  }
});

router.get("/orders/seller", requireAuth, async (req: any, res: any) => {
  try {
    const snap = await getFirestore().collection("orders")
      .where("sellerId", "==", req.uid).orderBy("createdAt", "desc").limit(100).get();
    res.json({ orders: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    logger.error({ err }, "Failed to fetch seller orders");
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

router.get("/orders/buyer", requireAuth, async (req: any, res: any) => {
  try {
    const snap = await getFirestore().collection("orders")
      .where("buyerId", "==", req.uid).orderBy("createdAt", "desc").limit(100).get();
    res.json({ orders: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    logger.error({ err }, "Failed to fetch buyer orders");
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

router.patch("/orders/:id/status", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { status } = req.body as { status: OrderStatus };
  const allowed: OrderStatus[] = ["confirmed", "rejected", "completed"];
  if (!allowed.includes(status)) { res.status(400).json({ error: `status must be: ${allowed.join(", ")}` }); return; }
  try {
    const db = getFirestore();
    const ref = db.collection("orders").doc(id);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: "Order not found" }); return; }
    const order = snap.data()!;
    if (order.sellerId !== req.uid) { res.status(403).json({ error: "Not your order" }); return; }
    await ref.update({ status, updatedAt: new Date() });
    if (status === "completed" && order.listingId) {
      try {
        const lRef = db.collection("products").doc(order.listingId);
        const lSnap = await lRef.get();
        if (lSnap.exists) {
          const l = lSnap.data()!;
          if (l.trackStock && typeof l.stockQty === "number" && l.stockQty > 0) {
            await lRef.update({ stockQty: l.stockQty - 1 });
          }
        }
      } catch (e) { logger.warn({ e }, "Stock decrement failed (non-fatal)"); }
    }
    req.log.info({ orderId: id, status }, "Order status updated");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to update order");
    res.status(500).json({ error: "Failed to update order" });
  }
});

export default router;
