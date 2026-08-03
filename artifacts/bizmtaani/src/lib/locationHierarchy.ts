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
/**
 * Find a ward in the already-loaded hierarchy.
 *
 * Returns the canonical county, constituency, and ward names.
 *
 * This is synchronous and only works after the hierarchy
 * has already been loaded into memory.
 */
export function findWardLocationSync(
  wardName: string
): {
  countyCode: number;
  countyName: string;
  constituencyName: string;
  wardName: string;
} | undefined {
  if (!hierarchyCache) {
    return undefined;
  }

  const normalizedWard = wardName.trim().toLowerCase();

  for (const county of hierarchyCache) {
    for (const constituency of county.constituencies) {
      const matchingWard = constituency.wards.find(
        (ward) =>
          ward.trim().toLowerCase() === normalizedWard
      );

      if (matchingWard) {
        return {
          countyCode: county.county_code,
          countyName: county.county_name,
          constituencyName: constituency.constituency_name,
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

/**
 * Clear the cached hierarchy.
 *
 * Normally you won't need this.
 * It can be useful during development or testing.
 */
export function clearLocationHierarchyCache(): void {
  hierarchyCache = null;
}
