import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useLocation } from "wouter";
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronLeft, Loader2, Wallet, Copy, Check, Share2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MarketerData {
  referralCode: string;
  status: "active" | "suspended";
  totalEarnedKES: number;
  totalWithdrawnKES: number;
  fullName?: string;
  idNumber?: string;
  mpesaNumber?: string;
}

interface Commission {
  id: string;
  amountPaidKES: number;
  commissionKES: number;
  createdAt?: { seconds: number } | null;
}
interface ReferredUser {
  uid: string;
  displayName: string;
  joinedAt?: { seconds: number } | null;
  commissionPaidOut: boolean;
  isPremium: boolean;
}

function timeAgo(seconds: number): string {
  const d = Math.floor(Date.now() / 1000) - seconds;
  if (d < 60) return "Just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// Simple in-memory cache — avoids re-reading Firestore every time the
// user navigates back to this page within the same app session.
let cachedMarketerData: { marketer: MarketerData; commissions: Commission[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

export default function MarketerDashboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

const [marketer, setMarketer] = useState<MarketerData | null>(null);
const [commissions, setCommissions] = useState<Commission[]>([]);
const [loading, setLoading] = useState(true);
const [codeCopied, setCodeCopied] = useState(false);

const [referrals, setReferrals] = useState<ReferredUser[]>([]);
const [referralsLoading, setReferralsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    if (cachedMarketerData && Date.now() - cachedMarketerData.timestamp < CACHE_TTL_MS) {
      setMarketer(cachedMarketerData.marketer);
      setCommissions(cachedMarketerData.commissions);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const marketerSnap = await getDoc(doc(db, "marketers", user.uid));
        if (!marketerSnap.exists()) {
          if (!cancelled) setLoading(false);
          return;
        }

        const marketerData = marketerSnap.data() as MarketerData;

        // Bounded to 30 most recent — enough for a dashboard view without
        // pulling a marketer's entire history on every visit.
        const commissionsSnap = await getDocs(
          query(
            collection(db, "referralCommissions"),
            where("marketerUid", "==", user.uid),
            orderBy("createdAt", "desc"),
            limit(30)
          )
        );

        const commissionsData = commissionsSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Commission)
        );

        if (!cancelled) {
          setMarketer(marketerData);
          setCommissions(commissionsData);
          cachedMarketerData = { marketer: marketerData, commissions: commissionsData, timestamp: Date.now() };
        }
      } catch (error) {
        console.error("Failed to load marketer dashboard:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);


  useEffect(() => {
    if (!user || !marketer) return;

    (async () => {
      try {
        setReferralsLoading(true);
        const getMyReferrals = httpsCallable(functions, "getMyReferrals");
        const result = await getMyReferrals({});
        const data = result.data as { referrals: ReferredUser[] };
        setReferrals(data.referrals ?? []);
      } catch (error) {
        console.error("Failed to load referrals:", error);
      } finally {
        setReferralsLoading(false);
      }
    })();
  }, [user, marketer]);

  function handleCopyCode() {
    if (!marketer) return;
    navigator.clipboard.writeText(marketer.referralCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  function handleShare() {
    if (!marketer) return;
    const message = `Use my BizMtaani marketer code ${marketer.referralCode} when you sign up! ${window.location.origin}`;
    if (navigator.share) {
      navigator.share({ title: "Join BizMtaani", text: message });
    } else {
      navigator.clipboard.writeText(message);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!marketer) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground">You are not an approved marketer.</p>
        <Button onClick={() => navigate("/profile")}>Go back</Button>
      </div>
    );
  }

  const availableBalance = marketer.totalEarnedKES - marketer.totalWithdrawnKES;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else navigate("/profile");
          }}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={24} />
        </button>
        <span className="font-black text-base">Marketer Dashboard</span>
      </header>

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {/* Earnings summary */}
        <div className="bg-gradient-to-br from-[#00A651] to-[#00A651]/80 rounded-2xl p-5 text-white">
          <p className="text-xs font-semibold opacity-90">Available Balance</p>
          <p className="font-black text-3xl mt-1">
            KES {availableBalance.toLocaleString("en-GB")}
          </p>
          <div className="flex items-center gap-4 mt-3 text-xs opacity-90">
            <span>Total earned: KES {marketer.totalEarnedKES.toLocaleString("en-GB")}</span>
            <span>Paid out: KES {marketer.totalWithdrawnKES.toLocaleString("en-GB")}</span>
          </div>
          <p className="text-xs mt-3 opacity-80">
            Payouts are arranged manually — contact BizMtaani to withdraw.
          </p>
        </div>

        {/* Referral code */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="font-black text-sm">Your Marketer Code</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-11 rounded-xl border-2 border-dashed border-[#00A651]/40 flex items-center justify-center font-black text-base tracking-wider text-[#00A651]">
              {marketer.referralCode}
            </div>
            <button
              onClick={handleCopyCode}
              className="h-11 w-11 rounded-xl border border-border flex items-center justify-center flex-shrink-0"
            >
              {codeCopied ? <Check size={18} className="text-[#00A651]" /> : <Copy size={18} />}
            </button>
          </div>
          <Button onClick={handleShare} variant="outline" className="w-full gap-2">
            <Share2 size={15} />
            Share your code
          </Button>
          <p className="text-xs text-muted-foreground">
            Earn KES 14 when someone you refer takes Weekly Premium, or KES 50 for Monthly Premium — on their first payment only.
          </p>
        </div>

        {/* Payout details on file */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="font-black text-sm">Payout Details on File</p>
          <p className="text-xs text-muted-foreground -mt-2">
            This is what we use to pay you. Contact BizMtaani if anything needs correcting.
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-semibold">{marketer.fullName || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID Number</span>
              <span className="font-semibold">{marketer.idNumber || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">M-Pesa Number</span>
              <span className="font-semibold">{marketer.mpesaNumber || "—"}</span>
            </div>
          </div>
        </div>

        {/* Recent commissions */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={17} className="text-primary" />
            <p className="font-black text-sm">Recent Commissions</p>
          </div>

          {commissions.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center border border-dashed border-border rounded-2xl">
              <Wallet size={28} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground px-6">
                No commissions yet. Share your code to start earning.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {commissions.map((c) => (
                <div
                  key={c.id}
                  className="bg-card border border-border rounded-2xl p-3.5 flex items-center justify-between"
                >
                  <div>
                    <p className="font-bold text-sm">
                      Referral payment: KES {c.amountPaidKES.toLocaleString("en-GB")}
                    </p>
                    {c.createdAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {timeAgo(c.createdAt.seconds)}
                      </p>
                    )}
                  </div>
                  <p className="font-black text-sm text-[#00A651]">
                    +KES {c.commissionKES.toLocaleString("en-GB")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* People referred */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={17} className="text-primary" />
            <p className="font-black text-sm">People You've Referred</p>
          </div>

          {referralsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          ) : referrals.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center border border-dashed border-border rounded-2xl">
              <p className="text-sm text-muted-foreground px-6">
                No one has used your code yet. Share it to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {referrals.map((r) => (
                <div
                  key={r.uid}
                  className="bg-card border border-border rounded-2xl p-3.5 flex items-center justify-between"
                >
                  <div>
                    <p className="font-bold text-sm">{r.displayName}</p>
                    {r.joinedAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Joined {timeAgo(r.joinedAt.seconds)}
                      </p>
                    )}
                  </div>
                  <p className={`text-xs font-bold ${r.isPremium ? "text-[#00A651]" : "text-muted-foreground"}`}>
                    {r.isPremium ? "Premium ✓" : "Not premium yet"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
          }
