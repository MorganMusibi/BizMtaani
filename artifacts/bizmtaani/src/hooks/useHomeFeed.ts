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

// Internal geographic loading radius.
// This is NOT selected by the user.
// The feed uses this to discover nearby candidates,
// which are then filtered by each advert's visibility rules.
const HOME_FEED_RADIUS_KM = 50;

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
  const distance = getDistanceKm(userCoords[0], userCoords[1], product.lat, product.lng);
  const scope = getProductVisibilityScope(product);

    // Free/local adverts (Free weekly visible to a radius of 2.5 km)
  if (scope === "local") {
    const radius = product.visibilityRadiusKm ?? 2.5;
    return distance <= radius;
  }
  // County and all-area adverts (Weekly/Monthly premiums) are visible in all wards
  if (scope === "county" || scope === "all_areas") {
    return true;
  }

  return false;
}


function getDistanceBucket(distanceKm: number) {
  if (distanceKm <= 2.5) return 1;
  if (distanceKm <= 5) return 2;
  if (distanceKm <= 10) return 3;
  if (distanceKm <= 20) return 4;
  if (distanceKm <= 50) return 5;

  return 6;
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

    return distanceA - distanceB;
  });
}
export function rankProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  return products
    .map((product, index) => {
      const distanceKm = getDistanceKm(
        userCoords[0],
        userCoords[1],
        product.lat,
        product.lng
      );

      const premium = isPremiumProduct(product);

      /*
       * Premium boost
       *
       * A premium advert gets a controlled ranking advantage.
       * Distance still matters, so an extremely far-away premium
       * advert will not automatically dominate the feed.
       *
       * The higher the boost, the stronger Premium is promoted.
       */
      const PREMIUM_BOOST = 3;

      const score =
        (premium ? PREMIUM_BOOST : 0) - distanceKm;

      return { product, distanceKm, premium, score, originalIndex: index, };
    })
    .sort((a, b) => {
      // 1. Higher ranking score first.
      // Premium gets boosted, while distance still matters.
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      // 2. Premium wins exact score ties.
      if (a.premium !== b.premium) {
        return a.premium ? -1 : 1;
      }

      // 3. If still tied, nearest advert first.
      if (a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }

      // 4. Final fallback: preserve original order.
      return a.originalIndex - b.originalIndex;
    })
    .map((item) => item.product);
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

        const docs = toProducts(snap.docs);

        setWardProducts(docs);

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

  while (
    collectedProducts.length < AREA_BUFFER_FETCH &&
    !allPrefixesDone
  ) {
    const prefixes = getNearbyGeohashPrefixes(
  userCoords[0],
  userCoords[1],
  radiusKm
);
  const queries = areaQueries(
  userCoords,
  radiusKm,
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
      (snap) => toProducts(snap.docs)
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
    };

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
        updatedCursors[key] =
          snap.docs[snap.docs.length - 1];
      }

      if (snap.docs.length < AREA_BUFFER_FETCH) {
        updatedDonePrefixes[key] = true;
      }
    });

    currentCursors = updatedCursors;
    currentDonePrefixes = updatedDonePrefixes;

    allPrefixesDone = prefixes.every(
  (prefix) =>
    currentDonePrefixes[prefix] === true
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
  collectedProducts.filter(
    (product) =>
      getDistanceKm(
        userCoords[0],
        userCoords[1],
        product.lat,
        product.lng
      ) <= radiusKm
  );

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
}, [gpsReady, isSearchMode, locationInfo?.wardName, userCoords, radiusKm]);

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

    const newWardProducts = toProducts(
      snap.docs
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
// NORMAL FEED — NEARBY AREA PAGINATION
//
// Ward adverts are exhausted.
//
// BUFFER-FIRST FLOW:
//
// 1. If the nearby buffer already contains products,
//    consume the next 20 locally.
// 2. Do NOT query Firestore when the buffer has products.
// 3. When the buffer is empty, fetch a new larger batch.
// 4. Keep the extra products in the buffer.
// 5. Display only 20 products at a time.
//
// Flow:
//
// Firestore
//    ↓
// 40+ nearby products
//    ↓
// areaBuffer
//    ↓
// 20 visible products
//    ↓
// consume buffer locally
//    ↓
// fetch again only when buffer is empty
// ============================================================

if (!areaDone && !areaLoading) {
  setAreaLoading(true);

  try {
    // ==========================================================
    // STEP 1 — CONSUME EXISTING BUFFER FIRST
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

      // We only mark the area as done when:
      // - Firestore is exhausted
      // - AND the local buffer is empty
      if (
        remainingBuffer.length === 0 &&
        Object.keys(areaDonePrefixes).length > 0 &&
        Object.values(areaDonePrefixes).every(Boolean)
      ) {
        setAreaDone(true);
      }

      return;
    }

    // ==========================================================
    // STEP 2 — BUFFER IS EMPTY
    // Fetch the next larger batch from Firestore.
    // ==========================================================

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
    // Keep fetching until we have enough products to fill
    // the buffer, or all geohash prefixes are exhausted.
    // ==========================================================

    while (
      collectedProducts.length < AREA_BUFFER_FETCH &&
      !allPrefixesDone
    ) {
      const prefixes =
        getNearbyGeohashPrefixes(
          userCoords[0],
          userCoords[1],
          radiusKm
        );

      const queries =
  areaQueries(
    userCoords,
    radiusKm,
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
      // Convert Firestore documents into valid products.
      // ========================================================

      const pageProducts =
        snapshots.flatMap(
          (snap) =>
            toProducts(
              snap.docs
            )
        );

      // Remove duplicate products caused by overlapping
      // geohash prefixes.
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
      // Update cursors and exhausted-prefix state.
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

    // This prefix was already exhausted.
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

          // Save the last document as the cursor
          // for the next Firestore request.
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

          // Because each request now fetches AREA_BUFFER_FETCH
          // documents, a shorter result means this prefix
          // has been completely exhausted.
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

      // ========================================================
      // Check whether every nearby geohash prefix is exhausted.
      // ========================================================

allPrefixesDone =
  prefixes.every(
    (prefix) =>
      currentDonePrefixes[
        prefix
      ] === true
  );
      // Safety check:
      // If every query returned zero documents,
      // stop immediately to avoid an infinite loop.
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
    // Sort the newly fetched products by distance.
    // ==========================================================
const radiusFilteredProducts =
  collectedProducts.filter(
    (product) =>
      getDistanceKm(
        userCoords[0],
        userCoords[1],
        product.lat,
        product.lng
      ) <= radiusKm
  );

const sortedProducts =
  sortNearbyProducts(
    radiusFilteredProducts,
    userCoords
  );

    // ==========================================================
    // Display the first 20.
    // Keep everything else in the local buffer.
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

    // ==========================================================
    // Save Firestore pagination state.
    // ==========================================================

    setAreaCursors(
      currentCursors
    );

    setAreaDonePrefixes(
      currentDonePrefixes
    );

    // ==========================================================
    // The nearby feed is completely finished only when:
    //
    // 1. Every geohash prefix is exhausted
    // 2. The local buffer is empty
    //
    // If there are still products in the buffer,
    // we must allow the next loadMore() call to consume them.
    // ==========================================================

    setAreaDone(
      allPrefixesDone &&
      remainingBuffer.length === 0
    );

  } catch (error) {
    console.error(
      "Failed to load more nearby adverts:",
      error
    );
  } finally {
    setAreaLoading(false);
  }
}

}, [ isSearchMode, userCoords, searchDone, searchLoading, searchCursor, wardDone,
  wardLoading,
  wardCursor,
  locationInfo?.wardName,
  areaDone,
areaLoading,
areaCursors,
areaDonePrefixes,
radiusKm,
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
