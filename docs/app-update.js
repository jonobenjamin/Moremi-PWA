/**
 * Manual app update for field users.
 * Clears service worker + all caches, then reloads to force fresh content.
 * Must work reliably - users should not need to clear browser data.
 */
async function forceAppUpdate() {
  const btn = document.getElementById('update-app-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating…';
  }

  try {
    // 1. Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    // 2. Clear all caches (flutter-app-cache, flutter-temp-cache, flutter-app-manifest)
    if ('caches' in window) {
      const names = await caches.keys();
      for (const name of names) {
        await caches.delete(name);
      }
    }

    // 3. Hard reload - bypass cache by adding a cache-busting query
    const url = new URL(window.location.href);
    url.searchParams.set('_u', Date.now());
    window.location.replace(url.toString());
  } catch (err) {
    console.error('Update failed:', err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Update app';
    }
    // Fallback: reload anyway
    window.location.reload();
  }
}

function createUpdateButton() {
  if (document.getElementById('update-app-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'update-app-btn';
  btn.type = 'button';
  btn.textContent = 'Update app';
  btn.title = 'Check for updates and reload with latest version';
  btn.setAttribute('aria-label', 'Update app');

  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    zIndex: '10000',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#007aff',
    background: 'rgba(255,255,255,0.95)',
    border: '1px solid #007aff',
    borderRadius: '8px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  });

  btn.addEventListener('click', () => forceAppUpdate());

  document.body.appendChild(btn);
}

// Add button when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createUpdateButton);
} else {
  createUpdateButton();
}

// Expose for programmatic use
window.forceAppUpdate = forceAppUpdate;
