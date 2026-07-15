# Changelog — shipped-phase history

Session-end status reports live here, **newest first**. CLAUDE.md holds only current
invariants and open work; when a task ships, its narrative (PRs, commits, root causes,
gotchas) is appended here instead of CLAUDE.md. Older history than this file covers:
`launchplan-claude-code.md` (STAP 0–4 framing), `docs/test-report.md`, the `perf-*.md`
records (repo root), and `engineering-review-2026-07.md`.

---

## 2026-07-14 — `useVenueGuests` pulled the whole venue guest history to the browser (86ey9e8hz)

DONE — PR #234 (`fix/86ey9e8hz-venue-guests-window`), merged to main. Adversarially CONFIRMED
finding (R3/C1) from the perf/scale review batch; violated the CLAUDE.md scale rule
"Reads must be windowed at large N". Milestone ≥25 (25 000 guests / 400 events).

- **Root cause.** The Guests-tab "All events" mode called `fetchGuests(client, { venueId })`
  → `fetchAllRanged` paged **every** venue guest row to the client (up to 50 sequential
  1000-row PostgREST pages), then `sortGuestsNewestFirst` (full copy + O(n log n)) + `toPoGuest`
  per row + `filterGuestList` over all rows on every debounced keystroke. At 25 000 guests that
  is ~25 sequential requests + the whole snapshot in browser memory. `usePoEventRealtime` also
  invalidated `VENUE_GUESTS_PREFIX` on **every** check-in, so returning to the tab during a live
  night re-triggered the full re-download + re-sort. Worked on the 30-guest seed, died at 25 000
  — the canonical "works at 150, falls over at 25 000".
- **Fix.** New `fetchVenueGuestsWindow` (`src/features/po/queries.ts`): ONE bounded request —
  newest-first (`created_at desc, id desc`), `VENUE_GUESTS_WINDOW = 200` rows via `.range`, tier
  from the `guest_tiers(name, color)` embed (kills the separate venue-wide tier read, no
  waterfall), and `count: 'exact'` for the "of N" subtitle total. Name **search is pushed to the
  server** (`ilike` on `full_name`, same shape as `fetchContacts`) so a match outside the window
  stays findable without downloading the venue. `useVenueGuests(events, search)` keys on
  venue+term (like `contacts`); `poKeys.venueGuests` gained the search arg (prefix unchanged, so
  guest writes still invalidate every variant). The unbounded `fetchGuests({ venueId })` branch
  was **deleted** at the source (narrowed to `fetchGuests(client, eventId)` — the single-event
  door/cockpit read is a bounded, deliberately-ranged case and is untouched).
- **Realtime.** Removed the per-check-in `VENUE_GUESTS_PREFIX` invalidation from
  `usePoEventRealtime` (kept `eventDetail`); the venue-wide tab is not the door, so it now
  refreshes on guest writes (mutation paths keep the prefix), navigation, and the safety sync —
  not on every check-in during a rush. Event-scoped door/cockpit stays fully live.
- Files: `src/features/po/queries.ts`, `hooks.ts`, `keys.ts`,
  `src/components/po/screens/guests/index.tsx`. Tests: new `fetchVenueGuestsWindow` coverage
  (window/search/count/tier-flatten + error-propagation) in `queries.test.ts`, repointed the
  SCALE-5 venue-scope guard, updated the realtime cascade test (venue-guests no longer fired;
  6-key → 5-key). No migration (reused `guests.venue_id` from `20260708120000`).
- **Runtime-verified** on the local stack (door@ / Club Vesper): the exact windowed query
  returned 200 (`…guest_tiers(name,color)&venue_id=eq.…&status=in.(approved,checked_in,refused)&order=created_at.desc,id.desc&offset=0&limit=200`),
  ONE page not a ranged loop; subtitle "33 of 33 shown"; typing "Esra" fired a fresh bounded
  request with `&full_name=ilike.%Esra%` and the subtitle became "1 of 1 shown". No console
  errors. Suites: Vitest 837 green, `tsc` clean, lint clean.
- **Known scope boundary (not a regression):** at large N the "Regulars" client filter and the
  "shown of N" pairing operate over the 200-row window; and `ilike '%term%'` is a seqscan at
  very large N (fine at 25 000, a `pg_trgm` index is the ≥100 follow-up if search latency shows).

---

## 2026-07-14 — Door-QueryClient rebuilt (and leaked) per shell remount (86ey9e8pm)

PR #235 open (`fix/86ey9e8pm-door-queryclient-remount`), tests green, awaiting fresh-session
`/code-review` + Max's merge. Adversarially CONFIRMED perf finding (L1) from the 86ey9e8xx
review batch; the immediate follow-up to 86ey9e8gf, which had already flagged this task's
remount as the suspected cause of the doubled snapshot bursts behind 86ey9tq62.

- **Root cause.** On `/app` the mobile Deur-tab mounts `DoorQueryProvider` *inside*
  `PlusOneApp`, which remounts fully on every `router.push` (module comment
  `app.tsx:244-257`). `DoorQueryProvider` built a **fresh** client per mount via
  `useState(() => createDoorQueryClient())`, whose `gcTime: WEEK_MS` timers pin the full
  event snapshot (150–1500+ rows) + the abandoned client for a week on unmount — one leaked
  client per Deur-tab visit, so the heap grows over a shift. The standalone `/door` route is
  immune: its provider lives in the route layout, mounted once (`src/app/door/layout.tsx:10`).
- **Why not "hoist the provider".** `PoLiveProvider` supplies the po-QueryClient on the
  **default** React Query context (`PoLiveProvider.tsx:76`); `PlusOneApp` + every po screen
  read it via `useQueryClient()` (e.g. `app.tsx:333`). Hanging `DoorQueryProvider` above
  `PlusOneApp` would shadow the po-client for the whole shell. The door client must stay
  scoped to the door subtree.
- **Fix (surgical singleton — scope confirmed with Max).** Door QueryClient + persister are
  now per-tab-session singletons (`getDoorQueryClient` / `getDoorPersister` in
  `offline/query-client.ts` + `offline/persister.ts`) that `DoorQueryProvider` reuses
  (`useState(getDoorQueryClient)` / `useState(getDoorPersister)`) — the client is no longer
  rebuilt per navigation. Kills the leak; serves a warm cache on re-entry, which also removes
  the **doubled full-snapshot refetch on remount** (relevant to 86ey9tq62 — worth a re-test).
  Resets only on a full page load; sign-out does `window.location.assign` (`settings/_shared.tsx`),
  so PII posture is unchanged. Same one-client-per-session model `/door` already uses.
- **Deliberately out of scope (R7 → follow-up).** `PlusOneApp` still remounts per navigation
  (a constant-cost shell re-render, not the growing leak). Filed as a separate no-remount task
  (move `PlusOneApp` into the stable `/app` layout) — that's the one that would also settle
  86ey9tq62's remount-driven overlay-back weirdness at the source.
- Files: `src/features/door/DoorQueryProvider.tsx`, `src/features/door/offline/query-client.ts`,
  `src/features/door/offline/persister.ts`. New tests: `offline/query-client.test.ts`
  (singleton identity + gcTime), `DoorQueryProvider.test.tsx` (same client instance across an
  unmount→remount cycle = the exact leak mechanism). No migration.
- Tests: `pnpm vitest run` green (837, 77 files, +4 new); `tsc --noEmit` clean; eslint clean.
  Browser: `/app` renders clean for `door@` with no console errors; a live heap/mount-count
  capture on the mobile door tab wasn't reliably obtainable in the shared headless preview
  (tab not painting, mobile branch not flipping via matchMedia), so the leak mechanism is
  unit-proven instead of screenshotted.

---

## 2026-07-14 — Door-overlay Back over-popped past the check-in list (86ey9tq62)

Surfaced during 86ey9e8gf live testing. PR pending, not yet merged. Client-only nav-state
fix (`src/components/po/`) — no migration, no RLS/auth/service-role touch. It IS door-adjacent
(the Deur tab's raw-history sub-nav), but touches only *when the `doorOverride` shadow clears*,
never the offline outbox or any write, and preserves the offline invariant (#25): still no
`router.push` on the door, still pure client state, no network. A fresh-session `/code-review`
is welcome but not a mandated gate per the high-risk list.

- **Root cause (traced against the code's own documented Next model).** Door sub-nav is driven
  by raw `window.history.pushState/replaceState` (`pushDoorState`/`replaceDoorState`), which
  Next's `usePathname`/`useSearchParams` do **not** track — they stay frozen at the last real
  router navigation and only resync on a genuine nav or a **popstate**. The `doorOverride` shadow
  was cleared solely by `useEffect(…, [pathname, searchParamsStr])`. Enter the door via
  `?event=A` → `useSearchParams` is frozen at `event=A`; the raw switch → picker → re-pick →
  open-overlay sub-nav never changes it; pressing Back to close the overlay pops back to
  `?event=A` — the **identical** frozen string. So the deps never change, the effect never
  re-runs, and the stale overlay override survives the pop: the overlay lingers on screen and
  the user's next Back over-pops straight **past** the check-in list. This is the
  `hasPushedThisSession`↔raw-history desync Max flagged; `hasPushedThisSession` itself is fine
  (the overlay really did push an entry) — the culprit is the shadow not clearing.
- **Fix.** Extracted the override state machine into `src/components/po/use-door-override.ts`
  (unit-testable, well-documented) and added a second clearing trigger: a `popstate` listener
  that drops the shadow on **any** browser back/forward, independent of whether Next's hooks
  changed — a popstate always means the browser URL just won, so the URL-derived door state
  becomes authoritative. `app.tsx` now calls `useDoorOverride(pathname, searchParamsStr)` in
  place of the inline `useState`+effect; behaviour is otherwise identical. Capacitor-safe (the
  Android hardware-back maps to popstate → this now clears correctly too).
- **Tests.** `use-door-override.test.ts` (5, new) — including the regression: a popstate with
  **unchanged** deps clears a set override (the exact stale-shadow-survives-pop condition), plus
  listener cleanup on unmount. Full Vitest **825/825** green, `pnpm type-check` + `pnpm lint`
  clean (only the pre-existing `datetime-field.tsx` aria warnings).
- **E2E (real browser, A/B-proven).** `tests/e2e/door-overlay-back.spec.ts` (new) drives the
  exact flow on a 390px viewport — dev-login as `door@` → enter the door with a frozen `?event=`
  → Switch → re-pick → open a guest overlay → one Back — and asserts the check-in list returns
  (search box + Switch bar, overlay gone, URL back to the list). The Next remount/popstate
  timing this depends on doesn't reproduce in jsdom, so this needed a real browser. Verified
  **both ways**: green with the fix; with the popstate listener neutralized it **fails** exactly
  at the post-Back assertion (the overlay lingers) — proving it's a genuine regression guard, not
  a test that passes regardless. (Local gotcha: the fresh Playwright dev server crashed a Next
  compile-worker on the cold 6.6k-module `/app/[[...segments]]` compile under load — a transient
  infra flake, not the app; pre-warming the port-3000 server it reuses makes the run
  deterministic. Authenticated `/app/door` renders `200`.)

---

## 2026-07-14 — DoorContext re-rendering on every sync tick (86ey9e8gf)

DONE + merged to main, PR #225 (`fix/86ey9e8gf-doorcontext-sync-memo`). Adversarially
CONFIRMED finding from the perf/scale review batch (86ey9e8xx).

- **Root cause.** `useDoorSync()` returned a fresh object literal on every render regardless
  of whether its own reactive state (`online`/`realtimeConnected`/`lastSyncAt`/`now`/`syncing`)
  actually changed — no `useMemo`. That busted `DoorProvider`'s `value` useMemo (`sync` was
  always a new reference), so every `useDoor()` consumer re-rendered on the 15s age-label tick
  and on every sync flush's `syncing` true/false toggle — confirmed ≥8×/min idle, 3-5× per
  check-in.
- **Fix.** (1) Wrapped `useDoorSync`'s return in `useMemo` so its identity is stable when
  nothing it derives from changed. (2) Split `sync` out of the broad `DoorContext` into a
  narrow `DoorSyncContext` — `SyncBar` is the only real consumer of that field (verified
  `AddOnSpot`/`Taken`/`GuestDetail`/`CheckInList` never read it), so the tick/syncing-toggle no
  longer re-renders the check-in list's ~20-28 virtual rows, `GuestDetail`, `Taken`, or
  `AddOnSpot`.
- Files: `src/features/door/DoorProvider.tsx`, `src/features/door/sync/useDoorSync.ts`,
  `src/features/door/components/SyncBar.tsx`. No migration.
- Tested by Max on the live door flow (10/10 on the per-screen handoff: Deur opens, sync-bar
  status/refresh, check-in/void/undo, idle sync-label keeps updating, screen stays visually
  still outside the sync-bar).
- **Gotcha found during testing, tracked separately (86ey9tq62):** checking a guest in
  sometimes leaves the GuestDetail overlay open instead of auto-returning to the check-in
  list, and "Back" can land somewhere unexpected. Traced `closeOverlay()`/`router.back()` in
  `src/components/po/app.tsx` line by line — confirmed `router.back()` is literally
  `window.history.back()` in the installed Next.js version (no internal position tracking to
  desync), and found no bug in the code as written. Live reproduction was blocked by the
  shared local Supabase stack being touched by other concurrent sessions in the same review
  batch (auth bouncing to onboarding, preview browser losing interactivity). Strong suspicion
  it's a symptom of 86ey9e8pm (`PlusOneApp` remounts fully on every navigation, confirmed in
  that task) rather than a bug in the door-overlay logic itself — the doubled full-snapshot
  request bursts seen in Max's repro screenshot match "DoorProvider remounted and refetched
  everything" rather than a normal delta-sync. Left unfixed pending 86ey9e8pm; narrow-fix
  branch `fix/86ey9tq62-door-overlay-back-nav` has no commits.

---

## 2026-07-14 — Home's event poll was unbounded, growing with venue age (86ey9e8gt)

DONE, merged to main, tested by Max (door@ confirmed real counts). Perf
finding, adversarial CONFIRMED (R2). Discussed with Max before building: he proposed
(1) stop polling old past events and (2) poll counts-only + manual refresh for new
events. Landed (1) — windowing already fixes the query-cost-grows-with-venue-age bug
that (2) was also trying to solve — and skipped (2) since `venue_event_headcounts` was
already counts-only (the unbounded cost was in the ROW COUNT of the aggregate, not in
fetching full guest rows), and the manual-refresh trade-off wasn't worth it once the
row count itself is bounded.

- **Root cause.** `usePoHomeEvents` (`src/features/po/hooks.ts`) polls every 10s via
  `fetchEvents` + `fetchEventHeadcounts`, neither of which had a date window — every
  poll re-scanned the venue's ENTIRE event history (400-1000 events after months),
  even though the Home board only ever displays recent-past (7 days, `PAST_WINDOW_MS`
  in `screens/home.tsx`) + upcoming events. `venue_event_headcounts` (the aggregate
  RPC) has no join to `events`, so it returned one row per historical event too.
- **Fix.** `venue_event_headcounts` gets an optional `p_since timestamptz` cutoff
  (migration `20260714171523_venue_event_headcounts_since_window.sql`, default null =
  unbounded — every other caller, incl. the Events tab's "Past" view, is unaffected).
  `fetchEvents` gets a matching optional `sinceIso` → `.gte('starts_at', sinceIso)`.
  `usePoHomeEvents` and `usePoDoorEvent` (same unbounded call, same file, no new
  design decision) now pass a shared `RECENT_EVENTS_WINDOW_MS` (7 days) cutoff;
  `home.tsx`'s own `PAST_WINDOW_MS` now imports that same constant instead of
  duplicating the number, so the query window and the display window can't drift.
- **Gotcha — migration timestamp collision on the shared local stack.** Picked
  `20260714160000` first (checked clean against `origin/main`), but the SHARED local
  Supabase stack (dozens of concurrent worktree sessions right now) already had a
  *different* migration applied at that exact version from another session —
  `supabase migration up` silently no-op'd it (matches by version number, not
  content), so my file never actually ran until I noticed the DB still had the old
  function signature and renamed to a less-guessable `20260714171523`. A full local
  `supabase test db` run also came back polluted (unrelated committed rows from other
  concurrent sessions inflating seed counts) — not a signal about this PR; the
  isolated single-file pgTAP run (37/37, incl. 2 new `p_since` cases) and CI's clean
  reset are the real gates here, not this shared dev DB's ambient state.
- **Gotcha — preview-tool couldn't visually verify.** The headless preview browser
  never fires `requestAnimationFrame`, which is what React's streaming-SSR Suspense
  reveal (`$RC`/`$RV`) depends on to un-hide server-rendered content — every po screen
  in this environment loads fully server-rendered but stays invisible forever. Forcing
  the reveal manually (`window.$RV(window.$RB)`) proved it's a pure visual/hydration-
  timing artifact, not a data problem — but no client-side query ever actually mounted
  in that session either (confirmed via a `window.fetch` monkey-patch: zero calls to
  the local Supabase REST endpoint across a full 10s poll interval), so live in-browser
  verification of the poll itself wasn´t possible this session. Verified instead via
  pgTAP + a direct `psql` smoke test of the windowed RPC against real seed data + the
  full po vitest suite (147/147) + a clean `tsc --noEmit` + lint.
- **Not high-risk** per CLAUDE.md's review-gate definition (no RLS policy, no trigger,
  no `SECURITY DEFINER`, no `service_role`) — CI is the floor, no mandatory fresh-session
  review before merge.
- **First test round used the wrong seed user:** pointed Max at `manager@`
  (`user_manager`) to eyeball Home — that role has zero guest-read rights by design
  (`GUEST_READ_ROLES` in `src/features/auth/roles.ts`, M9/K-7: a "—" is correct there,
  not a bug), so it looked like guests had vanished. Re-tested as `door@` and counts
  showed correctly.

---

## 2026-07-14 — Request-link-max trigger missing the same concurrency lock as quota/capacity/tier-max (86ey9p8zh)

DONE + merged to main, PR #224 (`claude/86ey9p8zh-request-link-trigger-lock`). CONFIRMED
follow-up filed by PR #216 (86ey9e8ar) itself — "same unlocked-recompute shape, out of scope
there". Touches a trigger + `SECURITY DEFINER` function → fresh-session `/code-review` +
`/security-review` run before merge; verdict **ship it**, zero real defects (7/7 adversarial
refuters held on an 8-agent panel, plus a live-DB break-script: 5/6/10-way floods, multi-slot
`plus_ones`, and the `UPDATE` net-increase path CI doesn't cover all landed exactly at the cap).

- **Root cause.** `enforce_request_link_max()` (SQLSTATE 45006,
  `supabase/migrations/20260706101000_request_link_attribution.sql`) recomputed
  `request_link_consumption()` via a plain `SELECT` in an AFTER trigger under READ COMMITTED
  with no row lock — the identical gap 86ey9e8ar fixed for personal quota/tier-max/event
  capacity. Two concurrent adds through the same request link (two door sessions, or two
  offline-outbox replays both attributing to the same influencer link) could each pass and
  silently exceed `max_headcount`.
- **Fix.** New migration `20260714160000_request_link_trigger_locking.sql`, `CREATE OR REPLACE`
  on the existing function, adding `pg_advisory_xact_lock(4, hashtext(request_link_id::text))`
  as the fourth contention domain (alongside 86ey9e8ar's 1/2/3), taken only on the net-increase
  branch. No schema change, no app-code change (`request_link_id` is only ever set single-row
  via `approve_guest_request`/`submit_guest_request`, never through `addGuestsBulk`, so the
  40P01 deadlock-retry #216 needed doesn't apply here).
- **Test.** Extended `scripts/quota-trigger-concurrency-test.mjs` with a fourth cross-connection
  race (45006) rather than a new pgTAP file — same reasoning as 86ey9e8ar (needs two genuinely
  racing connections, which one pgTAP transaction can't produce). `supabase db reset` clean,
  `supabase test db` 52 files/1003 pgTAP green, `pnpm db:test:concurrency` 4/4 domains PASS,
  lint clean, vitest 819/820 (1 unrelated `stripe-webhook.test.ts` timeout flake, confirmed
  passing in isolation).
- **Review found two pre-existing, out-of-scope, low-severity gaps** in the *original*
  20260706101000 migration (not introduced by this PR) — filed as its own task, 86ey9thm6:
  (1) the 45006 error's numeric hint leaks another venue's link consumption/max if a staffer
  cross-attributes to a link outside their own event (no event/venue match in the lookup);
  (2) a theoretical multi-link raw-insert deadlock, unreachable via any shipped path and
  fail-safe regardless.

---

## 2026-07-14 — Home "Lock" button was a decoy (86ey9e8de)

DONE, PR [#228](https://github.com/Max-Seffelaar/PlusOne/pull/228), not yet merged.
CONFIRMED review finding (QU2). Client-only React Query wiring fix — no migration, no
RLS/auth/service-role/door-outbox touch, so no mandatory fresh-session review gate; CI is
the floor here.

- **Root cause.** Home's board `onLock` (`src/components/po/screens/home.tsx`) only
  flipped local `lockOverride` state and showed a "Lijst vergrendeld" toast — it never
  called `usePoSetListLock`. `events.list_locked` never changed: staff mutations stayed
  RLS-allowed and the icon reverted to the stale server value on refresh. The cockpit
  (`EventDayCockpit.tsx`) already wired the real mutation; only Home's board was fake.
- **Fix.** New `usePoSetListLockOnHome` (`src/features/po/mutations.ts`) — same
  `setListLock` action as `usePoSetListLock`, but the eventId travels in the `mutate()`
  call instead of hook creation, since Home renders many events at once rather than one
  fixed id (can't call a per-id hook inside a list `.map()`). Also invalidates
  `poKeys.home` — a separate cache key from `poKeys.events`/`poKeys.event` that
  `useInvalidateEvent` doesn't touch — so Home's own icon refreshes without waiting on
  the 60s poll. `onLock` now: optimistic flip → toast only on mutation `onSuccess` →
  rollback of the override on `onError`.
- **Live-verified** (local Supabase, not just unit tests): as `admin@`, Lock/Unlock
  flips `events.list_locked` (+`locked_by`/`locked_at`) confirmed via direct PostgREST
  read AND after a full page reload (fresh server state). As `manager@`
  (`user_manager`, no lock rights per #23), the DB row correctly stays unchanged — RLS
  holds.
- **Gotcha found while testing, not fixed here:** Home passes `onLock`/`onEdit` to
  every `EventRow` regardless of role (unlike `edit.tsx`, which gates the lock toggle
  behind `writable`/`canManage`), and `setListLock` doesn't distinguish a real success
  from an RLS-filtered 0-row update — it returns `ok:true` either way. Combined, an
  unprivileged role's click leaves the optimistic UI stuck on "locked" until a manual
  refresh. RLS itself blocks the write (no bypass, proven by the existing
  `attacker_list_lock.test.sql` pgTAP), so this is a UX/consistency gap, not a live
  vulnerability — spawned as a separate follow-up rather than widening this PR.
- **Preview-tooling gotcha:** the `/app` route streams via React 18 Suspense; on a
  backgrounded/occluded preview tab, Chrome throttles the `requestAnimationFrame` the
  streaming reveal (`$RC`/`$RV`) depends on, so the page can stay stuck showing only
  the pre-hydration shell indefinitely (not just slowly). Unstick with
  `window.$RV(window.$RB)` in `preview_eval` if `document.hidden` is true and content
  never appears after a normal wait.

---

## 2026-07-14 — Cockpit realtime invalidation fanned out ~20 requests/check-in (86ey9e8fe)

DONE + merged to main. PR #226 (`fix/86ey9e8fe-cockpit-realtime-invalidation-fanout`).
Not a high-risk surface (no RLS/triggers/service_role/auth/webhook/door-outbox) — CI
(`lint-and-test`) was the gate, plus a fresh 5-angle `/code-review` pass run before
merge as extra confidence on a check-in-path perf change.

- **Root cause.** `usePoEventRealtime`'s realtime channel fired its full 6-key
  invalidation cascade (guests/tiers/arrivals/eventStats/venue-guests/eventDetail)
  once per `postgres_changes` event — a single check-in touches both `guests`
  (status flip) and `check_ins` (insert), so that's 2 cascades per check-in on its
  own. On top of that, each check-in mutation's `onSettled` re-invalidated
  `guests`/`arrivals` right after `onMutate` had already patched them optimistically
  to the exact post-mutation shape — re-downloading data that was already correct.
  `usePoCheckinArrivals` also returned a fresh `Map` on every fetch, defeating React
  Query's structural sharing and invalidating the `tiles`/`tierRows`/
  `CockpitGuestList` memos downstream even when nothing had changed.
- **Fix.**
  - `usePoEventRealtime`'s invalidate is now throttled (leading+trailing, 500ms) —
    a door-rush burst collapses into at most 2 cascades instead of one per event.
  - Check-in mutations no longer invalidate `guests`/`arrivals` (optimistic patch
    already correct); `tiers`/`eventStats`/`VENUE_GUESTS_PREFIX` still invalidate on
    `onSettled` — see review gotcha below for why `onSuccess` was wrong here.
  - `usePoCheckinArrivals` gets a content-aware `structuralSharing` comparator
    (`arrivalsEqual`) so an unchanged refetch keeps the old `Map` reference.
  - Added an opt-in 60s `refetchInterval` safety poll on the cockpit's 4 live
    queries, matching the "optimistic patch + realtime + 60s safety sync" scale rule.
- **Review gotcha.** The first pass changed the check-in mutations' `onSettled` to
  `onSuccess` and dropped `VENUE_GUESTS_PREFIX` from the derived-invalidation helper
  entirely — both looked like reasonable trims but a 5-angle review (3 independent
  agents, same finding from different angles) caught that this regressed real
  behavior: `onSuccess` skips reconciliation on a failed mutation (e.g. a revive that
  fails after a peer's write already landed), and dropping `VENUE_GUESTS_PREFIX` made
  the acting device's own venue-wide Guests-tab freshness depend entirely on the
  throttled realtime echo with no poll fallback outside the cockpit screen. Reverted
  to `onSettled` + restored `VENUE_GUESTS_PREFIX` in the same PR before merge — worth
  remembering that "this cache key looks now-redundant" needs checking against BOTH
  the success path and the error/no-realtime path before removing it.
- **Test-list gotcha.** One test-handoff item ("does the KPI chart update after a
  check-in") was checked with the doorhost seed account and reported as "the whole
  card vanished" — false alarm: the KPI/arrivals card is gated behind `canSeeStats`
  (admin, this event's organizer, or finance), which doorhost never satisfies. Not
  touched by this PR at all; worth being explicit about required role per test-list
  item when a screen has per-role visibility gates, not just per-role write gates.

---

## 2026-07-14 — Door add-on-the-spot bypassed Zod; quick-add trailing-number misparse (86ey9e8bd)

DONE + merged to main. CONFIRMED review finding (T2 + gap-sweep #36). PR #219
(`fix/86ey9e8bd-door-add-plus-ones-cap`). Touched the door outbox → high-risk surface →
fresh-session `/code-review` + `/security-review` run before merge, not by the building
session — the code review caught a real merge-blocking bug (below), the security review
found nothing blocking.

- **Root cause 1 (T2).** `DoorProvider.addOnSpot` (`src/features/door/DoorProvider.tsx`)
  enqueued the door "add on the spot" payload straight into the offline outbox with only
  `if (!fullName) return` as a guard — no Zod. The outbox replay (`outbox/replay.ts` →
  `gateway.ts insertGuest`) inserts that payload directly through the user-scoped client
  with RLS as the only gate — no server action re-validates it — so `plusOnes`/`fullName`
  reached the DB with only `plus_ones >= 0` (no ceiling) as a backstop. A quota-exempt
  admin mistyping a large number could write `guests.plus_ones` in the millions,
  corrupting quota/headcount math.
- **Root cause 2 (gap-sweep #36).** `quick-add-parser.ts`'s `findPlusOnes` read *any*
  bare trailing integer under 8 digits as a plus-ones count (the "Naam 2" → +2
  convenience). "Adele 25" parsed as +25 (26 slots); "Blink 182" parsed as +182 and
  failed the `.max(50)` Zod cap, silently killing an otherwise-valid bulk-paste line.
- **Fix.**
  - New `addOnSpotSchema` (`src/features/guests/schemas.ts`, derived from `addGuestSchema`
    via `.pick()` rather than duplicating field definitions) — `DoorProvider.addOnSpot`
    now `safeParse`s the door-add payload before enqueueing; on failure it toasts and
    never queues the write.
  - New additive CHECK constraint `guests_plus_ones_upper_bound` (`plus_ones <= 50`),
    migration `20260714150000_guests_plus_ones_upper_bound.sql` — the existing
    `plus_ones >= 0` check is untouched. DB-level backstop for any insert path, not just
    the door.
  - `findPlusOnes`'s bare-trailing-number fallback is now capped at
    `MAX_BARE_TRAILING_PLUS_ONES = 9` — "Naam 2" still works, "Adele 25"/"Blink 182"/a
    mistyped "Anna 9999999" now leave the number in the name instead of misreading it as
    a party size. An explicit `+N`/`plus N` still works up to the Zod cap (50) regardless
    of the bare-number threshold.
- **Code-review finding, fixed before merge.** `addOnSpot` originally returned `void`.
  `AddOnSpot.tsx`'s `commit()` unconditionally showed the guest as "on the list" and
  cleared the input after calling it — even when the new Zod guard silently rejected the
  payload. Reachable: the parser's explicit `+N`/`pN` triggers have no upper bound of
  their own (unlike the bare-number fallback), so an exempt door user typing e.g.
  `"Anna p9999999"` could pass the UI's own quota gate and get a false success
  confirmation for a write that never happened. Fixed: `addOnSpot` now returns a boolean;
  `commit()` only marks success when it's `true`. New `AddOnSpot.test.tsx` (2 cases)
  covers both outcomes.
- **Tests.** `src/features/guests/schemas.test.ts` (7 cases), `AddOnSpot.test.tsx`
  (2 cases), 5 new `quick-add-parser.test.ts` cases, pgTAP
  `guests_plus_ones_upper_bound.test.sql` (50 accepted, 51 + a runaway value rejected
  with `23514`). Final state: Vitest 820, pgTAP 1003 (fresh `db reset`), lint clean,
  `tsc --noEmit` clean.
- **Unrelated but blocking discovery: `main` had a live migration timestamp collision.**
  PR #220 (`promote_guest_to_contact_widen_authz.sql`) merged with the same
  `20260714130000` timestamp PR #215 (`stripe_event_ordering_guard.sql`) had already
  claimed — `supabase db reset` failed outright for anyone on `main` (duplicate key on
  `schema_migrations`), which also blocks the prod-push flow's required `db reset && test
  db` step. Fixed in **PR #222** (merged first): renamed the later file to
  `20260714135000` (pure rename, no SQL change), verified 1000/1000 pgTAP passing after.
  PR #219 was rebased on top once #222 merged. **Lesson: the pre-push hook only checks
  the pushing branch against `main` at push time — it can't catch two branches that each
  independently pick a free slot and then merge close together.** Worth a periodic
  `git ls-files supabase/migrations | sort | uniq -d -w14` sweep, not just per-PR checks.
- **Live UI verification never completed** by the building session — the door route's
  client-side Suspense boundary never mounted content in the headless preview (no
  console/server errors, all chunks 200'd; read as a preview-harness/session quirk, not a
  code defect, but not conclusively ruled out). Max reviewed and approved merge directly
  ("Everything is okay! We can merge!") without a documented answer to the 5-question
  test handoff below — noted here in case the door screen needs a closer look later.

**Test handoff (if ever needed):**
`http://localhost:<port>/auth/dev-login?email=door@plusone.test&next=/app/door?add=1`
(or Deur tab → "+" add-on-the-spot). Questions:
1. Typing "Anna 9999999" (or any 2+ digit trailing number) no longer offers it as
   plus-ones — the number stays part of the preview name?
2. Typing "Naam 2" still shows a +2 preview and adds 2 plus-ones?
3. Typing "Naam +25" still works (explicit +N above the bare-number threshold)?
4. A normal add ("Juri Braakman +2 vip") still completes and appears in "Just added"?
5. No new console errors when opening the add-on-the-spot screen or committing an add?

---

## 2026-07-14 — `promote_guest_to_contact()` missing venue/role authorization (86ey9e880)

CONFIRMED cross-tenant PII-write defect, verified adversarially before this session (S2 +
13/7 re-verification). Branch `fix/86ey9e880-promote-guest-authz`. High-risk surface
(`SECURITY DEFINER` + RLS-adjacent authorization) → fresh-session `/code-review` +
`/security-review` required before merge — not run by the building session.

- **Root cause.** `promote_guest_to_contact()` (`20260625100100`) is `SECURITY DEFINER`
  with `set search_path=''` but had **no authorization predicate**. The inline comment
  claimed "RLS enforces membership" — false, because a DEFINER function bypasses RLS
  entirely. The read on `guests`/`events` succeeded for *any* non-removed guest UUID in
  *any* venue; the function then inserted a `contacts` row (PII) into that venue and
  back-linked `guests.contact_id`, reachable by any `authenticated` user via
  `GRANT ... TO authenticated`. The sister RPCs added later (`mark_guest_regular`
  `20260707150000`, `add_contacts_to_event` `20260707160000`) both gate on
  `has_venue_role(admin) or organizes_event_at_venue` — this one never got that gate when
  it was written first.
- **Fix.** New migration `20260714120000_promote_guest_to_contact_authz.sql` — same
  `create or replace function` body, with the missing predicate added (raises `42501`
  otherwise), mirroring `mark_guest_regular` exactly. No column/table changes, no
  expand-contract concerns.
- **Tests.** New `supabase/tests/database/promote_guest_to_contact.test.sql` (12 pgTAP
  assertions) — staff/finance denied (create nothing), admin promotes a name-only guest
  (fresh contact, `source = 'guest_list'`), an e-mail dedup guest links onto the existing
  contact instead of duplicating, already-linked guest is a no-op, a non-admin organizer of
  the guest's event may promote, non-existent guest raises `P0002`. Full suite green on a
  fresh `supabase db reset`: pgTAP 981 (was 969), Vitest 777, lint clean.
- **UX note, not fixed here.** The "Save as contact" CTA in
  `src/components/po/screens/guests/profile.tsx` is shown to any non-door-only role
  (`isDoorOnlyRole`), including plain `staff` — who could previously call the RPC
  successfully (the bug) and will now get a generic "no rights" toast (`mapMutationError`
  → `42501`, handled gracefully, no crash). Determining organizer-of-this-event client-side
  needs data `usePoIdentity` doesn't carry today; flagged as a follow-up rather than folded
  into this security fix.

---

## 2026-07-13 — Persisted door-cache never evicted → "app wordt trager" (86ey9e86f)

CONFIRMED root cause of the reported growth-slowdown that also hits prod. Three coupled
defects in the door's IndexedDB persistence, one PR (all touch the same persisted cache).
Branch `perf/door-cache-evict-86ey9e86f`. High-risk surface (door outbox/realtime) →
fresh-session `/code-review` before merge; live door check waiting on Max (handoff on the PR).

- **P-IDB1 — never-evicting cache.** `DoorQueryProvider` had no `dehydrateOptions`, so the
  whole client (every `['door', eventId]` + `['door-quota', eventId]` ever opened) was
  re-persisted with a fresh top-level timestamp on every boot → the client-level `maxAge`
  and 1-week `gcTime` never fired; 30+ month-old snapshots rode along forever. Fix: a per-
  query recency gate (`src/features/door/offline/dehydrate.ts` — `shouldDehydrateDoorQuery`)
  persists only door queries whose own `dataUpdatedAt` is within `maxAge`; an `onSuccess`
  boot-sweep (`isStaleDoorQuery`) removes stale, **unobserved** door queries from memory.
  Recency (not "single active event") is deliberate: the provider is a generic wrapper that
  doesn't know the active eventId, and an observer-count gate would drop the offline
  snapshot the moment the Deur tab unmounts (breaks #25). Buster bumped `v1`→`v2`.
- **P-IDB2 — whole-cache write per mutation (worse than filed).** `persistQueryClientSubscribe`
  fires on *every* cache event and does not throttle, and our custom `createIdbPersister`
  didn't either → a full `dehydrate()` + IDB write per check-in/realtime patch on the main
  thread. Fix: a trailing throttle in the persister (`PERSIST_THROTTLE_MS = 2000`, keep only
  the latest client; `removeClient` cancels a queued write so a discarded/sign-out-cleared
  cache can't be resurrected). Outbox durability is unaffected — it lives under a separate
  IDB key (`door-outbox`).
- **P-IDB7 — `select('*')` + unshown PII.** The snapshot pulled all 21 guest columns. Fix:
  narrow `GuestRow` to the 13 door-rendered columns (`queries.ts`), project the `select`, the
  realtime `payload.new` (`projectDoorGuest`, so a realtime row can't reintroduce PII), and
  the `addOnSpot` optimistic row. `email` (+ contact_id/source/request_link_id/updated_at/
  removed_at/anonymized_at/venue_id) leaves IndexedDB; `phone` stays (the door shows last-4,
  #27). No door code reads the dropped columns off a guest row; the gateway insert type is
  separate and untouched.
- **Measured (representative rows):** guest row 667→411 B (38% smaller); total blob 2.88 MB
  (30 events, unbounded) → 0.41 MB (≤7 events, week-bounded, stale evicted); boot-restore
  parse proxy 6.25→0.95 ms; rush writes ~50+ → ~5 (~10× fewer).
- **Tests:** +16 (`offline/dehydrate.test.ts` 9, `offline/persister.test.ts` 3 fake-timer
  throttle, `queries.test.ts` 4 projection/select-sync); `model.test.ts` fixture narrowed.
  Door suite 100 green, full Vitest 773 green, `tsc --noEmit` clean, lint clean.

## 2026-07-13 — Client-settable `comped` RPC bypass closed (86ey9e851)

Adversarial review (S3) confirmed a duplicate-review finding: `create_venue_with_owner`
and `set_venue_plan` both took a client-supplied `p_comped boolean` and were `GRANT`ed to
`authenticated`, so any logged-in user could call either RPC directly
(`POST /rest/v1/rpc/...`, bypassing the app entirely) and set their own venue's
subscription to `comped` — a status `apply_stripe_subscription_update`
(`20260706120000`/`130000`) explicitly never overwrites with webhook state. A
client-set `comped` was therefore a permanent, Stripe-unreconciled billing bypass.
Neither app call site ever sent an attacker-controlled `p_comped` (`createVenueAction`
never sent it at all; `setVenuePlanAction` only ever forwarded a locally-computed
`false`), so the app itself was not exploitable — the hole was reachable only via a
raw RPC call.

- **`supabase/migrations/20260713160000_remove_client_comped.sql`** — `p_comped`
  removed from both signatures entirely (decision #32: comped is manual-only, via the
  service-role SQL runbook `docs/stripe-setup.md`, never client-settable). Both RPCs
  now always insert `'trialing'`; `set_venue_plan`'s update branch was extended to also
  preserve an existing `'comped'` status (previously only active/past_due/canceled were
  protected from being overwritten), so a manually-comped venue survives a later
  onboarding plan change.
- **`src/features/billing/actions.ts`** — `setVenuePlanAction` no longer forwards
  `p_comped` (the RPC no longer accepts it).
- **pgTAP** (`supabase/tests/database/onboarding.test.sql`, plan 23→26): T8b/T11b prove
  a caller who still tries to pass `p_comped` is refused at function-resolution
  (`42883`), not silently ignored; T10b proves `set_venue_plan` can never produce
  `comped`. Full suite green on a fresh reset (48 files, 956 tests).
- Regenerated `src/lib/database.types.ts`. `pnpm lint` clean, `tsc --noEmit` clean,
  `pnpm vitest run` green (66 files, 757 tests). Smoke-tested `/app` boot post-fix
  (organizer dev-login → consent → Home, no console errors).
- High-risk surface (RLS-adjacent RPC + `authenticated` grants) → fresh-session
  `/security-review` still required before merge.

## 2026-07-13 — clickup-task skill + Stop-hook enforcement (workflow tooling, no ClickUp task)

Max asked for a skill that owns the ClickUp task lifecycle (planning → in progress →
complete) because sessions kept drifting from CLAUDE.md's bookkeeping rules — the 13/7
list-wide reconciliation being the visible cost. Root insight: prose instructions load at
session start but the failure moment (the end-of-session update) comes hours later, so the
fix is enforcement, not more prose.

- **`.claude/skills/clickup-task/SKILL.md`** — status flow with exact status strings (the
  done-status is `complete`, not "done"), the complete-gate (merged AND tested, an open PR
  is never complete, zero-work sessions revert to `to do`), the concurrency check as hard
  step 0, comment cadence (pickup / plan / end-of-session / final), task id in branch + PR
  title. Validated with two dry-run subagents against sandbox tasks (deleted after):
  planning path and mechanical-interrupted path both behaved correctly first try; their
  four ambiguity findings (zero-work ending, branch-name at planning-only pickup,
  description-vs-codebase conflicts, comment-vs-status-flip ordering) were folded back in.
- **`scripts/hooks/clickup-sync-check.mjs`** — Stop hook: the skill writes a gitignored
  marker (`.claude/clickup-session.json`, `{"tasks":[{"id","synced"}]}`) at pickup; the
  hook blocks ending the session while any entry is unsynced. `stop_hook_active` guards
  the retry loop; fail-open on unreadable stdin; corrupt marker blocks with repair
  instructions. Pipe-tested across all five scenarios.
- **`.claude/settings.json`** — `Stop` hook registered (initially permission-denied as
  config self-modification; applied after Max's explicit go later the same session).
  Existing PreToolUse migration-check hook untouched.
- **Session naming:** exact automatic naming is impossible today (`/rename` is
  user-only; SessionStart hooks fire before the task is known) — the skill instead
  prints a copy-paste-ready `/rename <task name>` line at pickup.

## 2026-07-13 — Bulk duplicate safeguard (86ey8xg4p, follow-up to 86ey8w7ek)

ClickUp `86ey8xg4p` — fresh-session review finding 7 on PR #182: the quick-add server-side
dupe-check shipped 12/7 (migration `20260712120000`) only covered quick-add. Bulk-paste and
"add to event" from contacts still ran the old client-only pattern (dedupe against whatever
page of `evGuests` had loaded), so the same 3–5x-duplication incident stayed possible there
on a big/not-yet-loaded event.

- **Scoped the actual gap first.** Contact-linked adds (`add_contact_to_event` /
  `add_contacts_to_event`, migrations `20260619000000`/`20260707160000`) already insert
  idempotently via the `(event_id, contact_id)` partial unique constraint — so the single
  `AddToEventSheet` (profile-sheets.tsx) and the contact-linked half of
  `BulkAddToEventSheet` were never actually at risk. The real gap was every path that ends
  in a plain `guests` insert keyed off a client-only "already on the list?" check: bulk-paste
  (`planBulkAdd`) and the **name-only** rows of `BulkAddToEventSheet`.
- **New RPC `find_event_guests_by_names(event_id, names[])`** (migration
  `20260713150000`) — set-based sibling of `find_event_guest_by_name`: one indexed,
  SECURITY INVOKER, soft-delete-aware lookup for many names at once (`distinct on` picks the
  oldest match per name, same "oldest wins" semantics). Capped at 200 names server-side as
  defense-in-depth; the client (`findEventGuestsByNames`, `src/features/po/queries.ts`)
  chunks to ≤100 per call. pgTAP `bulk_dupe_check.test.sql` (11 assertions: RPC shape,
  SECURITY INVOKER not DEFINER, multi-name hit/miss, case/whitespace fold, oldest-wins,
  soft-delete exclusion, RLS-scoped cross-staff denial, anon denied, empty/oversized-array
  no-op).
- **Bulk-paste** (`BulkPaste.confirm()`, `src/components/po/screens/guests/index.tsx`): the
  existing `byName` index from `evGuests` stays as the early UI hint (preview badges, the
  3-way dupe picker); at confirm time an authoritative batched RPC call resolves every
  pasted name against the full RLS-scoped list and `planBulkAdd` runs against THAT result,
  same layered hint-vs-authoritative pattern as quick-add. A failed RPC call (offline /
  deploy skew) falls back to the client hint and reports to Sentry via
  `captureUnexpectedError` — mirrors quick-add's fallback exactly.
- **`BulkAddToEventSheet`** (`bulk-add.tsx`): `submit()` is now async — before calling the
  bulk-add mutation, name-only people not already flagged `alreadyOn` by the client hint get
  one authoritative batched check, and confirmed matches are marked `alreadyOn` so the
  existing per-row outcome reporting (`added`/`already`/...) stays truthful. Contact-linked
  people are untouched (already safe).
- Regenerated `src/lib/database.types.ts` (`supabase gen types typescript --local`) — also
  picked up unrelated pre-existing drift (a stale `create_venue_with_owner` overload, the
  `graphql_public` schema block) that had never been regenerated after an earlier migration;
  left as-is rather than hand-editing the generated file.
- **Verification:** `supabase db reset` clean, pgTAP 953/953 green (48 files, incl. the new
  11), `tsc --noEmit` clean, `pnpm lint` clean, Vitest 757/757 green. **Could not verify live
  in the browser preview** — `/app` hydration stalled (streamed RSC content stuck in a
  hidden Suspense marker, no console/server errors) on a freshly-restarted server before any
  of the changed screens were reached; reproduced on two independent server instances, so
  it reads as a preview-harness limitation rather than a defect in this change. Flagging
  per CLAUDE.md rather than claiming UI verification that didn't happen — a manual retest of
  bulk-paste + "add to event" on a big guest list is still worth doing.

---

## 2026-07-12 — G4: Guests/Lijst-fusie + één persoonsmodel

ClickUp `86ey7e079` (UX/IA 8/7). Scope narrowed by two already-merged sibling efforts: the
guest-tier vocabulary was already unified (Review-K11 + FE-2, `tierRole()` in
`src/lib/po/tier.ts`), and the doorhost profile dead-end already had a reactive fallback
(M3, PR #173). This task closed the remaining gap — three parts, all in one PR, no
migration.

- **Merged the standalone `Lijst` screen into `GuestsTab`** (`src/components/po/screens/
  guests/index.tsx`). `Lijst` was a ~150-LOC wrapper duplicating what `GuestsTab` already
  did in single-event scope via the same shared `GuestCardList`/`GuestTable`/
  `BulkTierSheet`. `GuestsTab` now takes an optional `pinnedEventId` prop: when set (pushed
  from EventView's "Guest list" button), the scope-chip/regulars-filter row is hidden and a
  back button returns to the event — otherwise identical to the old `Lijst` UI.
  `app.tsx`'s `case 'lijst'` renders `<GuestsTab pinnedEventId={e.id} />` instead of the
  deleted `<Lijst>`; no route/URL changes (`routes.ts`'s `/app/events/:id/guests` is
  untouched, only the component behind it).
- **Dropped the standalone contact role chip** (`RoleChip` in `kit.tsx`, `ROLE_ICON` in
  `icon.tsx`) from the Contacts list and `ContactProfile` header — Max's call: remove it
  rather than back it with a new per-contact tier lookup. Real tier names still show
  per-event in the events list (`TierPill`, unaffected). `contactRoleToPo`/`Role`/
  `preferred_role` (the DB-level tier-resolution mechanism, `resolve_tier_for_contact`) are
  untouched — that's a functional matcher, not the display concept being removed.
- **Made the person-profile role-aware for doorhost** (structural fix for K-8, building on
  M3's reactive fallback): new `isDoorOnlyRole()` (`src/features/auth/roles.ts`) drives the
  `ContactProfile` actions-block branching, checked BEFORE `isContact`/`restricted` so it
  applies uniformly — including to a not-yet-linked guest, which previously still showed a
  "Save as contact" CTA to a doorhost. Header/stats/events/timeline stay; edit/promote/
  add-to-event/star all disappear.
- **Gotcha found via live testing, not planning:** the first `isDoorOnlyRole` design
  required EVERY held role to be exactly `doorhost` (multi-role-per-user, CLAUDE.md #8 —
  admin/finance combos should keep the full profile). Live-testing against the seed
  `door@plusone.test` user (`Lisa van den Berg`) showed the fix never fired: the seed
  persona holds `{doorhost, staff}`, not `{doorhost}` alone. Corrected to mirror the actual
  `contacts_select` RLS boundary instead of a bare role-purity check: `roles.includes(
  'doorhost') && !roles.includes('admin') && !roles.includes('finance')` — `staff` doesn't
  grant contacts access either, so `{doorhost, staff}` now correctly qualifies.
- **Housekeeping:** this worktree was 7 commits behind `origin/main` at session start (PRs
  up to #186, the G1 canonical-URL nav rework) — fast-forwarded and re-diffed every file
  this task touches against the new HEAD before planning (none of #186/#183/#180/#182 etc.
  actually collided with this task's files; confirmed no open PR and no dirty sibling
  worktree touched the same files either).
- Verification: lint clean, zero TypeScript errors, 726/726 vitest green (63 files, +7 new
  `isDoorOnlyRole` cases in `roles.test.ts`). Live: one full successful manual pass
  confirmed the merged `GuestsTab`/pinned mode and the `ContactProfile` data pipeline
  render correctly against real local Supabase data (pre-fix, showing the old restricted-
  note text as expected) — but the session's dev machine was under heavy resource
  contention (45+ concurrent worktree sessions) and the preview browser's hydration stalled
  on every subsequent attempt (server-side confirmed healthy and fast via direct `curl`
  throughout — this was a browser/CDP starvation issue, not an app bug). Could not get a
  final live screenshot of the corrected doorhost-reduced-profile in this session; the fix
  is covered by unit tests that directly encode the real seed role combination.

---

## 2026-07-12 — UX/IA G3: Promotion hub (Promo + Links + Influencers regrouped) + M14

Built per the pre-written plan (`promotion-regroup-plan-claude-code.md`, now stamped
"gebouwd" — it sat uncommitted in sibling worktree `interesting-rhodes-e3fe08` and is
committed with this PR). G1 had landed (#186); M14 had not, so per the plan's own logic
M14 rode along instead of being built twice. ClickUp `86ey7e03j`.

- **One Promotion area** at `/app/promotion` (`src/components/po/screens/promotion/`):
  hub with Seg tabs **Overview** (old promo.tsx minus its per-event section — the funnel
  card now links through to Per event) / **Per event** (old links.tsx + event picker +
  **M14: checked-in on every link card** via `usePoLinkFunnel`, the same
  `event_link_funnel` RPC the Overview reads) / **Roster** (old influencers.tsx).
  Old files (`promo.tsx` 627, `links.tsx` 659, `influencers.tsx` 320,
  `promo-create-link.tsx` 300) deleted; every new file well under the 800-LOC guideline.
- **Create-link-flow deduplicated (G3-0):** one `CreateLinkFlow` (form → done-screen with
  explicit copy step, the plan's recommended UX) behind both the Overview CTA and the
  per-event links screen; `LinkSheet` is edit-only now. The third near-identical tier
  picker (approvals `AssignSheet`) and the two link ones fold into a new **kit primitive
  `TierPicker`** (radio rows, color dot + capacity hint; surface copy stays at call sites).
- **Gating decoupled per vraag 6:** the hub nav item + deep link are venue-member-only
  (`statsVenues`, i.e. admin/finance reporting access; direct hit without access = plain
  no-access state, M3-style role-hide). The standalone `/app/events/[id]/links`
  (ScreenName `'links'`) deliberately survives OUTSIDE the hub so an external organizer
  keeps managing his own event's links from EventView/EventEdit. The More-hub
  Influencers row (admin-only, duplicated what Promotion already offers since
  admin ⊂ canViewStats) is removed; Promo row + Stats cross-link now push `'promotion'`.
- **Routing:** ScreenNames `'promo'`/`'influencers'` replaced by `'promotion'`
  (`props.tab: overview|events|roster`, `'overview'` is the URL-less default like
  aanvragen's `'landing'`); `/app/promo` and `/app/influencers` parse as legacy aliases
  to the matching hub tab (round-trip + alias tests in `routes.test.ts`).
- **Verification:** tsc + lint clean; vitest 727 green (5 billing/realtime timeouts under
  full-suite load pass in isolation — pre-existing flake). Live preview as admin: hub +
  all three tabs render, Overview live data, per-event cards show "… · 0 in" (M14) and
  capacity, CreateLinkFlow renders with who-chips + rich TierPicker; staff login confirmed
  role-hide (no Promotion nav item) and the server action's rights error surfaces
  gracefully in the sheet. **Caveat:** mid-session a concurrent session shared the preview
  browser profile + local DB (cookie flips admin→staff→manager, a DB reset that revived
  the consent gate, minutes-long compiles), so create-flow completion, the Roster tab
  body, the standalone links route and the organizer flow were NOT click-verified live —
  they're the moved/shared code paths above and are covered in the per-screen test
  handoff. Lesson repeated: **check who's using the stack before a test pass** (the
  "one DB owner" rule exists for exactly this).
- **Follow-up (same day, Max's test pass):** persistent "+ New link" moved into the hub
  header (was only reachable from the Per-event tab) + `CreateLinkFlow` gained an optional
  event-switcher (`EventPicker`, shown when more than one venue event is passed) so the
  flow isn't locked to wherever it was opened — the standalone organizer route still gets
  no switcher (single event, unchanged). **Merge conflict landing this:** `main` had
  independently built M14 in the same window (UX/IA M10+M11+M13+M14 polish, PR #193) —
  their approach is better: `checkedInHeads` lives directly on `PoRequestLink`
  (`fetchRequestLinks` in `queries.ts` now tallies it from the same `guests` read that
  already computes `approvedHeads`), one query instead of G3's separate
  `usePoLinkFunnel` merge. Adopted main's data layer, dropped the redundant funnel fetch
  and the `checkedIn` prop plumbing from `event-links.tsx` — same UI result, one fewer
  round trip. i18n `links.stats` conflict resolved the same way (single interpolated
  string with `{checkedIn}`, not a conditionally-appended second key).

---

## 2026-07-13 — MFA enrollment: same-device deep link + secret copy

Follow-up flagged during code review of PR #187 ("fix(auth): soften MFA nudge to ask-first
onboarding", UX/IA 9/7, ClickUp 86ey7qkkb) and repeated in PR #196's changelog entry below (both
list it under "not fixed here"), PR [#197](https://github.com/Max-Seffelaar/PlusOne/pull/197),
branch `claude/upbeat-moore-00b4dc`. Rebased onto #187/#196's ask-first two-step redesign after
those landed mid-session (real conflict in `MfaEnrollCard.tsx`, resolved by moving the deep-link
+ copy-button JSX into the new step-2 block — no logic from either side dropped).

`MfaEnrollCard.tsx`'s step-2 enroll screen showed a QR code and a manual secret as a `text-xs`
footnote with no copy button — impractical for a mobile-first PWA: you can't scan a QR with the
same device you're enrolling on, and Supabase's `mfa.enroll()` response already carries
`data.totp.uri` (an `otpauth://` deep link) that the component discarded entirely.

- Added an **"Open in authenticator app"** link (`<a href={uri}>`, `btn-dark flex w-full
  items-center justify-center`) rendered above the manual secret — mobile OSes route
  `otpauth://` straight to an installed authenticator app for one-tap same-device enrollment.
  Note the plain `<a>` needed `flex`+`w-full` explicitly: `.btn-dark` has no `display` rule, and
  an anchor's default `display: inline` ignores `width: 100%` (a `<button>` gets away with just
  `w-full` because buttons default to `inline-block`) — no prior `<a>`-as-button usage existed
  in the codebase to copy from.
- Added a **copy-to-clipboard** button next to the manual secret, reusing the codebase's existing
  guarded pattern (feature-detect `navigator.clipboard` + try/catch, matching
  `links.tsx`/`promo-create-link.tsx`) rather than gating on `isNativeShell()` — that seam is
  specifically for the billing/store-tax rule (#32), not a general platform guard, so the
  clipboard code follows its own established convention instead.
- QR code stays visible (desktop still needs it). Copy verb-first/sentence-case/no-period
  ("Copy" → "Copied!"), matching `tone-of-voice.md` and the existing `qrCopy`/`qrCopied` keys.
- New `MfaEnrollCard.test.tsx` (3 tests): deep-link href from the mocked enroll response, copy
  success via a mocked `navigator.clipboard.writeText`, and the clipboard-blocked fallback
  (no crash, stays on "Copy"). No `@testing-library/user-event` in this repo — used
  `fireEvent`+`act` to match the existing test style (`CheckInList.test.tsx`).

**Gotcha hit mid-session:** this worktree's `node_modules` was missing `@sentry/nextjs` (declared
in `package.json`, presumably added by the Sentry PR #155 merge, but never installed here) —
broke both `tsc --noEmit` (12 unrelated `TS2307` errors) and `pnpm dev` (`next.config.js` require
crash). `pnpm install` fixed it; unrelated to this change but blocked live preview until resolved.

**Live-verified** via local dev-login (`manager@plusone.test` → consent → `/mfa/enroll`):
accessibility snapshot + `preview_inspect` confirmed the deep link's real `otpauth://` URI, the
full-width button layout, and that clicking Copy in a permission-denied automated-browser context
degrades silently (matches the guarded-fallback test). `preview_screenshot` itself was flaky in
this session (timed out repeatedly) — verification relied on snapshot/inspect/eval instead, per
[[recharts-and-preview]]'s known quirk.

**Verification:** `pnpm exec vitest run src/features/auth` 53/53 green, `pnpm exec eslint` clean,
`pnpm exec tsc --noEmit` clean on touched files.

---

## 2026-07-13 — PoMfaSheet: ask before enrolling MFA (UX/IA 9/7 follow-up)

Task [86ey7qkkb](https://app.clickup.com/t/86ey7qkkb) comment (flagged during PR #187 review as
out of scope there — PR #187's own changelog entry below lists it under "not fixed here"), PR
[#196](https://github.com/Max-Seffelaar/PlusOne/pull/196), branch
`claude/gifted-tereshkova-e77b12`. Merged right after #187.

`PoMfaSheet` (`src/components/po/mfa-gate.tsx`) — the Profile "Enable MFA" self-service sheet
and the `useMfaGate` step-up sheet used by `team.tsx`/`quota.tsx` — auto-called
`supabase.auth.mfa.enroll()` in a `useEffect` as soon as it mounted whenever the caller had no
verified TOTP factor, creating an unverified factor before the user made any choice inside the
sheet. Same bug PR #187 fixed in `MfaEnrollCard`.

- New `ask` phase: explanation + "Set up now" CTA. `enroll()` (plus the stray-unverified-factor
  cleanup, moved out of the mount effect) only fires from that explicit click, guarded against
  double-fire with an in-flight ref — same shape as PR #187's `startEnrollment`.
- Dropped the stale header comment claiming a blanket AAL2 gate/middleware force-step-up (that
  policy was removed by migration `20260702120000_mfa_fully_optional`); replaced with an accurate
  description of the sheet's two real callers.
- Considered rendering `MfaEnrollCard` directly instead of duplicating the enroll UI — didn't:
  `MfaEnrollCard` is a full-page redirect-based flow with its own skip/snooze actions, while
  `PoMfaSheet` is `Sheet`/kit-styled and also serves the `challenge` phase (existing verified
  factor) for `useMfaGate`. Direct reuse would've broken one of the two.
- Verified live against the local Supabase stack (`manager@plusone.test`, Profile → Security →
  "Turn on"): zero `auth/v1/factors` calls until "Set up now" is clicked; clicking it fires the
  cleanup DELETE + enroll POST and shows the QR/code step; "Cancel" unenrolls and returns to OFF.

**Flagged, not fixed here:** while verifying, found a genuine pre-existing gap between
CLAUDE.md's Auth section ("no AAL2 requirement in RLS anywhere") and actual code —
`venue_memberships_delete`'s RLS policy still enforces AAL2 (only the create/role-update
policies dropped `is_aal2()` in `20260702120000_mfa_fully_optional`), and `removeMemberAction`
(`venues/actions.ts`) plus `useMfaGate`'s real callers depend on that still-live check. Left a
comment on 86ey7qkkb; needs its own decision (drop the RLS check for consistency, or correct the
CLAUDE.md claim).

---

## 2026-07-12 — UX/IA 9/7: MFA-nudge softened to ask-first (86ey7qkkb)

MFA stays fully optional (#20 unchanged) — only the presentation softened, per Max's
2026-07-09 decision. Three changes, all in one PR:

- **A · Two-step enroll screen** ([MfaEnrollCard.tsx](../src/features/auth/components/MfaEnrollCard.tsx)):
  step 1 is the explanation + three actions ("Set up now (2 min)" / "Ask me in 7 days" /
  "Don't ask again") with **no QR visible**. `supabase.auth.mfa.enroll()` moved off the mount
  `useEffect` onto the "Set up now" click — no more half-created factors for someone who only
  glanced at the screen.
- **B · Order fix** ([guards.ts](../src/lib/auth/guards.ts) `requireAppAccess`): `requireConsent`
  now runs before `recommendMfaIfDue` (was reversed). **Correction (fresh-session review):**
  `requireAppAccess` turned out to have zero live call sites — the real `/app` guard
  (`src/app/app/layout.tsx`) already ran consent-before-MFA inline, unchanged, so this fix had
  no live effect. Kept as the documented order for `requireAppAccess` (reserved for a future
  route), with an explicit comment on both sides noting the duplication.
- **C · Not on session one:** `recommendMfaIfDue` returns early until 24h after the account's
  first real session, no migration needed. Self-service enroll via Profile is unaffected.

Landed on top of 8 PRs that merged to `main` mid-session (G1 canonical-nav refactor moved the
`/app` guard call from `src/app/app/page.tsx` into `src/app/app/layout.tsx` — confirmed that
call site already ran consent-before-MFA, so no additional fix needed there). Rebased with a
stash/fast-forward/pop; the only textual overlap was CLAUDE.md, auto-merged cleanly.

New unit tests (`src/lib/auth/guards.test.ts`, 6 cases) cover every due-logic branch: young
account, >24h no factor (redirects), snoozed, snoozed-forever, verified factor, role doesn't
require MFA. Full suite green post-rebase (728 tests), typecheck clean, lint clean.

Manually verified live against the local stack: dev-logged in as `finance@plusone.test`
(fresh seed account, no TOTP factor) — landed straight on `/app` with no MFA redirect,
confirming the 24h skip. Navigating directly to `/mfa/enroll` showed step 1 with no QR;
clicking "Set up now" produced a real QR + manual secret + 6-digit verify form via Supabase's
local GoTrue. Note: the shared local Supabase stack was mid-reset by another concurrent
session during testing (containers cycling, tables briefly absent) — waited it out rather
than racing it, per the "one DB owner" rule.

**Fresh-session `/code-review` + `/security-review` (high-risk surface gate, `guards.ts`
touches auth/middleware) — 0 blockers, 4 findings, all fixed before merge:**

- **Should-fix — wrong anchor for "not on session one":** `user.created_at` is stamped when
  the invite is *sent* (`inviteUserByEmail` creates the auth row immediately), not on first
  login — so a crew member invited Monday and accepting Thursday still got nudged on their
  very first real session, defeating the point of C. Re-anchored `recommendMfaIfDue` on
  `user_profiles.terms_accepted_at` instead (fetched in the same query as the snooze check, no
  extra round trip); null (not yet consented) fails open. Not a regression — main nudged
  everyone unconditionally — but the fix only worked for same-day accepters before this.
- **Should-fix — B was dead code:** see the correction on bullet B above; comments added on
  both `requireAppAccess` and `layout.tsx` cross-referencing each other so this doesn't
  surprise the next reader.
- **Minor bug — double-click race:** removing the old mount-`useEffect`'s `started` ref
  guard (needed for A) left `startEnrollment` re-entrant — a fast double-click on "Set up
  now", or "Try again" while a slow prior attempt was still in flight, could fire two
  concurrent `enroll()` calls; worst case the user scans the first QR while state settles on
  the second factor's ID, and verification fails with a confusing "invalid code". Fixed with
  an `enrollInFlight` ref guard (a state check alone can't catch same-tick clicks).
- **Note, pre-existing, not fixed here:** `/mfa/*` is only `requireUser`-gated, not
  consent-gated, so a deep link could let an un-consented user enroll/snooze before accepting
  terms. Predates this PR; flagged for a follow-up, not blocking.

Unit tests updated to match the new anchor (`terms_accepted_at` via the mocked query instead
of `ctx.user.created_at`), plus a new case for the null/fail-open branch — 7 cases, all green.

**Second-pass review (7-lens workflow, 63 agents, adversarial-verified) — 0 blockers, 10
verified findings, 4 fixed before merge, rest pre-existing/flagged:**

- **UI regression — silent error on step 1:** the new step-1 branch rendered no error
  paragraph, so a failed `snoozeMfaAction` (e.g. "Ask me in 7 days" clicked before ever
  reaching step 2) set `error` but showed nothing — the button just reset and the user assumed
  it saved. Added the error paragraph to the step-1 branch too.
- **3 a11y/copy regressions, all new in this PR (all CONFIRMED by 2 independent verifiers):**
  focus dropped to `document.body` when "Set up now" unmounted itself (WCAG 2.4.3) — fixed by
  focusing a `tabIndex={-1}` step-2 container on entry; "Loading QR code…" had no
  `role="status"` for screen readers (WCAG 4.1.3) — added; "Set up now — takes 2 minutes" broke
  `tone-of-voice.md`'s no-em-dash rule — reworded to "Set up now (2 min)".
- **Mutation-proven test gaps in `guards.test.ts`:** the "covers every due-logic branch" claim
  above was inaccurate — deleting the `Number.isNaN(sinceAcceptedMs) ||` guard, the literal
  `raw === 'infinity'` check, or omitting the no-`ctx` production codepath (the only codepath
  `layout.tsx` actually calls) all left the suite green. Added 3 tests: an unparseable
  (non-null) `terms_accepted_at` string, `mfa_snooze_until: 'infinity'` (what the e2e smoke
  literally writes), and a no-`ctx` case that exercises the internal `getAuthContext()`
  fallback. 10 cases now.
- **Spec overstatement:** "the consent gate always runs before the MFA recommendation" isn't
  globally enforced — only true on the `/app` path; `/mfa/enroll` itself has no consent check
  (same root as the pre-existing note above). Scoped the claim in the spec/CLAUDE.md wording to
  "on the `/app` path" rather than fixing the gap here — the actual fix is the spun-off task.
- **Not fixed (pre-existing, flagged as follow-ups, not this PR's scope):** same-device QR
  enrollment is impractical on mobile (no `otpauth://` deep link, no copy button for the
  manual secret — Supabase returns `data.totp.uri` but the card discards it); `PoMfaSheet`
  (Profile self-service) still auto-enrolls on mount with a stale AAL2 comment, the exact
  pattern this PR removed elsewhere; smaller items (Android back-button leaves `/mfa` entirely
  instead of returning to step 1, missing `100dvh`/safe-area on the `/mfa` layout, "Don't ask
  again"'s tap target under 44px, a cross-tab race between the card's and sheet's unverified-
  factor cleanup loops).

729 tests green (post these fixes), typecheck clean, lint clean.

---

## 2026-07-12 — M6: event-stats to event-home, Analytics event-first, LOG→Audit

UX/IA 8/7 task M6 ([86ey7dzmp](https://app.clickup.com/t/9018914367/86ey7dzmp), `ux-ia-audit-claude-code.md`
§2-E/§5.2/§7-Q4), PR [#188](https://github.com/Max-Seffelaar/PlusOne/pull/188), branch
`claude/affectionate-shannon-602e85`.

§2-E had flagged the same per-event stats rendered on three surfaces (EventView's Activity
section, Analytics' per-event drill-down, the cockpit) via two separate data paths for
tier/member numbers — `fetchPoEventActivityStats` (`event_tier_stats`/`event_user_additions`
RPCs, raw rows) vs `fetchEventStats`+`po-adapter.ts` (same two RPCs plus summary/perQuarter,
adapted view-models). Max's 8/7 decision: EventView/PastEvent's Activity section is the
canonical "event-home"; Analytics becomes event-first and reuses the *same* component
(K-10-les — no second render).

- New `src/components/po/screens/events/stats-panel.tsx` (`EventStatsPanel`) — KPIs
  (peak/no-shows), arrivals chart, by-tier, by-member. Moved verbatim out of `stats.tsx`'s
  old per-event JSX block (richer than the old Activity tables, which it replaces).
- `usePoEventActivity` (`hooks.ts`) repurposed to wrap `fetchEventStats` +
  `eventKpis`/`toPerKwartier`/`toPerTier`/`toPerUser` instead of the narrower
  `fetchPoEventActivityStats` (now deleted from `queries.ts`, along with `EventActivityStats`).
  One fetch, one shape (`EventStatsDetail`), used by both surfaces.
- `EventActivitySection` (`past.tsx`, shared by EventView + PastEvent): the inline audit-log
  list is gone — a "View activity" button does `nav.push('audit', { id: eventId })`, landing
  on the Audit screen pre-filtered to the event (`AuditLog`'s `eventId` prop already supported
  this; the wiring in `app.tsx` predates this PR).
- `stats.tsx` (Analytics): dropped the venue-wide KPI hero cards (`fetchVenueStats`/`venueKpis`)
  for a static "venue trends coming later" note; the per-event block is now just
  `<EventStatsPanel eventId={selectedEvent.id} />`. The manual refresh button now invalidates
  `poKeys.eventActivity(eventId)` via `useQueryClient` instead of re-running the removed
  venue-stats effect.
- i18n: `events.ts` lost the `activityPerTier`/`activityPerMember`/`activityLog`/… keys, gained
  `viewActivity`; `analytics.ts` lost the venue-KPI keys, gained `venueTrendsLater`.

**Merge conflict, not a rebase nit:** `origin/main` had moved on with PR #186 (G1 — canonical
nav, URL-based `/app` deep-linking, `context.tsx`/`routes.ts` rewrite) and PR #183 (event-detail
fixes from the 10/7 test round) while this branch was in flight. #183 had *paginated* the exact
inline log this task deletes (`FEED_PAGE`/`Show more`, ClickUp 86ey8w79x) — a real conflict in
`past.tsx` and `events.ts`, resolved in favor of the M6 decision (removal supersedes the
paging band-aid; #183's other changes — stat-tile relabel, quota-request badge, link-funnel
row, error-throwing fetches — are unrelated files/regions and merged clean). G1's route table
already generalized exactly the `nav.push('audit', { id })` pattern used here
(`screenPath`/`parseAppUrl` in `routes.ts`) — no adjustment needed, `routes.test.ts` covers the
round-trip.

**Verification:** `pnpm lint` clean, `tsc --noEmit` 0 errors, `vitest run` 722/722 green
(post-merge; was 671 pre-merge, +51 from G1/#183's own new tests). **Live browser verification
NOT completed** — the preview harness's `/app/[[...segments]]` bundle (~6500 modules) never
finished loading across 4 separate fresh dev-server attempts in this session (`main-app.js` +
the segments `page.js` stayed pending indefinitely in the network log while every smaller
chunk — CSS, webpack runtime, the lighter `/consent`/`/mfa/enroll` page bundles — loaded and
rendered fine). No compile error, no console error, no server-side error surfaced; looked like
a stalled large-chunk transfer specific to this session's preview environment, not a code
defect. PR is up with this caveat explicit in the test-plan checklist; needs a manual pass
before merge.

---

## 2026-07-12 — G2: deur-consolidatie + cockpit door-parity (M16, Refuse/undo-refusal/Tasks)

ClickUp `86ey7dzzg`. Two parts, both done in one session (see plan approved before implementation):

**Route consolidation + M16.** `/door/[eventId]` no longer mounts a second `DoorShell`
component tree (own `PhoneFrame` + a mock "9:41" status bar shipped to production) — it now
mounts the identical `PoDoorTab` the `/app` Door tab already used, via a new thin
`src/features/door/components/DoorRoute.tsx`. `DoorShell.tsx` deleted; `PhoneFrame`/`StatusBar`
(only used by it) removed from `shell.tsx`, plus the now-orphaned `.po-stage` CSS and
`shared.shell.*`/`door.tabCheckin`/`tabTasks`/`back` i18n keys. Verified server-side via direct
curl against the dev server (session cookie + `/door/<seed-event-id>`): 200, no `9:41`/`po-stage`
in the rendered HTML, `Check-in` (the shared segmented control's copy) present.

**Cockpit door-parity (decision "vraag 3").** Scope narrowed with Max at the start of the
session: void/checkout already worked in the cockpit (shipped 21–23/6, predates the 8/7 audit)
and "+ Add guest" → `QuickAdd` already covers add-on-spot — so "reverse-check-in" = undoing a
**refusal**, and the real gap was Refuse + undo-refusal + Tasks (guest notes/priority + ack),
all missing from `EventDayCockpit.tsx`. Added, all online (no outbox, matching the cockpit's
existing check-in/out mutations — `usePoRefuseGuest`/`usePoUndoRefusal`/`usePoAckNote` in
`mutations.ts`, same `supabaseGateway(getDoorClient())` pattern):
- A guest row's ✗ slot, when the guest isn't inside, is now "Refuse" (was a dead click —
  `onVoidClick` early-returned for a non-checked-in guest) → `CockpitRefuseModal.tsx` (mandatory
  reason, reuses `t.door.refuse*` copy).
- A 4th "Refused" segment (only shown once non-empty) lists refused guests with an "Undo" button.
  `cockpit.ts`'s `filterCockpit`/`cockpitCounts` extended for the `'refused'` `StatusFilter`.
- `CockpitTasksCard.tsx` — desktop equivalent of the door's `Taken.tsx`, in the right column.
  Needed `guests.note_acknowledged_at` added to `fetchGuests`'s select + `Guest.noteAcknowledged`
  on the adapter (`note_acknowledged_by`/a resolved "Done by" name deliberately skipped — scope
  trim, not a data gap).
- A priority-flag icon added next to the guest name in the main list row (previously invisible
  in the cockpit entirely).

Verified: `pnpm type-check` + `pnpm lint` clean; full `vitest run` 724/724 (extended
`cockpit.test.ts` for the new filter/count branch, `adapters.test.ts` for `noteAcknowledged`).
Live interactive browser verification (click-through) could **not** be completed this session —
the preview browser tool hung mid-hydration on every route, including on an unmodified baseline
(confirmed via a stash A/B: reverted to `origin/main` code on a fresh dev-server instance,
identical hang) — an environment/tooling issue, not a defect introduced here. Server-side
rendering was independently confirmed clean via direct `curl` against the dev server for both
changed routes. **Follow-up needed: a real click-through per the per-screen test handoff below
before this is considered fully verified** — not done as part of this session.

Files: see the plan file structure — `mutations.ts`/`queries.ts`/`adapters.ts`/`lib/po/types.ts`
(+noteAcknowledged plumbing), `cockpit.ts`/`cockpit.test.ts`, `EventDayCockpit.tsx`,
`CockpitTasksCard.tsx` + `CockpitRefuseModal.tsx` (new), `DoorRoute.tsx` (new),
`app/door/[eventId]/page.tsx`, `shell.tsx`, i18n surfaces (`door.ts`/`cockpit.ts`/`shared.ts`).
No migration — every write reuses an existing `DoorGateway` call already covered by mobile's
RLS/audit-trigger path.

---

## 2026-07-12 — G1 follow-up: door sub-nav still hit the server (fresh-eyes re-review)

A second fresh-session review found the G1 layout split (below) did NOT actually fix the
offline invariant it claimed to: a live network trace showed `GET .../door?guest=…&_rsc=…`
firing on every guest-overlay open. Root cause — confirmed against the installed
`next@15.5.19` — Next's client router keys cached page data by the FULL search string on a
dynamic route regardless of whether `page.tsx` reads `searchParams`; the optimization that
would avoid this needs a `loading.tsx`, which this route doesn't have. So query-param
navigation via `router.push`/`replace` always hits the server here, not just when
`searchParams` is read server-side as the first pass assumed.

- **`src/components/po/app.tsx`** — door sub-state (guest/add overlay, Deur↔Taken segment,
  event override) now goes through raw `window.history.pushState`/`replaceState`
  (`pushDoorState`/`replaceDoorState`), bypassing `router.push`/`replace` entirely — no
  server round-trip. Since Next's `usePathname`/`useSearchParams` don't reactively track
  raw History API calls, a local `doorOverride` state shadows the URL-derived door fields;
  an effect keyed on `[pathname, searchParams]` clears it whenever Next's own hooks report
  a real change (a genuine router-driven nav, or a browser back/forward popstate, which
  Next resyncs on its own regardless of who pushed the entry) so the URL becomes
  authoritative again. `routes.ts`'s URL shapes are unchanged. The desktop cockpit is
  untouched (online-only by design, never sets this override).
- Two bugs found in the FIRST round's fix code, both corrected: (1) the cold-deep-link
  `back()`/`closeOverlay` fallback pushed the parent path AND latched `hasHistoryRef`,
  so a second back() popped straight back into the original (now-orphaned) deep-linked
  screen instead of climbing further — child↔parent oscillation, overlay close going dead
  after one cycle. Fixed: the fallback now `router.replace`s without latching, so repeated
  cold-back keeps ascending. (2) `resolvedDoorId`'s validation against `doorCandidates`
  (added in the first round) checked a query that mutations never invalidated — "Check-in"
  on a just-created/just-started event was wrongly rejected until a full reload. Fixed:
  `poKeys.doorCandidates` is now invalidated alongside `poKeys.events` in every event
  mutation (`src/features/po/mutations.ts`), plus a one-shot refetch in `app.tsx` when a
  requested id isn't found in the currently-loaded list (covers changes made by other
  clients, not just this one).
- Also from this pass: the animation `key` was a bumped `useState`+`useEffect` pair,
  meaning every navigation mounted the new screen once and then remounted it again one
  tick later under a bumped key — screen mount effects ran twice per nav. Replaced with a
  key derived directly from `pathname`/`searchParams`.
- **Verification:** confirmed the `_rsc` fetch live in the preview BEFORE this fix (network
  log, guest-overlay open); typecheck, lint, and the full suite (721/722 — same pre-existing
  phantom-path failure pending `git add`) all green after. Could NOT re-confirm the fix live
  afterward — the preview environment stopped rendering the mobile shell (`isMobile` stuck
  false regardless of confirmed-correct `matchMedia`/viewport state, across multiple fresh
  server instances) partway through this session, an apparent tooling/harness issue
  unrelated to this change (`use-viewport.ts` itself is untouched). Flagging honestly rather
  than claiming a live re-verification that didn't actually happen — the fix is verified by
  code-level reasoning (traced the History API/popstate/Next-resync mechanics against
  `next@15.5.19`'s documented behavior) plus the type/lint/test suite, not by a second
  successful click-through.

---

## 2026-07-12 — UX/IA 8/7 G1: canonical nav + real `/app` deep-linking (86ey7e024)

Replaced the `po` app's in-memory nav stack (`StackEntry[]` + a hand-rolled browser-history
bridge in the now-deleted `history-nav.ts` + a sessionStorage restore-after-refresh hack)
with real, bookmarkable per-screen URLs — every one of the 28 screens, every tab, and the
door's overlay/segment sub-state now lives on its own path/query string instead of behind
one static `/app`.

- **`src/components/po/routes.ts`** (new) — the canonical URL scheme: `screenPath`/
  `tabPath`/`doorPath` build a URL for a `nav.push`/`replace` call, `parseAppUrl` is the
  inverse (used by `app.tsx` on every render to derive the active screen from
  `usePathname()`/`useSearchParams()`). `routes.test.ts` round-trips every screen.
- **`src/app/app/page.tsx` → `src/app/app/[[...segments]]/page.tsx`** — a catch-all route so
  every screen's path actually resolves. `context.tsx`'s `StackEntry`/nav-state
  sessionStorage helpers were deleted (the URL itself is now the persisted state) and
  `Nav`'s `push`/`replace`/`back`/`setTab`/`openDoor` in `app.tsx` are thin `useRouter()`
  wrappers around `routes.ts`.
- **Architecture split (fresh-session `/code-review high` before merge — required per
  CLAUDE.md's review-gate for auth-adjacent surfaces):** the review's three HIGH findings
  shared one root cause — the original single `page.tsx` read the `searchParams` prop
  itself (for the consent/MFA `next=` round-trip), which forces Next.js to dynamically
  re-render and re-fetch over the network on every query-string-only navigation (door
  overlay open/close, event picks). That remounted `PoLiveProvider`'s QueryClient on every
  screen change AND made the door overlay's open/close fail outright when offline (RSC
  fetch → hard navigation → wrong service-worker shell), breaking the door's offline
  invariant (#25). Fix: split into **`src/app/app/layout.tsx`** (identity/venue resolution,
  onboarding/consent/MFA gates, `PoLiveProvider` — runs once, stays mounted across
  navigations, never reads `searchParams` by Next.js design) + a trivial `page.tsx` that
  does zero server data work. Trade-off, documented in the layout: since it sits above the
  dynamic segment it can't reconstruct the exact deep link for the one-time consent/MFA
  `next=` redirect, so that redirect targets bare `/app` instead of the requested screen —
  acceptable for a gate that fires once, on first login only. Shell display data
  (`statsAccess`/`myVenues`/etc.) now flows layout → `page.tsx` via a new client context,
  `src/components/po/app-shell-data.tsx`, rather than as page props.
- **Other findings fixed in the same pass:** `navKeyForScreen`'s guest/pastevent sidebar
  highlight (the eventId-presence heuristic didn't correlate with actual origin — dropped
  it, `guest` always maps to `guests` now); `back()`/`canGoBack`/the door overlay's close
  button no-op'd or could leave the app on a cold deep link (fresh tab, bookmark, the
  consent/MFA round-trip) — added a `parentPathFor` fallback + a `hasHistoryRef` mount-scoped
  flag so `back()` only trusts `router.back()` once this mount has actually pushed
  something; `parseAppUrl`/`screenPath` round-trip gaps for id-less `allowance` (now a
  top-level `/app/allowance` — it self-picks its event, was never actually event-scoped)
  and `quickadd`/`bulk` (same self-picking pattern, now `/app/add`/`/app/bulk` when no id);
  the T6 auto-open-door effect now consumes its one-shot session flag on the FIRST
  evaluation regardless of tab (previously only stamped inside the Start-tab branch, so a
  session whose first landing was a deep link elsewhere stayed armed and could hijack a
  later deliberate tap on Home); `resolvedDoorId` (mobile) now validates against the real
  `doorCandidates` list before mounting `DoorProvider`, matching what the desktop cockpit
  already did (a stale `?event=` — e.g. after a venue switch — could otherwise mount the
  wrong venue's event); `safeNextPath` now rejects dot-segment traversal
  (`/app/../login`); the layout added a defense-in-depth `getSessionUser()` check, since
  the catch-all route now matches paths (e.g. `/app/anything.txt`) that used to 404 before
  every screen had a real URL, and the middleware matcher's static-extension exclusion
  skips auth for those.
- `capacitor-plan-claude-code.md` updated: the Android hardware-back-button hook point is
  now `router.back()` in `app.tsx`, not the deleted `history-nav.ts`.
- Suites green (routes round-trip, `next-path` guard, full typecheck). The
  `claude-md-references.test.ts` phantom-path guard will fail locally until `routes.ts`/
  `layout.tsx`/`app-shell-data.tsx` are staged — expected for any new untracked file, not a
  regression; resolves once committed.

---

## 2026-07-12 — Testronde Max 10/7: 8 taken → 5 PR's + prod-schema-drift gevonden (PR #179–#183)

Max' mobiele testronde op prod (10/7, 8 ClickUp-taken met screenshots) uitgewerkt tot
root causes, de taken herschreven met acceptatiecriteria, en 5 PR's gebouwd.

- **Root cause van de "alles 0" bugs (86ey8w7w2 + 86ey8w7bm): prod mist migratie
  `20260708120000_venue_scope_denormalization`.** De prod-migratiehistorie stopt bij
  `20260708110000` (read-only bevestigd via MCP `list_migrations`); de gedeployde app
  leest `guests.venue_id` + de `venue_event_headcounts` RPC die daar niet bestaan. De
  query-laag slikte de errors stil in (`const { data } = …`) → door-picker 0/0/0, lege
  requests-inbox, event-stats 0 — terwijl event-scoped reads gewoon werkten. **Prod-push:
  go gegeven 12/7, draait direct na de merge-trein** (flow in taak 86ey8w7w2); de A/B-test van
  9/7 draaide op een throwaway-project, niet op prod — vandaar dat dit niet eerder opviel.
- **PR #179 — door-fixes (86ey8w759 + 86ey8w7u4):** check-in-lijst focuste het zoekveld
  bij elke remount → keyboard-pop na elke check-in op mobiel; auto-focus nu alleen op
  fine-pointer (nieuwe `hasFinePointer()` seam in `src/lib/platform.ts`). Stepper "how
  many are coming in?" verhuisd naar de BottomBar naast de Check-in knop — past altijd
  samen in het viewport.
- **PR #180 — gastenlijst-rijen (86ey8w7kf):** statusbolletjes weg; mobiele kaarten in de
  deur-taal (solid tier fill + `tierInk`, ingecheckt = `tintTier` 0.14 + check-badge,
  multi-select = inset accent-ring).
- **PR #181 — tiers (86ey8w7r2):** Save-acties uit de (achter het keyboard verdwijnende)
  BottomBar naar de New-tier card zelf.
- **PR #182 — duplicate safeguard (86ey8w7ek, migratie `20260712120000`):** dupe-check was
  client-side over de volledige lijst (te laat bij duizenden gasten; server had géén
  safeguard). Nu: partial index `(event_id, lower(full_name))` excl. `removed` + RPC
  `find_event_guest_by_name` (SECURITY INVOKER, RLS-scoped) + blocking overlay op submit
  (+N optellen / vervangen / toch toevoegen / annuleren — besluit Max 12/7). pgTAP 11
  tests; volledige suite 936/936 groen op verse reset. **Review gate: migratie → fresh
  /code-review vóór merge.**
- **PR #183 — event-pagina admin (86ey8w79x + code-helft 86ey8w7bm):** tegel "On the way"
  → "On the list"; badge telt nu óók pending quota-requests (waren onzichtbaar → badge
  vs. inbox mismatch) met deep-link naar de juiste tab; request-links funnel (clicks ·
  requests · approved) zichtbaar; activity-log gepagineerd (50 + Show more); en de
  venue-scoped po-reads **gooien errors** i.p.v. stil 0/[] te renderen — zodat Sentry
  schema-drift zoals hierboven voortaan direct vangt.
- Gotcha: `preview_screenshot` timet out in deze omgeving; verifiëren ging via
  `preview_eval` bounding-boxes/DOM-asserts.

---

## 2026-07-12 — Mock venue state + dead switchVenue removed from the po shell (last mock fixture gone)

Dead-code removal in the `/app` shell; behavior-neutral (verified live: sidebar header,
Meer venue card, venue switcher, venue settings all render live data as before).

- **`app.tsx` no longer imports the mock fixtures.** The shell initialized `venue` state
  from `src/lib/po/data.ts` (`venues.find((v) => v.current)`) — the last mock-data import
  in a shipped render path (the FE-5 guard scanned `screens/` + `features/po` but not the
  component root, so the shell itself slipped through). Every remaining read of
  `po.venue` was just `venue.name` as a display fallback that live identity already
  covers: shell `venueName` → `liveVenueName ?? t.settings.venueSwitch.thisVenueFallback`;
  Meer's venue card + `VenueSettings`' sub → `usePoIdentity().venueName` (sub simply
  omitted while null). `VenueSettings` lost its (unused-beyond-the-fallback) `venue` prop.
- **Dead `switchVenue` removed** from `app.tsx` + the `PoApp` context type. It was the
  prototype's local-state switcher (toast + setState) with zero callers — the real path
  is `switchToVenue` (server cookie + full reload, #1), which stays. Dead i18n copy went
  with it (`venue.switched`, `home.switchVenue`).
- **`src/lib/po/data.ts` deleted, `Venue` interface deleted** (`src/lib/po/types.ts`) —
  both were orphaned by the above; nothing in src/tests imported them anymore.
- **Guard tightened + CLAUDE.md updated:** `tests/unit/no-mock-data-imports.test.ts` now
  scans ALL of `src/components/po` (not just `screens/`), and the front-end-discipline
  bullet reflects the module's removal (phantom-path guard forced the same-PR update).
- Suite: type-check clean, lint clean, vitest 671/671 green. No high-risk surface touched.

---

## 2026-07-12 — UX/IA 8/7 M4: canonical headcount rules + one shared selector (K-10, ClickUp `86ey7dzdc`)

Root-caused K-10 ("cockpit counts differently than the rest — 4/38 · 34 on the way vs.
door/EventView's 37 · 33, same event, same moment") and fixed it at both the structural
and the data level, per the canonical rules Max locked in `ux-ia-audit-claude-code.md`
§5.2 (now also `gastenlijst-app-spec.md` decision #44).

**Structural fix:** one canonical selector, `src/features/po/headcount.ts`
(`computeHeadcounts`) — on-list excludes `removed`/`refused`, inside counts only arrived
heads on a partial check-in, on-the-way = on-list − inside, refused is tracked separately
and never contributes elsewhere. `src/features/po/eventday/cockpit.ts` and
`src/features/door/model.ts` both now delegate to it instead of each carrying its own
reducer — that duplication is exactly what let the two drift apart.

**Two real bugs found while root-causing, fixed in migration
`20260713140000_headcount_canonical_rules.sql`** (renamed at the fresh-session
`/code-review` pass — the original `20260710120000` stamp sorted before `main`'s
already-live `20260712120000_quick_add_dupe_check.sql`, which would have forced
`db push --include-all` on the next prod deploy):**
1. `venue_event_headcounts.present` (feeds Home cards + EventView) summed the *full*
   registered party for every checked-in guest instead of `plus_ones_arrived` — a partial
   check-in was overcounted. New pgTAP (`venue_scope_denormalization.test.sql` 5d) proves a
   +3 party with 1 arrival now adds 2 heads, not 4.
2. `event_stats_summary` / `event_tier_stats` / `venue_stats_summary` /
   `venue_event_rollup` folded `refused` guests into the same "registered" pool as
   approved/checked-in — a deliberate, tested choice at the time (see the old
   `analytics.test.sql` comments) that the M4 decision now supersedes: refused never
   contributes to on-list/no-shows/attendance anywhere, tracked only via its own,
   `guests.status`-direct count. `event_user_additions`/`venue_user_additions` (per-adder
   attribution — "gross, incl. removed") are deliberately **unchanged**, a different
   metric. `analytics.test.sql` expectations updated (registered 28→27, registered
   headcount 39→37, attendance 10.3%→10.8%, Regular-tier registered 22→21 — Bram, the
   seed's refused guest, sat in Regular).

**~~Bycatch, same investigation~~ — RETRACTED, see the fresh-session `/code-review` correction
below.** The original entry here claimed `check_ins` has no `event_id` column and removed the
realtime filter on that basis. Both were wrong: `check_ins` has carried `event_id` since
`20260622140000_checkin_event_scope.sql`, and `20260623` (`d6b8c4a`) deliberately added the
`event_id=eq.<id>` filter as scale-track work — without it, every venue's check-in reaches every
subscriber before RLS runs. The filter was restored in both `useDoorSync.ts` and `hooks.ts`; see
the 13/7 correction entry for the full story.

**Tests:** new `src/features/po/headcount.test.ts` (10 cases, incl. a K-10 repro proving
the split-refused-array and unsplit-array call sites agree). `pnpm vitest run` 681/681
green, `supabase test db` on a fresh reset green (926 tests, incl. the updated
`analytics.test.sql` + new `venue_scope_denormalization.test.sql` 5d). Zero `tsc`/`lint`
errors. Publieke `/e/[slug]`-pagina shows a different, unrelated metric (`spots_left`,
per-link capacity) — out of scope for this rule, confirmed and left untouched.

**Follow-up 13/7 (Max' manual test found a THIRD bug the RPC/pgTAP checks above didn't
cover):** cockpit still showed one head too many live in the browser (40 vs. 41 — the seed's
own `pending`-status guest, Aïcha, doesn't come from a trigger/RPC so no pgTAP test ever
exercised it). Root cause: `fetchGuests` (`src/features/po/queries.ts`, backs `usePoGuests` →
cockpit + the Guests tab + the venue-wide list) filtered `.neq('status', 'removed')` — the
ONLY fetcher that didn't scope to the same `approved`/`checked_in`/`refused` triple the door's
own query and every stats RPC already use. A `pending` (or `denied`) guest row slipped
through, and since the po `Guest.status` type only has `in`/`wait`/`refused`,
`guestStatusToPo` silently collapsed it into `wait` — a phantom "on the way" guest invisible
in the UI (no `pending` badge exists) but very visible in the headcount. Fixed: `fetchGuests`
now filters `.in('status', [...ON_LIST, 'refused'])`, matching the door exactly. No UI
capability lost — nothing renders `guests.status === 'pending'` distinctly, so this guest was
never meant to be counted, only ever meant to be excluded (per the seed's own comment: "pending
Aïcha ... excluded"). Live-reverified in the preview: cockpit/door/Home all read 40 on the
list · 25 on the way · 15 inside after the fix, where cockpit alone read 41/26/15 before.
732/732 vitest green, `tsc`/`lint` clean (no DB change, so no new pgTAP needed here).

**Fresh-session `/code-review` before merge (per the review gate — migration touches
`SECURITY DEFINER` functions), 13/7 — two real findings, both fixed:**
1. **The "bycatch" realtime fix above was built on a false premise and reverted.**
   `check_ins` DOES carry `event_id` (`20260622140000_checkin_event_scope.sql`, backfilled
   NOT NULL, trigger-maintained, indexed specifically "backs the realtime event filter"), and
   the `event_id=eq.<id>` filter this session removed was deliberately added in `d6b8c4a`
   ("feat(scale): wire check_ins event scope") as scale-track work — without it, every venue's
   check-in reaches every subscriber before RLS evaluates, the exact cost that commit fixed.
   Filter restored in both `useDoorSync.ts` and `usePoEventRealtime` (`hooks.ts`); the false
   claim also corrected in both files' comments and here. If realtime genuinely looked dead
   during the original K-10 investigation, the real suspect is the documented local
   realtime-publication-drop quirk (see `local-supabase-quirks`), not the filter — worth its
   own look if it reproduces on prod, but out of scope for this PR.
2. **`venue_event_headcounts.present` regressed staff to seeing 0 for their own checked-in
   guests.** The rewrite is `SECURITY INVOKER` and derives `present` from `check_ins`, which
   staff have no SELECT policy on — so a staff user's own guest showed `checked_in` in the
   list while the Home/EventView card read 0 inside (the pre-PR formula, summing the full
   registered party off `guests` alone, happened to dodge this since `guests` IS staff-
   readable). Fixed role-preservingly: `sum(1 + coalesce(c.plus_ones_arrived, g.plus_ones))
   filter (where g.status = 'checked_in')`, `c` joined only on non-voided rows — exact
   arrived heads where `check_ins` is readable, the old full-party behaviour where it isn't
   (a hidden row joins to `null`, `coalesce` falls back). New pgTAP case covers staff
   specifically (the original 5d only exercised admin — DoD's per-role rule).

Also from the review: renamed the migration off a timestamp that collided with `main`'s
`20260712120000_quick_add_dupe_check.sql`; fixed `event_checkins_per_quarter`'s comment
(a refused-after-checked-in guest keeps its check-in — `sync_guest_status_from_refusal`
flips status without voiding — so "refused never has a check-in" was false, just rare); fixed
the seed baseline comment ("Tom 7" → "Tom 8", the file's own 4.6 assertion already proved 8).
Flagged, not fixed (non-blocking): `arrivedHeads`/`cockpitCounts`/`perTierLive` in
`cockpit.ts` still hand-roll koppen math the canonical selector already provides — the exact
duplication this PR exists to kill, left as a follow-up rather than growing this PR further;
`guest_slot_cost` still charges a `pending` guest quota (pre-existing, unrelated to this PR).

---

## 2026-07-09 — Before/after A/B of the venue-scope read fix (#143 — SCALE-5/K8/FE-3, PR #165)

Same-machine, same-seed verification that the venue-scope fix (PR #143) is real, not just
plausible from reading the diff. Extracted the exact pre-fix `.in(eventIds)` query shapes
from `e93d3dc^` and re-ran them back-to-back against the current source functions in one
run, so only the query shape differs.

- **Fleet (1 venue × 400 events):** all six venue-wide reads (`fetchGuests`, `fetchTiers`,
  `fetchEventHeadcounts`, `fetchGuestRequests`, `fetchQuotaRequests`,
  `fetchVenueRequestLinks`) genuinely **414'd** pre-fix when actually executed (15.7–15.9
  KB URLs) — not a projection from URL-length math. All six pass post-fix with short,
  fixed-size requests (46×–277× shorter URL).
- **Mega (1 venue, one 25 000-guest event):** `fetchEventHeadcounts` dropped from 28
  requests / 2.34 MB (client-side sum over every guest row) to 1 request / 252 bytes (the
  `venue_event_headcounts` RPC) — ~9 700× fewer bytes.
- **Write throughput unaffected** (control): 1 013 check-ins/sec across 45 concurrent
  scanners, 0 errors — at/above the prior 872/sec baseline, confirming this was a
  read-only fix with no regression.
- **Honest caveat:** the door's cold-load payload at 25k guests is **untouched** by this
  fix (~13.6 MB) — that's SCALE-1/K9, a separate item that hasn't shipped.
- `scripts/perf/scale-audit.mjs`'s seed/measure/burst/teardown helpers are now exported
  (entrypoint-guarded so importing doesn't trigger its own run) so the new companion
  `scripts/perf/scale-beforeafter.mjs` reuses them instead of duplicating seeding logic.
- Full delta table in `perf-before-after-2026-07.md` (repo root). Measurement only — no
  application code changed.

---

## 2026-07-09 — UX/IA 8/7 rechten-hygiëne: role-hide i.p.v. show-and-block (M1+M9+M3)

Ticket 86ey7dz91. UI-laag only — RLS ongemoeid, geen migraties. Fixt K-4/K-5/K-7/K-8 uit
`ux-ia-audit-claude-code.md`.

- **New role gates in `src/features/auth/roles.ts`** (unit-tested, `roles.test.ts`):
  `canSeeGuestCounts` (mirrors guests-select RLS — admin/finance/staff/doorhost; a pure
  `user_manager` always gets zero rows), `canSeeRequestInbox` (admin/finance —
  guest_requests_select/quota_requests_select's venue-role arm), `canDecideRequests`
  (admin only — quota_requests_decide_admin/guest_requests_decide's role arm),
  `canSeeOwnRequests` (staff without inbox rights — the `user_id = auth.uid()` RLS arm),
  `canSeeAnyRequests`.
- **M1 (K-4/K-5) — `approvals.tsx`:** Approve/Decline/Deny buttons only render for
  `canDecideRequests`. Finance gets the full venue-wide inbox read-only (`PendingBadge`
  instead of buttons, a `readOnlyNote` instead of the decide-framed note). Staff without
  inbox rights gets a single-tab "Your requests" own-status view (no tabs, no venue
  framing, `ownQuotaNote`/`ownEmptyQuota` copy) — landing tab never applies to staff since
  `guest_requests_select` RLS excludes them outright. A role with neither gets a plain
  "no access" state instead of an empty-looking inbox. Fixed the stale MFA-excuse copy
  ("...or MFA is required") in `db-errors.ts` + `links/actions.ts` +
  `requests.approveQuotaFailed` — no AAL2/MFA requirement exists anywhere in RLS
  (decision #20).
- **M9 (K-7) — `home.tsx`/`event-row.tsx`:** "New guest" CTA hidden for roles without
  `canManageGuests`. `EventRow` gets a `guestCountsVisible` prop; when false (pure
  `user_manager`) the on-the-list/inside readouts show "—" instead of a fake "0".
- **M3 (K-8) — `queries.ts`/`profile.tsx`:** `fetchPersonProfile`'s guestId branch now
  falls back to the name-only guest-row profile when the guest IS contact-linked but the
  caller can't read `contacts` (RLS: admin/finance/organizer only) — new `restricted` flag
  threaded through `PersonProfileData`/`PoContactProfile`. The profile screen shows a plain
  `restrictedNote` instead of the dead-end "not available" error AND instead of a "Save as
  contact" CTA (it's already a contact, just not visible). Home's request pulse tiles
  hidden entirely for roles with zero request visibility (doorhost/user_manager).
- **Regression caught during live verification, fixed same session:** the new gates are
  all keyed off `roles: VenueRole[]`, which is empty for a pure event-organizer (their
  rights come from `event_organizers`, not `venue_memberships` — same gap already noted in
  `Contacten`). Naively hiding on `roles.length === 0` broke organizer's Home entirely
  (New guest, request tiles, real guest counts all vanished) and would have made
  `approvals.tsx` dead-end them with "no access" where they previously had (RLS-correct,
  if imperfect) working access. Fixed by treating an empty `roles` array as "give the
  benefit of the doubt, preserve prior behavior" in `home.tsx` and `approvals.tsx` — never
  newly hide/block for a role we can't positively identify. Full organizer-aware framing is
  explicitly deferred to M2 (K-6), a separate ClickUp task.
- **Bonus fix, same root cause as K-5:** `app.tsx`'s sidebar/More "Requests" nav item was
  hard-coded `roles.includes('admin')` — finance/staff had zero nav route and could only
  reach the inbox via Home's tiles ("dezelfde functie is per ingang anders gegate", exactly
  what K-5 flagged). Renamed to `showRequestsNavItem` = `canSeeAnyRequests` (+ the same
  empty-roles carve-out for organizer).
- Verification: `pnpm exec tsc --noEmit` clean, `pnpm lint` clean (pre-existing a11y
  warning only), `pnpm exec vitest run` 664/664 passing (12 new tests in `roles.test.ts`).
  Live-verified via dev-login as admin/manager/finance/staff/door/organizer — see the
  ClickUp comment for the full per-role walkthrough and test handoff.
- **Gotcha:** this worktree had no `node_modules` — `pnpm install` needed before
  typecheck/lint/test would run.

---

## 2026-07-09 — K11 real tier names + K6 dead auth-mock deletion (PR #164)

Review-backlog cleanup: 2 of 3 requested tasks shipped, 1 parked per the milestone-gating
rule after confirming with Max.

- **K11** (86ey6xf7t, Med): the guests-list already rendered real `guest_tiers.name`/color
  via `TierPill` from earlier work; the past-event recap and a name-only guest's profile
  header still collapsed the tier through `tierRole()`'s lossy 6-word substring taxonomy
  ("Members"/"Table 5"/etc. all → "GUEST"). Fixed both: `fetchRecapGuests` now selects
  `guest_tiers.color` too, `RecapGuestRow`/`RecapGuest` carry `tierColor`, and both spots
  render `TierPill` instead of `RoleChip`. Overlaps with **FE-2** (86ey6ypfw) — only the
  render half is done; FE-2's `tierRole` de-dup (adapters.ts vs door/model.ts),
  `optimisticGuest`/`toPoGuest` fold, and the shared date-format module are still open.
  Cross-referenced on both ClickUp tasks so neither redoes the other's half.
- **K6** (86ey6xfbx, Low): `started` in `app.tsx` was initialized `true` and never set
  `false`, so the entire pre-login mock flow (Welcome/Login/Otp/Mfa/Invite screens, the
  `PhoneFrame` wrapper, `AuthView`/`AuthNav` plumbing) was dead — real auth is middleware +
  `/login` + `/mfa`. Deleted `screens/auth.tsx` (192 lines) + ~50 lines of unreachable
  branches/state/types from `app.tsx`/`context.tsx`.
- **K9 parked, not built:** door `flush()`'s redundant snapshot re-download is tagged
  `milestone-25` and explicitly folds into the parked scale-track (CLAUDE.md: "scale-track
  remainder ≥25"). Flagged the milestone-tag conflict to Max before starting; he confirmed
  park-it. Left untouched in ClickUp under ≥25.
- Verification: `pnpm run type-check` clean, `pnpm exec vitest run` 653/653 passing
  (adapters.test.ts updated for the new `RecapGuestRow`/`RecapGuest` shape), `pnpm run
  lint` clean (pre-existing unrelated a11y warnings only). Manually verified live too (dev
  server + local Supabase seed): a name-only guest's profile now shows the real `TierPill`
  ("Regular") instead of the collapsed "GUEST" `RoleChip`.
- **Gotcha:** this worktree had no `node_modules` — needed a `pnpm install` before
  typecheck/test/lint would run at all (worktrees aren't pre-provisioned).

---

## 2026-07-09 — Prod-ready 9/7 task 13: Test-quality audit (UI-success-only tests)

One lens (per the task): do tests assert **database state**, or only that the UI said
`ok:true`? C15 proved an `ok:true` assertion is worthless when RLS silently drops the
write. Audited all 60 Vitest files + the write paths against the pgTAP suite.

- **Headline: the suite is in good shape.** No assertion-free tests exist. The naive
  "assert ok:true and nothing else" pattern is largely absent: `guests/actions.test.ts`
  fakes the affected-row `count` and asserts `count 0 → not_found` (the C15 guard itself);
  `door/outbox/replay.test.ts` + `gateway.test.ts` assert argument-pinning and the
  `.not()/.is()` safety filters; `po/mutations.test.tsx` asserts React-Query cache keys
  (mocking the actions is correct there). The pgTAP layer carries the real DB-state truth —
  guest quota, list-lock, check-in/void/revive, approvals, contacts, Stripe all have
  SELECT-back **and** RLS-deny assertions.
- **The one real gap found + fixed — `changeGuestsTierBulk`.** The C15 `{count:'exact'}` +
  `notFound()` guard (PR #136) was applied to `updateGuest`/`changeGuestTier`/`removeGuest`
  but **never extended to the bulk path**: it did a blind `.update().in('id', ids)` and
  returned `ok:true` regardless — a silent total failure when RLS filters every row (staff
  moving guests they don't own, or a locked list). It was also the **only staff-reachable**
  unguarded write, and had **no test anywhere** (only a mocked `ok:true` in
  `mutations.test.tsx`). Fixed: added `{count:'exact'}`+`.select('id')`+`if(!count)
  return notFound()` to `src/features/guests/actions.ts`; added a Vitest C15 regression
  block (extended the fake client to be thenable for the direct-await bulk path); added
  **`supabase/tests/database/guest_bulk_tier_change.test.sql`** (7 assertions) proving the
  DB truth the guard relies on — admin move lands (SELECT-back), staff move of others'
  guests changes **0 rows**, staff move of own guests lands, list-locked staff move changes
  **0 rows**.
- **Flagged, NOT fixed (low real-world exposure — a consistency/defense-in-depth backlog,
  not a live bug):** 21 other server actions do an `.update()`/`.delete()`/`.upsert()` and
  return `ok:true` without a count guard (`events` settings + templates + tiers, `links`
  updates, `contacts` upsert/toggle-permanent, `requests` deny, `quotas` deny). **All are
  admin/organizer-only paths acting on their own venue — RLS won't silently filter the
  actor's own rows**, so the C15 false-success can't trigger the way it does for staff. Two
  minor pgTAP coverage gaps also noted: tier CREATE/UPDATE/DELETE has no role-matrix RLS
  test (only VAT-constraint validation), and refusal INSERT has no direct SELECT-back
  (covered at argument level by `replay.test.ts`). Left for a dedicated follow-up if the
  guard is ever standardised across all mutations.
- **Verification:** Vitest 656 green (3 new), new pgTAP file 7/7 green, `type-check` +
  `lint` clean. No migration (test + a 3-line action guard only).

---

## 2026-07-09 — Prod-ready 9/7 task 10: Mail deliverability research (OTP = login availability)

Investigation task — "login is 100% e-mail-OTP, so mail-in-spam = login down." Goal:
find what sends prod mail, whether the sending domain is authenticated, and where OTP
mail lands. **Result: 🟢 green, verified in prod — no fixes needed for launch.**
Findings written up in `docs/mail-deliverability.md`.

- **What sends prod mail:** Resend (custom SMTP under Supabase Auth, not the built-in
  shared mailer), from **`theoperators.nl`** via Amazon SES **eu-west-1**. Resend domain
  status = **verified**, sending enabled. A *borrowed* Operators domain "for now" — a
  dedicated PlusOne domain stays F3/branding (86ey6b3hv).
- **DNS auth verified** (DoH, bypassing the ISP resolver that hijacks lookups): DKIM
  `resend._domainkey` published ✅, SPF `send.theoperators.nl = include:amazonses.com` ✅,
  bounce MX `feedback-smtp.eu-west-1.amazonses.com` ✅, DMARC present (`p=none`, no `rua`).
  SPF+DKIM align → passes DMARC → inbox.
- **Proven delivery (Resend MCP):** **11/11 emails delivered, 0 bounced, 0 complained**,
  including **Gmail and Hotmail** recipients + business domains. Real invites + sign-in
  links to actual testers.
- **Proven from the sending side (Supabase MCP):** 24h auth logs show **zero SMTP/send
  errors**; 10 users / 7 confirmed / 3 signed-in-7d. The only mail-ish log lines are
  user-side (expired link, mistyped TOTP), not delivery failures. A "550" in the logs
  was a false positive (digits inside a timestamp, not an SMTP reject).
- **Verification tooling milestone:** first task using the newly-connected **Supabase**
  and **Resend** MCPs to read live prod state directly (they hot-load only after a
  session reconnect, not mid-session).
- **Open / scale-time (not blocking):** (1) borrowed Operators domain couples PlusOne
  login deliverability to another brand's reputation — real fix is F3 dedicated domain;
  (2) confirm the Resend plan's daily/monthly caps before venue scale (≥5–25), since
  every login is a send; (3) optional DMARC `rua=` for report visibility, tighten to
  `p=quarantine` later.

## 2026-07-09 — Prod-ready 9/7 task 11: Legal drafts (DPA + ToS + privacy policy + subprocessors)

English-language legal drafts for the paid product, in `docs/legal/` (ClickUp
`86ey7q7c2`). All four grounded in the real dataflows, not boilerplate: retention =
`venues.retention_months` 1–60 (default 12), event-anchored, daily 03:30 UTC
`run_privacy_retention()` with structure-preserving audit-diff redaction;
`forget_contact()` as the Art. 17 self-service path; RLS/audit/soft-delete as the
Annex 3 TOMs; Sentry scrub guarantees stated as written (no request/IP/query
strings, UUID-only user, EU region `de.sentry.io`); Stripe = SEPA+iDEAL, no
card/IBAN storage; Better Stack explicitly listed as NOT a subprocessor (public
health endpoint only). Planned subprocessors (Attio, GA, PostHog, Resend) are in
the list as "planned — 30-day notice before activation" so venues sign once.

- Structure per Weeztix inspo (task links): dual-role privacy policy
  (controller vs processor split), standard/planned subprocessor tables, B2B
  ToS with liability cap + Art. 28 hook.
- Docs mirror to Google Drive `Plus one - guestlist app/02_Legal/`
  (`Terms_and_Conditions` + `Privacy_AVG_GDPR`) as editable Google Docs.
- **DRAFT status is explicit in every file** — Dutch lawyer review is mandatory
  before publication/signature; placeholder checklist in `docs/legal/README.md`
  (entity, KvK, address, domain, court district).

## 2026-07-09 — Prod-ready 9/7 task 12: incident-response skill

Built with the `skill-creator` skill (draft → dry-run test agent → fix from feedback,
skipped the full eval-harness loop — single subjective orchestration skill, not worth
the machinery). **`.claude/skills/incident-response/SKILL.md`** (tracked in git —
`.claude/settings.json`/`launch.json` are, `settings.local.json` isn't): triggers on
"prod is down" / "errors in prod" / door check-in failures / etc., reads
`docs/runbook.md` first, then pulls live diagnostics per source availability (Sentry
MCP → `sentry-cli` skill fallback; no Vercel/Supabase MCP exists here, so CLI-if-linked
→ dashboard fallback for both), and synthesizes a triage summary: what's broken,
confidence + evidence, door-live-vs-not framing, rollback-first recommendation, who to
inform from the runbook.

- **Dry-run test surfaced a real bug, not just a skill gap:** `docs/runbook.md`'s
  key-facts table had a stale Vercel project (`plus-one-the-operators` /
  `…-the-operators.vercel.app`) — the actual project is **`plus-one`**
  (`plus-one-phi.vercel.app`, org `the-operators`, verified via `vercel project ls`).
  Fixed in the same PR since a wrong project name in the "First 60 seconds" table is
  actively harmful during a real incident.
- **Skill fixes from the test agent's feedback:** Sentry MCP tools need an org
  slug/region first (`find_organizations`/`find_projects`) — the skill now says so
  instead of assuming `search_issues` just works; Vercel/Supabase CLI fallbacks now
  say to confirm the CLI is actually authenticated/linked (`vercel whoami`,
  `supabase projects list`) before trusting silence-on-error as "nothing's wrong";
  added an explicit "all sources clean → say so, don't force a rollback, ask for a
  sharper repro" branch, since the test run's real triage genuinely came back clean.
- Sentry/Betterstack MCP auth wasn't available in this session — the skill is written
  so it degrades to CLI/dashboard pointers rather than assuming those connectors exist.

## 2026-07-09 — Prod-ready 9/7 task 04: Playwright e2e smoke with DB-state assertions (STAP 4.3)

The long-open e2e-kernflow gap (`docs/test-report.md` point 3; the old task 86exzefwq
was marked complete but never built) is closed with ONE deliberately small spec, now
blocking in CI (ClickUp `86ey7q6ze`).

- **`tests/e2e/core-flow.spec.ts`** — dev-login as `admin@plusone.test` → create an
  event on the Events tab → add a guest via quick-add (first tier created inline —
  fresh events are tier-less) → check the guest in on `/door/[eventId]`. Every step
  is asserted **directly in the database** via the service-role client, never via UI
  text: event row at the right venue, guest row (`added_by` + `status`), `check_ins`
  row (`checked_by` = session user), and the trigger-written `audit_log` rows
  (`create` for the guest, `check_in` for the check-in, actor + event scoped). This
  catches exactly the C15 class (UI says ok, RLS silently dropped the write) and C7
  (audit silently missing). Passes locally in ~19s, re-run safe (unique names).
- **CI (`.github/workflows/ci.yml`):** `supabase db start` → **`supabase start`**
  (the smoke needs GoTrue for dev-login + PostgREST; config.toml keeps analytics/
  edge-runtime off), then provision `.env.local` via `scripts/dev-env.mjs`, install
  Chromium, and run the new **`pnpm e2e:smoke`** script. Playwright traces upload
  as an artifact on failure. Only the smoke spec runs in CI (see gotcha below).
- **`playwright.config.ts` fix:** the config waited on port 3000 while `pnpm dev`
  (scripts/dev-env.mjs, added later) claims 7000/70xx — every e2e run would hang.
  The webServer now pins `PORT=3000`.
- **Consent gate gotcha:** first login on a fresh DB lands on `/consent` (terms +
  privacy, #20/#40) before `/app` — the spec accepts it conditionally. Any future
  e2e spec doing a first login needs the same step.
- **Fresh-DB-only failures the first CI runs caught** (exactly the drift class
  this smoke exists for — local runs were green both times):
  1. **CI Node 20 → 22:** `supabase-js ≥2.108` needs native WebSocket — on Node
     20 the client CONSTRUCTOR throws (`realtime-js` websocket-factory), hitting
     the e2e helpers and any server-side client. Node ≥22 is now a CI given.
  2. **MFA enroll nudge:** a fresh admin has no TOTP factor, so `/app` redirects
     once to the skippable `/mfa/enroll` recommendation — the spec pre-sets
     `user_profiles.mfa_snooze_until` in setup (no-op locally where dev:mfa
     stamps a factor).
  Also: a **CONFLICTING PR runs no Actions at all** (GitHub can't build the
  merge ref → the `pull_request` workflow silently never starts — it looks like
  CI is stuck; rebase first).
- **Known debt (out of scope, deliberately):** the four pre-existing specs
  (`door-offline`, `venue-dashboard`, `login`, `mfa-enroll`, …) predate the
  English-UI migration and the `(app)`→`/app` surface unification (Dutch strings,
  `/dashboard` waits, AAL2 expectations) and will fail if run — that's why CI runs
  `e2e:smoke`, not `e2e`. Reviving or pruning them is its own task.

## 2026-07-09 — Tractie/Attio 9/7: program plan (discussion session, no code)

Discussion session Max ↔ Claude on new-customer traction + Attio CRM. Output:
**`docs/attio-crm-plan.md`** (PR #157, merged) + ClickUp Doc "Tractie & Attio CRM —
plan 9/7" + 6 tasks "Tractie/Attio 9/7 — 01…06" in list `901818739469`. Nothing built.

- **Data map finding:** every lifecycle signal already exists (invites sent/accepted,
  profile/venue/event created_at, first check-in, subscription transitions, audit-log
  activity proxy) — except `events.created_by` (migration in task 01). Deliberately NO
  last-login tracking; max `audit_log` per venue is the activity proxy.
- **Key decisions (Max):** two-field Attio model (`Sales stage` manual/sales-owned,
  `product_lifecycle` synced hourly, assert-only, never touches sales fields); lifecycle
  ladder `invited → signed_up → venue_created → onboarded → first_event →
  first_door_night → active → paying/comped` + `at_risk`/`churned`; People-sync = ALL
  team roles (requires Attio DPA + privacy-statement update before go-live, task 06);
  digest → Slack + persisted `founder_digests`; platform-admin via audited SECURITY
  DEFINER RPCs (no blanket RLS rewrite); **support impersonation built now** (Max's
  call, against read-only-first advice) with hard guardrails — audit actor stays the
  support admin, ≤60 min time-box, start/stop audit actions, visible banner.
- **Parked at ≥25 venues:** auto-invite on signed contract (would break one-way sync
  + needs a venue-less "platform invite" concept). Interim: Attio workflow → Slack ping
  (task 06); later a one-click audited invite button on the founder dashboard (phase 04).
- **Gates:** tasks 02 (service_role cron sync) and 05 (impersonation) are high-risk →
  fresh-session `/code-review` + `/security-review`. No Attio MCP connector exists;
  integration = own REST client behind a `CrmProvider` interface (billing pattern).

## 2026-07-09 — Prod-ready 9/7 task 08: Sentry review-gate fixes

Fresh-session `/code-review` + `/security-review` on PR #155 found the scrub layer
covered only `.message` fields while PII rides four vectors. All findings were
verified against real code paths, not the PR's comments. Fixes (same PR):

- **[blocking] Breadcrumb `data.url` leak.** A contact/guest name search runs over
  the BROWSER Supabase client (`fetchContacts` → `.ilike('full_name', '%Jan%')`),
  so the name lands in a fetch-breadcrumb `data.url` — which `scrubEvent` never
  touched (it mapped only `breadcrumb.message`). `scrub.ts` now strips query
  strings from any http(s) URL (`URL_QUERY_RE` in `scrubText`) and shallow-scrubs
  `breadcrumb.data` / `span.data` string values (`scrubData`). **Verified live via
  the MCP:** a real fetch breadcrumb arrived as `…/contacts?[filtered]` — the name
  never reached Sentry.
- **[should-fix] Transactions bypassed the scrub.** `beforeSend` runs on errors
  only; the 0.05 prod trace sample shipped span URLs unscrubbed. Added
  `beforeSendTransaction: scrubTransaction` (deletes `request`, scrubs span
  description + data URLs) to all three configs. Generic over `Event` because
  `@sentry/nextjs` doesn't re-export `TransactionEvent`.
- **[should-fix] Server/edge dropped no console breadcrumbs.** Only the client had
  `beforeBreadcrumb`; a server `console.error('…', guestObj)` could ride along.
  Added `beforeBreadcrumb: scrubBreadcrumb` to `sentry.server.config.ts` +
  `sentry.edge.config.ts`.
- **[should-fix] Middleware matcher prefix-bypass.** `monitoring` in the negative
  lookahead excluded any `/monitoring*` path — a future `/monitoring-dashboard`
  would skip auth entirely. Tightened to `monitoring(?:/|$)`. **Verified:**
  `/monitoring` still tunnels (401, not redirected), `/monitoring-dashboard` now
  307s to `/login`.
- **[nit] `sentry-test` server action** now returns early in prod (the action id
  survives the bundle even though the page 404s); scrub header comment corrected
  to stop overclaiming (`extra`/`contexts` are backstop-only shallow-scrubbed).

Suites: Vitest 650/650 (was 645; +5 scrub cases), type-check + lint clean, build
passes tokenless. Test issues resolved; DSN removed from `.env.local`.

## 2026-07-09 — Prod-ready 9/7 task 08: Sentry error monitoring (code)

Implemented `sentry-implementatieplan.md` phases 1–6 (all code) for
`@sentry/nextjs@^10` (installed 10.64.0). Error monitoring + readable stack
traces + release tracking, PII-scrubbed, EU-region, no session replay. ClickUp
`86ey7q790`. **High-risk surface (middleware + auth) — needs a fresh-session
`/code-review` before merge per CLAUDE.md review gates.**

- **Build/config** — `next.config.js` wrapped with `withSentryConfig` (D2:
  `tunnelRoute: '/monitoring'` same-origin ingest, CSP untouched; source-map
  upload disabled without `SENTRY_AUTH_TOKEN` so CI/local builds pass tokenless).
  `src/middleware.ts` matcher now excludes `monitoring` — the plan's #1 silent
  failure mode (auth-gate 307'ing every envelope to `/login`).
- **SDK config** — `src/instrumentation.ts` (server/edge dispatch +
  `onRequestError`), `src/instrumentation-client.ts` (offline transport for the
  door, `beforeSend`/`beforeBreadcrumb` scrub, `enabled: Boolean(dsn)` so it's
  dormant without a DSN), `sentry.server.config.ts`, `sentry.edge.config.ts`,
  `src/app/global-error.tsx` (root crash screen, shows no `error.message`).
- **PII scrub** — `src/lib/observability/scrub.ts` (type-only Sentry import;
  redacts emails, phones, and Postgres `Key (col)=(value)` details — the #1 PII
  vector) + `scrub.test.ts` (9 tests) + `capture.ts` (the "unexpected only" gate:
  drops AbortError + offline TypeErrors).
- **Diagnostic context** — `PoLiveProvider` wires `QueryCache`/`MutationCache`
  `onError` → `captureUnexpectedError` + `setUser({id})`/venue+roles tags;
  `app.tsx` tags the active po screen (one URL, in-memory nav) + a nav
  breadcrumb; `DoorProvider` sets the same user/venue context. Server actions
  untouched (D10 — expected `MutationError` returns are never reported).
- **Test harness** — `src/app/sentry-test/` (page 404s in prod, three triggers:
  client throw, server-action throw, `captureMessage`).
- **Verified locally:** `type-check` + `lint` clean; Vitest 645/645 green;
  `pnpm build` succeeds **without** `SENTRY_AUTH_TOKEN` (CI parity, upload
  skipped); production `next start` smoke — `POST /monitoring` returns 401 (tunnel
  handler) and is **not** 307'd to `/login`, while `/app` and `/sentry-test`
  still 307 to `/login` (middleware exclusion proven, protection intact).
- **Verified LIVE against the real Sentry project** (`plus-one-hs/javascript-nextjs`,
  `de.sentry.io`) with the real DSN in a `local-smoke` env, then retrieved every
  event back through the **Sentry MCP** (the task's "loop bewijzen" step): all 5
  triggers ingested (client throw, server-action throw, captureMessage, a PII
  error, an app-surface error). Confirmed via the MCP: envelopes tunnel to
  `/monitoring?…&r=de` (200, same-origin); **PII scrubbed** — `Key (email)=(…)` →
  `Key ([redacted])=([redacted])`, `+31 6 …` → `[phone]`; **no Request section**;
  `user` = bare UUID (no email/name); app-surface event carried `po.screen=start`,
  `roles=doorhost,staff`, `venue.id=…`; `release` = git SHA; `environment=local-smoke`.
  Stack traces + natural-language `search_issues` + **Seer** all worked (Seer
  pinpointed `src/app/sentry-test/actions.ts:6`). Test issues resolved; the
  temporary DSN was removed from the gitignored `.env.local`. Residual note for
  fase 7.6: Sentry adds a coarse `user.geo` from the connecting IP **after**
  `beforeSend` — enable "Prevent Storing of IP Addresses" to drop it too.
- **v10 API notes for the reviewer:** `makeFetchTransport`/
  `makeBrowserOfflineTransport`/`captureRouterTransitionStart` are client-only
  exports (a Node `require()` shows them `undefined` — a red herring; they
  resolve in the browser bundle via `@sentry/nextjs` client → `@sentry/react` →
  `@sentry/browser`). `disableLogger`/`automaticVercelMonitors` are deprecated in
  v10 → moved under `webpack.{treeshake.removeDebugLogging, automaticVercelMonitors}`.
- **Remaining (not in this PR):** Max's fase 7 (Sentry EU account/org + project +
  Vercel marketplace integration + `NEXT_PUBLIC_SENTRY_DSN` + alert rules) and the
  live smoke/preview/offline/alert verification (fase 8.3–8.7, need a real DSN),
  then the Sentry-MCP hookup — **DONE in this session** (MCP live, round-trip
  proven above). **Slug resolved:** the real project is `javascript-nextjs` (not
  the plan's `plusone-guestlist`); the `next.config.js` fallback was corrected to
  match. Env from the Vercel integration wins on prod either way; the fallback
  only matters tokenless.
## 2026-07-09 — Prod-ready 9/7 task 05: Supabase Pro + restore drill + runbook

Backups moved from "hope" to "tested plan" (ClickUp `86ey7q72b`). Max upgraded the
prod project (`tolxwgqhppdcvnogdpel`) to **Pro** → automated **daily backups, 7-day
retention** now running. No code — docs + a live drill.

- **Live restore drill (PASSED).** Used Supabase's **"Restore to a new project"
  (BETA)** to clone the 2026-07-09 00:48 UTC physical backup into a throwaway
  project — **zero impact on prod** (the in-place "Restore" button was deliberately
  avoided; it overwrites). Verified in the clone: row counts intact (5 venues / 8
  events / 18 guests / 10 auth.users / 5 subscriptions / 75 audit_log rows), **RLS
  enabled on every public table**, the full audit + quota trigger stack present
  (`audit_*` + `enforce_guest_quota`/`enforce_event_capacity`/`check_ins_cap_arrivals`/
  `guard_guest_attribution`), and +N quota math correct on spot-check. Clone deleted
  immediately after (it bills separately, inherits prod compute).
- **`docs/backup-restore.md`** — Method A (restore-to-new-project, preferred) +
  Method B (logical `db dump` → scratch project, fallback), the verification SQL
  block, the in-place incident-restore procedure (with the overwrite/downtime
  warning), and a running **drill log** (this run recorded).
- **`docs/runbook.md`** — one-page 00:30 incident runbook: triage table (app down →
  Vercel rollback; DB → restore; login → Auth/SMTP; door not syncing → offline
  outbox is expected; billing/webhook → non-urgent, idempotent replay), "rollback
  is the default first move", and a who-to-inform section. Two `<FILL IN>`s left for
  Max: prod domain + Vercel project name, and pilot-venue contacts.
- **PITR decision:** verified pricing (~$100/mo for 7-day) and **parked until ≥25
  venues** — daily backups cover the "Now" milestone. Recorded in `backup-restore.md`.

## 2026-07-09 — Prod-ready 9/7 task 03: migration-collision hooks

Two mechanical guards replace the prose-only "never edit an applied migration /
pick a unique timestamp" rules in CLAUDE.md "Conventions" (ClickUp `86ey7q6xq`).
Shared pure logic in `scripts/hooks/lib/migration-guard.mjs`, unit-tested in
`tests/unit/migration-guard.test.ts` (8 tests, timestamp-collision +
migration-path matching).

- **Git `pre-push` hook** (`scripts/hooks/pre-push` → `check-migration-collisions.mjs`):
  blocks the push if a new local migration in `supabase/migrations/` shares its
  14-digit timestamp prefix with a migration already on `origin/main` — the
  exact collision class that broke `db push`/`db reset` once before. Installed
  via `git config core.hooksPath scripts/hooks`, set automatically by
  `scripts/setup-git-hooks.mjs` on every `pnpm install` (new `postinstall`
  script) — no manual setup step per machine/worktree.
- **Claude Code `PreToolUse` hook** (`.claude/settings.json`, matcher
  `Write|Edit` → `check-applied-migration.mjs`): denies an Edit/Write on any
  `supabase/migrations/*.sql` file that already exists in the `origin/main`
  git tree, mechanically enforcing "never edit an applied migration — write a
  new one."
- **Caveat (by design, not a gap to close later):** both guards only see what
  the last `git fetch` knows about `origin/main`, and are trivially
  bypassable — `git push --no-verify` for the git hook, editing the file
  outside Claude Code (or disabling the hook) for the Claude Code one. They
  fail open (allow) whenever `origin/main` can't be resolved, rather than
  blocking on an unrelated network/fetch problem. Blocking CI (task 02, the
  `lint-and-test` required check on `main`) remains the actual backstop —
  these hooks exist to catch the mistake locally, before a PR round-trip.

## 2026-07-09 — Prod-ready 9/7 — 09: uptime monitor + Dependabot

- **`GET /api/health`** ([src/app/api/health/route.ts](../src/app/api/health/route.ts)) — public route (middleware
  exempts `/api/health`), service-role round-trip against `venues` (head-only) so a hung
  Postgres connection trips it too, not just a live Next.js process. 200 `{status:'ok'}` /
  503 `{status:'error'}`.
- **BetterStack** is the uptime monitor (chosen on alert quality, not MCP tooling) — dashboard
  setup is external to code, runbook at `docs/uptime-setup.md` (1-minute HTTP check against
  `/api/health`, push-to-phone alert policy). Not yet configured — Max does the one-time
  dashboard signup.
- **Dependabot** (`.github/dependabot.yml`): weekly npm + github-actions update PRs, grouped
  by dev/prod dependency-type. No new gate needed — the existing blocking `lint-and-test`
  branch protection already fails a red update PR closed.
- CLAUDE.md: dropped the stale "Stripe webhook = the app's only API route" claim (billing
  section) now that `/api/health` exists.

## 2026-07-09 — Prod-ready program start + scale fixes

- **Prod-ready program (ClickUp "Prod-ready 9/7 —" 01–13, `86ey7q6vf`…`86ey7q7ev`).**
  Process hardening decided with Max: CLAUDE.md slim-down (this changelog), blocking CI,
  hooks, e2e smoke with DB-state assertions, Supabase Pro + restore drill + runbook,
  memory consolidation, backlog milestone-sweep, Sentry + MCP, uptime + Dependabot, mail
  deliverability, legal drafts (DPA/ToS/privacy), incident-response skill, test-quality
  audit. **Branch protection on `main` is LIVE** (requires the `lint-and-test` check,
  applies to admins, no force-pushes). New standing rules added to CLAUDE.md: review
  gates, milestone rule, model routing, expand–contract migrations, path-claim
  verification (guarded by `tests/unit/claude-md-references.test.ts`).
- **Scale: venue-scope reads (SCALE-5/K8/FE-3, PR #143 `e93d3dc`, migration
  `20260708120000_venue_scope_denormalization.sql`).** Denormalized `venue_id` onto
  `guests`/`guest_requests`/`quota_requests`/`guest_tiers` (fixes the venue-wide
  `.in(eventIds)` 414 past ~205 events) + `venue_event_headcounts` RPC (SECURITY INVOKER,
  role-relative) + fetcher dedup (`fetchGuests`/`fetchTiers` take a `{eventId}|{venueId}`
  scope).
- **Engineering review doc committed (PR #144 `0fa4fe4`).** `engineering-review-2026-07.md`
  (grade, decision log, FE architecture) — previously flagged as phantom because it lived
  uncommitted in the sibling worktree `sad-vaughan-ebcfec`; now on main. The "Scale &
  front-end discipline" CLAUDE.md section landed in the same PR.

## 2026-07-08 — Full-app review remediation P2–P5 + sidebar fix

Remediation of the 2026-07-07 10-angle review (35 verified findings, phases P0–P6,
ClickUp list `901818739469`), one phase-PR at a time.

- **P2 audit/quota/stats DONE** (PR #135 `590fbdd`, migration `20260708100000`, confirmed
  on prod): C6 `event_user_additions` restored the `where c.voided_at is null` filter its
  own predecessor carried (a voided check-in had silently counted as present in the
  per-member "Added by" breakdown); C7 `events.default_member_quota` changes now audit AND
  the three per-column `events` audit triggers were consolidated into one (`audit_events`,
  `WHEN (list_locked OR allow_uncheck OR default_member_quota changed)`) — the two
  pre-existing single-column triggers (`audit_events_lock`/`audit_events_allow_uncheck`)
  never fired for this column, so it wrote zero audit rows despite a migration comment
  claiming otherwise; the migration DROPs the old two and replaces them with the one
  consolidated trigger (forward-only DDL). K10: the four "keep in LOCKSTEP by comment"
  functions (`audit_trigger`, `run_privacy_retention`, `submit_guest_request`,
  `approve_guest_request`) now have checked-in canonical bodies under `supabase/canonical/`
  plus a guard test (`tests/unit/canonical-functions.test.ts`) that fails if a future
  migration redefines one with a different body.
- **P3 cache invalidation & false-success DONE** (PR #136 `e652588` + docs PR #137
  `0279442`, no migrations; C15–C19/C24/C25/G2): C15 `updateGuest`/`changeGuestTier`/
  `removeGuest` now use `{ count: 'exact' }` + a `notFound()` helper (`db-errors.ts`) so an
  RLS-filtered 0-row write returns an error instead of `ok:true`; C16 the shared
  `guestMutation` factory also invalidates `poKeys.quota(eventId)`; C17/C18
  `usePoApproveRequest`/`usePoForgetContact` invalidate the venue-wide All-Guests cache;
  C19 `usePoEventRealtime`'s `invalidate()` also refreshes venue-guests + `eventDetail`;
  C24 `switchToVenue` clears persisted nav-state before the post-switch reload and clears
  the "Switching…" toast on a rejected `setActiveVenueAction`; C25 `stats/data.ts` throws
  on a real RPC/query error instead of collapsing it into an empty shape — Analytics shows
  an error+retry state; G2 `usePoUpdateInfluencer` invalidates the Promotion
  link-funnel/promo prefixes. New tests: `guests/actions.test.ts`, `po/mutations.test.tsx`,
  `po/hooks.eventRealtime.test.tsx`, `stats/data.test.ts`. Same-PR follow-up from manual
  test feedback: `upsertContact`'s generic "This already exists." now names the conflicting
  field via `mapContactUniqueError` (both unique indexes are venue-scoped, confirmed), and
  contact-edit / save-as-contact flows show a "Saved." confirmation toast instead of
  closing silently. Dev-mode gotcha (not a code issue): a long-running `pnpm dev`
  recompiled all ~3900 modules on nearly every request (2.4–2.9 s) making the app FEEL
  slow — clearing `.next` + restarting fixed it (`POST /app` back to ~800 ms).
- **P4 input & date correctness DONE** (PR #138 `0e37cf6`, migration `20260708110000`):
  C20 the quick-add tokenizer's `+`-split ran *before* contact-token extraction, silently
  swallowing a plus-addressed email's mailbox tag (`jan+vip@x.nl` → `jan`) — extraction now
  runs first on plain-whitespace tokens; C21 `buildEventSlug()` sliced the UTC day off
  `starts_at`, baking the wrong (previous) day into the permanent slug for a 00:00–02:00
  Amsterdam start — fixed both the app helper and the DB backstop trigger
  (`events_set_landing_slug`) to use the event's Amsterdam calendar day; C22 the auto-lock
  save comparison string-compared `toISOString()` (`…Z`) against PostgREST's `…+00:00`, so
  every save fired a redundant write — normalized through `splitLocal`; C23 template
  auto-lock "hours before doors" parsed Dutch decimals (`1,5`) to `NaN`→`null` while the UI
  kept showing "Locks 1,5 hours" — reuses the `,`→`.` normalization
  (`parseAutoLockOffsetMinutes`) and blocks Save with an inline error; C27 deleted
  `PeriodControls` (zero importers).
- **P5 mock-data purge, billing & cleanup: 6/8 DONE** (PR #139 `f3f31ac` mock-purge, PR
  #140 `05da737` billing+cleanup, no migrations; K6/K11 deliberately deferred to their own
  sessions to avoid merge collisions with C24/FE-2): K1 the per-event Allowance screen
  (100% mock, steppers wrote nothing) wired to live `event_quotas` via
  `usePoEventAllowance`/`usePoSetAllowance` reusing `setEventUserQuota`; K2 the
  venue-switcher's mock "Max Seffelaar" fallback replaced by a neutral placeholder + dead
  `account`/`allowanceData` fixtures removed; K5 `createCheckoutSessionAction`/
  `createPortalSessionAction` catch a `StripeAdapter` throw and return the existing
  `unavailable` shape; K7 removed the stale AAL2 wall + step-up sheet on admin-sessions
  (AAL2 dropped in the 2026-07-02 MFA refinement) + deleted the dead `usePoAal2` hook; K4
  the stripe-confinement test also catches dynamic `import('stripe')`; C26 the billing
  checkout/portal redirect's `mutateAsync().then()` had no rejection handler — a real
  unhandled-promise-rejection reproduced live before the fix, confirmed gone after.
- **Ad-hoc fix (Max, screenshot):** the desktop sidebar (`ResponsiveShell` ≥1024px,
  `shell-responsive.tsx`) had no scroll container — short viewports clipped nav items and
  the profile footer. The nav list is now the flexible scrollable region
  (`min-h-0 flex-1 overflow-y-auto`) with the footer as a `flex-none` sibling. PR #141
  `b108349`.

## 2026-07-07 — Review kickoff, P0/P1, T8 crew, T9 cockpit fold

- **Full-app review:** 10-angle `/code-review` → 35 verified findings (42 candidates, 5
  plausible, 2 refuted; 7 high, 0 critical). Phases P0–P6 as ClickUp phase-parents + 40
  subtasks; remediation artifact linked from `86ey6xdjp`.
- **P0 security DONE + prod** (PR #131 `fe248f4`, migration `20260707170000`): crew-invite
  authz, anon RLS surface, approval race.
- **P1 door outbox data-integrity DONE** (PR #133 `43086bc`, no migrations): C8
  `syncing`-orphan recovery on `store.init` (`resumeStuckEntries`); C9 terminal codes →
  dead-letter + drain skips past a wedged entry (only a code-less/network failure pauses);
  C10 `reviveCheckIn` voided-only guard; C11 door realtime `check_ins` `event:'*'` (peer
  void/top-up visible ~1 s vs ≤60 s); C12 empty-name add-on-spot block; C13 `getDeviceId`
  storage guard + `DoorErrorBoundary`; C14 persist buster; C28 door TZ pinned.
  Perf/verification record: `perf-outbox-p1-133.md` (`scripts/perf/outbox-drain-bench.mjs`
  — wedge-drain 0→4999/5000).
- **Team & external crew — feedback 1/7 T8** (PR #121, prod-pushed): Team screen split into
  Venue members + External crew (venue-wide `event_organizers`, deduped, members excluded —
  `fetchVenueCrew`/`usePoVenueCrew`); invites list shows accepted/expired with status chips
  + Resend/Revoke. Resend = fresh 7-day expiry + new mail; the expiry bump is the ONLY
  client-UPDATE path on `invites` (column-grant `expires_at` behind RLS
  `invites_update_resend`, manager role, pending only, escalation guard, ≤30 days;
  migration `20260707113000`). Crew "accepted" derives from `user_profiles.terms_accepted_at`.
  **Invariants:** (1) all invite/resend mail goes through `src/features/auth/invite-mail.ts`
  `sendInviteEmail` — invite-first with magic-link fallback (`signInWithOtp` hard-refuses
  UNCONFIRMED accounts); (2) crew provisioning uses `inviteUserByEmail`, never
  `admin.createUser` (sends no e-mail — the pre-T8 bug: crew invited into silence).
- **T9 fold** (PR #118): `/eventday` retired — the Event-dag cockpit is the desktop Deur
  tab inside `/app` (`EventDayCockpitGate` lazy in `src/components/po/app.tsx`, event
  choice shared via `doorEventId`); `/eventday` redirects to `/app`.

## 2026-07-06 — Stripe Billing fase 13 + tiers editor

- **Billing (decision #32) all 3 PRs merged + prod-live** (#109/#113/#115; migrations
  `20260706120000` + `20260706130000`): webhook route + `stripe_webhook_events` ledger +
  service_role-only RPC `apply_stripe_subscription_update` (replay mutates nothing;
  security-reviewed, no findings); checkout/portal buttons + trial nudge + `isNativeShell()`
  seam; soft-block gating (`src/features/billing/gate.ts`) on
  create-event/from-template/invite/import + `useBillingBlocked()` UX locks +
  customer-mismatch guard. The door outbox and guest mutations on planned events are
  deliberately never gated. Pilot venues set to `comped` (never overwritten by webhook
  state — guard in the RPC). Setup + test-mode script: `docs/stripe-setup.md`; go-live
  checklist ClickUp `86ey6bga8`.
- **Tiers editor — feedback 1/7 T3** (PR #116, migration `20260706140000`): Free/Paid
  toggle replaces the single "door price" field; paid tiers carry display-only VAT-%
  (`guest_tiers.vat_percent`/`event_template_tiers.vat_percent`, default 9); palette 6→11
  (`src/lib/po/tier-colors.ts`) with in-event duplicate-color disable + reuse-with-warning;
  explicit Save / Save & add another / Cancel; empty state = "+ Add your first tier" CTA.
  The compact create-tier-on-the-spot flow got the same fields. Also fixed
  `create_template_from_event` silently dropping `door_price_cents`.

## 2026-07-01 → 07-03 — MFA fully optional + T1 auth/onboarding

- **MFA (TOTP) fully OPTIONAL for every role incl. admin/finance** (decided 2026-07-01,
  shipped 2026-07-02, T1 `86ey4j1dz` PR c; migration `20260702120000_mfa_fully_optional`,
  supersedes `20260624160000_mfa_scope_sensitive_actions`). Rationale (Max, trade-off
  accepted deliberately): forced MFA = onboarding friction that risks losing customers;
  passwordless OTP already gates access. No hard gate and no AAL2 requirement in RLS
  anywhere — invite / revoke-invite / member add-remove-rolechange / remote-logout are
  role-only. Admin/finance get a skippable recommendation on app entry (`recommendMfaIfDue`
  → `/mfa/enroll`, snooze persisted on `user_profiles.mfa_snooze_until`). Backlog
  counterweight: venue-policy "require MFA" toggle (`86ey4uv97`).
- **T1 auth/onboarding 3-PR stack** merged + prod-live 3/7 (#102/#103/#104): sign-out +
  sessions dedupe, one-flow invite via `/auth/confirm` templates, MFA optional + snooze.

## 2026-06 — Foundation (surface unification, perf, QA, settings)

- **Surface unification (PR #50, 2026-06-21):** the desktop `(app)` dashboard and mobile
  `po /app` collapsed into ONE responsive surface at `/app`; old routes redirect; po
  screens wired live via `src/features/po/`. Supersedes the launchplan's
  viewport-switch/"Strategy A" framing.
- **Settings polish #39 (S4.1–S4.3, PR #56, 2026-06-22):** invite role-chips with nothing
  pre-selected + admin can assign invitee as organizer of upcoming events
  (`invites.event_ids`, granted by `accept_pending_invites()`; migration `20260622120000`);
  sessions label shows OS (`deviceLabel`, `src/lib/ua.ts`); BTW/company grid overflow ≤390px
  fixed; load spinners; optional roles can self-enable/disable MFA.
- **Performance STAP 3.5 (baseline `perf-baseline-3.5a.md` + fixes via PR #53/#54):**
  ranged reads (fixes the 1000-row PostgREST truncation that hid ~532 guests at the door),
  realtime throttle 10→200 eps + refetch-on-reconnect, list virtualization + search
  debounce, `/app` code-split + eventday first-paint + deur-CLS. Backend write baseline:
  495 check-ins/sec, p95 13 ms. **Scale-track linchpin shipped** (PR #59/#60 + wiring):
  `check_ins`/`refusals` carry `event_id`+`venue_id` (`set_checkin_scope` BEFORE-trigger),
  SELECT-policies collapsed to one membership check on indexed `venue_id`, realtime
  subscriptions filter `event_id=eq.X`. Remaining (parked, not an MVP blocker):
  `postgres_changes`→Broadcast, polling/caching trims, hosted load-test
  (`scripts/perf/realtime-loadtest-hosted.mjs`); progress record `perf-scale-track-3.5.md`.
- **Testen & QA STAP 4.1 (2026-06-23, `docs/test-report.md`):** Vitest 39 files/434 tests +
  pgTAP 22 files/529 tests green on a fresh `supabase db reset`; lint + type-check clean.
  Added: offline-outbox `refusal`/`ack_note` replay (8/8 kinds) + status helpers + a
  secret-grep guard keeping the `service_role` key out of client code (runs in `pnpm test`
  CI). Open at the time: no line-coverage metric, server `actions.ts` only indirectly
  covered, e2e core flow = STAP 4.3 (now Prod-ready task 04).
