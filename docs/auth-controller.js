// Authentication Controller — startup must not block on Firebase (login shows immediately).
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

    const storedAuth = localStorage.getItem('userAuthenticated');
    const storedUserName = localStorage.getItem('authenticatedUserName');

    if (storedAuth === 'true' && storedUserName) {
      console.log('Restoring session for:', storedUserName);
      this.startFlutterApp();
      return;
    }

    if (this.isFirebaseRuntimeReady() && window.authService?.isAuthenticated?.()) {
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
  window.authController.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapMoremiAuth);
} else {
  bootstrapMoremiAuth();
}
