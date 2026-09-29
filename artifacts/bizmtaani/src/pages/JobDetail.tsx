import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { doc, getDoc, deleteDoc,  } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  ChevronLeft, Loader2, Share2, Trash2, Briefcase, 
  Building2, MapPin, Banknote, Clock, Mail, 
  MessageSquare, Phone 
} from "lucide-react";
import {
  startJobApplicationChat,
  type ChatParticipant,
} from "@/lib/chatService";
import { clearJobsCache, jobsCache, JOBS_CACHE_TTL_MS, type JobPost } from "./Jobs";
import { usePageMeta, SITE_URL, type PageMeta } from "@/hooks/usePageMeta";

// Helper function needed for your component
function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Ensure this matches your specific type file
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

export default function JobDetail() {
  const [, params] = useRoute("/jobs/:id");
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [job, setJob] = useState<JobPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

useEffect(() => {
    async function loadJob() {
      if (!params?.id) return;

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

      const docRef = doc(db, "jobs", params.id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setJob({ id: snap.id, ...snap.data() } as JobPost);
      }
      setLoading(false);
    }
    loadJob();
  }, [params?.id]);

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
  if (!job || !user) {
    toast({
      title: "Authentication required",
      description:
        "Please log in to apply via chat.",
      variant: "destructive",
    });

    return;
  }

  if (user.uid === job.posterId) {
    toast({
      title:
        "You cannot apply to your own job",
      variant: "destructive",
    });

    return;
  }

  try {
    const applicant: ChatParticipant = {
      uid: user.uid,
      name:
        user.displayName ||
        user.email ||
        "Job Seeker",
      photoURL:
        user.photoURL || "",
    };

    const employer: ChatParticipant = {
      uid: job.posterId,
      name:
        job.posterName ||
        job.company ||
        "Employer",
      photoURL: "",
    };

    const result =
      await startJobApplicationChat({
        applicant,
        employer,

        jobId:
          job.id,

        jobTitle:
          job.title ||
          "Job Position",

        company:
          job.company ||
          "Company",
      });

    navigate(
      `/chat/${result.chatId}`
    );
      } catch (error: any) {
    console.error(
      "CHAT ERROR:",
      error
    );

    toast({
      title: "Chat Error",
      description:
        error?.message ||
        "Failed to initiate chat. Check permissions.",
      variant: "destructive",
    });
  }

}
  

  function handleApply() {
    if (!job) return;
    if (job.contactMethod === "email") {
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
  const ApplyIcon = job.contactMethod === "email" ? Mail : job.contactMethod === "whatsapp" ? MessageSquare : Phone;
  const applyLabel = job.contactMethod === "email" ? "Apply via Email" : job.contactMethod === "whatsapp" ? "Apply on WhatsApp" : "Call to Apply";

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 border-b p-4">
        <button onClick={() => navigate("/jobs")}>
          <ChevronLeft size={22} />
        </button>

        <div className="flex-1">
          <h1 className="font-bold text-lg">Job Details</h1>
        </div>

        <button onClick={handleShare}>
          <Share2 size={20} />
        </button>

        {isOwner && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button>
                <Trash2 size={20} />
              </button>
            </AlertDialogTrigger>
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
                  onClick={handleDelete} 
                  className="bg-destructive hover:bg-destructive/90 text-white"
                >
                  {deleting ? <Loader2 className="animate-spin" /> : "Delete Job"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>

      <div className="p-4 space-y-5">
        <div>
          <h2 className="text-2xl font-bold">{job.title}</h2>
          <p className="text-muted-foreground">{job.company}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${TYPE_COLORS[job.jobType] ?? "bg-muted"}`}>
            {job.jobType}
          </span>

          <span className="px-3 py-1 rounded-full bg-muted text-xs">
            {job.category}
          </span>
        </div>

        {job.salary && (
          <div className="flex items-center gap-2">
            <Banknote size={18} />
            <span>{job.salary}</span>
          </div>
        )}

        {(job.ward || job.county) && (
          <div className="flex items-center gap-2">
            <MapPin size={18} />
            <span>{job.ward ? (job.areaLabel ?? job.ward) : job.county}</span>
          </div>
        )}

        {job.createdAt && (
          <div className="flex items-center gap-2">
            <Clock size={18} />
            <span>{timeAgo(job.createdAt.seconds)}</span>
          </div>
        )}

        <div>
          <h3 className="font-semibold mb-2">Description</h3>
          <p>{job.description}</p>
        </div>

        {job.requirements && (
  <div>
    <h3 className="font-semibold mb-2">Requirements</h3>
    <ul className="list-disc pl-5 space-y-1 leading-relaxed">
      {job.requirements
        .split("\n")
        .map((point, index) => (
          point.trim() && (
            <li key={index}>{point.trim()}</li>
          )
        ))}
    </ul>
  </div>
)}
{isOwner ? (
  <div className="space-y-2">
    <div className="rounded-xl bg-muted/50 px-4 py-3 text-center">
      <p className="text-sm text-muted-foreground">
        {isExpired ? "This job listing has expired." : "You posted this job."}
      </p>
    </div>

    {isExpired && (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="w-full h-12 font-bold">
            <Trash2 className="mr-2" size={18} />
            Delete Expired Job
          </Button>
        </AlertDialogTrigger>
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
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {deleting ? <Loader2 className="animate-spin" /> : "Delete Job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )}
  </div>
) : isExpired ? (
  <Button disabled className="w-full h-12">
    Job Expired
  </Button>
) : (
  <div className="space-y-3 pt-2">
    <Button
      type="button"
      className="w-full h-12 font-bold"
      onClick={handleApplyViaChat}
    >
      <MessageSquare className="mr-2" size={18} />
      Apply via BizMtaani Chat
    </Button>

    {job.contactMethod &&
      job.contactMethod !== "none" &&
      job.contact?.trim() && (
        <Button
          type="button"
          variant="outline"
          className="w-full h-12"
          onClick={handleApply}
        >
          <ApplyIcon className="mr-2" size={18} />
          {applyLabel}
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
  </div>
)}
        
      </div>
    </div>
  );
}
