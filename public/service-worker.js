// PLUSONE — lean door service worker (Fase 9).
//
// Goal: boot the door PWA while offline. Data lives in IndexedDB (TanStack Query
// persist + outbox); this SW only caches the *app shell* (navigation HTML +
// Next static assets) so the page itself loads with no network.
//
// Safety:
//  - Only same-origin GET requests are handled; cross-origin (Supabase REST /
//    Realtime) always goes straight to the network — auth, RLS and realtime are
//    never touched.
//  - Door navigation HTML is PII-free (the page does not SSR guest data), so it
//    is safe to cache on a shared device; per-user data lives in IndexedDB and
//    is wiped on sign-out.

const CACHE = 'plusone-door-v1';
const SHELL = ['/door'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function putInCache(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  caches.open(CACHE).then((cache) => cache.put(request, response)).catch(() => undefined);
}

const STATIC_RE = /\/_next\/|\/icons\/|\.(?:js|css|woff2?|png|svg|ico|jpg|jpeg|webp)$/;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // never cache writes / auth POSTs
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase & co → network only

  // App-shell navigations: network-first, fall back to cache (offline boot).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putInCache(request, response.clone());
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/door'))),
    );
    return;
  }

  // Static assets / chunks: stale-while-revalidate.
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            putInCache(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Everything else same-origin (e.g. /auth/* callbacks): network, no cache.
});
