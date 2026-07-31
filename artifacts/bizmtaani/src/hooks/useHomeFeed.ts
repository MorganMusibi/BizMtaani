import { useState, useEffect, useCallback } from "react";
import { collection, query, orderBy, where, limit, startAfter, getDocs, QueryDocumentSnapshot, DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getNearbyGeohashPrefixes } from "@/lib/geohash";
interface ProductImage { url: string; public_id?: string;
}
const WARD_PAGE = 20;
const AREA_PAGE = 20;
const AREA_BUFFER_FETCH = 40;
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
function sortNearbyProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  return [...products].sort((a, b) => {
    const distanceA = getDistanceKm(
      userCoords[0],
      userCoords[1],
      a.lat,
      a.lng
    );

    const distanceB = getDistanceKm(
      userCoords[0],
      userCoords[1],
      b.lat,
      b.lng
    );

    // Distance remains the primary ordering factor.
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }

    // Premium wins only when distance is effectively tied.
    const premiumA = isPremiumProduct(a);
    const premiumB = isPremiumProduct(b);

    if (premiumA !== premiumB) {
      return premiumA ? -1 : 1;
    }

    // Newer adverts first when distance and premium status tie.
    const createdA = a.createdAt?.seconds ?? 0;
    const createdB = b.createdAt?.seconds ?? 0;

    return createdB - createdA;
  });
}

export function rankProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  return [...products].sort((a, b) => {
    const distanceA = getDistanceKm(
      userCoords[0],
      userCoords[1],
      a.lat,
      a.lng
    );

    const distanceB = getDistanceKm(
      userCoords[0],
      userCoords[1],
      b.lat,
      b.lng
    );

    // ============================================================
    // PRIMARY FACTOR — DISTANCE
    //
    // The home feed always prefers adverts that are physically
    // closer to the user.
    // ============================================================

    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }

    // ============================================================
    // SECONDARY FACTOR — PREMIUM
    //
    // Premium gets a boost when adverts are at approximately
    // the same distance.
    // ============================================================

    const premiumA = isPremiumProduct(a);
    const premiumB = isPremiumProduct(b);

    if (premiumA !== premiumB) {
      return premiumA ? -1 : 1;
    }

    // ============================================================
    // TERTIARY FACTOR — NEWER ADVERTS
    // ============================================================

    const createdA = a.createdAt?.seconds ?? 0;
    const createdB = b.createdAt?.seconds ?? 0;

    return createdB - createdA;
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
  } | null;
}) {

const [wardProducts, setWardProducts] = useState<Product[]>([]);
  const [wardCursor, setWardCursor] = useState<Cursor | null>(null);
  const [wardDone, setWardDone] = useState(false);
  const [wardLoading, setWardLoading] = useState(false);

const [areaProducts, setAreaProducts] = useState<Product[]>([]);
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
const [areaBuffer, setAreaBuffer] = useState<Product[]>([]);

const [areaCursors, setAreaCursors] = useState<Record<string, Cursor | null>>({});
const [areaDonePrefixes, setAreaDonePrefixes] = useState<Record<string, boolean>>({});
const [areaDone, setAreaDone] = useState(false);
const [areaLoading, setAreaLoading] = useState(false);
const [searchCursor, setSearchCursor] = useState<Cursor | null>(null);
const [searchDone, setSearchDone] = useState(false);
const [searchLoading, setSearchLoading] = useState(false);
const [initialLoading, setInitialLoading] = useState(true);

useEffect(() => {
  if (!gpsReady || !userCoords) return;

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
  const run = async () => {

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

    if (wardName) {
      try {
        const snap = await getDocs(
          wardQuery(wardName)
        );

        const docs = filterVisibleProducts(
  toProducts(snap.docs),
  userCoords
);

setWardProducts(
  sortNearbyProducts(
    docs,
    userCoords
  )
);

        setWardCursor(
          snap.docs[snap.docs.length - 1] ?? null
        );

        setWardDone(
          snap.docs.length < WARD_PAGE
        );

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
  let allPrefixesDone = false;

    const currentRadius = HOME_FEED_RADIUS_STEPS[0];

  while (
    collectedProducts.length < AREA_BUFFER_FETCH &&
    !allPrefixesDone
  ) {
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

  const radiusFilteredProducts =
  collectedProducts.filter((product) => {
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

const sortedBuffer = sortNearbyProducts(
  radiusFilteredProducts,
  userCoords
);

  // First 20 products become visible.
  // Everything else stays in the buffer.
  setAreaProducts(
    sortedBuffer.slice(0, AREA_PAGE)
  );

  setAreaBuffer(
    sortedBuffer.slice(AREA_PAGE)
  );

  setAreaCursors(currentCursors);
  setAreaDonePrefixes(currentDonePrefixes);

  // We are done only when Firestore has no more prefixes
  // AND there are no buffered products waiting to be shown.
  setAreaDone(
    allPrefixesDone &&
    sortedBuffer.length <= AREA_PAGE
  );

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
}, [gpsReady, isSearchMode, locationInfo?.wardName, userCoords]);

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
// NORMAL FEED — WARD-FIRST PAGINATION
//
// 1. Load the next 20 adverts from the user's ward first.
// 2. Only after ward adverts are exhausted, load nearby adverts.
// ============================================================

if (!wardDone && !wardLoading) {
  const wardName = locationInfo?.wardName;

  if (!wardName) {
    setWardDone(true);
    return;
  }

  setWardLoading(true);

  try {
    const snap = await getDocs(
      wardQuery(
        wardName,
        wardCursor ?? undefined
      )
    );

    const newWardProducts = filterVisibleProducts(
  toProducts(snap.docs),
  userCoords
);

    setWardProducts((prev) =>
      dedupe(
        prev,
        newWardProducts
      )
    );

    setWardCursor(
      snap.docs[
        snap.docs.length - 1
      ] ?? wardCursor
    );

    setWardDone(
      snap.docs.length < WARD_PAGE
    );

  } catch (error) {
    console.error(
      "Failed to load more ward adverts:",
      error
    );
  } finally {
    setWardLoading(false);
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

    // ==========================================================
    // STEP 3 — FETCH ENOUGH PRODUCTS FOR THE BUFFER
    // ==========================================================

    while (
      collectedProducts.length <
        AREA_BUFFER_FETCH &&
      !allPrefixesDone
    ) {
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
    // STEP 4 — FILTER TO CURRENT GEOGRAPHIC STAGE
    // ==========================================================

    const radiusFilteredProducts =
  collectedProducts.filter(
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

    const sortedProducts =
      sortNearbyProducts(
        radiusFilteredProducts,
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
      } else {
        // All geographic stages have been exhausted.
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
  wardDone,
  wardLoading,
  wardCursor,
  locationInfo?.wardName,
  areaDone,
  areaLoading,
  areaBuffer,
  areaRadiusStage,
  areaCursors,
  areaDonePrefixes,
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
