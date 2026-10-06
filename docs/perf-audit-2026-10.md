# Performance audit, 2026-10-06 (read-only, from the code)

Trigger: Max and Joeri report the app "sometimes feels slow". A read-only audit of the `/app` surface, the
`po` hooks and queries, the `/app` layout, middleware, service worker and the migrations. No prod timing
data was used; see "Needs prod data" at the end. Execution lives in ClickUp as Snelheid P1 (quick wins,
milestone Now) and Snelheid P2 (larger or high-risk items); the order is in
`onboarding-orchestration-claude-code.md`. The earlier `perf-scale-audit-megaevent.md` still applies for
the door and the scale track; this document does not repeat it.

## Status (Snelheid P1, 2026-10-06, branch `claude/z8uq9m2xyn-snelheid-p1`)

| Finding | P1 status |
|---|---|
| 1 | `staleTimes.dynamic: 300` done. `pushState` navigation stays P2. |
| 2 | Done. Measured locally: 16 calls / 13 waves / 9 GoTrue before, 5 calls / 2 waves / 1 GoTrue after (layout; middleware's own getUser not counted). Extra finding: the root `not-found.tsx` also called `getSessionUser` per request, now shared through `cache()`. |
| 3 | Done for guests, events, contacts, quotas, requests; venues keeps layout revalidations where the layout output changes. Guard test added. |
| 4 | `AppScreens` reads no query; single-event read for event detail. `usePoEvents` staleTime NOT raised: guest writes don't invalidate the events list (`mutations.ts` `invalidateAfterAdd`), so the premise "writes already invalidate" is false for headcounts. Windowing stays P2. |
| 5 | Badge = role-gated `head` count. The full list on Home/Aanvragen (and the `.in()` link labels) stays P2. |
| 7 | Done (module-scope preload, browser-only). |
| 8 | Index done; count stays `exact` (review: `estimated` read ~3x too low past 1000 guests; with the index `exact` is ~0.47 s at 30k, was 1.0 s). "Map event names with `select` instead of waiting" not done: it needs the `useVenueGuests` call site in `screens/guests/index.tsx`. |
| Advisor `auth_rls_initplan` | Done (`invites_select`); the advisor matched the policy text, the old form was already an initplan. |
| 6, 9–14, other advisors | P2. |

P2 follow-ups from the P1 review (PR #408), not built in P1:

- **Own organizer scope:** the removed `revalidateEvent` calls re-rendered the `/app` layout, which derives the crew
  access set (`organizerVenues`). When an admin changes their OWN organizer scope (`assignOrganizer`,
  `removeOrganizer`, `inviteExternalCrew`), the venue switcher stays stale until a reload. Fix: `if (userId ===
  user.id) revalidatePath('/app', 'layout')` (same rule as the venue member actions) and allow that one call in
  `tests/unit/no-dead-revalidate-path.test.ts`.
- **Single-event headcounts:** `usePoEvent`'s cache-miss path calls `venue_event_headcounts` with `p_since =
  starts_at`, which aggregates every event after that one (the oldest event's recap is close to full history) and
  runs as a second sequential round-trip. Fix: a `p_event_id` filter on the RPC (SECURITY INVOKER) or a direct count.
- **`usePoEvents` staleTime:** raise to minutes only after the guest mutation hooks invalidate `poKeys.events`
  (`mutations.ts` `invalidateAfterAdd` and the edit/remove paths), so the Events-card headcounts can't go stale.

## The four root causes

1. Every tab tap waits on a server round-trip before the UI moves.
2. Every hard load of `/app` runs 12 to 13 auth and database calls one after another before the first byte.
3. Every po mutation re-runs that same chain on the server because of dead `revalidatePath` calls.
4. Some reads cover the venue's whole history and grow as the venue ages.

The "sometimes" is most likely serverless cold starts on the per-tap round-trip, plus older venues.

## Ranked findings

### 1. Every screen change is a server round-trip (P1 for `staleTimes`, P2 for `pushState`)

`src/components/po/app.tsx:167-174,199-231` navigates with `router.push`/`router.replace`. The page is
empty (`src/app/app/[[...segments]]/page.tsx:27`), the layout is dynamic and `next.config.js` sets no
`staleTimes`, so each tap goes middleware → GoTrue `getUser` (`src/lib/supabase/middleware.ts:56`) → a
fra1 function → an RSC payload that renders `null`. Warm: 150 to 400 ms. Cold function: 1 to 2 s.

Fix, quick: `experimental.staleTimes.dynamic: 300`, so revisited tabs come from the client cache. Fix,
real: navigate with `window.history.pushState(null, '', url)`; Next 15 syncs `usePathname` and
`useSearchParams` for any `pushState` whose state lacks `__NA`
(`node_modules/next/dist/client/components/app-router.js:309-316`). The door passes
`window.history.state`, which carries `__NA`, and that is the only reason `useDoorOverride` exists. Leave
the door as it is at first.

### 2. The `/app` layout makes 12 to 13 sequential calls before the first byte (P1, review gate)

`src/app/app/layout.tsx:65,81,87,95-98,139,154` through `context.ts:23`, `memberships.ts:34-78`,
`onboarding.ts:36-59` and `guards.ts:38-48` (`getAuthContext` → `listFactors()` calls `getUser` again).
There is no React `cache()`, so `getUser` hits GoTrue 8 times per document (9 with the middleware),
`venue_memberships` is read 3 times and `user_profiles` 2 to 3 times. Roughly 400 to 800 ms of TTFB
(fra1 → eu-west-1) on every cold open, refresh, PWA launch, venue switch and revalidating action.

Fix: wrap `getSessionUser` and `getMyMemberships` in `cache()`, then one `Promise.all` over memberships
(with the `venues.settings` + `subscriptions` embed onboarding needs), organizer venues, one profile row
(`full_name`, `terms_*`, `mfa_snooze_until`) and the `current_user_requires_mfa` RPC. Read factors from
`user.factors`. Target: 2 round-trips. Behaviour-preserving, but auth surface: reviewer session.

### 3. Dead `revalidatePath` calls re-render the whole layout on every po mutation (P1)

`features/guests/actions.ts:116,178,213,237,265,287`, `events/actions.ts:81-84` (`revalidateEvent`, 14
callers), `contacts/actions.ts` (10 calls), `quotas/actions.ts:62,108`, the requests and venues actions.
They target `/events/*`, `/admin/*` and `/app`; no `/events` or `/admin` routes exist, but any
`revalidatePath` sets `pathWasRevalidated`. Action fetches send no `RSC` header, so `flightRouterState`
is undefined (`next/dist/server/app-render/app-render.js:103-105`) and the response renders from the root,
re-running the chain in finding 2. About 0.4 to 0.8 s and around 10 GoTrue calls per guest add, edit,
remove, tier change, lock toggle or contact action, and a full shell re-render when the tree lands.

Fix: delete them from every action po calls; po invalidates its own React Query keys
(`mutations.ts:216-218`). Keep only consent and the profile name the layout renders.

### 4. `AppScreens` loads the venue's full history on every non-door screen (P1; windowing in P2)

`src/components/po/app-screens.tsx:202` (used only for `lijst`) → `hooks.ts:183-213`: `fetchEvents` plus
`venue_event_headcounts` with no `p_since` (migration `20260714171523`), aggregating every guest and
check-in the venue ever had under SECURITY INVOKER RLS. Cost grows with venue age (about 40k guest rows
per year at spec scale); with `staleTime` 30 s it refetches whenever one of about 12 screens mounts; it
blocks event detail (`events.tsx:225-245`) and the guest list, which is a waterfall: events, then guests
(`app-screens.tsx:126-128`).

Fix: drop the hook from `AppScreens` and render `GuestsTab` from `pinnedEventId`; give event detail a
single-event read; raise `staleTime` to minutes (writes already invalidate). P2: window `usePoEvents`.

### 5. The nav badge downloads 12 months of guest requests with PII, with a 414 time bomb (P1 badge, P2 list)

`app-chrome.tsx:202` → `hooks.ts:879` → `queries.ts:578-605` fetches all pending, denied and
auto-approved rows (e-mail, phone; retention default 12 months), then `request_links.in('id', linkIds)`
with no bound (`queries.ts:549`), then `influencers.in(...)`: three sequential round-trips for a count.
Past about 205 events with requests in the retention window the URL hits HTTP 414 (same class as
SCALE-5) and the badge, Home tiles and the Aanvragen inbox all throw. It also runs for staff and doorhost,
who scan the venue under RLS only to get `[]`.

Fix: badge = `count:'exact', head:true` on `status='pending'`, gated by role (P1). Full list only on
Aanvragen and Home, labels from the venue-scoped `fetchVenueRequestLinks` instead of `.in()` (P2).

### 6. The Guests tab downloads the whole address book for the "Regulars" filter (P2)

`guests/index.tsx:126` → `hooks.ts:1050` → `fetchContacts` (`queries.ts:1219-1245`, pages of 1000) +
`contactEventCounts` (`queries.ts:1184-1214`, a sequential loop over 120-id chunks). Contacten does the
same. At 3,000 contacts: about 28 sequential round-trips, 1.5 to 3 s, refetched after every contact
mutation. Fix: `.eq('is_permanent', true)` server-side (the partial index `contacts_venue_permanent_idx`
exists) and one GROUP BY RPC for the counts (SECURITY INVOKER, grant matrix).

### 7. Cold load is a chain of downloads with no preload (P1)

`src/components/po/app-client.tsx:39-42`: `next/dynamic` with `ssr:false` renders no `PreloadChunks`
(`next/dist/shared/lib/lazy-dynamic/loadable.js`), so the biggest chunk (shell, the eager
events/guests/settings barrels, the mobile door, the ~188 KB-source i18n catalogue) is requested only
after hydration, and about 14 queries start after that. Fix: `import('./app')` at module scope in
`app-client.tsx`, still `ssr:false`; optionally prefetch the first screen's queries in `PoLiveProvider`.
The no-SSR-Suspense rule stays intact.

### 8. The venue-wide guest window counts every row (P1)

`queries.ts:231-242` uses `count:'exact'` and the only index is `guests(venue_id)`; `useVenueGuests`
also waits for finding 4 (`hooks.ts:665`, `enabled: events.length > 0`). Fix: index
`guests(venue_id, created_at desc, id desc)`, `count:'planned'` or drop "of N", map event names with
`select` instead of waiting.

### 9. Middleware calls GoTrue `getUser()` on every request (P2, review gate)

`src/lib/supabase/middleware.ts:56`, including RSC navigations and actions. Fix: `getClaims()` (local
JWKS verification) in the middleware only; layout and actions keep `getUser`. Needs asymmetric JWT
signing keys on the project.

### 10. The desktop event-day cockpit refetches everything on each realtime event (P2)

`hooks.ts:765` throttles at 500 ms; `hooks.ts:797-806` invalidates the full guest list, tiers, arrivals,
the 5-RPC stats bundle and event detail (`EventDayCockpit.tsx:173-181`): about 2 full-list refetches per
second per cockpit at peak. K9 in the earlier audit covers the mobile door only. Fix: patch guests and
arrivals from the payload (as the door's `onCheckIn` does) and throttle stats and tiers to about 5 s.

### 11. The service worker has no timeout on network-first navigations (P2)

`public/service-worker.js:469-492`: on venue lie-fi the boot screen hangs for the whole failed fetch
before the cache fallback. Fix: race the fetch against a 3 to 4 s timeout, same cache buckets, PII
scoping unchanged; re-run the SW guards.

### 12. Three separate `events` reads and two headcount RPCs on Home (P2)

`usePoEvents` (full history), `usePoHomeEvents` (7 days, 10 s poll, `hooks.ts:252`) and
`usePoDoorCandidates` (full history, `hooks.ts:330`, mounted on every desktop screen via
`DesktopDoorAutoOpen`, `app.tsx:321`). Fix: one windowed base query with `select` per shape, `sinceIso`
for door candidates; keep `hasData`/`fetchStatus` semantics for the N7 offline fallback.

### 13. The platform-admin check doubled the per-row RLS cost (P2, review gate)

`20260923120000_platform_admin.sql`: every false branch of `has_venue_role` and `is_event_organizer` now
also calls `is_platform_admin()` per row; `guests_select` for staff is about 5 helper calls per row,
`check_ins_select` about 4. Fix: set-based policies (`venue_id in (select
public.my_venue_ids_with_roles(...))`, constant argument so it hoists once) or `(select
public.is_platform_admin())` as its own top-level disjunct. pgTAP allowed and denied per role.

### 14. Minor (P2)

`usePoGuests` reads tiers again next to `usePoTiers` (`hooks.ts:625-628`); bulk-paste contact matching
runs one RPC per distinct name (`features/guests/contact-match.ts:108-125`); `stats-panel.tsx:28` polls a
5-RPC bundle every 15 s while a live event detail is open; adding a guest re-downloads the event's full
list (`mutations.ts:180-185`) instead of patching it.

## Supabase performance advisors (2026-10-06)

- `auth_rls_initplan` (WARN): `invites_select` re-evaluates `auth.uid()` per row; wrap as
  `(select auth.uid())`. P1.
- `multiple_permissive_policies` (WARN): `check_ins` has two permissive UPDATE policies for
  `authenticated` (`check_ins_update_door`, `check_ins_update_own_device`); merge. P2 (RLS).
- `unindexed_foreign_keys` (INFO, 33): mostly `*_by` audit columns that are never filtered on. Worth
  adding only where a venue-wide read exists: check in P1 whether anything reads `check_ins` or
  `refusals` by `venue_id` without `event_id`.
- `unused_index` (INFO, 11): leave until prod has traffic; `contacts_venue_permanent_idx` becomes used
  by finding 6.
- Auth DB connection strategy is absolute (10): switch to percentage in the dashboard (Max).

## Already fine, do not re-audit

The Sentry browser SDK is deferred to idle (`instrumentation-client.ts`). Rare screens are lazy and
guarded by `app.code-split.test.ts`; phone/libphonenumber, qrcode and the day-picker are lazy. The mobile
door is deliberately static in the shell chunk for offline (#25). The shell root reads no venue-wide
query; door render isolation and `notifyOnChangeProps` tuning work. SCALE-5 is fixed (`venue_id`
denormalized, headcounts as a GROUP BY RPC, no `.in()` lists of event ids, contact chunks ≤ 120). Indexes
exist for every hot filter except finding 8. RLS helpers are STABLE SECURITY DEFINER with indexed
`exists()`. `refetchOnWindowFocus` is off; the Home poll pauses when hidden and is windowed to 7 days. At
most one realtime channel is open at a time and the door patches its cache from the payload. The door
persister is throttled to 2 s. The browser Supabase client is a singleton. Stats run on aggregate RPCs.
Fonts are self-hosted variable fonts. Still open from the earlier audit: K9 (`DoorProvider.tsx:424-428`
invalidates the full snapshot after every drain), SCALE-1 (door cold-load payload), realtime fan-out.

## Prod numbers, 2026-10-06 (Vercel observability, production, last 12 h)

- Functions: TTFB average 485 ms, P75 563 ms, P95 711 ms. Active CPU average 115 ms, P75 158 ms.
  Inference, not proof: the ~370 ms gap is time the function is not computing (I/O wait, queueing
  or start-up). It is consistent with the sequential Supabase/GoTrue chain of finding 2, which
  comes from reading the code, not from these metrics.
- Start type: 88% hot, 9% prewarmed, 2.5% cold. Fluid compute is on. Cold starts exist but are a
  small share of invocations.
- Per route (P75): `/app/[[...segments]]` 508 ms (323 invocations), `/consent` 709 ms,
  `/auth/confirm` 1.3 s, `/onboarding` 889 ms, `/login` 76 ms. `/login` is the one page without
  the auth + database chain; the gap is consistent with the hypothesis, not proof of it.
- **Verify before changing anything (first step of P1):** open a sampled `/app` transaction in
  Sentry → Performance (server tracing samples 5%) and count the `http.client` spans to
  `*.supabase.co` and their serial layout; or raise the sample rate to 100% for `/app` for a day.
  Expected if the hypothesis holds: 8+ GoTrue calls and 3 `venue_memberships` reads, one after
  another. If a trace shows otherwise, finding 2 is wrong and P1 drops that item.
- `/api/health` is 256 of 760 invocations (an uptime poll every ~3 min) at 579 ms P75: cost
  only, but worth a cheaper check.
- Deployment regions are `["fra1"]` and a live response carries `x-vercel-id: fra1::fra1`. The
  observability panel shows the project default "Region IAD1": set the project's function region
  to Frankfurt as well so nothing outside `vercel.json` can land in the US (also an EU-processing
  statement in the DPA).

## Measurement plan for P1 (before → target, same instrument both times)

| Path or query | Before (2026-10-06) | Target after P1 | Instrument |
|---|---|---|---|
| `/app/[[...segments]]` P75 | 508 ms | ≤ 200 ms | Vercel → Observability → Routes, 12 h window |
| `/consent` P75 | 709 ms | ≤ 300 ms | same |
| `/onboarding` P75 | 889 ms | ≤ 300 ms | same |
| GoTrue calls per `/app` document load | 8–9 (from code; confirm in trace) | 2 | Sentry → Performance, `http.client` spans of one `/app` transaction |
| `venue_memberships` reads per load | 3 (from code) | 1 | same |
| Server time per po mutation | 0.4–0.8 s (layout re-render via dead `revalidatePath`) | no layout render | Sentry trace of one server action (`guests.add`) |
| Requests on returning to a visited tab | 1 RSC fetch | 0 | browser Network tab |
| Nav badge query | full requests list incl. PII | 1 `head` count | Network tab (PostgREST URL) |
| Venue-wide guest count | `count=exact` | `planned` or none | Network tab |
| Venue-history fetch on non-door screens | every mount | list screen only | Network tab, React Query devtools |

The P1 PR body carries this table with the "after" column filled in; the "before" column is
re-measured on the same day the PR is opened so both sides use the same traffic.

## Needs prod data

The real `/app` TTFB split between middleware, the layout chain and cold starts (Sentry server tracing
samples 5%); whether Vercel Fluid compute is enabled; whether the project uses asymmetric JWT signing keys
(decides finding 9); real per-venue sizes (aggregates only); database time of the full-history
`venue_event_headcounts`; production bundle sizes (`next build` route table); the edge middleware region
relative to eu-west-1; realtime RLS fan-out (hosted-only).
