import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { Firestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let fs: Firestore | null = null;

export function getFirebase() {
  if (!isFirebaseConfigured) throw new Error('Firebase is not configured. Add VITE_FIREBASE_* values to .env');
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
    auth = getAuth(app);
    // Keep a copy of the school's data on this device so registers and marks can be
    // entered with no internet; Firestore syncs the changes when the connection returns.
    try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
    catch { fs = initializeFirestore(app, {}); }
  }
  return { app: app!, auth: auth!, db: fs! };
}

/** A second Firebase app instance, so an admin can create accounts without being signed out. */
export function getSecondaryAuth(): Auth {
  const existing = getApps().find((a) => a.name === 'secondary');
  const second = existing ?? initializeApp(firebaseConfig, 'secondary');
  return getAuth(second);
}
