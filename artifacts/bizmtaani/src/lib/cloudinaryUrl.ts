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
