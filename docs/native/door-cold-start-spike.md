# Door cold-start spike (N4) — go/no-go

Fase 17 wave 3, plan row N4 (`capacitor-plan-claude-code.md` §4; ClickUp 86ey6bfe8). A decision
document, no production code. Written 2026-09-25 against `main` at `fcc6f1e` and the N3 scaffold
branch `claude/86ey6bfdm-capacitor-scaffold` (PR #340, draft).

## 0. Decision in one screen

| | Android v1 | iOS v1 |
|---|---|---|
| **Model** | Remote-URL + service worker (variant 1) — **go** | Remote-URL + App-Bound Domains (variant 2) — **go, staged in S1b** |
| **Bundle the door locally (variant 3)** | **no-go** for v1 | **no-go** for v1 |
| **Cold start while offline** | Works once the web-side follow-up below ships; the SW already works in Android WebView | Only with `WKAppBoundDomains`; without it iOS is warm-resume-only |
| **Warm resume while offline** (app backgrounded, not killed) | Works today, unchanged by the shell model | Works today, unchanged by the shell model |

**The thing this spike actually found:** under the remote-URL model the native shell always cold-starts
at `https://app.plus-one.io/` → `/app`, i.e. the Deur tab of the `po` shell. That tab **cannot cold-boot
offline anywhere today, not even in a browser**, for reasons that have nothing to do with Capacitor:
the service worker is only registered on the standalone `/door/<eventId>` route, and the Deur tab
resolves *which* event to open through a network query (`usePoDoorCandidates`) that is never
persisted. The IndexedDB snapshot and the outbox are there; the tab never reaches them without a
network round-trip first. The standalone `/door/<eventId>` route, which *is* built for offline boot,
is unreachable from the native shell (no in-app link, no URL bar).

So the go/no-go is not "remote-URL vs bundle". It is: fix two small web-side gaps so the Deur tab
can boot from its own caches, keep the remote-URL model, and on iOS buy the service worker with
App-Bound Domains. Bundling the door locally would cost 4–6 sessions plus a second auth and data
store, and would still need the same two web-side fixes.

## 1. What "cold start offline" means here

- **Warm resume:** the app was backgrounded (screen locked, app switcher, phone in a pocket) and
  the process was **not** killed. The page is still in memory; the door keeps working from the
  IndexedDB snapshot and queues writes in the outbox (#25). Both Android and iOS behave the same
  under remote-URL as in a browser tab. The wake lock (`useWakeLock`) keeps the door in the
  foreground during a shift, which makes this the common case.
- **Cold start:** the process was killed (swipe-kill, OS memory pressure, reboot) and the doorhost
  reopens the app **with no connectivity** (basement door, venue wifi down). The webview has to
  load `server.url` from somewhere other than the network. This is the case N4 is about.
- **Not in scope:** offline *login*. A signed-out device has no session and no snapshot and
  cannot work the door offline in any model (CLAUDE.md, "Device storage is session-scoped").

## 2. What the code does today (read before researching)

Findings, each with the file it comes from.

1. **The SW is registered only on the standalone door route.** `RegisterServiceWorker` is mounted
   in `src/app/door/layout.tsx` and nowhere else. It registers `/service-worker.js` at root scope,
   so *once* registered it controls the whole origin, including `/app` — but a user who only ever
   opens `/app` never registers it. `seed-shell` seeds `/` and the current `/door/<id>` only
   (`src/app/door/register-sw.tsx`).
2. **The native shell always launches at the origin.** N3's `capacitor.config.ts` reduces
   `server.url` to `https://app.plus-one.io`; the middleware 307s a signed-in user to `/app`.
   Capacitor does not restore the last URL on a cold start. The standalone `/door/<eventId>`
   route has no in-app link (the only `href` to it is the `/door` picker, which itself has no
   link from the `po` surface) and a native webview has no URL bar, so **in the native shell the
   route built for offline boot is unreachable.**
3. **The Deur tab resolves its event over the network.** `MobileDoorBranch`
   (`src/components/po/door-branch.tsx`) mounts `DoorQueryProvider`/`DoorProvider` only once
   `usePoDoorCandidates()` has produced a list that contains the requested id. That query lives in
   the `po` QueryClient (`PoLiveProvider.tsx`: `gcTime` 5 min, no persister). Offline on a cold
   boot the query never resolves (React Query's default `networkMode: 'online'` pauses it), the
   fallback is the stable empty array, `resolvedDoorId` stays `null`, and the tab renders
   "no event". The IndexedDB snapshot for the event is on the device, unread. An `?event=<id>` in
   the URL does not help: the id is validated against the (empty) candidate list.
4. **The SW's own offline path is sound for the pages it caches.** `public/service-worker.js`:
   navigations are network-first with a cache fallback, `/app*` HTML sits in the session-scoped
   `plusone-session-*` cache (wiped by `signOutDevice`), `/door/<id>` and `/` in the persistent
   `plusone-shell-*` cache, static chunks stale-while-revalidate, cross-origin (Supabase) never
   touched. `MATCH_OPTS.ignoreSearch` + `fallbackFor('/app/door…') → '/app'` means a cached bare
   `/app` entry can serve `/app/door?event=<id>`.
5. **Nothing else is HTTP-cacheable.** `/app` and `/door/<id>` are dynamic server-rendered routes
   (cookies, `headers()`, per-user RSC payload). Next.js sends them with
   `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`, so without a service
   worker neither WebView nor WKWebView can serve them from the HTTP cache. (Could not be curled
   from this container — the egress proxy returned 502 for `app.plus-one.io`; confirm in the
   device test via `chrome://inspect` → Network.)
6. **Session is a cookie on the app origin.** `@supabase/ssr`'s `createBrowserClient`
   (`src/lib/supabase/client.ts`, `src/features/door/offline/device.ts`) reads the session from
   `document.cookie` of `app.plus-one.io`; `autoRefreshToken` is on. Offline, an expired access
   token is harmless — the outbox drain waits for `online`, and the refresh happens on reconnect.
   This only becomes a problem when the door runs on a *different origin* (variant 3).
7. **The stale-resume guard will fire in every cold-start test.** `useStaleResumeGuard` opens a
   blocking "syncing" overlay on a hidden→visible transition when the last sync is older than
   5 min, then degrades to `blocked` with "continue anyway" after 8 s offline. That is by design
   (degrade loudly); the device script below expects it.
8. **Two guards constrain any fix.** `tests/unit/service-worker-cache-scope.test.ts` pins which
   cache each path may land in; `src/components/po/door-render-isolation.test.tsx` fails if a
   venue-wide read moves onto the door's ancestor path. A follow-up must respect both.

## 3. Platform facts (sources in §11, accessed 2026-09-25)

**Android WebView**
- Service workers are a first-class WebView feature: `android.webkit.ServiceWorkerController`
  exists since API 24 (our `minSdk` is 24) and Capacitor's own `Bridge.java` installs a
  `ServiceWorkerClient` on it. A remote `https://` origin is a secure context, so registration
  works exactly as in Chrome. [S1][S2]
- **Bridge injection after an SW-served page.** Capacitor 8 injects the bridge with
  `WebViewCompat.addDocumentStartJavaScript(webView, script, {allowedOrigin})`, scoped to the
  `server.url` origin. A document-start script runs on every navigation to that origin regardless
  of whether the response came from the network or the SW cache. The old report "service worker
  server.url not injecting capacitor" (#5278, Capacitor 3.3, Nov 2021) concerned the
  `shouldInterceptRequest`-based fallback injector, which a SW-served response bypasses; that
  fallback is still used on WebViews **without** `DOCUMENT_START_SCRIPT`. On such a device the app
  would boot offline but `isNativeShell()` would read `false` (no back-button listener, links via
  `window.open`). The device test checks this. [S2][S3][S4]
- `server.errorPath` (a bundled HTML page shown when `server.url` cannot be loaded) is
  **Android-only**, and that page has no bridge. [S5]

**iOS WKWebView**
- Service workers are not available to an in-app WKWebView unless the app opts into
  **App-Bound Domains** (`WKAppBoundDomains` in Info.plist, max 10 domains) and sets
  `limitsNavigationsToAppBoundDomains = true` on the webview configuration. Capacitor exposes the
  latter as `ios.limitsNavigationsToAppBoundDomains` and documents that `localhost` (the local
  scheme host) must be in the list too. iOS 14+. [S6][S7][S8]
- App-Bound Domains restrict, on **non**-bound domains, exactly three things: JavaScript
  evaluation/user-script injection (the Capacitor bridge is a `WKUserScript`),
  `window.webkit.messageHandlers`, and `WKHTTPCookieStore` manipulation. The check is on the
  **top-level frame only**: subresource `fetch`/XHR/WebSocket to `*.supabase.co` and third-party
  iframes are unaffected. A top-level navigation to a domain outside the list is blocked. [S6]
- Reports of "SW registration fails on iOS" in Capacitor issues (#7069, #5502) are about apps
  served from `capacitor://localhost`, where `serviceWorker.register()` refuses a non-http(s)
  script URL. That does not apply to a remote `https://app.plus-one.io` origin. [S9][S10]
- ITP is on by default in WKWebView since iOS 14. Its 7-day cap on script-writable storage
  (IndexedDB, Cache Storage, SW registrations) applies to origins the user has not *interacted*
  with for 7 days of use. The shell is single-origin and every tap is an interaction, so in
  practice the door's snapshot is not in that window; Apple has not answered the question for
  in-app webviews explicitly (forum thread unanswered). Marked "verify on device", not a blocker.
  [S11][S12]
- Without a SW, a failed `server.url` load on iOS leaves the webview blank / on the splash
  (Capacitor discussion #3205, maintainer answer). No `errorPath` equivalent. [S13]

**Next.js**
- `output: 'export'` is project-wide and does not support dynamic routes without
  `generateStaticParams`, `cookies()`/`headers()`, middleware, server actions, `redirects`/`headers`
  in `next.config.js`. `/door/[eventId]/page.tsx` uses `headers()`, the cookie-based server
  Supabase client, `redirect()` and `notFound()`. It is not exportable, and neither is the rest of
  the app. [S14]

## 4. Variant 1 — pure remote-URL + service worker

**How it works.** Nothing changes in the native shell. The webview loads `https://app.plus-one.io`;
if the SW is registered and the needed HTML is in Cache Storage, the SW serves it; the shell boots
client-side (`app-client.tsx`, `ssr:false`) from the cached RSC payload, `DoorQueryProvider` restores
the guest snapshot from IndexedDB, and writes go to the outbox.

**Android, cold start offline — today:** fails. Either the SW was never registered (the user never
opened `/door/<id>`), or it was and `/` → `/app` are served from cache but the Deur tab stops at
"no event" (finding 3). **After the web-side follow-up (§8):** works; SW serves `/app`, the Deur
tab mounts the last door event from local memory, snapshot from IndexedDB, outbox drains on
reconnect. Bridge presence after an SW-served boot must be confirmed on the debug build (§3).

**iOS, cold start offline:** fails, and cannot be made to work in this variant — no SW in WKWebView
without App-Bound Domains. The webview shows a blank/splash screen. Warm resume works.

**What breaks / degrades:** nothing that works today. The SW has to be registered under `/app` for
this to help native users; CLAUDE.md's "never *depend* on the service worker" stays true (the SW is
an enhancement; the Deur tab still works online without it).

**Effort:** 0 for the variant itself; the web-side follow-up is 1 session (it is needed by every
variant, see §8). **Risk:** low. **Max tests on device:** script §9, steps 1–12, on the N3 Android
debug build — first *before* the follow-up (expected: warm ✅, cold ❌, which proves finding 3), then
after.

## 5. Variant 2 — App-Bound Domains on iOS

**How it works.** Two config lines on the N3 scaffold: `WKAppBoundDomains = [app.plus-one.io,
localhost]` in `ios/App/App/Info.plist`, and `ios: { limitsNavigationsToAppBoundDomains: true }` in
`capacitor.config.ts`. WKWebView then treats `app.plus-one.io` as app-bound: the SW registers and
Cache Storage works; the cold-start path becomes the same as Android's.

**iOS, cold start offline:** works, subject to the same web-side follow-up as Android and to the
device verification below. **Android:** unaffected (iOS-only keys).

**What it costs / can break (checked against this app):**
- *Top-level navigation off the list is blocked inside the webview.* We already never navigate
  off-origin inside the shell: N3 sets no `allowNavigation`, external links go through
  `openExternal()` → `@capacitor/browser` (decision 12, SFSafariViewController is out-of-process
  and not subject to the list), billing/checkout is hidden on native (store-tax rule), magic links
  land on `/auth/*` on the same domain (decision 7/11). The Cloudflare Turnstile iframe on `/e/*`
  would still be allowed (iframes are not checked) — and `/e/*` is never opened in the shell anyway.
- *Bridge only on bound domains.* Our only origin is bound. A `CAP_SERVER_URL` preview build
  (`*.vercel.app`, per N3's sync-time override) would **not** be in the list → no bridge on iOS
  preview builds unless the preview host is added (one of the 10 slots) or the flag is off for
  that build. Document it next to the override.
- *Supabase:* `fetch`/WebSocket subresources to `*.supabase.co` are not navigations → unaffected.
  Cookies: our session cookie lives on the bound domain; Capacitor's cookie plugin is not used.
- *Wrong list = silently broken iOS shell.* The failure mode N3 warned about: a typo or a domain
  change (`plusone.app` → `plus-one.io` happened on 2026-09-18) breaks push, back and external links
  on iOS with no error in the web app. There is no iOS device or Mac until M1/S1b, so this cannot
  be verified before S1b.
- *Nothing new on device storage.* The SW cache already exists for web PWA users; the device-storage
  rule (persistent = PII-free shell, session bucket wiped on sign-out) is unchanged.

**Effort:** ½ session for config + docs, plus one extra TestFlight round in S1b. **Risk:** medium,
entirely "unverifiable before a device". **Max tests on device (S1b, iPhone and iPad):** (a) a
TestFlight build *without* the keys passes the N3 golf-2 checks (login, server action, external
link in SFSafariViewController, push); (b) a second build *with* the keys passes the same checks
again — that proves the list is right; (c) then script §9 cold-start steps on that build.

## 6. Variant 3 — bundle only the door route locally

**How it would work.** A static door entry in Capacitor's `webDir` (`native/www`), loaded from
`capacitor://localhost` (iOS) / `https://localhost` (Android); `server.url` stays remote for
everything else, and the door entry syncs to Supabase directly with the browser client.

**Feasibility with the App Router:** `/door/[eventId]` is not statically exportable (finding 5,
[S14]), and `output: 'export'` is project-wide, so this is a **second build**: a separate
client-only entry (Vite, or a second Next config) that imports `src/features/door/**`,
`src/components/po/screens/door`, the kit, i18n and the Supabase browser client, built and copied
into `native/www` on every release. Every door change then ships in the store binary, through
store review, instead of a deploy — the property that makes the remote-URL model cheap
(plan §5: "een deploy ís de update") is gone for the door, and expand–contract now has to cover
binaries in the field that can be months old.

**Auth/session.** Cookies are per origin: the local door has no `app.plus-one.io` cookie and thus no
session. The tokens (access + refresh) would have to be handed from the remote page to the native
side and into the local page, refreshed there, and revoked in lockstep with `signOutDevice` and the
admin remote-revoke RPCs. That is a new session store and a security-shaped surface (fresh-session
`/security-review` per CLAUDE.md).

**Data.** IndexedDB is per origin: the snapshot the Deur tab keeps under `app.plus-one.io` is
invisible to the local door. Either the local door fetches and stores its own copy (a second copy
of guest PII on the device, a second wipe path, two outboxes) or the door runs *only* locally in the
native shell (then the `/app` Deur tab must be hidden on native, and push tap-navigation, back
button and deep links need cross-origin routing).

**Cold start offline:** works on both platforms by construction — that is the one thing this variant
delivers — provided the local door had already loaded a snapshot while online, which is the same
precondition as variants 1/2.

**Effort:** 4–6 sessions to build (second build pipeline, token handoff, second store + wipe,
native routing between origins, tests) and a recurring cost per release. **Risk:** high (auth
handoff, PII duplication, version skew). **Verdict:** no-go for v1. Keep as the ≥25-venues fallback
only if device tests show that a remote-URL door cannot be made reliable.

## 7. Comparison

| | 1 Remote-URL + SW | 2 + App-Bound Domains (iOS) | 3 Local door bundle |
|---|---|---|---|
| Android cold-start offline | ✅ after §8 | n/a (same as 1) | ✅ |
| iOS cold-start offline | ❌ | ✅ after §8, if the keys check out | ✅ |
| Warm resume offline (both) | ✅ today | ✅ today | ✅ |
| Session model | one cookie, unchanged | unchanged | second token store + handoff |
| Guest data on device | one IDB snapshot | one | two, or the Deur tab hidden on native |
| Door updates ship via | deploy | deploy | store release |
| Effort | 0 (+1 shared) | ½ (+1 shared) + TestFlight round | 4–6 + recurring |
| Risk | low | medium, unverifiable pre-device | high |
| Security surface | none new | Info.plist list correctness | auth handoff (review gate) |

## 8. Recommendation and the minimal next step

**Decision.** Android v1: variant 1. iOS v1: variant 2, staged in S1b (two TestFlight builds, keys
off then on; keep them only if the bridge checks pass). Variant 3: no-go. All of it hinges on a
small web-side follow-up that is needed regardless of variant, and that also fixes the web PWA's
Deur tab.

**Follow-up task — "Deur tab: cold boot offline from local caches" (proposed N7; Opus; 1 session;
milestone Now — it is the Apple 4.2 "offline door" defence).** Scope:

1. **Register the SW under `/app` too.** Mount `RegisterServiceWorker` (or a shared variant) in the
   `/app` layout/chrome so a native user gets the SW on first online login, and seed `/` from there.
   `/app` HTML keeps landing in the session bucket via the normal navigation path — no new
   persistent entries, so `service-worker-cache-scope.test.ts` stays green; add a case that a
   `/app` registration seeds nothing outside SHELL rules. Files: `src/app/door/register-sw.tsx`
   (move to a shared spot), `src/app/app/layout.tsx` or `src/components/po/app-chrome.tsx`.
2. **Remember the last door event locally and let the Deur tab mount from it offline.** Store
   `{venueId, eventId, name}` of the last pinned door event in the door IndexedDB store
   (`src/features/door/offline/idb.ts` — wiped by `idbClearAll` on sign-out, so no new wipe path)
   when `pinEvent` runs; in `MobileDoorBranch` (`src/components/po/door-branch.tsx`), when the
   candidate query is paused/errored (`fetchStatus === 'paused'` or `isError`) and the remembered
   event matches the venue, mount `DoorTree` for it. Guard both ways: never override a loaded
   candidate list, and never mount for an event whose snapshot is absent from IndexedDB (the door
   would be empty). `usePoDoorCandidates` stays where it is (door render isolation).
3. **Android offline page.** `server.errorPath` → a bundled `native/www/offline.html` ("No
   connection — reopen once you have signal", Retry). It only shows when the SW cannot serve
   anything (first-ever launch offline, SW evicted); it is not the offline door. Native config,
   so it belongs with S1a, not the web PR.
4. **Optional, verify first:** launch the shell at `/app` instead of `/` to skip the cached
   landing page + "Open the app" tap on an offline cold start. Capacitor's Android origin scoping
   strips the path, but N3's resolver deliberately reduces to the origin; issue #7596 shows a
   fragment in `server.url` breaks injection — a path is fine, a fragment is not. Confirm on the
   debug build before changing `PROD_SERVER_URL`.

**Before S5 (both platforms):** the device script below passes on Max's Android build with items 1–2
deployed, and on the S1b TestFlight build with the App-Bound keys.

## 9. Device test script for Max (Android debug build from N3)

Prerequisites: the N3 build from PR #340, logged in as a doorhost/admin of a venue with one **live or
upcoming** event that has guests. Run it twice: **Round A now** (expect 1–6 ✅, 7–9 ❌ — that
proves finding 3), **Round B once the follow-up in §8 is deployed** (expect all ✅).

1. Online: open the app, go to the Deur tab, wait until the guest list shows and the sync bar is
   quiet. Check one guest in. Is the check-in visible on another device or in the desktop cockpit?
2. Airplane mode on (wifi off too). Check a second guest in. Does the sync bar show it as
   queued (pending count 1), with the guest marked checked in?
3. Press Home (do **not** swipe-kill). Wait ≥ 6 minutes (past the 5-minute stale threshold).
   Reopen the app. Does the stale-resume overlay appear, then after ~8 s offer "continue anyway"?
   Tap it. Is the list still there with your queued check-in?
4. Still offline: check a third guest in. Queued count now 2?
5. Airplane mode off. Within ~60 s (the safety sync) do both queued check-ins drain (pending count
   0, no error state)? Are both visible on the other device?
6. Warm-resume baseline passed? (Steps 1–5 all yes = the offline door works when the process
   survives. This is unchanged by the shell model.)
7. **Cold start offline, main test.** Online, open the Deur tab once more so the shell is fresh.
   Airplane mode on. Force-stop the app (Settings → Apps → PlusOne → Force stop, or swipe-kill).
   Reopen it. What do you see? (Round A expected: a blank/error webview *or* the landing page and
   then "no event" on the Deur tab. Round B expected: the Deur tab with the guest list.)
8. Round B only: check a guest in offline, then airplane mode off. Does it drain and show on the
   other device?
9. Round B only, bridge check after an SW-served boot: from the Deur tab, open the profile /
   settings and tap an external link (terms/privacy). Does it open in the in-app browser sheet
   with a close button (bridge present) rather than inside the webview (bridge absent)? Also: does
   the Android back button behave as in N3's checks (Home → minimize)?
10. Round B only, first-ever-launch offline: uninstall, reinstall, airplane mode on, open. Do you
    get the bundled "No connection" page (if S1a shipped `errorPath`) or the system error? Either is
    acceptable; what must **not** happen is a frozen splash.
11. Sign-out wipe: online, sign out from the profile. Airplane mode on, force-stop, reopen. Do you
    land on login (no cached app HTML served), with no guest data anywhere?
12. Storage sanity (chrome://inspect from a laptop, Application tab on the webview): after Round B
    step 7, list Cache Storage. Is `/app` in `plusone-session-*`, `/` in `plusone-shell-*`, and is
    there **no** Supabase response body in any cache?

Answer as "1 ✅, 2 ❌ — …" per step.

## 10. Reconciliation with N3

N3 (PR #340) proposed "no `WKAppBoundDomains` in v1; N4 decides". This spike agrees with the
*first iOS build* being without the keys, and decides that the keys go **on** in a second S1b
TestFlight build, staged as in §5, because it is the only path to a cold-start-offline door on
iOS under remote-URL and the cost is two config lines. If that build fails the bridge checks, ship
iOS v1 without the keys, document iOS as warm-resume-only, and revisit at S1b's next iteration —
not by bundling the door.

## 11. Sources (accessed 2026-09-25)

- [S1] Android `ServiceWorkerController` API reference (added in API level 24):
  https://developer.android.com/reference/android/webkit/ServiceWorkerController
- [S2] Capacitor `Bridge.java` (main): `WebViewCompat.addDocumentStartJavaScript` gated on
  `WebViewFeature.DOCUMENT_START_SCRIPT`, single normalized allowed origin; `JSInjector` /
  `WebViewLocalServer.shouldInterceptRequest` fallback; `ServiceWorkerController` client:
  https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/Bridge.java
- [S3] Capacitor issue #5278 "bug: service worker server.url not injecting capacitor" (Capacitor
  3.3.2, Android, opened 2021-11-26, closed): https://github.com/ionic-team/capacitor/issues/5278
- [S4] Capacitor issue #7596 (Android detected as web when `server.url` has a fragment on
  `DOCUMENT_START_SCRIPT` WebViews): https://github.com/ionic-team/capacitor/issues/7596
- [S5] Capacitor configuration reference (v8): `server.url`, `server.errorPath` ("On Android the
  html file won't have access to Capacitor plugins", Android-only), `server.allowNavigation`,
  `ios.limitsNavigationsToAppBoundDomains` ("`localhost` (or the value configured as
  `server.hostname`) also needs to be added to the `WKAppBoundDomains` list"):
  https://capacitorjs.com/docs/config
- [S6] WebKit blog, "App-Bound Domains" (2020-06-26): opt-in via `WKAppBoundDomains` (max 10),
  `limitsNavigationsToAppBoundDomains`, restricted APIs on non-bound domains (JS evaluation and
  user scripts, `messageHandlers`, `WKHTTPCookieStore`), top-level-frame-only check, iOS 14:
  https://webkit.org/blog/10882/app-bound-domains/
- [S7] Capacitor issue #4122 "feat: Implement App-Bound Domains to enable Service Workers in
  WKWebView on iOS14+" (opened 2021-01-27): https://github.com/ionic-team/capacitor/issues/4122
- [S8] Capacitor PR #4789 "feat(ios): Add limitsNavigationsToAppBoundDomains configuration option":
  https://github.com/ionic-team/capacitor/pull/4789
- [S9] Capacitor issue #7069 "Service workers fail to register on iOS via WKWebView" (Capacitor
  5.5.1, 2023-11-14, closed as not planned; the `capacitor://` scheme case):
  https://github.com/ionic-team/capacitor/issues/7069
- [S10] Capacitor discussion #5502 "Running ServiceWorker in Capacitor App on iOS" (2022-03-14,
  unanswered): https://github.com/ionic-team/capacitor/discussions/5502
- [S11] WebKit blog, App-Bound Domains (same post): ITP enabled by default in all WKWebView apps on
  iOS 14 / macOS Big Sur; `NSCrossWebsiteTrackingUsageDescription` opt-out control.
- [S12] Apple Developer Forums thread 750682 "IndexedDB in WebView, get deleted?" (April 2024,
  no answer): https://developer.apple.com/forums/thread/750682
- [S13] Capacitor discussion #3205 "PWA offline after app restart" (2020; maintainer: WKWebView has
  no SW support, Android SW "doesn't work well" with the local server; the reporter's failure was
  a `server.url` cold start offline): https://github.com/ionic-team/capacitor/discussions/3205
- [S14] Next.js docs, "Static Exports" — Unsupported Features (dynamic routes without
  `generateStaticParams`, `cookies`, `headers`, middleware/proxy, server actions, `redirects`,
  `headers`): https://nextjs.org/docs/app/guides/static-exports
- [S15] Vercel docs, CDN cache — cacheable response criteria (`private`/`no-cache`/`no-store`
  never cached): https://vercel.com/docs/caching/cdn-cache
- Repo: `public/service-worker.js`, `src/app/door/register-sw.tsx`, `src/app/door/**`,
  `src/features/door/**`, `src/components/po/door-branch.tsx`, `src/features/po/hooks.ts`,
  `src/features/po/PoLiveProvider.tsx`, `src/middleware.ts`, `next.config.js`; N3 branch
  `capacitor.config.ts`, `ios/App/App/Info.plist`, `src/components/po/native-back.ts`; PR #340 body.
