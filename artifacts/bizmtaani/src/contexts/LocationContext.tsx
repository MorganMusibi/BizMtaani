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
  setNeedsLocationPrompt: (value: boolean) => void;
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
  const { user, userProfile, profileLoading, likelySignedIn } = useAuth();
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
  const startGpsRef = useRef<(() => void) | null>(null);
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
  //
  // GPS is only ever requested for a signed-in user who turns out to
  // have NO saved profile area — a returning user with homeLocation
  // already set should never see the OS permission prompt again. A
  // safety cap covers the rare case where the profile fetch itself
  // hangs, so this can never wait forever.
  const PROFILE_WAIT_SAFETY_CAP_MS = 4000;

  useEffect(() => {
        if (!user) {
      setIsLocationLoading(false);
      // brand-new visitor: no cache, not signed in → Home shows the "Set my area" prompt
      if (!likelySignedIn && !cached?.userCoords) setNeedsLocationPrompt(true);
      return;
    }
    if (resolutionStarted.current) return;

    if (cached?.gpsReady && cached.locationInfo) {
      resolutionStarted.current = true;
      setGpsReady(true);
      settle("resolved");
      return;
    }

    resolutionStarted.current = true;

        function startGps() {
      if (settledRef.current) return;
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
          if (settledRef.current) return;
          // GPS fix arrived: stop the cap timer so it can't discard the ward lookup
          if (capTimerRef.current) {
            clearTimeout(capTimerRef.current);
            capTimerRef.current = null;
          }
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setGpsGranted(true);

          let resolved: ResolvedLocation | null = null;
          try {
            resolved = await Promise.race([
              getWardInfo(lat, lng),
              new Promise<null>((r) => setTimeout(() => r(null), 3000)),
            ]);
          } catch {
            resolved = null;
          }

          if (settledRef.current) return;
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
          if (settledRef.current) return;
          setGpsGranted(false);
          setGpsReady(true);
          settle("unresolved");
        },
        { enableHighAccuracy: false, timeout: LOCATION_RESOLVE_CAP_MS, maximumAge: 10 * 60 * 1000 }
      );
    }

    startGpsRef.current = startGps;

    // Safety net only — if the profile fetch itself hangs longer
    // than this, fall back to GPS rather than leaving the user
    // stuck. In the normal case, the profile-resolution effect below
    // settles this first (with or without GPS) well before this fires.
    const safetyTimer = setTimeout(() => {
      if (!settledRef.current) startGps();
    }, PROFILE_WAIT_SAFETY_CAP_MS);

    return () => clearTimeout(safetyTimer);
  }, [user]);
  // Resolves from the profile the moment it finishes loading — races
  // against startGps() above via the shared settledRef; whichever
  // settles first wins, the other is simply ignored.
  useEffect(() => {
    if (!user) return;
    if (profileLoading) return;
    if (settledRef.current) return;

    const savedArea = userProfile?.homeLocation;
    if (savedArea && savedArea.areaName) {
      setLocationInfo({
        wardName: savedArea.areaName,
        constituency: savedArea.constituency,
        county: savedArea.county,
        lat: savedArea.lat,
        lng: savedArea.lng,
        label: savedArea.label ?? undefined,
      } as ResolvedLocation);
      setUserCoords(
        savedArea.lat != null && savedArea.lng != null
          ? [savedArea.lat, savedArea.lng]
          : null
      );
      setGpsReady(true);
      settle("resolved");
    } else {
      // Profile finished loading and genuinely has no saved area —
      // this is the only case that should ever trigger a GPS
      // permission prompt.
      startGpsRef.current?.();
    }
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

          try {
            // getWardInfo has no internal timeout of its own — once a
            // GPS fix is obtained, the 15s geolocation timeout above
            // no longer applies. Race it against a cap here so a
            // stalled fetch (weak connection) can never leave
            // isLocationLoading stuck true forever.
            const resolved = await Promise.race([
              getWardInfo(lat, lng),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("ward-resolve-timeout")), 8000)
              ),
            ]);
            setGpsReady(true);
            if (resolved) {
              setLocationInfo({ ...resolved, lat, lng } as ResolvedLocation);
              setUserCoords([lat, lng]);
              settle("resolved");
            } else {
              settle("unresolved");
            }
          } catch (err) {
            console.warn("Ward resolution timed out or failed:", err);
            setGpsReady(true);
            setUserCoords([lat, lng]);
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
      setNeedsLocationPrompt,
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
