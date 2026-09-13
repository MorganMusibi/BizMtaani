import { useEffect } from "react";

// Silently reloads the page exactly once when a new service worker
// takes control — no banner, no user interaction. The sessionStorage
// guard stops this from ever looping: once this tab has reloaded for
// a controllerchange, it won't reload again for the rest of this
// session even if another controllerchange fires.
export function UpdatePrompt() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const RELOAD_GUARD_KEY = "bizmtaani_sw_reloaded";

    function handleControllerChange() {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      window.location.reload();
    }

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  return null;
}
