import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { useLocation, useRoute } from "wouter";
import { doc, getDoc, collection, query, where, limit, getDocs } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Share2,
  Trash2,
  Briefcase,
  Building2,
  MapPin,
  Banknote,
  Clock,
  Mail,
  MessageSquare,
  Phone,
  Copy,
  Check,
  Download,
  ExternalLink,
  X,
} from "lucide-react";
import {
  startJobApplicationChat,
  type ChatParticipant,
} from "@/lib/chatService";
import { clearJobsCache, jobsCache, JOBS_CACHE_TTL_MS, type JobPost } from "./Jobs";
import { usePageMeta, SITE_URL, type PageMeta } from "@/hooks/usePageMeta";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { OnlineServicesButton } from "@/components/OnlineServicesButton";

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------

function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Whole days left until the deadline (negative once it has passed).
function daysLeft(deadline?: string): number | null {
  if (!deadline) return null;
  const end = new Date(`${deadline}T23:59:59`).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86400000);
}

const TYPE_COLORS: Record<string, string> = {
  "Full-time": "bg-green-100 text-green-700",
  "Part-time": "bg-blue-100 text-blue-700",
  "Contract": "bg-purple-100 text-purple-700",
  "Remote": "bg-teal-100 text-teal-700",
  "Internship": "bg-amber-100 text-amber-700",
};

// Google for Jobs uses a fixed enum for employmentType — not
// freeform text — so BizMtaani's own job type labels get mapped
// across. "Remote" isn't an employment type in schema.org terms;
// it's handled separately below via jobLocationType.
const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "Full-time": "FULL_TIME",
  "Part-time": "PART_TIME",
  "Contract": "CONTRACTOR",
  "Internship": "INTERN",
};

function isJobPastDeadline(deadline?: string): boolean {
  if (!deadline) return false;
  return new Date(`${deadline}T23:59:59`) < new Date();
}

function jobPlace(job: JobPost): string {
  return job.ward ? (job.areaLabel ?? job.ward) : job.county || "";
}

function companyInitial(job: JobPost): string {
  return (job.company || job.title || "J").trim().charAt(0).toUpperCase();
}

// Only ever open real web links. Anyone can write to Firestore, so a
// stored "contact" could be something like javascript:... — never trust it.
function getSafeWebLink(value?: string): string | null {
  const v = (value ?? "").trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// When the recruiter gave their own way to apply (email, website link,
// WhatsApp or phone), applicants must use that method. The BizMtaani
// chat is only available for jobs with no contact details at all.
function isChatBlocked(job: JobPost): boolean {
  const link = getSafeWebLink(job.contact);
  if (job.contactMethod === "link" || link) return !!link;
  return (
    ["email", "whatsapp", "phone"].includes(job.contactMethod) &&
    !!job.contact?.trim()
  );
}

function buildJobMeta(job: JobPost): PageMeta {
  const place = job.areaLabel || job.ward || job.county || "Kenya";
  const title = `${job.title.trim().slice(0, 60)} at ${job.company} | BizMtaani`;

  const cleanDescription = (job.description ?? "").replace(/\s+/g, " ").trim();
  const description = cleanDescription
    ? cleanDescription.slice(0, 155)
    : `${job.jobType} ${job.category} role at ${job.company}, ${place}. Apply on BizMtaani.`;

  const path = `/jobs/${job.id}`;
  const url = `${SITE_URL}${path}`;
  const expired = isJobPastDeadline(job.deadline);
  const isRemote = job.jobType === "Remote";

  // datePosted and validThrough are both required by Google for
  // Jobs — a JobPosting missing either is silently excluded from
  // that surface even if it otherwise validates.
  const datePosted = job.createdAt ? new Date(job.createdAt.seconds * 1000).toISOString() : undefined;
  const validThrough = job.deadline ? new Date(`${job.deadline}T23:59:59`).toISOString() : undefined;

  let jsonLd: Record<string, unknown> | null = null;

  if (!expired && datePosted && validThrough) {
    jsonLd = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: job.title,
      description: cleanDescription || description,
      identifier: {
        "@type": "PropertyValue",
        name: "BizMtaani",
        value: job.id,
      },
      datePosted,
      validThrough,
      hiringOrganization: {
        "@type": "Organization",
        name: job.company,
      },
      employmentType: EMPLOYMENT_TYPE_MAP[job.jobType] ?? "OTHER",
      url,
      ...(isRemote
        ? {
            jobLocationType: "TELECOMMUTE",
            applicantLocationRequirements: {
              "@type": "Country",
              name: "Kenya",
            },
          }
        : {
            jobLocation: {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressLocality: job.areaLabel || job.ward || undefined,
                addressRegion: job.county || undefined,
                addressCountry: "KE",
              },
            },
          }),
    };
  }

  return {
    title,
    description,
    canonicalPath: path,
    noindex: expired,
    jsonLd,
  };
}

// ------------------------------------------------------------
// Related jobs
// ------------------------------------------------------------

const MAX_RELATED_JOBS = 5;

function relatedScore(base: JobPost, candidate: JobPost): number {
  let score = 0;
  if (candidate.category === base.category) score += 4;
  if (candidate.jobType === base.jobType) score += 1;
  if (base.ward && candidate.ward === base.ward) score += 3;
  else if (base.county && candidate.county === base.county) score += 2;
  if (base.company && candidate.company === base.company) score += 1;
  if (candidate.createdAt) {
    const ageDays = (Date.now() / 1000 - candidate.createdAt.seconds) / 86400;
    if (ageDays < 7) score += 1;
  }
  return score;
}

function pickRelated(base: JobPost, pool: JobPost[]): JobPost[] {
  return pool
    .filter((candidate) => {
      if (candidate.id === base.id) return false;
      if (isJobPastDeadline(candidate.deadline)) return false;
      // Hide anything that is explicitly not active, if jobs carry a status.
      const status = (candidate as unknown as { status?: string }).status;
      if (status && status !== "active") return false;
      return relatedScore(base, candidate) >= 3;
    })
    .sort((a, b) => {
      const diff = relatedScore(base, b) - relatedScore(base, a);
      if (diff !== 0) return diff;
      return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
    })
    .slice(0, MAX_RELATED_JOBS);
}

function RelatedJobCard({ job, onOpen }: { job: JobPost; onOpen: () => void }) {
  const place = jobPlace(job);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-2xl border border-border bg-card p-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
    >
      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black text-lg flex-shrink-0">
        {companyInitial(job)}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm leading-tight line-clamp-2">{job.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.company}</p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${TYPE_COLORS[job.jobType] ?? "bg-muted"}`}>
            {job.jobType}
          </span>
          {place && (
            <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <MapPin size={11} /> {place}
            </span>
          )}
          {job.createdAt && (
            <span className="text-[11px] text-muted-foreground">{timeAgo(job.createdAt.seconds)}</span>
          )}
        </div>

        {job.salary && (
          <p className="text-xs font-semibold text-primary mt-1 truncate">{job.salary}</p>
        )}
      </div>

      <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
    </button>
  );
}

function RelatedJobSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 flex items-center gap-3 animate-pulse">
      <div className="w-11 h-11 rounded-xl bg-muted flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-muted rounded w-4/5" />
        <div className="h-3 bg-muted rounded w-2/5" />
        <div className="h-3 bg-muted rounded w-3/5" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Install prompt for visitors who arrive from social media
// ------------------------------------------------------------

const IN_APP_REGEX = /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Twitter|Snapchat|Line\//i;
const SOCIAL_REFERRER_REGEX =
  /(facebook\.|fb\.com|instagram\.|t\.co\/|twitter\.com|x\.com|tiktok\.|whatsapp\.|wa\.me|linkedin\.|telegram\.|snapchat\.)/i;
const INSTALL_CARD_HIDDEN_KEY = "bizmtaani_job_install_card_hidden";

function detectVisitorSource() {
  const ua = navigator.userAgent;
  const inApp = IN_APP_REGEX.test(ua);
  const referrer = document.referrer || "";
  const params = new URLSearchParams(window.location.search);
  const fromSocial =
    inApp ||
    SOCIAL_REFERRER_REGEX.test(referrer) ||
    params.has("fbclid") ||
    params.has("igshid") ||
    params.has("utm_source");

  return {
    inApp,
    fromSocial,
    isIOSDevice: /iPhone|iPad|iPod/i.test(ua),
  };
}

function openInChrome() {
  const { host, pathname, search, href } = window.location;
  window.location.href =
    `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

function SocialInstallCard() {
  const { showBanner, isIOS, install } = useInstallPrompt();
  const [source] = useState(detectVisitorSource);
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(INSTALL_CARD_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (hidden || !source.fromSocial) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(INSTALL_CARD_HIDDEN_KEY, "1");
    } catch {
      // sessionStorage unavailable — just hide for this render
    }
    setHidden(true);
  }

  let message: ReactNode;
  let action: ReactNode = null;

  if (source.inApp && source.isIOSDevice) {
    // iPhone: Facebook/Instagram/TikTok browsers can't install anything.
    message = (
      <>
        To install BizMtaani, tap <strong>•••</strong> then <strong>Open in Safari</strong>, then
        tap <strong>Share</strong> and <strong>Add to Home Screen</strong>.
      </>
    );
  } else if (source.inApp) {
    // Android: hand the page over to Chrome, where the Install button works.
    message = (
      <>
        Open this page in Chrome, then tap <strong>Install</strong>. If nothing happens, tap{" "}
        <strong>⋮</strong> and choose <strong>Open in browser</strong>.
      </>
    );
    action = (
      <Button type="button" size="sm" className="mt-3 font-bold" onClick={openInChrome}>
        <ExternalLink className="mr-1.5" size={14} />
        Open in Chrome
      </Button>
    );
  } else if (isIOS && showBanner) {
    message = (
      <>
        Tap <strong>Share</strong> then <strong>Add to Home Screen</strong> to keep BizMtaani on
        your phone.
      </>
    );
  } else if (showBanner) {
    message = <>Install BizMtaani for faster loading and a home-screen icon.</>;
    action = (
      <Button
        type="button"
        size="sm"
        className="mt-3 font-bold"
        onClick={async () => {
          await install();
        }}
      >
        <Download className="mr-1.5" size={14} />
        Install App
      </Button>
    );
  } else {
    return null;
  }

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
      <div className="w-11 h-11 rounded-xl bg-primary text-white flex items-center justify-center font-black text-lg flex-shrink-0">
        B
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-black text-sm leading-tight">Get the BizMtaani app</p>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">{message}</p>
        {action}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 p-1.5 rounded-xl hover:bg-muted transition-colors"
      >
        <X size={16} className="text-muted-foreground" />
      </button>
    </section>
  );
}

// ------------------------------------------------------------
// Delete dialog (used in the header and for expired jobs)
// ------------------------------------------------------------

function DeleteJobDialog({
  trigger,
  onConfirm,
  deleting,
}: {
  trigger: ReactNode;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this job?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently remove your job posting from BizMtaani.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            {deleting ? <Loader2 className="animate-spin" /> : "Delete Job"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function InfoTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2.5 min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon} {label}
      </p>
      <p className={`text-sm font-semibold mt-0.5 break-words ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function JobDetail() {
  const [, params] = useRoute("/jobs/:id");
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [job, setJob] = useState<JobPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const [related, setRelated] = useState<JobPost[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadJob() {
      if (!params?.id) return;

      // Opening a related job keeps this component mounted, so jump
      // back to the top of the page for the new job.
      window.scrollTo(0, 0);

      // Reuse data already fetched by the Jobs feed instead of an
      // extra Firestore read, if it's sitting in the feed's cache.
      const cachedMatch = [...jobsCache.values()]
        .filter((entry) => Date.now() - entry.timestamp < JOBS_CACHE_TTL_MS)
        .flatMap((entry) => entry.jobs)
        .find((j) => j.id === params.id);

      if (cachedMatch) {
        setJob(cachedMatch);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "jobs", params.id));
        if (cancelled) return;
        setJob(snap.exists() ? ({ id: snap.id, ...snap.data() } as JobPost) : null);
      } catch (error) {
        console.error("Failed to load job:", error);
        if (!cancelled) setJob(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadJob();
    return () => {
      cancelled = true;
    };
  }, [params?.id]);

  // Related jobs: use the Jobs feed cache first (free), and only hit
  // Firestore when the cache doesn't already hold enough same-category
  // jobs. The query has a single equality filter, so it needs no
  // composite index.
  useEffect(() => {
    if (!job) {
      setRelated([]);
      setRelatedLoading(false);
      return;
    }

    let cancelled = false;
    const base = job;
    const pool = new Map<string, JobPost>();

    [...jobsCache.values()]
      .filter((entry) => Date.now() - entry.timestamp < JOBS_CACHE_TTL_MS)
      .flatMap((entry) => entry.jobs)
      .forEach((j) => pool.set(j.id, j));

    setRelated(pickRelated(base, [...pool.values()]));

    const sameCategoryCached = [...pool.values()].filter(
      (j) => j.category === base.category && j.id !== base.id
    ).length;

    if (sameCategoryCached >= MAX_RELATED_JOBS) {
      setRelatedLoading(false);
      return;
    }

    setRelatedLoading(true);
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "jobs"), where("category", "==", base.category), limit(15))
        );
        if (cancelled) return;
        snap.docs.forEach((d) => pool.set(d.id, { id: d.id, ...d.data() } as JobPost));
        setRelated(pickRelated(base, [...pool.values()]));
      } catch (error) {
        console.warn("Failed to load related jobs:", error);
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  async function handleDelete() {
    if (!job) return;
    setDeleting(true);
    try {
      const deleteJob = httpsCallable(functions, "deleteJob");
      await deleteJob({ jobId: job.id });
      clearJobsCache();
      toast({ title: "Job deleted" });
      navigate("/jobs");
    } catch (e) {
      toast({ title: "Failed to delete", variant: "destructive" });
      setDeleting(false);
    }
  }

  async function handleApplyViaChat() {
    if (job && isChatBlocked(job)) {
      toast({
        title: "Apply using the employer's method",
        description: "This employer asked applicants to use the contact details provided.",
        variant: "destructive",
      });
      return;
    }

    if (!job || !user) {
      toast({
        title: "Authentication required",
        description: "Please log in to apply via chat.",
        variant: "destructive",
      });
      return;
    }

    if (user.uid === job.posterId) {
      toast({
        title: "You cannot apply to your own job",
        variant: "destructive",
      });
      return;
    }

    try {
      const applicant: ChatParticipant = {
        uid: user.uid,
        name: user.displayName || user.email || "Job Seeker",
        photoURL: user.photoURL || "",
      };

      const employer: ChatParticipant = {
        uid: job.posterId,
        name: job.posterName || job.company || "Employer",
        photoURL: "",
      };

      const result = await startJobApplicationChat({
        applicant,
        employer,
        jobId: job.id,
        jobTitle: job.title || "Job Position",
        company: job.company || "Company",
      });

      navigate(`/chat/${result.chatId}`);
    } catch (error: any) {
      console.error("CHAT ERROR:", error);

      toast({
        title: "Chat Error",
        description: error?.message || "Failed to initiate chat. Check permissions.",
        variant: "destructive",
      });
    }
  }

  // Copies the recruiter's email/phone/website link
  async function handleCopyContact() {
    if (!job?.contact) return;
    try {
      await navigator.clipboard.writeText(job.contact);
      toast({ title: "Copied!" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  function handleApply() {
    if (!job) return;
    const linkUrl = getSafeWebLink(job.contact);
    if (job.contactMethod === "link" || linkUrl) {
      if (!linkUrl) {
        toast({ title: "This application link is not valid", variant: "destructive" });
        return;
      }
      window.open(linkUrl, "_blank", "noopener,noreferrer");
    } else if (job.contactMethod === "email") {
      window.location.href = `mailto:${job.contact}?subject=Application for ${job.title}`;
    } else if (job.contactMethod === "whatsapp") {
      const num = job.contact.replace(/\D/g, "").replace(/^0/, "254");
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(`Hello, I'm interested in the ${job.title} position at ${job.company}.`)}`);
    } else {
      window.open(`tel:${job.contact}`);
    }
  }

  function handleShare() {
    if (navigator.share && job) {
      navigator.share({ title: job.title, text: `${job.title} at ${job.company} — apply on BizMtaani`, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast({ title: "Link copied!" });
    }
  }

  usePageMeta(
    job
      ? buildJobMeta(job)
      : !loading
      ? {
          title: "Job not found | BizMtaani",
          description: "This job listing is no longer available on BizMtaani.",
          noindex: true,
        }
      : null
  );

  if (loading || authLoading) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-3">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4 px-6">
        <p className="font-bold text-lg">Job not found</p>
        <Button onClick={() => navigate("/jobs")}>Back to Jobs</Button>
      </div>
    );
  }

  const isOwner = user?.uid === job.posterId;
  const isExpired = job.deadline
    ? new Date(`${job.deadline}T23:59:59`) < new Date()
    : false;
  const remainingDays = daysLeft(job.deadline);
  const closingSoon = !isExpired && remainingDays !== null && remainingDays <= 3;
  const place = jobPlace(job);

  // A contact that is a web address is always treated as a website link,
  // even if contactMethod is missing or unfamiliar (e.g. an older cached
  // version of the app saved it differently).
  const safeLink = getSafeWebLink(job.contact);
  const isLinkApply = job.contactMethod === "link" || !!safeLink;

  const ApplyIcon = isLinkApply
    ? ExternalLink
    : job.contactMethod === "email"
    ? Mail
    : job.contactMethod === "whatsapp"
    ? MessageSquare
    : Phone;
  const applyLabel = isLinkApply
    ? "Apply on Company Website"
    : job.contactMethod === "email"
    ? "Apply via Email"
    : job.contactMethod === "whatsapp"
    ? "Apply on WhatsApp"
    : "Call to Apply";
  const contactLabel = isLinkApply
    ? "Website"
    : job.contactMethod === "email"
    ? "Email"
    : job.contactMethod === "whatsapp"
    ? "WhatsApp"
    : "Phone";
  const contactDisplay = isLinkApply
    ? (safeLink ?? job.contact).replace(/^https?:\/\//i, "")
    : job.contact;

  // True when the recruiter gave their own way to apply. For website
  // links, the link must also be a safe http(s) URL.
  const hasExternalContact = isLinkApply
    ? !!safeLink
    : ["phone", "email", "whatsapp"].includes(job.contactMethod) && !!job.contact?.trim();

  const requirementLines = (job.requirements ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 backdrop-blur-sm px-4 h-14">
        <button onClick={() => navigate("/jobs")} aria-label="Back to jobs">
          <ChevronLeft size={22} />
        </button>

        <div className="flex-1">
          <h1 className="font-bold text-lg">Job Details</h1>
        </div>

        <button onClick={handleShare} aria-label="Share job">
          <Share2 size={20} />
        </button>

        {isOwner && (
          <DeleteJobDialog
            deleting={deleting}
            onConfirm={handleDelete}
            trigger={
              <button aria-label="Delete job">
                <Trash2 size={20} />
              </button>
            }
          />
        )}
      </header>

      {/* select-text lets users highlight and copy anything on the page */}
      <div className="p-4 pb-28 space-y-4 select-text [-webkit-touch-callout:default]">

        {/* ---------- Hero card ---------- */}
        <section className="rounded-3xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="h-16 bg-gradient-to-r from-primary/25 via-primary/10 to-transparent" />

          <div className="px-4 pb-4 -mt-8 space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary text-white border-4 border-card shadow-md flex items-center justify-center text-2xl font-black">
              {companyInitial(job)}
            </div>

            <div>
              <h2 className="text-2xl font-bold leading-tight">{job.title}</h2>
              <p className="flex items-center gap-1.5 text-muted-foreground mt-1">
                <Building2 size={15} /> {job.company}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${TYPE_COLORS[job.jobType] ?? "bg-muted"}`}>
                {job.jobType}
              </span>
              <span className="px-3 py-1 rounded-full bg-muted text-xs">{job.category}</span>
              {isExpired && (
                <span className="px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold">Expired</span>
              )}
              {closingSoon && (
                <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                  {remainingDays === 0 ? "Closes today" : `Closes in ${remainingDays} day${remainingDays === 1 ? "" : "s"}`}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {job.salary && (
                <InfoTile icon={<Banknote size={13} />} label="Salary" value={job.salary} />
              )}
              {place && (
                <InfoTile icon={<MapPin size={13} />} label="Location" value={place} />
              )}
              {job.createdAt && (
                <InfoTile icon={<Clock size={13} />} label="Posted" value={timeAgo(job.createdAt.seconds)} />
              )}
              {job.deadline && (
                <InfoTile
                  icon={<Clock size={13} />}
                  label={isExpired ? "Status" : "Deadline"}
                  value={isExpired ? `Expired (${job.deadline})` : job.deadline}
                  tone={isExpired ? "text-destructive" : ""}
                />
              )}
            </div>
          </div>
        </section>

        {/* ---------- Description ---------- */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-bold mb-2 flex items-center gap-2">
            <Briefcase size={17} className="text-primary" /> Description
          </h3>
          {/* whitespace-pre-line keeps the recruiter's line breaks */}
          <p className="whitespace-pre-line leading-relaxed text-[15px]">{job.description}</p>
        </section>

        {/* ---------- Requirements ---------- */}
        {requirementLines.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <Check size={17} className="text-primary" /> Requirements
            </h3>
            <ul className="space-y-2">
              {requirementLines.map((point, index) => (
                <li key={index} className="flex items-start gap-2.5 leading-relaxed text-[15px]">
                  <span className="mt-1 w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Check size={10} strokeWidth={3} />
                  </span>
                  <span className="flex-1">{point}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------- Apply / owner actions ---------- */}
        {isOwner ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-muted/50 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">
                {isExpired ? "This job listing has expired." : "You posted this job."}
              </p>
            </div>

            {isExpired && (
              <DeleteJobDialog
                deleting={deleting}
                onConfirm={handleDelete}
                trigger={
                  <Button variant="destructive" className="w-full h-12 font-bold">
                    <Trash2 className="mr-2" size={18} />
                    Delete Expired Job
                  </Button>
                }
              />
            )}
          </div>
        ) : isExpired ? (
          <Button disabled className="w-full h-12">
            Job Expired
          </Button>
        ) : (
          <div className="space-y-3">
            {/* The recruiter's own contact method is primary; BizMtaani chat is secondary */}
            {hasExternalContact ? (
              <>
                {isLinkApply && safeLink ? (
                  <Button asChild className="w-full h-12 font-bold rounded-xl">
                    <a href={safeLink} target="_blank" rel="noopener noreferrer">
                      <ApplyIcon className="mr-2" size={18} />
                      {applyLabel}
                    </a>
                  </Button>
                ) : (
                  <Button type="button" className="w-full h-12 font-bold rounded-xl" onClick={handleApply}>
                    <ApplyIcon className="mr-2" size={18} />
                    {applyLabel}
                  </Button>
                )}

                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{contactLabel}</p>
                    {isLinkApply && safeLink ? (
                      <a
                        href={safeLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold break-all text-primary underline underline-offset-2"
                      >
                        {contactDisplay}
                      </a>
                    ) : (
                      <p className="font-semibold break-all select-text">{contactDisplay}</p>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleCopyContact}>
                    <Copy className="mr-1" size={14} /> Copy
                  </Button>
                </div>

                {!isChatBlocked(job) && (
                  <button
                    type="button"
                    onClick={handleApplyViaChat}
                    className="w-full text-center text-sm text-muted-foreground underline underline-offset-4 py-1"
                  >
                    Or message the employer on BizMtaani
                  </button>
                )}
              </>
            ) : (
              <Button type="button" className="w-full h-12 font-bold rounded-xl" onClick={handleApplyViaChat}>
                <MessageSquare className="mr-2" size={18} />
                Apply via BizMtaani Chat
              </Button>
            )}

            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-4 py-3">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-400">
                ⚠️ Kaa rada na SCAM jobs, usioshwe!
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-1 leading-relaxed">
                BizMtaani jobs hazihitaji ulipie pesa ama utume M-Pesa kabla ya interview ya Mundu khu Mundu.
              </p>
            </div>

            {/* Online services (CV, KRA, eCitizen, ...) — CV orders are pre-filled with this job */}
            <OnlineServicesButton
              jobTitle={job.title}
              company={job.company}
              jobUrl={window.location.href}
            />
          </div>
        )}

        {/* ---------- Install prompt (only for visitors from social media) ---------- */}
        <SocialInstallCard />

        {/* ---------- Related jobs ---------- */}
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base flex items-center gap-2">
              <Briefcase size={18} className="text-primary" /> Related jobs
            </h3>
            <button
              type="button"
              onClick={() => navigate("/jobs")}
              className="text-xs font-bold text-primary"
            >
              See all
            </button>
          </div>

          {relatedLoading && related.length === 0 ? (
            <div className="space-y-2">
              <RelatedJobSkeleton />
              <RelatedJobSkeleton />
              <RelatedJobSkeleton />
            </div>
          ) : related.length > 0 ? (
            <div className="space-y-2">
              {related.map((r) => (
                <RelatedJobCard key={r.id} job={r} onOpen={() => navigate(`/jobs/${r.id}`)} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground rounded-xl bg-muted/40 px-4 py-3 text-center">
              No similar jobs right now. Check back soon.
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full h-11 rounded-xl font-semibold"
            onClick={() => navigate("/jobs")}
          >
            Browse all jobs
          </Button>
        </section>
      </div>
    </div>
  );
          }
