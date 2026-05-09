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

window.forceAppUpdate = forceAppUpdate;
