import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { httpsCallable } from "firebase/functions";
import { functions, functionsEU } from "@/lib/firebase";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, deleteDoc, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
// CHANGE 1: added Copy icon
import { ChevronLeft, MessageCircle, MapPin, Clock, Tag, Loader2, Store, Phone, ChevronRight, Copy, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getCategoryBadgeColor } from "@/lib/categories";
import {
  startProductChat,
  ChatParticipant,
} from "@/lib/chatService";
import { isProductVisibleToUser, clearFeedCache } from "@/hooks/useHomeFeed";
import { usePageMeta, SITE_URL, type PageMeta } from "@/hooks/usePageMeta";

interface MenuItem { name: string; price: number; }
interface HotelMenu { breakfast: MenuItem[]; lunch: MenuItem[]; supper: MenuItem[]; }

// Persists across ProductDetail unmount/remount so returning to a
// product you already viewed doesn't re-fetch from Firestore.
interface ProductDetailCacheEntry {
  product: Product;
  relatedProducts: Product[];
  timestamp: number;
}
const productDetailCache = new Map<string, ProductDetailCacheEntry>();
const PRODUCT_DETAIL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHED_PRODUCTS = 30; // caps memory growth over a long browsing session

// GPS location persists indefinitely for the session — no reason to
// re-request it every time this page mounts.
let cachedUserCoords: { lat: number; lng: number } | null = null;

interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  priceRaw?: string;
  rentPerMonth?: number;
  rentPerMonthRaw?: string;
  category: string;
  subcategory?: string;
  plan?: string;
  isPremium?: boolean;
  verified?: boolean;
  visibilityScope?: "local" | "county" | "all_areas";
  visibilityRadiusKm?: number;
  expiresAt?: { seconds: number } | null;
  status?: string;
  imageUrl: string;
  imageUrls?: (string | { url: string; public_id?: string })[];
  lat: number;
  lng: number;
  sellerId: string;
  sellerName: string;
  sellerAvatar: string;
  phone?: string;
  priceDisplay?: "fixed" | "negotiable" | "contact" | "quote" | "free" | "custom";
  priceText?: string;
  ward?: string;
  areaLabel?: string;
  county?: string;
  pricingBasis?: string;
  // Marketer Program — set when the seller switched on "Open to marketers"
  affiliate?: {
    enabled: boolean;
    type: "fixed" | "percentage" | "half_month_rent" | "one_month_rent";
    amount: number;
  } | null;
  hotelMenu?: HotelMenu;
  eateryPayment?: {
    method: "mpesa" | "till" | "paybill" | "pochi" | "other" | "";
    number: string;
    accountNumber?: string;
    otherDescription?: string;
  };
  priceList?: {
    name: string;
    price: number;
    priceType?: "fixed" | "contact" | "custom";
    priceText?: string;
  }[];
  createdAt: { seconds: number } | null;
}

// Marketer status is checked once per session per user (only on adverts
// that are open to marketers), so browsing many adverts doesn't repeat
// the read.
let cachedMarketerInfo: { uid: string; info: { referralCode: string } | null } | null = null;

function describeAffiliateCommission(aff: NonNullable<Product["affiliate"]>): string {
  if (aff.type === "percentage") return `${aff.amount}% of the sale price`;
  const kes = `KES ${aff.amount.toLocaleString()}`;
  if (aff.type === "half_month_rent") return `${kes} (half a month's rent)`;
  if (aff.type === "one_month_rent") return `${kes} (one month's rent)`;
  return kes;
}

const MEAL_PERIODS: { key: keyof HotelMenu; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "supper", label: "Supper" },
];

function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isNotExpired(p: Product): boolean {
  if (!p.expiresAt) return true;
  return p.expiresAt.seconds > Date.now() / 1000;
}

function isPremiumProduct(product: Product) {
  return (
    product.plan === "premium_weekly" ||
    product.plan === "premium_monthly" ||
    product.isPremium === true
  );
}

// Local dedupe-by-id — kept separate from useHomeFeed's own dedupe()
// rather than importing it, since that one is typed against
// useHomeFeed's own Product interface and this file declares its own
// (structurally similar but independently maintained) Product type.
function dedupeById(existing: Product[], incoming: Product[]): Product[] {
  const ids = new Set(existing.map((p) => p.id));
  return [...existing, ...incoming.filter((p) => !ids.has(p.id))];
}

// ============================================================
// FIX — SAME "DON'T FETCH WHAT YOU'LL DISCARD" PATTERN AS
// useHomeFeed.ts's areaQueries() AND CategoryAds's category queries.
//
// The old version ran one nationwide query per scope level
// (subcategory, then category as a fallback) with no ward or
// visibilityScope filter at all, then threw away every result that
// isProductVisibleToUser() said the viewer shouldn't see. For a
// "show 3 related items" widget this was never the same order of
// cost as the home feed's radius fan-out, but it's the same
// unnecessary-read shape, and worth fixing the same way while we're
// touching this file — plus it's a smaller, cheaper query change
// than the home feed's, since it doesn't need pagination at all.
//
// Split into a ward-scoped free query and a visibilityScope-scoped
// premium query, same as categoryFreeQuery/categoryPremiumQuery in
// useHomeFeed.ts. currentProduct.ward is used as the scope — matching
// exactly what the old code already did by passing currentProduct.ward
// as isProductVisibleToUser's userWardName argument (i.e. "related
// items" has always meant "near this advert", not "near the viewer's
// own resolved home ward").
//
// No new Firestore composite index should be needed for these two —
// unlike categoryFreeQuery/categoryPremiumQuery, there's no orderBy
// here, and Firestore can satisfy multiple equality/`in` filters
// without a manual composite index as long as no ordering or range
// filter is involved. If Firestore does ask for one (visible as a
// console-link error), the fix is identical to the category-page
// index walkthrough — just click its link.
// ============================================================
async function fetchScopedRelated(
  fieldName: "subcategory" | "category",
  fieldValue: string,
  currentProductId: string,
  currentProductWard: string | undefined,
  fetchLimit: number
): Promise<Product[]> {
  const coll = collection(db, "products");

  const freeQueryPromise = currentProductWard
    ? getDocs(
        query(
          coll,
          where(fieldName, "==", fieldValue),
          where("status", "==", "active"),
          where("ward", "==", currentProductWard),
          limit(fetchLimit)
        )
      )
    : Promise.resolve(null);

  const premiumQueryPromise = getDocs(
    query(
      coll,
      where(fieldName, "==", fieldValue),
      where("status", "==", "active"),
      where("visibilityScope", "in", ["county", "all_areas"] as const),
      limit(fetchLimit)
    )
  );

  const [freeSnap, premiumSnap] = await Promise.all([freeQueryPromise, premiumQueryPromise]);

  const freeItems = freeSnap
    ? freeSnap.docs
        .filter((d) => d.id !== currentProductId)
        .map((d) => ({ id: d.id, ...d.data() } as Product))
    : [];

  const premiumItems = premiumSnap.docs
    .filter((d) => d.id !== currentProductId)
    .map((d) => ({ id: d.id, ...d.data() } as Product));

  return dedupeById(freeItems, premiumItems).filter(isNotExpired);
}
function getComparablePrice(p: Product): number {
  return p.rentPerMonth ?? p.price ?? 0;
}

// Price is a soft nudge, not a filter — bucketed rather than exact,
// so "relatively closer price" wins ties without excluding anything
// that's simply not premium or not subcategory-matched.
const PRICE_PROXIMITY_BUCKET = 0.5; // 50% bands: 0–50% off, 50–100% off, etc.

function rankRelatedProducts(
  products: Product[],
  currentProduct: Product,
  userCoords: { lat: number; lng: number } | null
): Product[] {
  const currentPrice = getComparablePrice(currentProduct);

  return [...products].sort((a, b) => {
    // 1. SAME SUBCATEGORY — relevance still comes first
    const aSameSubcategory = Boolean(currentProduct.subcategory && a.subcategory === currentProduct.subcategory);
    const bSameSubcategory = Boolean(currentProduct.subcategory && b.subcategory === currentProduct.subcategory);
    if (aSameSubcategory !== bSameSubcategory) return aSameSubcategory ? -1 : 1;

    // 2. PREMIUM — now ranked ahead of distance/price, per your ask
    const premiumA = isPremiumProduct(a);
    const premiumB = isPremiumProduct(b);
    if (premiumA !== premiumB) return premiumA ? -1 : 1;

    // 3. PRICE PROXIMITY (soft, bucketed) — prefers similar price
    // without requiring it; items far off in price still show,
    // just lower within the same relevance/premium tier.
    const priceA = getComparablePrice(a);
    const priceB = getComparablePrice(b);
    const diffA = currentPrice > 0 ? Math.abs(priceA - currentPrice) / currentPrice : 0;
    const diffB = currentPrice > 0 ? Math.abs(priceB - currentPrice) / currentPrice : 0;
    const bucketA = Math.floor(diffA / PRICE_PROXIMITY_BUCKET);
    const bucketB = Math.floor(diffB / PRICE_PROXIMITY_BUCKET);
    if (bucketA !== bucketB) return bucketA - bucketB;

    // 4. DISTANCE
    if (userCoords) {
      const distanceA = getDistanceKm(userCoords.lat, userCoords.lng, a.lat, a.lng);
      const distanceB = getDistanceKm(userCoords.lat, userCoords.lng, b.lat, b.lng);
      if (distanceA !== distanceB) return distanceA - distanceB;
    }

    // 5. NEWEST
    const createdA = a.createdAt?.seconds ?? 0;
    const createdB = b.createdAt?.seconds ?? 0;
    return createdB - createdA;
  });
}
function timeAgo(createdAt: { seconds: number } | null) {
  if (!createdAt) return "";

  const seconds = Math.floor(Date.now() / 1000) - createdAt.seconds;

  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30)
    return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12)
    return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function getThumbnailUrl(url: string): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_500,c_fill/");
  }
  return url;
}

function getDetailImageUrl(url: string): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_1000,c_limit/");
  }
  return url;
}

function getAvatarThumbnailUrl(url: string): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_128,h_128,c_fill/");
  }
  return url;
}
function buildProductMeta(product: Product, images: string[]): PageMeta {
  const place = product.areaLabel || product.ward || product.county || "Kenya";
  const title = `${product.title.trim().slice(0, 60)} in ${place} | BizMtaani`;

  const cleanDescription = (product.description ?? "").replace(/\s+/g, " ").trim();
  const description = cleanDescription
    ? cleanDescription.slice(0, 155)
    : `${product.subcategory ?? product.category} in ${place}. Chat with the seller directly on BizMtaani.`;

  const path = `/product/${product.id}`;
  const url = `${SITE_URL}${path}`;
  const imageUrls = images.slice(0, 5).map(getDetailImageUrl);

  // Same rule the feed uses: a missing status counts as active.
  const isLive = (!product.status || product.status === "active") && isNotExpired(product);

  const isRental = product.category === "Accommodation";
  const showsPrice =
    !product.priceDisplay ||
    product.priceDisplay === "fixed" ||
    product.priceDisplay === "negotiable";
  const amount = isRental ? (product.rentPerMonth ?? product.price) : product.price;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description,
    url,
    category: product.subcategory ?? product.category,
    ...(imageUrls.length > 0 ? { image: imageUrls } : {}),
  };

  if (isLive && showsPrice && amount > 0) {
    jsonLd.offers = {
      "@type": "Offer",
      url,
      priceCurrency: "KES",
      availability: "https://schema.org/InStock",
      ...(isRental
        ? {
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: amount,
              priceCurrency: "KES",
              unitCode: "MON",
            },
          }
        : { price: amount }),
    };
  }

  return {
    title,
    description,
    canonicalPath: path,
    image: imageUrls[0],
    noindex: !isLive,
    jsonLd: isLive ? jsonLd : null,
  };
}
function HotelMenuDisplay({ menu }: { menu: HotelMenu }) {
  const periodsWithItems = MEAL_PERIODS.filter(({ key }) => (menu[key]?.length ?? 0) > 0);
  if (periodsWithItems.length === 0) return null;
  return (
    <div className="space-y-4">
      <h2 className="font-black text-lg">Menu</h2>
      {periodsWithItems.map(({ key, label }) => (
        <div key={key} className="rounded-2xl border border-border overflow-hidden">
          <div className="bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 border-b border-border">
            <span className="font-bold text-sm text-rose-700 dark:text-rose-400">{label}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Dish</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">Price</th>
              </tr>
            </thead>
            <tbody>
              {menu[key].map((item, i) => (
                <tr key={i} className={i > 0 ? "border-t border-border" : ""}>
                  <td className="px-4 py-2.5 font-medium">{item.name}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-primary whitespace-nowrap">KES {item.price.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ImageGallery({ images }: { images: string[] }) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  if (!images || images.length === 0) {
    return (
      <div className="aspect-[4/5] sm:aspect-video w-full bg-muted flex items-center justify-center">
        <Store size={48} className="text-muted-foreground" />
      </div>
    );
  }

  const goToPrevious = () => {
    setActive((current) =>
      current === 0 ? images.length - 1 : current - 1
    );
  };

  const goToNext = () => {
    setActive((current) =>
      current === images.length - 1 ? 0 : current + 1
    );
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (
      touchStartX.current === null ||
      touchEndX.current === null
    ) {
      return;
    }

    const distance =
      touchStartX.current - touchEndX.current;

    const minimumSwipeDistance = 50;

    if (Math.abs(distance) < minimumSwipeDistance) {
      return;
    }

    if (distance > 0) {
      goToNext();
    } else {
      goToPrevious();
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  return (
    <div className="w-full">
      {/* Main Image */}
      <div
        className="relative aspect-[4/5] sm:aspect-video w-full overflow-hidden rounded-b-2xl bg-muted touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        >
      <img
          src={getDetailImageUrl(images[active])}
          alt={`Product image ${active + 1}`}
          className="w-full h-full object-cover"
          onContextMenu={(e) => e.preventDefault()}
          draggable={false}
          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
        />

        {/* Photo Counter */}
        {images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div className="rounded-full bg-black/60 backdrop-blur-sm px-3 py-1 text-xs font-semibold text-white">
              {active + 1} / {images.length}
            </div>
          </div>
        )}

        {/* Previous Button */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={goToPrevious}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        {/* Next Button */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={goToNext}
            aria-label="Next image"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      {/* Thumbnail Strip */}
      {images.length > 1 && (
        <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar bg-card border-b border-border">
          {images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              className={`flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${
                i === active
                  ? "border-primary"
                  : "border-transparent opacity-60"
              }`}
              >
            <img
                src={getThumbnailUrl(url)}
                alt={`Thumbnail ${i + 1}`}
                loading="lazy"
                className="w-full h-full object-cover"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
                style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export default function ProductDetail() {
  const [showOptions, setShowOptions] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false); // <--- ADD THIS HERE
  const [showMenu, setShowMenu] = useState(false);
  const [editingMenu, setEditingMenu] = useState(false);
  const [editableMenu, setEditableMenu] = useState<HotelMenu | null>(null);
  const [newMenuItem, setNewMenuItem] = useState<Record<keyof HotelMenu, { name: string; price: string }>>({
  breakfast: { name: "", price: "" },
  lunch: { name: "", price: "" },
  supper: { name: "", price: "" },
});
const [savingMenu, setSavingMenu] = useState(false);
const [showReportModal, setShowReportModal] = useState(false);
const [showPriceList, setShowPriceList] = useState(false);
const [reportReason, setReportReason] = useState("");
const [submittingReport, setSubmittingReport] = useState(false);
const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

function handlePressStart() {
  pressTimer.current = setTimeout(() => {
    setShowOptions(true);
  }, 600);
}

function handlePressCancel() {
  if (pressTimer.current) {
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }
}

// Logic for actions
const handleShare = async () => {
  if (!product) return;

  if (navigator.share) {
    await navigator.share({
      title: product.title,
      text: product.description,
      url: window.location.href,
    });
  }

  setShowOptions(false);
};

const handleReply = () => {
  handleChat();
  setShowOptions(false);
};

  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  // Synchronous cache read at mount time — avoids the empty-then-refill
  // spinner flash when navigating back to a product viewed within the
  // cache TTL. The effect below still runs and re-confirms this, but
  // the first paint is now already correct instead of showing a spinner.
  const initialProductCached = id ? productDetailCache.get(id) : undefined;
  const initialProductCachedFresh =
    initialProductCached && Date.now() - initialProductCached.timestamp < PRODUCT_DETAIL_CACHE_TTL_MS
      ? initialProductCached
      : undefined;

  const [product, setProduct] = useState<Product | null>(initialProductCachedFresh?.product ?? null);
  const [loading, setLoading] = useState(!initialProductCachedFresh);
  const [chatLoading, setChatLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(cachedUserCoords);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>(initialProductCachedFresh?.relatedProducts ?? []);
    useEffect(() => {
  if (cachedUserCoords) {
    // Already resolved earlier this session — skip re-requesting GPS.
    return;
  }

  if (!navigator.geolocation) {
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      // Optional: Log or handle cases where GPS accuracy is too broad (e.g., > 100 meters)
      if (position.coords.accuracy > 100) {
        console.warn(
          `GPS fix has low accuracy (${position.coords.accuracy.toFixed(0)}m radius).`
        );
      }

      const coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      cachedUserCoords = coords;
      setUserCoords(coords);
    },
    (error) => {
  if (error.code === error.PERMISSION_DENIED) {
    // Expected — user declined location access. Not an error
    // worth logging; the product's own location is used as
    // the recommendation fallback below.
  } else {
    console.warn(
      "Unable to get user location for product details:",
      error
    );
  }
  // Keep userCoords as null either way.
},
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    }
  );
}, []);

   // 1. Fetch main product and base related items when ID changes
useEffect(() => {
  if (!id) return;

  let cancelled = false;

  const cached = productDetailCache.get(id);
  if (cached && Date.now() - cached.timestamp < PRODUCT_DETAIL_CACHE_TTL_MS) {
    setProduct(cached.product);
    setRelatedProducts(cached.relatedProducts);
    setLoading(false);
    return;
  }

  (async () => {
    try {
      setLoading(true);

      const snap = await getDoc(doc(db, "products", id));

      if (!snap.exists()) {
        if (!cancelled) {
          setProduct(null);
          setRelatedProducts([]);
          setLoading(false);
        }
        return;
      }

      const currentProduct = {
        id: snap.id,
        ...snap.data(),
      } as Product;

      if (cancelled) return;

      setProduct(currentProduct);

      // Coords used both to decide premium-ad visibility (distance cap)
      // and to rank results — falls back to the advert's own location
      // when the viewer hasn't granted GPS.
      const recommendationCoords: [number, number] | null =
        userCoords
          ? [userCoords.lat, userCoords.lng]
          : typeof currentProduct.lat === "number" && typeof currentProduct.lng === "number"
          ? [currentProduct.lat, currentProduct.lng]
          : null;

      let visibleRelatedProducts: Product[] = [];

      if (currentProduct.subcategory) {
        const scoped = await fetchScopedRelated(
          "subcategory",
          currentProduct.subcategory,
          currentProduct.id,
          currentProduct.ward,
          5
        );
        visibleRelatedProducts = recommendationCoords
          ? scoped.filter((item) =>
              isProductVisibleToUser(item, recommendationCoords, currentProduct.ward)
            )
          : scoped;
      }

      // FIX: this fallback used to trigger on relatedItems.length === 0
      // — the RAW fetch count, before visibility filtering. That meant
      // if the subcategory query returned docs but every one of them
      // turned out to be invisible to this viewer (e.g. all from other
      // wards), the code never fell back to the broader category
      // search, and the section could render empty even though a
      // category-level search might have found something visible.
      // Checking the post-filter visible count instead fixes that.
      if (visibleRelatedProducts.length === 0 && currentProduct.category) {
        const scoped = await fetchScopedRelated(
          "category",
          currentProduct.category,
          currentProduct.id,
          currentProduct.ward,
          6
        );
        visibleRelatedProducts = recommendationCoords
          ? scoped.filter((item) =>
              isProductVisibleToUser(item, recommendationCoords, currentProduct.ward)
            )
          : scoped;
      }

      const rankedRelatedProducts = rankRelatedProducts(
        visibleRelatedProducts,
        currentProduct,
        recommendationCoords
      );

      if (!cancelled) {
        const finalRelated = rankedRelatedProducts.slice(0, 3);
        setRelatedProducts(finalRelated);

        productDetailCache.set(id, {
          product: currentProduct,
          relatedProducts: finalRelated,
          timestamp: Date.now(),
        });

        if (productDetailCache.size > MAX_CACHED_PRODUCTS) {
          const oldestKey = [...productDetailCache.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
          productDetailCache.delete(oldestKey);
        }
      }
    } catch (error) {
      console.error("Failed to load product or related adverts:", error);
      if (!cancelled) setRelatedProducts([]);
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [id]);
  
    const images = product 
    ? (Array.isArray(product.imageUrls) 
        ? product.imageUrls.map((img: string | { url: string; public_id?: string }) => (typeof img === 'string' ? img : img.url)) 
        : product.imageUrl ? [product.imageUrl] : [])
    : [];
  
  usePageMeta(
  product
    ? buildProductMeta(product, images)
    : !loading
    ? {
        title: "Advert not found | BizMtaani",
        description: "This advert is no longer available on BizMtaani.",
        noindex: true,
      }
    : null
);

  // ===== Marketer Program: "I have a buyer" =====
  const [marketerInfo, setMarketerInfo] = useState<{ referralCode: string } | null>(
    cachedMarketerInfo && user && cachedMarketerInfo.uid === user.uid
      ? cachedMarketerInfo.info
      : null
  );
  const [claiming, setClaiming] = useState(false);
  const [showBuyerModal, setShowBuyerModal] = useState(false);
  const [viewingTime, setViewingTime] = useState("");

  useEffect(() => {
    if (!user || !product?.affiliate?.enabled || product.sellerId === user.uid) {
      setMarketerInfo(null);
      return;
    }
    if (cachedMarketerInfo && cachedMarketerInfo.uid === user.uid) {
      setMarketerInfo(cachedMarketerInfo.info);
      return;
    }

    let cancelled = false;
    const uid = user.uid;
    getDoc(doc(db, "marketers", uid))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : null;
        const info =
          data && data.status === "active"
            ? { referralCode: String(data.referralCode ?? "") }
            : null;
        cachedMarketerInfo = { uid, info };
        if (!cancelled) setMarketerInfo(info);
      })
      .catch(() => {
        if (!cancelled) setMarketerInfo(null);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid, product?.id, product?.affiliate?.enabled]);

  async function handleHaveBuyer(viewing?: string) {
    if (!user || !product || !marketerInfo) return;
    setClaiming(true);
    try {
      const createAffiliateClaim = httpsCallable<
        { productId: string; viewingTime?: string },
        {
          success: boolean;
          claimId: string;
          sellerPhone: string | null;
          referralCode: string;
          alreadyClaimed: boolean;
        }
      >(functions, "createAffiliateClaim");

      const viewingNote = viewing?.trim() || "";
      const res = await createAffiliateClaim({
        productId: product.id,
        viewingTime: viewingNote || undefined,
      });
      const { sellerPhone, referralCode } = res.data;

      let message = `Hi, I have a buyer for your ${product.title}.`;
      if (referralCode) message += ` Ref: ${referralCode}`;
      if (viewingNote) message += ` Preferred viewing time: ${viewingNote}.`;

      setShowBuyerModal(false);
      setViewingTime("");

      if (sellerPhone) {
        toast({ title: "Claim saved", description: "Opening WhatsApp to message the seller…" });
        window.location.href = `https://wa.me/${sellerPhone}?text=${encodeURIComponent(message)}`;
      } else {
        // Seller gave no phone number — their claim is still recorded,
        // so fall back to BizMtaani chat.
        toast({ title: "Claim saved", description: "This seller has no WhatsApp number, opening chat instead." });
        handleChat();
      }
    } catch (error: any) {
      console.error("Failed to create marketer claim:", error);
      toast({
        title: "Couldn't save your claim",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setClaiming(false);
    }
  }

  // CHANGE 2: new function to copy the seller's phone number
  async function handleCopyPhone() {
    if (!product?.phone) return;
    try {
      await navigator.clipboard.writeText(product.phone);
      toast({ title: "Number copied!" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  // NOW handleChat CAN SAFELY USE "images"
  
      async function handleChat() {
  if (!user) {
    setLocation("/login");
    return;
  }

  if (!product || product.sellerId === user.uid) {
    return;
  }

  setChatLoading(true);

  try {
    const currentUser: ChatParticipant = {
      uid: user.uid,
      name:
        user.displayName ||
        user.email ||
        "User",
      photoURL:
        user.photoURL || "",
    };

    const seller: ChatParticipant = {
      uid: product.sellerId,
      name:
        product.sellerName ||
        "Seller",
      photoURL:
        product.sellerAvatar ||
        "",
    };

    const result =
      await startProductChat({
        currentUser,
        seller,

        productId:
          product.id,

        productTitle:
          product.title,

        productImage:
          images.length > 0
            ? images[0]
            : "",
      });

    setLocation(
  `/chat/${result.chatId}?ref=product`
);
  } catch (error: unknown) {
    console.error(
      "Error opening product chat:",
      error
    );

    toast({
      title: "Unable to start chat",
      description:
        error instanceof Error
          ? error.message
          : "Please try again.",
      variant: "destructive",
    });
  } finally {
    setChatLoading(false);
  }
}

  if (loading || authLoading) return (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 size={32} className="animate-spin text-primary" />
  </div>
);
  if (!product) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
      <p className="text-muted-foreground">Product not found.</p>
      <Button onClick={() => setLocation("/")}>Go back</Button>
    </div>
  );

  function startEditingMenu() {
  setEditableMenu(
    product?.hotelMenu ?? { breakfast: [], lunch: [], supper: [] }
  );
  setEditingMenu(true);
}

function removeEditableMenuItem(period: keyof HotelMenu, index: number) {
  setEditableMenu((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      [period]: prev[period].filter((_, i) => i !== index),
    };
  });
}

function addEditableMenuItem(period: keyof HotelMenu) {
  const item = newMenuItem[period];
  if (!item.name.trim() || !item.price) return;
  setEditableMenu((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      [period]: [...prev[period], { name: item.name.trim(), price: parseFloat(item.price) }],
    };
  });
  setNewMenuItem((prev) => ({ ...prev, [period]: { name: "", price: "" } }));
}

async function saveMenuChanges() {
  if (!product || !editableMenu) return;
  setSavingMenu(true);
  try {
    await updateDoc(doc(db, "products", product.id), { hotelMenu: editableMenu });
    setProduct((prev) => (prev ? { ...prev, hotelMenu: editableMenu } : prev));
    setEditingMenu(false);
    toast({ title: "Menu updated" });
  } catch (error) {
    console.error("Failed to update menu:", error);
    toast({ title: "Failed to save menu", variant: "destructive" });
  } finally {
    setSavingMenu(false);
  }
      }

  async function submitReport() {
  if (!product || !reportReason.trim()) {
    toast({ title: "Please select or describe a reason", variant: "destructive" });
    return;
  }
  setSubmittingReport(true);
  try {
    const submitProductReport = httpsCallable(functions, "submitProductReport");
    await submitProductReport({
      productId: product.id,
      productTitle: product.title,
      sellerId: product.sellerId,
      reason: reportReason.trim(),
    });
    toast({ title: "Report submitted", description: "Thank you — our team will review this advert." });
    setShowReportModal(false);
    setReportReason("");
  } catch (error: any) {
    console.error("Failed to submit report:", error);
    toast({
      title: "Failed to submit report",
      description: error?.message ?? "Please try again.",
      variant: "destructive",
    });
  } finally {
    setSubmittingReport(false);
  }
  }
  
        async function handleDeleteProduct() {
    if (!product || !user) return;

    try {
      const deleteAdvert = httpsCallable(functionsEU, "deleteAdvert");
      await deleteAdvert({ productId: product.id });

      productDetailCache.delete(product.id);
      clearFeedCache();

      toast({ 
        title: "Advert deleted", 
        description: "Your advert has been removed." 
      });
      setLocation("/");
        } catch (error: any) {
      console.error("Delete error:", error);
      toast({
        title: "Delete failed",
        description: `${error?.code ?? ""} ${error?.message ?? "Please try again."}`,
        variant: "destructive",
      });
    }
  }

  const isSeller = user?.uid === product.sellerId;
  const showMarketerButton =
    !isSeller && !!marketerInfo && product.affiliate?.enabled === true;

  const isAccommodation = product.category === "Accommodation";
  const isEatery = product.subcategory === "Hotels / Eateries" || product.subcategory === "Restaurants & Cooked Food";
  const badgeColor = getCategoryBadgeColor(product.category);
  const distance = userCoords
    ? getDistanceKm(userCoords.lat, userCoords.lng, product.lat, product.lng)
    : null;

  // Seller role label
  const roleLabel = isAccommodation ? "Landlord / Agent"
    : isEatery ? "Restaurant owner"
    : "Seller";

    return (
  /* CHANGE 3: select-none -> select-text so users can highlight and copy text */
  <div className={`min-h-screen bg-background ${showMarketerButton ? "pb-52" : "pb-36"} select-text`}>
    <header className="sticky top-0 z-40 bg-transparent px-4 h-14 flex items-center">
      <button
        data-testid="button-back"
        onClick={() => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    setLocation("/");
  }
}}
        className="p-2 rounded-full bg-card/80 backdrop-blur-sm shadow"
      >
        <ChevronLeft size={20} />
      </button>
    </header>

    {/* CHANGE 5: select-none here keeps the long-press-on-photo options menu working */}
    <div
  className="select-none"
  onTouchStart={handlePressStart}
  onTouchMove={handlePressCancel}
  onTouchEnd={handlePressCancel}
  onMouseDown={handlePressStart}
  onMouseUp={handlePressCancel}
  onMouseLeave={handlePressCancel}
>
  <ImageGallery images={images} />
</div>

      <div className="px-4 pt-4 pb-4 space-y-6">
    
  
        {/* Title + price + badge */}
<div>

  <h1
    data-testid="text-product-title"
    className="text-3xl font-bold mt-5"
  >
    {product.title}
  </h1>

  <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">

    <div className="flex items-center gap-1">
      <MapPin size={16} />
      <span>
        {product.ward
          ? `${product.areaLabel ?? product.ward}, ${product.county ?? ""}`
          : distance !== null
          ? `${distance.toFixed(1)} km away`
          : ""}
      </span>
    </div>

    <div className="flex items-center gap-1">
      <Clock size={16} />
      <span>{timeAgo(product.createdAt)}</span>
    </div>

  </div>

  <div className="mt-3 flex justify-end">
    <span
      className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${badgeColor}`}
    >
      <Tag size={12} />
      {product.subcategory ?? product.category}
    </span>
  </div>

</div>
{(!isEatery || product.eateryPayment?.method) && (
<Card className={`mt-5 p-4 ${isEatery ? "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900" : "bg-primary/5 border-primary/10"}`}>

{isEatery ? (
  <div>
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
      Payment
    </p>
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600 select-text">
      {product.eateryPayment?.method === "mpesa"
        ? `M-Pesa: ${product.eateryPayment.number}`
        : product.eateryPayment?.method === "till"
        ? `Till Number: ${product.eateryPayment.number}`
        : product.eateryPayment?.method === "pochi"
        ? `Pochi la Biashara: ${product.eateryPayment.number}`
        : product.eateryPayment?.method === "paybill"
        ? `Paybill: ${product.eateryPayment.number} (Acc: ${product.eateryPayment.accountNumber})`
        : product.eateryPayment.otherDescription || ""}
    </h2>
  </div>
) : isAccommodation ? (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600">
      KES {product.rentPerMonthRaw || (product.rentPerMonth ?? product.price).toLocaleString()} / month
    </h2>

  ) : product.priceDisplay === "contact" ? (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600">
      Contact for Price
    </h2>

  ) : product.priceDisplay === "quote" ? (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600">
      Request Quote
    </h2>

  ) : product.priceDisplay === "free" ? (
    <h2 className="text-xl sm:text-2xl font-bold text-green-600">
      Free
    </h2>

  ) : product.priceDisplay === "custom" ? (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600">
      {product.priceText || "Contact for Price"}
    </h2>

    ) : (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600">
      KES {product.priceRaw || product.price.toLocaleString()}
    </h2>
  )}

  {product.priceDisplay === "negotiable" && (
    <div className="mt-2">
      <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-700">
        Negotiable
      </span>
    </div>
  )}

</Card>
)}

        
        {product.affiliate?.enabled === true && (
          <Card className="p-4 border-[#00A651]/30 bg-[#00A651]/5">
            <div className="flex items-start gap-3">
              <Users size={18} className="text-[#00A651] flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold">Open to marketers</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Earn <strong className="text-foreground">{describeAffiliateCommission(product.affiliate)}</strong> when you bring a buyer. The commission is paid by the seller after the sale.
                </p>
                {!isSeller && !marketerInfo && (
                  <button
                    onClick={() => setLocation("/profile")}
                    className="mt-2 text-sm font-bold text-[#00A651]"
                  >
                    Want to earn like this? Become a Marketer →
                  </button>
                )}
              </div>
            </div>
          </Card>
        )}

        {product.description && (
  <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
    <div className="p-5 space-y-3">
      <h2 className="text-lg font-bold">Description</h2>

      {/* CHANGE 6: whitespace-pre-line keeps the seller's line breaks */}
      <p
        data-testid="text-product-description"
        className="leading-7 text-muted-foreground whitespace-pre-line"
      >
        {product.description}
      </p>
    </div>
  </Card>
)}

{/* Hotel/eatery menu */}
{isEatery && product.hotelMenu && (
  <Button
    variant="outline"
    className="w-full gap-2"
    onClick={() => setShowMenu(true)}
  >
    View Menu
  </Button>
)}

{/* Related items / services list */}
{Array.isArray(product.priceList) && product.priceList.length > 0 && (
  <Button
    variant="outline"
    className="w-full gap-2"
    onClick={() => setShowPriceList(true)}
  >
    View related items or services
  </Button>
)}
        {/*Title, Price, Description, Menu) ... */}

        {/* CHANGE 7: copyable phone number card, shown above the Seller card */}
        {product.phone && !isSeller && (
          <Card className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{roleLabel} phone</p>
              <p className="font-bold text-lg break-all select-text">{product.phone}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleCopyPhone}>
              <Copy className="mr-1" size={14} /> Copy
            </Button>
          </Card>
        )}
        
          <Card className="p-5 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
  <h2 className="text-lg font-bold mb-4">Seller</h2>      

  <div
    onClick={() => setLocation(`/shop/${product.sellerId}`)}
    className="flex items-center gap-4 cursor-pointer"
  >
    {product.sellerAvatar ? (
      <img
        src={getAvatarThumbnailUrl(product.sellerAvatar)}
        alt={product.sellerName}
        className="w-14 h-14 rounded-full object-cover"
      />
    ) : (
      <div className="w-14 h-14 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-xl">
        {product.sellerName[0]?.toUpperCase()}
      </div>
    )}

    <div className="flex-1">
      <h3
        data-testid="text-seller-name"
        className="font-bold text-base"
      >
        {product.sellerName}
      </h3>

      {/* CHANGE 9: the "Verified Seller" line only shows when the advert is really
          marked verified, and the made-up "4.8 rating • 24 Listings" line is removed
          because there is no real data behind it */}
      {product.verified === true && (
        <p className="text-sm text-green-600">
          ✓ Verified Seller
        </p>
      )}

      {distance !== null && (
        <p className="text-xs text-muted-foreground mt-1">
          <MapPin className="inline w-3 h-3 mr-1" />
          {distance < 1
            ? `${(distance * 1000).toFixed(0)}m away`
            : `${distance.toFixed(1)} km away`}
        </p>
      )}
    </div>

    <ChevronRight className="text-muted-foreground" />
  </div>

  <Button
    variant="outline"
    className="w-full mt-5"
    onClick={() => setLocation(`/shop/${product.sellerId}`)}
  >
    {isSeller ? "View My Shop" : "View Shop"}
  </Button>
</Card>

         {relatedProducts.length > 0 && (
  <section className="space-y-4">
    {/* Related Products Heading */}
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-xl font-black">
  {product.subcategory
    ? `More ${product.subcategory}`
    : `More ${product.category}`}
  {userCoords
    ? " Near You"
    : product.lat && product.lng
    ? " Near This Location"
    : ""}
</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Similar adverts you may be interested in
        </p>
      </div>
    </div>

    {/* Related Products Grid */}
    <div className="grid grid-cols-2 gap-3">
      {relatedProducts.map((item) => {
        const itemImages = Array.isArray(item.imageUrls)
          ? item.imageUrls
              .map((img: any) =>
                typeof img === "string"
                  ? img
                  : img?.url
              )
              .filter(Boolean)
          : item.imageUrl
          ? [item.imageUrl]
          : [];

const recommendationLocation =
  userCoords ??
  (product.lat &&
  product.lng
    ? {
        lat: product.lat,
        lng: product.lng,
      }
    : null);

const itemDistance =
  recommendationLocation &&
  typeof item.lat === "number" &&
  typeof item.lng === "number"
    ? getDistanceKm(
        recommendationLocation.lat,
        recommendationLocation.lng,
        item.lat,
        item.lng
      )
    : null;

        const itemIsAccommodation =
          item.category === "Accommodation";

        let itemPriceLabel = "";

        if (itemIsAccommodation) {
          itemPriceLabel = `KES ${(
            item.rentPerMonth ??
            item.price
          ).toLocaleString()} / month`;
        } else if (
          item.priceDisplay === "contact"
        ) {
          itemPriceLabel = "Contact for Price";
        } else if (
          item.priceDisplay === "quote"
        ) {
          itemPriceLabel = "Request Quote";
        } else if (
          item.priceDisplay === "free"
        ) {
          itemPriceLabel = "Free";
        } else if (
          item.priceDisplay === "custom"
        ) {
          itemPriceLabel = item.priceText || "Contact for Price";
        } else {
          itemPriceLabel = `KES ${item.priceRaw || item.price.toLocaleString()}`;
        }
        return (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              setLocation(
                `/product/${item.id}`
              )
            }
            className="text-left rounded-2xl border border-border overflow-hidden bg-card hover:shadow-md active:scale-[0.98] transition-all"
          >
            {/* Product Image */}
            <div className="relative aspect-square bg-muted">
              {itemImages.length > 0 ? (
                <img
                  src={getThumbnailUrl(itemImages[0])}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Store
                    className="text-muted-foreground"
                    size={32}
                  />
                </div>
              )}

              {/* Multiple Images Indicator */}
              {itemImages.length > 1 && (
                <div className="absolute bottom-2 right-2 rounded-full bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] font-semibold text-white">
                  {itemImages.length} photos
                </div>
              )}
            </div>

            {/* Product Information */}
            <div className="p-3">
              <h3 className="font-bold text-sm line-clamp-2 min-h-[40px]">
                {item.title}
              </h3>

              <p className="text-primary font-black mt-2 text-sm">
                {itemPriceLabel}
              </p>

              {/* Location */}
              {item.ward && (
                <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                  <MapPin size={12} />

                  <span className="truncate">
                    {item.areaLabel ?? item.ward}
                  </span>
                </div>
              )}

              {/* Distance */}
              {itemDistance !== null && (
  <p className="text-xs text-muted-foreground mt-1">
    <MapPin className="inline w-3 h-3 mr-1" />

    {itemDistance < 1
      ? `${(
          itemDistance * 1000
        ).toFixed(0)}m away`
      : `${itemDistance.toFixed(
          1
        )} km away`}
  </p>
)}
            </div>
          </button>
        );
      })}
    </div>
  </section>
)}
        {/* --- OPTIONS MODAL START --- */}
        {showOptions && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end animate-in fade-in duration-200">
            <div className="bg-background w-full rounded-t-3xl p-5 space-y-3 shadow-2xl">
              <h3 className="font-bold text-center mb-2">Advert Options</h3>
              <Button variant="ghost" className="w-full justify-start" onClick={handleShare}>Share Advert</Button>
              <Button variant="ghost" className="w-full justify-start" onClick={handleReply}>Reply to Advert</Button>
              {!isSeller && (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-destructive"
                  onClick={() => { setShowOptions(false); setShowReportModal(true); }}
                >
                  Report Advert
                </Button>
              )}
                            {isSeller && (
                <Button variant="destructive" className="w-full justify-start" onClick={() => { setShowOptions(false); setShowDeleteDialog(true); }}>
                  Delete Advert
                </Button>
              )}
              <Button variant="outline" className="w-full mt-2" onClick={() => setShowOptions(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {/* --- OPTIONS MODAL END --- */}

      </div> {/* This closes the main padding div (px-4...) */}
      
      {/* Bottom action bar follows here... */}

<div className="fixed bottom-16 left-0 right-0 px-4 pb-2 space-y-2">
  {showMarketerButton && (
    <Button
      type="button"
      className="w-full h-12 font-bold gap-2 shadow-lg"
      style={{ backgroundColor: "#00A651" }}
      onClick={() => (isAccommodation ? setShowBuyerModal(true) : handleHaveBuyer())}
      disabled={claiming}
    >
      {claiming ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
      I have a buyer
    </Button>
  )}
  {isSeller ? (
    <div className="space-y-2">
      <div className="text-center text-sm text-muted-foreground">
        This is your listing
      </div>

            <Button
        variant="destructive"
        className="w-full"
        onClick={() => setShowDeleteDialog(true)}
      >
        Delete Advert
      </Button>
    </div>
  ) : (
    /* CHANGE 8: if the seller gave a phone number, Call is the main button and Chat is
       secondary. With no phone number, chat stays the main button. */
    <div className="flex gap-3">
      {product.phone ? (
        <>
          <a
            href={`tel:${product.phone}`}
            className="flex-[2] h-12 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-bold shadow-lg"
          >
            <Phone size={17} />
            {isAccommodation ? "Call Landlord" : isEatery ? "Call Restaurant" : "Call Seller"}
          </a>
          <Button
            data-testid="button-chat-seller"
            variant="outline"
            className="h-12 font-bold gap-2 flex-1 bg-background"
            onClick={handleChat}
            disabled={chatLoading}
          >
            {chatLoading ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18} />}
            Chat
          </Button>
        </>
      ) : (
        <Button
          data-testid="button-chat-seller"
          className="h-12 font-bold gap-2 shadow-xl flex-1"
          onClick={handleChat}
          disabled={chatLoading}
        >
          {chatLoading ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18} />}
          {isAccommodation ? "Message Landlord" : isEatery ? "Contact Restaurant" : "Chat with Seller"}
        </Button>
      )}
    </div>
  )}
</div>

      
    {/* --- MARKETER: I HAVE A BUYER (houses: optional viewing time) --- */}
      {showBuyerModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-200">
          <div
            className="bg-background w-full rounded-t-3xl p-5 space-y-4 shadow-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
          >
            <div className="space-y-1">
              <h3 className="font-black text-lg">I have a buyer</h3>
              <p className="text-sm text-muted-foreground">
                We'll record your claim and open WhatsApp so you can message the landlord. You can add a preferred viewing time.
              </p>
            </div>

            <input
              type="text"
              placeholder="Preferred viewing time (optional), e.g. Saturday 10am"
              value={viewingTime}
              onChange={(e) => setViewingTime(e.target.value)}
              maxLength={100}
              className="w-full h-12 px-3 rounded-xl border-2 border-border bg-background text-sm"
            />

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-12 font-bold rounded-2xl border-2"
                onClick={() => setShowBuyerModal(false)}
                disabled={claiming}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1 h-12 font-bold rounded-2xl"
                style={{ backgroundColor: "#00A651" }}
                onClick={() => handleHaveBuyer(viewingTime)}
                disabled={claiming}
              >
                {claiming ? <Loader2 size={16} className="animate-spin" /> : "Open WhatsApp"}
              </Button>
            </div>
          </div>
        </div>
      )}

    {/* --- REPORT MODAL --- */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="text-center space-y-1">
              <h3 className="font-black text-lg">Report this advert</h3>
              <p className="text-sm text-muted-foreground">
                Let us know what's wrong. Our team will review it.
              </p>
            </div>

            <div className="space-y-2">
              {[
                "Scam or fraud",
                "Prohibited item",
                "Wrong category",
                "Offensive content",
                "Duplicate listing",
                "Other",
              ].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setReportReason(reason)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                    reportReason === reason
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => { setShowReportModal(false); setReportReason(""); }}
                disabled={submittingReport}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                onClick={submitReport}
                disabled={submittingReport}
              >
                {submittingReport ? <Loader2 size={16} className="animate-spin" /> : "Submit"}
              </Button>
            </div>
          </div>
        </div>
      )}
{/* --- MENU MODAL --- */}
      {showMenu && product.hotelMenu && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-200">
          <div
            className="bg-background w-full max-h-[80vh] overflow-y-auto rounded-t-3xl p-5 space-y-4 shadow-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-black text-lg">Menu</h3>
              <div className="flex items-center gap-3">
                {isSeller && !editingMenu && (
                  <button
                    onClick={startEditingMenu}
                    className="text-primary text-sm font-bold"
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setEditingMenu(false);
                  }}
                  className="text-muted-foreground hover:text-foreground text-sm font-bold"
                >
                  Close
                </button>
              </div>
            </div>

            {!editingMenu ? (
              <HotelMenuDisplay menu={product.hotelMenu} />
            ) : (
              <div className="space-y-4">
                {MEAL_PERIODS.map(({ key, label }) => (
                  <div key={key} className="rounded-2xl border border-border overflow-hidden">
                    <div className="bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 border-b border-border">
                      <span className="font-bold text-sm text-rose-700 dark:text-rose-400">{label}</span>
                    </div>

                    {editableMenu && editableMenu[key].length > 0 && (
                      <div className="divide-y divide-border">
                        {editableMenu[key].map((item, i) => (
                          <div key={i} className="flex items-center px-4 py-2.5 gap-2">
                            <span className="flex-1 text-sm font-medium">{item.name}</span>
                            <span className="text-sm font-bold text-primary">KES {item.price}</span>
                            <button
                              onClick={() => removeEditableMenuItem(key, i)}
                              className="ml-2 text-muted-foreground hover:text-destructive"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2 p-3">
                      <input
                        placeholder="Dish name"
                        value={newMenuItem[key].name}
                        onChange={(e) =>
                          setNewMenuItem((prev) => ({ ...prev, [key]: { ...prev[key], name: e.target.value } }))
                        }
                        className="flex-1 h-9 px-2 rounded-lg border border-border text-sm bg-background"
                      />
                      <input
                        type="number"
                        placeholder="KES"
                        value={newMenuItem[key].price}
                        onChange={(e) =>
                          setNewMenuItem((prev) => ({ ...prev, [key]: { ...prev[key], price: e.target.value } }))
                        }
                        className="w-20 h-9 px-2 rounded-lg border border-border text-sm bg-background"
                      />
                      <button
                        onClick={() => addEditableMenuItem(key)}
                        className="h-9 w-9 rounded-lg bg-primary text-white flex items-center justify-center flex-shrink-0 font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setEditingMenu(false)}
                    disabled={savingMenu}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={saveMenuChanges}
                    disabled={savingMenu}
                  >
                    {savingMenu ? <Loader2 size={16} className="animate-spin" /> : "Save Menu"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    {/* --- PRICE LIST MODAL --- */}
      {showPriceList && Array.isArray(product.priceList) && (
       <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-200">
         <div
           className="bg-background w-full max-h-[80vh] overflow-y-auto rounded-t-3xl p-5 space-y-4 shadow-2xl"
           style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
         >
            <div className="flex items-center justify-between">
              <h3 className="font-black text-lg">Related Items or Services</h3>
              <button
                onClick={() => setShowPriceList(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                Close
              </button>
            </div>

            <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border">
              {product.priceList.map((item, i) => (
                <div key={i} className="flex items-center px-4 py-3 gap-2">
                  <span className="flex-1 text-sm font-medium">{item.name}</span>
                  <span className="text-sm font-bold text-primary whitespace-nowrap">
                    {item.priceType === "contact"
                      ? "Contact for Price"
                      : item.priceType === "custom" && item.priceText
                      ? item.priceText
                      : `KES ${item.price.toLocaleString()}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- PROFESSIONAL DELETE CONFIRMATION MODAL --- */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <Tag size={24} />
            </div>
            
            <div className="text-center space-y-1">
              <h3 className="font-black text-lg">Delete this advert?</h3>
              <p className="text-sm text-muted-foreground">
                This action cannot be undone. Your listing and its photos will be permanently removed from BizMtaani.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-12 font-bold rounded-2xl border-2"
                onClick={() => setShowDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1 h-12 font-bold rounded-2xl shadow-lg"
                onClick={() => {
                  setShowDeleteDialog(false);
                  handleDeleteProduct();
                }}
              >
                Yes, Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
