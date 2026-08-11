import { useLocation } from "wouter";
import { useState } from "react";
import {
  ArrowLeft,
  Flag,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/contexts/AuthContext";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const REPORT_TYPES = [
  { value: "advert", label: "Advert" },
  { value: "user", label: "User" },
  { value: "payment", label: "Payment" },
  { value: "technical", label: "Technical problem" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "fraud", label: "Fraud or scam" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "other", label: "Other" },
];

export default function Report() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { user } = useAuth();

if (!user) {
  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3 z-40">
        <button
          onClick={() => setLocation("/about")}
          className="p-2 -ml-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
          aria-label="Back to About"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="font-black text-lg tracking-tight">
          Report a Problem
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-8 pb-24">
        <div className="max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Flag size={32} className="text-primary" />
          </div>
          <h1 className="text-xl font-black mb-2">Please log in</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You need to be logged in to submit a report.
          </p>
          <div className="mt-6 space-y-2">
            <button
              onClick={() => setLocation("/login")}
              className="w-full rounded-2xl bg-primary text-primary-foreground font-bold text-sm py-3.5 active:scale-[0.98] transition-transform"
            >
              Log in
            </button>
            <button
              onClick={() => setLocation("/about")}
              className="w-full rounded-2xl bg-card border border-border font-bold text-sm py-3.5 active:scale-[0.98] transition-transform"
            >
              Back to About
            </button>
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

  const [reportType, setReportType] = useState("advert");
  const [advertId, setAdvertId] = useState("");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    setError("");

    const cleanDescription = description.trim();
    const cleanAdvertId = advertId.trim();
    const cleanContact = contact.trim();

    if (!cleanDescription) {
      setError("Please describe the problem before submitting your report.");
      return;
    }

    if (cleanDescription.length < 10) {
      setError("Please provide a little more detail about the problem.");
      return;
    }

    if (cleanDescription.length > 3000) {
      setError("Your description is too long. Please keep it under 3,000 characters.");
      return;
    }

    if (cleanContact.length > 150) {
      setError("Your contact information is too long.");
      return;
    }

    if (submitting) return;

    try {
      setSubmitting(true);

      await addDoc(collection(db, "supportReports"), {
        userId: user.uid,
        userEmail: user.email ?? null,

        type: reportType,

        advertId: cleanAdvertId || null,

        description: cleanDescription,

        contact: cleanContact || null,

        status: "open",
        priority: reportType === "fraud" ? "high" : "normal",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSubmitted(true);
      setAdvertId("");
      setDescription("");
      setContact("");
    } catch (err) {
      console.error("Failed to submit report:", err);

      setError(
        "We couldn't submit your report right now. Please check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col h-screen bg-background overflow-hidden">
        <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3 z-40">
          <button
            onClick={() => setLocation("/about")}
            className="p-2 -ml-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
            aria-label="Back to About"
          >
            <ArrowLeft size={20} />
          </button>

          <span className="font-black text-lg tracking-tight">
            Report a Problem
          </span>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-8 pb-24">
          <div className="max-w-md mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} className="text-primary" />
            </div>

            <h1 className="text-xl font-black mb-2">
              Report submitted
            </h1>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Thank you for helping us keep BizMtaani safe and reliable.
              Our team will review your report.
            </p>

            <div className="mt-6 space-y-2">
              <button
                onClick={() => {
                  setSubmitted(false);
                  setError("");
                }}
                className="w-full rounded-2xl bg-primary text-primary-foreground font-bold text-sm py-3.5 active:scale-[0.98] transition-transform"
              >
                Submit another report
              </button>

              <button
                onClick={() => setLocation("/about")}
                className="w-full rounded-2xl bg-card border border-border font-bold text-sm py-3.5 active:scale-[0.98] transition-transform"
              >
                Back to About
              </button>
            </div>
          </div>
        </main>

        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3 z-40">
        <button
          onClick={() => setLocation("/about")}
          className="p-2 -ml-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
          aria-label="Back to About"
        >
          <ArrowLeft size={20} />
        </button>

        <span className="font-black text-lg tracking-tight">
          Report a Problem
        </span>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        <div className="max-w-2xl mx-auto">
          {/* Introduction */}
          <section className="mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
              <Flag size={22} className="text-primary" />
            </div>

            <h1 className="text-xl font-black mb-2">
              Help us keep BizMtaani safe
            </h1>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Report a suspicious advert, scam, inappropriate content,
              technical problem, or anything else that needs our attention.
            </p>
          </section>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Report type */}
            <div>
              <label
                htmlFor="reportType"
                className="block text-sm font-bold mb-2"
              >
                What are you reporting?
              </label>

              <div className="relative">
                <select
                  id="reportType"
                  value={reportType}
                  onChange={(event) => setReportType(event.target.value)}
                  className="w-full appearance-none bg-card border border-border rounded-2xl px-4 py-3.5 pr-11 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {REPORT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>

                <ChevronDown
                  size={18}
                  className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
                />
              </div>
            </div>

            {/* Advert ID */}
            <div>
              <label
                htmlFor="advertId"
                className="block text-sm font-bold mb-2"
              >
                Advert ID
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (optional)
                </span>
              </label>

              <input
                id="advertId"
                type="text"
                value={advertId}
                onChange={(event) => setAdvertId(event.target.value)}
                placeholder="Enter the advert ID if applicable"
                maxLength={150}
                className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />

              <p className="text-xs text-muted-foreground mt-2">
                If you're reporting a specific advert, including its ID helps
                our team find it faster.
              </p>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-bold mb-2"
              >
                Describe the problem
              </label>

              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Tell us what happened..."
                rows={6}
                maxLength={3000}
                required
                className="w-full resize-none bg-card border border-border rounded-2xl px-4 py-3.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />

              <div className="flex justify-end mt-1">
                <span className="text-[11px] text-muted-foreground">
                  {description.length}/3000
                </span>
              </div>
            </div>

            {/* Contact */}
            <div>
              <label
                htmlFor="contact"
                className="block text-sm font-bold mb-2"
              >
                Contact information
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (optional)
                </span>
              </label>

              <input
                id="contact"
                type="text"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="Phone number or email"
                maxLength={150}
                className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />

              <p className="text-xs text-muted-foreground mt-2">
                Logged-in users' account email may already be available to our
                support team. Add another contact method if needed.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-2xl px-4 py-3">
                <p className="text-sm text-destructive font-medium">
                  {error}
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-primary text-primary-foreground font-bold text-sm py-3.5 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
            >
              {submitting ? "Submitting..." : "Submit report"}
            </button>

            <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
              Please do not include passwords, M-Pesa PINs, authentication
              codes, or other sensitive security information in your report.
            </p>
          </form>
        </div>
      </main>

      <BottomNav />
    </div>
  );
                              }
