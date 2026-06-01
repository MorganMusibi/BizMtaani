import type { ResolvedLocation } from "@/lib/location";
import { MapPin, Check } from "lucide-react";

interface Props {
  choices: ResolvedLocation[];
  onSelect: (choice: ResolvedLocation) => void;
  onDismiss: () => void;
}

export function AreaPickerSheet({ choices, onSelect, onDismiss }: Props) {
  if (choices.length <= 1) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
        onClick={onDismiss}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[61] bg-card rounded-t-3xl border-t border-border px-5 pt-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
      >
        <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-5" />

        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <MapPin size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-black text-base leading-tight">Which area are you in?</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              You appear to be near the border of a few areas. Pick the one that best
              describes your location so buyers find you accurately.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {choices.map((choice, i) => (
            <button
              key={choice.wardName}
              onClick={() => onSelect(choice)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${
                i === 0
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/40 hover:border-primary/40"
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
          ))}
        </div>

        <button
          onClick={onDismiss}
          className="w-full mt-3 py-3 text-sm font-semibold text-muted-foreground"
        >
          Use first suggestion
        </button>
      </div>
    </>
  );
}
