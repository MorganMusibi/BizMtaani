import { useState, useEffect, useCallback, useRef } from "react";
import { collection, query, orderBy, where, limit, startAfter, getDocs, QueryDocumentSnapshot, DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getNearbyGeohashPrefixes } from "@/lib/geohash";
interface ProductImage { url: string; public_id?: string;
}
const WARD_PAGE = 20;
const AREA_PAGE = 20;
const AREA_BUFFER_FETCH = 20;
// Internal geographic discovery stages.
//
// These are NOT user-selected visibility distances.
// They control how the feed progressively discovers
// nearby candidate adverts.
//
// Advert visibility is still controlled separately by
// isProductVisibleToUser().
const HOME_FEED_RADIUS_STEPS = [
  2.5,
  5,
  10,
  20,
  50,
];

const HOME_FEED_MAX_RADIUS_KM = 50;
interface FeedCacheEntry {
  wardProducts: Product[];
  wardCursor: Cursor | null;
  wardDone: boolean;
  areaProducts: Product[];
  areaBuffer: Product[];
  areaCursors: Record<string, Cursor | null>;
  areaDonePrefixes: Record<string, boolean>;
  areaDone: boolean;
  nationwideCursor: Cursor | null;
  nationwideDone: boolean;
  timestamp: number;
}
const FEED_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes — freshness for the poster's own device is handled by clearFeedCache() at post time instead
function loadFeedCacheFromStorage(): Map<string, FeedCacheEntry> {
  try {
    const raw = localStorage.getItem("bizmtaani_feed_cache");
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Omit<FeedCacheEntry, "wardCursor" | "areaCursors" | "nationwideCursor"> & { wardCursor: null; areaCursors: Record<string, null>; nationwideCursor: null }>;
    const map = new Map<string, FeedCacheEntry>();
    Object.entries(parsed).forEach(([key, entry]) => {
      map.set(key, { ...entry, wardCursor: null, areaCursors: {}, nationwideCursor: null });
    });
    return map;
  } catch {
    return new Map();
  }
}

// Caps how many area/ward combos are kept in localStorage at once.
// Without this, a session that browses many different areas would
// grow the cache — and the JSON.stringify cost on every save —
// without bound.
const MAX_CACHED_AREAS = 6;

function saveFeedCacheToStorage(cache: Map<string, FeedCacheEntry>) {
  try {
    // Keep only the most recently updated entries, evicting the
    // oldest first once over the cap. This also trims the in-memory
    // map itself, not just what gets written to localStorage.
    if (cache.size > MAX_CACHED_AREAS) {
      const sortedByAge = [...cache.entries()].sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );
      const toEvict = sortedByAge.slice(0, cache.size - MAX_CACHED_AREAS);
      for (const [key] of toEvict) {
        cache.delete(key);
      }
    }

    const serializable: Record<string, unknown> = {};
    cache.forEach((entry, key) => {
      const { wardCursor, areaCursors, nationwideCursor, ...rest } = entry;
      serializable[key] = rest;
    });
    localStorage.setItem("bizmtaani_feed_cache", JSON.stringify(serializable));
  } catch {
    // localStorage full or unavailable — cache just won't persist across reload
  }
}

const feedCache = loadFeedCacheFromStorage();

// Called after a successful advert post so the poster's own device
// shows the new advert immediately instead of waiting out the TTL.
// This only clears this browser's cache — it has no effect on other
// users' devices, since there is no shared server-side cache here.
export function clearFeedCache() {
  feedCache.clear();
  try {
    localStorage.removeItem("bizmtaani_feed_cache");
  } catch {
    // localStorage unavailable — nothing to clear, safe to ignore
  }
}

function computeFeedCacheKey(
  wardName: string | undefined,
  userCoords: [number, number]
): string {
  return `${wardName ?? ""}_${userCoords[0].toFixed(2)}_${userCoords[1].toFixed(2)}`;
}

// Reads a still-fresh cache entry synchronously, for seeding a hook's
// initial state before first render — avoids the empty-then-refill
// flash on remount when nothing has actually changed.
function getFreshFeedCacheEntry(key: string): FeedCacheEntry | null {
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.timestamp < FEED_CACHE_TTL_MS) {
    return cached;
  }
  return null;
}

export interface Product {
  id: string;
  title: string;
  price: number;
  rentPerMonth?: number;

  category: string;
  subcategory?: string;

  // Supports both old and new image formats
  imageUrl?: string;
  imageUrls?: (string | ProductImage)[];

  lat: number;
lng: number;

ward?: string;
constituency?: string;
county?: string;

  // Supports both old and new pricing fields
  priceType?: "fixed" | "negotiable";
  priceDisplay?: "fixed" | "negotiable";

  pricingBasis?: string;

  sellerId: string;
  sellerName: string;
  sellerType?: "business" | "individual";

  phone?: string;
  geohash?: string;

  createdAt?: { seconds: number } | null;
  expiresAt?: { seconds: number } | null;

  status?: string;
  plan?: string;

visibilityScope?: "local" | "county" | "all_areas";
visibilityRadiusKm?: number;

isPremium?: boolean;
verified?: boolean;
}
type Cursor = QueryDocumentSnapshot<DocumentData>;

 export function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function isPremiumProduct(product: Product) {
  return (
    product.plan === "premium_weekly" ||
    product.plan === "premium_monthly" ||
    product.isPremium === true
  );
}

// Premium ads sort as if they were closer than they really are — a
// ranking nudge, not a visibility rule. isProductVisibleToUser() and
// isProductEligibleForFeedStage() are untouched and still use real
// distance, so this only affects order within an already-eligible set.
const PREMIUM_SORT_DISTANCE_DISCOUNT = 0.5;

// Products whose effective (discounted) distance falls in the same
// bucket are treated as "the same area" — competing for view priority
// via weighted randomness instead of raw distance. Tune to make "same
// area" wider or narrower.
const SAME_AREA_BUCKET_KM = 1;

// How much more likely a premium ad is to win the weighted draw within
// a same-area bucket, versus a free ad. 3 means premium is roughly 3x
// as likely to land first in a head-to-head same-area tie — a real,
// statistically higher chance of being seen, not a guarantee.
const PREMIUM_VIEW_WEIGHT = 3;
const FREE_VIEW_WEIGHT = 1;

// Deterministic string hash → [0,1). Not cryptographic, just needs to
// be stable for a given (seed, productId) pair so ordering doesn't
// flicker on re-render, while varying across sessions.
function seededRandom01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

// One seed per browser tab/session — stable across re-renders and
// pagination within a visit, but different on a fresh session, so the
// weighted "who wins the same-area tie" outcome varies across visits
// rather than always favoring the same product forever.
function getViewSessionSeed(): string {
  try {
    let seed = sessionStorage.getItem("bizmtaani_view_seed");
    if (!seed) {
      seed = Math.random().toString(36).slice(2);
      sessionStorage.setItem("bizmtaani_view_seed", seed);
    }
    return seed;
  } catch {
    return "static-seed";
  }
}

// Efraimidis-Spirakis weighted random key: U^(1/weight), U uniform in
// (0,1]. Sorting descending by this key gives each item a probability
// of ranking first proportional to its weight — premium wins more
// often, but never deterministically.
function getViewPriorityKey(product: Product, sessionSeed: string): number {
  const weight = isPremiumProduct(product) ? PREMIUM_VIEW_WEIGHT : FREE_VIEW_WEIGHT;
  const u = Math.max(seededRandom01(`${sessionSeed}_${product.id}`), 0.0001);
  return Math.pow(u, 1 / weight);
}

function getEffectiveSortDistanceKm(
  userCoords: [number, number],
  product: Product
): number {
  const distance = getDistanceKm(userCoords[0], userCoords[1], product.lat, product.lng);
  return isPremiumProduct(product) ? distance * PREMIUM_SORT_DISTANCE_DISCOUNT : distance;
}

function getProductVisibilityScope(product: Product) {
  // New adverts: use explicit visibility scope
  if (product.visibilityScope) {
    return product.visibilityScope;
  }

  // Backward compatibility for existing adverts
  if (isPremiumProduct(product)) {
    return "county";
  }

  return "local";
}

export function isProductVisibleToUser(
  product: Product,
  userCoords: [number, number]
) {
  const distance = getDistanceKm(
    userCoords[0],
    userCoords[1],
    product.lat,
    product.lng
  );

  const scope = getProductVisibilityScope(product);

  // ============================================================
  // FREE / LOCAL ADVERTS
  //
  // Free adverts are only visible within their local radius.
  // Default maximum visibility = 2.5 km.
  //
  // Therefore:
  // Stage 1: visible
  // Stage 2+: not visible
  // ============================================================

  if (scope === "local") {
    const radius = product.visibilityRadiusKm ?? 2.5;

    return distance <= radius;
  }

  // ============================================================
  // PREMIUM / WIDER VISIBILITY ADVERTS
  //
  // Premium adverts are eligible for progressive geographic
  // discovery.
  //
  // The actual geographic stage is handled by the feed loader.
  // Here we only confirm that the advert has wider visibility.
  // ============================================================

  if (
    scope === "county" ||
    scope === "all_areas"
  ) {
    return true;
  }

  return false;
}
function isProductEligibleForFeedStage(
  product: Product,
  distanceKm: number,
  stageIndex: number
) {
  const isPremium = isPremiumProduct(product);

  // ============================================================
  // STAGE 1 — 0–2.5 KM
  //
  // Free + Premium adverts are allowed.
  // ============================================================

  if (stageIndex === 0) {
    return distanceKm <= 2.5;
  }

  // ============================================================
  // STAGES 2–5
  //
  // Only Premium adverts are allowed beyond 2.5 km.
  //
  // Free adverts are NEVER allowed beyond 2.5 km.
  // ============================================================

  if (!isPremium) {
    return false;
  }

  const previousRadius =
    HOME_FEED_RADIUS_STEPS[stageIndex - 1] ?? 0;

  const currentRadius =
    HOME_FEED_RADIUS_STEPS[stageIndex] ??
    HOME_FEED_MAX_RADIUS_KM;

  return (
    distanceKm > previousRadius &&
    distanceKm <= currentRadius
  );
}

function toProducts(docs: QueryDocumentSnapshot<DocumentData>[]): Product[] {
  const nowSec = Date.now() / 1000;

  return docs
    .map((d) => ({ id: d.id, ...d.data() } as Product))
    .filter((p) => {
      // Only active products
      if (p.status && p.status !== "active") {
        return false;
      }

      // Do not load/use expired products
      if (p.expiresAt && p.expiresAt.seconds <= nowSec) {
        return false;
      }

      return true;
    });
}
function filterVisibleProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  return products.filter((product) =>
    isProductVisibleToUser(product, userCoords)
  );
}

export function dedupe(existing: Product[], incoming: Product[]): Product[] {
  const ids = new Set(existing.map((p) => p.id));
  return [...existing, ...incoming.filter((p) => !ids.has(p.id))];
}

// Precomputes each product's sort-relevant values exactly once, so a
// sort of n products does O(n) distance/hash work instead of
// O(n log n) — the comparator below only does cheap lookups.
function buildSortKeys(
  products: Product[],
  userCoords: [number, number],
  sessionSeed: string
): Map<string, { bucket: number; distance: number; viewKey: number; created: number }> {
  const keys = new Map<string, { bucket: number; distance: number; viewKey: number; created: number }>();
  for (const product of products) {
    const distance = getEffectiveSortDistanceKm(userCoords, product);
    keys.set(product.id, {
      distance,
      bucket: Math.floor(distance / SAME_AREA_BUCKET_KM),
      viewKey: getViewPriorityKey(product, sessionSeed),
      created: product.createdAt?.seconds ?? 0,
    });
  }
  return keys;
}

function sortNearbyProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  const sessionSeed = getViewSessionSeed();
  const keys = buildSortKeys(products, userCoords, sessionSeed);

  return [...products].sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;

    // Different areas — real (discounted) distance still decides.
    if (ka.bucket !== kb.bucket) {
      return ka.bucket - kb.bucket;
    }

    // Same area — compete via weighted randomness instead of exact
    // distance, so premium has a statistically higher chance of
    // landing first without always winning outright.
    if (ka.viewKey !== kb.viewKey) {
      return kb.viewKey - ka.viewKey;
    }

    // Exact tie (rare) — fall back to raw distance, then newest.
    if (ka.distance !== kb.distance) return ka.distance - kb.distance;
    return kb.created - ka.created;
  });
}

export function rankProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  const sessionSeed = getViewSessionSeed();
  const keys = buildSortKeys(products, userCoords, sessionSeed);

  return [...products].sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;

    // ============================================================
    // PRIMARY FACTOR — DISTANCE (bucketed)
    // ============================================================
    if (ka.bucket !== kb.bucket) {
      return ka.bucket - kb.bucket;
    }

    // ============================================================
    // SECONDARY FACTOR — WEIGHTED VIEW PRIORITY
    // ============================================================
    if (ka.viewKey !== kb.viewKey) {
      return kb.viewKey - ka.viewKey;
    }

    // ============================================================
    // TERTIARY FACTOR — NEWER ADVERTS (rare exact-key tie)
    // ============================================================
    return kb.created - ka.created;
  });
}

function wardQuery(
  wardName: string,
  cursor?: Cursor
) {
  const coll = collection(db, "products");

  if (cursor) {
    return query(
      coll,
      where("ward", "==", wardName),
      orderBy("createdAt", "desc"),
      startAfter(cursor),
      limit(WARD_PAGE)
    );
  }

  return query(
    coll,
    where("ward", "==", wardName),
    orderBy("createdAt", "desc"),
    limit(WARD_PAGE)
  );
}
  function searchQueryAllProducts(
  cursor?: Cursor
) {
  const coll = collection(db, "products");

  if (cursor) {
    return query(
      coll,
      orderBy("createdAt", "desc"),
      startAfter(cursor),
      limit(AREA_PAGE)
    );
  }

  return query(
    coll,
    orderBy("createdAt", "desc"),
    limit(AREA_PAGE)
  );
  }
function areaQueries(
  coords: [number, number],
  radiusKm: number,
  cursors: Record<string, Cursor | null> = {},
  donePrefixes: Record<string, boolean> = {}
) {
  const prefixes = getNearbyGeohashPrefixes(
    coords[0],
    coords[1],
    radiusKm
  );
  const coll = collection(db, "products");

  return prefixes
  .map((prefix) => {
    const key = prefix;

      // Skip geohash prefixes that are already exhausted.
      if (donePrefixes[key]) {
        return null;
      }

      const cursor = cursors[key];

      if (cursor) {
        return query(
          coll,
          where("geohash", ">=", prefix),
          where("geohash", "<", prefix + "\uf8ff"),
          orderBy("geohash"),
          startAfter(cursor),
          limit(AREA_BUFFER_FETCH)
        );
      }

      return query(
        coll,
        where("geohash", ">=", prefix),
        where("geohash", "<", prefix + "\uf8ff"),
        orderBy("geohash"),
        limit(AREA_BUFFER_FETCH)
      );
    })
    .filter(
      (q): q is ReturnType<typeof query> => q !== null
    );
}

// Unbounded by geohash — used only once the normal 2.5→50km discovery
// stages are exhausted, to surface premium adverts from anywhere in
// Kenya. Only matches adverts with an explicit visibilityScope of
// "county" or "all_areas" — legacy premium adverts without that field
// set are still found via the normal radius stages (isPremiumProduct
// still makes them eligible there), just not by this nationwide stage.
function nationwidePremiumQuery(cursor?: Cursor) {
  const coll = collection(db, "products");

  if (cursor) {
    return query(
      coll,
      where("status", "==", "active"),
      where("visibilityScope", "in", ["county", "all_areas"]),
      orderBy("createdAt", "desc"),
      startAfter(cursor),
      limit(AREA_PAGE)
    );
  }

  return query(
    coll,
    where("status", "==", "active"),
    where("visibilityScope", "in", ["county", "all_areas"]),
    orderBy("createdAt", "desc"),
    limit(AREA_PAGE)
  );
}

export function useHomeFeeds({
  gpsReady,
  userCoords,
  isSearchMode,
  locationInfo,
}: {
  gpsReady: boolean;
  userCoords: [number, number] | null;
  isSearchMode: boolean;
  locationInfo: {
  wardName?: string;
  constituency?: string;
  county?: string;
} | null;
}) {

// Synchronous cache read at hook-init time — if this exact ward/coords
// combo is already cached and fresh, seed state with it directly so
// the first render after remounting doesn't show empty + spinner
// before the effect below gets a chance to run.
const initialCacheKey = !isSearchMode && gpsReady && userCoords
  ? computeFeedCacheKey(locationInfo?.wardName, userCoords)
  : null;
const initialCached = initialCacheKey ? getFreshFeedCacheEntry(initialCacheKey) : null;
// Consumed once by the effect below, then cleared — only the very
// first matching run should skip its reset-and-refetch.
const skipNextResetRef = useRef(initialCached ? initialCacheKey : null);

const [wardProducts, setWardProducts] = useState<Product[]>(initialCached?.wardProducts ?? []);
  const [wardCursor, setWardCursor] = useState<Cursor | null>(initialCached?.wardCursor ?? null);
  const [wardDone, setWardDone] = useState(initialCached?.wardDone ?? false);
  const [wardLoading, setWardLoading] = useState(false);

const [areaProducts, setAreaProducts] = useState<Product[]>(initialCached?.areaProducts ?? []);
  // Current geographic discovery stage.
//
// 0 = 2.5 km
// 1 = 5 km
// 2 = 10 km
// 3 = 20 km
// 4 = 50 km
//
// This controls candidate discovery only.
// It does NOT change advert visibility permissions.
const [areaRadiusStage, setAreaRadiusStage] = useState(0);

// Products fetched from Firestore but not yet displayed.
// These act as the nearby pagination buffer.
const [areaBuffer, setAreaBuffer] = useState<Product[]>(initialCached?.areaBuffer ?? []);

const [areaCursors, setAreaCursors] = useState<Record<string, Cursor | null>>(initialCached?.areaCursors ?? {});
const [areaDonePrefixes, setAreaDonePrefixes] = useState<Record<string, boolean>>(initialCached?.areaDonePrefixes ?? {});
const [areaDone, setAreaDone] = useState(initialCached?.areaDone ?? false);
const [areaLoading, setAreaLoading] = useState(false);

// Nationwide premium discovery — only used once the geohash radius
// stages (2.5→50km) are exhausted. Tracked separately since it isn't
// geohash-keyed like areaCursors/areaDonePrefixes.
const [nationwideCursor, setNationwideCursor] = useState<Cursor | null>(initialCached?.nationwideCursor ?? null);
const [nationwideDone, setNationwideDone] = useState(initialCached?.nationwideDone ?? false);
const [searchCursor, setSearchCursor] = useState<Cursor | null>(null);
const [searchDone, setSearchDone] = useState(false);
const [searchLoading, setSearchLoading] = useState(false);
const [initialLoading, setInitialLoading] = useState(!initialCached);

useEffect(() => {
  if (!gpsReady || !userCoords) return;

  const cacheKeyForThisRun = computeFeedCacheKey(locationInfo?.wardName, userCoords);

  // State was already seeded from this exact cache entry when the hook
  // first mounted — skip the reset-and-refetch for this one run only.
  if (!isSearchMode && skipNextResetRef.current === cacheKeyForThisRun) {
    skipNextResetRef.current = null;
    return;
  }
  skipNextResetRef.current = null;

setInitialLoading(true);

setWardProducts([]);
setWardCursor(null);
setWardDone(false);

setAreaProducts([]);
setAreaBuffer([]);
setAreaCursors({});
setAreaDone(false);
setAreaDonePrefixes({});   
setAreaRadiusStage(0);
setNationwideCursor(null);
setNationwideDone(false);

setSearchCursor(null);
setSearchDone(false);
  const run = async () => {
    

    const cacheKey = `${locationInfo?.wardName ?? ""}_${userCoords[0].toFixed(2)}_${userCoords[1].toFixed(2)}`;

    if (!isSearchMode) {
      const cached = feedCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < FEED_CACHE_TTL_MS) {
        setWardProducts(cached.wardProducts);
        setWardCursor(cached.wardCursor);
        setWardDone(cached.wardDone);
        setAreaProducts(cached.areaProducts);
        setAreaBuffer(cached.areaBuffer);
        setAreaCursors(cached.areaCursors);
        setAreaDonePrefixes(cached.areaDonePrefixes);
        setAreaDone(cached.areaDone);
        setInitialLoading(false);
        return;
      }
    }

    // ============================================================
    // SEARCH MODE
    // Search ALL products across Kenya.
    
    // Free and Premium products are treated equally.
    //
    // Expired / pending-payment / inactive products are removed
    // later by toProducts() and applyFilters().
    // ============================================================

    if (isSearchMode) {
  try {
    const snap = await getDocs(
      searchQueryAllProducts()
    );

    const products = toProducts(
      snap.docs
    );

    setWardProducts([]);

    setAreaProducts(
      sortNearbyProducts(
        products,
        userCoords
      )
    );

    setSearchCursor(
  snap.docs[
    snap.docs.length - 1
  ] ?? null
);

setSearchDone(
  snap.docs.length < AREA_PAGE
);

setWardDone(true);
setAreaDone(true);

  } catch (error) {
    console.error(
      "Failed to search products:",
      error
    );

    setWardProducts([]);
    setAreaProducts([]);

    setWardDone(true);
    setAreaDone(true);
  }

  setInitialLoading(false);
  return;
}
    // ============================================================
    // NORMAL HOME FEED
    // Keep existing ward + nearby geohash behavior.
    // ============================================================

    const wardName = locationInfo?.wardName ?? "";

    let localWardProducts: Product[] = [];
    let localWardCursor: Cursor | null = null;
    let localWardDone = true;

    if (wardName) {
      try {
        const snap = await getDocs(
          wardQuery(wardName)
        );

        const docs = filterVisibleProducts(
  toProducts(snap.docs),
  userCoords
);

        localWardProducts = sortNearbyProducts(docs, userCoords);
        localWardCursor = snap.docs[snap.docs.length - 1] ?? null;
        localWardDone = snap.docs.length < WARD_PAGE;

setWardProducts(localWardProducts);
setWardCursor(localWardCursor);
setWardDone(localWardDone);

      } catch (error) {
        console.error(
          "Failed to load ward adverts:",
          error
        );

        setWardDone(true);
      }
    } else {
      setWardDone(true);
    }
// ============================================================
// INITIAL NEARBY AREA LOAD — BUFFERED
//
// Fetch a larger nearby buffer from Firestore.
// Only 20 products are displayed at a time.
//
// The buffer allows pagination to happen locally first,
// reducing repeated Firestore reads.
//
// Flow:
//   Firestore -> areaBuffer -> 20 visible products
// ============================================================

try {
  let currentCursors: Record<string, Cursor | null> = {};
  let currentDonePrefixes: Record<string, boolean> = {};

  let collectedProducts: Product[] = [];
  let iterations = 0;
  // Not a visibility limit — purely a runaway-loop safety net.
  // Real exhaustion is decided by allPrefixesDone below; this should
  // never realistically be reached.
  const MAX_ITERATIONS = 10000;
  let allPrefixesDone = false;

  const currentRadius = HOME_FEED_RADIUS_STEPS[0];

  while (
    collectedProducts.length < AREA_BUFFER_FETCH &&
    !allPrefixesDone &&
    iterations < MAX_ITERATIONS
  ) {
    iterations++;
  const prefixes = getNearbyGeohashPrefixes(
  userCoords[0],
  userCoords[1],
  currentRadius
);

const queries = areaQueries(
  userCoords,
  currentRadius,
  currentCursors,
  currentDonePrefixes
);

    if (queries.length === 0) {
      allPrefixesDone = true;
      break;
    }

    const snapshots = await Promise.all(
      queries.map((q) => getDocs(q))
    );

    const pageProducts = snapshots.flatMap(
  (snap) => {
    const products = toProducts(snap.docs);

    return products.filter((product) => {
      const distance = getDistanceKm(
        userCoords[0],
        userCoords[1],
        product.lat,
        product.lng
      );

      return (
        isProductVisibleToUser(
          product,
          userCoords
        ) &&
        isProductEligibleForFeedStage(
          product,
          distance,
          0
        )
      );
    });
  }
);

    const uniquePageProducts = Array.from(
      new Map(
        pageProducts.map((product) => [
          product.id,
          product,
        ])
      ).values()
    );

    collectedProducts = Array.from(
      new Map(
        [
          ...collectedProducts,
          ...uniquePageProducts,
        ].map((product) => [
          product.id,
          product,
        ])
      ).values()
    );

    const updatedCursors: Record<
      string,
      Cursor | null
    > = {
      ...currentCursors,
    };

    const updatedDonePrefixes: Record<
      string,
      boolean
    > = {
      ...currentDonePrefixes,
    }
    let queryIndex = 0;

    prefixes.forEach((prefix) => {
      const key = prefix;

      if (currentDonePrefixes[key]) {
        return;
      }

      const snap = snapshots[queryIndex];
      queryIndex++;

      if (!snap) {
        updatedDonePrefixes[key] = true;
        return;
      }

      if (snap.docs.length > 0) {
        updatedCursors[key] = snap.docs[snap.docs.length - 1];
      }

      if (snap.docs.length < AREA_BUFFER_FETCH) {
        updatedDonePrefixes[key] = true;
      }
    });

    currentCursors = updatedCursors;
    currentDonePrefixes = updatedDonePrefixes;

    allPrefixesDone = prefixes.every(
      (prefix) => currentDonePrefixes[prefix] === true
    );


    // Prevent an infinite loop when every active prefix
    // returns an empty snapshot.
    if (
      snapshots.length > 0 &&
      snapshots.every(
        (snap) => snap.docs.length === 0
      )
    ) {
      allPrefixesDone = true;
    }
  }

  // collectedProducts was already filtered by isProductVisibleToUser +
  // isProductEligibleForFeedStage inside the pageProducts step above —
  // re-filtering here was redundant (same checks, same data, always
  // true) and recomputed every product's distance a second time.
  const sortedBuffer = sortNearbyProducts(
    collectedProducts,
    userCoords
  );

  // First 20 products become visible.
  // Everything else stays in the buffer.
  const localAreaProducts = sortedBuffer.slice(0, AREA_PAGE);
  const localAreaBuffer = sortedBuffer.slice(AREA_PAGE);
  const localAreaDone = allPrefixesDone && sortedBuffer.length <= AREA_PAGE;

  setAreaProducts(localAreaProducts);
  setAreaBuffer(localAreaBuffer);
  setAreaCursors(currentCursors);
  setAreaDonePrefixes(currentDonePrefixes);
  setAreaDone(localAreaDone);

  feedCache.set(cacheKey, {
    wardProducts: localWardProducts,
    wardCursor: localWardCursor,
    wardDone: localWardDone,
    areaProducts: localAreaProducts,
    areaBuffer: localAreaBuffer,
    areaCursors: currentCursors,
    areaDonePrefixes: currentDonePrefixes,
    areaDone: localAreaDone,
    nationwideCursor: null,
    nationwideDone: false,
    timestamp: Date.now(),
  });
  saveFeedCacheToStorage(feedCache);

} catch (error) {
  console.error(
    "Failed to load nearby adverts:",
    error
  );

  setAreaProducts([]);
  setAreaBuffer([]);
  setAreaDone(true);
}

    

    setInitialLoading(false);
  };

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  gpsReady,
  isSearchMode,
  locationInfo?.wardName,
  locationInfo?.constituency,
  locationInfo?.county,
  userCoords,
]);

const loadMore = useCallback(async () => {
  if (!userCoords) return;

  // ============================================================
  // SEARCH PAGINATION
  // Load 20 search results at a time.
  // ============================================================
  if (isSearchMode) {
    if (searchDone || searchLoading) return;

    setSearchLoading(true);

    try {
      const snap = await getDocs(
        searchQueryAllProducts(searchCursor ?? undefined)
      );

      const newProducts = toProducts(snap.docs);

      setAreaProducts((prev) => {
        const merged = dedupe(prev, newProducts);

        return sortNearbyProducts(
          merged,
          userCoords
        );
      });

      setSearchCursor(
        snap.docs[snap.docs.length - 1] ?? searchCursor
      );

      setSearchDone(
        snap.docs.length < AREA_PAGE
      );
    } catch (error) {
      console.error(
        "Failed to load more search results:",
        error
      );
    } finally {
      setSearchLoading(false);
    }

    return;
  }
  
     // ============================================================
// NORMAL FEED — PROGRESSIVE NEARBY AREA PAGINATION
//
// Geographic expansion:
//
//   Stage 0 → 2.5 km
//   Stage 1 → 5 km
//   Stage 2 → 10 km
//   Stage 3 → 20 km
//   Stage 4 → 50 km
//
// The feed always tries the closest geographic stage first.
// When that stage is exhausted, it expands outward.
//
// IMPORTANT:
// This does NOT change advert visibility rules.
// isProductVisibleToUser() still decides whether an advert
// is actually visible to the user.
// ============================================================

if (!areaDone && !areaLoading) {
  setAreaLoading(true);

  try {
    // ==========================================================
    // STEP 1 — CONSUME EXISTING BUFFER FIRST
    //
    // Never query Firestore if we already have products
    // waiting in the local buffer.
    // ==========================================================

    if (areaBuffer.length > 0) {
      const nextPage = areaBuffer.slice(
        0,
        AREA_PAGE
      );

      const remainingBuffer = areaBuffer.slice(
        AREA_PAGE
      );

      setAreaProducts((prev) => {
        const merged = dedupe(
          prev,
          nextPage
        );

        return sortNearbyProducts(
          merged,
          userCoords
        );
      });

      setAreaBuffer(
        remainingBuffer
      );

      return;
    }

    // ==========================================================
    // STEP 1B — NATIONWIDE PREMIUM STAGE
    //
    // Reached only after every geohash radius stage (2.5→50km) is
    // exhausted. Fetches premium adverts from anywhere in Kenya,
    // nearest-first within this page via sortNearbyProducts — so a
    // closer premium advert still outranks a farther one even here.
    // ==========================================================

    if (areaRadiusStage >= HOME_FEED_RADIUS_STEPS.length) {
      if (nationwideDone) {
        setAreaDone(true);
        return;
      }

      const snap = await getDocs(
        nationwidePremiumQuery(nationwideCursor ?? undefined)
      );

      const fetchedProducts = toProducts(snap.docs);
      const sortedFetched = sortNearbyProducts(fetchedProducts, userCoords);

      setAreaProducts((prev) =>
        sortNearbyProducts(dedupe(prev, sortedFetched), userCoords)
      );

      const newCursor = snap.docs[snap.docs.length - 1] ?? null;
      const isDone = snap.docs.length < AREA_PAGE;

      setNationwideCursor(newCursor);
      setNationwideDone(isDone);
      setAreaDone(isDone);

      return;
    }

    // ==========================================================
    // STEP 2 — GET CURRENT GEOGRAPHIC STAGE
    // ==========================================================

    const currentRadius =
      HOME_FEED_RADIUS_STEPS[
        areaRadiusStage
      ] ??
      HOME_FEED_MAX_RADIUS_KM;

    let currentCursors: Record<
      string,
      Cursor | null
    > = {
      ...areaCursors,
    };

    let currentDonePrefixes: Record<
      string,
      boolean
    > = {
      ...areaDonePrefixes,
    };

    let collectedProducts: Product[] = [];
    let allPrefixesDone = false;
    let iterations = 0;
    // Not a visibility limit — purely a runaway-loop safety net.
    // Real exhaustion is decided by allPrefixesDone below; this should
    // never realistically be reached.
    const MAX_ITERATIONS = 10000;

    // ==========================================================
    // STEP 3 — FETCH ENOUGH PRODUCTS FOR THE BUFFER
    // ==========================================================

    while (
      collectedProducts.length <
        AREA_BUFFER_FETCH &&
      !allPrefixesDone &&
      iterations < MAX_ITERATIONS
    ) {
      iterations++;
      const prefixes =
        getNearbyGeohashPrefixes(
          userCoords[0],
          userCoords[1],
          currentRadius
        );

      const queries =
        areaQueries(
          userCoords,
          currentRadius,
          currentCursors,
          currentDonePrefixes
        );

      if (queries.length === 0) {
        allPrefixesDone = true;
        break;
      }

      const snapshots =
        await Promise.all(
          queries.map((q) =>
            getDocs(q)
          )
        );

      // ========================================================
      // Convert Firestore documents into products.
      // ========================================================

      const pageProducts =
  snapshots.flatMap(
    (snap) => {
      const products =
        toProducts(snap.docs);

      return products.filter(
        (product) => {
          const distance =
            getDistanceKm(
              userCoords[0],
              userCoords[1],
              product.lat,
              product.lng
            );

          return (
            isProductVisibleToUser(
              product,
              userCoords
            ) &&
            isProductEligibleForFeedStage(
              product,
              distance,
              areaRadiusStage
            )
          );
        }
      );
    }
  );

      // ========================================================
      // Remove duplicates caused by overlapping geohashes.
      // ========================================================

      const uniquePageProducts =
        Array.from(
          new Map(
            pageProducts.map(
              (product) => [
                product.id,
                product,
              ]
            )
          ).values()
        );

      collectedProducts =
        Array.from(
          new Map(
            [
              ...collectedProducts,
              ...uniquePageProducts,
            ].map(
              (product) => [
                product.id,
                product,
              ]
            )
          ).values()
        );

      // ========================================================
      // Update cursors and exhausted prefix state.
      // ========================================================

      const updatedCursors: Record<
        string,
        Cursor | null
      > = {
        ...currentCursors,
      };

      const updatedDonePrefixes: Record<
        string,
        boolean
      > = {
        ...currentDonePrefixes,
      };

      let queryIndex = 0;

      prefixes.forEach(
        (prefix) => {
          const key = prefix;

          if (
            currentDonePrefixes[key]
          ) {
            return;
          }

          const snap =
            snapshots[queryIndex];

          queryIndex++;

          if (!snap) {
            updatedDonePrefixes[
              key
            ] = true;

            return;
          }

          if (
            snap.docs.length > 0
          ) {
            updatedCursors[
              key
            ] =
              snap.docs[
                snap.docs.length - 1
              ];
          }

          if (
            snap.docs.length <
            AREA_BUFFER_FETCH
          ) {
            updatedDonePrefixes[
              key
            ] = true;
          }
        }
      );

      currentCursors =
        updatedCursors;

      currentDonePrefixes =
        updatedDonePrefixes;

      allPrefixesDone =
        prefixes.every(
          (prefix) =>
            currentDonePrefixes[
              prefix
            ] === true
        );

      // Safety protection against endless loops.
      if (
        snapshots.length > 0 &&
        snapshots.every(
          (snap) =>
            snap.docs.length === 0
        )
      ) {
        allPrefixesDone = true;
      }
    }
    // ==========================================================
    // STEP 4 — collectedProducts is already filtered to the current
    // geographic stage (same isProductVisibleToUser +
    // isProductEligibleForFeedStage checks applied inside the
    // pageProducts step above) — re-filtering here was redundant and
    // recomputed every product's distance a second time.
    // ==========================================================

    const sortedProducts =
      sortNearbyProducts(
        collectedProducts,
        userCoords
      );

    // ==========================================================
    // STEP 5 — SHOW 20 AND BUFFER THE REST
    // ==========================================================

    const nextPage =
      sortedProducts.slice(
        0,
        AREA_PAGE
      );

    const remainingBuffer =
      sortedProducts.slice(
        AREA_PAGE
      );

    setAreaProducts(
      (prev) => {
        const merged =
          dedupe(
            prev,
            nextPage
          );

        return sortNearbyProducts(
          merged,
          userCoords
        );
      }
    );

    setAreaBuffer(
      remainingBuffer
    );

    setAreaCursors(
      currentCursors
    );

    setAreaDonePrefixes(
      currentDonePrefixes
    );

    // ==========================================================
    // STEP 6 — PROGRESSIVE RADIUS EXPANSION
    //
    // If the current radius is exhausted, move outward.
    // ==========================================================

    if (
      allPrefixesDone &&
      remainingBuffer.length === 0
    ) {
      const nextStage =
        areaRadiusStage + 1;

      if (
        nextStage <
        HOME_FEED_RADIUS_STEPS.length
      ) {
        // Expand to the next radius.
        //
        // IMPORTANT:
        // Reset geohash cursors because the larger radius
        // introduces new geohash prefixes that have never
        // been queried before.

        setAreaRadiusStage(
          nextStage
        );

        setAreaCursors({});

        setAreaDonePrefixes({});

        setAreaDone(false);
      } else if (!nationwideDone) {
        // All geohash radius stages (up to 50km) are exhausted —
        // move into the nationwide premium stage instead of ending.
        setAreaRadiusStage(nextStage);
        setAreaDone(false);
      } else {
        // Nationwide stage also exhausted — nothing left to load.
        setAreaDone(true);
      }
    } else {
      setAreaDone(false);
    }

  } catch (error) {
    console.error(
      "Failed to load more nearby adverts:",
      error
    );
  } finally {
    setAreaLoading(false);
  }
}    

}, [
  isSearchMode,
  userCoords,
  searchDone,
  searchLoading,
  searchCursor,
  areaDone,
  areaLoading,
  areaBuffer,
  areaRadiusStage,
  areaCursors,
  areaDonePrefixes,
  nationwideCursor,
  nationwideDone,
]);
return {
  wardProducts,
  areaProducts,
  wardLoading,
  areaLoading,
  wardDone,
  areaDone,
  initialLoading,
  loadMore,
};
}
