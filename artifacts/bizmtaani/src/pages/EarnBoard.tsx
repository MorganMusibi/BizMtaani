import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Search, ArrowLeft } from "lucide-react";

type Affiliate = { enabled?: boolean; type?: string; amount?: number };

type EarnAdvert = {
  id: string;
  title?: string;
  price?: number;
  category?: string;
  location?: string;
  wardName?: string;
  countyName?: string;
  imageUrls?: string[];
  status?: string;
  sellerId?: string;
  affiliate?: Affiliate;
  createdAt?: any;
};

function commissionText(a?: Affiliate, price?: number): string {
  if (!a || !a.enabled) return "";
  const amt = Number(a.amount) || 0;
  switch (a.type) {
    case "fixed":
      return `KES ${amt.toLocaleString()}`;
    case "percentage":
      return price
        ? `${amt}% (about KES ${Math.round((price * amt) / 100).toLocaleString()})`
        : `${amt}%`;
    case "half_month_rent":
      return price ? `Half a month's rent (KES ${Math.round(price / 2).toLocaleString()})` : "Half a month's rent";
    case "one_month_rent":
      return price ? `One month's rent (KES ${price.toLocaleString()})` : "One month's rent";
    default:
      return amt ? `KES ${amt.toLocaleString()}` : "";
  }
}

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export default function EarnBoard() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"loading" | "denied" | "ok">("loading");
  const [adverts, setAdverts] = useState<EarnAdvert[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        setStatus("denied");
        return;
      }
      try {
        const m = await getDoc(doc(db, "marketers", user.uid));
        if (!m.exists() || m.data()?.status !== "active") {
          if (!cancelled) setStatus("denied");
          return;
        }
        // Single-field equality query: no composite index needed.
        // Status filter + sorting are done in the browser.
        const snap = await getDocs(
          query(collection(db, "products"), where("affiliate.enabled", "==", true), limit(100))
        );
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as EarnAdvert))
          .filter((p) => p.status === "active" && p.sellerId !== user.uid)
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        if (!cancelled) {
          setAdverts(rows);
          setStatus("ok");
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError("Could not load the Earn board. Check your connection and try again.");
          setStatus("ok");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return adverts;
    return adverts.filter((p) =>
      [p.title, p.category, p.location, p.wardName, p.countyName]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    );
  }, [adverts, search]);

  return (
    <div className="min-h-screen pb-24 bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
        <Link href="/marketer">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold leading-tight">Earn board</h1>
          <p className="text-xs text-muted-foreground">Adverts where sellers pay you for a buyer</p>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {status === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}

        {status === "denied" && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 font-semibold">
              <Users className="h-5 w-5" /> Marketers only
            </div>
            <p className="text-sm text-muted-foreground">
              The Earn board is open to approved BizMtaani marketers. Apply from your profile and we will
              review your request.
            </p>
            <Link href={user ? "/profile" : "/login"}>
              <Button className="w-full">{user ? "Go to my profile" : "Log in"}</Button>
            </Link>
          </Card>
        )}

        {status === "ok" && (
          <>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by item, category or area"
                className="w-full h-10 rounded-md border border-border bg-background pl-9 pr-3 text-sm"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {!error && filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No adverts are open to marketers right now. Check again soon.
              </p>
            )}

            {filtered.map((p) => (
              <Link key={p.id} href={`/product/${p.id}`}>
                <Card className="p-3 flex gap-3 cursor-pointer">
                  <div className="h-20 w-20 shrink-0 rounded-md bg-muted overflow-hidden">
                    {p.imageUrls?.[0] && (
                      <img src={p.imageUrls[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{p.title || "Advert"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[p.wardName, p.countyName].filter(Boolean).join(", ") || p.location || ""}
                    </p>
                    {typeof p.price === "number" && (
                      <p className="text-xs mt-0.5">Price: KES {p.price.toLocaleString()}</p>
                    )}
                    <p className="text-xs mt-1 font-semibold text-green-700">
                      You earn: {commissionText(p.affiliate, p.price)}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
