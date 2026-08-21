import { useParams, useLocation, Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { getCategoryDef } from "@/lib/categories";

export default function CategorySubcategories() {
  const { categoryKey } = useParams<{ categoryKey: string }>();
  const [, navigate] = useLocation();

  const catDef = categoryKey ? getCategoryDef(decodeURIComponent(categoryKey)) : undefined;

  if (!catDef) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground">Category not found.</p>
        <button onClick={() => navigate("/")} className="text-primary font-semibold">
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="p-1 text-muted-foreground hover:text-foreground">
          <ChevronLeft size={24} />
        </button>
        <div className="flex items-center gap-2">
          <catDef.icon size={18} className="text-foreground" />
          <span className="font-black text-base">{catDef.displayShort}</span>
        </div>
      </header>

      <div className="px-4 pt-4">
        <p className="text-sm text-muted-foreground mb-4">{catDef.tagline}</p>

        <div className="space-y-2">
          {catDef.subcategories.map((sub) => (
            <Link
              key={sub}
              href={`/category/${encodeURIComponent(catDef.key)}/${encodeURIComponent(sub)}`}
              className="block w-full text-left px-4 py-3.5 rounded-2xl border border-border bg-card hover:border-primary/40 transition-colors font-semibold text-sm"
            >
              {sub}
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
