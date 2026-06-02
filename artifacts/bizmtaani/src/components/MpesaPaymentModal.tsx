/**
 * MpesaPaymentModal — full STK Push flow.
 *
 * States: idle → initiating → awaiting_pin → success | failed | cancelled | timeout
 *
 * After initiating, the component subscribes to Firestore `payments/{checkoutRequestId}`
 * to receive the real-time result from the Safaricom callback.
 */
import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { initiateStkPush, normalizePhone } from "@/lib/mpesa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  X, Smartphone, Loader2, CheckCircle2, XCircle,
  AlertCircle, Clock, ArrowLeft,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  productTitle: string;
  sellerId: string;
  amount: number;
  /** Pre-fill phone (user's number if known) */
  defaultPhone?: string;
}

type Stage = "idle" | "initiating" | "awaiting_pin" | "success" | "failed" | "cancelled" | "timeout";

const PIN_TIMEOUT_SECS = 120;

interface PaymentDoc {
  status: "pending" | "completed" | "failed" | "cancelled";
  mpesaCode?: string;
  failureReason?: string;
}

export function MpesaPaymentModal({
  open, onClose, productId, productTitle, sellerId, amount, defaultPhone = "",
}: Props) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(defaultPhone);
  const [phoneError, setPhoneError] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [mpesaCode, setMpesaCode] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(PIN_TIMEOUT_SECS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStage("idle");
        setCheckoutId(null);
        setMpesaCode(null);
        setFailReason(null);
        setPhone(defaultPhone);
        setPhoneError("");
      }, 300);
    }
  }, [open, defaultPhone]);

  // Start countdown once in awaiting_pin stage
  useEffect(() => {
    if (stage === "awaiting_pin") {
      setCountdown(PIN_TIMEOUT_SECS);
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(timerRef.current!);
            if (stage === "awaiting_pin") setStage("timeout");
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [stage]);

  // Listen to Firestore payment doc for real-time result
  useEffect(() => {
    if (!checkoutId) return;
    unsubRef.current?.();
    unsubRef.current = onSnapshot(doc(db, "payments", checkoutId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as PaymentDoc;
      if (data.status === "completed") {
        clearInterval(timerRef.current!);
        setMpesaCode(data.mpesaCode ?? null);
        setStage("success");
      } else if (data.status === "failed") {
        clearInterval(timerRef.current!);
        setFailReason(data.failureReason ?? "Payment failed");
        setStage("failed");
      } else if (data.status === "cancelled") {
        clearInterval(timerRef.current!);
        setStage("cancelled");
      }
    });
    return () => unsubRef.current?.();
  }, [checkoutId]);

  async function handlePay() {
    setPhoneError("");
    try {
      normalizePhone(phone);
    } catch {
      setPhoneError("Enter a valid Kenyan number e.g. 0712 345 678");
      return;
    }
    setStage("initiating");
    try {
      const result = await initiateStkPush({ phone, amount, productId, productTitle, sellerId });
      setCheckoutId(result.checkoutRequestId);
      setStage("awaiting_pin");
    } catch (err) {
      setStage("idle");
      toast({ title: "Could not initiate payment", description: (err as Error).message, variant: "destructive" });
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => stage === "idle" && onClose()} />

      {/* Sheet */}
      <div className="relative mt-auto w-full bg-card rounded-t-3xl border-t border-border px-5 pt-4 pb-safe animate-in slide-in-from-bottom-4 duration-300"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>

        {/* Handle + close */}
        <div className="flex items-center justify-between mb-5">
          <div className="w-10 h-1 rounded-full bg-muted mx-auto" />
        </div>
        <button onClick={onClose} disabled={stage === "initiating"}
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
                <p className="font-black text-base">Pay with M-Pesa</p>
                <p className="text-xs text-muted-foreground">Lipa Na M-Pesa STK Push</p>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-muted/50 rounded-2xl px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Item</span>
                <span className="font-semibold line-clamp-1 max-w-[55%] text-right">{productTitle}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-black text-primary">KES {amount.toLocaleString()}</span>
              </div>
            </div>

            {/* Phone input */}
            <div className="space-y-2">
              <Label>M-Pesa Phone Number</Label>
              <Input
                type="tel" placeholder="07XX XXX XXX"
                value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneError(""); }}
                className={`h-12 text-base ${phoneError ? "border-destructive" : ""}`}
                autoFocus
              />
              {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
              <p className="text-xs text-muted-foreground">
                A push notification will be sent to this Safaricom number.
              </p>
            </div>

            <Button onClick={handlePay} className="w-full h-12 font-black text-base rounded-xl bg-[#00A651] hover:bg-[#008a44] gap-2">
              <Smartphone size={18} />
              Send M-Pesa Prompt
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Secure payment powered by Safaricom M-Pesa
            </p>
          </div>
        )}

        {/* ---- INITIATING ---- */}
        {stage === "initiating" && (
          <div className="flex flex-col items-center py-8 gap-4">
            <Loader2 size={40} className="animate-spin text-[#00A651]" />
            <p className="font-black text-base">Sending prompt...</p>
            <p className="text-sm text-muted-foreground text-center">Connecting to M-Pesa</p>
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
                Enter your M-Pesa PIN to complete the payment of{" "}
                <strong className="text-foreground">KES {amount.toLocaleString()}</strong>
              </p>
            </div>

            {/* Countdown ring */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-8 h-8 rounded-full border-2 border-primary flex items-center justify-center">
                <span className="text-xs font-bold text-primary">{countdown}</span>
              </div>
              <span>seconds remaining</span>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-800 text-center">
              Do <strong>NOT</strong> close this screen until you have entered your PIN
            </div>

            <button onClick={() => setStage("idle")} className="flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2">
              <ArrowLeft size={12} />Wrong number? Go back
            </button>
          </div>
        )}

        {/* ---- TIMEOUT ---- */}
        {stage === "timeout" && (
          <div className="flex flex-col items-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertCircle size={32} className="text-amber-600" />
            </div>
            <div className="text-center">
              <p className="font-black text-base">Payment timed out</p>
              <p className="text-sm text-muted-foreground mt-1">
                The request expired. You were not charged.
              </p>
            </div>
            <Button onClick={() => setStage("idle")} className="w-full h-11 rounded-xl">
              Try Again
            </Button>
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
              <p className="text-sm text-muted-foreground mt-1">You cancelled the M-Pesa prompt.</p>
            </div>
            <Button onClick={() => setStage("idle")} className="w-full h-11 rounded-xl">
              Try Again
            </Button>
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
              <p className="text-sm text-muted-foreground mt-1">{failReason ?? "The payment could not be completed."}</p>
            </div>
            <Button onClick={() => setStage("idle")} className="w-full h-11 rounded-xl">
              Try Again
            </Button>
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
              <p className="font-black text-xl text-[#00A651]">Payment confirmed!</p>
              <p className="text-sm text-muted-foreground mt-1">
                KES {amount.toLocaleString()} paid successfully
              </p>
            </div>
            {mpesaCode && (
              <div className="bg-[#00A651]/5 border border-[#00A651]/20 rounded-2xl px-4 py-3 text-center w-full">
                <p className="text-xs text-muted-foreground mb-1">M-Pesa Receipt</p>
                <p className="font-black text-lg tracking-widest text-[#00A651]">{mpesaCode}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Save your receipt number for reference. Message the seller to confirm delivery.
            </p>
            <Button onClick={onClose} className="w-full h-11 rounded-xl bg-[#00A651] hover:bg-[#008a44]">
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
