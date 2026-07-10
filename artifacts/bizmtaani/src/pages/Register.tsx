import { useState } from "react";
import { useLocation, Link } from "wouter";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getWardInfo } from "@/lib/location";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SiGoogle } from "react-icons/si";
import { Loader2, ChevronLeft, Store, User, MapPin } from "lucide-react";

type Step = 1 | 2;

interface HomeLocation {
  lat: number; lng: number;
  areaName: string; constituency: string; county: string;
}

/**
 * Try to geocode an area name → coordinates + ward info.
 * Times out in 4 s. Returns null on any failure — never throws.
 */
async function geocodeArea(area: string): Promise<HomeLocation | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(area.trim() + ", Kenya")}&limit=1`,
      { signal: controller.signal }
    );
    clearTimeout(tid);
    const results = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (!results.length) return null;
    const { lat, lon } = results[0];
    const c = { lat: parseFloat(lat), lng: parseFloat(lon) };
    const info = await getWardInfo(c.lat, c.lng);
    return {
      lat: c.lat,
      lng: c.lng,
      areaName: info?.wardName || area.trim(),
      constituency: info?.constituency ?? "",
      county: info?.county ?? "",
    };
  } catch {
    return null;
  }
}

async function saveUserProfile(
  uid: string,
  opts: {
    displayName: string;
    isBusinessOwner: boolean;
    businessName?: string;
    homeLocation?: HomeLocation;
  }
) {
  await setDoc(doc(db, "users", uid), {
    displayName: opts.displayName,
    isBusinessOwner: opts.isBusinessOwner,
    // --- ADD THESE LINES BELOW ---
    subscription: {
      planType: "freemium",
      expiryDate: null
    },
    // -----------------------------
    ...(opts.isBusinessOwner && opts.businessName
      ? { businessName: opts.businessName }
      : {}),
    ...(opts.homeLocation ? { homeLocation: opts.homeLocation } : {}),
    createdAt: serverTimestamp(),
  });
}



export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [isBusinessOwner, setIsBusinessOwner] = useState<boolean | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

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
    if (!area.trim()) {
      toast({ title: "Please enter your area / location", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password too short", description: "At least 6 characters.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Geocode area (4 s timeout, non-blocking on failure)
      const geo = await geocodeArea(area);
      const homeLocation: HomeLocation = geo ?? {
        lat: 0, lng: 0,
        areaName: area.trim(),
        constituency: "",
        county: "",
      };

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await saveUserProfile(cred.user.uid, {
        displayName: name.trim(),
        isBusinessOwner: isBusinessOwner ?? false,
        businessName: isBusinessOwner ? name.trim() : undefined,
        homeLocation,
      });

      // Send email verification — non-blocking (don't fail if this errors)
      sendEmailVerification(cred.user).catch(() => {});

      toast({
        title: "Account created!",
        description: "Check your email and click the verification link to unlock all features.",
      });

      setLocation("/");
    } catch (err: unknown) {
      toast({
        title: "Registration failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    if (!area.trim()) {
      toast({ title: "Please enter your area / location first", variant: "destructive" });
      return;
    }
    setGoogleLoading(true);
    try {
      const geo = await geocodeArea(area);
      const homeLocation: HomeLocation = geo ?? {
        lat: 0, lng: 0,
        areaName: area.trim(),
        constituency: "",
        county: "",
      };

      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await saveUserProfile(result.user.uid, {
        displayName: result.user.displayName ?? "BizMtaani User",
        isBusinessOwner: isBusinessOwner ?? false,
        businessName: isBusinessOwner ? (result.user.displayName ?? undefined) : undefined,
        homeLocation,
      });
      setLocation("/");
    } catch (err: unknown) {
      toast({
        title: "Google sign-in failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGoogleLoading(false);
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

            {/* ── Location field (required, shared between email & Google flows) ── */}
            <div className="bg-muted/50 border border-border rounded-2xl px-4 py-3 mb-5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <MapPin size={13} className="text-primary flex-shrink-0" />
                <Label htmlFor="area" className="text-xs font-bold text-foreground">
                  Your area / location *
                </Label>
              </div>
              <Input
                id="area"
                data-testid="input-area"
                placeholder="e.g. Kariobangi, Eastleigh, Githurai 45"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className="h-11 bg-background"
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Helps buyers find your ads and shows you nearby listings.
              </p>
            </div>

            <Button
              data-testid="button-google-register"
              type="button"
              variant="outline"
              className="w-full h-12 gap-3 font-semibold mb-6"
              onClick={handleGoogleLogin}
              disabled={googleLoading}
            >
              {googleLoading ? <Loader2 size={18} className="animate-spin" /> : <SiGoogle size={18} />}
              Continue with Google
            </Button>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-3 text-xs text-muted-foreground uppercase tracking-wider">or</span>
              </div>
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
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  data-testid="input-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
    </div>
  );
}
