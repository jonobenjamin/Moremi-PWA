// Authentication Controller - Main entry point
class AuthController {
  constructor() {
    this.flutterStarted = false;
    console.log('AuthController constructor called');
  }

  showConfigRequired() {
    if (document.getElementById('moremi-config-wall')) return;

    const el = document.createElement('div');
    el.id = 'moremi-config-wall';
    el.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:#1a2744;color:#e8eef9;padding:22px;font-family:system-ui,sans-serif;overflow:auto;line-height:1.5;';

    el.innerHTML =
      '<h1 style="margin:0 0 12px 0;font-size:1.35rem">Starting app...</h1>' +
      '<p style="opacity:0.95">Initializing Firebase and authentication services.</p>' +
      '<p id="moremi-bootstrap-hint" style="margin:14px 0;padding:12px;background:#2a3f66;border-radius:8px;font-size:14px;white-space:pre-wrap"></p>' +
      '<p style="opacity:0.85;font-size:14px;margin-top:20px">If this stays visible, check console logs.</p>' +
      '<p><button id="moremi-hard-reset" style="padding:12px 18px;font-size:16px;border-radius:10px;border:none;background:#38bdf8;color:#0f172a;font-weight:600;cursor:pointer;margin-top:8px">Clear cache & reload</button></p>';

    document.body.appendChild(el);

    const hintEl = document.getElementById('moremi-bootstrap-hint');
    if (hintEl) {
      hintEl.textContent =
        window.__MOREMI_FIREBASE_BOOTSTRAP_ERROR__ || 'Waiting for Firebase...';
    }

    document.getElementById('moremi-hard-reset').addEventListener('click', async () => {
      try {
        localStorage.clear();
      } catch (e) {}

      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch (e) {}

      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}

      window.location.reload(true);
    });
  }

  async init() {
    console.log('Auth controller initializing...');

    // ✅ FIXED: Firebase is ready if runtime exists, not a flag
    const firebaseReady =
      window.firebaseAuth &&
      window.firebaseAuth.auth &&
      window.firebaseAuth.db;

    if (!firebaseReady) {
      console.warn('Firebase not ready yet — waiting for services...');
      this.showConfigRequired();
      await this.waitForServices();
    }

    await this.waitForServices();
    console.log('Auth services ready');

    const storedAuth = localStorage.getItem('userAuthenticated');
    const storedUserName = localStorage.getItem('authenticatedUserName');

    if (storedAuth === 'true' && storedUserName) {
      console.log('Restoring session for:', storedUserName);
      this.startFlutterApp();
      return;
    }

    const isAuthenticated = window.authService?.isAuthenticated?.();

    if (isAuthenticated) {
      console.log('User authenticated via Firebase');
      this.startFlutterApp();
      return;
    }

    console.log('User not authenticated — showing login');
    window.authUI.showLoginTypeSelection();
  }

  waitForServices() {
    return new Promise((resolve) => {
      const check = () => {
        if (window.firebaseAuth && window.authService && window.authUI) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  startFlutterApp() {
    if (this.flutterStarted) return;
    this.flutterStarted = true;

    console.log('STARTING Flutter app');

    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';

    if (window._flutter?.loader) {
      const loadPromise = window._flutter.loader.load({
        serviceWorkerSettings: {
          serviceWorkerVersion: "921946570"
        }
      });

      if (loadPromise?.then) {
        loadPromise.then(() => this.triggerOfflinePrefetch()).catch(() => {});
      }
    }
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
