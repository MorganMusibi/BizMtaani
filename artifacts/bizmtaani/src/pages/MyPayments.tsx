/**
 * Payment history — shows all of the current user's M-Pesa payments.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { collection, query, where, orderBy, getDocs, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Smartphone, Loader2, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";

interface Payment {
  id: string;
  checkoutRequestId: string;
  productId: string;
  productTitle: string;
  amount: number;
  buyerPhone: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  mpesaCode?: string;
  failureReason?: string;
  createdAt?: { seconds: number } | null;
  completedAt?: { seconds: number } | null;
}

function timeAgo(sec: number): string {
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(sec * 1000).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, color: "text-[#00A651]", bg: "bg-[#00A651]/10", label: "Paid" },
  pending: { icon: Clock, color: "text-amber-600", bg: "bg-amber-100", label: "Pending" },
  failed: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", label: "Failed" },
  cancelled: { icon: AlertCircle, color: "text-muted-foreground", bg: "bg-muted", label: "Cancelled" },
};

export default function MyPayments() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    getDocs(
      query(
        collection(db, "payments"),
        where("buyerId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(50)
      )
    ).then((snap) => {
      setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Payment)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user]);

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button onClick={() => navigate("/profile")} className="p-1.5 rounded-xl hover:bg-muted transition-colors">
          <ChevronLeft size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#00A651] flex items-center justify-center">
            <Smartphone size={13} className="text-white" />
          </div>
          <span className="font-black text-base">My Payments</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={28} className="animate-spin text-[#00A651]" />
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 px-6">
            <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
              <Smartphone size={36} className="text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-bold text-lg">No payments yet</p>
              <p className="text-muted-foreground text-sm mt-1">
                Your M-Pesa payment history will appear here
              </p>
            </div>
            <Button onClick={() => navigate("/")} className="gap-2">
              Browse listings
            </Button>
          </div>
        ) : (
          <div className="px-4 pt-4 space-y-3">
            {payments.map((p) => {
              const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.pending;
              const StatusIcon = cfg.icon;
              return (
                <div
                  key={p.id}
                  onClick={() => navigate(`/product/${p.productId}`)}
                  className="bg-card border border-border rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-transform"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                      <StatusIcon size={20} className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-sm line-clamp-1">{p.productTitle}</p>
                        <span className={`flex-shrink-0 text-xs font-black ${cfg.color}`}>{cfg.label}</span>
                      </div>
                      <p className="font-black text-primary mt-0.5">KES {p.amount.toLocaleString()}</p>
                      {p.mpesaCode && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Receipt: <span className="font-mono font-bold text-foreground">{p.mpesaCode}</span>
                        </p>
                      )}
                      {p.failureReason && (
                        <p className="text-xs text-destructive mt-1">{p.failureReason}</p>
                      )}
                      {p.createdAt && (
                        <p className="text-xs text-muted-foreground mt-1">{timeAgo(p.createdAt.seconds)}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
