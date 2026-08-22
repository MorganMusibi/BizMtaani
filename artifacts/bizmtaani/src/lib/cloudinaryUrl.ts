/**
 * Applies Cloudinary's auto-format/auto-quality transform plus a
 * fixed display width, so the browser never downloads a full-res
 * original for a small card thumbnail. Non-Cloudinary URLs (or
 * empty strings) are returned unchanged.
 */
export function getThumbnailUrl(url: string, width = 500): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width},c_fill/`);
  }
  return url;
}

/**
 * Applies Cloudinary's auto-format/auto-quality transform for
 * full-size views (product detail page, photo viewer, avatar zoom)
 * without forcing a fixed crop — just format/quality optimization
 * and a sane upper-bound width so a phone camera photo (often
 * 3000px+) isn't served at full original resolution even when
 * viewed "full size." Non-Cloudinary URLs (or empty strings) are
 * returned unchanged.
 */
export function getFullSizeUrl(url: string, maxWidth = 1600): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/f_auto,q_auto,w_${maxWidth},c_limit/`);
  }
  return url;
}
