/**
 * MpesaPaymentModal — listing activation STK Push flow.
 *
 * Used when an advertiser pays to post their listing.
 * The parent provides an `onInitiate` callback that uploads photos,
 * saves the pending listing, and triggers the STK push — returning
 * the checkoutRequestId and productId.
 *
 * States: idle → initiating → awaiting_pin → success | failed | cancelled | timeout
 */
import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";
import {
  X,
  Smartphone,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Image as ImageIcon,
} from "lucide-react";
import {
  normalizePhone,
  PLAN_AMOUNTS,
  LISTING_DURATION_DAYS,
  type PaidListingPlan,
} from "@/lib/mpesa";

interface Props {
  open: boolean;
  onClose: () => void;
  plan: PaidListingPlan;
  /** Pre-fill phone input with this number */
  defaultPhone?: string;
  /**
   * Called when user submits their phone number.
   * Should upload images, save the pending product to Firestore,
   * call the STK push API, and return the checkoutRequestId + productId.
   */
  onInitiate: (phone: string) => Promise<{ checkoutRequestId: string; productId: string }>;
  /** Called when payment is confirmed and user taps "View Listing" */
  onSuccess: (productId: string) => void;
}

type Stage = "idle" | "initiating" | "awaiting_pin" | "success" | "failed" | "cancelled" | "timeout";

const PIN_TIMEOUT_SECS = 120;

interface PaymentDoc {
  status: "pending" | "completed" | "failed" | "cancelled";
  mpesaCode?: string;
  failureReason?: string;
}

export function MpesaPaymentModal({ open, onClose, plan, defaultPhone = "", onInitiate, onSuccess }: Props) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(defaultPhone);
  const [phoneError, setPhoneError] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [mpesaCode, setMpesaCode] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(PIN_TIMEOUT_SECS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const amount = PLAN_AMOUNTS[plan];

  const planLabel =
  plan === "premium_weekly"
    ? "Weekly Premium"
    : "Monthly Premium";

const duration = LISTING_DURATION_DAYS[plan];

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStage("idle");
        setCheckoutId(null);
        setProductId(null);
        setMpesaCode(null);
        setFailReason(null);
        setPhoneError("");
      }, 300);
      return () => clearTimeout(t);
    } else {
      setPhone(defaultPhone);
      return undefined;
    }
  }, [open, defaultPhone]);

  useEffect(() => {
    if (stage === "awaiting_pin") {
      setCountdown(PIN_TIMEOUT_SECS);
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(timerRef.current!);
            setStage((s) => s === "awaiting_pin" ? "timeout" : s);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [stage]);

  useEffect(() => {
  if (!checkoutId) return;

  unsubRef.current?.();

  unsubRef.current = onSnapshot(
    doc(db, "payments", checkoutId),
    (snap) => {
      if (!snap.exists()) return;

      const data = snap.data() as PaymentDoc;

      if (data.status === "completed") {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }

        setMpesaCode(data.mpesaCode ?? null);
        setStage("success");
      } else if (data.status === "failed") {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }

        setFailReason(
  "We couldn't complete your M-Pesa payment. Please try again."
);

        setStage("failed");
      } else if (data.status === "cancelled") {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }

        setStage("cancelled");
      }
    },
    (error: unknown) => {
      console.error("Payment status listener failed:", error);

      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      setFailReason(
        getFirebaseErrorMessage(
          error,
          "We couldn't check the payment status. Please try again."
        )
      );

      setStage("failed");
    }
  );

  return () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };
}, [checkoutId]);
  

  async function handlePay() {
  setPhoneError("");

  try {
    normalizePhone(phone);
  } catch {
    setPhoneError("Enter a valid Safaricom number e.g. 0712 345 678");
    return;
  }

  setStage("initiating");

  try {
    const {
      checkoutRequestId,
      productId: pid,
    } = await onInitiate(phone);

    setCheckoutId(checkoutRequestId);
    setProductId(pid);

    // Free/subscription-based publishing may not create an STK request.
    // For this modal, paid listings should always have a checkout ID.
    if (!checkoutRequestId) {
      throw new Error("Payment request was not created.");
    }

    setStage("awaiting_pin");
  } catch (error: unknown) {
    console.error("M-Pesa payment initiation failed:", error);

    setStage("idle");

    const message = getFirebaseErrorMessage(
      error,
      "We couldn't start your M-Pesa payment. Please check your phone number and try again."
    );

    toast({
      title: "Payment failed to start",
      description: message,
      variant: "destructive",
    });
  }
}
  

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => stage === "idle" && onClose()} />

      <div className="relative mt-auto w-full bg-card rounded-t-3xl border-t border-border px-5 pt-4 pb-safe animate-in slide-in-from-bottom-4 duration-300"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>

        <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-4" />
        <button onClick={onClose} disabled={stage === "initiating" || stage === "awaiting_pin"}
          className="absolute top-4 right-4 p-2 rounded-xl hover:bg-muted transition-colors">
          <X size={18} className="text-muted-foreground" />
        </button>

        {/* ---- IDLE: phone input ---- */}
        {stage === "idle" && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#00A651]/10 flex items-center justify-center flex-shrink-0">
                <Smartphone size={22} className="text-[#00A651]" />
              </div>
              <div>
                <p className="font-black text-base">Activate Listing</p>
                <p className="text-xs text-muted-foreground">
  Pay to post your advert for {duration} days
</p>
              </div>
            </div>

            <div className="bg-muted/50 rounded-2xl px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-semibold">{planLabel}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-semibold">{duration} days</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-black text-primary">KES {amount}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>M-Pesa Phone Number</Label>
              <Input
                type="tel" placeholder="07XX XXX XXX"
                value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneError(""); }}
                className={`h-12 text-base ${phoneError ? "border-destructive" : ""}`}
                autoFocus
              />
              {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
              <p className="text-xs text-muted-foreground">Enter your Safaricom number to receive the M-Pesa prompt.</p>
            </div>

            <Button onClick={handlePay} className="w-full h-12 font-black text-base rounded-xl gap-2" style={{ backgroundColor: "#00A651" }}>
              <Smartphone size={18} />
              Pay KES {amount} & Publish
            </Button>
            <p className="text-center text-xs text-muted-foreground">Secured by Safaricom M-Pesa</p>
          </div>
        )}

        {/* ---- INITIATING: uploading & preparing ---- */}
        {stage === "initiating" && (
          <div className="flex flex-col items-center py-8 gap-4">
            <div className="relative">
              <Loader2 size={40} className="animate-spin text-[#00A651]" />
              <ImageIcon size={16} className="absolute inset-0 m-auto text-[#00A651]" />
            </div>
            <p className="font-black text-base text-center">Uploading photos & preparing your listing...</p>
            <p className="text-sm text-muted-foreground text-center">Please wait, do not close this screen.</p>
          </div>
        )}

        {/* ---- AWAITING PIN ---- */}
        {stage === "awaiting_pin" && (
          <div className="flex flex-col items-center py-6 gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-[#00A651]/10 flex items-center justify-center">
                <Smartphone size={36} className="text-[#00A651]" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-card border-2 border-[#00A651] flex items-center justify-center">
                <Clock size={14} className="text-[#00A651]" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-black text-lg">Check your phone</p>
              <p className="text-sm text-muted-foreground mt-1">
                Enter your M-Pesa PIN to pay <strong className="text-foreground">KES {amount}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-8 h-8 rounded-full border-2 border-primary flex items-center justify-center">
                <span className="text-xs font-bold text-primary">{countdown}</span>
              </div>
              <span>seconds remaining</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-800 text-center">
              Do <strong>NOT</strong> close this screen. Your listing is ready and waiting.
            </div>
          </div>
        )}

        {/* ---- TIMEOUT ---- */}
        {stage === "timeout" && (
          <div className="flex flex-col items-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertCircle size={32} className="text-amber-600" />
            </div>
            <div className="text-center">
              <p className="font-black text-base">Request timed out</p>
              <p className="text-sm text-muted-foreground mt-1">You were not charged. Try again.</p>
            </div>
            <Button onClick={() => setStage("idle")} className="w-full h-11 rounded-xl">Try Again</Button>
          </div>
        )}

        {/* ---- CANCELLED ---- */}
        {stage === "cancelled" && (
          <div className="flex flex-col items-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <XCircle size={32} className="text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-black text-base">Payment cancelled</p>
              <p className="text-sm text-muted-foreground mt-1">You cancelled the M-Pesa prompt. No charge was made.</p>
            </div>
            <Button onClick={() => setStage("idle")} className="w-full h-11 rounded-xl">Try Again</Button>
          </div>
        )}

        {/* ---- FAILED ---- */}
        {stage === "failed" && (
          <div className="flex flex-col items-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle size={32} className="text-destructive" />
            </div>
            <div className="text-center">
              <p className="font-black text-base">Payment failed</p>
              <p className="text-sm text-muted-foreground mt-1">{failReason ?? "Could not complete payment."}</p>
            </div>
            <Button onClick={() => setStage("idle")} className="w-full h-11 rounded-xl">Try Again</Button>
            <button onClick={onClose} className="text-xs text-muted-foreground underline">Cancel</button>
          </div>
        )}

        {/* ---- SUCCESS ---- */}
        {stage === "success" && (
          <div className="flex flex-col items-center py-6 gap-4">
            <div className="w-20 h-20 rounded-full bg-[#00A651]/10 flex items-center justify-center">
              <CheckCircle2 size={40} className="text-[#00A651]" />
            </div>
            <div className="text-center">
              <p className="font-black text-xl" style={{ color: "#00A651" }}>Listing is live!</p>
              <p className="text-sm text-muted-foreground mt-1">
  Your advert is now visible for {duration} days.
</p>
            </div>
            {mpesaCode && (
              <div className="bg-[#00A651]/5 border border-[#00A651]/20 rounded-2xl px-4 py-3 text-center w-full">
                <p className="text-xs text-muted-foreground mb-1">M-Pesa Receipt</p>
                <p className="font-black text-lg tracking-widest text-[#00A651]">{mpesaCode}</p>
              </div>
            )}
            <Button
              onClick={() => productId && onSuccess(productId)}
              className="w-full h-11 rounded-xl font-black"
              style={{ backgroundColor: "#00A651" }}
            >
              View My Listing
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
