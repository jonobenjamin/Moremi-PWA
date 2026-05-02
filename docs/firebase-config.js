/**
 * Moremi PWA — Firebase + API root (edit this file only).
 *
 * Set MOREMI_API_BASE to your Vercel URL. Paste firebaseConfig from Firebase Console → Project settings → Web app.
 * MOREMI_FIRESTORE_DATABASE_ID usually '(default)'; must match Vercel FIRESTORE_DATABASE_ID.
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

const MOREMI_API_BASE = 'https://moremi-pwa-backend.vercel.app';
const MOREMI_FIRESTORE_DATABASE_ID = '(default)';

const firebaseConfig = {
  apiKey: 'PASTE_WEB_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'PASTE_MESSAGING_SENDER_ID',
  appId: 'PASTE_APP_ID',
};

window.__MOREMI_API_BASE__ = MOREMI_API_BASE;

const missingFirebase =
  !firebaseConfig.projectId ||
  firebaseConfig.projectId.includes('PASTE') ||
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.includes('PASTE');

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

if (missingFirebase) {
  console.error(
    '[Moremi] Edit docs/firebase-config.js: paste Web app keys from Firebase Console and set MOREMI_API_BASE.'
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

  console.log('Moremi Firebase:', firebaseConfig.projectId, 'Firestore:', MOREMI_FIRESTORE_DATABASE_ID);

  window.__MOREMI_FIREBASE_READY__ = true;
  window.firebaseAuth = {
    auth,
    db,
    ...firebaseExports
  };
}
