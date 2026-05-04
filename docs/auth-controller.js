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
      '<h1 style="margin:0 0 12px 0;font-size:1.35rem">Finish Firebase setup</h1>' +
      '<p>Open <code style="background:#2a3f66;padding:3px 8px;border-radius:6px">docs/firebase-config.js</code> in your project and replace every <strong>PASTE_…</strong> value with your <strong>Moremi</strong> web app keys (Firebase Console → Project settings).</p>' +
      '<p style="margin:12px 0"><strong>Important:</strong> On Vercel, <code>FIREBASE_SERVICE_ACCOUNT_KEY</code> must be from the <strong>same</strong> Firebase project. If it is still the old account, API writes will keep going to the old database. After changing Vercel env, redeploy the backend.</p>' +
      '<p style="opacity:0.9"><strong>Still seeing the old KPR map?</strong> You may be opening an old GitHub Pages URL, or a service worker was serving an old <code>main.dart.js</code>. This site no longer double-registers the worker — use the button below once, then hard refresh.</p>' +
      '<p><button type="button" id="moremi-hard-reset" style="padding:12px 18px;font-size:16px;border-radius:10px;border:none;background:#38bdf8;color:#0f172a;font-weight:600;cursor:pointer;margin-top:8px">Clear cached old app &amp; reload</button></p>' +
      '<p style="opacity:0.85;font-size:14px;margin-top:20px">After editing Firebase config on GitHub: commit and wait for Pages to rebuild, then reload.</p>';

    document.body.appendChild(el);

    document.getElementById('moremi-hard-reset').addEventListener('click', async function () {
      try {
        localStorage.removeItem('userAuthenticated');
        localStorage.removeItem('authenticatedUserName');
        localStorage.removeItem('authenticatedUsername');
        localStorage.removeItem('firebaseIdToken');
        localStorage.removeItem('firebaseUid');
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

    // Must be explicitly true — not undefined (avoids racing before firebase-config.js).
    if (window.__MOREMI_FIREBASE_READY__ !== true) {
      console.warn('Firebase not ready: edit docs/firebase-config.js (paste real Web app keys).');
      this.showConfigRequired();
      return;
    }

    await this.waitForServices();
    console.log('Auth services ready');

    const storedAuth = localStorage.getItem('userAuthenticated');
    const storedUserName = localStorage.getItem('authenticatedUserName');
    console.log('DEBUG: storedAuth:', storedAuth, 'storedUserName:', storedUserName);

    if (storedAuth === 'true' && storedUserName) {
      console.log('Found previously authenticated user:', storedUserName, '- starting Flutter directly');
      this.startFlutterApp();
      return;
    }

    const isAuthenticated = window.authService.isAuthenticated();
    console.log('Current Firebase auth state:', isAuthenticated);

    if (isAuthenticated) {
      console.log('User is currently authenticated with Firebase - starting Flutter');
      this.startFlutterApp();
      return;
    }

    console.log('User not authenticated - showing auth UI');
    window.authUI.showLoginTypeSelection();
  }

  waitForServices() {
    return new Promise((resolve) => {
      const checkServices = () => {
        if (window.firebaseAuth && window.authService && window.authUI) {
          resolve();
        } else {
          setTimeout(checkServices, 100);
        }
      };
      checkServices();
    });
  }

  showAuthScreen() {
    console.log('Auth screen should already be visible');
  }

  startFlutterApp() {
    console.log('STARTING Flutter app');

    if (this.flutterStarted) {
      console.log('Flutter app already started, skipping');
      return;
    }
    this.flutterStarted = true;

    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }

    if (window._flutter && window._flutter.loader) {
      const loadPromise = window._flutter.loader.load({
        serviceWorkerSettings: {
          serviceWorkerVersion: "200661858"
        }
      });
      if (loadPromise && typeof loadPromise.then === 'function') {
        loadPromise.then(() => this.triggerOfflinePrefetch()).catch(() => {});
      } else {
        setTimeout(() => this.triggerOfflinePrefetch(), 3000);
      }
    } else {
      console.error('Flutter loader not available');
    }
  }

  triggerOfflinePrefetch() {
    if (!navigator.onLine || !navigator.serviceWorker) return;
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.active) {
          reg.active.postMessage('downloadOffline');
        }
      })
      .catch(() => {});
  }

  showOfflineMessage() {
    const container = document.createElement('div');
    container.id = 'auth-overlay';
    container.innerHTML = `
      <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.8); display: flex; justify-content: center; align-items: center; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="background: white; border-radius: 16px; padding: 24px; max-width: 400px; width: 90%; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2); text-align: center;">
          <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">Moremi wildlife</h2>
          <p style="color: #666; margin-bottom: 20px; font-size: 16px;">
            You appear to be offline. Connect to the internet to sign in.
          </p>
          <button onclick="window.location.reload()" style="background: linear-gradient(135deg, #007aff, #0056cc); color: white; border: none; padding: 16px 20px; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; box-sizing: border-box; min-height: 48px;">
            Retry
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(container);
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
