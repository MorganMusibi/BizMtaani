import { useState, useEffect } from "react";
import { collection, query, orderBy, where, limit, startAfter, getDocs, QueryDocumentSnapshot, DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getNearbyGeohashPrefixes } from "@/lib/geohash";
interface ProductImage {
  url: string;
  public_id?: string;
}
const AREA_BUFFER_FETCH = 40;

interface Product {
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

function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
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

function isProductVisibleToUser(
  product: Product,
  userCoords: [number, number]
) {
  const distance = getDistanceKm( userCoords[0], userCoords[1], product.lat,
    product.lng
  );
 const scope = getProductVisibilityScope(product);

  // Free/local adverts
  if (scope === "local") {
    const radius = product.visibilityRadiusKm ?? 2.5;
    return distance <= radius;
  }

  // County and all-area adverts are currently eligible
  // once they have been loaded by the geographic query.
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

function dedupe(existing: Product[], incoming: Product[]): Product[] {
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
function rankProducts(
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
    .map((prefix, index) => {
      const key = String(index);

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
  radiusKm,
}: {
  gpsReady: boolean;
  userCoords: [number, number] | null;
  isSearchMode: boolean;
  locationInfo: {
    wardName?: string;
  } | null;
  radiusKm: number;
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

    prefixes.forEach((_, prefixIndex) => {
      const key = String(prefixIndex);

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
      (_, index) =>
        currentDonePrefixes[String(index)] === true
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

  const sortedBuffer = sortNearbyProducts(
    collectedProducts,
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
}, [gpsReady, isSearchMode, locationInfo?.wardName]);
}
