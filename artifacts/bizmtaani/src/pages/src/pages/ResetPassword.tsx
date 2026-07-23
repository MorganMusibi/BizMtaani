import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [oobCode, setOobCode] = useState("");
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);

  const [resetSuccess, setResetSuccess] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);

  useEffect(() => {
    async function verifyResetLink() {
      const params = new URLSearchParams(window.location.search);

      const mode = params.get("mode");
      const code = params.get("oobCode");

      if (mode !== "resetPassword" || !code) {
        setInvalidLink(true);
        setLoading(false);
        return;
      }

      try {
        const userEmail = await verifyPasswordResetCode(auth, code);

        setOobCode(code);
        setEmail(userEmail);
      } catch (error: unknown) {
        console.error("Password reset link verification error:", error);

        setInvalidLink(true);

        toast({
          title: "Invalid or expired link",
          description: getFirebaseErrorMessage(
            error,
            "This password reset link is invalid or has expired. Please request a new one."
          ),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }

    verifyResetLink();
  }, [toast]);

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();

    if (password.length < 6) {
      toast({
        title: "Password too short",
        description:
          "Your password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description:
          "Please make sure both passwords are the same.",
        variant: "destructive",
      });
      return;
    }

    setResetLoading(true);

    try {
      await confirmPasswordReset(auth, oobCode, password);

      setResetSuccess(true);

      toast({
        title: "Password reset successful",
        description:
          "Your password has been updated successfully.",
      });
    } catch (error: unknown) {
      console.error("Password reset error:", error);

      toast({
        title: "Password reset failed",
        description: getFirebaseErrorMessage(
          error,
          "Unable to reset your password. Please request a new reset link and try again."
        ),
        variant: "destructive",
      });
    } finally {
      setResetLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2
            size={32}
            className="animate-spin text-primary"
          />

          <p className="text-sm text-muted-foreground">
            Verifying your password reset link...
          </p>
        </div>
      </div>
    );
  }

  if (invalidLink) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 mx-auto mb-6 rounded-full bg-destructive/10 flex items-center justify-center">
            <span className="text-2xl">!</span>
          </div>

          <h1 className="text-2xl font-black text-foreground">
            Invalid or expired link
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            This password reset link is no longer valid.
            Please request a new password reset link.
          </p>

          <Button
            className="w-full h-12 mt-6 font-bold"
            onClick={() => setLocation("/login")}
          >
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  if (resetSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2
              size={30}
              className="text-primary"
            />
          </div>

          <h1 className="text-2xl font-black text-foreground">
            Password updated
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Your BizMtaani password has been reset successfully.
            You can now sign in with your new password.
          </p>

          <Button
            className="w-full h-12 mt-6 font-bold"
            onClick={() => setLocation("/login")}
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 py-12 max-w-sm mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-foreground">
            Reset your password
          </h1>

          <p className="text-muted-foreground mt-2">
            Create a new password for your BizMtaani account.
          </p>

          {email && (
            <p className="text-sm text-muted-foreground mt-3">
              Account:{" "}
              <span className="font-semibold text-foreground">
                {email}
              </span>
            </p>
          )}
        </div>

        <form
          onSubmit={handleResetPassword}
          className="space-y-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-password">
              New password
            </Label>

            <div className="relative">
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={resetLoading}
                className="h-12 pr-12"
              />

              <button
                type="button"
                aria-label={
                  showPassword
                    ? "Hide password"
                    : "Show password"
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() =>
                  setShowPassword((value) => !value)
                }
              >
                {showPassword ? (
                  <EyeOff size={19} />
                ) : (
                  <Eye size={19} />
                )}
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Use at least 6 characters.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">
              Confirm new password
            </Label>

            <div className="relative">
              <Input
                id="confirm-password"
                type={
                  showConfirmPassword
                    ? "text"
                    : "password"
                }
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) =>
                  setConfirmPassword(e.target.value)
                }
                required
                disabled={resetLoading}
                className="h-12 pr-12"
              />

              <button
                type="button"
                aria-label={
                  showConfirmPassword
                    ? "Hide password"
                    : "Show password"
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() =>
                  setShowConfirmPassword(
                    (value) => !value
                  )
                }
              >
                {showConfirmPassword ? (
                  <EyeOff size={19} />
                ) : (
                  <Eye size={19} />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-12 font-bold text-base"
            disabled={resetLoading}
          >
            {resetLoading ? (
              <Loader2
                size={18}
                className="animate-spin"
              />
            ) : (
              "Reset password"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
