import { getToken, onMessage } from "firebase/messaging";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMessagingIfSupported } from "@/lib/firebase";

// You'll find this in Firebase Console → Project Settings → Cloud Messaging
// → Web configuration → Web Push certificates (generate one if you haven't).
// Trimmed and stripped of stray quotes, since a pasted env var often
// carries whitespace/quotes that break base64 decoding.
const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY ?? "")
  .trim()
  .replace(/^["']|["']$/g, "");

// Guards against onMessage being attached more than once per page load.
let foregroundListenerAttached = false;

async function getTokenWithRetry(
  messaging: Parameters<typeof getToken>[0],
  registration: ServiceWorkerRegistration
): Promise<string> {
  try {
    return await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
  } catch (firstError) {
    console.warn("[FCM debug] getToken failed, retrying once:", firstError);
    await new Promise((r) => setTimeout(r, 1500));
    return await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
  }
}

/**
 * Requests notification permission (if not already granted/denied),
 * retrieves an FCM token, registers the service worker, and saves
 * the token to Firestore (fcmTokens/{uid}) so backend functions can
 * send to this device.
 * Safe to call multiple times — no-ops if permission was already denied.
 */
export async function registerForNotifications(uid: string): Promise<void> {
  try {
    const messaging = await getMessagingIfSupported();
    if (!messaging) return; // unsupported browser (e.g. Safari < 16, some in-app browsers)

    if (Notification.permission === "denied") return;

    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
    }

    console.log("[FCM debug] VAPID_KEY present:", !!VAPID_KEY, "prefix:", VAPID_KEY?.slice(0, 6));
    console.log(
      "[FCM debug] messagingSenderId:",
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
    );
    console.log("[FCM debug] appId:", import.meta.env.VITE_FIREBASE_APP_ID);
    console.log("[FCM debug] projectId:", import.meta.env.VITE_FIREBASE_PROJECT_ID);

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    await navigator.serviceWorker.ready; // ensure it's actually active, not just registering

    console.log(
      "[FCM debug] SW registration state:",
      registration.active?.state,
      "scope:",
      registration.scope
    );
    console.log("[FCM debug] Notification.permission at getToken time:", Notification.permission);

    let token: string;
    try {
      token = await getTokenWithRetry(messaging, registration);
    } catch (tokenError) {
      console.error("[FCM debug] getToken failed:", tokenError);
      // Rethrow so the outer catch below still handles/logs it.
      throw tokenError;
    }

    if (!token) {
      console.warn("[FCM debug] getToken returned an empty token");
      return;
    }

    // Save the token so backend functions (sendPushToUid) can reach this
    // device. Doc id = uid, matching the backend and Firestore rules.
    await setDoc(
      doc(db, "fcmTokens", uid),
      { token, updatedAt: serverTimestamp() },
      { merge: true }
    );

    // Foreground messages (app open, tab focused) — service worker's
    // onBackgroundMessage only fires when the tab isn't focused, so
    // this handles the case where the user is actively using the app.
    if (!foregroundListenerAttached) {
      foregroundListenerAttached = true;
      onMessage(messaging, (payload) => {
        const { title, body } = payload.notification ?? {};
        const clickUrl = payload.data?.clickUrl || "/";
        if (Notification.permission === "granted") {
          const notification = new Notification(title ?? "BizMtaani", {
            body: body ?? "",
            icon: "/icon-192.png",
          });
          notification.onclick = () => {
            window.focus();
            window.location.href = clickUrl;
            notification.close();
          };
        }
      });
    }
  } catch (error) {
    console.warn("Failed to register for notifications:", error);
  }
}

/**
 * Removes the saved FCM token — call on sign-out so a stale token
 * doesn't linger and potentially receive notifications meant for
 * whoever logs in next.
 */
export async function unregisterNotifications(uid: string): Promise<void> {
  try {
    await deleteDoc(doc(db, "fcmTokens", uid));
  } catch (error) {
    console.warn("Failed to unregister notifications:", error);
  }
}
