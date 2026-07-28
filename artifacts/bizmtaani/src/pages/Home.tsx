/**

Home feed — two-phase area-first advert loader.

Location fallback chain:

1. Live GPS (if permitted)



2. Saved home area from user's Firestore profile



3. Nairobi centre (last resort)
*/




import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
collection, query, orderBy, where, limit, startAfter,
getDocs, QueryDocumentSnapshot, DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { getNearbyGeohashPrefixes } from "@/lib/geohash";
import { getWardInfo, getAreaChoices, type ResolvedLocation } from "@/lib/location";
import { CATEGORY_DEFS, getCategoryBadgeColor } from "@/lib/categories";
import { AreaPickerSheet } from "@/components/AreaPickerSheet";
import { Button } from "@/components/ui/button";
import { Search, Plus, MapPin, Loader2, Package, X, Check } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

const WARD_PAGE = 20;
const AREA_PAGE = 20;
const NAIROBI: [number, number] = [-1.286389, 36.817223];
const AREA_PICKER_STORAGE_KEY = "bizmtaani_area_chosen";
const DEFAULT_RADIUS_KM = 5;
const RADIUS_STEPS = [1, 2, 3, 5, 7, 10]; // discrete steps for the slider

const FILTER_CHIPS = [
{ label: "All", key: "All" },
...CATEGORY_DEFS.map((c) => ({ label: c.displayShort, key: c.key })),
];

interface ProductImage {
url: string;
public_id?: string;
}

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

function fmtDist(km: number) {
return km < 1 ? ${Math.round(km * 1000)}m : ${km.toFixed(1)}km;
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
const distance = getDistanceKm(
userCoords[0],
userCoords[1],
product.lat,
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

  return {  
    product,  
    distanceKm,  
    premium,  
    score,  
    originalIndex: index,  
  };  
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

function ProductCard({
product, userCoords, onClick,
}: {
product: Product;
userCoords: [number, number] | null;
onClick: (e: React.MouseEvent | React.TouchEvent) => void;
}) {
const distance = userCoords
? getDistanceKm(userCoords[0], userCoords[1], product.lat, product.lng)
: null;

const badgeColor = getCategoryBadgeColor(product.category);

const isAccommodation =
product.category === "Accommodation";

const isEatery =
product.subcategory === "Hotels / Eateries" ||
product.subcategory === "Restaurants & Cooked Food";

// Support BOTH old string arrays and new object arrays
const firstImage = product.imageUrls?.[0];

const displayImage =
typeof firstImage === "string"
? firstImage
: firstImage?.url || product.imageUrl || "";

const negotiable =
(product.priceDisplay ?? product.priceType) === "negotiable";

const basisLabel: Record<string, string> = {
per_km: "/km",
per_hour: "/hr",
per_day: "/day",
per_trip: "/trip",
per_session: "/session",
};

const serviceCategories = [
"Services",
"Transport",
"Delivery",
"Cleaning",
"Repairs",
];

const showPricingBasis =
serviceCategories.includes(product.category);

const basisSuffix =
showPricingBasis && product.pricingBasis
? basisLabel[product.pricingBasis] ?? ""
: "";

const priceLabel = isAccommodation
? KES ${(product.rentPerMonth ?? product.price).toLocaleString()}/mo
: isEatery
? null
: product.pricingBasis === "quote_only"
? "Quote only"
: product.price > 0
? KES ${product.price.toLocaleString()}${basisSuffix}${   negotiable ? " · Neg." : ""   }
: negotiable
? "Negotiable"
: null;

return (
<div
data-testid={product-card-${product.id}}
onClick={onClick}
className="bg-card rounded-2xl border border-border overflow-hidden cursor-pointer active:scale-[0.98] transition-transform shadow-sm"
>
<div className="relative">
{/* --- PREMIUM BADGE --- */}
{product.plan?.startsWith("premium") && (
<div className="absolute top-2 left-2 bg-[#00A651] text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-sm z-10">
PREMIUM
</div>
)}

{displayImage ? (  
      <img

src={displayImage}
alt={product.title}
loading="lazy"
className="w-full aspect-square object-cover"
onError={(e) => {
console.error("Image failed:", displayImage);

e.currentTarget.onerror = null;
e.currentTarget.src = "/placeholder-image.png";
}}
/>
) : (
<div className="w-full aspect-square bg-muted flex items-center justify-center">
<Package size={28} className="text-muted-foreground" />
</div>
)}

{priceLabel && (  
      <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded-lg z-[5]">  
        {priceLabel}  
      </div>  
    )}  
      
    <div className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeColor} z-[5]`}>  
      {product.subcategory ?? product.category}  
    </div>  
      
    {/* Verified Badge - Positioned to avoid overlapping Premium badge */}  
    {(product.verified || product.plan?.startsWith("premium")) && (  
      <div className="absolute top-2 left-14 flex items-center gap-0.5 bg-blue-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full z-10">  
        <Check size={8} />  
        <span>Verified</span>  
      </div>  
    )}  
      
    {isAccommodation &&

Array.isArray(product.imageUrls) &&
product.imageUrls.length > 1 && (
<div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded font-medium z-[5]">
+{product.imageUrls.length - 1} photos
</div>
)}
</div>
<div className="px-3 py-2.5">
<p className="font-bold text-sm leading-tight line-clamp-2">{product.title}</p>
<div className="flex items-center justify-between mt-1.5 gap-1">
<div className="flex items-center gap-1 min-w-0">
{product.sellerType === "business" ? (
<span className="flex-shrink-0 text-[9px] font-black bg-primary/10 text-primary px-1.5 py-0.5 rounded-full leading-none">
BIZ
</span>
) : product.sellerType === "individual" ? (
<span className="flex-shrink-0 text-[9px] font-black bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full leading-none">
IND
</span>
) : null}
<p className="text-xs text-muted-foreground truncate">{product.sellerName}</p>
</div>
{distance !== null && (
<div className="flex items-center gap-0.5 text-[10px] text-muted-foreground flex-shrink-0">
<MapPin size={10} /><span>{fmtDist(distance)}</span>
</div>
)}
</div>
</div>
</div>
);
}

export default function Home() {
const [, setLocation] = useLocation();
const { user, userProfile } = useAuth();

const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
const [gpsGranted, setGpsGranted] = useState(false);
const [gpsReady, setGpsReady] = useState(false);
const [locationInfo, setLocationInfo] = useState<ResolvedLocation | null>(null);

// Border-area picker state
const [areaChoices, setAreaChoices] = useState<ResolvedLocation[]>([]);
const [showAreaPicker, setShowAreaPicker] = useState(false);
const hasPromptedArea = useRef(false);

const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
const [showRadiusSlider, setShowRadiusSlider] = useState(false);

const [activeKey, setActiveKey] = useState("All");
const [searchInput, setSearchInput] = useState("");
const [searchQuery, setSearchQuery] = useState("");
const [showSearch, setShowSearch] = useState(false);
const isSearchMode = searchQuery.length > 0;

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

// Number of products to fetch from each active geohash prefix.
// This is intentionally larger than the visible page size.
const AREA_BUFFER_FETCH = 40;

const [searchCursor, setSearchCursor] = useState<Cursor | null>(null);
const [searchDone, setSearchDone] = useState(false);
const [searchLoading, setSearchLoading] = useState(false);

const [initialLoading, setInitialLoading] = useState(true);
const sentinelRef = useRef<HTMLDivElement>(null);

useEffect(() => {
navigator.geolocation.getCurrentPosition(
async (pos) => {
const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
setUserCoords(coords);
setGpsGranted(true);

// If the user already chose their area during sign-up (homeLocation saved to  
    // their profile), or has previously dismissed the picker, skip it entirely —  
    // just resolve the current GPS position to a ward name silently.  
    const alreadyChosen = localStorage.getItem(AREA_PICKER_STORAGE_KEY);  
    const hasHomeLocation = !!userProfile?.homeLocation;  

    if (hasHomeLocation || alreadyChosen) {  
      const cached = alreadyChosen && !hasHomeLocation  
        ? (() => { try { return JSON.parse(alreadyChosen) as ResolvedLocation; } catch { return null; } })()  
        : null;  
      if (cached) {  
        setLocationInfo(cached);  
      } else {  
        const info = await getWardInfo(coords[0], coords[1]);  
        setLocationInfo(info);  
      }  
      setGpsReady(true);  
      return;  
    }  

    // First-time / guest: probe for border areas and offer a picker  
    const choices = await getAreaChoices(coords[0], coords[1]);  
    if (choices.length > 1 && !hasPromptedArea.current) {  
      setAreaChoices(choices);  
      setLocationInfo(choices[0]); // use first while picker is open  
      setShowAreaPicker(true);  
      hasPromptedArea.current = true;  
    } else {  
      const info = choices[0] ?? await getWardInfo(coords[0], coords[1]);  
      setLocationInfo(info);  
    }  
    setGpsReady(true);  
  },  
  async () => {  
    // GPS denied — use saved home area from profile, or Nairobi as last resort  
    let coords: [number, number] = NAIROBI;  
    let resolvedInfo: ResolvedLocation | null = null;  

    if (userProfile?.homeLocation) {  
      const hl = userProfile.homeLocation;  
      coords = [hl.lat, hl.lng];  
      resolvedInfo = {  
        wardName: hl.areaName,  
        constituency: hl.constituency,  
        county: hl.county,  
        displayName: hl.areaName  
          ? `${hl.areaName}${hl.county ? `, ${hl.county}` : ""}`  
          : "your area",  
      };  
    }  

    setUserCoords(coords);  
    setGpsGranted(false);  

    if (resolvedInfo) {  
      setLocationInfo(resolvedInfo);  
    } else {  
      const info = await getWardInfo(coords[0], coords[1]);  
      setLocationInfo(info);  
    }  
    setGpsReady(true);  
  },  
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }  
);

// eslint-disable-next-line react-hooks/exhaustive-deps
}, [userProfile]);

function handleAreaSelect(choice: ResolvedLocation) {
setLocationInfo(choice);
localStorage.setItem(AREA_PICKER_STORAGE_KEY, JSON.stringify(choice));
setShowAreaPicker(false);
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

  const queries = areaQueries(  
    userCoords,  
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
    (_, prefixIndex) => {  
      const key =  
        String(prefixIndex);  

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
      (_, index) =>  
        currentDonePrefixes[  
          String(index)  
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

const sortedProducts =  
  sortNearbyProducts(  
    collectedProducts,  
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

useEffect(() => {
const el = sentinelRef.current;
if (!el) return;

const observer = new IntersectionObserver(
([entry]) => {
if (entry.isIntersecting) {
loadMore();
}
},
{
rootMargin: "400px",
}
);

observer.observe(el);

return () => observer.disconnect();
}, [loadMore]);

function applyFilters(products: Product[]): Product[] {
const nowSec = Date.now() / 1000;

return products.filter((p) => {
// Hide pending-payment listings
if (p.status === "pending_payment") {
return false;
}

// Hide expired listings  
if (p.expiresAt && p.expiresAt.seconds <= nowSec) {  
  return false;  
}  

const matchCat =  
  activeKey === "All" ||  
  p.category === activeKey;  

const search = searchQuery.toLowerCase();  

const matchSearch =  
  !search ||  
  p.title.toLowerCase().includes(search) ||  
  p.sellerName.toLowerCase().includes(search) ||  
  (p.subcategory ?? "").toLowerCase().includes(search) ||  
  (p.ward ?? "").toLowerCase().includes(search);  

// Search mode shows results across Kenya.  
// Normal mode applies the selected radius.  
const matchRadius =  
  isSearchMode ||  
  !userCoords ||  
  getDistanceKm(  
    userCoords[0],  
    userCoords[1],  
    p.lat,  
    p.lng  
  ) <= radiusKm;  

return (  
  matchCat &&  
  matchSearch &&  
  matchRadius  
);

});
}

// ============================================================
// MERGE WARD + NEARBY PRODUCTS
// ============================================================

const wardIds = new Set(
wardProducts.map((p) => p.id)
);

const allLoadedProducts = dedupe(
wardProducts,
areaProducts.filter(
(p) => !wardIds.has(p.id)
)
);

// ============================================================
// APPLY VISIBILITY RULES
// ============================================================

const visibleProducts = isSearchMode
? allLoadedProducts
: userCoords
? allLoadedProducts.filter((product) =>
isProductVisibleToUser(
product,
userCoords
)
)
: allLoadedProducts;

// ============================================================
// APPLY CATEGORY, SEARCH & RADIUS FILTERS
// ============================================================

const filteredProducts = applyFilters(
visibleProducts
);

// ============================================================
// RANK PRODUCTS
// ============================================================

const rankedProducts = userCoords
? rankProducts(
filteredProducts,
userCoords
)
: filteredProducts;

// ============================================================
// SPLIT WARD PRODUCTS FROM OTHER NEARBY PRODUCTS
// ============================================================

const filteredWard = rankedProducts.filter(
(product) =>
locationInfo?.wardName &&
product.ward === locationInfo.wardName
);

const filteredWardIds = new Set(
filteredWard.map((product) => product.id)
);

const filteredArea = rankedProducts.filter(
(product) => !filteredWardIds.has(product.id)
);

// ============================================================
// FEED STATE
// ============================================================

const totalVisible = rankedProducts.length;

const isLoadingMore =
wardLoading || areaLoading;

const allDone =
wardDone && areaDone;

// ============================================================
// SEARCH
// ============================================================

function handleSearch(
e: React.FormEvent
) {
e.preventDefault();
setSearchQuery(
searchInput.trim()
);
}

function clearSearch() {
setSearchInput("");
setSearchQuery("");
setShowSearch(false);
}

function bannerText() {
if (isSearchMode) {
return "Searching across Kenya";
}

if (!locationInfo) {
return "Finding your area...";
}

const area = locationInfo.wardName;

if (area && gpsGranted) {
return Showing adverts in ${area} area;
}

if (area) {
return Showing adverts near ${area} area (from your saved location);
}

return "Finding nearby adverts...";
}
return (
<div className="flex flex-col h-screen bg-background overflow-hidden">
<header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center justify-between gap-3 z-40">
<div className="flex items-center gap-2">
<div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
<span className="text-white text-sm font-black">B</span>
</div>
<span className="font-black text-lg tracking-tight">BizMtaani</span>
</div>
<div className="flex items-center gap-1">
{user && (
<button
data-testid="fab-post-product"
onClick={() => setLocation("/post")}
className="p-2 rounded-xl hover:bg-muted transition-colors"
>
<Plus size={20} />
</button>
)}
<button
data-testid="button-toggle-search"
onClick={() => setShowSearch((s) => !s)}
className="p-2 rounded-xl hover:bg-muted transition-colors"
>
<Search size={20} />
</button>
</div>
</header>

{showSearch && (  
    <form  
      onSubmit={handleSearch}  
      className="flex-shrink-0 bg-card border-b border-border px-4 py-2 flex gap-2 z-40"  
    >  
      <input  
        data-testid="input-search"  
        type="search"  
        placeholder="Search products, areas, sellers..."  
        value={searchInput}  
        onChange={(e) => setSearchInput(e.target.value)}  
        autoFocus  
        className="flex-1 h-10 px-4 rounded-xl bg-muted text-foreground text-sm outline-none border border-transparent focus:border-primary transition-colors"  
      />  
      <button  
        type="submit"  
        className="h-10 px-4 bg-primary text-white rounded-xl text-sm font-semibold flex-shrink-0"  
      >  
        Go  
      </button>  
    </form>  
  )}  

  {isSearchMode && (  
    <div className="flex-shrink-0 bg-card border-b border-border px-4 py-2 flex items-center gap-2 z-40">  
      <span className="text-xs text-muted-foreground">Results for:</span>  
      <span className="flex items-center gap-1 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full">  
        {searchQuery}  
        <button onClick={clearSearch} className="ml-1"><X size={11} /></button>  
      </span>  
    </div>  
  )}  

  <div className="flex-shrink-0 bg-card/90 backdrop-blur-sm border-b border-border z-30">  
    <div className="flex gap-2 px-4 py-2.5 overflow-x-auto no-scrollbar">  
      {FILTER_CHIPS.map(({ label, key }) => (  
        <button  
          key={key}  
          data-testid={`filter-${key.toLowerCase().replace(/[\s/&]+/g, "-")}`}  
          onClick={() => setActiveKey(key)}  
          className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${  
            activeKey === key  
              ? "bg-primary text-white"  
              : "bg-muted text-muted-foreground hover:bg-muted/80"  
          }`}  
        >  
          {label}  
        </button>  
      ))}  
    </div>  

    {/* Near me radius row */}  
    {!isSearchMode && (  
      <div className="px-4 pb-2.5">  
        <button  
          onClick={() => setShowRadiusSlider((s) => !s)}  
          className="flex items-center gap-2 group"  
        >  
          <MapPin size={12} className="text-primary flex-shrink-0" />  
          <span className="text-xs font-semibold text-primary">  
            Within {radiusKm} km  
          </span>  
          <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">  
            {showRadiusSlider ? "▲" : "▼"}  
          </span>  
        </button>  

        {showRadiusSlider && (  
          <div className="mt-3 pb-1">  
            <div className="flex items-center justify-between mb-2">  
              <span className="text-[10px] text-muted-foreground">1 km</span>  
              <span className="text-xs font-black text-primary">{radiusKm} km from you</span>  
              <span className="text-[10px] text-muted-foreground">10 km</span>  
            </div>  
            <input  
              type="range"  
              min={0}  
              max={RADIUS_STEPS.length - 1}  
              step={1}  
              value={RADIUS_STEPS.indexOf(radiusKm) === -1  
                ? RADIUS_STEPS.findIndex((s) => s >= radiusKm)  
                : RADIUS_STEPS.indexOf(radiusKm)}  
              onChange={(e) => setRadiusKm(RADIUS_STEPS[Number(e.target.value)])}  
              className="w-full h-2 rounded-full appearance-none cursor-pointer  
                bg-muted [&::-webkit-slider-thumb]:appearance-none  
                [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5  
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary  
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer  
                [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5  
                [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary  
                [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"  
              style={{  
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${  
                  (RADIUS_STEPS.indexOf(radiusKm) / (RADIUS_STEPS.length - 1)) * 100  
                }%, hsl(var(--muted)) ${  
                  (RADIUS_STEPS.indexOf(radiusKm) / (RADIUS_STEPS.length - 1)) * 100  
                }%, hsl(var(--muted)) 100%)`,  
              }}  
            />  
            <div className="flex justify-between mt-1.5">  
              {RADIUS_STEPS.map((s) => (  
                <span  
                  key={s}  
                  onClick={() => setRadiusKm(s)}  
                  className={`text-[9px] font-semibold cursor-pointer transition-colors ${  
                    s === radiusKm ? "text-primary" : "text-muted-foreground"  
                  }`}  
                >  
                  {s}km  
                </span>  
              ))}  
            </div>  
          </div>  
        )}  
      </div>  
    )}  
  </div>  

  <div className="flex-1 overflow-y-auto">  
    {gpsReady && (  
      <div  
        className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30 cursor-pointer"  
        onClick={() => {  
          if (areaChoices.length > 1) setShowAreaPicker(true);  
        }}  
      >  
        <MapPin size={12} className={gpsGranted ? "text-secondary" : "text-amber-500"} />  
        <p className="text-xs text-muted-foreground flex-1">{bannerText()}</p>  
        {areaChoices.length > 1 && (  
          <span className="text-[10px] font-semibold text-primary flex-shrink-0">Change area</span>  
        )}  
      </div>  
    )}  

    {initialLoading ? (  
      <div className="flex flex-col items-center justify-center py-24 gap-3">  
        <Loader2 size={28} className="animate-spin text-primary" />  
        <p className="text-sm text-muted-foreground">Finding nearby adverts...</p>  
      </div>  
    ) : totalVisible === 0 ? (  
      <div className="flex flex-col items-center justify-center py-24 gap-4 px-6">  
        <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">  
          <Package size={36} className="text-muted-foreground" />  
        </div>  
        <div className="text-center">  
          <p className="font-bold text-lg">No adverts found</p>  
          <p className="text-muted-foreground text-sm mt-1">  
            {isSearchMode  
              ? "Try a different search term"  
              : activeKey !== "All"  
              ? "No listings in this category near you"  
              : "No listings in your area yet"}  
          </p>  
        </div>  
        {user && (  
          <Button onClick={() => setLocation("/post")} className="gap-2">  
            <Plus size={16} />Be the first to post here  
          </Button>  
        )}  
      </div>  
    ) : (  
      <div className="px-3 pt-3 pb-24">  
        {filteredWard.length > 0 && (  
          <>  
            {locationInfo?.wardName && !isSearchMode && (  
              <div className="flex items-center gap-2 mb-3">  
                <MapPin size={13} className="text-primary flex-shrink-0" />  
                <p className="text-xs font-bold text-primary uppercase tracking-wide">  
                  In {locationInfo.wardName} area  
                </p>  
              </div>  
            )}  
            <div className="grid grid-cols-2 gap-3">  
              {filteredWard.map((p) => (

<ProductCard
key={p.id}
product={p}
userCoords={userCoords}
onClick={(e) => {
e.stopPropagation(); // This prevents the click from reaching the FAB
setLocation(/product/${p.id});
}}
/>
))}
</div>
</>
)}

{filteredArea.length > 0 && (  
          <>  
            <div className={`flex items-center gap-3 ${filteredWard.length > 0 ? "mt-6 mb-3" : "mb-3"}`}>  
              <div className="h-px flex-1 bg-border" />  
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap px-1">  
                {filteredWard.length > 0 ? "Other nearby adverts" : "Nearby adverts"}  
              </span>  
              <div className="h-px flex-1 bg-border" />  
            </div>  
            <div className="grid grid-cols-2 gap-3">  
              {filteredArea.map((p) => (

<ProductCard
key={p.id}
product={p}
userCoords={userCoords}
onClick={(e) => {
e.stopPropagation(); // This prevents the click from reaching the FAB
setLocation(/product/${p.id});
}}
/>
))}
</div>
</>
)}

<div ref={sentinelRef} className="h-1" />  

        {isLoadingMore && (  
          <div className="flex justify-center py-6">  
            <Loader2 size={22} className="animate-spin text-primary" />  
          </div>  
        )}  

        {allDone && totalVisible > 0 && (  
          <p className="text-center text-xs text-muted-foreground py-6">  
            {isSearchMode ? "No more results" : "You have seen all nearby adverts"}  
          </p>  
        )}  
      </div>  
    )}  
  </div>

{user && (

  <div className="fixed bottom-20 right-4 z-40 pointer-events-none"> {/* Added pointer-events-none */}  
    <button  
      data-testid="fab-advertise"  
      onClick={() => setLocation("/post")}  
      className="pointer-events-auto flex items-center gap-2 bg-primary text-white font-black text-sm px-5 h-12 rounded-full shadow-xl active:scale-95 transition-transform"  
    >  
      <Plus size={18} />Advertise  
    </button>  
  </div>  
)}  {!user && gpsReady && (  
    <div className="flex-shrink-0 bg-card border-t border-border px-4 py-3 flex items-center gap-3 z-40">  
      <div className="flex-1 min-w-0">  
        <p className="font-bold text-sm">Sell to buyers near you</p>  
        <p className="text-xs text-muted-foreground">Sign in to post an advert</p>  
      </div>  
      <Button  
        data-testid="button-signin-prompt"  
        size="sm"  
        className="flex-shrink-0"  
        onClick={() => setLocation("/login")}  
      >  
        Sign in  
      </Button>  
    </div>  
  )}  

  {/* Border area picker */}  
  {showAreaPicker && (  
    <AreaPickerSheet  
      choices={areaChoices}  
      onSelect={handleAreaSelect}  
      onDismiss={() => {  
        handleAreaSelect(areaChoices[0]);  
      }}  
    />  
  )}  

  <BottomNav />  
</div>

);
}
