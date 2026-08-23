import { useState, useEffect, useRef } from "react";
import {
  searchWardsByName,
  searchConstituenciesByName,
  searchCountiesByName,
  type Constituency,
} from "@/lib/locationHierarchy";
import { MapPin, Search, Loader2, ChevronLeft } from "lucide-react";

interface WardMatch {
  wardName: string;
  constituencyName: string;
  countyName: string;
}

interface Props {
  onSearchSelect: (ward: WardMatch) => void;
  onFreeTextSearch: (text: string) => void;
  onDismiss: () => void;
  resolving?: boolean;
  freeTextSearching?: boolean;
}

// What's currently shown below the search box.
type Step =
  | { type: "search" }
  | { type: "wards"; countyName: string; constituencyName: string; wards: string[] }
  | { type: "constituencies"; countyName: string; constituencies: Constituency[] };

export function AreaPickerSheet({
  onSearchSelect,
  onFreeTextSearch,
  onDismiss,
  resolving = false,
  freeTextSearching = false,
}: Props) {
  const [searchText, setSearchText] = useState("");
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [wardResults, setWardResults] = useState<WardMatch[]>([]);
  const [constituencyResults, setConstituencyResults] = useState<
    { countyName: string; constituencyName: string; wards: string[] }[]
  >([]);
  const [countyResults, setCountyResults] = useState<
    { countyName: string; constituencies: Constituency[] }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [step, setStep] = useState<Step>({ type: "search" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (step.type !== "search") return; // only live-search at the top level

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = searchText.trim();
    if (!trimmed) {
      setWardResults([]);
      setConstituencyResults([]);
      setCountyResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const [wards, constituencies, counties] = await Promise.all([
        searchWardsByName(trimmed, 8),
        searchConstituenciesByName(trimmed, 8),
        searchCountiesByName(trimmed, 5),
      ]);
      setWardResults(wards.map((w) => ({ wardName: w.wardName, constituencyName: w.constituencyName, countyName: w.countyName })));
      setConstituencyResults(constituencies);
      setCountyResults(counties);
      setSearching(false);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchText, step.type]);

  const hasAnyResults = wardResults.length > 0 || constituencyResults.length > 0 || countyResults.length > 0;
  const showEmptyState = step.type === "search" && searchText.trim() && !searching && !hasAnyResults;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
        onClick={onDismiss}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[61] bg-card rounded-t-3xl border-t border-border px-5 pt-5 max-h-[80vh] flex flex-col"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
      >
        <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-5 flex-shrink-0" />

        <div className="flex items-start gap-3 mb-4 flex-shrink-0">
          {step.type !== "search" && (
            <button
              onClick={() => setStep({ type: "search" })}
              className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 mt-0.5"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <MapPin size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-black text-base leading-tight">
              {step.type === "search"
                ? "Which area are you in?"
                : step.type === "wards"
                ? `Wards in ${step.constituencyName}`
                : `Constituencies in ${step.countyName}`}
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {step.type === "search"
                ? "Type your ward, constituency, or county name."
                : "Pick your exact ward."}
            </p>
          </div>
        </div>

        {step.type === "search" && (
          <div className="relative mb-4 flex-shrink-0">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="e.g. Kariobangi, Kasarani, or Nairobi..."
              disabled={resolving}
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-muted text-sm outline-none border border-transparent focus:border-primary transition-colors disabled:opacity-50"
            />
            {searching && (
              <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        )}

        <div className="overflow-y-auto flex-1 space-y-4 pb-2">
          {step.type === "wards" && (
            <div className="space-y-2">
              {step.wards.map((ward) => (
                <button
                  key={ward}
                  onClick={() => onSearchSelect({ wardName: ward, constituencyName: step.constituencyName, countyName: step.countyName })}
                  disabled={resolving}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border-2 border-border bg-muted/40 hover:border-primary/40 text-left transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <p className="font-bold text-sm">{ward}</p>
                  {resolving && <Loader2 size={16} className="animate-spin text-primary flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {step.type === "constituencies" && (
            <div className="space-y-2">
              {step.constituencies.map((c) => (
                <button
                  key={c.constituency_name}
                  onClick={() =>
                    setStep({
                      type: "wards",
                      countyName: step.countyName,
                      constituencyName: c.constituency_name,
                      wards: c.wards,
                    })
                  }
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border-2 border-border bg-muted/40 hover:border-primary/40 text-left transition-all active:scale-[0.98]"
                >
                  <p className="font-bold text-sm">{c.constituency_name}</p>
                  <span className="text-xs text-muted-foreground">{c.wards.length} wards</span>
                </button>
              ))}
            </div>
          )}

          {step.type === "search" && (
            <>
              {wardResults.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Wards</p>
                  <div className="space-y-2">
                    {wardResults.map((w) => {
  const key = `${w.wardName}-${w.constituencyName}`;
  const isThisResolving = resolving && resolvingKey === key;
  return (
    <button
      key={key}
      onClick={() => {
        setResolvingKey(key);
        onSearchSelect(w);
      }}
      disabled={resolving}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-primary/40 bg-primary/5 text-left transition-all active:scale-[0.98] disabled:opacity-50"
    >
      <div className="flex-1">
        <p className="font-bold text-sm">{w.wardName} area</p>
        <p className="text-xs text-muted-foreground mt-0.5">{w.constituencyName}, {w.countyName}</p>
      </div>
      {isThisResolving && <Loader2 size={16} className="animate-spin text-primary flex-shrink-0" />}
    </button>
  );
})}
                  </div>
                </div>
              )}

              {constituencyResults.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Constituencies</p>
                  <div className="space-y-2">
                    {constituencyResults.map((c) => (
                      <button
                        key={`${c.constituencyName}-${c.countyName}`}
                        onClick={() =>
                          setStep({
                            type: "wards",
                            countyName: c.countyName,
                            constituencyName: c.constituencyName,
                            wards: c.wards,
                          })
                        }
                        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border-2 border-border bg-muted/40 hover:border-primary/40 text-left transition-all active:scale-[0.98]"
                      >
                        <div>
                          <p className="font-bold text-sm">{c.constituencyName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.countyName}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">{c.wards.length} wards</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {countyResults.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Counties</p>
                  <div className="space-y-2">
                    {countyResults.map((c) => (
                      <button
                        key={c.countyName}
                        onClick={() => setStep({ type: "constituencies", countyName: c.countyName, constituencies: c.constituencies })}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border-2 border-border bg-muted/40 hover:border-primary/40 text-left transition-all active:scale-[0.98]"
                      >
                        <p className="font-bold text-sm">{c.countyName}</p>
                        <span className="text-xs text-muted-foreground">{c.constituencies.length} constituencies</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showEmptyState && (
                <p className="text-center text-xs text-muted-foreground py-6">
                  No matching ward, constituency, or county found. Try a different spelling.
                </p>
              )}

              {showEmptyState && (
  <div className="text-center py-6">
    <p className="text-xs text-muted-foreground mb-3">
      No matching ward, constituency, or county found for "{searchText.trim()}".
    </p>
    <button
      onClick={() => onFreeTextSearch(searchText.trim())}
      disabled={freeTextSearching}
      className="text-xs font-semibold text-primary px-4 py-2 rounded-xl border border-primary/40 disabled:opacity-50"
    >
      {freeTextSearching ? "Searching..." : `Search "${searchText.trim()}" as a place`}
    </button>
  </div>
)}
            </>
          )}
        </div>

        <button
          onClick={onDismiss}
          disabled={resolving}
          className="w-full mt-3 py-3 text-sm font-semibold text-muted-foreground flex-shrink-0 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </>
  );
}
