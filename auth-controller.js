// Authentication Controller — startup must not block on Firebase (login shows immediately).
import { mlsGet, moremiMigrateLegacyStorage, mlsClearAuthKeys } from './moremi-storage.js';

class AuthController {
  constructor() {
    this.flutterStarted = false;
    console.log('AuthController constructor called');
  }

  /** Remove any leftover full-screen layer from older builds so login is visible. */
  removeStaleBlockingLayers() {
    document.getElementById('moremi-config-wall')?.remove();
  }

  isFirebaseRuntimeReady() {
    return !!(window.firebaseAuth?.auth && window.firebaseAuth?.db);
  }

  async init() {
    console.log('Auth controller initializing...');
    this.removeStaleBlockingLayers();
    moremiMigrateLegacyStorage();

    await window.authService?.clearStaleFirebaseSession?.().catch((e) => {
      console.warn('[Moremi] clearStaleFirebaseSession:', e);
    });

    if (await window.authService?.purgeLegacyFirebaseUidIfNeeded?.()) {
      console.warn('[Moremi] Legacy auth UID removed — showing sign-in.');
      window.authUI?.showLoginTypeSelection?.();
      return;
    }

    const storedAuth = mlsGet('userAuthenticated');
    const storedUserName = mlsGet('authenticatedUserName');

    if (storedAuth === 'true' && storedUserName) {
      const firebaseOk = await window.authService?.waitForFirebaseUser?.(4000);
      if (firebaseOk) {
        if (await window.authService?.purgeLegacyFirebaseUidIfNeeded?.()) {
          window.authUI?.showLoginTypeSelection?.();
          return;
        }
        console.log('Restoring session for:', storedUserName);
        this.startFlutterApp();
        return;
      }
      console.warn(
        '[Moremi] Saved login flags but no Firebase user (session expired or stale). Showing sign-in.'
      );
      if (window.authService) {
        await window.authService.signOut().catch(() => {});
      } else {
        mlsClearAuthKeys();
      }
      window.authUI?.showLoginTypeSelection?.();
      return;
    }

    if (this.isFirebaseRuntimeReady() && window.authService?.isAuthenticated?.()) {
      if (await window.authService?.purgeLegacyFirebaseUidIfNeeded?.()) {
        window.authUI?.showLoginTypeSelection?.();
        return;
      }
      console.log('User authenticated via Firebase');
      this.startFlutterApp();
      return;
    }

    console.log('User not authenticated — showing login');
    window.authUI?.showLoginTypeSelection?.();
  }

  startFlutterApp() {
    if (this.flutterStarted) return;
    this.flutterStarted = true;

    console.log('STARTING Flutter app');

    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';

    // Flutter is started once from flutter_bootstrap.js (correct serviceWorkerVersion).
    // Do not call loader.load() again — it caused SW/hash mismatch and duplicate init.
    this.triggerOfflinePrefetch();
  }

  triggerOfflinePrefetch() {
    if (!navigator.onLine || !navigator.serviceWorker) return;

    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage('downloadOffline');
    });
  }
}

function bootstrapMoremiAuth() {
  if (window.__MOREMI_AUTH_BOOTSTRAP_DONE) return;
  window.__MOREMI_AUTH_BOOTSTRAP_DONE = true;

  window.authController = new AuthController();
  void window.authController.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapMoremiAuth);
} else {
  bootstrapMoremiAuth();
}
