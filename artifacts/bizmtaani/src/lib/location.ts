/**
 * Location resolution — priority order:
 *  1. GeoJSON ward polygon match  (fastest, most accurate, no network call)
 *  2. Module-level result cache   (avoids repeated work)
 *  3. OSM Nominatim               (fallback, also used for border detection)
 */
import {
  resolveCanonicalLocation,
  normalize,
} from "@/lib/locationHierarchy";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import { getRecaptchaToken } from "@/lib/recaptcha";
import { resolveWardFromAlias, getAllWardsForTown, isMultiWardTown } from "./townAliasMapping";

/**
 * Manual coordinate overrides for wards that GeoJSON can't resolve —
 * either missing entirely from the boundary file, or genuinely
 * ambiguous (same ward name existing as a real, distinct physical
 * place in more than one county). Checked before any GeoJSON lookup.
 *
 * Key format: `${normalize(ward)}|${normalize(constituency)}|${normalize(county)}`
 * using the same normalize() as locationHierarchy.ts, so lookups here
 * are punctuation/casing-insensitive like everywhere else.
 *
 * COORDINATES ARE APPROXIMATE unless noted otherwise — verify/refine
 * locally before relying on these for anything precision-sensitive.
 */
const WARD_COORDINATE_OVERRIDES: Record<string, { lat: number; lng: number }> = {
  // Mwiki straddles a river between Nairobi (Kasarani side) and
  // Kiambu (Ruiru/Githurai side) — two real, distinct wards with the
  // identical name. kenya-wards.geojson only has geometry for the
  // Kasarani/Nairobi side, so the Ruiru/Kiambu side has no polygon to
  // resolve to at all. This coordinate is the general "Mwiki" area
  // pin (~1.22361°S, 36.93111°E per Wikipedia) — approximate, since
  // the Githurai-Mwiki side specifically sits just across the river
  // from this point, not centered exactly on it.
  "mwiki|ruiru|kiambu": { lat: -1.22361, lng: 36.93111 },
};

function getWardCoordinateOverride(
  wardName: string,
  constituencyName: string,
  countyName: string
): { lat: number; lng: number } | null {
  const key = `${normalize(wardName)}|${normalize(constituencyName)}|${normalize(countyName)}`;
  return WARD_COORDINATE_OVERRIDES[key] ?? null;
}

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

export async function forwardGeocodePlace(query: string): Promise<{ lat: number; lng: number } | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ke&limit=1&q=${encodeURIComponent(
        `${trimmed}, Kenya`
      )}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!resp.ok) return null;

    const results = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (!results.length) return null;

    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch (e) {
    console.warn("[location] forward geocode failed:", e);
    return null;
  }
}

/**
 * Search location with support for multi-ward towns (like Kitale)
 * Returns all possible wards for multi-ward towns, or single ward for others
 */
export async function searchLocationWithWardPicker(
  query: string
): Promise<{ 
  type: 'single' | 'multi' | 'none';
  locations?: ResolvedLocation[];
  defaultLocation?: ResolvedLocation;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { type: 'none' };

  // Check if it's a multi-ward town (e.g., Kitale)
  if (isMultiWardTown(trimmed)) {
    const wards = await getAllWardsForTown(trimmed);
    if (wards && wards.length > 0) {
      return {
        type: 'multi',
        locations: wards,
        defaultLocation: wards[0],
      };
    }
  }

  // Check single ward alias (e.g., Ruaka → Ndenderu)
  const singleMatch = await resolveWardFromAlias(trimmed);
  if (singleMatch) {
    return {
      type: 'single',
      defaultLocation: singleMatch,
    };
  }

  // Fallback to geocoding
  const coords = await forwardGeocodePlace(trimmed);
  if (coords) {
    const info = await getWardInfo(coords.lat, coords.lng);
    return {
      type: 'single',
      defaultLocation: info,
    };
  }

  return { type: 'none' };
}

export async function nominatimFallback(lat: number, lng: number): Promise<Partial<ResolvedLocation>> {
  try {
    const functions = getFunctions(app, "us-central1");
    const recaptchaToken = await getRecaptchaToken("reverse_geocode");
    const reverseGeocode = httpsCallable<
      { lat: number; lng: number; recaptchaToken: string },
      Record<string, string | null>
    >(functions, "reverseGeocode");
    const { data: addr } = await reverseGeocode({ lat, lng, recaptchaToken });

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

export async function getWardCoordinates(
  wardName: string,
  constituencyName: string,
  countyName: string
): Promise<{ lat: number; lng: number } | null> {
  const override = getWardCoordinateOverride(wardName, constituencyName, countyName);
  if (override) return override;

  const features = await loadWards();
  if (!features) return null;

  const centerOf = (f: WardFeature) => {
    const [minLng, minLat, maxLng, maxLat] = f._bbox;
    return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  };

  // 1. Exact match: ward + constituency + county
let matches = features.filter(
  (f) =>
    normalize(f.properties.ward) === normalize(wardName) &&
    normalize(f.properties.constituency) === normalize(constituencyName) &&
    normalize(f.properties.county) === normalize(countyName)
);
if (matches.length === 1) return centerOf(matches[0]);

// 2. Ward + county only (constituency naming can drift between
//    MasterHierarchy.json and the GeoJSON source)
matches = features.filter(
  (f) =>
    normalize(f.properties.ward) === normalize(wardName) &&
    normalize(f.properties.county) === normalize(countyName)
);
if (matches.length === 1) return centerOf(matches[0]);

// 3. Ward-only — ONLY safe to use if it's unambiguous (a single
  //    physical ward with this name in the whole country). If there
  //    are duplicates, refuse rather than silently picking the wrong one.
  //
  //    First, collapse duplicate GeoJSON features that describe the
  //    SAME administrative ward (identical ward+constituency+county) —
  //    likely a MultiPolygon split into multiple Features on export.
  //    Without this, a ward that's simply duplicated in the source
  //    file gets wrongly treated as "colliding with a different place
  //    of the same name" and refused even though there's no real
  //    ambiguity.
  matches = features.filter((f) => normalize(f.properties.ward) === normalize(wardName));
  const distinctWards = new Map<string, WardFeature>();
  for (const f of matches) {
    const key = `${normalize(f.properties.ward)}|${normalize(f.properties.constituency)}|${normalize(f.properties.county)}`;
    if (!distinctWards.has(key)) distinctWards.set(key, f);
  }
  const distinctMatches = [...distinctWards.values()];
  if (distinctMatches.length === 1) return centerOf(distinctMatches[0]);

  if (matches.length > 1) {
    console.warn(
      `[location] Ambiguous ward "${wardName}" (constituency="${constituencyName}", county="${countyName}") ` +
      `matched ${matches.length} physical wards in GeoJSON, none of which matched the requested ` +
      `constituency/county exactly:`,
      JSON.stringify(matches.map((f) => f.properties), null, 2)
    );
  }

  return null;
}

export function preloadWards(): void {
  void loadWards();
}

export async function getWardInfo(lat: number, lng: number): Promise<ResolvedLocation> {
  const key = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  if (resolvedCache.has(key)) return resolvedCache.get(key)!;

  const features = await loadWards();
  if (features) {
  const match = findWard(
    lat,
    lng,
    features
  );

  if (match) {
    // GeoJSON identifies the physical ward.
    // MasterHierarchy.json determines the
    // canonical County → Constituency → Ward.
    const canonical =
      await resolveCanonicalLocation(
        match.ward,
        match.constituency,
        match.county
      );

    if (canonical) {
      const result: ResolvedLocation = {
        wardName:
          canonical.wardName,

        constituency:
          canonical.constituencyName,

        county:
          canonical.countyName,

        displayName:
          `${canonical.wardName}, ${canonical.constituencyName}`,
      };

      resolvedCache.set(
        key,
        result
      );

      return result;
    }

    // Safety fallback if the GeoJSON ward
    // does not exist in MasterHierarchy.json.
    const wardName =
      toTitleCase(match.ward);

    const county =
      toTitleCase(match.county);

    const constituency =
      toTitleCase(match.constituency);

    const result: ResolvedLocation = {
      wardName,
      constituency,
      county,
      displayName:
        `${wardName}, ${constituency}`,
    };

    resolvedCache.set(
      key,
      result
    );

    return result;
  }
}

  const fallback =
  await nominatimFallback(
    lat,
    lng
  );

const canonical =
  fallback.wardName
    ? await resolveCanonicalLocation(
        fallback.wardName,
        fallback.constituency,
        fallback.county
      )
    : undefined;

const result: ResolvedLocation =
  canonical
    ? {
        wardName:
          canonical.wardName,

        constituency:
          canonical.constituencyName,

        county:
          canonical.countyName,

        displayName:
          `${canonical.wardName}, ${canonical.constituencyName}`,
      }
    : {
        wardName:
          fallback.wardName ?? "",

        constituency:
          fallback.constituency ?? "",

        county:
          fallback.county ?? "",

        displayName:
          fallback.displayName ??
          "your area",
      };

resolvedCache.set(
  key,
  result
);

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
  const feat = features.find(
    (f) =>
      toTitleCase(f.properties.ward) === name
  );

  if (!feat) continue;

  // GeoJSON identifies the physical ward.
  // MasterHierarchy.json is the final source of truth.
  const canonical =
    await resolveCanonicalLocation(
      feat.properties.ward,
      feat.properties.constituency,
      feat.properties.county
    );

  if (!canonical) continue;

  choices.push({
    wardName: canonical.wardName,
    constituency: canonical.constituencyName,
    county: canonical.countyName,
    displayName:
      `${canonical.wardName}, ${canonical.constituencyName}`,
  });
}
    // Make sure the primary match is first
    // Make sure the primary canonical ward is first
if (primaryMatch) {
  const primaryCanonical =
    await resolveCanonicalLocation(
      primaryMatch.ward,
      primaryMatch.constituency,
      primaryMatch.county
    );

  if (primaryCanonical) {
    const primaryName =
      primaryCanonical.wardName;

    const idx =
      choices.findIndex(
        (c) =>
          c.wardName === primaryName
      );

    if (idx > 0) {
      const [item] =
        choices.splice(idx, 1);

      choices.unshift(item);
    }
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

  if (!info.wardName) continue;

  // Resolve Nominatim's ward through MasterHierarchy.json.
  const canonical =
    await resolveCanonicalLocation(
      info.wardName,
      info.constituency,
      info.county
    );

  if (!canonical) continue;

  if (
    seen.has(
      canonical.wardName.toLowerCase()
    )
  ) {
    continue;
  }

  seen.add(
    canonical.wardName.toLowerCase()
  );

  choices.push({
    wardName: canonical.wardName,
    constituency: canonical.constituencyName,
    county: canonical.countyName,
    displayName:
      `${canonical.wardName}, ${canonical.constituencyName}`,
  });

  if (choices.length >= 3) break;
}

  return choices.length > 0 ? choices : [await getWardInfo(lat, lng)];
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

