import { getToken, onMessage } from "firebase/messaging";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMessagingIfSupported } from "@/lib/firebase";

// You'll find this in Firebase Console → Project Settings → Cloud Messaging
// → Web configuration → Web Push certificates (generate one if you haven't).
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

/**
 * Requests notification permission (if not already granted/denied),
 * retrieves an FCM token, registers the service worker, and saves
 * the token to Firestore so backend functions can send to this device.
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

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

const token = await getToken(messaging, {
  vapidKey: VAPID_KEY,
  serviceWorkerRegistration: registration,
});

    // Foreground messages (app open, tab focused) — service worker's
    // onBackgroundMessage only fires when the tab isn't focused, so
    // this handles the case where the user is actively using the app.
    onMessage(messaging, (payload) => {
      const { title, body } = payload.notification ?? {};
      if (Notification.permission === "granted") {
        new Notification(title ?? "BizMtaani", {
          body: body ?? "",
          icon: "/icon-192.png",
        });
      }
    });
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
