import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp, deleteDoc, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, MessageCircle, MapPin, Clock, Tag, Loader2, Store, Phone, ChevronRight } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Card } from "@/components/ui/card";
import { getCategoryBadgeColor } from "@/lib/categories";

interface MenuItem { name: string; price: number; }
interface HotelMenu { breakfast: MenuItem[]; lunch: MenuItem[]; supper: MenuItem[]; }

interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  rentPerMonth?: number;
  category: string;
  subcategory?: string;
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
  
  if (!images || images.length === 0) return (
    <div className="aspect-video w-full bg-muted flex items-center justify-center">
      <Store size={48} className="text-muted-foreground" />
    </div>
  );

  return (
    <div>
      <div className="aspect-video w-full overflow-hidden rounded-b-2xl bg-muted">
  <img
    src={images[active]}
    alt="Product"
    className="w-full h-full object-cover"
  />
</div>
      {images.length > 1 && (
        <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar bg-card border-b border-border">
          {images.map((url, i) => (
            <button key={i} onClick={() => setActive(i)}
              className={`flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${i === active ? "border-primary" : "border-transparent opacity-60"}`}>
              <img src={url} alt={`Thumbnail ${i}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


export default function ProductDetail() {
const [showOptions, setShowOptions] = useState(false);
const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

function handlePressStart() {
  pressTimer.current = setTimeout(() => {
    setShowOptions(true);
  }, 600);
}

function handlePressEnd() {
  if (pressTimer.current) clearTimeout(pressTimer.current);
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
  if (!id) return;

  (async () => {
  const snap = await getDoc(doc(db, "products", id));

  if (!snap.exists()) {
    setLoading(false);
    return;
  }

  const currentProduct = {
    id: snap.id,
    ...snap.data(),
  } as Product;

  setProduct(currentProduct);

  const relatedQuery = query(
  collection(db, "products"),
  where(
    currentProduct.subcategory ? "subcategory" : "category",
    "==",
    currentProduct.subcategory ?? currentProduct.category
  ),
  where("status", "==", "active"),
  limit(6)
);
  const relatedSnap = await getDocs(relatedQuery);

  setRelatedProducts(
    relatedSnap.docs
      .filter((doc) => doc.id !== currentProduct.id)
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as Product))
  );

  setLoading(false);
})();

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setUserCoords({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
    },
    () => {},
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}, [id]);

  // MOVE IMAGES CALCULATION UP HERE
  const images = product 
    ? (Array.isArray(product.imageUrls) 
        ? product.imageUrls.map((img: any) => (typeof img === 'string' ? img : img.url)) 
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
    // Check if this buyer already has a chat
    // with this seller for this specific product.
    const q = query(
      collection(db, "chats"),
      where("productId", "==", product.id),
      where("buyerId", "==", user.uid),
      where("sellerId", "==", product.sellerId),
      limit(1)
    );

    const existing = await getDocs(q);

    // Open existing conversation.
    if (!existing.empty) {
      setLocation(`/chat/${existing.docs[0].id}`);
      return;
    }

    // Create new product conversation.
    const chatDoc = await addDoc(collection(db, "chats"), {
      type: "product",

      productId: product.id,
      productTitle: product.title,
      productImage: images.length > 0 ? images[0] : "",

      buyerId: user.uid,
      buyerName: user.displayName || "Buyer",

      sellerId: product.sellerId,
      sellerName: product.sellerName,

      participants: [
        user.uid,
        product.sellerId,
      ],

      lastMessage: "",
      lastMessageAt: serverTimestamp(),

      createdAt: serverTimestamp(),
    });

    // Open the new conversation.
    setLocation(`/chat/${chatDoc.id}`);

  } catch (err: unknown) {
    console.error("Error opening chat:", err);

    toast({
      title: "Unable to start chat",
      description:
        err instanceof Error
          ? err.message
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
      
    async function handleDeleteProduct() {
    if (!product || !user) return;

    const confirmDelete = window.confirm("Are you sure you want to delete this advert?");
    if (!confirmDelete) return;

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
  <div className="min-h-screen bg-background pb-36">
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
  onTouchEnd={handlePressEnd}
  onMouseDown={handlePressStart}
  onMouseUp={handlePressEnd}
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

<Card className="mt-5 p-5">

  {isAccommodation ? (
    <h2 className="text-3xl font-bold text-orange-600">
      KES {(product.rentPerMonth ?? product.price).toLocaleString()} / month
    </h2>

  ) : product.priceDisplay === "contact" ? (
    <h2 className="text-3xl font-bold text-orange-600">
      Contact for Price
    </h2>

  ) : product.priceDisplay === "quote" ? (
    <h2 className="text-3xl font-bold text-orange-600">
      Request Quote
    </h2>

  ) : product.priceDisplay === "free" ? (
    <h2 className="text-3xl font-bold text-green-600">
      Free
    </h2>

  ) : (
    <h2 className="text-3xl font-bold text-orange-600">
      KES {product.price.toLocaleString()}
    </h2>
  )}

  {product.priceDisplay === "negotiable" && (
    <div className="mt-3">
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
        Negotiable
      </span>
    </div>
  )}

</Card>

        
        {product.description && (
  <Card>
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
{isEatery && product.hotelMenu && <HotelMenuDisplay menu={product.hotelMenu} />}

        {/*Title, Price, Description, Menu) ... */}

        
        <Card className="p-5">
  <h2 className="text-lg font-bold mb-4">Seller</h2>

  <div
    onClick={() => setLocation(`/shop/${product.sellerId}`)}
    className="flex items-center gap-4 cursor-pointer"
  >
    {product.sellerAvatar ? (
      <img
        src={product.sellerAvatar}
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
  <Card className="p-5">
    <h2 className="text-lg font-bold mb-4">
  More {product.subcategory ?? product.category} nearby
</h2>

    <div className="grid grid-cols-2 gap-3">
      {relatedProducts.map((item) => {
        const itemImages = Array.isArray(item.imageUrls)
          ? item.imageUrls.map((img: any) =>
              typeof img === "string" ? img : img.url
            )
          : item.imageUrl
          ? [item.imageUrl]
          : [];

        return (
          <div
            key={item.id}
            onClick={() => setLocation(`/product/${item.id}`)}
            className="cursor-pointer rounded-xl border border-border overflow-hidden bg-card hover:shadow-md transition"
          >
            <div className="aspect-square bg-muted">
              {itemImages.length > 0 ? (
                <img
                  src={itemImages[0]}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Store className="text-muted-foreground" size={32} />
                </div>
              )}
            </div>

            <div className="p-3">
              <h3 className="font-semibold text-sm line-clamp-1">
                {item.title}
              </h3>

              <p className="text-primary font-bold mt-1">
                {item.priceDisplay === "contact"
                  ? "Contact for Price"
                  : item.priceDisplay === "quote"
                  ? "Request Quote"
                  : item.priceDisplay === "free"
                  ? "Free"
                  : `KES ${item.price.toLocaleString()}`}
              </p>

              <p className="text-xs text-muted-foreground mt-1">
                {item.ward}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  </Card>
)}
        {/* --- OPTIONS MODAL START --- */}
        {showOptions && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end animate-in fade-in duration-200">
            <div className="bg-background w-full rounded-t-3xl p-5 space-y-3 shadow-2xl">
              <h3 className="font-bold text-center mb-2">Advert Options</h3>
              <Button variant="ghost" className="w-full justify-start" onClick={handleShare}>Share Advert</Button>
              <Button variant="ghost" className="w-full justify-start" onClick={handleReply}>Reply to Advert</Button>
              {isSeller && (
                <Button variant="destructive" className="w-full justify-start" onClick={() => { handleDeleteProduct(); setShowOptions(false); }}>
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
        onClick={handleDeleteProduct}
      >
        Delete Advert
      </Button>
    </div>
  ) : (
    <div className="grid grid-cols-3 gap-3">
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
        className={`h-12 font-bold gap-2 shadow-xl ${
          product.phone ? "flex-1" : "w-full"
        }`}
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
    </div>
  );
}
