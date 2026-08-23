import { useState, useEffect, useRef } from "react";
import type { ResolvedLocation } from "@/lib/location";
import { searchWardsByName } from "@/lib/locationHierarchy";
import { MapPin, Check, Search, Loader2 } from "lucide-react";

interface WardMatch {
  countyCode: number;
  countyName: string;
  constituencyName: string;
  wardName: string;
}

interface Props {
  // GPS-based nearby suggestions, when available. Optional — the
  // sheet works purely as a search box even with none supplied.
  choices?: ResolvedLocation[];
  onSelect: (choice: ResolvedLocation) => void;
  // Fired when the user picks a ward from search results, which has
  // no coordinates yet — the caller is responsible for geocoding it
  // and calling onSelect (or an equivalent) once coordinates resolve.
  onSearchSelect: (ward: WardMatch) => void;
  onDismiss: () => void;
  // True while the caller is geocoding a search selection — disables
  // the list so the user can't double-tap while it resolves.
  resolving?: boolean;
}

export function AreaPickerSheet({ choices = [], onSelect, onSearchSelect, onDismiss, resolving = false }: Props) {
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<WardMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = searchText.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const matches = await searchWardsByName(trimmed);
      setResults(matches);
      setSearching(false);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchText]);

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
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <MapPin size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-black text-base leading-tight">Which area are you in?</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Search for your ward, or pick one of the suggestions below.
            </p>
          </div>
        </div>

        <div className="relative mb-4 flex-shrink-0">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            autoFocus
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Type your area or ward name..."
            disabled={resolving}
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-muted text-sm outline-none border border-transparent focus:border-primary transition-colors disabled:opacity-50"
          />
          {searching && (
            <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="overflow-y-auto flex-1 space-y-2 pb-2">
          {searchText.trim() ? (
            results.length === 0 && !searching ? (
              <p className="text-center text-xs text-muted-foreground py-6">
                No matching areas found. Try a different spelling.
              </p>
            ) : (
              results.map((ward) => (
                <button
                  key={`${ward.wardName}-${ward.constituencyName}`}
                  onClick={() => onSearchSelect(ward)}
                  disabled={resolving}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-border bg-muted/40 hover:border-primary/40 text-left transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <div className="flex-1">
                    <p className="font-bold text-sm">{ward.wardName} area</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {ward.constituencyName}, {ward.countyName}
                    </p>
                  </div>
                  {resolving && <Loader2 size={16} className="animate-spin text-primary flex-shrink-0" />}
                </button>
              ))
            )
          ) : choices.length > 0 ? (
            choices.map((choice, i) => (
              <button
                key={choice.wardName}
                onClick={() => onSelect(choice)}
                disabled={resolving}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] disabled:opacity-50 ${
                  i === 0 ? "border-primary bg-primary/5" : "border-border bg-muted/40 hover:border-primary/40"
                }`}
              >
                <div className="flex-1">
                  <p className="font-bold text-sm">{choice.wardName} area</p>
                  {choice.constituency && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {choice.constituency}{choice.county ? `, ${choice.county}` : ""}
                    </p>
                  )}
                </div>
                {i === 0 && (
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <Check size={11} className="text-white" />
                  </div>
                )}
              </button>
            ))
          ) : (
            <p className="text-center text-xs text-muted-foreground py-6">
              Start typing to find your area.
            </p>
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
