/**
 * StellarForge Service Worker
 *
 * - App-shell caching (Network-first for navigations, falls back to cached shell)
 * - Static asset caching (stale-while-revalidate)
 * - No aggressive API caching — IDE state must be fresh
 *
 * §Fix (2026-08-16) — ChunkLoadError after deploy:
 *   1. Bumped VERSION from "soroban-build-v1" → "soroban-build-v2-2026-08-16".
 *      The old VERSION never changed between deploys, so the same cache
 *      survived forever — old chunks from previous builds stayed cached
 *      alongside new chunks, and after a Turbopack rebuild the old chunk
 *      URLs returned 404 from the server while the SW still served cached
 *      HTML pointing at them → "Uncaught ChunkLoadError".
 *      Bumping VERSION forces the SW to delete the v1 cache on activate.
 *   2. Added explicit purge of ALL `/_next/static/chunks/*` entries on
 *      activate (regardless of cache version) — defense-in-depth so that
 *      even if a future deploy forgets to bump VERSION, stale chunks
 *      can't accumulate and cause ChunkLoadError.
 */

const VERSION = "soroban-build-v2-2026-08-16";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // §Fix 1 — delete ALL caches from previous SW versions (forces a
      // full re-fetch of every asset, guaranteeing no stale chunks).
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
      );

      // §Fix 2 — defense-in-depth: even in the current-version cache,
      // purge every cached `/_next/static/chunks/*` entry. New deploys
      // generate new chunk hashes (Turbopack content-addresses them), so
      // any cached chunk URL is by definition stale after a deploy.
      // Letting the SW re-fetch fresh chunks on next navigation avoids
      // "ChunkLoadError: Failed to load chunk /_next/static/chunks/…"
      // after the next deploy even if VERSION isn't bumped.
      const currentCache = await caches.open(VERSION);
      const requests = await currentCache.keys();
      const staleChunkReqs = requests.filter((req) => {
        try {
          const url = new URL(req.url);
          return url.pathname.startsWith("/_next/static/chunks/");
        } catch {
          return false;
        }
      });
      await Promise.all(staleChunkReqs.map((req) => currentCache.delete(req)));

      // §Fix 3 — also purge cached "/" (the app shell HTML) so the new
      // deploy's HTML with new chunk URLs gets fetched fresh. Without
      // this, the SW might serve the old HTML referencing old chunk URLs.
      await currentCache.delete("/");
      await currentCache.delete("/");

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // §Fix 4 — NEVER cache /_next/static/chunks/* via the SW. These are
  // content-addressed by Turbopack; the browser HTTP cache handles them
  // correctly with immutable caching. Letting the SW cache them causes
  // stale chunks to persist across deploys even when VERSION is bumped
  // (because the SW re-populates the cache from the network on first
  // fetch after activate, then keeps serving the cached version forever).
  if (url.pathname.startsWith("/_next/static/chunks/")) {
    // Bypass SW entirely — go straight to network.
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  if (["style", "script", "image", "font"].includes(req.destination)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
