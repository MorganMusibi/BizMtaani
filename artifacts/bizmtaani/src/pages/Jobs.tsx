/**
 * Jobs feed — location-aware job listings board.
 * Recruiters post jobs; job seekers browse by area, category, and type.
 *
 * Cost strategy: unlike the home feed's progressive 5-stage radius
 * expansion, jobs use a SINGLE fixed 30km geohash fan-out — no
 * expanding-radius while loop. loadMore drains a locally-buffered
 * page first, and only does ONE bounded extra fetch round when the
 * buffer runs out (never a retry loop). If a user's area genuinely
 * has fewer than PAGE_SIZE jobs within 30km, they just see fewer
 * jobs — there is no nationwide/expanding fallback, which is what
 * keeps this cheap.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  collection, query, orderBy, where, limit, startAfter,
  getDocs, type QueryDocumentSnapshot, type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useLocationContext } from "@/contexts/LocationContext";
import { getLocationHierarchy } from "@/lib/locationHierarchy";
import { getNearbyGeohashPrefixes, radiusKmToGeohashPrecision } from "@/lib/geohash";
import { LocationBanner } from "@/components/LocationBanner";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase, Plus, Loader2, MapPin, Clock, Search, X,
  Building2, Banknote, ChevronRight,
} from "lucide-react";

// ============================================================
// CONSTANTS
// ============================================================

const PAGE_SIZE = 15;
const PREFIX_FETCH_SIZE = 15; // per-prefix page size for the fan-out
const JOBS_RADIUS_KM = 30;

const JOBS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const JOBS_CACHE_STORAGE_KEY = "bizmtaani_jobs_cache";
const MAX_CACHED_KEYS = 6;

type Cursor = QueryDocumentSnapshot<DocumentData>;

// ============================================================
// CACHE
// Only the jobs/buffer/done flags are persisted to localStorage.
// Cursors are real Firestore snapshot objects and only live in the
// in-memory jobsCache Map for the current session — same pattern the
// original file used (never serialized, just kept alive in memory).
// ============================================================

interface JobsCacheEntry {
  jobs: JobPost[];
  buffer: JobPost[];
  prefixDone: Record<string, boolean>;
  prefixCursors: Record<string, Cursor | null>;
  done: boolean;
  timestamp: number;
}

function loadJobsCacheFromStorage(): Map<string, JobsCacheEntry> {
  try {
    const raw = localStorage.getItem(JOBS_CACHE_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<
      string,
      Omit<JobsCacheEntry, "prefixCursors"> & { prefixCursors?: undefined }
    >;
    const map = new Map<string, JobsCacheEntry>();
    Object.entries(parsed).forEach(([key, entry]) => {
      map.set(key, { ...entry, prefixCursors: {} });
    });
    return map;
  } catch {
    return new Map();
  }
}

function saveJobsCacheToStorage(cache: Map<string, JobsCacheEntry>) {
  try {
    if (cache.size > MAX_CACHED_KEYS) {
      const sorted = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toEvict = sorted.slice(0, cache.size - MAX_CACHED_KEYS);
      for (const [key] of toEvict) cache.delete(key);
    }
    const serializable: Record<string, unknown> = {};
    cache.forEach((entry, key) => {
      const { prefixCursors, ...rest } = entry;
      serializable[key] = rest;
    });
    localStorage.setItem(JOBS_CACHE_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // localStorage full or unavailable — cache just won't persist across reload
  }
}

export const jobsCache = loadJobsCacheFromStorage();

// Called after a successful job post so the poster's own device shows
// the new listing immediately instead of waiting out the TTL.
export function clearJobsCache() {
  jobsCache.clear();
  try {
    localStorage.removeItem(JOBS_CACHE_STORAGE_KEY);
  } catch {
    // safe to ignore
  }
}

function computeJobsCacheKey(
  category: string,
  type: string,
  coords: [number, number] | null
): string {
  const coordsPart = coords ? `${coords[0].toFixed(2)}_${coords[1].toFixed(2)}` : "nogps";
  return `${category}_${type}_${coordsPart}`;
}

function getFreshJobsCacheEntry(key: string): JobsCacheEntry | null {
  const cached = jobsCache.get(key);
  if (cached && Date.now() - cached.timestamp < JOBS_CACHE_TTL_MS) {
    return cached;
  }
  return null;
}

// ============================================================
// TYPES & CONSTANTS
// ============================================================

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
  geohash?: string;
  lat?: number | null;
  lng?: number | null;
  description: string;
  requirements?: string;
  contact: string;
  contactMethod: "phone" | "email" | "whatsapp";
  posterId: string;
  posterName: string;
  createdAt?: { seconds: number } | null;
  status?: string;
}

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

function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toJobs(docs: QueryDocumentSnapshot<DocumentData>[]): JobPost[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() } as JobPost))
    .filter((j) => {
      if (j.status && j.status !== "active") return false;
      if (isJobExpired(j.deadline)) return false;
      return true;
    });
}

function dedupe(existing: JobPost[], incoming: JobPost[]): JobPost[] {
  const ids = new Set(existing.map((j) => j.id));
  return [...existing, ...incoming.filter((j) => !ids.has(j.id))];
}

const TYPE_COLORS: Record<string, string> = {
  "Full-time": "bg-green-100 text-green-700",
  "Part-time": "bg-blue-100 text-blue-700",
  "Contract": "bg-purple-100 text-purple-700",
  "Remote": "bg-teal-100 text-teal-700",
  "Internship": "bg-amber-100 text-amber-700",
};

// ============================================================
// FIRESTORE QUERIES
// ============================================================

// Fallback query used only when GPS/coords aren't available yet —
// same shape as the original file's simple paginated query. No
// distance filtering, since there's no location to filter by.
function fallbackQuery(category: string, jobType: string, cursor?: Cursor | null) {
  const coll = collection(db, "jobs");
  const filters: ReturnType<typeof where>[] = [where("status", "==", "active")];
  if (category !== "All") filters.push(where("category", "==", category));
  if (jobType !== "All Types") filters.push(where("jobType", "==", jobType));

  if (cursor) {
    return query(coll, ...filters, orderBy("createdAt", "desc"), startAfter(cursor), limit(PAGE_SIZE));
  }
  return query(coll, ...filters, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
}

// Single fixed-radius geohash fan-out — one query per nearby prefix,
// no expanding stages. Each prefix paginates independently via its
// own cursor.
function areaJobQueries(
  coords: [number, number],
  category: string,
  jobType: string,
  prefixCursors: Record<string, Cursor | null>,
  prefixDone: Record<string, boolean>
) {
  const prefixes = getNearbyGeohashPrefixes(
    coords[0],
    coords[1],
    radiusKmToGeohashPrecision(JOBS_RADIUS_KM)
  );
  const coll = collection(db, "jobs");

  return prefixes
    .filter((prefix) => !prefixDone[prefix])
    .map((prefix) => {
      const filters: ReturnType<typeof where>[] = [
        where("geohash", ">=", prefix),
        where("geohash", "<", prefix + "\uf8ff"),
        where("status", "==", "active"),
      ];
      if (category !== "All") filters.push(where("category", "==", category));
      if (jobType !== "All Types") filters.push(where("jobType", "==", jobType));

      const cursor = prefixCursors[prefix];
      const base = cursor
        ? query(coll, ...filters, orderBy("geohash"), startAfter(cursor), limit(PREFIX_FETCH_SIZE))
        : query(coll, ...filters, orderBy("geohash"), limit(PREFIX_FETCH_SIZE));

      return { prefix, q: base };
    });
}

async function fetchAreaPage(
  coords: [number, number],
  category: string,
  jobType: string,
  prefixCursors: Record<string, Cursor | null>,
  prefixDone: Record<string, boolean>
): Promise<{
  jobs: JobPost[];
  nextCursors: Record<string, Cursor | null>;
  nextDone: Record<string, boolean>;
}> {
  const targets = areaJobQueries(coords, category, jobType, prefixCursors, prefixDone);
  if (targets.length === 0) {
    return { jobs: [], nextCursors: prefixCursors, nextDone: prefixDone };
  }

  const snapshots = await Promise.all(targets.map((t) => getDocs(t.q)));

  const nextCursors = { ...prefixCursors };
  const nextDone = { ...prefixDone };
  const collected: JobPost[] = [];

  snapshots.forEach((snap, i) => {
    const { prefix } = targets[i];
    const jobs = toJobs(snap.docs).filter((job) => {
      if (job.lat == null || job.lng == null) return false;
      const distance = getDistanceKm(coords[0], coords[1], job.lat, job.lng);
      return distance <= JOBS_RADIUS_KM;
    });
    collected.push(...jobs);

    const lastDoc = snap.docs[snap.docs.length - 1];
    nextCursors[prefix] = lastDoc ?? prefixCursors[prefix] ?? null;
    if (snap.docs.length < PREFIX_FETCH_SIZE) {
      nextDone[prefix] = true;
    }
  });

  return { jobs: collected, nextCursors, nextDone };
}

function sortJobsByProximity(
  jobs: JobPost[],
  userCoords: [number, number] | null,
  wardName?: string
): JobPost[] {
  return [...jobs].sort((a, b) => {
    if (wardName) {
      const aMatch = a.ward?.toLowerCase() === wardName.toLowerCase();
      const bMatch = b.ward?.toLowerCase() === wardName.toLowerCase();
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }
    if (!userCoords) return 0;
    const distA = a.lat != null && a.lng != null ? getDistanceKm(userCoords[0], userCoords[1], a.lat, a.lng) : Infinity;
    const distB = b.lat != null && b.lng != null ? getDistanceKm(userCoords[0], userCoords[1], b.lat, b.lng) : Infinity;
    return distA - distB;
  });
}

// ============================================================
// JOB CARD
// ============================================================

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

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function Jobs() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { locationInfo, userCoords, gpsGranted, gpsReady, isLocationLoading } = useLocationContext();

  const [hierarchyReady, setHierarchyReady] = useState(false);

  const [activeCategory, setActiveCategory] = useState("All");
  const [activeType, setActiveType] = useState("All Types");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const isSearchMode = searchQuery.length > 0;

  const initialCacheKey = gpsReady ? computeJobsCacheKey(activeCategory, activeType, userCoords) : null;
  const initialCached = initialCacheKey ? getFreshJobsCacheEntry(initialCacheKey) : null;
  const skipNextResetRef = useRef(initialCached ? initialCacheKey : null);

  const [jobs, setJobs] = useState<JobPost[]>(initialCached?.jobs ?? []);
  const [buffer, setBuffer] = useState<JobPost[]>(initialCached?.buffer ?? []);
  const [prefixCursors, setPrefixCursors] = useState<Record<string, Cursor | null>>(initialCached?.prefixCursors ?? {});
  const [prefixDone, setPrefixDone] = useState<Record<string, boolean>>(initialCached?.prefixDone ?? {});
  const [fallbackCursor, setFallbackCursor] = useState<Cursor | null>(null);
  const [done, setDone] = useState(initialCached?.done ?? false);
  const [loading, setLoading] = useState(!initialCached);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getLocationHierarchy()
      .then(() => { if (!cancelled) setHierarchyReady(true); })
      .catch(() => { if (!cancelled) setHierarchyReady(true); });
    return () => { cancelled = true; };
  }, []);

  // ─── Initial fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!gpsReady) return;

    const cacheKey = computeJobsCacheKey(activeCategory, activeType, userCoords);

    if (skipNextResetRef.current === cacheKey) {
      skipNextResetRef.current = null;
      return;
    }
    skipNextResetRef.current = null;

    const cached = getFreshJobsCacheEntry(cacheKey);
    if (cached) {
      setJobs(cached.jobs);
      setBuffer(cached.buffer);
      setPrefixCursors(cached.prefixCursors);
      setPrefixDone(cached.prefixDone);
      setDone(cached.done);
      setLoading(false);
      return;
    }

    setLoading(true);
    setJobs([]);
    setBuffer([]);
    setPrefixCursors({});
    setPrefixDone({});
    setFallbackCursor(null);
    setDone(false);

    (async () => {
      try {
        if (!userCoords) {
          // No location yet — cheap fallback, no distance filtering.
          const snap = await getDocs(fallbackQuery(activeCategory, activeType));
          const fetched = toJobs(snap.docs);
          const nextCursor = snap.docs[snap.docs.length - 1] ?? null;
          const fetchedDone = snap.docs.length < PAGE_SIZE;

          setJobs(fetched);
          setFallbackCursor(nextCursor);
          setDone(fetchedDone);
          setLoading(false);
          return;
        }

        const { jobs: collected, nextCursors, nextDone } = await fetchAreaPage(
          userCoords, activeCategory, activeType, {}, {}
        );

        const sorted = sortJobsByProximity(collected, userCoords, locationInfo?.wardName);
        const page = sorted.slice(0, PAGE_SIZE);
        const rest = sorted.slice(PAGE_SIZE);
        const allPrefixesDone = Object.values(nextDone).every(Boolean) &&
          Object.keys(nextDone).length === getNearbyGeohashPrefixes(
            userCoords[0], userCoords[1], radiusKmToGeohashPrecision(JOBS_RADIUS_KM)
          ).length;
        const finishedNow = allPrefixesDone && rest.length === 0;

        setJobs(page);
        setBuffer(rest);
        setPrefixCursors(nextCursors);
        setPrefixDone(nextDone);
        setDone(finishedNow);
        setLoading(false);

        jobsCache.set(cacheKey, {
          jobs: page,
          buffer: rest,
          prefixCursors: nextCursors,
          prefixDone: nextDone,
          done: finishedNow,
          timestamp: Date.now(),
        });
        saveJobsCacheToStorage(jobsCache);
      } catch (error) {
        console.error("Failed to load jobs:", error);
        setLoading(false);
        setDone(true);
      }
    })();
  }, [gpsReady, userCoords, activeCategory, activeType, locationInfo?.wardName]);

  // ─── Load more ─────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (done || loadingMore) return;
    setLoadingMore(true);

    try {
      // No GPS — use the plain fallback pagination.
      if (!userCoords) {
        if (!fallbackCursor) { setDone(true); return; }
        const snap = await getDocs(fallbackQuery(activeCategory, activeType, fallbackCursor));
        const newJobs = toJobs(snap.docs);
        setJobs((prev) => dedupe(prev, newJobs));
        setFallbackCursor(snap.docs[snap.docs.length - 1] ?? null);
        setDone(snap.docs.length < PAGE_SIZE);
        return;
      }

      const cacheKey = computeJobsCacheKey(activeCategory, activeType, userCoords);

      // Drain the local buffer first — free, no network call.
      if (buffer.length > 0) {
        const nextPage = buffer.slice(0, PAGE_SIZE);
        const remaining = buffer.slice(PAGE_SIZE);
        const merged = sortJobsByProximity(dedupe(jobs, nextPage), userCoords, locationInfo?.wardName);

        setJobs(merged);
        setBuffer(remaining);

        jobsCache.set(cacheKey, {
          jobs: merged, buffer: remaining, prefixCursors, prefixDone, done, timestamp: Date.now(),
        });
        saveJobsCacheToStorage(jobsCache);
        return;
      }

      // Buffer empty — ONE bounded extra fetch round (not a retry loop).
      const allPrefixesAlreadyDone = Object.values(prefixDone).every(Boolean) &&
        Object.keys(prefixDone).length === getNearbyGeohashPrefixes(
          userCoords[0], userCoords[1], radiusKmToGeohashPrecision(JOBS_RADIUS_KM)
        ).length;

      if (allPrefixesAlreadyDone) {
        setDone(true);
        return;
      }

      const { jobs: collected, nextCursors, nextDone } = await fetchAreaPage(
        userCoords, activeCategory, activeType, prefixCursors, prefixDone
      );

      const sorted = sortJobsByProximity(collected, userCoords, locationInfo?.wardName);
      const nextPage = sorted.slice(0, PAGE_SIZE);
      const rest = sorted.slice(PAGE_SIZE);
      const merged = sortJobsByProximity(dedupe(jobs, nextPage), userCoords, locationInfo?.wardName);

      const allDoneNow = Object.values(nextDone).every(Boolean) &&
        Object.keys(nextDone).length === getNearbyGeohashPrefixes(
          userCoords[0], userCoords[1], radiusKmToGeohashPrecision(JOBS_RADIUS_KM)
        ).length;
      const finishedNow = allDoneNow && rest.length === 0;

      setJobs(merged);
      setBuffer(rest);
      setPrefixCursors(nextCursors);
      setPrefixDone(nextDone);
      setDone(finishedNow);

      jobsCache.set(cacheKey, {
        jobs: merged, buffer: rest, prefixCursors: nextCursors, prefixDone: nextDone,
        done: finishedNow, timestamp: Date.now(),
      });
      saveJobsCacheToStorage(jobsCache);
    } catch (error) {
      console.error("Failed to load more jobs:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [done, loadingMore, buffer, jobs, userCoords, fallbackCursor, prefixCursors, prefixDone, activeCategory, activeType, locationInfo?.wardName]);

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
        <LocationBanner
          gpsReady={gpsReady}
          gpsGranted={gpsGranted}
          locationInfo={locationInfo}
          isSearchMode={isSearchMode}
          refreshingLocation={false}
          onRefresh={() => {}}
          onSetArea={() => {}}
          locationErrorMsg={null}
          hideRefreshButton={true}
        />
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
        <div className="flex gap-2 px-4 pb-2.5 overflow-x-auto no-scrollbar">
          {JOB_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setActiveType(t)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
                activeType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

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
                {searchQuery
                  ? "Try a different search term"
                  : userCoords
                  ? "No jobs within 30km of your area yet"
                  : "No listings in this category yet"}
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
              {locationInfo?.wardName && !searchQuery && userCoords ? ` · within 30km of ${locationInfo.wardName}` : ""}
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
    </div>
  );
}
