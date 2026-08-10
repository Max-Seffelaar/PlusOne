// PLUSONE — lean door service worker (Fase 9, hardened 86ey9e9mn).
//
// Goal: boot the door PWA while offline. Data lives in IndexedDB (TanStack Query
// persist + outbox); this SW only caches the *app shell* (navigation HTML +
// Next static assets) so the page itself loads with no network.
//
// TWO CACHES, TWO LIFETIMES — the whole point of this file's shape:
//
//  - SHELL_CACHE is PII-free and PERSISTENT. It survives sign-out on purpose: a
//    shared venue tablet must still cold-start offline for the NEXT doorhost
//    (invariant #25). Only static assets and `/door/<eventId>` navigations go in
//    here — that page deliberately SSRs no guest data (see its page.tsx).
//
//  - SESSION_CACHE holds CREDENTIALED navigation HTML and has the same lifetime
//    as IndexedDB: wiped on sign-out by `clearDeviceCaches()`
//    (src/features/door/offline/sw-cache.ts), called from `signOutDevice`.
//    `/app` HTML embeds the RSC payload — user id, venue, roles, display name,
//    memberships — and `/door` (the picker) SSRs the caller's event list. On a
//    shared door tablet neither may outlive the session that produced it
//    (86ey9et07 wiped IndexedDB for exactly this reason; Cache Storage was the
//    hole left behind).
//
// Any other same-origin navigation (/login, /e/<slug>, /settings, …) is NEVER
// written to a cache: if it isn't needed for offline boot, it isn't worth the
// blast radius of storing a credentialed response on disk.
//
// Safety:
//  - Only same-origin GET requests are handled; cross-origin (Supabase REST /
//    Realtime) always goes straight to the network — auth, RLS and realtime are
//    never touched.
//  - Redirected responses are never cached: after a sign-out, `/app` 307s to
//    /login, and following that redirect would otherwise store the login page
//    under the `/app` key (and poison the next offline boot).
//
// DEV KILL-SWITCH: this SW is registered at the ROOT scope, so once the door
// registers it, it controls the WHOLE origin. With stale-while-revalidate that
// serves stale dev assets across /app too (it masked code changes and even
// 404-ed rebuilt chunks during local testing). The offline shell is a PRODUCTION
// concern, so on localhost the SW caches nothing, purges old caches, unregisters
// itself, and reloads its clients so they drop SW control and fetch fresh.

const DEV =
  self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// Bumped from the single `plusone-door-v1`: `activate` deletes every cache that
// is not one of these two, which is also what evicts the pre-fix cache holding
// credentialed `/app` HTML from devices that already have it. Never reuse an old
// name — the purge IS the migration.
const SHELL_CACHE = 'plusone-shell-v2';
const SESSION_CACHE = 'plusone-session-v1';
const KEEP = [SHELL_CACHE, SESSION_CACHE];

self.addEventListener('install', (event) => {
  // No precache: `cache.addAll` sends cookies (Request credentials default to
  // 'same-origin'), so precaching `/door` would drop the caller's event list
  // into the persistent cache. The shell fills itself from real navigations
  // below, which is equivalent — the SW only registers from a /door visit.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  if (DEV) {
    // Purge every cache, unregister self, then reload open windows so they are no
    // longer controlled by this SW and load fresh assets straight from the dev server.
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: 'window' }))
        .then((clients) => clients.forEach((c) => c.navigate(c.url)))
        .catch(() => undefined),
    );
    return;
  }
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function putInCache(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  if (response.redirected) return; // e.g. /app → /login after sign-out
  caches
    .open(cacheName)
    .then((cache) => cache.put(request, response))
    .catch(() => undefined);
}

const STATIC_RE = /\/_next\/|\/icons\/|\.(?:js|css|woff2?|png|svg|ico|jpg|jpeg|webp)$/;

/**
 * Which cache (if any) a navigation to `pathname` may be written to.
 * Returning `null` means "network only, never store" — the default.
 */
function navigationCache(pathname) {
  if (pathname === '/door') return SESSION_CACHE; // picker SSRs the caller's events
  if (pathname.startsWith('/door/')) return SHELL_CACHE; // PII-free by construction
  if (pathname === '/app' || pathname.startsWith('/app/')) return SESSION_CACHE; // RSC payload = identity + roles
  return null;
}

/** Offline fallback shell for a navigation we could not serve from its own key. */
function fallbackFor(pathname) {
  if (pathname === '/door' || pathname.startsWith('/door/')) return '/door';
  if (pathname === '/app' || pathname.startsWith('/app/')) return '/app';
  return null; // no cross-surface fallback — a wrong shell is worse than an error
}

self.addEventListener('fetch', (event) => {
  if (DEV) return; // dev: never intercept — always fresh from the network
  const request = event.request;
  if (request.method !== 'GET') return; // never cache writes / auth POSTs
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase & co → network only

  // App-shell navigations: network-first, fall back to cache (offline boot).
  if (request.mode === 'navigate') {
    const cacheName = navigationCache(url.pathname);
    const fallback = fallbackFor(url.pathname);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (cacheName) putInCache(cacheName, request, response.clone());
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || (fallback ? caches.match(fallback) : undefined))
            .then((cached) => cached || Response.error()),
        ),
    );
    return;
  }

  // Static assets / chunks: stale-while-revalidate.
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            putInCache(SHELL_CACHE, request, response.clone());
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
