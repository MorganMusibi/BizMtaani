import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { doc, getDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  ChevronLeft, Loader2, Share2, Trash2, Briefcase, 
  Building2, MapPin, Banknote, Clock, Mail, 
  MessageSquare, Phone 
} from "lucide-react";
import type { JobPost } from "./Jobs";

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

export default function JobDetail() {
  const [, params] = useRoute("/jobs/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [job, setJob] = useState<JobPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function loadJob() {
      if (!params?.id) return;
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
    if (!job || !confirm("Are you sure?")) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "jobs", job.id));
      toast({ title: "Job deleted" });
      navigate("/jobs");
    } catch (e) {
      toast({ title: "Failed to delete", variant: "destructive" });
      setDeleting(false);
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

  // --- PASTED YOUR CODE FROM HERE DOWN ---
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
  const isExpired = job.deadline && new Date(job.deadline) < new Date();
  const ApplyIcon = job.contactMethod === "email" ? Mail : job.contactMethod === "whatsapp" ? MessageSquare : Phone;
  const applyLabel = job.contactMethod === "email" ? "Apply via Email" : job.contactMethod === "whatsapp" ? "Apply on WhatsApp" : "Call to Apply";

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ... (The rest of your JSX remains exactly as you had it) ... */}
    </div>
  );
}
