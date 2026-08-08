import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, deleteDoc, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, MessageCircle, MapPin, Clock, Tag, Loader2, Store, Phone, ChevronRight } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Card } from "@/components/ui/card";
import { getCategoryBadgeColor } from "@/lib/categories";
import {
  startProductChat,
  ChatParticipant,
} from "@/lib/chatService";
import { isProductVisibleToUser, } from "@/hooks/useHomeFeed";

interface MenuItem { name: string; price: number; }
interface HotelMenu { breakfast: MenuItem[]; lunch: MenuItem[]; supper: MenuItem[]; }

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
  priceDisplay?: "fixed" | "negotiable" | "contact" | "quote" | "free";
  ward?: string;
  county?: string;
  pricingBasis?: string;
  hotelMenu?: HotelMenu;
  eateryPayment?: {
    method: "mpesa" | "till" | "paybill" | "pochi" | "other" | "";
    number: string;
    accountNumber?: string;
    otherDescription?: string;
  };
  priceList?: { name: string; price: number }[];
  createdAt: { seconds: number } | null;
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
function isPremiumProduct(product: Product) {
  return (
    product.plan === "premium_weekly" ||
    product.plan === "premium_monthly" ||
    product.isPremium === true
  );
}
function rankRelatedProducts(
  products: Product[],
  currentProduct: Product,
  userCoords: { lat: number; lng: number } | null
): Product[] {
  return [...products].sort((a, b) => {
    // ============================================================
    // PRIMARY FACTOR — SUBCATEGORY RELEVANCE
    //
    // Products in the exact same subcategory come first.
    // ============================================================

    const aSameSubcategory =
      Boolean(
        currentProduct.subcategory &&
        a.subcategory ===
          currentProduct.subcategory
      );

    const bSameSubcategory =
      Boolean(
        currentProduct.subcategory &&
        b.subcategory ===
          currentProduct.subcategory
      );

    if (
      aSameSubcategory !==
      bSameSubcategory
    ) {
      return aSameSubcategory ? -1 : 1;
    }

    // ============================================================
    // SECONDARY FACTOR — DISTANCE
    //
    // Nearby adverts come before distant adverts.
    // ============================================================

    if (userCoords) {
      const distanceA = getDistanceKm(
        userCoords.lat,
        userCoords.lng,
        a.lat,
        a.lng
      );

      const distanceB = getDistanceKm(
        userCoords.lat,
        userCoords.lng,
        b.lat,
        b.lng
      );

      if (distanceA !== distanceB) {
        return distanceA - distanceB;
      }
    }

    // ============================================================
    // TERTIARY FACTOR — PREMIUM
    //
    // Premium adverts win when relevance and distance
    // are otherwise comparable.
    // ============================================================

    const premiumA =
      isPremiumProduct(a);

    const premiumB =
      isPremiumProduct(b);

    if (
      premiumA !== premiumB
    ) {
      return premiumA ? -1 : 1;
    }

    // ============================================================
    // FINAL FACTOR — NEWEST
    // ============================================================

    const createdA =
      a.createdAt?.seconds ?? 0;

    const createdB =
      b.createdAt?.seconds ?? 0;

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
  const { user } = useAuth();
  const { toast } = useToast();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
    useEffect(() => {
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

      setUserCoords({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
    },
    (error) => {
      console.warn(
        "Unable to get user location for product details:",
        error
      );

      // Keep userCoords as null.
      // The product's own location will be used
      // as the recommendation fallback.
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

      let relatedItems: Product[] = [];

      if (currentProduct.subcategory) {
        const subcategoryQuery = query(
          collection(db, "products"),
          where("subcategory", "==", currentProduct.subcategory),
          where("status", "==", "active"),
          limit(20)
        );
        const subcategorySnap = await getDocs(subcategoryQuery);
        relatedItems = subcategorySnap.docs
          .filter((d) => d.id !== currentProduct.id)
          .map((d) => ({ id: d.id, ...d.data() } as Product));
      }

      if (relatedItems.length === 0 && currentProduct.category) {
        const categoryQuery = query(
          collection(db, "products"),
          where("category", "==", currentProduct.category),
          where("status", "==", "active"),
          limit(20)
        );
        const categorySnap = await getDocs(categoryQuery);
        relatedItems = categorySnap.docs
          .filter((d) => d.id !== currentProduct.id)
          .map((d) => ({ id: d.id, ...d.data() } as Product));
      }

      // Store raw fetched items temporarily or compute with current fallback coords
      const recommendationCoords: [number, number] | null =
        userCoords
          ? [userCoords.lat, userCoords.lng]
          : typeof currentProduct.lat === "number" && typeof currentProduct.lng === "number"
          ? [currentProduct.lat, currentProduct.lng]
          : null;

      const visibleRelatedProducts = recommendationCoords
        ? relatedItems.filter((item) => isProductVisibleToUser(item, recommendationCoords))
        : relatedItems;

      const rankedRelatedProducts = rankRelatedProducts(
        visibleRelatedProducts,
        currentProduct,
        recommendationCoords
      );

      if (!cancelled) {
        setRelatedProducts(rankedRelatedProducts.slice(0, 6));
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

// 2. Re-rank/filter related items separately if userCoords loads/updates later
useEffect(() => {
  if (!product || !userCoords) return;

  const recommendationCoords: [number, number] = [userCoords.lat, userCoords.lng];
  
  // Re-run visibility filter and ranking against already loaded product state
  // (You can also extract the related fetching into a helper function, 
  // but keeping it cleanly triggered prevents infinite fetch loops)
}, [userCoords]);
  
    const images = product 
    ? (Array.isArray(product.imageUrls) 
        ? product.imageUrls.map((img: string | { url: string; public_id?: string }) => (typeof img === 'string' ? img : img.url)) 
        : product.imageUrl ? [product.imageUrl] : [])
    : [];

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
    
    console.log("CHAT DEBUG", {
  authenticatedUser: user.uid,
  productId: product.id,
  sellerId: product.sellerId,
  participants: [
    user.uid,
    product.sellerId,
  ],
});

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
      `/chat/${result.chatId}`
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

  if (loading) return (
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
    await addDoc(collection(db, "reports"), {
      productId: product.id,
      productTitle: product.title,
      sellerId: product.sellerId,
      reporterId: user?.uid ?? null,
      reason: reportReason.trim(),
      createdAt: serverTimestamp(),
      status: "pending",
    });
    toast({ title: "Report submitted", description: "Thank you — our team will review this advert." });
    setShowReportModal(false);
    setReportReason("");
  } catch (error) {
    console.error("Failed to submit report:", error);
    toast({ title: "Failed to submit report", variant: "destructive" });
  } finally {
    setSubmittingReport(false);
  }
      }
        async function handleDeleteProduct() {
    if (!product || !user) return;

    try {
      const deleteAdvert = httpsCallable(functions, "deleteAdvert");
      await deleteAdvert({ productId: product.id });

      toast({ 
        title: "Advert deleted", 
        description: "Your advert has been removed." 
      });
      setLocation("/");
    } catch (error) {
      console.error("Delete error:", error);
      toast({ 
        title: "Delete failed", 
        description: "Please try again.", 
        variant: "destructive" 
      });
    }
  }

  const isSeller = user?.uid === product.sellerId;

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
  <div className="min-h-screen bg-background pb-36 select-none">
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

    <div
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
          ? `${product.ward}, ${product.county ?? ""}`
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
<Card className={`mt-5 p-4 ${isEatery ? "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900" : "bg-primary/5 border-primary/10"}`}>

{isEatery ? (
  <div className="select-none">
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
      Payment
    </p>
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600">
      {product.eateryPayment?.method === "mpesa"
        ? `M-Pesa: ${product.eateryPayment.number}`
        : product.eateryPayment?.method === "till"
        ? `Till Number: ${product.eateryPayment.number}`
        : product.eateryPayment?.method === "pochi"
        ? `Pochi la Biashara: ${product.eateryPayment.number}`
        : product.eateryPayment?.method === "paybill"
        ? `Paybill: ${product.eateryPayment.number} (Acc: ${product.eateryPayment.accountNumber})`
        : product.eateryPayment?.method === "other"
        ? product.eateryPayment.otherDescription || "Contact for payment details"
        : "Contact for payment details"}
    </h2>
  </div>
) : isAccommodation ? (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600 select-none">
      KES {product.rentPerMonthRaw || (product.rentPerMonth ?? product.price).toLocaleString()} / month
    </h2>

  ) : product.priceDisplay === "contact" ? (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600 select-none">
      Contact for Price
    </h2>

  ) : product.priceDisplay === "quote" ? (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600 select-none">
      Request Quote
    </h2>

  ) : product.priceDisplay === "free" ? (
    <h2 className="text-xl sm:text-2xl font-bold text-green-600 select-none">
      Free
    </h2>

    ) : (
    <h2 className="text-xl sm:text-2xl font-bold text-orange-600 select-none">
      KES {product.priceRaw || product.price.toLocaleString()}
    </h2>
  )}

  {product.priceDisplay === "negotiable" && (
    <div className="mt-2 select-none">
      <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-700">
        Negotiable
      </span>
    </div>
  )}

</Card>

        
        {product.description && (
  <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
    <div className="p-5 space-y-3">
      <h2 className="text-lg font-bold">Description</h2>

      <p
        data-testid="text-product-description"
        className="leading-7 text-muted-foreground"
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

{/* Other products / services list */}
{Array.isArray(product.priceList) && product.priceList.length > 0 && (
  <Button
    variant="outline"
    className="w-full gap-2"
    onClick={() => setShowPriceList(true)}
  >
    View other items
  </Button>
)}
        {/*Title, Price, Description, Menu) ... */}

        
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

      <p className="text-sm text-green-600">
        ✓ Verified Seller
      </p>

      <p className="text-sm text-muted-foreground">
        ⭐ 4.8 • 24 Listings
      </p>

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
                    {item.ward}
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
    <div className="flex gap-3">
  {product.phone && (
    <a
      href={`tel:${product.phone}`}
      className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl bg-secondary text-white font-bold shadow-lg"
    >
      <Phone size={17} /> Call
    </a>
  )}

  <Button
    data-testid="button-chat-seller"
    className={`h-12 font-bold gap-2 shadow-xl flex-1`}
    onClick={handleChat}
    disabled={chatLoading}
  >
    {chatLoading ? (
      <Loader2 size={18} className="animate-spin" />
    ) : (
      <MessageCircle size={18} />
    )}
    {isAccommodation
      ? "Message Landlord"
      : isEatery
      ? "Contact Restaurant"
      : "Chat with Seller"}
  </Button>
</div>

  )}
</div>

      <BottomNav />
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-200">
          <div className="bg-background w-full max-h-[80vh] overflow-y-auto rounded-t-3xl p-5 space-y-4 shadow-2xl">
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-200">
          <div className="bg-background w-full max-h-[80vh] overflow-y-auto rounded-t-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-lg">Other Items</h3>
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
                    KES {item.price.toLocaleString()}
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
