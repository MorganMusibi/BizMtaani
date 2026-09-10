import * as fs from "fs";
import * as path from "path";

const wardsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "kenya-wards.geojson"), "utf8")
);
const hierarchyData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "MasterHierarchy.json"), "utf8")
);
// ─── Shared normalize() — identical to src/lib/locationHierarchy.ts ────────
export function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[\/\-]/g, " ")
    .replace(/\s+/g, "");
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Ward polygon matching — ported verbatim from src/lib/location.ts ──────
interface WardFeature {
  properties: { ward: string; constituency: string; county: string };
  geometry: GeoJSONGeometry;
  _bbox: [number, number, number, number];
}
type GeoJSONGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

function computeBbox(geom: GeoJSONGeometry): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function scanRing(ring: number[][]) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) scanRing(ring);
  } else {
    for (const poly of geom.coordinates) for (const ring of poly) scanRing(ring);
  }
  return [minLng, minLat, maxLng, maxLat];
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, geom: GeoJSONGeometry): boolean {
  if (geom.type === "Polygon") {
    if (!pointInRing(lng, lat, geom.coordinates[0])) return false;
    for (let i = 1; i < geom.coordinates.length; i++) {
      if (pointInRing(lng, lat, geom.coordinates[i])) return false;
    }
    return true;
  }
  for (const poly of geom.coordinates) {
    if (!pointInRing(lng, lat, poly[0])) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) {
      if (pointInRing(lng, lat, poly[i])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

let wardFeatures: WardFeature[] | null = null;
function loadWards(): WardFeature[] {
  if (wardFeatures) return wardFeatures;
  const geojson = wardsData as { features: Omit<WardFeature, "_bbox">[] };
  wardFeatures = geojson.features
    .filter((f) => f.properties.ward)
    .map((f) => ({ ...f, _bbox: computeBbox(f.geometry) }));
  return wardFeatures;
}

function findWard(lat: number, lng: number): WardFeature["properties"] | null {
  const features = loadWards();
  for (const f of features) {
    const [minLng, minLat, maxLng, maxLat] = f._bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (pointInPolygon(lng, lat, f.geometry)) return f.properties;
  }
  return null;
}

// ─── Hierarchy validation — ported verbatim from src/lib/locationHierarchy.ts
interface Constituency { constituency_name: string; wards: string[]; }
interface County { county_code: number; county_name: string; constituencies: Constituency[]; }
export interface CanonicalLocation {
  wardName: string;
  constituencyName: string;
  countyName: string;
  countyCode: number;
}

const hierarchy = hierarchyData as County[];

export function resolveCanonicalLocation(
  wardName: string,
  constituencyName?: string,
  countyName?: string
): CanonicalLocation | undefined {
  if (!wardName?.trim()) return undefined;
  const normalizedWard = normalize(wardName);
  const normalizedConstituency = constituencyName ? normalize(constituencyName) : "";
  const normalizedCounty = countyName ? normalize(countyName) : "";

  // 1. Exact full hierarchy match
  for (const county of hierarchy) {
    const countyMatches = !normalizedCounty || normalize(county.county_name) === normalizedCounty;
    if (!countyMatches) continue;
    for (const constituency of county.constituencies) {
      const constituencyMatches =
        !normalizedConstituency ||
        normalize(constituency.constituency_name) === normalizedConstituency;
      if (!constituencyMatches) continue;
      const matchingWard = constituency.wards.find((ward) => normalize(ward) === normalizedWard);
      if (matchingWard) {
        return {
          wardName: matchingWard,
          constituencyName: constituency.constituency_name,
          countyName: county.county_name,
          countyCode: county.county_code,
        };
      }
    }
  }

  // 2. Ward-only fallback
  for (const county of hierarchy) {
    for (const constituency of county.constituencies) {
      const matchingWard = constituency.wards.find((ward) => normalize(ward) === normalizedWard);
      if (matchingWard) {
        return {
          wardName: matchingWard,
          constituencyName: constituency.constituency_name,
          countyName: county.county_name,
          countyCode: county.county_code,
        };
      }
    }
  }

  return undefined;
}

// ─── Geohash — ported verbatim from src/lib/geohash.ts ─────────────────────
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let idx = 0, bit = 0;
  let evenBit = true;
  let hash = "";
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { idx = (idx << 1) | 1; lngMin = mid; }
      else { idx <<= 1; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = (idx << 1) | 1; latMin = mid; }
      else { idx <<= 1; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

// ─── Main entry point ───────────────────────────────────────────────────────
export interface ServerResolvedLocation {
  wardName: string;
  constituency: string;
  county: string;
  geohash: string;
}

/**
 * Resolves ward/constituency/county/geohash SERVER-SIDE from raw
 * coordinates only — never trusts any location string supplied by
 * the client. Returns null if the point doesn't fall inside any
 * known ward polygon (e.g. outside Kenya, or a genuine GeoJSON gap).
 */
export function resolveWardServerSide(lat: number, lng: number): ServerResolvedLocation | null {
  const match = findWard(lat, lng);
  if (!match) return null;

  const canonical = resolveCanonicalLocation(match.ward, match.constituency, match.county);
  const geohash = encodeGeohash(lat, lng, 6);

  if (canonical) {
    return {
      wardName: canonical.wardName,
      constituency: canonical.constituencyName,
      county: canonical.countyName,
      geohash,
    };
  }

  // Safety fallback — GeoJSON found a ward that MasterHierarchy.json
  // doesn't recognize. Same fallback behavior as the client's
  // getWardInfo(), so server and client never disagree on this edge case.
  return {
    wardName: toTitleCase(match.ward),
    constituency: toTitleCase(match.constituency),
    county: toTitleCase(match.county),
    geohash,
  };
      }
