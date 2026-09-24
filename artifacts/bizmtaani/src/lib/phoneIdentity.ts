// Shared by Register.tsx, Login.tsx, and the phone-OTP password-reset flow.
// Keep this the single source of truth for how a phone number maps to a
// Firebase Auth identity — every file that touches signup/login must agree
// on this exact mapping or accounts silently stop matching.

// Domain used only to satisfy Firebase Auth's email/password requirement
// for phone-only accounts. Never sent anywhere, never shown to the user,
// not a real mailbox.
export const PHONE_AUTH_DOMAIN = "bizmtaani.local";

/**
 * Normalizes a Kenyan phone number to 2547XXXXXXXX / 2541XXXXXXXX format.
 * Accepts 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, +2547XXXXXXXX, 7XXXXXXXX.
 * Returns null if the input doesn't match a recognizable Kenyan mobile format.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");

  if (/^(07|01)\d{8}$/.test(digits)) {
    return "254" + digits.slice(1);
  }
  if (/^254(7|1)\d{8}$/.test(digits)) {
    return digits;
  }
  if (/^(7|1)\d{8}$/.test(digits)) {
    return "254" + digits;
  }
  return null;
}

export function phoneToAuthEmail(normalizedPhone: string): string {
  return `${normalizedPhone}@${PHONE_AUTH_DOMAIN}`;
}

/**
 * Turns whatever the user typed on the login screen — a real email or a
 * phone number — into the actual string Firebase Auth needs. Returns null
 * if it's neither.
 */
export function resolveAuthEmail(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    // Reject anyone trying to type our internal synthetic domain directly.
    if (trimmed.toLowerCase().endsWith(`@${PHONE_AUTH_DOMAIN}`)) return null;
    return trimmed;
  }

  const normalizedPhone = normalizeKenyanPhone(trimmed);
  return normalizedPhone ? phoneToAuthEmail(normalizedPhone) : null;
}

