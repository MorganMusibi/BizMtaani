import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { BottomNav } from "@/components/BottomNav";
import {
  ChevronLeft,
  Phone,
  MessageCircle,
  Package,
  Store,
  MapPin,
  Loader2,
} from "lucide-react";
import { getCategoryBadgeColor } from "@/lib/categories";
import {
  startProductChat,
  ChatParticipant,
} from "@/lib/chatService";

interface ProductImage {
  url: string;
  public_id?: string;
}

interface ShopProduct {
  id: string;
  title: string;
  description?: string;
  price: number;
  rentPerMonth?: number;

  category: string;
  subcategory?: string;

  plan?: string;
  isPremium?: boolean;
  verified?: boolean;

  imageUrl?: string;
  imageUrls?: (string | ProductImage)[];

  sellerId: string;
  sellerName: string;
  sellerAvatar?: string;
  phone?: string;

  ward?: string;
  county?: string;

  pricingBasis?: string;

  priceDisplay?:
    | "fixed"
    | "negotiable"
    | "contact"
    | "quote"
    | "free";

  priceType?: "fixed" | "negotiable";

  priceList?: { name: string; price: number }[];

  status?: string;

  lat?: number;
  lng?: number;

  createdAt: { seconds: number } | null;
}
 interface ShopCacheEntry {
  products: ShopProduct[];
  sellerProfile: {
    displayName?: string;
    businessName?: string;
    isBusinessOwner?: boolean;
    homeLocation?: { areaName?: string; county?: string };
  } | null;
  timestamp: number;
}
const SHOP_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes — shop catalogues change infrequently
const SHOP_CACHE_PREFIX = "bizmtaani_shop_cache_";

function readShopCache(userId: string): ShopCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(SHOP_CACHE_PREFIX + userId);
    if (!raw) return null;
    return JSON.parse(raw) as ShopCacheEntry;
  } catch {
    return null;
  }
}

function writeShopCache(userId: string, entry: ShopCacheEntry): void {
  try {
    sessionStorage.setItem(SHOP_CACHE_PREFIX + userId, JSON.stringify(entry));
  } catch {
    // sessionStorage may be full or unavailable — fail silently, cache is a performance optimization only
  }
}
function getDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}

function getThumbnailUrl(url: string): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_500,c_fill/");
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

function getProductImages(product: ShopProduct): string[] {
  if (Array.isArray(product.imageUrls)) {
    const urls = product.imageUrls
      .map((image) =>
        typeof image === "string"
          ? image
          : image?.url
      )
      .filter(
        (url): url is string =>
          typeof url === "string" &&
          url.length > 0
      );

    if (urls.length > 0) {
      return urls;
    }
  }

  if (product.imageUrl) {
    return [product.imageUrl];
  }

  return [];
}

function priceDisplay(product: ShopProduct): string {
  if (
    product.priceDisplay === "contact"
  ) {
    return "Contact for Price";
  }

  if (
    product.priceDisplay === "quote"
  ) {
    return "Request Quote";
  }

  if (
    product.priceDisplay === "free"
  ) {
    return "Free";
  }

  if (
    product.pricingBasis === "quote_only"
  ) {
    return "Quote only";
  }

  if (
    product.category ===
    "Accommodation"
  ) {
    return `KES ${(
      product.rentPerMonth ??
      product.price ??
      0
    ).toLocaleString()} / month`;
  }

  if (
    product.priceDisplay ===
    "negotiable" ||
    product.priceType ===
    "negotiable"
  ) {
    return `KES ${(
      product.price ?? 0
    ).toLocaleString()} · Negotiable`;
  }

  const basisMap: Record<
    string,
    string
  > = {
    per_km: "/km",
    per_hour: "/hr",
    per_day: "/day",
    per_session: "/session",
    per_trip: "/trip",
  };

  const suffix =
    product.pricingBasis
      ? basisMap[
          product.pricingBasis
        ] ?? ""
      : "";

  if (!product.price) {
    return "Price on request";
  }

  return `KES ${product.price.toLocaleString()}${suffix}`;
}

function getWhatsAppNumber(
  phone: string
): string {
  const digits = phone.replace(
    /\D/g,
    ""
  );

  if (digits.startsWith("254")) {
    return digits;
  }

  if (digits.startsWith("0")) {
    return `254${digits.slice(1)}`;
  }

  return digits;
}

export default function ShopCatalogue() {
  const { userId } =
    useParams<{ userId: string }>();

  const { user, userProfile } =
    useAuth();

  const { toast } =
    useToast();

  const [, navigate] =
    useLocation();

  const [
    products,
    setProducts,
  ] = useState<ShopProduct[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    chatLoading,
    setChatLoading,
  ] = useState(false);

  const [
    userCoords,
    setUserCoords,
  ] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [sellerProfile, setSellerProfile] = useState<{
    displayName?: string;
    businessName?: string;
    isBusinessOwner?: boolean;
    homeLocation?: {
      areaName?: string;
      county?: string;
    };
  } | null>(null);

  const isOwn =
    user?.uid === userId;

  /*
   * ------------------------------------------------------------
   * GET USER LOCATION
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (
      !navigator.geolocation
    ) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoords({
          lat:
            position.coords.latitude,
          lng:
            position.coords.longitude,
        });
      },
      (error) => {
        console.warn(
          "Unable to get user location for shop:",
          error
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }, []);

  /*
   * ------------------------------------------------------------
   * LOAD SELLER'S ACTIVE PRODUCTS
   * ------------------------------------------------------------
   */

useEffect(() => {
    if (!userId) {
      setProducts([]);
      setSellerProfile(null);
      setLoading(false);
      return;
    }

    const cached = readShopCache(userId);
    if (cached && Date.now() - cached.timestamp < SHOP_CACHE_TTL_MS) {
      setProducts(cached.products);
      setSellerProfile(cached.sellerProfile);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadShop() {
      try {
        setLoading(true);

        const productsQuery = query(
          collection(db, "products"),
          where("sellerId", "==", userId),
          where("status", "==", "active"),
          orderBy("createdAt", "desc"),
          limit(60)
        );

        const [snapshot, profileSnap] = await Promise.all([
          getDocs(productsQuery),
          getDoc(doc(db, "users", userId)),
        ]);

        if (cancelled) return;

        const nowSec = Date.now() / 1000;

        const loadedProducts = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as ShopProduct))
          .filter((product) => {
            if (product.expiresAt && product.expiresAt.seconds <= nowSec) {
              return false;
            }
            return true;
          });

        const loadedProfile = profileSnap.exists() ? profileSnap.data() : null;

        setProducts(loadedProducts);
        setSellerProfile(loadedProfile);

        writeShopCache(userId, {
          products: loadedProducts,
          sellerProfile: loadedProfile,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error("Failed to load shop:", error);

        if (!cancelled) {
          setProducts([]);
          setSellerProfile(null);

          toast({
            title: "Unable to load shop",
            description: "Please try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadShop();

    return () => {
      cancelled = true;
    };
  }, [userId, toast]);

  const sellerName =
    sellerProfile?.businessName ||
    sellerProfile?.displayName ||
    products[0]?.sellerName ||
    "Seller";

  const sellerAvatar =
    products[0]?.sellerAvatar ??
    "";

  const sellerWard =
    sellerProfile?.homeLocation?.areaName ||
    products[0]?.ward ||
    "";

  const sellerCounty =
    sellerProfile?.homeLocation?.county ||
    products[0]?.county ||
    "";

  const sellerPhone =
    products[0]?.phone ??
    "";
  

  const sellerLat =
    products[0]?.lat;

  const sellerLng =
    products[0]?.lng;

  const initial =
    sellerName
      .charAt(0)
      .toUpperCase();

  /*
   * ------------------------------------------------------------
   * CATEGORY GROUPS
   * ------------------------------------------------------------
   */

  const categories =
    useMemo(
      () =>
        Array.from(
          new Set(
            products.map(
              (product) =>
                product.category
            )
          )
        ),
      [products]
    );

  /*
   * ------------------------------------------------------------
   * SELLER DISTANCE
   * ------------------------------------------------------------
   */

  const sellerDistance =
    userCoords &&
    typeof sellerLat ===
      "number" &&
    typeof sellerLng ===
      "number"
      ? getDistanceKm(
          userCoords.lat,
          userCoords.lng,
          sellerLat,
          sellerLng
        )
      : null;

  /*
   * ------------------------------------------------------------
   * START SELLER CHAT
   *
   * Uses the same chatService used by ProductDetail.
   * This keeps direct seller conversations consistent
   * with product chats.
   * ------------------------------------------------------------
   */

  async function handleChat() {
    if (!user) {
      navigate("/login");
      return;
    }

    if (
      !userId ||
      user.uid === userId
    ) {
      return;
    }

    setChatLoading(true);

    try {
      const currentUser:
        ChatParticipant = {
        uid: user.uid,

        name:
          userProfile?.businessName ||
          userProfile?.displayName ||
          user.displayName ||
          user.email ||
          "User",

        photoURL:
          user.photoURL ||
          "",
      };

      const seller:
        ChatParticipant = {
        uid: userId,

        name:
          sellerName ||
          "Seller",

        photoURL:
          sellerAvatar ||
          "",
      };

      /*
       * Use the first active product as
       * the context for this seller chat.
       *
       * This gives the chat a product context
       * while still opening the seller's chat.
       */

      const contextProduct =
        products[0];

      if (!contextProduct) {
        toast({
          title:
            "No active listings",
          description:
            "This seller currently has no active listings.",
          variant:
            "destructive",
        });

        return;
      }

      const productImages =
        getProductImages(
          contextProduct
        );

      const result =
        await startProductChat({
          currentUser,

          seller,

          productId:
            contextProduct.id,

          productTitle:
            contextProduct.title,

          productImage:
            productImages[0] ||
            "",
        });

      navigate(
        `/chat/${result.chatId}`
      );
    } catch (error: unknown) {
      console.error(
        "Error opening seller chat:",
        error
      );

      toast({
        title:
          "Unable to start chat",
        description:
          error instanceof Error
            ? error.message
            : "Please try again.",
        variant:
          "destructive",
      });
    } finally {
      setChatLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * LOADING STATE
   * ------------------------------------------------------------
   */

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2
          size={28}
          className="animate-spin text-primary"
        />
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * SHOP UI
   * ------------------------------------------------------------
   */

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* --------------------------------------------------------
          HEADER
      --------------------------------------------------------- */}

      <div className="sticky top-0 z-40 bg-card border-b border-border flex items-center gap-3 px-4 h-14">
        <button
          type="button"
          onClick={() =>
            navigate(
              -1 as unknown as string
            )
          }
          className="p-1 text-muted-foreground hover:text-foreground"
          aria-label="Go back"
        >
          <ChevronLeft
            size={24}
          />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Store
            size={16}
            className="text-primary flex-shrink-0"
          />

          <span className="font-black text-base truncate">
            {isOwn
              ? "My Shop"
              : `${sellerName}'s Shop`}
          </span>
        </div>
      </div>

      {/* --------------------------------------------------------
          SELLER PROFILE HEADER
      --------------------------------------------------------- */}

      <div className="px-4 pt-5 pb-4 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center overflow-hidden flex-shrink-0 border border-border">
            {sellerAvatar ? (
              <img
                src={getAvatarThumbnailUrl(sellerAvatar)}
                alt={sellerName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl font-black text-primary">
                {initial}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="font-black text-xl leading-tight truncate">
              {isOwn
                ? "My Shop"
                : sellerName}
            </h1>

            {(sellerWard ||
              sellerCounty) && (
              <div className="flex items-center gap-1 mt-1">
                <MapPin
                  size={12}
                  className="text-muted-foreground flex-shrink-0"
                />

                <span className="text-xs text-muted-foreground truncate">
                  {sellerWard}
                  {sellerWard &&
                  sellerCounty
                    ? ", "
                    : ""}
                  {sellerCounty}
                </span>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-1">
              {products.length}{" "}
              {products.length === 1
                ? "listing"
                : "listings"}

              {categories.length >
                1 &&
                ` across ${categories.length} categories`}
            </p>

            {sellerDistance !==
              null && (
              <p className="text-xs text-muted-foreground mt-1">
                <MapPin className="inline w-3 h-3 mr-1" />

                {sellerDistance <
                1
                  ? `${(
                      sellerDistance *
                      1000
                    ).toFixed(
                      0
                    )}m away`
                  : `${sellerDistance.toFixed(
                      1
                    )} km away`}
              </p>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------
            CONTACT BUTTONS
        ------------------------------------------------------- */}

        {!isOwn && (
          <div
            className={`grid gap-2 ${
              sellerPhone
                ? "grid-cols-3"
                : "grid-cols-1"
            }`}
          >
            {sellerPhone && (
              <a
                href={`tel:${sellerPhone}`}
                className="h-10 flex items-center justify-center gap-2 rounded-xl bg-secondary text-white text-sm font-bold"
              >
                <Phone
                  size={15}
                />
                Call
              </a>
            )}

            {sellerPhone && (
              <a
                href={`https://wa.me/${getWhatsAppNumber(
                  sellerPhone
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 flex items-center justify-center gap-2 rounded-xl bg-green-600 text-white text-sm font-bold"
              >
                <MessageCircle
                  size={15}
                />
                WhatsApp
              </a>
            )}

            <button
              type="button"
              onClick={
                handleChat
              }
              disabled={
                chatLoading ||
                products.length ===
                  0
              }
              className="h-10 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
            >
              {chatLoading ? (
                <Loader2
                  size={15}
                  className="animate-spin"
                />
              ) : (
                <MessageCircle
                  size={15}
                />
              )}

              Message
            </button>
          </div>
        )}
      </div>

      <div className="h-2 bg-muted" />

      {/* --------------------------------------------------------
          EMPTY SHOP
      --------------------------------------------------------- */}

      {products.length ===
      0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 px-4">
          <div className="w-16 h-16 rounded-3xl bg-muted flex items-center justify-center">
            <Package
              size={28}
              className="text-muted-foreground"
            />
          </div>

          <p className="font-bold text-lg">
            No listings yet
          </p>

          {isOwn && (
            <Link
              href="/post"
              className="text-primary font-semibold text-sm underline underline-offset-2"
            >
              Post your first advert
            </Link>
          )}
        </div>
      ) : (
        /* ------------------------------------------------------
           PRODUCT CATALOGUE
        ------------------------------------------------------- */

        <div className="px-4 pt-4 space-y-6">
          {categories.map(
            (category) => {
              const categoryProducts =
                products.filter(
                  (product) =>
                    product.category ===
                    category
                );

              const badgeColor =
                getCategoryBadgeColor(
                  category
                );

              return (
                <section
                  key={category}
                  className="space-y-3"
                >
                  {/* Category heading */}

                  {categories.length >
                    1 && (
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeColor}`}
                      >
                        {category}
                      </span>

                      <span className="text-xs text-muted-foreground">
                        {
                          categoryProducts.length
                        }{" "}
                        {categoryProducts.length ===
                        1
                          ? "item"
                          : "items"}
                      </span>
                    </div>
                  )}

                  {/* Product grid */}

                  <div className="grid grid-cols-2 gap-3">
                    {categoryProducts.map(
                      (product) => {
                        const images =
                          getProductImages(
                            product
                          );

                        const displayImage =
                          images[0] ||
                          "";

                        const productDistance =
                          userCoords &&
                          typeof product.lat ===
                            "number" &&
                          typeof product.lng ===
                            "number"
                            ? getDistanceKm(
                                userCoords.lat,
                                userCoords.lng,
                                product.lat,
                                product.lng
                              )
                            : null;

                        return (
                          <Link
                            key={
                              product.id
                            }
                            href={`/product/${product.id}`}
                            className="bg-card rounded-2xl border border-border overflow-hidden active:scale-[0.97] transition-transform"
                          >
                            {/* Product image */}

                            <div className="relative w-full aspect-square bg-muted">
                              {displayImage ? (
                                <img
                                  src={
                                    getThumbnailUrl(displayImage)
                                  }
                                  alt={
                                    product.title
                                  }
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Package
                                    size={
                                      28
                                    }
                                    className="text-muted-foreground"
                                  />
                                </div>
                              )}

                              {/* Photo count */}

                              {images.length >
                                1 && (
                                <div className="absolute top-2 right-2 rounded-full bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] font-semibold text-white">
                                  {
                                    images.length
                                  }{" "}
                                  photos
                                </div>
                              )}

                              {/* Price overlay */}

                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6">
                                <span className="text-white text-xs font-bold line-clamp-1">
                                  {priceDisplay(
                                    product
                                  )}
                                </span>
                              </div>
                            </div>

                            {/* Product details */}

                            <div className="px-2.5 py-2.5">
                              <p className="text-sm font-semibold leading-tight line-clamp-2">
                                {
                                  product.title
                                }
                              </p>

                              {product.subcategory && (
                                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                  {
                                    product.subcategory
                                  }
                                </p>
                              )}

                              {product.priceList && product.priceList.length > 0 && (
                                <p className="text-[11px] text-primary font-semibold mt-0.5">
                                  +{product.priceList.length} other item{product.priceList.length > 1 ? "s" : ""}
                                </p>
                              )}

                              {product.ward && (
                                <div className="flex items-center gap-1 mt-2 text-[11px] text-muted-foreground">
                                  <MapPin
                                    size={
                                      11
                                    }
                                  />

                                  <span className="truncate">
                                    {
                                      product.ward
                                    }
                                  </span>
                                </div>
                              )}

                              {productDistance !==
                                null && (
                                <p className="text-[11px] text-muted-foreground mt-1">
                                  {productDistance <
                                  1
                                    ? `${(
                                        productDistance *
                                        1000
                                      ).toFixed(
                                        0
                                      )}m away`
                                    : `${productDistance.toFixed(
                                        1
                                      )} km away`}
                                </p>
                              )}
                            </div>
                          </Link>
                        );
                      }
                    )}
                  </div>
                </section>
              );
            }
          )}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
