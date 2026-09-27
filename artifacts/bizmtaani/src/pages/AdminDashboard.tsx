import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import {
  Users,
  Package,
  Briefcase,
  CreditCard,
  Flag,
  LayoutDashboard,
  LogOut,
  Loader2,
  ExternalLink,
  Check,
  Trash2,
  X,
  Shield,
  Megaphone,
  TrendingUp,
  RefreshCw,
  Plus,
} from "lucide-react";
import {
  collection, getCountFromServer, query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type Tab = "overview" | "users" | "adverts" | "jobs" | "payments" | "reports" | "support" | "marketers" | "applications" | "payouts" | "leaderboard" | "auditlog" | "createListing";
interface ProductReport {
  id: string;
  productId: string;
  productTitle: string;
  sellerId: string;
  reporterId: string;
  reason: string;
  status: "pending" | "resolved" | "dismissed";
  createdAt: { seconds: number } | null;
}

interface SupportReport {
  id: string;
  userId: string | null;
  userEmail: string | null;
  type: string;
  advertId: string | null;
  description: string;
  contact: string | null;
  status: "open" | "resolved" | "dismissed";
  priority: "normal" | "high";
  createdAt: { seconds: number } | null;
}

interface AdminUser {
  id: string;
  displayName?: string;
  role?: string;
  subscriptionPlan?: string;
  createdAt?: string;
  blocked?: boolean;
  blockReason?: string;
}

interface Marketer {
  id: string;
  referralCode?: string;
  fullName?: string;
  email?: string;
  status?: "active" | "suspended";
  totalEarnedKES?: number;
  totalWithdrawnKES?: number;
  createdAt?: { seconds: number } | null;
}

interface Payout {
  id: string;
  marketerUid: string;
  referralCode?: string | null;
  earningsKES: number;
  signups: number;
  paid: boolean;
}

interface Payment {
  id: string;
  checkoutRequestId?: string;
  plan?: string;
  productId?: string;
  buyerId?: string;
  status?: "pending" | "completed" | "failed" | "cancelled";
  confirmedAmountKES?: number | null;
  failureReason?: string;
  createdAt?: { seconds: number } | null;
}

interface LeaderboardEntry {
  id: string;
  referralCode: string | null;
  earningsThisMonth: number;
  signupsThisMonth: number;
}

interface AuditLogEntry {
  id: string;
  adminUid: string;
  action: string;
  targetUid?: string;
  reason?: string;
  referralCode?: string;
  createdAt: { seconds: number } | null;
}

interface MarketerApplication {
  id: string;
  fullName?: string;
  email?: string;
  idNumber?: string;
  mpesaNumber?: string;
  reason?: string;
  status?: "pending" | "approved" | "rejected";
  createdAt?: { seconds: number } | null;
}

interface AdminProduct {
  id: string;
  title: string;
  sellerName?: string;
  category?: string;
  status?: string;
  price?: number;
  createdAt?: { seconds: number } | null;
}
interface AdminJob {
  id: string;
  title?: string;
  company?: string;
  jobType?: string;
  posterId?: string;
  deadline?: string;
  createdAt?: { seconds: number } | null;
}

function timeAgo(createdAt: { seconds: number } | null | undefined) {
  if (!createdAt) return "";
  const seconds = Math.floor(Date.now() / 1000) - createdAt.seconds;
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface DashboardStatsCache {
  totalUsers: number | null;
  activeAdverts: number | null;
  totalJobs: number | null;
  successfulPayments: number | null;
  pendingReportsCount: number | null;
  pendingSupportCount: number | null;
  todayActiveAdverts: number | null;
  todayNewUsers: number | null;
  expiredCount: number | null;
  premiumExpiringSoon: number | null;
  failedPayments: number | null;
  timestamp: number;
}
let dashboardStatsCache: DashboardStatsCache | null = null;
const DASHBOARD_STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// DESIGN TOKENS
// A pale-ledger palette + IBM Plex trio (Serif for headings, Sans for UI,
// Mono for anything that's actually data). Defined once as CSS custom
// properties on the page root, referenced via Tailwind's bg-[var(--x)]
// arbitrary-value syntax everywhere below.
// ---------------------------------------------------------------------------
const rootVars = {
  ["--pd-paper"]: "#EEF2E7",
  ["--pd-surface"]: "#FBFCF9",
  ["--pd-ink"]: "#1B2A20",
  ["--pd-ink-soft"]: "#5A6A5D",
  ["--pd-line"]: "#D6DECB",
  ["--pd-green"]: "#2F8F52",
  ["--pd-green-soft"]: "#E3EEDF",
  ["--pd-rust"]: "#B1502E",
  ["--pd-rust-soft"]: "#F4E4DC",
  ["--pd-gold"]: "#B9822E",
  ["--pd-gold-soft"]: "#F3E9D5",
  ["--pd-font-serif"]: "'IBM Plex Serif', Georgia, serif",
  ["--pd-font-sans"]: "'IBM Plex Sans', system-ui, sans-serif",
  ["--pd-font-mono"]: "'IBM Plex Mono', ui-monospace, monospace",
} as React.CSSProperties;

const fontSerif = { fontFamily: "var(--pd-font-serif)" };
const fontMono = { fontFamily: "var(--pd-font-mono)" };

// Shared class fragments so the same visual language repeats exactly
// everywhere instead of drifting tab to tab.
const navItemBase =
  "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-sm border-l-2 transition-colors";
const navItemActive = "border-[var(--pd-green)] bg-white/5 text-[var(--pd-paper)]";
const navItemInactive =
  "border-transparent text-[#AEBBA2] hover:text-[var(--pd-paper)] hover:bg-white/5";

const panelCls = "border border-[var(--pd-line)] bg-[var(--pd-surface)]";
const thCls = "text-left px-4 py-2.5 font-medium text-xs text-[var(--pd-ink-soft)]";
const tdMuted = "px-4 py-3 text-[var(--pd-ink-soft)]";

const btnPrimary =
  "bg-[var(--pd-ink)] text-[var(--pd-paper)] hover:bg-[#2A3D2E] transition-colors px-4 py-2 text-xs font-medium disabled:opacity-50";
const btnGhost =
  "border border-[var(--pd-line)] text-[var(--pd-ink)] hover:bg-[var(--pd-ink)]/5 transition-colors px-4 py-2 text-xs font-medium disabled:opacity-50 flex items-center gap-2";
const btnDanger =
  "bg-[var(--pd-rust)] text-white hover:bg-[#96401F] transition-colors px-4 py-2 text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1.5";
const btnConfirm =
  "bg-[var(--pd-green)] text-white hover:bg-[#256F3F] transition-colors px-4 py-2 text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1.5";
const btnGhostSmall =
  "flex-1 border border-[var(--pd-line)] text-[var(--pd-ink)] hover:bg-[var(--pd-ink)]/5 transition-colors px-3 py-2 text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1.5";

const linkGreen = "text-xs font-medium text-[var(--pd-green)] hover:underline disabled:opacity-50";
const linkRust = "text-xs font-medium text-[var(--pd-rust)] hover:underline disabled:opacity-50";
const linkInk = "text-xs font-medium text-[var(--pd-ink)] hover:underline disabled:opacity-50";

function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={fontMono}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span style={{ color }}>{label}</span>
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${panelCls} p-10 text-center text-sm text-[var(--pd-ink-soft)]`}>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-5 w-5 animate-spin text-[var(--pd-ink-soft)]" />
    </div>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={btnGhost}>
      <RefreshCw className="h-3.5 w-3.5" />
      Refresh
    </button>
  );
}

export default function AdminDashboard() {
  const { user, isAdmin, adminLoading } = useAuth();
  const [, navigate] = useLocation();

  // Matches OWNER_UID in functions/index.ts — only the owner sees
  // admin-revocation controls, even though other admins can use
  // the rest of this dashboard.
  const isOwner = user?.uid === "MdkkpY3BkMNdTYChcR2TaNtK08W2";

  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Overview stats
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [activeAdverts, setActiveAdverts] = useState<number | null>(null);
  const [totalJobs, setTotalJobs] = useState<number | null>(null);
  const [successfulPayments, setSuccessfulPayments] = useState<number | null>(null);
  const [pendingReportsCount, setPendingReportsCount] = useState<number | null>(null);
  const [pendingSupportCount, setPendingSupportCount] = useState<number | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  // Today's insights
  const [todayActiveAdverts, setTodayActiveAdverts] = useState<number | null>(null);
  const [todayNewUsers, setTodayNewUsers] = useState<number | null>(null);
  const [expiredCount, setExpiredCount] = useState<number | null>(null);
  const [premiumExpiringSoon, setPremiumExpiringSoon] = useState<number | null>(null);
  const [failedPayments, setFailedPayments] = useState<number | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  // Reports tab
  const [reports, setReports] = useState<ProductReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [processingReportId, setProcessingReportId] = useState<string | null>(null);
  // Support reports tab
  const [supportReports, setSupportReports] = useState<SupportReport[]>([]);
  const [supportReportsLoading, setSupportReportsLoading] = useState(true);
  const [processingSupportReportId, setProcessingSupportReportId] = useState<string | null>(null);

  // Users tab
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);
  const [reportCountsBySeller, setReportCountsBySeller] = useState<Record<string, number>>({});
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<AdminUser[] | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);

  // Message modal — sending a direct notification to a specific user
  const [messageTarget, setMessageTarget] = useState<AdminUser | null>(null);
  const [messageTitle, setMessageTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  // Adverts tab
  const [adverts, setAdverts] = useState<AdminProduct[]>([]);
  const [advertsLoading, setAdvertsLoading] = useState(false);
  const [advertsLoaded, setAdvertsLoaded] = useState(false);
  const [processingAdvertId, setProcessingAdvertId] = useState<string | null>(null);

  // Jobs tab
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);
// Create Listing tab — admin bulk-creates a business listing before
  // the owner has signed up; excludeFromFreeLimit keeps it from ever
  // counting against the owner's own 3-free-ad cap, even after claim
  const [newListingTitle, setNewListingTitle] = useState("");
  const [newListingCategory, setNewListingCategory] = useState("");
  const [newListingSubcategory, setNewListingSubcategory] = useState("");
  const [newListingWard, setNewListingWard] = useState("");
  const [newListingConstituency, setNewListingConstituency] = useState("");
  const [newListingCounty, setNewListingCounty] = useState("");
  const [newListingPrice, setNewListingPrice] = useState("");
  const [newListingPhone, setNewListingPhone] = useState("");
  const [creatingListing, setCreatingListing] = useState(false);
  const [lastCreatedClaimUrl, setLastCreatedClaimUrl] = useState<string | null>(null);
  // Marketers tab — lazily loaded, matches the pattern used elsewhere
  const [marketers, setMarketers] = useState<Marketer[]>([]);
  const [marketersLoading, setMarketersLoading] = useState(false);
  const [marketersLoaded, setMarketersLoaded] = useState(false);
  const [processingMarketerId, setProcessingMarketerId] = useState<string | null>(null);
  const [onboardingStats, setOnboardingStats] = useState<Record<string, { today: number; totalOnboarded: number; premiumCount: number }>>({});

  // Payouts tab — lazily loaded per selected month
  const [payoutMonth, setPayoutMonth] = useState(() => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  });
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const [processingPayoutId, setProcessingPayoutId] = useState<string | null>(null);

  // Payments tab — lazily loaded, matches the pattern used elsewhere.
  // Only completed (successful) payments are ever fetched — see loadPayments.
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);

  // Leaderboard tab — lazily loaded, matches the pattern used elsewhere
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardLoaded, setLeaderboardLoaded] = useState(false);

  // Marketer applications tab — lazily loaded, bounded, matches the pattern used elsewhere
  const [applications, setApplications] = useState<MarketerApplication[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [processingApplicationId, setProcessingApplicationId] = useState<string | null>(null);

  // Audit log tab — owner-only, lazily loaded, bounded to 50 most recent
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [auditLogLoaded, setAuditLogLoaded] = useState(false);
  const [adminNames, setAdminNames] = useState<Record<string, string>>({});

  async function loadJobs(force = false) {
    if (jobsLoaded && !force) return;
    setJobsLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "jobs"), orderBy("createdAt", "desc"), limit(50))
      );
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdminJob)));
      setJobsLoaded(true);
    } catch (error) {
      console.error("Failed to load jobs:", error);
    } finally {
      setJobsLoading(false);
    }
  }

  async function deleteJobDirect(jobId: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setProcessingJobId(jobId);
    try {
      const deleteJob = httpsCallable(functions, "deleteJob");
      await deleteJob({ jobId });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (error) {
      console.error("Failed to delete job:", error);
      alert("Failed to delete the job.");
    } finally {
      setProcessingJobId(null);
    }
  }

  // -------------------------------------------------------
  // CREATE LISTING — admin creates an unclaimed advert on a business's
  // behalf (from Google Maps outreach); calls adminCreateListing Cloud
  // Function, which must NOT be added to PostProduct.tsx's publish path
  // -------------------------------------------------------
  async function createListing() {
    if (!newListingTitle.trim() || !newListingCategory.trim() || !newListingWard.trim() || !newListingPhone.trim()) {
      alert("Title, category, ward, and phone number are required.");
      return;
    }
    setCreatingListing(true);
    try {
      const adminCreateListing = httpsCallable(functions, "adminCreateListing");
      const result = await adminCreateListing({
        title: newListingTitle.trim(),
        category: newListingCategory.trim(),
        subcategory: newListingSubcategory.trim() || null,
        ward: newListingWard.trim(),
        constituency: newListingConstituency.trim() || null,
        county: newListingCounty.trim() || null,
        price: newListingPrice ? Number(newListingPrice) : 0,
        ownerPhone: newListingPhone.trim(),
      });
      const { claimUrl } = result.data as { listingId: string; claimUrl: string };
      setLastCreatedClaimUrl(claimUrl);
      setNewListingTitle("");
      setNewListingCategory("");
      setNewListingSubcategory("");
      setNewListingWard("");
      setNewListingConstituency("");
      setNewListingCounty("");
      setNewListingPrice("");
      setNewListingPhone("");
      // Invalidate the Adverts tab cache so it shows the new listing next open
      setAdvertsLoaded(false);
    } catch (error) {
      console.error("Failed to create listing:", error);
      alert("Failed to create the listing.");
    } finally {
      setCreatingListing(false);
    }
  }

  function isJobExpired(deadline?: string) {
    if (!deadline) return false;
    return new Date(`${deadline}T23:59:59`) < new Date();
  }

  // -------------------------------------------------------
  // MARKETERS — loaded lazily when tab is opened, bounded to 50
  // -------------------------------------------------------
  async function loadMarketers() {
    if (marketersLoaded) return;
    setMarketersLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "marketers"), orderBy("createdAt", "desc"), limit(50))
      );
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Marketer));
      setMarketers(loaded);
      setMarketersLoaded(true);

      if (loaded.length > 0) {
        try {
          const getMarketerOnboardingStats = httpsCallable(functions, "getMarketerOnboardingStats");
          const result = await getMarketerOnboardingStats({ uids: loaded.map((m) => m.id) });
          const data = result.data as { stats: Record<string, { today: number; totalOnboarded: number; premiumCount: number }> };
          setOnboardingStats(data.stats ?? {});
        } catch (error) {
          console.error("Failed to load marketer onboarding stats:", error);
        }
      }
    } catch (error) {
      console.error("Failed to load marketers:", error);
    } finally {
      setMarketersLoading(false);
    }
  }
  async function loadPayouts(monthKey: string) {
    setPayoutsLoading(true);
    try {
      const getMonthlyPayouts = httpsCallable(functions, "getMonthlyPayouts");
      const result = await getMonthlyPayouts({ monthKey });
      const data = result.data as { payouts: Payout[] };
      setPayouts(data.payouts ?? []);
    } catch (error) {
      console.error("Failed to load payouts:", error);
      alert("Failed to load payouts for this month.");
    } finally {
      setPayoutsLoading(false);
    }
  }

  // Only completed (successful) payments are fetched — failed/cancelled/
  // pending attempts never leave Firestore for this tab.
  async function loadPayments(force = false) {
    if (paymentsLoaded && !force) return;
    setPaymentsLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "payments"),
          where("status", "==", "completed"),
          orderBy("createdAt", "desc"),
          limit(50)
        )
      );
      setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Payment)));
      setPaymentsLoaded(true);
    } catch (error) {
      console.error("Failed to load payments:", error);
    } finally {
      setPaymentsLoading(false);
    }
  }

  async function loadLeaderboard() {
    if (leaderboardLoaded) return;
    setLeaderboardLoading(true);
    try {
      const getTopMarketers = httpsCallable(functions, "getTopMarketers");
      const result = await getTopMarketers({});
      const data = result.data as { leaderboard: LeaderboardEntry[] };
      setLeaderboard(data.leaderboard ?? []);
      setLeaderboardLoaded(true);
    } catch (error) {
      console.error("Failed to load leaderboard:", error);
      alert("Failed to load the leaderboard.");
    } finally {
      setLeaderboardLoading(false);
    }
  }

  async function markPaid(payout: Payout) {
    if (!confirm(`Mark ${payout.referralCode ?? payout.marketerUid} as paid for ${payoutMonth}?`)) return;
    setProcessingPayoutId(payout.id);
    try {
      const markPayoutPaid = httpsCallable(functions, "markPayoutPaid");
      await markPayoutPaid({ monthKey: payoutMonth, marketerUid: payout.marketerUid });
      setPayouts((prev) =>
        prev.map((p) => (p.id === payout.id ? { ...p, paid: true } : p))
      );
    } catch (error) {
      console.error("Failed to mark payout paid:", error);
      alert("Failed to update payout status.");
    } finally {
      setProcessingPayoutId(null);
    }
  }

  async function makeMarketer(targetUser: AdminUser) {
    if (!confirm(`Approve "${targetUser.displayName || targetUser.id}" as a Brand Ambassador?`)) return;
    setProcessingUserId(targetUser.id);
    try {
      const approveMarketer = httpsCallable(functions, "approveMarketer");
      const result = await approveMarketer({ uid: targetUser.id });
      const { referralCode } = result.data as { referralCode: string };
      alert(`Brand Ambassador approved. Their referral code is: ${referralCode}`);
      // Invalidate the marketers cache so the Brand Ambassadors tab shows
      // this new entry next time it's opened, without an extra read now.
      setMarketersLoaded(false);
    } catch (error) {
      console.error("Failed to approve marketer:", error);
      alert("Failed to approve this user as a Brand Ambassador.");
    } finally {
      setProcessingUserId(null);
    }
  }


  async function revokeAdmin(targetUser: AdminUser) {
    if (!confirm(`Revoke admin access for "${targetUser.displayName || targetUser.id}"?`)) return;
    setProcessingUserId(targetUser.id);
    try {
      const revokeAdminRole = httpsCallable(functions, "revokeAdminRole");
      await revokeAdminRole({ uid: targetUser.id });
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: "user" } : u))
      );
      alert("Admin access revoked.");
    } catch (error: any) {
      console.error("Failed to revoke admin:", error);
      alert(error?.message ?? "Failed to revoke admin access.");
    } finally {
      setProcessingUserId(null);
    }
  }

  async function grantAdmin(targetUser: AdminUser) {
    if (!confirm(`Grant admin access to "${targetUser.displayName || targetUser.id}"? They will be able to manage users, adverts, payouts, and more.`)) return;
    setProcessingUserId(targetUser.id);
    try {
      const setAdminRole = httpsCallable(functions, "setAdminRole");
      await setAdminRole({ uid: targetUser.id });
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: "admin" } : u))
      );
      alert("Admin access granted.");
    } catch (error: any) {
      console.error("Failed to grant admin:", error);
      alert(error?.message ?? "Failed to grant admin access.");
    } finally {
      setProcessingUserId(null);
    }
  }

  async function toggleMarketerStatus(marketer: Marketer) {
    const willSuspend = marketer.status !== "suspended";
    setProcessingMarketerId(marketer.id);
    try {
      const setMarketerStatus = httpsCallable(functions, "setMarketerStatus");
      await setMarketerStatus({
        uid: marketer.id,
        status: willSuspend ? "suspended" : "active",
      });
      setMarketers((prev) =>
        prev.map((m) =>
          m.id === marketer.id ? { ...m, status: willSuspend ? "suspended" : "active" } : m
        )
      );
      // Audit logging now happens server-side inside the Cloud
      // Function, so no direct client write is needed here.
    } catch (error) {
      console.error("Failed to update marketer status:", error);
      alert("Failed to update marketer status.");
    } finally {
      setProcessingMarketerId(null);
    }
  }

  // -------------------------------------------------------
  // MARKETER APPLICATIONS — loaded lazily when tab is opened, bounded
  // -------------------------------------------------------
  async function loadApplications() {
    if (applicationsLoaded) return;
    setApplicationsLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "marketerApplications"),
          where("status", "==", "pending"),
          orderBy("createdAt", "desc"),
          limit(50)
        )
      );
      setApplications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MarketerApplication)));
      setApplicationsLoaded(true);
    } catch (error) {
      console.error("Failed to load marketer applications:", error);
    } finally {
      setApplicationsLoading(false);
    }
  }

  async function approveApplication(application: MarketerApplication) {
    if (!confirm(`Approve "${application.fullName || application.id}" as a Brand Ambassador?`)) return;
    setProcessingApplicationId(application.id);
    try {
      const approveMarketer = httpsCallable(functions, "approveMarketer");
      const result = await approveMarketer({ uid: application.id });
      const { referralCode } = result.data as { referralCode: string };
      alert(`Brand Ambassador approved. Their referral code is: ${referralCode}`);
      setApplications((prev) => prev.filter((a) => a.id !== application.id));
      // Invalidate marketers cache so the Brand Ambassadors tab reflects this on next open.
      setMarketersLoaded(false);
    } catch (error) {
      console.error("Failed to approve application:", error);
      alert("Failed to approve this application.");
    } finally {
      setProcessingApplicationId(null);
    }
  }

  async function rejectApplication(application: MarketerApplication) {
    if (!confirm(`Reject "${application.fullName || application.id}"'s application?`)) return;
    setProcessingApplicationId(application.id);
    try {
      const rejectMarketerApplication = httpsCallable(functions, "rejectMarketerApplication");
      await rejectMarketerApplication({ uid: application.id });
      setApplications((prev) => prev.filter((a) => a.id !== application.id));
    } catch (error) {
      console.error("Failed to reject application:", error);
      alert("Failed to reject this application.");
    } finally {
      setProcessingApplicationId(null);
    }
  }
  // -------------------------------------------------------
  // AUDIT LOG — owner-only, lazily loaded when tab is opened
  // -------------------------------------------------------
  async function loadAuditLog() {
    if (auditLogLoaded) return;
    setAuditLogLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "adminAuditLog"), orderBy("createdAt", "desc"), limit(50))
      );
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogEntry));
      setAuditLog(entries);
      setAuditLogLoaded(true);

      // Resolve admin uids to display names for readability, skipping
      // any already resolved. Best-effort — falls back to the raw uid.
      const uidsToResolve = Array.from(new Set(entries.map((e) => e.adminUid))).filter(
        (uid) => !adminNames[uid]
      );
      if (uidsToResolve.length > 0) {
        try {
          const resultsMap: Record<string, string> = {};
          for (let i = 0; i < uidsToResolve.length; i += 30) {
            const chunk = uidsToResolve.slice(i, i + 30);
            const snap = await getDocs(
              query(collection(db, "users"), where("__name__", "in", chunk))
            );
            snap.docs.forEach((d) => {
              resultsMap[d.id] = d.data()?.displayName ?? d.id;
            });
          }
          // Any uid with no matching user doc falls back to the raw uid.
          uidsToResolve.forEach((uid) => {
            if (!(uid in resultsMap)) resultsMap[uid] = uid;
          });
          setAdminNames((prev) => ({ ...prev, ...resultsMap }));
        } catch (error) {
          console.error("Failed to resolve admin names:", error);
        }
      }
    } catch (error) {
      console.error("Failed to load audit log:", error);
    } finally {
      setAuditLogLoading(false);
    }
  }
  // -------------------------------------------------------
  // OVERVIEW STATS
  // -------------------------------------------------------
  useEffect(() => {
    if (adminLoading || !user || !isAdmin) return;

    if (dashboardStatsCache && Date.now() - dashboardStatsCache.timestamp < DASHBOARD_STATS_CACHE_TTL_MS) {
      setTotalUsers(dashboardStatsCache.totalUsers);
      setActiveAdverts(dashboardStatsCache.activeAdverts);
      setTotalJobs(dashboardStatsCache.totalJobs);
      setSuccessfulPayments(dashboardStatsCache.successfulPayments);
      setPendingReportsCount(dashboardStatsCache.pendingReportsCount);
      setPendingSupportCount(dashboardStatsCache.pendingSupportCount);
      setTodayActiveAdverts(dashboardStatsCache.todayActiveAdverts);
      setTodayNewUsers(dashboardStatsCache.todayNewUsers);
      setExpiredCount(dashboardStatsCache.expiredCount);
      setPremiumExpiringSoon(dashboardStatsCache.premiumExpiringSoon);
      setFailedPayments(dashboardStatsCache.failedPayments);
      setStatsLoading(false);
      setInsightsLoading(false);
      return;
    }

    async function loadDashboardStats() {
      try {
        setStatsLoading(true);
        setStatsError("");

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startOfTodayTs = Timestamp.fromDate(startOfToday);
        const nowTs = Timestamp.now();
        const in48h = Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1000));
        const todayDateStr = startOfToday.toISOString().split("T")[0];

        const [
          usersSnapshot,
          activeAdvertsSnapshot,
          jobsSnapshot,
          paymentsSnapshot,
          reportsCountSnapshot,
          supportCountSnapshot,
          activeTodaySnap,
          newUsersSnap,
          expiredAdvertsSnap,
          expiredJobsSnap,
          premiumExpiringSnap,
          failedPaymentsSnap,
        ] = await Promise.all([
          getCountFromServer(collection(db, "users")),
          getCountFromServer(query(collection(db, "products"), where("status", "==", "active"))),
          getCountFromServer(collection(db, "jobs")),
          getCountFromServer(query(collection(db, "payments"), where("status", "==", "completed"))),
          getCountFromServer(query(collection(db, "reports"), where("status", "==", "pending"))),
          getCountFromServer(query(collection(db, "supportReports"), where("status", "==", "open"))),
          getCountFromServer(
            query(collection(db, "products"), where("status", "==", "active"), where("createdAt", ">=", startOfTodayTs))
          ),
          getCountFromServer(query(collection(db, "users"), where("createdAt", ">=", startOfTodayTs))).catch(() => null),
          getCountFromServer(
            query(collection(db, "products"), where("status", "==", "active"), where("expiresAt", "<", nowTs))
          ),
          getCountFromServer(query(collection(db, "jobs"), where("deadline", "<", todayDateStr))),
          getCountFromServer(
            query(
              collection(db, "products"),
              where("status", "==", "active"),
              where("plan", "in", ["premium_weekly", "premium_monthly"]),
              where("expiresAt", ">", nowTs),
              where("expiresAt", "<=", in48h)
            )
          ),
          getCountFromServer(query(collection(db, "payments"), where("status", "==", "failed"))),
        ]);

        const next: DashboardStatsCache = {
          totalUsers: usersSnapshot.data().count,
          activeAdverts: activeAdvertsSnapshot.data().count,
          totalJobs: jobsSnapshot.data().count,
          successfulPayments: paymentsSnapshot.data().count,
          pendingReportsCount: reportsCountSnapshot.data().count,
          pendingSupportCount: supportCountSnapshot.data().count,
          todayActiveAdverts: activeTodaySnap.data().count,
          todayNewUsers: newUsersSnap ? newUsersSnap.data().count : null,
          expiredCount: expiredAdvertsSnap.data().count + expiredJobsSnap.data().count,
          premiumExpiringSoon: premiumExpiringSnap.data().count,
          failedPayments: failedPaymentsSnap.data().count,
          timestamp: Date.now(),
        };

        setTotalUsers(next.totalUsers);
        setActiveAdverts(next.activeAdverts);
        setTotalJobs(next.totalJobs);
        setSuccessfulPayments(next.successfulPayments);
        setPendingReportsCount(next.pendingReportsCount);
        setPendingSupportCount(next.pendingSupportCount);
        setTodayActiveAdverts(next.todayActiveAdverts);
        setTodayNewUsers(next.todayNewUsers);
        setExpiredCount(next.expiredCount);
        setPremiumExpiringSoon(next.premiumExpiringSoon);
        setFailedPayments(next.failedPayments);
        setInsightsLoading(false);

        dashboardStatsCache = next;
      } catch (error) {
        console.error("ADMIN DASHBOARD - STATS FAILED:", error);
        setStatsError(
          error instanceof Error ? error.message : "Unable to load dashboard statistics."
        );
      } finally {
        setStatsLoading(false);
      }
    }

    loadDashboardStats();
  }, [adminLoading, user, isAdmin, overviewRefreshKey]);



  // -------------------------------------------------------
  // REPORTS — live subscription, only once admin confirmed
  // ✅ KEPT REALTIME - needed for moderation queue
  // -------------------------------------------------------
  useEffect(() => {
    if (adminLoading || !user || !isAdmin) return;

    const q = query(
      collection(db, "reports"),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const reportsList = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductReport));
        setReports(reportsList);
        setReportsLoading(false);

        const counts: Record<string, number> = {};
        reportsList.forEach((r) => {
          if (r.sellerId) counts[r.sellerId] = (counts[r.sellerId] ?? 0) + 1;
        });
        setReportCountsBySeller(counts);
      },
      (error) => {
        console.error("Failed to load reports:", error);
        setReportsLoading(false);
      }
    );

    return () => unsub();
  }, [adminLoading, user, isAdmin]);

  // -------------------------------------------------------
  // SUPPORT REPORTS — live subscription, only once admin confirmed
  // ✅ KEPT REALTIME - needed for urgent support issues
  // -------------------------------------------------------
  useEffect(() => {
    if (adminLoading || !user || !isAdmin) return;

    const q = query(
      collection(db, "supportReports"),
      where("status", "==", "open"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setSupportReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupportReport)));
        setSupportReportsLoading(false);
      },
      (error) => {
        console.error("Failed to load support reports:", error);
        setSupportReportsLoading(false);
      }
    );

    return () => unsub();
  }, [adminLoading, user, isAdmin]);

  // -------------------------------------------------------
  // USERS — loaded lazily when tab is opened
  // -------------------------------------------------------
  async function loadUsers(force = false) {
    if (usersLoaded && !force) return;
    setUsersLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(50)));
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdminUser)));
      setUsersLoaded(true);
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setUsersLoading(false);
    }
  }

  // Prefix search on displayName. Firestore range query: matches any
  // name starting with the typed text (case-sensitive — matches how
  // displayName is actually stored). Bounded to 20 results.
  async function searchUsers(rawQuery: string) {
    const q = rawQuery.trim();
    if (!q) {
      setUserSearchResults(null);
      return;
    }
    setUserSearchLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "users"),
          orderBy("displayName"),
          where("displayName", ">=", q),
          where("displayName", "<=", q + "\uf8ff"),
          limit(20)
        )
      );
      setUserSearchResults(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdminUser)));
    } catch (error) {
      console.error("Failed to search users:", error);
      setUserSearchResults([]);
    } finally {
      setUserSearchLoading(false);
    }
  }

  // -------------------------------------------------------
  // ADVERTS — loaded lazily when tab is opened
  // -------------------------------------------------------
  async function loadAdverts(force = false) {
    if (advertsLoaded && !force) return;
    setAdvertsLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "products"), orderBy("createdAt", "desc"), limit(50))
      );
      setAdverts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdminProduct)));
      setAdvertsLoaded(true);
    } catch (error) {
      console.error("Failed to load adverts:", error);
    } finally {
      setAdvertsLoading(false);
    }
  }

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    if (tab === "users") loadUsers();
    if (tab === "adverts") loadAdverts();
    if (tab === "jobs") loadJobs();
    if (tab === "marketers") loadMarketers();
    if (tab === "applications") loadApplications();
    if (tab === "payments") loadPayments();
    if (tab === "payouts") loadPayouts(payoutMonth);
    if (tab === "leaderboard") loadLeaderboard();
    if (tab === "auditlog") loadAuditLog();
  }

  // -------------------------------------------------------
  // REPORT ACTIONS
  // -------------------------------------------------------
  async function dismissReport(reportId: string) {
    setProcessingReportId(reportId);
    try {
      await updateDoc(doc(db, "reports", reportId), { status: "dismissed" });
    } catch (error) {
      console.error("Failed to dismiss report:", error);
    } finally {
      setProcessingReportId(null);
    }
  }
  async function resolveSupportReport(reportId: string) {
    setProcessingSupportReportId(reportId);
    try {
      await updateDoc(doc(db, "supportReports", reportId), { status: "resolved" });
    } catch (error) {
      console.error("Failed to resolve support report:", error);
    } finally {
      setProcessingSupportReportId(null);
    }
  }

  async function dismissSupportReport(reportId: string) {
    setProcessingSupportReportId(reportId);
    try {
      await updateDoc(doc(db, "supportReports", reportId), { status: "dismissed" });
    } catch (error) {
      console.error("Failed to dismiss support report:", error);
    } finally {
      setProcessingSupportReportId(null);
    }
  }

  async function removeReportedAdvert(report: ProductReport) {
    if (!confirm(`Delete "${report.productTitle}"? This cannot be undone.`)) return;
    setProcessingReportId(report.id);
    try {
      const deleteAdvert = httpsCallable(functions, "deleteAdvert");
      await deleteAdvert({ productId: report.productId });
      await updateDoc(doc(db, "reports", report.id), { status: "resolved" });
    } catch (error) {
      console.error("Failed to remove reported advert:", error);
      alert("Failed to delete the advert. It may already be removed.");
    } finally {
      setProcessingReportId(null);
    }
  }

  async function toggleUserBlock(targetUser: AdminUser) {
    const willBlock = !targetUser.blocked;
    const reason = willBlock ? prompt("Reason for blocking this user (optional):") ?? "" : "";

    setProcessingUserId(targetUser.id);
    try {
      await updateDoc(doc(db, "users", targetUser.id), {
        blocked: willBlock,
        blockReason: willBlock ? reason : "",
        blockedAt: willBlock ? new Date().toISOString() : null,
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === targetUser.id ? { ...u, blocked: willBlock, blockReason: reason } : u
        )
      );

      if (user) {
        addDoc(collection(db, "adminAuditLog"), {
          adminUid: user.uid,
          action: willBlock ? "block_user" : "unblock_user",
          targetUid: targetUser.id,
          reason: willBlock ? reason : "",
          createdAt: serverTimestamp(),
        }).catch((err) => console.error("Failed to write audit log:", err));
      }
    } catch (error) {
      console.error("Failed to update block status:", error);
      alert("Failed to update user status.");
    } finally {
      setProcessingUserId(null);
    }
  }

  async function sendAdminMessage() {
    if (!messageTarget || !messageTitle.trim() || !messageBody.trim()) return;
    setSendingMessage(true);
    try {
      const adminSendNotification = httpsCallable(functions, "adminSendNotification");
      await adminSendNotification({
        uid: messageTarget.id,
        title: messageTitle.trim(),
        body: messageBody.trim(),
      });
      alert(`Message sent to ${messageTarget.displayName || messageTarget.id}.`);
      setMessageTarget(null);
      setMessageTitle("");
      setMessageBody("");
    } catch (error) {
      console.error("Failed to send admin notification:", error);
      alert("Failed to send message. The user may not have notifications enabled.");
    } finally {
      setSendingMessage(false);
    }
  }

  // -------------------------------------------------------
  // ADVERT ACTIONS
  // -------------------------------------------------------
  async function deleteAdvertDirect(productId: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setProcessingAdvertId(productId);
    try {
      const deleteAdvert = httpsCallable(functions, "deleteAdvert");
      await deleteAdvert({ productId });
      setAdverts((prev) => prev.filter((a) => a.id !== productId));
    } catch (error) {
      console.error("Failed to delete advert:", error);
      alert("Failed to delete the advert.");
    } finally {
      setProcessingAdvertId(null);
    }
  }

  // Wait while Firebase checks the admin custom claim
  if (adminLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ ...rootVars, background: "var(--pd-paper)" }}
      >
        <p className="text-sm text-[var(--pd-ink-soft)]" style={fontMono}>
          Checking administrator access…
        </p>
      </div>
    );
  }

  if (!user) {
    navigate("/login");
    return null;
  }

  if (!isAdmin) {
    navigate("/");
    return null;
  }

  const stats = [
    { title: "Total users", value: totalUsers, icon: Users },
    { title: "Active adverts", value: activeAdverts, icon: Package },
    { title: "Jobs", value: totalJobs, icon: Briefcase },
    { title: "Payments", value: successfulPayments, icon: CreditCard },
    { title: "Support reports", value: pendingSupportCount, icon: Flag },
  ];

  const insightCards = [
    { label: "Active adverts today", value: todayActiveAdverts, accent: "var(--pd-green)" },
    { label: "New users today", value: todayNewUsers, accent: "var(--pd-ink)" },
    { label: "Expired adverts & jobs", value: expiredCount, accent: "var(--pd-rust)" },
    { label: "Premium expiring soon", value: premiumExpiringSoon, accent: "var(--pd-gold)" },
    { label: "Failed M-Pesa payments", value: failedPayments, accent: "var(--pd-rust)" },
  ];

  const menuItems: { title: string; icon: typeof Users; tab: Tab; badge?: number | null }[] = [
    { title: "Overview", icon: LayoutDashboard, tab: "overview" },
    { title: "Users", icon: Users, tab: "users" },
    { title: "Brand Ambassador Applications", icon: Megaphone, tab: "applications", badge: applicationsLoaded ? applications.length : null },
    { title: "Create Listing", icon: Plus, tab: "createListing" },
    { title: "Brand Ambassadors", icon: Megaphone, tab: "marketers" },
    { title: "Adverts", icon: Package, tab: "adverts" },
    { title: "Jobs", icon: Briefcase, tab: "jobs" },
    { title: "Payments", icon: CreditCard, tab: "payments" },
    { title: "Reports", icon: Flag, tab: "reports", badge: pendingReportsCount },
    { title: "Support", icon: Flag, tab: "support", badge: pendingSupportCount },
    { title: "Payouts", icon: CreditCard, tab: "payouts" },
    { title: "Leaderboard", icon: TrendingUp, tab: "leaderboard" },
    ...(isOwner ? [{ title: "Audit log", icon: Shield, tab: "auditlog" as Tab }] : []),
  ];

  // Function to refresh overview stats
  const refreshOverview = () => {
    dashboardStatsCache = null;
    setOverviewRefreshKey((k) => k + 1);
  };

  return (
    <div
      className="min-h-screen"
      style={{ ...rootVars, background: "var(--pd-paper)", color: "var(--pd-ink)", fontFamily: "var(--pd-font-sans)" }}
    >
      {/*
        Fonts: for production, move this @import into index.html as
        preloaded <link> tags (matches the preconnect pattern already
        used elsewhere) rather than an in-component @import.
      */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');`}</style>

      {/* Header */}
      <header className="border-b" style={{ borderColor: "var(--pd-line)" }}>
        <div className="flex h-16 items-center justify-between px-4 md:px-8">
          <div>
            <h1 className="text-xl" style={{ ...fontSerif, fontWeight: 600 }}>
              BizMtaani
            </h1>
            <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5">Admin console</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{user.displayName || "Administrator"}</p>
              <p className="text-xs text-[var(--pd-ink-soft)]" style={fontMono}>
                {user.email || "Admin account"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex items-center gap-2 border px-3 py-2 text-sm transition-colors hover:bg-[var(--pd-ink)]/5"
              style={{ borderColor: "var(--pd-line)" }}
            >
              <LogOut className="h-4 w-4" />
              Exit
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside
          className="hidden min-h-[calc(100vh-4rem)] w-64 md:block"
          style={{ background: "var(--pd-ink)" }}
        >
          <nav className="py-4">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.tab;
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => selectTab(item.tab)}
                  className={`${navItemBase} ${active ? navItemActive : navItemInactive}`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    {item.title}
                  </span>
                  {!!item.badge && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5"
                      style={{ ...fontMono, background: "var(--pd-rust)", color: "#fff" }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile tab bar */}
        <div
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex overflow-x-auto no-scrollbar border-t"
          style={{ background: "var(--pd-ink)", borderColor: "var(--pd-line)" }}
        >
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.tab;
            return (
              <button
                key={item.title}
                onClick={() => selectTab(item.tab)}
                className="flex-1 min-w-[70px] flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium relative"
                style={{ color: active ? "var(--pd-paper)" : "#8C9A87" }}
              >
                <Icon className="h-5 w-5" />
                {item.title}
                {!!item.badge && (
                  <span
                    className="absolute top-1 right-3 w-2 h-2 rounded-full"
                    style={{ background: "var(--pd-rust)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8">
          {activeTab === "overview" && (
            <>
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>
                    Overview
                  </h2>
                  <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                    Monitor and manage the BizMtaani marketplace.
                  </p>
                </div>
                <RefreshButton onClick={refreshOverview} />
              </div>

              <div
                className={`grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 ${panelCls}`}
                style={{ borderColor: "var(--pd-line)" } as React.CSSProperties}
              >
                <style>{`.pd-divide > * { border-color: var(--pd-line); }`}</style>
                {stats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.title} className="p-5" style={{ borderColor: "var(--pd-line)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-[var(--pd-ink-soft)]">{stat.title}</p>
                        <Icon className="h-4 w-4 text-[var(--pd-ink-soft)]" />
                      </div>
                      <p className="text-2xl" style={fontMono}>
                        {statsLoading ? "…" : stat.value ?? "—"}
                      </p>
                    </div>
                  );
                })}
              </div>

              {statsError && (
                <div
                  className="mt-6 border p-4"
                  style={{ borderColor: "var(--pd-rust)", background: "var(--pd-rust-soft)" }}
                >
                  <p className="text-sm" style={{ color: "var(--pd-rust)" }}>{statsError}</p>
                </div>
              )}

              <div className="mt-10">
                <h3 className="text-sm text-[var(--pd-ink-soft)] mb-3">Today's insights</h3>
                <div className={`grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 ${panelCls}`}>
                  {insightCards.map((card) => (
                    <div
                      key={card.label}
                      className="p-4 border-l-[3px]"
                      style={{ borderLeftColor: card.accent, borderColor: "var(--pd-line)" }}
                    >
                      <p className="text-xl" style={fontMono}>
                        {insightsLoading ? "…" : card.value ?? "—"}
                      </p>
                      <p className="text-xs text-[var(--pd-ink-soft)] mt-1">{card.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {!!pendingReportsCount && (
                <button
                  onClick={() => selectTab("reports")}
                  className="mt-6 w-full flex items-center justify-between border-l-[3px] p-4 text-left transition-colors hover:bg-[var(--pd-rust)]/5"
                  style={{ borderLeftColor: "var(--pd-rust)", background: "var(--pd-rust-soft)" }}
                >
                  <div className="flex items-center gap-3">
                    <Flag className="h-4 w-4" style={{ color: "var(--pd-rust)" }} />
                    <div>
                      <p className="font-medium text-sm">
                        {pendingReportsCount} pending report{pendingReportsCount === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-[var(--pd-ink-soft)]">Needs your review</p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-[var(--pd-ink-soft)]" />
                </button>
              )}
              {!!pendingSupportCount && (
                <button
                  onClick={() => selectTab("support")}
                  className="mt-3 w-full flex items-center justify-between border-l-[3px] p-4 text-left transition-colors hover:bg-[var(--pd-rust)]/5"
                  style={{ borderLeftColor: "var(--pd-rust)", background: "var(--pd-rust-soft)" }}
                >
                  <div className="flex items-center gap-3">
                    <Flag className="h-4 w-4" style={{ color: "var(--pd-rust)" }} />
                    <div>
                      <p className="font-medium text-sm">
                        {pendingSupportCount} support report{pendingSupportCount === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-[var(--pd-ink-soft)]">Needs your review</p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-[var(--pd-ink-soft)]" />
                </button>
              )}
            </>
          )}

          {activeTab === "reports" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Reports</h2>
                <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                  Adverts flagged by users, awaiting review. Live updates.
                </p>
              </div>

              {reportsLoading ? (
                <Spinner />
              ) : reports.length === 0 ? (
                <EmptyState>No pending reports. All clear.</EmptyState>
              ) : (
                <div className={`${panelCls} divide-y`} style={{ borderColor: "var(--pd-line)" }}>
                  {reports.map((report) => (
                    <div key={report.id} className="p-4 space-y-3" style={{ borderColor: "var(--pd-line)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{report.productTitle}</p>
                          <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5">
                            Reason: <span style={{ color: "var(--pd-ink)" }}>{report.reason}</span>
                          </p>
                          <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5" style={fontMono}>
                            {timeAgo(report.createdAt)}
                          </p>
                        </div>
                        <a
                          href={`/product/${report.productId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-shrink-0 flex items-center gap-1 text-xs font-medium hover:underline"
                          style={{ color: "var(--pd-ink)" }}
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => dismissReport(report.id)}
                          disabled={processingReportId === report.id}
                          className={btnGhostSmall}
                        >
                          <Check className="h-3.5 w-3.5" /> Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => removeReportedAdvert(report)}
                          disabled={processingReportId === report.id}
                          className={`flex-1 ${btnDanger}`}
                        >
                          {processingReportId === report.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <Trash2 className="h-3.5 w-3.5" /> Delete advert
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "support" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Support reports</h2>
                <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                  Problems reported directly by users. Live updates.
                </p>
              </div>

              {supportReportsLoading ? (
                <Spinner />
              ) : supportReports.length === 0 ? (
                <EmptyState>No open support reports. All clear.</EmptyState>
              ) : (
                <div className={`${panelCls} divide-y`} style={{ borderColor: "var(--pd-line)" }}>
                  {supportReports.map((report) => (
                    <div key={report.id} className="p-4 space-y-3" style={{ borderColor: "var(--pd-line)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm capitalize">{report.type}</span>
                            {report.priority === "high" && (
                              <span
                                className="text-[10px] font-medium px-1.5 py-0.5"
                                style={{ background: "var(--pd-rust)", color: "#fff" }}
                              >
                                high
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-[var(--pd-ink-soft)] mt-1 whitespace-pre-wrap">
                            {report.description}
                          </p>
                          {report.advertId && (
                            <p className="text-xs text-[var(--pd-ink-soft)] mt-1">
                              Advert ID: <span style={fontMono}>{report.advertId}</span>
                            </p>
                          )}
                          <p className="text-xs text-[var(--pd-ink-soft)] mt-1">
                            {report.userEmail || report.contact || "No contact provided"}
                            {" · "}
                            <span style={fontMono}>{timeAgo(report.createdAt)}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => dismissSupportReport(report.id)}
                          disabled={processingSupportReportId === report.id}
                          className={btnGhostSmall}
                        >
                          <X className="h-3.5 w-3.5" /> Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveSupportReport(report.id)}
                          disabled={processingSupportReportId === report.id}
                          className={`flex-1 ${btnConfirm}`}
                        >
                          {processingSupportReportId === report.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <Check className="h-3.5 w-3.5" /> Mark resolved
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "users" && (
            <>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Users</h2>
                  <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                    {userSearchResults !== null
                      ? `${userSearchResults.length} result${userSearchResults.length === 1 ? "" : "s"} for "${userSearchQuery}"`
                      : "Most recent 50 users."}
                  </p>
                </div>
                <RefreshButton onClick={() => loadUsers(true)} />
              </div>

              <div className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchUsers(userSearchQuery); }}
                  placeholder="Search by name (case-sensitive, matches start of name)…"
                  className="flex-1 h-10 px-3 border text-sm bg-[var(--pd-surface)]"
                  style={{ borderColor: "var(--pd-line)" }}
                />
                <button type="button" onClick={() => searchUsers(userSearchQuery)} className={btnGhost}>
                  Search
                </button>
                {userSearchResults !== null && (
                  <button
                    type="button"
                    onClick={() => { setUserSearchQuery(""); setUserSearchResults(null); }}
                    className={btnGhost}
                  >
                    Clear
                  </button>
                )}
              </div>

              {usersLoading || userSearchLoading ? (
                <Spinner />
              ) : (
                <div className={`${panelCls} overflow-hidden overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead style={{ borderBottom: "1px solid var(--pd-line)" }}>
                      <tr>
                        <th className={thCls}>Name</th>
                        <th className={thCls}>Plan</th>
                        <th className={thCls}>Role</th>
                        <th className={thCls}>Status</th>
                        <th className={`${thCls} text-right`}>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {(userSearchResults ?? users).map((u) => {
                        const reportCount = reportCountsBySeller[u.id] ?? 0;
                        return (
                          <tr key={u.id} className="border-t" style={{ borderColor: "var(--pd-line)" }}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div>
                                  <p>{u.displayName || "—"}</p>
                                  {(u as any).email && (
                                    <p className="text-xs text-[var(--pd-ink-soft)]">{(u as any).email}</p>
                                  )}
                                </div>
                                {reportCount > 0 && (
                                  <span
                                    title={`${reportCount} pending report(s)`}
                                    className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5"
                                    style={{ background: "var(--pd-gold-soft)", color: "var(--pd-gold)" }}
                                  >
                                    {reportCount} flagged
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={tdMuted}>{u.subscriptionPlan ?? "free"}</td>
                            <td className="px-4 py-3">
                              {u.role === "admin" ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium">
                                  <Shield className="h-3 w-3" /> Admin
                                </span>
                              ) : (
                                <span className="text-xs text-[var(--pd-ink-soft)]">User</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {u.blocked ? (
                                <StatusDot color="var(--pd-rust)" label={u.blockReason || "blocked"} />
                              ) : (
                                <StatusDot color="var(--pd-green)" label="active" />
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <button type="button" onClick={() => setMessageTarget(u)} className={linkInk}>
                                  Message
                                </button>
                                {u.role !== "admin" && (
                                  <button
                                    type="button"
                                    onClick={() => makeMarketer(u)}
                                    disabled={processingUserId === u.id}
                                    className={linkGreen}
                                  >
                                    {processingUserId === u.id ? "…" : "Make Brand Ambassador"}
                                  </button>
                                )}
                                {u.role !== "admin" && (
                                  <button
                                    type="button"
                                    onClick={() => toggleUserBlock(u)}
                                    disabled={processingUserId === u.id}
                                    className={u.blocked ? linkGreen : linkRust}
                                  >
                                    {processingUserId === u.id ? "…" : u.blocked ? "Unblock" : "Block"}
                                  </button>
                                )}
                                {u.role !== "admin" && isOwner && (
                                  <button
                                    type="button"
                                    onClick={() => grantAdmin(u)}
                                    disabled={processingUserId === u.id}
                                    className={linkInk}
                                  >
                                    {processingUserId === u.id ? "…" : "Grant admin"}
                                  </button>
                                )}
                                {u.role === "admin" && isOwner && u.id !== user?.uid && (
                                  <button
                                    type="button"
                                    onClick={() => revokeAdmin(u)}
                                    disabled={processingUserId === u.id}
                                    className={linkRust}
                                  >
                                    {processingUserId === u.id ? "…" : "Revoke admin"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === "adverts" && (
            <>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Adverts</h2>
                  <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">Most recent 50 adverts.</p>
                </div>
                <RefreshButton onClick={() => loadAdverts(true)} />
              </div>

              {advertsLoading ? (
                <Spinner />
              ) : (
                <div className={`${panelCls} divide-y`} style={{ borderColor: "var(--pd-line)" }}>
                  {adverts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 p-4"
                      style={{ borderColor: "var(--pd-line)" }}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{a.title}</p>
                        <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5">
                          {a.category} · {a.status} · <span style={fontMono}>{timeAgo(a.createdAt)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <a
                          href={`/product/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className={linkInk}
                        >
                          View
                        </a>
                        <button
                          type="button"
                          onClick={() => deleteAdvertDirect(a.id, a.title)}
                          disabled={processingAdvertId === a.id}
                          className={linkRust}
                        >
                          {processingAdvertId === a.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "jobs" && (
            <>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Jobs</h2>
                  <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">Most recent 50 job posts.</p>
                </div>
                <RefreshButton onClick={() => loadJobs(true)} />
              </div>

              {jobsLoading ? (
                <Spinner />
              ) : jobs.length === 0 ? (
                <EmptyState>No job posts yet.</EmptyState>
              ) : (
                <div className={`${panelCls} divide-y`} style={{ borderColor: "var(--pd-line)" }}>
                  {jobs.map((j) => {
                    const expired = isJobExpired(j.deadline);
                    return (
                      <div
                        key={j.id}
                        className="flex items-center justify-between gap-3 p-4"
                        style={{ borderColor: "var(--pd-line)" }}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{j.title || "Untitled"}</p>
                          <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5">
                            {j.company || "—"} · {j.jobType || "—"}
                            {expired && (
                              <span className="ml-2 font-medium" style={{ color: "var(--pd-rust)" }}>Expired</span>
                            )}
                            {" · "}
                            <span style={fontMono}>{timeAgo(j.createdAt)}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <a href={`/jobs/${j.id}`} target="_blank" rel="noreferrer" className={linkInk}>
                            View
                          </a>
                          <button
                            type="button"
                            onClick={() => deleteJobDirect(j.id, j.title || "this job")}
                            disabled={processingJobId === j.id}
                            className={linkRust}
                          >
                            {processingJobId === j.id ? "…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === "applications" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Brand Ambassador applications</h2>
                <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                  Pending applications from users wanting to become Brand Ambassadors.
                </p>
              </div>

              {applicationsLoading ? (
                <Spinner />
              ) : applications.length === 0 ? (
                <EmptyState>No pending applications.</EmptyState>
              ) : (
                <div className={`${panelCls} divide-y`} style={{ borderColor: "var(--pd-line)" }}>
                  {applications.map((a) => (
                    <div key={a.id} className="p-4 space-y-3" style={{ borderColor: "var(--pd-line)" }}>
                      <div>
                        <p className="font-medium text-sm">{a.fullName || "Unnamed applicant"}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-[var(--pd-ink-soft)]">
                          <span>Email: {a.email || "—"}</span>
                          <span>ID: {a.idNumber || "—"}</span>
                          <span>M-Pesa: {a.mpesaNumber || "—"}</span>
                        </div>
                        {a.reason && (
                          <p className="text-sm text-[var(--pd-ink-soft)] mt-2 whitespace-pre-wrap">{a.reason}</p>
                        )}
                        <p className="text-xs text-[var(--pd-ink-soft)] mt-2" style={fontMono}>
                          {timeAgo(a.createdAt)}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => rejectApplication(a)}
                          disabled={processingApplicationId === a.id}
                          className={btnGhostSmall}
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => approveApplication(a)}
                          disabled={processingApplicationId === a.id}
                          className={`flex-1 ${btnConfirm}`}
                        >
                          {processingApplicationId === a.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <Check className="h-3.5 w-3.5" /> Approve
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "createListing" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Create listing</h2>
                <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                  Create a free, unclaimed listing on a business's behalf. They'll get a claim link to make it their own — it never counts against their 3 free adverts.
                </p>
              </div>

              <div className={`${panelCls} p-5 space-y-4 max-w-lg`}>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Business name *</label>
                  <input
                    type="text"
                    value={newListingTitle}
                    onChange={(e) => setNewListingTitle(e.target.value)}
                    className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                    style={{ borderColor: "var(--pd-line)" }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Category *</label>
                    <input
                      type="text"
                      value={newListingCategory}
                      onChange={(e) => setNewListingCategory(e.target.value)}
                      placeholder="e.g. Services"
                      className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                      style={{ borderColor: "var(--pd-line)" }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Subcategory</label>
                    <input
                      type="text"
                      value={newListingSubcategory}
                      onChange={(e) => setNewListingSubcategory(e.target.value)}
                      placeholder="e.g. Plumbing & Electrical"
                      className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                      style={{ borderColor: "var(--pd-line)" }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Ward *</label>
                    <input
                      type="text"
                      value={newListingWard}
                      onChange={(e) => setNewListingWard(e.target.value)}
                      className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                      style={{ borderColor: "var(--pd-line)" }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Constituency</label>
                    <input
                      type="text"
                      value={newListingConstituency}
                      onChange={(e) => setNewListingConstituency(e.target.value)}
                      className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                      style={{ borderColor: "var(--pd-line)" }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pd-ink-soft)]">County</label>
                    <input
                      type="text"
                      value={newListingCounty}
                      onChange={(e) => setNewListingCounty(e.target.value)}
                      className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                      style={{ borderColor: "var(--pd-line)" }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Price (KES)</label>
                    <input
                      type="number"
                      value={newListingPrice}
                      onChange={(e) => setNewListingPrice(e.target.value)}
                      className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                      style={{ borderColor: "var(--pd-line)" }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Owner phone (WhatsApp) *</label>
                    <input
                      type="text"
                      value={newListingPhone}
                      onChange={(e) => setNewListingPhone(e.target.value)}
                      placeholder="+2547..."
                      className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                      style={{ borderColor: "var(--pd-line)" }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={createListing}
                  disabled={creatingListing}
                  className={`${btnPrimary} w-full flex items-center justify-center gap-2`}
                >
                  {creatingListing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {creatingListing ? "Creating…" : "Create listing"}
                </button>

                {lastCreatedClaimUrl && (
                  <div
                    className="p-3 border text-xs space-y-1"
                    style={{ borderColor: "var(--pd-green)", background: "var(--pd-green-soft)" }}
                  >
                    <p className="font-medium" style={{ color: "var(--pd-green)" }}>Listing created. Send this claim link to the owner:</p>
                    <p style={fontMono}>{lastCreatedClaimUrl}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === "marketers" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Brand Ambassadors</h2>
                <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                  Approved Brand Ambassadors and their commission earnings. To approve a new one, use "Make Brand Ambassador" on the Users tab.
                </p>
              </div>

              {marketersLoading ? (
                <Spinner />
              ) : marketers.length === 0 ? (
                <EmptyState>No Brand Ambassadors approved yet.</EmptyState>
              ) : (
                <div className={`${panelCls} overflow-hidden overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead style={{ borderBottom: "1px solid var(--pd-line)" }}>
                      <tr>
                        <th className={thCls}>Code</th>
                        <th className={thCls}>Name / email</th>
                        <th className={thCls}>Status</th>
                        <th className={thCls}>Today</th>
                        <th className={thCls}>Onboarded</th>
                        <th className={thCls}>Premium</th>
                        <th className={thCls}>Earned</th>
                        <th className={thCls}>Paid out</th>
                        <th className={thCls}>Balance</th>
                        <th className={`${thCls} text-right`}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketers.map((m) => {
                        const earned = m.totalEarnedKES ?? 0;
                        const paid = m.totalWithdrawnKES ?? 0;
                        const stats = onboardingStats[m.id];
                        return (
                          <tr key={m.id} className="border-t" style={{ borderColor: "var(--pd-line)" }}>
                            <td className="px-4 py-3" style={fontMono}>{m.referralCode ?? "—"}</td>
                            <td className="px-4 py-3">
                              <p>{m.fullName || "—"}</p>
                              <p className="text-xs text-[var(--pd-ink-soft)]">{m.email || "—"}</p>
                            </td>
                            <td className="px-4 py-3">
                              {m.status === "suspended" ? (
                                <StatusDot color="var(--pd-rust)" label="suspended" />
                              ) : (
                                <StatusDot color="var(--pd-green)" label="active" />
                              )}
                            </td>
                            <td className="px-4 py-3" style={fontMono}>{stats ? stats.today : "…"}</td>
                            <td className="px-4 py-3" style={fontMono}>{stats ? stats.totalOnboarded : "…"}</td>
                            <td className="px-4 py-3" style={fontMono}>{stats ? stats.premiumCount : "…"}</td>
                            <td className="px-4 py-3" style={fontMono}>KES {earned.toLocaleString("en-GB")}</td>
                            <td className="px-4 py-3" style={fontMono}>KES {paid.toLocaleString("en-GB")}</td>
                            <td className="px-4 py-3 font-medium" style={fontMono}>
                              KES {(earned - paid).toLocaleString("en-GB")}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => toggleMarketerStatus(m)}
                                disabled={processingMarketerId === m.id}
                                className={m.status === "suspended" ? linkGreen : linkRust}
                              >
                                {processingMarketerId === m.id
                                  ? "…"
                                  : m.status === "suspended"
                                  ? "Reactivate"
                                  : "Suspend"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === "payouts" && (
            <>
              <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Brand Ambassador payouts</h2>
                  <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">Monthly commission owed to each Brand Ambassador.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={payoutMonth}
                    onChange={(e) => setPayoutMonth(e.target.value)}
                    className="border px-3 py-2 text-sm bg-[var(--pd-surface)]"
                    style={{ borderColor: "var(--pd-line)" }}
                  />
                  <button type="button" onClick={() => loadPayouts(payoutMonth)} className={btnGhost}>
                    Load
                  </button>
                </div>
              </div>

              {payoutsLoading ? (
                <Spinner />
              ) : payouts.length === 0 ? (
                <EmptyState>
                  No payout data for {payoutMonth}. It may not have closed yet, or no Brand Ambassadors earned commissions.
                </EmptyState>
              ) : (
                <div className={`${panelCls} overflow-hidden overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead style={{ borderBottom: "1px solid var(--pd-line)" }}>
                      <tr>
                        <th className={thCls}>Code</th>
                        <th className={thCls}>Sign-ups</th>
                        <th className={thCls}>Earned</th>
                        <th className={thCls}>Status</th>
                        <th className={`${thCls} text-right`}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((p) => (
                        <tr key={p.id} className="border-t" style={{ borderColor: "var(--pd-line)" }}>
                          <td className="px-4 py-3" style={fontMono}>{p.referralCode ?? p.marketerUid}</td>
                          <td className="px-4 py-3" style={fontMono}>{p.signups}</td>
                          <td className="px-4 py-3 font-medium" style={fontMono}>
                            KES {p.earningsKES.toLocaleString("en-GB")}
                          </td>
                          <td className="px-4 py-3">
                            {p.paid ? (
                              <StatusDot color="var(--pd-green)" label="paid" />
                            ) : (
                              <StatusDot color="var(--pd-gold)" label="unpaid" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!p.paid && (
                              <button
                                type="button"
                                onClick={() => markPaid(p)}
                                disabled={processingPayoutId === p.id}
                                className={linkInk}
                              >
                                {processingPayoutId === p.id ? "…" : "Mark paid"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === "leaderboard" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Top Brand Ambassadors</h2>
                <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">Ranked by earnings this month.</p>
              </div>

              {leaderboardLoading ? (
                <Spinner />
              ) : leaderboard.length === 0 ? (
                <EmptyState>No Brand Ambassador earnings recorded yet this month.</EmptyState>
              ) : (
                <div className={`${panelCls} overflow-hidden overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead style={{ borderBottom: "1px solid var(--pd-line)" }}>
                      <tr>
                        <th className={thCls}>Rank</th>
                        <th className={thCls}>Code</th>
                        <th className={thCls}>Sign-ups</th>
                        <th className={thCls}>Earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((entry, index) => (
                        <tr key={entry.id} className="border-t" style={{ borderColor: "var(--pd-line)" }}>
                          <td className="px-4 py-3 font-medium" style={fontMono}>#{index + 1}</td>
                          <td className="px-4 py-3" style={fontMono}>{entry.referralCode ?? entry.id}</td>
                          <td className="px-4 py-3" style={fontMono}>{entry.signupsThisMonth}</td>
                          <td className="px-4 py-3 font-medium" style={fontMono}>
                            KES {entry.earningsThisMonth.toLocaleString("en-GB")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === "payments" && (
            <>
              <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Payments</h2>
                  <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">Most recent 50 successful M-Pesa payments.</p>
                </div>
                <RefreshButton onClick={() => loadPayments(true)} />
              </div>

              {paymentsLoading ? (
                <Spinner />
              ) : payments.length === 0 ? (
                <EmptyState>No completed payments found.</EmptyState>
              ) : (
                <div className={`${panelCls} overflow-hidden overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead style={{ borderBottom: "1px solid var(--pd-line)" }}>
                      <tr>
                        <th className={thCls}>Checkout ID</th>
                        <th className={thCls}>Plan</th>
                        <th className={thCls}>Amount</th>
                        <th className={thCls}>Status</th>
                        <th className={thCls}>Product</th>
                        <th className={thCls}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-t" style={{ borderColor: "var(--pd-line)" }}>
                          <td className="px-4 py-3 text-xs" style={fontMono}>{p.id.slice(0, 14)}…</td>
                          <td className={tdMuted}>{p.plan ?? "—"}</td>
                          <td className="px-4 py-3 font-medium" style={fontMono}>
                            {p.confirmedAmountKES != null ? `KES ${p.confirmedAmountKES.toLocaleString()}` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusDot color="var(--pd-green)" label="completed" />
                          </td>
                          <td className="px-4 py-3">
                            {p.productId ? (
                              <a
                                href={`/product/${p.productId}`}
                                target="_blank"
                                rel="noreferrer"
                                className={linkInk}
                              >
                                View
                              </a>
                            ) : (
                              <span className="text-xs text-[var(--pd-ink-soft)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--pd-ink-soft)]" style={fontMono}>
                            {timeAgo(p.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === "auditlog" && isOwner && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl" style={{ ...fontSerif, fontWeight: 600 }}>Audit log</h2>
                <p className="mt-1 text-sm text-[var(--pd-ink-soft)]">
                  Most recent 50 admin actions. Permanent — cannot be edited or deleted.
                </p>
              </div>

              {auditLogLoading ? (
                <Spinner />
              ) : auditLog.length === 0 ? (
                <EmptyState>No admin actions recorded yet.</EmptyState>
              ) : (
                <div className={`${panelCls} divide-y`} style={{ borderColor: "var(--pd-line)" }}>
                  {auditLog.map((entry) => (
                    <div key={entry.id} className="p-4" style={{ borderColor: "var(--pd-line)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm capitalize">
                            {entry.action.replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5">
                            By {adminNames[entry.adminUid] ?? entry.adminUid}
                            {entry.targetUid && <> · Target: <span style={fontMono}>{entry.targetUid}</span></>}
                          </p>
                          {entry.reason && (
                            <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5">Reason: {entry.reason}</p>
                          )}
                          {entry.referralCode && (
                            <p className="text-xs text-[var(--pd-ink-soft)] mt-0.5">
                              Code: <span style={fontMono}>{entry.referralCode}</span>
                            </p>
                          )}
                        </div>
                        <p className="text-xs text-[var(--pd-ink-soft)] flex-shrink-0" style={fontMono}>
                          {timeAgo(entry.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {messageTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`${panelCls} max-w-sm w-full p-6 space-y-4`} style={{ background: "var(--pd-surface)" }}>
            <div>
              <h3 className="text-lg" style={{ ...fontSerif, fontWeight: 600 }}>
                Message {messageTarget.displayName || messageTarget.id}
              </h3>
              <p className="text-xs text-[var(--pd-ink-soft)] mt-1">
                Sent as a push notification, if they have notifications enabled.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Title</label>
              <input
                type="text"
                value={messageTitle}
                onChange={(e) => setMessageTitle(e.target.value)}
                maxLength={100}
                placeholder="e.g. Regarding your advert"
                className="w-full h-10 px-3 border bg-[var(--pd-paper)] text-sm"
                style={{ borderColor: "var(--pd-line)" }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--pd-ink-soft)]">Message</label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                maxLength={500}
                placeholder="Type your message..."
                className="w-full min-h-[100px] px-3 py-2 border bg-[var(--pd-paper)] text-sm"
                style={{ borderColor: "var(--pd-line)" }}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMessageTarget(null);
                  setMessageTitle("");
                  setMessageBody("");
                }}
                disabled={sendingMessage}
                className={`flex-1 ${btnGhost} justify-center`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendAdminMessage}
                disabled={sendingMessage || !messageTitle.trim() || !messageBody.trim()}
                className={`flex-1 ${btnPrimary}`}
              >
                {sendingMessage ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
