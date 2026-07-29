interface ProductImage {
  url: string;
  public_id?: string;
}

interface Product {
  id: string;
  title: string;
  price: number;
  rentPerMonth?: number;

  category: string;
  subcategory?: string;

  // Supports both old and new image formats
  imageUrl?: string;
  imageUrls?: (string | ProductImage)[];

  lat: number;
  lng: number;

  ward?: string;

  // Supports both old and new pricing fields
  priceType?: "fixed" | "negotiable";
  priceDisplay?: "fixed" | "negotiable";

  pricingBasis?: string;

  sellerId: string;
  sellerName: string;
  sellerType?: "business" | "individual";

  phone?: string;
  geohash?: string;

  createdAt?: { seconds: number } | null;
  expiresAt?: { seconds: number } | null;

  status?: string;
  plan?: string;

visibilityScope?: "local" | "county" | "all_areas";
visibilityRadiusKm?: number;

isPremium?: boolean;
verified?: boolean;
}
type Cursor = QueryDocumentSnapshot<DocumentData>;

function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function isPremiumProduct(product: Product) {
  return (
    product.plan === "premium_weekly" ||
    product.plan === "premium_monthly" ||
    product.isPremium === true
  );
}

function getProductVisibilityScope(product: Product) {
  // New adverts: use explicit visibility scope
  if (product.visibilityScope) {
    return product.visibilityScope;
  }

  // Backward compatibility for existing adverts
  if (isPremiumProduct(product)) {
    return "county";
  }

  return "local";
}

function isProductVisibleToUser(
  product: Product,
  userCoords: [number, number]
) {
  const distance = getDistanceKm(
    userCoords[0],
    userCoords[1],
    product.lat,
    product.lng
  );

  const scope = getProductVisibilityScope(product);

  // Free/local adverts
  if (scope === "local") {
    const radius = product.visibilityRadiusKm ?? 2.5;
    return distance <= radius;
  }

  // County and all-area adverts are currently eligible
  // once they have been loaded by the geographic query.
  if (scope === "county" || scope === "all_areas") {
    return true;
  }

  return false;
}

function getDistanceBucket(distanceKm: number) {
  if (distanceKm <= 2.5) return 1;
  if (distanceKm <= 5) return 2;
  if (distanceKm <= 10) return 3;
  if (distanceKm <= 20) return 4;
  if (distanceKm <= 50) return 5;

  return 6;
  }

function toProducts(docs: QueryDocumentSnapshot<DocumentData>[]): Product[] {
  const nowSec = Date.now() / 1000;

  return docs
    .map((d) => ({ id: d.id, ...d.data() } as Product))
    .filter((p) => {
      // Only active products
      if (p.status && p.status !== "active") {
        return false;
      }

      // Do not load/use expired products
      if (p.expiresAt && p.expiresAt.seconds <= nowSec) {
        return false;
      }

      return true;
    });
}

function dedupe(existing: Product[], incoming: Product[]): Product[] {
  const ids = new Set(existing.map((p) => p.id));
  return [...existing, ...incoming.filter((p) => !ids.has(p.id))];
}
function sortNearbyProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  return [...products].sort((a, b) => {
    const distanceA = getDistanceKm(
      userCoords[0],
      userCoords[1],
      a.lat,
      a.lng
    );

    const distanceB = getDistanceKm(
      userCoords[0],
      userCoords[1],
      b.lat,
      b.lng
    );

    return distanceA - distanceB;
  });
}
function rankProducts(
  products: Product[],
  userCoords: [number, number]
): Product[] {
  return products
    .map((product, index) => {
      const distanceKm = getDistanceKm(
        userCoords[0],
        userCoords[1],
        product.lat,
        product.lng
      );

      const premium = isPremiumProduct(product);

      /*
       * Premium boost
       *
       * A premium advert gets a controlled ranking advantage.
       * Distance still matters, so an extremely far-away premium
       * advert will not automatically dominate the feed.
       *
       * The higher the boost, the stronger Premium is promoted.
       */
      const PREMIUM_BOOST = 3;

      const score =
        (premium ? PREMIUM_BOOST : 0) - distanceKm;

      return {
        product,
        distanceKm,
        premium,
        score,
        originalIndex: index,
      };
    })
    .sort((a, b) => {
      // 1. Higher ranking score first.
      // Premium gets boosted, while distance still matters.
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      // 2. Premium wins exact score ties.
      if (a.premium !== b.premium) {
        return a.premium ? -1 : 1;
      }

      // 3. If still tied, nearest advert first.
      if (a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }

      // 4. Final fallback: preserve original order.
      return a.originalIndex - b.originalIndex;
    })
    .map((item) => item.product);
  }
