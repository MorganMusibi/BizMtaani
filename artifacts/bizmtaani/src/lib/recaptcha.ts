declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

const RECAPTCHA_SITE_KEY = "6LfdW4wtAAAAAJonWa3TejbOoRJ44p9vQ8wU8kUC"; // same site key as in index.html

// The reCAPTCHA script is no longer loaded eagerly in index.html —
// it's only needed on the few screens that call getRecaptchaToken
// (publish advert, submit referral, etc), so we load it lazily here,
// the first time it's actually needed, and cache the load so repeat
// calls in the same session don't re-inject the script.
let recaptchaLoadPromise: Promise<void> | null = null;

function loadRecaptchaScript(): Promise<void> {
  if (window.grecaptcha) {
    // Already loaded (e.g. a previous call already finished) — skip.
    return Promise.resolve();
  }

  if (recaptchaLoadPromise) {
    return recaptchaLoadPromise;
  }

  recaptchaLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later call to retry, in case this failure was a
      // transient network issue rather than a permanent one.
      recaptchaLoadPromise = null;
      reject(new Error("Failed to load reCAPTCHA script"));
    };
    document.head.appendChild(script);
  });

  return recaptchaLoadPromise;
}

export async function getRecaptchaToken(action: string): Promise<string> {
  await loadRecaptchaScript();

  return new Promise((resolve, reject) => {
    if (!window.grecaptcha) {
      reject(new Error("reCAPTCHA not loaded"));
      return;
    }
    window.grecaptcha.ready(() => {
      window.grecaptcha!
        .execute(RECAPTCHA_SITE_KEY, { action })
        .then(resolve)
        .catch(reject);
    });
  });
}
