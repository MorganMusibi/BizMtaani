import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  collection, query, where, orderBy, onSnapshot, deleteDoc, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Package, Loader2, Store, RefreshCw, Clock } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { MpesaPaymentModal } from "@/components/MpesaPaymentModal";
import { initiateStkPush, type PaidListingPlan, PLAN_PHOTO_LIMITS, PLAN_AMOUNTS } from "@/lib/mpesa";

interface Product {
  id: string;
  title: string;
  price: number;
  rentPerMonth?: number;
  category: string;
  imageUrl: string;
  createdAt: { seconds: number } | null;
  expiresAt?: { seconds: number } | null;
  status?: string;
  plan?: string;
}

function getExpiryInfo(p: Product): { label: string; color: string; isExpired: boolean } | null {
  if (!p.expiresAt) return null;
  const nowSec = Date.now() / 1000;
  const diff = p.expiresAt.seconds - nowSec;
  if (diff < 0) return { label: "Expired", color: "text-destructive", isExpired: true };
  const days = Math.floor(diff / 86400);
  const hours = Math.ceil(diff / 3600);
  if (days <= 0) return { label: `${hours}h left`, color: "text-destructive", isExpired: false };
  if (days <= 2) return { label: `${days}d left`, color: "text-amber-600", isExpired: false };
  return { label: `${days}d left`, color: "text-[#00A651]", isExpired: false };
}

export default function MyListings() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null);

  // Renewal state
  const [renewProduct, setRenewProduct] = useState<Product | null>(null);
  const [renewPlan, setRenewPlan] = useState<PaidListingPlan>("basic");
  const [showRenewModal, setShowRenewModal] = useState(false);

  useEffect(() => {
    if (!user) { setLocation("/login"); return; }
    const q = query(collection(db, "products"), where("sellerId", "==", user.uid), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Product)));
      setLoading(false);
    });
  }, [user, setLocation]);

  async function confirmDelete() {
    if (!confirmProduct) return;
    const product = confirmProduct;
    setConfirmProduct(null);
    setDeleting(product.id);
    try {
      await deleteDoc(doc(db, "products", product.id));
      toast({ title: "Listing deleted" });
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setDeleting(null); }
  }

  async function handleRenewInitiate(phone: string): Promise<{ checkoutRequestId: string; productId: string }> {
    if (!renewProduct) throw new Error("No product selected");
    const result = await initiateStkPush({ phone, plan: renewPlan, productId: renewProduct.id });
    return { checkoutRequestId: result.checkoutRequestId, productId: renewProduct.id };
  }

  // Separate active vs expired
  const activeProducts = products.filter((p) => p.status !== "pending_payment");
  const expiredProducts = activeProducts.filter((p) => {
    const info = getExpiryInfo(p);
    return info?.isExpired;
  });
  const liveProducts = activeProducts.filter((p) => {
    const info = getExpiryInfo(p);
    return !info?.isExpired;
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center justify-between">
        <h1 className="font-black text-lg">My Listings</h1>
        <div className="flex items-center gap-2">
          {products.length > 0 && (
            <button onClick={() => setLocation(`/shop/${user?.uid}`)}
              className="flex items-center gap-1.5 text-xs text-primary font-semibold px-3 py-1.5 rounded-xl bg-primary/10">
              <Store size={13} />My Shop
            </button>
          )}
          <Button data-testid="button-post-product" size="sm" className="gap-1.5 font-semibold" onClick={() => setLocation("/post")}>
            <Plus size={16} />Post
          </Button>
        </div>
      </header>

      <div className="px-4 py-4 max-w-lg mx-auto space-y-6">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-primary" /></div>
        ) : activeProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
              <Package size={36} className="text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-bold text-lg">No listings yet</p>
              <p className="text-muted-foreground text-sm mt-1">Pay KES 60 to post your first advert for 7 days</p>
            </div>
            <Button data-testid="button-first-post" onClick={() => setLocation("/post")} className="gap-2">
              <Plus size={16} />Post a Product
            </Button>
          </div>
        ) : (
          <>
            {/* Live listings */}
            {liveProducts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#00A651]" />
                  <p className="text-sm font-black text-muted-foreground uppercase tracking-wide">Live ({liveProducts.length})</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {liveProducts.map((product) => {
                    const expiry = getExpiryInfo(product);
                    return (
                      <div key={product.id} data-testid={`card-product-${product.id}`}
                        className="bg-card rounded-2xl border border-border overflow-hidden">
                        <Link href={`/product/${product.id}`}>
                          {product.imageUrl ? (
                            <img src={product.imageUrl} alt={product.title} className="w-full aspect-square object-cover" />
                          ) : (
                            <div className="w-full aspect-square bg-muted flex items-center justify-center">
                              <Package size={28} className="text-muted-foreground" />
                            </div>
                          )}
                        </Link>
                        <div className="p-3">
                          <p data-testid={`text-title-${product.id}`} className="font-bold text-sm line-clamp-1">{product.title}</p>
                          <p data-testid={`text-price-${product.id}`} className="text-primary font-bold text-sm mt-0.5">
                            {(product.rentPerMonth ?? product.price) > 0
                              ? `KES ${(product.rentPerMonth ?? product.price).toLocaleString()}`
                              : "Quote only"}
                          </p>
                          {expiry && (
                            <div className={`flex items-center gap-1 mt-1 text-[10px] font-bold ${expiry.color}`}>
                              <Clock size={10} />
                              {expiry.label}
                            </div>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <button data-testid={`button-delete-${product.id}`}
                              onClick={() => setConfirmProduct(product)} disabled={deleting === product.id}
                              className="flex items-center gap-1 text-destructive text-xs font-medium hover:opacity-70 transition-opacity">
                              {deleting === product.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              Delete
                            </button>
                            {expiry && !expiry.isExpired && (
                              <button onClick={() => { setRenewProduct(product); setRenewPlan((product.plan === "premium" ? "premium" : "basic") as PaidListingPlan); }}
                                className="flex items-center gap-1 text-[#00A651] text-xs font-bold">
                                <RefreshCw size={11} />Renew
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Expired listings */}
            {expiredProducts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-destructive" />
                  <p className="text-sm font-black text-muted-foreground uppercase tracking-wide">Expired ({expiredProducts.length})</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {expiredProducts.map((product) => (
                    <div key={product.id} className="bg-card rounded-2xl border border-destructive/20 overflow-hidden opacity-70">
                      <div className="relative">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.title} className="w-full aspect-square object-cover grayscale" />
                        ) : (
                          <div className="w-full aspect-square bg-muted flex items-center justify-center">
                            <Package size={28} className="text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                          <span className="bg-destructive text-white text-[10px] font-black px-2 py-1 rounded-full">EXPIRED</span>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="font-bold text-sm line-clamp-1">{product.title}</p>
                        <div className="flex items-center justify-between mt-2">
                          <button onClick={() => setConfirmProduct(product)} disabled={deleting === product.id}
                            className="flex items-center gap-1 text-destructive text-xs font-medium hover:opacity-70 transition-opacity">
                            {deleting === product.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            Delete
                          </button>
                          <button onClick={() => { setRenewProduct(product); setRenewPlan((product.plan === "premium" ? "premium" : "basic") as PaidListingPlan); }}
                            className="flex items-center gap-1 text-[#00A651] text-xs font-bold">
                            <RefreshCw size={11} />Renew
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Renew plan selector */}
      {renewProduct && !showRenewModal && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex flex-col justify-end">
          <div className="bg-card rounded-t-3xl border-t border-border px-5 pt-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
            <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-4" />
            <p className="font-black text-base mb-1">Renew Listing</p>
            <p className="text-sm text-muted-foreground mb-4 line-clamp-1">{renewProduct.title}</p>
            <div className="flex gap-3 mb-5">
              {(["basic", "premium"] as PaidListingPlan[]).map((p) => (
                <button key={p} onClick={() => setRenewPlan(p)}
                  className={`flex-1 py-3 rounded-2xl border-2 text-center transition-all ${
                    renewPlan === p ? "border-primary bg-primary/5" : "border-border"
                  }`}>
                  <p className="font-black text-sm capitalize">{p}</p>
                  <p className="text-xs text-muted-foreground">{PLAN_PHOTO_LIMITS[p]} photos · 7 days</p>
                  <p className="font-black text-primary mt-1">KES {PLAN_AMOUNTS[p]}</p>
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRenewProduct(null)}
                className="flex-1 py-3 rounded-2xl border-2 border-border text-sm font-semibold text-muted-foreground">
                Cancel
              </button>
              <button onClick={() => setShowRenewModal(true)}
                className="flex-1 py-3 rounded-2xl text-sm font-black text-white"
                style={{ backgroundColor: "#00A651" }}>
                Pay KES {PLAN_AMOUNTS[renewPlan]} & Renew
              </button>
            </div>
          </div>
        </div>
      )}

      <MpesaPaymentModal
        open={showRenewModal}
        onClose={() => setShowRenewModal(false)}
        plan={renewPlan}
        defaultPhone={user?.phoneNumber || ""}
        onInitiate={handleRenewInitiate}
        onSuccess={() => {
          toast({ title: "Listing renewed!", description: "Your advert is live for another 7 days." });
          setRenewProduct(null);
          setShowRenewModal(false);
        }}
      />

      <AlertDialog open={!!confirmProduct} onOpenChange={(open) => { if (!open) setConfirmProduct(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete listing?</AlertDialogTitle>
            <AlertDialogDescription>"{confirmProduct?.title}" will be permanently removed from the marketplace.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete" onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );
}
