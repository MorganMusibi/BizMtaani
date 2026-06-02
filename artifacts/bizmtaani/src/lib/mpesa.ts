/**
 * Frontend M-Pesa helpers — phone formatting and API calls.
 */
import { auth } from "@/lib/firebase";

export interface StkPushParams {
  phone: string;
  amount: number;
  productId: string;
  productTitle: string;
  sellerId: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage?: string;
}

/** Normalize phone to 254XXXXXXXXX for display/validation */
export function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s\-+]/g, "");
  if (p.startsWith("254") && p.length === 12) return p;
  if ((p.startsWith("07") || p.startsWith("01")) && p.length === 10) return "254" + p.slice(1);
  if (p.startsWith("7") && p.length === 9) return "254" + p;
  throw new Error(`Invalid Kenyan number: ${raw}`);
}

/** Return user-friendly formatted number e.g. 07XX XXX XXX */
export function formatPhoneDisplay(raw: string): string {
  try {
    const norm = normalizePhone(raw);
    // 254XXXXXXXXX → 0XX XXXX XXXX
    return "0" + norm.slice(3, 5) + " " + norm.slice(5, 8) + " " + norm.slice(8, 12);
  } catch {
    return raw;
  }
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
