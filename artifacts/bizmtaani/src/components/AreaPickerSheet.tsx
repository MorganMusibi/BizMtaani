import { useState, useEffect, useRef } from "react";
import {
  searchWardsByName,
  searchConstituenciesByName,
  searchCountiesByName,
  type Constituency,
} from "@/lib/locationHierarchy";
import { type ResolvedLocation } from "@/lib/location";
import {
  isMultiWardTown as checkIsMultiWardTown,
  getAllWardsForTown,
  resolveWardFromAlias,
  searchTownAliases,
} from "@/lib/townAliasMapping";
import { MapPin, Search, Loader2, ChevronLeft } from "lucide-react";

interface WardMatch {
  wardName: string;
  constituencyName: string;
  countyName: string;
  label?: string;
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
  const [townAliasResults, setTownAliasResults] = useState<ResolvedLocation[]>([]);
  const [isMultiWardTown, setIsMultiWardTown] = useState(false);
  const [searchingAlias, setSearchingAlias] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
  if (step.type !== "search") return; // only live-search at the top level

  if (debounceRef.current) clearTimeout(debounceRef.current);

  const trimmed = searchText.trim();
  if (!trimmed) {
    setWardResults([]);
    setConstituencyResults([]);
    setCountyResults([]);
    setTownAliasResults([]);
    setIsMultiWardTown(false);
    setSearching(false);
    setSearchingAlias(false);
    return;
  }

  setSearching(true);
  setSearchingAlias(true);
  
  debounceRef.current = setTimeout(async () => {
    // 1. First check if it's a known town alias (Ruaka, Kitale, etc.)
    if (checkIsMultiWardTown(trimmed)) {
      const wards = await getAllWardsForTown(trimmed);
      if (wards && wards.length > 0) {
        // Multi-ward town (e.g., Kitale)
        setTownAliasResults(wards);
        setIsMultiWardTown(true);
        setWardResults([]);
        setConstituencyResults([]);
        setCountyResults([]);
        setSearching(false);
        setSearchingAlias(false);
        return;
      }
    }

    const singleMatch = await resolveWardFromAlias(trimmed);
    if (singleMatch) {
      // Single ward town (e.g., Ruaka → Ndenderu)
      setTownAliasResults([singleMatch]);
      setIsMultiWardTown(false);
      setWardResults([]);
      setConstituencyResults([]);
      setCountyResults([]);
      setSearching(false);
      setSearchingAlias(false);
      return;
    }

    // 1c. No exact alias match — try partial/autocomplete suggestions
    // (e.g. "buru" -> "buruburu") via substring matching. These are
    // shown ALONGSIDE the regular hierarchy search below, never
    // instead of it — a partial alias match (e.g. "githurai" ->
    // "Githurai 45") must not hide a real, distinct ward of the same
    // root name (e.g. the actual "Githurai" ward in Roysambu).
    const aliasSuggestions = searchTownAliases(trimmed);
    let aliasResults: ResolvedLocation[] = [];
    let aliasResultsAreMultiWard = false;

    if (aliasSuggestions.length > 0) {
      const resolvedGroups = await Promise.all(
        aliasSuggestions.map(async (s) =>
          s.isMultiWard
            ? await getAllWardsForTown(s.alias)
            : [await resolveWardFromAlias(s.alias)]
        )
      );
      aliasResults = resolvedGroups
        .flat()
        .filter((r): r is ResolvedLocation => r !== null);

      // Only treat it as "spans multiple areas" styling if the partial
      // query matched exactly one town and that town is multi-ward —
      // e.g. "kita" -> "kitale". If several different aliases matched
      // the partial query, keep the plain single-card styling.
      aliasResultsAreMultiWard =
        aliasSuggestions.length === 1 && aliasSuggestions[0].isMultiWard;
    }

    // 2. Always also run the regular hierarchy search — a partial
    // alias suggestion above is additive, never a substitute for it.
    const [wards, constituencies, counties] = await Promise.all([
      searchWardsByName(trimmed, 8),
      searchConstituenciesByName(trimmed, 8),
      searchCountiesByName(trimmed, 5),
    ]);

    setTownAliasResults(aliasResults);
    setIsMultiWardTown(aliasResultsAreMultiWard);
    setWardResults(wards.map((w) => ({ wardName: w.wardName, constituencyName: w.constituencyName, countyName: w.countyName })));
    setConstituencyResults(constituencies);
    setCountyResults(counties);
    setSearching(false);
    setSearchingAlias(false);
  }, 250);

  return () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };
}, [searchText, step.type]);

  const hasAnyResults = wardResults.length > 0 || constituencyResults.length > 0 || countyResults.length > 0 || townAliasResults.length > 0;
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
            {(searching || searchingAlias) && (
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
    {/* ===== NEW: Town Alias Results ===== */}
    {townAliasResults.length > 0 && (
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
          {isMultiWardTown ? `📍 ${searchText} spans multiple areas` : "📍 Known Area"}
        </p>
        <div className="space-y-2">
          {townAliasResults.map((loc, index) => {
            const key = `${loc.wardName}-${loc.constituency}-${index}`;
            const isThisResolving = resolving && resolvingKey === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setResolvingKey(key);
                  onSearchSelect({
                    wardName: loc.wardName,
                    constituencyName: loc.constituency,
                    countyName: loc.county,
                    label: loc.label,
                  });
                }}
                disabled={resolving}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] disabled:opacity-50 ${
                  isMultiWardTown 
                    ? "border-amber-400/40 bg-amber-50/50 hover:border-amber-500/60" 
                    : "border-emerald-400/40 bg-emerald-50/50 hover:border-emerald-500/60"
                }`}
              >
                <div className="flex-1">
                  <p className="font-bold text-sm">
                    {isMultiWardTown
                      ? loc.wardName
                      : `${loc.label ?? loc.wardName}, ${loc.constituency}`}
                    {isMultiWardTown && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {loc.constituency}, {loc.county}
                      </span>
                    )}
                  </p>
                  {isMultiWardTown ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {loc.constituency}, {loc.county}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {loc.constituency}, {loc.county}
                    </p>
                  )}
                  {isMultiWardTown && (
                    <p className="text-xs text-amber-600 mt-1">
                      🏙️ Part of {searchText} town
                    </p>
                  )}
                </div>
                {isThisResolving && <Loader2 size={16} className="animate-spin text-primary flex-shrink-0" />}
                {!isThisResolving && isMultiWardTown && (
                  <span className="text-xs text-amber-600">Select</span>
                )}
              </button>
            );
          })}
          {isMultiWardTown && (
            <p className="text-xs text-muted-foreground px-2 py-1">
              {searchText} spans multiple wards. Please choose your specific area above.
            </p>
          )}
        </div>
      </div>
    )}

    {/* ===== Existing Ward Results ===== */}
    
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
                 Jaribu ku search na jina ya Constituency enye uko alafu uchague ward yako                </p>
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
