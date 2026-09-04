import {
  useHomeFeeds,
  type Product,
  getDistanceKm,
  dedupe,
  rankProducts,
} from "@/hooks/useHomeFeed";
import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useLocation } from "wouter";
import { LocationBanner } from "@/components/LocationBanner";
import { useAuth } from "@/contexts/AuthContext";
import { useLocationContext } from "@/contexts/LocationContext";
import {
  getWardInfo,
  getWardCoordinates,
  type ResolvedLocation,
} from "@/lib/location";
import { resolveCanonicalLocation } from "@/lib/locationHierarchy";
import {
  findWardLocationSync,
  getLocationHierarchy,
} from "@/lib/locationHierarchy";
import { CATEGORY_DEFS, getCategoryBadgeColor } from "@/lib/categories";
import { AreaPickerSheet } from "@/components/AreaPickerSheet";
import { Button } from "@/components/ui/button";
import { Search, Plus, MapPin, Loader2, Package, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getThumbnailUrl } from "@/lib/cloudinaryUrl";

const AREA_PICKER_STORAGE_KEY = "bizmtaani_area_chosen";

const FILTER_CHIPS = [
  { label: "All", key: "All" },
  ...CATEGORY_DEFS.map((c) => ({ label: c.displayShort, key: c.key })),
];

function ProductCardSkeleton() {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden animate-pulse">
      <div className="w-full aspect-square bg-muted" />
      <div className="px-3 py-2.5 space-y-2">
        <div className="h-3.5 bg-muted rounded w-4/5" />
        <div className="h-3.5 bg-muted rounded w-3/5" />
        <div className="h-2.5 bg-muted rounded w-2/5" />
      </div>
    </div>
  );
}

const ProductCard = memo(function ProductCard({
  product,
  userCoords,
  onClick,
  hierarchyReady,
}: {
  product: Product;
  userCoords: [number, number] | null;
  onClick: (e: React.MouseEvent | React.TouchEvent) => void;
  hierarchyReady: boolean;
}) {
  const distance = userCoords
    ? getDistanceKm(userCoords[0], userCoords[1], product.lat, product.lng)
    : null;
  const canonicalLocation =
    hierarchyReady && product.ward
      ? findWardLocationSync(product.ward.trim())
      : undefined;

  const displayWard =
    canonicalLocation?.wardName ??
    product.ward?.trim() ??
    "";

  const displayConstituency =
    canonicalLocation?.constituencyName ??
    product.constituency?.trim() ??
    "";

  const displayCounty =
    canonicalLocation?.countyName ??
    product.county?.trim() ??
    "";

  const badgeColor = getCategoryBadgeColor(product.category);

  const isAccommodation =
    product.category === "Accommodation";

  const isEatery =
    product.subcategory === "Hotels / Eateries" ||
    product.subcategory === "Restaurants & Cooked Food";

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

  const showPricingBasis =
    product.category === "Services" ||
    product.category === "Vehicles";

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
        {product.plan?.startsWith("premium") && (
          <div className="absolute top-2 left-2 bg-[#00A651] text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-sm z-10">
            PREMIUM
          </div>
        )}

        {displayImage ? (
          <img
            src={getThumbnailUrl(displayImage)}
            alt={product.title}
            loading="lazy"
            decoding="async"
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
        <div className="mt-1.5">
          {(displayWard || displayConstituency) && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
              <MapPin size={11} className="flex-shrink-0" />
              <span className="truncate">
                {[displayWard, displayConstituency]
                  .filter(Boolean)
                  .map((text) =>
                    text
                      .toLowerCase()
                      .split(" ")
                      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(" ")
                  )
                  .join(".")}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default function Home() {
  const [, setLocation] = useLocation();
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  
  const { 
  locationInfo,
  userCoords,
  gpsGranted,
  gpsReady,
  setLocationInfo,
  setUserCoords,
  setGpsGranted,
  setGpsReady,
  refreshLocation,
  isLocationLoading,
  needsLocationPrompt, 
} = useLocationContext();

  const [hierarchyReady, setHierarchyReady] = useState(false);
  
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const hasPromptedArea = useRef(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [showRefreshOptions, setShowRefreshOptions] = useState(false);
  
  const refreshFailureTimestampsRef = useRef<number[]>([]);
  const REFRESH_FAILURE_WINDOW_MS = 60 * 1000;
  const REFRESH_FAILURE_THRESHOLD = 3;

  const handleRefreshLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationErrorMsg("Your browser doesn't support location. Please search your area manually.");
      return;
    }
    setRefreshingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGpsGranted(true);
        setLocationErrorMsg(null);
        const resolved = await getWardInfo(lat, lng);

        const wardChanged = resolved?.wardName
          ? resolved.wardName !== locationInfo?.wardName
          : false;

        if (resolved && wardChanged) {
          setLocationInfo(resolved);
          setUserCoords([lat, lng]);
        } else if (!resolved) {
          setUserCoords([lat, lng]);
        } else {
          toast({
            title: "TULIAA! Uko",
            description: resolved.wardName ? `${resolved.wardName} 🎯` : undefined,
          });
        }

        setRefreshingLocation(false);
      },
      (error) => {
        console.warn("Manual location refresh failed:", error);
        setRefreshingLocation(false);

        const isGpsUnavailable =
          error.code === error.PERMISSION_DENIED ||
          error.code === error.POSITION_UNAVAILABLE;

        if (isGpsUnavailable) {
          const now = Date.now();
          const recent = refreshFailureTimestampsRef.current.filter(
            (t) => now - t < REFRESH_FAILURE_WINDOW_MS
          );
          recent.push(now);
          refreshFailureTimestampsRef.current = recent;

          if (recent.length >= REFRESH_FAILURE_THRESHOLD) {
            refreshFailureTimestampsRef.current = [];
            setLocationErrorMsg(null);
            setShowAreaPicker(true);
            setRefreshingLocation(false);
            return;
          }
        }

        if (error.code === error.PERMISSION_DENIED) {
          setLocationErrorMsg(
            "Location yako iko off. Enda browser settings uka i turn ON, kisha ujaribu tena."
          );
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setLocationErrorMsg(
            "GPS yako iko off msee. Iwashe kwa phone settings, kisha ujaribu tena."
          );
        } else {
          setLocationErrorMsg(
            "location yako haipatikani sahii. Jaribu tena in a fewww!."
          );
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [locationInfo?.wardName, toast, setGpsGranted, setLocationInfo, setUserCoords]);

  // Load hierarchy with localStorage caching
useEffect(() => {
  let cancelled = false;
  const CACHE_KEY = "bizmtaani_hierarchy_cache";
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  const loadHierarchy = async () => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const cacheTime = localStorage.getItem(`${CACHE_KEY}_time`);
      
      if (cached && cacheTime && Date.now() - parseInt(cacheTime) < CACHE_TTL) {
        // Use cached data - just mark ready
        if (!cancelled) setHierarchyReady(true);
        return;
      }
      
      // Fetch fresh
      await getLocationHierarchy();
      localStorage.setItem(CACHE_KEY, "loaded"); // Store a marker
      localStorage.setItem(`${CACHE_KEY}_time`, String(Date.now()));
      if (!cancelled) setHierarchyReady(true);
    } catch (error) {
      console.error("Failed to load hierarchy:", error);
      // Fail open - allow app to work
      if (!cancelled) setHierarchyReady(true);
    }
  };
  
  loadHierarchy();
  return () => { cancelled = true; };
}, []);

useEffect(() => {
  if (needsLocationPrompt && !hasPromptedArea.current) {
    hasPromptedArea.current = true;
    setShowAreaPicker(true);
  }
}, [needsLocationPrompt]);

const [activeKey, setActiveKey] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const isSearchMode = searchQuery.length > 0;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const {
    wardProducts,
    areaProducts,
    wardLoading,
    areaLoading,
    wardDone,
    areaDone,
    initialLoading,
    loadMore,
    previewProducts,
    areaIsPremiumOnly,
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
          if (loadMoreDebounceRef.current) {
            clearTimeout(loadMoreDebounceRef.current);
          }
          loadMoreDebounceRef.current = setTimeout(() => {
            loadMore();
          }, 300);
        }
      },
      { rootMargin: "100px" }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (loadMoreDebounceRef.current) {
        clearTimeout(loadMoreDebounceRef.current);
      }
    };
  }, [loadMore]);
  
  const handleAreaSelect = useCallback(
    (choice: ResolvedLocation) => {
      setLocationInfo(choice);
      if (choice.lat != null && choice.lng != null) {
        setUserCoords([choice.lat, choice.lng]);
      }
      setGpsReady(true);
      setShowAreaPicker(false);
      localStorage.setItem(AREA_PICKER_STORAGE_KEY, JSON.stringify(choice));
    },
    [setLocationInfo, setUserCoords, setGpsReady]
  );

  const [resolvingAreaSearch, setResolvingAreaSearch] = useState(false);


const handleProductClick = useCallback((productId: string) => {
  setLocation(`/product/${productId}`);
}, [setLocation]);


const handleAreaSearchSelect = useCallback(
  async (ward: { wardName: string; constituencyName: string; countyName: string }) => {
    setResolvingAreaSearch(true);
    try {
      const coords = await getWardCoordinates(
        ward.wardName,
        ward.constituencyName,
        ward.countyName
      );

      if (!coords) {
        toast({
          title: "Couldn't find that area on the map",
          description: "Try a nearby, larger area name instead.",
        });
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
      console.warn("Failed to resolve selected area:", error);
      toast({
        title: "Something went wrong",
        description: "Please try again or pick a different area.",
      });
    } finally {
      setResolvingAreaSearch(false);
    }
  },
  [handleAreaSelect, toast]
);

  function applyFilters(products: Product[]): Product[] {
    const nowSec = Date.now() / 1000;
    return products.filter((p) => {
      if (p.status === "pending_payment") return false;
      if (p.expiresAt && p.expiresAt.seconds <= nowSec) return false;

      const matchCat = activeKey === "All" || p.category === activeKey;
      const search = searchQuery.toLowerCase();
      const matchSearch =
        !search ||
        p.title.toLowerCase().includes(search) ||
        p.sellerName.toLowerCase().includes(search) ||
        (p.subcategory ?? "").toLowerCase().includes(search) ||
        (p.ward ?? "").toLowerCase().includes(search);

      return matchCat && matchSearch;
    });
  }

  const { rankedWardProducts, rankedAreaProducts, totalVisible } = useMemo(() => {
    const wardIds = new Set(wardProducts.map((p) => p.id));
    const areaOnly = areaProducts.filter((p) => !wardIds.has(p.id));

    const filteredWard = applyFilters(wardProducts);
    const filteredArea = applyFilters(areaOnly);

    const rankedWard = userCoords ? rankProducts(filteredWard, userCoords) : filteredWard;
    const rankedArea = userCoords ? rankProducts(filteredArea, userCoords) : filteredArea;

    return {
      rankedWardProducts: rankedWard,
      rankedAreaProducts: rankedArea,
      totalVisible: rankedWard.length + rankedArea.length,
    };
  }, [wardProducts, areaProducts, activeKey, searchQuery, userCoords]);
  
  const isLoadingMore = areaLoading;
  const allDone = areaDone;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearchQuery("");
    setShowSearch(false);
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
              onClick={() => {
                if (key === "All") {
                  setActiveKey(key);
                } else {
                  setLocation(`/category/${encodeURIComponent(key)}`);
                }
              }}
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
      </div>

      <div className="flex-1 overflow-y-auto">
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
        
        {locationErrorMsg && (
          <div className="mx-4 my-2 p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-start gap-3 shadow-sm">
            <MapPin size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                We need Location Yako 📍
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                {locationErrorMsg}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleRefreshLocation}
                  disabled={refreshingLocation}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {refreshingLocation ? "Retrying..." : "Jaribu tena"}
                </button>
              </div>
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

        {/* Show loading spinner while initial loading and no products yet */}
        {initialLoading ? (
  <div className="px-3 pt-3 pb-24">
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
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
            {rankedWardProducts.length > 0 && (
              <>
                {!isSearchMode && (
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap px-1">
                      Nearby adverts
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {rankedWardProducts.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      userCoords={userCoords}
                      hierarchyReady={hierarchyReady}
                      onClick={(e) => {
                      e.stopPropagation();
                      handleProductClick(p.id);
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {rankedAreaProducts.length > 0 && (
              <>
                <div className="flex items-center gap-3 mb-3 mt-6">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-bold uppercase tracking-wide whitespace-nowrap px-1" style={{ color: areaIsPremiumOnly ? "#00A651" : undefined }}>
                    {isSearchMode
                      ? "More results"
                      : areaIsPremiumOnly
                      ? "More listings nearby · Premium"
                      : "More listings nearby"}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {rankedAreaProducts.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      userCoords={userCoords}
                      hierarchyReady={hierarchyReady}
                      onClick={(e) => {
                      e.stopPropagation();
                      handleProductClick(p.id);
                     }}
                    />
                  ))}
                </div>
              </>
            )}

            <div ref={sentinelRef} className="h-1" />
            {isLoadingMore && (
          <div className="grid grid-cols-2 gap-3 mt-3">
          {Array.from({ length: 4 }).map((_, i) => (
           <ProductCardSkeleton key={`more-${i}`} />
          ))}
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
        <div className="fixed bottom-20 right-4 z-40 pointer-events-none">
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
                  handleRefreshLocation();
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
