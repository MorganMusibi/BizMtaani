import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { doc, getDoc, deleteDoc, collection, addDoc, setDoc, serverTimestamp, } from "firebase/firestore";
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
  if (!job) return; // Removed the 'confirm()' check
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

async function handleApplyViaChat() {
  if (!job || !user) return;

  if (user.uid === job.posterId) {
    toast({
      title: "You cannot apply to your own job",
      variant: "destructive",
    });
    return;
  }

  try {
    const chatId = `job_${job.id}_${user.uid}_${job.posterId}`;

    const chatRef = doc(db, "chats", chatId);

    const existingChat = await getDoc(chatRef);

    if (!existingChat.exists()) {
      await setDoc(chatRef, {
        type: "job_application",

        jobId: job.id,
        jobTitle: job.title,
        company: job.company,

        buyerId: user.uid,
        buyerName:
          user.displayName || "Job Seeker",

        sellerId: job.posterId,
        sellerName:
          job.posterName || job.company,

        participants: [
          user.uid,
          job.posterId,
        ],

        lastMessage:
          `Hello, I'm interested in applying for the ${job.title} position at ${job.company}. I'd like to know more about the opportunity and how I can apply.`,

        lastMessageAt:
          serverTimestamp(),

        lastSenderId:
          user.uid,
      });

      await addDoc(
        collection(
          db,
          "chats",
          chatId,
          "messages"
        ),
        {
          senderId: user.uid,

          senderName:
            user.displayName ||
            "Job Seeker",

          text:
            `Hello, I'm interested in applying for the ${job.title} position at ${job.company}. I'd like to know more about the opportunity and how I can apply.`,

          createdAt:
async function handleApplyViaChat() {
  if (!job || !user) return;

  if (user.uid === job.posterId) {
    toast({
      title: "You cannot apply to your own job",
      variant: "destructive",
    });
    return;
  }

  try {
    const chatId = `job_${job.id}_${user.uid}_${job.posterId}`;

    const chatRef = doc(db, "chats", chatId);

    console.log("STEP 1: Checking chat", chatId);

    const existingChat = await getDoc(chatRef);

    console.log("STEP 2: Existing chat check passed");

    if (!existingChat.exists()) {
      console.log("STEP 3: Creating chat");

      await setDoc(chatRef, {
        type: "job_application",
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,

        buyerId: user.uid,
        buyerName: user.displayName || "Job Seeker",

        sellerId: job.posterId,
        sellerName: job.posterName || job.company,

        participants: [
          user.uid,
          job.posterId,
        ],

        lastMessage: "",
        lastMessageAt: serverTimestamp(),
        lastSenderId: user.uid,
      });

      console.log("STEP 4: Chat created successfully");

      await addDoc(
        collection(
          db,
          "chats",
          chatId,
          "messages"
        ),
        {
          senderId: user.uid,
          senderName: user.displayName || "Job Seeker",
          text: `Hello, I'm interested in applying for the ${job.title} position at ${job.company}. I'd like to know more about the opportunity and how I can apply.`,
          createdAt: serverTimestamp(),
        }
      );

      console.log("STEP 5: Message created successfully");
    }

    console.log("STEP 6: Navigating to chat");

    navigate(`/chat/${chatId}`);

  } catch (error: any) {
    console.error("CHAT ERROR:", error);

    toast({
      title: "Chat Error",
      description: error?.message || "Unknown error",
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
          <span>{job.ward || job.county}</span>
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
          <p>{job.requirements}</p>
        </div>
      )}

      {isExpired ? (
  <Button
    disabled
    className="w-full h-12"
  >
    Job Expired
  </Button>
) : isOwner ? (
  <div className="rounded-xl bg-muted/50 px-4 py-3 text-center">
    <p className="text-sm text-muted-foreground">
      You posted this job.
    </p>
  </div>
) : (
  <div className="space-y-3 pt-2">

    {/* ALWAYS AVAILABLE */}
    <Button
      type="button"
      className="w-full h-12 font-bold"
      onClick={handleApplyViaChat}
    >
      <MessageSquare
        className="mr-2"
        size={18}
      />
      Apply via BizMtaani Chat
    </Button>

    {/* OPTIONAL EXTERNAL CONTACT */}
    {job.contactMethod &&
      job.contactMethod !== "none" &&
      job.contact?.trim() && (
        <Button
          type="button"
          variant="outline"
          className="w-full h-12"
          onClick={handleApply}
        >
          <ApplyIcon
            className="mr-2"
            size={18}
          />
          {applyLabel}
        </Button>
      )}

  </div>
)}
    </div>
  </div>
);
}  
