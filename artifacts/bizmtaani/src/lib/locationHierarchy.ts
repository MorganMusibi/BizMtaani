// src/lib/locationHierarchy.ts

/**
 * Central location hierarchy for BizMtaani.
 *
 * The source of truth is:
 * /public/MasterHierarchy.json
 *
 * Hierarchy:
 * County
 *   └── Constituency
 *         └── Ward
 */

export interface Constituency {
  constituency_name: string;
  wards: string[];
}

export interface County {
  county_code: number;
  county_name: string;
  constituencies: Constituency[];
}

// Cache the hierarchy so we only fetch the JSON once
let hierarchyCache: County[] | null = null;
const HIERARCHY_SESSION_KEY = "bizmtaani_master_hierarchy";

/**
 * Normalize a location name for comparison.
 *
 * Strips whitespace differences and casing so that variants like
 * "Baba Dogo" (JSON) and "Babadogo" (Google reverse geocoding)
 * are treated as the same ward.
 *
 * Also strips apostrophes/hyphens/slashes, since ward names in
 * MasterHierarchy.json use these inconsistently across near-duplicate
 * spellings — e.g. "Trans-Nzoia" vs "Trans Nzoia", "Ng'Ararii" vs
 * "Ngararii", "Chuka/Igambang'Ombe". Without stripping these, two
 * strings that are clearly "the same place" to a human fail to match
 * because of a punctuation difference alone (this is exactly what
 * caused Kitale's alias entries to fail validation — "Trans Nzoia"
 * vs the JSON's "Trans-Nzoia").
 *
 * Exported so every consumer (this file, location.ts, etc.) uses the
 * same normalization instead of each maintaining its own copy that
 * can silently drift out of sync.
 */
export function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['''`]/g, "")   // apostrophes: straight, curly (both directions), backtick
    .replace(/[\/\-]/g, " ")  // slashes and hyphens -> space, so word boundaries survive
    .replace(/\s+/g, "");     // collapse/strip all whitespace
}

/**
 * Load the complete location hierarchy.
 *
 * Data is loaded from:
 * public/MasterHierarchy.json
 */
export async function getLocationHierarchy(): Promise<County[]> {
  // Return in-memory cache if already loaded this page load
  if (hierarchyCache) {
    return hierarchyCache;
  }

  // Check sessionStorage — survives a full page reload, only cleared
  // when the browser tab/session ends. Ward boundaries essentially
  // never change, so no TTL is needed here.
  try {
    const stored = sessionStorage.getItem(HIERARCHY_SESSION_KEY);
    if (stored) {
      const data: County[] = JSON.parse(stored);
      hierarchyCache = data;
      return data;
    }
  } catch {
    // Corrupt or inaccessible sessionStorage — fall through to fetch.
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("/MasterHierarchy.json", {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to load MasterHierarchy.json: ${response.status} ${response.statusText}`
      );
    }

    const data: County[] = await response.json();

    hierarchyCache = data;

    try {
      sessionStorage.setItem(HIERARCHY_SESSION_KEY, JSON.stringify(data));
    } catch {
      // sessionStorage full or unavailable — in-memory cache still works
      // for the rest of this page load, just won't survive a reload.
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Find a ward in the already-loaded hierarchy.
 *
 * Returns the canonical county, constituency, and ward names.
 *
 * This is synchronous and only works after the hierarchy
 * has already been loaded into memory.
 */
export function findWardLocationSync(
  wardName: string,
  constituencyName?: string,
  countyName?: string
): {
  countyCode: number;
  countyName: string;
  constituencyName: string;
  wardName: string;
} | undefined {
  if (!hierarchyCache || !wardName?.trim()) {
    return undefined;
  }

  const normalizedWard = normalize(wardName);
  const normalizedConstituency = constituencyName ? normalize(constituencyName) : "";
  const normalizedCounty = countyName ? normalize(countyName) : "";
  // ============================================================
  // 1. Exact County + Constituency + Ward match
  // ============================================================

  if (
    normalizedCounty &&
    normalizedConstituency
  ) {
    for (const county of hierarchyCache) {
      if (
        normalize(county.county_name) !==
        normalizedCounty
      ) {
        continue;
      }

      for (const constituency of county.constituencies) {
        if (
          normalize(constituency.constituency_name) !==
          normalizedConstituency
        ) {
          continue;
        }

        const matchingWard =
          constituency.wards.find(
            (ward) =>
              normalize(ward) ===
              normalizedWard
          );

        if (matchingWard) {
          return {
            countyCode: county.county_code,
            countyName: county.county_name,
            constituencyName:
              constituency.constituency_name,
            wardName: matchingWard,
          };
        }
      }
    }
  }

  // ============================================================
  // 2. Constituency + Ward match
  // ============================================================

  if (normalizedConstituency) {
    for (const county of hierarchyCache) {
      for (const constituency of county.constituencies) {
        if (
          normalize(constituency.constituency_name) !==
          normalizedConstituency
        ) {
          continue;
        }

        const matchingWard =
          constituency.wards.find(
            (ward) =>
              normalize(ward) ===
              normalizedWard
          );

        if (matchingWard) {
          return {
            countyCode: county.county_code,
            countyName: county.county_name,
            constituencyName:
              constituency.constituency_name,
            wardName: matchingWard,
          };
        }
      }
    }
  }

  // ============================================================
  // 3. Ward-only fallback
  // ============================================================

  for (const county of hierarchyCache) {
    for (const constituency of county.constituencies) {
      const matchingWard =
        constituency.wards.find(
          (ward) =>
            normalize(ward) ===
            normalizedWard
        );

      if (matchingWard) {
        return {
          countyCode: county.county_code,
          countyName: county.county_name,
          constituencyName:
            constituency.constituency_name,
          wardName: matchingWard,
        };
      }
    }
  }

  return undefined;
}


/**
 * Get all counties.
 */
export async function getCounties(): Promise<County[]> {
  return getLocationHierarchy();
}

/**
 * Find a county by name.
 */
export async function getCountyByName(
  countyName: string
): Promise<County | undefined> {
  const counties = await getLocationHierarchy();

  const normalizedName = normalize(countyName);

  return counties.find(
    (county) =>
      normalize(county.county_name) === normalizedName
  );
}

/**
 * Find a county by county code.
 */
export async function getCountyByCode(
  countyCode: number
): Promise<County | undefined> {
  const counties = await getLocationHierarchy();

  return counties.find(
    (county) => county.county_code === countyCode
  );
}

/**
 * Get all constituencies belonging to a county.
 */
export async function getConstituencies(
  countyName: string
): Promise<Constituency[]> {
  const county = await getCountyByName(countyName);

  return county?.constituencies ?? [];
}

/**
 * Find a constituency by name within a county.
 */
export async function getConstituencyByName(
  countyName: string,
  constituencyName: string
): Promise<Constituency | undefined> {
  const county = await getCountyByName(countyName);

  if (!county) {
    return undefined;
  }

  const normalizedName = normalize(constituencyName);

  return county.constituencies.find(
    (constituency) =>
      normalize(constituency.constituency_name) ===
      normalizedName
  );
}

/**
 * Get all wards belonging to a county and constituency.
 */
export async function getWards(
  countyName: string,
  constituencyName: string
): Promise<string[]> {
  const constituency = await getConstituencyByName(
    countyName,
    constituencyName
  );

  return constituency?.wards ?? [];
}

/**
 * Find which county contains a specific constituency.
 */
export async function findCountyByConstituency(
  constituencyName: string
): Promise<County | undefined> {
  const counties = await getLocationHierarchy();

  const normalizedName = normalize(constituencyName);

  return counties.find((county) =>
    county.constituencies.some(
      (constituency) =>
        normalize(constituency.constituency_name) ===
        normalizedName
    )
  );
}

/**
 * Find the county and constituency that contain a specific ward.
 */
export async function findWardLocation(
  wardName: string
): Promise<{
  county: County;
  constituency: Constituency;
  ward: string;
} | undefined> {
  const counties = await getLocationHierarchy();

  const normalizedWard = normalize(wardName);

  for (const county of counties) {
    for (const constituency of county.constituencies) {
      const matchingWard = constituency.wards.find(
        (ward) =>
          normalize(ward) === normalizedWard
      );

      if (matchingWard) {
        return {
          county,
          constituency,
          ward: matchingWard,
        };
      }
    }
  }

  return undefined;
}

/**
 * Get all wards in the entire country.
 *
 * Useful for search and admin functionality.
 */
export async function getAllWards(): Promise<
  {
    countyCode: number;
    countyName: string;
    constituencyName: string;
    wardName: string;
  }[]
> {
  const counties = await getLocationHierarchy();

  const results: {
    countyCode: number;
    countyName: string;
    constituencyName: string;
    wardName: string;
  }[] = [];

  for (const county of counties) {
    for (const constituency of county.constituencies) {
      for (const ward of constituency.wards) {
        results.push({
          countyCode: county.county_code,
          countyName: county.county_name,
          constituencyName: constituency.constituency_name,
          wardName: ward,
        });
      }
    }
  }

  return results;
}
export interface CanonicalLocation {
  wardName: string;
  constituencyName: string;
  countyName: string;
  countyCode: number;
}

/**
 * Resolve a location against MasterHierarchy.json.
 *
 * MasterHierarchy.json is the FINAL source of truth.
 *
 * Matching priority:
 * 1. Ward + constituency + county
 * 2. Ward + constituency
 * 3. Ward only
 *
 * This allows older or incorrect Firestore location fields
 * to be corrected automatically.
 */
export async function resolveCanonicalLocation(
  wardName: string,
  constituencyName?: string,
  countyName?: string
): Promise<CanonicalLocation | undefined> {
  if (!wardName?.trim()) {
    return undefined;
  }
  const counties = await getLocationHierarchy();
  const normalizedWard = normalize(wardName);

  const normalizedConstituency =
    constituencyName ? normalize(constituencyName) : "";

  const normalizedCounty =
    countyName ? normalize(countyName) : "";

  // ============================================================
  // 1. Exact full hierarchy match
  // ============================================================

  for (const county of counties) {
    const countyMatches =
      !normalizedCounty ||
      normalize(county.county_name) === normalizedCounty;

    if (!countyMatches) {
      continue;
    }

    for (const constituency of county.constituencies) {
      const constituencyMatches =
        !normalizedConstituency ||
        normalize(constituency.constituency_name) ===
          normalizedConstituency;

      if (!constituencyMatches) {
        continue;
      }

      const matchingWard =
        constituency.wards.find(
          (ward) =>
            normalize(ward) === normalizedWard
        );

      if (matchingWard) {
        return {
          wardName: matchingWard,
          constituencyName:
            constituency.constituency_name,
          countyName:
            county.county_name,
          countyCode:
            county.county_code,
        };
      }
    }
  }

  // ============================================================
  // 2. Ward-only canonical lookup
  //
  // Used when Firestore or GeoJSON has an incorrect
  // constituency/county.
  // ============================================================

  for (const county of counties) {
    for (const constituency of county.constituencies) {
      const matchingWard =
        constituency.wards.find(
          (ward) =>
            normalize(ward) ===
            normalizedWard
        );

      if (matchingWard) {
        return {
          wardName: matchingWard,
          constituencyName:
            constituency.constituency_name,
          countyName:
            county.county_name,
          countyCode:
            county.county_code,
        };
      }
    }
  }

  return undefined;
}

/**
 * Clear the cached hierarchy.
 *
 * Normally you won't need this.
 * It can be useful during development or testing.
 */
export function clearLocationHierarchyCache(): void {
  hierarchyCache = null;
  try {
    sessionStorage.removeItem(HIERARCHY_SESSION_KEY);
  } catch {
    // Ignore — nothing to clean up if sessionStorage is unavailable.
  }
}
export async function validateLocationHierarchy(
  countyName: string,
  constituencyName: string,
  wardName: string
): Promise<CanonicalLocation | null> {
  const counties = await getLocationHierarchy();

  const county = counties.find(
    (county) =>
      normalize(county.county_name) === normalize(countyName)
  );

  if (!county) return null;

  const constituency = county.constituencies.find(
    (constituency) =>
      normalize(constituency.constituency_name) ===
      normalize(constituencyName)
  );

  if (!constituency) return null;

  const matchingWard = constituency.wards.find(
    (ward) => normalize(ward) === normalize(wardName)
  );

  if (!matchingWard) return null;

  return {
    wardName: matchingWard,
    constituencyName: constituency.constituency_name,
    countyName: county.county_name,
    countyCode: county.county_code,
  };
}


/**
 * Search all wards by a typed, partial name — for a manual area-picker
 * search box. Uses the same normalize() as the rest of this file, so
 * results are consistent with resolveCanonicalLocation/findWardLocationSync
 * (e.g. typing "babadogo" matches "Baba Dogo"). Unlike those functions,
 * this does substring matching, not exact — appropriate for search-as-you-type.
 */
export async function searchWardsByName(
  queryText: string,
  limit = 15
): Promise<
  { countyCode: number; countyName: string; constituencyName: string; wardName: string }[]
> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  const all = await getAllWards();
  const normalizedQuery = normalize(trimmed);

  return all
    .filter((w) => normalize(w.wardName).includes(normalizedQuery))
    .slice(0, limit);
}

/**
 * Search constituencies by a typed, partial name. Selecting a result
 * from this should show that constituency's ward list next (its
 * wards are already included on the returned object, no extra
 * lookup needed).
 */
export async function searchConstituenciesByName(
  queryText: string,
  limit = 15
): Promise<{ countyCode: number; countyName: string; constituencyName: string; wards: string[] }[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  const counties = await getLocationHierarchy();
  const normalizedQuery = normalize(trimmed);
  const results: { countyCode: number; countyName: string; constituencyName: string; wards: string[] }[] = [];

  for (const county of counties) {
    for (const constituency of county.constituencies) {
      if (normalize(constituency.constituency_name).includes(normalizedQuery)) {
        results.push({
          countyCode: county.county_code,
          countyName: county.county_name,
          constituencyName: constituency.constituency_name,
          wards: constituency.wards,
        });
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

/**
 * Search counties by a typed, partial name. Selecting a result from
 * this should show that county's constituency list next.
 */
export async function searchCountiesByName(
  queryText: string,
  limit = 15
): Promise<{ countyCode: number; countyName: string; constituencies: Constituency[] }[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  const counties = await getLocationHierarchy();
  const normalizedQuery = normalize(trimmed);

  return counties
    .filter((c) => normalize(c.county_name).includes(normalizedQuery))
    .map((c) => ({ countyCode: c.county_code, countyName: c.county_name, constituencies: c.constituencies }))
    .slice(0, limit);
}

