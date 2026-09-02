import { resolveCanonicalLocation } from './locationHierarchy';

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Single ward towns (1:1 mapping)
export const TOWN_ALIASES = [
  { 
    alias: "ruaka", 
    ward: "Ndenderu", 
    constituency: "Kiambaa", 
    county: "Kiambu" 
  },
  // Add more single-ward towns here
  // { alias: "kayole", ward: "Kayole North", constituency: "Embakasi North", county: "Nairobi" },
] as const;

// Multi-ward towns (1:many mapping)
export const MULTI_WARD_TOWNS = {
  "kitale": [
    { ward: "Tuwan", constituency: "Saboti", county: "Trans Nzoia" },
    { ward: "Kinyoro", constituency: "Saboti", county: "Trans Nzoia" },
    { ward: "Matisi", constituency: "Saboti", county: "Trans Nzoia" },
    { ward: "Hospital", constituency: "Kiminini", county: "Trans Nzoia" },
    { ward: "Sirende", constituency: "Kiminini", county: "Trans Nzoia" },
    { ward: "Waitaluk", constituency: "Kiminini", county: "Trans Nzoia" },
    { ward: "Bidii", constituency: "Kwanza", county: "Trans Nzoia" },
    { ward: "Kapomboi", constituency: "Kwanza", county: "Trans Nzoia" },
  ],
  // Add more multi-ward towns here
  // "nakuru": [
  //   { ward: "Nakuru East", constituency: "Nakuru Town East", county: "Nakuru" },
  //   { ward: "Nakuru West", constituency: "Nakuru Town West", county: "Nakuru" },
  // ],
} as const;

export type TownAlias = keyof typeof MULTI_WARD_TOWNS;

/**
 * Resolve an alias entry to a canonical location, falling back to the
 * alias table's own ward/constituency/county (title-cased) if the ward
 * hasn't been added to MasterHierarchy.json yet. Without this fallback,
 * a known alias whose ward is missing from the hierarchy silently
 * resolves to nothing instead of a usable location.
 */
async function resolveWithFallback(ward: string, constituency: string, county: string) {
  const canonical = await resolveCanonicalLocation(ward, constituency, county);
  if (canonical) return canonical;

  const wardName = toTitleCase(ward);
  const constituencyName = toTitleCase(constituency);
  return {
    wardName,
    constituencyName,
    countyName: toTitleCase(county),
    displayName: `${wardName}, ${constituencyName}`,
  };
}

// Check if a search term is a known town
export async function resolveWardFromAlias(searchTerm: string) {
  const normalized = searchTerm.trim().toLowerCase();
  
  // 1. Check single ward match first
  const singleMatch = TOWN_ALIASES.find(a => a.alias === normalized);
  if (singleMatch) {
    return await resolveWithFallback(
      singleMatch.ward,
      singleMatch.constituency,
      singleMatch.county
    );
  }
  
  // 2. Check multi-ward town - return first (central) ward as default
  const multiWards = MULTI_WARD_TOWNS[normalized as TownAlias];
  if (multiWards && multiWards.length > 0) {
    const primary = multiWards[0]; // Hospital ward for Kitale
    return await resolveWithFallback(
      primary.ward,
      primary.constituency,
      primary.county
    );
  }
  
  return null;
}

// Get ALL wards for a multi-ward town (for the picker UI)
export async function getAllWardsForTown(searchTerm: string) {
  const normalized = searchTerm.trim().toLowerCase();
  const multiWards = MULTI_WARD_TOWNS[normalized as TownAlias];
  if (!multiWards) return null;
  
  const results = await Promise.all(
    multiWards.map(({ ward, constituency, county }) =>
      resolveWithFallback(ward, constituency, county)
    )
  );
  
  // Every entry now resolves to something (canonical or fallback),
  // so there's nothing to filter out anymore.
  return results;
}

// Check if a search term is a multi-ward town
export function isMultiWardTown(searchTerm: string): boolean {
  const normalized = searchTerm.trim().toLowerCase();
  return normalized in MULTI_WARD_TOWNS;
}
