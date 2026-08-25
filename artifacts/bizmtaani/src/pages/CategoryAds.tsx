import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, Loader2, Package, MapPin, Search } from "lucide-react"; // Added Search
import { getCategoryDef, getCategoryBadgeColor } from "@/lib/categories";
import { useHomeFeeds, rankProducts, getDistanceKm } from "@/hooks/useHomeFeed";
import { useAuth } from "@/contexts/AuthContext";
import { LocationBanner } from "@/components/LocationBanner";
import { findWardLocationSync } from "@/lib/locationHierarchy";
import { getThumbnailUrl } from "@/lib/cloudinaryUrl";
import { AreaPickerSheet } from "@/components/AreaPickerSheet"; // ADD THIS
import { Button } from "@/components/ui/button"; // ADD THIS

export default function CategoryAds() {
  const { categoryKey, subcategory } = useParams<{ 
    categoryKey: string; 
    subcategory: string 
  }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const catDef = categoryKey ? getCategoryDef(decodeURIComponent(categoryKey)) : undefined;
  const subName = subcategory ? decodeURIComponent(subcategory) : "";

  // Location state (same as Home page)
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [gpsGranted, setGpsGranted] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);
  const [locationInfo, setLocationInfo] = useState<{ wardName?: string } | null>(null);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);
  const [hierarchyReady, setHierarchyReady] = useState(false);
  
  // NEW: Refresh options and area picker state
  const [showRefreshOptions, setShowRefreshOptions] = useState(false);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [resolvingAreaSearch, setResolvingAreaSearch] = useState(false);

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

  // Try to get location from cache
  useEffect(() => {
    try {
      const cached = localStorage.getItem("bizmtaani_location_state");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.userCoords && parsed.locationInfo) {
          setUserCoords(parsed.userCoords);
          setGpsGranted(parsed.gpsGranted || false);
          setGpsReady(true);
          setLocationInfo(parsed.locationInfo);
          return;
        }
      }
    } catch (e) {
      // Ignore
    }

    // Fallback: try GPS
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setGpsGranted(true);
          setUserCoords([lat, lng]);
          
          try {
            const { getWardInfo } = await import("@/lib/location");
            const resolved = await getWardInfo(lat, lng);
            if (resolved) {
              setLocationInfo(resolved);
            }
          } catch (e) {
            // Ignore
          }
          setGpsReady(true);
        },
        () => {
          setGpsReady(true);
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      setGpsReady(true);
    }
  }, []);

  // NEW: Handle area selection from picker
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
    []
  );

  // NEW: Handle area search selection
  const handleAreaSearchSelect = useCallback(
    async (ward: { wardName: string; constituencyName: string; countyName: string }) => {
      setResolvingAreaSearch(true);
      try {
        const { getWardCoordinates } = await import("@/lib/location");
        const coords = await getWardCoordinates(
          ward.wardName,
          ward.constituencyName,
          ward.countyName
        );

        if (!coords) {
          // toast would go here if we had useToast
          return;
        }

        const resolved: any = {
          lat: coords.lat,
          lng: coords.lng,
          wardName: ward.wardName,
          constituency: ward.constituencyName,
          county: ward.countyName,
          displayName: `${ward.wardName}, ${ward.constituencyName}`,
        };

        handleAreaSelect(resolved);
      } catch (error) {
        console.warn("Failed to resolve selected area:", error);
      } finally {
        setResolvingAreaSearch(false);
      }
    },
    [handleAreaSelect]
  );

  // NEW: Refresh location function (same as Home)
  const refreshLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setRefreshingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGpsGranted(true);
        setLocationErrorMsg(null);
        const { getWardInfo } = await import("@/lib/location");
        const resolved = await getWardInfo(lat, lng);

        const wardChanged = resolved?.wardName
          ? resolved.wardName !== locationInfo?.wardName
          : false;

        if (resolved && wardChanged) {
          setLocationInfo(resolved);
          setUserCoords([lat, lng]);
        } else if (!resolved) {
          setUserCoords([lat, lng]);
        }
        setRefreshingLocation(false);
      },
      (error) => {
        console.warn("Manual location refresh failed:", error);
        setRefreshingLocation(false);
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
  }, [locationInfo?.wardName]);

  // Use the shared hook!
  const {
    areaProducts,
    areaLoading,
    areaDone,
    initialLoading,
    loadMore,
  } = useHomeFeeds({
    gpsReady,
    userCoords,
    isSearchMode: false,
    locationInfo: locationInfo as any,
    category: catDef?.key,
    subcategory: subName,
  });

  // Ranking and filtering - FIX: Apply visibility filtering for free ads
  const rankedProducts = useMemo(() => {
    if (!userCoords) return areaProducts;
    
    // Filter products based on visibility rules (same as Home)
    const visibleProducts = areaProducts.filter((p) => {
      // For free ads (non-premium), only show if in same ward
      const isPremium = p.plan?.startsWith("premium") || p.isPremium;
      if (!isPremium) {
        // Free ads: only visible if ward matches user's ward
        if (!locationInfo?.wardName || !p.ward) return false;
        return p.ward.trim().toLowerCase() === locationInfo.wardName.trim().toLowerCase();
      }
      // Premium ads: visible by distance (handled by useHomeFeeds)
      return true;
    });
    
    return rankProducts(visibleProducts, userCoords);
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

      {/* Shared Location Banner - with refresh options popup */}
      <LocationBanner
        gpsReady={gpsReady}
        gpsGranted={gpsGranted}
        locationInfo={locationInfo}
        isSearchMode={false}
        refreshingLocation={refreshingLocation}
        onRefresh={() => setShowRefreshOptions(true)} // Show popup instead of direct refresh
        onSetArea={() => setShowAreaPicker(true)}
        locationErrorMsg={locationErrorMsg}
      />

      <div className="px-3 pt-3">
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
              No listings in {subName} yet.
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
                  canonicalLocation?.wardName ?? p.ward?.trim() ?? "";

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

      {/* NEW: Refresh Options Popup - Same as Home */}
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
                  refreshLocation();
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

      {/* NEW: Area Picker Sheet */}
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
