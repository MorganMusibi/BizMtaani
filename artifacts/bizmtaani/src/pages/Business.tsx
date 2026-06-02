/**
 * Business Management — dashboard for small business owners and service providers.
 * Accessible from Profile for users with isBusinessOwner = true.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  collection, query, where, getDocs, orderBy,
  doc, deleteDoc, updateDoc, limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, LayoutDashboard, Package, BarChart2,
  Phone, Share2, Plus, Loader2, Trash2, Edit3, Eye,
  Star, TrendingUp, ShoppingBag, MessageCircle, Store,
  ExternalLink, Check, X,
} from "lucide-react";

interface Listing {
  id: string;
  title: string;
  price: number;
  rentPerMonth?: number;
  category: string;
  imageUrl?: string;
  imageUrls?: string[];
  createdAt?: { seconds: number } | null;
  views?: number;
  priceType?: string;
}

type Tab = "overview" | "listings" | "profile";

export default function Business() {
  const [, navigate] = useLocation();
  const { user, userProfile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("overview");
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Profile editing
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(userProfile?.businessName || userProfile?.displayName || "");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    if (userProfile !== null && !userProfile?.isBusinessOwner) {
      navigate("/profile");
    }
  }, [user, userProfile]);

  useEffect(() => {
    if (!user) return;
    setListingsLoading(true);
    getDocs(
      query(
        collection(db, "products"),
        where("sellerId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(50)
      )
    ).then((snap) => {
      setListings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Listing)));
      setListingsLoading(false);
    }).catch(() => setListingsLoading(false));
  }, [user]);

  async function handleDelete(id: string) {
    if (!confirm("Remove this listing?")) return;
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, "products", id));
      setListings((prev) => prev.filter((l) => l.id !== id));
      toast({ title: "Listing removed" });
    } catch {
      toast({ title: "Could not delete", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveName() {
    if (!user || !newName.trim()) return;
    setSavingName(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        displayName: newName.trim(),
        businessName: newName.trim(),
      });
      await refreshProfile();
      setEditingName(false);
      toast({ title: "Business name updated" });
    } catch {
      toast({ title: "Could not update name", variant: "destructive" });
    } finally {
      setSavingName(false);
    }
  }

  function handleShare() {
    const url = `${window.location.origin}/shop/${user?.uid}`;
    if (navigator.share) {
      navigator.share({ title: userProfile?.businessName || "My Shop", url });
    } else {
      navigator.clipboard.writeText(url);
      toast({ title: "Shop link copied!" });
    }
  }

  const activeListings = listings.filter((l) => l.id);
  const totalValue = listings.reduce((sum, l) => sum + (l.rentPerMonth ?? l.price ?? 0), 0);

  const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "listings", label: "Listings", icon: Package },
    { key: "profile", label: "Business", icon: Store },
  ];

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button onClick={() => navigate("/profile")} className="p-1.5 rounded-xl hover:bg-muted transition-colors">
          <ChevronLeft size={22} />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <Store size={13} className="text-white" />
          </div>
          <span className="font-black text-base truncate">
            {userProfile?.businessName || "My Business"}
          </span>
          <span className="text-[10px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full flex-shrink-0">BIZ</span>
        </div>
        <button onClick={handleShare} className="p-2 rounded-xl hover:bg-muted transition-colors flex-shrink-0">
          <Share2 size={18} />
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex-shrink-0 bg-card border-b border-border flex">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-bold transition-colors border-b-2 ${
              tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            <Icon size={18} strokeWidth={tab === key ? 2.5 : 1.8} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-8">

        {/* ===== OVERVIEW ===== */}
        {tab === "overview" && (
          <div className="px-4 py-5 space-y-5">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={ShoppingBag} label="Active Listings" value={activeListings.length} color="text-primary bg-primary/10" />
              <StatCard icon={TrendingUp} label="Total Value (KES)" value={totalValue > 0 ? totalValue.toLocaleString() : "—"} color="text-secondary bg-secondary/10" />
              <StatCard icon={BarChart2} label="Avg. Price (KES)" value={
                listings.length > 0 ? Math.round(totalValue / listings.length).toLocaleString() : "—"
              } color="text-amber-600 bg-amber-100" />
              <StatCard icon={Star} label="Seller Type" value="Business" color="text-orange-600 bg-orange-100" />
            </div>

            {/* Quick actions */}
            <div>
              <p className="font-black text-sm mb-3">Quick Actions</p>
              <div className="space-y-2">
                <ActionRow
                  icon={Plus} label="Post a new product or service"
                  sub="Add a listing to your shop" onClick={() => navigate("/post")}
                />
                <ActionRow
                  icon={Eye} label="Preview my shop"
                  sub="See how buyers see your business" onClick={() => navigate(`/shop/${user?.uid}`)}
                />
                <ActionRow
                  icon={Share2} label="Share my shop link"
                  sub="Send customers directly to your listings" onClick={handleShare}
                />
                <ActionRow
                  icon={MessageCircle} label="View customer messages"
                  sub="Reply to buyers who messaged you" onClick={() => navigate("/chats")}
                />
                <ActionRow
                  icon={ExternalLink} label="Post a job listing"
                  sub="Recruit staff or freelancers" onClick={() => navigate("/jobs/post")}
                />
              </div>
            </div>

            {/* Tips */}
            <div className="bg-primary/5 border border-primary/20 rounded-2xl px-4 py-4 space-y-2">
              <p className="font-black text-sm text-primary">💡 Business tips</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li>• Add clear photos — listings with photos get 3× more views</li>
                <li>• Keep your phone number updated so buyers can reach you fast</li>
                <li>• Post regularly to stay at the top of local searches</li>
                <li>• Share your shop link on WhatsApp and social media</li>
              </ul>
            </div>
          </div>
        )}

        {/* ===== LISTINGS ===== */}
        {tab === "listings" && (
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-muted-foreground">{activeListings.length} listing{activeListings.length !== 1 ? "s" : ""}</p>
              <button
                onClick={() => navigate("/post")}
                className="flex items-center gap-1 text-xs font-bold text-primary"
              >
                <Plus size={14} />Add listing
              </button>
            </div>

            {listingsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            ) : listings.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                  <Package size={28} className="text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="font-bold">No listings yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Post your first product or service</p>
                </div>
                <Button onClick={() => navigate("/post")} className="gap-2">
                  <Plus size={16} />Post listing
                </Button>
              </div>
            ) : (
              listings.map((listing) => (
                <div key={listing.id} className="bg-card border border-border rounded-2xl p-3 flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                    {listing.imageUrls?.[0] || listing.imageUrl ? (
                      <img
                        src={listing.imageUrls?.[0] || listing.imageUrl}
                        alt={listing.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package size={20} className="text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm leading-tight line-clamp-1">{listing.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{listing.category}</p>
                    <p className="text-xs font-bold text-primary mt-1">
                      {listing.rentPerMonth
                        ? `KES ${listing.rentPerMonth.toLocaleString()}/mo`
                        : listing.price > 0
                        ? `KES ${listing.price.toLocaleString()}`
                        : "Quote only"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/product/${listing.id}`)}
                      className="p-2 rounded-xl hover:bg-muted transition-colors"
                    >
                      <Eye size={16} className="text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => handleDelete(listing.id)}
                      disabled={deletingId === listing.id}
                      className="p-2 rounded-xl hover:bg-destructive/10 text-destructive transition-colors"
                    >
                      {deletingId === listing.id
                        ? <Loader2 size={16} className="animate-spin" />
                        : <Trash2 size={16} />}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ===== BUSINESS PROFILE ===== */}
        {tab === "profile" && (
          <div className="px-4 py-5 space-y-5">
            {/* Business name */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-black text-sm">Business Name</p>
                {!editingName && (
                  <button onClick={() => { setNewName(userProfile?.businessName || ""); setEditingName(true); }}
                    className="flex items-center gap-1 text-xs font-semibold text-primary">
                    <Edit3 size={13} />Edit
                  </button>
                )}
              </div>
              {editingName ? (
                <div className="space-y-2">
                  <Input
                    value={newName} onChange={(e) => setNewName(e.target.value)}
                    placeholder="Your business name" className="h-11" autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setEditingName(false)} className="flex-1 h-9 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-1 text-muted-foreground">
                      <X size={14} />Cancel
                    </button>
                    <button onClick={handleSaveName} disabled={savingName}
                      className="flex-1 h-9 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1">
                      {savingName ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} />Save</>}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="font-bold text-lg">{userProfile?.businessName || userProfile?.displayName || "—"}</p>
              )}
            </div>

            {/* Shop link */}
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <p className="font-black text-sm">Your Shop Link</p>
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                <p className="text-xs text-muted-foreground flex-1 truncate">
                  {window.location.origin}/shop/{user?.uid?.slice(0, 12)}...
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleShare}
                  className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-2">
                  <Share2 size={15} />Share Shop
                </button>
                <button onClick={() => navigate(`/shop/${user?.uid}`)}
                  className="flex-1 h-10 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-2 text-muted-foreground">
                  <Eye size={15} />Preview
                </button>
              </div>
            </div>

            {/* Contact */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="font-black text-sm mb-3">Contact & Reach</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Phone size={15} className="text-green-700" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="text-sm font-semibold">{user?.phoneNumber || "Not set — add in your listings"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <MessageCircle size={15} className="text-blue-700" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Chat</p>
                    <p className="text-sm font-semibold">Buyers message you via in-app chat</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Danger zone */}
            <div className="border border-border rounded-2xl p-4">
              <p className="font-black text-sm text-destructive mb-1">Need help?</p>
              <p className="text-xs text-muted-foreground">
                To upgrade your account type or remove your business, visit your Profile settings.
              </p>
              <button onClick={() => navigate("/profile")} className="mt-3 text-sm font-semibold text-primary">
                Go to Profile →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof ShoppingBag; label: string; value: string | number; color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        <Icon size={18} />
      </div>
      <p className="font-black text-xl leading-none">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function ActionRow({ icon: Icon, label, sub, onClick }: {
  icon: typeof Plus; label: string; sub: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-border bg-card hover:bg-muted/40 transition-all text-left active:scale-[0.98]"
    >
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon size={17} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <ChevronLeft size={16} className="text-muted-foreground rotate-180 flex-shrink-0" />
    </button>
  );
}
