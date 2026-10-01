/*
 * Grubano PWA service worker — PRUDENT caching (scope "/").
 *
 * Money/menu safety: pages and all dynamic data are NETWORK-FIRST, so prices, menus and
 * orders are NEVER served stale. Only hashed/immutable build assets are cache-first. API,
 * authenticated data and anything payment-related are NEVER cached (the SW doesn't touch them).
 * Navigations fall back to a simple /offline.html when there is no network. Updates take over
 * cleanly (skipWaiting + clients.claim) so a stale SW never sticks.
 */
const VERSION = 'v1';
const STATIC_CACHE = 'grubano-static-' + VERSION;
const OFFLINE_URL = '/offline.html';
// Minimal precache: the offline fallback + one icon, so the offline page works fully offline.
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting(); // new SW activates immediately
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop superseded versioned caches.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('grubano-static-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim(); // take control of open pages now
    })()
  );
});

// Allow the page to trigger an immediate takeover after an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Cache-first ONLY for hash-named / immutable assets — exactly the task's "assets statiques à
// nom hashé (JS/CSS de build, polices, icônes)". /_next/static/ holds the content-hashed build
// JS/CSS + fonts (…/static/media); /icons/ holds the PWA icons. Mutable same-origin assets at
// STABLE urls (brand SVGs, /images/food/*, favicon) are intentionally NOT cached-first here, so
// a replaced asset is never served stale (no hash to invalidate it). They fall through to the
// network below. This never touches prices/menus/orders (navigations + /api/* handled above).
function isHashedStatic(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with non-GET (POST/PUT/PATCH/DELETE = mutations, payments, auth).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache APIs, NextAuth, or Next data payloads — always live.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/data/')
  ) {
    return; // let the network handle it, uncached
  }

  // PAGE NAVIGATIONS → network-first, offline.html fallback. Never cached (no stale pages).
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch (e) {
          const cache = await caches.open(STATIC_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return offline || Response.error();
        }
      })()
    );
    return;
  }

  // HASHED STATIC ASSETS → cache-first (immutable; safe and fast).
  if (isHashedStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          // Only store successful, basic (same-origin) responses.
          if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Everything else → default network behaviour, uncached.
});
