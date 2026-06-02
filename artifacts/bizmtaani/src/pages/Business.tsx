/**
 * Business Management — dashboard for sellers.
 * Tabs: Overview · Orders · Inventory · Inquiries · Profile
 */
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  collection, query, where, getDocs, orderBy,
  doc, updateDoc, limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, LayoutDashboard, Package, Store,
  Share2, Plus, Loader2, Edit3, Eye,
  Star, TrendingUp, ShoppingBag, MessageCircle,
  ExternalLink, Check, X, Inbox, ChevronRight,
  ClipboardList, AlertCircle,
} from "lucide-react";
import { auth } from "@/lib/firebase";

// ── types ────────────────────────────────────────────────────────────────────
interface Listing {
  id: string;
  title: string;
  price: number;
  rentPerMonth?: number;
  category: string;
  imageUrl?: string;
  imageUrls?: string[];
  createdAt?: { seconds: number } | null;
  stockQty?: number | null;
  trackStock?: boolean;
  status?: string;
  expiresAt?: { seconds: number } | null;
}

interface Order {
  id: string;
  listingId: string;
  listingTitle: string;
  listingImage?: string;
  buyerId: string;
  buyerName: string;
  buyerPhone: string;
  sellerId: string;
  amount: number;
  note: string;
  status: "pending" | "confirmed" | "rejected" | "completed";
  createdAt?: { seconds: number } | null;
}

interface InquiryGroup {
  productId: string;
  productTitle: string;
  productImage?: string;
  count: number;
  unreadCount: number;
  lastActivity?: { seconds: number };
}

type Tab = "overview" | "orders" | "inventory" | "inquiries" | "profile";

// ── helpers ───────────────────────────────────────────────────────────────────
function timeAgo(seconds: number): string {
  const d = Math.floor(Date.now() / 1000) - seconds;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

async function apiRequest(path: string, options?: RequestInit) {
  const token = await auth.currentUser?.getIdToken();
  return fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options?.headers },
  });
}

const STATUS_COLORS: Record<Order["status"], string> = {
  pending: "text-amber-700 bg-amber-100",
  confirmed: "text-blue-700 bg-blue-100",
  completed: "text-[#00A651] bg-[#00A651]/10",
  rejected: "text-destructive bg-destructive/10",
};

// ── component ─────────────────────────────────────────────────────────────────
export default function Business() {
  const [, navigate] = useLocation();
  const { user, userProfile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("overview");

  // listings / inventory
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [stockInput, setStockInput] = useState("");
  const [savingStock, setSavingStock] = useState(false);

  // orders
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);

  // inquiries
  const [inquiries, setInquiries] = useState<InquiryGroup[]>([]);
  const [inquiriesLoading, setInquiriesLoading] = useState(true);

  // profile editing
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(userProfile?.businessName || userProfile?.displayName || "");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    if (userProfile !== null && !userProfile?.isBusinessOwner) navigate("/profile");
  }, [user, userProfile]);

  // fetch listings
  useEffect(() => {
    if (!user) return;
    setListingsLoading(true);
    getDocs(query(collection(db, "products"), where("sellerId", "==", user.uid), orderBy("createdAt", "desc"), limit(50)))
      .then((snap) => setListings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Listing))))
      .catch(() => {})
      .finally(() => setListingsLoading(false));
  }, [user]);

  // fetch orders
  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setOrdersLoading(true);
    try {
      const res = await apiRequest("/api/orders/seller");
      if (res.ok) {
        const data = await res.json() as { orders: Order[] };
        setOrders(data.orders);
      }
    } catch { /* non-fatal */ } finally { setOrdersLoading(false); }
  }, [user]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // fetch inquiries
  useEffect(() => {
    if (!user) return;
    setInquiriesLoading(true);
    getDocs(query(collection(db, "chats"), where("sellerId", "==", user.uid))).then((snap) => {
      const map = new Map<string, InquiryGroup>();
      for (const d of snap.docs) {
        const data = d.data();
        if (!data.productId) continue;
        if (!map.has(data.productId)) {
          map.set(data.productId, {
            productId: data.productId, productTitle: data.productTitle || "Listing",
            productImage: data.productImage, count: 0, unreadCount: 0,
            lastActivity: data.updatedAt ?? data.createdAt ?? null,
          });
        }
        const g = map.get(data.productId)!;
        g.count++;
        if (data.lastSenderId && data.lastSenderId !== user.uid) g.unreadCount++;
        const ts = (data.updatedAt ?? data.createdAt)?.seconds ?? 0;
        if (ts > (g.lastActivity?.seconds ?? 0)) g.lastActivity = data.updatedAt ?? data.createdAt;
      }
      setInquiries([...map.values()].sort((a, b) => (b.lastActivity?.seconds ?? 0) - (a.lastActivity?.seconds ?? 0)));
    }).catch(() => {}).finally(() => setInquiriesLoading(false));
  }, [user]);

  async function handleUpdateOrderStatus(orderId: string, status: Order["status"]) {
    setUpdatingOrder(orderId);
    try {
      const res = await apiRequest(`/api/orders/${orderId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (res.ok) {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status } : o));
        toast({ title: status === "confirmed" ? "Order confirmed!" : status === "completed" ? "Order completed!" : "Order rejected" });
      } else {
        toast({ title: "Failed to update order", variant: "destructive" });
      }
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setUpdatingOrder(null); }
  }

  async function handleSaveStock(listingId: string) {
    const qty = parseInt(stockInput);
    if (isNaN(qty) || qty < 0) { toast({ title: "Enter a valid quantity", variant: "destructive" }); return; }
    setSavingStock(true);
    try {
      await updateDoc(doc(db, "products", listingId), { stockQty: qty, trackStock: true });
      setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, stockQty: qty, trackStock: true } : l));
      setEditingStock(null);
      toast({ title: "Stock updated" });
    } catch { toast({ title: "Could not update stock", variant: "destructive" }); }
    finally { setSavingStock(false); }
  }

  async function handleSaveName() {
    if (!user || !newName.trim()) return;
    setSavingName(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { displayName: newName.trim(), businessName: newName.trim() });
      await refreshProfile();
      setEditingName(false);
      toast({ title: "Business name updated" });
    } catch { toast({ title: "Could not update name", variant: "destructive" }); }
    finally { setSavingName(false); }
  }

  function handleShare() {
    const url = `${window.location.origin}/shop/${user?.uid}`;
    if (navigator.share) navigator.share({ title: userProfile?.businessName || "My Shop", url });
    else { navigator.clipboard.writeText(url); toast({ title: "Shop link copied!" }); }
  }

  const pendingOrders = orders.filter((o) => o.status === "pending").length;
  const activeListings = listings.filter((l) => l.status === "active").length;
  const totalValue = listings.reduce((sum, l) => sum + (l.rentPerMonth ?? l.price ?? 0), 0);
  const totalInquiries = inquiries.reduce((s, g) => s + g.count, 0);
  const unreadInquiries = inquiries.filter((g) => g.unreadCount > 0).length;

  const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard; badge?: number }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "orders", label: "Orders", icon: ClipboardList, badge: pendingOrders || undefined },
    { key: "inventory", label: "Stock", icon: Package },
    { key: "inquiries", label: "Chats", icon: Inbox, badge: unreadInquiries || undefined },
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
          <span className="font-black text-base truncate">{userProfile?.businessName || "My Business"}</span>
          <span className="text-[10px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full flex-shrink-0">BIZ</span>
        </div>
        <button onClick={handleShare} className="p-2 rounded-xl hover:bg-muted transition-colors flex-shrink-0">
          <Share2 size={18} />
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex-shrink-0 bg-card border-b border-border flex overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon, badge }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 min-w-[64px] flex flex-col items-center justify-center gap-1 py-3 text-xs font-bold transition-colors border-b-2 relative ${
              tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}>
            <div className="relative">
              <Icon size={18} strokeWidth={tab === key ? 2.5 : 1.8} />
              {badge != null && badge > 0 && (
                <span className="absolute -top-1.5 -right-2 text-[9px] font-black bg-destructive text-white min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
                  {badge}
                </span>
              )}
            </div>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-8">

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div className="px-4 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={ShoppingBag} label="Active Listings" value={activeListings} color="text-primary bg-primary/10" />
              <StatCard icon={ClipboardList} label="Pending Orders" value={pendingOrders} color="text-amber-600 bg-amber-100" badge={pendingOrders > 0 ? "Action needed" : undefined} />
              <StatCard icon={TrendingUp} label="Total Value (KES)" value={totalValue > 0 ? totalValue.toLocaleString() : "—"} color="text-secondary bg-secondary/10" />
              <StatCard icon={Star} label="Seller Type" value="Business" color="text-orange-600 bg-orange-100" />
            </div>

            {pendingOrders > 0 && (
              <button onClick={() => setTab("orders")}
                className="w-full flex items-center gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-left">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <ClipboardList size={17} className="text-amber-700" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-sm text-amber-700">{pendingOrders} order{pendingOrders > 1 ? "s" : ""} waiting</p>
                  <p className="text-xs text-muted-foreground">Confirm or reject buyer orders</p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>
            )}

            <div>
              <p className="font-black text-sm mb-3">Quick Actions</p>
              <div className="space-y-2">
                <ActionRow icon={Plus} label="Post a new product or service" sub="Add a listing to your shop" onClick={() => navigate("/post")} />
                <ActionRow icon={Eye} label="Preview my shop" sub="See how buyers see your business" onClick={() => navigate(`/shop/${user?.uid}`)} />
                <ActionRow icon={Share2} label="Share my shop link" sub="Send customers directly to your listings" onClick={handleShare} />
                <ActionRow icon={MessageCircle} label="View customer messages" sub="Reply to buyers who messaged you" onClick={() => navigate("/chats")} />
                <ActionRow icon={ExternalLink} label="Post a job listing" sub="Recruit staff or freelancers" onClick={() => navigate("/jobs/post")} />
              </div>
            </div>
          </div>
        )}

        {/* ── ORDERS ── */}
        {tab === "orders" && (
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-muted-foreground">{orders.length} order{orders.length !== 1 ? "s" : ""}</p>
              <button onClick={fetchOrders} className="text-xs font-semibold text-primary">Refresh</button>
            </div>

            {ordersLoading ? (
              <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-primary" /></div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                  <ClipboardList size={28} className="text-muted-foreground" />
                </div>
                <p className="font-bold">No orders yet</p>
                <p className="text-sm text-muted-foreground">When buyers place orders on your listings, they'll appear here</p>
              </div>
            ) : (
              orders.map((order) => (
                <div key={order.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    {order.listingImage ? (
                      <img src={order.listingImage} alt={order.listingTitle} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        <Package size={20} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm line-clamp-1">{order.listingTitle}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {order.buyerName || "Buyer"} {order.buyerPhone ? `· ${order.buyerPhone}` : ""}
                      </p>
                      <p className="font-black text-primary text-sm mt-1">KES {order.amount.toLocaleString()}</p>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full capitalize flex-shrink-0 ${STATUS_COLORS[order.status]}`}>
                      {order.status}
                    </span>
                  </div>

                  {order.note && (
                    <p className="text-xs text-muted-foreground bg-muted rounded-xl px-3 py-2 italic">"{order.note}"</p>
                  )}

                  {order.createdAt && (
                    <p className="text-[10px] text-muted-foreground">{timeAgo(order.createdAt.seconds)}</p>
                  )}

                  {order.status === "pending" && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleUpdateOrderStatus(order.id, "rejected")}
                        disabled={updatingOrder === order.id}
                        className="flex-1 h-9 rounded-xl border-2 border-border text-sm font-bold text-muted-foreground flex items-center justify-center gap-1 disabled:opacity-50">
                        {updatingOrder === order.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                        Reject
                      </button>
                      <button
                        onClick={() => handleUpdateOrderStatus(order.id, "confirmed")}
                        disabled={updatingOrder === order.id}
                        className="flex-1 h-9 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-50">
                        {updatingOrder === order.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        Confirm
                      </button>
                    </div>
                  )}

                  {order.status === "confirmed" && (
                    <button
                      onClick={() => handleUpdateOrderStatus(order.id, "completed")}
                      disabled={updatingOrder === order.id}
                      className="w-full h-9 rounded-xl border-2 border-[#00A651] text-[#00A651] text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-50">
                      {updatingOrder === order.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Mark as Completed
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── INVENTORY / STOCK ── */}
        {tab === "inventory" && (
          <div className="px-4 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">Track stock for physical products. Leave blank for services.</p>

            {listingsLoading ? (
              <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-primary" /></div>
            ) : listings.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                  <Package size={28} className="text-muted-foreground" />
                </div>
                <p className="font-bold">No listings yet</p>
                <Button onClick={() => navigate("/post")} className="gap-2"><Plus size={16} />Post listing</Button>
              </div>
            ) : (
              listings.map((listing) => {
                const isLow = listing.trackStock && typeof listing.stockQty === "number" && listing.stockQty <= 5;
                const isEditing = editingStock === listing.id;
                return (
                  <div key={listing.id} className="bg-card border border-border rounded-2xl p-3 flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                      {listing.imageUrls?.[0] || listing.imageUrl ? (
                        <img src={listing.imageUrls?.[0] || listing.imageUrl} alt={listing.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Package size={18} className="text-muted-foreground" /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm line-clamp-1">{listing.title}</p>
                      {isEditing ? (
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            type="number" min="0" value={stockInput}
                            onChange={(e) => setStockInput(e.target.value)}
                            className="h-8 w-20 text-sm" placeholder="Qty" autoFocus
                          />
                          <button onClick={() => handleSaveStock(listing.id)} disabled={savingStock}
                            className="h-8 px-3 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-50">
                            {savingStock ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                          </button>
                          <button onClick={() => setEditingStock(null)} className="h-8 px-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1">
                          {listing.trackStock && typeof listing.stockQty === "number" ? (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isLow ? "text-amber-700 bg-amber-100" : "text-[#00A651] bg-[#00A651]/10"}`}>
                              {isLow && <AlertCircle size={9} className="inline mr-0.5" />}
                              {listing.stockQty} in stock
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not tracked</span>
                          )}
                        </div>
                      )}
                    </div>
                    {!isEditing && (
                      <button onClick={() => { setEditingStock(listing.id); setStockInput(String(listing.stockQty ?? "")); }}
                        className="p-2 rounded-xl hover:bg-muted transition-colors flex-shrink-0">
                        <Edit3 size={15} className="text-muted-foreground" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── INQUIRIES ── */}
        {tab === "inquiries" && (
          <div className="px-4 py-4 space-y-4">
            <p className="text-sm font-bold text-muted-foreground">
              {totalInquiries} {totalInquiries === 1 ? "inquiry" : "inquiries"} across {inquiries.length} {inquiries.length === 1 ? "listing" : "listings"}
            </p>

            {inquiriesLoading ? (
              <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-primary" /></div>
            ) : inquiries.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                  <Inbox size={28} className="text-muted-foreground" />
                </div>
                <p className="font-bold">No inquiries yet</p>
                <p className="text-sm text-muted-foreground">Buyers will message you here when interested</p>
              </div>
            ) : (
              inquiries.map((group) => (
                <button key={group.productId} onClick={() => navigate("/chats")}
                  className="w-full bg-card border border-border rounded-2xl p-3.5 flex items-center gap-3 text-left active:scale-[0.99] transition-transform">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                    {group.productImage ? (
                      <img src={group.productImage} alt={group.productTitle} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Package size={20} className="text-muted-foreground" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm line-clamp-1 flex-1">{group.productTitle}</p>
                      {group.unreadCount > 0 && (
                        <span className="flex-shrink-0 text-[10px] font-black bg-destructive text-white px-1.5 py-0.5 rounded-full">{group.unreadCount} new</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageCircle size={11} />{group.count} {group.count === 1 ? "buyer" : "buyers"}
                      </span>
                      {group.lastActivity && <span className="text-xs text-muted-foreground">{timeAgo(group.lastActivity.seconds)}</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        )}

        {/* ── PROFILE ── */}
        {tab === "profile" && (
          <div className="px-4 py-5 space-y-5">
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
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Your business name" className="h-11" autoFocus />
                  <div className="flex gap-2">
                    <button onClick={() => setEditingName(false)} className="flex-1 h-9 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-1 text-muted-foreground">
                      <X size={14} />Cancel
                    </button>
                    <button onClick={handleSaveName} disabled={savingName} className="flex-1 h-9 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1">
                      {savingName ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} />Save</>}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="font-bold text-lg">{userProfile?.businessName || userProfile?.displayName || "—"}</p>
              )}
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <p className="font-black text-sm">Your Shop Link</p>
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                <p className="text-xs text-muted-foreground flex-1 truncate">
                  {window.location.origin}/shop/{user?.uid?.slice(0, 12)}...
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleShare} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-2">
                  <Share2 size={15} />Share Shop
                </button>
                <button onClick={() => navigate(`/shop/${user?.uid}`)} className="flex-1 h-10 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-2 text-muted-foreground">
                  <Eye size={15} />Preview
                </button>
              </div>
            </div>

            <div className="border border-border rounded-2xl p-4">
              <p className="font-black text-sm text-destructive mb-1">Need help?</p>
              <p className="text-xs text-muted-foreground">To change your account type or remove your business, visit your Profile settings.</p>
              <button onClick={() => navigate("/profile")} className="mt-3 text-sm font-semibold text-primary">Go to Profile →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, badge }: {
  icon: typeof ShoppingBag; label: string; value: string | number; color: string; badge?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        <Icon size={18} />
      </div>
      <p className="font-black text-xl leading-none">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {badge && <span className="mt-1.5 inline-block text-[10px] font-bold text-amber-700">{badge}</span>}
    </div>
  );
}

function ActionRow({ icon: Icon, label, sub, onClick }: {
  icon: typeof Plus; label: string; sub: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-border bg-card hover:bg-muted/40 transition-all text-left active:scale-[0.98]">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon size={17} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
    </button>
  );
}
