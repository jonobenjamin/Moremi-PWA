/**
 * Moremi PWA — API root + Firebase.
 *
 * 1) Set MOREMI_API_BASE to your Vercel URL (must match Flutter --dart-define from build-app.sh).
 * 2) Firebase Web config is fetched from the same backend (/api/client-firebase-config) so the PWA
 *    always matches the Firestore project used by FIREBASE_SERVICE_ACCOUNT_KEY on Vercel.
 *    On Vercel set: FIREBASE_WEB_API_KEY, FIREBASE_WEB_APP_ID, FIREBASE_WEB_MESSAGING_SENDER_ID
 *    (or FIREBASE_WEB_CONFIG_JSON). If fetch fails, edit fallback below.
 *
 * This module uses top-level await so auth scripts load only after Firebase is configured.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth,
  signInWithCustomToken,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const MOREMI_API_BASE = 'https://moremi-pwa.vercel.app/';

/** Fallback only if /api/client-firebase-config is unavailable — paste Web app keys for the SAME project as Vercel admin. */
const fallbackFirebaseConfig = {
  apiKey: 'PASTE_WEB_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'PASTE_MESSAGING_SENDER_ID',
  appId: 'PASTE_APP_ID'
};

window.__MOREMI_API_BASE__ = MOREMI_API_BASE;

const firebaseExports = {
  signInWithCustomToken,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
};

let MOREMI_FIRESTORE_DATABASE_ID = '(default)';
let firebaseConfig = { ...fallbackFirebaseConfig };

try {
  const url = `${MOREMI_API_BASE}/api/client-firebase-config`;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.ok) {
    const remote = await r.json();
    if (remote && remote.projectId && remote.apiKey) {
      MOREMI_FIRESTORE_DATABASE_ID = remote.firestoreDatabaseId || '(default)';
      firebaseConfig = {
        apiKey: remote.apiKey,
        authDomain: remote.authDomain || `${remote.projectId}.firebaseapp.com`,
        projectId: remote.projectId,
        storageBucket: remote.storageBucket || `${remote.projectId}.firebasestorage.app`,
        messagingSenderId: remote.messagingSenderId,
        appId: remote.appId
      };
      console.log(
        '[Moremi] Firebase config from API — project:',
        firebaseConfig.projectId,
        'Firestore:',
        MOREMI_FIRESTORE_DATABASE_ID
      );
    }
  } else {
    const errText = await r.text().catch(() => '');
    console.warn('[Moremi] client-firebase-config HTTP', r.status, errText.slice(0, 200));
  }
} catch (e) {
  console.warn('[Moremi] client-firebase-config fetch failed:', e?.message || e);
}

const missingFirebase =
  !firebaseConfig.projectId ||
  firebaseConfig.projectId.includes('PASTE') ||
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.includes('PASTE');

if (missingFirebase) {
  console.error(
    '[Moremi] No valid Firebase web config. Deploy backend with FIREBASE_WEB_* env vars, or paste keys in firebase-config.js fallback.'
  );
  window.__MOREMI_FIREBASE_READY__ = false;
  window.firebaseAuth = {
    auth: null,
    db: null,
    ...firebaseExports
  };
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app, MOREMI_FIRESTORE_DATABASE_ID);

  window.__MOREMI_FIREBASE_READY__ = true;
  window.firebaseAuth = {
    auth,
    db,
    ...firebaseExports
  };
}
