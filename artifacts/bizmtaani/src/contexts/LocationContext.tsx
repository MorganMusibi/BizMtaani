// contexts/LocationContext.tsx
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { getWardInfo, type ResolvedLocation } from "@/lib/location";
import { useAuth } from "@/contexts/AuthContext";

interface LocationContextType {
  locationInfo: ResolvedLocation | null;
  userCoords: [number, number] | null;
  gpsGranted: boolean;
  gpsReady: boolean;
  setLocationInfo: (location: ResolvedLocation | null) => void;
  setUserCoords: (coords: [number, number] | null) => void;
  setGpsGranted: (granted: boolean) => void;
  setGpsReady: (ready: boolean) => void;
  refreshLocation: () => Promise<void>;
  isLocationLoading: boolean;
  /** True once resolution has settled (profile/cache/GPS/5s cap) and
   * still found nothing — UI should prompt for GPS or manual entry. */
  needsLocationPrompt: boolean;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

const LOCATION_STATE_STORAGE_KEY = "bizmtaani_location_state";
const LOCATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const LOCATION_RESOLVE_CAP_MS = 5000;

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
    if (!parsed.timestamp || Date.now() - parsed.timestamp > LOCATION_CACHE_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const { userProfile, profileLoading } = useAuth();
  const cached = loadCachedLocationState();

  const [locationInfo, setLocationInfo] = useState<ResolvedLocation | null>(cached?.locationInfo ?? null);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(cached?.userCoords ?? null);
  const [gpsGranted, setGpsGranted] = useState(cached?.gpsGranted ?? false);
  const [gpsReady, setGpsReady] = useState(cached?.gpsReady ?? false);
  const [isLocationLoading, setIsLocationLoading] = useState(true);
  const [needsLocationPrompt, setNeedsLocationPrompt] = useState(false);

  const resolutionStarted = useRef(false);
  // Guards against both the GPS callback and the 5s cap timer trying
  // to settle the outcome — only the first one to fire wins.
  const settledRef = useRef(false);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function settle(outcome: "resolved" | "unresolved") {
    if (settledRef.current) return;
    settledRef.current = true;
    if (capTimerRef.current) {
      clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
    setIsLocationLoading(false);
    setNeedsLocationPrompt(outcome === "unresolved");
  }

  // Persist location state whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(LOCATION_STATE_STORAGE_KEY, JSON.stringify({
        userCoords,
        gpsGranted,
        gpsReady,
        locationInfo,
        timestamp: Date.now()
      }));
    } catch {
      // ignore
    }
  }, [userCoords, gpsGranted, gpsReady, locationInfo]);

  // Primary resolution, in priority order:
  // 1) saved profile location — instant, no spinner
  // 2) valid local cache — instant, no spinner
  // 3) GPS — spins, capped at 5s; stops the moment it resolves
  // 4) still nothing after the cap — prompt for GPS or manual entry
  useEffect(() => {
    if (profileLoading) return; // keep spinner up while auth/profile resolves
    if (resolutionStarted.current) return;
    resolutionStarted.current = true;

    // 1) Valid recent cache wins first — this is what makes a manual
    // area pick on Home "stick" across a reload/re-sign-in for the
    // cache's TTL, instead of always reverting to the profile's saved
    // area. Also the cheapest path: zero network/Firestore cost.
    if (cached?.gpsReady && cached.locationInfo) {
      setGpsReady(true);
      settle("resolved");
      return;
    }

    // 2) No valid cache — fall back to the profile's saved home area.
    // No extra Firestore read here: userProfile is already loaded via
    // AuthContext's existing onSnapshot subscription.
    const savedArea = userProfile?.homeLocation;
    if (savedArea && savedArea.areaName) {
      setLocationInfo({
        wardName: savedArea.areaName,
        constituency: savedArea.constituency,
        county: savedArea.county,
        lat: savedArea.lat,
        lng: savedArea.lng,
      } as ResolvedLocation);
      setUserCoords(
  savedArea.lat != null && savedArea.lng != null
    ? [savedArea.lat, savedArea.lng]
    : null
);
      setGpsReady(true);
      settle("resolved");
      return;
    }

    // 3) Nothing saved and nothing cached — fall back to GPS, capped
    // at 5s, then prompt if still unresolved.
    if (!navigator.geolocation) {
      setGpsReady(true);
      settle("unresolved");
      return;
    }

    capTimerRef.current = setTimeout(() => {
      setGpsReady(true);
      settle("unresolved");
    }, LOCATION_RESOLVE_CAP_MS);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGpsGranted(true);

        const resolved = await getWardInfo(lat, lng);
        setGpsReady(true);
        if (resolved) {
          setLocationInfo({ ...resolved, lat, lng } as ResolvedLocation);
          setUserCoords([lat, lng]);
          settle("resolved");
        } else {
          settle("unresolved");
        }
      },
      () => {
        setGpsGranted(false);
        setGpsReady(true);
        settle("unresolved");
      },
      { enableHighAccuracy: true, timeout: LOCATION_RESOLVE_CAP_MS, maximumAge: 0 }
    );
  }, [profileLoading, userProfile]);

  const refreshLocation = async () => {
    setIsLocationLoading(true);
    setNeedsLocationPrompt(false);
    settledRef.current = false;

    return new Promise<void>((resolve) => {
      if (!navigator.geolocation) {
        setGpsReady(true);
        settle("unresolved");
        resolve();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setGpsGranted(true);

          const resolved = await getWardInfo(lat, lng);
          setGpsReady(true);
          if (resolved) {
            setLocationInfo({ ...resolved, lat, lng } as ResolvedLocation);
            setUserCoords([lat, lng]);
            settle("resolved");
          } else {
            settle("unresolved");
          }
          resolve();
        },
        () => {
          setGpsGranted(false);
          setGpsReady(true);
          settle("unresolved");
          resolve();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  };

  return (
    <LocationContext.Provider value={{
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
    }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocationContext() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error('useLocationContext must be used within a LocationProvider');
  }
  return context;
}
