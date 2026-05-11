// Authentication Service — MOREMI_AUTH_MODULE=moremi-storage-2026050815
import {
  mlsGet,
  mlsSet,
  mlsRemove,
  mlsClearAuthKeys,
  moremiMigrateLegacyStorage,
  moremiIsLegacyFirebaseUid
} from './moremi-storage.js';
// Import Firebase functions directly
import {
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

class AuthService {
  constructor() {
    this.currentUser = null;
    this.recaptchaVerifier = null;
    this._authListenerBound = false;
    void this.init();
  }

  get auth() {
    return window.firebaseAuth?.auth || null;
  }

  get db() {
    return window.firebaseAuth?.db || null;
  }

  bindAuthStateListener() {
    if (this._authListenerBound || !this.auth) return;
    this._authListenerBound = true;
    onAuthStateChanged(this.auth, async (user) => {
      if (user && moremiIsLegacyFirebaseUid(user.uid)) {
        console.warn(
          '[Moremi] This app no longer uses custom sign-in IDs. Signed out — please sign in again with email/password or PIN.'
        );
        try {
          await signOut(this.auth);
        } catch (e) {
          console.warn('[Moremi] signOut (legacy uid):', e);
        }
        this.currentUser = null;
        mlsClearAuthKeys();
        try {
          window.authUI?.showAuthOverlay?.();
          window.authUI?.showLoginTypeSelection?.();
        } catch (e) {
          /* ignore */
        }
        if (window.authController?.flutterStarted) {
          window.location.reload();
        }
        return;
      }
      this.currentUser = user;
      if (user) {
        void this.updateUserLastLogin(user.uid);
        try {
          const token = await user.getIdToken();
          mlsSet('firebaseIdToken', token);
          mlsSet('firebaseUid', user.uid);
        } catch (e) {
          console.warn('[Moremi] Token not stored yet (transient); auth session is active', e);
        }
        user
          .getIdTokenResult()
          .then((r) => {
            const u = r.claims.username;
            if (u) mlsSet('authenticatedUsername', String(u));
          })
          .catch(() => {});
      } else {
        mlsRemove('firebaseIdToken');
        mlsRemove('firebaseUid');
      }
    });
  }

  tryBindFromWindow() {
    if (!this.auth) return false;
    this.bindAuthStateListener();
    return true;
  }

  pollBindAuth(maxAttempts) {
    let n = 0;
    const step = () => {
      if (this._authListenerBound) return;
      this.tryBindFromWindow();
      n++;
      if (!this._authListenerBound && n < maxAttempts) {
        setTimeout(step, 50);
      }
    };
    step();
  }

  async init() {
    await this.waitForFirebase();
    this.tryBindFromWindow();
    this.pollBindAuth(400);
    if (!this.auth) {
      console.warn('[Moremi] Firebase Auth not bound yet; will bind when available (UI is not blocked).');
    }
  }

  /**
   * Call before operations that need this.auth. Does not block the rest of the app.
   */
  async ensureAuthClient() {
    if (this.auth) return;
    this.tryBindFromWindow();
    for (let i = 0; i < 120; i++) {
      if (this.auth) return;
      await new Promise((r) => setTimeout(r, 50));
      this.tryBindFromWindow();
    }
    throw new Error('Firebase Auth is still starting. Please wait a moment and try again.');
  }

  waitForFirebase() {
    moremiMigrateLegacyStorage();
    return new Promise((resolve) => {
      let attempts = 0;
      const max = 400;
      const checkFirebase = () => {
        if (window.__MOREMI_FIREBASE_READY__ === true && window.firebaseAuth?.auth) {
          resolve();
          return;
        }
        if (window.__MOREMI_FIREBASE_READY__ === false) {
          resolve();
          return;
        }
        attempts++;
        if (attempts >= max) {
          console.warn('[Moremi] Firebase bootstrap slow; continuing without blocking UI.');
          resolve();
          return;
        }
        setTimeout(checkFirebase, 50);
      };
      checkFirebase();
    });
  }

  apiBase() {
    const b = window.__MOREMI_API_BASE__;
    if (!b) {
      console.error('Moremi: firebase-config.js must set window.__MOREMI_API_BASE__');
      return '';
    }
    return String(b).replace(/\/$/, '');
  }

  /** Retries once on transient Identity Toolkit / fetch errors. */
  async signInWithCustomTokenResilient(customToken) {
    const attempt = () => signInWithCustomToken(this.auth, customToken);
    try {
      return await attempt();
    } catch (e) {
      const retryable =
        e &&
        (e.code === 'auth/network-request-failed' ||
          e.code === 'auth/internal-error' ||
          e.code === 'auth/timeout' ||
          /network|fetch|Failed to fetch|identitytoolkit/i.test(String(e.message || '')));
      if (retryable) {
        await new Promise((r) => setTimeout(r, 450));
        return await attempt();
      }
      throw e;
    }
  }

  async loginWithPassword(email, password) {
    const apiBase = this.apiBase();
    if (!apiBase) throw new Error('API URL not set — edit docs/firebase-config.js');
    await this.ensureAuthClient();
    const emailNorm = String(email).trim().toLowerCase();
    if (!emailNorm || !password) {
      throw new Error('Email and password are required');
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm);
    if (!emailOk) {
      throw new Error('Use your full email address (for example name@domain.com)');
    }
    let result;
    try {
      result = await signInWithEmailAndPassword(this.auth, emailNorm, password);
    } catch (e) {
      const code = e && e.code;
      const msg = String(e && e.message ? e.message : e || '');
      const rest =
        (e &&
          e.customData &&
          e.customData._serverResponse &&
          e.customData._serverResponse.error &&
          e.customData._serverResponse.error.message) ||
        '';
      console.warn('[Moremi] signInWithEmailAndPassword', {
        firebaseCode: code || null,
        message: msg,
        identityToolkit: rest || null
      });
      const credProblem =
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials' ||
        code === 'auth/missing-password' ||
        /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/i.test(rest) ||
        /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/i.test(msg);
      if (code === 'auth/invalid-email') {
        throw new Error(
          'Use your full email address (for example name@domain.com). If you see this with a normal email, deploy the latest site and hard-refresh. [Firebase: auth/invalid-email]'
        );
      }
      if (credProblem) {
        throw new Error(
          'That email and password don’t match what Firebase has. If you ever used “Email (PIN)”, Firebase gave you a random password you never saw — tap Forgot password and set a new one. In Firebase Console → Authentication → Users, confirm this email exists with Email/Password. [' +
            (code || rest || 'invalid-credentials') +
            ']'
        );
      }
      if (code === 'auth/too-many-requests') {
        throw new Error('Too many attempts. Try again in a few minutes. [Firebase: auth/too-many-requests]');
      }
      if (code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/password sign-in is turned off in Firebase. Enable it: Authentication → Sign-in method → Email/Password. [Firebase: auth/operation-not-allowed]'
        );
      }
      if (code === 'auth/user-disabled') {
        throw new Error('This account is disabled. Contact support. [Firebase: auth/user-disabled]');
      }
      throw new Error(
        (e?.message || 'Sign-in failed') +
          ' [Firebase: ' +
          (code || rest || 'unknown') +
          '] Please check your internet connection and try again.'
      );
    }
    mlsSet('userAuthenticated', 'true');
    mlsSet('authenticatedUserName', result.user.displayName || emailNorm.split('@')[0] || '');
    mlsSet('authenticatedUsername', emailNorm);
    try {
      const token = await result.user.getIdToken();
      mlsSet('firebaseIdToken', token);
      mlsSet('firebaseUid', result.user.uid);
    } catch (e) {
      console.warn('[Moremi] Token storage:', e);
    }
    await this.updateUserLastLogin(result.user.uid);
    return result;
  }

  async requestPasswordReset(email) {
    if (!this.apiBase()) throw new Error('API URL not set — edit docs/firebase-config.js');
    await this.ensureAuthClient();
    const emailNorm = String(email).trim().toLowerCase();
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      throw new Error('Enter a valid email address');
    }
    try {
      await sendPasswordResetEmail(this.auth, emailNorm);
    } catch (e) {
      const code = e && e.code;
      console.warn('[Moremi] sendPasswordResetEmail', code, e?.message);
      if (code === 'auth/user-not-found') {
        throw new Error('No Firebase account for that email. Try Create account or Email (PIN) sign-in.');
      }
      if (code === 'auth/too-many-requests') {
        throw new Error('Too many reset emails. Wait a few minutes and try again.');
      }
      if (code === 'auth/operation-not-allowed') {
        throw new Error('Password reset is not available (check Email/Password is enabled in Firebase).');
      }
      throw new Error(e?.message || 'Could not send reset email');
    }
  }

  async registerAccount({ username, password, email, phone, displayName }) {
    const apiBase = this.apiBase();
    if (!apiBase) throw new Error('API URL not set — edit docs/firebase-config.js');
    await this.ensureAuthClient();
    const emailNorm = email ? String(email).trim().toLowerCase() : '';
    if (!emailNorm || !password) {
      throw new Error('Email and password are required');
    }
    const body = {
      email: emailNorm,
      password,
      displayName:
        (displayName && String(displayName).trim()) ||
        (username && String(username).trim()) ||
        emailNorm.split('@')[0] ||
        'User'
    };
    if (username && String(username).trim()) body.username = String(username).trim().toLowerCase();
    if (phone && String(phone).trim()) body.phone = String(phone).trim();

    const response = await fetch(`${apiBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Registration failed');
    }
    if (!data.customToken) {
      throw new Error('Invalid server response');
    }
    const result = await this.signInWithCustomTokenResilient(data.customToken);
    mlsSet('userAuthenticated', 'true');
    mlsSet('authenticatedUserName', data.name || body.displayName);
    mlsSet('authenticatedUsername', data.email || emailNorm);
    try {
      await this.createOrUpdateUser(result.user, {
        email: body.email,
        name: data.name || body.displayName,
        phone: body.phone,
        username: data.username || body.username
      });
    } catch (err) {
      console.warn('createOrUpdateUser after register:', err);
    }
    return result;
  }

  /**
   * Create or merge userProfiles for the signed-in user (after registration wizard).
   */
  async saveInitialUserProfile({ avatarEmoji }) {
    await this.ensureAuthClient();
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in');
    if (!this.db) throw new Error('Firestore not ready');

    const displayName = (mlsGet('authenticatedUserName') || 'User').trim() || 'User';
    const emoji = (avatarEmoji && String(avatarEmoji)) || '🐘';

    const ref = doc(this.db, 'userProfiles', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        username: displayName,
        avatarEmoji: emoji,
        createdAt: serverTimestamp(),
        currentGroupId: null
      });
    } else {
      await setDoc(
        ref,
        {
          username: displayName,
          avatarEmoji: emoji
        },
        { merge: true }
      );
    }
  }

  /**
   * POST /api/auth/join-group with Firebase ID token (same as Flutter join).
   */
  async joinGroupWithInviteCode(rawCode) {
    const apiBase = this.apiBase();
    if (!apiBase) throw new Error('API URL not set');
    await this.ensureAuthClient();
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const token = await user.getIdToken();
    const inviteCode = String(rawCode || '').trim().toUpperCase();
    if (inviteCode.length < 4) {
      throw new Error('Enter a valid invite code');
    }
    const response = await fetch(`${apiBase}/api/auth/join-group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ inviteCode })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Could not join group');
    }
    return data;
  }

  async requestEmailPin(email, name) {
    try {
      const apiBase = this.apiBase();
      if (!apiBase) throw new Error('API URL not set — edit docs/firebase-config.js');
      const response = await fetch(`${apiBase}/api/auth/request-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, name })
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = await response.json().catch(() => ({ message: errorText }));
        throw new Error(error.message || 'Failed to send PIN');
      }

      return { success: true, message: 'PIN sent to your email' };
    } catch (error) {
      console.error('Email PIN request failed:', error);
      throw new Error(`Failed to send PIN: ${error.message}`);
    }
  }

  async verifyEmailPin(email, pin) {
    try {
      const apiBase = this.apiBase();
      if (!apiBase) throw new Error('API URL not set — edit docs/firebase-config.js');
      const response = await fetch(`${apiBase}/api/auth/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, pin })
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = await response.json().catch(() => ({ message: errorText }));
        throw new Error(error.message || 'Invalid PIN');
      }

      const data = await response.json();
      await this.ensureAuthClient();
      // Sign in with custom token
      const result = await this.signInWithCustomTokenResilient(data.customToken);

      // Create/update user document
      try {
        await this.createOrUpdateUser(result.user, { email, name: data.name });
      } catch (error) {
        console.warn('[Moremi] User document update after PIN (non-blocking):', error);
      }

      // Store authentication state for offline use
      mlsSet('userAuthenticated', 'true');
      mlsSet('authenticatedUserName', data.name);

      return { success: true, user: result.user };
    } catch (error) {
      console.error('Email PIN verification failed:', error);
      throw error;
    }
  }

  // Phone Authentication
  async requestPhoneOtp(phoneNumber, name) {
    try {
      await this.ensureAuthClient();

      // Validate phone number format
      const phoneRegex = /^\+[1-9]\d{1,14}$/;
      if (!phoneRegex.test(phoneNumber)) {
        throw new Error('Please enter a valid phone number with country code (e.g., +1234567890)');
      }

      // Initialize reCAPTCHA if not already done
      if (!this.recaptchaVerifier) {
        // Clear any existing reCAPTCHA
        const container = document.getElementById('recaptcha-container');
        if (container) {
          container.innerHTML = '';
        }

        try {
          this.recaptchaVerifier = new RecaptchaVerifier(this.auth, 'recaptcha-container', {
            size: 'invisible',
            callback: () => {},
            'expired-callback': () => {
              this.recaptchaVerifier = null;
            },
            'error-callback': (error) => {
              console.error('[Moremi] reCAPTCHA error:', error);
            }
          });
        } catch (error) {
          console.error('[Moremi] Failed to create reCAPTCHA verifier:', error);
          throw new Error('Failed to initialize security verification. Please refresh the page and try again.');
        }
      }

      this.confirmationResult = await signInWithPhoneNumber(this.auth, phoneNumber, this.recaptchaVerifier);

      // Store user data for later use
      sessionStorage.setItem('pendingPhoneUser', JSON.stringify({ name, phone: phoneNumber }));

      return { success: true, message: 'SMS code sent to your phone' };

    } catch (error) {
      console.error('Phone OTP request failed:', error);

      // Reset reCAPTCHA on error
      if (this.recaptchaVerifier) {
        this.recaptchaVerifier.clear();
        this.recaptchaVerifier = null;
      }

      // Handle specific Firebase errors
      if (error.code === 'auth/invalid-phone-number') {
        throw new Error('Invalid phone number format. Please include country code (e.g., +1 for US).');
      } else if (error.code === 'auth/too-many-requests') {
        throw new Error('Too many requests. Please try again later.');
      } else if (error.code === 'auth/missing-recaptcha-token') {
        throw new Error('reCAPTCHA verification failed. Please refresh and try again.');
      }

      throw new Error(`Failed to send SMS: ${error.message}`);
    }
  }

  async verifyPhoneOtp(otp) {
    try {
      if (!this.confirmationResult) {
        throw new Error('No OTP request found. Please request OTP first.');
      }

      const result = await this.confirmationResult.confirm(otp);

      // Update user document with phone auth data
      const pendingUserData = JSON.parse(sessionStorage.getItem('pendingPhoneUser'));
      if (pendingUserData) {
        await this.createOrUpdateUser(result.user, pendingUserData);
        sessionStorage.removeItem('pendingPhoneUser');

        // Store authentication state for offline use
        mlsSet('userAuthenticated', 'true');
        mlsSet('authenticatedUserName', pendingUserData.name);
      }

      return { success: true, user: result.user };
    } catch (error) {
      console.error('Phone OTP verification failed:', error);
      throw new Error(`Invalid OTP: ${error.message}`);
    }
  }

  // User Management
  async createOrUpdateUser(user, userData) {
    if (!this.db) throw new Error('Firestore instance not available');
    if (!this.auth?.currentUser) throw new Error('User not authenticated');

    const userDoc = {
      uid: user.uid,
      name: userData.name,
      email: userData.email ?? user.email ?? null,
      phone: userData.phone ?? user.phoneNumber ?? null,
      ...(userData.username ? { username: userData.username } : {}),
      lastLogin: serverTimestamp()
    };

    try {
      const docRef = doc(this.db, 'users', user.uid);
      await setDoc(docRef, userDoc, { merge: true });
    } catch (error) {
      console.error('[Moremi] createOrUpdateUser failed:', error.code, error.message);
      throw error;
    }
  }

  async updateUserLastLogin(uid) {
    if (!this.db || !uid) return;
    try {
      await setDoc(
        doc(this.db, 'users', uid),
        { lastLogin: serverTimestamp() },
        { merge: true }
      );
    } catch (error) {
      console.warn('Failed to update last login:', error);
    }
  }

  async checkUserStatus() {
    if (!this.currentUser || !this.db) return null;
    try {
      const userDoc = await getDoc(doc(this.db, 'users', this.currentUser.uid));
      if (userDoc.exists()) {
        return userDoc.data();
      }
      return null;
    } catch (error) {
      console.error('[Moremi] checkUserStatus failed:', error.code, error.message);
      return null;
    }
  }

  // Check if user is allowed to submit data (not revoked)
  async canSubmitData() {
    const userStatus = await this.checkUserStatus();
    if (!userStatus) {
      return true; // Allow new users to submit until status is set
    }

    const isActive = userStatus.status === 'active' || userStatus.status === undefined;
    if (!isActive) {
      console.warn('[Moremi] REVOKED USER attempted to submit data - BLOCKED');
    }

    return isActive;
  }

  async purgeLegacyFirebaseUidIfNeeded() {
    try {
      await this.ensureAuthClient();
    } catch (e) {
      return false;
    }
    if (!this.auth) return false;
    const u = this.auth.currentUser;
    if (!u || !moremiIsLegacyFirebaseUid(u.uid)) return false;
    console.warn(
      '[Moremi] Clearing legacy custom Firebase UID — sign in again with email/password or PIN.'
    );
    try {
      await signOut(this.auth);
    } catch (e) {
      console.warn('[Moremi] signOut (legacy uid purge):', e);
    }
    this.currentUser = null;
    mlsClearAuthKeys();
    return true;
  }

  async signOut() {
    try {
      await this.ensureAuthClient();
    } catch (e) {
      /* no auth client yet — still clear local session */
    }
    if (this.auth) {
      await signOut(this.auth);
    }
    this.currentUser = null;
    mlsClearAuthKeys();
  }

  /**
   * Same-origin: Firebase can restore a user without our scoped LS keys (e.g. another GH Pages app).
   * Clear Firebase when we do not have an app session for this path.
   */
  async clearStaleFirebaseSession() {
    try {
      await this.ensureAuthClient();
    } catch (e) {
      return;
    }
    if (!this.auth) return;
    if (this.auth.currentUser && moremiIsLegacyFirebaseUid(this.auth.currentUser.uid)) {
      console.warn('[Moremi] Clearing session: legacy custom Firebase UID is no longer valid.');
      try {
        await signOut(this.auth);
      } catch (e) {
        console.warn('[Moremi] signOut (legacy uid):', e);
      }
      this.currentUser = null;
      mlsClearAuthKeys();
      return;
    }
    if (this.auth.currentUser && mlsGet('userAuthenticated') !== 'true') {
      try {
        await signOut(this.auth);
      } catch (e) {
        console.warn('[Moremi] signOut (stale session):', e);
      }
      this.currentUser = null;
      mlsClearAuthKeys();
    }
  }

  isAuthenticated() {
    return !!this.currentUser;
  }

  /**
   * Wait until Firebase restores persistence or gives up (installed PWA / stale LS flags).
   */
  waitForFirebaseUser(maxMs = 4000) {
    return new Promise((resolve) => {
      (async () => {
        try {
          await this.ensureAuthClient();
        } catch (e) {
          resolve(false);
          return;
        }
        if (!this.auth) {
          resolve(false);
          return;
        }
        if (this.auth.currentUser) {
          resolve(true);
          return;
        }
        let settled = false;
        const finish = (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          try {
            unsub();
          } catch (e) {
            /* ignore */
          }
          resolve(v);
        };
        const t = setTimeout(() => finish(false), maxMs);
        const unsub = onAuthStateChanged(this.auth, (user) => {
          if (user) finish(true);
        });
      })();
    });
  }
}

// Create global instance
window.authService = new AuthService();