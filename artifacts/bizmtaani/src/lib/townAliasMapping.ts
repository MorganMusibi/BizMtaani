import { resolveCanonicalLocation, normalize } from './locationHierarchy';

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

  // Mombasa Estates/Areas with non-matching ward names
  { alias: "old town", ward: "Mji wa Kale/Makadara", constituency: "Mvita", county: "Mombasa" },
  { alias: "kizingo", ward: "Ganjoni/Shimanzi", constituency: "Mvita", county: "Mombasa" },
  { alias: "buxton", ward: "Tononoka", constituency: "Mvita", county: "Mombasa" },
  { alias: "saba saba", ward: "Tononoka", constituency: "Mvita", county: "Mombasa" },
  { alias: "shimanzi", ward: "Ganjoni/Shimanzi", constituency: "Mvita", county: "Mombasa" },
  { alias: "makupa", ward: "Tudor", constituency: "Mvita", county: "Mombasa" },
  { alias: "bombolulu", ward: "Ziwa la Ng'ombe", constituency: "Nyali", county: "Mombasa" },
  { alias: "lights", ward: "Mkomani", constituency: "Nyali", county: "Mombasa" },
  { alias: "mamba village", ward: "Mkomani", constituency: "Nyali", county: "Mombasa" },
  { alias: "sokoni", ward: "Kongowea", constituency: "Nyali", county: "Mombasa" },
  { alias: "vescon", ward: "Bamburi", constituency: "Kisauni", county: "Mombasa" },
  { alias: "mwandoni", ward: "Magogoni", constituency: "Kisauni", county: "Mombasa" },
  { alias: "shelly beach", ward: "Timbwani", constituency: "Likoni", county: "Mombasa" },
  { alias: "ferry", ward: "Bofu", constituency: "Likoni", county: "Mombasa" },
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

// All multi-ward town keys, typed. Used instead of direct bracket
// access (MULTI_WARD_TOWNS[x as TownAlias]) now that lookups go
// through normalize() rather than an exact object-key match.
const MULTI_WARD_TOWN_KEYS = Object.keys(MULTI_WARD_TOWNS) as TownAlias[];

// Shape consumed by AreaPickerSheet / location.ts. NOTE: constituency/
// county here (not constituencyName/countyName) — AreaPickerSheet maps
// loc.constituency -> constituencyName and loc.county -> countyName
// when it calls onSearchSelect, so this shape must match.
export interface ResolvedLocation {
  wardName: string;
  constituency: string;
  county: string;
  displayName: string;
  /**
   * The alias text as searched (e.g. "Ruaka"), title-cased — set only
   * when this result came from the alias table. Callers that want to
   * show the town name the user actually typed, instead of the
   * canonical ward it maps to, should prefer this over displayName.
   */
  label?: string;
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
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
    label: toTitleCase(alias),
  };
}

// Check if a search term is a known town — exact match, using the

// Check if a search term is a known town — exact match, using the
// same normalize() as locationHierarchy.ts (strips spaces, apostrophes,
// hyphens, slashes), so "buru buru" and "buruburu" resolve identically,
// same as "Trans Nzoia"/"Trans-Nzoia" or "babadogo"/"Baba Dogo" do
// against MasterHierarchy.
export async function resolveWardFromAlias(searchTerm: string): Promise<ResolvedLocation | null> {
  const normalizedQuery = normalize(searchTerm);
  if (!normalizedQuery) return null;

  // 1. Check single ward match first
  const singleMatch = TOWN_ALIASES.find(a => normalize(a.alias) === normalizedQuery);
  if (singleMatch) {
    return await resolveAndValidate(
      singleMatch.alias,
      singleMatch.ward,
      singleMatch.constituency,
      singleMatch.county
    );
  }

  // 2. Check multi-ward town - return first (central) ward as default
  const townKey = MULTI_WARD_TOWN_KEYS.find(k => normalize(k) === normalizedQuery);
  if (townKey) {
    const primary = MULTI_WARD_TOWNS[townKey][0]; // Hospital ward for Kitale
    return await resolveAndValidate(
      townKey,
      primary.ward,
      primary.constituency,
      primary.county
    );
  }

  return null;
}

// Get ALL wards for a multi-ward town (for the picker UI) — exact
// match via normalize(), same as resolveWardFromAlias above.
export async function getAllWardsForTown(searchTerm: string): Promise<ResolvedLocation[] | null> {
  const normalizedQuery = normalize(searchTerm);
  if (!normalizedQuery) return null;

  const townKey = MULTI_WARD_TOWN_KEYS.find(k => normalize(k) === normalizedQuery);
  if (!townKey) return null;

  const results = await Promise.all(
    MULTI_WARD_TOWNS[townKey].map(({ ward, constituency, county }) =>
      resolveAndValidate(townKey, ward, constituency, county)
    )
  );

  // Drop entries that failed validation (typo'd alias data) rather
  // than showing an unverified location in the picker.
  return results.filter((r): r is ResolvedLocation => r !== null);
}

// Check if a search term is a multi-ward town — exact match via normalize().
export function isMultiWardTown(searchTerm: string): boolean {
  const normalizedQuery = normalize(searchTerm);
  if (!normalizedQuery) return false;
  return MULTI_WARD_TOWN_KEYS.some(k => normalize(k) === normalizedQuery);
}

export interface TownAliasMatch {
  /** The alias text as stored, for display (e.g. "buruburu", "kitale") */
  alias: string;
  isMultiWard: boolean;
}

/**
 * Search town aliases by a typed, partial name — for search-as-you-type
 * autocomplete in the area picker. Same substring + normalize()
 * approach as searchWardsByName/searchConstituenciesByName in
 * locationHierarchy.ts, so typing "buru" surfaces "buruburu" as a
 * suggestion before the full name is typed, and "trans" would surface
 * "kitale" (matched loosely) the same way "babadogo" partial-matches
 * "Baba Dogo" in the ward search.
 *
 * Returns alias names only — callers resolve each one individually
 * with resolveWardFromAlias/getAllWardsForTown once the person picks
 * a suggestion, same as the ward-search flow resolves a picked ward.
 */
export function searchTownAliases(queryText: string, limit = 8): TownAliasMatch[] {
  const trimmed = queryText.trim();
  if (!trimmed) return [];
  const normalizedQuery = normalize(trimmed);

  const singleMatches: TownAliasMatch[] = TOWN_ALIASES
    .filter(a => normalize(a.alias).includes(normalizedQuery))
    .map(a => ({ alias: a.alias, isMultiWard: false }));

  const multiMatches: TownAliasMatch[] = MULTI_WARD_TOWN_KEYS
    .filter(k => normalize(k).includes(normalizedQuery))
    .map(k => ({ alias: k, isMultiWard: true }));

  return [...singleMatches, ...multiMatches].slice(0, limit);
}
