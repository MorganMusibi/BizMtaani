import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { doc, getDoc } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { httpsCallable } from "firebase/functions";
import { Loader2, MapPin, Package } from "lucide-react";

interface ListingPreview {
  title: string;
  category: string;
  subcategory?: string;
  ward: string;
  constituency?: string;
  claimed?: boolean;
}

export default function ClaimListing() {
  const [, params] = useRoute("/claim/:listingId");
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const [listing, setListing] = useState<ListingPreview | null>(null);
  const [loadingListing, setLoadingListing] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [phone, setPhone] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch and show the listing immediately — no auth required, since
  // the products read rule is public. Signing in is only needed for
  // the actual claim action below.
  useEffect(() => {
    if (!params?.listingId) return;
    getDoc(doc(db, "products", params.listingId))
      .then((snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          return;
        }
        setListing(snap.data() as ListingPreview);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoadingListing(false));
  }, [params?.listingId]);

  async function handleClaim() {
    if (!params?.listingId || !phone.trim()) return;

    // Only gate here, at the point of actually claiming — not before.
    if (!user) {
      setLocation(`/register?redirect=${encodeURIComponent(`/claim/${params.listingId}`)}`);
      return;
    }

    setClaiming(true);
    setError(null);
    try {
      const claimListing = httpsCallable(functions, "claimListing");
      await claimListing({ listingId: params.listingId, phone: phone.trim() });
      setLocation(`/product/${params.listingId}`);
    } catch (err: any) {
      setError(err?.message ?? "Could not claim this listing.");
    } finally {
      setClaiming(false);
    }
  }

  if (loadingListing) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="p-6 text-center">
        <p className="font-bold">Listing not found</p>
        <p className="text-sm text-muted-foreground mt-1">
          This link may be invalid or the listing has been removed.
        </p>
      </div>
    );
  }

  if (listing.claimed) {
    return (
      <div className="p-6 text-center">
        <p className="font-bold">Already claimed</p>
        <p className="text-sm text-muted-foreground mt-1">
          This listing has already been claimed.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-md mx-auto">
      {/* Show the listing itself first — builds trust before asking for anything */}
      <div className="bg-card border border-border rounded-2xl p-4 mb-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Package size={14} />
          <span>{listing.subcategory || listing.category}</span>
        </div>
        <h1 className="text-xl font-black">{listing.title}</h1>
        <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
          <MapPin size={13} />
          <span>{listing.ward}{listing.constituency ? `, ${listing.constituency}` : ""}</span>
        </div>
      </div>

      <div className="bg-muted/50 border border-border rounded-2xl p-4">
        <p className="font-bold text-sm mb-1">This is your business listing on BizMtaani</p>
        <p className="text-xs text-muted-foreground mb-4">
          Enter the phone number it was registered with to claim it and manage it yourself.
        </p>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="07..."
          className="w-full h-11 px-3 border border-border rounded-xl mb-3 bg-background text-sm"
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          onClick={handleClaim}
          disabled={claiming || !phone.trim()}
          className="w-full h-11 bg-primary text-white rounded-xl font-bold disabled:opacity-50"
        >
          {claiming ? "Claiming..." : user ? "Claim this listing" : "Continue to claim"}
        </button>
        {!user && (
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            You'll create a free account to finish claiming it.
          </p>
        )}
      </div>
    </div>
  );
  }
