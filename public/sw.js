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
  event.waitUntil(
    caches
      .keys()
      // Keep the door's PII-free offline shell if it somehow coexists: wiping it
      // would cost the next doorhost their offline cold start (invariant #25).
      .then((keys) => keys.filter((k) => !k.startsWith('plusone-shell-')))
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
      .catch(() => undefined),
  );
});
