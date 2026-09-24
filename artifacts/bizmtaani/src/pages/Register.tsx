import { useState } from "react";
import { useLocation, Link } from "wouter";
import {
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";
import { getWardCoordinates } from "@/lib/location";
import { AreaPickerSheet } from "@/components/AreaPickerSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, Store, User, MapPin } from "lucide-react";

type Step = 1 | 2;

interface HomeLocation {
  lat: number | null; lng: number | null;
  areaName: string; constituency: string; county: string;
}

// Domain used only to satisfy Firebase Auth's email/password requirement.
// Never sent anywhere, never shown to the user, not a real mailbox.
const PHONE_AUTH_DOMAIN = "bizmtaani.local";

/**
 * Normalizes a Kenyan phone number to 2547XXXXXXXX / 2541XXXXXXXX format.
 * Accepts 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, +2547XXXXXXXX, 7XXXXXXXX.
 * Returns null if the input doesn't match a recognizable Kenyan mobile format.
 */
function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");

  if (/^(07|01)\d{8}$/.test(digits)) {
    return "254" + digits.slice(1);
  }
  if (/^254(7|1)\d{8}$/.test(digits)) {
    return digits;
  }
  if (/^(7|1)\d{8}$/.test(digits)) {
    return "254" + digits;
  }
  return null;
}

function phoneToAuthEmail(normalizedPhone: string): string {
  return `${normalizedPhone}@${PHONE_AUTH_DOMAIN}`;
}

async function saveUserProfile(
  uid: string,
  opts: {
    displayName: string;
    phone: string;
    isBusinessOwner: boolean;
    businessName?: string;
    homeLocation?: HomeLocation;
  }
) {
  await setDoc(doc(db, "users", uid), {
    displayName: opts.displayName,
    phone: opts.phone,
    isBusinessOwner: opts.isBusinessOwner,
    searchNameLower: (opts.isBusinessOwner && opts.businessName
      ? opts.businessName
      : opts.displayName
    ).trim().toLowerCase(),
    ...(opts.isBusinessOwner && opts.businessName
      ? { businessName: opts.businessName }
      : {}),
    ...(opts.homeLocation ? { homeLocation: opts.homeLocation } : {}),
    createdAt: serverTimestamp(),
  });
}

/**
 * Applies a referral code after account creation, if one was entered.
 * Deliberately non-blocking and silent on failure — an invalid or
 * already-used code should never prevent someone from signing up.
 */
async function applyReferralCodeIfPresent(code: string): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return true;

  if (!/^[A-Z]{1,6}[A-Z0-9]{3}$/.test(trimmed)) {
    console.warn("Referral code format invalid, skipping submission:", trimmed);
    return false;
  }

  try {
    const submitReferralCode = httpsCallable(functions, "submitReferralCode");
    await submitReferralCode({ code: trimmed });
    return true;
  } catch (error) {
    console.warn("Referral code could not be applied:", error);
    return false;
  }
}

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [isBusinessOwner, setIsBusinessOwner] = useState<boolean | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [selectedWard, setSelectedWard] = useState<{
    wardName: string;
    constituencyName: string;
    countyName: string;
  } | null>(null);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [resolvingArea, setResolvingArea] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const [loading, setLoading] = useState(false);

  async function handleAreaPicked(ward: {
    wardName: string;
    constituencyName: string;
    countyName: string;
  }) {
    setResolvingArea(true);
    try {
      const coords = await getWardCoordinates(
        ward.wardName,
        ward.constituencyName,
        ward.countyName
      );

      setSelectedWard(ward);

      if (!coords) {
        toast({
          title: "Area saved",
          description: "We couldn't pin it on the map, but your area is noted.",
        });
      }

      setShowAreaPicker(false);
    } finally {
      setResolvingArea(false);
    }
  }

  function handleTypeSelect(type: boolean) {
    setIsBusinessOwner(type);
    setStep(2);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Please enter your name", variant: "destructive" });
      return;
    }
    if (!selectedWard) {
      toast({ title: "Chagua eneo lako", variant: "destructive" });
      return;
    }
    const normalizedPhone = normalizeKenyanPhone(phone);
    if (!normalizedPhone) {
      toast({
        title: "Enter a valid phone number",
        description: "e.g. 0712 345 678",
        variant: "destructive",
      });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password too short", description: "At least 6 characters.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const coords = await getWardCoordinates(
        selectedWard.wardName,
        selectedWard.constituencyName,
        selectedWard.countyName
      );
      const homeLocation: HomeLocation = {
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        areaName: selectedWard.wardName,
        constituency: selectedWard.constituencyName,
        county: selectedWard.countyName,
      };

      const authEmail = phoneToAuthEmail(normalizedPhone);
      const cred = await createUserWithEmailAndPassword(auth, authEmail, password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await saveUserProfile(cred.user.uid, {
        displayName: name.trim(),
        phone: normalizedPhone,
        isBusinessOwner: isBusinessOwner ?? false,
        businessName: isBusinessOwner ? name.trim() : undefined,
        homeLocation,
      });

      applyReferralCodeIfPresent(referralCode).then((applied) => {
        if (referralCode.trim()) {
          console.log(`Referral code "${referralCode.trim()}" applied:`, applied);
        }
      });

      toast({
        title: "Account created!",
        description: "Welcome to BizMtaani.",
      });

      setLocation("/");
    } catch (err: unknown) {
      console.error("Registration failed:", err);

      // Firebase will report "email-already-in-use" for a duplicate phone —
      // reword it so it actually makes sense to the user.
      const rawMessage = getFirebaseErrorMessage(
        err,
        "Unable to create your account. Please try again."
      );
      const description = rawMessage.toLowerCase().includes("email")
        ? "This phone number is already registered. Try signing in instead."
        : rawMessage;

      toast({
        title: "Registration failed",
        description,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const nameLabel = isBusinessOwner === true ? "Business name" : "Your full name";
  const namePlaceholder = isBusinessOwner === true
    ? "e.g. Mama Njeri Groceries"
    : "e.g. Jane Wanjiru";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 py-10 max-w-sm mx-auto w-full">

        {/* Back button */}
        <button
          onClick={() => (step === 1 ? setLocation("/login") : setStep(1))}
          className="flex items-center gap-1 text-muted-foreground mb-8 hover:text-foreground transition-colors self-start"
        >
          <ChevronLeft size={18} />
          <span className="text-sm">{step === 1 ? "Back to login" : "Back"}</span>
        </button>

        {/* ========== STEP 1: Account type ========== */}
        {step === 1 && (
          <>
            <div className="mb-8">
              <div className="w-12 h-12 mb-5">
                <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                  <defs>
                    <linearGradient id="rbg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#047857"/>
                      <stop offset="100%" stopColor="#022C22"/>
                    </linearGradient>
                    <linearGradient id="raw" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FB923C"/>
                      <stop offset="100%" stopColor="#EA580C"/>
                    </linearGradient>
                  </defs>
                  <rect width="100" height="100" rx="22" fill="url(#rbg)"/>
                  <path d="M14 40 L50 24 L86 40 L82 49 L18 49 Z" fill="url(#raw)"/>
                  <rect x="18" y="47" width="64" height="34" rx="3" fill="white" opacity="0.97"/>
                  <rect x="23" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
                  <rect x="43" y="55" width="14" height="26" rx="2" fill="#065F46"/>
                  <rect x="62" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
                  <rect x="12" y="79" width="76" height="4" rx="2" fill="#F97316" opacity="0.45"/>
                </svg>
              </div>
              <h1 className="text-3xl font-black text-foreground">Join BizMtaani</h1>
              <p className="text-muted-foreground mt-1">First, how will you use the app?</p>
            </div>

            <div className="space-y-3 mb-8">
              <button
                onClick={() => handleTypeSelect(true)}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left active:scale-[0.98]"
              >
                <div className="w-11 h-11 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Store size={22} className="text-primary" />
                </div>
                <div>
                  <p className="font-bold">Business owner</p>
                  <p className="text-xs text-muted-foreground mt-0.5">I sell products or offer services</p>
                </div>
              </button>

              <button
                onClick={() => handleTypeSelect(false)}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left active:scale-[0.98]"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <User size={22} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-bold">Individual / Buyer</p>
                  <p className="text-xs text-muted-foreground mt-0.5">I'm buying or exploring nearby deals</p>
                </div>
              </button>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-semibold">Sign in</Link>
            </p>
          </>
        )}

        {/* ========== STEP 2: Credentials ========== */}
        {step === 2 && (
          <>
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-5">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isBusinessOwner ? "bg-orange-100" : "bg-blue-100"}`}>
                  {isBusinessOwner
                    ? <Store size={20} className="text-primary" />
                    : <User size={20} className="text-blue-600" />}
                </div>
                <span className="text-sm font-semibold text-muted-foreground">
                  {isBusinessOwner ? "Business owner" : "Individual / Buyer"}
                </span>
              </div>
              <h1 className="text-2xl font-black text-foreground">Create your account</h1>
              <p className="text-muted-foreground text-sm mt-1">
                {isBusinessOwner
                  ? "Use your business name so buyers can find you"
                  : "Choose a name that other users will see"}
              </p>
            </div>

            {/* ── Location field ── */}
            <div className="bg-muted/50 border border-border rounded-2xl px-4 py-3 mb-5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <MapPin size={13} className="text-primary flex-shrink-0" />
                <Label className="text-xs font-bold text-foreground">
                  Your area / location *
                </Label>
              </div>
              <button
                type="button"
                data-testid="button-select-area"
                onClick={() => setShowAreaPicker(true)}
                className="w-full h-11 px-3 rounded-xl bg-background border border-border text-left text-sm flex items-center"
              >
                {selectedWard ? (
                  <span className="font-semibold">
                    {selectedWard.wardName}, {selectedWard.constituencyName}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Tap to search your ward</span>
                )}
              </button>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Connect na wauzaji pamoja na wanunuzi karibu nawe.
              </p>
            </div>

            <div className="mb-5">
              <Label htmlFor="referralCode" className="text-xs font-bold text-foreground">
                Referral code (optional)
              </Label>
              <Input
                id="referralCode"
                data-testid="input-referral-code"
                placeholder="e.g. JANE7K2"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                className="h-11 mt-1.5"
              />
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">{nameLabel}</Label>
                <Input
                  id="name"
                  data-testid="input-name"
                  placeholder={namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-12"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  data-testid="input-phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="07XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="h-12"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12"
                />
              </div>
              <Button
                data-testid="button-register"
                type="submit"
                className="w-full h-12 font-bold text-base"
                disabled={loading}
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : "Create account"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-semibold">Sign in</Link>
            </p>
          </>
        )}
      </div>
      {showAreaPicker && (
        <AreaPickerSheet
          onSearchSelect={handleAreaPicked}
          resolving={resolvingArea}
          onDismiss={() => setShowAreaPicker(false)}
        />
      )}
    </div>
  );
}
