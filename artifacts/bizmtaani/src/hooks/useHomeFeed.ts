import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  where,
  limit,
  startAfter,
  getDocs,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getNearbyGeohashPrefixes, radiusKmToGeohashPrecision } from "@/lib/geohash";

interface ProductImage { url: string; public_id?: string;
}
const WARD_PAGE = 20;
const AREA_PAGE = 20;
const AREA_BUFFER_FETCH = 20;

// Single source of truth for the master admin/owner UID — must match
// OWNER_UID in the Cloud Functions backend exactly. Products posted by
// this account are treated as universally visible (see
// isProductVisibleToUser) and are actively broadcast to every viewer
// regardless of ward or distance (see adminBroadcastQuery below),
// since normal geohash-radius discovery is capped at
// HOME_FEED_MAX_RADIUS_KM and would never reach a viewer far from
// where the admin's advert happens to be located.
const OWNER_UID = "MdkkpY3BkMNdTYChcR2TaNtK08W2";
const ADMIN_BROADCAST_PAGE = 30;

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
  30,  
];

const HOME_FEED_MAX_RADIUS_KM = 30;   // was 50

// ============================================================
// SERIALIZABLE CURSORS
//
// Firestore QueryDocumentSnapshot objects cannot survive a
// JSON.stringify round trip, which is why the old cache had to
// strip cursors before writing to localStorage (and lost your
// place in every paginated list on every hard reload).
//
// Both order-by fields this file ever uses (createdAt, geohash)
// can be represented as plain, serializable values instead, and
// Firestore's startAfter() accepts raw field values just as
// happily as it accepts a document snapshot — so we build cursors
// from the field values directly and never need the snapshot
// itself past the point of extracting it.
// ============================================================
type CreatedAtCursor = { seconds: number; nanoseconds: number };
type GeohashCursor = string;

function createdAtCursorFromDoc(
  doc: QueryDocumentSnapshot<DocumentData>
): CreatedAtCursor | null {
  const createdAt = doc.get("createdAt");
  if (!createdAt || typeof createdAt.seconds !== "number") return null;
  return {
    seconds: createdAt.seconds,
    nanoseconds: typeof createdAt.nanoseconds === "number" ? createdAt.nanoseconds : 0,
  };
}

function geohashCursorFromDoc(
  doc: QueryDocumentSnapshot<DocumentData>
): GeohashCursor | null {
  const geohash = doc.get("geohash");
  return typeof geohash === "string" ? geohash : null;
}

function createdAtCursorToTimestamp(cursor: CreatedAtCursor): Timestamp {
  return new Timestamp(cursor.seconds, cursor.nanoseconds);
}

interface FeedCacheEntry {
  wardProducts: Product[];
  wardCursor: CreatedAtCursor | null;
  wardDone: boolean;
  areaProducts: Product[];
  areaBuffer: Product[];
  areaCursors: Record<string, GeohashCursor | null>;
  areaDonePrefixes: Record<string, boolean>;
  areaDone: boolean;
  areaRadiusStage: number;
  // Only used in category/subcategory mode — two independently paginated
  // sub-queries (see categoryFreeQuery/categoryPremiumQuery below) whose
  // merged, deduped results are what the hook exposes as areaProducts
  // in that mode. Undefined/unused in normal home-feed and search modes.
  categoryFreeCursor?: CreatedAtCursor | null;
  categoryFreeDone?: boolean;
  categoryPremiumCursor?: CreatedAtCursor | null;
  categoryPremiumDone?: boolean;
  timestamp: number;
}
const FEED_CACHE_TTL_MS = 30 * 60 * 1000; // 20 minutes — freshness for the poster's own device is handled by clearFeedCache() at post time instead
function loadFeedCacheFromStorage(): Map<string, FeedCacheEntry> {
  try {
    const raw = localStorage.getItem("bizmtaani_feed_cache");
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, FeedCacheEntry>;
    const map = new Map<string, FeedCacheEntry>();
    // FIX: cursors are now plain JSON-safe values (a {seconds,nanoseconds}
    // object or a geohash string), so — unlike the old wardCursor/
    // areaCursors/nationwideCursor snapshot fields — they survive the
    // round trip and are restored as-is instead of being nulled out.
    Object.entries(parsed).forEach(([key, entry]) => {
      map.set(key, entry);
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

    // FIX: no more stripping wardCursor/areaCursors/nationwideCursor —
    // they're plain values now, so the whole entry is serializable.
    const serializable: Record<string, FeedCacheEntry> = {};
    cache.forEach((entry, key) => {
      serializable[key] = entry;
    });
    localStorage.setItem("bizmtaani_feed_cache", JSON.stringify(serializable));
  } catch {
    // localStorage full or unavailable — cache just won't persist across reload
  }
}

const feedCache = loadFeedCacheFromStorage();

// Lightweight, nationwide "recent listings" used only as placeholder
// content while the real location-based feed is still resolving (GPS
// permission prompt, reverse geocode, ward/area queries).
//
// FIX: this used to be an in-memory-only module variable, which meant
// it reset on every hard reload/full navigation and re-ran the query
// every single time — the exact "re-runs on every hard load" cost
// called out in the review. It's now persisted the same way feedCache
// is, with its own TTL and key.
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const PREVIEW_CACHE_KEY = "bizmtaani_preview_cache";

function loadPreviewCacheFromStorage(): { products: Product[]; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(PREVIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { products: Product[]; timestamp: number };
    if (Date.now() - parsed.timestamp >= PREVIEW_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePreviewCacheToStorage(products: Product[]) {
  try {
    localStorage.setItem(
      PREVIEW_CACHE_KEY,
      JSON.stringify({ products, timestamp: Date.now() })
    );
  } catch {
    // localStorage full or unavailable — preview just won't persist across reload
  }
}

let previewCache: { products: Product[]; timestamp: number } | null = loadPreviewCacheFromStorage();

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
  // FIX: also clear the (now persisted) preview cache, so a poster's
  // own new listing shows up in the nationwide preview strip too,
  // instead of only in their ward/area feed.
  previewCache = null;
  try {
    localStorage.removeItem(PREVIEW_CACHE_KEY);
  } catch {
    // localStorage unavailable — nothing to clear, safe to ignore
  }
  // Also clear the persisted admin-broadcast cache, so a fresh admin
  // post shows up for every viewer immediately rather than waiting
  // out ADMIN_BROADCAST_CACHE_TTL_MS.
  adminBroadcastCache = null;
  try {
    localStorage.removeItem(ADMIN_BROADCAST_CACHE_KEY);
  } catch {
    // localStorage unavailable — nothing to clear, safe to ignore
  }
}

function computeFeedCacheKey(
  wardName: string | undefined,
  userCoords: [number, number],
  category?: string,
  subcategory?: string
): string {
  return `${wardName ?? ""}_${userCoords[0].toFixed(2)}_${userCoords[1].toFixed(2)}_${category ?? ""}_${subcategory ?? ""}`;
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
areaLabel?: string;
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

  // FIX: nanoseconds added alongside seconds. The raw Firestore
  // Timestamp on the document always carries both — toProducts()
  // spreads the whole raw document, so this was always present on
  // the actual object, just not declared in the type. Declaring it
  // lets category-page pagination build an exact-precision cursor
  // straight from an already-loaded Product, without the extra
  // getDoc() read the old code needed just to look the snapshot back up.
  createdAt?: { seconds: number; nanoseconds: number } | null;
  expiresAt?: { seconds: number } | null;

  status?: string;
  plan?: string;

visibilityScope?: "local" | "county" | "all_areas";
visibilityRadiusKm?: number;

isPremium?: boolean;
verified?: boolean;
}

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
function getViewPriorityKey(
  product: Product,
  sessionSeed: string,
  premiumWeight: number = PREMIUM_VIEW_WEIGHT,
  freeWeight: number = FREE_VIEW_WEIGHT
): number {
  const weight = isPremiumProduct(product) ? premiumWeight : freeWeight;
  const u = Math.max(seededRandom01(`${sessionSeed}_${product.id}`), 0.0001);
  return Math.pow(u, 1 / weight);
}

function getEffectiveSortDistanceKm(
  userCoords: [number, number],
  product: Product,
  premiumDiscount: number = PREMIUM_SORT_DISTANCE_DISCOUNT
): number {
  const distance = getDistanceKm(userCoords[0], userCoords[1], product.lat, product.lng);
  return isPremiumProduct(product) ? distance * premiumDiscount : distance;
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
  userCoords: [number, number],
  userWardName?: string
) {
  // Master admin adverts are visible to every user, everywhere — no
  // ward match required, no distance cap. This is the visibility half
  // of "posted by master admin = visible everywhere, unlimited posts";
  // the discovery half (actually surfacing a far-away admin product to
  // a viewer, since geohash-radius discovery below is capped at
  // HOME_FEED_MAX_RADIUS_KM) is handled separately by
  // adminBroadcastQuery / the adminBroadcastProducts fetch further
  // down this file.
  if (product.sellerId === OWNER_UID) {
    return true;
  }

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
  // Free adverts are strictly ward-based — visible only to buyers
  // whose resolved ward matches the advert's ward exactly. This is
  // a name match, not a distance check, so a free advert in one
  // ward (e.g. Baba Dogo) never leaks into a neighboring ward (e.g.
  // Lucky Summer) just because the two happen to be physically close.
  // ============================================================

  if (scope === "local") {
    if (!userWardName || !product.ward) return false;
    return (
      product.ward.trim().toLowerCase() ===
      userWardName.trim().toLowerCase()
    );
  }

  // ============================================================
  // PREMIUM / WIDER VISIBILITY ADVERTS
  //
  // Premium adverts use distance-based discovery, capped at
  // HOME_FEED_MAX_RADIUS_KM — this is what "boosts" a premium
  // advert beyond its own ward. Free adverts never use distance.
  // ============================================================

  if (
    scope === "county" ||
    scope === "all_areas"
  ) {
    return distance <= HOME_FEED_MAX_RADIUS_KM;
  }

  return false;
}
function isProductEligibleForFeedStage(
  product: Product,
  distanceKm: number,
  stageIndex: number
) {
  // Master admin adverts pass every discovery stage unconditionally —
  // consistent with isProductVisibleToUser() treating them as visible
  // everywhere, not just within the normal free/premium distance tiers.
  if (product.sellerId === OWNER_UID) {
    return true;
  }

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

      
      if (p.expiresAt && p.expiresAt.seconds <= nowSec) {
        return false;
      }

      return true;
    });
}
function filterVisibleProducts(
  products: Product[],
  userCoords: [number, number],
  userWardName?: string
): Product[] {
  return products.filter((product) =>
    isProductVisibleToUser(product, userCoords, userWardName)
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
  sessionSeed: string,
  options?: { premiumWeight?: number; freeWeight?: number; premiumDiscount?: number }
): Map<string, { bucket: number; distance: number; viewKey: number; created: number }> {
  const keys = new Map<string, { bucket: number; distance: number; viewKey: number; created: number }>();
  for (const product of products) {
    const distance = getEffectiveSortDistanceKm(userCoords, product, options?.premiumDiscount);
    keys.set(product.id, {
      distance,
      bucket: Math.floor(distance / SAME_AREA_BUCKET_KM),
      viewKey: getViewPriorityKey(product, sessionSeed, options?.premiumWeight, options?.freeWeight),
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
  userCoords: [number, number],
  options?: { premiumWeight?: number; freeWeight?: number; premiumDiscount?: number; premiumAlwaysFirst?: boolean }
): Product[] {
  const sessionSeed = getViewSessionSeed();
  const keys = buildSortKeys(products, userCoords, sessionSeed, options);

  return [...products].sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;

    // ============================================================
    // OPTIONAL — HARD PREMIUM-FIRST TIER
    // When enabled, every premium ad ranks above every free ad,
    // unconditionally — no lottery, no distance override. Distance/
    // weighting below then only decides order WITHIN each tier.
    // ============================================================
    if (options?.premiumAlwaysFirst) {
      const aPremium = isPremiumProduct(a);
      const bPremium = isPremiumProduct(b);
      if (aPremium !== bPremium) {
        return aPremium ? -1 : 1;
      }
    }

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
  cursor?: CreatedAtCursor | null
) {
  const coll = collection(db, "products");

  if (cursor) {
    return query(
      coll,
      where("ward", "==", wardName),
      where("status", "==", "active"),
      orderBy("createdAt", "desc"),
      startAfter(createdAtCursorToTimestamp(cursor)),
      limit(WARD_PAGE)
    );
  }

  return query(
    coll,
    where("ward", "==", wardName),
    where("status", "==", "active"),
    orderBy("createdAt", "desc"),
    limit(WARD_PAGE)
  );
}

  function searchQueryAllProducts(
  cursor?: CreatedAtCursor | null
) {
  const coll = collection(db, "products");

  if (cursor) {
    return query(
      coll,
      where("status", "==", "active"),
      orderBy("createdAt", "desc"),
      startAfter(createdAtCursorToTimestamp(cursor)),
      limit(AREA_PAGE)
    );
  }

  return query(
    coll,
    where("status", "==", "active"),
    orderBy("createdAt", "desc"),
    limit(AREA_PAGE)
  );
  }

// ============================================================
// MASTER ADMIN BROADCAST QUERY
//
// Ward and geohash-radius discovery (wardQuery/areaQueries below) are
// both fundamentally local — a ward name match, or a geohash prefix
// within HOME_FEED_MAX_RADIUS_KM (30km) of the viewer. Neither can
// ever surface a master-admin advert to a viewer who happens to be
// far from wherever that advert's lat/lng is. Since admin adverts are
// meant to be visible everywhere regardless of distance, they need
// their own unscoped query, independent of the viewer's location.
// ============================================================
function adminBroadcastQuery(cursor?: CreatedAtCursor | null) {
  const coll = collection(db, "products");
  const baseFilters = [
    where("sellerId", "==", OWNER_UID),
    where("status", "==", "active"),
  ];

  if (cursor) {
    return query(
      coll,
      ...baseFilters,
      orderBy("createdAt", "desc"),
      startAfter(createdAtCursorToTimestamp(cursor)),
      limit(ADMIN_BROADCAST_PAGE)
    );
  }

  return query(
    coll,
    ...baseFilters,
    orderBy("createdAt", "desc"),
    limit(ADMIN_BROADCAST_PAGE)
  );
}

// Persisted the same way previewCache is — admin broadcast content
// doesn't depend on the viewer's location at all, so every viewer on
// this device can share one cached fetch instead of re-querying on
// every mount.
const ADMIN_BROADCAST_CACHE_TTL_MS = 10 * 60 * 1000;
const ADMIN_BROADCAST_CACHE_KEY = "bizmtaani_admin_broadcast_cache";

function loadAdminBroadcastCacheFromStorage(): { products: Product[]; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(ADMIN_BROADCAST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { products: Product[]; timestamp: number };
    if (Date.now() - parsed.timestamp >= ADMIN_BROADCAST_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveAdminBroadcastCacheToStorage(products: Product[]) {
  try {
    localStorage.setItem(
      ADMIN_BROADCAST_CACHE_KEY,
      JSON.stringify({ products, timestamp: Date.now() })
    );
  } catch {
    // localStorage full or unavailable — cache just won't persist across reload
  }
}

let adminBroadcastCache: { products: Product[]; timestamp: number } | null =
  loadAdminBroadcastCacheFromStorage();

// ============================================================
// FIX — SERVER-SIDE PREMIUM FILTER (the big one)
//
// isProductEligibleForFeedStage() already rejects every non-premium
// product for stageIndex >= 1 — but the old areaQueries() had no way
// to tell Firestore that, so it fetched (and paid for) every free
// listing in the geohash prefix too, just to throw almost all of it
// away client-side. In a ward with lots of free listings and few
// premium ones, a single scroll-triggered stage expansion could read
// through that ward's *entire* free-listing history before the
// "buffer full or prefix exhausted" loop ever stopped.
//
// `premiumOnly` adds where("visibilityScope","in",["county","all_areas"])
// so stages 1+ only ever fetch documents that could possibly pass the
// stage filter in the first place.
//
// IMPORTANT — this relies on visibilityScope being set on the
// document. getProductVisibilityScope()'s legacy fallback (an old
// premium doc with `plan`/`isPremium` set but no `visibilityScope`
// field) still works for *stage 0* and for direct visibility checks,
// but a server-side `where` clause can't see a field that isn't
// there — a legacy premium doc with no visibilityScope would be
// silently skipped by this filter at stage 1+. Run the one-off
// backfill script (provided alongside this file) before shipping
// this change, so every existing premium doc has visibilityScope
// explicitly set to "county" or "all_areas". New adverts already set
// this field going forward (per getProductVisibilityScope's "new
// adverts" branch), so this is a one-time migration, not an ongoing
// requirement.
// ============================================================
function areaQueries(
  coords: [number, number],
  radiusKm: number,
  cursors: Record<string, GeohashCursor | null> = {},
  donePrefixes: Record<string, boolean> = {},
  premiumOnly: boolean = false
) {
  const prefixes = getNearbyGeohashPrefixes(
  coords[0],
  coords[1],
  radiusKmToGeohashPrecision(radiusKm)
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
      const scopeFilter = premiumOnly
        ? [where("visibilityScope", "in", ["county", "all_areas"] as const)]
        : [];

      if (cursor) {
        return query(
          coll,
          where("geohash", ">=", prefix),
          where("geohash", "<", prefix + "\uf8ff"),
          where("status", "==", "active"),
          ...scopeFilter,
          orderBy("geohash"),
          startAfter(cursor),
          limit(AREA_BUFFER_FETCH)
        );
      }

      return query(
        coll,
        where("geohash", ">=", prefix),
        where("geohash", "<", prefix + "\uf8ff"),
        where("status", "==", "active"),
        ...scopeFilter,
        orderBy("geohash"),
        limit(AREA_BUFFER_FETCH)
      );
    })
    .filter(
      (q): q is ReturnType<typeof query> => q !== null
    );
}

// ============================================================
// FIX — CATEGORY PAGES NOW USE THE SAME "DON'T FETCH WHAT YOU'LL
// DISCARD" PRINCIPLE AS THE HOME FEED.
//
// The old single categorySubcategoryQuery() pulled the most recent
// N active docs in a category/subcategory NATIONWIDE, with no ward
// or scope filter at all. CategoryAds.tsx then filtered out every
// free ad that wasn't in the viewer's own ward, client-side, AFTER
// paying for all of them. In a category with lots of free listings
// scattered across many wards, a "page" of 20 fetched docs could
// collapse to a handful actually shown — the same over-fetch pattern
// fixed in the home feed's areaQueries(), just happening here too.
//
// It also meant areaDone (and therefore "No more adverts" / whether
// infinite-scroll keeps calling loadMore) was computed from the raw
// fetched count, not the post-filter visible count — so the feed
// could report "not done" while showing almost nothing, or the
// reverse.
//
// Fix: split into two independently-scoped, independently-paginated
// queries — exactly mirroring how the normal home feed already
// separates "ward query" (free) from "area query" (premium):
//   - categoryFreeQuery: ward-scoped, only ever returns free ads the
//     viewer is actually allowed to see.
//   - categoryPremiumQuery: visibilityScope-scoped, same filter the
//     home feed's stage-1+ areaQueries() already uses.
// Both queries need a composite index (category + subcategory +
// status + ward + createdAt for the free one; category + subcategory
// + status + visibilityScope + createdAt for the premium one) —
// Firestore will show a console link to auto-create either index the
// first time each query runs, same as any other new compound query.
//
// Note: master admin adverts (visibilityScope "all_areas") already
// flow through categoryPremiumQuery like any other all_areas advert —
// no special-casing needed here.
// ============================================================
function categoryFreeQuery(
  category: string,
  subcategory: string,
  wardName: string,
  cursor?: CreatedAtCursor | null
) {
  const coll = collection(db, "products");
  const baseFilters = [
    where("category", "==", category),
    where("subcategory", "==", subcategory),
    where("status", "==", "active"),
    where("ward", "==", wardName),
  ];

  if (cursor) {
    return query(
      coll,
      ...baseFilters,
      orderBy("createdAt", "desc"),
      startAfter(createdAtCursorToTimestamp(cursor)),
      limit(AREA_PAGE)
    );
  }

  return query(
    coll,
    ...baseFilters,
    orderBy("createdAt", "desc"),
    limit(AREA_PAGE)
  );
}

function categoryPremiumQuery(
  category: string,
  subcategory: string,
  cursor?: CreatedAtCursor | null
) {
  const coll = collection(db, "products");
  const baseFilters = [
    where("category", "==", category),
    where("subcategory", "==", subcategory),
    where("status", "==", "active"),
    where("visibilityScope", "in", ["county", "all_areas"] as const),
  ];

  if (cursor) {
    return query(
      coll,
      ...baseFilters,
      orderBy("createdAt", "desc"),
      startAfter(createdAtCursorToTimestamp(cursor)),
      limit(AREA_PAGE)
    );
  }

  return query(
    coll,
    ...baseFilters,
    orderBy("createdAt", "desc"),
    limit(AREA_PAGE)
  );
}


export function useHomeFeeds({
  gpsReady,
  userCoords,
  isSearchMode,
  locationInfo,
  category,     
  subcategory,
  refreshKey,
}: {
  gpsReady: boolean;
  userCoords: [number, number] | null;
  isSearchMode: boolean;
  locationInfo: {
    wardName?: string;
    constituency?: string;
    county?: string;
  } | null;
  category?: string;      
  subcategory?: string;
  // Bump this from outside (e.g. right after a successful advert
  // post) to force a fresh Firestore fetch even though gpsReady/
  // locationInfo/userCoords haven't changed. clearFeedCache() alone
  // only empties the cache — it doesn't make an already-mounted
  // component re-run its fetch effect.
  refreshKey?: number;
}) {

// Synchronous cache read at hook-init time — if this exact ward/coords
// combo is already cached and fresh, seed state with it directly so
// the first render after remounting doesn't show empty + spinner
// before the effect below gets a chance to run.
const runIdRef = useRef(0);
const initialCacheKey = !isSearchMode && gpsReady && userCoords
  ? computeFeedCacheKey(locationInfo?.wardName, userCoords, category, subcategory)
  : null;
const initialCached = initialCacheKey ? getFreshFeedCacheEntry(initialCacheKey) : null;
// Consumed once by the effect below, then cleared — only the very
// first matching run should skip its reset-and-refetch.
const skipNextResetRef = useRef(initialCached ? initialCacheKey : null);

const [wardProducts, setWardProducts] = useState<Product[]>(initialCached?.wardProducts ?? []);
  const [wardCursor, setWardCursor] = useState<CreatedAtCursor | null>(initialCached?.wardCursor ?? null);
  const [wardDone, setWardDone] = useState(initialCached?.wardDone ?? false);
  const [wardLoading, setWardLoading] = useState(false);

const [areaProducts, setAreaProducts] = useState<Product[]>(initialCached?.areaProducts ?? []);
  // Current geographic discovery stage.
//
// 0 = 2.5 km
// 1 = 5 km
// 2 = 10 km
// 3 = 20 km
// 4 = 30 km
//
// This controls candidate discovery only.
// It does NOT change advert visibility permissions.
const [areaRadiusStage, setAreaRadiusStage] = useState(initialCached?.areaRadiusStage ?? 0);
// Products fetched from Firestore but not yet displayed.
// These act as the nearby pagination buffer.
const [areaBuffer, setAreaBuffer] = useState<Product[]>(initialCached?.areaBuffer ?? []);

const [areaCursors, setAreaCursors] = useState<Record<string, GeohashCursor | null>>(initialCached?.areaCursors ?? {});
const [areaDonePrefixes, setAreaDonePrefixes] = useState<Record<string, boolean>>(initialCached?.areaDonePrefixes ?? {});
const [areaDone, setAreaDone] = useState(initialCached?.areaDone ?? false);
const [areaLoading, setAreaLoading] = useState(false);

const [searchCursor, setSearchCursor] = useState<CreatedAtCursor | null>(null);
const [searchDone, setSearchDone] = useState(false);
const [searchLoading, setSearchLoading] = useState(false);

// Category/subcategory mode only — independent cursors/done flags for
// the two separately-scoped sub-queries (free/ward-scoped and
// premium/visibilityScope-scoped) that get merged into areaProducts.
// Unused in normal home-feed and search modes.
const [categoryFreeCursor, setCategoryFreeCursor] = useState<CreatedAtCursor | null>(initialCached?.categoryFreeCursor ?? null);
const [categoryFreeDone, setCategoryFreeDone] = useState(initialCached?.categoryFreeDone ?? false);
const [categoryPremiumCursor, setCategoryPremiumCursor] = useState<CreatedAtCursor | null>(initialCached?.categoryPremiumCursor ?? null);
const [categoryPremiumDone, setCategoryPremiumDone] = useState(initialCached?.categoryPremiumDone ?? false);

const [initialLoading, setInitialLoading] = useState(!initialCached);

// Independent of GPS/location — fetches immediately on mount so the
// homepage always has something to show within a moment, regardless
// of how long location resolution takes.
const [previewProducts, setPreviewProducts] = useState<Product[]>(previewCache?.products ?? []);
const [previewLoading, setPreviewLoading] = useState(!previewCache);

// Master admin broadcast — independent of GPS/location/ward, same as
// previewProducts above, but NOT a placeholder: this list is meant to
// stay populated permanently, on every screen, for every viewer,
// regardless of where the real ward/area feed ends up resolving to.
// Kept as its own separate list rather than threaded into
// wardProducts/areaProducts, since those two already carry complex
// pagination/cursor/cache state built around ward-matching and
// geohash-radius discovery that admin adverts deliberately bypass.
// Callers should merge this in wherever they render the feed (e.g.
// `dedupe(adminBroadcastProducts, wardProducts)`).
const [adminBroadcastProducts, setAdminBroadcastProducts] = useState<Product[]>(
  adminBroadcastCache?.products ?? []
);
const [adminBroadcastLoading, setAdminBroadcastLoading] = useState(!adminBroadcastCache);

useEffect(() => {
  if (adminBroadcastCache && Date.now() - adminBroadcastCache.timestamp < ADMIN_BROADCAST_CACHE_TTL_MS) {
    setAdminBroadcastProducts(adminBroadcastCache.products);
    setAdminBroadcastLoading(false);
    return;
  }

  let cancelled = false;
  setAdminBroadcastLoading(true);

  (async () => {
    try {
      // Master admin can post unlimited adverts, so a single
      // ADMIN_BROADCAST_PAGE-sized fetch could silently miss anything
      // beyond the newest 30 — page through until exhausted.
      // ADMIN_BROADCAST_MAX_PAGES is a runaway-loop safety net, not a
      // real visibility limit (50 * 30 = 1500 admin ads ceiling).
            const snap = await getDocs(adminBroadcastQuery(null));
      const all = toProducts(snap.docs);

      if (!cancelled) {
        setAdminBroadcastProducts(all);
        adminBroadcastCache = { products: all, timestamp: Date.now() };
        saveAdminBroadcastCacheToStorage(all);
      }
    } catch (error) {
      console.error("Failed to load master admin broadcast listings:", error);
    } finally {
      if (!cancelled) setAdminBroadcastLoading(false);
    }
  })();

  return () => { cancelled = true; };
  // refreshKey included so a freshly-posted admin advert shows up for
  // the poster immediately, same as the rest of the feed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [refreshKey]);

useEffect(() => {
  // Only worth fetching a nationwide fallback when the real,
  // location-based feed hasn't already resolved synchronously
  // (localStorage cache or saved profile location) — for a
  // returning user, the real feed fires almost instantly and this
  // would just be a wasted Firestore read for content nobody sees.
  // gpsReady's value at mount time is what matters here, which is
  // exactly what an empty dependency array captures.
    if (gpsReady && userCoords) {
    setPreviewLoading(false);
    return;
  }

  if (previewCache && Date.now() - previewCache.timestamp < PREVIEW_CACHE_TTL_MS) {
    setPreviewProducts(previewCache.products);
    setPreviewLoading(false);
    return;
  }

  let cancelled = false;

  (async () => {
    try {
      const snap = await getDocs(searchQueryAllProducts());
      const products = toProducts(snap.docs);
      if (!cancelled) {
        setPreviewProducts(products);
        previewCache = { products, timestamp: Date.now() };
        savePreviewCacheToStorage(products);
      }
    } catch (error) {
      console.error("Failed to load preview listings:", error);
    } finally {
      if (!cancelled) setPreviewLoading(false);
    }
  })();

  return () => { cancelled = true; };
}, []);

useEffect(() => {
  if (!gpsReady || !userCoords) return;

  const cacheKeyForThisRun = computeFeedCacheKey(locationInfo?.wardName, userCoords, category, subcategory);
  // State was already seeded from this exact cache entry when the hook
  // first mounted — skip the reset-and-refetch for this one run only.
  if (!isSearchMode && skipNextResetRef.current === cacheKeyForThisRun) {
    skipNextResetRef.current = null;
    return;
  }
  skipNextResetRef.current = null;

const myRun = ++runIdRef.current;
const stale = () => runIdRef.current !== myRun;
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

setSearchCursor(null);
setSearchDone(false);

setCategoryFreeCursor(null);
setCategoryFreeDone(false);
setCategoryPremiumCursor(null);
setCategoryPremiumDone(false);
  const run = async () => {
    

    const cacheKey = computeFeedCacheKey(locationInfo?.wardName, userCoords, category, subcategory);
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
    setAreaRadiusStage(cached.areaRadiusStage ?? 0);
    setCategoryFreeCursor(cached.categoryFreeCursor ?? null);
    setCategoryFreeDone(cached.categoryFreeDone ?? false);
    setCategoryPremiumCursor(cached.categoryPremiumCursor ?? null);
    setCategoryPremiumDone(cached.categoryPremiumDone ?? false);
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

    const lastDoc = snap.docs[snap.docs.length - 1];
    setSearchCursor(lastDoc ? createdAtCursorFromDoc(lastDoc) : null);

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
// CATEGORY/SUBCATEGORY MODE
// Show products from a specific category/subcategory
// ============================================================

if (category && subcategory) {
  const categoryWardName = locationInfo?.wardName ?? "";

  try {
    // FIX: two separately-scoped queries instead of one nationwide
    // fetch + client-side ward discard — see the comment above
    // categoryFreeQuery/categoryPremiumQuery for why. Free-ad query is
    // skipped entirely when there's no resolved ward yet (matching
    // how the normal home feed's ward query behaves with no wardName).
    const [freeSnap, premiumSnap] = await Promise.all([
      categoryWardName
        ? getDocs(categoryFreeQuery(category, subcategory, categoryWardName))
        : Promise.resolve(null),
      getDocs(categoryPremiumQuery(category, subcategory)),
    ]);

    if (stale()) return;
const freeProducts = freeSnap ? toProducts(freeSnap.docs) : [];
const premiumProducts = toProducts(premiumSnap.docs);
    const merged = dedupe(freeProducts, premiumProducts);

    // Rank by distance if we have user coords
    const rankedProducts = userCoords
      ? sortNearbyProducts(merged, userCoords)
      : merged;

    const localFreeDone = categoryWardName ? freeSnap!.docs.length < AREA_PAGE : true;
    const localPremiumDone = premiumSnap.docs.length < AREA_PAGE;
    const localFreeCursor = categoryWardName && freeSnap!.docs.length > 0
      ? createdAtCursorFromDoc(freeSnap!.docs[freeSnap!.docs.length - 1])
      : null;
    const localPremiumCursor = premiumSnap.docs.length > 0
      ? createdAtCursorFromDoc(premiumSnap.docs[premiumSnap.docs.length - 1])
      : null;

    setWardProducts([]);
    setAreaProducts(rankedProducts);
    setWardDone(true);
    setCategoryFreeCursor(localFreeCursor);
    setCategoryFreeDone(localFreeDone);
    setCategoryPremiumCursor(localPremiumCursor);
    setCategoryPremiumDone(localPremiumDone);
    setAreaDone(localFreeDone && localPremiumDone);

    // Cache the results
    if (!isSearchMode) {
      feedCache.set(cacheKey, {
        wardProducts: [],
        wardCursor: null,
        wardDone: true,
        areaProducts: rankedProducts,
        areaBuffer: [],
        areaCursors: {},
        areaDonePrefixes: {},
        areaDone: localFreeDone && localPremiumDone,
        areaRadiusStage: 0,
        categoryFreeCursor: localFreeCursor,
        categoryFreeDone: localFreeDone,
        categoryPremiumCursor: localPremiumCursor,
        categoryPremiumDone: localPremiumDone,
        timestamp: Date.now(),
      });
      saveFeedCacheToStorage(feedCache);
    }
  } catch (error) {
    console.error("Failed to load category products:", error);
    setWardProducts([]);
    setAreaProducts([]);
    setWardDone(true);
    setCategoryFreeDone(true);
    setCategoryPremiumDone(true);
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
    let localWardCursor: CreatedAtCursor | null = null;
    let localWardDone = true;

    // The ward query and the stage-0 premium gap-fill query don't
    // depend on each other — the gap-fill only needs userCoords, and
    // only uses the ward query's results afterward, to dedupe. They
    // used to run strictly one after the other (gap-fill only started
    // once the ward query had fully resolved); firing both together
    // removes one full round-trip's worth of serialized latency
    // whenever a ward name is already known. Each has its own catch
    // so a failure in one doesn't wipe out a successful result from
    // the other, same isolation as before.
    let stage0Snapshots: Awaited<ReturnType<typeof getDocs>>[] = [];
    let stage0Prefixes: string[] = [];

    if (wardName) {
      stage0Prefixes = getNearbyGeohashPrefixes(
        userCoords[0],
        userCoords[1],
        radiusKmToGeohashPrecision(HOME_FEED_RADIUS_STEPS[0])
      );
      const stage0Queries = areaQueries(
        userCoords,
        HOME_FEED_RADIUS_STEPS[0],
        {},
        {},
        true // premium-only — free ads are already fully covered by wardQuery
      );

      const wardPromise = getDocs(wardQuery(wardName)).catch((error) => {
        console.error("Failed to load ward adverts:", error);
        return null;
      });
      const stage0Promise = Promise.all(stage0Queries.map((q) => getDocs(q))).catch((error) => {
        console.error("Failed stage-0 premium gap-fill query:", error);
        return [] as Awaited<ReturnType<typeof getDocs>>[];
      });

      const [wardSnap, resolvedStage0Snapshots] = await Promise.all([wardPromise, stage0Promise]);
      if (stale()) return;
      stage0Snapshots = resolvedStage0Snapshots;

      if (wardSnap) {
        const docs = filterVisibleProducts(
          toProducts(wardSnap.docs),
          userCoords,
          wardName
        );

        localWardProducts = sortNearbyProducts(docs, userCoords);
        const lastWardDoc = wardSnap.docs[wardSnap.docs.length - 1];
        localWardCursor = lastWardDoc ? createdAtCursorFromDoc(lastWardDoc) : null;
        localWardDone = wardSnap.docs.length < WARD_PAGE;

        setWardProducts(localWardProducts);
        setWardCursor(localWardCursor);
        setWardDone(localWardDone);
      } else {
        setWardDone(true);
      }
    } else {
      setWardDone(true);
    }

    // The ward query already covers this user's most-local candidates
    // (a product in their ward is almost always also within 2.5km of
    // them). The stage-0 geohash fan-out targets that exact same
    // 2.5km radius, so running it whenever the ward query found
    // anything at all would re-fetch — and re-bill for — mostly the
    // same documents under a different index. Skip stage 0 entirely
    // whenever the ward query returned any results, and start any
    // "load more" scrolling at stage 1 (5km) instead, so we only pay
    // for genuinely new ground beyond what the ward query already
    // covered.
    const wardHadResults = localWardProducts.length > 0;

if (wardHadResults) {
  // Ward query already covers this viewer's most-local free+premium
  // candidates THAT MATCH THEIR WARD NAME EXACTLY. But a premium ad
  // within 2.5km whose stored `ward` field doesn't exactly match the
  // viewer's currently-resolved wardName (GPS drift, boundary edge,
  // slightly different geocode result) would never surface via
  // wardQuery — and jumping straight to areaRadiusStage=1 below
  // permanently excludes it too, since stage 1+ only accepts
  // distance > 2.5km. The stage-0 premium snapshots already fetched
  // above (in parallel with the ward query) close that gap.
  let stage0PremiumProducts: Product[] = [];
  let stage0Cursors: Record<string, GeohashCursor | null> = {};
  let stage0DonePrefixes: Record<string, boolean> = {};

  try {
    const pageProducts = stage0Snapshots.flatMap((snap) => {
      const products = toProducts(snap.docs);
      return products.filter((product) => {
        const distance = getDistanceKm(userCoords[0], userCoords[1], product.lat, product.lng);
        return (
          isProductVisibleToUser(product, userCoords, wardName) &&
          isProductEligibleForFeedStage(product, distance, 0)
        );
      });
    });

    const wardIds = new Set(localWardProducts.map((p) => p.id));
    stage0PremiumProducts = Array.from(
      new Map(pageProducts.filter((p) => !wardIds.has(p.id)).map((p) => [p.id, p])).values()
    );

    let queryIndex = 0;
    stage0Prefixes.forEach((prefix) => {
      const snap = stage0Snapshots[queryIndex];
      queryIndex++;
      if (!snap) {
        stage0DonePrefixes[prefix] = true;
        return;
      }
      const lastDoc = snap.docs[snap.docs.length - 1];
      if (lastDoc) stage0Cursors[prefix] = geohashCursorFromDoc(lastDoc);
      if (snap.docs.length < AREA_BUFFER_FETCH) stage0DonePrefixes[prefix] = true;
    });
  } catch (error) {
    console.error("Failed to process stage-0 premium gap-fill results:", error);
  }

  const sortedStage0 = sortNearbyProducts(stage0PremiumProducts, userCoords);

  setAreaProducts(sortedStage0);
  setAreaBuffer([]);
  setAreaCursors(stage0Cursors);
  setAreaDonePrefixes(stage0DonePrefixes);
  setAreaDone(false);
  setAreaRadiusStage(1);

  feedCache.set(cacheKey, {
    wardProducts: localWardProducts,
    wardCursor: localWardCursor,
    wardDone: localWardDone,
    areaProducts: sortedStage0,
    areaBuffer: [],
    areaCursors: stage0Cursors,
    areaDonePrefixes: stage0DonePrefixes,
    areaDone: false,
    areaRadiusStage: 1,
    timestamp: Date.now(),
  });
  saveFeedCacheToStorage(feedCache);

  setInitialLoading(false);
  return;
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
  let currentCursors: Record<string, GeohashCursor | null> = {};
  let currentDonePrefixes: Record<string, boolean> = {};

  let collectedProducts: Product[] = [];
  let iterations = 0;
  const MAX_ITERATIONS = 10000;
  let allPrefixesDone = false;

  const currentRadius = HOME_FEED_RADIUS_STEPS[0];

  // FIX: this loop used to run to completion (a full 20-product buffer,
  // or every prefix exhausted) before anything reached the screen — in
  // a sparsely-populated area that could mean several sequential
  // Firestore round-trips with a blank screen the whole time. Now the
  // first non-empty batch is flushed immediately; the loop then keeps
  // running purely to top up the scroll buffer in the background.
  let hasFlushedFirstPaint = false;
  let shownIds = new Set<string>();
  let flushedFirstPage: Product[] = [];

  while (
    collectedProducts.length < AREA_BUFFER_FETCH &&
    !allPrefixesDone &&
    iterations < MAX_ITERATIONS
  ) {
    iterations++;
    const prefixes = getNearbyGeohashPrefixes(
      userCoords[0],
      userCoords[1],
      radiusKmToGeohashPrecision(currentRadius)
    );

    const queries = areaQueries(
      userCoords,
      currentRadius,
      currentCursors,
      currentDonePrefixes,
      true
    );

    if (queries.length === 0) {
      allPrefixesDone = true;
      break;
    }

    const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
    if (stale()) return;

    const pageProducts = snapshots.flatMap((snap) => {
      const products = toProducts(snap.docs);
      return products.filter((product) => {
        const distance = getDistanceKm(
          userCoords[0],
          userCoords[1],
          product.lat,
          product.lng
        );
        return (
          isProductVisibleToUser(product, userCoords, wardName) &&
          isProductEligibleForFeedStage(product, distance, 0)
        );
      });
    });

    const uniquePageProducts = Array.from(
      new Map(pageProducts.map((product) => [product.id, product])).values()
    );

    collectedProducts = Array.from(
      new Map(
        [...collectedProducts, ...uniquePageProducts].map((product) => [
          product.id,
          product,
        ])
      ).values()
    );

    const updatedCursors: Record<string, GeohashCursor | null> = {
      ...currentCursors,
    };
    const updatedDonePrefixes: Record<string, boolean> = {
      ...currentDonePrefixes,
    };
    let queryIndex = 0;

    prefixes.forEach((prefix) => {
      const key = prefix;
      if (currentDonePrefixes[key]) return;
      const snap = snapshots[queryIndex];
      queryIndex++;
      if (!snap) {
        updatedDonePrefixes[key] = true;
        return;
      }
      const lastDoc = snap.docs[snap.docs.length - 1];
      if (lastDoc) updatedCursors[key] = geohashCursorFromDoc(lastDoc);
      if (snap.docs.length < AREA_BUFFER_FETCH) updatedDonePrefixes[key] = true;
    });

    currentCursors = updatedCursors;
    currentDonePrefixes = updatedDonePrefixes;

    allPrefixesDone = prefixes.every(
      (prefix) => currentDonePrefixes[prefix] === true
    );

    if (
      snapshots.length > 0 &&
      snapshots.every((snap) => snap.docs.length === 0)
    ) {
      allPrefixesDone = true;
    }

    // FIRST-PAINT FLUSH — show what we have the moment we have anything,
    // rather than waiting for the buffer to fill or prefixes to exhaust.
    if (!hasFlushedFirstPaint && collectedProducts.length > 0) {
      hasFlushedFirstPaint = true;
      const sortedSoFar = sortNearbyProducts(collectedProducts, userCoords);
      flushedFirstPage = sortedSoFar.slice(0, AREA_PAGE);
      const restAsBuffer = sortedSoFar.slice(AREA_PAGE);
      shownIds = new Set(flushedFirstPage.map((p) => p.id));

      setAreaProducts(flushedFirstPage);
      setAreaBuffer(restAsBuffer);
      setAreaCursors(currentCursors);
      setAreaDonePrefixes(currentDonePrefixes);
      setAreaDone(false);
      setInitialLoading(false);
      // No cache write yet — the background top-up below may still add
      // more; the cache gets the fuller result once collection finishes.
    }
  }

  // Final commit, once the background top-up finishes (or the area is
  // genuinely exhausted).
  const sortedBuffer = sortNearbyProducts(collectedProducts, userCoords);

  if (hasFlushedFirstPaint) {
    // The first page is already on screen — never reshuffle what the
    // user is already looking at. Anything collected since the flush
    // that isn't already shown becomes the buffer for "load more".
    const newBuffer = sortedBuffer.filter((p) => !shownIds.has(p.id));
    const localAreaDone = allPrefixesDone && newBuffer.length === 0;

    setAreaBuffer(newBuffer);
    setAreaCursors(currentCursors);
    setAreaDonePrefixes(currentDonePrefixes);
    setAreaDone(localAreaDone);

    feedCache.set(cacheKey, {
      wardProducts: localWardProducts,
      wardCursor: localWardCursor,
      wardDone: localWardDone,
      areaProducts: flushedFirstPage,
      areaBuffer: newBuffer,
      areaCursors: currentCursors,
      areaDonePrefixes: currentDonePrefixes,
      areaDone: localAreaDone,
      areaRadiusStage: 0,
      timestamp: Date.now(),
    });
    saveFeedCacheToStorage(feedCache);
  } else {
    // Nothing was ever found — identical to the original behavior for
    // a genuinely empty area.
    const localAreaProducts = sortedBuffer.slice(0, AREA_PAGE);
    const localAreaBuffer = sortedBuffer.slice(AREA_PAGE);
    const localAreaDone = false;
// Stage 0 found nothing: continue at stage 1 (5km, premium only)
setAreaRadiusStage(1);
currentCursors = {};
currentDonePrefixes = {};
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
      areaRadiusStage: 1,
      timestamp: Date.now(),
    });
    saveFeedCacheToStorage(feedCache);
  }
} catch (error) {
  console.error("Failed to load nearby adverts:", error);
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
  userCoords?.[0],
userCoords?.[1],
  category,      
  subcategory,
  refreshKey,
]);

const loadMore = useCallback(async () => {
  if (!userCoords) return;

  const cacheKey = computeFeedCacheKey(locationInfo?.wardName, userCoords, category, subcategory);

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

      const lastDoc = snap.docs[snap.docs.length - 1];
      setSearchCursor(lastDoc ? createdAtCursorFromDoc(lastDoc) : searchCursor);

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
// CATEGORY/SUBCATEGORY PAGINATION
// ============================================================
if (category && subcategory) {
  if (areaDone || areaLoading) return;

  setAreaLoading(true);
  try {
    const categoryWardName = locationInfo?.wardName ?? "";

    // FIX: each sub-query pages off its own tracked cursor
    // (categoryFreeCursor / categoryPremiumCursor in state) instead of
    // reverse-engineering a single cursor from the last merged,
    // re-sorted product — which broke down once there were two
    // independently-scoped queries feeding the same list. A query
    // whose own side is already exhausted is skipped entirely rather
    // than re-fetched.
    const [freeSnap, premiumSnap] = await Promise.all([
      !categoryFreeDone && categoryWardName
        ? getDocs(categoryFreeQuery(category, subcategory, categoryWardName, categoryFreeCursor))
        : Promise.resolve(null),
      !categoryPremiumDone
        ? getDocs(categoryPremiumQuery(category, subcategory, categoryPremiumCursor))
        : Promise.resolve(null),
    ]);

    const newFreeProducts = freeSnap ? toProducts(freeSnap.docs) : [];
    const newPremiumProducts = premiumSnap ? toProducts(premiumSnap.docs) : [];
    const newProducts = dedupe(newFreeProducts, newPremiumProducts);

    setAreaProducts((prev) => {
      const merged = dedupe(prev, newProducts);
      return userCoords
        ? sortNearbyProducts(merged, userCoords)
        : merged;
    });

    const nextFreeDone = freeSnap ? freeSnap.docs.length < AREA_PAGE : categoryFreeDone;
    const nextPremiumDone = premiumSnap ? premiumSnap.docs.length < AREA_PAGE : categoryPremiumDone;
    const nextFreeCursor = freeSnap && freeSnap.docs.length > 0
      ? createdAtCursorFromDoc(freeSnap.docs[freeSnap.docs.length - 1])
      : categoryFreeCursor;
    const nextPremiumCursor = premiumSnap && premiumSnap.docs.length > 0
      ? createdAtCursorFromDoc(premiumSnap.docs[premiumSnap.docs.length - 1])
      : categoryPremiumCursor;

    setCategoryFreeDone(nextFreeDone);
    setCategoryPremiumDone(nextPremiumDone);
    setCategoryFreeCursor(nextFreeCursor);
    setCategoryPremiumCursor(nextPremiumCursor);
    setAreaDone(nextFreeDone && nextPremiumDone);
  } catch (error) {
    console.error("Failed to load more category products:", error);
  } finally {
    setAreaLoading(false);
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
//   Stage 4 → 30 km
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
  try {
    if (areaBuffer.length > 0) {
      const nextPage = areaBuffer.slice(
        0,
        AREA_PAGE
      );


  const remainingBuffer = areaBuffer.slice(
    AREA_PAGE
  );

  const mergedAreaProducts = sortNearbyProducts(
    dedupe(areaProducts, nextPage),
    userCoords
  );

  setAreaProducts(mergedAreaProducts);
  setAreaBuffer(remainingBuffer);

  feedCache.set(cacheKey, {
    wardProducts,
    wardCursor,
    wardDone,
    areaProducts: mergedAreaProducts,
    areaBuffer: remainingBuffer,
    areaCursors,
    areaDonePrefixes,
    areaDone,
    areaRadiusStage,
    timestamp: Date.now(),
  });
  saveFeedCacheToStorage(feedCache);

  return;
}

    // ==========================================================
    // STEP 1B — DISCOVERY EXHAUSTED
    //
    // All geohash radius stages have been tried. Countrywide
    // discovery has been removed — nothing further to load.
    // ==========================================================

    if (areaRadiusStage >= HOME_FEED_RADIUS_STEPS.length) {
      setAreaDone(true);
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

    // FIX: stage >= 1 only ever accepts premium products (see
    // isProductEligibleForFeedStage), so from here on areaQueries()
    // is told to filter for that server-side instead of fetching
    // every free listing in the prefix just to discard it client-side.
    const stageIsPremiumOnly = areaRadiusStage >= 1;

    let currentCursors: Record<
      string,
      GeohashCursor | null
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
    radiusKmToGeohashPrecision(currentRadius)
  );

      const queries =
        areaQueries(
          userCoords,
          currentRadius,
          currentCursors,
          currentDonePrefixes,
          stageIsPremiumOnly
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
              userCoords,
              locationInfo?.wardName
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
        GeohashCursor | null
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

          const lastDoc =
            snap.docs[
              snap.docs.length - 1
            ];

          if (lastDoc) {
            updatedCursors[key] =
              geohashCursorFromDoc(lastDoc);
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

    const mergedStageProducts = sortNearbyProducts(
  dedupe(areaProducts, nextPage),
  userCoords
);

setAreaProducts(mergedStageProducts);
setAreaBuffer(remainingBuffer);
setAreaCursors(currentCursors);
setAreaDonePrefixes(currentDonePrefixes);

// ==========================================================
// STEP 6 — PROGRESSIVE RADIUS EXPANSION
//
// If the current radius is exhausted, move outward.
// ==========================================================

let resolvedNextStage = areaRadiusStage;
let resolvedAreaDone = false;
let resolvedCursors = currentCursors;
let resolvedDonePrefixes = currentDonePrefixes;

if (allPrefixesDone && remainingBuffer.length === 0) {
  const nextStage = areaRadiusStage + 1;

  if (nextStage < HOME_FEED_RADIUS_STEPS.length) {
    // Expand to the next radius.
    //
    // IMPORTANT:
    // Reset geohash cursors because the larger radius
    // introduces new geohash prefixes that have never
    // been queried before.
    setAreaRadiusStage(nextStage);
    setAreaCursors({});
    setAreaDonePrefixes({});
    setAreaDone(false);

    resolvedNextStage = nextStage;
    resolvedAreaDone = false;
    resolvedCursors = {};
    resolvedDonePrefixes = {};
} else {
    // All radius stages are exhausted — countrywide discovery
    // removed, so there's nothing further to load.
    setAreaDone(true);
    resolvedAreaDone = true;
  }
} else {
  setAreaDone(false);
  resolvedAreaDone = false;
}

feedCache.set(cacheKey, {
  wardProducts,
  wardCursor,
  wardDone,
  areaProducts: mergedStageProducts,
  areaBuffer: remainingBuffer,
  areaCursors: resolvedCursors,
  areaDonePrefixes: resolvedDonePrefixes,
  areaDone: resolvedAreaDone,
  areaRadiusStage: resolvedNextStage,
  timestamp: Date.now(),
});
saveFeedCacheToStorage(feedCache);

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
  areaProducts,
  areaRadiusStage,
  areaCursors,
  areaDonePrefixes,
  locationInfo?.wardName,
  wardProducts,
  wardCursor,
  wardDone,
  category,     
  subcategory,   
  categoryFreeDone,
  categoryPremiumDone,
  categoryFreeCursor,
  categoryPremiumCursor,
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
  previewProducts,
  previewLoading,
  // Master admin broadcast listings — always visible everywhere,
  // independent of ward/distance. Merge into whatever list you're
  // rendering, e.g. dedupe(adminBroadcastProducts, wardProducts).
  adminBroadcastProducts,
  adminBroadcastLoading,
  // True once discovery has moved past stage 0 (2.5km) — at that
  // point isProductEligibleForFeedStage only allows premium adverts
  // through, and free adverts are ward-matched so they never appear
  // here anyway. areaProducts is effectively premium-only reach from
  // here on, so the homepage can label this section accordingly.
  areaIsPremiumOnly: areaRadiusStage >= 1,
};
}
