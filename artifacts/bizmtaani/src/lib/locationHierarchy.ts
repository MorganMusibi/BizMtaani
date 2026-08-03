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

/**
 * Load the complete location hierarchy.
 *
 * Data is loaded from:
 * public/MasterHierarchy.json
 */
export async function getLocationHierarchy(): Promise<County[]> {
  // Return cached data if already loaded
  if (hierarchyCache) {
    return hierarchyCache;
  }

  const response = await fetch("/MasterHierarchy.json");

  if (!response.ok) {
    throw new Error(
      `Failed to load MasterHierarchy.json: ${response.status} ${response.statusText}`
    );
  }

  const data: County[] = await response.json();

  hierarchyCache = data;

  return data;
}
export async function validateLocationHierarchy(
  countyName: string,
  constituencyName: string,
  wardName: string
): Promise<boolean> {
  const canonical = await resolveCanonicalLocation(
    wardName,
    constituencyName,
    countyName
  );

  if (!canonical) {
    return false;
  }

  return (
    canonical.countyName.trim().toLowerCase() ===
      countyName.trim().toLowerCase() &&
    canonical.constituencyName.trim().toLowerCase() ===
      constituencyName.trim().toLowerCase() &&
    canonical.wardName.trim().toLowerCase() ===
      wardName.trim().toLowerCase()
  );
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

  const normalizedName = countyName.trim().toLowerCase();

  return counties.find(
    (county) =>
      county.county_name.trim().toLowerCase() === normalizedName
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

  const normalizedName = constituencyName.trim().toLowerCase();

  return county.constituencies.find(
    (constituency) =>
      constituency.constituency_name.trim().toLowerCase() ===
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

  const normalizedName = constituencyName.trim().toLowerCase();

  return counties.find((county) =>
    county.constituencies.some(
      (constituency) =>
        constituency.constituency_name.trim().toLowerCase() ===
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

  const normalizedWard = wardName.trim().toLowerCase();

  for (const county of counties) {
    for (const constituency of county.constituencies) {
      const matchingWard = constituency.wards.find(
        (ward) =>
          ward.trim().toLowerCase() === normalizedWard
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

  const normalizedWard =
    wardName.trim().toLowerCase();

  const normalizedConstituency =
    constituencyName?.trim().toLowerCase() ?? "";

  const normalizedCounty =
    countyName?.trim().toLowerCase() ?? "";

  // ============================================================
  // 1. Exact full hierarchy match
  // ============================================================

  for (const county of counties) {
    const countyMatches =
      !normalizedCounty ||
      county.county_name.trim().toLowerCase() ===
        normalizedCounty;

    if (!countyMatches) {
      continue;
    }

    for (const constituency of county.constituencies) {
      const constituencyMatches =
        !normalizedConstituency ||
        constituency.constituency_name
          .trim()
          .toLowerCase() ===
          normalizedConstituency;

      if (!constituencyMatches) {
        continue;
      }

      const matchingWard =
        constituency.wards.find(
          (ward) =>
            ward.trim().toLowerCase() ===
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
            ward.trim().toLowerCase() ===
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
}
export function validateLocationHierarchy(
  countyName: string,
  constituencyName: string,
  wardName: string
): boolean {
  const normalize = (value: string) =>
    value.trim().toLowerCase();

  const county = LOCATION_HIERARCHY.find(
    (county) =>
      normalize(county.county_name) === normalize(countyName)
  );

  if (!county) return false;

  const constituency = county.constituencies.find(
    (constituency) =>
      normalize(constituency.constituency_name) ===
      normalize(constituencyName)
  );

  if (!constituency) return false;

  return constituency.wards.some(
    (ward) =>
      normalize(ward) === normalize(wardName)
  );
}
