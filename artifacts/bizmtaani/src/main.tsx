import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { preloadWards } from "./lib/location";
import { registerSW } from "virtual:pwa-register";

// ─── Deferred PWA update: install silently, apply only when backgrounded ───
let updateReady = false;
const updateSW = registerSW({
  onNeedRefresh() {
    updateReady = true;
    // No reload here — applied on visibilitychange below, so an active
    // session is never interrupted by a mid-use reload/blink.
  },
  onOfflineReady() {
    // no-op
  },
});

document.addEventListener("visibilitychange", () => {
  // Skip the reload-on-background entirely while on /admin — the
  // dashboard's Create Listing flow requires leaving the tab (to
  // paste a claim link into WhatsApp) and coming straight back,
  // repeatedly, by design. Applying the update here would silently
  // wipe in-progress form state and the active tab every single time.
  // The update just stays queued (updateReady remains true) until the
  // admin navigates away from /admin and backgrounds the tab again.
  if (window.location.pathname.startsWith("/admin")) return;

  if (document.visibilityState === "hidden" && updateReady) {
    updateReady = false;
    updateSW(true); // activates new SW + reloads, but app is hidden right now
  }
});

window.addEventListener("vite:preloadError", async () => {
  const key = "bizmtaani_last_preload_reload_at";
  const lastAttempt = Number(sessionStorage.getItem(key) ?? "0");
  const now = Date.now();

  // Time-based guard, not a one-shot guard: allows recovery from a
  // genuinely stale build (the real, common case during frequent
  // deploys) while still blocking a tight reload loop if something
  // is persistently broken (e.g. a bad deploy). 15s is long enough
  // that no legitimate reload cycle could hit it twice, short enough
  // that a user isn't stuck waiting.
  if (now - lastAttempt < 15_000) {
    console.error("Preload failed again too soon after a reload — stopping to avoid a loop.");
    return;
  }
  sessionStorage.setItem(key, String(now));

  // Clear any cached old index.html/assets before reloading, so the
  // reload actually fetches the current deploy's manifest instead of
  // potentially re-hitting a cached stale one.
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Best-effort — proceed with reload regardless.
  }

  window.location.reload();
});

// A synchronous throw here must never stop the app from rendering
// (which would leave the user stuck on the boot splash).
try {
  preloadWards();
} catch (e) {
  console.error("preloadWards failed:", e);
}

createRoot(document.getElementById("root")!).render(<App />);

// ─── Boot splash removal ───
// Removed on transitionend, with a timed fallback in case that event
// never fires (background tab, reduced motion, browser quirk).
function hideSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  splash.classList.add("fade-out");
  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  setTimeout(() => splash.remove(), 600);
}

requestAnimationFrame(() => requestAnimationFrame(hideSplash));
// Last resort if anything above stalled.
setTimeout(hideSplash, 8000);
