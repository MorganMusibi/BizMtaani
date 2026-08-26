import { getToken, onMessage, onTokenRefresh } from "firebase/messaging";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMessagingIfSupported } from "@/lib/firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export async function registerForNotifications(uid: string): Promise<void> {
  try {
    const messaging = await getMessagingIfSupported();
    if (!messaging) return;

    if (Notification.permission === "denied") return;

    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
    }

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    registration.active?.postMessage({
      type: "FIREBASE_CONFIG",
      config: {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      },
    });

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) return;

    // Save token to Firestore
    await setDoc(doc(db, "fcmTokens", uid), {
      token,
      updatedAt: new Date().toISOString(),
    });

    // Listen for token refresh and update Firestore
    onTokenRefresh(messaging, async (newToken) => {
      await setDoc(doc(db, "fcmTokens", uid), {
        token: newToken,
        updatedAt: new Date().toISOString(),
      });
    });

    // Foreground messages – dispatch a custom event so we can show a toast and navigate
    onMessage(messaging, (payload) => {
      const { title, body } = payload.notification ?? {};
      const data = payload.data || {};
      window.dispatchEvent(
        new CustomEvent("notification-received", {
          detail: { title, body, clickUrl: data.clickUrl || "/" },
        })
      );
    });

  } catch (error) {
    console.warn("Failed to register for notifications:", error);
  }
}

export async function unregisterNotifications(uid: string): Promise<void> {
  try {
    await deleteDoc(doc(db, "fcmTokens", uid));
  } catch (error) {
    console.warn("Failed to unregister notifications:", error);
  }
}
