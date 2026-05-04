/**
 * Moremi PWA — API root + Firebase (browser).
 * MOREMI_API_BASE: your Vercel API (must match ./build-app.sh --dart-define API_BASE_URL).
 * Firebase initializes from embedded fallback; /api/client-firebase-config is optional enhancement.
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

const MOREMI_API_BASE = 'https://moremi-pwa.vercel.app';

const fallbackFirebaseConfig = {
  apiKey: 'AIzaSyB4eTkmBRxQ7hNm0zNRuXa1xzqTkeNa4bM',
  authDomain: 'moremi-app.firebaseapp.com',
  projectId: 'moremi-app',
  storageBucket: 'moremi-app.firebasestorage.app',
  messagingSenderId: '478665220534',
  appId: '1:478665220534:web:98b23a9c8fb77504232117'
};

window.__MOREMI_API_BASE__ = MOREMI_API_BASE;
window.__MOREMI_FIREBASE_BOOTSTRAP_ERROR__ = '';

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

let usedRemoteFirebaseConfig = false;
let MOREMI_FIRESTORE_DATABASE_ID = '(default)';
let firebaseConfig = { ...fallbackFirebaseConfig };

try {
  const url = `${MOREMI_API_BASE}/api/client-firebase-config`;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.ok) {
    const remote = await r.json();
    if (remote && remote.projectId && remote.apiKey && !remote.error) {
      MOREMI_FIRESTORE_DATABASE_ID = remote.firestoreDatabaseId || '(default)';
      firebaseConfig = {
        apiKey: remote.apiKey,
        authDomain: remote.authDomain || `${remote.projectId}.firebaseapp.com`,
        projectId: remote.projectId,
        storageBucket: remote.storageBucket || `${remote.projectId}.firebasestorage.app`,
        messagingSenderId: remote.messagingSenderId,
        appId: remote.appId
      };
      usedRemoteFirebaseConfig = true;
      console.log('[Moremi] Using remote Firebase config');
      console.log('[Moremi] Remote project:', firebaseConfig.projectId, 'Firestore:', MOREMI_FIRESTORE_DATABASE_ID);
    } else {
      console.warn('[Moremi] Remote Firebase config missing fields or returned error; using embedded fallback.', remote);
    }
  } else {
    console.warn(`[Moremi] /api/client-firebase-config HTTP ${r.status}; using embedded fallback.`);
  }
} catch (e) {
  console.warn('[Moremi] /api/client-firebase-config fetch failed; using embedded fallback.', e?.message || e);
}

if (!usedRemoteFirebaseConfig) {
  console.log('[Moremi] Using fallback Firebase config');
}

const missingFirebase =
  !firebaseConfig.projectId ||
  !firebaseConfig.apiKey ||
  String(firebaseConfig.projectId).includes('PASTE') ||
  String(firebaseConfig.apiKey).includes('PASTE');

if (missingFirebase) {
  window.__MOREMI_FIREBASE_BOOTSTRAP_ERROR__ =
    'Firebase web config in docs/firebase-config.js is invalid or still has placeholder values.';
  console.error('[Moremi] Firebase not configured:', window.__MOREMI_FIREBASE_BOOTSTRAP_ERROR__);
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
  window.__MOREMI_FIREBASE_BOOTSTRAP_ERROR__ = '';
  window.__MOREMI_FIREBASE_READY__ = true;
  window.firebaseAuth = {
    auth,
    db,
    ...firebaseExports
  };
  console.log('[Moremi] Firebase initialized', firebaseConfig.projectId, 'Firestore:', MOREMI_FIRESTORE_DATABASE_ID);
}
