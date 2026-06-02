import admin from "firebase-admin";

let initialized = false;

export function getFirebaseAdmin(): admin.app.App {
  if (initialized) return admin.app();

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON env var is not set");
  }

  const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;
  return admin.app();
}

export function getMessaging(): admin.messaging.Messaging {
  return getFirebaseAdmin().messaging();
}

export function getFirestore(): admin.firestore.Firestore {
  return getFirebaseAdmin().firestore();
}
