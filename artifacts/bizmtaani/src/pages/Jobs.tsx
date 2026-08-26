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
import { getWardInfo, getWardCoordinates, type ResolvedLocation } from "@/lib/location";
import { getLocationHierarchy } from "@/lib/locationHierarchy";
import { LocationBanner } from "@/components/LocationBanner";
import { AreaPickerSheet } from "@/components/AreaPickerSheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase, Plus, Loader2, MapPin, Clock, Search, X,
  Building2, Banknote, ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 15;

export const JOB_CATEGORIES = [
  "All",
  "Domestic Work",
  "Security",
  "Driving & Riding",
  "Transport & Logistics (Delivery)",
  "Construction & Fundi",
  "Plumbing & Electrical",
  "Carpentry & Welding",
  "Painting & Décor",
  "Sales & Retail",
  "Hospitality & Food",
  "Catering & Baking",
  "Beauty & Grooming",
  "Tailoring & Fashion Design",
  "Farm & Agriculture",
  "Care Work",
  "Mechanic & Technical",
  "Cleaning Services",
  "Laundry & Dry Cleaning",
  "Events & Ushering",
  "Photography & Videography",
  "Teaching & Tutoring",
  "IT & Digital Services",
  "General Labour / Casual (Kibarua)",
  "Other",
];

export const JOB_TYPES = ["All Types", "Full-time", "Part-time", "Contract", "Remote", "Internship"];

type JobPostShape = {
  id: string;
  [key: string]: unknown;
};

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

function isJobExpired(deadline?: string) {
  if (!deadline) return false;
  return new Date(`${deadline}T23:59:59`) < new Date();
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
  const { toast } = useToast();

  // Location state (matching homepage pattern)
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [gpsGranted, setGpsGranted] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);
  const [locationInfo, setLocationInfo] = useState<ResolvedLocation | null>(null);
  const [hierarchyReady, setHierarchyReady] = useState(false);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);
  const [showRefreshOptions, setShowRefreshOptions] = useState(false);
  const [resolvingAreaSearch, setResolvingAreaSearch] = useState(false);
  const hasPromptedArea = useRef(false);

  // Filter states
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeType, setActiveType] = useState("All Types");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const isSearchMode = searchQuery.length > 0;

  // Jobs state
  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Load location hierarchy
  useEffect(() => {
    let cancelled = false;
    getLocationHierarchy()
      .then(() => {
        if (!cancelled) setHierarchyReady(true);
      })
      .catch(() => {
        if (!cancelled) setHierarchyReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Location detection (matching homepage pattern)
  useEffect(() => {
    let cancelled = false;

    const requestGps = async () => {
      if (!navigator.geolocation) {
        setGpsReady(true);
        if (!hasPromptedArea.current) {
          hasPromptedArea.current = true;
          setShowAreaPicker(true);
        }
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setGpsGranted(true);
          
          const resolved = await getWardInfo(lat, lng);
          if (resolved && !cancelled) {
            setLocationInfo({ ...resolved, lat, lng } as ResolvedLocation);
            setUserCoords([lat, lng]);
          }
          setGpsReady(true);
        },
        async () => {
          setGpsGranted(false);
          setGpsReady(true);
          if (!hasPromptedArea.current) {
            hasPromptedArea.current = true;
            setShowAreaPicker(true);
          }
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
      );
    };

    requestGps();
    return () => { cancelled = true; };
  }, []);

  // Hard timeout for location
  useEffect(() => {
    if (gpsReady) return;
    const timeoutId = setTimeout(() => {
      setGpsReady(true);
      if (!hasPromptedArea.current) {
        hasPromptedArea.current = true;
        setShowAreaPicker(true);
      }
      setLocationErrorMsg("Taking long to find your area? Choose your area manually.");
    }, 10000);
    return () => clearTimeout(timeoutId);
  }, [gpsReady]);

  // Handle area selection
  const handleAreaSelect = useCallback((choice: ResolvedLocation) => {
    setLocationInfo(choice);
    if (choice.lat != null && choice.lng != null) {
      setUserCoords([choice.lat, choice.lng]);
    }
    setGpsReady(true);
    setShowAreaPicker(false);
    localStorage.setItem("bizmtaani_area_chosen", JSON.stringify(choice));
  }, []);

  const handleAreaSearchSelect = useCallback(async (ward: { wardName: string; constituencyName: string; countyName: string }) => {
    setResolvingAreaSearch(true);
    try {
      const coords = await getWardCoordinates(ward.wardName, ward.constituencyName, ward.countyName);
      if (!coords) {
        toast({ title: "Couldn't find that area", description: "Try a nearby area name instead." });
        return;
      }
      const resolved: ResolvedLocation = {
        lat: coords.lat,
        lng: coords.lng,
        wardName: ward.wardName,
        constituency: ward.constituencyName,
        county: ward.countyName,
        displayName: `${ward.wardName}, ${ward.constituencyName}`,
      } as ResolvedLocation;
      handleAreaSelect(resolved);
    } catch (error) {
      toast({ title: "Something went wrong", description: "Please try again." });
    } finally {
      setResolvingAreaSearch(false);
    }
  }, [handleAreaSelect, toast]);

  const refreshLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setRefreshingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGpsGranted(true);
        setLocationErrorMsg(null);
        const resolved = await getWardInfo(lat, lng);
        if (resolved) {
          const wardChanged = resolved.wardName !== locationInfo?.wardName;
          if (wardChanged) {
            setLocationInfo({ ...resolved, lat, lng } as ResolvedLocation);
            setUserCoords([lat, lng]);
          } else {
            toast({ title: "TULIAA! Uko", description: resolved.wardName ? `${resolved.wardName} 🎯` : undefined });
          }
        }
        setRefreshingLocation(false);
      },
      (error) => {
        setRefreshingLocation(false);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationErrorMsg("Location yako iko off. Enda browser settings uka i turn ON.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setLocationErrorMsg("GPS yako iko off msee. Iwashe kwa phone settings.");
        } else {
          setLocationErrorMsg("location yako haipatikani sahii. Jaribu tena.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [locationInfo?.wardName, toast]);

  // Build query function
  function buildQuery(cur?: Cursor) {
    const coll = collection(db, "jobs");
    const constraints = [
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE),
    ] as Parameters<typeof query>[1][];

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

  // Fetch jobs when location is ready or filters change
  useEffect(() => {
    if (!gpsReady) return;
    
    setLoading(true);
    setJobs([]);
    setCursor(null);
    setDone(false);

    getDocs(buildQuery())
      .then((snap) => {
        const fetchedJobs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobPost));
        const fetchedCursor = snap.docs[snap.docs.length - 1] ?? null;
        const fetchedDone = snap.docs.length < PAGE_SIZE;
        setJobs(fetchedJobs);
        setCursor(fetchedCursor);
        setDone(fetchedDone);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load jobs:", error);
        setLoading(false);
      });
  }, [gpsReady, activeCategory, activeType]);

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
  }, [done, loadingMore, cursor]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore(); }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  // Apply local filters
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

  // Sort jobs by proximity (matching homepage pattern)
  function sortJobs(list: JobPost[]) {
    const wardName = locationInfo?.wardName || null;
    const county = locationInfo?.county || null;
    return [...list].sort((a, b) => {
      const expiredA = isJobExpired(a.deadline);
      const expiredB = isJobExpired(b.deadline);
      if (expiredA !== expiredB) return expiredA ? 1 : -1;
      const tierA = wardName && a.ward === wardName ? 0 : county && a.county === county ? 1 : 2;
      const tierB = wardName && b.ward === wardName ? 0 : county && b.county === county ? 1 : 2;
      if (tierA !== tierB) return tierA - tierB;
      return 0;
    });
  }

  const activeJobs = jobs.filter((j) => !isJobExpired(j.deadline));
  const visible = sortJobs(applyLocalFilters(activeJobs));

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header with Location Banner */}
      <header className="flex-shrink-0 bg-card border-b border-border z-40">
        <div className="px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Briefcase size={14} className="text-white" />
            </div>
            <span className="font-black text-lg tracking-tight">Local Jobs</span>
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
        </div>

        {/* Location Banner - same as homepage */}
        <LocationBanner
          gpsReady={gpsReady}
          gpsGranted={gpsGranted}
          locationInfo={locationInfo}
          isSearchMode={isSearchMode}
          refreshingLocation={refreshingLocation}
          onRefresh={() => setShowRefreshOptions(true)}
          onSetArea={() => setShowAreaPicker(true)}
          locationErrorMsg={locationErrorMsg}
        />
      </header>

      {/* Location Error Message - same as homepage */}
      {locationErrorMsg && (
        <div className="mx-4 my-2 p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-start gap-3 shadow-sm">
          <MapPin size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Tunahitaji Location Yako 📍
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
              {locationErrorMsg}
            </p>
            <button
              type="button"
              onClick={refreshLocation}
              disabled={refreshingLocation}
              className="mt-2 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {refreshingLocation ? "Retrying..." : "Jaribu tena"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setLocationErrorMsg(null)}
            className="text-amber-900 dark:text-amber-200 hover:opacity-70 text-xs font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search */}
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
              {locationInfo?.wardName && !searchQuery ? ` · ${locationInfo.wardName} area & beyond` : ""}
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

      {/* Refresh Options Sheet - same as homepage */}
      {showRefreshOptions && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            onClick={() => setShowRefreshOptions(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[61] bg-card rounded-t-3xl border-t border-border px-5 pt-5"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
          >
            <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-5" />
            <p className="font-black text-base mb-4">Update your area</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setShowRefreshOptions(false);
                  refreshLocation();
                }}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-primary/40 bg-primary/5 text-left transition-all active:scale-[0.98]"
              >
                <MapPin size={18} className="text-primary flex-shrink-0" />
                <div>
                  <p className="font-bold text-sm">Use GPS</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Detect my current location</p>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowRefreshOptions(false);
                  setShowAreaPicker(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-border bg-muted/40 text-left transition-all active:scale-[0.98]"
              >
                <Search size={18} className="text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="font-bold text-sm">Search manually</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Type jina la ward au Constituency enye uko</p>
                </div>
              </button>
            </div>
            <button
              onClick={() => setShowRefreshOptions(false)}
              className="w-full mt-3 py-3 text-sm font-semibold text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Area Picker Sheet - same as homepage */}
      {showAreaPicker && (
        <AreaPickerSheet
          onSearchSelect={handleAreaSearchSelect}
          resolving={resolvingAreaSearch}
          onDismiss={() => setShowAreaPicker(false)}
        />
      )}
    </div>
  );
                }
