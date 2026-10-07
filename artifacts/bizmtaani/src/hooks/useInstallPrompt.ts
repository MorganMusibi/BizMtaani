import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

// New key on purpose: old permanent "pwa-install-dismissed=1" flags are ignored.
const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_MS = 3 * 24 * 60 * 60 * 1000; // show again after 3 days

// Module-level, so the event is captured the moment this file loads,
// even if no component has mounted yet.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installedFlag = true;
    deferredPrompt = null;
    notify();
  });
}

function isStandaloneNow() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function recentlyDismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return t > 0 && Date.now() - t < DISMISS_MS;
  } catch {
    return false;
  }
}

export function useInstallPrompt() {
  const [, rerender] = useState(0);
  const [dismissed, setDismissed] = useState(recentlyDismissed);

  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  const ua = navigator.userAgent;
  const isIOSDevice =
    /iphone|ipad|ipod/i.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  const isIOSSafari = isIOSDevice && /^((?!chrome|android).)*safari/i.test(ua);
  const installed = installedFlag || isStandaloneNow();

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    const p = deferredPrompt;
    await p.prompt();
    const { outcome } = await p.userChoice;
    deferredPrompt = null;
    if (outcome === "accepted") installedFlag = true;
    notify();
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }, []);

  const installable = isIOSSafari || deferredPrompt !== null;
  const showBanner = installable && !installed && !dismissed;

  return { showBanner, isIOS: isIOSSafari, install, dismiss };
}
