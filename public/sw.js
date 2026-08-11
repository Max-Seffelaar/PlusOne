// PLUSONE — self-destructing stub (86ey9e9mn). DO NOT put caching logic here.
//
// This path used to serve a next-pwa/Workbox service worker. next-pwa is gone
// (see next.config.js) and the door's own SW lives at /service-worker.js, but
// removing the file was not enough: a browser that ever registered /sw.js keeps
// running the INSTALLED copy indefinitely, and that copy cached same-origin AND
// cross-origin GETs — including Supabase REST responses (guest PII) for an hour,
// under an origin-scoped cache that outlived sign-out.
//
// Browsers re-fetch a registered SW script on navigation (and at least daily), so
// shipping this stub is what actually stops those clients: it takes over the
// registration, deletes the Workbox caches, and unregisters itself. Once a client
// has run it, /sw.js is no longer registered and this file is never fetched again.
//
// It must keep being served WITHOUT an auth redirect (see the middleware matcher
// exclusion in src/middleware.ts) — an HTML login page here would fail to parse
// and the stale Workbox SW would survive.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  // The unregister is the load-bearing step, so it is deliberately NOT chained
  // behind the cache purge: `Promise.all` over `caches.delete` would let a single
  // rejection skip the unregister and leave the Workbox worker installed for
  // good (activate never fires again for this script version). Purge with
  // allSettled first, then unregister no matter how that went.
  event.waitUntil(
    caches
      .keys()
      // Keep the door's PII-free offline shell if it somehow coexists: wiping it
      // would cost the next doorhost their offline cold start (invariant #25).
      // Prefix must stay in sync with SHELL_CACHE in service-worker.js and
      // KEEP_PREFIX in src/features/door/offline/sw-cache.ts — guarded by
      // tests/unit/service-worker-cache-scope.test.ts.
      .then((keys) => keys.filter((k) => !k.startsWith('plusone-shell-')))
      .then((keys) => Promise.allSettled(keys.map((k) => caches.delete(k))))
      .catch(() => undefined)
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
      .catch(() => undefined),
  );
});
