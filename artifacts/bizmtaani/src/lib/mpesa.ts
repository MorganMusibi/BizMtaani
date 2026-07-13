/**
 * Frontend M-Pesa helpers — listing activation payments.
 *
 * Plans:
 * free            — 0 KES, 1 photo, 7 days, up to 5 active adverts
 * premium_weekly  — 100 KES, Unlimited photos, 7 days, Unlimited active adverts
 * premium_monthly — 350 KES, Unlimited photos, 30 days, Unlimited active adverts
 *
 * Payment is processed via Firebase Cloud Function `initiateMpesaPayment`,
 * which calls the Daraja STK push API server-side.
 */
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";

// --- TYPES ---
export type ListingPlan = "free" | "premium_weekly" | "premium_monthly";
export type PaidListingPlan = "premium_weekly" | "premium_monthly";

// --- EXPIRY LOGIC (Days until ad expires) ---
export const LISTING_DURATION_DAYS: Record<ListingPlan, number> = {
  free: 7,
  premium_weekly: 7,
  premium_monthly: 30,
};

// --- AD LIMITS (Max active adverts) ---
export const MAX_ACTIVE_ADVERTS: Record<ListingPlan, number> = {
  free: 5,
  premium_weekly: Infinity, // 'Infinity' means no limit
  premium_monthly: Infinity,
};

// --- PHOTO LIMITS (Photos per advert) ---
export const MAX_PHOTO_LIMIT: Record<ListingPlan, number> = {
  free: 1,
  premium_weekly: Infinity,
  premium_monthly: Infinity,
};

// --- PRICING ---
export const PLAN_AMOUNTS: Record<PaidListingPlan, number> = {
  premium_weekly: 100,
  premium_monthly: 350,
};

export interface StkPushParams {
  phone: string;
  plan: PaidListingPlan;
  productId: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage?: string;
}

/** Normalize a Kenyan phone number to 254XXXXXXXXX format */
export function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s\-+]/g, "");
  if (p.startsWith("254") && p.length === 12) return p;
  if ((p.startsWith("07") || p.startsWith("01")) && p.length === 10) return "254" + p.slice(1);
  if (p.startsWith("7") && p.length === 9) return "254" + p;
  throw new Error(`Invalid Kenyan number: ${raw}`);
}

export async function initiateStkPush(params: StkPushParams): Promise<StkPushResult> {
  const functions = getFunctions(app);
  const initiate = httpsCallable<StkPushParams, StkPushResult>(
    functions,
    "initiateMpesaPayment"
  );
  const { data } = await initiate(params);
  return data;
}
