import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, Loader2, Package, MapPin, Search } from "lucide-react";
import { getCategoryDef, getCategoryBadgeColor } from "@/lib/categories";
import { useHomeFeeds, rankProducts, getDistanceKm } from "@/hooks/useHomeFeed";
import { useAuth } from "@/contexts/AuthContext";
import { useLocationContext } from "@/contexts/LocationContext";
import { useToast } from "@/hooks/use-toast";
import { LocationBanner } from "@/components/LocationBanner";
import { getWardInfo } from "@/lib/location";
import { findWardLocationSync } from "@/lib/locationHierarchy";
import { getThumbnailUrl } from "@/lib/cloudinaryUrl";
import { AreaPickerSheet } from "@/components/AreaPickerSheet";
import { Button } from "@/components/ui/button";

// How long a signed-in user waits for their saved area before the
// category page loads without a location.
const LOCATION_WAIT_MS = 4000;

export default function CategoryAds() {
  const { categoryKey, subcategory } = useParams<{ 
    categoryKey: string; 
    subcategory: string 
  }>();
  const [, navigate] = useLocation();
  const { user, likelySignedIn } = useAuth();
  const { toast } = useToast();

  // Use location from context (shared with homepage)
  const { 
  locationInfo,
  userCoords,
  gpsGranted,
  gpsReady,
  refreshLocation,
  isLocationLoading,
  setLocationInfo,
  setUserCoords,
  setGpsReady,
  setGpsGranted,
} = useLocationContext();

  // Signed-in users have a saved profile area, so they get a short wait
  // for it. Brand-new visitors never get a location, so they must not
  // wait at all — the page loads straight away without one.
  const expectsLocation = Boolean(user || likelySignedIn);
  const [waitedForLocation, setWaitedForLocation] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaitedForLocation(true), LOCATION_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const canLoad = gpsReady || !expectsLocation || waitedForLocation;

  const catDef = categoryKey ? getCategoryDef(decodeURIComponent(categoryKey)) : undefined;
  const subName = subcategory ? decodeURIComponent(subcategory) : "";

  const [hierarchyReady, setHierarchyReady] = useState(false);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);
  
  // Refresh options and area picker state
  const [showRefreshOptions, setShowRefreshOptions] = useState(false);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [resolvingAreaSearch, setResolvingAreaSearch] = useState(false);

  const refreshFailureTimestampsRef = useRef<number[]>([]);
  const REFRESH_FAILURE_WINDOW_MS = 60 * 1000;
  const REFRESH_FAILURE_THRESHOLD = 3;

  // Hierarchy loading
  useEffect(() => {
    let cancelled = false;
    import("@/lib/locationHierarchy").then(({ getLocationHierarchy }) => {
      getLocationHierarchy()
        .then(() => {
          if (!cancelled) setHierarchyReady(true);
        })
        .catch(() => {
          if (!cancelled) setHierarchyReady(true);
        });
    });
    return () => { cancelled = true; };
  }, []);

  // Handle area selection from picker
const handleAreaSelect = useCallback(
  (choice: any) => {
    setLocationInfo(choice);
    if (choice.lat != null && choice.lng != null) {
      setUserCoords([choice.lat, choice.lng]);
    }
    setGpsReady(true);
    setShowAreaPicker(false);
    localStorage.setItem("bizmtaani_area_chosen", JSON.stringify(choice));
  },
  [setLocationInfo, setUserCoords, setGpsReady]
);

  // Handle area search selection
  const handleAreaSearchSelect = useCallback(
    async (ward: { wardName: string; constituencyName: string; countyName: string; label?: string }) => {
      setResolvingAreaSearch(true);
      try {
        const { getWardCoordinates } = await import("@/lib/location");
        const coords = await getWardCoordinates(
          ward.wardName,
          ward.constituencyName,
          ward.countyName
        );

        if (!coords) {
          toast({
            title: "Couldn't find that area",
            description: "Try a nearby, larger area name instead.",
          });
          return;
        }

        const resolved: any = {
          lat: coords.lat,
          lng: coords.lng,
          wardName: ward.wardName,
          constituency: ward.constituencyName,
          county: ward.countyName,
          displayName: ward.label ?? `${ward.wardName}, ${ward.constituencyName}`,
          label: ward.label,
        };

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

// Refresh location handler — calls the browser API directly (rather
  // than the context's refreshLocation, whose error path never rejects)
  // so a real permission/GPS failure actually reaches the user.
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

        try {
          // getWardInfo has no internal timeout of its own — race it
          // against one here so a stalled fetch (weak connection)
          // can never leave "Updating..." stuck forever.
          const resolved = await Promise.race([
            getWardInfo(lat, lng),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("ward-resolve-timeout")), 8000)
            ),
          ]);

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
        } catch (err) {
          console.warn("Ward resolution timed out or failed:", err);
          // Still keep the raw GPS coords even though ward lookup
          // failed — better than leaving the user with nothing.
          setUserCoords([lat, lng]);
          setLocationErrorMsg(
            "Ilichukua muda mrefu kupata eneo lako. Jaribu tena, au search manually."
          );
        } finally {
          setRefreshingLocation(false);
        }
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

  // Use the shared hook!
  // gpsReady is replaced by canLoad here so that visitors with no
  // location (and signed-in users after a short wait) still load.
  const {
    areaProducts,
    areaLoading,
    areaDone,
    initialLoading,
    loadMore,
  } = useHomeFeeds({
    gpsReady: canLoad,
    userCoords,
    isSearchMode: false,
    locationInfo: locationInfo as any,
    category: catDef?.key,
    subcategory: subName,
  });

  // Ranking and filtering - Apply visibility filtering for free ads
  const rankedProducts = useMemo(() => {
    if (!userCoords) return areaProducts;
    
    // Filter products based on visibility rules (same as Home)
    const visibleProducts = areaProducts.filter((p) => {
      // For free ads (non-premium), only show if in same ward
      const isPremium = (p.plan && p.plan.startsWith("premium")) || p.isPremium === true;
      if (!isPremium) {
        // Free ads: only visible if ward matches user's ward
        if (!locationInfo?.wardName || !p.ward) return false;
        return p.ward.trim().toLowerCase() === locationInfo.wardName.trim().toLowerCase();
      }
      // Premium ads: visible by distance (handled by useHomeFeeds)
      return true;
    });
    
    // Stronger premium bias on category pages specifically — premium ads
// both sort as if closer (0.3x vs Home's 0.5x) and win same-area ties
// roughly twice as often (weight 6 vs Home's 3).
return rankProducts(visibleProducts, userCoords, {
  premiumWeight: 6,
  premiumDiscount: 0.3,
  premiumAlwaysFirst: true,
});
  }, [areaProducts, userCoords, locationInfo?.wardName]);

  // Infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !areaLoading && !areaDone) {
          loadMore();
        }
      },
      { rootMargin: "100px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [areaLoading, areaDone, loadMore]);

  if (!catDef) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground">Category not found.</p>
        <button onClick={() => navigate("/")} className="text-primary font-semibold">
          Go back
        </button>
      </div>
    );
  }

  const badgeColor = getCategoryBadgeColor(catDef.key);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              navigate("/");
            }
          }}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={24} />
        </button>
        <span className="font-black text-base truncate">{subName}</span>
      </header>

      {/* Shared Location Banner - using context */}
      <LocationBanner
        gpsReady={gpsReady}
        gpsGranted={gpsGranted}
        locationInfo={locationInfo}
        isSearchMode={false}
        refreshingLocation={refreshingLocation || isLocationLoading}
        onRefresh={() => setShowRefreshOptions(true)}
        onSetArea={() => setShowAreaPicker(true)}
        locationErrorMsg={locationErrorMsg}
      />

      {/* Location Error Message */}
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
            <button
              type="button"
              onClick={handleRefreshLocation}
              disabled={refreshingLocation || isLocationLoading}
              className="mt-2 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {refreshingLocation || isLocationLoading ? "Retrying..." : "Jaribu tena"}
            </button>
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

      <div className="px-3 pt-3">
        {/* Visitors with no location: invite them to choose an area */}
        {!userCoords && !isLocationLoading && (
          <div className="text-center mb-3">
            <p className="text-xs text-muted-foreground mb-2">
              Choose your area to see listings near you
            </p>
            <Button size="sm" onClick={() => setShowRefreshOptions(true)}>
              Set my area
            </Button>
          </div>
        )}

        {initialLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading adverts...</p>
          </div>
        ) : rankedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 px-6">
            <Package size={36} className="text-muted-foreground" />
            <p className="font-bold text-lg">No adverts found</p>
            <p className="text-muted-foreground text-sm text-center">
              {userCoords
                ? `No listings in ${subName} yet.`
                : `Set your area to see ${subName} adverts near you.`}
            </p>
            {user && (
              <button
                onClick={() => navigate("/post")}
                className="mt-2 px-4 py-2 bg-primary text-white rounded-xl font-semibold text-sm"
              >
                Post one now
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {rankedProducts.map((p) => {
                const firstImage = p.imageUrls?.[0];
                const displayImage =
                  typeof firstImage === "string"
                    ? firstImage
                    : firstImage?.url || p.imageUrl || "";

                const canonicalLocation =
                  hierarchyReady && p.ward
                    ? findWardLocationSync(p.ward.trim())
                    : undefined;

                const displayWard =
                  (p.areaLabel?.trim() || canonicalLocation?.wardName) ?? p.ward?.trim() ?? "";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/product/${p.id}`)}
                    className="text-left rounded-2xl border border-border overflow-hidden bg-card active:scale-[0.98] transition-transform"
                  >
                    <div className="relative aspect-square bg-muted">
                      {displayImage ? (
                        <img
                          src={getThumbnailUrl(displayImage)}
                          alt={p.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package size={28} className="text-muted-foreground" />
                        </div>
                      )}
                      <div
                        className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeColor}`}
                      >
                        {p.subcategory ?? p.category}
                      </div>
                      {p.plan?.startsWith("premium") && (
                        <div className="absolute top-2 left-2 bg-[#00A651] text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-sm z-10">
                          PREMIUM
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="font-bold text-sm leading-tight line-clamp-2">
                        {p.title}
                      </p>
                      {p.price > 0 && (
                        <p className="text-primary font-black mt-1 text-sm">
                          KES {p.price.toLocaleString()}
                        </p>
                      )}
                      {displayWard && (
                        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                          <MapPin size={11} className="flex-shrink-0" />
                          <span className="truncate">{displayWard}</span>
                        </div>
                      )}
                      {userCoords && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {getDistanceKm(
                            userCoords[0],
                            userCoords[1],
                            p.lat,
                            p.lng
                          ).toFixed(1)}
                          km away
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div ref={sentinelRef} className="h-1" />

            {areaLoading && (
              <div className="flex justify-center py-6">
                <Loader2 size={22} className="animate-spin text-primary" />
              </div>
            )}

            {areaDone && rankedProducts.length > 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">
                No more adverts in {subName}
              </p>
            )}
          </>
        )}
      </div>

      {/* Refresh Options Popup - Same as Home */}
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

      {/* Area Picker Sheet */}
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
