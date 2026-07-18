import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase"; 
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { db } from "@/lib/firebase";
import { uploadImage } from "@/lib/uploadImage";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Camera, Plus, X, Loader2, MapPin, Check, Smartphone, Shield } from "lucide-react";
import { CATEGORY_DEFS, type CategoryKey } from "@/lib/categories";
import { encodeGeohash } from "@/lib/geohash";
import { getWardInfo, type ResolvedLocation } from "@/lib/location";
import { MpesaPaymentModal } from "@/components/MpesaPaymentModal";
import {
  initiateStkPush,
  MAX_PHOTO_LIMIT,
  PLAN_AMOUNTS,
  type ListingPlan,
  type PaidListingPlan,
} from "@/lib/mpesa";
const NAIROBI = { lat: -1.286389, lng: 36.817223 };

interface MenuItem { name: string; price: number; }
interface HotelMenu { breakfast: MenuItem[]; lunch: MenuItem[]; supper: MenuItem[]; }
interface PublishAdvertResponse {
  success: boolean;
  productId: string;
}

const MEAL_PERIODS: { key: keyof HotelMenu; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "supper", label: "Supper" },
];

const PRICING_BASIS_OPTIONS = [
  { value: "per_km", label: "Per KM" },
  { value: "per_hour", label: "Per Hour" },
  { value: "per_day", label: "Per Day" },
  { value: "per_trip", label: "Per Trip / Fixed" },
  { value: "per_session", label: "Per Session" },
  { value: "quote_only", label: "Quote Only" },
];

type Step = 1 | 2 | 3 | 4 | 5;

export default function PostProduct() {
  const {
  user,
  userProfile,
  subscriptionPlan,
  hasActivePremium,
} = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);

  // Step 1 — Category
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | "">("");
  const [selectedSubcategory, setSelectedSubcategory] = useState("");
  const [customSubcategory, setCustomSubcategory] = useState("");

  // Step 2 — Details
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [rentPerMonth, setRentPerMonth] = useState("");
  type PriceDisplay =
  | "fixed"
  | "negotiable"
  | "contact"
  | "quote"
  | "free";

const [priceDisplay, setPriceDisplay] =
  useState<PriceDisplay>("fixed");
  const [pricingBasis, setPricingBasis] = useState("per_trip");
  const [phone, setPhone] = useState("");

  // Hotel menu
  const [hotelMenu, setHotelMenu] = useState<HotelMenu>({ breakfast: [], lunch: [], supper: [] });
  const [newItems, setNewItems] = useState<Record<keyof HotelMenu, { name: string; price: string }>>({
    breakfast: { name: "", price: "" },
    lunch: { name: "", price: "" },
    supper: { name: "", price: "" },
  });

  // Step 3 — Images + location
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [wardInfo, setWardInfo] = useState<ResolvedLocation | null>(null);
  const [locationName, setLocationName] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);

  // Step 4 — Plan & payment
  const [plan, setPlan] = useState<ListingPlan>("free");
  useEffect(() => {
  if (hasActivePremium) {
    setPlan(subscriptionPlan);
  }
}, [hasActivePremium, subscriptionPlan]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [publishingFree, setPublishingFree] = useState(false);

  const [showImageMenu, setShowImageMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const photoLimit = MAX_PHOTO_LIMIT[plan];

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    if (user.phoneNumber) setPhone(user.phoneNumber);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        getWardInfo(c.lat, c.lng).then((info) => {
          setWardInfo(info);
          if (info?.wardName) setLocationName(info.wardName);
        });
      },
      () => {
        // GPS denied — use saved home location from profile, or Nairobi as last resort
        if (userProfile?.homeLocation) {
          const hl = userProfile.homeLocation;
          setCoords({ lat: hl.lat, lng: hl.lng });
          setWardInfo({ wardName: hl.areaName, constituency: hl.constituency, county: hl.county, displayName: hl.areaName });
          setLocationName(hl.areaName);
        } else {
          setCoords(NAIROBI);
          getWardInfo(NAIROBI.lat, NAIROBI.lng).then(setWardInfo);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [user, userProfile]);

  // Auto-upgrade to premium if photos exceed basic limit

useEffect(() => {
  if (
    imageFiles.length > MAX_PHOTO_LIMIT.free &&
    plan === "free"
  ) {
    if (hasActivePremium) {
      setPlan(subscriptionPlan);
    } else {
      setPlan("premium_weekly");
    }
  }
}, [
  imageFiles.length,
  plan,
  hasActivePremium,
  subscriptionPlan,
]);
  // Cleanup preview URLs when component unmounts
useEffect(() => {
  return () => {
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
  };
}, [imagePreviews]);

  const catDef = selectedCategory ? CATEGORY_DEFS.find((c) => c.key === selectedCategory) : null;
  const isAccommodation = selectedCategory === "Accommodation";
  const isEatery =
    selectedSubcategory === "Hotels / Eateries" ||
    selectedSubcategory === "Restaurants & Cooked Food";
  const isTransport = selectedSubcategory === "Delivery & Transport";
  const subcategories = catDef?.subcategories ?? [];
  
  function getPriceOptions() {
  if (isAccommodation) return [];

  if (isTransport) {
    return [
      { value: "fixed", label: "Fixed Price" },
      { value: "negotiable", label: "Negotiable" },
      { value: "contact", label: "Contact for Price" },
    ];
  }

  if (selectedCategory === "Services") {
    return [
      { value: "contact", label: "Contact for Price" },
      { value: "quote", label: "Request Quote" },
    ];
  }

  return [
    { value: "fixed", label: "Fixed Price" },
    { value: "negotiable", label: "Negotiable" },
  ];
  }

  function handleImageFiles(files: FileList | null) {
  if (!files) return;
  
  // Use the new MAX_PHOTO_LIMIT constant
  const currentLimit = MAX_PHOTO_LIMIT[plan];
  const remaining = currentLimit - imageFiles.length;
  
  if (remaining <= 0) {
    if (plan === "free") {
      toast({ 
        title: "Free plan limit reached", 
        description: "Upgrade to Weekly or Monthly Premium for more photos." 
      });
    } else {
      // This covers both premium_weekly and premium_monthly
      toast({ 
        title: "Limit reached", 
        description: "You have reached the photo limit for your current plan." 
      });
    }
    return;
  }
  
  const toAdd = Array.from(files).slice(0, remaining);
  const oversized = toAdd.filter((f) => f.size > 8 * 1024 * 1024);
  
  if (oversized.length > 0) {
    toast({ 
      title: "Some images too large", 
      description: "Max 8 MB per image.", 
      variant: "destructive" 
    });
    return;
  }
  
  setImageFiles((prev) => [...prev, ...toAdd]);
  const previews = toAdd.map((f) => URL.createObjectURL(f));
  setImagePreviews((prev) => [...prev, ...previews]);
}

  function removeImage(i: number) {
    URL.revokeObjectURL(imagePreviews[i]);
    setImageFiles((prev) => prev.filter((_, idx) => idx !== i));
    setImagePreviews((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addMenuItem(period: keyof HotelMenu) {
    const item = newItems[period];
    if (!item.name.trim() || !item.price) return;
    setHotelMenu((prev) => ({
      ...prev,
      [period]: [...prev[period], { name: item.name.trim(), price: parseFloat(item.price) }],
    }));
    setNewItems((prev) => ({ ...prev, [period]: { name: "", price: "" } }));
  }

  function removeMenuItem(period: keyof HotelMenu, i: number) {
    setHotelMenu((prev) => ({
      ...prev,
      [period]: prev[period].filter((_, idx) => idx !== i),
    }));
  }

  async function searchLocation() {
    if (!locationSearch.trim()) return;
    setLocationLoading(true);
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationSearch + ", Kenya")}&limit=1`
      );
      const results = await resp.json();
      if (results && results.length > 0) {
        const { lat, lon, display_name } = results[0];
        const c = { lat: parseFloat(lat), lng: parseFloat(lon) };
        setCoords(c);
        const info = await getWardInfo(c.lat, c.lng);
        setWardInfo(info);
        setLocationName(info?.wardName ?? display_name.split(",")[0]);
        toast({ title: "Location updated" });
      } else {
        toast({ title: "Location not found", description: "Try a more specific search.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Location search failed", variant: "destructive" });
    } finally {
      setLocationLoading(false);
    }
  }

  function validateStep(): boolean {
    if (step === 1) {
      if (!selectedCategory) { toast({ title: "Select a category", variant: "destructive" }); return false; }
      if (subcategories.length > 0 && !selectedSubcategory) {
        toast({ title: "Select a subcategory", variant: "destructive" }); return false;
      }
      if (selectedSubcategory === "Other" && !customSubcategory.trim()) {
        toast({ title: "Describe what you're selling", description: "Type your product or service in the box below.", variant: "destructive" }); return false;
      }
      return true;
    }
    if (step === 2) {
  if (!title.trim()) {
    toast({
      title: "Enter a title",
      variant: "destructive",
    });
    return false;
  }

  // Accommodation must always have rent
  if (isAccommodation && !rentPerMonth) {
    toast({
      title: "Enter monthly rent",
      variant: "destructive",
    });
    return false;
  }

  // Only require a price when using Fixed or Negotiable pricing
  const requiresPrice =
    priceDisplay === "fixed" ||
    priceDisplay === "negotiable";

  if (
    requiresPrice &&
    !isAccommodation &&
    !isEatery &&
    (!price || parseFloat(price) <= 0)
  ) {
    toast({
      title: "Enter a valid price",
      description: "Or choose 'Contact for Price' or 'Request Quote'.",
      variant: "destructive",
    });
    return false;
  }

  return true;
}
    if (step === 3) {
       
      if (!coords) { toast({ title: "Location not ready", variant: "destructive" }); return false; }
      return true;
    }
    return true;
  }

  function isValidKenyanPhone(phone: string): boolean {
  const cleaned = phone.replace(/\s+/g, "").trim();

  return /^(?:\+254|254|0)(?:7\d{8}|1\d{8})$/.test(cleaned);
  }
  
  function goNext() {
  if (!validateStep()) return;

  if (step < 5) {
    setStep((prev) => (prev + 1) as Step);
  }
}
/**
 * Corrected handleInitiate
 */
async function handleInitiate(mpesaPhone: string): Promise<{ checkoutRequestId: string; productId: string }> {
  if (!user || !coords) throw new Error("Not ready");
  const cleanedPhone = mpesaPhone.replace(/\s+/g, "").trim();

if (!isValidKenyanPhone(cleanedPhone)) {
  toast({
    title: "Invalid phone number",
    description: "Enter a valid Kenyan mobile number.",
    variant: "destructive",
  });

  throw new Error("Invalid phone number");
}

  // 1. Upload images
  const uploadedImages = await Promise.all(
  imageFiles.map(file => uploadImage(file, "product"))
);

  // 2. Prepare data
  const docData: any = {
      title: title.trim(),
      description: description.trim(),
      price: isAccommodation
        ? parseFloat(rentPerMonth) || 0
        : pricingBasis === "quote_only"
          ? 0
          : parseFloat(price) || 0,

      category: selectedCategory,
      subcategory:
        selectedSubcategory === "Other"
          ? customSubcategory.trim() || "Other"
          : selectedSubcategory || selectedCategory,
  imageUrl: uploadedImages[0]?.url ?? "",
  imageUrls: uploadedImages,
  lat: coords.lat,
  lng: coords.lng,
  ward: locationName || wardInfo?.wardName || "",
  constituency: wardInfo?.constituency ?? "",
  county: wardInfo?.county ?? "",
  geohash: encodeGeohash(coords.lat, coords.lng),
  sellerId: user.uid,
  sellerName: userProfile?.displayName ?? user.displayName ?? "",
  sellerType: userProfile?.isBusinessOwner ? "business" : "individual",
  priceDisplay,
pricingBasis: isTransport ? pricingBasis : null,
  hotelMenu: isEatery ? hotelMenu : null,
  plan: plan,
  phone: cleanedPhone,
};

  // 3. Call Backend Gatekeeper
  const publishAdvert = httpsCallable(functions, "publishAdvert");
const result = await publishAdvert(docData);

const data = result.data as PublishAdvertResponse;

const productId = data.productId;

// Existing premium users should not pay again
if (hasActivePremium) {
  return {
    checkoutRequestId: "",
    productId,
  };
}

// Initiate STK Push for non-premium users
const stkResult = await initiateStkPush({
  phone: mpesaPhone,
  plan: plan as PaidListingPlan,
  productId,
});

return {
  checkoutRequestId: stkResult.checkoutRequestId,
  productId,
};
}

/**
 * Corrected handlePublishFree
 */

  async function handlePublishFree() {
  const cleanedPhone = phone.replace(/\s+/g, "").trim();

  if (!isValidKenyanPhone(cleanedPhone)) {
    toast({
      title: "Invalid phone number",
      description: "Enter a valid Kenyan mobile number.",
      variant: "destructive",
    });
    return;
  }

  if (!user || !coords) {
    toast({
      title: "Location not ready",
      description: "Please wait for your location to be detected.",
      variant: "destructive",
    });
    return;
  }

  setPublishingFree(true);

  try {
    // Upload images
    const uploadedImages = await Promise.all(
      imageFiles.map((file) => uploadImage(file, "product"))
    );

    // Prepare advert data
    const docData: any = {
      title: title.trim(),
      description: description.trim(),
      price: isAccommodation
        ? parseFloat(rentPerMonth) || 0
        : pricingBasis === "quote_only"
          ? 0
          : parseFloat(price) || 0,

      category: selectedCategory,
      subcategory:
        selectedSubcategory === "Other"
          ? customSubcategory.trim() || "Other"
          : selectedSubcategory || selectedCategory,

      imageUrl: uploadedImages[0]?.url ?? "",
      imageUrls: uploadedImages,

      lat: coords.lat,
      lng: coords.lng,
      ward: locationName || wardInfo?.wardName || "",
      constituency: wardInfo?.constituency ?? "",
      county: wardInfo?.county ?? "",
      geohash: encodeGeohash(coords.lat, coords.lng),

      sellerId: user.uid,
      sellerName:
        userProfile?.displayName ??
        user.displayName ??
        "",

      sellerType: userProfile?.isBusinessOwner
  ? "business"
  : "individual",
      priceDisplay,
     pricingBasis: isTransport ? pricingBasis : null,
      hotelMenu: isEatery ? hotelMenu : null,
      plan: "free",

      phone: cleanedPhone,
    };

    // Publish advert through Cloud Function
     const publishAdvert = httpsCallable(functions, "publishAdvert");
const result = await publishAdvert(docData);

const data = result.data as PublishAdvertResponse;

 if (data.success) {
  toast({
    title: "Advert published!",
    description: "Your advert is now live.",
  });

  navigate(`/product/${data.productId}`);
 }
    else {
      throw new Error("Publishing failed.");
    }
  } catch (error: any) {
    console.error("Publish free advert failed:", error);

    if (error.code === "failed-precondition") {
      toast({
        title: "Limit reached",
        description:
          "You have reached the maximum of 5 active free advertisements.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Failed to publish",
        description:
          error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  } finally {
    setPublishingFree(false);
  }
}
  async function handlePublishPremiumSubscriber() {
  setPublishingFree(true);

  try {
    const result = await handleInitiate(phone);

    toast({
      title: "Advert published!",
      description: "Published using your Premium subscription.",
    });

    navigate(`/product/${result.productId}`);
  } catch (error: any) {
    toast({
      title: "Failed to publish",
      description: error.message || "An unexpected error occurred.",
      variant: "destructive",
    });
  } finally {
    setPublishingFree(false);
  }
}

  const stepLabels = ["Category", "Details", "Photos", "Plan", "Review"];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="flex items-center gap-3 px-4 h-14">
          <button
            onClick={() => (step === 1 ? navigate("/") : setStep((s) => (s - 1) as Step))}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="font-black text-base flex-1">Post Advert</h1>
        </div>

        {/* Step indicators */}
        <div className="flex items-center px-4 pb-3 gap-1">
          {stepLabels.map((label, i) => {
            const n = (i + 1) as Step;
            const done = step > n;
            const active = step === n;
            return (
              <div key={label} className="flex items-center gap-1 flex-1 min-w-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black transition-all ${
                  done ? "bg-secondary text-white" : active ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <Check size={12} /> : n}
                </div>
                <span className={`text-[10px] font-semibold truncate ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                {i < 4 && <div className="flex-1 h-px bg-border min-w-[2px]" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32 space-y-5">

        {/* ========== STEP 1: Category ========== */}
        {step === 1 && (
          <>
            <h2 className="font-black text-lg">What are you selling?</h2>
            <div className="space-y-2">
              {CATEGORY_DEFS.map((cat) => {
                const isSelected = selectedCategory === cat.key;
                const subs = cat.subcategories ?? [];
                return (
                  <div key={cat.key}>
                    <button
                      onClick={() => { setSelectedCategory(cat.key); setSelectedSubcategory(""); setCustomSubcategory(""); }}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition-all text-left ${
                        isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-border/80"
                      }`}
                    >
                      <cat.icon size={22} className="flex-shrink-0 text-foreground" />
                      <div className="flex-1">
                        <p className="font-bold text-sm">{cat.displayShort}</p>
                        <p className="text-xs text-muted-foreground">{cat.tagline}</p>
                      </div>
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                          <Check size={11} className="text-white" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-border flex-shrink-0" />
                      )}
                    </button>

                    {isSelected && subs.length > 0 && (
                      <div className="mt-2 ml-3 mr-1 mb-1 bg-muted/50 rounded-2xl px-4 py-3 border border-border/60">
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2.5">Choose a subcategory</p>
                        <div className="flex flex-wrap gap-2">
                          {subs.map((sub) => (
                            <button key={sub} onClick={() => { setSelectedSubcategory(sub); setCustomSubcategory(""); }}
                              className={`px-3 py-1.5 rounded-xl border-2 text-xs font-semibold transition-all active:scale-95 ${
                                selectedSubcategory === sub
                                  ? "border-primary bg-primary text-white"
                                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
                              }`}
                            >
                              {sub}
                            </button>
                          ))}
                          {/* "Other" escape hatch for products/services not in the list */}
                          <button
                            onClick={() => { setSelectedSubcategory("Other"); setCustomSubcategory(""); }}
                            className={`px-3 py-1.5 rounded-xl border-2 text-xs font-semibold transition-all active:scale-95 ${
                              selectedSubcategory === "Other"
                                ? "border-primary bg-primary text-white"
                                : "border-border bg-card text-muted-foreground hover:border-primary/40"
                            }`}
                          >
                            Other…
                          </button>
                        </div>

                        {selectedSubcategory === "Other" && (
                          <div className="mt-3">
                            <input
                              type="text"
                              placeholder="Describe what you're selling e.g. Handmade beads, Car wash, Tailoring…"
                              value={customSubcategory}
                              onChange={(e) => setCustomSubcategory(e.target.value)}
                              maxLength={60}
                              className="w-full h-10 px-3 rounded-xl border-2 border-primary bg-background text-sm font-semibold focus:outline-none placeholder:text-muted-foreground/60 placeholder:font-normal"
                              autoFocus
                            />
                            <p className="text-[11px] text-muted-foreground mt-1">This will appear as your advert's category label.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ========== STEP 2: Details ========== */}
        {step === 2 && (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-bold">Title *</label>
              <Input
                placeholder={
                  isAccommodation ? "e.g. 1 bedroom bedsitter in Kariobangi"
                  : isEatery ? "e.g. Mama Njeri Restaurant"
                  : isTransport ? "e.g. Toyota Probox taxi — Eastleigh"
                  : "e.g. iPhone 13 Pro 256GB"
                }
                value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="h-12 text-base"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold">Description</label>
              <Textarea
                placeholder="Describe your product or service in detail..."
                value={description} onChange={(e) => setDescription(e.target.value)}
                className="min-h-[100px] text-sm" maxLength={1000}
              />
              <p className="text-xs text-right text-muted-foreground">{description.length}/1000</p>
            </div>

            {isAccommodation ? (
              <div className="space-y-1.5">
                <label className="text-sm font-bold">Monthly Rent (KES) *</label>
                <Input type="number" inputMode="numeric" placeholder="e.g. 7500"
                  value={rentPerMonth} onChange={(e) => setRentPerMonth(e.target.value)} className="h-12 text-base" />
            <div className="flex gap-2">
  {getPriceOptions().map((option) => (
    <button
      key={option.value}
      onClick={() => setPriceDisplay(option.value as PriceDisplay)}
      className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
        priceDisplay === option.value
          ? "border-primary bg-primary/5 text-primary"
          : "border-border text-muted-foreground"
      }`}
    >
      {option.label}
    </button>
  ))}
</div>
              </div>
            ) : isTransport ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">Pricing Basis</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PRICING_BASIS_OPTIONS.map(({ value, label }) => (
                      <button key={value} onClick={() => setPricingBasis(value)}
                        className={`py-2.5 px-3 rounded-xl border-2 text-xs font-semibold text-left transition-all ${
                          pricingBasis === value ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
                        }`}>{label}</button>
                    ))}
                  </div>
                </div>
                {pricingBasis !== "quote_only" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold">Price (KES)</label>
                    <Input type="number" inputMode="numeric"
                      placeholder={pricingBasis === "per_km" ? "e.g. 50 per km" : "e.g. 2000"}
                      value={price} onChange={(e) => setPrice(e.target.value)} className="h-12 text-base" />
                  </div>
                )}
              </div>
            ) : !isEatery ? (
              <div className="space-y-3">
                {(priceDisplay === "fixed" ||
  priceDisplay === "negotiable") && (
  <div className="space-y-1.5">
    <label className="text-sm font-bold">
      Price (KES)
    </label>

    <Input
      type="number"
      inputMode="numeric"
      placeholder="e.g. 1500"
      value={price}
      onChange={(e) => setPrice(e.target.value)}
      className="h-12 text-base"
    />
  </div>
)}
                <div className="flex gap-2">
                  {getPriceOptions().map((option) => (
  <button
    key={option.value}
    onClick={() => setPriceDisplay(option.value as PriceDisplay)}
    className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
      priceDisplay === option.value
        ? "border-primary bg-primary/5 text-primary"
        : "border-border text-muted-foreground"
    }`}
  >
    {option.label}
  </button>
))}
                    
                </div>
              </div>
            ) : null}

            {isEatery && (
              <div className="space-y-4">
                <p className="font-black text-base">Hotel / Restaurant Menu</p>
                {MEAL_PERIODS.map(({ key, label }) => (
                  <div key={key} className="rounded-2xl border border-border overflow-hidden">
                    <div className="bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 border-b border-border">
                      <span className="font-bold text-sm text-rose-700 dark:text-rose-400">{label}</span>
                    </div>
                    {hotelMenu[key].length > 0 && (
                      <div className="divide-y divide-border">
                        {hotelMenu[key].map((item, i) => (
                          <div key={i} className="flex items-center px-4 py-2.5 gap-2">
                            <span className="flex-1 text-sm font-medium">{item.name}</span>
                            <span className="text-sm font-bold text-primary">KES {item.price}</span>
                            <button onClick={() => removeMenuItem(key, i)} className="ml-2 text-muted-foreground hover:text-destructive">
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 p-3">
                      <Input placeholder="Dish name" value={newItems[key].name}
                        onChange={(e) => setNewItems((prev) => ({ ...prev, [key]: { ...prev[key], name: e.target.value } }))}
                        className="flex-1 h-9 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMenuItem(key); } }} />
                      <Input type="number" inputMode="numeric" placeholder="KES" value={newItems[key].price}
                        onChange={(e) => setNewItems((prev) => ({ ...prev, [key]: { ...prev[key], price: e.target.value } }))}
                        className="w-24 h-9 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMenuItem(key); } }} />
                      <button onClick={() => addMenuItem(key)}
                        className="h-9 w-9 rounded-xl bg-primary text-white flex items-center justify-center flex-shrink-0">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-bold">Contact Phone (WhatsApp)</label>
              <Input type="tel" placeholder="e.g. 0712345678"
                value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 text-base" />
            </div>
          </>
        )}

        {/* ========== STEP 3: Photos & Location ========== */}
        {step === 3 && (
          <>
            {!isEatery && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  {/* Change the label and the span to use MAX_PHOTO_LIMIT */}
<label className="text-sm font-bold">
  Photos (up to {MAX_PHOTO_LIMIT[plan]}) *
</label>
<span className="text-xs text-muted-foreground">{imageFiles.length}/{MAX_PHOTO_LIMIT[plan]}</span>
                </div>

            {plan === "free" && imageFiles.length >= MAX_PHOTO_LIMIT.free && (
  <div className="bg-muted/60 border border-border rounded-2xl px-4 py-3 flex items-start gap-3">
    <Shield size={15} className="text-muted-foreground flex-shrink-0 mt-0.5" />
    <div className="flex-1">
      <p className="text-xs font-bold text-foreground">Free plan: 1 photo max</p>
      <p className="text-xs text-muted-foreground mt-0.5">Upgrade to Weekly or Monthly Premium for unlimited photos.</p>
    </div>
  </div>
)}

                <div className="grid grid-cols-3 gap-2">
                  {imagePreviews.map((src, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                      <img src={src} alt="" className="w-full h-full object-cover" />
                      {i === 0 && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-1 font-semibold">
                          Cover
                        </div>
                      )}
                      <button onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {imageFiles.length < photoLimit && (
                    <button onClick={() => setShowImageMenu(true)}
                      className="aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      <Camera size={22} />
                      <span className="text-[10px] font-semibold">Add photo</span>
                    </button>
                  )}
                </div>

                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => handleImageFiles(e.target.files)} />
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => handleImageFiles(e.target.files)} />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-bold">Location</label>
              <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-2xl">
                <MapPin size={16} className="text-primary flex-shrink-0" />
                <div className="flex-1">
                  {wardInfo ? (
                    <p className="text-sm font-semibold">{wardInfo.wardName || "Unknown ward"}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Detecting your location...</p>
                  )}
                  {wardInfo?.constituency && (
                    <p className="text-xs text-muted-foreground">{wardInfo.constituency}, {wardInfo.county}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Input placeholder="Search a different location..."
                  value={locationSearch} onChange={(e) => setLocationSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchLocation(); } }}
                  className="flex-1 h-10 text-sm" />
                <Button type="button" variant="outline" size="sm" onClick={searchLocation}
                  disabled={locationLoading} className="h-10 px-4 flex-shrink-0">
                  {locationLoading ? <Loader2 size={14} className="animate-spin" /> : "Search"}
                </Button>
              </div>
              {locationName && locationName !== wardInfo?.wardName && (
                <p className="text-xs text-muted-foreground">Listing location: <strong>{locationName}</strong></p>
              )}
            </div>
          </>
        )}

        {/* ========== STEP 4: Choose Plan & Publish ========== */}
{step === 4 && (
  hasActivePremium ? (
    <>
      <div>
        <h2 className="font-black text-lg">Premium Subscription Active</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your advert will be published using your active premium subscription.
          No additional payment is required.
        </p>
      </div>

      <div className="rounded-2xl border-2 border-[#00A651] bg-[#00A651]/5 p-4">
        <div className="flex items-center gap-3">
          <Shield className="text-[#00A651]" size={22} />

          <div>
            <p className="font-black text-base">
              {subscriptionPlan === "premium_monthly"
                ? "Monthly Premium"
                : "Weekly Premium"}
            </p>

            <p className="text-sm text-muted-foreground">
              Your subscription is active.
            </p>
          </div>
        </div>
      </div>
    </>
  ) : (
    <>
    <div>
      <h2 className="font-black text-lg">Choose Your Plan</h2>
      <p className="text-sm text-muted-foreground mt-0.5">Free listings go live instantly. Paid plans unlock more reach.</p>
    </div>

    {/* Free plan */}
    <button onClick={() => setPlan("free")} className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${plan === "free" ? "border-primary bg-primary/5" : "border-border"}`}>
      <div className="flex justify-between items-center">
        <div>
          <span className="font-black text-base">Free</span>
          <p className="text-sm text-muted-foreground">7 days · 1 photo · 5 max active adverts</p>
        </div>
        <span className="font-black text-xl text-muted-foreground">Free</span>
      </div>
    </button>

    {/* Weekly Premium */}
    <button onClick={() => setPlan("premium_weekly")} className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${plan === "premium_weekly" ? "border-[#00A651] bg-[#00A651]/5" : "border-border"}`}>
      <div className="flex justify-between items-center">
        <div>
          <span className="font-black text-base">Weekly Premium</span>
          <p className="text-sm text-muted-foreground">7 days · Unlimited photos · Unlimited active adverts</p>
        </div>
        <span className="font-black text-2xl" style={{ color: "#00A651" }}>KES {PLAN_AMOUNTS.premium_weekly}</span>
      </div>
    </button>

    {/* Monthly Premium */}
    <button onClick={() => setPlan("premium_monthly")} className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${plan === "premium_monthly" ? "border-[#00A651] bg-[#00A651]/5" : "border-border"}`}>
      <div className="flex justify-between items-center">
        <div>
          <span className="font-black text-base">Monthly Premium</span>
          <p className="text-sm text-muted-foreground">30 days · Unlimited photos · Unlimited active adverts</p>
        </div>
        <span className="font-black text-2xl" style={{ color: "#00A651" }}>KES {PLAN_AMOUNTS.premium_monthly}</span>
      </div>
    </button>

    {/* Common features */}
    <div className="bg-muted/40 rounded-2xl px-4 py-4 space-y-2.5">
      <p className="text-xs font-black text-muted-foreground uppercase tracking-wide">Included in all plans</p>
      {[
        "Listed in your ward & nearby areas",
        "Visible to buyers searching your category",
        "Direct chat with interested buyers",
      ].map((f) => (
        <div key={f} className="flex items-center gap-2">
          <Check size={13} className="text-[#00A651] flex-shrink-0" />
          <span className="text-sm text-muted-foreground">{f}</span>
        </div>
      ))}
    </div>

    {plan !== "free" && (
      <div className="bg-card border border-border rounded-2xl px-4 py-3 flex items-start gap-3">
        <Smartphone size={18} className="text-[#00A651] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          You'll receive an M-Pesa prompt on your phone to complete payment.
          Your listing goes live <strong className="text-foreground">immediately</strong> once payment is confirmed.
        </p>
      </div>
    )}
    </>
  )
)}
        
              {/* ========== STEP 5: Review and Publish ========== */}
        {step === 5 && (
          <div className="space-y-6 py-2">
            <h2 className="font-black text-lg">Review your advert</h2>
            
            {/* Summary Card */}
            <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
              <div className="aspect-video bg-muted rounded-xl overflow-hidden">
                {imagePreviews[0] ? (
                  <img src={imagePreviews[0]} className="w-full h-full object-cover" alt="Preview" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                )}
              </div>
              
              <div>
                <h3 className="font-bold text-base">{title || "Untitled Advert"}</h3>
                <p className="text-sm text-muted-foreground mt-1">{description || "No description provided."}</p>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="text-sm font-bold text-primary">
  {isAccommodation
    ? `KES ${rentPerMonth}/mo`
    : priceDisplay === "contact"
    ? "Contact for Price"
    : priceDisplay === "quote"
    ? "Request Quote"
    : priceDisplay === "negotiable"
    ? `KES ${price} (Negotiable)`
    : `KES ${price}`}
</span>
                <span className="text-sm text-muted-foreground">{selectedCategory} / {selectedSubcategory}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Price</span>
                <span className="text-sm font-bold text-primary">
                  {isAccommodation ? `KES ${rentPerMonth}/mo` : price ? `KES ${price}` : "Negotiable"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Plan</span>
                <span className="text-sm font-bold capitalize">{plan}</span>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground px-4">
  By clicking{" "}
  {hasActivePremium
    ? "Publish Advert"
    : plan === "free"
      ? "Publish Free"
      : "Pay & Publish"}
  , you agree to our terms and conditions.
</p>
          </div>
        )}
        </div>


      {/* Bottom action */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border px-4 py-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        {step < 5 ? (
          <Button className="w-full h-12 font-black text-base rounded-2xl shadow-lg" onClick={goNext}>
            Next
          </Button>
        ) : hasActivePremium ? (
          <Button
  className="w-full h-12 font-black text-base rounded-2xl shadow-lg gap-2"
  onClick={handlePublishPremiumSubscriber}
  disabled={publishingFree}
>
  {publishingFree ? (
    <Loader2 size={18} className="animate-spin" />
  ) : (
    "Publish Advert"
  )}
</Button>
        ) : plan === "free" ? (
  <Button
    className="w-full h-12 font-black text-base rounded-2xl shadow-lg"
    onClick={handlePublishFree}
    disabled={publishingFree}
  >
    {publishingFree ? (
      <Loader2 size={18} className="animate-spin" />
    ) : (
      "Publish Free"
    )}
  </Button>
) : (
  <Button
    className="w-full h-12 font-black text-base rounded-2xl shadow-lg gap-2"
    style={{ backgroundColor: "#00A651" }}
    onClick={() => setShowPaymentModal(true)}
  >
    <Smartphone size={18} />
    Pay KES {PLAN_AMOUNTS[plan as PaidListingPlan]} & Publish
  </Button>
)}
      </div>

      {/* Image source picker sheet */}
      {showImageMenu && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowImageMenu(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl border-t border-border px-4 pt-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}>
            <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-5" />
            <p className="font-bold text-sm text-center mb-4">Add a photo</p>
            <div className="space-y-2">
              <button type="button" onClick={() => { setShowImageMenu(false); cameraRef.current?.click(); }}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-muted font-semibold text-sm">
                <Camera size={20} className="text-primary" />Take a photo
              </button>
              <button type="button" onClick={() => { setShowImageMenu(false); fileRef.current?.click(); }}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-muted font-semibold text-sm">
                <Camera size={20} className="text-primary" />Choose from gallery
              </button>
              <button type="button" onClick={() => setShowImageMenu(false)}
                className="w-full flex items-center justify-center px-4 py-3.5 rounded-2xl font-semibold text-sm text-muted-foreground">
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* M-Pesa listing payment modal */}
      <MpesaPaymentModal
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        plan={plan as PaidListingPlan}
        defaultPhone={phone}
        onInitiate={handleInitiate}
        onSuccess={(pid) => {
          toast({ title: "Listing is live!", description: "Your advert is now visible in the marketplace." });
          navigate(`/product/${pid}`);
        }}
      />
    </div>
  );
}
