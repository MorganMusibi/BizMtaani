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

const AREA_PICKER_STORAGE_KEY = "bizmtaani_area_chosen";

const FILTER_CHIPS = [
  { label: "All", key: "All" },
  ...CATEGORY_DEFS.map((c) => ({ label: c.displayShort, key: c.key })),
];
function getThumbnailUrl(url: string): string {
  if (!url) return "";

  // Cloudinary images:
  // Optimize format, quality, width, and crop for feed cards.
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace(
      "/upload/",
      "/upload/f_auto,q_auto,w_500,c_fill/"
    );
  }

  // Non-Cloudinary images are returned unchanged.
  return url;
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
  {(product.ward || product.constituency) && (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
      <MapPin size={11} className="flex-shrink-0" />
      <span className="truncate">
        {product.ward}
        {product.ward && product.constituency ? " · " : ""}
        {product.constituency}
      </span>
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

  const [areaChoices, setAreaChoices] = useState<ResolvedLocation[]>([]);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const hasPromptedArea = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const applyResolvedLocation = (location: ResolvedLocation) => {
      if (cancelled) return;
      setLocationInfo(location);
      if (location.lat != null && location.lng != null) {
        setUserCoords([location.lat, location.lng]);
      }
      setGpsReady(true);
    };

    const useSavedProfileLocation = () => {
      const saved = userProfile?.homeLocation;
      if (saved && typeof saved.lat === "number" && typeof saved.lng === "number") {
        const savedLocation: ResolvedLocation = {
          lat: saved.lat,
          lng: saved.lng,
          wardName: saved.areaName,
          constituency: saved.constituency,
          county: saved.county,
        };
        applyResolvedLocation(savedLocation);
        return true;
      }
      return false;
    };

    const usePreviouslySelectedArea = () => {
      try {
        const stored = localStorage.getItem(AREA_PICKER_STORAGE_KEY);
        if (!stored) return false;
        const parsed = JSON.parse(stored) as ResolvedLocation;
        if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return false;
        applyResolvedLocation(parsed);
        return true;
      } catch (error) {
        console.error("Failed to load saved area:", error);
        return false;
      }
    };

    const requestGps = () => {
      if (!navigator.geolocation) {
        if (useSavedProfileLocation()) return;
        if (usePreviouslySelectedArea()) return;
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
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setUserCoords([lat, lng]);
          setGpsGranted(true);
          setGpsReady(true);

          try {
            const resolved = await getWardInfo(lat, lng);
            if (cancelled) return;
            if (resolved) {
              setLocationInfo(resolved);
              try {
                const choices = await getAreaChoices(lat, lng);
                if (!cancelled) {
                  setAreaChoices(choices ?? []);
                }
              } catch (error) {
                console.error("Failed to load nearby area choices:", error);
              }
            }
          } catch (error) {
            console.error("Failed to resolve GPS location:", error);
          }
        },
        () => {
          setGpsGranted(false);
          if (useSavedProfileLocation()) return;
          if (usePreviouslySelectedArea()) return;
          setGpsReady(true);
          if (!hasPromptedArea.current) {
            hasPromptedArea.current = true;
            setShowAreaPicker(true);
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    };

    if (user && !userProfile) return;
    requestGps();

    return () => {
      cancelled = true;
    };
  }, [user, userProfile]);

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
      { rootMargin: "400px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
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
    []
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

  const wardIds = new Set(wardProducts.map((p) => p.id));
  const allLoadedProducts = dedupe(
    wardProducts,
    areaProducts.filter((p) => !wardIds.has(p.id))
  );

  const filteredProducts = applyFilters(allLoadedProducts);
  const rankedProducts = userCoords
  ? rankProducts(
      filteredProducts,
      userCoords
    )
  : filteredProducts;

const totalVisible = rankedProducts.length;
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

  function bannerText() {
    if (isSearchMode) return "Searching across Kenya";
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
            {rankedProducts.length > 0 && (
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
      {rankedProducts.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          userCoords={userCoords}
          onClick={(e) => {
            e.stopPropagation();
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
