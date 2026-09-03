import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { preloadWards } from "./lib/location";

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
preloadWards();

createRoot(document.getElementById("root")!).render(<App />);
document.getElementById("boot-splash")?.remove();
