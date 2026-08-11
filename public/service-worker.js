// PLUSONE — lean door service worker (Fase 9, hardened 86ey9e9mn).
//
// Goal: boot the door PWA while offline. Data lives in IndexedDB (TanStack Query
// persist + outbox); this SW only caches the *app shell* (navigation HTML +
// Next static assets) so the page itself loads with no network.
//
// TWO CACHES, TWO LIFETIMES — the whole point of this file's shape:
//
//  - SHELL_CACHE is PII-free and PERSISTENT. Only three kinds of entry may go in
//    here: Next static assets, `/` (the static marketing landing — no auth, no
//    redirect, and the installed PWA's manifest `start_url`), and
//    `/door/<eventId>`, which deliberately SSRs no guest data — it renders only
//    `<DoorRoute eventId serverHint>` (guarded by
//    tests/unit/service-worker-cache-scope.test.ts).
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
// Any other same-origin navigation (/login, /e/<slug>, /onboarding, …) is NEVER
// written to a cache: if it isn't needed for offline boot, it isn't worth the
// blast radius of storing a credentialed response on disk.
//
// WHAT THE PERSISTENT SHELL ACTUALLY BUYS ACROSS SIGN-OUT (corrected 86ey9e9mn
// review): static assets plus any `/door/<eventId>` page already cached under
// that exact URL. It does NOT hand the next doorhost a bootable door for an
// event they have not opened before — `fallbackFor('/door/<id>')` points at the
// `/door` picker, which lives in the sign-out-wiped SESSION bucket, and we
// deliberately do not serve one event's HTML for another (the flight payload
// embeds the eventId, so it would render the wrong event). That is honest
// rather than limiting: a signed-out device cannot work the door offline
// anyway — no session, no IndexedDB snapshot. Bootable door HTML for the next
// doorhost comes from their own online login, which the `seed-shell` message
// below guarantees.
//
// Safety:
//  - Only same-origin GET requests are handled; cross-origin (Supabase REST /
//    Realtime) always goes straight to the network — auth, RLS and realtime are
//    never touched.
//  - A navigation request has redirect mode 'manual', so a signed-out `/app`
//    (307 → /login) reaches us as an **opaqueredirect**: status 0, `redirected`
//    false. It is the `status !== 200` / opaque-type check that keeps the login
//    page out of the `/app` cache key, NOT the `redirected` flag. That flag is
//    still live for the redirect-mode-'follow' paths (static assets and the
//    seed fetch), so both guards stay.
//  - A navigation that comes back opaqueredirect for a SESSION path means the
//    session is gone (local sign-out we missed, expiry, or an admin's remote
//    revoke) — we drop SESSION_CACHE right there, so a remotely revoked device
//    self-cleans on its next ONLINE visit. A device that never goes online
//    again keeps its session cache; nothing running on it can be reached.
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
// name — the purge IS the migration. SHELL_CACHE must keep the `plusone-shell-`
// prefix: that prefix is what `clearDeviceCaches()` spares on sign-out (guarded
// by tests/unit/service-worker-cache-scope.test.ts).
const SHELL_CACHE = 'plusone-shell-v2';
const SESSION_CACHE = 'plusone-session-v1';
const KEEP = [SHELL_CACHE, SESSION_CACHE];

// Bound the persistent cache. The retired Workbox SW had ExpirationPlugin caps;
// without one, months of deploys accumulate hashed chunks until the ORIGIN quota
// evicts — and origin eviction takes the IndexedDB outbox (un-synced check-ins)
// with it. Static entries are evicted first; the navigation shells are the whole
// point of the cache, so they go last.
const SHELL_MAX_ENTRIES = 60;

// Wipe epoch for SESSION_CACHE, mirroring `idbEpoch()` in
// src/features/door/offline/idb.ts. A navigation captures it before its fetch and
// re-checks before the cache write commits: if a sign-out wiped the cache in
// between, the write would resurrect the previous user's HTML, so it is dropped.
// An epoch (rather than a sticky "wiped" flag) self-heals — the next user's own
// navigations carry the new epoch and cache normally.
let sessionEpoch = 0;

// Paths already re-fetched by `seed-shell` in this worker instance. A deploy
// replaces the script, which resets this — so the shell refreshes per version
// without a network hit on every screen mount.
const seeded = new Set();

/** Delete every cache that is not one of ours. Used by `activate` and once per
 *  worker startup: the SW we replaced finishes its in-flight events after being
 *  replaced, so a fire-and-forget write can re-create a purged legacy cache
 *  seconds after `activate` ran. */
function purgeForeignCaches() {
  return caches
    .keys()
    .then((keys) =>
      Promise.allSettled(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))),
    )
    .catch(() => undefined);
}

// Lazy second purge, kicked off at worker startup. Deliberately not awaited
// anywhere on the fetch path — it must never delay a door request.
if (!DEV) purgeForeignCaches();

self.addEventListener('install', (event) => {
  // No precache: `cache.addAll` sends cookies (Request credentials default to
  // 'same-origin'), so precaching `/door` would drop the caller's event list
  // into the PERSISTENT cache. Seeding happens through the `seed-shell` message
  // instead, which runs each path through `navigationCache` first.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  if (DEV) {
    // Purge every cache, unregister self, then reload open windows so they are no
    // longer controlled by this SW and load fresh assets straight from the dev server.
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.allSettled(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: 'window' }))
        .then((clients) => clients.forEach((c) => c.navigate(c.url)))
        .catch(() => undefined),
    );
    return;
  }
  // allSettled + an unconditional claim: one rejected `caches.delete` must not
  // skip the rest of the purge AND leave the worker unclaimed, because activate
  // never fires again for this script version.
  event.waitUntil(purgeForeignCaches().then(() => self.clients.claim()));
});

/** A response we must never persist: opaque/opaqueredirect/error have no usable
 *  body or status, and a followed redirect means the URL we keyed on is not what
 *  produced this body (e.g. the seed fetch landing on /login). */
function isStorable(response) {
  if (!response || response.status !== 200 || response.redirected) return false;
  return (
    response.type !== 'opaque' && response.type !== 'opaqueredirect' && response.type !== 'error'
  );
}

/** True when a navigation response says the session is gone. See the header:
 *  navigations use redirect mode 'manual', so the 307 to /login surfaces as an
 *  opaqueredirect rather than a followed redirect. Deliberately NOT "any
 *  non-200" — a 500 or a 503 on flaky venue wifi must not wipe the cache. */
function isSessionGone(response) {
  return Boolean(response) && (response.type === 'opaqueredirect' || response.redirected === true);
}

const STATIC_RE = /\/_next\/|\/icons\/|\.(?:js|css|woff2?|png|svg|ico|jpg|jpeg|webp)$/;
// NB: `/_next/image` matches `\/_next\/` and therefore routes to the PERSISTENT
// shell. That is only safe while `images.unoptimized: true` (next.config.js) —
// the optimizer is off, so nothing user-derived is served from that path. If
// remote/user images are ever enabled, exclude `/_next/image` here first.

/** Cache-match options for navigations. Without `ignoreSearch` an entry stored
 *  under `/app/door?event=X` (the canonical Deur-tab URL, `doorPath()` in
 *  src/components/po/routes.ts) cannot satisfy `/app/door?event=X&seg=taken` or
 *  the bare `/app` fallback, and the tab dies offline on a query-only change.
 *  The `/app` shell derives its screen from the URL client-side, so serving a
 *  same-path-different-query entry is correct. `ignoreSearch` ignores only the
 *  query — never the path — so it cannot bleed one event's page into another. */
const MATCH_OPTS = { ignoreSearch: true };

/**
 * Which cache (if any) a navigation to `pathname` may be written to.
 * Returning `null` means "network only, never store" — the default.
 */
function navigationCache(pathname) {
  // The static, auth-free landing. It is the installed PWA's manifest
  // `start_url`, so without it an offline home-screen launch dead-ends on the
  // browser's error page.
  if (pathname === '/') return SHELL_CACHE;
  // The picker SSRs the caller's own event + venue list.
  if (pathname === '/door') return SESSION_CACHE;
  // A real door page, PII-free by construction. The length check keeps the bare
  // `/door/` (which Next 308s to the credentialed picker) out of the PERSISTENT
  // bucket — today that only holds because `trailingSlash` is false.
  if (pathname.startsWith('/door/') && pathname.length > '/door/'.length) return SHELL_CACHE;
  // RSC payload = identity + roles + memberships.
  if (pathname === '/app' || pathname.startsWith('/app/')) return SESSION_CACHE;
  return null;
}

/** Offline fallback shell for a navigation we could not serve from its own key.
 *  Same-surface only — a wrong shell is worse than an error, and one event's
 *  door HTML must never stand in for another's. */
function fallbackFor(pathname) {
  if (pathname === '/') return '/';
  if (pathname === '/door' || pathname.startsWith('/door/')) return '/door';
  if (pathname === '/app' || pathname.startsWith('/app/')) return '/app';
  return null;
}

/** Evict down to SHELL_MAX_ENTRIES, oldest static asset first (`cache.keys()`
 *  is insertion-ordered). Navigation shells are only touched if statics alone
 *  cannot get us under the cap. */
function trimShell(cache) {
  return cache
    .keys()
    .then((keys) => {
      const over = keys.length - SHELL_MAX_ENTRIES;
      if (over <= 0) return undefined;
      const isStatic = (k) => STATIC_RE.test(new URL(k.url).pathname);
      const victims = keys.filter(isStatic).slice(0, over);
      if (victims.length < over) {
        victims.push(...keys.filter((k) => !isStatic(k)).slice(0, over - victims.length));
      }
      return Promise.allSettled(victims.map((k) => cache.delete(k)));
    })
    .then(() => undefined);
}

/**
 * Write a response to `cacheName`. Returns the promise so every call site can
 * hand it to `event.waitUntil` — a fire-and-forget write is dropped when the
 * worker is terminated after the response is delivered but before the write
 * commits (most aggressive on WebKit/iPad, which is the door's device class).
 * `waitUntil` extends the worker's life; it does not delay the response.
 */
function putInCache(cacheName, request, response, epochAtStart) {
  if (!isStorable(response)) return Promise.resolve();
  // Sign-out landed while this response was in flight — see `sessionEpoch`.
  if (cacheName === SESSION_CACHE && epochAtStart !== undefined && epochAtStart !== sessionEpoch) {
    return Promise.resolve();
  }
  return caches
    .open(cacheName)
    .then((cache) =>
      cache
        .put(request, response)
        .then(() => (cacheName === SHELL_CACHE ? trimShell(cache) : undefined)),
    )
    .catch(() => undefined);
}

/**
 * Fill the persistent shell for paths the SW would otherwise never see.
 *
 * Every in-app move is a `<Link>`/RSC fetch (`mode: 'cors'`), not a document
 * navigation — the picker's links in src/app/door/page.tsx are the case that
 * matters — so a first-session tablet reaches `/door/<eventId>` without the SW
 * ever handling a 'navigate' request for it, and an offline reload dies. The
 * client posts the paths it wants seeded; we re-fetch them as real requests.
 *
 * The path list is UNTRUSTED input: each entry has to classify as SHELL on its
 * own merits via `navigationCache`, so a compromised client cannot talk the SW
 * into persisting credentialed HTML.
 */
function seedShell(paths) {
  const wanted = [];
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    let url;
    try {
      url = new URL(raw, self.location.origin);
    } catch {
      continue;
    }
    if (url.origin !== self.location.origin) continue;
    if (navigationCache(url.pathname) !== SHELL_CACHE) continue;
    if (seeded.has(url.pathname)) continue;
    seeded.add(url.pathname);
    wanted.push(url.pathname);
  }
  if (!wanted.length) return Promise.resolve();
  return caches
    .open(SHELL_CACHE)
    .then((cache) =>
      Promise.allSettled(
        wanted.map((path) =>
          // redirect mode defaults to 'follow' here, so an unauthorized or
          // missing door page comes back as a followed redirect / non-200 and
          // `isStorable` refuses it.
          fetch(path, { credentials: seedCredentials(path) })
            .then((response) => {
              if (!isStorable(response)) throw new Error('not storable');
              return cache.put(path, response);
            })
            .catch((err) => {
              // Let a transient failure retry later in this worker's life —
              // a door that never seeds is worse than one extra fetch.
              seeded.delete(path);
              throw err;
            }),
        ),
      ).then(() => trimShell(cache)),
    )
    .catch(() => undefined);
}

/**
 * `/` is PUBLIC but middleware 307s a signed-in user from it to `/app`, so a
 * credentialed seed would always come back redirected and never store — leaving
 * the installed PWA (start_url `/`) unbootable offline for exactly the people
 * who use it. Fetching it anonymously returns the real landing and, as a bonus,
 * makes "this entry contains no session data" true by construction rather than
 * by inspection. `/door/<eventId>` is the opposite: it needs the session or it
 * 404s, so it keeps same-origin credentials.
 */
function seedCredentials(pathname) {
  return pathname === '/' ? 'omit' : 'same-origin';
}

self.addEventListener('message', (event) => {
  if (DEV) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'session-wipe') {
    // Bump first: any navigation already in flight now fails its epoch check and
    // will not re-create the cache we are about to delete.
    sessionEpoch += 1;
    event.waitUntil(caches.delete(SESSION_CACHE).catch(() => undefined));
    return;
  }

  if (data.type === 'seed-shell' && Array.isArray(data.paths)) {
    event.waitUntil(seedShell(data.paths));
  }
});

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
    const epochAtStart = sessionEpoch;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (cacheName === SESSION_CACHE && isSessionGone(response)) {
            // The session ended somewhere we don't run code (expiry, admin
            // remote-revoke). Self-clean now that we are online. Bump the epoch
            // for the same reason `session-wipe` does: a sibling tab's in-flight
            // navigation must not re-create what we are deleting.
            sessionEpoch += 1;
            event.waitUntil(caches.delete(SESSION_CACHE).catch(() => undefined));
          } else if (cacheName) {
            event.waitUntil(putInCache(cacheName, request, response.clone(), epochAtStart));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request, MATCH_OPTS)
            .then((cached) => cached || (fallback ? caches.match(fallback, MATCH_OPTS) : undefined))
            .then((cached) => cached || Response.error()),
        ),
    );
    return;
  }

  // Static assets / chunks: stale-while-revalidate.
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Revalidate in the background — waitUntil is what keeps the worker
          // alive long enough for the write to land.
          event.waitUntil(
            fetch(request)
              .then((response) => putInCache(SHELL_CACHE, request, response.clone()))
              .catch(() => undefined),
          );
          return cached;
        }
        return fetch(request).then((response) => {
          event.waitUntil(putInCache(SHELL_CACHE, request, response.clone()));
          return response;
        });
      }),
    );
    return;
  }

  // Everything else same-origin (e.g. /auth/* callbacks): network, no cache.
});
