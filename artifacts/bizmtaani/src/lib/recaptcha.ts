declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready: (cb: () => void) => void;
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
    };
  }
}

const RECAPTCHA_SITE_KEY = "declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready: (cb: () => void) => void;
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
    };
  }
}

const RECAPTCHA_SITE_KEY = "6LddmkgtAAAAANnCYmsgANE0PNJC5xNltv7dYRL8";

let recaptchaLoadPromise: Promise<void> | null = null;

function loadRecaptchaScript(): Promise<void> {
  if (window.grecaptcha?.enterprise) {
    return Promise.resolve();
  }

  if (recaptchaLoadPromise) {
    return recaptchaLoadPromise;
  }

  recaptchaLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.onload = () => {
      // Poll for window.grecaptcha.enterprise to actually attach —
      // onload only means the script file downloaded and started
      // executing, not that the SDK finished initializing. A fixed
      // delay can fire too early on a slow connection/device.
      const POLL_INTERVAL_MS = 50;
      const POLL_TIMEOUT_MS = 5000;
      const startedAt = Date.now();

      const checkReady = () => {
        if (window.grecaptcha?.enterprise) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          recaptchaLoadPromise = null;
          reject(new Error("reCAPTCHA Enterprise did not initialize in time"));
          return;
        }
        setTimeout(checkReady, POLL_INTERVAL_MS);
      };

      checkReady();
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
    const enterprise = window.grecaptcha?.enterprise;

    if (!enterprise) {
      reject(new Error("reCAPTCHA Enterprise not loaded"));
      return;
    }

    try {
      enterprise.ready(() => {
        enterprise
          .execute(RECAPTCHA_SITE_KEY, { action })
          .then(resolve)
          .catch(reject);
      });
    } catch (error) {
      reject(error);
    }
  });
}


let recaptchaLoadPromise: Promise<void> | null = null;

function loadRecaptchaScript(): Promise<void> {
  if (window.grecaptcha?.enterprise) {
    return Promise.resolve();
  }

  if (recaptchaLoadPromise) {
    return recaptchaLoadPromise;
  }

  recaptchaLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.onload = () => {
      // Poll for window.grecaptcha.enterprise to actually attach —
      // onload only means the script file downloaded and started
      // executing, not that the SDK finished initializing. A fixed
      // delay can fire too early on a slow connection/device.
      const POLL_INTERVAL_MS = 50;
      const POLL_TIMEOUT_MS = 5000;
      const startedAt = Date.now();

      const checkReady = () => {
        if (window.grecaptcha?.enterprise) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          recaptchaLoadPromise = null;
          reject(new Error("reCAPTCHA Enterprise did not initialize in time"));
          return;
        }
        setTimeout(checkReady, POLL_INTERVAL_MS);
      };

      checkReady();
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
    // ✅ Use enterprise.enterprise (NOT grecaptcha directly)
    const grecaptcha = window.grecaptcha?.enterprise;
    
    if (!grecaptcha) {
      reject(new Error("reCAPTCHA Enterprise not loaded"));
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
