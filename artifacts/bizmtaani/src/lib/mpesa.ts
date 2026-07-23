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
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";

// ============================================================
// TYPES
// ============================================================

export type ListingPlan =
  | "free"
  | "premium_weekly"
  | "premium_monthly";

export type PaidListingPlan =
  | "premium_weekly"
  | "premium_monthly";

// ============================================================
// LISTING EXPIRY
// ============================================================

export const LISTING_DURATION_DAYS: Record<ListingPlan, number> = {
  free: 7,
  premium_weekly: 7,
  premium_monthly: 30,
};

// ============================================================
// ACTIVE ADVERT LIMITS
// ============================================================

export const MAX_ACTIVE_ADVERTS: Record<ListingPlan, number> = {
  free: 5,
  premium_weekly: Infinity,
  premium_monthly: Infinity,
};

// ============================================================
// PHOTO LIMITS
// ============================================================

export const MAX_PHOTO_LIMIT: Record<ListingPlan, number> = {
  free: 1,
  premium_weekly: Infinity,
  premium_monthly: Infinity,
};

// ============================================================
// PLAN PRICES
// Must match functions/src/index.ts
// ============================================================

export const PLAN_AMOUNTS: Record<ListingPlan, number> = {
  free: 0,
  premium_weekly: 100,
  premium_monthly: 350,
};

// ============================================================
// STK PUSH TYPES
// ============================================================

export interface StkPushParams {
  phone: string;
  plan: PaidListingPlan;
  productId: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  customerMessage?: string;
}

// ============================================================
// NORMALIZE KENYAN PHONE NUMBER
// Converts:
// 0712345678
// 0112345678
// +254712345678
// 254712345678
// 712345678
//
// Into:
// 254712345678
// ============================================================

export function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s\-+]/g, "");

  if (p.startsWith("254") && p.length === 12) {
    return p;
  }

  if (
    (p.startsWith("07") || p.startsWith("01")) &&
    p.length === 10
  ) {
    return "254" + p.slice(1);
  }

  if (p.startsWith("7") && p.length === 9) {
    return "254" + p;
  }

  throw new Error("Invalid Kenyan phone number.");
}

// ============================================================
// INITIATE M-PESA STK PUSH
// ============================================================

export async function initiateStkPush(
  params: StkPushParams
): Promise<StkPushResult> {

  const functions = getFunctions(app);

  const normalizedPhone = normalizePhone(params.phone);

  const initiate = httpsCallable<
    StkPushParams,
    StkPushResult
  >(
    functions,
    "initiateMpesaPayment"
  );

  try {
    const { data } = await initiate({
      ...params,
      phone: normalizedPhone,
    });

    return data;

  } catch (error: unknown) {

    console.error(
      "M-Pesa STK Push failed:",
      error
    );

    throw new Error(
      getFirebaseErrorMessage(
        error,
        "We couldn't start the M-Pesa payment. Please try again."
      )
    );
  }
}
