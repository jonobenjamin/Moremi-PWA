/**
 * Path-scoped localStorage so multiple apps under the same origin (e.g. user.github.io)
 * do not share auth/session keys. Also migrates legacy unprefixed keys on Moremi-PWA only.
 */
const LEGACY_KEYS = [
  'firebaseIdToken',
  'firebaseUid',
  'userAuthenticated',
  'authenticatedUserName',
  'authenticatedUsername'
];

export function moremiStoragePrefix() {
  try {
    const path = (window.location && window.location.pathname) || '/';
    const seg = path
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)[0] || 'app';
    return `moremi:${seg}:`;
  } catch (e) {
    return 'moremi:app:';
  }
}

export function moremiMigrateLegacyStorage() {
  const p = moremiStoragePrefix();
  if (localStorage.getItem(p + '__migrated_v2')) return;

  const path = (window.location && window.location.pathname) || '';
  const seg = path
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)[0] || '';
  const allowLegacyMigrate = seg.toLowerCase() === 'moremi-pwa';

  if (allowLegacyMigrate) {
    const hasLegacy =
      localStorage.getItem('firebaseIdToken') != null ||
      localStorage.getItem('userAuthenticated') === 'true';
    if (hasLegacy) {
      for (const k of LEGACY_KEYS) {
        const v = localStorage.getItem(k);
        if (v != null && localStorage.getItem(p + k) == null) {
          localStorage.setItem(p + k, v);
        }
      }
      for (const k of LEGACY_KEYS) {
        localStorage.removeItem(k);
      }
    }
  }

  localStorage.setItem(p + '__migrated_v2', '1');
}

export function mlsGet(key) {
  return localStorage.getItem(moremiStoragePrefix() + key);
}

export function mlsSet(key, value) {
  localStorage.setItem(moremiStoragePrefix() + key, value);
}

export function mlsRemove(key) {
  localStorage.removeItem(moremiStoragePrefix() + key);
}

export function mlsClearAuthKeys() {
  const p = moremiStoragePrefix();
  for (const k of LEGACY_KEYS) {
    localStorage.removeItem(p + k);
  }
}
