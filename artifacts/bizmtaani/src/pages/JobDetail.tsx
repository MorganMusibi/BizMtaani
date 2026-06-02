import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { doc, getDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, MapPin, Clock, Briefcase, Building2, Banknote,
  Phone, Mail, MessageSquare, Share2, Trash2, Loader2,
} from "lucide-react";
import type { JobPost } from "./Jobs";

function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  const days = Math.floor(diff / 86400);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

const TYPE_COLORS: Record<string, string> = {
  "Full-time": "bg-green-100 text-green-700",
  "Part-time": "bg-blue-100 text-blue-700",
  "Contract": "bg-purple-100 text-purple-700",
  "Remote": "bg-teal-100 text-teal-700",
  "Internship": "bg-amber-100 text-amber-700",
};

export default function JobDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/jobs/:id");
  const { user } = useAuth();
  const { toast } = useToast();

  const [job, setJob] = useState<JobPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    getDoc(doc(db, "jobs", params.id)).then((snap) => {
      if (snap.exists()) setJob({ id: snap.id, ...snap.data() } as JobPost);
      setLoading(false);
    });
  }, [params?.id]);

  async function handleDelete() {
    if (!job || !user) return;
    if (!confirm("Delete this job listing?")) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "jobs", job.id));
      toast({ title: "Job deleted" });
      navigate("/jobs");
    } catch {
      toast({ title: "Could not delete", variant: "destructive" });
      setDeleting(false);
    }
  }

  function handleApply() {
    if (!job) return;
    if (job.contactMethod === "email") {
      window.open(`mailto:${job.contact}?subject=${encodeURIComponent(`Application: ${job.title}`)}`);
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

  if (loading) {
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
  const ApplyIcon = job.contactMethod === "email" ? Mail : job.contactMethod === "whatsapp" ? MessageSquare : Phone;
  const applyLabel = job.contactMethod === "email" ? "Apply via Email" : job.contactMethod === "whatsapp" ? "Apply on WhatsApp" : "Call to Apply";

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center justify-between">
        <button onClick={() => navigate("/jobs")} className="p-1.5 rounded-xl hover:bg-muted transition-colors">
          <ChevronLeft size={22} />
        </button>
        <div className="flex items-center gap-2">
          <button onClick={handleShare} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <Share2 size={18} />
          </button>
          {isOwner && (
            <button
              onClick={handleDelete} disabled={deleting}
              className="p-2 rounded-xl hover:bg-destructive/10 text-destructive transition-colors"
            >
              {deleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-28">
        {/* Hero */}
        <div className="px-4 py-5 border-b border-border">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Briefcase size={26} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-black text-xl leading-tight">{job.title}</h1>
              <div className="flex items-center gap-1.5 mt-1">
                <Building2 size={13} className="text-muted-foreground" />
                <span className="text-sm font-semibold text-muted-foreground">{job.company}</span>
              </div>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 mt-4">
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${TYPE_COLORS[job.jobType] ?? "bg-muted text-muted-foreground"}`}>
              {job.jobType}
            </span>
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-muted text-muted-foreground">
              {job.category}
            </span>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-4 mt-4">
            {(job.ward || job.county) && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin size={14} className="text-primary flex-shrink-0" />
                <span>{job.ward ? `${job.ward} area` : job.county}</span>
              </div>
            )}
            {job.salary && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Banknote size={14} className="text-primary flex-shrink-0" />
                <span>{job.salary}</span>
              </div>
            )}
            {job.createdAt && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock size={14} className="flex-shrink-0" />
                <span>{timeAgo(job.createdAt.seconds)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="px-4 py-5 border-b border-border">
          <h2 className="font-black text-base mb-3">About this job</h2>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{job.description}</p>
        </div>

        {/* Requirements */}
        {job.requirements && (
          <div className="px-4 py-5 border-b border-border">
            <h2 className="font-black text-base mb-3">Requirements</h2>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{job.requirements}</p>
          </div>
        )}

        {/* How to apply */}
        <div className="px-4 py-5">
          <h2 className="font-black text-base mb-1">How to apply</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Contact {job.company} via {job.contactMethod} to apply for this role.
          </p>
          <div className="bg-muted/50 rounded-2xl px-4 py-3 flex items-center gap-3">
            <ApplyIcon size={16} className="text-primary flex-shrink-0" />
            <span className="text-sm font-semibold">{job.contact}</span>
          </div>
        </div>
      </div>

      {/* Apply button */}
      <div className="flex-shrink-0 bg-card border-t border-border px-4 py-4">
        <Button
          onClick={handleApply}
          className="w-full h-12 font-black text-base rounded-xl gap-2"
        >
          <ApplyIcon size={18} />
          {applyLabel}
        </Button>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Posted by {job.posterName}
        </p>
      </div>
    </div>
  );
}
