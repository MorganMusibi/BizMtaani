import { locationHierarchy } from './locationHierarchy';

// Your hand-picked list - start with 5-10 problem towns
export const TOWN_ALIASES = [
  { alias: "ruaka", ward: "Ruaka", county: "Kiambu", subCounty: "Kiambaa" },
  { alias: "kitale", ward: "Kitale", county: "Trans Nzoia", subCounty: "Trans Nzoia West" },
  // Add more as you discover them
] as const;

export function resolveWardFromAlias(searchTerm: string) {
  const normalized = searchTerm.trim().toLowerCase();
  const match = TOWN_ALIASES.find(a => a.alias === normalized);
  if (!match) return null;
  
  // Cross-reference with your hierarchy
  return locationHierarchy.find(
    w => w.ward === match.ward && w.county === match.county
  ) || null;
}
