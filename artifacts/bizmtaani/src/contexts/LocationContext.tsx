// contexts/LocationContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

const LOCATION_STATE_STORAGE_KEY = "bizmtaani_location_state";
const LOCATION_CACHE_TTL_MS = 15 * 60 * 1000;

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
  const { user, userProfile, profileLoading } = useAuth();
  const cached = loadCachedLocationState();
  
  const [locationInfo, setLocationInfo] = useState<ResolvedLocation | null>(cached?.locationInfo ?? null);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(cached?.userCoords ?? null);
  const [gpsGranted, setGpsGranted] = useState(cached?.gpsGranted ?? false);
  const [gpsReady, setGpsReady] = useState(cached?.gpsReady ?? false);
  const [isLocationLoading, setIsLocationLoading] = useState(!cached?.gpsReady);

  // Cache location state whenever it changes
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

  // Helper to fallback to profile location or just set ready
  const handleLocationFallback = () => {
    // If profile is still loading, wait for it.
    if (profileLoading) {
      return;
    }

    // If user has a home location, use it
    if (userProfile?.homeLocation) {
      const home = userProfile.homeLocation;
      if (home.lat && home.lng) {
        const profileLoc: ResolvedLocation = {
          lat: home.lat,
          lng: home.lng,
          wardName: home.areaName || undefined,
          constituency: home.constituency || undefined,
          county: home.county || undefined,
        };
        setLocationInfo(profileLoc);
        setUserCoords([home.lat, home.lng]);
        setGpsGranted(false);
        setGpsReady(true);
        setIsLocationLoading(false);
        return;
      }
    }

    // No location available, set ready without location
    setGpsGranted(false);
    setGpsReady(true);
    setIsLocationLoading(false);
  };

  // Initial location detection
  useEffect(() => {
    // If we already have a fresh cache, we're done.
    if (cached?.gpsReady) {
      setIsLocationLoading(false);
      return;
    }

    // If no geolocation, fallback to profile or set ready.
    if (!navigator.geolocation) {
      handleLocationFallback();
      return;
    }

    // Try GPS
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGpsGranted(true);
        
        const resolved = await getWardInfo(lat, lng);
        if (resolved) {
          setLocationInfo({ ...resolved, lat, lng } as ResolvedLocation);
          setUserCoords([lat, lng]);
        }
        setGpsReady(true);
        setIsLocationLoading(false);
      },
      () => {
        // GPS failed - fallback to profile
        handleLocationFallback();
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  }, []);

  // Re-check fallback when profile loads or changes
  useEffect(() => {
    if (!profileLoading && !gpsGranted) {
      // If GPS hasn't been granted, we may use profile location
      if (!locationInfo || (userProfile?.homeLocation && locationInfo.wardName !== userProfile.homeLocation.areaName)) {
        handleLocationFallback();
      }
    }
  }, [profileLoading, userProfile, gpsGranted]);

  // Update location if profile changes and we don't have a GPS fix
  useEffect(() => {
    if (profileLoading) return;
    if (gpsGranted) return; // If GPS is granted, we trust it
    if (userProfile?.homeLocation && (!locationInfo || locationInfo.wardName !== userProfile.homeLocation.areaName)) {
      const home = userProfile.homeLocation;
      if (home.lat && home.lng) {
        const profileLoc: ResolvedLocation = {
          lat: home.lat,
          lng: home.lng,
          wardName: home.areaName || undefined,
          constituency: home.constituency || undefined,
          county: home.county || undefined,
        };
        setLocationInfo(profileLoc);
        setUserCoords([home.lat, home.lng]);
        setGpsReady(true);
        setIsLocationLoading(false);
      }
    }
  }, [userProfile, profileLoading, gpsGranted, locationInfo]);

  const refreshLocation = async () => {
    setIsLocationLoading(true);
    return new Promise<void>((resolve) => {
      if (!navigator.geolocation) {
        setGpsReady(true);
        setIsLocationLoading(false);
        resolve();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setGpsGranted(true);
          
          const resolved = await getWardInfo(lat, lng);
          if (resolved) {
            setLocationInfo({ ...resolved, lat, lng } as ResolvedLocation);
            setUserCoords([lat, lng]);
          }
          setGpsReady(true);
          setIsLocationLoading(false);
          resolve();
        },
        () => {
          setGpsGranted(false);
          setGpsReady(true);
          setIsLocationLoading(false);
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
      isLocationLoading
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
