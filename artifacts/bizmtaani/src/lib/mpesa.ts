/**
 * Frontend M-Pesa helpers — listing activation payments.
 *
 * Plans:
 *   free    — 0 KES, 1 photo, 3 days, up to 5 active adverts
 *   basic   — KES 60/week, 2 photos, 7 days, up to 10 active adverts, verified badge
 *   premium — KES 120/week, 4 photos, 7 days, up to 30 active adverts, verified badge + biz tools
 */
import { auth } from "@/lib/firebase";
import { apiBase } from "@/lib/apiUrl";

export type ListingPlan = "free" | "basic" | "premium";
export type PaidListingPlan = "basic" | "premium";

export const FREE_PLAN_DURATION_DAYS = 3;
export const FREE_PLAN_ADVERT_LIMIT = 5;

export const PLAN_AMOUNTS: Record<PaidListingPlan, number> = {
  basic: 60,
  premium: 120,
};

export const PLAN_PHOTO_LIMITS: Record<ListingPlan, number> = {
  free: 1,
  basic: 2,
  premium: 4,
};

export const PLAN_ADVERT_LIMITS: Record<ListingPlan, number> = {
  free: 5,
  basic: 10,
  premium: 30,
};

export const LISTING_DURATION_DAYS: Record<ListingPlan, number> = {
  free: 3,
  basic: 7,
  premium: 7,
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
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const res = await fetch(`${apiBase()}/api/mpesa/stkpush`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });

  const data = (await res.json()) as StkPushResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Payment request failed");
  return data;
}
