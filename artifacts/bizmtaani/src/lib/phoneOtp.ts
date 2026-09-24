import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

// Used ONLY for the forgot-password-via-phone flow — never at signup —
// to keep SMS costs to the rare "I forgot my password" case instead of
// every new account.

let recaptchaVerifier: RecaptchaVerifier | null = null;

function getRecaptchaVerifier(containerId: string): RecaptchaVerifier {
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: "invisible",
    });
  }
  return recaptchaVerifier;
}

/**
 * Sends an SMS OTP to a normalized Kenyan phone number (2547XXXXXXXX).
 * Requires an empty DOM element with id === containerId to be mounted
 * on the page (used invisibly by reCAPTCHA).
 */
export async function sendPhoneOtp(
  normalizedPhone: string,
  containerId: string
): Promise<ConfirmationResult> {
  const verifier = getRecaptchaVerifier(containerId);
  return signInWithPhoneNumber(auth, `+${normalizedPhone}`, verifier);
}

/** Call after the OTP flow finishes (success or abandoned) to allow a fresh attempt. */
export function resetPhoneOtpState() {
  recaptchaVerifier?.clear();
  recaptchaVerifier = null;
}

