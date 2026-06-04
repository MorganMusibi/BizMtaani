/**
 * Banner shown to email/password users who have not yet verified their email.
 * Google sign-in users are always verified, so this only appears for email accounts.
 * Dismissed state is stored in sessionStorage so it doesn't re-appear during the session.
 */
import { useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Mail, X, RefreshCw } from "lucide-react";

export function EmailVerificationBanner() {
  const { user, reloadUser } = useAuth();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("bm_evb_dismissed") === "1"
  );
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);

  // Only show for email/password users who have not verified
  if (!user) return null;
  if (user.emailVerified) return null;
  // Google users have a providerId of "google.com" — skip them
  const isEmailUser = user.providerData.some((p) => p.providerId === "password");
  if (!isEmailUser) return null;
  if (dismissed) return null;

  function dismiss() {
    sessionStorage.setItem("bm_evb_dismissed", "1");
    setDismissed(true);
  }

  async function resend() {
    const current = auth.currentUser;
    if (!current) return;
    setSending(true);
    try {
      await sendEmailVerification(current);
      toast({ title: "Verification email sent", description: `Check your inbox at ${current.email}` });
    } catch (err) {
      toast({
        title: "Could not send email",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  async function checkVerified() {
    setChecking(true);
    try {
      await reloadUser();
      // If still not verified after reload, tell the user
      if (!auth.currentUser?.emailVerified) {
        toast({ title: "Not verified yet", description: "Click the link in your email first, then try again." });
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-3">
      <Mail size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-900 leading-snug">
          Verify your email to unlock all features
        </p>
        <p className="text-[11px] text-amber-700 mt-0.5 leading-snug">
          We sent a link to <strong>{user.email}</strong>
        </p>
        <div className="flex items-center gap-3 mt-1.5">
          <button
            onClick={checkVerified}
            disabled={checking}
            className="text-[11px] font-bold text-amber-800 underline underline-offset-2 flex items-center gap-1 disabled:opacity-60"
          >
            {checking && <RefreshCw size={10} className="animate-spin" />}
            I've verified
          </button>
          <button
            onClick={resend}
            disabled={sending}
            className="text-[11px] text-amber-700 underline underline-offset-2 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Resend email"}
          </button>
        </div>
      </div>
      <button onClick={dismiss} className="p-0.5 text-amber-500 hover:text-amber-800 transition-colors flex-shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}
