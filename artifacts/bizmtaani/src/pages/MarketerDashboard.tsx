import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  startAfter,
  QueryDocumentSnapshot
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { 
  ChevronLeft, 
  Loader2, 
  Wallet, 
  Copy, 
  Check, 
  Share2, 
  TrendingUp,
  ChevronDown,
  RefreshCw,
  Users,
  Gift
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────

interface MarketerData {
  referralCode: string;
  status: "active" | "suspended" | "pending";
  totalEarnedKES: number;
  totalWithdrawnKES: number;
  fullName?: string;
  idNumber?: string;
  mpesaNumber?: string;
  earningsThisMonth?: number;
  signupsThisMonth?: number;
  earningsMonthKey?: string;
}

interface Commission {
  id: string;
  amountPaidKES: number;
  commissionKES: number;
  referredUserUid: string;
  createdAt?: { seconds: number } | null;
}

interface ReferredUser {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  joinedAt?: { seconds: number } | null;
  commissionPaidOut: boolean;
  isPremium: boolean;
}

// ─── Multi-Level Cache ───────────────────────────────────────────────

// Cache for marketer dashboard data
interface MarketerCache {
  marketer: MarketerData;
  commissions: Commission[];
  referrals: ReferredUser[];
  timestamp: number;
  hasMoreCommissions: boolean;
  hasMoreReferrals: boolean;
  lastCommissionDoc: QueryDocumentSnapshot | null;
  lastReferralDoc: QueryDocumentSnapshot | null;
}

const MARKETER_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const marketerCacheByUid = new Map<string, MarketerCache>();

// ✅ User profile cache - persists across dashboard sessions
interface UserProfile {
  displayName: string;
  email: string;
  isPremium: boolean;
  photoURL: string;
  timestamp: number;
}

const USER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const userProfileCache: Record<string, UserProfile> = {};

// ─── Cache Functions ──────────────────────────────────────────────────

// Export for Profile.tsx logout
export function clearMarketerDashboardCache() {
  marketerCacheByUid.clear();
  // Also clear user profiles on logout
  Object.keys(userProfileCache).forEach(key => delete userProfileCache[key]);
}

// Helper to get user profiles with caching
async function getUserProfiles(uids: string[]): Promise<Map<string, UserProfile>> {
  const result = new Map<string, UserProfile>();
  const uncachedUids: string[] = [];

  // 1. Check cache first
  for (const uid of uids) {
    const cached = userProfileCache[uid];
    if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL_MS) {
      result.set(uid, cached);
    } else {
      uncachedUids.push(uid);
    }
  }

  // 2. Fetch uncached users from Firestore
  if (uncachedUids.length > 0) {
    // Fetch in chunks of 10 (Firestore 'in' limit)
    for (let i = 0; i < uncachedUids.length; i += 10) {
      const chunk = uncachedUids.slice(i, i + 10);
      const userSnap = await getDocs(
        query(collection(db, "users"), where("__name__", "in", chunk))
      );
      
      userSnap.docs.forEach((d) => {
        const data = d.data();
        const now = Date.now();
        const profile: UserProfile = {
          displayName: data.displayName || "Unknown User",
          email: data.email || "",
          isPremium: !!(data.premiumEndsAt && data.premiumEndsAt.toDate() > new Date()),
          photoURL: data.photoURL || "",
          timestamp: now,
        };
        
        // Store in cache
        userProfileCache[d.id] = profile;
        result.set(d.id, profile);
      });
    }
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function timeAgo(seconds: number): string {
  const d = Math.floor(Date.now() / 1000) - seconds;
  if (d < 60) return "Just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount);
}

// ─── Main Component ──────────────────────────────────────────────────

export default function MarketerDashboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  // ─── State ──────────────────────────────────────────────────────────

  const [marketer, setMarketer] = useState<MarketerData | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [referrals, setReferrals] = useState<ReferredUser[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  
  // Pagination - Commissions
  const [commissionsLoading, setCommissionsLoading] = useState(false);
  const [hasMoreCommissions, setHasMoreCommissions] = useState(true);
  const [lastCommissionDoc, setLastCommissionDoc] = useState<QueryDocumentSnapshot | null>(null);
  const COMMISSIONS_PAGE_SIZE = 15;

  // Pagination - Referrals
  const [referralsLoading, setReferralsLoading] = useState(false);
  const [hasMoreReferrals, setHasMoreReferrals] = useState(true);
  const [lastReferralDoc, setLastReferralDoc] = useState<QueryDocumentSnapshot | null>(null);
  const REFERRALS_PAGE_SIZE = 15;

  // ─── Load Data ─────────────────────────────────────────────────────

  const loadMarketerData = useCallback(async (force = false) => {
    if (!user) return;

    // Check marketer cache (only if not forcing refresh)
    if (!force) {
      const cached = marketerCacheByUid.get(user.uid);
      if (cached && Date.now() - cached.timestamp < MARKETER_CACHE_TTL_MS) {
        setMarketer(cached.marketer);
        setCommissions(cached.commissions);
        setReferrals(cached.referrals);
        setHasMoreCommissions(cached.hasMoreCommissions);
        setHasMoreReferrals(cached.hasMoreReferrals);
        setLastCommissionDoc(cached.lastCommissionDoc);
        setLastReferralDoc(cached.lastReferralDoc);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setRefreshing(true);

    try {
      // ─── 1. Fetch Marketer Document (1 read) ──────────────────────
      const marketerSnap = await getDoc(doc(db, "marketers", user.uid));
      if (!marketerSnap.exists()) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const marketerData = marketerSnap.data() as MarketerData;

      // ─── 2. Fetch Commissions (1 read for 15 docs) ────────────────
      const commissionsQuery = query(
        collection(db, "referralCommissions"),
        where("marketerUid", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(COMMISSIONS_PAGE_SIZE)
      );
      
      const commissionsSnap = await getDocs(commissionsQuery);
      const commissionsData = commissionsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Commission)
      );

      // ─── 3. Fetch Referrals with Cached User Data ──────────────────
      const referralsQuery = query(
        collection(db, "referrals"),
        where("marketerUid", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(REFERRALS_PAGE_SIZE)
      );
      
      const referralsSnap = await getDocs(referralsQuery);
      
      // ✅ Use cached user profiles
      const userUids = referralsSnap.docs.map((d) => d.id);
      const userProfileMap = userUids.length > 0 
        ? await getUserProfiles(userUids) 
        : new Map();

      const referralsData: ReferredUser[] = referralsSnap.docs.map((d) => {
        const data = d.data();
        const userProfile = userProfileMap.get(d.id);
        return {
          uid: d.id,
          displayName: userProfile?.displayName || "Unknown User",
          email: userProfile?.email || "",
          photoURL: userProfile?.photoURL || "",
          joinedAt: data.createdAt || null,
          commissionPaidOut: data.commissionPaidOut || false,
          isPremium: userProfile?.isPremium || false,
        };
      });

      // ─── 4. Update State ──────────────────────────────────────────
      setMarketer(marketerData);
      setCommissions(commissionsData);
      setReferrals(referralsData);
      setHasMoreCommissions(commissionsSnap.docs.length === COMMISSIONS_PAGE_SIZE);
      setHasMoreReferrals(referralsSnap.docs.length === REFERRALS_PAGE_SIZE);
      setLastCommissionDoc(commissionsSnap.docs[commissionsSnap.docs.length - 1] || null);
      setLastReferralDoc(referralsSnap.docs[referralsSnap.docs.length - 1] || null);

      // ─── 5. Update Marketer Cache ──────────────────────────────────
      marketerCacheByUid.set(user.uid, {
        marketer: marketerData,
        commissions: commissionsData,
        referrals: referralsData,
        timestamp: Date.now(),
        hasMoreCommissions: commissionsSnap.docs.length === COMMISSIONS_PAGE_SIZE,
        hasMoreReferrals: referralsSnap.docs.length === REFERRALS_PAGE_SIZE,
        lastCommissionDoc: commissionsSnap.docs[commissionsSnap.docs.length - 1] || null,
        lastReferralDoc: referralsSnap.docs[referralsSnap.docs.length - 1] || null,
      });

    } catch (error) {
      console.error("Failed to load marketer dashboard:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // ─── Load More Commissions ────────────────────────────────────────

  const loadMoreCommissions = useCallback(async () => {
    if (!user || commissionsLoading || !hasMoreCommissions || !lastCommissionDoc) return;
    setCommissionsLoading(true);

    try {
      const q = query(
        collection(db, "referralCommissions"),
        where("marketerUid", "==", user.uid),
        orderBy("createdAt", "desc"),
        startAfter(lastCommissionDoc),
        limit(COMMISSIONS_PAGE_SIZE)
      );

      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreCommissions(false);
        setCommissionsLoading(false);
        return;
      }

      const newCommissions = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Commission)
      );

      setCommissions((prev) => [...prev, ...newCommissions]);
      setLastCommissionDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMoreCommissions(snap.docs.length === COMMISSIONS_PAGE_SIZE);

    } catch (error) {
      console.error("Failed to load more commissions:", error);
    } finally {
      setCommissionsLoading(false);
    }
  }, [user, lastCommissionDoc, hasMoreCommissions, commissionsLoading]);

  // ─── Load More Referrals ──────────────────────────────────────────

  const loadMoreReferrals = useCallback(async () => {
    if (!user || referralsLoading || !hasMoreReferrals || !lastReferralDoc) return;
    setReferralsLoading(true);

    try {
      const q = query(
        collection(db, "referrals"),
        where("marketerUid", "==", user.uid),
        orderBy("createdAt", "desc"),
        startAfter(lastReferralDoc),
        limit(REFERRALS_PAGE_SIZE)
      );

      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreReferrals(false);
        setReferralsLoading(false);
        return;
      }

      // ✅ Use cached user profiles for new referrals
      const userUids = snap.docs.map((d) => d.id);
      const userProfileMap = userUids.length > 0 
        ? await getUserProfiles(userUids) 
        : new Map();

      const newReferrals: ReferredUser[] = snap.docs.map((d) => {
        const data = d.data();
        const userProfile = userProfileMap.get(d.id);
        return {
          uid: d.id,
          displayName: userProfile?.displayName || "Unknown User",
          email: userProfile?.email || "",
          photoURL: userProfile?.photoURL || "",
          joinedAt: data.createdAt || null,
          commissionPaidOut: data.commissionPaidOut || false,
          isPremium: userProfile?.isPremium || false,
        };
      });

      setReferrals((prev) => [...prev, ...newReferrals]);
      setLastReferralDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMoreReferrals(snap.docs.length === REFERRALS_PAGE_SIZE);

    } catch (error) {
      console.error("Failed to load more referrals:", error);
    } finally {
      setReferralsLoading(false);
    }
  }, [user, lastReferralDoc, hasMoreReferrals, referralsLoading]);

  // ─── Initial Load ──────────────────────────────────────────────────

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    const checkAndLoad = async () => {
      const marketerSnap = await getDoc(doc(db, "marketers", user.uid));
      if (!marketerSnap.exists()) {
        setLoading(false);
        return;
      }
      loadMarketerData();
    };

    checkAndLoad();
  }, [user, navigate, loadMarketerData]);

  // ─── Handlers ──────────────────────────────────────────────────────

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

  // ─── Loading State ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // ─── Not a Marketer ─────────────────────────────────────────────────

  if (!marketer) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 bg-background">
        <div className="text-center">
          <Gift size={48} className="mx-auto text-muted-foreground" />
          <h2 className="font-bold text-lg mt-4">Not a Marketer</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            You are not registered as a marketer. Apply through your profile settings.
          </p>
        </div>
        <Button onClick={() => navigate("/profile")}>Go back</Button>
      </div>
    );
  }

  // ─── Main UI ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
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
        </div>
        <button
          onClick={() => loadMarketerData(true)}
          disabled={refreshing}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
        </button>
      </header>

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {/* ─── Stats Summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-[#00A651] to-[#00A651]/80 rounded-2xl p-4 text-white col-span-2">
            <p className="text-xs font-semibold opacity-90">Available Balance</p>
            <p className="font-black text-2xl mt-1">
              {formatCurrency((marketer.totalEarnedKES || 0) - (marketer.totalWithdrawnKES || 0))}
            </p>
            <div className="flex items-center gap-4 mt-2 text-xs opacity-80">
              <span>Earned: {formatCurrency(marketer.totalEarnedKES || 0)}</span>
              <span>Paid: {formatCurrency(marketer.totalWithdrawnKES || 0)}</span>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground">This Month</p>
            <p className="font-bold text-lg">{formatCurrency(marketer.earningsThisMonth || 0)}</p>
            <p className="text-xs text-muted-foreground">{marketer.signupsThisMonth || 0} signups</p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className={`font-bold text-lg capitalize ${
              marketer.status === "active" ? "text-green-600" :
              marketer.status === "suspended" ? "text-red-600" :
              "text-amber-600"
            }`}>
              {marketer.status || "Pending"}
            </p>
          </div>
        </div>

        {/* ─── Referral Code ─────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="font-black text-sm">Your Marketer Code</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-11 rounded-xl border-2 border-dashed border-[#00A651]/40 flex items-center justify-center font-black text-base tracking-wider text-[#00A651]">
              {marketer.referralCode}
            </div>
            <button
              onClick={handleCopyCode}
              className="h-11 w-11 rounded-xl border border-border flex items-center justify-center flex-shrink-0 hover:bg-muted transition-colors"
            >
              {codeCopied ? <Check size={18} className="text-[#00A651]" /> : <Copy size={18} />}
            </button>
          </div>
          <Button onClick={handleShare} variant="outline" className="w-full gap-2">
            <Share2 size={15} />
            Share your code
          </Button>
          <p className="text-xs text-muted-foreground">
            Earn 14.2% commission when someone you refer makes their first premium purchase.
          </p>
        </div>

        {/* ─── Payout Details ────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="font-black text-sm">Payout Details on File</p>
          <p className="text-xs text-muted-foreground -mt-2">
            Contact support if anything needs correcting.
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

        {/* ─── Recent Commissions ────────────────────────────────────── */}
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
                      {formatCurrency(c.amountPaidKES)} payment
                    </p>
                    {c.createdAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {timeAgo(c.createdAt.seconds)}
                      </p>
                    )}
                  </div>
                  <p className="font-black text-sm text-[#00A651]">
                    +{formatCurrency(c.commissionKES)}
                  </p>
                </div>
              ))}

              {hasMoreCommissions && (
                <button
                  onClick={loadMoreCommissions}
                  disabled={commissionsLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-2xl transition-colors disabled:opacity-50"
                >
                  {commissionsLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      Load more <ChevronDown size={16} />
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ─── Referrals ─────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users size={17} className="text-primary" />
            <p className="font-black text-sm">People You've Referred</p>
          </div>

          {referrals.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center border border-dashed border-border rounded-2xl">
              <Users size={28} className="text-muted-foreground" />
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
                    {r.email && (
                      <p className="text-[10px] text-muted-foreground">{r.email}</p>
                    )}
                    {r.joinedAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Joined {timeAgo(r.joinedAt.seconds)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.isPremium && (
                      <span className="text-[10px] font-bold text-[#00A651] bg-[#00A651]/10 px-2 py-0.5 rounded-full">
                        Premium ✓
                      </span>
                    )}
                    {r.commissionPaidOut ? (
                      <span className="text-[10px] font-bold text-green-600 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                        Paid
                      </span>
                    ) : r.isPremium ? (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                        Pending
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}

              {hasMoreReferrals && (
                <button
                  onClick={loadMoreReferrals}
                  disabled={referralsLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-2xl transition-colors disabled:opacity-50"
                >
                  {referralsLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      Load more <ChevronDown size={16} />
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
        }
