import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase"; 
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { db } from "@/lib/firebase";
import { uploadImage } from "@/lib/uploadImage";
import { useAuth } from "@/contexts/AuthContext";
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Camera, Plus, X, Loader2, MapPin, Check, Smartphone, Shield } from "lucide-react";
import { CATEGORY_DEFS, type CategoryKey } from "@/lib/categories";
import { encodeGeohash } from "@/lib/geohash";
import { resolveCanonicalLocation } from "@/lib/locationHierarchy";
import { getWardInfo, type ResolvedLocation, } from "@/lib/location";
import { MpesaPaymentModal } from "@/components/MpesaPaymentModal";
import { initiateStkPush, MAX_PHOTO_LIMIT, PLAN_AMOUNTS, type ListingPlan, type PaidListingPlan,
} from "@/lib/mpesa";
interface MenuItem { name: string; price: number; }
interface HotelMenu { breakfast: MenuItem[]; lunch: MenuItem[]; supper: MenuItem[]; }
interface PublishAdvertResponse {
  success: boolean;
  productId: string;
  status: "active" | "pending_payment";
  requiresPayment: boolean;
  plan: ListingPlan;
}
function extractPriceValue(input: string): number {
  const match = input.match(/[\d,]+(\.\d+)?/);
  return match ? parseFloat(match[0].replace(/,/g, "")) : 0;
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
  const { user, userProfile, subscriptionPlan, hasActivePremium,
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
  // Job seeker details
const [jobTitle, setJobTitle] = useState("");
const [jobSkills, setJobSkills] = useState("");
const [jobExperience, setJobExperience] = useState("");
const [jobEducation, setJobEducation] = useState("");
const [jobEmploymentType, setJobEmploymentType] = useState("");
const [jobAvailability, setJobAvailability] = useState("");

// Vehicle details
const [vehicleMake, setVehicleMake] = useState("");
const [vehicleModel, setVehicleModel] = useState("");
const [vehicleYear, setVehicleYear] = useState("");
const [vehicleCondition, setVehicleCondition] = useState("");
const [vehicleMileage, setVehicleMileage] = useState("");
const [vehicleTransmission, setVehicleTransmission] = useState("");
const [vehicleFuelType, setVehicleFuelType] = useState("");
const [vehicleBodyType, setVehicleBodyType] = useState("");
const [vehicleRegistration, setVehicleRegistration] = useState("");
// Professional service details
const [serviceType, setServiceType] = useState("");
const [serviceArea, setServiceArea] = useState("");
const [servicePricingType, setServicePricingType] = useState("");
const [priceDisplay, setPriceDisplay] =
  useState<PriceDisplay>("fixed");
  const [pricingBasis, setPricingBasis] = useState("per_trip");
  const [phone, setPhone] = useState("");
  const [eateryPaymentMethod, setEateryPaymentMethod] = useState<"mpesa" | "till" | "paybill" | "pochi" | "other" | "">("");
  const [eateryPaymentOther, setEateryPaymentOther] = useState("");
  const [eateryPaymentNumber, setEateryPaymentNumber] = useState("");
  const [eateryPaybillAccount, setEateryPaybillAccount] = useState("");

  // Hotel menu
  const [hotelMenu, setHotelMenu] = useState<HotelMenu>({ breakfast: [], lunch: [], supper: [] });
  const [newItems, setNewItems] = useState<Record<keyof HotelMenu, { name: string; price: string }>>({
    breakfast: { name: "", price: "" },
    lunch: { name: "", price: "" },
    supper: { name: "", price: "" },
  });
  // Other products / services list (shown on Product Detail as "View List")
  const [priceListItems, setPriceListItems] = useState<{ name: string; price: string }[]>([]);
  const [newPriceListItem, setNewPriceListItem] = useState({ name: "", price: "" });

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
  const [limitModalMessage, setLimitModalMessage] = useState<string | null>(null);
  const [showImageMenu, setShowImageMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoLimit = MAX_PHOTO_LIMIT[plan];
// Property / rental
const [bedrooms, setBedrooms] = useState("");
const [bathrooms, setBathrooms] = useState("");
const [furnishing, setFurnishing] = useState("");
const [landSize, setLandSize] = useState("");
const [stayDetails, setStayDetails] = useState("");
const [spaceDetails, setSpaceDetails] = useState("");
const [sharedHousingDetails, setSharedHousingDetails] = useState("");

// Sale / hire
const [transactionType, setTransactionType] = useState<"sale" | "hire">("sale");
const [hireRate, setHireRate] = useState("");
const [hireRateBasis, setHireRateBasis] = useState("");

// Equipment
const [equipmentType, setEquipmentType] = useState("");
const [equipmentCondition, setEquipmentCondition] = useState("");

// Furniture
const [furnitureType, setFurnitureType] = useState("");
const [furnitureMaterial, setFurnitureMaterial] = useState("");
const [furnitureCondition, setFurnitureCondition] = useState("");

// Commercial property
const [commercialPropertyType, setCommercialPropertyType] = useState("");

// Events
const [eventType, setEventType] = useState("");
const [eventDate, setEventDate] = useState("");
const [eventStartTime, setEventStartTime] = useState("");
const [eventEndTime, setEventEndTime] = useState("");
const [eventVenue, setEventVenue] = useState("");
const [eventOrganizer, setEventOrganizer] = useState("");
const [ticketPrice, setTicketPrice] = useState("");

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    if (user.phoneNumber) setPhone(user.phoneNumber);

    // Show profile's saved area immediately so the field isn't blank
    // while we wait for GPS to resolve (GPS will override this if it succeeds).
    if (userProfile?.homeLocation) {
      const hl = userProfile.homeLocation;
      setCoords({ lat: hl.lat, lng: hl.lng });
      setWardInfo({ wardName: hl.areaName, constituency: hl.constituency, county: hl.county, displayName: hl.areaName });
      setLocationName(hl.areaName);
    }

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
        // GPS denied/failed. If we already have a profile home location, keep it.
        // Otherwise, don't guess a location — let the user set it manually via search.
        if (!userProfile?.homeLocation) {
          toast({
            title: "Set your location",
            description: "We couldn't detect your location. Please search for your area below.",
          });
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

  const catDef = selectedCategory
  ? CATEGORY_DEFS.find((c) => c.key === selectedCategory)
  : null;

// ============================================================
// CATEGORY CLASSIFICATION
// Keep all category/subcategory behavior centralized here.
// CATEGORY_DEFS in categories.ts remains the source of truth
// ============================================================

const isAccommodation =
  selectedCategory === "Accommodation";
const isAccommodationSale =
  selectedCategory === "Accommodation" &&
  (
    selectedSubcategory === "Houses for Sale" ||
    selectedSubcategory === "Apartments for Sale" ||
    selectedSubcategory === "Residential Land for Sale"
  );

const isAccommodationLand =
  selectedCategory === "Accommodation" &&
  (
    selectedSubcategory === "Residential Land for Sale" ||
    selectedSubcategory === "Residential Land for Rent"
  );
const isVehicle =
  selectedCategory === "Vehicles";

const isCommercialProperty =
  selectedCategory === "Commercial Property";

const isEquipment =
  selectedCategory === "Commercial Equipment & Tools";

const isFurniture =
  selectedCategory === "Home, Furniture & Appliances";

const isEvent =
  selectedCategory === "Entertainment & Events";

const isLeisure =
  selectedCategory === "Leisure & Activities";

const isFashion =
  selectedCategory === "Fashion & Clothing";

const isElectronics =
  selectedCategory === "Electronics & Tech";

const isGeneralProduct =
  selectedCategory === "General Products";

const isSecondHand =
  selectedCategory === "Second-Hand / Used Items";

const isBabiesAndKids =
  selectedCategory === "Babies & Kids";

const isAnimalsAndPets =
  selectedCategory === "Animals & Pets";

const isOtherCategory =
  selectedCategory === "Other & Miscellaneous";


// ============================================================
// ACCOMMODATION / RESIDENTIAL PROPERTY CLASSIFICATION
// ============================================================

const RESIDENTIAL_RENTAL_SUBCATEGORIES = [
  "Single Rooms",
  "Bedsitters",
  "Studios",
  "1 Bedroom Apartments",
  "2 Bedroom Apartments",
  "3 Bedroom Apartments",
  "4+ Bedroom Apartments",
  "1 Bedroom Houses",
  "2 Bedroom Houses",
  "3 Bedroom Houses",
  "4+ Bedroom Houses",
  "Houses to Rent",
  "Apartments to Rent",
  "Hostels & Student Housing",
  "Serviced Apartments",
  "Furnished Apartments",
  "Maisonettes",
  "Bungalows",
  "Townhouses",
  "Gated Community Homes",
];

const RESIDENTIAL_PROPERTY_SALE_SUBCATEGORIES = [
  "Houses for Sale",
  "Apartments for Sale",
  "Residential Land for Sale",
];

const RESIDENTIAL_LAND_RENT_SUBCATEGORIES = [
  "Residential Land for Rent",
];

const SHORT_STAY_SUBCATEGORIES = [
  "Airbnb / Short Stays",
  "Lodges / Guest Houses",
  "Vacation Rentals",
];

const SHARED_HOUSING_SUBCATEGORIES = [
  "Roommates / Shared Housing",
];

const PARKING_SUBCATEGORIES = [
  "Parking Spaces",
  "Garages",
];

const isResidentialRental =
  isAccommodation &&
  RESIDENTIAL_RENTAL_SUBCATEGORIES.includes(
    selectedSubcategory
  );

const isPropertySale =
  isAccommodation &&
  RESIDENTIAL_PROPERTY_SALE_SUBCATEGORIES.includes(
    selectedSubcategory
  );

const isResidentialLandForRent =
  isAccommodation &&
  RESIDENTIAL_LAND_RENT_SUBCATEGORIES.includes(
    selectedSubcategory
  );

const isShortStay =
  isAccommodation &&
  SHORT_STAY_SUBCATEGORIES.includes(
    selectedSubcategory
  );

const isSharedHousing =
  isAccommodation &&
  SHARED_HOUSING_SUBCATEGORIES.includes(
    selectedSubcategory
  );

const isParking =
  isAccommodation &&
  PARKING_SUBCATEGORIES.includes(
    selectedSubcategory
  );
// ============================================================
// COMMERCIAL PROPERTY CLASSIFICATION
// ============================================================

const COMMERCIAL_LAND_SUBCATEGORIES = [
  "Commercial Land for Sale",
  "Commercial Land for Rent",
  "Industrial Land",
];

const COMMERCIAL_SALE_SUBCATEGORIES = [
  "Shops for Sale",
  "Offices for Sale",
  "Commercial Buildings for Sale",
];

const isCommercialPropertyLand =
  isCommercialProperty &&
  COMMERCIAL_LAND_SUBCATEGORIES.includes(selectedSubcategory);

const isCommercialPropertySale =
  isCommercialProperty &&
  !isCommercialPropertyLand &&
  COMMERCIAL_SALE_SUBCATEGORIES.includes(selectedSubcategory);

// ============================================================
// FOOD / EATERY CLASSIFICATION
// ============================================================

const EATERY_SUBCATEGORIES = [
  "Restaurants & Cooked Food",
  "Hotels / Eateries",
  "Catering Services",
];

const isEatery =
  selectedCategory === "Food & Groceries" &&
  EATERY_SUBCATEGORIES.includes(
    selectedSubcategory
  );


// ============================================================
// TRANSPORT / DELIVERY CLASSIFICATION
// ============================================================

const TRANSPORT_SUBCATEGORIES = [
  "Delivery Services",
  "Courier Services",
  "Transport Services",
  "Moving Services",
];

const isTransport =
  selectedCategory === "Services" &&
  TRANSPORT_SUBCATEGORIES.includes(
    selectedSubcategory
  );

const isTransportService =
  selectedCategory === "Services" &&
  selectedSubcategory === "Transport Services";


// ============================================================
// JOB SEEKING
// ============================================================

const isJobSeeking =
  selectedCategory === "Services" &&
  selectedSubcategory === "Job Seeking & CVs";


// ============================================================
// PROFESSIONAL / SERVICE PROVIDER CLASSIFICATION
// ============================================================

const PROFESSIONAL_SERVICE_SUBCATEGORIES = [
  // Professional
  "Accounting & Bookkeeping",
  "Legal Services",
  "Consulting",
  "Marketing & Advertising",
  "Real Estate Services",
  "Insurance Services",

  // Personal
  "Beauty & Personal Care",
  "Photography",
  "Videography",
  "Tutoring & Education",
  "Fitness Training",

  // Business & digital
  "Business & Digital Services",
  "Web & App Development",
  "Graphic Design",
  "Social Media Services",
  "Printing Services",

  // Jobs / freelance
  "Freelance Services",
];

const isProfessionalService =
  selectedCategory === "Services" &&
  PROFESSIONAL_SERVICE_SUBCATEGORIES.includes(
    selectedSubcategory
  );


// ============================================================
// NORMAL ADVERT CATEGORIES
// These categories currently use the generic product/ad form.
// They will be expanded with specialized forms in later steps.
// ============================================================

const isNormalAdvertCategory =
  isFashion ||
  isElectronics ||
  isGeneralProduct ||
  isSecondHand ||
  isBabiesAndKids ||
  isAnimalsAndPets ||
  isLeisure ||
  isOtherCategory;


// ============================================================
// SUBCATEGORY LIST FOR SELECTED CATEGORY
// ============================================================

const subcategories =
  catDef?.subcategories ?? [];
  
  function getPriceOptions() {
  if (isJobSeeking) {
    return [];
  }

  if (isTransport) {
    return [
      { value: "fixed", label: "Fixed Price" },
      { value: "negotiable", label: "Negotiable" },
      { value: "contact", label: "Contact for Price" },
    ];
  }

  if (isProfessionalService) {
    return [
      { value: "fixed", label: "Fixed Price" },
      { value: "negotiable", label: "Negotiable" },
      { value: "contact", label: "Contact for Price" },
      { value: "quote", label: "Request Quote" },
    ];
  }

  if (selectedCategory === "Services") {
    return [
      { value: "fixed", label: "Fixed Price" },
      { value: "negotiable", label: "Negotiable" },
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
  const oversized = toAdd.filter((f) => f.size > 4 * 1024 * 1024);
  
  if (oversized.length > 0) {
    toast({ 
      title: "Some images too large", 
      description: "Max 4 MB per image.", 
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
  function addPriceListItem() {
    if (!newPriceListItem.name.trim() || !newPriceListItem.price) return;
    setPriceListItems((prev) => [
      ...prev,
      { name: newPriceListItem.name.trim(), price: newPriceListItem.price },
    ]);
    setNewPriceListItem({ name: "", price: "" });
  }

  function removePriceListItem(i: number) {
    setPriceListItems((prev) => prev.filter((_, idx) => idx !== i));
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
    async function validateStep(): Promise<boolean> {
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
      // Job seeker validation
      if (isJobSeeking) {
        if (!jobTitle.trim()) {
          toast({
            title: "Enter the job title",
            description: "Tell employers what position you are looking for.",
            variant: "destructive",
          });
          return false;
        }

        if (!title.trim()) {
          setTitle(jobTitle.trim());
        }

        return true;
      }
      
      // Vehicle validation
      if (isVehicle) {
        if (!title.trim()) {
          toast({
            title: "Enter an advert title",
            variant: "destructive",
          });
          return false;
        }

        if (!vehicleMake.trim() || !vehicleModel.trim()) {
          toast({
            title: "Enter vehicle details",
            description: "Make and model are required.",
            variant: "destructive",
          });
          return false;
        }

        if (!price || parseFloat(price) <= 0) {
          toast({
            title: "Enter a valid vehicle price",
            variant: "destructive",
          });
          return false;
        }

        return true;
      }
      
      // Professional service validation
      if (isProfessionalService) {
        if (!title.trim()) {
          toast({
            title: "Enter a service title",
            variant: "destructive",
          });
          return false;
        }

        if (!servicePricingType) {
          toast({
            title: "Choose a pricing method",
            variant: "destructive",
          });
          return false;
        }

        if (
          servicePricingType !== "quote_only" &&
          (!price || parseFloat(price) <= 0)
        ) {
          toast({
            title: "Enter a valid service price",
            variant: "destructive",
          });
          return false;
        }

        return true;
      }
      
      // Normal advert validation
      if (!title.trim()) {
        toast({
          title: "Enter a title",
          variant: "destructive",
        });
        return false;
      }
      
      // Accommodation must always have rent (except Sale/Land, which use price instead)
if (isAccommodation && !isAccommodationSale && !isAccommodationLand && !rentPerMonth) {
  toast({
    title: "Enter monthly rent",
    variant: "destructive",
  });
  return false;
}
      // Commercial Property must always have rent (except Sale/Land, which use price instead)
if (isCommercialProperty && !isCommercialPropertySale && !isCommercialPropertyLand && !rentPerMonth) {
  toast({
    title: "Enter monthly rent",
    variant: "destructive",
  });
  return false;
}
      
      // Transport uses pricingBasis, not priceDisplay — validate separately
if (isTransport) {
  if (
    pricingBasis !== "quote_only" &&
    (!price || parseFloat(price) <= 0)
  ) {
    toast({
      title: "Enter a valid price",
      description: "Or choose 'Quote Only' as the pricing basis.",
      variant: "destructive",
    });
    return false;
  }
  return true;
}

const requiresPrice =
  !isAccommodation &&
  !isCommercialProperty &&
  !isEatery &&
  (priceDisplay === "fixed" ||
    priceDisplay === "negotiable");

if (
  requiresPrice &&
  (!price || parseFloat(price) <= 0)
) {
  toast({
    title: "Enter a valid price",
    description:
      "Or choose 'Contact for Price' or 'Request Quote'.",
    variant: "destructive",
  });
  return false;
}

return true;
    }

    if (step === 3) {
      return true;
    }
return true;
  }
function isValidKenyanPhone(phone: string): boolean {
  const cleaned = phone.replace(/\s+/g, "").trim();

  return /^(?:\+254|254|0)(?:7\d{8}|1\d{8})$/.test(cleaned);
  }
   async function validateAdvertLocation(): Promise<boolean> {
  const ward = wardInfo?.wardName?.trim() || locationName.trim();
  const constituency = wardInfo?.constituency?.trim() || "";
  const county = wardInfo?.county?.trim() || "";

  // No ward info at all — nothing to correct, just proceed.
  if (!ward) return true;

  try {
    const canonical = await resolveCanonicalLocation(ward, constituency, county);

    if (canonical) {
      // Found a match (exact or ward-only) — correct spelling/constituency/county
      setWardInfo((prev) => ({
        ...(prev ?? { displayName: canonical.wardName }),
        wardName: canonical.wardName,
        constituency: canonical.constituencyName,
        county: canonical.countyName,
      }));
      setLocationName(canonical.wardName);
    }
    // No match found anywhere in the hierarchy — keep the GPS/geocoded
    // guess as-is and let the user post anyway.
  } catch {
    // Hierarchy failed to load or lookup errored — never block posting over this.
  }

  return true;
}
  
  async function goNext() {
      // Accommodation validation
  if (step === 2 && isAccommodation) {
    if (!title.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a title for your accommodation advert.",
        variant: "destructive",
      });
      return;
    }

    if (isAccommodationLand) {
      if (!landSize.trim()) {
        toast({
          title: "Land size required",
          description: "Please enter the size of the land.",
          variant: "destructive",
        });
        return;
      }

      if (!price || parseFloat(price) <= 0) {
        toast({
          title: "Price required",
          description: "Please enter a valid price for the land.",
          variant: "destructive",
        });
        return;
      }
    } else if (isAccommodationSale) {
      if (!price || parseFloat(price) <= 0) {
        toast({
          title: "Sale price required",
          description: "Please enter a valid sale price.",
          variant: "destructive",
        });
        return;
      }
        } else if (
  selectedSubcategory === "Airbnb / Short Stays" ||
  selectedSubcategory === "Vacation Rentals" ||
  selectedSubcategory === "Lodges / Guest Houses" ||
  selectedSubcategory === "Serviced Apartments"
) {
  if (!rentPerMonth || parseFloat(rentPerMonth) <= 0) {
    toast({
      title: "Rate required",
      description: "Please enter a valid rate for this short-stay accommodation.",
      variant: "destructive",
    });
    return;
  }
} else if (
  selectedSubcategory === "Parking Spaces" ||
  selectedSubcategory === "Garages"
) {
  if (!rentPerMonth || parseFloat(rentPerMonth) <= 0) {
    toast({
      title: "Fee required",
      description: "Please enter a valid fee for this listing.",
      variant: "destructive",
    });
    return;
  }
} else {
      if (!rentPerMonth || parseFloat(rentPerMonth) <= 0) {
        toast({
          title: "Monthly rent required",
          description: "Please enter a valid monthly rent.",
          variant: "destructive",
        });
        return;
      }
    }
  }
    // Commercial Property validation
  if (step === 2 && isCommercialProperty) {
    if (!title.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a title for your commercial property advert.",
        variant: "destructive",
      });
      return;
    }

    if (isCommercialPropertyLand) {
      if (!landSize.trim()) {
        toast({
          title: "Land size required",
          description: "Please enter the size of the land.",
          variant: "destructive",
        });
        return;
      }
      if (!price || parseFloat(price) <= 0) {
        toast({
          title: "Price required",
          description: "Please enter a valid price for the land.",
          variant: "destructive",
        });
        return;
      }
    } else if (isCommercialPropertySale) {
      if (!price || parseFloat(price) <= 0) {
        toast({
          title: "Sale price required",
          description: "Please enter a valid sale price.",
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!rentPerMonth || parseFloat(rentPerMonth) <= 0) {
        toast({
          title: "Monthly rent required",
          description: "Please enter a valid monthly rent.",
          variant: "destructive",
        });
        return;
      }
    }
  }
  if (!(await validateStep())) return;

  if (!(await validateStep())) return;

  if (step === 3) {
    await validateAdvertLocation();
  }

  if (step < 5) {
    setStep((prev) => (prev + 1) as Step);
  }
}
/**
 * Corrected handleInitiate
 */
async function handleInitiate(
  mpesaPhone: string
): Promise<{
  checkoutRequestId: string;
  productId: string;
}> {
  if (!user) {
    throw new Error("Not ready");
  }

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
    imageFiles.map((file) => uploadImage(file, "product"))
  );

  // 2. Prepare advert data
  const docData = {
    title: title.trim(),
    description: description.trim(),

    price:
  isAccommodation && !isAccommodationSale && !isAccommodationLand
    ? extractPriceValue(rentPerMonth)
    : isCommercialProperty && !isCommercialPropertySale && !isCommercialPropertyLand
      ? extractPriceValue(rentPerMonth)
      : isProfessionalService && servicePricingType === "quote_only"
        ? 0
        : isTransport && pricingBasis === "quote_only"
          ? 0
          : extractPriceValue(price),

    priceRaw: price.trim(),
    rentPerMonthRaw: rentPerMonth.trim(),

    category: selectedCategory,

    subcategory:
      selectedSubcategory === "Other"
        ? customSubcategory.trim() || "Other"
        : selectedSubcategory || selectedCategory,

    imageUrl: uploadedImages[0]?.url ?? "",
    imageUrls: uploadedImages,

    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,

    ward: wardInfo?.wardName?.trim() || locationName.trim() || "",
constituency: wardInfo?.constituency?.trim() || "",
county: wardInfo?.county?.trim() || "",

    geohash: coords ? encodeGeohash(coords.lat, coords.lng) : "",

    sellerId: user.uid,
    sellerName:
      userProfile?.displayName ??
      user.displayName ??
      "",

    sellerType: userProfile?.isBusinessOwner
      ? "business"
      : "individual",

    priceDisplay,

    pricingBasis: isTransport
      ? pricingBasis
      : null,

    hotelMenu: isEatery
      ? hotelMenu
      : null,
    eateryPayment: isEatery
      ? {
          method: eateryPaymentMethod,
          number: eateryPaymentNumber.trim(),
          accountNumber: eateryPaymentMethod === "paybill" ? eateryPaybillAccount.trim() : "",
          otherDescription: eateryPaymentMethod === "other" ? eateryPaymentOther.trim() : "",
        }
      : null,
    priceList:
      priceListItems.length > 0
        ? priceListItems.map((item) => ({
            name: item.name,
            price: parseFloat(item.price) || 0,
          }))
        : null,

    plan,
    phone: cleanedPhone,
    // Category-specific details
jobDetails: isJobSeeking
  ? {
      jobTitle: jobTitle.trim(),
      skills: jobSkills.trim(),
      experience: jobExperience.trim(),
      education: jobEducation.trim(),
      employmentType: jobEmploymentType,
      availability: jobAvailability.trim(),
    }
  : null,

vehicleDetails: isVehicle
  ? {
      make: vehicleMake.trim(),
      model: vehicleModel.trim(),
      year: vehicleYear ? parseInt(vehicleYear) : null,
      condition: vehicleCondition,
      transmission: vehicleTransmission,
      fuelType: vehicleFuelType,
      mileage: vehicleMileage ? parseInt(vehicleMileage) : null,
      registration: vehicleRegistration.trim(),
    }
  : null,

serviceDetails: isProfessionalService
  ? {
      serviceType: serviceType.trim(),
      serviceArea: serviceArea.trim(),
      pricingType: servicePricingType,
    }
  : null,
    accommodationDetails: isAccommodation
  ? {
      bedrooms:
        !isAccommodationLand
          ? bedrooms
          : "",

      bathrooms:
        !isAccommodationLand
          ? bathrooms
          : "",

      furnishing:
        !isAccommodationLand
          ? furnishing
          : "",

      landSize:
        isAccommodationLand
          ? landSize
          : "",

      stayDetails:
        selectedSubcategory === "Airbnb / Short Stays" ||
        selectedSubcategory === "Vacation Rentals" ||
        selectedSubcategory === "Lodges / Guest Houses" ||
        selectedSubcategory === "Serviced Apartments"
          ? stayDetails
          : "",

      spaceDetails:
        selectedSubcategory === "Parking Spaces" ||
        selectedSubcategory === "Garages"
          ? spaceDetails
          : "",

      sharedHousingDetails:
        selectedSubcategory === "Roommates / Shared Housing"
          ? sharedHousingDetails
          : "",
    }
  : null,
    commercialPropertyDetails: isCommercialProperty
  ? { landSize: isCommercialPropertyLand ? landSize : "" }
  : null,
  };
  
  // 3. Ask backend to create the advert
  const publishAdvert = httpsCallable<
    typeof docData,
    PublishAdvertResponse
  >(functions, "publishAdvert");

  const result = await publishAdvert(docData);
  const data = result.data;

  // 4. Backend says advert is already active
  if (!data.requiresPayment) {
    return {
      checkoutRequestId: "",
      productId: data.productId,
    };
  }

  // 5. Backend says payment is required
  const stkResult = await initiateStkPush({
    phone: cleanedPhone,
    plan: data.plan as PaidListingPlan,
    productId: data.productId,
  });

  return {
    checkoutRequestId: stkResult.checkoutRequestId,
    productId: data.productId,
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

if (!user) {
  toast({
    title: "Please sign in",
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
      price:
  isAccommodation && !isAccommodationSale && !isAccommodationLand
    ? extractPriceValue(rentPerMonth)
    : isCommercialProperty && !isCommercialPropertySale && !isCommercialPropertyLand
      ? extractPriceValue(rentPerMonth)
      : isProfessionalService && servicePricingType === "quote_only"
        ? 0
        : isTransport && pricingBasis === "quote_only"
          ? 0
          : extractPriceValue(price),

      priceRaw: price.trim(),
      rentPerMonthRaw: rentPerMonth.trim(),

      category: selectedCategory,
      subcategory:
        selectedSubcategory === "Other"
          ? customSubcategory.trim() || "Other"
          : selectedSubcategory || selectedCategory,

      imageUrl: uploadedImages[0]?.url ?? "",
      imageUrls: uploadedImages,

      lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,

    ward: wardInfo?.wardName?.trim() || locationName.trim() || "",
constituency: wardInfo?.constituency?.trim() || "",
county: wardInfo?.county?.trim() || "",

    geohash: coords ? encodeGeohash(coords.lat, coords.lng) : "",

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
      eateryPayment: isEatery
      ? {
          method: eateryPaymentMethod,
          number: eateryPaymentNumber.trim(),
          accountNumber: eateryPaymentMethod === "paybill" ? eateryPaybillAccount.trim() : "",
          otherDescription: eateryPaymentMethod === "other" ? eateryPaymentOther.trim() : "",
        }
      : null,
      priceList:
        priceListItems.length > 0
          ? priceListItems.map((item) => ({
              name: item.name,
              price: parseFloat(item.price) || 0,
            }))
          : null,
      plan: "free",

phone: cleanedPhone,

jobDetails: isJobSeeking
  ? {
      jobTitle: jobTitle.trim(),
      skills: jobSkills.trim(),
      experience: jobExperience.trim(),
      education: jobEducation.trim(),
      employmentType: jobEmploymentType,
      availability: jobAvailability.trim(),
    }
  : null,

vehicleDetails: isVehicle
  ? {
      make: vehicleMake.trim(),
      model: vehicleModel.trim(),
      year: vehicleYear ? parseInt(vehicleYear) : null,
      condition: vehicleCondition,
      transmission: vehicleTransmission,
      fuelType: vehicleFuelType,
      mileage: vehicleMileage ? parseInt(vehicleMileage) : null,
      registration: vehicleRegistration.trim(),
    }
  : null,

serviceDetails: isProfessionalService
  ? {
      serviceType: serviceType.trim(),
      serviceArea: serviceArea.trim(),
      pricingType: servicePricingType,
    }
  : null,
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

    const errorMessage = error?.message || "";

    if (
      errorMessage.toLowerCase().includes("limit") || 
      errorMessage.toLowerCase().includes("maximum") || 
      errorMessage.toLowerCase().includes("expired") || 
      errorMessage.toLowerCase().includes("archived")
    ) {
      setLimitModalMessage(
        "You have reached your maximum limit of 5 active free adverts, or have 5 archived items. Please upgrade your plan or delete/manage existing listings to post a new one."
      );
    } else {
      const message = getFirebaseErrorMessage(
        error,
        "Unable to publish your advert. Please try again."
      );
toast({
        title: "Failed to publish",
        description: message,
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
  } catch (error: unknown) {
  console.error("Publish premium advert failed:", error);

  toast({
    title: "Failed to publish",
    description: getFirebaseErrorMessage(
      error,
      "Unable to publish your advert using your Premium subscription. Please try again."
    ),
    variant: "destructive",
  });
    }
   finally {
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
                      onClick={() => {
  setSelectedCategory(cat.key);
  setSelectedSubcategory("");
  setCustomSubcategory("");

  // Reset pricing basis when leaving Services
  if (cat.key !== "Services") {
    setPricingBasis("per_trip");
  }
}}
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
    {/* =========================================================
        JOB SEEKER / CV FORM
        ========================================================= */}
    {isJobSeeking ? (
      <div className="space-y-5">

        <div>
          <h2 className="font-black text-lg">Job Seeker Profile</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tell employers about the work you are looking for and your skills.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Job Title / Position *</label>
          <Input
            placeholder="e.g. ICT Support Technician"
            value={jobTitle}
            onChange={(e) => {
              setJobTitle(e.target.value);
              setTitle(e.target.value);
            }}
            maxLength={80}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Professional Summary</label>
          <Textarea
            placeholder="Briefly describe yourself, your experience and the type of work you are looking for..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            className="min-h-[120px] text-sm"
          />
          <p className="text-xs text-right text-muted-foreground">
            {description.length}/1000
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Skills</label>
          <Textarea
            placeholder="e.g. Computer networking, IT support, Microsoft Office, customer service..."
            value={jobSkills}
            onChange={(e) => setJobSkills(e.target.value)}
            maxLength={500}
            className="min-h-[90px] text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Work Experience</label>
          <Textarea
            placeholder="e.g. 2 years experience in ICT support..."
            value={jobExperience}
            onChange={(e) => setJobExperience(e.target.value)}
            maxLength={500}
            className="min-h-[90px] text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Education / Qualifications</label>
          <Textarea
            placeholder="e.g. Diploma in IT, Bachelor's Degree in Information Technology..."
            value={jobEducation}
            onChange={(e) => setJobEducation(e.target.value)}
            maxLength={500}
            className="min-h-[80px] text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Employment Type</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              "Full-time",
              "Part-time",
              "Contract",
              "Temporary",
              "Internship",
              "Freelance",
            ].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setJobEmploymentType(type)}
                className={`py-2.5 px-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                  jobEmploymentType === type
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Availability</label>
          <Input
            placeholder="e.g. Available immediately"
            value={jobAvailability}
            onChange={(e) => setJobAvailability(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Contact Phone (WhatsApp) *</label>
          <Input
            type="tel"
            placeholder="e.g. 0712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-12 text-base"
          />
        </div>

      </div>

    ) : isVehicle ? (

      /* =========================================================
         VEHICLE FORM
         ========================================================= */
      <div className="space-y-5">

        <div>
          <h2 className="font-black text-lg">Vehicle Details</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Provide important details about the vehicle you are selling.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Advert Title *</label>
          <Input
            placeholder="e.g. Toyota Probox 2018 in good condition"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            className="h-12 text-base"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">

          <div className="space-y-1.5">
            <label className="text-sm font-bold">Make *</label>
            <Input
              placeholder="e.g. Toyota"
              value={vehicleMake}
              onChange={(e) => setVehicleMake(e.target.value)}
              className="h-12"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-bold">Model *</label>
            <Input
              placeholder="e.g. Probox"
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
              className="h-12"
            />
          </div>

        </div>

        <div className="grid grid-cols-2 gap-3">

          <div className="space-y-1.5">
            <label className="text-sm font-bold">Year</label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="e.g. 2018"
              value={vehicleYear}
              onChange={(e) => setVehicleYear(e.target.value)}
              className="h-12"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-bold">Mileage (KM)</label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="e.g. 85000"
              value={vehicleMileage}
              onChange={(e) => setVehicleMileage(e.target.value)}
              className="h-12"
            />
          </div>

        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Condition</label>
          <div className="grid grid-cols-2 gap-2">
            {["New", "Used", "Foreign Used", "Locally Used"].map((condition) => (
              <button
                key={condition}
                type="button"
                onClick={() => setVehicleCondition(condition)}
                className={`py-2.5 px-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                  vehicleCondition === condition
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {condition}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">

          <div className="space-y-1.5">
            <label className="text-sm font-bold">Transmission</label>
            <select
              value={vehicleTransmission}
              onChange={(e) => setVehicleTransmission(e.target.value)}
              className="w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-sm"
            >
              <option value="">Select</option>
              <option value="Automatic">Automatic</option>
              <option value="Manual">Manual</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-bold">Fuel Type</label>
            <select
              value={vehicleFuelType}
              onChange={(e) => setVehicleFuelType(e.target.value)}
              className="w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-sm"
            >
              <option value="">Select</option>
              <option value="Petrol">Petrol</option>
              <option value="Diesel">Diesel</option>
              <option value="Hybrid">Hybrid</option>
              <option value="Electric">Electric</option>
            </select>
          </div>

        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Description</label>
          <Textarea
            placeholder="Describe the vehicle, condition, features and any other important information..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            className="min-h-[120px] text-sm"
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-bold">Price (KES) *</label>

          <Input
            type="text"
            inputMode="text"
            placeholder="e.g. 850000"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-12 text-base"
          />

          <div className="flex gap-2">
            {[
              { value: "fixed", label: "Fixed Price" },
              { value: "negotiable", label: "Negotiable" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPriceDisplay(option.value as PriceDisplay)}
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold ${
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

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Contact Phone (WhatsApp) *</label>
          <Input
            type="tel"
            placeholder="e.g. 0712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-12 text-base"
          />
        </div>

      </div>

    ) : isProfessionalService ? (

      /* =========================================================
         PROFESSIONAL SERVICES FORM
         ========================================================= */
      <div className="space-y-5">

        <div>
          <h2 className="font-black text-lg">Professional Service Details</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tell customers what professional service you offer and how you charge.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Service Title *</label>
          <Input
            placeholder="e.g. Professional Graphic Design Services"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Service Description</label>
          <Textarea
            placeholder="Describe your professional service, experience and what customers can expect..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            className="min-h-[120px] text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Service Type</label>
          <Input
            placeholder="e.g. Accounting, Legal, IT Support, Graphic Design"
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Service Area</label>
          <Input
            placeholder="e.g. Nairobi, Kasarani, Remote / Online"
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Pricing Method *</label>

          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "fixed", label: "Fixed Price" },
              { value: "per_hour", label: "Per Hour" },
              { value: "per_day", label: "Per Day" },
              { value: "per_session", label: "Per Session" },
              { value: "per_project", label: "Per Project" },
              { value: "quote_only", label: "Request Quote" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setServicePricingType(option.value)}
                className={`py-2.5 px-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                  servicePricingType === option.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {servicePricingType !== "quote_only" && (
          <div className="space-y-1.5">
            <label className="text-sm font-bold">Price (KES) *</label>
            <Input
              type="text"
              inputMode="text"
              placeholder="e.g. 5000"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-12 text-base"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Contact Phone (WhatsApp) *</label>
          <Input
            type="tel"
            placeholder="e.g. 0712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-12 text-base"
          />
        </div>

      </div>

    ) : (

      /* =========================================================
         NORMAL ADVERT FORM
         Includes:
         - Babies & Kids
         ========================================================= */
      <div className="space-y-5">

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Title *</label>
          <Input
            placeholder={
  isAccommodation
    ? "e.g. 1 bedroom bedsitter in Kariobangi"
    : isCommercialProperty
    ? "e.g. 2000 sqft shop in Nairobi CBD"
    : isEatery
    ? "e.g. Mama Njeri Restaurant"
    : isTransport
    ? "e.g. Toyota Probox taxi — Eastleigh"
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
          <p className="text-xs text-right text-muted-foreground">
            {description.length}/1000
          </p>
        </div>
        
                        {isAccommodation && !isAccommodationLand && (
          <div className="space-y-4">

  {(selectedSubcategory.includes("Bedroom") ||
  selectedSubcategory.includes("Houses") ||
  selectedSubcategory.includes("Apartments") ||
  selectedSubcategory === "Bedsitters" ||
  selectedSubcategory === "Studios" ||
  selectedSubcategory === "Single Rooms" ||
  selectedSubcategory === "Maisonettes" ||
  selectedSubcategory === "Bungalows" ||
  selectedSubcategory === "Townhouses" ||
  selectedSubcategory === "Gated Community Homes") && (
  <>
    {/* Only ask for bedroom count when it isn't already implied by the subcategory name */}
    {!(
      selectedSubcategory === "Single Rooms" ||
      selectedSubcategory === "Bedsitters" ||
      selectedSubcategory === "Studios"
    ) ? (
      <div className="grid grid-cols-2 gap-3">

        <div className="space-y-1.5">
          <label className="text-sm font-bold">
            Bedrooms
          </label>

          <Input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 2"
            value={bedrooms}
            onChange={(e) => setBedrooms(e.target.value)}
            className="h-12"
          />
        </div>

        <div className="space-y-1.5">
  <label className="text-sm font-bold">
    Bathrooms <span className="font-normal text-muted-foreground">(Optional)</span>
  </label>

          <Input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={bathrooms}
            onChange={(e) => setBathrooms(e.target.value)}
            className="h-12"
          />
        </div>

      </div>
    ) : (
      <div className="space-y-1.5">
  <label className="text-sm font-bold">
    Bathrooms <span className="font-normal text-muted-foreground">(Optional)</span>
  </label>

        <Input
          type="number"
          inputMode="numeric"
          placeholder="e.g. 1"
          value={bathrooms}
          onChange={(e) => setBathrooms(e.target.value)}
          className="h-12"
        />
      </div>
    )}

    <div className="space-y-1.5">
  <label className="text-sm font-bold">
    Furnishing <span className="font-normal text-muted-foreground">(Optional)</span>
  </label>

      <div className="grid grid-cols-3 gap-2">
        {[
          "Unfurnished",
          "Semi-Furnished",
          "Furnished",
        ].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFurnishing(option)}
            className={`py-2.5 px-2 rounded-xl border-2 text-xs font-semibold transition-all ${
              furnishing === option
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  </>
)}
            {(selectedSubcategory === "Airbnb / Short Stays" ||
              selectedSubcategory === "Vacation Rentals" ||
              selectedSubcategory === "Lodges / Guest Houses" ||
              selectedSubcategory === "Serviced Apartments") && (
              <div className="space-y-1.5">
                <label className="text-sm font-bold">
                  Stay Type / Booking Details
                </label>

                <Input
                  placeholder="e.g. Available daily, weekly or monthly"
                  value={stayDetails}
                  onChange={(e) => setStayDetails(e.target.value)}
                  className="h-12 text-base"
                />
              </div>
            )}

            {(selectedSubcategory === "Parking Spaces" ||
              selectedSubcategory === "Garages") && (
              <div className="space-y-1.5">
                <label className="text-sm font-bold">
                  Availability / Space Details
                </label>

                <Input
                  placeholder="e.g. 2 parking spaces available"
                  value={spaceDetails}
                  onChange={(e) => setSpaceDetails(e.target.value)}
                  className="h-12 text-base"
                />
              </div>
            )}

            {selectedSubcategory === "Roommates / Shared Housing" && (
              <div className="space-y-1.5">
                <label className="text-sm font-bold">
                  Shared Housing Details
                </label>

                <Input
                  placeholder="e.g. 1 room available in a 3-bedroom house"
                  value={sharedHousingDetails}
                  onChange={(e) =>
                    setSharedHousingDetails(e.target.value)
                  }
                  className="h-12 text-base"
                />
              </div>
            )}

          </div>
        )}
{isAccommodation ? (
  <div className="space-y-4">

    {isAccommodationLand ? (
  <>
    <div className="space-y-1.5">
      <label className="text-sm font-bold">
        Land Size *
      </label>
      <Input
        placeholder="e.g. 50 x 100 ft or 1/8 acre"
        value={landSize}
        onChange={(e) => setLandSize(e.target.value)}
        className="h-12 text-base"
      />
    </div>

    <div className="space-y-1.5">
      <label className="text-sm font-bold">
        Price (KES) *
      </label>
          <Input
            type="text"
            inputMode="text"
            placeholder="e.g. 2500000"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">
            Price Display
          </label>

          <div className="flex gap-2">
            {getPriceOptions().map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setPriceDisplay(option.value as PriceDisplay)
                }
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold ${
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
      </>
    ) : isAccommodationSale ? (
      <div className="space-y-1.5">

        <label className="text-sm font-bold">
          Sale Price (KES) *
        </label>

        <Input
          type="text"
          inputMode="text"
          placeholder="e.g. 8500000"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="h-12 text-base"
        />

        <div className="flex gap-2">
          {getPriceOptions().map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                setPriceDisplay(option.value as PriceDisplay)
              }
              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold ${
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
    ) : (
      <div className="space-y-1.5">

        <label className="text-sm font-bold">
  {isShortStay
    ? "Rate (KES) *"
    : (selectedSubcategory === "Parking Spaces" || selectedSubcategory === "Garages")
    ? "Parking Fee (KES) *"
    : "Monthly Rent (KES) *"}
</label>

<Input
  type="text"
  inputMode="text"
  placeholder={isShortStay ? "e.g. 3500 per night" : "e.g. 7500"}
  value={rentPerMonth}
  onChange={(e) => setRentPerMonth(e.target.value)}
  className="h-12 text-base"
/>

        <div className="flex gap-2">
          {getPriceOptions().map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                setPriceDisplay(option.value as PriceDisplay)
              }
              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold ${
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
    )}

  </div>

) : isCommercialProperty ? (
  <div className="space-y-4">

    {isCommercialPropertyLand ? (
      <>
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Land Size *</label>
          <Input
            placeholder="e.g. 1 acre or 50 x 100 ft"
            value={landSize}
            onChange={(e) => setLandSize(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Price (KES) *</label>
          <Input
            type="text"
            inputMode="text"
            placeholder="e.g. 5000000"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold">Price Display</label>
          <div className="flex gap-2">
            {getPriceOptions().map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPriceDisplay(option.value as PriceDisplay)}
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold ${
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
      </>
    ) : isCommercialPropertySale ? (
      <div className="space-y-1.5">
        <label className="text-sm font-bold">Sale Price (KES) *</label>
        <Input
          type="text"
          inputMode="text"
          placeholder="e.g. 15000000"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="h-12 text-base"
        />
        <div className="flex gap-2">
          {getPriceOptions().map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPriceDisplay(option.value as PriceDisplay)}
              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold ${
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
    ) : (
      <div className="space-y-1.5">
        <label className="text-sm font-bold">Monthly Rent (KES) *</label>
        <Input
          type="text"
          inputMode="text"
          placeholder="e.g. 45000"
          value={rentPerMonth}
          onChange={(e) => setRentPerMonth(e.target.value)}
          className="h-12 text-base"
        />
        <div className="flex gap-2">
          {getPriceOptions().map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPriceDisplay(option.value as PriceDisplay)}
              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold ${
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
    )}

  </div>

        ) : isTransport ? (

          <div className="space-y-3">

            <div className="space-y-1.5">
              <label className="text-sm font-bold">
                Pricing Basis
              </label>

              <div className="grid grid-cols-2 gap-2">
                {PRICING_BASIS_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPricingBasis(value)}
                    className={`py-2.5 px-3 rounded-xl border-2 text-xs font-semibold text-left transition-all ${
                      pricingBasis === value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {pricingBasis !== "quote_only" && (
              <div className="space-y-1.5">
                <label className="text-sm font-bold">
                  Price (KES)
                </label>

                <Input
                  type="text"
                  inputMode="text"
                  placeholder={
                    pricingBasis === "per_km"
                      ? "e.g. 50 per km"
                      : "e.g. 2000"
                  }
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="h-12 text-base"
                />
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
                  type="text"
                  inputMode="text"
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
                  type="button"
                  onClick={() =>
                    setPriceDisplay(option.value as PriceDisplay)
                  }
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
            <div className="space-y-3">
              <p className="font-black text-base">Payment Method</p>

                <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "mpesa", label: "Direct M-Pesa (Phone)" },
                  { value: "till", label: "Till Number" },
                  { value: "pochi", label: "Pochi la Biashara" },
                  { value: "paybill", label: "Paybill" },
                  { value: "other", label: "Other" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEateryPaymentMethod(option.value as typeof eateryPaymentMethod)}
                    className={`py-2.5 px-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                      eateryPaymentMethod === option.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {(eateryPaymentMethod === "till" || eateryPaymentMethod === "pochi") && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">
                    {eateryPaymentMethod === "till" ? "Till Number" : "Pochi la Biashara Number"}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 123456"
                    value={eateryPaymentNumber}
                    onChange={(e) => setEateryPaymentNumber(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
              )}

              {eateryPaymentMethod === "mpesa" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">M-Pesa Phone Number</label>
                  <Input
                    type="tel"
                    placeholder="e.g. 0712345678"
                    value={eateryPaymentNumber}
                    onChange={(e) => setEateryPaymentNumber(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
              )}

              {eateryPaymentMethod === "other" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">Describe Payment Method</label>
                  <Input
                    type="text"
                    placeholder="e.g. Cash on delivery, Bank transfer..."
                    value={eateryPaymentOther}
                    onChange={(e) => setEateryPaymentOther(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
              )}

              {eateryPaymentMethod === "paybill" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold">Paybill Number *</label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="e.g. 400200"
                      value={eateryPaymentNumber}
                      onChange={(e) => setEateryPaymentNumber(e.target.value)}
                      className="h-12 text-base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold">Account Number *</label>
                    <Input
                      type="text"
                      placeholder="e.g. Your name/shop"
                      value={eateryPaybillAccount}
                      onChange={(e) => setEateryPaybillAccount(e.target.value)}
                      className="h-12 text-base"
                    />
                  </div>
                </div>
              )}
            </div>

            <p className="font-black text-base">
              Hotel / Restaurant Menu
            </p>

            {MEAL_PERIODS.map(({ key, label }) => (
              <div
                key={key}
                className="rounded-2xl border border-border overflow-hidden"
              >

                <div className="bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 border-b border-border">
                  <span className="font-bold text-sm text-rose-700 dark:text-rose-400">
                    {label}
                  </span>
                </div>

                {hotelMenu[key].length > 0 && (
                  <div className="divide-y divide-border">
                    {hotelMenu[key].map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center px-4 py-2.5 gap-2"
                      >
                        <span className="flex-1 text-sm font-medium">
                          {item.name}
                        </span>

                        <span className="text-sm font-bold text-primary">
                          KES {item.price}
                        </span>

                        <button
                          onClick={() =>
                            removeMenuItem(key, i)
                          }
                          className="ml-2 text-muted-foreground hover:text-destructive"
                        >
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
                    onChange={(e) =>
                      setNewItems((prev) => ({
                        ...prev,
                        [key]: {
                          ...prev[key],
                          name: e.target.value,
                        },
                      }))
                    }
                    className="flex-1 h-9 text-sm"
                  />

                  <Input
                    type="text"
                    inputMode="text"
                    placeholder="KES"
                    value={newItems[key].price}
                    onChange={(e) =>
                      setNewItems((prev) => ({
                        ...prev,
                        [key]: {
                          ...prev[key],
                          price: e.target.value,
                        },
                      }))
                    }
                    className="w-24 h-9 text-sm"
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

        <div className="space-y-1.5">

          <label className="text-sm font-bold">Contact Phone (WhatsApp) *</label>

          <Input
            type="tel"
            placeholder="e.g. 0712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-12 text-base"
          />

        </div>

      </div>
    )}
  </>
)}
                {/* ========== STEP 3: Photos & Location ========== */}
        {step === 3 && (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold">
                  Photos (Optional • up to {MAX_PHOTO_LIMIT[plan]})
                </label>
                <span className="text-xs text-muted-foreground">{imageFiles.length}/{MAX_PHOTO_LIMIT[plan]}</span>
              </div>

              {imageFiles.length === 0 && (
                <div className="bg-muted/50 border border-border rounded-2xl px-4 py-3 text-xs text-muted-foreground">
                  Photos are optional. You can proceed to the next step without uploading a photo.
                </div>
              )}

              {plan === "free" && imageFiles.length >= MAX_PHOTO_LIMIT.free && (
                <div className="bg-muted/60 border border-border rounded-2xl px-4 py-3 flex items-start gap-3">
                  <Shield size={15} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-foreground">Free plan: 1 photo max</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Upgrade to Weekly or Monthly Premium for more photos.</p>
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

            {/* Other products / services list */}
            <div className="space-y-3 mt-4">
              <div>
                <label className="text-sm font-bold">Other Products / Services (Optional)</label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Selling more than one thing? List other items with their prices — buyers will see a "View List" option on this advert.
                </p>
              </div>

              {priceListItems.length > 0 && (
                <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border">
                  {priceListItems.map((item, i) => (
                    <div key={i} className="flex items-center px-4 py-2.5 gap-2">
                      <span className="flex-1 text-sm font-medium">{item.name}</span>
                      <span className="text-sm font-bold text-primary">KES {item.price}</span>
                      <button
                        type="button"
                        onClick={() => removePriceListItem(i)}
                        className="ml-2 text-muted-foreground hover:text-destructive"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  placeholder="Item name"
                  value={newPriceListItem.name}
                  onChange={(e) =>
                    setNewPriceListItem((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="flex-1 h-9 text-sm"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="KES"
                  value={newPriceListItem.price}
                  onChange={(e) =>
                    setNewPriceListItem((prev) => ({ ...prev, price: e.target.value }))
                  }
                  className="w-24 h-9 text-sm"
                />
                <button
                  type="button"
                  onClick={addPriceListItem}
                  className="h-9 w-9 rounded-xl bg-primary text-white flex items-center justify-center flex-shrink-0"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-2 mt-4">
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
                  value={locationSearch}  onChange={(e) => setLocationSearch(e.target.value)}// Keep your existing handler here
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
          <p className="text-sm text-muted-foreground">7 days · 1 photo · 3 max active adverts</p>
        </div>
        <span className="font-black text-xl text-muted-foreground">Free</span>
      </div>
    </button>

    {/* Weekly Premium */}
    <button onClick={() => setPlan("premium_weekly")} className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${plan === "premium_weekly" ? "border-[#00A651] bg-[#00A651]/5" : "border-border"}`}>
      <div className="flex justify-between items-center">
        <div>
          <span className="font-black text-base">Weekly Premium</span>
          <p className="text-sm text-muted-foreground">7 days · Up to 3 photos · Up to 8 active adverts</p>
        </div>
        <span className="font-black text-2xl" style={{ color: "#00A651" }}>KES {PLAN_AMOUNTS.premium_weekly}</span>
      </div>
    </button>

    {/* Monthly Premium */}
    <button onClick={() => setPlan("premium_monthly")} className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${plan === "premium_monthly" ? "border-[#00A651] bg-[#00A651]/5" : "border-border"}`}>
      <div className="flex justify-between items-center">
        <div>
          <span className="font-black text-base">Monthly Premium</span>
          <p className="text-sm text-muted-foreground">30 days · Up to 3 photos · Up to 10 active adverts</p>
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
  <img
    src={imagePreviews[0]}
    className="w-full h-full object-cover"
    alt="Preview"
  />
) : (
  <div className="w-full h-full flex flex-col items-center justify-center bg-muted text-muted-foreground">
    <Camera size={40} />
    <p className="mt-2 text-xs font-medium">No photo added</p>
  </div>
)}
              </div>
              
              <div>
                <h3 className="font-bold text-base">{title || "Untitled Advert"}</h3>
                <p className="text-sm text-muted-foreground mt-1">{description || "No description provided."}</p>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4">
  <span className="text-sm font-bold text-primary">
    {isAccommodationLand || isCommercialPropertyLand
      ? `KES ${price}`
      : isAccommodationSale || isCommercialPropertySale
      ? `KES ${price}${priceDisplay === "negotiable" ? " (Negotiable)" : ""}`
      : isAccommodation || isCommercialProperty
      ? `KES ${rentPerMonth}/mo`
      : priceDisplay === "contact"
      ? "Contact for Price"
      : priceDisplay === "quote"
      ? "Request Quote"
      : priceDisplay === "negotiable"
      ? `KES ${price} (Negotiable)`
      : `KES ${price}`}
  </span>

  <span className="text-sm text-muted-foreground">
    {selectedCategory} / {selectedSubcategory}
  </span>
</div>
 <div className="flex items-center justify-between">
<span className="text-sm font-semibold">
    {isAccommodationLand || isCommercialPropertyLand
      ? "Land Price"
      : isAccommodationSale || isCommercialPropertySale
      ? "Sale Price"
      : isAccommodation || isCommercialProperty
      ? "Monthly Rent"
      : "Price"}
  </span>

  <span className="text-sm font-bold text-primary">
    {isAccommodationLand || isCommercialPropertyLand
      ? price
        ? `KES ${price}`
        : "Not specified"
      : isAccommodationSale || isCommercialPropertySale
      ? price
        ? `KES ${price}`
        : "Not specified"
      : isAccommodation || isCommercialProperty
      ? rentPerMonth
        ? `KES ${rentPerMonth}/mo`
        : "Not specified"
      : price
      ? `KES ${price}`
      : "Negotiable"}
  </span>
</div>
{isAccommodation && (
  <div className="space-y-2 border-t border-border pt-4">

    {isAccommodationLand ? (
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          Land Size
        </span>
        <span className="text-sm text-muted-foreground">
          {landSize || "Not specified"}
        </span>
      </div>
    ) : (
      <>
        {bedrooms && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              Bedrooms
            </span>
            <span className="text-sm text-muted-foreground">
              {bedrooms}
            </span>
          </div>
        )}

        {bathrooms && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              Bathrooms
            </span>
            <span className="text-sm text-muted-foreground">
              {bathrooms}
            </span>
          </div>
        )}

        {furnishing && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              Furnishing
            </span>
            <span className="text-sm text-muted-foreground">
              {furnishing}
            </span>
          </div>
        )}
      </>
    )}

    {stayDetails && (
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          Stay Details
        </span>
        <span className="text-sm text-muted-foreground text-right max-w-[60%]">
          {stayDetails}
        </span>
      </div>
    )}

    {spaceDetails && (
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          Space Details
        </span>
        <span className="text-sm text-muted-foreground text-right max-w-[60%]">
          {spaceDetails}
        </span>
      </div>
    )}

    {sharedHousingDetails && (
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          Shared Housing
        </span>
        <span className="text-sm text-muted-foreground text-right max-w-[60%]">
          {sharedHousingDetails}
        </span>
      </div>
    )}

  </div>
)}
                {isCommercialPropertyLand && (
  <div className="space-y-2 border-t border-border pt-4">
    <div className="flex items-center justify-between">
      <span className="text-sm font-semibold">Land Size</span>
      <span className="text-sm text-muted-foreground">
        {landSize || "Not specified"}
      </span>
    </div>
  </div>
)}
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
          <div className="flex gap-3">
            {step > 1 && (
              <Button
                type="button"
                variant="outline"
                className="w-1/3 h-12 font-black text-base rounded-2xl border-2"
                onClick={() => setStep((prev) => (prev - 1) as Step)}
              >
                Back
              </Button>
            )}
            <Button 
              className={`h-12 font-black text-base rounded-2xl shadow-lg ${step > 1 ? "flex-1" : "w-full"}`} 
              onClick={goNext}
            >
              Next
            </Button>
          </div>
        ) : (
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="w-1/3 h-12 font-black text-base rounded-2xl border-2"
              onClick={() => setStep((prev) => (prev - 1) as Step)}
              disabled={publishingFree}
            >
              Back
            </Button>

            {hasActivePremium ? (
              <Button
                className="flex-1 h-12 font-black text-base rounded-2xl shadow-lg gap-2"
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
                className="flex-1 h-12 font-black text-base rounded-2xl shadow-lg"
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
                className="flex-1 h-12 font-black text-base rounded-2xl shadow-lg gap-2"
                style={{ backgroundColor: "#00A651" }}
                onClick={() => setShowPaymentModal(true)}
              >
                <Smartphone size={18} />
                Pay KES {PLAN_AMOUNTS[plan as PaidListingPlan]} & Publish
              </Button>
            )}
          </div>
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
            {/* Limit Reached Professional Modal */}
      {limitModalMessage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto">
              <Shield size={24} />
            </div>
            
            <div className="text-center space-y-1">
              <h3 className="font-black text-lg">Listing Limit Reached</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {limitModalMessage}
              </p>
            </div>

            <div className="pt-2">
              <Button
                type="button"
                className="w-full h-12 font-bold rounded-2xl shadow-lg"
                onClick={() => setLimitModalMessage(null)}
              >
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
</div>
  );
}
