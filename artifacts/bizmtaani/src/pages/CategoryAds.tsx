import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  collection, query, where, orderBy, limit, startAfter, getDocs,
  QueryDocumentSnapshot, DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ChevronLeft, Loader2, Package, MapPin } from "lucide-react";
import { getCategoryDef, getCategoryBadgeColor } from "@/lib/categories";
import type { Product } from "@/hooks/useHomeFeed";

const PAGE_SIZE = 20;
type Cursor = QueryDocumentSnapshot<DocumentData>;

function getThumbnailUrl(url: string): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_500,c_fill/");
  }
  return url;
}

function toProducts(docs: QueryDocumentSnapshot<DocumentData>[]): Product[] {
  const nowSec = Date.now() / 1000;
  return docs
    .map((d) => ({ id: d.id, ...d.data() } as Product))
    .filter((p) => {
      if (p.status && p.status !== "active") return false;
      if (p.expiresAt && p.expiresAt.seconds <= nowSec) return false;
      return true;
    });
}

export default function CategoryAds() {
  const { categoryKey, subcategory } = useParams<{ categoryKey: string; subcategory: string }>();
  const [, navigate] = useLocation();

  const catDef = categoryKey ? getCategoryDef(decodeURIComponent(categoryKey)) : undefined;
  const subName = subcategory ? decodeURIComponent(subcategory) : "";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!catDef || !subName) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, "products"),
          where("category", "==", catDef.key),
          where("subcategory", "==", subName),
          where("status", "==", "active"),
          orderBy("createdAt", "desc"),
          limit(PAGE_SIZE)
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        const items = toProducts(snap.docs);
        setProducts(items);
        setCursor(snap.docs[snap.docs.length - 1] ?? null);
        setDone(snap.docs.length < PAGE_SIZE);
      } catch (error) {
        console.error("Failed to load category ads:", error);
        setProducts([]);
        setDone(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [catDef?.key, subName]);

  async function loadMore() {
    if (!catDef || !subName || done || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const q = query(
        collection(db, "products"),
        where("category", "==", catDef.key),
        where("subcategory", "==", subName),
        where("status", "==", "active"),
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const items = toProducts(snap.docs);
      setProducts((prev) => [...prev, ...items]);
      setCursor(snap.docs[snap.docs.length - 1] ?? cursor);
      setDone(snap.docs.length < PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load more category ads:", error);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!catDef) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground">Category not found.</p>
        <button onClick={() => navigate("/")} className="text-primary font-semibold">Go back</button>
      </div>
    );
  }

  const badgeColor = getCategoryBadgeColor(catDef.key);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              navigate("/");
            }
          }}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={24} />
        </button>
        <span className="font-black text-base truncate">{subName}</span>
      </header>

      <div className="px-3 pt-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading adverts...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 px-6">
            <Package size={36} className="text-muted-foreground" />
            <p className="font-bold text-lg">No adverts found</p>
            <p className="text-muted-foreground text-sm text-center">No listings in {subName} yet.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {products.map((p) => {
                const firstImage = p.imageUrls?.[0];
                const displayImage = typeof firstImage === "string" ? firstImage : firstImage?.url || p.imageUrl || "";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/product/${p.id}`)}
                    className="text-left rounded-2xl border border-border overflow-hidden bg-card active:scale-[0.98] transition-transform"
                  >
                    <div className="relative aspect-square bg-muted">
                      {displayImage ? (
                        <img src={getThumbnailUrl(displayImage)} alt={p.title} loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package size={28} className="text-muted-foreground" />
                        </div>
                      )}
                      <div className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeColor}`}>
                        {p.subcategory ?? p.category}
                      </div>
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="font-bold text-sm leading-tight line-clamp-2">{p.title}</p>
                      {p.price > 0 && (
                        <p className="text-primary font-black mt-1 text-sm">KES {p.price.toLocaleString()}</p>
                      )}
                      {p.ward && (
                        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                          <MapPin size={11} />
                          <span className="truncate">{p.ward}</span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {!done && (
              <div className="flex justify-center py-6">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-6 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 size={16} className="animate-spin" /> : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
    }
