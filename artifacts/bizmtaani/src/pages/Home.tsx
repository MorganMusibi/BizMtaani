
import {
  useHomeFeeds,
  type Product,
  getDistanceKm,
  dedupe,
  rankProducts,
} from "@/hooks/useHomeFeed";
import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWardInfo,
  getAreaChoices,
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
const LOCATION_STATE_STORAGE_KEY = "bizmtaani_location_state";
const LOCATION_PROMPT_SHOWN_KEY = "bizmtaani_location_prompt_shown";

const LOCATION_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function loadCachedLocationState() {
  try {
    const raw = localStorage.getItem(LOCATION_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      userCoords: [number, number] | null;
      gpsGranted: boolean;
      gpsReady: boolean;
      locationInfo: ResolvedLocation | null;
      timestamp?: number;
    };
    // Expired or missing a timestamp (old cache format) — treat as stale
    if (!parsed.timestamp || Date.now() - parsed.timestamp > LOCATION_CACHE_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

let cachedLocationState = loadCachedLocationState();
const FILTER_CHIPS = [
  { label: "All", key: "All" },
  ...CATEGORY_DEFS.map((c) => ({ label: c.displayShort, key: c.key })),
];

function getCanonicalProductLocation(product: Product): {
  ward: string;
  constituency: string;
  county: string;
} {
  const ward = product.ward?.trim() ?? "";
  const constituency = product.constituency?.trim() ?? "";
  const county = product.county?.trim() ?? "";

  // Use MasterHierarchy.json as the source of truth.
  // The ward determines its constituency and county.
  if (hierarchyReady && ward) {
    const canonical = findWardLocationSync(ward);

    if (canonical) {
      return {
        ward: canonical.wardName,
        constituency: canonical.constituencyName,
        county: canonical.countyName,
      };
    }
  }

  // Fallback to the location saved on the advert.
  return {
    ward,
    constituency,
    county,
  };
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
  const [userCoords, setUserCoords] = useState<[number, number] | null>(cachedLocationState?.userCoords ?? null);
  const [gpsGranted, setGpsGranted] = useState(cachedLocationState?.gpsGranted ?? false);
  const [gpsReady, setGpsReady] = useState(cachedLocationState?.gpsReady ?? false);
  const [locationInfo, setLocationInfo] = useState<ResolvedLocation | null>(cachedLocationState?.locationInfo ?? null);
  const [hierarchyReady, setHierarchyReady] = useState(false);
  const [areaChoices, setAreaChoices] = useState<ResolvedLocation[]>([]);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const hasPromptedArea = useRef(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);
  const [refreshingLocation, setRefreshingLocation] = useState(false);

  const refreshLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setRefreshingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGpsGranted(true);
        setLocationErrorMsg(null);
        const resolved = await getWardInfo(lat, lng);

        // Only update state (and therefore trigger a Home feed refetch)
        // if the resolved area is genuinely different from what's
        // already showing. Prevents a Refresh tap from re-querying
        // Firestore when the user hasn't actually moved to a new area.
        const wardChanged = resolved?.wardName
          ? resolved.wardName !== locationInfo?.wardName
          : false;

        if (resolved && wardChanged) {
          setLocationInfo(resolved);
          setUserCoords([lat, lng]);
          const choices = await getAreaChoices(lat, lng);
          setAreaChoices(choices ?? []);
        } else if (!resolved) {
          // Couldn't resolve a ward this time — still worth updating
          // coords in case the caller relies on a fresher fix, but
          // don't touch locationInfo (avoids flashing "Unknown ward").
          setUserCoords([lat, lng]);
        } else {
          // Same ward as before — nothing to update, no refetch. Let
          // the user know the refresh actually ran, since otherwise a
          // no-op refresh looks identical to a silently failed one.
          toast({
            title: "TULIAA! 😂 Uko",
            description: resolved.wardName ? `${resolved.wardName} 🎯` : undefined,
          });
        }

        setRefreshingLocation(false);
      },
      (error) => {
        console.warn("Manual location refresh failed:", error);
        setRefreshingLocation(false);

        if (error.code === error.PERMISSION_DENIED) {
          setLocationErrorMsg(
            "Location yako iko off. Enda  browser settings uka i turn ON, kisha ujaribu tena."
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
  }, [locationInfo?.wardName]);
  // Keep the module-level cache in sync so a later remount can skip
  useEffect(() => {
    cachedLocationState = { userCoords, gpsGranted, gpsReady, locationInfo, timestamp: Date.now() };
    try {
      localStorage.setItem(LOCATION_STATE_STORAGE_KEY, JSON.stringify(cachedLocationState));
    } catch {
      // localStorage full or unavailable — in-memory cache still works for same-session nav
    }
  }, [userCoords, gpsGranted, gpsReady, locationInfo]);

  useEffect(() => {
  let cancelled = false;

  getLocationHierarchy()
    .then(() => {
      if (!cancelled) {
        setHierarchyReady(true);
      }
    })
    .catch((error) => {
      console.error(
        "Failed to load MasterHierarchy.json:",
        error
      );

      if (!cancelled) {
        setHierarchyReady(true);
      }
    });

  return () => {
    cancelled = true;
  };
}, []);
  useEffect(() => {
  if (!("geolocation" in navigator)) return;

  // Only show the location reminder once.
  try {
    const alreadyShown = localStorage.getItem(LOCATION_PROMPT_SHOWN_KEY);

    if (alreadyShown === "true") {
      return;
    }
  } catch {
    // If localStorage is unavailable, continue normally.
  }

  if ("permissions" in navigator) {
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        // Only show the reminder if location hasn't been granted.
        if (status.state === "prompt" || status.state === "denied") {
          toast({
            title: "Turn on location",
            description:
              "Enable GPS/location so we can show your area accurately on adverts and listings nearby.",
          });

          // Remember that the reminder has already been shown.
          try {
            localStorage.setItem(LOCATION_PROMPT_SHOWN_KEY, "true");
          } catch {
            // Ignore localStorage errors.
          }
        }
      })
      .catch((error) => {
        console.warn("Unable to check location permission:", error);
      });
  }
}, [toast]);
    useEffect(() => {
    let cancelled = false;
const applyResolvedLocation = async (location: ResolvedLocation) => {

  if (cancelled) return;

  let final = location;
  if (location.wardName) {
    
    const canonical = await resolveCanonicalLocation(
      location.wardName,
      location.constituency,
      location.county
    );
    
    if (canonical) {
      final = {
        ...location,
        wardName: canonical.wardName,
        constituency: canonical.constituencyName,
        county: canonical.countyName,
        displayName: `${canonical.wardName}, ${canonical.constituencyName}`,
      };
    }
  }

  setLocationInfo((prev) => {
  if (
    prev &&
    prev.lat === final.lat &&
    prev.lng === final.lng &&
    prev.wardName === final.wardName &&
    prev.constituency === final.constituency &&
    prev.county === final.county
  ) {
    return prev;
  }

  return final;
});
  if (final.lat != null && final.lng != null) {
    setUserCoords((prev) => {
  if (
    prev &&
    prev[0] === final.lat &&
    prev[1] === final.lng
  ) {
    return prev;
  }

  return [final.lat, final.lng];
});
  }
  setGpsReady(true);
  
};

    const useSavedProfileLocation = async (): Promise<boolean> => {
  const saved = userProfile?.homeLocation;
  if (saved && typeof saved.lat === "number" && typeof saved.lng === "number") {
    const savedLocation: ResolvedLocation = {
      lat: saved.lat,
      lng: saved.lng,
      wardName: saved.areaName,
      constituency: saved.constituency,
      county: saved.county,
    };
    await applyResolvedLocation(savedLocation);
    return true;
  }
  return false;
};

const usePreviouslySelectedArea = async (): Promise<boolean> => {
  
  try {
    const stored = localStorage.getItem(AREA_PICKER_STORAGE_KEY);
    
    if (!stored) return false;
    const parsed = JSON.parse(stored) as ResolvedLocation;
    
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") {
      
      return false;
    }
    await applyResolvedLocation(parsed);
    
    return true;
  } catch (error) {
    console.error("[LOC] Failed to load saved area:", error);
    return false;
  }
};

    const requestGps = async () => {
  
  if (!navigator.geolocation) {
    if (await useSavedProfileLocation()) return;
    if (await usePreviouslySelectedArea()) return;
    setGpsReady(true);
    if (!hasPromptedArea.current) {
      hasPromptedArea.current = true;
      setShowAreaPicker(true);
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setGpsGranted(true);

      const resolved = await getWardInfo(lat, lng);

      if (resolved) {
        await applyResolvedLocation({ ...resolved, lat, lng });
      } else {
        // Couldn't resolve a ward for these coordinates — still use raw GPS coords
        await applyResolvedLocation({ lat, lng } as ResolvedLocation);
      }

      const choices = await getAreaChoices(lat, lng);
      setAreaChoices(choices ?? []);
    },
    async () => {
      setGpsGranted(false);

      if (await useSavedProfileLocation()) {
        setGpsReady(true);
        return;
      }
      if (await usePreviouslySelectedArea()) {
        setGpsReady(true);
        return;
      }

      setGpsReady(true);
      if (!hasPromptedArea.current) {
        hasPromptedArea.current = true;
        setShowAreaPicker(true);
      }
    },
    {
      enableHighAccuracy: true,
      // Cut from 15s to 6s. A user who hesitates on the browser's
      // "Allow location?" prompt was previously burning that
      // hesitation time against a single long timeout, leaving the
      // homepage blank the whole while. A shorter timeout gets a
      // declining/hesitant user to the fallback chain (saved
      // location → previously chosen area → manual area picker)
      // much sooner.
      timeout: 6000,
      maximumAge: 0
    }
  );
};
    if (gpsReady) {
      // Already resolved (cached from a previous mount) — skip
      // GPS/geocoding entirely on remount.
      return;
    }

    // Previously this waited for userProfile (a Firestore read) to
    // finish before even requesting GPS — for a brand-new signup that
    // adds a full extra round-trip of blank-screen time before the
    // location prompt even appears. GPS/geolocation itself doesn't
    // need the profile; only the useSavedProfileLocation() fallback
    // path does, and that function already handles a not-yet-loaded
    // profile gracefully (returns false and moves to the next
    // fallback), so we no longer block on it here.
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
    if (area) return `${area} area`;
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
        {gpsReady && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
            <MapPin size={12} className={gpsGranted ? "text-secondary flex-shrink-0" : "text-amber-500 flex-shrink-0"} />
            <p className="text-xs text-muted-foreground flex-1 truncate">
              {bannerText()}
            </p>
            <button
              type="button"
              onClick={refreshLocation}
              disabled={refreshingLocation}
              className="text-xs font-semibold text-primary flex-shrink-0 disabled:opacity-50"
            >
              {refreshingLocation ? "Updating..." : "Refresh"}
            </button>
          </div>
        )}
                      {locationErrorMsg && (
          <div className="mx-4 my-2 p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-start gap-3 shadow-sm">
            <MapPin size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Tunahitaji Location Yako 📍
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                {locationErrorMsg}
              </p>
              
              <div className="flex items-center gap-2 mt-2">
                {/* Try Again Button */}
                <button
                  type="button"
                  onClick={refreshLocation}
                  disabled={refreshingLocation}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {refreshingLocation ? "Retrying..." : "Try Again"}
                </button>

                {/* Open Permissions / Guide Button */}
                <button
                  type="button"
                  onClick={() => {
                    alert(
                      "Jinsi ya kuwasha location:\n\n1. Bonyeza lock (🔒) au settings icon kwa address bar.\n2. Tafuta 'Permissions' au 'Location'.\n3. Badilisha iwe 'Allow'.\n4. Refresh page au bonyeza 'Try Again'."
                    );
                  }}
                  className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 text-[11px] font-bold rounded-lg transition-colors border border-amber-500/30"
                >
                  Open Permissions Guide
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
  hierarchyReady={hierarchyReady}
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

    </div>
  );
    }
