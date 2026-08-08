/**
 * sw-nuke.js — service worker kill switch
 *
 * Loaded as a plain <script> in index.html (not registered as a SW itself).
 * Finds any registered service workers and unregisters them all, then forces
 * a hard reload so the page starts clean with no stale module cache.
 *
 * This fixes the "Expected a JavaScript-or-Wasm module script but the server
 * responded with a MIME type of text/html" error caused by stale SW caches
 * holding references to old hashed asset filenames that no longer exist.
 */
(function () {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    var nuked = registrations.length > 0;
    registrations.forEach(function (reg) {
      reg.unregister();
    });
    // Clear all caches so old hashed filenames are fully gone
    if ('caches' in window) {
      caches.keys().then(function (keys) {
        keys.forEach(function (key) { caches.delete(key); });
      });
    }
    // Reload once to pick up the fresh deploy — only if we actually nuked something
    if (nuked) {
      window.location.reload();
    }
  });
})();
