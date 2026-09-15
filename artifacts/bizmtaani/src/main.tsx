import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { preloadWards } from "./lib/location";
import { registerSW } from "virtual:pwa-register";

window.addEventListener('vite:preloadError', () => {
  const key = 'bizmtaani_preload_reload_attempted';
  if (sessionStorage.getItem(key)) {
    // Already tried reloading once this session — a second failure
    // means reloading won't fix it, so stop instead of looping.
    console.error('Preload failed again after reload — giving up to avoid a reload loop.');
    return;
  }
  sessionStorage.setItem(key, '1');
  window.location.reload();
});

registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload();
  },
});

preloadWards();

createRoot(document.getElementById("root")!).render(<App />);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById("boot-splash");
    if (splash) {
      splash.classList.add("fade-out");
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    }
  });
});
