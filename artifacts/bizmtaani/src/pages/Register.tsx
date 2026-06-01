import { useState } from "react";
import { useLocation, Link } from "wouter";
import {
  createUserWithEmailAndPassword,
  updateProfile,
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
import { Loader2, ChevronLeft, Store, User } from "lucide-react";

type Step = 1 | 2;

async function tryGetLocation() {
  try {
    const pos = await new Promise<GeolocationPosition>((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, {
        enableHighAccuracy: true, timeout: 8000, maximumAge: 0,
      })
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
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
  }
) {
  let homeLocation: {
    lat: number; lng: number;
    areaName: string; constituency: string; county: string;
  } | undefined;

  const coords = await tryGetLocation();
  if (coords) {
    const info = await getWardInfo(coords.lat, coords.lng);
    homeLocation = {
      lat: coords.lat,
      lng: coords.lng,
      areaName: info.wardName,
      constituency: info.constituency,
      county: info.county,
    };
  }

  await setDoc(doc(db, "users", uid), {
    displayName: opts.displayName,
    isBusinessOwner: opts.isBusinessOwner,
    ...(opts.isBusinessOwner && opts.businessName
      ? { businessName: opts.businessName }
      : {}),
    ...(homeLocation ? { homeLocation } : {}),
    createdAt: serverTimestamp(),
  });
}

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [isBusinessOwner, setIsBusinessOwner] = useState<boolean | null>(null);
  const [name, setName] = useState("");
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
    if (password.length < 6) {
      toast({ title: "Password too short", description: "At least 6 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await saveUserProfile(cred.user.uid, {
        displayName: name.trim(),
        isBusinessOwner: isBusinessOwner ?? false,
        businessName: isBusinessOwner ? name.trim() : undefined,
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
    setGoogleLoading(true);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      // Save profile — ProfileSetupModal in App.tsx will catch users with no profile
      // but we can pre-save with detected location right now:
      await saveUserProfile(result.user.uid, {
        displayName: result.user.displayName ?? "BizMtaani User",
        isBusinessOwner: isBusinessOwner ?? false,
        businessName: isBusinessOwner ? (result.user.displayName ?? undefined) : undefined,
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
              <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center mb-5">
                <span className="text-white text-xl font-black">B</span>
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
            <div className="mb-8">
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
