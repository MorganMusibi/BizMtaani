// Turns a name into a URL-safe slug: "Baba Dogo" -> "baba-dogo".
// The reverse direction (slug -> canonical name) doesn't need its own
// un-slugify function — resolveCanonicalLocation() in
// locationHierarchy.ts already normalizes away hyphens/case/
// punctuation, so a raw slug can be passed straight into it.
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[/]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
