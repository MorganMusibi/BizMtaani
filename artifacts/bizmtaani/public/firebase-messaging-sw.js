// /public/firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAYSIJ1Qd-1j-u1HGIaQ8IhZX2J_mva2Mw",
  authDomain: "bizmtaani-f50d5.firebaseapp.com",
  projectId: "bizmtaani-f50d5",
  storageBucket: "bizmtaani-f50d5.firebasestorage.app",
  messagingSenderId: "22366733449",
  appId: "1:22366733449:web:8ffab0c8c96ab557eef258",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(title || "BizMtaani", {
    body: body || "",
    icon: "/icon-192.png",
    data: { clickUrl: data.clickUrl || "/" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.clickUrl || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
