// contexts/LocationContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getWardInfo, type ResolvedLocation } from "@/lib/location";

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

  // Initial location detection
  useEffect(() => {
    if (cached?.gpsReady) {
      setIsLocationLoading(false);
      return;
    }

    if (!navigator.geolocation) {
      setGpsReady(true);
      setIsLocationLoading(false);
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
      },
      () => {
        setGpsGranted(false);
        setGpsReady(true);
        setIsLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  }, []);

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
