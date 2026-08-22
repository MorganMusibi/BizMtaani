const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

const NEIGHBORS: Record<
  "right" | "left",
  Record<"even" | "odd", string>
> = {
  right: {
    even: "bc01fg45238967deuvhjyznpkmstqrwx",
    odd: "p0r21436x8zb9dcf5h7kjnmqesgutwvy",
  },
  left: {
    even: "238967debc01fg45kmstqrwxuvhjyznp",
    odd: "14365h7k9dcfesgujnmqp0r2twvyx8zb",
  },
};

const BORDERS: Record<
  "right" | "left",
  Record<"even" | "odd", string>
> = {
  right: {
    even: "bcfguvyz",
    odd: "prxz",
  },
  left: {
    even: "0145hjnp",
    odd: "028b",
  },
};

/**
 * Encode latitude / longitude into a geohash.
 *
 * Precision guide:
 *
 * 4 → ~40km × 20km
 * 5 → ~4.9km × 4.9km
 * 6 → ~1.2km × 0.6km
 */
export function encodeGeohash(
  lat: number,
  lng: number,
  precision = 6
): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let hash = "";

  let latMin = -90;
  let latMax = 90;

  let lngMin = -180;
  let lngMax = 180;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;

      if (lng >= mid) {
        idx = (idx << 1) | 1;
        lngMin = mid;
      } else {
        idx <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;

      if (lat >= mid) {
        idx = (idx << 1) | 1;
        latMin = mid;
      } else {
        idx <<= 1;
        latMax = mid;
      }
    }

    evenBit = !evenBit;

    if (++bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }

  return hash;
}

/**
 * Get a neighbouring geohash in a given direction.
 */
function calculateAdjacent(
  hash: string,
  direction: "right" | "left"
): string {
  if (!hash) return "";

  const lastChar = hash[hash.length - 1];

  const parity = hash.length % 2 === 0
    ? "even"
    : "odd";

  const border = BORDERS[direction][parity];

  let parent = hash.slice(0, -1);

  if (border.includes(lastChar) && parent) {
    parent = calculateAdjacent(
      parent,
      direction
    );
  }

  const neighborTable =
    NEIGHBORS[direction][parity];

  const index = neighborTable.indexOf(lastChar);

  if (index === -1) {
    return hash;
  }

  return (
    parent +
    BASE32[index]
  );
}

/**
 * Get the geohash immediately north.
 */
function north(hash: string): string {
  return calculateAdjacent(
    calculateAdjacent(hash, "right"),
    "right"
  );
}

/**
 * Get the geohash immediately south.
 */
function south(hash: string): string {
  return calculateAdjacent(
    calculateAdjacent(hash, "left"),
    "left"
  );
}

/**
 * Get the geohash immediately east.
 */
function east(hash: string): string {
  return calculateAdjacent(
    hash,
    "right"
  );
}

/**
 * Get the geohash immediately west.
 */
function west(hash: string): string {
  return calculateAdjacent(
    hash,
    "left"
  );
}

/**
 * Return all 8 surrounding cells plus
 * the current cell.
 *
 * The returned array contains up to 9
 * unique geohash prefixes.
 */
export function getNearbyGeohashPrefixes(
  lat: number,
  lng: number,
  precision = 5
): string[] {
  const center = encodeGeohash(
    lat,
    lng,
    precision
  );

  const n = north(center);
  const s = south(center);
  const e = east(center);
  const w = west(center);

  const ne = east(n);
  const nw = west(n);
  const se = east(s);
  const sw = west(s);

  return Array.from(
    new Set([
      center,

      // North
      n,

      // South
      s,

      // East
      e,

      // West
      w,

      // North-East
      ne,

      // North-West
      nw,

      // South-East
      se,

      // South-West
      sw,
    ])
  );
}

/**
 * Return the precision-4 prefix.
 *
 * This is kept for compatibility with
 * your existing code.
 */
export function areaPrefix(
  lat: number,
  lng: number
): string {
  return encodeGeohash(
    lat,
    lng,
    4
  );
}

/**
 * Return a precision-5 geohash.
 *
 * Precision 5 is approximately a few
 * kilometres across and is suitable for
 * nearby advert discovery.
 */
export function nearbyAreaPrefix(
  lat: number,
  lng: number
): string {
  return encodeGeohash(
    lat,
    lng,
    5
  );
    }
/**
 * Maps a search radius (km) to a sane geohash precision. Precision
 * must stay a small integer (4-6 typically) — cell size should get
 * coarser as the search radius grows, not finer. Passing radiusKm
 * itself as precision (the previous bug here) produced 10-50
 * character "geohashes" that never matched any real stored value.
 */
export function radiusKmToGeohashPrecision(radiusKm: number): number {
  if (radiusKm <= 5) return 5;   // ~4.9km cells
  if (radiusKm <= 20) return 4;  // ~40km × 20km cells
  return 3;                      // ~156km cells — covers up to 50km+ in one or two cells
}
