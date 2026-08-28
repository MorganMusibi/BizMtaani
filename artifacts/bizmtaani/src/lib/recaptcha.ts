declare global {
  interface Window {
    grecaptcha?: {
      enterprise?: {
        ready: (cb: () => void) => void;
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

const RECAPTCHA_SITE_KEY = "6LddmkgtAAAAANnCYmsgANE0PNJC5xNltv7dYRL8";

let recaptchaLoadPromise: Promise<void> | null = null;

function loadRecaptchaScript(): Promise<void> {
  // Check if already loaded (either standard or enterprise)
  if (window.grecaptcha?.enterprise || window.grecaptcha) {
    return Promise.resolve();
  }

  if (recaptchaLoadPromise) {
    return recaptchaLoadPromise;
  }

  recaptchaLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    // Use the correct Enterprise URL
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.onload = () => {
      // Wait a moment for the script to fully initialize
      setTimeout(resolve, 100);
    };
    script.onerror = () => {
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
    // Try enterprise first, then fallback to standard
    const grecaptcha = window.grecaptcha?.enterprise || window.grecaptcha;
    
    if (!grecaptcha) {
      reject(new Error("reCAPTCHA not loaded"));
      return;
    }

    try {
      grecaptcha.ready(() => {
        grecaptcha
          .execute(RECAPTCHA_SITE_KEY, { action })
          .then(resolve)
          .catch(reject);
      });
    } catch (error) {
      reject(error);
    }
  });
}
