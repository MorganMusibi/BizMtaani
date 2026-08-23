const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

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

// Returns the lat/lng span (in degrees) covered by one geohash cell
// at a given precision — used to step to neighboring cells without
// relying on base32 neighbor/border lookup tables.
function geohashCellSizeDeg(precision: number): { lngSpan: number; latSpan: number } {
  const totalBits = precision * 5;
  const lngBits = Math.ceil(totalBits / 2);
  const latBits = Math.floor(totalBits / 2);
  return {
    lngSpan: 360 / Math.pow(2, lngBits),
    latSpan: 180 / Math.pow(2, latBits),
  };
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
  const { lngSpan, latSpan } = geohashCellSizeDeg(precision);

  const points: [number, number][] = [
    [lat, lng],
    [lat + latSpan, lng],
    [lat - latSpan, lng],
    [lat, lng + lngSpan],
    [lat, lng - lngSpan],
    [lat + latSpan, lng + lngSpan],
    [lat + latSpan, lng - lngSpan],
    [lat - latSpan, lng + lngSpan],
    [lat - latSpan, lng - lngSpan],
  ];

  return Array.from(
    new Set(
      points.map(([la, lo]) => {
        const clampedLat = Math.max(-90, Math.min(90, la));
        const clampedLng = ((lo + 540) % 360) - 180;
        return encodeGeohash(clampedLat, clampedLng, precision);
      })
    )
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
