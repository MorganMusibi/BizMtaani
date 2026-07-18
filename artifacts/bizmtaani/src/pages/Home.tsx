/**
 * Home feed — two-phase area-first advert loader.
 * Location fallback chain:
 *   1. Live GPS (if permitted)
 *   2. Saved home area from user's Firestore profile
 *   3. Nairobi centre (last resort)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  collection, query, orderBy, where, limit, startAfter,
  getDocs, QueryDocumentSnapshot, DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { areaPrefix } from "@/lib/geohash";
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
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function toProducts(docs: QueryDocumentSnapshot<DocumentData>[]): Product[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() } as Product))
    .filter((p) => !p.status || p.status === "active");
}

function dedupe(existing: Product[], incoming: Product[]): Product[] {
  const ids = new Set(existing.map((p) => p.id));
  return [...existing, ...incoming.filter((p) => !ids.has(p.id))];
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

const basisSuffix = product.pricingBasis
  ? basisLabel[product.pricingBasis] ?? ""
  : "";

const priceLabel = isAccommodation
  ? `KES ${(product.rentPerMonth ?? product.price).toLocaleString()}/mo`
  : isEatery
  ? null
  : product.pricingBasis === "quote_only"
  ? "Quote only"
  : product.price > 0
  ? `KES ${product.price.toLocaleString()}${basisSuffix}${
      negotiable ? " · Neg." : ""
    }`
  : negotiable
  ? "Negotiable"
  : null;

  return (
    <div
      data-testid={`product-card-${product.id}`}
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

    (e.currentTarget as HTMLImageElement).src =
      "/placeholder-image.png";
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
        {(product.verified || product.plan === "basic" || product.plan === "premium") && (
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
  const [areaCursor, setAreaCursor] = useState<Cursor | null>(null);
  const [areaDone, setAreaDone] = useState(false);
  const [areaLoading, setAreaLoading] = useState(false);

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

  function wardQuery(wardName: string, cursor?: Cursor) {
    const coll = collection(db, "products");
    const constraints = [
      where("ward", "==", wardName),
      orderBy("createdAt", "desc"),
      limit(WARD_PAGE),
    ] as const;
    return cursor
      ? query(coll, constraints[0], constraints[1], constraints[2], startAfter(cursor), constraints[3])
      : query(coll, ...constraints);
  }

    function areaQuery(coords: [number, number], cursor?: Cursor) {
    const prefix = areaPrefix(coords[0], coords[1]);
    const coll = collection(db, "products");
    const constraints = [
      where("geohash", ">=", prefix),
      where("geohash", "<", prefix + "\uf8ff"),
      orderBy("geohash"),
      limit(AREA_PAGE),
    ] as const;
    return cursor
      ? query(coll, constraints[0], constraints[1], constraints[2], constraints[3], startAfter(cursor), constraints[4])
      : query(coll, ...constraints);
  }

  useEffect(() => {
    if (!gpsReady || !userCoords) return;

    setInitialLoading(true);
    setWardProducts([]); setWardCursor(null); setWardDone(false);
    setAreaProducts([]); setAreaCursor(null); setAreaDone(false);

    const run = async () => {
      const wardName = locationInfo?.wardName ?? "";
      if (wardName && !isSearchMode) {
        try {
          const snap = await getDocs(wardQuery(wardName));
          const docs = toProducts(snap.docs);
          setWardProducts(docs);
          setWardCursor(snap.docs[snap.docs.length - 1] ?? null);
          setWardDone(snap.docs.length < WARD_PAGE);
        } catch {
          setWardDone(true);
        }
      } else {
        setWardDone(true);
      }

      try {
        const snap = await getDocs(areaQuery(userCoords));
        setAreaProducts(toProducts(snap.docs));
        setAreaCursor(snap.docs[snap.docs.length - 1] ?? null);
        setAreaDone(snap.docs.length < AREA_PAGE);
      } catch {
        setAreaDone(true);
      }

      setInitialLoading(false);
    };

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsReady, isSearchMode, locationInfo?.wardName]);

  const loadMore = useCallback(async () => {
    if (!userCoords) return;

    if (!wardDone && !wardLoading && wardCursor && locationInfo?.wardName) {
      setWardLoading(true);
      try {
        const snap = await getDocs(wardQuery(locationInfo.wardName, wardCursor));
        setWardProducts((prev) => dedupe(prev, toProducts(snap.docs)));
        setWardCursor(snap.docs[snap.docs.length - 1] ?? null);
        setWardDone(snap.docs.length < WARD_PAGE);
      } finally {
        setWardLoading(false);
      }
      return;
    }

    if (!areaDone && !areaLoading && areaCursor) {
      setAreaLoading(true);
      try {
        const snap = await getDocs(areaQuery(userCoords, areaCursor));
        setAreaProducts((prev) => dedupe(prev, toProducts(snap.docs)));
        setAreaCursor(snap.docs[snap.docs.length - 1] ?? null);
        setAreaDone(snap.docs.length < AREA_PAGE);
      } finally {
        setAreaLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardDone, wardLoading, wardCursor, areaDone, areaLoading, areaCursor, userCoords, locationInfo]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  function applyFilters(products: Product[]): Product[] {
    const nowSec = Date.now() / 1000;
    return products.filter((p) => {
      // Hide listings pending payment or already expired
      if (p.status === "pending_payment") return false;
      if (p.expiresAt && p.expiresAt.seconds < nowSec) return false;

      const matchCat = activeKey === "All" || p.category === activeKey;
      const matchSearch =
        !searchQuery ||
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sellerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.subcategory ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.ward ?? "").toLowerCase().includes(searchQuery.toLowerCase());
      // Radius filter — skip when in search mode (search shows all Kenya)
      const matchRadius =
        isSearchMode ||
        !userCoords ||
        getDistanceKm(userCoords[0], userCoords[1], p.lat, p.lng) <= radiusKm;
      return matchCat && matchSearch && matchRadius;
    });
  }

  const wardIds = new Set(wardProducts.map((p) => p.id));
  const filteredWard = applyFilters(wardProducts);
  const filteredArea = applyFilters(areaProducts.filter((p) => !wardIds.has(p.id)));

  const totalVisible = filteredWard.length + filteredArea.length;
  const isLoadingMore = wardLoading || areaLoading;
  const allDone = wardDone && areaDone;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  }
  function clearSearch() {
    setSearchInput(""); setSearchQuery(""); setShowSearch(false);
  }

  function bannerText() {
    if (isSearchMode) return `Searching across Kenya`;
    if (!locationInfo) return "Finding your area...";
    const area = locationInfo.wardName;
    if (area && gpsGranted) return `Showing adverts in ${area} area`;
    if (area) return `Showing adverts near ${area} area (from your saved location)`;
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
      setLocation(`/product/${p.id}`);
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
      setLocation(`/product/${p.id}`);
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
)}

      {!user && gpsReady && (
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
