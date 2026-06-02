/**
 * Location resolution — priority order:
 *  1. GeoJSON ward polygon match  (fastest, most accurate, no network call)
 *  2. Module-level result cache   (avoids repeated work)
 *  3. OSM Nominatim               (fallback, also used for border detection)
 */

interface WardFeature {
  type: "Feature";
  properties: { ward: string; constituency: string; county: string };
  geometry: GeoJSONGeometry;
  _bbox: [number, number, number, number];
}

type GeoJSONGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface ResolvedLocation {
  wardName: string;
  constituency: string;
  county: string;
  displayName: string;
}

/** ~330 m at Kenya latitudes — used for border-area probing */
const BORDER_PROBE_DEG = 0.003;

const resolvedCache = new Map<string, ResolvedLocation>();
let wardFeatures: WardFeature[] | null | undefined = undefined;
let loadPromise: Promise<WardFeature[] | null> | null = null;

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

async function loadWards(): Promise<WardFeature[] | null> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch("/kenya-wards.geojson");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json() as {
        type: string;
        features: Omit<WardFeature, "_bbox">[];
      };
      const features: WardFeature[] = geojson.features
        .filter((f) => f.properties.ward)
        .map((f) => ({ ...f, _bbox: computeBbox(f.geometry) }));
      wardFeatures = features;
      return features;
    } catch (e) {
      console.warn("[location] GeoJSON load failed:", e);
      wardFeatures = null;
      return null;
    }
  })();
  return loadPromise;
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

function findWard(lat: number, lng: number, features: WardFeature[]): WardFeature["properties"] | null {
  for (const f of features) {
    const [minLng, minLat, maxLng, maxLat] = f._bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (pointInPolygon(lng, lat, f.geometry)) return f.properties;
  }
  return null;
}

/** Find all wards whose bounding box is within BORDER_PROBE_DEG of the point (border candidates). */
function findNearbyWardNames(lat: number, lng: number, features: WardFeature[]): string[] {
  const pad = BORDER_PROBE_DEG;
  const names: string[] = [];
  for (const f of features) {
    const [minLng, minLat, maxLng, maxLat] = f._bbox;
    // Expand bbox by pad and check if point is inside expanded bbox
    if (
      lng >= minLng - pad && lng <= maxLng + pad &&
      lat >= minLat - pad && lat <= maxLat + pad
    ) {
      const name = toTitleCase(f.properties.ward);
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export async function nominatimFallback(lat: number, lng: number): Promise<Partial<ResolvedLocation>> {
  try {
    // zoom=14 targets ward/suburb level; zoom=12 would give sub-county
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=14`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en", "User-Agent": "BizMtaani/1.0" },
    });
    if (!res.ok) throw new Error("Nominatim error");
    const data = await res.json();
    const addr = data.address ?? {};

    // Priority order for Kenya ward names:
    // suburb / neighbourhood / quarter  → ward-level (most accurate)
    // village / hamlet                  → small settlement (ward-level)
    // town / municipality               → small town (ward-level)
    // city_district / county_district   → sub-county (only if nothing better)
    const wardName = toTitleCase(
      addr.suburb ??
      addr.neighbourhood ??
      addr.quarter ??
      addr.village ??
      addr.hamlet ??
      addr.town ??
      addr.municipality ??
      (addr.city_district !== addr.county ? addr.city_district : undefined) ??
      ""
    );

    // County: prefer state (e.g. "Nairobi County") stripped of " County"
    const countyRaw = (addr.state ?? addr.county ?? "").replace(/ County$/i, "").trim();
    const countyName = toTitleCase(countyRaw);

    // Sub-county as constituency stand-in
    const constituencyName = toTitleCase(addr.city_district ?? addr.county_district ?? "");

    const displayName =
      wardName && countyName && wardName !== countyName
        ? `${wardName}, ${countyName}`
        : wardName || countyName || "your area";

    return { wardName, county: countyName, constituency: constituencyName, displayName };
  } catch {
    return { wardName: "", displayName: "your area" };
  }
}

export function preloadWards(): void {
  void loadWards();
}

export async function getWardInfo(lat: number, lng: number): Promise<ResolvedLocation> {
  const key = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  if (resolvedCache.has(key)) return resolvedCache.get(key)!;

  const features = await loadWards();
  if (features) {
    const match = findWard(lat, lng, features);
    if (match) {
      const wardName = toTitleCase(match.ward);
      const county = toTitleCase(match.county);
      const constituency = toTitleCase(match.constituency);
      const displayName = county ? `${wardName}, ${county}` : wardName;
      const result: ResolvedLocation = { wardName, constituency, county, displayName };
      resolvedCache.set(key, result);
      return result;
    }
  }

  const fallback = await nominatimFallback(lat, lng);
  const result: ResolvedLocation = {
    wardName: fallback.wardName ?? "",
    constituency: fallback.constituency ?? "",
    county: fallback.county ?? "",
    displayName: fallback.displayName ?? "your area",
  };
  resolvedCache.set(key, result);
  return result;
}

export async function getWardName(lat: number, lng: number): Promise<string> {
  const info = await getWardInfo(lat, lng);
  return info.displayName;
}

/**
 * Detect whether a point is near the border of 2–3 areas.
 * Returns 1 item if clearly inside one area, 2–3 items if near a border.
 * Uses GeoJSON when available, otherwise probes Nominatim at offset points.
 */
export async function getAreaChoices(lat: number, lng: number): Promise<ResolvedLocation[]> {
  const features = await loadWards();

  if (features) {
    // GeoJSON path: find all wards whose expanded bbox covers this point
    const primaryMatch = findWard(lat, lng, features);
    const nearbyNames = findNearbyWardNames(lat, lng, features);

    if (nearbyNames.length <= 1) {
      // Clearly inside one area — no picker needed
      const info = await getWardInfo(lat, lng);
      return [info];
    }

    // Map names to full ResolvedLocation objects
    const choices: ResolvedLocation[] = [];
    for (const name of nearbyNames.slice(0, 3)) {
      const feat = features.find((f) => toTitleCase(f.properties.ward) === name);
      if (!feat) continue;
      choices.push({
        wardName: name,
        constituency: toTitleCase(feat.properties.constituency),
        county: toTitleCase(feat.properties.county),
        displayName: `${name}, ${toTitleCase(feat.properties.county)}`,
      });
    }
    // Make sure the primary match is first
    if (primaryMatch) {
      const primaryName = toTitleCase(primaryMatch.ward);
      const idx = choices.findIndex((c) => c.wardName === primaryName);
      if (idx > 0) {
        const [item] = choices.splice(idx, 1);
        choices.unshift(item);
      }
    }
    return choices;
  }

  // Nominatim path: probe offset points to detect border areas
  const probes: [number, number][] = [
    [lat, lng],
    [lat + BORDER_PROBE_DEG, lng],
    [lat, lng + BORDER_PROBE_DEG],
    [lat - BORDER_PROBE_DEG, lng - BORDER_PROBE_DEG],
  ];

  const results = await Promise.allSettled(
    probes.map(([plat, plng]) => nominatimFallback(plat, plng))
  );

  const seen = new Set<string>();
  const choices: ResolvedLocation[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const info = r.value;
    if (!info.wardName || seen.has(info.wardName)) continue;
    seen.add(info.wardName);
    choices.push({
      wardName: info.wardName,
      constituency: info.constituency ?? "",
      county: info.county ?? "",
      displayName: info.displayName ?? info.wardName,
    });
    if (choices.length >= 3) break;
  }

  return choices.length > 0 ? choices : [await getWardInfo(lat, lng)];
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
