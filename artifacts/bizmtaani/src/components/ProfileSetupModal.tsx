/**
 * Shown after Google sign-in when the user has no Firestore profile yet.
 * Asks: business owner or individual → name (if different from Google display name).
 */
import { useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { getWardInfo } from "@/lib/location";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Store, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function ProfileSetupModal() {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [isBusinessOwner, setIsBusinessOwner] = useState<boolean | null>(null);
  const [name, setName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!user) return;
    if (!name.trim()) {
      toast({ title: "Please enter a name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Try to detect location for home area
      let homeLocation: {
        lat: number; lng: number;
        areaName: string; constituency: string; county: string;
      } | undefined;

      try {
        const coords = await new Promise<GeolocationCoordinates>((res, rej) =>
          navigator.geolocation.getCurrentPosition((p) => res(p.coords), rej, {
            enableHighAccuracy: true, timeout: 8000, maximumAge: 0,
          })
        );
        const info = await getWardInfo(coords.latitude, coords.longitude);
        homeLocation = {
          lat: coords.latitude,
          lng: coords.longitude,
          areaName: info.wardName,
          constituency: info.constituency,
          county: info.county,
        };
      } catch {
        // Location permission denied — no home area saved
      }

      await setDoc(
        doc(db, "users", user.uid),
        {
          displayName: name.trim(),
          isBusinessOwner: isBusinessOwner ?? false,
          ...(isBusinessOwner ? { businessName: name.trim() } : {}),
          ...(homeLocation ? { homeLocation } : {}),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      await refreshProfile();
    } catch (err) {
      toast({ title: "Could not save profile", description: "Please try again.", variant: "destructive" });
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm" />
      <div
        className="fixed bottom-0 left-0 right-0 z-[71] bg-card rounded-t-3xl border-t border-border px-5 pt-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
      >
        <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-6" />

        {step === 1 && (
          <>
            <div className="mb-6">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <span className="text-2xl">👋</span>
              </div>
              <h2 className="font-black text-xl">One quick thing</h2>
              <p className="text-muted-foreground text-sm mt-1">
                How will you use BizMtaani?
              </p>
            </div>

            <div className="space-y-3 mb-6">
              <button
                onClick={() => { setIsBusinessOwner(true); setStep(2); }}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 border-border bg-muted/30 hover:border-primary hover:bg-primary/5 transition-all text-left active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Store size={20} className="text-primary" />
                </div>
                <div>
                  <p className="font-bold text-sm">Business owner</p>
                  <p className="text-xs text-muted-foreground">I sell products or services</p>
                </div>
              </button>

              <button
                onClick={() => { setIsBusinessOwner(false); setStep(2); }}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 border-border bg-muted/30 hover:border-primary hover:bg-primary/5 transition-all text-left active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <User size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-bold text-sm">Individual / Buyer</p>
                  <p className="text-xs text-muted-foreground">I'm looking to buy or discover local deals</p>
                </div>
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="mb-6">
              <h2 className="font-black text-xl">
                {isBusinessOwner ? "Your business name" : "Your name"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {isBusinessOwner
                  ? "This is the name buyers will see on your shop and listings"
                  : "How should other users identify you?"}
              </p>
            </div>

            <Input
              placeholder={isBusinessOwner ? "e.g. Mama Njeri Groceries" : "e.g. Jane Wanjiru"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 text-base mb-5"
              autoFocus
            />

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="h-12 px-5 rounded-xl border border-border font-semibold text-sm text-muted-foreground"
              >
                Back
              </button>
              <Button
                className="flex-1 h-12 font-black text-base rounded-xl"
                onClick={handleSave}
                disabled={saving || !name.trim()}
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : "Let's go →"}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
