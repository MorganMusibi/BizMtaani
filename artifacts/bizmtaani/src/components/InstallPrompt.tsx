/**
 * PWA install prompt banner — appears at the bottom of the screen when the app
 * can be installed (Android/Chrome) or on iOS to guide manual installation.
 * Also handles in-app browsers (Facebook, Instagram, TikTok...), which can't
 * install PWAs: it tells the user how to open the page in a real browser.
 */
import { useState } from "react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Download, X, Share, ExternalLink } from "lucide-react";

const IN_APP_REGEX = /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Twitter|Snapchat/i;
const IN_APP_DISMISS_KEY = "bizmtaani_inapp_install_dismissed";

function openInChrome() {
  const { host, pathname, search, href } = window.location;
  window.location.href =
    `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

export function InstallPrompt() {
  const { showBanner, isIOS, install, dismiss } = useInstallPrompt();

  const ua = navigator.userAgent;
  const inApp = IN_APP_REGEX.test(ua);
  const isAndroidUA = /Android/i.test(ua);
  const [inAppHidden, setInAppHidden] = useState(() => {
    try { return sessionStorage.getItem(IN_APP_DISMISS_KEY) === "1"; } catch { return false; }
  });

  // In-app browser (Facebook etc.): installing is impossible here, so guide
  // the user to open the link in Chrome/Safari instead.
  if (inApp && !inAppHidden) {
    return (
      <div className="fixed bottom-[72px] left-3 right-3 z-50 animate-in slide-in-from-bottom-4 duration-300">
        <div className="bg-card border border-border rounded-2xl shadow-2xl px-4 py-3.5 flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 mt-0.5">
            <img src="/icon-192.png" alt="BizMtaani" className="w-full h-full object-cover" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight">Get the BizMtaani app</p>

            {isAndroidUA ? (
              <>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">
                  Open this page in Chrome, then tap <strong>Install</strong>. If nothing happens,
                  tap ⋮ and choose <strong>Open in browser</strong>.
                </p>
                <button
                  onClick={openInChrome}
                  className="mt-2.5 flex items-center gap-1.5 bg-primary text-white text-xs font-bold px-4 py-2 rounded-xl"
                >
                  <ExternalLink size={13} />
                  Open in Chrome
                </button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                Tap <strong>•••</strong> then <strong>Open in Safari</strong>, then{" "}
                <Share size={11} className="inline mx-0.5 -mt-0.5" /> and{" "}
                <strong>Add to Home Screen</strong>
              </p>
            )}
          </div>

          <button
            onClick={() => {
              try { sessionStorage.setItem(IN_APP_DISMISS_KEY, "1"); } catch {}
              setInAppHidden(true);
            }}
            className="flex-shrink-0 p-1.5 rounded-xl hover:bg-muted transition-colors mt-0.5"
            aria-label="Dismiss"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
      </div>
    );
  }

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
