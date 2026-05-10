/**
 * PWA Install button - shows "Download app" when browser supports install prompt.
 * Uses beforeinstallprompt to show a custom install button.
 */
(function() {
  let deferredPrompt;

  function createInstallButton() {
    if (document.getElementById('pwa-install-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.type = 'button';
    btn.innerHTML = '&#x2193; Download app';
    btn.title = 'Install KPR Monitor app on your device';
    btn.setAttribute('aria-label', 'Install app');

    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '12px',
      left: '12px',
      zIndex: '10000',
      padding: '10px 18px',
      fontSize: '14px',
      fontWeight: '600',
      color: 'white',
      background: 'linear-gradient(135deg, #007aff, #0056cc)',
      border: 'none',
      borderRadius: '10px',
      cursor: 'pointer',
      boxShadow: '0 2px 10px rgba(0,122,255,0.4)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'none',
    });

    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        btn.style.display = 'none';
      }
      deferredPrompt = null;
    });

    document.body.appendChild(btn);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'block';
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createInstallButton);
  } else {
    createInstallButton();
  }
})();
