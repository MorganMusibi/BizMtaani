import { resolveCanonicalLocation } from './locationHierarchy';

// Single ward towns (1:1 mapping)
export const TOWN_ALIASES = [
  { alias: "ruaka", ward: "Ndenderu", constituency: "Kiambaa", county: "Kiambu" },
  // Nairobi Estates/Areas with non-matching ward names
  { alias: "buruburu", ward: "Harambee", constituency: "Makadara", county: "Nairobi" },
  { alias: "south b", ward: "Nairobi South", constituency: "Starehe", county: "Nairobi" },
  { alias: "madaraka", ward: "Nairobi West", constituency: "Lang'ata", county: "Nairobi" },
  { alias: "donholm", ward: "Upper Savanna", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "nyayo estate", ward: "Embakasi", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "runda", ward: "Karura", constituency: "Westlands", county: "Nairobi" },
  { alias: "muthaiga", ward: "Karura", constituency: "Westlands", county: "Nairobi" },
  { alias: "gigiri", ward: "Karura", constituency: "Westlands", county: "Nairobi" },
  { alias: "hurlingham", ward: "Kilimani", constituency: "Dagoretti North", county: "Nairobi" },
  { alias: "adams arcade", ward: "Kilimani", constituency: "Dagoretti North", county: "Nairobi" },
  { alias: "otiende", ward: "Lang'ata", constituency: "Lang'ata", county: "Nairobi" },
  { alias: "tena", ward: "Harambee", constituency: "Makadara", county: "Nairobi" },
  { alias: "jericho", ward: "Makongeni", constituency: "Makadara", county: "Nairobi" },
  { alias: "fedha", ward: "Kware", constituency: "Embakasi South", county: "Nairobi" },
  { alias: "tassia", ward: "Embakasi", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "satellite", ward: "Riruta", constituency: "Dagoretti South", county: "Nairobi" },
  { alias: "mirema", ward: "Roysambu", constituency: "Roysambu", county: "Nairobi" },
  { alias: "kahawa sukari", ward: "Kahawa", constituency: "Roysambu", county: "Nairobi" },
  { alias: "industrial area", ward: "Viwandani", constituency: "Makadara", county: "Nairobi" },
  { alias: "shauri moyo", ward: "Pumwani", constituency: "Kamukunji", county: "Nairobi" },
  { alias: "greenfields", ward: "Savanna", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "jacaranda", ward: "Kayole Central", constituency: "Embakasi Central", county: "Nairobi" },

  // Add more single-ward towns here
  // { alias: "kayole", ward: "Kayole North", constituency: "Embakasi North", county: "Nairobi" },
] as const;

// Multi-ward towns (1:many mapping)
export const MULTI_WARD_TOWNS = {
  "kitale": [
    { ward: "Tuwani", constituency: "Saboti", county: "Trans-Nzoia" },
    { ward: "Kinyoro", constituency: "Saboti", county: "Trans-Nzoia" },
    { ward: "Matisi", constituency: "Saboti", county: "Trans-Nzoia" },
    { ward: "Hospital", constituency: "Kiminini", county: "Trans-Nzoia" },
    { ward: "Sirende", constituency: "Kiminini", county: "Trans-Nzoia" },
    { ward: "Waitaluk", constituency: "Kiminini", county: "Trans-Nzoia" },
    { ward: "Bidii", constituency: "Kwanza", county: "Trans-Nzoia" },
    { ward: "Kapomboi", constituency: "Kwanza", county: "Trans-Nzoia" },
  ],
  
  "lavington": [
    { ward: "Kileleshwa", constituency: "Dagoretti North", county: "Nairobi" },
    { ward: "Kitisuru", constituency: "Westlands", county: "Nairobi" },
  ],
  "loresho": [
    { ward: "Mountain View", constituency: "Westlands", county: "Nairobi" },
    { ward: "Kitisuru", constituency: "Westlands", county: "Nairobi" },
  ],

  // Add more multi-ward towns here
  // "nakuru": [
  //   { ward: "Nakuru East", constituency: "Nakuru Town East", county: "Nakuru" },
  //   { ward: "Nakuru West", constituency: "Nakuru Town West", county: "Nakuru" },
  // ],
} as const;

export type TownAlias = keyof typeof MULTI_WARD_TOWNS;

// Shape consumed by AreaPickerSheet / location.ts. NOTE: constituency/
// county here (not constituencyName/countyName) — AreaPickerSheet maps
// loc.constituency -> constituencyName and loc.county -> countyName
// when it calls onSearchSelect, so this shape must match.
export interface ResolvedLocation {
  wardName: string;
  constituency: string;
  county: string;
  displayName: string;
}

/**
 * Resolve an alias entry against MasterHierarchy.json — the alias
 * table is only ever a pointer at a ward; MasterHierarchy is the
 * source of truth for whether that ward exists and what its
 * canonical names are.
 *
 * resolveCanonicalLocation returns { wardName, constituencyName,
 * countyName }; that's mapped here to the { wardName, constituency,
 * county, displayName } shape above.
 *
 * If validation fails, that means an alias entry has a typo or
 * references a ward/constituency/county combination that isn't in
 * the hierarchy — a bug in the alias table, not a "not added yet"
 * situation. This does NOT fabricate a result: it warns (so the bad
 * entry surfaces during development) and returns null, so the
 * caller treats it the same as any other unresolved search term.
 */
async function resolveAndValidate(
  alias: string,
  ward: string,
  constituency: string,
  county: string
): Promise<ResolvedLocation | null> {
  const canonical = await resolveCanonicalLocation(ward, constituency, county);
  if (!canonical) {
    console.warn(
      `[townAliasMapping] "${alias}" -> ward="${ward}", constituency="${constituency}", county="${county}" ` +
      `did not match MasterHierarchy.json. Check this alias entry for a typo.`
    );
    return null;
  }

  return {
    wardName: canonical.wardName,
    constituency: canonical.constituencyName,
    county: canonical.countyName,
    displayName: `${canonical.wardName}, ${canonical.constituencyName}`,
  };
}

// Check if a search term is a known town
export async function resolveWardFromAlias(searchTerm: string): Promise<ResolvedLocation | null> {
  const normalized = searchTerm.trim().toLowerCase();
  
  // 1. Check single ward match first
  const singleMatch = TOWN_ALIASES.find(a => a.alias === normalized);
  if (singleMatch) {
    return await resolveAndValidate(
      singleMatch.alias,
      singleMatch.ward,
      singleMatch.constituency,
      singleMatch.county
    );
  }
  
  // 2. Check multi-ward town - return first (central) ward as default
  const multiWards = MULTI_WARD_TOWNS[normalized as TownAlias];
  if (multiWards && multiWards.length > 0) {
    const primary = multiWards[0]; // Hospital ward for Kitale
    return await resolveAndValidate(
      normalized,
      primary.ward,
      primary.constituency,
      primary.county
    );
  }
  
  return null;
}

// Get ALL wards for a multi-ward town (for the picker UI)
export async function getAllWardsForTown(searchTerm: string): Promise<ResolvedLocation[] | null> {
  const normalized = searchTerm.trim().toLowerCase();
  const multiWards = MULTI_WARD_TOWNS[normalized as TownAlias];
  if (!multiWards) return null;
  
  const results = await Promise.all(
    multiWards.map(({ ward, constituency, county }) =>
      resolveAndValidate(normalized, ward, constituency, county)
    )
  );
  
  // Drop entries that failed validation (typo'd alias data) rather
  // than showing an unverified location in the picker.
  return results.filter((r): r is ResolvedLocation => r !== null);
}

// Check if a search term is a multi-ward town
export function isMultiWardTown(searchTerm: string): boolean {
  const normalized = searchTerm.trim().toLowerCase();
  return normalized in MULTI_WARD_TOWNS;
}
