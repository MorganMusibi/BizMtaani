import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { preloadWards } from "./lib/location";

window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

preloadWards();

createRoot(document.getElementById("root")!).render(<App />);
