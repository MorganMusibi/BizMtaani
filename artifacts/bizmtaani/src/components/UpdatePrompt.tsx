import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("Service worker registration error:", error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-[100] mx-auto max-w-sm rounded-2xl border border-border bg-card px-4 py-3.5 shadow-xl flex items-center gap-3"
      style={{ paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom))" }}
    >
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <RefreshCw size={16} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">Update available</p>
        <p className="text-xs text-muted-foreground">Reload to get the latest version.</p>
      </div>
      <Button
        size="sm"
        className="h-8 px-3 text-xs font-bold flex-shrink-0"
        onClick={() => updateServiceWorker(true)}
      >
        Reload
      </Button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="w-7 h-7 rounded-full hover:bg-muted flex items-center justify-center flex-shrink-0 text-muted-foreground"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
