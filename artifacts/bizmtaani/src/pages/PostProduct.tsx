import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { uploadImage } from "@/lib/uploadImage";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Camera, Plus, X, Loader2, MapPin, Check } from "lucide-react";
import { CATEGORY_DEFS, type CategoryKey } from "@/lib/categories";
import { encodeGeohash } from "@/lib/geohash";
import { getWardInfo, type ResolvedLocation } from "@/lib/location";

const NAIROBI = { lat: -1.286389, lng: 36.817223 };
const MAX_IMAGES = 6;

interface MenuItem { name: string; price: number; }
interface HotelMenu { breakfast: MenuItem[]; lunch: MenuItem[]; supper: MenuItem[]; }

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

type Step = 1 | 2 | 3;

export default function PostProduct() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);

  // Step 1 — Category
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | "">("");
  const [selectedSubcategory, setSelectedSubcategory] = useState("");

  // Step 2 — Details
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [rentPerMonth, setRentPerMonth] = useState("");
  const [priceType, setPriceType] = useState<"fixed" | "negotiable">("fixed");
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

  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [showImageMenu, setShowImageMenu] = useState(false);

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
        setCoords(NAIROBI);
        getWardInfo(NAIROBI.lat, NAIROBI.lng).then(setWardInfo);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [user]);

  const catDef = selectedCategory ? CATEGORY_DEFS.find((c) => c.key === selectedCategory) : null;
  const isAccommodation = selectedCategory === "Accommodation";
  const isEatery =
    selectedSubcategory === "Hotels / Eateries" ||
    selectedSubcategory === "Restaurants & Cooked Food";
  const isTransport = selectedCategory === "Transport";
  const subcategories = catDef?.subcategories ?? [];

  function handleImageFiles(files: FileList | null) {
    if (!files) return;
    const remaining = MAX_IMAGES - imageFiles.length;
    const toAdd = Array.from(files).slice(0, remaining);
    const oversized = toAdd.filter((f) => f.size > 8 * 1024 * 1024);
    if (oversized.length > 0) {
      toast({ title: "Some images too large", description: "Max 8 MB per image.", variant: "destructive" });
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
      return true;
    }
    if (step === 2) {
      if (!title.trim()) { toast({ title: "Enter a title", variant: "destructive" }); return false; }
      if (isAccommodation && !rentPerMonth) { toast({ title: "Enter monthly rent", variant: "destructive" }); return false; }
      return true;
    }
    if (step === 3) {
      if (!isEatery && imageFiles.length === 0) {
        toast({ title: "Add at least one photo", variant: "destructive" }); return false;
      }
      if (!coords) { toast({ title: "Location not ready", variant: "destructive" }); return false; }
      return true;
    }
    return true;
  }

  async function handleSubmit() {
    if (!validateStep()) return;
    if (!user || !coords) return;

    setSubmitting(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of imageFiles) {
        const url = await uploadImage(file, "product");
        uploadedUrls.push(url);
      }

      const geohash = encodeGeohash(coords.lat, coords.lng, 7);

      const priceVal = isAccommodation
        ? parseFloat(rentPerMonth) || 0
        : pricingBasis === "quote_only"
        ? 0
        : parseFloat(price) || 0;

      const docData: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        price: priceVal,
        category: selectedCategory,
        subcategory: selectedSubcategory || selectedCategory,
        imageUrl: uploadedUrls[0] ?? "",
        imageUrls: uploadedUrls,
        lat: coords.lat,
        lng: coords.lng,
        geohash,
        ward: wardInfo?.wardName ?? "",
        constituency: wardInfo?.constituency ?? "",
        county: wardInfo?.county ?? "",
        sellerId: user.uid,
        sellerName: user.displayName || "Seller",
        sellerAvatar: user.photoURL || "",
        phone: phone.trim(),
        priceType: pricingBasis === "quote_only" ? "fixed" : priceType,
        createdAt: serverTimestamp(),
      };

      if (isAccommodation) {
        docData.rentPerMonth = parseFloat(rentPerMonth) || 0;
      }
      if (isTransport) {
        docData.pricingBasis = pricingBasis;
      }
      if (isEatery) {
        docData.hotelMenu = hotelMenu;
      }

      await addDoc(collection(db, "products"), docData);

      toast({ title: "Advert posted!", description: "Your listing is now live." });
      navigate("/");
    } catch (err) {
      console.error(err);
      toast({ title: "Failed to post", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (validateStep()) setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }

  const stepLabels = ["Category", "Details", "Photos & Location"];

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
        <div className="flex items-center px-4 pb-3 gap-2">
          {stepLabels.map((label, i) => {
            const n = (i + 1) as Step;
            const done = step > n;
            const active = step === n;
            return (
              <div key={label} className="flex items-center gap-2 flex-1 min-w-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black transition-all ${
                  done ? "bg-secondary text-white" : active ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <Check size={12} /> : n}
                </div>
                <span className={`text-xs font-semibold truncate ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                {i < 2 && <div className="flex-1 h-px bg-border min-w-[4px]" />}
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
              {CATEGORY_DEFS.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    setSelectedCategory(cat.key);
                    setSelectedSubcategory("");
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition-all text-left ${
                    selectedCategory === cat.key
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-border/80"
                  }`}
                >
                  <span className="text-2xl">{cat.icon}</span>
                  <div className="flex-1">
                    <p className="font-bold text-sm">{cat.displayLabel}</p>
                    <p className="text-xs text-muted-foreground">{cat.description}</p>
                  </div>
                  {selectedCategory === cat.key && (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Check size={11} className="text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {catDef && subcategories.length > 0 && (
              <div className="space-y-2">
                <p className="font-bold text-sm">Subcategory</p>
                <div className="flex flex-wrap gap-2">
                  {subcategories.map((sub) => (
                    <button
                      key={sub}
                      onClick={() => setSelectedSubcategory(sub)}
                      className={`px-3 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                        selectedSubcategory === sub
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                className="h-12 text-base"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold">Description</label>
              <Textarea
                placeholder="Describe your product or service in detail..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[100px] text-sm"
                maxLength={1000}
              />
              <p className="text-xs text-right text-muted-foreground">{description.length}/1000</p>
            </div>

            {/* Pricing */}
            {isAccommodation ? (
              <div className="space-y-1.5">
                <label className="text-sm font-bold">Monthly Rent (KES) *</label>
                <Input
                  type="number" inputMode="numeric" placeholder="e.g. 7500"
                  value={rentPerMonth} onChange={(e) => setRentPerMonth(e.target.value)}
                  className="h-12 text-base"
                />
                <div className="flex gap-2 mt-2">
                  {(["fixed", "negotiable"] as const).map((t) => (
                    <button key={t} onClick={() => setPriceType(t)}
                      className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold capitalize transition-all ${
                        priceType === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
                      }`}>
                      {t}
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
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {pricingBasis !== "quote_only" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold">Price (KES)</label>
                    <Input
                      type="number" inputMode="numeric"
                      placeholder={pricingBasis === "per_km" ? "e.g. 50 per km" : "e.g. 2000"}
                      value={price} onChange={(e) => setPrice(e.target.value)}
                      className="h-12 text-base"
                    />
                  </div>
                )}
              </div>
            ) : !isEatery ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">Price (KES)</label>
                  <Input
                    type="number" inputMode="numeric" placeholder="e.g. 1500"
                    value={price} onChange={(e) => setPrice(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
                <div className="flex gap-2">
                  {(["fixed", "negotiable"] as const).map((t) => (
                    <button key={t} onClick={() => setPriceType(t)}
                      className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold capitalize transition-all ${
                        priceType === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Hotel menu */}
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
                      <Input
                        placeholder="Dish name"
                        value={newItems[key].name}
                        onChange={(e) => setNewItems((prev) => ({ ...prev, [key]: { ...prev[key], name: e.target.value } }))}
                        className="flex-1 h-9 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMenuItem(key); } }}
                      />
                      <Input
                        type="number" inputMode="numeric" placeholder="KES"
                        value={newItems[key].price}
                        onChange={(e) => setNewItems((prev) => ({ ...prev, [key]: { ...prev[key], price: e.target.value } }))}
                        className="w-24 h-9 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMenuItem(key); } }}
                      />
                      <button
                        onClick={() => addMenuItem(key)}
                        className="h-9 w-9 rounded-xl bg-primary text-white flex items-center justify-center flex-shrink-0"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Phone */}
            <div className="space-y-1.5">
              <label className="text-sm font-bold">Contact Phone (WhatsApp)</label>
              <Input
                type="tel" placeholder="e.g. 0712345678"
                value={phone} onChange={(e) => setPhone(e.target.value)}
                className="h-12 text-base"
              />
            </div>
          </>
        )}

        {/* ========== STEP 3: Photos & Location ========== */}
        {step === 3 && (
          <>
            {!isEatery && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold">
                    Photos {isAccommodation ? "(up to 6)" : "(up to 6)"}
                    {!isEatery && " *"}
                  </label>
                  <span className="text-xs text-muted-foreground">{imageFiles.length}/{MAX_IMAGES}</span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {imagePreviews.map((src, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                      <img src={src} alt="" className="w-full h-full object-cover" />
                      {i === 0 && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-1 font-semibold">
                          Cover
                        </div>
                      )}
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {imageFiles.length < MAX_IMAGES && (
                    <button
                      onClick={() => setShowImageMenu(true)}
                      className="aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                    >
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

            {/* Location */}
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
                    <p className="text-xs text-muted-foreground">
                      {wardInfo.constituency}, {wardInfo.county}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Search a different location..."
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchLocation(); } }}
                  className="flex-1 h-10 text-sm"
                />
                <Button
                  type="button" variant="outline" size="sm" onClick={searchLocation}
                  disabled={locationLoading}
                  className="h-10 px-4 flex-shrink-0"
                >
                  {locationLoading ? <Loader2 size={14} className="animate-spin" /> : "Search"}
                </Button>
              </div>
              {locationName && locationName !== wardInfo?.wardName && (
                <p className="text-xs text-muted-foreground">
                  Listing location: <strong>{locationName}</strong>
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom action */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border px-4 py-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        {step < 3 ? (
          <Button className="w-full h-12 font-black text-base rounded-2xl shadow-lg" onClick={goNext}>
            Next
          </Button>
        ) : (
          <Button
            className="w-full h-12 font-black text-base rounded-2xl shadow-lg"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <><Loader2 size={18} className="animate-spin mr-2" />Posting...</>
            ) : "Post Advert"}
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
    </div>
  );
}
