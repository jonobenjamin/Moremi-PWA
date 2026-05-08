/**
 * Moremi PWA — API root + Firebase (browser).
 * MOREMI_API_BASE: your Vercel API (must match ./build-app.sh --dart-define API_BASE_URL).
 * Firebase initializes from embedded fallback; /api/client-firebase-config is optional enhancement.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  sendPasswordResetEmail
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
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  sendPasswordResetEmail,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
};

function firebaseConfigIsComplete(cfg) {
  return !!(
    cfg &&
    cfg.projectId &&
    cfg.apiKey &&
    cfg.appId &&
    cfg.messagingSenderId &&
    !String(cfg.projectId).includes('PASTE') &&
    !String(cfg.apiKey).includes('PASTE')
  );
}

let usedRemoteFirebaseConfig = false;
let MOREMI_FIRESTORE_DATABASE_ID = '(default)';

function applyRemoteFirestoreIfNeeded(app, remote) {
  if (!firebaseConfigIsComplete(remote) || remote.error) return;
  usedRemoteFirebaseConfig = true;
  const dbId = remote.firestoreDatabaseId || '(default)';
  if (dbId !== MOREMI_FIRESTORE_DATABASE_ID) {
    MOREMI_FIRESTORE_DATABASE_ID = dbId;
    window.firebaseAuth.db = getFirestore(app, MOREMI_FIRESTORE_DATABASE_ID);
    console.log('[Moremi] Remote Firestore database:', MOREMI_FIRESTORE_DATABASE_ID);
  }
}

function fetchRemoteFirestoreConfig(app) {
  void (async () => {
    try {
      const url = `${MOREMI_API_BASE}/api/client-firebase-config`;
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const remote = await r.json();
        if (firebaseConfigIsComplete(remote) && !remote.error) {
          if (remote.projectId && remote.projectId !== fallbackFirebaseConfig.projectId) {
            console.warn(
              '[Moremi] Remote Firebase project differs from embedded config; keeping embedded app id for stability.',
              remote.projectId,
              'vs',
              fallbackFirebaseConfig.projectId
            );
          } else {
            console.log('[Moremi] Remote /api/client-firebase-config OK; Firestore:', remote.firestoreDatabaseId || '(default)');
            applyRemoteFirestoreIfNeeded(app, remote);
          }
        } else {
          console.warn('[Moremi] Remote Firebase config incomplete or error; using embedded Firestore.', remote);
        }
      } else {
        console.warn(`[Moremi] /api/client-firebase-config HTTP ${r.status}; using embedded Firestore.`);
      }
    } catch (e) {
      console.warn('[Moremi] /api/client-firebase-config fetch failed; using embedded Firestore.', e?.message || e);
    }
    if (!usedRemoteFirebaseConfig) {
      console.log('[Moremi] Using embedded Firebase config only (default Firestore DB)');
    }
  })();
}

const missingFirebase = !firebaseConfigIsComplete(fallbackFirebaseConfig);

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
  const app = initializeApp(fallbackFirebaseConfig);
  window.__MOREMI_FIREBASE_APP__ = app;
  // Synchronous bootstrap (no await before this) so Auth inits before Flutter loads — avoids
  // IndexedDB + iframe / gapi races (api.js "u[v] is not a function").
  let auth;
  try {
    auth = initializeAuth(app, { persistence: browserLocalPersistence });
  } catch (e) {
    if (e && e.code === 'auth/already-initialized') {
      auth = getAuth(app);
    } else {
      throw e;
    }
  }
  const db = getFirestore(app, MOREMI_FIRESTORE_DATABASE_ID);
  window.__MOREMI_FIREBASE_BOOTSTRAP_ERROR__ = '';
  window.__MOREMI_FIREBASE_READY__ = true;
  window.firebaseAuth = {
    auth,
    db,
    ...firebaseExports
  };
  console.log('[Moremi] Firebase initialized', fallbackFirebaseConfig.projectId, 'Firestore:', MOREMI_FIRESTORE_DATABASE_ID);
  fetchRemoteFirestoreConfig(app);
}
