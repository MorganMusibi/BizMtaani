import { initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "firebase/app-check";


const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// App Check — proves requests are coming from your real app, not a
// scripted client. Currently in monitor-only mode: enforcement isn't
// turned on yet in Firebase Console, so this just starts sending
// tokens and populating the metrics dashboard. Debug token lets
// localhost keep working during development without a real domain
// match.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_APPCHECK_SITE_KEY || "6LddmkgtAAAAANnCYmsgANE0PNJC5xNltv7dYRL8";

if (import.meta.env.DEV) {
  // @ts-expect-error — Firebase App Check local debug mode
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
  isTokenAutoRefreshEnabled: true,
});



// Warm up the App Check token in the background so it's cached before the
// first Firestore read or Cloud Function call. This runs without awaiting.
getToken(appCheck, false).catch(() => {
  // Silent fail - if it fails here, the first actual Firebase call will fetch it anyway.
});

export const auth = getAuth(app);

// Keep users signed in across browser restarts
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Persistent local cache: Firestore reads/writes are cached in
// IndexedDB, so revisiting the same data (e.g. reopening a product,
// or navigating back to Home) can be served from local cache instead
// of a fresh network read — cuts both load time and Firestore read
// costs. persistentMultipleTabManager lets it work correctly if the
// user has BizMtaani open in more than one browser tab at once.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
export const functionsEU = getFunctions(app, "europe-west1");

export async function getMessagingIfSupported() {
  const supported = await isSupported();
  if (!supported) return null;
  return getMessaging(app);
}
