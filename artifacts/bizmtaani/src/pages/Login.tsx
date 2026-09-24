import { useState, useRef } from "react";
import { useLocation, Link } from "wouter";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  type ConfirmationResult,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";
import { normalizeKenyanPhone, resolveAuthEmail } from "@/lib/phoneIdentity";
import { sendPhoneOtp, resetPhoneOtpState } from "@/lib/phoneOtp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const RESET_RECAPTCHA_CONTAINER_ID = "recaptcha-container-login-reset";


export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  // Phone-OTP reset flow — separate from the email-link flow above.
  // "method" picks which UI shows; "phase" only applies to phone.
  const [resetMethod, setResetMethod] = useState<"email" | "phone">("email");
  const [resetPhase, setResetPhase] = useState<"request" | "otp">("request");
  const [resetPhone, setResetPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPhonePassword, setNewPhonePassword] = useState("");
  const [phoneResetLoading, setPhoneResetLoading] = useState(false);
  const confirmationResultRef = useRef<ConfirmationResult | null>(null);

  function openForgotPassword() {
    const trimmed = identifier.trim();
    if (trimmed && !trimmed.includes("@")) {
      // They typed a phone number on the login screen — default the
      // reset modal to the phone flow instead of email.
      setResetMethod("phone");
      setResetPhone(trimmed);
      setResetEmail("");
    } else {
      setResetMethod("email");
      setResetEmail(trimmed.includes("@") ? trimmed : "");
      setResetPhone("");
    }
    setResetPhase("request");
    setOtpCode("");
    setNewPhonePassword("");
    setShowForgotPassword(true);
  }

  function closeForgotPasswordModal() {
    setShowForgotPassword(false);
    setResetPhase("request");
    setOtpCode("");
    setNewPhonePassword("");
    confirmationResultRef.current = null;
    resetPhoneOtpState();
  }

  async function handleSendResetOtp(e: React.FormEvent) {
    e.preventDefault();

    const normalizedPhone = normalizeKenyanPhone(resetPhone);
    if (!normalizedPhone) {
      toast({
        title: "Enter a valid phone number",
        description: "e.g. 0712 345 678",
        variant: "destructive",
      });
      return;
    }

    setPhoneResetLoading(true);
    try {
      confirmationResultRef.current = await sendPhoneOtp(
        normalizedPhone,
        RESET_RECAPTCHA_CONTAINER_ID
      );
      setResetPhase("otp");
      toast({ title: "Code sent", description: `We sent a code to ${resetPhone}.` });
    } catch (err: unknown) {
      console.error("Failed to send reset OTP:", err);
      // A failed send may leave the reCAPTCHA verifier in a bad state —
      // clear it so the next attempt (e.g. after fixing a typo) starts fresh.
      resetPhoneOtpState();
      toast({
        title: "Could not send code",
        description: getFirebaseErrorMessage(
          err,
          "Please check the number and try again."
        ),
        variant: "destructive",
      });
    } finally {
      setPhoneResetLoading(false);
    }
  }

  async function handleConfirmResetOtp(e: React.FormEvent) {
    e.preventDefault();

    if (!confirmationResultRef.current) {
      toast({
        title: "Session expired",
        description: "Please request a new code.",
        variant: "destructive",
      });
      setResetPhase("request");
      return;
    }

    if (newPhonePassword.length < 6) {
      toast({
        title: "Password too short",
        description: "At least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    setPhoneResetLoading(true);
    try {
      // Signs the browser into a temporary phone-auth session — this is
      // only used as proof of phone ownership; resetPasswordViaPhoneOtp
      // resets the REAL account and deletes this ephemeral one.
      await confirmationResultRef.current.confirm(otpCode.trim());

      const resetPasswordViaPhoneOtp = httpsCallable<
        { newPassword: string },
        { success: boolean }
      >(functions, "resetPasswordViaPhoneOtp");

      await resetPasswordViaPhoneOtp({ newPassword: newPhonePassword });

      // The ephemeral session's account no longer exists server-side
      // (or shouldn't be used further either way) — sign out so the
      // user lands back on a clean login screen.
      await signOut(auth).catch(() => {});

      toast({
        title: "Password updated",
        description: "You can now sign in with your new password.",
      });

      setIdentifier(resetPhone);
      setPassword("");
      closeForgotPasswordModal();
    } catch (err: unknown) {
      console.error("Failed to confirm reset OTP:", err);
      // Wrong code is a retryable mistake on the SAME confirmationResult —
      // don't clear the verifier or bounce back to the request step for
      // that case. Anything else (expired session, etc.) needs a fresh code.
      const code = (err as { code?: string })?.code ?? "";
      if (code !== "auth/invalid-verification-code") {
        resetPhoneOtpState();
        confirmationResultRef.current = null;
        setResetPhase("request");
      }
      toast({
        title: "Could not verify code",
        description: getFirebaseErrorMessage(
          err,
          "Please check the code and try again."
        ),
        variant: "destructive",
      });
    } finally {
      setPhoneResetLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    const authEmail = resolveAuthEmail(identifier);
    if (!authEmail) {
      toast({
        title: "Invalid email or phone number",
        description: "Enter the email or phone number you signed up with.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, authEmail, password);
      setLocation("/");
    } catch (err: unknown) {
      console.error("Login error:", err);

      toast({
        title: "Login failed",
        description: getFirebaseErrorMessage(
          err,
          "Unable to sign in. Please check your credentials and try again."
        ),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();

    if (!resetEmail.trim()) {
      toast({
        title: "Email required",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    setResetLoading(true);

    try {
      await sendPasswordResetEmail(
        auth,
        resetEmail.trim(),
        {
          url: `${window.location.origin}/reset-password`,
          handleCodeInApp: true,
        }
      );

      toast({
        title: "Password reset email sent",
        description:
          "Check your email for instructions to reset your password.",
      });

      setShowForgotPassword(false);
      setResetEmail("");
    } catch (err: unknown) {
      console.error("Password reset error:", err);

      toast({
        title: "Password reset failed",
        description: getFirebaseErrorMessage(
          err,
          "Unable to send the password reset email. Please try again."
        ),
        variant: "destructive",
      });
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 py-12 max-w-sm mx-auto w-full">
        <div className="mb-10">
          <div className="w-14 h-14 mb-6">
            <svg
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-full"
            >
              <defs>
                <linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#047857" />
                  <stop offset="100%" stopColor="#022C22" />
                </linearGradient>

                <linearGradient id="law" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FB923C" />
                  <stop offset="100%" stopColor="#EA580C" />
                </linearGradient>
              </defs>

              <rect width="100" height="100" rx="22" fill="url(#lbg)" />

              <path
                d="M14 40 L50 24 L86 40 L82 49 L18 49 Z"
                fill="url(#law)"
              />

              <rect
                x="18"
                y="47"
                width="64"
                height="34"
                rx="3"
                fill="white"
                opacity="0.97"
              />

              <rect
                x="23"
                y="53"
                width="15"
                height="11"
                rx="2.5"
                fill="#D1FAE5"
              />

              <rect
                x="43"
                y="55"
                width="14"
                height="26"
                rx="2"
                fill="#065F46"
              />

              <rect
                x="62"
                y="53"
                width="15"
                height="11"
                rx="2.5"
                fill="#D1FAE5"
              />

              <rect
                x="12"
                y="79"
                width="76"
                height="4"
                rx="2"
                fill="#F97316"
                opacity="0.45"
              />
            </svg>
          </div>

          <h1 className="text-3xl font-black text-foreground">
            Welcome back
          </h1>

          <p className="text-muted-foreground mt-1">
            Sign in to BizMtaani
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="identifier">Email or phone number</Label>

            <Input
              id="identifier"
              data-testid="input-identifier"
              type="text"
              autoComplete="username"
              placeholder="you@example.com or 07XX XXX XXX"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="h-12"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>

              <button
                type="button"
                onClick={openForgotPassword}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Forgot password?
              </button>
            </div>

            <Input
              id="password"
              data-testid="input-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-12"
            />
          </div>

          <Button
            data-testid="button-login"
            type="submit"
            className="w-full h-12 font-bold text-base"
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link
            href="/register"
            className="text-primary font-semibold"
          >
            Create one free
          </Link>
        </p>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
          onClick={() => {
            if (!resetLoading && !phoneResetLoading) {
              closeForgotPasswordModal();
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-foreground">
              Reset your password
            </h2>

            {/* Method toggle */}
            <div className="flex rounded-xl bg-muted p-1 mt-4 mb-1">
              <button
                type="button"
                onClick={() => { setResetMethod("phone"); setResetPhase("request"); }}
                className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${
                  resetMethod === "phone" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
                disabled={resetLoading || phoneResetLoading}
              >
                Phone
              </button>
              <button
                type="button"
                onClick={() => setResetMethod("email")}
                className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${
                  resetMethod === "email" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
                disabled={resetLoading || phoneResetLoading}
              >
                Email
              </button>
            </div>

            {resetMethod === "email" ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Enter the email address associated with your BizMtaani
                  account and we'll send you a password reset link. This only
                  works for accounts created with an email address.
                </p>

                <form onSubmit={handleForgotPassword} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-email">Email address</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      className="h-12"
                      disabled={resetLoading}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 h-12"
                      onClick={closeForgotPasswordModal}
                      disabled={resetLoading}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 h-12 font-bold" disabled={resetLoading}>
                      {resetLoading ? <Loader2 size={18} className="animate-spin" /> : "Send link"}
                    </Button>
                  </div>
                </form>
              </>
            ) : resetPhase === "request" ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Enter your phone number and we'll text you a one-time code
                  to reset your password.
                </p>

                <form onSubmit={handleSendResetOtp} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-phone">Phone number</Label>
                    <Input
                      id="reset-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="07XX XXX XXX"
                      value={resetPhone}
                      onChange={(e) => setResetPhone(e.target.value)}
                      required
                      className="h-12"
                      disabled={phoneResetLoading}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 h-12"
                      onClick={closeForgotPasswordModal}
                      disabled={phoneResetLoading}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 h-12 font-bold" disabled={phoneResetLoading}>
                      {phoneResetLoading ? <Loader2 size={18} className="animate-spin" /> : "Send code"}
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Enter the code sent to {resetPhone} and choose a new password.
                </p>

                <form onSubmit={handleConfirmResetOtp} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-otp">Verification code</Label>
                    <Input
                      id="reset-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      required
                      className="h-12"
                      disabled={phoneResetLoading}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reset-new-password">New password</Label>
                    <Input
                      id="reset-new-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 6 characters"
                      value={newPhonePassword}
                      onChange={(e) => setNewPhonePassword(e.target.value)}
                      required
                      className="h-12"
                      disabled={phoneResetLoading}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 h-12"
                      onClick={closeForgotPasswordModal}
                      disabled={phoneResetLoading}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 h-12 font-bold" disabled={phoneResetLoading}>
                      {phoneResetLoading ? <Loader2 size={18} className="animate-spin" /> : "Reset password"}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Invisible reCAPTCHA container for phone-OTP password reset —
          must be mounted whenever the modal can be, not just after
          the phone form renders, so sendPhoneOtp always finds it. */}
      <div id={RESET_RECAPTCHA_CONTAINER_ID} />
    </div>
  );
}
