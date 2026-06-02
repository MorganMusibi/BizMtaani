/**
 * PWA install prompt banner — appears at the bottom of the screen when the app
 * can be installed (Android/Chrome) or on iOS to guide manual installation.
 */
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Download, X, Share } from "lucide-react";

export function InstallPrompt() {
  const { showBanner, isIOS, install, dismiss } = useInstallPrompt();

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-[72px] left-3 right-3 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-card border border-border rounded-2xl shadow-2xl px-4 py-3.5 flex items-start gap-3">
        {/* App icon */}
        <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 mt-0.5">
          <img src="/icon-192.png" alt="BizMtaani" className="w-full h-full object-cover" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-black text-sm leading-tight">Add BizMtaani to Home Screen</p>

          {isIOS ? (
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Tap <Share size={11} className="inline mx-0.5 -mt-0.5" /> then{" "}
              <strong>Add to Home Screen</strong> for the full app experience
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Install for offline access, faster loading & home screen icon
            </p>
          )}

          {!isIOS && (
            <button
              onClick={install}
              className="mt-2.5 flex items-center gap-1.5 bg-primary text-white text-xs font-bold px-4 py-2 rounded-xl"
            >
              <Download size={13} />
              Install App
            </button>
          )}
        </div>

        <button
          onClick={dismiss}
          className="flex-shrink-0 p-1.5 rounded-xl hover:bg-muted transition-colors mt-0.5"
          aria-label="Dismiss"
        >
          <X size={16} className="text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
