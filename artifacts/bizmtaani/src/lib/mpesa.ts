/**
 * Frontend M-Pesa helpers — listing activation payments.
 * Advertisers pay to post: KES 60 (basic) or KES 120 (premium).
 */
import { auth } from "@/lib/firebase";

export type ListingPlan = "basic" | "premium";

export interface StkPushParams {
  phone: string;
  plan: ListingPlan;
  productId: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage?: string;
}

export const PLAN_AMOUNTS: Record<ListingPlan, number> = {
  basic: 60,
  premium: 120,
};

export const PLAN_PHOTO_LIMITS: Record<ListingPlan, number> = {
  basic: 10,
  premium: 25,
};

export const LISTING_DURATION_DAYS = 7;

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

  const res = await fetch("/api/mpesa/stkpush", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });

  const data = (await res.json()) as StkPushResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Payment request failed");
  return data;
}
