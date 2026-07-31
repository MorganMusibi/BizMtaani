/**

* Home feed — two-phase area-first advert loader.
* 
* Location priority:
* 1. Live GPS (if permitted)
* 2. Saved home area from the user's Firestore profile
* 3. If neither exists, wait for the user to provide/select an area.
* 
* No artificial Nairobi fallback is used.
  */
import {
  useHomeFeeds,
  type Product,
  getDistanceKm,
  dedupe,
  isProductVisibleToUser,
  rankProducts,
} from "@/hooks/useHomeFeed";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { getWardInfo, getAreaChoices, type ResolvedLocation } from "@/lib/location";
import { CATEGORY_DEFS, getCategoryBadgeColor } from "@/lib/categories";
import { AreaPickerSheet } from "@/components/AreaPickerSheet";
import { Button } from "@/components/ui/button";
import { Search, Plus, MapPin, Loader2, Package, X, Check } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

const WARD_PAGE = 20;
const AREA_PAGE = 20;
const AREA_PICKER_STORAGE_KEY = "bizmtaani_area_chosen";
const DEFAULT_RADIUS_KM = 2.5;
const RADIUS_STEPS = [1, 2.5, 5, 7, 10]; // discrete steps for the slider

const FILTER_CHIPS = [
  { label: "All", key: "All" },
  ...CATEGORY_DEFS.map((c) => ({ label: c.displayShort, key: c.key })),
];

function fmtDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
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

// Area picker state
const [areaChoices, setAreaChoices] = useState<ResolvedLocation[]>([]);
const [showAreaPicker, setShowAreaPicker] = useState(false);
const hasPromptedArea = useRef(false);
// ============================================================
// LOCATION INITIALIZATION
// Priority:
// 1. Live GPS
// 2. Saved homeLocation from user profile
// 3. Previously selected area
// 4. Ask user to select an area
//
// IMPORTANT:
// There is NO Nairobi fallback.
// ============================================================

useEffect(() => {
  let cancelled = false;

  const useLocation = (location: ResolvedLocation) => {
    if (cancelled) return;

    setLocationInfo(location);

    if (
      location.lat != null &&
      location.lng != null
    ) {
      setUserCoords([
        location.lat,
        location.lng,
      ]);
    }

    setGpsReady(true);
  };

  const useSavedProfileLocation = () => {
    const saved = userProfile?.homeLocation;

    if (
      saved &&
      typeof saved.lat === "number" &&
      typeof saved.lng === "number"
    ) {
      const savedLocation: ResolvedLocation = {
        lat: saved.lat,
        lng: saved.lng,
        wardName: saved.areaName,
        constituency: saved.constituency,
        county: saved.county,
      };

      useLocation(savedLocation);
      return true;
    }

    return false;
  };

  const usePreviouslySelectedArea = () => {
    try {
      const stored =
        localStorage.getItem(
          AREA_PICKER_STORAGE_KEY
        );

      if (!stored) {
        return false;
      }

      const parsed =
        JSON.parse(stored) as ResolvedLocation;

      if (
        typeof parsed.lat !== "number" ||
        typeof parsed.lng !== "number"
      ) {
        return false;
      }

      useLocation(parsed);
      return true;
    } catch (error) {
      console.error(
        "Failed to load saved area:",
        error
      );

      return false;
    }
  };

  const requestGps = () => {
    if (
      !navigator.geolocation
    ) {
      // GPS is unavailable.
      // Try saved profile location.
      if (
        useSavedProfileLocation()
      ) {
        return;
      }

      // Try previously selected area.
      if (
        usePreviouslySelectedArea()
      ) {
        return;
      }

      // No location available.
      // The user must choose one.
      setGpsReady(true);

      if (!hasPromptedArea.current) {
        hasPromptedArea.current = true;
        setShowAreaPicker(true);
      }

      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (cancelled) return;

        const lat =
          position.coords.latitude;

        const lng =
          position.coords.longitude;

        setUserCoords([lat, lng]);
        setGpsGranted(true);
        setGpsReady(true);

        try {
          const resolved =
            await getWardInfo(lat, lng);

          if (cancelled) return;

          if (resolved) {
            setLocationInfo(resolved);

            // Get nearby/border-area choices
            // only when GPS successfully resolves.
            try {
              const choices =
                await getAreaChoices(
                  lat,
                  lng
                );

              if (!cancelled) {
                setAreaChoices(
                  choices ?? []
                );
              }
            } catch (error) {
              console.error(
                "Failed to load nearby area choices:",
                error
              );
            }
          }
        } catch (error) {
          console.error(
            "Failed to resolve GPS location:",
            error
          );

          // GPS coordinates still exist,
          // so continue using them.
        }
      },
      () => {
        // GPS denied or unavailable.
        setGpsGranted(false);

        // First try saved profile location.
        if (
          useSavedProfileLocation()
        ) {
          return;
        }

        // Then try previously selected area.
        if (
          usePreviouslySelectedArea()
        ) {
          return;
        }

        // No location available.
        // Do NOT use Nairobi.
        setGpsReady(true);

        if (!hasPromptedArea.current) {
          hasPromptedArea.current = true;
          setShowAreaPicker(true);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  };

  // Wait until the profile has finished loading
  // before deciding whether to use its location.
  if (user && !userProfile) {
    return;
  }
requestGps();

  return () => {
    cancelled = true;
  };
}, [
  user,
  userProfile,
]);

const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
const [showRadiusSlider, setShowRadiusSlider] = useState(false);

  const [activeKey, setActiveKey] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const isSearchMode = searchQuery.length > 0;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const {
  wardProducts,
  areaProducts,
  wardLoading,
  areaLoading,
  wardDone,
  areaDone,
  initialLoading,
  loadMore,
} = useHomeFeeds({
  gpsReady,
  userCoords,
  isSearchMode,
  locationInfo,
});

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
  
 const handleAreaSelect = useCallback(
  (choice: ResolvedLocation) => {
    setLocationInfo(choice);

    if (
      choice.lat != null &&
      choice.lng != null
    ) {
      setUserCoords([
        choice.lat,
        choice.lng,
      ]);
    }

    // The user now has a valid location,
    // so the feed can start loading.
    setGpsReady(true);

    setShowAreaPicker(false);

    localStorage.setItem(
      AREA_PICKER_STORAGE_KEY,
      JSON.stringify(choice)
    );
  },
  []
);
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

    return (
  matchCat &&
  matchSearch
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
// APPLY CATEGORY & SEARCH FILTERS
// ============================================================

const categoryAndSearchFiltered = applyFilters(
  visibleProducts
);

// ============================================================
// APPLY USER DISPLAY RADIUS
//
const filteredProducts = categoryAndSearchFiltered;

// ============================================================
// RANK PRODUCTS — WARD FIRST, THEN NEARBY
// ============================================================

// ------------------------------------------------------------
// 1. Separate the loaded products into:
//    - Products belonging to the user's current ward
//    - Products from other nearby areas
//
// IMPORTANT:
// Geographic phase has priority over Premium ranking.
// Premium adverts cannot jump from the nearby section
// into the ward section.
// ------------------------------------------------------------

const wardProductsFiltered = filteredProducts.filter(
  (product) =>
    Boolean(locationInfo?.wardName) &&
    product.ward === locationInfo?.wardName
);

const wardProductIds = new Set(
  wardProductsFiltered.map((product) => product.id)
);

const areaProductsFiltered = filteredProducts.filter(
  (product) => !wardProductIds.has(product.id)
);

// ------------------------------------------------------------
// 2. Rank ONLY within the ward section.
//
// This means Premium can receive ranking preference
// against other adverts in the same geographic phase,
// but cannot override the ward-first structure.
// ------------------------------------------------------------

const filteredWard = userCoords
  ? rankProducts(
      wardProductsFiltered,
      userCoords
    )
  : wardProductsFiltered;

// ------------------------------------------------------------
// 3. Rank ONLY within the nearby section.
//
// Nearby adverts are ranked independently from ward adverts.
// ------------------------------------------------------------

const filteredArea = userCoords
  ? rankProducts(
      areaProductsFiltered,
      userCoords
    )
  : areaProductsFiltered;

// ------------------------------------------------------------
// 4. Combine only for total count.
//
// The UI still renders filteredWard first and filteredArea
// second, so the geographic order is preserved.
// ------------------------------------------------------------

const rankedProducts = [
  ...filteredWard,
  ...filteredArea,
];

// ============================================================
// FEED STATE
// ============================================================

const totalVisible = rankedProducts.length;

const isLoadingMore =
  wardLoading || areaLoading;

const allDone = isSearchMode
  ? areaDone
  : wardDone && areaDone;

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
    return `Showing adverts in ${area} area`;
  }

  if (area) {
    return `Showing adverts near ${area} area (from your saved location)`;
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
                  value={Math.max(
  0,
  RADIUS_STEPS.indexOf(radiusKm)
)}
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
