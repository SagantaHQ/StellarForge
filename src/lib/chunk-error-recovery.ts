/**
 * §Fix (2026-08-16) — Global ChunkLoadError recovery.
 *
 * When StellarForge is redeployed, Turbopack generates new chunk hashes
 * (e.g. `2swv6z621yn5o.js` → `abc123.js`). The previous chunks are
 * deleted from the server. If a user has the OLD page open (or has
 * stale HTML cached) and the browser tries to load an OLD chunk URL,
 * the server returns 404 and Turbopack's runtime throws:
 *
 *   Uncaught ChunkLoadError: Failed to load chunk /_next/static/chunks/<old>.js
 *
 * Without recovery, the user is stuck on a broken page. They would
 * have to manually hard-refresh (Ctrl+Shift+R) to clear caches and
 * reload fresh HTML.
 *
 * This script:
 *   1. Listens for unhandled `error` events whose error name is
 *      `ChunkLoadError` (or whose message matches the chunk-load pattern).
 *   2. Clears the SW caches (`caches.keys()` → `caches.delete()`) so
 *      stale chunk URLs are purged.
 *   3. Uses sessionStorage as a one-shot guard so we don't enter a
 *      reload loop if the reload itself fails (max 1 auto-reload per
 *      session).
 *   4. Forces a hard reload via `window.location.reload()` — the
 *      browser will bypass its HTTP cache for a navigation reload
 *      when there's no cached response for the document.
 *
 * This script MUST run early (in <head>, before any chunks load) so
 * the listener is in place before the first ChunkLoadError can fire.
 */

export const chunkErrorRecoveryScript = `
(function() {
  if (typeof window === 'undefined') return;
  // Guard against double-registration if the script somehow runs twice.
  if (window.__chunkErrorRecoveryInstalled) return;
  window.__chunkErrorRecoveryInstalled = true;

  var RELOAD_KEY = 'stellarforge:chunk-reload-attempted';

  function isChunkLoadError(err) {
    if (!err) return false;
    if (err.name === 'ChunkLoadError') return true;
    var msg = (err.message || '') + ' ' + (err.stack || '');
    return /Loading chunk \\S+ failed|Failed to load chunk/i.test(msg);
  }

  window.addEventListener('error', function(e) {
    if (!isChunkLoadError(e.error || e)) return;

    // One-shot guard: don't reload more than once per session.
    // If the reload itself produces a ChunkLoadError (server is still
    // serving stale assets), we let the user see the error instead
    // of looping forever.
    if (sessionStorage.getItem(RELOAD_KEY)) {
      console.error('[chunk-recovery] ChunkLoadError after reload — giving up to avoid loop. Hard-refresh (Ctrl+Shift+R) to clear caches manually.');
      return;
    }
    sessionStorage.setItem(RELOAD_KEY, '1');

    console.warn('[chunk-recovery] ChunkLoadError detected — clearing caches and reloading.');

    // Clear all SW caches so stale chunk URLs are purged.
    if ('caches' in window) {
      caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      }).catch(function() {});
    }

    // Unregister the service worker so a fresh SW (with the new VERSION)
    // can take over and clean up any leftover state.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        return Promise.all(regs.map(function(r) { return r.unregister(); }));
      }).catch(function() {});
    }

    // Hard reload — bypass HTTP cache by appending a cache-bust param.
    // (window.location.reload() in modern browsers respects cache
    // headers, so this is belt-and-suspenders.)
    setTimeout(function() {
      var url = new URL(window.location.href);
      url.searchParams.set('__cb', Date.now().toString(36));
      window.location.replace(url.toString());
    }, 150);
  });

  // Clear the reload guard once the page has loaded successfully —
  // this means a future ChunkLoadError (e.g. from a later deploy) will
  // be auto-recovered again.
  window.addEventListener('load', function() {
    // Delay slightly so any synchronous post-load chunk loads complete.
    setTimeout(function() {
      sessionStorage.removeItem(RELOAD_KEY);
    }, 5000);
  });
})();
`;
