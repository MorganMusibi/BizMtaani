import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { getWardInfo } from "@/lib/location";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Loader2, Check, Briefcase } from "lucide-react";
import { JOB_CATEGORIES, JOB_TYPES } from "./Jobs";

const NAIROBI = { lat: -1.286389, lng: 36.817223 };
const CONTACT_METHODS = [
  { value: "none", label: "BizMtaani Chat Only" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone Call" },
  { value: "email", label: "Email" },
] as const;

export default function PostJob() {
  const { user, userProfile } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState(userProfile?.businessName || userProfile?.displayName || "");
  const [category, setCategory] = useState("");
  const [jobType, setJobType] = useState("");
  const [salary, setSalary] = useState("");
  const [deadline,setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [contact, setContact] = useState("");
  const [contactMethod, setContactMethod] = useState<
  "none" | "whatsapp" | "phone" | "email"
>("none");
  const [ward, setWard] = useState("");
  const [county, setCounty] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
  if (!user) { navigate("/login"); return; }
  
  // Check if we have a saved location from the profile
  // This works regardless of whether they are a business or individual
  if (userProfile?.homeLocation) {
    setWard(userProfile.homeLocation.areaName);
    setCounty(userProfile.homeLocation.county);
  } else {
    // Fallback: GPS/GeoJSON logic if profile location is missing
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const info = await getWardInfo(pos.coords.latitude, pos.coords.longitude);
        setWard(info.wardName);
        setCounty(info.county);
      },
      async () => {
        const info = await getWardInfo(NAIROBI.lat, NAIROBI.lng);
        setWard(info.wardName);
        setCounty(info.county);
      },
      { timeout: 8000, maximumAge: 0 }
    );
  }
}, [user, userProfile, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast({ title: "Enter a job title", variant: "destructive" }); return; }
    if (!company.trim()) { toast({ title: "Enter company/recruiter name", variant: "destructive" }); return; }
    if (!category) { toast({ title: "Select a category", variant: "destructive" }); return; }
    if (!jobType) { toast({ title: "Select job type", variant: "destructive" }); return; }
    if (!description.trim()) { toast({ title: "Enter a job description", variant: "destructive" }); return; }
    if (!deadline) { 
      toast({ title: "Please select an application deadline", variant: "destructive" }); 
      return; 
    }
    if (contactMethod !== "none" && !contact.trim()) {
  toast({
    title: "Enter contact details",
    variant: "destructive",
  });
  return;
}
    if (!user) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, "jobs"), {
        title: title.trim(),
        company: company.trim(),
        category,
        jobType,
        salary: salary.trim() || null,
        deadline: deadline,
        description: description.trim(),
        requirements: requirements.trim() || null,
        contact: contact.trim(),
        contactMethod,
        ward,
        county,
        posterId: user.uid,
        posterName: userProfile?.businessName || user.displayName || "Recruiter",
        createdAt: serverTimestamp(),
      });
      toast({ title: "Job posted!", description: "Your job listing is now live." });
      navigate("/jobs");
    } catch (error: any) {
  console.error("Job posting error:", error);

  toast({
    title: "Failed to post job",
    description: error.message || "Please try again.",
    variant: "destructive",
  });
    }finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button onClick={() => navigate("/jobs")} className="p-1.5 rounded-xl hover:bg-muted transition-colors">
          <ChevronLeft size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Briefcase size={13} className="text-white" />
          </div>
          <span className="font-black text-base">Post a Job</span>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-5 pb-28 space-y-5">
        {/* Title & Company */}
        <div className="space-y-1.5">
          <Label>Job Title *</Label>
          <Input placeholder="e.g. Sales Representative" value={title} onChange={(e) => setTitle(e.target.value)} className="h-12" required />
        </div>
        <div className="space-y-1.5">
          <Label>Company / Recruiter Name *</Label>
          <Input placeholder="e.g. Nairobi Supermarkets Ltd" value={company} onChange={(e) => setCompany(e.target.value)} className="h-12" required />
        </div>

        {/* Category */}
        <div className="space-y-2">
          <Label>Category *</Label>
          <div className="flex flex-wrap gap-2">
            {JOB_CATEGORIES.filter((c) => c !== "All").map((cat) => (
              <button
                key={cat} type="button"
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-xl border-2 text-xs font-semibold transition-all ${
                  category === cat ? "border-primary bg-primary text-white" : "border-border text-muted-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Job Type */}
        <div className="space-y-2">
          <Label>Job Type *</Label>
          <div className="flex flex-wrap gap-2">
            {JOB_TYPES.filter((t) => t !== "All Types").map((t) => (
              <button
                key={t} type="button"
                onClick={() => setJobType(t)}
                className={`px-3 py-1.5 rounded-xl border-2 text-xs font-semibold transition-all ${
                  jobType === t ? "border-primary bg-primary text-white" : "border-border text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Salary */}
        <div className="space-y-1.5">
          <Label>Salary / Compensation <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input placeholder="e.g. KES 30,000–50,000/month or Negotiable" value={salary} onChange={(e) => setSalary(e.target.value)} className="h-12" />
        </div>

        {/* Deadline */}
        <div className="space-y-1.5">
          <Label>Application Deadline *</Label>
          <Input 
            type="date" 
            value={deadline} 
            onChange={(e) => setDeadline(e.target.value)} 
            className="h-12" 
            required 
            min={new Date().toISOString().split('T')[0]} 
          />
        </div>


        {/* Description */}
        <div className="space-y-1.5">
          <Label>Job Description *</Label>
          <Textarea
            placeholder="Describe the role, responsibilities, and what you're looking for..."
            value={description} onChange={(e) => setDescription(e.target.value)}
            className="min-h-[120px]" maxLength={2000}
          />
          <p className="text-xs text-right text-muted-foreground">{description.length}/2000</p>
        </div>

        {/* Requirements */}
        <div className="space-y-1.5">
          <Label>Requirements <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Textarea
            placeholder="e.g. KCSE C+, 2 years experience in sales, Valid driving licence..."
            value={requirements} onChange={(e) => setRequirements(e.target.value)}
            className="min-h-[80px]" maxLength={1000}
          />
        </div>

        {/* Additional Application Contact */}
<div className="space-y-2">
  <Label>
    Additional application contact
    <span className="text-muted-foreground font-normal">
      {" "} (optional)
    </span>
  </Label>

  <p className="text-xs text-muted-foreground">
    Applicants can always apply through BizMtaani Chat.
    You can optionally provide another way for applicants
    to contact you.
  </p>

  <div className="grid grid-cols-2 gap-2">
    {CONTACT_METHODS.map(({ value, label }) => (
      <button
        key={value}
        type="button"
        onClick={() => setContactMethod(value)}
        className={`py-2.5 px-3 rounded-xl border-2 text-xs font-semibold transition-all ${
          contactMethod === value
            ? "border-primary bg-primary/5 text-primary"
            : "border-border text-muted-foreground"
        }`}
      >
        {contactMethod === value && (
          <Check size={11} className="inline mr-1" />
        )}

        {label}
      </button>
    ))}
  </div>

  {contactMethod !== "none" && (
    <Input
      placeholder={
        contactMethod === "email"
          ? "your@email.com"
          : contactMethod === "whatsapp"
          ? "07XXXXXXXX (WhatsApp number)"
          : "07XXXXXXXX"
      }
      value={contact}
      onChange={(e) => setContact(e.target.value)}
      className="h-12"
      required
    />
  )}

  {contactMethod === "none" && (
    <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
      <p className="text-sm font-medium text-primary">
        ✓ BizMtaani Chat enabled
      </p>

      <p className="text-xs text-muted-foreground mt-1">
        Applicants will contact you through BizMtaani Chat.
      </p>
    </div>
  )}
</div>

        {/* Location info */}
        {(ward || county) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-4 py-3 rounded-xl">
            <span>📍</span>
            <span>Your job will be shown to seekers in <strong>{ward ? `${ward} area` : county}</strong></span>
          </div>
        )}
      </form>

      {/* Submit */}
      <div className="flex-shrink-0 bg-card border-t border-border px-4 py-4">
        <Button
          type="submit" onClick={handleSubmit}
          className="w-full h-12 font-black text-base rounded-xl gap-2" disabled={submitting}
        >
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <><Briefcase size={16} />Post Job Listing</>}
        </Button>
      </div>
    </div>
  );
}
