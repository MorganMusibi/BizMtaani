import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { collection, query, where, limit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CATEGORY_DEFS } from "@/lib/categories";
import { resolveCanonicalLocation } from "@/lib/locationHierarchy";
import { slugify } from "@/lib/slug";
import { usePageMeta, SITE_URL, type PageMeta } from "@/hooks/usePageMeta";
import { type Product } from "@/hooks/useHomeFeed";
import { getThumbnailUrl } from "@/lib/cloudinaryUrl";
import { Loader2, MapPin, Package, ChevronLeft } from "lucide-react";
import NotFound from "@/pages/not-found";

const LANDING_PAGE_LIMIT = 24;

interface ResolvedTarget {
  wardName: string;
  countyName: string;
  categoryKey: string;
  categoryLabel: string;
}

// Same split — ward-scoped free ads, county-scoped premium ads — as
// categoryFreeQuery/categoryPremiumQuery in useHomeFeed.ts. Premium
// results are additionally filtered to this page's own county so a
// nationwide "all_areas" advert doesn't render identically across
// every ward page in the country.
async function fetchLandingProducts(
  categoryKey: string,
  wardName: string,
  countyName: string
): Promise<Product[]> {
  const coll = collection(db, "products");

  const freeQ = query(
    coll,
    where("category", "==", categoryKey),
    where("status", "==", "active"),
    where("ward", "==", wardName),
    limit(LANDING_PAGE_LIMIT)
  );

  const premiumQ = query(
    coll,
    where("category", "==", categoryKey),
    where("status", "==", "active"),
    where("visibilityScope", "in", ["county", "all_areas"] as const),
    where("county", "==", countyName),
    limit(LANDING_PAGE_LIMIT)
  );

  const [freeSnap, premiumSnap] = await Promise.all([getDocs(freeQ), getDocs(premiumQ)]);

  const freeItems = freeSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product));
  const premiumItems = premiumSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product));

  const ids = new Set(freeItems.map((p) => p.id));
  const merged = [...freeItems, ...premiumItems.filter((p) => !ids.has(p.id))];

  const nowSec = Date.now() / 1000;
  return merged.filter((p) => !p.expiresAt || p.expiresAt.seconds > nowSec);
}

export default function WardCategoryPage() {
  const [, params] = useRoute("/:countySlug/:wardSlug/:categorySlug");
  const [, setLocation] = useLocation();

  const [status, setStatus] = useState<"loading" | "found" | "not-found">("loading");
  const [target, setTarget] = useState<ResolvedTarget | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    (async () => {
      if (!params?.countySlug || !params?.wardSlug || !params?.categorySlug) {
        if (!cancelled) setStatus("not-found");
        return;
      }

      const categoryDef = CATEGORY_DEFS.find((c) => slugify(c.key) === params.categorySlug);
      if (!categoryDef) {
        if (!cancelled) setStatus("not-found");
        return;
      }

      // resolveCanonicalLocation normalizes hyphens/case internally,
      // so the raw slugs can be passed straight in — no un-slugify
      // step needed.
      const resolved = await resolveCanonicalLocation(params.wardSlug, undefined, params.countySlug);
      if (!resolved) {
        if (!cancelled) setStatus("not-found");
        return;
      }

      const items = await fetchLandingProducts(categoryDef.key, resolved.wardName, resolved.countyName);
      if (cancelled) return;

      // No live listings — render a real 404 rather than a thin,
      // empty page. This is the guard the SEO plan depends on.
      if (items.length === 0) {
        setStatus("not-found");
        return;
      }

      setTarget({
        wardName: resolved.wardName,
        countyName: resolved.countyName,
        categoryKey: categoryDef.key,
        categoryLabel: categoryDef.displayShort,
      });
      setProducts(items);
      setStatus("found");
    })();

    return () => {
      cancelled = true;
    };
  }, [params?.countySlug, params?.wardSlug, params?.categorySlug]);

  const meta: PageMeta | null =
    status === "found" && target
      ? {
          title: `${target.categoryLabel} in ${target.wardName}, ${target.countyName} | BizMtaani`,
          description: `Browse ${target.categoryLabel.toLowerCase()} adverts in ${target.wardName}, ${target.countyName}. Live listings updated daily on BizMtaani.`,
          canonicalPath: `/${slugify(target.countyName)}/${slugify(target.wardName)}/${slugify(target.categoryKey)}`,
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: products.slice(0, 20).map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${SITE_URL}/product/${p.id}`,
            })),
          },
        }
      : status === "not-found"
      ? {
          title: "Page not found | BizMtaani",
          description: "This page is not available on BizMtaani.",
          noindex: true,
        }
      : null;

  usePageMeta(meta);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  if (status === "not-found" || !target) {
    return <NotFound />;
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button onClick={() => setLocation("/")} className="p-2 -ml-2 rounded-xl hover:bg-muted">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="font-black text-base leading-tight">
            {target.categoryLabel} in {target.wardName}
          </h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin size={11} /> {target.countyName} County
          </p>
        </div>
      </header>

      <div className="px-3 pt-3 grid grid-cols-2 gap-3">
        {products.map((p) => {
          const firstImage = p.imageUrls?.[0];
          const displayImage = typeof firstImage === "string" ? firstImage : firstImage?.url || p.imageUrl || "";
          return (
            <button
              key={p.id}
              onClick={() => setLocation(`/product/${p.id}`)}
              className="text-left rounded-2xl border border-border overflow-hidden bg-card"
            >
              <div className="aspect-square bg-muted">
                {displayImage ? (
                  <img
                    src={getThumbnailUrl(displayImage)}
                    alt={p.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package size={28} className="text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="font-bold text-sm line-clamp-2">{p.title}</p>
                <p className="text-primary font-black text-sm mt-1">
                  {p.price > 0 ? `KES ${p.price.toLocaleString()}` : "Contact for price"}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
