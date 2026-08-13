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
} from "lucide-react";
import {
  collection,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";


type Tab = "overview" | "users" | "adverts" | "jobs" | "payments" | "reports" | "support" | "marketers" | "applications" | "payouts";
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

interface MarketerApplication {
  id: string;
  fullName?: string;
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
  timestamp: number;
}
let dashboardStatsCache: DashboardStatsCache | null = null;
const DASHBOARD_STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 3 minutes

export default function AdminDashboard() {
  const { user, isAdmin, adminLoading } = useAuth();
  const [, navigate] = useLocation();

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

// Marketers tab — lazily loaded, matches the pattern used elsewhere
  const [marketers, setMarketers] = useState<Marketer[]>([]);
  const [marketersLoading, setMarketersLoading] = useState(false);
  const [marketersLoaded, setMarketersLoaded] = useState(false);
  const [processingMarketerId, setProcessingMarketerId] = useState<string | null>(null);

  // Payouts tab — lazily loaded per selected month
  const [payoutMonth, setPayoutMonth] = useState(() => {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
});
const [payouts, setPayouts] = useState<Payout[]>([]);
const [payoutsLoading, setPayoutsLoading] = useState(false);
const [processingPayoutId, setProcessingPayoutId] = useState<string | null>(null);

  // Marketer applications tab — lazily loaded, bounded, matches the pattern used elsewhere
  const [applications, setApplications] = useState<MarketerApplication[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [processingApplicationId, setProcessingApplicationId] = useState<string | null>(null);
  
  async function loadJobs() {
    if (jobsLoaded) return;
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
      setMarketers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Marketer)));
      setMarketersLoaded(true);
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
    if (!confirm(`Approve "${targetUser.displayName || targetUser.id}" as a marketer?`)) return;
    setProcessingUserId(targetUser.id);
    try {
      const approveMarketer = httpsCallable(functions, "approveMarketer");
      const result = await approveMarketer({ uid: targetUser.id });
      const { referralCode } = result.data as { referralCode: string };
      alert(`Marketer approved. Their referral code is: ${referralCode}`);
      // Invalidate the marketers cache so the Marketers tab shows this
      // new entry next time it's opened, without an extra read now.
      setMarketersLoaded(false);
    } catch (error) {
      console.error("Failed to approve marketer:", error);
      alert("Failed to approve this user as a marketer.");
    } finally {
      setProcessingUserId(null);
    }
  }

  async function toggleMarketerStatus(marketer: Marketer) {
    const willSuspend = marketer.status !== "suspended";
    setProcessingMarketerId(marketer.id);
    try {
      await updateDoc(doc(db, "marketers", marketer.id), {
        status: willSuspend ? "suspended" : "active",
      });
      setMarketers((prev) =>
        prev.map((m) =>
          m.id === marketer.id ? { ...m, status: willSuspend ? "suspended" : "active" } : m
        )
      );
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
    if (!confirm(`Approve "${application.displayName || application.id}" as a marketer?`)) return;
    setProcessingApplicationId(application.id);
    try {
      const approveMarketer = httpsCallable(functions, "approveMarketer");
      const result = await approveMarketer({ uid: application.id });
      const { referralCode } = result.data as { referralCode: string };
      alert(`Marketer approved. Their referral code is: ${referralCode}`);
      setApplications((prev) => prev.filter((a) => a.id !== application.id));
      // Invalidate marketers cache so the Marketers tab reflects this on next open.
      setMarketersLoaded(false);
    } catch (error) {
      console.error("Failed to approve application:", error);
      alert("Failed to approve this application.");
    } finally {
      setProcessingApplicationId(null);
    }
  }

  async function rejectApplication(application: MarketerApplication) {
    if (!confirm(`Reject "${application.displayName || application.id}"'s application?`)) return;
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
      setStatsLoading(false);
      return;
    }

    async function loadDashboardStats() {
      try {
        setStatsLoading(true);
        setStatsError("");

        const usersSnapshot = await getCountFromServer(collection(db, "users"));
        const activeAdvertsSnapshot = await getCountFromServer(
          query(collection(db, "products"), where("status", "==", "active"))
        );
        const jobsSnapshot = await getCountFromServer(collection(db, "jobs"));
        const paymentsSnapshot = await getCountFromServer(
          query(collection(db, "payments"), where("status", "==", "completed"))
        );
        const reportsCountSnapshot = await getCountFromServer(
          query(collection(db, "reports"), where("status", "==", "pending"))
        );
        const supportCountSnapshot = await getCountFromServer(
          query(collection(db, "supportReports"), where("status", "==", "open"))
        );

        const next: DashboardStatsCache = {
          totalUsers: usersSnapshot.data().count,
          activeAdverts: activeAdvertsSnapshot.data().count,
          totalJobs: jobsSnapshot.data().count,
          successfulPayments: paymentsSnapshot.data().count,
          pendingReportsCount: reportsCountSnapshot.data().count,
          pendingSupportCount: supportCountSnapshot.data().count,
          timestamp: Date.now(),
        };

        setTotalUsers(next.totalUsers);
        setActiveAdverts(next.activeAdverts);
        setTotalJobs(next.totalJobs);
        setSuccessfulPayments(next.successfulPayments);
        setPendingReportsCount(next.pendingReportsCount);
        setPendingSupportCount(next.pendingSupportCount);

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
  }, [adminLoading, user, isAdmin]);
  
  useEffect(() => {
    if (adminLoading || !user || !isAdmin) return;

    async function loadInsights() {
      try {
        setInsightsLoading(true);

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startOfTodayTs = Timestamp.fromDate(startOfToday);
        const nowTs = Timestamp.now();
        const in48h = Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1000));
        const todayDateStr = startOfToday.toISOString().split("T")[0];

        // Active adverts posted today
        const activeTodaySnap = await getCountFromServer(
          query(
            collection(db, "products"),
            where("status", "==", "active"),
            where("createdAt", ">=", startOfTodayTs)
          )
        );
        setTodayActiveAdverts(activeTodaySnap.data().count);

        // New users today — adjust field/format if your users store createdAt differently
        try {
          const newUsersSnap = await getCountFromServer(
            query(
              collection(db, "users"),
              where("createdAt", ">=", startOfToday.toISOString())
            )
          );
          setTodayNewUsers(newUsersSnap.data().count);
        } catch {
          setTodayNewUsers(null);
        }

        // Expired adverts still marked active (not yet cleaned up)
        const expiredAdvertsSnap = await getCountFromServer(
          query(
            collection(db, "products"),
            where("status", "==", "active"),
            where("expiresAt", "<", nowTs)
          )
        );

        // Expired jobs (deadline passed) — deadline stored as "YYYY-MM-DD" string
        const expiredJobsSnap = await getCountFromServer(
          query(collection(db, "jobs"), where("deadline", "<", todayDateStr))
        );

        setExpiredCount(expiredAdvertsSnap.data().count + expiredJobsSnap.data().count);

        // Premium adverts expiring in the next 48 hours
        const premiumExpiringSnap = await getCountFromServer(
          query(
            collection(db, "products"),
            where("status", "==", "active"),
            where("plan", "in", ["premium_weekly", "premium_monthly"]),
            where("expiresAt", ">", nowTs),
            where("expiresAt", "<=", in48h)
          )
        );
        setPremiumExpiringSoon(premiumExpiringSnap.data().count);

        // Failed M-Pesa payments (requires the Cloud Function fix above)
        const failedPaymentsSnap = await getCountFromServer(
          query(collection(db, "payments"), where("status", "==", "failed"))
        );
        setFailedPayments(failedPaymentsSnap.data().count);
      } catch (error) {
        console.error("Failed to load insights:", error);
      } finally {
        setInsightsLoading(false);
      }
    }

    loadInsights();
  }, [adminLoading, user, isAdmin]);

  // -------------------------------------------------------
  // REPORTS — live subscription, only once admin confirmed
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
  async function loadUsers() {
    if (usersLoaded) return;
    setUsersLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), limit(50)));
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdminUser)));
      setUsersLoaded(true);
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setUsersLoading(false);
    }
  }

  // -------------------------------------------------------
  // ADVERTS — loaded lazily when tab is opened
  // -------------------------------------------------------
  async function loadAdverts() {
    if (advertsLoaded) return;
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
  if (tab === "payouts") loadPayouts(payoutMonth);
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
    } catch (error) {
      console.error("Failed to update block status:", error);
      alert("Failed to update user status.");
    } finally {
      setProcessingUserId(null);
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Checking administrator access...</p>
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
    { title: "Total Users", value: totalUsers, icon: Users },
    { title: "Active Adverts", value: activeAdverts, icon: Package },
    { title: "Jobs", value: totalJobs, icon: Briefcase },
    { title: "Payments", value: successfulPayments, icon: CreditCard },
    { title: "Support Reports", value: pendingSupportCount, icon: Flag },
  ];

  const menuItems: { title: string; icon: typeof Users; tab: Tab; badge?: number | null }[] = [
    { title: "Overview", icon: LayoutDashboard, tab: "overview" },
    { title: "Users", icon: Users, tab: "users" },
    { title: "Applications", icon: Megaphone, tab: "applications", badge: applicationsLoaded ? applications.length : null },
    { title: "Marketers", icon: Megaphone, tab: "marketers" },
    { title: "Adverts", icon: Package, tab: "adverts" },
    { title: "Jobs", icon: Briefcase, tab: "jobs" },
    { title: "Payments", icon: CreditCard, tab: "payments" },
    { title: "Reports", icon: Flag, tab: "reports", badge: pendingReportsCount },
    { title: "Support", icon: Flag, tab: "support", badge: pendingSupportCount },
    { title: "Payouts", icon: CreditCard, tab: "payouts" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-4 md:px-8">
          <div>
            <h1 className="text-xl font-bold">BizMtaani Admin</h1>
            <p className="text-sm text-muted-foreground">Platform management dashboard</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{user.displayName || "Administrator"}</p>
              <p className="text-xs text-muted-foreground">{user.email || "Admin account"}</p>
            </div>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              Exit
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden min-h-[calc(100vh-4rem)] w-64 border-r bg-background md:block">
          <nav className="space-y-1 p-4">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.tab;
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => selectTab(item.tab)}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-primary text-white" : "hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-5 w-5" />
                    {item.title}
                  </span>
                  {!!item.badge && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                      active ? "bg-white/20" : "bg-destructive text-white"
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile tab bar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border flex overflow-x-auto no-scrollbar">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.tab;
            return (
              <button
                key={item.title}
                onClick={() => selectTab(item.tab)}
                className={`flex-1 min-w-[70px] flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold relative ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.title}
                {!!item.badge && (
                  <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-destructive" />
                )}
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8">
          {activeTab === "overview" && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold">Dashboard Overview</h2>
                <p className="mt-1 text-muted-foreground">
                  Monitor and manage the BizMtaani marketplace.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.title} className="rounded-xl border bg-card p-6 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">{stat.title}</p>
                          <p className="mt-2 text-3xl font-bold">
                            {statsLoading ? "..." : stat.value ?? "—"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted p-3">
                          <Icon className="h-6 w-6" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {statsError && (
                <div className="mt-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                  <p className="text-sm text-destructive">{statsError}</p>
                </div>
              )}
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4">Today's Insights</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    { label: "Active Adverts Today", value: todayActiveAdverts, emoji: "🟢" },
                    { label: "New Users Today", value: todayNewUsers, emoji: "👤" },
                    { label: "Expired Adverts & Jobs", value: expiredCount, emoji: "🔴" },
                    { label: "Premium Expiring Soon", value: premiumExpiringSoon, emoji: "⭐" },
                    { label: "Failed M-Pesa Payments", value: failedPayments, emoji: "💳" },
                  ].map((card) => (
                    <div key={card.label} className="rounded-xl border bg-card p-4">
                      <p className="text-xl mb-1">{card.emoji}</p>
                      <p className="text-2xl font-bold">
                        {insightsLoading ? "..." : card.value ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {!!pendingReportsCount && (
                <button
                  onClick={() => selectTab("reports")}
                  className="mt-6 w-full flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-left hover:bg-destructive/10 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Flag className="h-5 w-5 text-destructive" />
                    <div>
                      <p className="font-semibold text-sm">
                        {pendingReportsCount} pending report{pendingReportsCount === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-muted-foreground">Needs your review</p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              {!!pendingSupportCount && (
  <button
    onClick={() => selectTab("support")}
    className="mt-3 w-full flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-left hover:bg-destructive/10 transition-colors"
  >
    <div className="flex items-center gap-3">
      <Flag className="h-5 w-5 text-destructive" />
      <div>
        <p className="font-semibold text-sm">
          {pendingSupportCount} support report{pendingSupportCount === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-muted-foreground">Needs your review</p>
      </div>
    </div>
    <ExternalLink className="h-4 w-4 text-muted-foreground" />
  </button>
)}
            </>
          )}

          {activeTab === "reports" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-bold">Reports</h2>
                <p className="mt-1 text-muted-foreground">
                  Adverts flagged by users, awaiting review.
                </p>
              </div>

              {reportsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : reports.length === 0 ? (
                <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
                  No pending reports. All clear.
                </div>
              ) : (
                <div className="space-y-3">
                  {reports.map((report) => (
                    <div key={report.id} className="rounded-xl border bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{report.productTitle}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Reason: <span className="font-medium text-foreground">{report.reason}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {timeAgo(report.createdAt)}
                          </p>
                        </div>
                        <a
                          href={`/product/${report.productId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => dismissReport(report.id)}
                          disabled={processingReportId === report.id}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" /> Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => removeReportedAdvert(report)}
                          disabled={processingReportId === report.id}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-destructive text-white px-3 py-2 text-xs font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50"
                        >
                          {processingReportId === report.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <Trash2 className="h-3.5 w-3.5" /> Delete Advert
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
      <h2 className="text-2xl font-bold">Support Reports</h2>
      <p className="mt-1 text-muted-foreground">
        Problems reported directly by users.
      </p>
    </div>

    {supportReportsLoading ? (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    ) : supportReports.length === 0 ? (
      <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
        No open support reports. All clear.
      </div>
    ) : (
      <div className="space-y-3">
        {supportReports.map((report) => (
          <div key={report.id} className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm capitalize">{report.type}</span>
                  {report.priority === "high" && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-destructive text-white">
                      HIGH
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                  {report.description}
                </p>
                {report.advertId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Advert ID: <span className="font-mono">{report.advertId}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {report.userEmail || report.contact || "No contact provided"}
                  {" • "}
                  {timeAgo(report.createdAt)}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => dismissSupportReport(report.id)}
                disabled={processingSupportReportId === report.id}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Dismiss
              </button>
              <button
                type="button"
                onClick={() => resolveSupportReport(report.id)}
                disabled={processingSupportReportId === report.id}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary text-white px-3 py-2 text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {processingSupportReportId === report.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" /> Mark Resolved
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
              <div className="mb-6">
                <h2 className="text-2xl font-bold">Users</h2>
                <p className="mt-1 text-muted-foreground">Most recent 50 users.</p>
              </div>

              {usersLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="rounded-xl border bg-card overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Name</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Plan</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Role</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Status</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                      
                        <tbody>
                      {users.map((u) => {
                        const reportCount = reportCountsBySeller[u.id] ?? 0;
                        return (
                          <tr key={u.id} className="border-t border-border">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                {u.displayName || "—"}
                                {reportCount > 0 && (
                                  <span
                                    title={`${reportCount} pending report(s)`}
                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"
                                  >
                                    🚩 {reportCount}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">{u.subscriptionPlan ?? "free"}</td>
                            <td className="px-4 py-2.5">
                              {u.role === "admin" ? (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                                  <Shield className="h-3 w-3" /> Admin
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">User</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {u.blocked ? (
                                <span
                                  title={u.blockReason || "Blocked"}
                                  className="text-xs font-semibold text-destructive"
                                >
                                  Blocked
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">Active</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-3">
                                {u.role !== "admin" && (
                                  <button
                                    type="button"
                                    onClick={() => makeMarketer(u)}
                                    disabled={processingUserId === u.id}
                                    className="text-xs font-semibold text-[#00A651] hover:underline disabled:opacity-50"
                                  >
                                    {processingUserId === u.id ? "..." : "Make Marketer"}
                                  </button>
                                )}
                                {u.role !== "admin" && (
                                  <button
                                    type="button"
                                    onClick={() => toggleUserBlock(u)}
                                    disabled={processingUserId === u.id}
                                    className={`text-xs font-semibold hover:underline disabled:opacity-50 ${
                                      u.blocked ? "text-primary" : "text-destructive"
                                    }`}
                                  >
                                    {processingUserId === u.id
                                      ? "..."
                                      : u.blocked
                                      ? "Unblock"
                                      : "Block"}
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
              <div className="mb-6">
                <h2 className="text-2xl font-bold">Adverts</h2>
                <p className="mt-1 text-muted-foreground">Most recent 50 adverts.</p>
              </div>

              {advertsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-2">
                  {adverts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{a.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {a.category} • {a.status} • {timeAgo(a.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <a
                          href={`/product/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          View
                        </a>
                        <button
                          type="button"
                          onClick={() => deleteAdvertDirect(a.id, a.title)}
                          disabled={processingAdvertId === a.id}
                          className="text-xs font-semibold text-destructive hover:underline disabled:opacity-50"
                        >
                          {processingAdvertId === a.id ? "..." : "Delete"}
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
              <div className="mb-6">
                <h2 className="text-2xl font-bold">Jobs</h2>
                <p className="mt-1 text-muted-foreground">Most recent 50 job posts.</p>
              </div>

              {jobsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
                  No job posts yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((j) => {
                    const expired = isJobExpired(j.deadline);
                    return (
                      <div
                        key={j.id}
                        className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{j.title || "Untitled"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {j.company || "—"} • {j.jobType || "—"}
                            {expired && (
                              <span className="ml-2 text-destructive font-semibold">Expired</span>
                            )}
                            {" • "}{timeAgo(j.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <a
                            href={`/jobs/${j.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            View
                          </a>
                          <button
                            type="button"
                            onClick={() => deleteJobDirect(j.id, j.title || "this job")}
                            disabled={processingJobId === j.id}
                            className="text-xs font-semibold text-destructive hover:underline disabled:opacity-50"
                          >
                            {processingJobId === j.id ? "..." : "Delete"}
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
                <h2 className="text-2xl font-bold">Marketer Applications</h2>
                <p className="mt-1 text-muted-foreground">
                  Pending applications from users wanting to become marketers.
                </p>
              </div>

              {applicationsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : applications.length === 0 ? (
                <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
                  No pending applications.
                </div>
              ) : (
                <div className="space-y-3">
                  {applications.map((a) => (
                    <div key={a.id} className="rounded-xl border bg-card p-4 space-y-3">
                      <div>
                        <p className="font-semibold text-sm">{a.fullName || "Unnamed applicant"}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                          <span>ID: {a.idNumber || "—"}</span>
                          <span>M-Pesa: {a.mpesaNumber || "—"}</span>
                        </div>
                        {a.reason && (
                          <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{a.reason}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">{timeAgo(a.createdAt)}</p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => rejectApplication(a)}
                          disabled={processingApplicationId === a.id}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => approveApplication(a)}
                          disabled={processingApplicationId === a.id}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[#00A651] text-white px-3 py-2 text-xs font-semibold hover:bg-[#00A651]/90 transition-colors disabled:opacity-50"
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

          {activeTab === "marketers" && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-bold">Marketers</h2>
                <p className="mt-1 text-muted-foreground">
                  Approved marketers and their commission earnings. To approve a new marketer, use "Make Marketer" on the Users tab.
                </p>
              </div>

              {marketersLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : marketers.length === 0 ? (
                <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
                  No marketers approved yet.
                </div>
              ) : (
                <div className="rounded-xl border bg-card overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Code</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Status</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Earned</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Paid Out</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Balance</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketers.map((m) => {
                        const earned = m.totalEarnedKES ?? 0;
                        const paid = m.totalWithdrawnKES ?? 0;
                        return (
                          <tr key={m.id} className="border-t border-border">
                            <td className="px-4 py-2.5 font-mono font-semibold">{m.referralCode ?? "—"}</td>
                            <td className="px-4 py-2.5">
                              {m.status === "suspended" ? (
                                <span className="text-xs font-semibold text-destructive">Suspended</span>
                              ) : (
                                <span className="text-xs font-semibold text-[#00A651]">Active</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">KES {earned.toLocaleString("en-GB")}</td>
                            <td className="px-4 py-2.5">KES {paid.toLocaleString("en-GB")}</td>
                            <td className="px-4 py-2.5 font-semibold">
                              KES {(earned - paid).toLocaleString("en-GB")}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => toggleMarketerStatus(m)}
                                disabled={processingMarketerId === m.id}
                                className={`text-xs font-semibold hover:underline disabled:opacity-50 ${
                                  m.status === "suspended" ? "text-primary" : "text-destructive"
                                }`}
                              >
                                {processingMarketerId === m.id
                                  ? "..."
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
        <h2 className="text-2xl font-bold">Marketer Payouts</h2>
        <p className="mt-1 text-muted-foreground">Monthly commission owed to each marketer.</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="month"
          value={payoutMonth}
          onChange={(e) => setPayoutMonth(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => loadPayouts(payoutMonth)}
          className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted"
        >
          Load
        </button>
      </div>
    </div>

    {payoutsLoading ? (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    ) : payouts.length === 0 ? (
      <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
        No payout data for {payoutMonth}. It may not have closed yet, or no marketers earned commissions.
      </div>
    ) : (
      <div className="rounded-xl border bg-card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Code</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Sign-ups</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Earned</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Status</th>
              <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-4 py-2.5 font-mono font-semibold">{p.referralCode ?? p.marketerUid}</td>
                <td className="px-4 py-2.5">{p.signups}</td>
                <td className="px-4 py-2.5 font-semibold">KES {p.earningsKES.toLocaleString("en-GB")}</td>
                <td className="px-4 py-2.5">
                  {p.paid ? (
                    <span className="text-xs font-semibold text-[#00A651]">Paid</span>
                  ) : (
                    <span className="text-xs font-semibold text-destructive">Unpaid</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {!p.paid && (
                    <button
                      type="button"
                      onClick={() => markPaid(p)}
                      disabled={processingPayoutId === p.id}
                      className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                    >
                      {processingPayoutId === p.id ? "..." : "Mark Paid"}
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
           {activeTab === "payments" && (
            <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
              Payment history view coming soon.
            </div>
          )}
        </main>
      </div>
    </div>
  );
  }
