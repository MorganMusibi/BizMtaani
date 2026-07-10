/**
 * Jobs feed — location-aware job listings board.
 * Recruiters post jobs; job seekers browse by area, category, and type.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  collection, query, orderBy, where, limit, startAfter,
  getDocs, type QueryDocumentSnapshot, type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { getWardInfo } from "@/lib/location";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import {
  Briefcase, Plus, Loader2, MapPin, Clock, Search, X,
  Building2, Banknote, ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 15;
const NAIROBI: [number, number] = [-1.286389, 36.817223];

export const JOB_CATEGORIES = [
  "All",
  "IT & Tech",
  "Sales & Marketing",
  "Healthcare",
  "Education",
  "Construction",
  "Transport & Logistics",
  "Hospitality",
  "Finance & Accounting",
  "NGO & Government",
  "General Labour",
  "Domestic & Cleaning",
  "Other",
];

export const JOB_TYPES = ["All Types", "Full-time", "Part-time", "Contract", "Remote", "Internship"];

export interface JobPost {
  id: string;
  title: string;
  company: string;
  category: string;
  jobType: string;
  salary?: string;
  deadline?: string;
  ward?: string;
  county?: string;
  description: string;
  requirements?: string;
  contact: string;
  contactMethod: "phone" | "email" | "whatsapp";
  posterId: string;
  posterName: string;
  createdAt?: { seconds: number } | null;
}

type Cursor = QueryDocumentSnapshot<DocumentData>;

function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const TYPE_COLORS: Record<string, string> = {
  "Full-time": "bg-green-100 text-green-700",
  "Part-time": "bg-blue-100 text-blue-700",
  "Contract": "bg-purple-100 text-purple-700",
  "Remote": "bg-teal-100 text-teal-700",
  "Internship": "bg-amber-100 text-amber-700",
};

function JobCard({ job, onClick }: { job: JobPost; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Briefcase size={20} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-black text-sm leading-tight">{job.title}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Building2 size={11} className="text-muted-foreground flex-shrink-0" />
                <p className="text-xs text-muted-foreground truncate">{job.company}</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0 mt-0.5" />
          </div>

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[job.jobType] ?? "bg-muted text-muted-foreground"}`}>
              {job.jobType}
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {job.category}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-2.5 text-[11px] text-muted-foreground">
            {(job.ward || job.county) && (
              <div className="flex items-center gap-1">
                <MapPin size={10} />
                <span>{job.ward ? `${job.ward} area` : job.county}</span>
              </div>
            )}
            {job.salary && (
              <div className="flex items-center gap-1">
                <Banknote size={10} />
                <span>{job.salary}</span>
              </div>
            )}
            {job.createdAt && (
              <div className="flex items-center gap-1 ml-auto">
                <Clock size={10} />
                <span>{timeAgo(job.createdAt.seconds)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Jobs() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const [areaName, setAreaName] = useState<string | null>(null);
  const [wardName, setWardName] = useState<string | null>(null);
  const [county, setCounty] = useState<string | null>(null);
  const [locationReady, setLocationReady] = useState(false);

  const [activeCategory, setActiveCategory] = useState("All");
  const [activeType, setActiveType] = useState("All Types");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Detect location
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const info = await getWardInfo(pos.coords.latitude, pos.coords.longitude);
        setWardName(info.wardName);
        setCounty(info.county);
        setAreaName(info.wardName || info.county || null);
        setLocationReady(true);
      },
      async () => {
        const info = await getWardInfo(NAIROBI[0], NAIROBI[1]);
        setWardName(info.wardName);
        setCounty(info.county);
        setAreaName(null); // GPS denied — show all jobs
        setLocationReady(true);
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  function buildQuery(cur?: Cursor) {
    const coll = collection(db, "jobs");
    const constraints = [
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE),
    ] as Parameters<typeof query>[1][];

    // TEMPORARILY REMOVE WARD FILTER
    // We will add it back after confirming your job documents contain the ward field.

    if (activeCategory !== "All") {
        constraints.unshift(where("category", "==", activeCategory));
    }

    if (activeType !== "All Types") {
        constraints.unshift(where("jobType", "==", activeType));
    }

    if (cur) {
        constraints.push(startAfter(cur));
    }

    return query(coll, ...constraints);
                 }

  useEffect(() => {
    if (!locationReady) return;
    setLoading(true);
    setJobs([]);
    setCursor(null);
    setDone(false);

    getDocs(buildQuery())
      .then((snap) => {

        console.log("Jobs found: " + snap.docs.length);

        setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobPost)));
        setCursor(snap.docs[snap.docs.length - 1] ?? null);
        setDone(snap.docs.length < PAGE_SIZE);
        setLoading(false);
      })
    .catch((error) => {
  console.error("Failed to load jobs:", error);
  setLoading(false);
});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationReady, activeCategory, activeType, searchQuery]);

  const loadMore = useCallback(async () => {
    if (done || loadingMore || !cursor) return;
    setLoadingMore(true);
    const snap = await getDocs(buildQuery(cursor));
    const newJobs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobPost));
    setJobs((prev) => {
      const ids = new Set(prev.map((j) => j.id));
      return [...prev, ...newJobs.filter((j) => !ids.has(j.id))];
    });
    setCursor(snap.docs[snap.docs.length - 1] ?? null);
    setDone(snap.docs.length < PAGE_SIZE);
    setLoadingMore(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, loadingMore, cursor]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore(); }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  function applyLocalFilters(list: JobPost[]) {
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        j.category.toLowerCase().includes(q) ||
        (j.ward ?? "").toLowerCase().includes(q) ||
        (j.county ?? "").toLowerCase().includes(q)
    );
  }

  const visible = applyLocalFilters(jobs);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center justify-between gap-3 z-40">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Briefcase size={14} className="text-white" />
          </div>
          <span className="font-black text-lg tracking-tight">Jobs</span>
          {areaName && (
            <span className="text-xs text-muted-foreground font-medium">· {areaName} area</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {user && (
            <button onClick={() => setLocation("/jobs/post")} className="p-2 rounded-xl hover:bg-muted transition-colors">
              <Plus size={20} />
            </button>
          )}
          <button onClick={() => setShowSearch((s) => !s)} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <Search size={20} />
          </button>
        </div>
      </header>

      {showSearch && (
        <form
          onSubmit={(e) => { e.preventDefault(); setSearchQuery(searchInput.trim()); }}
          className="flex-shrink-0 bg-card border-b border-border px-4 py-2 flex gap-2"
        >
          <input
            type="search" placeholder="Search jobs, companies, areas..."
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)} autoFocus
            className="flex-1 h-10 px-4 rounded-xl bg-muted text-sm outline-none border border-transparent focus:border-primary transition-colors"
          />
          <button type="submit" className="h-10 px-4 bg-primary text-white rounded-xl text-sm font-semibold flex-shrink-0">Go</button>
        </form>
      )}

      {searchQuery && (
        <div className="flex-shrink-0 bg-card border-b border-border px-4 py-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Results for:</span>
          <span className="flex items-center gap-1 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full">
            {searchQuery}
            <button onClick={() => { setSearchInput(""); setSearchQuery(""); setShowSearch(false); }}><X size={11} /></button>
          </span>
        </div>
      )}

      {/* Category chips */}
      <div className="flex-shrink-0 bg-card/90 backdrop-blur-sm border-b border-border z-30">
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto no-scrollbar">
          {JOB_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                activeCategory === cat ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        {/* Job type chips */}
        <div className="flex gap-2 px-4 pb-2.5 overflow-x-auto no-scrollbar">
          {JOB_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setActiveType(t)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
                activeType === t
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-20">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading jobs...</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 px-6">
            <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
              <Briefcase size={36} className="text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-bold text-lg">No jobs found</p>
              <p className="text-muted-foreground text-sm mt-1">
                {searchQuery ? "Try a different search term" : "No listings in this category yet"}
              </p>
            </div>
            {user && (
              <Button onClick={() => setLocation("/jobs/post")} className="gap-2">
                <Plus size={16} />Post the first job here
              </Button>
            )}
          </div>
        ) : (
          <div className="px-3 pt-3 space-y-3">
            <p className="text-xs text-muted-foreground px-1">
              {visible.length} job{visible.length !== 1 ? "s" : ""} found
              {areaName && !searchQuery ? ` · ${areaName} area & beyond` : ""}
            </p>
            {visible.map((job) => (
              <JobCard key={job.id} job={job} onClick={() => setLocation(`/jobs/${job.id}`)} />
            ))}
            <div ref={sentinelRef} className="h-1" />
            {loadingMore && (
              <div className="flex justify-center py-4">
                <Loader2 size={20} className="animate-spin text-primary" />
              </div>
            )}
            {done && visible.length > 0 && (
              <p className="text-center text-xs text-muted-foreground py-4">All jobs loaded</p>
            )}
          </div>
        )}
      </div>

      {/* Post job FAB */}
      {user && (
        <div className="fixed bottom-20 right-4 z-40">
          <button
            onClick={() => setLocation("/jobs/post")}
            className="flex items-center gap-2 bg-primary text-white font-black text-sm px-5 h-12 rounded-full shadow-xl active:scale-95 transition-transform"
          >
            <Plus size={18} />Post a Job
          </button>
        </div>
      )}

      {!user && (
        <div className="flex-shrink-0 bg-card border-t border-border px-4 py-3 flex items-center gap-3 z-40">
          <div className="flex-1">
            <p className="font-bold text-sm">Are you hiring?</p>
            <p className="text-xs text-muted-foreground">Sign in to post a job listing</p>
          </div>
          <Button size="sm" onClick={() => setLocation("/login")}>Sign in</Button>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
