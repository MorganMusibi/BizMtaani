import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage, functions } from "@/lib/firebase";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getRecaptchaToken } from "@/lib/recaptcha";
import { useRef, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { signOut, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Package, MessageCircle, Camera, Loader2, Store, Briefcase, ChevronRight, Gift, X, Plus, MapPin } from "lucide-react";
import { AreaPickerSheet } from "@/components/AreaPickerSheet";
import { getWardCoordinates } from "@/lib/location";
import { Link } from "wouter";
import imageCompression from "browser-image-compression";
import { getFullSizeUrl } from "@/lib/cloudinaryUrl";
import { clearMarketerDashboardCache } from "@/pages/MarketerDashboard";

export default function Profile() {
  const [, setLocation] = useLocation();
  const { user, userProfile, loading } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showPhotoViewer, setShowPhotoViewer] = useState(false);
  const hasPhoto = !!user?.photoURL;


  const [isMarketer, setIsMarketer] = useState(false);
  const [marketerData, setMarketerData] = useState<any>(null);
  
  useEffect(() => {
    if (!user) return;
    const cacheKey = `bizmtaani_marketer_status_${user.uid}`;
    const CACHE_TTL_MS = 20 * 60 * 1000; // ✅ 20 minutes TTL to prevent excessive reads

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        // ✅ Only skip reads if cache is fresh (< 20 mins)
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          setIsMarketer(parsed.isMarketer);
          setMarketerData(parsed.marketerData);
          setHasPendingApplication(parsed.hasPendingApplication);
          return; 
        }
      }
    } catch {
      // Corrupt or unavailable cache — fall through and fetch normally.
    }

    import("firebase/firestore").then(({ getDoc, doc: docRef }) => {
      getDoc(docRef(db, "marketers", user.uid)).then((snap) => {
        const isMkt = snap.exists();
        const data = snap.exists() ? snap.data() : null;
        setIsMarketer(isMkt);
        setMarketerData(data);
        getDoc(docRef(db, "marketerApplications", user.uid)).then((appSnap) => {
          const pending = appSnap.exists() && appSnap.data()?.status === "pending";
          setHasPendingApplication(pending);
          try {
            sessionStorage.setItem(
              cacheKey,
              JSON.stringify({
                isMarketer: isMkt,
                marketerData: data,
                hasPendingApplication: pending,
                timestamp: Date.now(), // ✅ Added timestamp for TTL check
              })
            );
          } catch {
            // sessionStorage full or unavailable — safe to ignore
          }
        });
      });
    });
  }, [user]);
  
const [showBusinessDetailsForm, setShowBusinessDetailsForm] = useState(false);
const [businessDescription, setBusinessDescription] = useState(userProfile?.businessDescription ?? "");
const [openingHours, setOpeningHours] = useState(userProfile?.openingHours ?? "");
const [businessAddress, setBusinessAddress] = useState(userProfile?.businessAddress ?? "");
const [socialMediaLink, setSocialMediaLink] = useState(userProfile?.socialMediaLink ?? "");
const [savingBusinessDetails, setSavingBusinessDetails] = useState(false);

const [showPriceListEditor, setShowPriceListEditor] = useState(false);
const [priceListItems, setPriceListItems] = useState<
  { name: string; priceType: "fixed" | "contact" | "custom"; price: string; priceText: string }[]
>(
  (userProfile?.shopPriceList ?? []).map((item: any) => ({
    name: item.name ?? "",
    priceType: item.priceType ?? "fixed",
    price: item.price != null ? String(item.price) : "",
    priceText: item.priceText ?? "",
  }))
);
const [newPriceListItem, setNewPriceListItem] = useState<{
  name: string;
  priceType: "fixed" | "contact" | "custom";
  price: string;
  priceText: string;
}>({ name: "", priceType: "fixed", price: "", priceText: "" });
const [savingPriceList, setSavingPriceList] = useState(false);

const [showBecomeBusinessForm, setShowBecomeBusinessForm] = useState(false);
const [businessNameInput, setBusinessNameInput] = useState("");
const [savingBecomeBusiness, setSavingBecomeBusiness] = useState(false);
const [showNameForm, setShowNameForm] = useState(false);
const [nameInput, setNameInput] = useState("");
const [savingName, setSavingName] = useState(false);
const [showAreaPicker, setShowAreaPicker] = useState(false);
const [resolvingArea, setResolvingArea] = useState(false);
const [selectedWard, setSelectedWard] = useState<{
  wardName: string;
  constituencyName: string;
  countyName: string;
  label?: string;
  lat: number | null;
  lng: number | null;
} | null>(null);

  const [showMarketerForm, setShowMarketerForm] = useState(false);
  const [hasPendingApplication, setHasPendingApplication] = useState(false);
  const [marketerFullName, setMarketerFullName] = useState("");
  const [marketerIdNumber, setMarketerIdNumber] = useState("");
  const [marketerMpesaNumber, setMarketerMpesaNumber] = useState("");
  const [marketerReason, setMarketerReason] = useState("");
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [showConfirmStep, setShowConfirmStep] = useState(false);

  async function handleApplyForMarketer() {
  if (!marketerFullName.trim()) {
    toast({ title: "Enter your full name", variant: "destructive" });
    return;
  }
  if (!marketerIdNumber.trim()) {
    toast({ title: "Enter your ID number", variant: "destructive" });
    return;
  }
  if (!marketerMpesaNumber.trim()) {
    toast({ title: "Enter your M-Pesa number", variant: "destructive" });
    return;
  }
  if (!marketerReason.trim()) {
    toast({ title: "Tell us why you want to be a marketer", variant: "destructive" });
    return;
  }

  setSubmittingApplication(true);

  try {
    const applyForMarketer = httpsCallable(functions, "applyForMarketer");
    await applyForMarketer({
      fullName: marketerFullName.trim(),
      idNumber: marketerIdNumber.trim(),
      mpesaNumber: marketerMpesaNumber.trim(),
      reason: marketerReason.trim(),
    });

    toast({ title: "Application submitted!", description: "We'll review it and get back to you." });
    setShowMarketerForm(false);
    setHasPendingApplication(true);
    if (user) sessionStorage.removeItem(`bizmtaani_marketer_status_${user.uid}`);
    setMarketerFullName("");
    setMarketerIdNumber("");
    setMarketerMpesaNumber("");
    setMarketerReason("");
  } catch (error: any) {
    toast({
      title: "Could not submit application",
      description: error?.message ?? "Please try again.",
      variant: "destructive",
    });
  } finally {
    setSubmittingApplication(false);
  }
}

  async function handleSaveBusinessDetails() {
  if (!user) return;

  setSavingBusinessDetails(true);

  try {
    await setDoc(doc(db, "users", user.uid), {
  businessDescription: businessDescription.trim(),
  openingHours: openingHours.trim(),
  businessAddress: businessAddress.trim(),
  socialMediaLink: socialMediaLink.trim(),
}, { merge: true });


    toast({ title: "Business details updated" });
    setShowBusinessDetailsForm(false);
  } catch (error) {
    toast({
      title: "Could not save details",
      description: "Please try again.",
      variant: "destructive",
    });
  } finally {
    setSavingBusinessDetails(false);
  }
  }

  async function handleSaveName() {
  if (!user || !nameInput.trim()) return;

  setSavingName(true);
  const updatedName = nameInput.trim();

  try {
    // 1. Update Firebase Auth display name
    await updateProfile(user, { displayName: updatedName });

    // 2. Update Firestore document (sets businessName if business owner, otherwise displayName)
    const updatePayload: Record<string, unknown> = isBusinessOwner
  ? { businessName: updatedName, searchNameLower: updatedName.toLowerCase() }
  : { displayName: updatedName, searchNameLower: updatedName.toLowerCase() };

    // 3. Include the updated area, if the user changed it in this same form
    if (selectedWard) {
      updatePayload.homeLocation = {
        lat: selectedWard.lat,
        lng: selectedWard.lng,
        areaName: selectedWard.wardName,
        constituency: selectedWard.constituencyName,
        county: selectedWard.countyName,
      };
    }

    await setDoc(doc(db, "users", user.uid), updatePayload, { merge: true });


    toast({ title: "Profile updated successfully" });
    setShowNameForm(false);
  
} catch (error) {
  console.error("Failed to update name:", error);
  toast({
    title: "Could not update name",
    description: "Please try again.",
    variant: "destructive",
  });
} finally {
  setSavingName(false);
}
  }

  function addShopPriceListItem() {
    if (!newPriceListItem.name.trim()) return;
    if (newPriceListItem.priceType === "fixed" && !newPriceListItem.price) return;
    if (newPriceListItem.priceType === "custom" && !newPriceListItem.priceText.trim()) return;

    setPriceListItems((prev) => [
      ...prev,
      {
        name: newPriceListItem.name.trim(),
        priceType: newPriceListItem.priceType,
        price: newPriceListItem.price,
        priceText: newPriceListItem.priceText.trim(),
      },
    ]);
    setNewPriceListItem({ name: "", priceType: "fixed", price: "", priceText: "" });
  }

  function removeShopPriceListItem(i: number) {
    setPriceListItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSaveShopPriceList() {
    if (!user) return;
    setSavingPriceList(true);
    try {
      await setDoc(doc(db, "users", user.uid), {
  shopPriceList: priceListItems.map((item) => ({
    name: item.name,
    priceType: item.priceType,
    price: item.priceType === "fixed" ? parseFloat(item.price) || 0 : 0,
    priceText: item.priceType === "custom" ? item.priceText : "",
  })),
}, { merge: true });

      toast({ title: "Price list updated" });
      setShowPriceListEditor(false);
    } catch (error) {
      toast({
        title: "Could not save price list",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingPriceList(false);
    }
  }

  async function handleAreaPicked(ward: {
    wardName: string;
    constituencyName: string;
    countyName: string;
    label?: string;
  }) {
    setResolvingArea(true);
    try {
      const coords = await getWardCoordinates(
        ward.wardName,
        ward.constituencyName,
        ward.countyName
      );

      setSelectedWard({
        wardName: ward.wardName,
        constituencyName: ward.constituencyName,
        countyName: ward.countyName,
        label: ward.label,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });

      setShowAreaPicker(false);
    } finally {
      setResolvingArea(false);
    }
  }

  async function handleBecomeBusinessOwner() {
    if (!user || !businessNameInput.trim()) return;

    setSavingBecomeBusiness(true);
    try {
      await setDoc(doc(db, "users", user.uid), {
  isBusinessOwner: true,
  businessName: businessNameInput.trim(),
  searchNameLower: businessNameInput.trim().toLowerCase(),
}, { merge: true });


      toast({ title: "You're now a business owner!", description: "Shop details, price list, and a Business badge are now available on your Profile." });
      setShowBecomeBusinessForm(false);
    } catch (error) {
      toast({
        title: "Could not update your account",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingBecomeBusiness(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    if (!file || !user) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Image too large",
        description: "Maximum 5 MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      console.log("STEP 1: Compressing image...");

      const compressedFile = await imageCompression(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 800,
        useWebWorker: true,
        initialQuality: 0.85,
        fileType: "image/jpeg",
      });

      console.log("STEP 1 SUCCESS:", compressedFile.size, "bytes");

      const oldStoragePath = userProfile?.photoStoragePath;
      const newStoragePath = `avatars/${user.uid}/${Date.now()}.jpg`;

      console.log("STEP 2: Uploading to:", newStoragePath);

      const storageRef = ref(storage, newStoragePath);

      await uploadBytes(storageRef, compressedFile, {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=31536000,immutable",
      });

      console.log("STEP 3 SUCCESS: Storage upload complete");

      const photoURL = await getDownloadURL(storageRef);

      console.log("STEP 4 SUCCESS: Got photo URL");

      await updateProfile(user, {
        photoURL,
      });

      await setDoc(
        doc(db, "users", user.uid),
        {
          photoURL,
          photoStoragePath: newStoragePath,
        },
        { merge: true }
      );

      console.log("STEP 5 SUCCESS: Firestore updated");

      if (oldStoragePath && oldStoragePath !== newStoragePath) {
        try {
          const oldStorageRef = ref(storage, oldStoragePath);
          await deleteObject(oldStorageRef);
        } catch (deleteError) {
          console.warn("Could not delete old profile photo:", deleteError);
        }
      }

      toast({
        title: "Profile photo updated",
      });

      window.location.reload();
    } catch (error) {
      console.error("Profile photo upload error:", error);

      toast({
        title: "Upload failed",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);

      if (fileRef.current) {
        fileRef.current.value = "";
      }

      if (cameraRef.current) {
        cameraRef.current.value = "";
      }
    }
  }

  async function handleDeleteAvatar() {
    if (!user) return;

    try {
      const storagePath = userProfile?.photoStoragePath;

      if (storagePath) {
        try {
          const storageRef = ref(storage, storagePath);
          await deleteObject(storageRef);
        } catch (deleteError) {
          console.warn("Could not delete profile photo:", deleteError);
        }
      }

      await updateProfile(user, {
        photoURL: "",
      });

      await updateDoc(doc(db, "users", user.uid), {
        photoURL: "",
        photoStoragePath: "",
      });

      setShowAvatarMenu(false);

      toast({
        title: "Profile photo removed",
      });

      window.location.reload();
    } catch (error) {
      console.error(error);

      toast({
        title: "Failed to remove photo",
        variant: "destructive",
      });
    }
  }

  async function handleSignOut() {
    clearMarketerDashboardCache();
    if (user) {
      try {
        sessionStorage.removeItem(`bizmtaani_marketer_status_${user.uid}`);
      } catch {
        // sessionStorage unavailable — nothing to clear, safe to ignore
      }
    }
    await signOut(auth);
    toast({ title: "Signed out" });
    setLocation("/");
  }

  if (loading) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-primary" />
    </div>
  );
}

if (!user) {
  return (
    <div className="min-h-screen bg-background pb-20 flex flex-col items-center justify-center gap-4 px-6">
      <div className="text-center">
        <h2 className="font-black text-2xl">Your Profile</h2>
        <p className="text-muted-foreground mt-1">Sign in ndio umanage account yako</p>
      </div>
      <Button data-testid="button-signin" onClick={() => setLocation("/login")} className="w-full max-w-xs">
        Sign In
      </Button>
    </div>
  );
}

const now = new Date();
const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const earningsThisMonth =
  marketerData?.earningsMonthKey === currentMonthKey
    ? marketerData?.earningsThisMonth ?? 0
    : 0;

const displayName = userProfile?.businessName || userProfile?.displayName || user.displayName || "Seller";
  const isBusinessOwner = userProfile?.isBusinessOwner ?? false;

  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center">
        <h1 className="font-black text-lg">Profile</h1>
      </header>

      <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
        {/* Avatar + info */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (uploading) return;

              if (hasPhoto) {
                setShowPhotoViewer(true);
              } else {
                setShowAvatarMenu(true);
              }
            }}
            disabled={uploading}
            className="relative w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 focus:outline-none"
          >
            {user.photoURL ? (
              <img src={user.photoURL} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-primary flex items-center justify-center">
                <span className="text-white text-2xl font-black">{initials}</span>
              </div>
            )}

            <div
              onClick={(e) => {
                e.stopPropagation();
                setShowAvatarMenu(true);
              }}
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary border-2 border-white flex items-center justify-center cursor-pointer"
            >
              {uploading ? (
                <Loader2 size={14} className="animate-spin text-white" />
              ) : (
                <Camera size={14} className="text-white" />
              )}
            </div>
          </button>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleAvatarChange} />

          <div className="min-w-0 flex-1">
  {showNameForm ? (
    <div className="space-y-2 mt-1">
      <input
        type="text"
        placeholder={isBusinessOwner ? "Business Name" : "Profile Name"}
        value={nameInput}
        onChange={(e) => setNameInput(e.target.value)}
        className="w-full h-9 px-3 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={() => setShowAreaPicker(true)}
        disabled={resolvingArea}
        className="w-full h-9 px-3 rounded-xl border border-border bg-background text-left text-sm flex items-center gap-1.5 disabled:opacity-50"
      >
        <MapPin size={13} className="text-primary flex-shrink-0" />
        {resolvingArea ? (
          <span className="text-muted-foreground">Updating area...</span>
        ) : selectedWard ? (
          <span className="font-medium truncate">
            {selectedWard.wardName}, {selectedWard.constituencyName}
          </span>
        ) : (
          <span className="text-muted-foreground">Tap to set your area</span>
        )}
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowNameForm(false)}
          className="h-8 px-3 rounded-lg border border-border text-xs font-semibold text-muted-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveName}
          disabled={savingName || !nameInput.trim()}
          className="h-8 px-3 rounded-lg bg-primary text-white text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {savingName ? <Loader2 size={12} className="animate-spin" /> : "Save"}
        </button>
      </div>
    </div>
  ) : (
    <>
      <div className="flex items-center gap-2">
        <p data-testid="text-display-name" className="font-black text-xl truncate">
          {displayName}
        </p>
        {isBusinessOwner && (
          <span className="flex-shrink-0 text-[10px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            BIZ
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setNameInput(displayName);
            setSelectedWard(
              userProfile?.homeLocation
                ? {
                    wardName: userProfile.homeLocation.areaName,
                    constituencyName: userProfile.homeLocation.constituency,
                    countyName: userProfile.homeLocation.county,
                    lat: userProfile.homeLocation.lat ?? null,
                    lng: userProfile.homeLocation.lng ?? null,
                  }
                : null
            );
            setShowNameForm(true);
          }}
          className="text-xs font-semibold text-primary hover:underline ml-1"
        >
          Edit
        </button>
      </div>
      {userProfile?.phone ? (
        <p data-testid="text-email" className="text-muted-foreground text-sm">{userProfile.phone}</p>
      ) : user.email ? (
        <p data-testid="text-email" className="text-muted-foreground text-sm">{user.email}</p>
      ) : null}
      <p className="text-xs text-muted-foreground mt-0.5">
        Tap photo to view • Tap camera to change
      </p>
    </>
  )}
</div>

        </div>

         {showAvatarMenu && (
          <>
            <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setShowAvatarMenu(false)} />
            <div
              className="fixed bottom-0 left-0 right-0 z-[60] bg-card rounded-t-3xl border-t border-border px-4 pb-8 pt-4"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
            >
              <button
                onClick={() => setShowAvatarMenu(false)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-muted flex items-center justify-center"
              >
                <X size={16} />
              </button>
              <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-5" />
              <p className="font-bold text-sm text-center mb-4">Badilisha profile photo</p>

              <div className="space-y-2">
                <button
                  onClick={() => {
                    setShowAvatarMenu(false);
                    cameraRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-muted font-semibold text-sm"
                >
                  <Camera size={20} className="text-primary" />
                  Take a photo
                </button>

                <button
                  onClick={() => {
                    setShowAvatarMenu(false);
                    fileRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-muted font-semibold text-sm"
                >
                  <Package size={20} className="text-primary" />
                  Chagua from gallery
                </button>

                {hasPhoto && (
                  <button
                    onClick={handleDeleteAvatar}
                    className="w-full flex items-center justify-center px-4 py-3.5 rounded-2xl bg-red-50 text-red-600 font-semibold text-sm"
                  >
                    Delete Photo
                  </button>
                )}

                <button
                  onClick={() => setShowAvatarMenu(false)}
                  className="w-full flex items-center justify-center px-4 py-3.5 rounded-2xl font-semibold text-sm text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}

        {/* Quick links grid */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/my-listings"
            data-testid="link-my-listings"
            className="flex flex-col items-center gap-2 p-4 bg-card rounded-2xl border border-border hover:border-primary transition-colors"
          >
            <Package size={22} className="text-primary" />
            <span className="font-semibold text-xs text-center">My Listings</span>
          </Link>
          <Link
            href="/chats"
            data-testid="link-my-chats"
            className="flex flex-col items-center gap-2 p-4 bg-card rounded-2xl border border-border hover:border-primary transition-colors"
          >
            <MessageCircle size={22} className="text-primary" />
            <span className="font-semibold text-xs text-center">Messages</span>
          </Link>
        </div>

        {/* Referrals & Rewards */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Gift size={18} className="text-primary" />
            <p className="font-black text-sm">Referrals & Rewards</p>
          </div>
          {isMarketer && (
  <div className="flex items-center justify-between bg-primary/5 rounded-xl px-3 py-2.5">
    <div>
      <p className="text-xs text-muted-foreground">Your earnings this month</p>
      <p className="font-black text-lg text-primary">
        KES {earningsThisMonth.toLocaleString()}
      </p>
    </div>
    <p className="text-xs text-muted-foreground text-right max-w-[55%]">
      You earn 25% every time someone you refer goes premium
    </p>
  </div>
)}

          {isMarketer ? (
          <button
            onClick={() => setLocation("/marketer")}
            className="w-full flex items-center gap-4 px-4 py-4 bg-gradient-to-r from-[#00A651]/10 to-emerald-50 border-2 border-[#00A651]/30 rounded-2xl hover:border-[#00A651] transition-all text-left active:scale-[0.98]"
          >
            <div className="w-11 h-11 rounded-xl bg-[#00A651] flex items-center justify-center flex-shrink-0">
              <Gift size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm">Marketer Dashboard</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Earn board, claims & your referral code
              </p>
            </div>
            <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
          </button>
        ) : hasPendingApplication ? (
          <div className="w-full flex items-center gap-4 px-4 py-4 bg-muted/40 border border-border rounded-2xl">
            <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              <Gift size={22} className="text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm">Marketer Application Pending</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                We're reviewing your application
              </p>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowMarketerForm(true)}
            className="w-full flex items-center gap-4 px-4 py-4 bg-card border border-border rounded-2xl hover:border-primary/40 transition-all text-left active:scale-[0.98]"
          >
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Gift size={22} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm">Become a Marketer</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Earn commission by bringing buyers and referring premium users
              </p>
            </div>
            <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
          </button>
        )}
        </div>

       {!isBusinessOwner && (
  <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
        <Store size={20} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm">Start Selling as a Business</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Get shop details, a price list, and a Business badge on your listings.
        </p>
      </div>
    </div>

    {showBecomeBusinessForm ? (
      <div className="space-y-2">
        <input
          type="text"
          placeholder="e.g. Mama Njeri Groceries"
          value={businessNameInput}
          onChange={(e) => setBusinessNameInput(e.target.value)}
          className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm font-medium"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={() => setShowBecomeBusinessForm(false)}
            className="flex-1 h-9 rounded-xl border border-border text-sm font-semibold text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleBecomeBusinessOwner}
            disabled={savingBecomeBusiness || !businessNameInput.trim()}
            className="flex-1 h-9 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-50"
          >
            {savingBecomeBusiness ? <Loader2 size={14} className="animate-spin" /> : "Confirm"}
          </button>
        </div>
      </div>
    ) : (
      <button
        onClick={() => {
          setBusinessNameInput(displayName);
          setShowBecomeBusinessForm(true);
        }}
        className="w-full h-10 rounded-xl bg-primary text-white text-sm font-bold"
      >
        Become a Business Owner
      </button>
    )}
  </div>
)}

        {/* Business details — shown on the seller's shop catalogue */}
{isBusinessOwner && (
  <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
    <div className="flex items-center justify-between">
      <p className="font-black text-sm">Shop Details</p>
      {!showBusinessDetailsForm && (
        <button
          onClick={() => setShowBusinessDetailsForm(true)}
          className="text-xs font-semibold text-primary"
        >
          Edit
        </button>
      )}
    </div>

    {showBusinessDetailsForm ? (
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Shop Description</label>
          <textarea
            placeholder="e.g. Family-run electronics shop since 2019, specializing in phone repairs..."
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            maxLength={300}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-border bg-background text-sm min-h-[70px]"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Opening Hours</label>
          <input
            type="text"
            placeholder="e.g. Mon–Sat, 8am–6pm"
            value={openingHours}
            onChange={(e) => setOpeningHours(e.target.value)}
            className="w-full h-11 mt-1 px-3 rounded-xl border border-border bg-background text-sm"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Address / Landmark</label>
          <input
            type="text"
            placeholder="e.g. Karibu na Mama watoto supermarket, Kasarani"
            value={businessAddress}
            onChange={(e) => setBusinessAddress(e.target.value)}
            className="w-full h-11 mt-1 px-3 rounded-xl border border-border bg-background text-sm"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Social Media Link (Optional)</label>
          <input
            type="text"
            placeholder="e.g. instagram.com/yourshop"
            value={socialMediaLink}
            onChange={(e) => setSocialMediaLink(e.target.value)}
            className="w-full h-11 mt-1 px-3 rounded-xl border border-border bg-background text-sm"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowBusinessDetailsForm(false)}
            className="flex-1 h-9 rounded-xl border border-border text-sm font-semibold text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveBusinessDetails}
            disabled={savingBusinessDetails}
            className="flex-1 h-9 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1"
          >
            {savingBusinessDetails ? <Loader2 size={14} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
    ) : (
      <div className="text-xs text-muted-foreground space-y-1">
        {businessDescription ? <p>{businessDescription}</p> : <p className="italic">No description added yet</p>}
        {openingHours && <p>🕒 {openingHours}</p>}
        {businessAddress && <p>📍 {businessAddress}</p>}
      </div>
    )}
  </div>
)}

{isBusinessOwner && (
  <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
    <div className="flex items-center justify-between">
      <p className="font-black text-sm">Shop Price List</p>
      {!showPriceListEditor && (
        <button
          onClick={() => setShowPriceListEditor(true)}
          className="text-xs font-semibold text-primary"
        >
          Edit
        </button>
      )}
    </div>

    {showPriceListEditor ? (
      <div className="space-y-3">
        {priceListItems.length > 0 && (
          <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border">
            {priceListItems.map((item, i) => (
              <div key={i} className="flex items-center px-3 py-2 gap-2">
                <span className="flex-1 min-w-0 text-sm font-bold truncate">{item.name}</span>
                <span className="text-xs font-bold text-primary">
                  {item.priceType === "contact"
                    ? "Contact for Price"
                    : item.priceType === "custom"
                    ? item.priceText
                    : `KES ${item.price}`}
                </span>
                <button
                  type="button"
                  onClick={() => removeShopPriceListItem(i)}
                  className="ml-2 text-muted-foreground hover:text-destructive"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <input
            type="text"
            placeholder="e.g. Haircut, T-shirt"
            value={newPriceListItem.name}
            onChange={(e) =>
              setNewPriceListItem((prev) => ({ ...prev, name: e.target.value }))
            }
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm font-semibold"
          />

          <div className="flex gap-2">
            {[
              { value: "fixed", label: "Fixed Price" },
              { value: "contact", label: "DM for Price" },
              { value: "custom", label: "Custom label" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setNewPriceListItem((prev) => ({
                    ...prev,
                    priceType: option.value as "fixed" | "contact" | "custom",
                  }))
                }
                className={`flex-1 py-2 px-2 rounded-xl border-2 text-[11px] font-semibold transition-all ${
                  newPriceListItem.priceType === option.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {newPriceListItem.priceType === "fixed" && (
              <input
                type="number"
                inputMode="numeric"
                placeholder="KES"
                value={newPriceListItem.price}
                onChange={(e) =>
                  setNewPriceListItem((prev) => ({ ...prev, price: e.target.value }))
                }
                className="flex-1 h-9 px-3 rounded-xl border border-border bg-background text-sm"
              />
            )}

            {newPriceListItem.priceType === "custom" && (
              <input
                type="text"
                placeholder="e.g. Starting from 500"
                value={newPriceListItem.priceText}
                onChange={(e) =>
                  setNewPriceListItem((prev) => ({ ...prev, priceText: e.target.value }))
                }
                className="flex-1 h-9 px-3 rounded-xl border border-border bg-background text-sm"
              />
            )}

            {newPriceListItem.priceType === "contact" && (
              <div className="flex-1 h-9 flex items-center px-3 rounded-xl bg-muted/50 text-xs text-muted-foreground">
                Buyers will be told to contact you for this item's price.
              </div>
            )}

            <button
              type="button"
              onClick={addShopPriceListItem}
              className="h-9 w-9 rounded-xl bg-primary text-white flex items-center justify-center flex-shrink-0"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setShowPriceListEditor(false)}
            className="flex-1 h-9 rounded-xl border border-border text-sm font-semibold text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveShopPriceList}
            disabled={savingPriceList}
            className="flex-1 h-9 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1"
          >
            {savingPriceList ? <Loader2 size={14} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
    ) : (
      <div className="text-xs text-muted-foreground">
        {priceListItems.length > 0 ? (
          <p>{priceListItems.length} item{priceListItems.length > 1 ? "s" : ""} listed</p>
        ) : (
          <p className="italic">No price list items added yet</p>
        )}
      </div>
    )}
  </div>
)}
        
        {/* Business management — only for business owners */}
{isBusinessOwner && (
  <>
    <button
      onClick={() => setLocation("/business")}
      className="w-full flex items-center gap-4 px-4 py-4 bg-gradient-to-r from-primary/10 to-orange-50 border-2 border-primary/30 rounded-2xl hover:border-primary transition-all text-left active:scale-[0.98]"
    >
      <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
        <Store size={22} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm">Manage My Business</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Dashboard, listings, shop profile & tools
        </p>
      </div>
      <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
    </button>

    <button
      onClick={() => setLocation(`/shop/${user.uid}`)}
      className="w-full flex items-center gap-4 px-4 py-4 bg-card border border-border rounded-2xl hover:border-primary/40 transition-all text-left active:scale-[0.98]"
    >
      <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
        <Store size={22} className="text-blue-700" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm">View My Shop</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          See your shop the way buyers see it
        </p>
      </div>
      <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
    </button>
  </>
)}

        {/* Jobs link */}
        <button
          onClick={() => setLocation("/jobs")}
          className="w-full flex items-center gap-4 px-4 py-4 bg-card border border-border rounded-2xl hover:border-primary/40 transition-all text-left active:scale-[0.98]"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Briefcase size={22} className="text-blue-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm">Jobs Board</p>
            <p className="text-xs text-muted-foreground mt-0.5">Browse jobs or post a vacancy</p>
          </div>
          <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
        </button>

        <Button
          data-testid="button-signout"
          variant="outline"
          className="w-full h-12 gap-2 text-destructive border-destructive/30 hover:bg-destructive/5"
          onClick={handleSignOut}
        >
          <LogOut size={16} />
          Sign Out
        </Button>
      </div>

      {showPhotoViewer && (
  <div
    className="fixed inset-0 z-[60] bg-black flex items-center justify-center"
    onClick={() => setShowPhotoViewer(false)}
  >
    <img
      src={getFullSizeUrl(user.photoURL!)}
      alt={displayName}
      className="max-w-full max-h-full object-contain"
      onClick={(e) => e.stopPropagation()}
    />

    <button
      className="absolute top-5 right-5 text-white text-4xl"
      onClick={() => setShowPhotoViewer(false)}
    >
      ✕
    </button>

    <button
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
      className="absolute left-1/2 -translate-x-1/2 bg-primary text-white px-6 py-3 rounded-xl font-bold shadow-lg"
      onClick={(e) => {
        e.stopPropagation();
        setShowPhotoViewer(false);
        setShowAvatarMenu(true);
      }}
    >
      Change Photo
    </button>
  </div>
)}

      {showAreaPicker && (
        <AreaPickerSheet
          onSearchSelect={handleAreaPicked}
          resolving={resolvingArea}
          onDismiss={() => setShowAreaPicker(false)}
        />
      )}

      {showMarketerForm && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setShowMarketerForm(false)} />
          <div
  className="fixed bottom-0 left-0 right-0 z-[60] bg-card rounded-t-3xl border-t border-border px-4 pb-8 pt-4"
  style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
>
  <button
    onClick={() => setShowMarketerForm(false)}
    className="absolute top-4 right-4 w-8 h-8 rounded-full bg-muted flex items-center justify-center"
  >
    <X size={16} />
  </button>
  <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-5" />
  <p className="font-bold text-sm text-center mb-4">Apply to be a Marketer</p>

 <div className="space-y-3">
  <div>
    <label className="text-xs font-semibold text-muted-foreground">Full Name *</label>
    <input
      type="text"
      placeholder="e.g. Jane Wanjiru"
      value={marketerFullName}
      onChange={(e) => setMarketerFullName(e.target.value)}
      className="w-full h-11 mt-1 px-3 rounded-xl border border-border bg-background text-sm"
    />
  </div>

  <div>
    <label className="text-xs font-semibold text-muted-foreground">ID Number *</label>
  <input
    type="text"
    placeholder="National ID number"
    value={marketerIdNumber}
    onChange={(e) => setMarketerIdNumber(e.target.value)}
    className="w-full h-11 mt-1 px-3 rounded-xl border border-border bg-background text-sm"
  />
</div>

<div>
  <label className="text-xs font-semibold text-muted-foreground">M-Pesa Number *</label>
  <input
    type="tel"
    placeholder="e.g. 0712345678"
    value={marketerMpesaNumber}
    onChange={(e) => setMarketerMpesaNumber(e.target.value)}
    className="w-full h-11 mt-1 px-3 rounded-xl border border-border bg-background text-sm"
  />
</div>

<div>
  <label className="text-xs font-semibold text-muted-foreground">
    Why do you want to be a marketer? *
  </label>
  <textarea
    placeholder="Tell us a bit about yourself..."
    value={marketerReason}
    onChange={(e) => setMarketerReason(e.target.value)}
    maxLength={300}
    className="w-full mt-1 px-3 py-2 rounded-xl border border-border bg-background text-sm min-h-[80px]"
  />
</div>
<p className="text-[11px] text-muted-foreground leading-snug">
  Marketers are independent. You are not an employee or agent of BizMtaani, and income is not guaranteed. For adverts, the seller agrees your commission and pays you directly.
</p>
<Button
                onClick={() => setShowConfirmStep(true)}
                disabled={submittingApplication}
                className="w-full gap-2"
              >
                Review & Submit
              </Button>
              
              <button
                onClick={() => setShowMarketerForm(false)}
                className="w-full flex items-center justify-center px-4 py-2.5 text-sm text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {showConfirmStep && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setShowConfirmStep(false)} />
          <div
            className="fixed bottom-0 left-0 right-0 z-[60] bg-card rounded-t-3xl border-t border-border px-4 pb-8 pt-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
          >
            <p className="font-bold text-sm text-center mb-4">Confirm your details</p>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-semibold">{marketerFullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID Number</span>
                <span className="font-semibold">{marketerIdNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">M-Pesa Number</span>
                <span className="font-semibold">{marketerMpesaNumber}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              This is what we'll use to pay you — double check it's correct.
            </p>
            <Button
              onClick={() => {
                setShowConfirmStep(false);
                handleApplyForMarketer();
              }}
              disabled={submittingApplication}
              className="w-full mb-2"
            >
              {submittingApplication ? <Loader2 size={16} className="animate-spin" /> : "Confirm & Submit"}
            </Button>
            <button
              onClick={() => setShowConfirmStep(false)}
              className="w-full text-sm text-muted-foreground py-2"
            >
              Go back and edit
            </button>
          </div>
        </>
      )}

    </div>
  );
        }
