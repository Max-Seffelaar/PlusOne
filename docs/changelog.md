# Changelog — shipped-phase history

Session-end status reports live here, **newest first**. CLAUDE.md holds only current
invariants and open work; when a task ships, its narrative (PRs, commits, root causes,
gotchas) is appended here instead of CLAUDE.md. Older history than this file covers:
`launchplan-claude-code.md` (STAP 0–4 framing), `docs/test-report.md`, the `perf-*.md`
records (repo root), and `engineering-review-2026-07.md`.

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
