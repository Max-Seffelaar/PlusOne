# Changelog — shipped-phase history

Session-end status reports live here, **newest first**. CLAUDE.md holds only current
invariants and open work; when a task ships, its narrative (PRs, commits, root causes,
gotchas) is appended here instead of CLAUDE.md. Older history than this file covers:
`launchplan-claude-code.md` (STAP 0–4 framing), `docs/test-report.md`, the `perf-*.md`
records (repo root), and `engineering-review-2026-07.md`.

---

## 2026-09-25 — Fase 17 N1 leftovers: kit copy/external-link helpers in auth + onboarding

Closes the three leftovers the 86ey6bfam N1 task fenced out (see that entry
below). No migration, no dependency change.

- **`MfaEnrollCard.tsx`**: the TOTP-secret copy button used a bare
  `navigator.clipboard.writeText` wrapped in its own try/catch + local
  `useTransientValue` state. Switched to the kit's `useCopyText` +
  `copyStateLabel`, so a blocked clipboard (some webviews, insecure contexts)
  now shows the shared "Couldn't copy" label instead of silently staying on
  "Copy" forever. The secret stays visible/selectable either way (unchanged
  fallback). `MfaEnrollCard.test.tsx`'s clipboard-unavailable case now asserts
  the failure label instead of "no crash, stays on Copy".
- **`ConsentScreen.tsx`** and **`VenueStep.tsx`**: terms/privacy links were
  bare `<a target="_blank" rel="noreferrer">`, same trap `screens/onboarding.tsx`
  already fixed in N1 (`ExternalLink` — Capacitor's remote-URL webview loads
  `_blank` INSIDE itself with no way back). Both links sit inside the `<label>`
  wrapping the consent checkbox; `ExternalLink`'s `preventDefault()` on a plain
  click already stops the label's own toggle action, so no extra handling was
  needed — verified with a dedicated test per screen (link has no `target`
  attribute, and clicking it leaves the checkbox unchecked).
- Repo-wide grep for `target="_blank"` / `window.open(` / `navigator.clipboard`
  outside `kit.tsx` turned up nothing else in `/app`, `/consent`, `/mfa`,
  `/login` or onboarding — `screens/settings/venue.tsx` was already on
  `ExternalLink` (the "known leftover" note under N1 below was stale).
  `landing-frame.tsx` (public `/e`/`/r` footer, browser-only surface — app
  links never claim `/e/*`, plan decision 11) is left as-is, same as N1.
- Tests: `MfaEnrollCard.test.tsx` (updated), new `ConsentScreen.test.tsx` and
  `steps/VenueStep.test.tsx` (2 cases each, pattern from `kit.webview.test.tsx`).

---

## 2026-09-24 — Fase 17 N1: webview-prep kit helpers (86ey6bfam)

Golf 1 of Fase 17. No migration, no dependency change.

- **`copyText(text): Promise<boolean>`** in `src/components/po/kit.tsx`: Clipboard
  API → legacy `execCommand('copy')` on a detached textarea → `false`. Never
  throws, guards `navigator`/`document`. Plus `useCopyText(ttl)` (built on
  `useTransientValue`) and `copyStateLabel()`: the copy button shows "Copied!"
  or the new `t.shared.kit.copyFailed` ("Couldn't copy"). Before this, all six
  sites failed silently. Rewired: `landing.tsx`, `influencer-stats.tsx`,
  `screens/events/edit.tsx`, `screens/promotion/{roster,create-link-flow,event-links}.tsx`
  (event-links has two: row + QR sheet). One behaviour change: the create-link
  "done" sheet's "Copied" label used to stay on. It now reverts after 1.8s,
  the same as every other copy button.
- **`openExternal(url)`** + **`ExternalLink`** primitive: `window.open(url,
  '_blank', 'noopener,noreferrer')` in the browser. In the native shell it calls
  the in-app browser through the `window.Capacitor.Plugins.Browser` global the
  runtime injects (no import of the not-yet-installed `@capacitor/browser`).
  `TODO(N3 86ey6bfdm)` swaps it for the typed import. `screens/onboarding.tsx`
  terms/privacy links now use `ExternalLink` (href kept, no `target`).
- `viewportFit: 'cover'` in the root `viewport` export, so `env(safe-area-inset-*)`
  stops reading 0 on iOS.
- `next.config.js`: comment-only CSP wrap notes. Prod `script-src` already
  carries `'unsafe-inline'`, so the Android bridge injection is not expected to
  be blocked today. If N3 proves otherwise, the fix is a hash/nonce.
- Tests: `src/components/po/kit.webview.test.tsx` (12 cases).

**Known leftovers, outside this task's scope fence:** `src/features/auth/components/MfaEnrollCard.tsx`
(bare clipboard); `target="_blank"` in `screens/settings/venue.tsx` (website
field ×2, reachable in the native app), `landing-frame.tsx` (public footer),
`features/auth/components/ConsentScreen.tsx` and
`features/onboarding/components/steps/VenueStep.tsx` (terms/privacy). The shell
has no `safe-area-inset-top` padding anywhere, only bottom (`shell.tsx`).
Because Next merges `viewport` per key, `cover` also reaches `/e`, `/r`, `/i`.
Those pages don't pad for safe areas; the impact is landscape iPhone only.

---

## 2026-09-24 — P-06 seed part: Max and Joeri as platform admins (z8uq9m0tny)

The other half of P-06 (docs part landed in PR #328). Migration
`20260924130000_seed_platform_admins.sql` flips `user_profiles.is_platform_admin`
to true for exactly two PlusOne operator accounts Max confirmed as existing,
confirmed, prod accounts with a `user_profiles` row already in place and the
flag currently false. No other account.

**This repo is PUBLIC — no e-mail address in it, corrected mid-session.** The
first version of this migration matched on the literal addresses and got
(rightly) refused at commit time. Rewritten to match on
`encode(extensions.digest(lower(email), 'sha256'), 'hex')` instead — the two
hex hashes are the only trace of the addresses anywhere in the repo, computed
and hashed outside it. **Framing corrected in review:** this is
scraper-resistance, not confidentiality — an unsalted sha256 of a plausible
address is crackable in seconds by hashing a candidate list, so "no address
anywhere" is true but "the addresses are secret" would not be. `pgcrypto`'s
`digest()` is assumed already present in schema `extensions` (bundled on the
Supabase Postgres image, confirmed locally); the migration does **not**
re-issue `create extension if not exists ... with schema extensions` —
review caught that `IF NOT EXISTS` silently ignores `WITH SCHEMA` when the
extension already exists elsewhere, so the statement is not the safety net
it looks like and was dropped rather than left in as decoration.

**Why not `public.set_platform_admin()`.** The RPC (P-02) requires an EXISTING
platform admin caller — it re-checks `is_platform_admin()` on the session
itself — which is exactly the chicken-and-egg this migration resolves for the
FIRST admins. Follows the bootstrap path `20260923120000_platform_admin.sql`'s
header documents instead: the transaction-local GUC
`plusone.platform_admin_write = 'on'` set immediately before the `UPDATE`,
cleared immediately after — the guard trigger applies to every role,
including the migration runner, so skipping it is not an option.

**The match/write/audit logic is one helper,
`public.seed_platform_admin_by_email_hash(p_hash text)`** — SECURITY DEFINER,
`search_path = ''`, EXECUTE revoked from `public`/`anon`/`authenticated`/
`service_role`, so only the owner (migrations, and the pgTAP suite, which
runs as the same owner) can call it. Factored out for exactly one reason: it
lets the test file prove the logic against a fixture hash without a real
address anywhere in it either. Resolves a hash to a `user_profiles.id` via an
`order by created_at, id` (tiebreaker added in review), `deleted_at is null`
pick of `auth.users` (defensive shape borrowed from
`platform_invite_stage_rows()`'s LATERAL match, minus the LATERAL itself —
`user_profiles.id = auth.users.id` directly here, so a scalar subquery is
enough).

**Review round (fresh-session `/code-review`): NEEDS CHANGES, both MAJOR
findings about the helper going quiet on exactly the cases that matter.**
1. It was `returns void` and treated "no match" as a silent no-op — if either
   hash were wrong (typo, trailing newline, wrong address), the migration
   would apply cleanly and grant nobody, with a manual `SELECT` afterwards as
   the only way to notice. Fixed: the helper now `returns text`
   (`'matched'` / `'already'` / `'missing'`), and the migration body wraps
   both calls in a `do $$ ... end $$` block that `raise warning`s on
   `'missing'` — surfaced in `supabase db push`'s own output, never a hard
   failure (the local/CI case, where neither address exists, must stay a
   no-op).
2. An `auth.users` row matched by hash but with NO `user_profiles` row
   collapsed into the exact same silent "no-op" as "no account at all" —
   but that combination should never happen and is a real data anomaly, not
   a normal local/CI case. Fixed: the helper now resolves the `auth.users`
   id into its own variable first; if that is non-null but the profile
   lookup comes back null, it `raise exception`s (default `P0001`) instead
   of returning.

Both findings share one root cause: conflating "this environment doesn't
have that account" (expected, must be silent) with "something is actually
wrong" (must be loud) into the same return path. Splitting them into three
distinct outcomes is the actual fix, not just the warning/exception wording.

No matching row → `'missing'`, warned, never an error (true for every
local/CI database, since these are prod-only addresses). Already flagged →
`'already'`, silent no-op, so calling it again (a second migration run, or a
`supabase db reset` re-applying it) never double-writes.

**Audited on name, same as the RPC.** One `audit_log` row per actual flip:
`entity_type = 'user_profiles'`, `action = 'platform_admin_grant'`, the same
`before`/`after` diff shape `set_platform_admin()` writes. `actor_id` is
`null` — a migration has no calling session/`auth.uid()` — matching the
existing "system action" convention (the anonymization job, #29). `venue_id`/
`event_id` are also `null`, so — like every `set_platform_admin()` row —
these two rows are readable only by a platform admin.

**Testing.** `supabase/tests/database/seed_platform_admins.test.sql` grew from
9 to **17 assertions** in the review round (fixture addresses only, no real
one anywhere): calling the helper with a fixture hash returns `'matched'`,
flags the account and audits the grant; calling it again returns
`'already'` (idempotent — same state, no error, no duplicate audit row); a
hash matching nothing returns `'missing'`, never raises; an `auth.users` row
with no `user_profiles` row makes the helper raise instead of returning
(`throws_ok`, `P0001`) — the MAJOR-2 fix, proved directly; the
transaction-local GUC is asserted `'off'` right after a successful call, and
a direct `UPDATE` immediately afterwards still throws `42501` — same
invariant `platform_admin.test.sql`'s F4/F5 prove for `set_platform_admin()`
itself (MINOR-3); a fixture whose hash was never passed in is never flagged;
the helper has no EXECUTE grant for `authenticated`/`anon`/`service_role`;
all six real local seed users (`admin@plusone.test` and friends) are still
`false` after the reset that ran this migration for real —
`platform_admin.test.sql` depends on that exact fact (`admin@plusone.test`
is its "venue admin who is NOT a platform admin" fixture) and stays green.
Full suite after a clean `supabase db reset`: pgTAP **67 files / 1555
assertions PASS**. `pnpm lint` and `pnpm run type-check` clean — no
schema/type change, so `src/lib/database.types.ts` is untouched.

**Two more MINOR fixes from the same review.** The header comment now states
explicitly that the transaction-local GUC needs no exception handler to
close again — Postgres discards all transaction-local `set_config` state
when the aborting (sub)transaction rolls back, so an explicit cleanup path
would be redundant work someone could later "simplify" into a real bug. It
also now names the trade-off the helper leaves behind: it stays in the
schema permanently after this migration runs, deliberately bypasses
`set_platform_admin()`'s own `is_platform_admin()` check, and writes
`actor_id = null` — exactly what a hash-driven bootstrap needs, reachable
only by the DB owner (never any app role, EXECUTE already revoked from all
of them), which the review confirmed is an acceptable, explicitly-stated
trade-off rather than an oversight.

**Not touched, per the task's context budget:** `scripts/dev-mfa.mjs` and
`supabase/seed.sql` — the local `admin@plusone.test` platform-admin fixture
stays exactly as P-04 left it.

**Verifying after the prod push (for whoever runs it):** query
`select email from auth.users where encode(extensions.digest(lower(email), 'sha256'), 'hex') in (<the two hashes from the migration file>)`
joined to `user_profiles.is_platform_admin` — the PR body carries the exact
two hashes so this can be run without opening the migration file.

**Milestone:** Now (open beta) — closes out the P-02..P-06 platform-admin
program.

---

## 2026-09-24 — P-06 docs part: platform-admin invariant + decision #49 (z8uq9m0tny)

Docs-only half of P-06. The seed part (idempotent migration flipping
`is_platform_admin` for Max's and Joeri's production accounts) is **not built in
this PR** — their production login e-mails were not available in this session and
guessing them is exactly the kind of silent deviation CLAUDE.md forbids. See "Seed
part pending" in the PR body; a second commit picks it up once Max supplies the
addresses.

**Numbering correction.** P-02/P-03/P-04/P-05 all announced this decision as
"decision #41" (CLAUDE.md #1's exception clause, and the "stays with P-06" note
at the end of the P-02 entry below) — but `gastenlijst-app-spec.md` already had
#41 assigned to the surface-unification decision (PR #50, 2026-06-21), and the
table runs to #48 as of the Joeri-walkthrough entry. Filed as **decision #49**
instead; CLAUDE.md #1's exception clause now points at a new "Platform admins"
subsection instead of restating the mechanism inline, so the invariant and the
spec entry cannot drift apart the same way twice. The stray "#41" references
inside `src/`, `tests/`, `README.md`, `launchplan-claude-code.md` and
`ux-walkthrough-2026-07-02.md` are out of this docs-only PR's touched-file scope
(CLAUDE.md, `gastenlijst-app-spec.md`, `docs/changelog.md`,
`docs/auth-setup.md` only) — flagged in the PR body for a follow-up.

**What shipped.**
- CLAUDE.md: new "Platform admins (decision #49)" subsection (outside
  `venue_role[]`, RLS is the boundary, cross-tenant writes audited on name /
  reads not, MFA deliberately not required yet, bootstrap path, `pnpm dev:mfa`
  local fixture, PlusOne Admin-venue = ordinary venue-creation flow); item #1's
  exception clause shortened to reference it; the stale "(#1–#39)" decision-range
  pointer in the intro corrected to "(#1–#49)".
- `gastenlijst-app-spec.md`: decision **#49** — system admin + `platform_invites`,
  open beta, same facts as CLAUDE.md plus the open items P-03 already flagged and
  never closed (revoke = row-stamp only, no AVG retention on prospect PII in
  `platform_invites`, no read-audit of support sessions).
- `docs/auth-setup.md`: one reference to the platform-admin bootstrap SQL, next to
  the invite-only signup section.

**Milestone:** Now (open beta) — same program as P-02/P-03/P-04/P-05.

---

## 2026-09-24 — P-05 Platform: venue overview + audit viewer (z8uq9m0tnx)

The other half of the operator console: which companies exist, jump into one to help,
and see back who did what — with a name, across every venue.

**What shipped.**
- Migration `20260924110000_platform_venue_audit_overview.sql` — five SECURITY DEFINER
  RPCs, all `authenticated`-only and re-checking `is_platform_admin()` in their own body
  (same shape as P-03's `platform_invite_overview`), no new table so no grant-matrix
  entry: `platform_venue_overview`/`_count` (member/event counts, subscription status,
  last activity, one GROUP BY-shaped query, windowed + searchable), `platform_venue_options`
  (id+name, capped 500, for the audit filter's venue picker), `platform_audit_overview`/
  `_count` (filterable by venue + period, windowed, `is_support_action` computed in SQL —
  the actor holds no CURRENT `venue_memberships` row at the audited venue).
- Two screens under Platform: `screens/platform-venues.tsx` (search + paged cards, each
  with "View audit" and "Switch into this venue") and `screens/platform-audit.tsx`
  (venue/period filter bar, mobile cards + desktop table, the diff rendered as **plain
  text only** — never `dangerouslySetInnerHTML`, it can carry any free-form input from
  anywhere in the product). Both self-gate on `usePoIsPlatformAdmin()` exactly like the
  Platform tab itself, so a bookmarked URL for a non-admin fires no read.
- Routes: `/app/platform/venues`, `/app/platform/audit` (+ `?venue=` pre-scope from a
  venue row's "View audit") via `routes.ts`/`context.tsx`'s `ScreenName` union;
  `nav-map.ts` maps both to the `platform` sidebar entry and into `WIDE_DESKTOP`; lazy
  chunks in `app-screens.tsx` like the rest of the Platform surface.
- New kit primitive `PageNav` (prev/next + "X of Y" for a windowed offset/limit read).
- Data: `fetchPlatformVenueOverview(Count)`/`fetchPlatformAuditOverview(Count)`/
  `fetchPlatformVenueOptions` in `queries.ts`; `toPlatformVenue`/`toPlatformVenueOption`/
  `toPlatformAuditEntry` in `adapters.ts`; `usePoPlatformVenues(Count)`/
  `usePoPlatformAudit(Count)`/`usePoPlatformVenueOptions` in `hooks.ts`.

**The "jump in to help" wiring — the one part that touched auth, not just the Platform
surface.** "Switch into this venue" reuses the EXISTING `switchToVenue` (no bespoke
mechanism, per the task), but that action refused a platform admin outright for any venue
they hold no real membership at — which is the common case, and the whole point of the
feature. Three small, isolated changes make it actually land the admin in the venue:
- `switchActiveVenueAction` (`src/features/venues/actions.ts`) falls back to
  `getPlatformAdminVenue()` (new, `src/lib/auth/memberships.ts`) when the caller isn't a
  member — it re-checks `is_platform_admin()` itself and confirms the venue exists.
- `resolveActiveVenueId` still only ever returns an id from the caller's real
  `accessVenues` (unchanged, untouched signature) — the cookie is instead read directly
  via new `getActiveVenueCookieValue()` (`active-venue.ts`) and layout.tsx re-validates it
  through the same `getPlatformAdminVenue()` before building a synthetic `roles: []`
  membership.
- **Known, documented limitation, not new here:** that synthetic membership is the SAME
  shape `getOrganizerVenues()` already hands external crew — every locally role-gated
  button (`venueCapabilities(roles)`) stays off even though RLS would allow the write,
  because those checks read client-side `roles`, not `is_platform_admin()`. A platform
  admin who switches in today gets read access and whatever screens don't role-gate
  locally; broadening capability-gating for cross-venue support is a P-02-scope decision,
  not something this PR expanded into.
- `roleLabel` in `layout.tsx` says "Platform admin (support)" instead of the misleading
  "External crew" when this fallback fires.

**Testing.** pgTAP `supabase/tests/database/platform_venue_audit_overview.test.sql` (55
assertions after the review round below): a platform admin reads venues/audit rows he
holds no membership at, member/event counts and subscription status aggregate correctly
(including the zero/null case for an empty venue), search + windowing (`p_limit`/
`p_offset`, an absurd limit capped, `*_count` matches, negative/zero clamps), the audit
feed's venue + period filters, `is_support_action` true for the platform admin's own
action at a venue he isn't a member of / false for a real member's action at their own
venue / false for a null-venue action, pagination stability across rows with an identical
`created_at`/venue `name` — and every other role (admin, user_manager, finance, staff,
doorhost, organizer) plus anon get zero rows or 42501 from all five functions individually,
both sides. Full suite re-verified on the same reset: pgTAP 66 files / 1538 assertions
PASS. Vitest: adapter + screen-visibility files (no-admin fires no read, matching
`platform-tab-visibility.test.tsx`'s pattern) + `layout.test.ts` cases for the
platform-admin cookie fallback. `pnpm run type-check` and `pnpm lint` clean.

**Review round (fresh-session `/code-review` + `/security-review`, same PR, before merge).**
Security review: SAFE TO MERGE (the auth widening holds — 12 direct RPC calls as a
non-platform-admin all returned zero rows, anon got 42501). Code review: NEEDS CHANGES,
fixed in follow-up commits, not a new migration (the schema hadn't reached prod yet):
- **Blocker** — `platform_audit_overview`'s `order by created_at desc` and
  `platform_venue_overview`'s `order by name asc` had no tiebreaker. `audit_trigger()`'s
  `created_at` is the enclosing transaction's `now()`, so a real trigger-batch (several
  guests inserted in one statement) writes several rows with an IDENTICAL timestamp —
  pagination could silently duplicate or drop a row as `p_offset` advanced. Fixed by
  adding `, id desc` / `, id asc`; two same-`created_at`/same-`name` fixtures + a
  disjoint-and-complete pgTAP assertion prove it.
- **Major** — the platform-wide (no venue filter) path of `platform_audit_overview`/
  `_count` scanned+sorted the whole `audit_log` table with no supporting index (the only
  existing one is the composite `(venue_id, created_at)`, useless without a venue
  predicate). Added `audit_log_created_at_idx on (created_at desc)` in the same migration.
- **Major** — `platform-audit.tsx`'s "From"/"Until" date inputs parsed inconsistently
  (`new Date('YYYY-MM-DD')` = UTC midnight vs `new Date('YYYY-MM-DDT23:59:59')` = local
  time) — fixed to build both as local midnight.
- **Minor fixes**: the platform-admin cookie-fallback branch in `layout.tsx` was untested
  (added 3 cases to `layout.test.ts`, including the negative one — the actual invariant);
  removed two dead i18n keys (`venuesSwitchPending`/`venuesSwitchDenied`); extracted a
  `Select` kit primitive instead of a hand-styled native `<select>`; associated filter
  labels via `Field`'s/`Select`'s `ariaLabel` instead of unlinked `<label>` text;
  `subscription_status` now renders through an i18n label map instead of the raw enum;
  `platform-audit.tsx` keys its console on the `?venue=` pre-scope so a second "View
  audit" tap while already mounted actually resets the filter; `PageNav` no longer
  renders under a loading/error/empty state ("0 of 0"); pgTAP now checks negative/zero
  `p_limit`/`p_offset` clamps and every non-admin role against all five functions
  individually (the PR body claimed that already — now it's literally true); the
  migration header + the support-badge copy both now say the flag is indicative, not
  forensic, since a platform admin's own `is_platform_admin()` already satisfies
  `venue_memberships_insert`'s role check at ANY venue, so they could self-insert a real
  membership and un-flag their own past support rows (itself audited, not silent).
- **Corrected claim**: the original PR body asserted `venue_memberships_insert`/`_update`/
  `_delete` still required AAL2, in tension with CLAUDE.md's "no AAL2 requirement in RLS
  anywhere." Verified against the LIVE schema (`pg_policy`, not just grepping migration
  files — `20260702120000_mfa_fully_optional` had already dropped `is_aal2()` from all
  three): zero policies on `venue_memberships` reference `is_aal2()` today. Claim
  retracted; the stale `audit_log_select_aal2` comment in `queries.ts`'s
  `fetchPoAuditFeed` header (a real, if unrelated, doc drift spotted while writing that
  claim) is fixed in the same pass since the file was already touched.
- **Parked, not built** (follow-up, not this PR): the read-only cross-venue switch writes
  no audit row — reads are never audited anywhere in this codebase, a standing scope
  decision, not a gap specific to this feature; `platform_venue_options`'s 500-row cap has
  no UI signal if a platform's venue count ever approaches it.

**Milestone:** Now (open beta) — same program as P-02/P-03/P-04.

---

## 2026-09-24 — Only submit_guest_request may create a landing request (F-3)

Branch `claude/guest-requests-insert-revoke`. Milestone: **Now**, a live RLS/grant gap on
prod. Migration `20260924100000_guest_requests_revoke_client_insert.sql` — first written
as `20260923120000`, renamed when P-02 landed `20260923120000_platform_admin.sql` on the
same timestamp while this PR sat open. A duplicate breaks `db push`/`db reset`, so the
new name also sorts past P-03's `20260923150000`. Second time in a week the rule bites
(the L5 entry below has its own rename), and both times the collision appeared *after*
the branch was cut — the timestamp check belongs immediately before merge, not only when
the file is written. High-risk surface (RLS + grants), so the PR body carries an
adversarial security-research prompt.

**Review gate: not used, on Max's explicit call.** CLAUDE.md asks for a fresh-session
`/code-review` + `/security-review` on this surface, and PR #310 — the directly preceding,
near-identical change — went through it. Here Max decided on 24/9 that the two SQL
statements did not warrant it and asked to merge; no review landed on the PR
(`reviewDecision` empty, zero reviews). Recorded because the two questions the prompt
raises are still unanswered: whether an attacker can *cause* the squat shape through
retention rather than a direct insert, and what the status-mirror branch does when someone
submits on a victim's e-mail first. Neither is created by this change — both predate it —
but neither was ruled out either.

**The bug.** `docs/security-audit.md` F-3, found by the fresh-session security review of
PR #310 (19-9), pre-existing, deliberately kept out of that PR so the L5 fix could reach
prod unchanged. `authenticated` held a table-wide INSERT grant on `guest_requests` and
`guest_requests_insert_public` pinned only `status = 'pending'` + a landing-active,
non-cancelled event (+ an open `request_link` when one is named). No role, no ownership,
no column. So any logged-in user could POST straight to `/rest/v1/guest_requests`.
Reproduced as **staff** — a role with no decide rights and no SELECT on the table — on
their own venue's seed event, on the shared local stack, in rolled-back transactions:

- **Silent suppression.** A row with `status = 'pending'`, `anonymized_at = now()` and the
  victim's e-mail as `dedupe_key` is invisible in the approvals inbox (`fetchGuestRequests`
  filters `anonymized_at is null`) yet still occupies `guest_requests_dedupe_idx`. The real
  applicant's submission then trips that index, and the dedup branch skips anonymized rows
  (`20260918160000`), so no status mirror is written either. Measured:
  `submit_guest_request` answers `{"status": "ok", "auto_approved": false}`, `real request
  stored: 0`, `/r/[token]` answers `{"found": false}`. Silent on both sides by
  construction — #28 makes a duplicate indistinguishable from a new request on purpose.
- **E-mail oracle.** `insert … on conflict do nothing` against that index: measured
  `DID apply -> inserted 0`, `did NOT apply -> inserted 1` (plain insert: `23505` vs
  success). That is the exact fact `guest_requests_select` withholds, readable by a role
  whose own `select count(*) from guest_requests` returns 0.
- **Validation/throttle bypass.** The RPC's throttle, honeypot, format checks and
  `left(motivation, 1000)` live in the function, not the table: `email = 'x'`,
  `phone = null`, `plus_ones = 99`, `junk rows planted: 500` in one statement.

Already closed before this migration and unchanged by it: cross-venue insert (`42501`),
forged `venue_id` (shared BEFORE trigger, `20260713160000`), attributing to a
`request_link` the caller cannot see.

**The fix.** `revoke insert on table public.guest_requests from authenticated` — the other
half of `20260707170000` (C2), which did the same for `anon` and left `authenticated`
without stating why — and `guest_requests_insert_public` **dropped**, not narrowed.
Reasoning, in the migration header: after the revoke neither of the policy's roles holds
INSERT, so a predicate in it is decoration, and it buys nothing against the one way the
grant returns (a blanket `grant all …` / stock default ACL, the `20260917100000`
mechanism) because RLS with **zero** applicable INSERT policies already denies every
client insert — the absence *is* the guard. A restrictive `false` policy would differ but
would also block any future legitimate insert policy. Intent moved to `comment on table`.
Checked before dropping: it was the table's only `FOR INSERT` policy and nothing else
referenced it.

**Why it is safe.** `src/` has no `.from('guest_requests').insert`/`.upsert` at all (two
SELECTs in `src/features/po/queries.ts`, the deny UPDATE in
`src/features/requests/actions.ts`); checked across `src/`, `scripts/` and
`supabase/functions/`. The table is not FORCE ROW LEVEL SECURITY, so `submit_guest_request`
(and approve / auto-approve / retention) run as the owner past both the grant and the
policy; the seed and pgTAP fixtures are superuser; `scripts/perf/scale-audit.mjs` is
`service_role` (BYPASSRLS). Pure contract step — no released app version inserts, so a
rollback keeps working.

**Grant matrix now** — `anon`: nothing · `authenticated`: table SELECT + UPDATE on
`status, decided_by, decided_at, decision_reason` (`20260919150000`) · `service_role` and
owner: unchanged.

**Tests.** New `guest_requests_insert_revoke.test.sql` (29): grant/policy layer incl.
catalog-driven "no `FOR INSERT` policy exists" and no column-level INSERT; the squat, both
oracle forms and the 500-row batch refused `42501` for staff, admin, organizer, doorhost
and anon; the previously suppressed applicant now stored with `{"found": true}` on their
own name; and the legit paths — anon submit, silent dedup, auto-approve,
`approve_guest_request`, the client deny, retention, the seed's privilege level,
`service_role`. `grant_matrix.test.sql` +2 (13 to 15). `venue_id_rls_integrity.test.sql`
S1d rewritten: the client insert is `42501` (it used to comment that *any* logged-in user
could do it) and the `venue_id` trigger half moved to the owner path, plan 8 to 9.
Re-pointed for the same reason: `guest_requests_decide.test.sql` A3 (asserted INSERT
*unchanged*; now asserts it is gone) and `venue_scope_denormalization.test.sql` 2d (its
fixture inserted as staff).

Ran per file in one rolled-back transaction on the shared local stack, with
`20260919150000` (which that DB lacks) + the new migration prepended. Failing files:
`analytics`, `auth.invites`, `guests_added_by_bind`, `onboarding`, `quota`, `rls` — all
fail identically **without** the new migration (baseline verified), data drift in the
shared DB. `npx tsc --noEmit` clean, `next lint` clean (2 pre-existing a11y warnings in
`datetime-field.tsx`). Vitest 1725/1735; the 10 failures are in
`pre-push-hook-is-executable`, `pgtap-plan-run-gate` and `datetime-field.datefield` —
Windows/worktree environment (absolute `core.hooksPath` from the worktree-local config;
"Could not run `supabase test db`"), and the diff is SQL-only, so no TS test can be
affected by it. CI runs on a fresh reset.

## 2026-09-23 — P-04 Platform tab: invites + status in the app (z8uq9m0tnw)

The UI on top of P-03: a **Platform** entry in `/app` that only a platform admin sees,
where a customer is invited with nothing but an e-mail address and the funnel is visible
without opening the Supabase dashboard. **No migration and no schema change at all** —
P-02/P-03 already shipped everything this needs; the only DB-adjacent edit is one
local-dev line in `scripts/dev-mfa.mjs` (see below).

**What shipped.**
- Route + nav: `screenPath('platform')` → `/app/platform`, `parseAppUrl` the inverse (G1,
  a real bookmarkable URL); `navKeyForScreen` gets its own `platform` key and the screen
  joins `WIDE_DESKTOP`. Lazy chunk in `app-screens.tsx` like Stats/Audit — a venue user
  never downloads it.
- Visibility: `usePoIsPlatformAdmin()` (one cached select on the caller's own
  `user_profiles` row) read in **`app-chrome.tsx`**, beside the other chrome reads and
  never in the shell root, so it cannot reach the door subtree (86eykm76k). Desktop
  sidebar entry + a mobile-only More-hub row (the M5 de-duplication rule).
- Screen `src/components/po/screens/platform.tsx` (381 LOC): invite form (e-mail +
  optional note), a SQL-aggregated funnel strip, and one card per invite with its stage
  track, company/event chips, the operator note **as plain text**, Resend and Stop
  following up (with a confirm sheet).
- Data: `fetchPlatformInvites` / `fetchPlatformFunnel` / `fetchIsPlatformAdmin` in
  `queries.ts`, ONE adapter (`toPlatformInvite` + `toPlatformFunnel`) in `adapters.ts`,
  hooks in `hooks.ts`, and three mutations wrapping the P-03 server actions unchanged.
- New kit primitive `StatTile` (one number + its label), used six times by the funnel.
- New i18n surface `src/lib/i18n/surfaces/platform.ts`.

**Two things worth remembering.**
- **Runtime nullability.** The type generator marks every `RETURNS TABLE` column
  non-null while `user_id`, `confirmed_at`, `last_sign_in_at`, `note`, `revoked_at`,
  `revoked_by` and `invited_by_name` are nullable in reality (PR #325). `PlatformInviteRow`
  narrows them by hand and the adapter normalises them, so no screen has to know.
- **Revoke is honest about what it does.** Revoking marks the row only: the invitee keeps
  a valid link and can still sign in and create a company (PR #325, follow-up F1). The
  button therefore says **"Stop following up"** with the helper line "Stops resends and
  hides them from the funnel. It does not block sign-in." All of that is one block in the
  i18n surface, so it is a copy edit if Max decides revoke should really close the door.

**Local dev — and where that flag may NOT live.** `scripts/dev-mfa.mjs` (`pnpm dev:mfa`,
so also `pnpm db:fresh`) now flips `is_platform_admin` on `admin@plusone.test`,
idempotently, through the `plusone.platform_admin_write` GUC the P-02 guard accepts.
It started out in `supabase/seed.sql` and **CI caught that**: the pgTAP suite runs
against the seeded database and uses that exact user as "a venue admin who is NOT a
platform admin", so the seed line turned 14 assertions in `platform_admin.test.sql` red
and knocked `platform_invites.test.sql` off its plan. `dev:mfa` is local-dev-only, so
the tab survives a reset and the DB tests never see the flag. The prod platform admin
is P-06.

**Gotcha that cost real time.** The Browser-pane preview started a dev server against the
**main checkout** while claiming the worktree's port; `/app/platform` rendered Home and
the sidebar had no Platform entry, with correct source on disk and green unit tests. The
tell was the Turbopack chunk names (`Documents_GitHub_PlusOne_src_…`, no
`_claude_worktrees_…`). CLAUDE.md's "a port is a checkout, not a PR" applies to the
preview tool too: check the chunk paths before believing a screen is broken.

---

## 2026-09-23 — dev-login deep links landing on Home (z8uq9m0jcf)

Branch `fix/z8uq9m0jcf-dev-login-deep-link`. Milestone: **Now** (dev/test loop
correctness; the route 404s in prod). Found while building PR #304: in the fixture
harness, `…/auth/dev-login?email=manager@plusone.test&next=/app/contacts` landed on
Home, while opening `/app/contacts` after login worked.

**Root cause (fixture harness): not the app.** The PR #304 screenshot script was called
from Git Bash as `node hw5-shot.mjs <name> "/app/contacts" …`. MSYS path conversion
rewrote that argument to `C:/Program Files/Git/app/contacts` before Node saw it. The
request that reached dev-login was `next=C%3A%2FProgram%20Files%2FGit%2Fapp%2Fcontacts`.
`safeNextPath` rejected it correctly (not root-relative) and fell back to `/app`. With
`MSYS_NO_PATHCONV=1` the same script lands on `/app/contacts`. The steps that worked had
the path inside a JSON string argument, which MSYS doesn't rewrite. Reproduced both ways
with a request trace on :7100 (fixture) and :7000 (local stack).

**Second cause (local stack): a real one, in dev-login.** On the local stack the clean
URL still ended on Home: `/app/contacts` → `307 /consent?next=%2Fapp`. The seed doesn't
stamp `terms_accepted_at`, so the `/app` layout's consent gate fires, and that gate can
only send users back to bare `/app` (the layout can't see the requested path; documented
trade-off in `src/app/app/layout.tsx`). The real entry routes (`/auth/confirm`,
`/auth/callback`) avoid this by resolving the final hop with `resolveEntryDestination`,
which sends an unconsented user to `/consent?next=<deep link>`. dev-login redirected
straight to `next` and skipped that step.

**Fix** (`src/app/auth/dev-login/route.ts`, dev-only):
- The final redirect now goes through `resolveEntryDestination`, the same as the real
  entry routes. On the local stack: `/consent?next=%2Fapp%2Fcontacts`.
- A `next` that the guard rejects now logs a `[dev-login] ignored next=…` warning in the
  dev-server log instead of silently landing on `/app`. A drive-letter value adds the
  `MSYS_NO_PATHCONV=1` hint.
- The dev gate now compares the Supabase URL's **hostname** (`localhost` / `127.0.0.1`)
  instead of substring-matching the whole URL, which also accepted a real host such as
  `https://localhost.attacker.dev`. Prod was never exposed (the `NODE_ENV` conjunct), but
  any non-prod deploy running `next dev` would have been.
- `safeNextPath` is unchanged here. The new `route.test.ts` (11 tests; 3 fail on the old
  route) covers the forms its literal clauses reject — it does **not** prove the guard is
  airtight: `%09`/`%0A`/`%0D` still pass it and `new URL()` then strips them, which is an
  open redirect on `/consent`, `/login`, `/auth/callback` and `/auth/confirm` too. Found
  by the fresh-session review of this PR; fixed in its own security PR.

**Prod login `next` handling: fine.** `/login?next=` → OTP → `/auth/callback` (or the
e-mail link → `/auth/confirm`) already keeps the deep link through consent.

**The other half, split off and since shipped:** an *already signed-in* user who opened a
deep link while a layout gate was due also landed on Home, after a `TERMS_VERSION` bump or
when the MFA nudge came due, because the layout hard-coded `next=/app`. That needed a
middleware change, so it went to its own session and landed as PR #316 (the
`x-po-request-path` header + `appGateNextPath`, entry below).

**Found by this PR's fresh-session review, fixed separately:** `safeNextPath` let ASCII
control characters through, and the URL parser strips them before resolving, so
`?next=%2F%09%2Fevil.com` resolved to another origin on the production entry routes too.
See the z8uq9m0tp5 entry.

---

## 2026-09-23 — safeNextPath let tab/CR/LF through (z8uq9m0tp5)

Branch `fix/z8uq9m0tp5-next-path-control-chars`. Milestone: **Now** — a live open redirect
on prod. No migration. Found by the fresh-session `/code-review` of PR #314 (z8uq9m0jcf);
pre-existing, not caused by that PR.

**The bug.** `safeNextPath` rejected `//`, `://`, `\`, `..`, `/login` and `/auth/*`, but not
ASCII control characters. The WHATWG URL parser strips those *before* resolving, so a
candidate slipped through every literal check and then changed origin:

```
raw   = '/<TAB>/evil.com'          // passes all five clauses
new URL(raw, 'https://app.plus-one.io/consent').origin === 'https://evil.com'
```

Measured: `%09`, `%0A`, `%0D` and `%0D%0A` all resolve to `http://evil.com`.

**Reach.** The same guard feeds `/auth/callback` (`route.ts:12`), `/auth/confirm`
(`route.ts:34`), `/login` (`page.tsx:18`) and `/consent` (`page.tsx:27`, plus
`ConsentScreen`'s `window.location.replace`). The cheapest exploit needs no token: a
signed-in user clicks `…/consent?next=%2F%09%2Fevil.com` and leaves the origin — a phishing
hand-off carrying our domain as the referrer. `src/middleware.ts` was never exposed: it
copies only `pathname`/`search` onto a clone of `request.nextUrl`, so the origin cannot
move. CR/LF in a Node redirect header throws `ERR_INVALID_CHAR` (a 500, not header
injection); TAB is a legal header byte and redirects cleanly.

**Fix** (`src/features/auth/next-path.ts`): reject the ASCII control range (U+0000 to U+001F, plus U+007F) up front, and add
a backstop that resolves the candidate against a reserved `.invalid` origin and refuses
anything whose origin moves or that will not parse. The backstop is what stops this guard
from depending on the completeness of its own literal checks — the next parser quirk fails
closed instead of open.

**Tests:** `next-path.test.ts` grows the six control-character cases, an off-origin
resolution assertion, and a positive case for encoded characters and a query string, each
asserted through `new URL()` the way the callers use the value. Seven of them fail on the
old guard. Full unit suite green (1735 passed; the 8 failures in `pgtap-plan-run-gate` and
`pre-push-hook-is-executable` are this Windows box — no Supabase CLI, absolute
`core.hooksPath` — not this change).

**Merged with #316 and #318, by union.** #316 added `appGateNextPath`, which calls
`safeNextPath` first, so the `/app` gates inherit this fix. #318 then restructured
`safeNextPath` itself into a decode-to-fixed-point loop against percent-encoded traversal,
landing before this branch. The two fixes close different holes in overlapping lines, so
the resolution keeps BOTH: the control-character clause runs first on the raw value, #318's
loop runs next, and the origin backstop guards the loop's clean exit. Taking either side
alone reinstates a proven one-click attack — `%2F%09%2Fevil.com` if this branch loses,
`/app/%2e%2e/auth/callback` if main does (security review of this PR, 2026-09-23).
---

## 2026-09-23 — P-03 `platform_invites`: invite customers into the open beta (z8uq9m0tnv)

A platform admin (P-02) invites a new customer with nothing but an e-mail address. We
create **no** venue and **no** `public.invites` row — the invitee walks the existing
onboarding wizard, makes their own company, accepts the terms themselves and lands on
`trialing`. `platform_invites` is the outreach record plus the funnel source, never an
access grant. Migration `20260923150000_platform_invites.sql`.

**What shipped.**
- `public.platform_invites` (`id` uuid v7, `email`, `note`, `invited_by`, `created_at`,
  `last_sent_at`, `revoked_at`, `revoked_by`). One OPEN invite per address (partial
  unique index on `lower(email)`); a revoked address can be re-invited.
- RLS: `select` / `insert` / `update` all `to authenticated` with `is_platform_admin()`
  as the only term. Insert pins `invited_by = auth.uid()` and forces the row open;
  update allows resend + revoke only. **No DELETE policy and no DELETE grant** —
  revoking is a soft `revoked_at` stamp, so the audit trail survives.
- Grant matrix stated explicitly (`revoke all … from anon, authenticated` first, then
  `grant select, insert, update … to authenticated`; `service_role` untouched).
- `guard_platform_invite_update()` freezes `id`/`email`/`invited_by`/`created_at` and
  makes a revoke one-way — RLS is row-level, so without it a platform admin could
  re-point an existing row at another address.
- `audit_trigger()` attached unchanged. The table has no `venue_id`, so the generic
  branch writes `venue_id = null`, which is exactly the P-02 shape: a null-venue audit
  row is readable only by platform admins.
- `consume_platform_invite_throttle()` — SECURITY DEFINER wrapper over the internal
  `consume_public_throttle()`; 20 outbound beta mails per platform admin per hour,
  shared by invite and resend. Raises 42501 for anyone else. It is consumed
  immediately before the mail — after validation, after the insert — so a rejected
  address or a duplicate never eats an hour of somebody's quota.
- `platform_invite_stage_rows()` (internal, no app role holds EXECUTE) computes the
  funnel stage once; `platform_invite_overview(p_limit, p_offset)` (windowed, default
  100, hard cap 500) and `platform_invite_funnel()` (GROUP BY over ALL invites) both
  sit on it. Stages: `invited` → `signed_in` → `company_created` → `first_event`, plus
  `revoked`. SECURITY DEFINER is forced by `auth.users.confirmed_at`, which
  `authenticated` cannot read; each re-checks `is_platform_admin()` in its own body,
  EXECUTE is revoked from public/anon/service_role, and a non-platform-admin gets zero
  rows rather than an error (no existence oracle). The `auth.users` match is a LATERAL
  "pick one" filtered on `deleted_at is null`: GoTrue's e-mail uniqueness is partial
  (`where is_sso_user = false`), so a plain join both duplicated invites in the list
  and double-counted them in the funnel.
- `src/features/platform/invite-actions.ts`: `inviteBetaCustomerAction`,
  `resendBetaInviteAction`, `revokeBetaInviteAction`. Every statement runs through the
  USER-scoped client so RLS is the boundary; the app-layer `is_platform_admin()` probe
  is only there for a clear message. Row FIRST, mail after (86ey9ea00 #54).
  `src/features/platform/schemas.ts` holds the Zod input.

**Service role — where and why.** Exactly one place: `sendInviteEmail()` from
`src/features/auth/invite-mail.ts`. `auth.admin.inviteUserByEmail` is a service-role-only
API (it provisions an auth identity) and the magic-link fallback for an already-confirmed
address uses a bare anon client. Nothing in `public` is ever written with the service
client here.

**Review round (fresh-session `/code-review` + `/security-review`, both on PR #325).**
The security review found the DB boundary holding against all 27 attacks it ran (anon,
venue admin, PostgREST upsert, embedded resource, count oracle, throttle race, the P-02
GUC trick). What changed afterwards, in the same PR:
- **The mail is the deliverable, so any undelivered mail is now a failure.** Unlike a
  crew invite, the row grants nothing — reporting "Invite sent." after a failed
  magic-link fallback was a lie. And because the row holds the unique-index slot, a
  plain retry could only ever answer "already an open invite", so every undelivered
  path now names Resend as the recovery instead of "try again".
- All three actions probe `is_platform_admin()` first and answer one uniform
  `NOT_ALLOWED`; previously resend leaked a rate-limit message where the others said
  "no access", because the throttle RPC's 42501 collapsed into "limited".
- The revoke guard also freezes `revoked_by` and `note`: the update policy only demands
  `revoked_by = auth.uid()`, so a SECOND platform admin could re-stamp a colleague's
  revoke (or rewrite the note explaining it) while leaving `revoked_at` untouched.
- `sendInviteEmail()` gained `seedName` (default true, crew behaviour unchanged).
  `inviteUserByEmail`'s `data` payload OVERWRITES an existing unconfirmed account's
  `raw_user_meta_data`, so a re-invite replaced a real crew invitee's name with their
  address' local part. Pre-existing, but P-03 made it reachable for arbitrary
  addresses; platform invites pass `seedName: false` and write no metadata.
- pgTAP gaps closed: the resend-audit assertion used `now()` inside the transaction, so
  the value never changed, `audit_changed()` returned null and no audit row was written
  — the assertion passed on a rowcount regardless. It now bumps by a distinct interval
  and asserts the audit row. Added: insert with a pre-stamped revoke, a second platform
  admin re-stamping `revoked_by`, the 21st mail hitting the throttle, `service_role`
  being unable to execute the three functions, the funnel as a non-admin, and the
  LATERAL dedup / `deleted_at` / windowing behaviour. 51 assertions.

**Open decision for Max (asked in the PR, deliberately not chosen here):** revoking marks
the row only — the person can still log in and self-onboard. The alternative is also
deleting the auth account while it was never confirmed. The minimal variant shipped.
This matters more than it reads: a revoked invitee keeps a valid link, and
`create_venue_with_owner` checks no invite, so they can still create a company. Options
if that is not wanted: `auth.admin.deleteUser` guarded on `confirmed_at is null`, gating
onboarding on an open invite row, or simply renaming the button "stop following up".

**Follow-ups noted, not built.** AVG: `platform_invites` holds prospect PII (address +
note) and so do its `audit_log` diffs, with no retention or erasure path —
`run_privacy_retention()` does not touch either. For P-04: never render `note` through
`dangerouslySetInnerHTML`, and note that the overview is deliberately an
account-existence probe for the platform admin. The fixed-window throttle (and `+`
address aliasing around it) is accepted as-is.

**Verification (after the review round).** `supabase db reset` clean; `pnpm db:test`
64 files / 1451 assertions PASS (new `supabase/tests/database/platform_invites.test.sql`,
51 assertions; `tables.test.sql` allowlist extended). `npx vitest run` 1806 passed — the
7 `pgtap-plan-run-gate.test.ts` failures are the known Windows-only environment noise and
the 2 `datetime-field.datefield.test.tsx` timeouts pass in isolation. `pnpm lint` clean,
`npx tsc --noEmit` clean. `src/lib/database.types.ts` carries only the real additions.

**For P-04 — `platform_invite_overview()` nullability.** The generator types every
RETURNS TABLE column as non-null. In reality `user_id`, `confirmed_at`,
`last_sign_in_at` (the LEFT JOIN LATERAL), `note`, `revoked_at`, `revoked_by` and
`invited_by_name` are all nullable at runtime. Treat them as optional in the UI.
---

## 2026-09-23 — P-02 platform (system) admin: `is_platform_admin` + RLS helpers (z8uq9m0tnt)

PlusOne's own operators can now read and write in every venue, with the boundary in RLS
and every action stamped with their own `auth.uid()`. Migration
`20260923120000_platform_admin.sql`.

**Why the capability is not a `venue_role` value.** That array flows through `invites`,
`canGrantRoles` and ~59 policies; a superuser value inside it makes every venue admin a
potential superuser-granter. It is a separate boolean on `user_profiles` instead, with
its own helper and its own RPC.

**What shipped.**
- `user_profiles.is_platform_admin boolean not null default false`.
- `public.is_platform_admin()` — stable, SECURITY DEFINER, `search_path = ''`.
- `or public.is_platform_admin()` inside `is_venue_member`, `has_venue_role`,
  `is_event_organizer`, `is_venue_organizer` and `can_view_profile`. 59 of the 68 public
  policies route through those, and none carries its own membership join, so there is no
  policy-by-policy work.
- `public.set_platform_admin(uuid, boolean)` — SECURITY DEFINER, requires
  `is_platform_admin()` itself, refuses self-revoke (lockout), writes its own `audit_log`
  row with `venue_id = null` (so only platform admins can read it back).
- `public.guard_platform_admin_flag()` on `user_profiles` BEFORE INSERT/UPDATE.

**Two things the task description did not name, both found by running the suite.**
- **The column guard is not optional.** `user_profiles_update_self` and
  `user_profiles_insert_self` already let a user write their own row, and RLS is
  row-level, not column-level — without a guard, any authenticated user promotes
  themselves to platform admin in one PostgREST call.
- **`user_is_quota_exempt` had to be widened too.** It takes the *adder's* id as a
  parameter instead of reading `auth.uid()`, so the helper widening does not reach it:
  `guests_insert` pins `added_by` to the caller, a platform admin holds no `quotas` row
  at a foreign venue, and `user_event_quota` falls through to 0 — every cross-venue guest
  add would die on `enforce_guest_quota` with 45001. The write half of the boundary is
  theatre without it.

**The GUC guard turned out not to be a boundary — the column grant is.** A fresh
`/security-review` ran the attacks against the local stack and proved that `authenticated`
can set the custom GUC itself, in the same statement it is guarding:
`update … set is_platform_admin = true where id = auth.uid() and
set_config('plusone.platform_admin_write','on',true) = 'on'` — the WHERE is evaluated
before the BEFORE trigger fires, and the flag flips. The only thing that stopped it was
the shape of the statements PostgREST is willing to emit, which is an app-layer property,
and CLAUDE.md #1 forbids leaning on one. Fix: `revoke insert, update on
public.user_profiles from authenticated` plus an explicit column list that omits
`is_platform_admin`. The list is every pre-existing column and nothing else — narrowing it
further breaks `rls.test` L2, which depends on a cross-user `email` UPDATE being
RLS-filtered to 0 rows rather than erroring. The GUC trigger stays as defence in depth
(it is what still stops the *owner* from writing the column outside the RPC, which the
tests assert separately). SELECT is deliberately untouched: dropping the column from the
read grant would break every `select *` PostgREST issues against `user_profiles` app-wide,
for one enumeration oracle that is only open to people who already share a venue with the
operator. Accepted; moving the read behind an RPC is noted for P-04.

**A suspected hole that measured closed.** Both reviews flagged that `user_is_quota_exempt`
is keyed on the adder, so a quota-bound doorhost might re-point `added_by` at a platform
admin and inherit the exemption. It cannot: `20260819100000` already binds `added_by` on
update (42501, not a filtered 0 rows), and the door-INSERT hand-off branch rejects a
platform admin as actor at a venue he is no member of. The branch got
`and p_user_id = (select auth.uid())` anyway — strictly tighter, free — and both halves are
now asserted, because the exemption is only safe while both hold.

**Gotcha worth remembering: copy the CURRENT body, not the one in the migration the task
points you at.** The first pass rebased `user_is_quota_exempt` on its original
20260613180000 body and silently restored the organizer exemption that 20260625120000
had removed (86ey21vre). `quota.test.sql` caught it — 3 failures. Any
`create or replace` of a helper must start from `grep -rn "create or replace function
public.<name>"` across *all* migrations, never from the one file you happen to be reading.

**Audit.** `audit_trigger()` already stamps `actor_id = auth.uid()`, so nothing changed
there; `platform_admin.test.sql` proves the stamp lands on guests, guest_tiers, quotas,
event_quotas, check_ins and venue_memberships for a platform-admin writer.

**Tests.** New `supabase/tests/database/platform_admin.test.sql`, 54 assertions, both
sides per role: platform admin reads+writes in a venue he is no member of; admin /
user_manager / finance / staff / doorhost / organizer unchanged and still locked out; a
venue admin cannot set the flag by direct UPDATE, by self-INSERT, or through the RPC;
anon reaches none of it; plus the column-privilege assertions, the GUC-window-closes proof
(run as the owner, since `authenticated` no longer holds the column at all), the
merge-duplicates upsert path, and `venue_id is null` audit rows staying invisible to venue
admin and finance. Full run after a clean `supabase db reset`: **63 files / 1400
assertions PASS**. `pnpm lint` clean (2 pre-existing a11y warnings in `datetime-field`),
`tsc --noEmit` clean, Vitest 1757 passed / 7 failed — all 7 pre-existing Windows-only
environment failures (`pgtap-plan-run-gate.test.ts` writes an extensionless `supabase`
stub that libuv cannot spawn on Windows).

**CLAUDE.md #1 gained its exception clause** (platform admins, enforced in the RLS helpers,
every cross-tenant write audited on name — decision #41). The full spec decision #41 and
its own invariant section stay with P-06.

**Follow-ups, deliberately not in this PR.** No seed platform admin and no dev-login for
one (P-01 territory); no UI. Bootstrapping the first platform admin is a one-line SQL
runbook step, documented in the migration header.
---

## 2026-09-23 — First login for new invitees: code in every mail + verify fallback (z8uq9m0tnq)

**P-01.** No beta invitee could get in on their own. The prod auth log of 23/9 for one
invitee reads: invite sent 09:35:06 → the invite link 403 "One-time token not found"
09:39:31 → "send me a code" 09:39:39 → the typed code 403 three times → a *second* mail
09:40:46 → in at 09:41:32 via that mail's link. Three independent causes, all fixed here.

**1 — The mail had no code.** An invitee who already has an unconfirmed account gets the
**Confirm signup** template (GoTrue treats a re-invite as a re-confirmation), and neither
`confirmation.html` nor `invite.html` carried `{{ .Token }}` — while `/login` asks for a
6-digit code. Both templates now render the code above the button, exactly like
`magic_link.html`. **These are dashboard snapshots: Max must re-paste all three templates
into Authentication → Email Templates.** `docs/auth-setup.md` no longer calls the Confirm
signup template "dormant" — it is a live, user-facing mail.

**2 — Verification was locked to one token slot.** `OtpLoginForm` always verified
`type: 'email'` and `/auth/confirm` always trusted the type in the link. A never-confirmed
invitee's token lives in the confirmation slot. Both now fall back through
`src/features/auth/verify-fallback.ts`: `email → signup → invite` for a typed code (client
side, the user's own IP), and for a link **one type per slot** — the declared type, then one
type from the other slot. GoTrue has only two slots that matter and the types inside one are
interchangeable (`invite` ≡ `signup`; `magiclink` ≡ `email` ≡ `recovery`), so a same-slot
retry would cost a round trip for nothing. Capping the link path at two attempts matters: it
runs server-side from one shared Vercel egress IP while GoTrue rate-limits `/verify` per IP,
so a nazorg batch must not cost four verifies per click (PR #324 reviews). `email_change`
and `recovery` never fall back and are never targets. Slot-level isolation does not exist
either way — a recovery token already verifies as `magiclink` — which is acceptable only
because password recovery is off (#20); the code says to revisit it if that changes. A
verify that succeeds but returns no user is terminal, not a slot miss: the token is spent.
A terminal error (a 429) is also what the user hears about, instead of being buried under an
earlier slot's 403 with the cooldown never starting.

**3 — "One-time token not found", explained and measured.** Reproduced on the local stack
(GoTrue v2.195.0) with `auth.one_time_tokens` read before and after each step: GoTrue keeps
**exactly one row per `(user_id, token_type)`**, and invite / re-invite / confirm-signup all
write the same `confirmation_token` slot. Minting a second link replaced the row's hash
(`0d08e0ed… → 0c26f874…`), and the first link then failed with precisely that error; a used
link fails identically on replay. So any second mail — or anything that opens the link
before the human does — kills the first one. Which of the two triggered it for that invitee
cannot be settled from the available prod log; the mechanism is proven, the specific trigger
is not. Note the prod log's own ordering: the failing click came *before* the "send code"
call, so it was not that call that superseded it.

**4 — A dead link is no longer a dead end.** `/auth/confirm` still bounces to
`/login?error=link`, but `/login` now renders what happened ("that link didn't work — it may
already have been used, or a newer email replaced it") with the Send-code step right there,
instead of a generic error with no way forward.

**5 — `scripts/invite-link.mjs`** now looks the account up first and **refuses an address
without an account**. That check is a safety boundary, not a nicety: `generateLink({type:
'invite'})` *creates* the auth user when it does not exist (the service role bypasses
"signups disabled"), so a typo in a prod nazorg run would otherwise mint a real account
outside the invite-only invariant (#20) — one that could walk through /onboarding and create
a venue. Found by the PR's security review; guarded by
`tests/unit/invite-link-no-provisioning.test.ts`. For an account that does exist it mints the
type matching its state: `invite` when never confirmed, `magiclink` when confirmed (the other
as fallback, and the *first* meaningful error reported when both miss). Also not cosmetic:
GoTrue happily mints a magic link for a never-confirmed account and then refuses to complete
it, so the earlier magiclink-first order printed a link that dies on click — measured, and
both printed links now verify end to end. `signup` is not a tier
(`generateLink({type:'signup'})` requires a password).

**6 — Every `?error=` value on `/login` now has copy**, including `devlogin`, and `verify()`
early-returns while a verification is in flight (the auto-submit and the form submit could
otherwise race).

Tests: `src/features/auth/verify-fallback.test.ts` (13) covers the order, the two-attempt
link budget, that a valid type is never retried, that the first error is the one surfaced,
and the rate-limit abort; `src/app/auth/confirm/route.test.ts` gained 7 against a mocked SSR
client (declared-type-first, sibling fallback, never a third slot, no fallback out of
magiclink/email_change, terminal no-user, rate-limit stop, e-mail-change destination);
`OtpLoginForm.test.tsx` gained 6. No migration.

**Nazorg for Max:** `gar***@gmail` (18/9), `pet***@hotmail` and `roe***@gmail` are still
stuck — hand them a fresh link with `node scripts/invite-link.mjs <email>
https://app.plus-one.io` and make sure no other mail is sent to that address afterwards.
---
## 2026-09-23 — `safeNextPath` rejects percent-encoded traversal in `?next=`

Branch `claude/next-path-encoded-traversal`. Milestone: Now-adjacent hardening (small).
Found by a fresh-session `/code-review` of PR #316, which judged it pre-existing and out of
scope for that PR.

**The hole.** `safeNextPath` rejected traversal with `pathOnly.split('/').includes('..')`,
which only matches a LITERAL `..` segment. `/app/%2e%2e/auth/callback` has none, so it passed
the guard — and the WHATWG URL parser treats `%2e%2e` as a double-dot path segment, so it then
normalized to `/auth/callback`, exactly the route the guard's own deny-list
(`raw === '/login' || raw.startsWith('/auth/')`) exists to block. It was reachable with a plain
link, no header forging: `/consent`, `/mfa/enroll`, `/mfa/verify`, the authed `/login?next=`
branch in `src/middleware.ts`, and the `/auth/callback` + `/auth/confirm` routes all feed a
client-supplied `?next=` into it, and `/consent` ends in `window.location.replace(next)`.

**Not an open redirect.** Every consumer re-runs `safeNextPath` and resolves the result against
`request.url`, and the `//`, `://` and `\` checks still held, so the value stayed same-origin
throughout. The damage was bounded to landing on a deny-listed in-app route.

**The fix.** `safeNextPath` now percent-decodes the path once and runs every structural check
against both the raw and the decoded form: protocol-relative prefix, scheme, backslash,
`..` segment, and the login/auth deny-list. Three judgment calls worth recording:

- **Unwrap to a fixed point, not once.** A single decode models what the URL parser does today
  (it matches `..`, `.%2e`, `%2e.` and `%2e%2e` as double-dot segments but leaves `%252e%252e` as
  literal text, which never normalizes), so `/app/%252e%252e/…` is harmless *for today's
  consumers*. It is rejected anyway: the guard must not depend on every hop decoding exactly once,
  because a future consumer that decodes twice would reopen the hole. This reverses the first cut
  of this change, which decoded once and asserted the double-encoded form passed through — the
  fresh-session **security review of #316** reached the opposite conclusion for `appGateNextPath`,
  and the argument applies to every `?next=` consumer, not just the /app gates (Max, 23/9: align
  before merging). Bounded at `MAX_DECODE_ROUNDS = 5` so a hostile value cannot drive the loop.
- **Encoded slashes are treated as separators.** Decoding turns `%2f` into a real `/`, so
  `/app/%2e%2e%2fauth/callback` and `/app/..%2Flogin` are now rejected. This is stricter than the
  URL parser alone, which does not split on `%2f` — deliberately, because Next's router decodes
  the pathname before it matches a route, so an encoded slash can still change which route runs.
  The previous test asserted `/app/..%2Flogin` was "harmless"; that expectation is what changed.
- **A malformed escape falls back.** `decodeURIComponent` throwing on `/app/%2` means the value
  is not a path we ever served, so it is treated as hostile rather than passed through.

**Tightened in passing, same bypass class.** The deny-list now compares the path only rather than
the whole raw value, so `/login?next=/app` no longer slips past the exact `raw === '/login'`
match; and running it on the decoded path also closes `/%61uth/callback`, where percent-encoding
the route name hid it from `startsWith('/auth/')`.

**A tolerant decode, after a peer review from the #316 session.** The first fixed-point cut used
`decodeURIComponent` per round and rejected on a throw. That quietly broke a legitimate deep
link: `/app/events/50%25korting` decodes to `/app/events/50%korting`, where `%ko` is not an escape
at all, so round two threw and the user was downgraded to bare /app — the exact feature #316
shipped. The #316 session proposed accepting on a throw past round 0; that has a hole, verified
here: `/app/%25252e%25252e/a%2525zz` reads `/app/%2e%2e/a%zz` by round 2, and `new URL()`
normalizes THAT to `/a%zz`, out of /app. So instead each round decodes tolerantly — every maximal
run of `%XX` is decoded together (multi-byte UTF-8 like `caf%C3%A9` survives) and an unresolvable
run is left as literal text, exactly as the WHATWG URL parser leaves it — while a malformed escape
in the value as HANDED to the guard (`/app/%2`) is still rejected up front. Both properties hold:
the legitimate `%` survives, and traversal hiding behind a bad escape does not. `appGateNextPath`
got the same treatment, since its own loop would otherwise have rejected the deep link anyway.

**Relation to PR #316 (merged first, `182e63f`).** #316 added `appGateNextPath`, a narrowing of
the guard for the `/app` consent/MFA gates, and its own fresh-session security review pushed that
function to unwrap to a fixed point — explicitly rejecting the single-decode reasoning this change
started from. Rather than land two guards that disagree, the fixed-point rule moved to the shared
layer here, where every `?next=` consumer gets it. `appGateNextPath`'s local loop is now provably
redundant and is **kept as defense in depth**: its own `/app` prefix test still runs on the
ENCODED path, which is only safe while the shared guard keeps treating `%2e%2e` as traversal and
`%2f` as a separator. That is the strictest part of the guard and the likeliest to be relaxed for
some future deep link; keeping the check local means relaxing it cannot silently open the gates.
Both docblocks now say this, and the stale "`safeNextPath` only rejects literal `..` segments"
note is gone from #316's function and its test.

Suites: CI `lint-and-test` green. Locally 1753/1761 Vitest tests pass; the 8 failures sit in `tests/unit/pgtap-plan-run-gate.test.ts` and
`tests/unit/pre-push-hook-is-executable.test.ts`, both environmental (they need the Supabase CLI
and a non-worktree `core.hooksPath`) and failing identically on `main`. `tsc --noEmit` clean,
`next lint` clean (two pre-existing a11y warnings in `datetime-field.tsx`, untouched).

---

## 2026-09-23 — ADE UX round test pass: 28/28 green, task closed (z8uq9m0g0j)

No code change — a verification session that closes the test handoff the 18/9 entry left
open. Both PRs ([#298](https://github.com/Max-Seffelaar/PlusOne/pull/298),
[#299](https://github.com/Max-Seffelaar/PlusOne/pull/299)) merged on 18/9; Max answered
all 28 handoff questions ✅ today, so `z8uq9m0g0j` moves to `complete`.

**What was actually tested.** The local stack on `main` @ `900f0f2` — eight PRs past
#298, not the PR branch — after `pnpm db:fresh`, dev server on 7000. That makes the pass
a statement about current `main` rather than about the merge commit alone.

**Two questions the seed cannot really exercise**, worth knowing before treating 28/28 as
total coverage:
- **Q19** (paste-a-list, ambiguous contact match): the seed has no two contacts sharing a
  normalized name, so only the matched and unmatched paths were exercised. The
  ambiguous-match branch is unit-tested only.
- **Q23** ("Added by a colleague"): probing RLS directly (`set local role authenticated`
  with each seed user's `sub`) shows staff sees 8 guests, all their own, and *every*
  co-member profile is readable by both staff and doorhost. The `addedByName === null`
  fallback therefore cannot render on seed data at all; `guest-source.test.ts` is its only
  coverage. What Q23 confirmed is the positive case ("Added by Tom").

**Setup gotchas that cost time and will recur:**
- **The Supabase CLI is not on PATH on this machine.** `pnpm db:fresh` fails with
  `'supabase' is not recognized`. The working copy lives in the npx cache
  (`~/AppData/Local/npm-cache/_npx/b96a6bd565c470ce/node_modules/.bin`, v2.115.0) — prepend
  it to PATH, or `npx supabase db reset && pnpm dev:mfa`. A cache directory can be pruned;
  the durable fix would be `pnpm add -D supabase`.
- **A resumed session must diff applied migrations against the repo before trusting a test
  pass.** The stack had been up 4 days; `main` had moved and `20260918203700_venue_website`
  + `20260919090000_partial_approval_decision_message` were never applied locally. Check
  `select version from supabase_migrations.schema_migrations order by version desc` against
  `supabase/migrations/` — a stale local schema fails in ways that read as UI bugs.
- **The handoff's "manager" persona is wrong against the local seed.** `manager@plusone.test`
  is Noor, a *pure* `user_manager`: not admin, cannot write guests, and reads zero guests
  under RLS. Every S1–S4 question aimed at "manager" needs `admin@plusone.test` (one-click
  after `pnpm dev:mfa`). The PR's handoff was written against the fixture backend
  (`pnpm dev:fake`), which has no RLS and no role matrix — that is exactly the class of gap
  the fixture harness cannot catch, so a handoff written there should have its personas
  re-checked against `supabase/seed.sql`.
- **Q20 needed fixture data the seed does not carry.** The seed has one always-upcoming
  event and no past ones, while `PAST_CHIPS_CAP = 12` in
  `src/components/po/screens/guests/list-shared.tsx` means "Show all" only appears past 13
  past events. Fourteen weekly `Past test night N` events plus one extra upcoming event
  were inserted locally for the pass and dropped again by the later `pnpm db:fresh`.

---

## 2026-09-19 — /app gates keep the deep link (consent re-prompt, MFA nudge)

Branch `claude/app-gate-deep-link`. No ClickUp task (Max, 2026-09-19). Milestone: **Now**
— venue staff share and bookmark `/app/events/<id>`-style links. Decision (Max): reverse
the documented trade-off in `src/app/app/layout.tsx` ("the gate fires once, on first
login, so `next=/app` is fine"). It didn't hold up. The consent gate re-fires for every
signed-in user after a `TERMS_VERSION` bump, and the MFA recommendation re-fires for
admin/finance without TOTP 24h after acceptance and again each time a 7-day snooze runs
out. Each time, a deep link landed on Home. Fresh logins were already fine
(`resolveEntryDestination` in the auth callback/confirm routes).

**Changed.** `src/middleware.ts` stamps `x-po-request-path` (pathname + search, `_rsc`
stripped) onto the forwarded request before `updateSession`. It always uses `set`, on
every route, so a client value never survives a request the middleware sees. The layout
reads it via `headers()`, not `searchParams`, so `[[...segments]]/page.tsx` stays free of
server work and the door invariant (#25) is untouched. It passes the value through the
new `appGateNextPath` (`safeNextPath` + the `/app` surface only + a 2048-char cap) and uses
the result as `next=` for the consent gate, `recommendMfaIfDue`, and the layout's own
`/login` fallback. Anything that fails falls back to bare `/app`, the old behaviour.

**Why the layout re-sanitizes.** The middleware matcher skips static-extension paths
(`/app/x.txt` still hits the catch-all), so there the client's header reaches the layout
unfiltered. Worst case is a same-origin `/app…` target the user could have typed.

**Tests.** Vitest: `next-path.test.ts` (helpers), `middleware.test.ts` (forwarding via
`x-middleware-request-*`, `_rsc` strip, client value overwritten), new
`src/app/app/layout.test.ts` (each gate's `next=`, plus forged/missing header). With the
fix reverted, 7 of those tests fail. Real runtime on the local stack (dev server + browser,
staff consent cleared then restored): `/app/contacts?q=anna` → `/consent?next=%2Fapp%2Fcontacts%3Fq%3Danna`;
a forged header on `/app/contacts` is overwritten; an RSC request doesn't leak `_rsc`;
on `/app/probe.txt` an off-site, `//`, traversal or non-`/app` header falls back to
`/app`; after consent, `/consent?next=…` lands on `/app/contacts?q=anna`. New e2e
`tests/e2e/app-gate-deep-link.spec.ts` was **not executed** in this session (Playwright
couldn't launch Chromium in the sandbox). It isn't in `e2e:smoke`.

**Review gate.** Middleware is a high-risk surface. The PR body carries an adversarial
security-research prompt. A fresh session ran `/code-review high` on 2026-09-23 and
cleared the design on security grounds (no cross-origin escape; `x-middleware-request-*`
spoofing doesn't work because the stamp is written before `updateSession` builds the
response; `next@15.5.19` is past the CVE-2025-29927 middleware-skip fix; the service
worker's `isStorable()` refuses redirects, so no gate 307 is ever cached; no gate can
point at itself; `[[...segments]]/page.tsx` byte-identical to main). Follow-ups applied
in the same branch: the stamp is now scoped to `/app` paths and deleted elsewhere, so a
bearer token in a `/r`, `/i` or webhook URL is never copied into a header nobody reads;
`appGateNextPath` re-checks the DECODED path, because `safeNextPath` only rejects literal
`..` and `/app/%2e%2e/auth/callback` would otherwise normalize out of `/app` in the
browser; the e2e spec restores the shared `staff@plusone.test` consent in a `finally`;
the length-cap comment now says what it actually bounds.

A second fresh session ran `/security-review` on 2026-09-23 against the post-fix branch:
**no high or medium findings, approved for merge.** It ran 28 payloads through the real
sanitizer chain (sanitize → `encodeURIComponent` → `/consent` searchParams decode →
`safeNextPath` → WHATWG URL resolution) — encoded/uppercase/double-encoded traversal,
`..;/`, encoded slashes and backslashes, fragment smuggling, raw TAB, `%09`, `%00`,
fullwidth and fraction solidus, CRLF, malformed escapes, over-cap — with zero off-site and
zero out-of-`/app` results. It also confirmed `x-middleware-subrequest` is gone from the
installed `next@15.5.19`, that `x-middleware-override-headers` is in Next's
`INTERNAL_HEADERS` (never honoured from an external request), that every non-`/app` path
shape (`/app%2fx`, `//app/x`, `/APP/x`) lands in the fail-safe `delete` branch, that no
`/app` query param mutates state on load, and that a forged header can only ever affect
the forger (no cross-site way to set it). Its two hardening notes are applied here:
`appGateNextPath` decodes to a FIXED POINT (single-decode was safe only because every hop
decodes exactly once — a future double-decoding consumer would have reopened it), and
`requestPathForHeader` edits the query as text so the `_rsc` branch keeps the rest
byte-for-byte like the no-`_rsc` branch.

**Left open.** `safeNextPath` accepting percent-encoded dot segments is PRE-EXISTING and
reachable today with a plain link on every `?next=` consumer (`/consent`, `/login`,
`/mfa/enroll`, `/auth/callback`). Same-origin only — every consumer re-runs the guard and
resolves against `request.url`, so it cannot leave the origin — but it belongs in its own
PR. Second: the Sentry scrubber's `RELATIVE_URL_QUERY_RE`
(`src/lib/observability/scrub.ts`) requires 2+ path segments, so a free-text
`/consent?next=…` or `/login?next=…` is not scrubbed while `/mfa/enroll?next=…` is.
Unreachable today — there is no client-side Sentry SDK in the repo, and `scrubEvent`
deletes `event.request` server-side — and `main` already writes `pathname + search` into
`/login?next=`, so it is the same pattern, not a new one. Its own small PR.
Unrelated pre-existing behaviour worth knowing: `isSessionGone()` in
`public/service-worker.js` treats any opaqueredirect on an `/app*` navigation as "session
gone" and wipes `plusone-session-v1`, so a TERMS_VERSION bump clears the session cache on
every device that hits the gate.

## 2026-09-19 — Client writes on guest_requests can only deny (L5, z8uq9m0jce)

Branch `claude/guest-requests-decide-status-guard`. Milestone: **Now**, a live RLS gap on
prod. Migration `20260919150000_guest_requests_decide_deny_only.sql` (first written as
`20260918213000`, renamed to sort after #308's `20260919090000`, which prod already has:
the CLI refuses a local migration older than the newest remote one). High-risk surface
(RLS policy + grants), so the PR body carries an adversarial security-research prompt and
the PR needs a fresh-session `/code-review` + `/security-review` before merge.

**The bug.** Found by the fresh-session review of PR #308 (finding L5), pre-existing.
`guest_requests_decide` pinned the old row (`status = 'pending'`), the actor and the
admin/organizer role, but not the new status, and `authenticated` held a table-wide
UPDATE. An admin PATCH of `status = 'approved'` succeeded with no guest row: tier-max,
capacity and link-max never ran, and `/r/[token]` showed the requester "approved" for a
list they were not on. Reproduced locally in a rolled-back transaction (`UPDATE 1`,
0 guests). The same grant let a deny rewrite any other column in the same PATCH.

**The fix.** Two layers. The policy's `WITH CHECK` requires `status = 'denied'` (the only
client transition is `pending → denied`); UPDATE is granted per column on exactly what
`denyGuestRequest` writes (`status`, `decided_by`, `decided_at`, `decision_reason`). A
column grant also keeps columns added later closed by default. SECURITY DEFINER paths
(approve, re-approve, auto-approve, retention) run as the owner and are unaffected.
USING also gained `anonymized_at is null` (review finding, below), so the deny path is
symmetric with `approve_guest_request`, which refuses anonymized requests with P0002.

**Side effect worth knowing.** Every remaining client write flips `status`, so
`audit_guest_requests` (trigger `WHEN old.status IS DISTINCT FROM new.status`) now fires
on 100% of them. Before this migration a PII rewrite through the deny path was unaudited.

**Relation to #308 (`20260919090000`).** Its `guard_guest_request_decision_fields`
trigger (plus_ones, approved_plus_ones, decision_message) is not duplicated. The column
grant now refuses those writes first and the trigger stays as a second layer; its
migration comment about a table-wide UPDATE grant is stale from here on. Checked by
applying both migrations in order in one transaction: `partial_approval.test.sql` and
`guest_requests_decide.test.sql` both pass.

**Tests.** New `guest_requests_decide.test.sql` (37). `rls.test.sql` N3 asserted the
direct approve as *allowed* and now asserts it is refused (N3) and that the deny works
(N3b), plan 74 to 75. The full suite ran with the migration applied inside one rolled-back
transaction per file on the shared local stack. The only failures (`analytics`,
`auth.invites`, `onboarding`, `rls` P1) fail identically without the migration; they come
from data drift in the shared DB (for example 16 events where the seed has 1). CI runs on
a fresh reset.

**Review gate.** Fresh-session `/code-review` + `/security-review`, both on Fable, both in
their own session and worktree. Security: **approve**, nothing in the migration itself a
finding; it re-verified L5 as fixed (UPDATE, upsert and fresh INSERT all 42501) and
refuted the race with the approve RPC (EvalPlanQual re-checks USING), the
`event_venue()`/`venue_id` divergence, PostgREST `return=representation` / `columns=` /
filter-less PATCH, trigger-ordering and `current_user` bypass on #308's guard, and an
existence oracle through UPDATE errors. Code review: **approve after one blocking line** —
a client deny still matched anonymized rows, writing a fresh free-text reason (and an
audit diff carrying it) onto a row retention had scrubbed. Fixed here with
`anonymized_at is null` in USING + tests H1/H2, which are red without it (`have:
denied|Piet Jansen was vervelend`). Test-quality fixes from the same review: B2 now
upserts a row B1 never touched (it used to pass for the wrong reason in a red run),
plus a finance deny (D5b) and the organizer arm of the RPC (E4a/E4b). Plan 37 → 42.

**Follow-ups (not in this PR).** (1) `authenticated` still holds table-wide **INSERT** on
`guest_requests` although no client code inserts — submission is the anon SECURITY
DEFINER RPC. The security review reproduced, as *staff*: planting a row with
`anonymized_at = now()` plus the victim's e-mail as `dedupe_key`, which is invisible in
the inbox but still holds the dedup slot, so the real person's submission is silently
swallowed and their status page says `found: false`; an e-mail oracle via
`on conflict do nothing` / `23505`; and validation/throttle bypass (`email='x'`,
`plus_ones=99`, 500 rows in one statement). Medium, pre-existing, deliberately a separate
PR + migration so this one reaches prod unchanged. (2) `denyGuestRequest` returns
`{ok:true}` on 0 affected rows, so the inbox reports a deny that changed nothing — fix
with `.select('id')` and the same not-found error shape the RPC's 45003 gets.
(3) `decided_at` stays client-chosen on a deny; nothing downstream reads it (confirmed),
so pinning it is optional.

**Gotcha.** A policy cannot compare OLD with NEW, so a status rule in `WITH CHECK` does
not stop a deny from also rewriting other columns. That part needs a column grant or a
trigger.

---

## 2026-09-19 — 44px tap targets on the 22 known-debt row/card controls

Branch `claude/tap-target-debt-44`, stacked on `claude/iconbtn-tap-target-44` (#313).
Milestone: **Now** (the tap-target floor is a hard CLAUDE.md rule; door and cockpit
controls are the most tap-critical ones). No migration.

**What changed.** Every control in the tap-target ratchet's `KNOWN_DEBT` now hits at
44x44 or more, and the list is empty. The fix per control was the least churn that fit:

- **Invisible ring, zero pixel change** (17 controls): influencer-stats clear-search and
  QR close, kit `Toggle`, event-row cog, both quota steppers, contact-row select / star /
  add, Home pager (the page-number chips too, which the scan can't see), door add-on-spot
  and task check, cockpit check-in slots, cockpit task check, cockpit approve/deny. The
  ring is lopsided where one neighbour is closer: clear-search (5px toward the input),
  door task check (4px clear of both neighbours), cockpit approve/deny (3px toward the
  partner, 11px outward, as in `SyncBar`).
- **Colour swatches** (3 copies): now one kit primitive, `ColorSwatches`: 34px dots,
  10px gap, wrapping, 5px ring each, so rings meet without overlapping. That moved the
  add-guest form's 30px dots to 34px and the gap from 9px to 10px everywhere. It also
  fixes a real bug: the template tier editor didn't wrap, so at 390px its 11 dots were
  squashed into 20px-wide pills.
- **Desktop guest table:** the select column went from 40px to 44px and the header row
  from 40px to 44px tall, so the select-all box and the row dots each get a full 44px cell.

**Measured, not assumed.** A Playwright probe against the fixture harness measured each
control's real hit extent with `elementFromPoint` at 390x844 (touch) and 1440x900:
121 control instances, all at least 44x44 afterwards, none stealing from a neighbour.
Before/after clips of the ring-only fixes are pixel-identical. The probe also caught
a bug that the class-derived test had missed: a `::before` with only `top`/`bottom`
set has `left`/`right: auto`, so an empty one is 0px wide and hits nothing. The
`Toggle` ring needs `before:inset-x-0`, and the test now gives no credit to a ring
that leaves a side unset.

**Guard tightened.** The ratchet's tag scan stopped at the first `<`, so
`quotaDefault <= 0 && …` in a className cut the event-edit minus stepper out of the scan
(the list said 1 stepper for that file; there were 2). The scan now only stops at a `<`
that opens a tag. `Toggle` and `ColorSwatches` get their own render checks. Mutation-checked
by dropping `inset-x-0`, shrinking the swatch inset to 6px and removing a contact-row ring:
each one fails the suite.

**Fixture harness (`scripts/dev/fake-supabase.mjs`).** It gained a `get_influencer_stats`
RPC, so `/i/<any token>` renders, and one event template. `event_quota_status` now
reports admins as exempt, like the real RPC does. That exempt flag also gates the inline
"Add tier" form. `FAKE_EXTRA_EVENTS=N` adds N empty upcoming events so Home's pager
shows. It is off by default, so existing baselines don't move.

---

## 2026-09-18/19 — Joeri walkthrough round (J1–J6)

Source: a screen-recorded walkthrough by Joeri (pilot partner running the ADE campaign),
transcribed and triaged with Max on 18/9. Items already fixed by the 17/9 round (#298:
end-date follow, alias hidden, +N from profile, guest source, Door → Check-in) were
dropped; the rest was bundled into six ClickUp tasks, each built by a separate agent in
its own worktree, with before/after screenshots for Max where he asked for them.
Milestone: **Now** (ADE campaign).

| Bundle | ClickUp | PR | What shipped |
|---|---|---|---|
| J1 copy sweep | `z8uq9m0hw1` | #303 | 64 user-facing em/en-dash sentences rewritten, "Influencer" → "Promoter" in copy only (code/DB/routes unchanged), guard `tests/unit/no-em-dash-in-copy.test.ts`. |
| J2 onboarding & settings | `z8uq9m0hw2` | #309 (db), #307 | Team step "Skip for now" / "Add another team member", outdated MFA note removed, Company name placeholder, searchable country dropdown (one shared list with the phone picker), single-venue shortcut to venue settings, "Manage" hidden for roles without access, dead `plus.one/<slug>` "Landing page" row replaced by an optional `venues.website` (http(s) CHECK), English invite / login-code / confirm-signup e-mail templates. |
| J3 events & tiers | `z8uq9m0hw3` | #305 | No past-event preselect in quick-add, working Events search, end time before doors rolls to the next day, "Add another tier" below the list, tiers editable after creation, sign-up link on by default, new event without tiers lands on the tiers step, "Template" label. `updateTier` now fails instead of reporting success on a 0-row update. |
| J4 requests, check-in, analytics | `z8uq9m0hw4` | #306 | Quick-add contact fields marked optional with the contact rule explained, connection pill in the desktop cockpit (`SyncDot` kit primitive), "New request link" from Requests, link label on every request, pending-requests badge on Home, "On the way" during / "No-shows" only after an event (stats panel + recap, UI-only), Analytics opens on the latest started event, Promotion "+ New link" gated like Requests. |
| J5 guest profile | `z8uq9m0hw5` | #304 | Per-event "…" actions on the profile (open event, +N, tier, remove) from any entry point, permissions mirrored from RLS in `src/features/guests/permissions.ts`, door-only gets "Open event" only, Guest/Contact title, Contacts empty state explains the name-only rule. |
| J6 partial approval & status page | `z8uq9m0hw6` | #308 | Approve fewer people than requested + optional venue message (`decision_message`, 280 chars, approved only), status page shows date, start–end time, venue address, "Approved for 3 of 5" and the message; footer links to plus-one.io. Spec #48 + #43(f) amendment. |

**J6 review gate.** High-risk (SECURITY DEFINER approve RPC, anonymous status RPC,
guard trigger, retention). An independent fresh-session `/code-review` +
`/security-review` returned "merge after fixes": M1 retention only scrubbed
`decision_message`/`decision_reason` for requests anonymized in the current run (old
rows kept the deny reason in the audit diff; an anonymized request could still be
approved with a message). Fixed with `redact_anonymized_request_audit_pii()` keyed on
`anonymized_at` (backfills, idempotent) and P0002 for anonymized requests; plus L1
mirror tokens no longer get the address, L2 no party size for approved mirrors, L3 one
whitespace set validated before any insert (a CHECK failure used to echo the row), L4
role check before the row lock, event_id re-checked after the lock. Re-review:
merge-ready. Accepted residual: a mirror token becomes recognisable after the original
is approved (`docs/security-audit.md` §4A).

**Prod push.** `20260918203700_venue_website` was first applied through the Supabase
MCP connector, which stamps its own ledger version (`20260918173900`); Max then linked
the CLI in the main checkout and realigned the ledger with `supabase migration repair`
(reverted `20260918173900` and the older MCP artefact `20260918153321`, applied
`20260918203700`). The J6 migration was renamed from `20260918174500` to
`20260919090000` before merge because the CLI refuses a local migration older than the
newest remote one, then pushed with `supabase db push`; dry-run afterwards: "Remote
database is up to date". Lesson: prefer the CLI; if the connector is used, repair the
ledger in the same session.

**Process notes.** Split a PR whose code reads a new column into a migration-only PR
merged and pushed first (J2: #309 before #307); Vercel deploys on merge, the push comes
after. The shared git config had `core.hooksPath` switched to an absolute path into the
main checkout (stale hooks in worktrees); reset to `scripts/hooks`.

**Tests.** Every PR: type-check clean, lint clean (2 pre-existing `datetime-field.tsx`
warnings), vitest green except the 7 Windows-only `pgtap-plan-run-gate` failures
(`spawn supabase ENOENT`, not reproducible in CI); CI `lint-and-test` (incl. pgTAP on a
fresh stack) green on every PR and on main. Playwright not run locally (needs a DB reset
on the shared stack).

**Follow-ups.** `z8uq9m0jce` guest_requests_decide lets an admin set `approved` without
the RPC (pre-existing, found by the J6 review, high-risk) · `z8uq9m0jcf` dev-login
`next=/app/contacts` lands on Home · `z8uq9m0jcg` 44px icon buttons (shipped, entry
below) · `86ey6bn05` transactional mails via Resend (queue / approved / adjusted /
denied; uses `decision_message`, must HTML-escape) · `z8uq9m0hw7` J7 ADE campaign link
(design) · open with Max: preset reasons for deny/adjust visible to the guest.

---

## 2026-09-18 — 44px tap targets on header icon buttons

Branch `claude/iconbtn-tap-target-44`. Milestone: **Now** (CLAUDE.md's tap-target floor
is a hard rule; the door is the most tap-critical surface). No migration.

**The gap.** The kit's `IconBtn` and `Top`'s back button were 40x40, as were the
hand-rolled header chips built the same way (contact-profile star, audit filter,
pushed-Home back, link-card QR). The door's `SyncBar` wake-lock and sync-now chips
were 30x30. Measured in a real browser against the fixture harness with
`elementFromPoint`: every one of them hit at exactly its visible size.

**Fix, zero visual churn.** `design-system.md` asks for a pixel match with the
prototype, so the visible chips keep their size. `hitArea44` (kit) adds an invisible
`::before` ring that is part of the button, taking the hit area to 44x44. Before/after
screenshots of 11 headers at 390px and 1440px are pixel-identical (the only differing
pixels are the cockpit's live clock). `SyncBar`'s chips are only 10px apart, so their
ring is lopsided (5px inside, 9px outside) and the two rings meet without overlapping.

**Gotcha worth keeping.** An absolutely positioned `::before` is placed against the
*padding* box, so `before:-inset-[2px]` on a 1px-bordered chip only gains 1px per side
(42, not 44). The first browser probe caught it; the inset is 3px.

**Guard.** `src/components/po/kit.tap-target.test.tsx` renders the kit chips and derives
their hit box from their classes (visible size + ring - border), and a source ratchet
fails CI on any new fixed-size `<button>` under 44px. The 22 sub-44 row/card controls
that predate it (colour swatches, steppers, 38px row actions, cockpit check slots,
Toggle) are listed per file with exact counts, so the list can only shrink. Those are
the follow-up.

---

## 2026-09-18 — Domain placeholders point at plus-one.io

Branch `chore/plus-one-io-domain`. Milestone: **Now** — the consent gate links and every
setup doc must name the real domain before venue #5 signs. Decision (Max): the marketing
site owns `plus-one.io` (apex canonical, `www` redirects to it; repo `Plus-One.io`), the
app moves to `app.plus-one.io`. Recorded as resolved open point 3 in the spec and in
CLAUDE.md §Env.

**Changed.** `src/lib/legal.ts` Terms/Privacy fallbacks `plusone.app/terms|privacy` →
`https://plus-one.io/legal#terms|#privacy` (the site's legal page picks its tab from the
hash); the go-live TODO (86ey1vbrj) now covers only the final legal text. `.env.example`
`NEXT_PUBLIC_APP_URL`, the Supabase Site URL example (`docs/auth-setup.md`), the Stripe
webhook endpoint, the uptime monitor URL, the Turnstile hostname, the runbook's Sentry
checks + key facts, the `invite-link.mjs` usage lines and the S15/S16 design mocks all
name `app.plus-one.io` / `plus-one.io` now. No runtime origin is hard-coded: in-app links
already use `window.location.origin` and billing reads `NEXT_PUBLIC_APP_URL`.

**Not in this change (live config, done by hand when the domain goes live).** Attach
`app.plus-one.io` to the Vercel project `plus-one`; attach `plus-one.io` + `www` to
`plus-one-io` and flip the redirect to www → apex (today the apex 308s to `www`, which
404s); Supabase Auth Site URL + redirect allow-list; Stripe webhook endpoint; Turnstile
hostname; BetterStack monitor; `NEXT_PUBLIC_APP_URL` in Vercel. The Resend sending
domain stays `theoperators.nl` until F3 (86ey6b3hv).

## 2026-09-18 — Status-token hijack on the silent-dedup path (z8uq9m0h2v)

Branch `fix/z8uq9m0h2v-status-token-hijack`. Milestone: **Now** — anon-reachable PII
disclosure live on prod. Migration `20260918140000_status_token_mirror.sql`. High-risk
surface (SECURITY DEFINER + `anon` + the landing surface), so the PR body carries an
adversarial security-research prompt for a fresh reviewing session.

**The bug.** `submit_guest_request` is SECURITY DEFINER and granted to `anon`, so it is
reachable with nothing but the public anon key and a link slug. On the silent-dedup path —
a submission matching an existing *pending* request on the same event — it rotated that
row's `status_token_hash` to the value the **caller** passed in `p_status_token_hash`. The
caller chooses that value. Pre-existing; found by the fresh-session review of PR #296 but
not caused by it, and recorded in `docs/security-audit.md` §4A as an open residual.

**Reproduced first, not assumed.** Local stack, PostgREST, anon key only, manual-review
link:

| step | call | result |
|---|---|---|
| 1 | victim submits, token `V` | `{"status":"ok","auto_approved":false}` |
| 2 | `get_request_status(V)` | `found:true`, `full_name:"Victim Vandermeer"`, `plus_ones:2` |
| 3 | attacker submits the **victim's e-mail** with attacker-chosen token `A` | `{"status":"ok","auto_approved":false}` |
| 4 | `get_request_status(A)` | `found:true`, **`full_name:"Victim Vandermeer"`, `plus_ones:2`** |
| 5 | `get_request_status(V)` | `{"found":false}` |

One unauthenticated call: an existence oracle, disclosure of a named individual's
attendance and plus-ones, and a DoS on the victim's own status URL. `p_ip_hash` is an
*argument*, so a direct PostgREST caller picks its own throttle bucket and has no
effective limit on probing addresses.

**Why neither obvious fix was taken.** Both "ignore `p_status_token_hash` on dedup" and
"accept it only when `status_token_hash is null`" close the disclosure and hand back a
clean one-call enumeration oracle in its place — *my token resolves ⇒ fresh address, my
token does not ⇒ taken address*. That is the exact trade PR #296 made in the neighbouring
block and had to write up as a swap, and it would be **new** on manual-review links, where
`auto_approved` is constant `false`. Checked rather than assumed that nothing else already
leaks that bit: `anon` holds no INSERT on `guest_requests` since `20260707170000`, so the
partial dedupe index is not reachable as a 409-vs-201 probe without a session.

**What shipped.** The rotation became an **additive, identity-scoped binding**. The dedup
branch never writes to the existing row; the caller's token hash goes into a new
`guest_request_status_mirrors` (`request_id` PK, `token_hash` unique, plus the
`full_name`/`plus_ones` *that caller* submitted), and `get_request_status` resolves
`guest_requests.status_token_hash` first, the mirror second — answering a mirror with the
**mirror's own** identity and the request's live status. Victim keeps their URL and their
row; the prober reads back only what they themselves sent; a deduped submission returns a
**byte-identical** payload to a fresh one at submit time and on every read before a staff
decision. Bounded by the primary key (one mirror per pending request), RLS on with no
policies and no grants to `anon`/`authenticated`, and dropped by `run_privacy_retention`
alongside the request anonymization it belongs to (#29).

**Residual, not claimed away.** A mirror reports the deduped-against request's *live*
status, so after a staff decision an attacker who submitted junk and polls can read an
`approved` as evidence the address belongs to someone who was let in. Delayed, dependent
on a staff action they cannot trigger, probabilistic, and it yields no name, no plus-ones
and no DoS — where the bug it replaces was instant, certain and gave all three. Freezing a
mirror at `pending` was weighed and rejected: it installs the mirror image of the same
signal *and* breaks the legitimate re-submitter, whose second URL would never show their
approval. Written into the migration header, §4A and here, in the same words.

**Guards proven red before green.** Reverted the three function bodies in the live database
to their pre-fix definitions and re-ran: `landing.test.sql` failed 7/67 (F5 `have:
tok-hj-attacker want: tok-hj-victim`; F9 `have: Hijack Victim want: Hijack Attacker`;
F11b's jsonb equality printing the victim's name where the attacker's belongs) and
`status_token.test.sql` failed 5/17 (B3–B6, D4). Restored, both green. A second round after
the review questions added F16–F22 (behaviour-level 42501 for `anon` **and** for a venue
admin, the second-probe overwrite, and the one-row-per-request growth bound) and re-ran the
revert: **10/74** red, F11b among them. The K10 drift guard
now also covers `get_request_status`, and that entry was likewise proven by perturbing the
canonical file and watching it fail.

**Also touched.** `status_token.test.sql` section B asserted the *old* rotation behaviour
(“the fresh URL works, the earlier one is dead”) — that was the vulnerability written down
as an expectation, and it is now B3–B6 asserting the additive binding and the untouched
stored hash. `tables.test.sql` needed the new table in its exact-table-set list (it caught
it unprompted, which is the guard working). `supabase/canonical/` gained
`get_request_status.sql` and the guard's function list grew to five.

**Suites.** pgTAP `pnpm db:test` on a fresh `supabase db reset`: **58 files / 1180
assertions, `Result: PASS`**, plan/run gate clean. `pnpm vitest run`: **129 files / 1374
tests passed**. `pnpm type-check` clean; `pnpm lint` clean bar two pre-existing
`jsx-a11y` warnings in `datetime-field.tsx`. Noted honestly: `tests/unit/pgtap-plan-run-gate.test.ts`
is flaky under full-suite parallelism in this container — it failed 1–2 of its 21
assertions on some runs *including on the unmodified tree* (`git stash`-verified) and
passes in isolation every time; not caused by this change.

**Second round — the fresh-session security review came back `REQUEST CHANGES`.** Migration
`20260918160000_status_token_mirror_hardening.sql`. The reviewer rebuilt the stack without
Docker (stock PG 16.13 + a hand-written platform shim, all 104 migrations clean, pgTAP through
this repo's own plan/run gate), reproduced 59/1202 and 144/1493 exactly, got **14** assertions
red on reverting the function body, tampered with the grant matrix and the canonical file to
confirm those guards fire, and could not break the mirror on any of its six attack questions —
including a timing run that showed the fix *narrowed* the dedup/fresh gap (+0.054 ms, against
+0.134 ms pre-fix). The design stands. Two defects did not:

- **F-1, a regression this PR introduced.** `p_status_token_hash` is anon-controlled unbounded
  `text` going into a unique btree index on both paths. Past the ~2704-byte index-row ceiling
  postgres raises `54000` — and once the mirror existed the two paths named **different
  indexes** in the message, which PostgREST forwards verbatim in its 500 body. A one-call
  e-mail-existence oracle, in exactly the class the mirror was designed to avoid. Reproduced
  locally before fixing (`…mirrors_token_idx` vs `…status_token_idx`). Fixed by capping the
  argument at 128 chars with the other argument-only guards above the throttle — the rule
  `86eyke279` already applies to `v_email` in this function for this same ceiling. Both paths
  now answer `{"status":"invalid"}` over real anon PostgREST.
- **F-2, an AVG retention gap.** Step 2b deleted only the mirrors of requests *that run* had
  anonymized, but retention leaves a request `pending` with its `dedupe_key`, so it keeps
  catching later submissions and those mirrored a fresh caller's real name onto a row no sweep
  would revisit. Reproduced: retention run #2 returned `0 0 0 0` and `"Late Caller Name"`
  survived. Fixed on both halves — the sweep drives off `anonymized_at` instead of the run's id
  list (self-healing), and the dedup branch refuses to mirror onto an anonymized request.

**A test that would have hidden itself.** The F-1 probe only works with *incompressible* input:
`repeat('A', 5000)` never reaches the btree ceiling because pglz compresses it inside the index
tuple. A length assertion built on a repeated character would have passed whether or not the
guard existed. G0 asserts the probe builder's output length before G1–G3 use it. Same care on
the F-2 side: G11 plants its orphan with `on conflict do update` so G13 pins the **sweep** half
even on a build where the **write** half is missing — without that, the reverted build already
occupies the row, the plain insert trips the primary key, and the abort hides whether the sweep
works at all. That is the shape of guard this repo keeps getting bitten by, so it was worth the
two extra lines.

**Red-on-revert, per finding.** Reverting both halves of F-2 while keeping F-1's cap: **G10**
(`have: 1 / want: 0` — the late caller's name parked in the table) and **G13** (`have: 1 /
want: 0` — the orphan surviving the sweep) go red independently, 2/91. Reverting F-1's cap:
`landing.test.sql` aborts at G1 with `ERROR: index row size 2712 exceeds btree version 4
maximum 2704 for index "guest_request_status_mirrors_token_idx"` — the raise *is* the finding.

**F-3, and why the header mattered.** `20260918140000`'s header claimed, twice and unqualified,
that deduped and fresh are byte-identical "on every read before a staff decision". True on
manual-review links, false on an auto-approve link below capacity, where the split is inherited
from `20260918100000`. `docs/security-audit.md` already had it right, so the two documents
disagreed — and the next reader of that comment is a future session deciding whether some change
is safe. The claim is scoped in place (that migration is unmerged and has never been applied
anywhere), and G14–G16 now pin all three regimes so the residual is tested rather than merely
described. Second time in two PRs a migration header has over-claimed; reading one's own header
adversarially is now part of the routine.

**F-4, left open on purpose and written down.** Past the retention window, on an event whose
link is still open, the dedup path *is* oracle (a). Pre-existing — the reviewer confirmed the
identical split pre-fix — and F-2's write-side half does not change it (that token answered
`{"found": false}` before and after, verified live). The structural close is
`request_link_open()` shutting a link once its event is past the venue's retention window,
which would take F-2's precondition and F-4 together; a behaviour change to the public landing
surface, so its own task.

**Suites after the second round**, on a fresh `supabase db reset`: pgTAP **59 files / 1219
assertions PASS** (1202 → 1219 is section G), concurrency `PASS`, vitest **144 files / 1493**,
type-check clean, lint 0 errors.

**Not done here.** The two auto-approve enumeration residuals in §4A are untouched — this
change does not widen or narrow them, and the at-capacity regime was re-checked against the
live stack in both directions to confirm it.

---

---

## 2026-09-18 — `@types/react` 18 → 19 (z8uq9m0h2h)

Branch `chore/z8uq9m0h2h-types-react-19`. Milestone: Now — it unblocks a group of safe
dependency bumps. No migration, no schema change, no runtime dependency change.

**Not a React major and not Next 16.** `react`/`react-dom` have been on 19 since long
before this; only `@types/react`/`@types/react-dom` were still on 18.3.31. Next 16 stays
parked as `86eyd39mx`.

**Measured, not estimated.** With `@types/react@19.3.0` + `@types/react-dom@19.3.0`
installed, `tsc --noEmit` over the whole tree produced exactly three errors in two files —
the same three the task predicted, re-measured on `9fba195` after `5206701` and `9fba195`
had landed (the latter split `app.tsx` into `app-chrome` / `app-screens` / `door-branch`):

```
src/components/po/datetime-field.tsx(179,14): TS2345  RefObject<HTMLDivElement | null>
src/components/po/datetime-field.tsx(308,14): TS2345  idem
src/features/door/sync/useWakeLock.ts(62,22):  TS2554  Expected 1 arguments, but got 0
```

Both fixes are typing-only:

- `datetime-field.tsx:67` — React 19 types `useRef<T>(null)` as `RefObject<T | null>`, so
  `useDismiss(ref: React.RefObject<HTMLElement>, …)` → `RefObject<HTMLElement | null>`.
  One signature, both call sites; it is the only place in the codebase where a `RefObject`
  crosses a function boundary.
- `useWakeLock.ts:62` — `useRef<() => Promise<void>>()` → `useRef<(() => Promise<void>) |
  undefined>(undefined)`. This ref is the deliberate cycle-breaker between `acquire` and
  `onSentinelReleased`; door code, so invariant #25 applies. Runtime behaviour is
  identical (`useRef()` already passed `undefined`). Verified by probe: replacing
  `void acquireRef.current?.()` with a no-op turns
  `useWakeLock.test.ts > re-acquires when the browser revokes the lock while STILL visible`
  red, so that path is genuinely under test, and it is green with the fix in place.

**The `JSX` guard kept, its doc comment corrected.** The earlier 269-annotation sweep
(86eyd39gn) is why this cost three errors instead of 272. Its comment claimed "tsc cannot
catch a regression while `@types/react` is still pinned to 18" — now stale. Under 19 tsc
does catch it: a probe file with a bare `JSX.Element` fails with
`TS2503: Cannot find namespace 'JSX'`, and the same probe turns
`tests/unit/jsx-namespace-imported.test.ts` red (offenders list non-empty). Both were
observed, then the probe removed and the suite re-run green. The guard stays — it names
the file and the fix, runs in the unit suite, and still holds if the types are ever pinned
back to 18.

**Suites.** `pnpm type-check` clean. `pnpm lint` 0 errors, 2 warnings — both pre-existing
`jsx-a11y/role-has-required-aria-props` on `datetime-field.tsx:218/353`, identical on an
unmodified tree. `pnpm vitest run` 1372/1372 passed, 129/129 files, four consecutive clean
runs. One earlier run of the full suite failed
`pgtap-plan-run-gate.test.ts > does not truncate its diagnostic when the reader is slow`;
it passes in isolation and in four subsequent full runs, and it asserts on a subprocess's
stderr under a slow reader, so it is a load-timing flake in that test, unrelated to this
change — recorded here rather than swept up, because it will resurface.
`pnpm e2e:smoke` **could not run in this session**: no Supabase CLI, no reachable Docker
daemon and no `.env.local`, so the Playwright web server dies on
`Missing required env var: NEXT_PUBLIC_SUPABASE_URL`. CI's `lint-and-test` covers it.

**The Dependabot ignore rule that was not doing its job.** `.github/dependabot.yml` ignores
`@types/react` majors, and PR #291 pulled one in anyway. What the config now records, with
the evidence behind each point:

- Dependabot's own PR body for #291 lists 12 updates, all production dependencies.
  `@types/react`/`@types/react-dom` are **not** among them — there was no "@types/react
  update" for an ignore condition to filter.
- The edit is not forced by resolution. With those 12 bumps applied and the types left at
  18, `pnpm install --lockfile-only` resolves cleanly to `@types/react@18.3.31` against
  `react@19.3.0`, no peer complaint.
- PR #292 (development-dependencies — the group `@types/react` actually belongs to, being a
  devDependency) left it at `^18.3.3` while bumping `@types/node` 20→26, `eslint` 8→10,
  `vitest` 1→5 and `tailwindcss` 3→4 around it.

So the rule works where Dependabot evaluates it; the bump rode in as a companion of the
`react`/`react-dom` update, on a path where ignore conditions are never consulted. GitHub
does not document that path and exposes no knob for it, so there is nothing to tighten —
**accepted deliberately**, and written into `.github/dependabot.yml` at the rule itself so
it stops reading as airtight. Aligning the types is the structural fix: the companion bump
only had a major to do while runtime (19) and types (18) had drifted; with both on 19 and
`react` majors ignored, it cannot produce a types major again without a react major first.
The control that actually stopped #291 was blocking CI plus branch protection.

**Not done here:** #291/#292 were left untouched — they share `package.json` and
`pnpm-lock.yaml` with this branch and want a rebase after it lands.
## 2026-09-18 — `main` back to green: the core-flow e2e race the ADE round exposed (z8uq9m0g0j)

Branch `fix/z8uq9m0g0j-core-flow-e2e`. Milestone: **Now** — `main` was red, which blocks
every open PR behind it. No migration, no app code: one test file.

**What was red.** `lint-and-test` → `e2e:smoke` → `tests/e2e/core-flow.spec.ts:91`, a 240 s
timeout on `getByRole('button', { name: 'Add guest' })` after the `Back` click. `main` ran
green at `9fba195` (#297), went red at `ee01118` (#298) and stayed red at `529503e` (#299).
Every other CI step — pgTAP, concurrency, lint, type-check, unit — was green throughout, and
`app-shell-no-remount.spec.ts` (the one selector #298 flagged) passed. Unowned: the session
that merged #298/#299 had already unsubscribed, and its own entry records that e2e never ran
for that round (no docker in that container).

**Stale spec, not an app regression — established, not assumed.** Reproduced locally, then
probed the app directly:

- Playwright's page snapshot at the moment of failure shows the app on **Home** ("Good
  morning, Max.", buttons `New event` / `New guest`), not the Events list. There is no
  `Add guest` on Home, so the wait could never succeed.
- A throwaway probe spec proved the nav itself is healthy: clicking the sidebar `Events`
  moves `/app` → `/app/events` and renders its `Add guest` CTA in **333 ms**.
- The same probe proved what changed: Home now carries **exactly one** `New event` button —
  item A of the round (`home-header-actions.tsx`). Before it, Home had none.

So the click at step 2 could resolve against **Home's** `New event` during the ~300 ms the
tab switch takes. The form is then pushed from Home, and the `Back` at step 3 correctly
returns to Home — where `Add guest` does not exist. The race predates the round; item A only
made it observable, because until then Home had no button of that name and Playwright was
forced to wait for the Events screen to render one. That accidental synchronisation was the
only thing holding the spec up.

Nothing a user can do is broken: from Home, `New event` → form → `Back` → Home is the correct
journey, and Home's guest action is `New guest`. So the fix belongs in the spec — and it is a
real synchronisation, not a selector patched until it goes green:

```ts
await page.getByRole('button', { name: 'Events', exact: true }).click();
await page.waitForURL('**/app/events', { timeout: 30_000 });   // ← added
await page.getByRole('button', { name: 'New event' }).click({ timeout: 30_000 });
```

Every screen has a real, bookmarkable URL (G1), so the URL is the honest signal that the tab
switch completed — not a sleep, not a guess about render timing.

**The flagged selector was already fixed.** #298's entry left
`app-shell-no-remount.spec.ts:193` (`'Door'` → `'Check-in'`, item L) for a local-stack pass.
It is already `tab(page, 'Check-in')` on `main`, with the rename explained at line 141, and
the spec passes. The flag was stale; nothing to do. No literal `'Door'` selector survives in
`tests/e2e/`.

**Suites**, on a fresh `supabase db reset` each time:

| suite | result |
|---|---|
| `pnpm e2e:smoke` (the 4 CI specs) | **6 passed**, 54.4 s — the set CI reported as `1 failed / 5 passed` |
| `core-flow.spec.ts` alone, pre-fix | fails identically to CI (`Add guest`, 240 s) |
| `core-flow.spec.ts` alone, post-fix | **1 passed**, 41.7 s |
| `pnpm db:test` | **59 files / 1174 assertions, `Result: PASS`** |
| `pnpm db:test:concurrency` | `PASS — 0 assertion(s) failed` |
| `pnpm vitest run` | **144 files / 1491 tests passed** |
| `pnpm type-check` · `pnpm lint` | clean · 0 errors |

**Container note, not a finding.** This container has no `chrome-headless-shell` for the
pinned Playwright build (1223 vs the pre-installed 1194) and the environment forbids
`playwright install`, so the runs above used a scratch config pointing `executablePath` at
`/opt/pw-browsers/chromium`. It was deleted before committing — CI uses the repo's own
`playwright.config.ts` untouched. Separately: running pgTAP straight after e2e goes red,
because `core-flow.spec.ts` leaves events behind and the pgTAP files assume the seed. Reset
between them; the numbers above all come from clean resets.

**Not done here.** Scope was held to the two items. One thing noticed and deliberately left:
`supabase/.temp/cli-latest` is listed in `.gitignore` but tracked, so it shows as dirty for
anyone who runs the Supabase CLI — `git rm --cached` in its own housekeeping commit.

---

## 2026-09-18 — ADE UX round: Joeri feedback 17/9, items A–O + K5 (z8uq9m0g0j)

Two draft PRs, both open, task stays `in progress` until merged + tested. Milestone: Now
(ADE campaign). Built per `docs/plan-ade-ux-round-2026-09-17.md` as one orchestrating
session spawning 6 parallel worktree sub-agents (streams S1–S5 for the UI, S6 for the
one migration), merged in the plan's order (S2 → S1 → S5 → S4 → S3), reconciled, and
visually verified against the fixture harness (`pnpm dev:fake` + `pnpm shot`, plus a few
throwaway interactive Playwright scripts for click-through behaviour the harness alone
can't capture).

**PR 1** [#298](https://github.com/Max-Seffelaar/PlusOne/pull/298) — items A–O, no
migration. `pnpm lint` clean, `pnpm type-check` clean, `pnpm vitest run` **144 files /
1492 tests green** (baseline before this round: 123 files / 1253 tests). pgTAP, the
concurrency suite, e2e and `pnpm build` were not run (no docker/supabase CLI in this
container); the PR body says so explicitly and flags one known e2e selector
(`tests/e2e/app-shell-no-remount.spec.ts:193`, literal `'Door'` → `'Check-in'` for item
L) left for a local-stack pass.

**PR 2** [#299](https://github.com/Max-Seffelaar/PlusOne/pull/299) — item K5, the round's
only migration and its only high-risk surface, on its own branch
(`claude/ade-ux-round-z8uq9m0g0j-db`) with the review-gate security-research prompt in
the body per CLAUDE.md. Not yet reviewed (`/code-review` + `/security-review` still
needed) or run against pgTAP.

**Cross-stream reconciliation the orchestrating session had to do after all 5 UI streams
merged** (none of it improvised feature work — all mechanical fixes to make streams that
were built blind to each other's exact shape agree):
- S5 built the door "Edit plus-ones" call site against an assumed `PlusOnesSheet`
  signature (`plusOnes`, no `onSaved`) before S4 landed; S4's actual sheet takes
  `current` + `onSaved`. Fixed the call site and its test's mock to match.
- Item A's "New event" button pushed `home.tsx` from 840 to 851 LOC, over the plan's
  explicit "never grow these" line for files already past 800 (`home.tsx`,
  `EventDayCockpit.tsx`, `guests/index.tsx`, `events/edit.tsx`). Extracted the header
  action row into `home-header-actions.tsx`; `home.tsx` is now 836.
- S6's migration was built in a worktree off a stale `main` and picked the timestamp
  `20260918100000`, which collided with `20260918100000_submit_guest_request_standing.sql`
  (PR #296, merged in the meantime). Rebased S6's branch onto current `main` and renamed
  the migration to `20260918110000` — verified unique via `git ls-tree -r origin/main --
  supabase/migrations` and the repo's own `check-migration-collisions.mjs` /
  `check-migration-duplicates.mjs` guards (both exit 0). Also merged current `main` into
  PR 1's branch for the same reason (`docs/changelog.md` had moved too) — clean, no
  conflicts.
- One purely-environmental flake, not caused by any merged code: `core.hooksPath` had
  drifted to an absolute path (`/home/user/PlusOne/scripts/hooks` instead of the tracked
  relative `scripts/hooks`) partway through the session, tripping
  `tests/unit/pre-push-hook-is-executable.test.ts`. Re-running
  `git config core.hooksPath scripts/hooks` (which is exactly what
  `scripts/setup-git-hooks.mjs`'s postinstall hook does) fixed it immediately — nothing
  in the repo needed changing, and re-running it confirmed the script itself was never
  the cause (it always writes the relative form). Left as an open question for whoever
  investigates further: something in this session's parallel worktree activity
  apparently wrote the absolute form to the shared `.git/config` at some point.

**K5 design notes worth carrying forward** (from S6's report, full detail in the
migration's own header comment and PR #299's body): the venue check resolves via
`event_venue(new.event_id)`, never the client-supplied `new.venue_id` — BEFORE row
triggers fire alphabetically and `guests_contact_same_venue` sorts before
`guests_set_scope`, so trusting `new.venue_id` would have been a bypass hiding in plain
sight. The guard is `SECURITY DEFINER` (staff can't `SELECT contacts` under RLS at all,
so an INVOKER guard would reject the very feature it protects). It validates a *change*
to `contact_id`, not merely its presence, specifically so a guest linked to a contact the
AVG sweep later anonymizes stays writable — a door check-in must never fail because
someone exercised their right to be forgotten.

**Not done, deliberately left to Max / a local-stack session:** merging either PR,
running pgTAP/e2e/the concurrency suite, the `/code-review` + `/security-review` PR 2
needs, the flagged e2e selector fix, and the full per-screen test handoff (posted on PR 1
and to the ClickUp task) — the fixture backend has no RLS, so every permission-difference
question in that handoff needs answering on the local stack, not `pnpm dev:fake`.


---

## 2026-09-18 — The door branch moves out of `app.tsx` (86eykm76k)

Branch `refactor/86eykm76k-extract-door-branch`. Milestone: ≥5 (maintainability on a
high-risk surface). No migration, no schema change, no new dependency. Follow-up on PR #261
findings 12 + 13, unblocked by #287 (R7) landing first.

**What was wrong.** PR #261's door render-scope fix worked, and its correctness rested on an
invariant spread across ~600 lines of `app.tsx`: a `useMemo`'d `<PoDoorTab>` element held
stable by six `useCallback`s and a ten-entry dependency array, so that `DoorProvider` /
`DoorQueryProvider` — which forward `children` untouched — could bail React out of
re-rendering the virtualized check-in list. Adding a ninth prop to `<PoDoorTab>` without
adding it to that dep array froze the new prop silently: no type error, no lint rule, no
failing test. The shell root read `usePoEvents`, `usePoDoorCandidates` and
`usePoGuestRequests`, so any of those refetching rebuilt the root's whole element tree and
the door had to be defended from it by hand, twelve times over.

**What replaced it.** The door is its own component (`src/components/po/door-branch.tsx`), and
the three venue-wide queries moved into its *siblings* rather than its ancestors:

| read | now lives in | mounted when |
|---|---|---|
| `usePoEvents` | `app-screens.tsx` | only when NOT on a door URL |
| `usePoGuestRequests`, `usePoCanManageTemplates` | `app-chrome.tsx` | always (it is the nav badge) |
| `usePoDoorCandidates` | `door-branch.tsx` | the door itself, plus a null-rendering `DesktopDoorAutoOpen` for the T6 one-shot |

An unrelated shell update now cannot schedule a door render at all — there is no re-render to
bail out of. All twelve hand-memos are gone with it, along with the `isMobile`/`isDoorTab`
guards that wrapped the pin effect (the component carrying it is simply not mounted off the
door tab).

**The one memo that stayed, and why it is a different thing.** `DoorTree` is `React.memo`'d.
`usePoDoorCandidates` declares `isFetching` in its `notifyOnChangeProps` and the door's
resolver reads it, so every background candidate refetch re-renders the resolver twice.
`React.memo` absorbs that *without a dependency list*: it compares whatever props `DoorTree`
declares, so a ninth prop threaded down to `PoDoorTab` is compared automatically and the type
checker refuses to let you forget to thread it. That is precisely the property the old dep
array did not have.

**A real bug the extraction surfaced.** `useDoorOverride` dropped its override in a
`useEffect` keyed on `[pathname, searchParamsStr]`. That was fine while the pin effect lived
in the same component (effects run in declaration order), but child effects run BEFORE parent
effects — so once the door became a child, its single-candidate pin (#278) wrote an override
and the parent effect wiped it in the very same commit. The pin was lost and the door fell
back to re-deriving it from `candidates.length === 1` every render: exactly the bug #278
fixed. The reset now happens during render (React's documented "adjusting state when a prop
changes" pattern), before any child renders or effects, so the two cannot race. The three
existing #278 pin tests caught this and pass **unmodified** — they were not touched in this PR.

**`door-tab-element-identity-bailout.test.ts` is deleted, not weakened.** It asserted, by
reading `app.tsx` as text, that the door element was built with `useMemo`, handed to
`<DoorProvider>` as a bare identifier, and forwarded through every provider layer untouched.
All three were true; all three have stopped existing. A source-shape assertion about a memo
that is gone can only be deleted. What it was ultimately protecting is the outcome, and that
is now asserted behaviourally in `src/components/po/door-render-isolation.test.tsx` with real
render counters against the real `PlusOneApp`. Each mocked query is a subscribable store read
through `useSyncExternalStore` and the tests push data into those stores rather than calling
`rerender(<App/>)` — that distinction is the whole test, and an earlier draft passed even with
a venue-wide query moved back into the shell root precisely because it re-rendered from the
root. Two counters: `candidateReads` (did the door subtree get entered at all — the structural
claim) and `doorTabRenders` (did the check-in list re-render — the outcome claim).

Red-on-revert, run rather than assumed — each revert applied to the real source, each failing
on the assertion that names it:

| revert | failing assertion |
|---|---|
| `usePoGuestRequests` back into the shell root | `an unrelated shell update re-rendered the door branch: expected 3 to be 2` |
| `DoorTree` loses `React.memo` | `a candidate refetch re-rendered PoDoorTab: expected 4 to be 2` |
| `DoorTree` over-memoized (`() => true`) | `the door never re-rendered on its own state change: expected 1 to be greater than 1` |

The third is the control: without it, a door frozen solid would satisfy the first two.

**Finding 13 (the LOC ceiling), and it is enforced now.** `app.tsx` 1148 → **328** lines. The
`max-lines` eslint override was extended to the four shell files — but as `error` at a plain
`max: 800` (no `skipComments`/`skipBlankLines`), not as the screens override's `warn` at 850
on code lines only. `next lint` exits 0 on warnings, so a warning would have been as
aspirational as the prose was. Verified live by temporarily lowering the limit to 50 and
watching all four files error.

    app.tsx        1148 → 328      door-branch.tsx   383 (new)
    app-chrome.tsx  307 (new)      app-screens.tsx   200 (new)
    nav-map.ts      122 (new)

**Secondary target, from #261's efficiency angle.** `navItems` (~10 objects + 10 closures)
was rebuilt on every render and handed to an unmemoized `ResponsiveShell`. It is memoized in
`app-chrome.tsx` now, along with `mobileTabs` and `mobileBadges`, and only rebuilds when
something in it actually changed.

**Door callbacks carry no dependency array at all.** `doorNav` is one permanently stable
object whose handlers read what they need out of a latest-value ref at call time instead of
capturing it. Handlers only run after a commit, and the ref is never read during render.
Nothing in it can go stale because nothing in it is captured — a handler added later gets the
same guarantee for free.

**Guards, unchanged and green.** `tests/e2e/app-shell-no-remount.spec.ts` (both specs — the
#287 measurement of the exact behaviour this PR restructures),
`tests/e2e/app-home-events-visible.spec.ts` (both — the `ssr:false` 86eya4yuf guard),
`tests/unit/app-shell-no-ssr-suspense.test.ts`, and `core-flow.spec.ts` (door check-in
asserted in the database). None was modified. `app.code-split.test.ts` was repointed from
`app.tsx` to `app-screens.tsx` — the file that owns the screen switch now — with every
assertion left identical.

**Suites.** `pnpm lint` clean (2 pre-existing a11y warnings in `datetime-field.tsx`,
untouched). `pnpm type-check` clean. `pnpm vitest run`: 129 files, **1372 passed, 0 failed**
(1373 before: −4 deleted identity-bailout tests, +3 isolation tests). `pnpm e2e:smoke`: **6
passed, 0 failed**.

---

## 2026-09-18 — Security: `auto_approved` stops answering "is this person on the list?" (z8uq9m0gvy)

Branch `fix/z8uq9m0gvy-auto-approved-oracle`. Milestone: ≥5 venues. One migration
(`20260918100000_submit_guest_request_standing.sql`), no app code, no schema change, no new
dependency. Found in the fresh-session review of PR #276, where it was pre-existing and
out of scope.

**The bug.** `public.submit_guest_request` is SECURITY DEFINER and granted to `anon`, so it is
reachable straight off the public key plus a link slug. On a link with `auto_approve = true`
and an unlocked list it returned `auto_approved = false` *exactly* when the submitted e-mail
already held an approved request on that event. Measured on the local stack before the fix:

```
1 victim signs up (fresh)        -> status=ok  auto_approved=true
2 attacker retries that e-mail   -> status=ok  auto_approved=false
3 attacker tries unknown address -> status=ok  auto_approved=true
```

That is a reliable yes/no answer to "is this named person on the list for this event?" —
the thing CLAUDE.md's security checklist forbids outright ("public endpoints … never reveal
whether a guest/e-mail exists"), and AVG-relevant besides: it confirms a named individual's
attendance at a party. `p_ip_hash` is a function *argument*, so a direct PostgREST caller
picks its own throttle bucket and has no effective rate limit on probing.

The sharp part is that the function already committed to indistinguishability for its
neighbours — the fullness branch is commented *"full: stays pending, indistinguishable for
the requester"* and the block header says *"#28: link config/fullness is not enumerable"*.
The already-approved branch was the single place that commitment was not kept.

**The fix.** `auto_approved` now reports the requester's **standing** ("you hold an approved
spot for this event") instead of "this call did the inserting". Those two coincide for a
first-time submitter and came apart for a repeat one, which is the whole leak. `true` is
honest — the person really is on the list, and the landing page's *"say your name at the
door"* is the correct thing to tell them.

**Why the obvious one-liner would not have been a fix.** Flipping only the already-approved
branch moves the oracle one probe later instead of closing it. The silent-dedup path
(`v_request_id := null`, a pending row already existed) *also* answered `false`, so probing
any address twice still separated the cases:

```
pre-approved address : true, false        <- leak survives at probe 2
unknown address      : true, true, false
```

Both arms are covered, so all four probes agree. `landing.test.sql` E4/E5 exist specifically
to fail if someone later "simplifies" this back to one branch.

**What did not change.** No approval behaviour moves: no guest row is created that was not
created before, no request is decided that was not decided before, and the deliberate
"a re-submit lands as a NEW pending row so staff can judge the repeat manually" behaviour is
untouched (E6/E7 pin both). The judgement call is that the requester is told about *their
spot* while a fresh pending row sits in the staff queue — the requester's operative fact is
that they get in at the door, and that is true.

Everything now hangs off one `not v_locked` gate, so a locked list still answers `false` to
every e-mail alike (E8/E9) — the fix does not trade the e-mail oracle for a lock-state one.

**Known residuals — corrected after review; this is a swap, not a close.** The first draft of
this PR described the at-capacity case as an inherited residual and justified it with a
mechanism that does not exist. The fresh-session review disproved both, and the migration
header, `docs/security-audit.md` §4A and this entry were rewritten to match:

- **Below capacity** the oracle is closed: a fresh address, an already-approved one and a
  repeat probe of either all answer `true`.
- **At capacity the oracle is open, and this migration opened it.** Before the change the
  `v_already` arm did not exist, so an already-approved address fell through to `false` and
  matched the stranger whose insert the capacity triggers had just rejected. Now the
  already-approved address answers `true` and the stranger `false`. Net: the leaking regime
  moved, it did not disappear. Keeping the change is still right — below capacity is where
  an event spends most of its life, and the leak there was unconditional — but the endpoint
  must not be described as free of e-mail enumeration.
- **The stated justification was factually wrong.** The claim that
  `guests_event_contact_uidx` rejects the duplicate at index time is false:
  `guests_autolink_contact` is BEFORE INSERT and leaves `contact_id` NULL on this path, and
  the index is partial (`where contact_id is not null`), so the probe insert reaches the
  capacity triggers and raises `45006`. The review proved this live. The rationale is
  removed, not restated.
- **One-sidedness is not mitigation.** Two throwaway addresses establish the regime for
  free — two `true`s means below capacity, two `false`s means at capacity — after which any
  `true` is definitive.
- **Closing it does not require duplicating the capacity rules.** Attempting the same insert
  in a subtransaction that is always rolled back reuses the triggers as the single source of
  truth. That is a real change to a SECURITY DEFINER function on the anon surface, so it is
  its own reviewed task rather than an addition to this one.

The undecided-pending residual is unchanged: an address with an *undecided* pending request
still answers `false`, and closing it means auto-deciding a request that arrived through
another, possibly manual-review, link — a workflow change, left for an explicit decision.
§4A also now records the **caller-chosen `p_status_token_hash` on the silent-dedup path**
(HIGH, pre-existing, untouched here) so that section is not read as a closed set. The same
pass corrected §4A's stale rate-limit numbers — the doc still said 10 requests / 10 min; the
code has been 5 / 15 min since `20260625100000`.

**An existing assertion changed, deliberately.** `auto_approve.test.sql` E1 required
`auto_approved = 'false'` for the already-approved re-submission — it was pinning the leak.
It now requires `'true'`; E2, the guard that section is really about (on the list exactly
once, repeat waits for staff), is unchanged and still passes.

**Suites**, run on a fresh `supabase db reset`: pgTAP **58 files / 1152 assertions PASS**
(`pnpm db:test`, plan/run gate green); Vitest **1373/1373** across 129 files; `pnpm
type-check` clean; `pnpm lint` exit 0 (2 pre-existing `jsx-a11y` warnings in
`datetime-field.tsx`, untouched). Red-on-revert was shown: with the pre-fix body reinstalled,
E2/E4/E5 fail `have: false, want: true` while E1/E3/E6–E9 stay green.

**Not pushed to prod.** Production has not deployed since 2026-08-19 (Vercel env guard,
`NEXT_PUBLIC_SENTRY_DSN` unset in the Production scope). Per the task, the migration stops at
merge; the schema deploy happens centrally once the app deploy is unblocked.

---
## 2026-09-17 — ADE UX round planned: 15 items from Joeri's feedback, verified in code, plus a docker-free screenshot harness

Branch `claude/wonderful-hopper-ji35cw` (plan-only PR, no app code). Source: Fathom call
Max <> Joeri 17/9 + Max's decisions in the planning session of the same day. Deliverables:

- `docs/plan-ade-ux-round-2026-09-17.md` — items A–O, each with Decision / Today
  (verified in code, file + line) / Spec / Tests, six work streams with file ownership,
  two PRs (K5's `guests.contact_id` venue guard is the only migration → its own PR and
  the review gates).
- `docs/prompts/ade-ux-round-orchestrator.md` — the paste-in prompt for the ONE building
  session (subagents in worktrees, merge order, harness, PRs, bookkeeping, test
  handoff). ClickUp umbrella task `z8uq9m0g0j`.
- `scripts/dev/fake-supabase.mjs` + `scripts/dev/screenshot.mjs` (`pnpm dev:fake`,
  `pnpm shot`) — a fixture-backed GoTrue/PostgREST subset so the REAL app boots in a web
  container (no docker, no supabase CLI) for looking at screens. Not a test double: no
  RLS, realtime 404s, writes stay in memory; nothing in CI depends on it. Ports
  55421/7100 sit beside the local stack (553xx) and `pnpm dev` (7000/70xx).

Findings worth keeping (all carried in the plan): the desktop guest-list avatar is
lavender for VIP-*type* tiers regardless of the tier's colour (`accent={role === 'VIP'}`,
four sites); the event form never derives an end date, and the day picker has no
month/year dropdown and does not follow typed text while open; name-only guests never
link to a contact by design (autolink is email/phone only) and there is NO database
guard that `guests.contact_id` belongs to the guest's venue (only `add_contact_to_event`
checks); the "+N" chip on the guest profile is a static `MiniChip`; the door overlay's
"…" button has no handler; `t.guests.add.contactPromptHint` has no render site.

Validated here: `pnpm dev:fake` boots against the fixtures, dev-login through the fake
sets real cookies, `pnpm shot` captured 30+ desktop + mobile screens used in the
session. Not run: pgTAP / e2e (no stack in the container) — this PR touches no app code.

## 2026-08-19 — Perf: the /app shell stops remounting on every navigation (86ey9uc87)

Branch `perf/86ey9uc87-no-remount-shell`. Milestone: Now. No migration, no schema change, no
new dependency. Three files of production code, and two of them are almost entirely comments.

**The bug.** `PlusOneApp` — the entire `/app` shell — was torn down and recreated on every
`router.push`. It was rendered by `src/app/app/[[...segments]]/page.tsx`, and Next rebuilds
the *page* subtree for each segment path; only the *layout* instance is preserved across
client-side navigation. So every screen change re-ran every shell effect (billing-return,
Sentry screen tag, viewport resolution, nav construction, the door auto-open one-shot, the
entrance animation) and reset every piece of shell state.

This was known, not suspected: the `hasPushedThisSession` comment in `app.tsx` documented a
mount/unmount probe firing on every navigation, and the module-level variable exists *because*
a `useRef` could not survive it.

**The measurement, since "feels faster" is not evidence.** A mount counter on `PlusOneApp`
(`window.__poShellMounts`, dev/test builds only), read across one real browser session on the
mobile viewport. Counts are doubled by `reactStrictMode`'s dev double-invoke, so one real
mount reads as 2 — what matters is whether the number moves at all.

| step | before (`main`) | after |
| --- | --- | --- |
| initial `/app` load | 2 | 2 |
| tab → Events | 2 | 2 |
| push → event detail | **4** | 2 |
| browser Back → events | **8** | 2 |
| tab → Guests | 8 | 2 |
| tab → Door (+ `?event=` pin) | **12** | 2 |

Before: five navigations, the shell mounted six times. After: it mounts once and never again.
Note the *shape* of the old behaviour — tab-root switches at the same segment depth did not
rebuild, deeper segment paths did. That is why this never showed up as an obvious break: the
cheapest navigation to try by hand was the one that already worked.

**The fix.** Render `<PlusOneAppClient />` from `src/app/app/layout.tsx` instead of from
`page.tsx`; `page.tsx` now renders `null` and exists only so the catch-all route matches.
`PlusOneApp` already derives its active screen from `usePathname()`/`useSearchParams()` (G1),
which are client hooks that re-render in place — it never needed the page slot to re-render in
order to follow the URL.

**The `ssr:false` trap was checked, not assumed (86eya4yuf).** CLAUDE.md forbids a client
component that suspends during SSR from hanging under a page `<Suspense>` at a route root, and
`/app` mounts via `app-client.tsx` with `ssr:false` for exactly that reason. Moving the mount
point does not touch that property: `app-client.tsx` carries `'use client'`, so its
`next/dynamic(..., { ssr: false })` runs in a *client* module and removes the server suspension
by construction, regardless of which server parent renders it — and the layout is the same kind
of server parent `page.tsx` was. `tests/unit/app-shell-no-ssr-suspense.test.ts` was widened
rather than relaxed: it now forbids a direct shell import from *either* file, requires exactly
one of them to mount via `app-client` (two mounts would mean two `DoorProvider`s and two
outboxes), and pins that the one is the layout. `tests/e2e/app-home-events-visible.spec.ts` —
including its `requestAnimationFrame`-stubbed never-painted-tab case — is untouched and green.

**Blast radius, walked deliberately.** Every piece of state that was silently
remount-scoped is now session-scoped:

- `hasPushedThisSession` **stays module-level.** A ref would work for screen-to-screen pushes
  now, but the flag's real question is "does this browser tab have history to pop?", and
  history belongs to the tab. `PlusOneApp` still unmounts when the user leaves `/app` for a
  sibling route (`/door/[id]`, `/e/[slug]`) and remounts on return — a client-side navigation
  that pushes real history entries while the component is gone. A ref would forget them and
  send the next `back()` down the cold-deep-link branch, reintroducing the original bug on a
  path the e2e suite does not cover. Left alone; comment rewritten to say why.
- **The #278 door-candidate pin is intact.** Both halves are derived from current state, not
  from a memory of what this mount wrote, which is precisely what makes them remount-count
  independent. One adjustment: `staleDoorRefetchRef` (one refetch per rejected `?event=`) used
  to be reset for free by the per-navigation remount. Without that it would live for the whole
  tab session, so an id going absent → present → absent again would be rejected against a
  possibly-stale list with no retry. It is now released alongside `rejectedDoorId` when the id
  reappears — "one retry per rejection episode", with no new memory of who chose the id.
- **The #281 venue-switch fix is untouched** (it ends in `window.location.assign`, a full load).
- **Door offline invariant #25 holds.** Overlay open/close still goes through `pushDoorState`
  on raw history, which never involved the router in the first place. `page.tsx` still does
  zero server data work, so query-string-only navigation stays fully client-side.
- The billing-return `sessionStorage` round-trip is kept even though the same mount now reads
  its own parked flag straight back: it costs nothing and still carries the toast across the
  strip-and-`replaceState` and any genuine reload.

**86ey9tq62 re-tested** (overlay stays open / Back lands wrong after check-in), since this
remount was its suspected cause: `tests/e2e/door-overlay-back.spec.ts` passes both before and
after. It was already fixed by the popstate listener in `use-door-override.ts`; the remount was
not what kept it alive. Reported as-is rather than claimed.

**New guard.** `tests/e2e/app-shell-no-remount.spec.ts` drives tab switches, a pushed detail
screen, browser Back, the door's `?event=` pin, the guest overlay's `?guest=` and the popstate
back out of it, asserting the mount count never leaves its baseline. Verified adversarially: on
`main`'s arrangement it fails on the first pushed screen (expected 2, received 4).

**Gates.** `pnpm lint` clean (2 pre-existing a11y warnings in `datetime-field.tsx`, untouched),
`pnpm type-check` clean, `npx vitest run` 122 files / 1242 tests green, Playwright e2e green
(see PR body for the run's real counts).

**Fresh-session `/code-review` (PR #287) — no correctness bug in the production code**, and the
acceptance criterion was reproduced in both directions by the reviewer. Three findings, all in
the new *test* material, all fixed on the branch:

1. **The guard never ran in CI.** `.github/workflows/ci.yml` has exactly one Playwright step,
   `pnpm e2e:smoke`, and that script named three files — not this one. `pnpm e2e` is never
   invoked by CI. So moving the mount back under `page.tsx` would have stayed green forever,
   in a file that exists precisely because the regression is invisible to every other test.
   `app-shell-no-remount.spec.ts` is now in `e2e:smoke`, next to the sibling guard
   `app-home-events-visible.spec.ts` that is wired in for the same reason. `STACK_SUITES` in
   `scripts/session-setup.mjs` names the *script*, not its files, so its runtime validation
   against `package.json` still passes unchanged.
2. **The spec was not hermetic** — fixed FIRST, because wiring a DB-order-dependent spec into
   CI is how you buy a flaky pipeline. It entered the door through the bottom tab and so
   depended on the door's implicit single-candidate auto-pin, i.e. on the venue having exactly
   ONE open event. `core-flow.spec.ts` leaves extra open events behind, so on a second run
   against the same database the picker rendered instead of the check-in list and the spec
   failed on a missing search box — reading as a broken door rather than a dirty database. It
   survived a full `pnpm e2e` only because alphabetical file order happened to put it ahead of
   `core-flow`. The measurement now enters the door explicitly via the event's own "Check-in"
   button (`nav.openDoor` → `/app/door?event=<id>`, the same URL `door-overlay-back.spec.ts`
   uses), which is independent of the candidate count and still exercises the `?event=`
   query-string leg. The implicit pin keeps its own assertion in a second test, written to
   cover both database states: one candidate → the pin fires, more than one → the picker is
   correct, and a picker offering a *single* card fails it.
3. **The one behavioural change had no test.** The `staleDoorRefetchRef` release above is the
   PR's only logic change, and deleting the line left the entire suite green (DoD #4).
   `src/components/po/door-pin-lifetime.test.tsx` gains a third phase on the existing retry
   test: it drives the requested id absent → present → **absent again** and asserts the refetch
   fires a second time. Red-on-revert, measured: with the line deleted the file runs
   **1 failed | 3 passed** (`expected 1 to be 2`); restored, **4 passed**.

**Post-review gates** (this branch, local Supabase): `pnpm lint` clean (same 2 pre-existing
a11y warnings), `pnpm type-check` clean, `npx vitest run` **122 files / 1242 tests passed**,
`pnpm e2e:smoke` **6 passed (53.2s)** on a `pnpm db:fresh` database and **6 passed (47.6s)** on
an immediate second run with no reset in between — the exact scenario that used to fail. For
the record, the pre-fix spec re-run against that same dirty database still fails on
`getByPlaceholder('Search a name…')`, so the hermeticity fix is what changed the outcome.

---

## 2026-08-19 — `add_contact_to_event` PII-reuse is by design, documented (86ey9e9nb)

Branch `docs/86ey9e9nb-contact-reuse-by-design`. Documentation only — no policy, function,
or permission changed. Spec decision **#47** added to `gastenlijst-app-spec.md` (with a
pointer amendment on the Adresboek & auto-contact paragraph); explanatory comments added at
the call sites in `src/features/contacts/actions.ts`.

**The finding this closes out.** `add_contact_to_event` (`SECURITY DEFINER`,
`supabase/migrations/20260619000000_add_contact_to_event_plus_ones.sql:38,55`) gates only on
`can_write_guests(p_event_id)` — true for staff and doorhost, not just managers. It reads the
contact via DEFINER rights (past `contacts_select`, which denies staff/doorhost direct PII
reads) and copies `full_name`/`email`/`phone` into the new `guests` row (`added_by =
auth.uid()`); because `guests_select` shows a caller their own `added_by = self` rows, the
staffer reads that PII straight back. A repeat `/security-review` kept re-surfacing this
because the bulk sibling, `add_contacts_to_event`, is admin/organizer-only while this
single-add path isn't — an unexplained asymmetry reads as a forgotten tightening.

**The decision (Max, 19/8): by design, not a gap.** This is exactly the "reuse in one tap"
path `search_contacts_for_reuse()` exists to power. Anyone who reaches this RPC already holds
unrestricted `can_write_guests` — they could type that same name/e-mail/phone into a manual
guest add regardless, so copying an existing contact's PII into a guest row they own grants no
new capability. The managers-only read on `contacts` governs *browsing* the whole address
book; it was never meant to gate reusing one already-identified contact. The bulk RPC stays
admin/organizer-only because it's the tail of the admin-only CRM-import flow
(`upsert_contacts`), not the "I recognize this person" moment the single-add path serves — the
asymmetry is intentional. **The gate stays `can_write_guests(p_event_id)`; nothing in the code
changed.**

**Why documentation only, no new migration.** A `COMMENT ON FUNCTION` migration was
considered so the explanation would live next to the SQL itself, but the applied migration
can't be edited in place (repo convention), and a comment-only migration still carries a
`db push` + fresh-`supabase db reset` + pgTAP cycle for zero behavioural change. Chose instead:
the full write-up in the spec's decision table (#47, the durable source of truth per
`CLAUDE.md`) plus a pointer comment at both TypeScript call sites
(`addContactToEvent`/`addContactsToEvent` in `src/features/contacts/actions.ts`) — a future
reader hits the explanation exactly where they'd look, without a schema change for a comment.

**Verification:** `pnpm lint` clean (pre-existing warnings only, unrelated file), `pnpm
type-check` clean, `pnpm vitest run` — 115 files / 1188 tests green. No RLS/pgTAP change, so no
`supabase db reset` was needed for this PR.
## 2026-08-19 — PR #276 visual-QA response: phone accepted a non-number, approve screen hid the e-mail (86eyke279)

Branch `feat/86eyke279-landing-contact-required`, same PR/task as the two entries below —
the visual-QA response pass, not a new task. A QA session walked the whole PR on a real local
stack (15 handoff questions: 12 ✅ · 3 ⚠️ · 0 ❌, plus eight edge-case blocks) and came back
with one blocker and three smaller items. Every finding was re-measured here before it was
touched.

**BLOCKER — `12345` was accepted and stored as `+3112345`.** Reproduced in one pass: a valid
name + e-mail, `12345` in the phone field with the selector on 🇳🇱 +31, submit → *"Request
sent."* and `guest_requests.phone` holding `+3112345`. Not a number anybody can call.

Root cause, re-measured against the installed `react-phone-number-input` 3.4.17 /
`libphonenumber-js` 1.13.6 rather than taken on report:

```
                     +3112345   +31612345678   +31201234567
default (= /min)     true       true           true
/max                 false      true           true
/mobile              false      true           false
```

The default entry ships libphonenumber's **`min`** metadata — per-country *length bands*, no
numbering plan — so a five-digit non-number sits inside the NL band and passes. The DB regex
`^\+[1-9][0-9]{1,14}$` is a deliberate **shape** check and cannot catch it either. The field
this PR makes mandatory was therefore the path of least resistance for anyone unwilling to
give a real number, which contradicts the PR's own premise that *"a required field that
accepts `x` is theatre"*.

**Fixed by moving the WHOLE phone surface to `/max`**, not just the validator: `isPhoneValid`
and `phoneCountryOf` (`react-phone-number-input/max`), the input build (`/input-max`) and the
country picker (`country-select.tsx`). Changing only the validator would have bundled *two*
metadata blobs and left the input formatting numbers under `min` that the validator then
rejects under `max`. `/mobile` was considered and rejected: it refuses the valid Amsterdam
landline `+31201234567`.

**Bundle cost — measured, not estimated.** Two full production builds (`pnpm build`),
baseline `993196f` vs the patched tree:

| | before | after | delta |
|---|---|---|---|
| First Load JS, **every** route | — | — | **identical** (route-table diff empty) |
| `/e/[slug]` First Load | 147 kB | 147 kB | 0 |
| lazy phone chunk, raw | 164.5 kB | 236.4 kB | +71.9 kB |
| lazy phone chunk, gz | **39.6 kB** | **59.8 kB** | **+20.2 kB** |

The metadata already sat behind the #B4 lazy boundary, so the delta lands **only** on users
who actually render a phone field — never on first paint of the public landing page. The
+71.9 kB raw is exactly one metadata blob (`metadata.max.json` 154.3 kB − `metadata.min.json`
82.3 kB = 72.0 kB), which confirms the single-build approach worked and no `min`+`max`
duplication crept in. Judged acceptable: 20 kB gz on a deferred chunk buys correctness on the
one field the PR makes mandatory.

**The server-side alternative was considered and rejected.** Tightening `submit_guest_request`
cannot express a numbering-plan check without hand-porting libphonenumber's per-country plans
into SQL, which is strictly worse to write and to keep current. The RPC keeps its shape check
by design, and the PR body records the residual: a hand-rolled caller can still post its own
junk number — it just cannot post it *through the form*.

**Guard.** New `tests/unit/phone-metadata-max.test.ts` locks both halves: the behaviour
(`/max` refuses the blocker, keeps NL mobile **and** landline, keeps international numbers)
and the wiring (every phone entry point resolves to the same `/max` build). It **complements**
`tests/unit/phone-lazy-imports.test.ts` — which keeps the library out of First Load JS and was
neither relaxed nor edited. Red-on-revert verified against the previous code:

```
FAIL  the app's own isPhoneValid (what the landing form calls) > refuses the reported blocker
AssertionError: expected true to be false
FAIL  src/components/po/phone-lazy.tsx imports only /max phone builds
FAIL  src/components/po/country-select.tsx imports only /max phone builds
```

**The e-mail was invisible on the screen where requests are approved.** The PR requires the
field *"so the organizer can reach the guest"*, but the Requests card showed only
`phone •••• 5610` and the Approve sheet showed no contact at all — the address existed
correctly in the DB and appeared one screen over in Contacts, which is exactly one screen too
far at the moment of deciding. `guest_requests.email` is now selected
(`fetchGuestRequests`), carried on the domain type (`PoGuestRequest.email` / `.phone`, full
values alongside the existing `phoneLast4` hint), rendered on the pending **and** declined
cards, and spelled out in full in a Contact block in the Approve sheet — you cannot mail a
masked hint, and the same RLS-scoped roles (admin/finance/organizer) already read the complete
address in Contacts, so this is not a new exposure class. Pre-rule rows keep both columns
NULLable and say so ("No email — filed before it was required") instead of rendering an empty
box.

**Three smaller items, all from the same QA pass.**
- The country-code button was a **31px** tap target, under the 44px rule, on the very field
  this PR makes required. A `before:` overlay lifts the hit area to 44px **without** changing
  the 53px row height or the visual — 44px fits inside the row, so nothing reflows.
- **Name carried no `required` badge** while being just as blocking: three required fields,
  two badges. Now three. A reader who trusted the badges was reading a wrong form.
- The phone error said *"…including the country code"* to someone who pasted
  `+44 7911 123456` into an NL-selected field — accusing them of omitting the one thing they
  typed. It now names the **country selector**, which is accurate for both failure modes (an
  incomplete national number, and a correct number under the wrong flag).

**Deliberately left alone**, both confirmed pre-existing and out of this PR's scope: the
`auto_approved` e-mail-existence oracle on auto-approve links (already recorded as a follow-up
in the PR body) and the fixed `manager@` role restriction on Requests. The handoff link in the
PR body pointed at `manager@plusone.test`, which is `user_manager` on Club Vesper and gets
*"You don't have access to requests."* — corrected to `admin@plusone.test`. This was the
**second** handoff this sweep pointing at a role that cannot reach the screen it names (#278's
QA found the same for the Deur tab, where `manager@` is not in `DOOR_ROLES`); a cheap
structural catch is sketched in the PR body but deliberately **not** built unasked.

**Suites:** vitest **1220 passed / 116 files**, `pnpm type-check` **0 errors**, `pnpm lint`
clean (pre-existing `datetime-field.tsx` a11y warnings only). No migration, no type
regeneration — this pass is client-side plus one added column in an existing `select`. pgTAP
unchanged and still CI's verdict.

---

## 2026-08-19 — PR #276 review response: e-mail length cap + K10 guard hardening (86eyke279)

Branch `feat/86eyke279-landing-contact-required`, same PR/task as the entry directly below —
this is the fresh-session review-response pass, not a new task. The `/code-review` on PR #276
found **no merge-blockers** (server-side half re-measured against a real Postgres 16: all
eleven empty/unusable variants refuse and write zero rows, red-on-revert holds). Three
non-blocking points remained; this session closed two and recorded the third.

**Fixed — `v_email` had no length cap (migration `20260819110000:93`).** The comment claimed
"a raw anon caller still can't store junk", which wasn't quite true: `full_name` caps at 120,
`motivation` truncates at 1000, `v_phone` is implicitly bounded by the E.164 regex (~16
chars) — but the e-mail shape regex alone puts no ceiling on length, and this is an anon write
path. Measured on a bare local Postgres 16 (no Docker here either; same "minimal stubs"
method as the entry below, this time with all 99 migrations + `seed.sql` applied for real
fixtures instead of hand-built ones):

- An e-mail made of **repeated** characters compresses under TOAST and can slip past the
  `guest_requests_dedupe_idx` btree row-size ceiling even at 5000 chars — silently stored.
- An **incompressible** (random) 4000+ char local-part reproduces exactly what the reviewer
  reported: `ERROR 54000: index row size 4208 exceeds btree version 4 maximum 2704` — escapes
  the function entirely (not caught by the `unique_violation` handler), so the whole RPC call
  fails instead of returning a clean `invalid`.

Fix: `char_length(v_email) > 254` added to the same `if` as the shape checks (254 matches
Zod's `.max(254)`, keeping "everything the client accepts passes here" true). Applied
identically to the migration and `supabase/canonical/submit_guest_request.sql` (verified
byte-for-byte equal, K10 guard passes). **Red-on-revert:** reapplying the previous (unpatched)
body against the same random 4000-char e-mail reproduces the 54000 error; the patched body
returns `invalid` and writes zero rows. New pgTAP (`landing.test.sql` A25–A27): 254 chars
accepted, 255 refused, zero rows on refusal — extends `plan(39)` to `plan(42)`.

**Fixed — the K10 canonical guard could repeat the exact drift it just caught.**
`tests/unit/canonical-functions.test.ts` scanned only for `create or replace function
public.<name>(...)`. The reviewer traced why the guard went silently green for six migrations
while `supabase/canonical/submit_guest_request.sql` described a function that no longer
existed: `20260706103000` changed the arg list, which Postgres can only do via `drop` +
**bare** `create function` (no `or replace`) — a shape the old regex never matched. This PR's
migration uses `create or replace` and fixes the symptom, but the next arg-list change would
trip the same gap again. Widened the pattern to `create (?:or replace )?function public\.` and
added two focused unit tests (bare `create function` matches; `create or replace` still
matches) — red-on-revert verified by reverting the regex locally and confirming the bare-create
test goes red.

**Recorded, not fixed — `auto_approved` is an e-mail-existence oracle (`…sql:208`).** Pre-existing
(introduced in `20260706103000`'s auto-approve feature, unrelated to and unchanged by this PR's
scope), so left alone per instructions; written up as a suggested follow-up task in the PR body
so it doesn't get lost. On an `auto_approve = true` link, the `auto_approved` field in the RPC's
return value is `true` for a fresh submission and `false` when the same e-mail is already
approved on that event — an anonymous caller can use it to test whether a specific e-mail is on
the guest list, with no rate limit of its own (`p_ip_hash` is caller-supplied). This is narrower
than the blanket "no enumeration" framing in `docs/security-audit.md:101` (which is about the
`closed` slug/event answer, a different and still-true claim) — worth a follow-up nuance to that
doc alongside the fix, not done here to keep this PR narrow.

Suites: `pnpm lint` clean (same pre-existing `datetime-field.tsx` a11y warnings), `pnpm
type-check` 0 errors, Vitest **1208 passed / 115 files** (+2 from the new
`canonical-functions.test.ts` cases). pgTAP not runnable here (no Docker) — CI is the verdict,
same as the building session; the new A25–A27 assertions were dry-run as plain SQL against the
bare-Postgres fixture above and match the expected pgTAP outcome.

Not merged. Replied to and resolved all three review threads on PR #276.

---

## 2026-08-19 — E-mail én telefoon verplicht op het publieke aanvraagformulier (86eyke279)

Branch `feat/86eyke279-landing-contact-required`. Milestone: **Now** — dit raakt het vermogen
van een pilot-venue om een goedgekeurde gast te bereiken. Spec: **#9 verfijnd** (niet een
nieuw nummer — dit versmalt een bestaande beslissing) + de datamodelregel bij `guests`/
`guest_requests` in `gastenlijst-app-spec.md`.

**Wat er mis was.** Max vond het op 2026-08-10 tijdens het testen van `86eyd3men` (PR #245):
een bezoeker kon op `/e/[slug]` een aanvraag indienen met **alleen een naam**. De venue hield
daar een goedgekeurde gast aan over zonder één kanaal om die te bereiken — geen bevestiging,
geen wijziging, geen afmelding. Dat was geen bug maar een gedocumenteerde keuze (#9,
dataminimalisatie); het besluit van 2026-08-10 draait die keuze **voor dit ene pad** terug.

**Reikwijdte, expliciet.** Alleen de publieke landing/influencer-linkflow: `/e/[slug]`,
`/r/[token]`, `submitGuestRequestSchema` en de `submit_guest_request`-RPC. De **interne**
toevoegpaden (quick-add #33, bulk-paste, admin- en deur-add) blijven ongemoeid en optioneel —
daar staat een medewerker naast de gast en is anoniem "Jan +2" nog steeds de bedoeling.

**Twee lagen, allebei nodig.**

| laag | wat het doet | waarom het alleen niet genoeg is |
|---|---|---|
| `submitGuestRequestSchema` + het formulier | `email`/`phone` van optioneel naar verplicht; directe veldfeedback | de RPC is aan `anon` gegrant — een hand-geschreven PostgREST-call slaat de client volledig over |
| `submit_guest_request` (SECURITY DEFINER, migratie `20260819110000`) | weigert dezelfde gevallen met `status: 'invalid'` | een DB-only regel zou de aanvrager pas ná het versturen een generieke fout geven |

**Wat "leeg" betekent — aan beide kanten hetzelfde.** `null`, `''` en whitespace-only worden
alle drie geweigerd. In SQL was dat niet vanzelfsprekend: `btrim(x)` strijkt **alleen ASCII
spatie** weg, dus een telefoonnummer van één tab overleefde het als "waarde". De functie
gebruikt nu één benoemde whitespace-set (`E' \t\n\r\f\x0B'`) voor naam, e-mail, telefoon
én motivatie. Bovenop de aanwezigheidscheck staat een **bruikbaarheidscheck** (e-mailvorm,
E.164) — een verplicht veld dat `x` accepteert is theater, en zonder die tweede check glipt
een NBSP-only waarde er alsnog doorheen (die overleeft `btrim` wél). De DB-checks zijn
bewust **losser** dan de Zod-regels: alles wat de client accepteert komt hier langs, zodat een
strengere client nooit stil door de database wordt overruled.

**Waar de guard staat, en waarom dat uitmaakt.** Direct naast de bestaande naamcheck, dus
**vóór** de throttle. Dat is verdedigbaar juist omdat het antwoord volledig uit de argumenten
van de aanvrager zelf volgt: er wordt geen slug, link of rij van ons gelezen voordat
`invalid` terugkomt, dus het lekt niets over welke events of links bestaan (#28). Onder de
throttle zetten zou niets opleveren — wie slugs probeert stuurt gewoon geldige contactgegevens
mee — en zou een legitieme bezoeker met een typefout zijn budget kosten.

**Bestaande rijen blijven staan — bewust geen NOT NULL.** `guest_requests.email`/`.phone`
blijven NULLable. Aanvragen van vóór vandaag blijven bestaan, blijven goedkeurbaar en blijven
door de retentie-job geanonimiseerd worden. Dit is een **toelatingsregel op nieuwe publieke
indieningen**, geen invariant van de tabel; een kolomconstraint zou expand-contract breken en
historische data ongeldig maken.

**Bijvangst, los van de taak maar in dezelfde bestanden.**

- De **K10-canonical-guard klopte niet meer**: `supabase/canonical/submit_guest_request.sql`
  hield de 7-args-versie uit `20260624200000` bij, terwijl `20260706103000` die overload
  **droppte** en de live functie met `create function` (niet `create or replace`) opnieuw
  aanmaakte — waar de guard-test niet op scant. Het canonieke bestand beschreef dus een
  functie die niet meer bestond. Deze migratie gebruikt `create or replace`, waardoor het
  bestand weer de echt gedeployde body bevat.
- **Twee beslissingen stonden buiten de beslistabel.** #45 en #46 (sessie `86ey9et0h`,
  12/8) waren aan regel 3 van de spec geplakt, achter de statusregel, in plaats van onder
  #44. Verplaatst; de tabel loopt weer 1–46 op volgorde. Geen inhoudelijke wijziging.
- `tests/e2e/landing-request.spec.ts` vult nu een e-mail. Die spec is verder **gedrift**
  (Nederlandse labels tegen een EN-only surface, de uitgefaseerde `/dashboard` + `/events/*`
  routes) en draait niet in CI (`pnpm e2e:smoke` bevat hem niet); alleen de contactvelden
  zijn bijgetrokken, de rest is een eigen taak.

**Bewezen, niet aangenomen.** Deze container heeft geen Docker, dus `supabase db reset` /
`test db` konden hier niet draaien — CI doet dat. Wat hier wél kon: een kale lokale
PostgreSQL 16 met minimale stubs, waarin de migratie schoon toepast, alle elf lege/onbruikbare
varianten `invalid` teruggeven en geen rij schrijven, en de complete aanvraag `ok` geeft.
**Red-on-revert is aan beide kanten gecontroleerd:** met de vorige functiebody
(`20260706103000`) geven diezelfde vier contactloze gevallen `ok` en schrijven ze vier rijen.

**Bestaande pgTAP moest mee.** Zeven suites riepen de RPC aan met `null, null` als
contactgegevens; die zouden na deze migratie op `invalid` stuklopen. Alle call-sites in
`landing`, `contacts.capture`, `auto_approve`, `event_lifecycle_capacity`, `rls`,
`status_token` en `attacker_landing_spam` dragen nu geldige contactgegevens — inclusief de
gevallen die `closed` of `rate_limited` moeten bewijzen, want die moeten de guard eerst
passeren om überhaupt bij de slug-resolutie of de throttle te komen. Eén test veranderde van
betekenis: `contacts.capture` C1 was "een naam-only aanvraag wordt geaccepteerd maar niet
vastgelegd" en is nu "een naam-only aanvraag wordt geweigerd".

**Bekende beperking, expliciet niet gedicht.** De regel bindt `anon`, niet `authenticated`.
Voor `anon` is de RPC echt het enige schrijfpad — `20260707170000` C2 trok de directe
INSERT-grant op `guest_requests` in — dus voor het bedreigingsmodel van deze taak is de guard
compleet. Maar `authenticated` heeft nog steeds `grant select, insert, update` op die tabel
(`20260613000000_full_schema.sql:405`) en de compat-policy `guest_requests_insert_public` stelt
géén eis aan contactgegevens: een ingelogde gebruiker kan een contactloze aanvraag rechtstreeks
wegschrijven. Bewust niet meegenomen — dat valt buiten de scope, en die policy raakt ook de
interne paden die deze taak juist met rust moest laten. Vervolgtaak voor Max: óf dezelfde regel
in de policy, óf de directe insert-grant voor `authenticated` helemaal weg.

**Openstaand voor Max:** de per-screen test handoff op de PR, en `/security-review` door een
verse sessie (SECURITY DEFINER op een publiek anoniem schrijfpad = high-risk). Niet zelf
gemerged. Typegeneratie (`src/lib/database.types.ts`) is **niet** nodig: de signatuur van de
RPC is ongewijzigd, alleen de body.
## 2026-08-19 — Stripe webhook: a malformed `client_reference_id` no longer retries forever (86ey9e9re)

Branch `fix/86ey9e9re-stripe-webhook-uuid-guard`. Milestone: Now (a stuck webhook queue hides
every *real* billing failure behind it). No migration — the fix is entirely application-layer.

**The bug.** `checkout.session.completed` carried `session.client_reference_id` straight into
`apply_stripe_subscription_update` as `p_venue_id`, whose declared type is `uuid`. That field is
an arbitrary Stripe-side string, not a validated id: a checkout started from the Stripe
dashboard, a legacy/typo value, or an attacker-supplied one all arrived verbatim. Postgres
failed the cast (`22P02`), the RPC returned an error, and the handler's one and only error
branch answered **500** — the code Stripe reads as "retry me". The same unfixable event then
came back with backoff for days, and genuine webhook failures drowned in that noise.

**The fix, and the line it draws.** A `z.string().uuid()` guard runs between the mapping and the
RPC. A present-but-malformed venue id is reported to Sentry and answered **200 `unprocessable`**;
the RPC is never called. The reasoning is a property of the input, not a preference: a
malformed `client_reference_id` cannot become valid on redelivery, so a retry has no possible
success path and 500 is simply the wrong answer. 500 stays reserved for what it was documented
for — genuinely transient failures.

**What this does NOT fix — the storm moves one event downstream.** Stated plainly because the
first version of this entry did overclaim it. The guard retires *this* event; for the scenario
that motivates the fix it does not make the venue work.

Take a Stripe-**dashboard**-created checkout whose `client_reference_id` was typed by hand into
something non-UUID. That venue's `subscriptions.stripe_customer_id` is `NULL`: `stamp_stripe_customer`
runs only in `createCheckoutSessionAction`, i.e. the app's own path. The one remaining chance to
link the customer is the webhook's own RPC, which writes
`stripe_customer_id = coalesce(p_stripe_customer_id, …)`. The guard returns before that call — so
the customer id is never stamped **at all**. Then `invoice.paid` arrives, carries no
`client_reference_id`, matches on `stripe_customer_id`, finds nothing, and raises `P0002`. The
handler's single error branch makes that a 500; the raise rolled back the ledger insert in the
same transaction, so the redelivery is never recognised as a replay and re-raises identically,
forever — now on the event that carries the money. The venue never activates and a real payment
lands silently in nothing.

**It is still strictly better, and the blast radius is narrow.** Pre-fix *both* events 500'd in a
loop; post-fix only the second does. And the guard is unreachable from our own checkout:
`stripe-adapter.ts` sets `client_reference_id: input.venueId` from a Zod-parsed, admin-checked
venue id, and `stamp_stripe_customer` runs before the redirect. Only dashboard/external checkouts
can reach it, and only those where somebody actually filled the field in — a dashboard checkout
with the field left *blank* never trips the guard at all and lands in the same `P0002` loop it
already had. So: this PR removes one permanent retry loop and routes a narrow, pre-existing
second one onto the money event.

**Therefore the `event.created`-age cutoff below is the priority follow-up**, not a nice-to-have:
it is the piece that turns that surviving `P0002` loop into a bounded failure.

Two boundaries worth stating, because both are load-bearing:

- **A `null` venueId still flows through.** `invoice.paid` and the subscription events carry no
  `client_reference_id` at all and match on `stripe_customer_id`; the guard rejects *malformed*,
  never *absent*. Regression-tested.
- **`mapStripeEvent` stays pure.** It reports what Stripe actually sent, non-UUID included;
  validation is the handler's concern. A test pins that passthrough so a later "helpful" null-ing
  inside the mapper can't quietly turn a poison event into a silent no-op.

**Deliberately rejected: falling back to customer-matching.** With `p_venue_id` null the RPC
matches on `stripe_customer_id`, so a malformed venue id *could* have been nulled and the event
applied anyway. That would infer intent from a malformed billing event and mutate a subscription
on a guess. A human reads the Sentry warning instead.

**New: `src/lib/observability/sentry-server.ts`.** There was a lazy *browser* Sentry facade but
no server one. It reaches the SDK (already initialised by `instrumentation.ts`) through a dynamic
`import()`, including for its types. Telemetry swallows its own failures — it must never turn a
200 into a 500.

The type-position workaround is worth recording, because **the lazy-import guard it routes around
is itself buggy**. `tests/unit/sentry-lazy-imports.test.ts:35` uses
`/import\s+(?!type\s)[\s\S]*?from\s+['"]@sentry\/nextjs['"]/`. The `[\s\S]*?` spans the whole file, so
the negative lookahead only ever inspects the **first** import statement: any preceding import
(`import 'server-only'`, `import { z } from 'zod'`) starts the match and the scan runs on to the
Sentry `from` clause. Verified by running the real regex against constructed cases —

| source | result |
|---|---|
| `import type { X } from '@sentry/nextjs'` alone | ok |
| `import 'server-only'` + that same type import | **FLAGGED** |
| `import { z } from 'zod'` + that same type import | **FLAGGED** |
| `typeof import('@sentry/nextjs')` (what this module uses) | ok |
| `import * as Sentry from '@sentry/nextjs'` | **FLAGGED** |

— which contradicts the guard's own doc comment ("`import type … from '@sentry/nextjs'` is fine
and not flagged"): it is flagged in every realistic file. Writing the types as
`typeof import('@sentry/nextjs')` leaves no `from` clause, so the guard stays intact and this
module needs no allowlist entry. **Fixed separately** (see the follow-up entry) — a CI-required
guard deserves its own reviewable change, not a passenger seat in a billing PR.

**Left open, reported not fixed (scope).** The same 500-means-retry-forever shape survives on the
RPC side. `apply_stripe_subscription_update` (current definition:
`20260714130000_stripe_event_ordering_guard.sql`) raises on three more conditions, and because the
raise rolls back the `stripe_webhook_events` ledger insert too, the redelivery is never recognised
as a replay — it re-raises identically, forever:

| errcode | condition | retryable? |
|---|---|---|
| `45010` | venue already linked to another Stripe customer | **never** — same payload, same raise |
| `22004` | event carries neither venue nor customer | **never** |
| `P0002` | no subscription matches the event | **mixed** |

`45010` is unfixable by construction and is the closest sibling of the bug fixed here. `P0002` is
the one that cannot simply be mapped to 2xx: it has a legitimately transient sub-case — the webhook
racing ahead of `stamp_stripe_customer`, which the original migration comment calls out as the
*reason* it raises — alongside a permanent one (a dashboard-created customer, a deleted
subscription row). Separating "not yet" from "never" needs a decision, not a patch; an
`event.created`-age cutoff is the obvious candidate. Detailed in the PR body; not touched here.

**Review round (fresh-session `/code-review` + `/security-review`: no blocking defect, four inline
findings).** What changed in response, and what deliberately did not:

- **Log levels now agree — `console.warn`, not `console.error`.** Sentry filed this at
  `level: 'warning'` while the console call was `console.error`. On Vercel, log drains and
  alerting key on `console.error`, so a branch that has *deliberately decided the event is not
  actionable* (it answers 200 on purpose) was paging as an error. Both sinks are `warning` now,
  pinned by a test that asserts `console.error` is **not** called on this path.
- **The Sentry warning is now self-contained enough to triage.** Keeping the rejected value out
  of the logs is right (unvalidated third-party input, CLAUDE.md §Security), but it left an
  operator unable to tell *what* arrived without opening Stripe. New `fingerprintOf` emits only
  derived facts: `valueType`, `valueLength`, and `valueCharset` — the set of character classes
  present, `+`-joined. `dash+hex` at length 18 is a truncated uuid; `alpha+dash+hex` is a
  hand-typed label; `punct`-heavy is a pasted blob. It cannot reconstruct the value (a test
  asserts no substring of the input ever appears in the output), the class set is capped at six
  members and the scan at 4 096 chars, so a megabyte of junk still yields one bounded log line.
  `valueType` also names the case where `client_reference_id` deserialises to a non-string —
  which is itself the finding.
- **A dead-letter record for dropped billing events: deliberately NOT in this PR.** The review is
  right that a discarded **billing** event currently survives only in two best-effort sinks —
  Sentry (`enabled: Boolean(dsn)`, a silent no-op without a DSN) and Vercel runtime logs, which
  age out — and that "how many did we drop last month?" has no queryable answer in a repo whose
  stated core value is *fraud resistance — everything audited*. Three reasons it waits:
  1. It needs a table, RLS policies, pgTAP coverage for both allowed and denied cases, and an AVG
     retention decision. That is a migration-shaped change inside a PR that deliberately has no
     migration; it belongs with the `P0002` work that will define what else lands in the same
     store.
  2. The event is not actually unrecoverable in the window that matters: Stripe retains event
     objects and their delivery attempts for ~30 days, and the `eventId` we *do* log is the key to
     look one up. The gap is real but it is a **retention** gap, not a total loss.
  3. Milestone rule: the reachable population is dashboard/external checkouts with a hand-filled
     non-UUID reference — near-zero today, and zero from our own checkout path by construction.
     A new audited persistence surface for that is not "Now".
  Recorded here rather than dropped: the correct shape is a record keyed **differently** from the
  live `stripe_webhook_events` ledger (a separate table, or a `rejected_reason` column on a
  distinctly-keyed row), because a ledger insert here would burn the event id and leave the event
  permanently replay-suppressed even after the cause is fixed. The guard returning *before* the
  RPC is what preserves that option, and that part is correct as it stands.

**Follow-ups this PR consciously leaves open**, in priority order:
1. **`event.created`-age cutoff on the RPC's `P0002` path** — the one that bounds the surviving
   retry loop described above. Highest value.
2. **Dead-letter record for discarded billing events**, per the reasoning above; pairs with (1).
3. `45010` / `22004`, which are unfixable-by-construction retries with the same ledger-rollback
   shape.

**Tests.** On the branch merged up to `main` (`daf0e58`): Vitest **1257 passed / 120 files**,
pgTAP **1112 passed / 57 files** — both run here against a live local stack, on the complete merged
migration set. `pnpm lint` clean (2 pre-existing `datetime-field.tsx` a11y warnings, file
untouched), `pnpm type-check` zero errors.

This PR's own contribution, measured on its pre-merge base: **+24 vitest tests** (1188 → 1197 in
the first round, → 1212 after the review round). No SQL, so the pgTAP delta is zero.

Every new assertion verified red against the behaviour it replaces, not assumed:
- the 6 original guard assertions fail with `expected 500 to be 200` on the unguarded handler,
  with the RPC mock returning the real `22P02` cast error rather than a synthetic one;
- the 6 new level assertions fail with `expected "warn" to be called 1 times, but got 0 times`
  when `console.warn` is reverted to `console.error`.

**The `P0002` chain was reproduced on a real database**, not reasoned about. Against the local
stack, an `invoice.paid` for a customer that was never linked raises `no subscription matches
stripe event …`; `select count(*) from stripe_webhook_events` for that id returns **0** (the raise
rolled the insert back); the redelivery raises identically. The contrast case — same call with a
linked customer — returns `applied = t` and leaves **1** ledger row. And the linking chance the
guard forecloses is real: a valid-UUID `checkout.session.completed` moves
`subscriptions.stripe_customer_id` from `NULL` to the event's customer through the RPC itself,
while the malformed sibling dies at the cast with `invalid input syntax for type uuid` before the
function body runs.

High-risk surface (billing webhook) → draft PR carries a proactive adversarial security-research
prompt; a fresh session reviews before merge.

---

## 2026-08-19 — Stale-resume guard extended to the desktop Event-dag cockpit; wake lock deliberately not (86eykg2x1)

Branch `feat/86eykg2x1-cockpit-stale-resume` (PR #279, draft, **not merged**). Milestone: Now. No
migration. No RLS/auth/`service_role`/PII surface touched — this is a read-only consumer of
existing React Query state plus one already-shipped overlay component.

Follow-up on `86ey6x56p` / PR #252, which shipped the wake lock and the stale-resume guard into
`PoDoorTab` only — i.e. the **mobile** `/door/[eventId]` route and the mobile `/app` Deur tab. The
desktop (≥1024px) Deur tab renders something else entirely (`EventDayCockpitGate`), so it had zero
coverage. PR #252 corrected its own false "covers the cockpit too" claims; this task builds the
thing those claims described.

**What is actually connected now** (and nothing beyond it):

- `src/features/po/eventday/cockpitFreshness.ts` — pure freshness math, DOM-free, same role as
  `features/door/sync/staleResume.ts`. Two rules: take the **oldest** `dataUpdatedAt` across the
  tracked queries, never the newest (one query that refetched a second ago next to four that last
  succeeded eleven hours ago is still an eleven-hour-old screen); and treat a query that has never
  loaded (`dataUpdatedAt === 0`) as *never synced*, because part of the screen then has no truth
  behind it at all.
- `src/features/po/eventday/useCockpitSync.ts` — adapter that synthesises the exact four fields
  `useStaleResumeGuard` needs (`online` / `syncing` / `lastSyncAt` / `forceSync`) out of React
  Query. **No second state machine and no second overlay were written**: the guard, its one-retry
  path, the 8s backstop, the self-heal and `StaleResumeOverlay` are the door's, reused verbatim.
  `online` comes from React Query's own `onlineManager` rather than a second `navigator.onLine`
  listener — it is the very flag RQ consults when deciding whether to run or pause the refetch we
  are waiting on, so the two can never disagree.
- `useStaleResumeGuard`'s parameter type was narrowed from `DoorSyncState` to a new structural
  `StaleResumeSyncSource` (declared in `staleResume.ts`). Behaviour unchanged; `DoorSyncState`
  satisfies it structurally, so the door side is untouched.
- `EventDayCockpit.tsx` mounts the guard once and `inert`s its own body while blocking — the
  cockpit's search field is Enter-to-check-in, so a barcode-scanner wedge must not reach it behind
  the overlay (same reasoning as `PoDoorTab`).

**Why the cockpit needs this despite having no outbox.** `refetchOnWindowFocus` is off on the
`/app` query client and React Query pauses `refetchInterval` while the document is hidden. So a
cockpit that was backgrounded — lid closed overnight is the canonical case — resumes on last
night's numbers and self-corrects only up to 60s later, or never if the realtime channel died
while it slept. The missing outbox makes this *worse*, not milder: a check-in attempted against
those stale numbers has nowhere to queue, it simply fails.

**Detect on a narrow set, repair the whole set.** Only the load-bearing polled live reads
(`usePoGuests`, `usePoTiers`, `usePoCheckinArrivals`) vote on staleness. The event-config read
(`usePoEventForEdit`) and the two request reads have no refresh cadence of their own, so their age
drifts past the 5 min threshold while the screen sits perfectly live in the foreground — including
them would fire the overlay on every resume and train doorhosts to click straight through it.
`usePoEventStats` was in this set as originally shipped and was **removed in review round 2**
(below) — it polls, but it is decorative and its veto was disproportionate. Everything excluded is
still refetched by the resume repair; it just does not get to raise the alarm.

**One string had to differ, so it is a prop and not a fork.** The door's offline copy promises
"check-ins will queue and sync once you're back online" — true there, a lie on an online-only
cockpit. `StaleResumeOverlay` gained an optional `offlineSub` override (default unchanged);
`t.cockpit.resumeOfflineSub` says the opposite and points at a phone. Every other string in that
overlay reads correctly on both surfaces, so nothing else was duplicated.

**Wake lock: deliberately NOT built, and this is the reasoning.** The Screen Wake Lock API is
released by the OS the moment the document becomes hidden and never prevents system sleep or a lid
close — so it cannot prevent the very scenario the stale-resume guard exists for. All it would buy
on a desktop is "the monitor doesn't dim while you are looking at this tab", which costs one mouse
move to undo and zero check-in throughput. That is categorically unlike a phone at the door, where
every auto-lock is a re-unlock in front of a waiting guest, which is why it earned its place on the
mobile door. Building it here would add a permission surface and a toggle nobody asked for, for no
measurable gain. If a concrete counter-scenario turns up (an unattended kiosk-mode display running
the cockpit as the primary check-in surface), it is a small, separable follow-up.

**Stated limit, rather than a repeat of the #252 mistake.** This is a *resume* guard. A cockpit
that stays continuously visible — a wall display that never goes hidden — produces no
hidden→visible edge and is therefore **not** covered by it; the realtime "live" indicator is what
speaks to that case. Nothing else on the desktop surface gained wake-lock or offline behaviour.

**Tests (as first shipped).** `npx vitest run` **1211 passed / 118 files, 0 failures** (23 new):
`cockpitFreshness.test.ts` (9), `useCockpitSync.test.tsx` (6), `EventDayCockpit.staleResume.test.tsx`
(8 — mounts the REAL gate/guard/overlay and proves the wiring PR #252 was missing: fresh resume
stays silent, stale resume blocks and refetches all seven reads, `inert` applied and released,
auto-close on fresh data, never-loaded arms the guard, the cockpit's own offline copy shows and the
door's does NOT, continue-anyway always escapes). **Red-on-revert verified on four independent
reverts**: removing the overlay render → 5 fail; flipping oldest→newest in `cockpitFreshness` → 2
fail; dropping the `offlineSub` override → 1 fail; dropping `inert` → 1 fail. `pnpm lint` clean (2
pre-existing `jsx-a11y` warnings in `datetime-field.tsx`, untouched); `pnpm type-check` clean.
pgTAP not run — no Docker in this container, and no migration in this branch. **Round 2 changed
these files and these counts — see the section below for the current figures.**

> **`pnpm test` is bare `vitest`, i.e. WATCH MODE — it never exits.** Two sessions in this sweep
> stalled on "test suite running" because of it. Use `npx vitest run` (or `CI=1 pnpm test`).

**Diff-reading note:** `EventDayCockpit.tsx`'s JSX body shifted 2 spaces because the root div is
now wrapped in a fragment alongside the overlay. Review with `git diff -w` — the real change there
is ~95 lines, not ~800.

### Review round 2 — three findings from a fresh-session `/code-review`, all confirmed and fixed

Each was reproduced against the running code before being acted on; none was taken on description.

1. **`usePoEventStats` held a veto over the whole cockpit.** `oldestDataUpdatedAt` is a hard AND,
   and React Query never stamps `dataUpdatedAt` for a query that has never succeeded — so a read
   that keeps failing pins `lastSyncAt` at "never synced" with **no path back**. `fetchEventStats`
   bundles five RPCs and throws if any one errors, so a single drifting or 500-ing RPC was enough:
   from then on *every* hidden→visible transition opened the blocking overlay, the forced refresh
   and its one internal retry could not clear it, and the doorhost sat out the 8s backstop before
   "continue anyway" even appeared — over a `canSeeStats`-gated read (peak tile, per-quarter card)
   that a doorhost never sees rendered at all. Reproduced: with stats pinned at 0 and guests/tiers/
   arrivals fresh, the overlay opened on resume and re-opened on every subsequent one. Stats is now
   out of the detecting set; `refreshCockpit` still repairs it. Guests/tiers/arrivals keep the veto
   — a persistent failure there really does mean the screen is wrong. The general lesson is in the
   header of `cockpitFreshness.ts`: **membership in `tracked` is a veto, so cadence alone does not
   earn it — the read must also be one the doorhost steers on.**

2. **Focus was dropped when the guard opened and never handed back.** `inert` makes the browser
   blur the focused descendant, which on the cockpit is the Enter-to-check-in search field — i.e.
   exactly the barcode-wedge target `inert` is there to protect — and nothing restored it. On the
   common online path the overlay flashes for about a second and auto-closes, so the next scan
   typed into `<body>`: no check-in, no error, nothing on screen to explain it. Same after
   "continue anyway", whose autofocused button is unmounted with focus on it. Reproduced (jsdom
   implements the `inert` attribute but not its focus semantics, so the browser's blur is modelled
   explicitly in the tests). Fixed in `useStaleResumeGuard`: capture `document.activeElement` on
   the closed→open edge — **synchronously in the visibilitychange handler, because `inert` lands
   during React's commit and any effect already runs too late** — and hand it back on close, only
   when focus actually went nowhere (`<body>`), so it never steals focus the operator has moved.
   **This also fixes the same latent bug on the mobile door**, which applies `inert` identically
   and shipped it in #252; that is why the fix lives in the shared guard rather than the cockpit.

3. **`syncing` meant "any cockpit traffic at all", not "the resume refresh is running".** The
   guard's resolve effect bails out while `sync.syncing` is true, and `syncing` was derived from
   "is any tracked query fetching". But those reads are on a 60s `refetchInterval` **and** are
   invalidated by `usePoEventRealtime` on every check-in (throttled to 500ms), so during a door
   rush they are almost never all idle at once. Reproduced: with all four stamps demonstrably fresh
   and one ambient fetch in flight, the blocking overlay stayed up over a live cockpit and the 8s
   backstop then flipped it to the "connection is stuck" copy. On the door `syncing` is one
   explicit sync cycle, so idle gaps are reliable; with four independently-polled queries plus
   realtime they are not. `useCockpitSync` now counts **its own forced refreshes** (the promise
   `refreshCockpit` returns) instead of sampling `fetchStatus`, restoring the meaning the guard has
   always assumed. A refetch React Query has *paused* while offline keeps its promise pending, so
   it still reads as in-flight — the 8s backstop bounds that wait, exactly as before. Side effect:
   the cockpit no longer reads `fetchStatus` at all, so it stops re-rendering on every fetch
   start/end; `dataUpdatedAt` only moves on success. `anyQueryInFlight` was deleted with its tests.

**Tests after round 2.** `npx vitest run` → **1222 passed / 118 files, 0 failures**. Per file:
`cockpitFreshness.test.ts` 9 → **7** (the 4 `anyQueryInFlight` cases removed with the function; 2
added for the veto property), `useCockpitSync.test.tsx` 6 → **10**, `EventDayCockpit.staleResume`
`.test.tsx` 8 → **13**, `useStaleResumeGuard.test.ts` 13 → **17** (focus restoration, on the shared
guard, so the door is covered too). The cockpit test's fake data layer was reworked from one shared
snapshot to per-query state — three of the new behaviours are about queries *disagreeing* — and it
now models React Query faithfully on the two points the guard depends on: a successful refetch
advances that query's `dataUpdatedAt`, and a refetch while offline stays pending.

**Red-on-revert verified, five independent reverts, each run to confirm it actually goes red:**

| revert | result |
|---|---|
| put `statsQuery` back into `trackedFreshness` | **1 fail** |
| derive `syncing` from ambient `fetchStatus` again | **1 fail** |
| drop the focus *restore* effect | **4 fail** (2 door, 2 cockpit) |
| drop the focus *capture* (keep the restore) | **4 fail** (2 door, 2 cockpit) |
| restore focus unconditionally (drop the "went nowhere" check) | **2 fail** |

`pnpm lint` clean (the same 2 pre-existing `jsx-a11y` warnings in the untouched
`datetime-field.tsx`); `pnpm type-check` clean. pgTAP still not run — no Docker in this container,
and this round adds no migration and touches no RLS/auth/`service_role`/PII surface.

**Not changed, deliberately:** `src/components/po/app.tsx` (two sister branches are editing it),
the wake-lock decision (still not built, reasoning above), and the stated resume-only limit — a
continuously-visible wall display still produces no hidden→visible edge and is still not covered.
## 2026-08-19 (later) — Code-review round on the `onblocked` fix: the wipe guard now covers the open path too (86ey9e9wc)

Branch `fix/86ey9e9wc-idb-open-onblocked`, PR #283. A fresh-session `/code-review` left four
inline findings. All four were re-checked against the code before acting — the reviewer was
right on all four, and one of them is a real PII defect.

**Finding 1 (blocker, fixed).** `settled` only becomes `true` when the grace timer fires, so the
existing `close()` on late arrival covered the window *after* give-up but not the one *before*
it. A `blocked` open that is still in flight when the doorhost signs out took the normal success
path: it adopted itself as `dbConn` and resolved. `openDb()` never consulted the wipe epoch, and
`idbClearAll` has no way to mark an in-flight attempt as abandoned.

The blast radius is wider than "an untracked connection". `idbSet` awaits `openDb()` *after* the
outbox's own epoch re-check (`outbox/store.ts:271`), so a write that legitimately passed the
guard and then parked inside a blocked open lands **after** the wipe — the previous doorhost's
queued check-ins written into the database the next doorhost boots on, on a shared tablet.
Device storage is session-scoped unless provably PII-free (CLAUDE.md), so this had to be fixed
before merge. `onsuccess` now bails on `settled || epoch !== openedAt`, closing the connection
and **rejecting** — the reviewer's suggested snippet returned without settling, which would have
hung every awaiting caller, i.e. the bug this file exists to remove.

**Finding 2 (fixed).** Give-up nulled `dbPromise` with no backoff, and the callers are not
occasional (persister on a 2 s trailing throttle, `outbox.commit()` on every enqueue,
`useDoorSync` every 60 s), so a persistently frozen sibling meant open → 2 s → give up → Sentry,
every few seconds indefinitely. Added `IDB_OPEN_BLOCKED_COOLDOWN_MS` (30 s): during it every
`openDb` fails fast instead of arming its own grace period, and because no attempt runs there is
no second report — the same transition-guard shape `setPersistDegraded` already uses two files
over. Time-boxed, and cleared by `idbClearAll`, so it can never leave IndexedDB switched off for
whoever uses the device next.

**Finding 4 (fixed) and 3 (decided, not fixed).** The 2 s was a guess, and one constant was
doing two jobs with opposite cost asymmetries: a failed *write* costs nothing user-visible (the
entry is in memory, every persist path is fire-and-forget), while a failed *boot restore* costs
the whole cached guest list — and at the door offline is the normal case, so there is no refetch.
Split: writes keep 2 s, the boot restore gets `IDB_OPEN_BLOCKED_RESTORE_GRACE_MS` (8 s), plumbed
as `idbGet(key, { graceMs })` with an in-flight attempt taking the longest grace any current
waiter asked for. Both numbers are now documented as **accepted guesses, not measurements** —
which is what the finding asked for; measuring `close()`-to-release on a throttled webview is the
way to replace them.

Finding 3 — a blocked restore is silent, because `idbGet` swallows the rejection and `undefined`
is indistinguishable from a cold cache — is **acknowledged and deliberately not fixed here**. The
longer restore grace reduces how often it happens and telemetry already covers it, but a
doorhost-facing "your cached list could not be loaded" signal applies to *every* restore failure
(corrupt snapshot, quota exceeded), not just a blocked open. It belongs to `restoreClient`'s
error contract and its own UI decision, not bolted onto this fix. Recorded at the call site in
`persister.ts` so it is discoverable rather than lost; needs its own task.

**Tests** — 3 added (7 total in `idb.test.ts`), each verified **red against its own revert**:
removing the epoch guard fails the wipe test with `expected true to be false` (the pre-wipe write
reports as landed); removing the cooldown fails with `expected Symbol(pending) to be false`;
removing the restore split fails with `expected undefined to be Symbol(pending)`.

**What the harness cannot prove — stated rather than papered over.** Two downstream consequences
of the adoption were probed against the unfixed code and came out **green** under
`fake-indexeddb`: the previous doorhost's record surviving on disk past the wipe, and the adopted
connection blocking a later `deleteDatabase`. Both depend on browser event ordering that
fake-indexeddb does not model, which matches the reviewer's own experience of getting the disk
outcome once and clean on repeat. Asserting either would be a test that can never fail, so
neither is asserted; the test pins the one deterministic step they all hang off — a post-wipe
attempt being adopted and its pre-wipe write reported as landed.

Gates: `pnpm lint` clean (exit 0; the 2 pre-existing `datetime-field.tsx` a11y warnings are
untouched), `pnpm type-check` 0 errors, **116 files / 1195 tests / 0 failures**. No migration and
no route change, so pgTAP and e2e were not run.

---

## 2026-08-19 — `indexedDB.open` no longer hangs the door when a sibling tab blocks a VERSION bump (86ey9e9wc)

Branch `fix/86ey9e9wc-idb-open-onblocked`. Milestone: Now (a door that never finishes booting
is a door that cannot check anyone in). **Scope note:** four of this task's five points had
already shipped under `86ey9et07` (PR #233) and were re-verified on `main` before any code was
written — connection closed before `deleteDatabase` (`idb.ts`), the PII wipe on sign-out
(`sign-out-device.ts`, with test), `onversionchange` on the open DB, and the HMR-accumulation
fix that follows from the tracked connection. Only the fifth was genuinely missing.

**The gap.** `openDb()` wired `onupgradeneeded`, `onsuccess` and `onerror` on its
`indexedDB.open` request — but not `onblocked`. `blocked` fires only when a version bump has to
run while another connection still holds the old version. Our own tabs release on
`versionchange`, so in practice this needs a tab that *cannot* respond: a frozen or backgrounded
webview, or one whose `close()` is deferred behind an in-flight transaction. An open request has
no timeout of its own, so in that case `dbPromise` stayed pending **forever**: `restoreClient`
(persister.ts) never settled, `PersistQueryClientProvider` never left `isRestoring`, and the
door sat on the restore gate with nothing logged anywhere.

**Why it was worth fixing before it ever fired.** `VERSION` is still `1`, so this could not
happen yet — it is armed by the *next* schema bump. The failure would therefore first appear as
"the door stopped booting after the deploy", on the venue's tablet, at the door.

**The behaviour chosen.** Hanging is wrong, but so is silently carrying on without a store —
the door must not serve an empty cache as though everything were fine. So `onblocked` starts a
grace period (`IDB_OPEN_BLOCKED_GRACE_MS`, 2 s) rather than failing instantly: a merely *busy*
sibling clears within a few frames and keeps its cache. If the block outlasts it, the open is
abandoned and the promise **rejects**, which the existing helpers already turn into visible
degradation — `idbSet` returns `false`, which flips the outbox's `persistDegraded` (doorhost
warning + Sentry, O4), and `idbGet` returns `undefined` so the restore gate releases. A static
`captureMessage` (no keys, no values — door payloads carry guest PII) names the real cause,
because otherwise the helpers' `catch` would make the frozen-tab case invisible in telemetry.
`dbPromise` is cleared on give-up so the *next* call opens from scratch instead of inheriting
one stale rejection for the rest of the session.

**The second-order bug this had to avoid.** An open request cannot be cancelled, so the one we
abandoned can still succeed later, once the frozen tab dies. Left alone, that late connection
would be untracked — `idbClearAll` closes only `dbConn` — and would go on to block sign-out's
`deleteDatabase` (previous doorhost's guest data surviving on a shared tablet) and the *next*
version change: precisely the failure just recovered from, re-created. The late `onsuccess`
therefore closes its own result when the attempt was already abandoned.

**Deliberately not changed:** `idbClearAll` still *resolves* on `onblocked` (`idb.ts`, reasoning
in place there). That is the opposite trade-off to this one and it is the right one — a
sign-out must not be held hostage by a sibling tab, and that tab's own unload finalizes the
delete.

**Tests** — `src/features/door/offline/idb.test.ts` (4). They drive a real `blocked` event via
`fake-indexeddb` against a real second connection; the version bump is simulated by rewriting
the version the module requests, since `VERSION` is a module constant. Only `setTimeout` is
faked, so fake-indexeddb's `setImmediate`-based scheduler keeps delivering events. A `PENDING`
sentinel raced against the promise turns "hangs forever" into an immediate assertion failure
instead of a suite timeout. **Red-on-revert verified:** against the unfixed `openDb`, 3 of the 4
fail with `expected Symbol(pending) to be false` — and still fail after advancing 60 s of fake
time, confirming a true hang rather than a slow settle. The fourth (a busy tab that releases
inside the grace period still gets its connection, no false alarm) passes both ways by design.

**Review posture:** door surface = high-risk, so this does not self-merge.
## 2026-08-19 — Lazy-Sentry import guard: the rule now matches its own documented contract

Branch `fix/sentry-lazy-import-guard-regex`. Milestone: Now (a CI guard that is wrong about what
it flags trains the next author to route around it). No migration, no `src/` change — the fix is
in `tests/unit/sentry-lazy-imports.test.ts` alone.

Found during the fresh-session review of the Stripe webhook PR (86ey9e9re, PR #273), which had to
work around this to add a server-side Sentry facade.

**The bug.** The rule was

```
/import\s+(?!type\s)[\s\S]*?from\s+['"]@sentry\/nextjs['"]/
```

`[\s\S]*?` spans the entire file, so the `(?!type\s)` negative lookahead only ever inspects the
**first** import statement. Any import above the Sentry one — `import 'server-only'`,
`import { z } from 'zod'` — starts the match, and the scan then runs on to the Sentry `from`
clause regardless of whether that statement said `type`. The guard's own doc comment promises
"`import type { … } from '@sentry/nextjs'` is fine (erased at build) and not flagged". It was
flagged, in every file that had any import above it. `src/lib/observability/sentry-client.ts`
passes only by accident: its type-only Sentry import happens to be the file's first.

**The fix.** Confine a match to one statement. The clause between `import` and `from` may span
lines (prettier wraps long named imports) but may never cross a `;`, a quote, or another `import`
keyword, and `^` under the `m` flag anchors the start to a statement — so a mid-line
`await import('…')` or `typeof import('…')` can never start one.

**It is strictly stronger, not weaker.** The bare side-effect form `import '@sentry/nextjs'` has
no `from` clause and was invisible to the old rule; it eagerizes the SDK just the same, and is now
caught. An inline type specifier mixed into a value import (`import { type Scope, captureMessage }
from …`) is flagged too — deliberately conservative, since whether that elides at runtime depends
on compiler settings.

**Evidence, both directions.** A new `describe('VALUE_IMPORT (the rule itself)')` pins 9
must-not-flag cases and 9 must-flag cases, plus an assertion that all three allowlisted files still
match the rule (an allowlist that no longer matches anything is dead code hiding a regression). Run
against the OLD regex, exactly 5 fail: the 4 legal `import type` forms it wrongly flagged, and the
bare side-effect import it wrongly missed. All 8 other must-flag cases pass under both regexes —
that is what makes this a fix rather than a weakening.

**Tests.** `tests/unit/sentry-lazy-imports.test.ts` **21 passed** (was 2 — the 19 new cases are the
rule's own contract). Full suite on the branch merged up to `main` (`daf0e58`): Vitest **1252
passed / 120 files**; the +19 over that base are all from this change. `pnpm lint` clean (2
pre-existing `datetime-field.tsx` a11y warnings, file untouched), `pnpm type-check` zero errors.
Touches no SQL and no `src/` file, so pgTAP is unaffected.

Follow-on: `src/lib/observability/sentry-server.ts` (PR #273) may now use the ordinary
`import type` form. No need to change it — `typeof import(…)` is correct either way — but the trap
it documents is disarmed.

---

## 2026-09-17 — A regression guard for the pre-push hook mode (the fix itself landed elsewhere)

Branch `fix/pre-push-hook-not-executable`. Milestone: Now — a migration-timestamp
collision breaks `db push` and `db reset` for everyone, and is discovered only after
the merge.

**Scope correction, written after the fact.** This branch was opened on 2026-08-19,
when `scripts/hooks/pre-push` was still committed as mode **100644**. Git silently
skips a non-executable hook — it says so only in a `hint:` line that scrolls past in
normal push output — so the migration-collision guard had never run, for anyone,
while `scripts/setup-git-hooks.mjs` printed `pre-push migration-collision guard
active` on every `pnpm install`.

The mode fix then landed independently on `main` a week later, in `834012f`
(2026-08-26, PR #288): *"track pre-push guard as executable — git silently ignored
it"*. Two people found the same hole a week apart, which says something about how
invisible it was. **The chmod in this branch is therefore redundant** and merges as a
no-op against today's `main`.

**What this PR still contributes**, and neither half is on `main`:

- `tests/unit/pre-push-hook-is-executable.test.ts` — asserts the mode **git records**,
  not the mode on disk. A local `chmod` would mask a regression for whoever ran it
  while every other clone stayed broken. It also asserts `core.hooksPath`, because a
  correct mode on a hook git never looks at is equally inert. Verified red on revert:
  flipping the mode back gives `expected '100644' to be '100755'`. Without this, the
  mode can silently regress again and nothing would notice — which is exactly how it
  got here the first time.
- `scripts/setup-git-hooks.mjs` no longer announces a guard it has not verified. It
  reads the committed mode and, when it is not `100755`, warns that the guard is **not**
  running and prints the one-line fix. Both branches exercised.

**Scope.** This does not make the hook a security boundary — it stays bypassable with
`git push --no-verify`, as its own comment says, and blocking CI remains the real
backstop. What changed is that the local guard can no longer regress to silence
unnoticed, and the installer can no longer lie about it.

---

## 2026-09-17 — Fase 17 (native apps): plan reviewed against the code, start approved

Branch `claude/dashboard-app-store-p4fxls`. Max asked how long the App Store / Play
Store wrap would take and whether the July plan (`capacitor-plan-claude-code.md`,
PR #110) was good enough to start on. Docs-only session: no code changes.

**Verified against `main`** (every claim in the July readiness audit, §8 of the plan):
auth is webview-safe (`/auth/confirm` + `/auth/callback`, cookie session, no popups),
the push seam and the session-revoke RPCs exist, the SW is registered only on `/door`,
the CSP is strict. Stale or missing in the July plan:

- **External links.** `target="_blank"` in `screens/onboarding.tsx` (terms/privacy) —
  Capacitor loads `_blank` inside the webview with no way back on iOS. → N1 gets an
  `openExternal()` kit helper on `@capacitor/browser`; CLAUDE.md checklist forbids
  `_blank` in the `po` surface.
- **Clipboard.** The plan pointed at `events.tsx`; that file has no clipboard any more,
  six other files do, without a shared helper. → N1: `copyText()` in the kit.
- **S4 scope error.** July claimed `/e/[slug]` as an app link too; that would pull a
  promoter's own guest landing into the app shell. → only `/auth/*` (decision 11).
- **Legal pages.** `src/lib/legal.ts` links to `plusone.app/privacy` + `/terms`, which
  do not exist (drafts in `docs/legal/`). Both stores require a live privacy URL. →
  existing task 86ey1vbrj becomes L1, a hard S5 dependency.
- **Grant matrix.** `push_tokens`/`notification_outbox` start closed since
  `20260917100000`; §3 now states the grants (`delete` on `push_tokens` is legitimate
  and goes on the allowlist; the outbox gets nothing for `authenticated`).
- **WKWebView service workers** need App-Bound Domains — a documented N3 choice, not a
  blocker. **Play tester rule** corrected to 20 testers / 14 days (org account bypasses
  it). **Account deletion** (Apple 5.1.1(v)): invite-only → exempt, explained in the
  review notes. **Sentry** already covers the webview; native-shell crashes are not v1.
- **ClickUp N3** still referenced the deleted `history-nav.ts`; updated.

**Decisions (Max, 2026-09-17):** v1 includes push (confirmed) · **iPhone + iPad** →
tablet layouts become a hard pre-submission requirement (new task T1, `z8uq9m0fzj`) ·
**Android first**, iOS when the Apple account lands (S1 split into S1a `86ey6bfpy` +
new S1b) · legal pages not live yet → L1. Spec #37 carries the refinement.

**Estimate:** 13–15 sessions (was 10–12), parallelisable in 5 waves (plan §4); the
wall clock is D-U-N-S → Apple org verification, not the code. Nothing on the M-track
(Max's accounts) has been started yet — that is the one thing to begin today.

**Follow-up (2026-09-18):** `capacitor-orchestration-claude-code.md` — one orchestrator
session per wave (not per programme), workers as separate one-task sessions under the
`clickup-task` skill, pre-assigned migration timestamps, shared-file sequencing, a
fresh reviewer session for N2/S3. Model routing per CLAUDE.md: orchestrator + reviewers
on Fable, workers on Opus, S2 on Sonnet. Contains the copy-paste orchestrator prompt,
the five wave blocks, the worker-brief template and the reviewer brief.

---

## 2026-09-17 — The grant matrix that was only ever a comment: anon/authenticated privileges in `public`

Branch `fix/anon-default-grant-matrix`. Found while diagnosing why `main` itself went
red on pgTAP with nothing in the repo changed — three assertions in
`influencers.test.sql`, `request_link_funnel.test.sql` and `analytics.test.sql` that
expect `42501 permission denied` suddenly caught no exception. They were true
positives about production, four months old.

**Root cause — and it is not "nobody thought about it".**
`20260613000000_full_schema.sql` got this exactly right, and said so in a comment:

```sql
-- Default ACLs differ between local and hosted Supabase, so we reset to
-- zero and grant exactly the intended surface.
revoke all on all tables in schema public from anon, authenticated, service_role;
```

The design was correct. The mechanism was not: `all tables in schema` is a **snapshot,
not a rule**. It zeroed the fifteen tables that existed on 2026-06-13 and has protected
nothing created since. Supabase's stock default ACL —

```sql
alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
```

— then handed the full privilege set to `anon` and `authenticated` on every table and
view a later migration created. Most later migrations repeated the revoke by hand and
stayed clean. Three did not, leaving six objects open: `event_templates`,
`event_template_tiers` (20260624091000), `influencers`, `request_links`,
`request_link_pageviews_daily` (20260706100000), and the `audit_feed` view. On prod,
`anon` held SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all five tables.

20260706100000 even carries the comment *"Table privileges (explicit grant matrix; RLS
is the row boundary on top)"* and, four lines down, *"No DELETE for app roles anywhere
(soft delete only, #21)"* — above a block that only ever `grant`s. Every grant it wrote
was a subset of what the table already had, so the block changed nothing and the comment
described a state the database never reached. Third instance this sweep of the same
failure shape: a guard that announces itself and does nothing (the others: pgTAP
reporting `ok` while running 2 of 15 planned assertions, 86eykjgrb; the pre-push hook
committed 100644 so git skipped it, #288).

**Reachability — measured on prod before writing the fix, not assumed.** Nothing was
exploitable. RLS is on for all five tables and every policy on them is scoped
`to authenticated`, so an anon PostgREST request matches no policy and default-denies.
TRUNCATE ignores RLS, but PostgREST never issues it and `anon` cannot run raw SQL.
`audit_feed` is `security_invoker=on` over a CTE plus six LEFT JOINs, so it is not
auto-updatable and its INSERT/UPDATE/DELETE grants cannot execute — no
write-through-view path to the audit log. So: a defence-in-depth hole, not a breach.
What it cost is the second line of defence — one policy ever written without
`to authenticated` on those five tables would have been live for the public anon key
on the same day.

**Why CI only noticed now.** Prod has had these default ACLs all along; they are stock.
CI pins `supabase/setup-cli@v3` with `version: latest`, so the local image floats. The
moment it caught up with prod's defaults, three assertions that had always been true
statements about production started reporting honestly. The tests were right the whole
time; the environment they ran in was the thing that had been lying.

**Shipped:**

- `supabase/migrations/20260917100000_public_grant_matrix_hardening.sql` — revokes the
  accidental privileges from `anon` (one grant is deliberate and stays:
  `request_links.SELECT`, from `20260706103000:426` — `/api/health` probes that table
  precisely because the grant means the query never 42501s while the absent anon SELECT
  policy means it always returns zero rows. That probe is its only live dependant; the
  grant's original second reason, the `guest_requests_insert_public` WITH CHECK
  subquery, went dead for anon when `20260707170000` revoked anon's INSERT on
  `guest_requests`. Follow-up worth doing separately: point the probe at a trivial
  anon-executable RPC and the last anon table grant in the schema can go too); brings `authenticated` back
  to exactly the matrix each migration declared (TRUNCATE off everywhere, DELETE off
  `influencers`/`request_links`/`request_link_pageviews_daily`/`audit_feed`, writes off
  the read-only counter table). `service_role` is deliberately untouched: it bypasses
  RLS by design and its key never reaches client code.
- Recurrence closed at the source, in the same migration: `alter default privileges for
  role postgres in schema public revoke all on tables from anon, and from authenticated`
  — the snapshot turned into a rule. A new table or view now starts CLOSED for both app
  roles, which makes the `grant select, insert, update on table X to authenticated`
  lines our migrations already write stop being decorative and start being the thing
  that actually opens the table. A migration that forgets them now fails loudly (403 in
  dev, e2e smoke red) instead of silently shipping an open table. `service_role` keeps
  its defaults: it bypasses RLS by design and its key never reaches client code.
- `supabase/tests/database/grant_matrix.test.sql` (13 assertions) — catalog-driven, not
  list-driven, for the same reason the original blanket revoke failed: anything that
  enumerates today's objects stops covering tomorrow's. `tables.test.sql` already
  checked DELETE on four tables *by name*, which is exactly why it never saw these six.
  The new file walks every relation in `public`: anon holds nothing beyond the one
  documented exception, no column-level anon grant hides where `has_table_privilege`
  cannot see it, no app role holds TRUNCATE, `authenticated` holds DELETE only on an
  allowlist of config/membership tables, and the default ACLs cannot re-open the hole —
  the last check scoped to the roles that actually *own* relations here rather than to
  `postgres` by name, so a table arriving under a different owner (dashboard, platform
  upgrade, `create extension … schema public`) fails the build instead of inheriting
  that owner's open defaults. That is the one loophole the migration itself cannot
  close: `alter default privileges for role supabase_admin …` fails with *"permission
  denied to change default privileges"* — `postgres` is neither superuser nor a member
  of `supabase_admin`, locally or hosted. **Known residual, named rather than asserted
  away:** what we get is prevention for objects created by `postgres` (every migration)
  and detection for everything else. A table created as `supabase_admin` really does
  start open — the reviewing session demonstrated it — and the guard catches it on the
  *next* CI run, not at creation. That window is accepted.

  Seven further assertions prove the revokes did not overshoot — without them the whole
  file could be satisfied by revoking everything from everyone, which passes CI and
  breaks the product. **Not hypothetical: the first CI run proved it.** The initial
  draft did `revoke all … from anon` on `request_links` and took out `/api/health` and
  every attributed public request with it. `request_links.test.sql` caught it 21
  subtests deep, where it read as a broken test rather than a broken revoke. The guard
  now asserts that exception *positively*, so the next over-eager revoke says so in the
  file whose job it is to know.

**Generalized lesson.** The bug was not a missing thought — the right thought is written
in a comment in the June schema migration. The bug is that it was expressed as a
statement over *the objects that exist right now* instead of as a rule about *objects*.
Anything phrased that way — `all tables in schema`, a hand-kept list in a test, a
checklist in CLAUDE.md — decays silently from the day it is written, and decays fastest
in exactly the places that are growing. Where the intent is "exactly these privileges
and no others", say `revoke` before `grant`, make the default a rule, and let the
catalog rather than a list be the witness: the list is maintained by the same person who
just forgot.

---

## 2026-08-26 — One setup codepath: session-setup script, web SessionStart hook, CI routed through it

**Follow-up (same day, after the merge of #288):** local sessions no longer no-op —
the SessionStart hook now runs the read-only `inventory` on the laptop too (~1s,
writes nothing, installs nothing), so every session, local or web, starts with the
environment report + the never-weaken rule in its context. `install` stays
remote-only. Asked for by Max after seeing the web hook live.

Branch `claude/script-sessionstart-workflow-f2mmid`. Claude Code web sessions start in
a fresh container (no `node_modules`, no supabase CLI, no reachable docker daemon), so
lint/type-check/vitest silently weren't runnable until someone set them up by hand —
and a session that starts working before looking is one bad afternoon away from
"disabling the guard that refused" instead of fixing its environment.

**Shipped:**

- `scripts/session-setup.mjs` — the ONE environment-setup codepath, three modes:
  `inventory` (read-only, always first: versions, tools, which suites can run here,
  and the never-weaken rule), `install` (inventory + `pnpm install --frozen-lockfile`,
  with an explicit "regenerate the lockfile properly, never hand-edit/drop the flag"
  failure message), `check` (the pure-node half of CI's `lint-and-test`: lint,
  type-check, `vitest run`).
- `.claude/hooks/session-start.sh` + registration in `.claude/settings.json` — remote
  sessions only (`CLAUDE_CODE_REMOTE` guard, verified no-op locally); runs `install`,
  so every web session starts with the inventory + rule in its context.
- `.github/workflows/ci.yml` — the inline `pnpm install/lint/type-check/test` steps
  replaced by `install` + `check` through the same script. Job name `lint-and-test`
  and the whole Supabase/e2e/build half untouched.

**The two generalized lessons (26/8):** the suite list is validated against
`package.json` before anything runs — a from-memory list once named a suite that
doesn't exist on main, and that must fail as "list drifted", not as a mid-run pnpm
mystery. And `check` ends by naming what it did NOT run (pgTAP, concurrency, e2e,
build), so a green `check` is never mistaken for green CI.

**Found along the way, fixed here:** `scripts/hooks/pre-push` was tracked as mode
`100644` since it landed (#201) — git only runs an *executable* hook and skips a 644
one with nothing but a hint, so the pre-push migration-collision guard has been
silently dead on every fresh clone. Tracked mode is now `100755`, and `inventory`
checks hooksPath + the executable bit so a regression shows up at session start
instead of never.

**Validated in the remote container:** hook end-to-end with `CLAUDE_CODE_REMOTE=true`
(cold install 13.9s, idempotent re-run 4s), `check` green (lint + type-check + vitest
123 files / 1253 tests), ci.yml parses and keeps all 16 steps. **Not validated here:**
the Actions run itself — a session can't execute GitHub-hosted workflows, so the first
real run of the reworked job is this PR's own CI.

## 2026-08-19 — Production ran blind: Sentry never initialised, and the build now refuses to ship without it (86eyp5w32)

Branch `claude/performance-sweep-orchestration-e4t594`. Found while orchestrating the
performance sweep, investigating `86eykdzf1` (the suspicion that `/e/[slug]` 500'd for
five weeks on a missing `LANDING_IP_SALT`).

**The finding is bigger than the incident it came from.** Sentry has received **zero
events in 90 days** — both orgs, both projects, no events of any kind. Not "no errors":
nothing at all.

### Why it was invisible

`sentry.server.config.ts:10`, `sentry.edge.config.ts:12` and `src/sentry.client.init.ts:24`
all initialise with `enabled: Boolean(dsn)` where `dsn = process.env.NEXT_PUBLIC_SENTRY_DSN`.
A missing var switches Sentry off silently — no warning, no log, no build failure.

What made it genuinely hard to spot: **the build-time half kept working.** Sentry holds
releases for these commits — `2790498b7a9a…` (the merge commit of PR #271, i.e. the
current tip of `main`) carries `lastDeploy.environment: "vercel-production"`. Creating a
release requires an authenticated token, so `SENTRY_AUTH_TOKEN` and the Vercel↔Sentry
integration are demonstrably fine. The marketplace integration injects
`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` — but not the DSN under this app's
variable name. So every deploy registered a release for events that would never arrive,
and every dashboard looked configured.

### How it was proven without Vercel env access

The load-bearing evidence is Sentry's own API, not the bundle:

- **0 events in 90 days**, both orgs (`plus-one-hs/javascript-nextjs`,
  `plus-one-lk/sentry-citron-cloud`) — no events of any kind, not merely no errors.
- **Every release** in the populated project reports `firstEvent: null`,
  `lastEvent: null`, `newIssues: 0` — across many deploys, never one event.
- `/monitoring` returns **404** even though `_sentryRewritesTunnelPath="/monitoring"` is
  compiled into the bundle: the tunnel route only registers once the SDK initialises with
  a DSN.

**Correction, from the review of this PR.** The first draft argued from the bundle:
`_sentryDebugIds`/`SENTRY_RELEASE` present ⇒ a real auth token. That inference is wrong.
`disable: !process.env.SENTRY_AUTH_TOKEN` at `next.config.js:133` sits inside the
`sourcemaps` block, so it gates source-map *upload* — not the plugin, and not debug-ID
injection. The reviewer built this branch with `SENTRY_AUTH_TOKEN` entirely unset and got
all three markers anyway. The conclusion survived on other evidence, but the stated proof
did not, and it is corrected here rather than quietly dropped.

A second claim was softened while checking the first: "`NEXT_PUBLIC_*` is inlined, so
absence from the shipped JS is evidence". The inlining behaviour is real and was verified
both ways — a var that IS set appears as a literal (the production Supabase URL is
verbatim in the prod bundle), a var that is NOT set survives as a runtime `env.X` lookup —
but the Sentry client-init code is not present in the chunks that were grepped, so that
particular grep showed nothing either way. Corroborating, not proof.

### The fix, and why it's a build guard rather than a boot guard

`scripts/hooks/lib/required-env.mjs` + `scripts/hooks/check-required-env.mjs`, wired as
the first half of `pnpm build`.

Throwing at runtime boot — the `landingIpSalt()` pattern — would be **worse than the
disease here**: a mistyped monitoring var would take the door offline, and the door is the
one surface that must keep working (door speed, offline-tolerant check-in). Failing the
*build* keeps the loudness without ever risking a live venue: a bad deploy never becomes a
running deploy.

Keyed on `VERCEL_ENV === 'production'`, deliberately **not** `NODE_ENV`. Next sets
`NODE_ENV=production` for preview deploys and for a plain local `pnpm build`, so a
`NODE_ENV` gate would break every contributor and every CI run — and that exact conflation
is what made `86eykdzf1` unfalsifiable ("it should have been throwing on preview too" was
never verifiable). CI's build step sets no `VERCEL_ENV`, so it stays green; verified by
running `pnpm build` under the exact CI env.

Guarded vars carry a `why` string each, printed on failure — a guard that only prints a
name teaches the next person nothing. `LANDING_IP_SALT` is in the list precisely because
its runtime fail-closed fires at *render*, not at submit: `/e/[slug]`, `/i/[token]` and
`/r/[token]` all 500 on first view, so landing, invite and status links go down together.
A build-time check turns a five-week silent outage into a failed deploy.

**Two exclusions, both stated rather than omitted** (an unexplained absence reads as an
oversight — raised in review):

- **Stripe** — the keyless stub provider is documented behaviour (decision #32) and pilots
  run `comped`. Requiring the keys in production is a product decision, not a cleanup.
- **Turnstile** — `verifyTurnstileToken()` passes OPEN when both keys are unset, which is
  the same fail-open-and-silent shape as the DSN on a more sensitive surface: bot
  protection on the only anonymous write path. Excluded for one blunt reason — **the site
  key is currently not set in production**, so requiring it would block the next deploy
  rather than protect it. Verified with the inlining behaviour described above: the prod
  `/e/[slug]` bundle still carries `env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` as a runtime
  lookup. Filed as a separate finding; "off in production" should be a decision, not a
  discovery.

### Verification

- `tests/unit/required-prod-env.test.ts` — 12 tests. Behavioural coverage of the predicate
  plus a structural test asserting `pnpm build` still invokes the runner (a guard nobody
  calls is the failure mode that produced this task — cf. `idbClearAll()` shipping with
  zero call sites and a comment claiming otherwise, 86ey9et07).
- **Both verified red-on-revert**: removing the guard from `package.json` fails the
  structural test; removing empty-string handling fails two behavioural tests.
- Guard exercised across all five env shapes (local, preview, `NODE_ENV=production`
  without Vercel, prod-missing, prod-complete) — pass/block as intended.
- Simulated `VERCEL_ENV=production` build blocks before `next build` runs, naming only the
  actually-missing var.
- `pnpm type-check` clean · `pnpm lint` clean (only the two pre-existing
  `datetime-field.tsx` a11y warnings) · `pnpm vitest run` **116 files / 1200 tests
  passing** · `pnpm build` green under CI env.
- `docs/runbook.md`: new "Is monitoring even alive?" section — two copy-paste checks, since
  "no Sentry alerts" must never again be read as "nothing is wrong".

### Still open — needs Max, not code

The guard prevents recurrence; it does **not** set the variable. `NEXT_PUBLIC_SENTRY_DSN`
must still be added in Vercel (Production scope) and a real event confirmed via the
existing `/sentry-test` route.

**Which project is settled**, and was an open question in the first draft:
`plus-one-hs/javascript-nextjs` holds every release including the current production
deploy, while `plus-one-lk/sentry-citron-cloud` has **zero** releases. That also verifies
the `next.config.js` fallbacks and answers the comment beside them ("fase 7.2 — verify the
real org slug"). Retiring the empty second project removes a real triage hazard: a DSN
aimed at the wrong project is indistinguishable from no DSN at all.

**The build-command bypass is narrower than first written.** `vercel.json` pins
`"framework": "nextjs"` and sets no `buildCommand`, so absent a dashboard override the
default resolves to `pnpm build` and the guard is in the path today. A dashboard override
stays invisible from the repo, so it is still worth one look — but "unverified" overstated
it. Moving the check into `next.config.js` would close that gap and should **not** be
done: Next also loads next.config in the server runtime, which would reintroduce exactly
the boot-time failure mode this guard was designed to avoid. The durable answer is a
post-deploy probe on a schedule — it catches a skipped guard, a var deleted after a good
build, *and* the wrong-project DSN case that no build-time check can see. The two curl
checks added to `docs/runbook.md` are that probe; they are one cron away from being
sufficient.

**Separate finding: Turnstile bot protection is currently off in production.** The site
key is unset, and `verifyTurnstileToken()` passes open in that state. The DB rate limit,
honeypot and dedup still stand, so the public funnel is not unprotected — but the
Cloudflare layer is silently absent. Needs its own task (ClickUp was rate-limited when
this was found).

Related: `86eykdzf1` closed as investigated-but-unprovable — Vercel retains 7 days and
Sentry held nothing, so the five-week question can no longer be answered from telemetry.
A live probe did confirm `/e/[slug]` is healthy now.
## 2026-08-19 — Stats dead-code follow-up: EventPicker/StatCard removed (86eykhqty)

Branch `chore/86eykhqty-stats-dead-code`. Milestone: Now (codebase hygiene, no behavior
change). Follow-up to the 2026-08-11 dead-code sweep (86ey9e9xx, above), which flagged
`src/features/stats/components/{EventPicker,StatCard}.tsx` as zero-importer but left them
untouched to avoid scope creep.

- **Removed, confirmed zero importers repo-wide:**
  - `src/features/stats/components/EventPicker.tsx` (exported `EventPicker`, `PickerOption`).
  - `src/features/stats/components/StatCard.tsx` (exported `StatCard`).
  - Fresh `grep -rn "stats/components/EventPicker\|stats/components/StatCard" src/` — zero
    hits, same as 11/8. Widened the search past that one pattern before deleting anything:
    bare-name grep (`EventPicker`/`StatCard`) across `src/` and `tests/` — the only hits
    left are unrelated same-named local symbols (`DoorEventPicker` in
    `src/components/po/screens/door.tsx`, a distinct `EventPicker` in
    `src/components/po/screens/promotion/shared.tsx`, both actively used elsewhere); no
    other `StatCard` definition exists in the repo (the task's warning about a same-named
    `po/kit.tsx` component didn't apply — no such component currently exists there); no
    `index.ts`/barrel in `src/features/stats/`; no import of the `stats/components` path
    as a whole; no dynamic import or path-alias reference resolving to either file; no
    dedicated test file for either component. `PickerOption` (the only other export from
    `EventPicker.tsx`) has no importers either.
  - `src/features/stats/components/` is now empty and was removed along with the files
    (git drops the now-empty dir automatically). Both files only imported shared kit
    primitives (`Card`, `Icon`, `cn`) — nothing else in `src/features/stats/` was orphaned
    by the removal (`data.ts`, `format.ts`, `po-adapter.ts`, `queries.ts` all stay, still
    imported via `@/features/stats/*` elsewhere).
- **DoD suites, fresh run:** `pnpm lint` clean (only the 2 pre-existing unrelated
  `datetime-field.tsx` a11y warnings). `pnpm type-check` — 0 errors. `npx vitest run` — 115
  test files / 1188 tests passed (note: `pnpm test` is watch-mode `vitest`, not `vitest run`
  — ran the latter directly to get a terminating result). `pnpm build` — compiles and
  generates all 15 static/dynamic routes cleanly.
## 2026-08-19 — `contactEventCounts` no longer 414s at 210+ contacts: wrong Kong URI-length comment fixed (86eykknf8)

Branch `fix/86eykknf8-chunkids-uri-limit`. Flagged during a fresh-session `/code-review`
of PR #260 (`86ey9e9wv`) as a pre-existing bug that PR almost copied for a similar case.

**The bug.** `contactEventCounts` (`src/features/po/queries.ts`, called from
`fetchContacts` — the venue address book) chunked its `guests.in('contact_id', …)`
filter with `chunkIds(contactIds)`, i.e. the bare default (`PAGE_SIZE` = 1000). The
comment above it claimed this was "chunked (≤1000 ids per request) to stay under Kong's
URI length" — wrong on the actual measured threshold: `perf-scale-audit-megaevent.md`
puts it at ~210 ids ≈ 7.8 kB → HTTP 414, and CLAUDE.md's scale rule says explicitly
"chunk to ≤120 ids if a list is truly unavoidable". So any venue with 210+ contacts
matching a search/filter 414'd on `contactEventCounts`'s very first chunk.

**Fix.** `chunkIds(contactIds, 120)` at the call site; the comment now states the real
~210-id/7.8 kB/414 threshold instead of the invented ≤1000/Kong claim.

**Call-site audit (grep `chunkIds(` across `src/`):** two real call sites existed.
`src/features/door/queries.ts:204` already passes an explicit `PROFILE_ID_CHUNK_SIZE =
120` (`door/queries.ts:21`, comment correctly cites CLAUDE.md's scale rule) — no change
needed there. `src/features/po/queries.ts:1116` (`contactEventCounts`) was the only
call site relying on the bare, wrong-for-URLs default; it's now fixed above. The
`chunkIds` tests in `src/lib/supabase/paging.test.ts` aren't call sites, just direct
unit coverage of the helper.

**`chunkIds`'s own default — left at `PAGE_SIZE` (1000), deliberately.** Considered
lowering it or introducing a separate `URI_CHUNK_SIZE` constant; decided against it.
`chunkIds` is a generic size-based chunker, not exclusively a URL-`.in()` helper — a
future caller might chunk for a pure row-count reason unrelated to any URL (e.g.
batching a JSON-body RPC array), where 1000 is the right default. Silently dropping the
default to 120 would also just move the footgun rather than remove it: a caller who
never stops to ask "is this filter going into a URL?" is exactly the failure mode that
produced this bug, and a lower default doesn't force that question — it just changes
which wrong number gets used implicitly. So the invariant stays "the caller building an
`.in()` URL filter must pass an explicit ≤120 size" (already how `door/queries.ts` does
it), not "the utility's default happens to be safe." Strengthened `chunkIds`'s docstring
in `src/lib/supabase/paging.ts` to state this plainly and point at 86eykknf8, since the
previous docstring's "keeps `.in()` filters under both PostgREST's max-rows AND Kong's
URI length" line was itself part of the false precedent — misleadingly implying the
default handles both limits when it only handles the first.

**Test.** `src/features/po/queries.test.ts` — new `describe('fetchContacts →
contactEventCounts chunking (86eykknf8)')`: 121 mock contact ids through `fetchContacts`,
asserting the `guests.in()` filter fires more than once and no single chunk exceeds 120
ids. Verified red-on-revert: reverting `chunkIds(contactIds, 120)` back to the bare
default made the test fail (`expected 1 to be greater than 1`) exactly as expected: 121
ids collapse into a single over-sized chunk at the old default.

**Results:** `pnpm lint` clean (2 pre-existing unrelated a11y warnings in
`datetime-field.tsx`). `pnpm type-check` clean. `pnpm test -- --run`: **115 test files,
1189 tests, all passed.**

**Out of scope, noted for a follow-up:** several other `.in()` call sites in `src/`
(`guests/actions.ts:198`, `auth/invite-actions.ts:102`, `po/queries.ts:397/479/484/559/1372`,
`events/actions.ts:460/469`) build `.in()` filters from unbounded id lists without
`chunkIds` at all. None are demonstrated to be reachable with 210+ ids in practice, and
this task's scope was `contactEventCounts` specifically — flagging for a separate audit
task rather than fixing here.

Not touched: `src/components/po/app.tsx` (other sessions working on it), no migrations.
## 2026-08-19 — Door: the implicit single-event choice is pinned, so a second live event no longer unmounts the door mid-shift (86eykm7qp)

Branch `fix/86eykm7qp-door-candidate-pin`. Milestone: Now. No migration, no schema change,
no new server state — the door stays local-first.

**The bug.** `app.tsx` resolved the door's event as
`doorState.eventId ?? (doorCandidates.length === 1 ? doorCandidates[0].id : null)`. The
single-candidate branch is an *implicit* choice, and it was never written back to
`doorOverride` or the URL — so it was re-derived from `length === 1` on every single render.
The instant a second event appeared in the candidate list, `requestedDoorId` became `null`,
`resolvedDoorId` followed, and `<DoorEventPicker>` rendered in the exact slot that had held
`<DoorQueryProvider><DoorProvider>`. Different element type at the same position → React
unmounts the whole door subtree → `useDoorSync`'s cleanup runs `client.removeChannel(...)`.

**The scenario that makes it real.** A doorhost checks guests in on a tablet at a venue whose
only non-past event is tonight's. The wifi drops and comes back; React Query's
`refetchOnReconnect` is at its default `true` (`PoLiveProvider` sets only
`staleTime`/`gcTime`/`retry`/`refetchOnWindowFocus:false`), so the candidate query refetches.
If a colleague has meanwhile scheduled the next party, the door jumps to an event picker
mid-check-in, with no explanation and no realtime.

**Blast radius, stated honestly.** A venue with anything else on the calendar already has >1
candidate, so it gets the picker on entry and the host picks explicitly — that path was always
immune. The vulnerable venue is the one whose only non-past event is tonight's, where someone
plans the next event during the shift. **The queue itself was never at risk**: the outbox is a
module singleton and `DoorQueryProvider` uses a per-tab singleton client with `gcTime: WEEK_MS`.
The damage was the unexplained jump plus losing realtime/sync mid-shift.

**The fix** (`src/components/po/app.tsx`, one effect next to `replaceDoorState`). Pin the
implicit choice the moment it resolves: `replaceDoorState({ seg, eventId: <resolved>, overlay })`
writes it into `doorOverride` **and** the raw URL. `replaceDoorState` goes through
`window.history.replaceState`, not `router.replace`, so there is no RSC round-trip and the
door's offline invariant (#25) is untouched. Once pinned, `doorState.eventId` is non-null and
the candidate list can grow freely without touching the door subtree.

Guards on the effect:
- **Mobile door tab only** (`isMobile && isDoorTab`). The desktop cockpit resolves its own
  event via `EventDayCockpitGate` and must never carry a `doorOverride`; and firing this from
  another screen would rewrite the URL to a door path under that screen.
- **Render-loop safe.** `replaceDoorState` sets state, so the effect only writes when the
  state is not already what it would write (`doorState.eventId === null && resolvedDoorId !==
  null`): one write at mount, zero on idle re-renders.
- **The pin is released when its event is gone.** If the pinned id drops out of the candidate
  list (after the existing stale-id refetch has had its one retry), the pin is cleared so
  derivation runs again. Without this the host would sit on "geen event" with no way out — the
  "ander event" control only renders with >1 candidates.

*(Round 1 implemented both of those with a `pinnedDoorRef` that also recorded whether the id
was "our guess"; the round-2 review below took that ref out. The bullets describe the shipped
code.)*

**Behaviour change worth knowing.** The implicit choice now behaves like an explicit one: it
sticks, and it survives a reload because it is in the URL. Auto-following to a different
single event only happens through the release path above.

**Test — and the red-on-revert check that PR #261 round 1 skipped.**
`src/components/po/door-pin-keeps-subtree-mounted.test.tsx` (jsdom) drives the **real**
`PlusOneApp` with only the periphery stubbed, goes from 1 candidate to 2 with
`doorState.eventId === null`, and asserts the door subtree never unmounts. `DoorProvider` is
stubbed with a probe that opens a channel on mount and removes it on unmount, mirroring
`useDoorSync`'s own cleanup, so the assertion reads in the bug's own terms
(`channelTeardowns === 0`, `doorMounts === 1`, picker never mounted). Two further cases cover
the URL write-back and the pin release.

`door-tab-render-scope.test.tsx` (the earlier attempt) failed by re-implementing the wiring in
a local harness and never importing `app.tsx`. To avoid repeating that, the fix was reverted
and the suite re-run: **3/3 red on unfixed `app.tsx`, 3/3 green with the fix**, verified
mechanically, not assumed.

**Gates.** `pnpm lint` clean (2 pre-existing `jsx-a11y` warnings in the unrelated
`datetime-field.tsx`), `pnpm type-check` zero errors, `npx vitest run` **116 files / 1191
tests, all passing**. The three protected guards were neither touched nor weakened:
`app-shell-no-ssr-suspense.test.ts` (2) and `door-tab-element-identity-bailout.test.ts` (4)
run green; `tests/e2e/app-home-events-visible.spec.ts` is unmodified but could not be executed
in this container (no Docker → no local Supabase stack, and Playwright needs a dev server).

### Round 2 — the pin's lifetime (fresh-session `/code-review` + `/security-review` on PR #278)

The review raised three findings, two merge-blocking. Both blockers were about **how long the
pin lives**, not about the pin itself, and both were confirmed here before being acted on —
reproduced against the real `PlusOneApp`, with numbers matching the reviewer's own.

The single root cause: **the write was guarded by a `useRef` while the pinned value lived in
the URL.** A ref is per-mount; the URL is not. Every gap between those two lifetimes leaked.

**Blocker 1 — the pin was one-shot per id, so the original bug came back after the first
hardware-back gesture.** `pinnedDoorRef.current === resolvedDoorId` was doing double duty: the
render-loop guard *and* a permanent record. Once `ev-a` had been pinned, that id could never be
pinned again for the life of the mount — and `doorState.eventId` returns to `null` **without** a
remount. `useDoorOverride`'s popstate listener drops the override on any back/forward by design
(it exists precisely because Next's hooks don't re-fire on a raw-history pop, 86ey9tq62), and a
door entered from the bottom tab has no `?event=` in Next's tracked search string to fall back
to. So closing a guest overlay with the Android hardware back button — the door's single most
common gesture — put the door back to being derived every render. Measured on the unfixed code:

```
after popstate, door : true
door after 2nd event : false
picker mounted       : true
channelTeardowns     : 1     <- the realtime channel this whole PR exists to protect
```

**Blocker 2 — the pin was persisted in the URL but the mechanism releasing it was not, so a
doorhost could land on a dead screen with no way out.** The pin survives a reload; a `useRef`
does not. A tablet reloading last night's pinned URL (a plain refresh, or the Capacitor
remote-URL shell restoring the last URL) hits: `requestedDoorId` = the stale `ev-a` from the
URL, so the `length === 1` derivation never runs; `resolvedDoorId` = `null`, correctly rejected
by validation; the release never fires because the fresh ref is `null`; and with exactly one
candidate there is no picker either (`> 1` required). Measured on the unfixed code:

```
door mounted   : false
picker mounted : false
URL            : ?event=ev-a
body text      : "Check-in — No event to check in to yet. Create or open one first."
```

This is a regression in kind, not degree: before the PR the implicit choice was never written
to the URL, so the same reload just re-derived tonight's event. A stale *explicit* `?event=`
could already strand a host, but only if they had deliberately picked one — after round 1 every
single-candidate door tab acquired one automatically.

**Finding 3 (minor) — an explicit re-pick of the already-pinned event was mislabelled as "our
guess".** A pick from the in-door picker (`onChangeDoorEvent` → `onPick`) goes through
`replaceDoorState` with no remount, so the ref kept its old value and the user's own choice
became releasable by the branch above. The reviewer's own note — that deriving intent from
state instead of tracking it in a ref removes all three at once — is what the fix does, so this
one dissolved rather than being patched.

**The fix: nothing is remembered about who chose an id; both halves read current state.**

- The **write guard** now asks *"is the state already what I would write?"* instead of *"have I
  ever written this?"* — it compares against `doorState.eventId`, which is self-healing: after
  the write the state *is* the value, so the effect stops on its own. It re-pins after a
  popstate, which is exactly what blocker 1 needed.
- The **release** now fires on `rejectedDoorId` — the candidate list's own settled verdict,
  published as state by the existing stale-id refetch effect once that id's one retry has come
  back and still doesn't contain it. It needs no memory of who chose the id, so it is
  re-derived on **every** mount, including the fresh one after a reload. That closes blocker 2.
- `pinnedDoorRef` is gone entirely.

Two details that are load-bearing rather than incidental:

- `rejectedDoorId` is **state, not a ref**, on purpose. Effects in one component run in
  declaration order, so a ref written by the refetch effect would already be readable by the
  pin effect on the *same* commit — and the pin would then be released before its retry had a
  chance to bring the event back. That retry exists for a real case ("Check-in" tapped for an
  event a colleague created seconds ago), so collapsing the two into one commit would trade a
  dead end for landing the host on the wrong event. A state update forces a later render.
  Mutation-tested: replacing the `rejectedDoorId` gate with a plain settled-list check turns
  that case red (`expected '?event=ev-b' to contain 'event=ev-a'`).
- The release re-checks `!doorCandidates.some(...)` alongside `rejectedDoorId`, because on the
  commit where the refetch effect *clears* the rejection the pin effect still reads the previous
  state value.

**Deliberate behaviour change.** The release no longer distinguishes our pin from an explicit
user pick, so a stale explicit `?event=` is now released too. That is a fix, not collateral:
`resolvedDoorId` already refuses to mount the door for a non-candidate, so such an id was only
ever stranding the host.

**Tests.** `src/components/po/door-pin-lifetime.test.tsx` (jsdom, real `PlusOneApp`) adds four
cases; the round-1 file's candidate-query stub was made faithful (`refetch()` now flips
`isFetching`, which is what `notifyOnChangeProps` actually re-renders on — a no-op stub modelled
a retry that never lands).

Red-on-revert verified per test, mechanically, against `git show HEAD:src/components/po/app.tsx`:

| test | on unfixed code |
| --- | --- |
| re-pins after a hardware-back gesture drops the door override | **red** — `door-provider` null after the 2nd event |
| releases a rejected pin on a FRESH mount (reload dead screen) | **red** — `door-provider` null, no picker |
| writes the pin exactly once at mount, never on an idle re-render | green (loop guard was already correct) — **red under mutation**: dropping the guard gives `expected 2 to be 1` |
| does not release before the stale-list retry has settled | green (unfixed code never releases there) — **red under mutation** as above |

The reviewer explicitly confirmed the round-1 render-loop guard was sound (1 write at mount, 0
on idle re-renders). Removing the ref must not cost that, so it is now asserted directly by
counting real `history.replaceState` calls rather than left implicit.

**Gates (round 2).** `pnpm lint` clean (same 2 pre-existing `jsx-a11y` warnings in the
unrelated `datetime-field.tsx`), `pnpm type-check` zero errors, `npx vitest run` **117 files /
1195 tests, all passing**. The three protected guards were neither touched nor weakened:
`app-shell-no-ssr-suspense.test.ts` and `door-tab-element-identity-bailout.test.ts` green;
`tests/e2e/app-home-events-visible.spec.ts` unmodified but still not runnable in this container
(no Docker → no local Supabase stack, and Playwright needs a dev server). Door offline
invariant #25 is untouched — the release, like the pin, goes through `replaceDoorState` on raw
history, never `router.replace`.
## 2026-08-19 — Venue switch: a refused switch no longer reloads as if it worked (86eykm7rk)

Branch `fix/86eykm7rk-venue-switch-silent-failure`. Milestone: **Now**. No migration, no schema
change — five source files, one dead component deleted, three unit suites, and one CLAUDE.md
invariant line.

**The bug.** `persistActiveVenue` (`src/features/venues/actions.ts`) refuses on three paths
*without throwing*: no session, Zod rejects the id, or the id is not one of the caller's live
memberships. Its only caller, `setActiveVenueAction`, dropped that boolean on the floor and
resolved as `Promise<void>`. The po shell's `switchToVenue` then did:

```ts
void setActiveVenueAction(fd).then(() => window.location.assign('/app')).catch(() => setToast(null));
```

`.then()` fires on a refusal exactly as it does on success — `.catch()` only ever saw real
exceptions. So the cookie was never written, the reload re-resolved identity to the **old**
venue, and the user landed back where they started with no error and nothing to act on.
Repeatable forever. **Trigger:** an admin revokes someone's membership of venue B between the
render of `myVenues` and their tap on "switch".

**Why the fix is not just "return the boolean".** One constraint shaped it: an expired session
must keep reloading, because that routes through middleware to `/login` — the right destination,
where an error toast would instead be a dead end. So the outcome is three states, not a boolean,
precisely because `unauthenticated` and `denied` must diverge in the UI:

```ts
export type SwitchVenueResult = 'ok' | 'unauthenticated' | 'denied';
export async function switchActiveVenueAction(venueId: string): Promise<SwitchVenueResult>
```

`switchToVenue` reloads on `ok` **and** on `unauthenticated`; only `denied` raises a message. The
refusal reasons stay server-side — the client learns the outcome, not the membership list.

*(Round 1 shipped a second, `Promise<void>` export as well, to keep `VenueSwitcher.tsx`'s
`<form action={…}>` call site compiling. Round-2 review found that component is rendered nowhere;
see "What round-2 review changed" below — that constraint and the second export are both gone.)*

**Second caller fixed too.** `screens/onboarding.tsx:72` (the switcher's "New venue" quick-create)
had the identical swallow — `await setActiveVenueAction(fd)` then an unconditional reload. It now
branches on the same contract — with its OWN string, because the venue *was* created at that
point (see finding 3 below).

**Copy is English, and that is now settled — and CLAUDE.md says so.** Max decided on 19/8 that
the product's UI copy is English; `tone-of-voice.md`, `copy-deck.md` and `ia-audit-claude-code.md`
§8 already said so, and `src/lib/i18n/en.ts` is headed "English UI copy — the single source of
truth". Round 1 flagged CLAUDE.md's Conventions line ("Dutch UI copy") as the odd one out and
asked for one of the two to move. **The correction was not actually in the repo** — not on `main`
and not on any remote branch — so this PR makes the one-line edit rather than shipping a changelog
that references a fix that does not exist. Invariant change only; no string in this PR is Dutch,
and the existing `switchFailed` text is unchanged.

**Red-on-revert verified on both halves** (not assumed — each was reverted and re-run):

| revert | failure |
|---|---|
| `switchToVenue` back to `.then(() => assign('/app'))` | `expected "spy" to not be called at all, but actually been called 1 times` — the buggy code navigates |
| `switchActiveVenueAction` swallowing the result (`await …; return 'ok'`) | 3 failures: `expected 'ok' to be 'denied'` ×2, `expected 'ok' to be 'unauthenticated'` |

**Gotcha for the next component test in this shell.** jsdom's `window.location` is
`[LegacyUnforgeable]`: `vi.spyOn(window.location, 'assign')` throws `Cannot redefine property`.
Replacing the whole property with `Object.defineProperty(window, 'location', { configurable: true,
… })` works and is what `app.venue-switch.test.tsx` does. The same file also shows how to drive a
real `usePo()` callback from a mocked screen — `await import('./context')` **inside** the
`vi.mock` factory, never a closed-over binding, or you get a second module instance, a second
React context, and `usePo()` throws.

`app.auto-open.test.tsx` needed its `@/features/venues/actions` mock renamed to the new export;
it mocks the module wholesale, so a missing export would have failed at import.

**Diff discipline.** `src/components/po/app.tsx` is also touched by PR #278 (`requestedDoorId`
~r. 437–466, pin logic ~r. 540–551). This PR's hunks are the `switchToVenue` callback, two imports,
a module constant and the toast state/render lines — all clear of those regions, no reformatting,
no import reordering. Re-verified after round 2 with a real trial merge against #278's branch:
`app.tsx` **auto-merges cleanly**; the only conflict is this file, where both PRs prepend a
newest-first entry at the same anchor — inherent to the convention, resolved by whichever merges
second.

### What round-2 review changed (fresh-session `/code-review`, 6 findings)

All six were verified against the code before being acted on; all six held.

**1 — `denied` also fired for external-crew venues (the serious one).** `src/app/app/layout.tsx:70`
builds the shell's `myVenues` as memberships **plus** organizer-only venues, and `VenueSwitch`
renders a Switch button on every one of them — labelling the crew ones "External crew".
`persistActiveVenue` validated against `getMyMemberships()` alone, so tapping Switch on a crew
venue returned `denied` and round 1 answered it with *"You no longer have access to that venue."*
Deterministic, on a completely normal path, for a user who had lost nothing — the PR's own premise
(`denied` ⇒ revoked access) did not hold. The check now mirrors `layout.tsx` exactly: memberships
∪ organizer venues, with the organizer lookup best-effort (`.catch(() => [])`) so a failing crew
read can never lock a real member out of their own venue. This is the same set
`resolveActiveVenueId` accepts a cookie against, so the write resolves correctly on reload. **`roles: []` is
not "no access": event scope IS access (#24/86ey21vre).** RLS remains the boundary either way —
this only decides whether the cookie is written.

**2 — the thrown-error path was still silent.** `.catch(() => setToast(null))` made a network blip
or a 500 indistinguishable from the silent refusal this PR exists to remove: "Switching…" flashed,
the venue did not change, nothing said why. It now raises `t.venue.switchError` — deliberately
**not** `switchFailed`, because the user's access is fine and "try again" is the opposite advice
from "refresh your venues".

**3 — the create message contradicted itself.** `VenueCreate` reused `venue.switchFailed`, telling
someone who had just become a venue's Admin that they no longer had access to it, and pointing
them at a list that *does* contain it. Its own key now: `onboarding.venueCreate.createdNotOpened`
— "Venue created, but we could not open it. You'll find it under More → Venues."

**4 — the toast timer diverged from the codebase's idiom, and there is a hook for it.** A bare
`setTimeout` in a promise callback outlived unmount and could clear a *later* toast: refuse a
switch (6s timer armed), tap a valid venue 3s later, and at t=6s the stale timer wiped the
in-flight "Switching…". The review pointed at the hand-rolled effects in `app.tsx:379` and
`guests/profile.tsx`, but the canonical answer is `src/lib/use-transient-value.ts` —
**11 call sites** (DoorProvider, `home.tsx`, the cockpit, every copy-link flag), and its docstring
names this exact bug: *"an earlier trigger's timer can never fire after a later value was set and
wipe it prematurely (86ey9ea1g — the home.tsx toast had exactly this bug before this hook
existed)"*. So `switchToVenue` now uses that hook rather than a fourth private timer, and gets its
trigger-after-unmount no-op for free — which matters, because this toast IS armed from an async
completion.

The one thing the hook cannot express is a **sticky** toast, and "Switching…" must be sticky: the
reload ends it, not a timer. So the two live side by side — sticky `toast` state for "Switching…"
and the billing toast, transient hook for the two errors — with `{(transientToast ?? toast)}`
rendering, and a new switch calling `clearTransientToast()` so a previous attempt's error cannot
render over the new "Switching…".

**5 — the onboarding branch had no test** while its `app.tsx` twin had four.
`screens/onboarding.venue-create.test.tsx` adds four: `denied` (no reload, create-specific string,
explicitly `not.toBe(switchFailed)`), `ok`, `unauthenticated`, and a failed create that must never
reach the switch. `actions.venue-switch.test.ts` gains the external-crew case from finding 1, a
"venue in neither set is still denied" guard so the widened set does not become accept-anything,
and the organizer-lookup-fails fallback. `app.venue-switch.test.tsx` gains the two timer tests and
its thrown-error test was rewritten — round 1's version *pinned the silence*.

**6 — the constraint that shaped the design came from dead code, so the design got simpler.**
`VenueSwitcher.tsx` was the sole consumer of the void-returning `setActiveVenueAction`, and
`grep -rn "VenueSwitcher" src/` returned only its own definition. It is a leftover of the retired
`(app)` dashboard (the branches that still import it are all June-2026 and pre-date `/app`), and
if it were ever mounted it carried the exact silent failure this PR removes. Deleted, and with it
`setActiveVenueAction` and the `persistActiveVenue`/two-export split: one exported
`switchActiveVenueAction`, no void/non-void justification, **net fewer lines than round 1**. Its
two dead siblings in that directory (`RemoveMemberButton.tsx`, `VenueSettingsForm.tsx`) are
untouched — unrelated to this bug, and dead-component removal has its own lane (PR #274).

**Red-on-revert verified on all five new guards** (each reverted and re-run, not assumed):

| revert | failure |
|---|---|
| access set back to memberships-only | `expected 'denied' to be 'ok'` — the external-crew test |
| `.catch()` back to `setToast(null)` | `Unable to find … "Could not switch venue…"` |
| error toast back to a bare `setTimeout` | `Unable to find … "Switching…"` — the stale timer clips the next toast |
| `VenueCreate` back to `t.venue.switchFailed` | `Unable to find … "Venue created, but we could not open it…"` |
| `VenueCreate`'s `denied` branch deleted | `expected "spy" to not be called at all, but actually been called 1 times` |

**Finding 1 also proved against a real database, not only mocks.** The unit test mocks
`getMyMemberships`/`getOrganizerVenues`, which is exactly the layer the bug lived in — so it was
worth confirming the premise holds against real RLS. The seed already ships the case: **Yusuf
(`organizer@plusone.test`) has no membership at Club Vesper, only an `event_organizers` row**
(seed comment: *"organizer Yusuf has NO membership, only an event scope"*). Adding a membership at
De Marktzaal makes him member-at-B / external-crew-at-A — the reviewer's exact scenario. Running
the app's two reads under his JWT with RLS enforced (`supabase/tests`-style `pg_temp.login`,
script kept out of the repo — it asserts seed shape, not app logic):

```
ok 1 - Club Vesper is NOT among Yusuf's memberships (external crew only)
ok 2 - Club Vesper IS among Yusuf's organizer venues, visible under RLS
ok 3 - round-1 (memberships only) would return 'denied' for a normal crew venue
ok 4 - round-2 (memberships UNION organizer) returns 'ok' for the crew venue
ok 5 - a venue in NEITHER set is still denied
ok 6 - the real membership (De Marktzaal) is still allowed
ok 7 - no membership row at the crew venue: selecting it grants no roles
```

The last one is the security half: writing the cookie for a crew venue grants no roles, so no
role-gated action opens up and RLS still decides every read.
## 2026-08-19 — pgTAP: a plan/run mismatch is now a red build (86eykjgrb)

Branch `fix/86eykjgrb-pgtap-plan-mismatch`. Two test files had been printing
`# Looks like you planned N tests but ran 2` into every suite run while `supabase test db`
reported an overall PASS.

**What was actually wrong — not what it looked like.** The symptom reads as "13 assertions
never ran", and that was the working theory. It is not what happens. Every assertion in
`tiers.vat.test.sql` runs, and every one passes; the same holds for `event_templates.test.sql`
(41 planned). The defect is in pgTAP's own bookkeeping:

- `finish()` compares `plan(N)` against `curr_test`, which pgTAP stores in the **temp table**
  `__tcache__` — so `rollback to savepoint` reverts it along with the section's data.
- The test *numbers* it prints come from `__tresults___numb_seq`, a **sequence**. Sequences are
  non-transactional, so those keep counting correctly across the same rollback.

The two drift apart, and `finish()` ends up comparing the plan against the last assertion that
ran *outside* a savepoint — test 2 in both files. `event_templates.test.sql` already carried a
comment showing the author had hit the edge of this ("finish() sees zero and raises *No tests
run!*") and worked around the exception without noticing the count was also wrong.

**Why pg_prove was right to say PASS.** The TAP stream it receives is complete and correct:
`1..15`, then fifteen `ok` lines. pgTAP's contradicting self-check is emitted as a TAP
*comment*, which a harness is free to ignore. Verified against the real binary rather than
assumed — pg_prove **does** already fail on a `not ok` line, and it passes `ON_ERROR_STOP=1` to
psql, so a file that genuinely dies mid-run truncates its stream and fails as
`Bad plan. You planned 4 tests but ran 2`. Neither of those safety nets was broken. The one
gap was the comment.

**The fix.** Re-sync pgTAP's counter from the sequence — the only place that knows what actually
executed — immediately before `finish()`, in the three files that use savepoints
(`tiers.vat`, `event_templates`, `events`). `plan(N)` was **not** lowered to match; that would
define the defect away. `events.test.sql` was not emitting the diagnostic, but only by accident
of ordering (its last assertions happen to sit outside a savepoint), so it got the same
treatment rather than being left to break on the next edit.

**The gate (the weightier half).** `supabase test db` in CI is now `node scripts/db-test.mjs`,
which streams pg_prove's output through unchanged and fails the build on
`planned N tests but ran M`, `Looks like you failed N tests of M`, and `# No tests run!`.
Detection lives in `scripts/lib/pgtap-gate.mjs` with a Vitest suite
(`tests/unit/pgtap-plan-run-gate.test.ts`, 7 tests) built from real captured pg_prove output.
Proven by running the gate against the unfixed file: pg_prove exits 0 and reports `Result: PASS`,
the gate exits 1.

**Scope of the rot: 2 files of 56.** The full suite was run file-by-file to check, not sampled.
1092 assertions, no mismatches remaining.

### Round 2 — review: the gate's own reliability (7 findings)

Reviewed as "no blockers", but five of the seven were about whether the gate can be
trusted to go red, which is the entire point of it. Each is now pinned by a test that
was checked to FAIL against the pre-fix code — a gate you only argue about is the thing
this PR exists to stop.

**Confirmed and fixed:**

- **stdout and stderr were merged into one buffer, then matched line by line.** They are
  independent pipes. Reproduced: a fake pg_prove writing `# Looks like you planned 15
  tests but `, a stderr warning, then `ran 2` yields the merged line
  `# Looks like you planned 15 tests but WARN: local stack is still warming up` — the
  old code found **0 hits** and exited 0 on a real mismatch. Every entry point in
  `pgtap-gate.mjs` now takes one string per stream and scans each on its own.
- **`process.exit()` on a piped stderr truncated the diagnostic the script exists to
  print.** Measured, not reasoned: ~200 KB of gate output, a reader busy for 250 ms
  (a CI log collector), stderr a pipe — `process.exit(1)` delivered **0 bytes**;
  `process.exitCode = 1` delivered all 199,569 with the tail intact. Both exit paths
  now set `exitCode`.
- **The success line asserted something nothing had verified.** "No failure pattern
  matched" is also what zero coverage looks like — a renamed tests directory, a changed
  CLI glob, a `config.toml` edit. `findMissingRunEvidence()` now demands positive proof
  (`Files=N` ≥ 1, `Tests=M` ≥ 1, a `Result: PASS` line) before success may be printed,
  and the success line names the numbers it checked instead of claiming a property.
- **`currval()` raised when no assertion had advanced the sequence.** SQLSTATE 55000
  aborted the transaction before `finish()` could raise `# No tests run!` — replacing a
  signal the gate catches by name with a sequence error it does not recognize, in
  exactly the case the gate must catch. The three resync blocks now swallow 55000 and
  leave `finish()` to raise its own diagnostic.
- **The gate was bypassed by every documented local workflow.** It lived in CI and
  `pnpm db:test` and nowhere else, so **CLAUDE.md's prod-push flow — the last check
  before a schema reaches the one prod project, with no staging behind it — stayed
  blind.** Nine call sites repointed at `pnpm db:test` (CLAUDE.md, README ×2,
  docs/ARCHITECTURE.md, bouwplan ×4, launchplan). Cost is zero: the wrapper needs no
  `node_modules`, adds no DB work, and now forwards arguments, so it is a strict
  superset of the bare command. `tests/unit/pgtap-gate-is-the-documented-command.test.ts`
  keeps the sweep from rotting — a live instruction doc may name the bare command only
  on a line that also points at the wrapper. Historical records (changelog,
  security-audit, plan-*) are deliberately untouched.
- **Arguments were silently dropped**, so `pnpm db:test -- one.test.sql` quietly ran all
  56 files against the shared local stack. `process.argv.slice(2)` is forwarded.
- **Two comment blocks stated an invariant the fix had removed** ("this final assertion
  must commit so curr_test reaches 46"; "without at least one non-rolled-back test,
  finish() sees zero"). Both rewritten — the resync takes the count from the sequence, so
  section ordering is now free. `event_templates.test.sql` carried the same stale rule
  and was fixed with it, though the review only flagged `events.test.sql`.

**One behaviour change beyond the findings.** The gate's patterns are now applied on the
non-zero-exit path too. `# No tests run!` is RAISEd by pgTAP, so psql (`ON_ERROR_STOP=1`)
exits non-zero and the old control flow returned before the gate ever looked — the pattern
was dead. It now names what it found on top of the exit code, instead of leaving the reader
to hunt through 56 files of output.

**How the gate was proven, not argued.** `tests/unit/pgtap-plan-run-gate.test.ts` (21 tests)
spawns the real `scripts/db-test.mjs` against a scripted fake `supabase` with its
stdout/stderr as pipes — the exact shape CI gives it — and covers the interleaved split, the
slow-reader truncation, the zero-coverage exit 0, the silent exit 0, argument forwarding, and
a non-zero exit that still gets labelled. Each guard was verified by reintroducing the defect:
merging the streams flips the interleave test to exit 0, restoring `process.exit()` drops the
diagnostic to 0 bytes, removing the evidence check turns both zero-coverage tests green.

The SQL half cannot be unit-tested — pgTAP's counter, `currval()` and `finish()` need a real
Postgres — so it was proven in CI instead, as four temporary workflow steps that assert their
own claims against the live stack and were removed again in the following commit (runs
`32271276799`, all four green). Each assertion was emitted as a workflow annotation, since this
session could not reach the log-storage host; the verdicts, verbatim:

**A — the gate turns a pg_prove PASS into a red build.** A savepoint-drifted file added to the
real 56-file suite:

```
bare `supabase test db` exit=0 ; gate exit=1
bare: # Looks like you planned 4 tests but ran 1
bare: Files=57, Tests=1096,  5 wallclock secs
bare: Result: PASS
gate: ✖ pgTAP plan/run gate failed — pg_prove reported PASS, but:
gate:   a pgTAP file's plan() does not match the number of assertions it ran:
gate:     # Looks like you planned 4 tests but ran 1
```

**B — the `currval()` finding, reproduced and then fixed, as an A/B on one database.** The same
zero-assertion file, differing only in the exception handler:

```
B2 (pre-fix):  ERROR:  currval of sequence "__tresults___numb_seq" is not yet defined in this session
               CONTEXT:  SQL statement "SELECT _set('curr_test', currval('__tresults___numb_seq')::int)"
               → Tests: 0, and `# No tests run!` never appears at all
B1 (fixed):    ERROR:  # No tests run!
               → gate: "a pgTAP file planned tests but ran none"
```

**D — arguments reach the real Supabase CLI**, which the unit test cannot show (it only sees a
fake binary): `Files=1, Tests=15` and `✔ pgTAP plan/run gate: 1 files / 15 assertions ran`.

**One false start worth recording.** The first version of proof A put its surviving assertion
*after* the rollback. CI reported `Files=57, Tests=1096`, `Result: PASS`, the proof file marked
`ok` — and no mismatch emitted. The gate exited 0 because there was genuinely nothing wrong:
that file only drifts if pgTAP's `ok()` increments `curr_test`, and not if it assigns it from
the sequence. The fixture was wrong, not the gate. Reshaped to mirror `tiers.vat.test.sql`
exactly — surviving assertion first, savepoint sections last, rollback immediately before
`finish()` — which drifts under either mechanism. Worth keeping in the record twice over: it is
also the one run in this PR where the gate was shown NOT to fire on a file that had not actually
drifted.

## 2026-08-19 — `guests.added_by` gebonden op UPDATE (86eymckjt)

Branch `fix/86eymckjt-guests-update-bind-added-by`. Milestone: Now. Migratie
`20260819100000_guests_update_bind_added_by.sql`, pgTAP `guests_added_by_bind.test.sql` (20
assertions). Spec-bullet toegevoegd onder de quota-implementatie in `gastenlijst-app-spec.md`,
naast de `guests.status`-bullet van 11/8 — dezelfde les, één kolom verder.

**Het gat.** `guests_update` (`20260613120000`, laatst gewijzigd `20260811160000`) evalueerde zijn
rol-tak op `auth.uid()` en stelde nooit een eis aan de *waarde* van `added_by`:

```sql
and (
  added_by = (select auth.uid())
  or public.has_venue_role(public.event_venue(event_id), '{admin,doorhost}')
  or public.is_event_organizer(event_id)
)
```

Kom je binnen via de tweede of derde tak, dan is die kolom vrij beschrijfbaar. `guests_insert`
pinde hem sinds dag één (#27); de UPDATE-kant nooit.

**Waarom dat het quotum adviserend maakte.** `enforce_guest_quota` (`20260714100000`, r.55) toetst
de vrijstelling op de **genoemde adder**, niet op de schrijver
(`not public.user_is_quota_exempt(new.event_id, new.added_by)`), en `user_is_quota_exempt`
(`20260625120000`) is waar voor elke venue-admin. Wijs `added_by` naar een admin en de hele
persoonlijke-quotumtak slaat over: niemands meter wordt belast — niet die van de schrijver, niet
die van de admin. Een doorhost of staflid met nul vrije plekken kon zo onbeperkt gasten toevoegen
door één normaal belaste rij toe te voegen en die daarna te herattribueren. **Dat sluit deze PR —
maar het quotum wordt er nog niet afdwingbaar van; zie "Wat hierna nog openstaat".** Dezelfde truc wijst een
rij naar `NULL`, de "auto-goedgekeurd via aanvraaglink"-attributie (#43(c)), die op géén meter drukt.

Wat wél bleef staan, en waarom dit geen gratis-gastenmachine was: de gedeelde pools bewogen nog
steeds (`events.capacity`, `guest_tiers.max_guests`) en `audit_log.actor_id` legde altijd de echte
sessie vast. De schade is misattributie plus een omzeilbaar persoonlijk quotum.

**Herkomst.** Gevonden door fresh-session `/code-review` + `/security-review` op PR #271
(`86ey9et0h`, door-outbox owner-stamp). Daar opgevoerd, vervolgens geverifieerd als pre-existing en
op `main` in één write bereikbaar — geen regressie van die PR. De migratie-header van
`20260812140000` noemt deze taak expliciet als de echte fix.

**De regel.** `added_by` mag ongewijzigd blijven of naar de caller zélf bewegen; nooit naar een
derde, nooit naar `NULL`. Eigenaarschap overnemen geeft niets weg: `enforce_guest_quota` ziet
`old.added_by <> new.added_by`, telt de oude bijdrage als 0 en zet de volle nieuwe op de meter van
de overnemer (bewezen in C3: de doorhost gaat van 2 naar 3 van haar 5). Eén bewuste asymmetrie,
genoteerd in de migratie-header: een venue-**admin** is quota-exempt, dus een admin die een gast van
een staflid overneemt geeft diens plek vrij. Admins bezitten de quotatabel sowieso en kunnen die
direct ophogen, dus dat voegt geen capability toe.

**Een trigger, geen `WITH CHECK` — precies de valkuil die de review van PR #271 (C4) ving.**
`WITH CHECK` evalueert de RESULTERENDE rij, niet de gewijzigde kolommen. Een grens op `added_by` in
de policy hervalideert dus élke update die de kolom niet aanraakt — notitie bewerken, tier wijzigen
(enkel + bulk), `undoRefusal`, `ackNote`, soft delete — tegen wie er toevallig in staat, en zou
daarmee juist de rijen bevriezen die een admin/doorhost/organisator hoort te kunnen bewerken. Een
BEFORE UPDATE-trigger ziet `OLD` en kan de enige vraag stellen die telt: *verandert* deze statement
de attributie? De trigger bindt bovendien strikter dan een policy: `guests` staat niet op
`FORCE ROW LEVEL SECURITY`, dus een SECURITY DEFINER-functie passeert RLS — maar nooit een trigger.

**Tweede valkuil uit dezelfde PR, ook overgenomen:** niet-client-contexten worden uitgesloten op
`current_user in ('authenticated','anon')`, **niet** op `auth.uid() is null`. `reset role` herstelt
de rol zónder `request.jwt.claims` te wissen, dus `auth.uid()` blijft vrolijk de laatst ingelogde
gebruiker teruggeven terwijl de write als superuser draait. Test D2 pint die val open: hij bewijst
dat de JWT-claim er nog stond toen D1 als superuser slaagde.

**Legitieme paden geverifieerd (bron, niet aanname).** Geen enkel pad schrijft `added_by` op een
bestaande rij: `src/features/guests/actions.ts` (updateGuest, changeGuestTier, bulk-tierwijziging,
soft delete), `src/features/door/outbox/gateway.ts` (`undoRefusal` = alleen `status`, `ackNote` =
alleen de ack-kolommen, `insertGuest` = een gewone INSERT, geen upsert, dus die raakt de trigger
nooit), en in SQL `promote_guest_to_contact` (`20260714140000`), `mark_guest_regular`
(`20260707150000`) en de anonimiseringssweeps — die raken `contact_id`/`full_name`/`email`/`phone`/
`note`/`anonymized_at` en zijn bovendien SECURITY DEFINER, dus de client-context-test sluit ze uit.
pgTAP sectie B dekt alle zes de client-updates expliciet af.

**Bewust niet meegenomen (open beslissing voor Max).** Of `enforce_guest_quota` de vrijstelling op
de **schrijver** moet toetsen in plaats van op `added_by`. Dat is een gedragswijziging — een admin
die namens een staflid toevoegt belast dan diens quotum — en vereist een expliciete go. Zonder die
wijziging blijft één legitieme route bestaan waarlangs een gast op niemands meter landt: een admin
die zelf toevoegt (source `app`), wat het bedoelde gedrag van de exemptie is.

**Wat hierna nog openstaat — het quotum blijft adviserend.** Een eerdere versie van deze kop en
van de spec-bullet zei "quotum-handhaving is niet langer adviserend". Dat klopte niet en is
teruggebracht tot wat deze PR feitelijk doet: `added_by` is gebonden op **UPDATE**. Na deze merge
blijven er twee één-write-routes over waarlangs een gebruiker over zijn persoonlijke quotum heen
komt. Beide zijn nagemeten op een volledige schemabouw (alle 99 migraties + `seed.sql` op een kale
Postgres 16, met een Supabase-shim voor `auth`), niet op een handmatig model:

1. **INSERT-forge langs `source='door'` (doorhost/organisator).** `20260812140000` (PR #271,
   besluit **#45**) versoepelde `guests_insert` van een pin naar een grens, zodat een deurtablet de
   entries van de vórige doorhost kan legen. `can_record_check_in_for` accepteert elke
   admin/doorhost/organisator van het event als *genoemde* adder, en een venue-admin is
   quota-exempt — dus precies de exploit die deze PR op UPDATE dicht, staat open op INSERT:

   ```
   honest add #1..#3 (eigen naam)                       -> ALLOWED
   honest add #4 (eigen naam)                           -> REFUSED 45001 "6 van 5"
   FORGE #1..#3  added_by=<venue admin>, source='door'  -> ALLOWED
   na afloop: doorhost 5/5 verbruikt | 3 gesmede rijen | 30 extra koppen op de lijst
   ```

   Besluit #45 noteert deze versoepeling al als "bekende prijs, aanvaard", op de grond dat "de
   collega's meter wordt belast". Die grond klopt voor een doorhost of organisator en **klopt niet
   voor een admin**, die is vrijgesteld — dan wordt er helemaal geen meter belast. Wat hier dus
   eerst moet gebeuren is een amendement op besluit #45 door Max, niet een stille aanscherping in
   een review-fix-PR. Bovendien werkt de voor de hand liggende one-liner
   (`and not public.user_is_quota_exempt(event_id, added_by)` in die OR-tak) niet zoals hij staat:
   `user_is_quota_exempt` is niet uitvoerbaar door `authenticated`, dus élke cross-user drain zou
   falen op 42501 "permission denied for function" — en 42501 is TERMINAL in `replay.ts`, oftewel
   dead-letter, oftewel exact het verloren deur-item dat #45 verbiedt. Mét de ontbrekende GRANT
   blokkeert hij de forge wél, maar weigert hij dan ook de legitieme drain van de eigen deur-adds
   van een **admin** (nagemeten). De derde optie — eisen dat de genoemde adder de outbox-eigenaar
   is — is server-side niet verifieerbaar: `ownerId` is een client-bewering, zoals de header van
   `20260812140000` zelf vaststelt. Vervolgtaak: vervolgtaak *"INSERT-kant van `guests.added_by` begrenzen + besluit #45 amenderen"* in ClickUp-lijst `901818739469` — nog aan te maken, ClickUp gaf tijdens deze sessie een rate-limit van ~19 uur.

2. **`source`-flip op UPDATE (gewoon staflid).** `guest_personal_contribution` telt
   `source in ('landing','permanent')` als 0 (#31/#11), en niets bindt `source` op UPDATE. Een
   staflid op zijn cap zet zijn eigen rijen om en begint opnieuw:

   ```
   staff honest add (over de cap)      -> REFUSED 45001 "13 van 12"
   staff flipt 12 eigen rijen->landing -> ALLOWED
   staff verbruik na de flip           -> 6/12   (18 rijen op zijn naam)
   ```

   Dezelfde vorm als de `guests.status`-les van 11/8 en als deze taak: een kolom die de
   quota-engine leest, maar die de client vrij mag schrijven. Vervolgtaak: vervolgtaak *"`guests.source` binden op UPDATE"* in ClickUp-lijst `901818739469` — idem nog aan te maken.

Kortom: deze PR haalt één van de drie routes weg en verkleint het gat; hij sluit het niet. De
kop, de spec-bullet en deze sectie zeggen dat nu in die woorden — een correcte fix met een
overdreven changelog is een slechtere PR dan een correcte fix met een eerlijke (de les van #252).

**Testen.** `pnpm lint` schoon (2 pre-existing a11y-warnings in `datetime-field.tsx`),
`pnpm type-check` 0 fouten, `pnpm test` groen. Geen Docker in de sessiecontainer, dus
`supabase start`/`db reset`/`test db` konden niet draaien — in plaats daarvan is de review-ronde
van 19/8 geverifieerd op een **volledige schemabouw**: alle 99 migraties + `seed.sql` toegepast op
een kale Postgres 16 met een minimale Supabase-shim (`auth.uid()/jwt()`, `auth.users`,
`auth.sessions`, de rollen `anon`/`authenticated`/`service_role`), waarna
`guests_added_by_bind.test.sql` er ongewijzigd op draait. Daarop gemeten: **20/20 groen met de
trigger**, en met de trigger gedropt (= `main`) zijn A1–A7 en B7 rood. A6 is apart nagemeten,
buiten de cascade van A1–A5 om, omdat dáár de review-bevinding zat:

```
A6 geïsoleerd, zonder de guard:
  caught: 42501: new row violates row-level security policy for table "guests"
  wanted: 42501: Je mag een gast niet op naam van een andere gebruiker zetten.   -> not ok
```

De pgTAP-job in GitHub Actions blijft het bindende bewijs.

---

## 2026-08-12 — Door outbox owner-stamp: a tablet hand-off no longer costs check-ins (86ey9et0h)

Branch `claude/outbox-owner-stamp-sync-7aadf3`. Milestone: Now (a lost door check-in is the
one failure mode a venue will not forgive). Spec decisions **#45** (this) and **#46**
(`add_contact_to_event` reuse, task `86ey9e9nb`) added to `gastenlijst-app-spec.md`.

**The decision that drove it (Max, 12/8): no data loss.** A venue tablet passes between
doorhosts. When A works a shift offline, taps N check-ins into the outbox and hands the
tablet over before it ever reconnects, those entries must still sync once B logs in on that
same device — not quarantined until A returns, not dropped. This **partially reverses #233
(`86ey9et07`)**, which introduced the sign-out wipe and thereby destroyed A's work in order to
prevent misattribution. Hard guardrail attached to the reversal: the audit trail is never
falsified. A stays the performer in the row, B is the actor who syncs.

**Why this could not be done in the client alone.** The queued entry carried no identity at
all — `replay.ts` took the actor from the live session at *drain* time. So the fix has two
halves, and only having the first one would have made things worse:

| half | without it |
|---|---|
| `ownerId` stamped at enqueue (`outbox/types.ts`) | the device doesn't know A did it; B's sync silently relabels the rows |
| RLS accepts an actor ≠ `auth.uid()` (migration `20260812140000`) | the insert returns `42501`, which `replay.ts` classifies as TERMINAL → dead-lettered → **the check-in is lost anyway** |

**The RLS change, stated precisely.** `check_ins_insert` pinned `checked_by = (select auth.uid())`
since the first RLS migration. That pin is now a *bound* rather than an identity: a door write
may name another actor, but only one who could themselves work that event's door
(`can_record_check_in_for`, SECURITY DEFINER, caller must independently pass `can_check_in`).
What the server deliberately does **not** claim is that A really tapped the button — A's session
is long gone, so that is a client assertion; the bound keeps it inside the set of people the
venue already trusts at the door, and `synced_by` + `audit_log.actor_id` record who transmitted
it. `refusals_insert` and (scoped to `source='door'`) `guests_insert` get the same treatment, the
last one because a dead-lettered door add takes the check-in chained behind it down with it (FK
`23503`).

**Bycatch — an UPDATE hole that predates this work.** `check_ins_update_door`
(`20260617020000`) had **no predicate on `checked_by` at all**, and because permissive policies
are OR-ed that made the sibling `check_ins_update_own_device` pin non-binding: any door-scoped
user could UPDATE an existing check-in and rewrite the actor to an arbitrary uuid — including
someone with no relation to the venue. `reviveCheckIn` writes that column on exactly this path.
Bounded now to the same rule as INSERT, so the migration nets out **tighter** than the status quo
despite relaxing the pin (pgTAP D1–D3).

**Accepted residual, recorded rather than buried.** Because `enforce_guest_quota` charges
`new.added_by`, the `source='door'` relaxation also lets a door-capable user attribute a walk-in
to a door-capable *colleague's* allowance. The guest is never free (event capacity and tier max
still move, the colleague's meter is still charged) and `audit_log.actor_id` still records the
real session — it misattributes which door colleague paid. Weighed against silently destroying a
queued door add, that is the smaller harm. Separately: if A's door role is revoked between the
shift and the sync, their entries settle to `error` rather than syncing — surfaced in the sync bar
and recoverable via force-sync once the role is restored, not silently dropped.

**Sign-out with pending entries.** Online, `signOutDevice` now drains first and the doorhost never
learns it happened. Offline it throws `PendingOutboxError(n)` and the caller shows a sheet naming
the cost ("N check-ins have not been synced yet"), with *stay signed in* as the primary action;
only an explicit `discardPending` proceeds. The wipe remains the endpoint (#233 / `86ey9e9mn`
untouched), as does the `sign-out-incomplete` fail-safe. The MFA wall refuses rather than prompts —
it sits in front of an unverified session and has no business discarding a doorhost's queue.

**What was NOT regressed** (checked deliberately, all three are load-bearing): the wipe-epoch +
`reset()` from #233, the `clearSettled`/tombstone-TTL housekeeping from #249, and the
`OUTBOX_BUSTER` envelope from #212 — the buster is deliberately **not** bumped and `ownerId` is
optional, because discarding the queue to enforce a schema is the exact data loss this PR exists
to prevent.

**Tests.** Vitest **1161 green** (61 new across `replay.test.ts`, `persistence.test.ts`,
`sign-out.test.ts` — owner-mismatch drain, identity preservation, mixed-owner queue, legacy
entries without `ownerId`, logout flush online/offline/discard). New pgTAP
`outbox_owner_stamp.test.sql` **16/16 green** (allowed + denied per role, `synced_by` pinned,
audit actor independent, UPDATE hole closed). `rls.test.sql` G3 rewritten: its subject moved from
"cannot record as someone else" to "cannot record as a **non-door role**", since admin now
legitimately passes. `pnpm lint` clean, `tsc --noEmit` clean.

**Test-round fixes (Max, 12-8) — one silent bug, one gap that is not ours.**

*The owner stamp did not survive going offline.* `meId` came from `supabase.auth.getUser()`, which
**validates against the auth server** and therefore fails offline — on a door surface that is the
normal case, not the edge one. Any reload during an offline shift left `meId` null, so every
subsequent check-in was queued with no `ownerId` and silently degraded to the old drain-time
attribution: the exact bug this task exists to fix, invisible because the queue still synced.
Resolved from `getSession()` (local storage, no network) first, with `getUser()` refining it when
a connection exists. Two regression tests in `DoorProvider.test.tsx`.

*Reloading offline is alarming and unguarded.* The queue survives (it is in IndexedDB), but the
doorhost lands on the browser's connection-error page with no way to tell whether their check-ins
are safe. Added a `beforeunload` guard, bound to un-sent work only so it cannot become a prompt
people click through by reflex. The browser owns the wording.

*What could NOT be verified locally, and why.* `public/service-worker.js` has a deliberate dev
kill-switch (`DEV = hostname is localhost`): on localhost it caches nothing and unregisters itself.
So "offline" in `pnpm dev` means *no service worker at all*, and any navigation falls through to the
browser's error page. Worse for this feature: a tab switch to Meer/Settings goes through
`router.push`, which forces an RSC round-trip — `app.tsx:308` already documents this, which is why
the door's own sub-navigation deliberately bypasses the router with raw History to keep invariant
#25. So **the offline branch of the sign-out prompt is unreachable in practice**: a doorhost who is
offline cannot open Settings, therefore cannot sign out, therefore cannot destroy their queue. That
unreachability is protective rather than harmful — the destructive path is gated behind the network
that would have flushed the queue anyway — but it does mean the prompt only fires in the
online-but-writes-won't-land case (captive-portal wifi), which is covered by unit test 6. Making
Settings reachable offline means extending the raw-History bypass to tab switches; deliberately NOT
done here (it is app-wide navigation surgery, not outbox work) and left for Max to scope.

**Review round (fresh-session `/code-review` + `/security-review`, 12-8).** No confirmed
vulnerabilities; three security candidates were raised and all three refuted on verification. The
code review found two merge-blockers and four real defects, all fixed here:

| # | defect | why it mattered |
|---|---|---|
| C1 | migration timestamp `20260812120000` collided with `…_landing_throttle_cleanup_cron` on `main` | `schema_migrations` keys on version — every `db push`/`db reset` after the merge aborts. Renamed to `20260812140000`. |
| C2 | `synced_by` sent on every insert, `null` included | PostgREST derives the column list from the JSON keys, and the prod migration is pushed AFTER the merge deploys — so in that window every door write returns PGRST204, dead-letters, and the door stops persisting check-ins. Now omitted unless a hand-off actually happened. |
| C3 | sign-out counted `isRetryable` (`pending \|\| error`) as blocking | a dead-lettered 45005 kept the doorhost behind a destructive-only prompt for the tombstone's full 12h, on any connection, claiming check-ins "have not been synced yet" that were in fact rejected. Counts unsent work only. |
| C4 | the UPDATE bound sat in `WITH CHECK` | WITH CHECK evaluates the RESULTING row, so a plain top-up or uitchecken was re-validated against whoever already sat in `checked_by`. Remove an external organizer afterwards and every later update to their check-ins failed 42501 — offline, terminally. Moved to a BEFORE UPDATE trigger that fires only when the actor CHANGES. |
| C5 | the sign-out flush drained queues it did not own | a staff session replaying a doorhost's entries gets 42501 → terminal, and automatic drains never retry those: the feature silently destroying the queue it exists to protect. Now skips when nothing in the queue belongs to the signing-out user. |
| C6 | `getUser()` could escape the flush | it validates against the auth server, so it rejects on captive-portal wifi where `isOnline()` is true — surfacing as a generic failure instead of the count, in exactly the scenario the prompt is for. |

Two smaller ones: the toast now says "door actions" when the queue is not all check-ins (C9), and
the flush reuses the caller's Supabase client instead of building a second one on the same cookie
storage (C10). Two documentation defects the review caught were corrected rather than papered over:
the migration claimed "the named colleague's meter is still charged", which is false when that
colleague is a venue admin (`user_is_quota_exempt` short-circuits the whole personal-quota branch),
and `synced_by`'s column comment promised more than the column delivers — it records the INSERT
only, since later updates do not maintain it.

**The trigger's own trap, worth remembering.** A trigger fires for EVERYONE, including the superuser
running seeds and pgTAP fixtures and every SECURITY DEFINER function — contexts RLS deliberately
does not apply to. The first version broke two unrelated pgTAP suites that arrange state by writing
`voided_by` directly. Exempting "no JWT" was NOT enough either: `reset role` restores the role
without clearing `request.jwt.claims`, so `auth.uid()` still returns the last logged-in user while
the write runs as a superuser. The correct discriminator is the ROLE — `current_user in
('authenticated','anon')` — which also forces the function to be SECURITY INVOKER, since inside a
DEFINER function `current_user` is always the owner.

**Pre-existing, out of scope, worth its own task:** `guests_update`'s WITH CHECK evaluates its role
branch on `auth.uid()` rather than on `added_by`, so any admin/doorhost/organizer can already
re-point `added_by` at a quota-exempt admin in one write on `main` today. That is what makes this
PR's `source='door'` relaxation a no-new-capability change rather than a new hole, and it is the
real fix for advisory-quota enforcement.

**Verified end-to-end in a real browser (12-8).** Driven through the in-app browser against the
local stack, both directions of a hand-off, with the transport to Supabase cut at `window.fetch` so
the outbox sees the same code-less failure a real offline shift produces:

| guest | checked_by | synced_by |
|---|---|---|
| Daniël Verhoeven, Eva Postma, Finn van Egmond, Julia Smeets, Lars Willems, Juri Braakman | `door@` | `admin@` |
| Isa van der Laan, Jesse Dijkstra | `admin@` | `door@` |

8 hand-off rows; `count(*) filter (where synced_by = checked_by)` = **0**, i.e. the column is set
only on a genuine cross-user replay, never as a redundant copy of the session. `audit_log.actor_id`
is the SYNCING user on all three of the first batch while the row keeps the performer — the
guardrail holds in live data, not just in pgTAP. IndexedDB inspection mid-shift confirmed every
queued entry carried `ownerId` = the doorhost who tapped it. The toast fires with correct
pluralisation: *"1 check-in from the previous user was synced"*.

Testing note worth keeping: `runFlush` drains regardless of `navigator.onLine` (only `maybeFlush`
gates on it), so overriding that property does NOT simulate offline — the drain still succeeds.
Cutting `fetch` to the Supabase origin is the faithful simulation.

**Full suite on a fresh database.** `supabase test db`: **55 files, 1085 assertions, PASS** —
including the new `outbox_owner_stamp.test.sql`. An earlier run had one failure in `rls.test.sql`
N1 ("3 seed + 1 anon", have 5), diagnosed as a stray `guest_requests` row ("Test Verify", created
two minutes after the seed timestamp) left by a manual dev session; a reset cleared it and the
assertion passes, confirming the diagnosis and satisfying DoD #5 (applies cleanly on a fresh DB).

**Gotcha worth remembering — a migration can be RECORDED without being APPLIED.** Twice during this
task the local `supabase_migrations.schema_migrations` table listed `20260812140000` while neither
`synced_by` nor `can_record_check_in_for` existed in the schema. In that state `supabase migration
up` reports "Local database is up to date" and silently leaves the schema wrong, which then fails at
the PostgREST layer (unknown column → every door insert rejected) rather than anywhere obvious. The
fix is `supabase migration repair --status reverted <version> --local` followed by `migration up`.
Both occurrences coincided with another session resetting the shared local stack — the concrete cost
of the one-DB-owner rule being broken mid-test.
## 2026-08-12 — Landing rate-limit hardening: throttle cleanup + Turnstile (86ey2czr6)

Branch `claude/clickup-task-fix-6dec47`. Rate-limit hardening sweep, milestone: before the
first real public event goes live (not a pilot blocker). Task's point 3 (log/alert on
rate-limit) belongs to Prod-ready 08 (Sentry, `86ey7q790`) per its 9/7 update note and was
left out here; point 2 (Vercel Firewall on `/e/*`) is dashboard-only config with no code
path — documented for Max, not built.

**Point 1. `landing_request_throttle` cleanup.** `consume_public_throttle` (20260706102000)
upserts one row per prefixed key (`req:`/`pv:`/`st:`/`if:`/`slug:` + ip_hash) and never deleted
anything — the table grew forever. `20260812120000_landing_throttle_cleanup_cron.sql` adds
`cleanup_landing_request_throttle()` (owner-only, no app-role EXECUTE) + an hourly pg_cron
schedule deleting rows `updated_at < now() - interval '2 hours'`, guarded the same way as
`run_privacy_retention`'s schedule so `supabase db reset` stays green without pg_cron
preloaded. pgTAP: `landing_throttle_cleanup.test.sql` (5 assertions).

**Point 4. Cloudflare Turnstile on `/e/[slug]`.** Widget (`TurnstileWidget` in
`src/components/po/landing.tsx`) renders only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set;
`verifyTurnstileToken` (`src/features/requests/turnstile.ts`) checks the token server-side in
`submitGuestRequest` before the rate-limited RPC. Keyless dev/CI is a hard requirement here —
same stance as the Stripe stub: without `TURNSTILE_SECRET_KEY` the server passes verification
open, so this ships inert until Max sets up the Cloudflare account. Two fail-open/fail-closed
choices worth flagging for review: (a) a missing/invalid token fails **closed** once a secret
is configured, but (b) an unreachable siteverify call fails **open** (logged) — a Cloudflare
outage shouldn't block every real submission when the DB rate limit/honeypot/dedup are still
standing. CSP (`next.config.js`) now allows `challenges.cloudflare.com` in
`script-src`/`connect-src`/`frame-src`. Setup steps for Max (Cloudflare account, site/secret
key → Vercel env) are in `docs/landing-rate-limit-hardening.md`, which also covers the Vercel
Firewall rule (point 2 above).

**Verified:** `pnpm type-check` clean, `pnpm lint` clean (pre-existing unrelated warnings
only), `vitest run` 1142/1142 passing (incl. new `turnstile.test.ts` covering the
keyless/fail-open/fail-closed matrix), `supabase db reset` clean on the full migration set,
`supabase test db` 1074/1074 passing. Manually verified in the browser preview: keyless widget
correctly renders nothing, full submission round-trip still succeeds, no console errors.

**Review gate:** this PR adds a new `SECURITY DEFINER` function
(`cleanup_landing_request_throttle`) — a CLAUDE.md high-risk surface — so it needs a
fresh-session `/code-review` before merge; the fail-open siteverify call also makes it worth a
`/security-review` pass given it's a new anon-facing external HTTP call.

**Addendum (same day, review-response round).** The fresh-session `/code-review xhigh` this
review gate asked for ran and returned 15 findings; all fixed on the same branch/PR (migration
`20260812120000` is still unmerged, so its comment block was edited in place — the one
documented exception to "never edit an applied migration"):
- `turnstile.ts`: 3s timeout (`AbortSignal.timeout`, a hang now fails open instead of blocking
  the submission indefinitely); `error-codes` from siteverify are now classified —
  infra-shaped codes (`invalid-input-secret`, `internal-error`) fail open, genuine verdicts
  (`invalid-input-response`, `timeout-or-duplicate`, `missing-input-response`) fail closed;
  `hostname` from siteverify is compared against the request's own `Host` header, closing a
  token-farming bypass (a token solved on an attacker's page, embedding our public site key,
  replayed against our action); `remoteip` is now sent (raw IP, never logged/persisted — new
  `landingClientIpForVerify()` in `ip-hash.ts`); enforcement now requires BOTH env vars, not
  just the secret — exactly one set fails open, loudly logged, instead of silently rejecting
  every submission on a half-finished env setup.
- `landing.tsx`: the doc comment claiming "the server's fail-open is the backstop" was wrong —
  a missing token fails CLOSED once configured, fixed to say so. `TurnstileWidget` split into a
  `<Script>` that mounts once (never remounted) and a separate `TurnstileContainer` for the
  widget itself (remounted on a failed submit for a fresh token) — verified against
  next@15.5.19 source: a remounted `<Script>` never reliably re-fires `onError` for a
  permanently failed src, so the fail state now lives where it survives that remount. A
  permanent script-load failure (ad-blocker, etc.) now shows a visible notice and disables
  submit instead of stranding the guest on a silent dead end.
- `actions.ts`: documented why verify-before-RPC is accepted (the RPC is consume-on-check, so
  there's no cheap way to check the throttle without also consuming it — the Vercel Firewall
  rule is the compensating edge control). New `actions.test.ts`: honeypot short-circuits before
  `verifyTurnstileToken` ever runs, and a rejected token never reaches the RPC.
- `next.config.js`: the CSP widening for `challenges.cloudflare.com` is now scoped to
  `/e/:path*` only (a second `headers()` entry after the strict global catch-all — order is
  load-bearing, last-wins per header key) instead of applying to every route. Verified live:
  `/` keeps the strict CSP, `/e/<slug>` gets the widened one.
- Migration comment corrected (window is 15 min, not 10; prefix list includes `slug:`; the
  DELETE is an unindexed seq scan that stays cheap only because the sweep keeps the table
  small) + a new `comment on function consume_public_throttle` recording the 2h ceiling.
  pgTAP de-flaked: drains the table before inserting fixtures, so a lived-in local/e2e stack
  with old committed rows can't break the exact-count assertion. `database.types.ts`
  regenerated against a fresh reset.
- Docs: fixed the same point-numbering ambiguity in `docs/landing-rate-limit-hardening.md`
  (headings now use the task's original point numbers) and removed the "add localhost to the
  Turnstile site" advice, which would have reopened the token-farming bypass the hostname check
  just closed.

Re-verified after fixes: `pnpm type-check`/`pnpm lint` clean, `vitest run` green (incl. 19
turnstile.test.ts cases + 3 new actions.test.ts cases), `supabase db reset` clean,
`supabase test db` 1074/1074. A second fresh-session review of the new code (hostname check,
error-codes handling, CSP split) is wanted before merge — see the PR for the security-research
prompt.

**Round-2 addendum.** Re-review confirmed all 15 findings above hold up in the actual code, and
surfaced 3 new low-severity residuals from the fix round itself, all fixed (commit `fa34a76`):
a port bug in the hostname check (`headers().get('host')` carries a port locally, Cloudflare's
`hostname` never does — broke the doc's own local real-key testing instructions, prod
unaffected); submit was gated on the script being `'ready'` instead of a token actually
existing (a tap in that gap hit the fail-closed rejection and the remount could cut off an
in-progress interactive challenge — fixed via a pure, unit-tested `computeTurnstileBlocking()`);
and a missing watchdog for a script request that hangs without ever firing `onError` (10s
timeout now flips it to the existing `'failed'` notice). Re-verified: `vitest run` 1163/1163.
Merged after Max confirmed the two `/code-review xhigh` rounds were sufficient coverage —
`/security-review` was intentionally skipped by his explicit call, not run.

---

## 2026-08-12 — Dependabot cleanup: 5 GitHub Actions majors merged, 2 npm groups closed on confirmed breaks

Repo hygiene, no ClickUp task (the npm-majors ignore-rule groundwork was already done in 86eyd39gn/#247).
7 open Dependabot PRs triaged.

**Merged (5, all CI-green, one-line version-pin bumps, no config changes needed):** #257
`actions/setup-node` 4→7, #152 `supabase/setup-cli` 1→3, #151 `actions/checkout` 4→7, #150
`pnpm/action-setup` 2→6, #149 `actions/upload-artifact` 4→7.

**Closed (2, grouped npm bumps with confirmed-breaking majors riding along with safe patches):**
- #264 `production-dependencies` (7 updates) — `zod` 3→4 drops `invalid_type_error`
  (`src/features/auth/schemas.ts`); `stripe` 18→22 changes the pinned `apiVersion` literal type
  (`stripe-adapter.ts`/`stripe-webhook.ts`). Both TS2353/TS2322 in CI.
- #241 `development-dependencies` (17 updates) — `typescript` 5→7 is explicitly rejected by Next
  15.5's own typescript-setup guard, failing `next lint` outright regardless of anything else in
  the group. Left the group's other untested majors (eslint 8→10, eslint-config-next 15→16,
  tailwindcss 3→4, vitest 1→4, jsdom 24→30, `@testing-library/jest-dom` 6→7) un-ignored — no CI
  proof either way, so Dependabot resurfaces them individually next run instead of guessing.

**dependabot.yml change (PR #265):** added `ignore` rules for `zod`, `stripe`, `typescript` majors,
mirroring the existing next/react pattern — future weekly grouped bumps only carry safe minor/patch
updates for these.

Zero code changes; scope was CI/Dependabot config only.

---

## 2026-08-11 — Quota-engine forge closed; quarter chart + per-member present follow #44 (86ey9c5fp)

Branch `claude/86ey9c5fp-quarter-chart-pending-quota` (PR #262). Part 2 of the M4 review
follow-up, **rewritten after a fresh-session `/code-review` found that half of it opened a
quota bypass**. Milestone: Now (fraud resistance on the core quota engine).

**What the review found, and what reproducing it showed.** The PR originally dropped `pending`
from the "holds a slot" branch of `guest_personal_contribution` and `link_headcount_contribution`,
on the argument that a pending guest is invisible and therefore inert. Verified against a local
stack, staff user pinned to 0 free slots (8 of 8), inside `begin … rollback`:

| statement | before the fix | after |
|---|---|---|
| normal `approved` insert | 45001 blocked ("9 van 8") | 45001 blocked |
| identical row, `status='pending'`, `plus_ones=50` | **accepted**, consumption still 8 | **42501 RLS reject** |
| same insert with the pre-PR function body | 45001 blocked ("59 van 8") | — |

The root cause is not the helper, it is that `guests_insert` pins `added_by` and `source`
(`20260623140200`) but never `status`, and `authenticated` holds table-wide INSERT including that
column. `enforce_guest_quota` only raises on a NET INCREASE, so with old = new = 0 the 45001
branch was never reached. The forged row still consumed the **shared** pools it is invisible in:
event capacity moved by 1 + plus_ones and tier-max by one entry — a ghost no screen renders and no
UI can delete. The migration's own SECURITY NOTE was wrong on all three of its claims; notably a
doorhost *can* insert a `check_ins` row for a pending guest (`check_ins_insert` gates on
`can_check_in(event_id)`, which structurally cannot see guest status), and
`sync_guest_status_from_checkin` then no-ops because it matches only `status = 'approved'` — so no
`guests` UPDATE fires and no quota re-check happens.

**Decisions (put to Max before writing code; he took all three recommendations).**
- **D1 — pin the column.** `20260811160000_guests_status_client_write_guard.sql`: a client insert
  may only create `approved`; a client update may never leave a row in `pending`/`denied` (the
  request-lifecycle statuses — `guest_requests.status` owns that). Verified non-breaking first:
  no client path sends a status at all (`guests/actions.ts` single + bulk, and the door outbox's
  `add_guest`) — they rely on the column DEFAULT. Triggers and SECURITY DEFINER RPCs bypass RLS
  (`guests` is not FORCE ROW LEVEL SECURITY), so the door's `approved → checked_in → refused`
  transitions are untouched.
- **D2 — revert 4A.** `20260811151000_pending_guest_holds_no_slot.sql` is deleted from the branch
  rather than neutralised by a follow-up migration. With the column pinned, 4A's motivation (an
  invisible slot the adder cannot free) is gone, and `pending` now charges uniformly across all
  four engines again — personal, link, capacity and tier. While the status column was forgeable,
  "which status is free" was attacker-controlled input.
- **D3 — `event_user_additions` follows #44.** `20260811161000`: `present`/`present_headcount` no
  longer count a guest refused after checking in, matching the chart and `summary.present` that
  render beside them. The gross ledger columns (`added`, `added_headcount`, `removed_headcount`)
  are deliberately unchanged — a different question.

**3A survives unchanged in substance** (`20260811150000`): `event_checkins_per_quarter` scopes to
`('approved','checked_in')`, so a guest refused after check-in leaves the chart. Two mechanical
cleanups from the review rode along: the `check_ins` scan had no bounding predicate of its own and
now filters on `c.event_id` (server-derived unconditionally since `20260713190000`, indexed), and
the `distinct on (c.guest_id)` was dropped — `check_ins.guest_id` is NOT NULL UNIQUE, so it
eliminated nothing while forcing a sort. The header comment that credited that clause with #11's
"first check-in wins" was wrong and is corrected: the UNIQUE constraint plus the door's 23505 →
revive path is what enforces #11.

**Link-cap display drift** (`20260811162000`). Four read paths re-typed the 45006 cap rule as a
literal `sum(case when gu.status in (…) then 1 + gu.plus_ones else 0 end)`, dropping the helper's
is-inside branch — so the Promotion bar and the public `/i/[token]` page could show room the
database will refuse to fill. `event_link_funnel`, `venue_influencer_leaderboard`,
`venue_label_link_funnel` and `get_influencer_stats` now delegate to
`link_headcount_contribution`, the same function `request_link_consumption` sums — the pattern
`event_tier_occupancy` already set for the tier cap. The three SECURITY INVOKER ones get the
matching `grant execute` on the helper. The now-false comment at `src/features/po/queries.ts` was
rewritten.

**Tests — the point of this round, since the original coverage is why it shipped.**
- `attacker_quota_bypass.test.sql` 8–13 (plan 7→13): the forged `status='pending'` insert, the
  `denied` variant, a 50-row forged batch and the update-to-pending path all reject with 42501, as
  `authenticated` rather than superuser; a DB-state assertion proves no forged row survived; and
  the legitimate soft delete still works, so the guard is not a regression.
- `event_lifecycle_capacity.test.sql` 10–13 (plan 13→17): the old case 14.4 was cited as the
  "no-bypass proof" and **could not fail** — `quota_override = 100000` made 45001 unreachable for
  the whole file, the block ran after the last `reset role`, and it contained no `throws_ok`. It is
  gone. In its place: pending charges its full 1 + plus_ones, that shows up in the adder's
  consumption, a check-in on a pending row does not promote it, and the guest stays charged either
  way. The post-cancel labels were renumbered 10–13 → 14–17 because pgTAP numbers by execution
  order, not by label.
- `event_capacity_inside.test.sql` 13 (plan 12→13): the capacity/personal parity assertion existed
  only for a `removed` row, which is why it stayed green while 4A broke parity for `pending`. Now
  asserted on a pending row too.
- `analytics.test.sql` §13 (plan 76→79): rebuilt on its own `e3..` fixture event instead of
  mutating the shared `ee..01` seed and pinning deltas against it — the same reasoning §12 states
  for its own fixture. Adds the D3 coverage (present drops the refused arrival, gross `added` does
  not).

**Suites, as actually run on the full merged migration set after `supabase db reset`:**
pgTAP **54 files / 1069 tests PASS**; `pnpm vitest run` **109 files / 1116 passed**;
`tsc --noEmit` clean; `eslint` clean on the touched paths (`next lint` cannot run in this
worktree — its `node_modules` is missing `next` after a contended install; the CI `lint-and-test`
gate covers it). `database.types.ts` needs no regeneration: every rewritten function keeps its
signature and return type.

**Still open, unchanged by this round:** `supabase/tests/database/tiers.vat.test.sql` plans 15
tests and runs 2 while pg_prove still reports the file as `ok`, so 13 assertions are absent from
the green light and the headline totals above are that much less trustworthy. Reproduced in
isolation, unrelated to these migrations, filed separately.

---

## 2026-08-11 — Door search + po shell re-render scope, third review pass (86ey9e9vc, PR #261)

Branch `perf/86ey9e9vc-render-scope-memo`, still not merged. A THIRD max-effort
fresh-session `/code-review` on the same PR — the round-2 rework (DoorToastContext
split, T6 auto-open re-check, useIsDesktop/innerWidth fallback, `notifyOnChangeProps`
audit trail) was found correct in its OWN claims (every red-on-revert claim from that
pass was independently re-verified and held), but the round-2 fix for finding 15
(moving the stable-empty-array fallback into `usePoEvents`/`usePoDoorCandidates`)
introduced **2 new blockers** and surfaced **4 more findings** in the process. Full
detail below; summary in the PR body. Milestone: Now (a genuinely broken desktop
feature + a re-render-scope regression, both introduced by the previous "fix").

- **Blocker 1 — the `{ ...query, ... }` spread defeated React Query's tracked-properties
  optimization.** `usePoEvents()`/`usePoDoorCandidates()` spread the FULL `UseQueryResult`
  object to attach the stable-empty-array `data` fallback. Spreading reads every one of
  ~26 properties on the object, which (per `@tanstack/react-query@5.101.0`'s
  `trackResult` Proxy) subscribes every consumer to every property — so a plain
  `invalidateQueries`/refetch re-rendered every consumer even when `data` itself hadn't
  changed, reintroducing the EXACT class of bug this whole PR chain exists to fix, now
  at the shared-hooks level (~17 call sites). Fixed with an explicit
  `notifyOnChangeProps` allowlist on both `useQuery()` calls, chosen only after a
  dedicated audit of every real call site's actual property reads (`data`/`isLoading`/
  `isError`/`isFetching`/`error`/`isSuccess` — small, stable, no dynamic access anywhere)
  confirmed the list would be complete. **Verified with a real render-count probe**
  (mounts the actual `usePoEvents()` against a real `QueryClient`, forces a refetch that
  leaves `data` structurally unchanged): before the fix, a `data`-only consumer picked
  up **+1 extra render** per refetch; after, **0 extra**. Re-verified failing by
  temporarily removing the allowlist and watching the probe go red, same as it did
  before the fix existed.
- **Blocker 2 — the T6 desktop auto-open effect (decided 1/7) silently stopped firing.**
  `app.tsx`'s one-shot "open the cockpit automatically if there's exactly one live
  event" effect guarded on `if (!doorCandidatesQuery.data) return;` — since `.data` is
  never `undefined` anymore (the very fallback this PR's own finding 15 added), that
  guard could never fire. It consumed its one-shot sessionStorage flag on the FIRST
  render (candidates still loading, `data` already `[]`, `autoOpenDoorEvent([], …)`
  finds nothing), before the real candidate list ever arrived — the desktop auto-open
  never worked again. Also directly contradicted this changelog's own round-1 entry,
  which claimed the empty-array audit had found no call site relying on `data`'s
  undefined-ness — it had, this was the exact counterexample. Fixed: gate on
  `doorCandidatesQuery.isSuccess` explicitly instead (not `isLoading` — a *disabled*
  query, e.g. `venueId` not yet resolved, also reads `isLoading: false`, same trap).
  Required adding `isSuccess` to `usePoDoorCandidates`'s `notifyOnChangeProps` list too
  (Blocker 1's fix), since app.tsx now reads it and an unlisted property can silently
  stop notifying. **New regression test** (`app.auto-open.test.tsx`, none existed
  before) — mounts the REAL `PlusOneApp` with its data/routing dependencies mocked (no
  existing test does this; the shell's hook surface required pinning ~10 module mocks
  to the minimum this one effect's guard logic needs), drives `usePoDoorCandidates`
  through a `useSyncExternalStore`-backed mock so flipping its result actually
  re-renders the shell, and asserts (a) the one-shot flag is NOT consumed while
  candidates are loading and (b) the auto-open genuinely fires once they resolve with
  one eligible event. Verified red on both assertions by restoring the old guard.
- **Finding 3 — the structural element-identity-bailout guard had a false-green hole.**
  `door-tab-element-identity-bailout.test.ts`'s `DoorQueryProvider` check
  (`/>\s*\{children\}\s*</`) anchors to ANY element's closing bracket, not specifically
  `PersistQueryClientProvider`'s — `<Suspense>{children}</Suspense>` injected right
  there still has a `>` immediately before `{children}`, so the check couldn't tell
  "wrapped in Suspense" (the exact route-root mutation CLAUDE.md bans) from "not
  wrapped at all". Separately, the guard only checked the INNERMOST
  `DoorToastContext.Provider` forwards `children` — `DoorSyncContext.Provider`/
  `DoorFiltersContext.Provider` could each wrap it in something else without failing
  anything. Fixed both: the `DoorProvider` check now matches the WHOLE 4-layer nesting
  chain in one pattern (an extra element inserted at ANY layer breaks the match — tested
  by hand, injecting a wrapper `<div>` mid-chain). The `DoorQueryProvider` check now
  uses `(?:[^>]|=>)*` to skip `PersistQueryClientProvider`'s own multi-line props
  (which contain `=>` arrow functions a naive `[^>]*` would stop at) while still
  requiring `{children}` immediately after its real closing `>` — verified this exact
  fix catches the reviewer's own `<Suspense fallback={<Spinner/>}>` reproduction by
  hand. Noted honestly in the test's own comment: a wrapper whose OWN opening tag
  contains no embedded `>` at all (unlike the demonstrated `<Spinner/>` case) could
  still slip past a regex-based check — real nested-tag matching isn't possible without
  a parser, and that residual gap is accepted, not undetected-by-oversight.
- **Finding 4 — two comments overstated what the toast-context split (round 2, Blocker 1
  of the SECOND pass) actually bought.** They claimed narrowing `PoDoorTab` to
  `useDoorToast()` "is what makes the element memo's bailout real" — it narrows the
  re-render frequency, it does not eliminate the residual: `toast` itself changes twice
  per local mutation (set, then `useTransientValue`'s ~2.6s clear), so `PoDoorTab` still
  re-renders on a check-in, just less. Also, `DoorProvider.test.tsx`'s own rationale
  comment misattributed that residual to the `syncing` flip during a flush. **Added a
  third probe to the existing render-scope test** (`useDoorSyncStatus()` alone, no
  toast) to actually isolate this instead of asserting it in prose: measured
  `oldExtra=2, newExtra=1, syncOnlyExtra=0` — the residual is `toast` changing, NOT
  `syncing`. Comments in `DoorProvider.tsx` and the test itself corrected to match; the
  test now asserts `syncOnlyExtra === 0` directly instead of only logging it.
- **Finding 5 — `usePoEvent`'s `notFound` had the SAME undefined-ness trap as Blocker 2.**
  Round 1 dropped a `!!data` check with a comment claiming `!isLoading` alone covered
  it post-fallback; it doesn't, for the identical reason — a *disabled* query
  (`venueId` not yet resolved) also has `isLoading: false`, so `notFound` read `true`
  whenever the query had simply never run, not just when it ran and the id was
  genuinely absent. No visible break today (both consumers OR it with `!event`, which
  stays `null` either way in that window) but the exported CONTRACT silently inverted.
  Fixed: gate on the query's own `isSuccess` (added to `usePoEvents`'s
  `notifyOnChangeProps` for the same reason as Blocker 2). **New test**
  (`hooks.usePoEvent.test.tsx`, none existed before) covers all three states
  (disabled/not-found/found); verified the disabled-query case red on reverting to
  `!isLoading`.
- **Finding 6 — the round-1 fix for the round-1 flake (3c) had its own, narrower flake
  window.** `waitForQuiescence`'s two-consecutive-equal-reads check, at `waitFor`'s
  default 50ms poll interval, only needed an async completion to land outside both of
  two ~50ms windows to be missed — captured too early, the same false-baseline failure
  mode 3c was fixing, just less likely to trigger. Tightened to a 5ms interval and
  THREE consecutive equal reads. Re-verified against the exact reproduction that
  originally caught 3c (a 10ms delay on the mocked `getUser`) — 5/5 clean runs, where
  the two-read/50ms version had failed under the same delay.
- Tests: `pnpm run type-check` clean, `pnpm run lint` clean (only the pre-existing
  unrelated `datetime-field.tsx` a11y warnings), `pnpm vitest run` — 113 files / 1136
  tests passing, 0 regressions (added: 2 in `app.auto-open.test.tsx`, 3 in
  `hooks.usePoEvent.test.tsx`, 1 new assertion + probe in the existing
  `DoorProvider.test.tsx` toast-split test). Every new/changed check in this pass
  verified red-on-revert by hand, including a real before/after render-count
  measurement for Blocker 1 (not just a type-level argument that `notifyOnChangeProps`
  should work).
- Left for Max: this round's fixes are a comment-and-guard pass PLUS two genuine
  behavioral bugfixes (Blockers 1/2) touching the shared `po` data-fetch hooks and the
  desktop shell — narrower in blast radius than round 2's new context, but still
  behavioral. Given that, another fresh-session `/code-review` before merge, same as
  every prior round (`DoorProvider.tsx` stays a listed high-risk surface).

## 2026-08-11 — Door search + po shell re-render scope, second review pass (86ey9e9vc, PR #261)

Branch `perf/86ey9e9vc-render-scope-memo`, still not merged. A SECOND max-effort
fresh-session `/code-review` on the same PR (following the first review pass
documented below) returned 15 findings, the two most severe of which meant the
PR's headline fix (#45) did not actually work and its own regression test could
not fail. Both fixed. Milestone: Now (door render-scope + a security-shaped
render-scope test file that asserted nothing).

- **Severity-1: the door-tab element memo alone cannot deliver its claimed win.**
  `PoDoorTab` (`screens/door.tsx`) calls `useDoor()` directly at the top of its own
  render body — a React context-value change forces a re-render REGARDLESS of how
  stable the element/props handed down from `app.tsx` are; memoizing `<PoDoorTab>`
  bails a component out of a props-driven re-render from its parent, never out of
  its own context subscription. The broad `DoorContext` value changes on every
  check-in (`view`/`pendingCount`/`outboxByGuest`) and every realtime patch from
  ANY doorhost's device; `toast` was PoDoorTab's only reason to read it. **Scope
  decision: Option A** (of the two the review offered) — split `toast` into its
  own `DoorToastContext` (`DoorProvider.tsx`), the same one-line pattern already
  used twice in this file for `sync`/`listFilters`. `PoDoorTab` now reads
  `useDoorSyncStatus()` + `useDoorToast()` only, so the element memo's bailout is
  real for it. This is DoorProvider's fourth split-off context — flagged, not
  reduced further, in this pass; `screens/door.tsx`'s standalone `/door/[eventId]`
  route (`DoorRoute.tsx`) mounts the same `PoDoorTab` and benefits equally, even
  though that route wasn't part of this PR's stated scope.
- **Severity-1: the regression test guarded nothing.** `door-tab-render-scope.test.tsx`
  (added in the first review pass) never imported `app.tsx` — it re-implemented the
  wiring in a local test harness and asserted React's built-in element-identity
  bailout in the abstract. Verified by reverting `app.tsx`'s actual memo and
  restoring the inline `<PoDoorTab>`: the test stayed at 2/2 passed. **The previous
  changelog entry's and PR body's claims that this test was "verified red by
  reverting the fix" were false** — that verification was done against the
  harness's own inline `useMemo`, not the shipped code. Deleted the file. Replaced
  with two real checks: `tests/unit/door-tab-element-identity-bailout.test.ts`
  (source-level structural guard — `app.tsx` builds the element via `useMemo` and
  hands `<DoorProvider>` a bare identifier, and `DoorProvider`/`DoorQueryProvider`
  forward `children` unmodified) and a genuine runtime test added to
  `DoorProvider.test.tsx` (a `useDoorSyncStatus`+`useDoor()` probe vs. a
  `useDoorSyncStatus`+`useDoorToast()` probe, both against a REAL `checkIn()` call
  through the real provider — the old shape re-renders strictly more than the new
  one). Both verified red-on-revert by hand, not assumed.
- **Real defects from the first pass, fixed:**
  - `use-viewport.ts`: the `matchMedia` guard had no fallback for a webview that
    has `matchMedia` but not `MediaQueryList.addEventListener` (iOS 12-13 —
    `useIsDesktop`, `datetime-field.tsx`, already handles this; the guard comment
    claimed parity it didn't have). Added the legacy `addListener`/`removeListener`
    fallback. Also: when `matchMedia` is genuinely absent, `isMobile` used to freeze
    at the server's UA guess forever instead of correcting — added a
    `window.innerWidth` fallback (same 1023px breakpoint), so an iPadOS device
    reporting `Macintosh` (`src/lib/ua.ts`) still lands on the right shell.
  - `app.tsx`'s `nav` memo depended on the whole `doorState` object but only ever
    reads `doorState.overlay` — every Deur↔Taken toggle and event switch (which
    change `doorState` without touching `overlay`) was rebuilding `nav` → `po` →
    every `usePo()`/`useNav()` context value, defeating the memo's own stated
    payoff on exactly the surface it targets. Narrowed to the member expression.
  - `EMPTY_EVENTS`/`EMPTY_DOOR_CANDIDATES` in `app.tsx` fixed nothing real:
    `events` is read by one imperative helper, never a dependency array, and the
    stale-door-refetch effect it was credited with protecting has no cleanup to
    tear down and was already capped at one refetch per id
    (`staleDoorRefetchRef`). Real fix, done properly this time: moved the stable
    fallback into the SOURCE — `usePoEvents()`/`usePoDoorCandidates()`
    (`src/features/po/hooks.ts`) now return `.data` as a stable empty array
    instead of `undefined` while loading/disabled, `isLoading`/`isFetching`/etc.
    untouched. That fixes all ~16 call sites across the app at once (confirmed via
    a dedicated audit that none of them distinguish "not loaded" from "loaded,
    zero results" via `data`'s undefined-ness rather than `isLoading` — one
    exception, `usePoEvent`'s `notFound` clause, whose now-redundant `!!data`
    check was cleaned up in the same pass since its semantics would otherwise have
    silently inverted). `app.tsx`'s local `EMPTY_*` constants and the `PoEvent`/
    `PoDoorEvent` type imports they required are gone.
  - Comments in `app.tsx`/`DoorProvider.tsx` that pinned a one-time `grep` result
    into source (e.g. "the only `React.memo` component…") were deleted outright —
    they go silently false on the next unrelated edit. Several verbose
    deliberation comments trimmed, with the durable "why" kept and the
    archaeology pointed at this changelog instead (`app.tsx` 1011 → 972 lines).
- **Test-quality fixes (review findings 3a–3d), each verified by breaking the
  underlying code and watching the specific assertion fail:**
  - `use-viewport.test.ts`'s "removes both listeners" test only asserted the
    `change`-listener side — deleting the `resize` cleanup line left it green.
    Now spies on `removeEventListener` and asserts the `resize` pair too.
  - No test pinned the actual breakpoint value — `MOBILE_QUERY` could drift to
    767px or an invalid unit and every test stayed green. Added an assertion on
    the exact `matchMedia` call argument.
  - `DoorProvider.test.tsx`'s render-scope test captured its "after mount"
    baseline after a single microtask flush, coupling an exact render-count
    assertion to how many hops the mocked `getUser()` happens to take (`meId` is
    a dep of six DoorContext callbacks) — reproduced by adding a 10ms delay to
    the mock. Replaced the single flush with a poll-until-quiescent wait.
  - A `vi.spyOn` in `use-viewport.test.ts` was restored as the last line of its
    own test body, leaking an instrumented `window.addEventListener` into later
    tests on any assertion failure above it. Moved to a global `afterEach`.
- **Two pre-existing bugs found in touched functions, confirmed but explicitly
  NOT fixed here (out of this PR's scope)** — flagged as background-session task
  chips instead of ClickUp tasks, since ClickUp's MCP was still workspace-wide
  rate-limited when this session ran (see the entry below):
  1. `app.tsx`'s implicit single-door-candidate pick is never written back to the
     URL/override, so a wifi-reconnect refetch (`refetchOnReconnect` defaults
     `true`, never overridden in `PoLiveProvider.tsx`) that returns a second live
     event can unmount the doorhost's active `DoorProvider` mid-shift, bouncing
     them to an event picker with no explanation.
  2. `switchToVenue` reloads to `/app` unconditionally even when the server-side
     switch was silently rejected (`persistActiveVenue` returns `false` without
     throwing on no-session/invalid/non-member; `setActiveVenueAction` discards
     the boolean) — the user lands back on their old venue with zero error shown.
- **Judgement calls raised, not absorbed:** whether `app.tsx`'s door branch should
  be extracted into its own component (so the re-render becomes structurally
  unreachable instead of defensively bailed) is a bigger, differently-scoped
  change — not done here, left for a future task if Max wants it. A shared
  `createRequiredContext` helper (this file now hand-rolls the same
  create-context/use-context/throw-if-missing triple four times) and a shared
  `useMediaQuery`/`matchMediaSafe` primitive (the guard added to `use-viewport.ts`
  is now a third copy of the pattern `src/lib/platform.ts` already owns) are
  reuse opportunities flagged for later, not built.
- Tests: `pnpm run type-check` clean, `pnpm run lint` clean (only the pre-existing
  `datetime-field.tsx` a11y warnings), `pnpm vitest run` — 110 files / 1120 tests
  passing, 0 regressions. Every new/changed test in this pass was verified to
  actually go red when the fix it covers was reverted by hand — the specific
  thing the previous pass got wrong.
- Left for Max: this needs ANOTHER fresh-session `/code-review` on the corrected
  diff before merge (DoorProvider.tsx stays a listed high-risk surface, now with
  a fourth split-off context) — not self-approved. ClickUp still unreachable
  (rate-limited) at session end; status/comment given to Max as text to paste.

---

## 2026-08-11 — Dead-code sweep (86ey9e9xx) + countryFromE164 dedup check (86ey9ea3e, partial)

Branch `chore/86ey9e9xx-dead-code-sweep`. Milestone: Now (codebase hygiene, no behavior
change). Every removal was grep-verified for zero call-sites before deletion, per the
task's hard requirement (a past sweep claim was inaccurate once).

- **Removed, all confirmed zero importers repo-wide:**
  - `src/features/guests/components/{QuickAddField,BulkPasteDialog,GuestEditForm}.tsx`
    (659 LOC) — superseded, no importers anywhere.
  - `usePoChangeStatus` (`src/features/po/mutations.ts`) + server action
    `changeEventStatus`/`changeStatusSchema` (`src/features/events/{actions,schemas}.ts`)
    — the vestigial event-status machine; `usePoSetCancelled`/`setEventCancelled`
    replaced it (24 jun 2026, #22). No parallel session had touched it (`gh pr list`
    for 86ey9e9gn/86ey9e9rz came back empty) — clean removal, no coordination needed.
    Also dropped the now-orphaned `eventStatus`/`EVENT_STATUSES` import in schemas.ts.
  - `usePoDoorEvent` (`src/features/po/hooks.ts`) + its dedicated test
    `hooks.doorEvent.test.tsx` — zero production call sites; `usePoHomeEvents` is the
    only live caller of the underlying `pickDoorEvent` pure function, which stays
    (and stays tested via `door-event.test.ts`, comment updated to stop pointing at
    the now-removed hook). Also dropped the orphaned `poKeys.doorEvent` key.
  - `usePoVoidCheckIn` (`src/features/po/mutations.ts`) — superseded by `usePoCheckOut`
    (full/partial checkout, S1.2), which calls the same gateway method directly. No
    open PR on 86ey9e9rz to coordinate with.
  - `src/features/contacts/queries.ts` — zero importers anywhere in the repo.
  - `src/features/stats/components/{TierChart,InflowChart}.tsx` + the `recharts`
    dependency (package.json + 307-line lockfile trim) — the event-day cockpit moved
    to CSS bars (`EventDaySkeleton.tsx`'s own comment confirms: "no recharts, cockpit
    uses CSS bars"), leaving these orphaned. Note: `stats/components/{EventPicker,StatCard}.tsx`
    grep the same way — zero importers of `stats/components/EventPicker`/`StatCard`
    either (the broad "EventPicker"/"StatCard" hits elsewhere are unrelated same-named
    local symbols). Not named in this task, so left alone rather than scope-creeping;
    flagged as a follow-up task instead.
- **86ey9ea3e (countryFromE164 dedup) — already moot, no code change.** Grepped for
  `countryFromE164` repo-wide: zero matches. It was already consolidated into
  `phoneCountryOf` (`src/components/po/phone-lazy.tsx`) during the First-Load-JS trim
  (PR #236) — both `profile-sheets.tsx` and `settings/profile.tsx` already import the
  shared helper. The LOC-split of approvals/home named in that task is explicitly
  **not** done here per the task instructions — left open, noted in the ClickUp
  comment once the workspace-wide rate limit clears.
- **"Overweeg" tooling ask (no-unused-vars→error / dead-export lint)** — not
  implemented. `@typescript-eslint/no-unused-vars` only catches unused *local*
  imports/vars, not unused *exports* (the actual shape of every item removed here);
  catching that needs a different tool (`knip`/`ts-prune`/`eslint-plugin-import`
  no-unused-modules) — new devDependency, likely surfaces unrelated findings
  workspace-wide. Flagged as a follow-up decision for Max rather than adding
  unreviewed tooling in a cleanup PR.
- **Gates:** `pnpm lint` clean (2 pre-existing unrelated a11y warnings in
  `datetime-field.tsx`), `npx tsc --noEmit` clean, `pnpm vitest run` 865/865 green,
  `pnpm build` succeeds. Not a UI change — no test handoff.
- **Environment gotcha (not code-related):** the first `pnpm install` after editing
  package.json hung for 40+ minutes under heavy concurrent-session load (dozens of
  node processes, sub-2GB free RAM) and, once killed, left `node_modules` **empty**
  and a corrupted partial-extraction dir in `node_modules/.pnpm`. Recovered via
  `rm -rf` on the corrupted package dir + a clean `pnpm install` once system load
  eased. `pnpm build` similarly OOM-crashed twice (Windows exit code 3221226505)
  under the same load before succeeding cleanly. No lasting damage, but worth knowing
  if a future session's `pnpm install`/`pnpm build` seems to hang for an unusually
  long time — check `Get-Process node | Measure-Object` / free memory before assuming
  the command itself is broken.
- **ClickUp:** MCP was workspace-wide rate-limited (~59 min) exactly when this session
  tried to pick up both tasks — same recurring issue as [[clickup-86ey9e9r9-sync-pending]].
  Status/comments deferred to the point where the limit clears; this changelog entry
  and the PR are the source of truth for what actually happened in the meantime.

---

## 2026-08-11 — Auth/redirect bundel: fresh-session security-review fixes (86ey9ea00, PR #243)

Follow-up op de 2026-08-10-entry hieronder, zelfde branch/PR, nog steeds niet gemerged.
Een verse `/security-review`-sessie op PR #243 leverde een schoon verdict op (geen
HIGH/MEDIUM-bevindingen die deze PR introduceert) maar wél 2 blokkerende + 1
aanbevolen fix, waarvan er één zelf pas een tweede, verkeerde poging kreeg tijdens het
oplossen:

- **`/api/health` zou permanent 503 zijn gebleven — tweede keer raak.** Mijn eerste
  poging (2026-08-10-entry) verving `venues` door `events`, gebaseerd op alleen
  `20260613000000_full_schema.sql`'s `grant select on table public.events to anon`.
  Fout: `20260707170000_p0_security_hotfixes.sql` (C3) trekt die grant later weer in
  (`events_select_landing` liet anon elk tenant's actieve events oplijsten — nu via
  de `SECURITY DEFINER get_landing_event`-RPC). **Dit is precies de fout die
  [[feedback-verify-schema-against-full-migration-history]] beschrijft** — ik had 'm
  zelf moeten voorkomen. Uiteindelijke, empirisch geverifieerde fix (rechtstreeks
  tegen de lokale stack met de echte lokale anon-JWT via `supabase status`):
  `request_links` — anon heeft daar een echte tabel-grant
  (`20260706103000_submit_via_request_link.sql`) mét een RLS-policy die `anon`
  helemaal niet noemt (`request_links_select`, alleen `to authenticated`) — dus de
  query 42501't nooit, en levert altijd 0 rijen. `venues` en `events` gaven beide
  bevestigd 42501 in de live curl-test; `request_links` gaf 200 met 0 rijen. Nieuwe
  `tests/e2e/api-health.spec.ts` (toegevoegd aan `e2e:smoke`) hit de échte lokale
  stack — de gemockte `route.test.ts` kán een ACL/RLS-fout structureel niet vangen,
  dus daar staat nu alleen een regressie-guard op de tabelnaam.
- **`isUnknownAccountOtpError`'s `code`-check was dode code, en de match was te
  breed.** GoTrue's echte `error_code` is `otp_disabled`, niet `signup_disabled` —
  bevestigd met een rechtstreekse curl tegen de lokale GoTrue-instance. Erger:
  dezelfde foutvorm (`otp_disabled` / "Signups not allowed for otp") komt ook terug
  voor een uitgenodigd-maar-nooit-geaccepteerd account (zie `invite-mail.ts`'s
  `sendInviteEmail`-comment) — zo iemand kreeg nu een nep "we hebben een code
  gestuurd"-scherm zonder dat er ooit een code verstuurd is, zonder enig vervolgpad.
  Fix: matcher checkt nu `otp_disabled` (primair) én `signup_disabled` (defensief);
  `OtpLoginForm`'s code-stap toont nu onvoorwaardelijk een "geen code ontvangen?
  vraag een admin je uitnodiging opnieuw te sturen"-hint (altijd zichtbaar, dus
  verraadt zelf niets).
- **#53-claim afgezwakt.** Zie de nuance hieronder in de 2026-08-10-entry — dit dicht
  het login-orakel op UI-niveau, niet het onderliggende `POST /auth/v1/otp`-endpoint.

**Los hiervan, buiten deze PR ontdekt tijdens het verifiëren:** het `.env.local` in de
hoofdcheckout (prod-pointing) had `NEXT_PUBLIC_SUPABASE_ANON_KEY` gevuld met een
`sb_secret_...`-waarde (service-role-equivalent) in plaats van de correcte
`sb_publishable_...`-waarde die er al naast stond. Nooit gecommit (gitignored, geen
git-historie). **Vercel's Production-waarde voor dezelfde variabele is bij het schrijven
van dit verslag nog NIET geverifieerd** — een poging om 'm via `vercel env pull` in te
zien werd automatisch geblokkeerd door de auto-mode-classifier (bulk-secret-download),
dus dit staat nog open. Max roteert de lokale secret-key, corrigeert het lokale bestand,
en checkt de Vercel-waarde zelf.

**Tests:** vitest-suite opnieuw groen inclusief de uitgebreide/nieuwe testcases hierboven;
`e2e:smoke` uitgebreid met `api-health.spec.ts`. Volledige testresultaten: sessieverslag/PR.

---

## 2026-08-10 — Auth/redirect kleine fixes — bundel review (86ey9ea00)

Branch `fix/86ey9ea00-auth-redirect-small-fixes` (PR [#243](https://github.com/Max-Seffelaar/PlusOne/pull/243)). Bundel van 1 CONFIRMED
finding + 4 finder-punten uit een eerdere review-pass, elk kort her-geverifieerd tegen
de huidige code vóór de fix. Milestone: Now (auth/middleware correctness + een echte
account-enumeratie-lek). High-risk surface (auth/middleware) — PR niet zelf gemerged,
zie de security-research prompt in de PR-body.

- **#56 (bevestigd dood pad).** `/settings/profile` bestaat niet (`src/app`
  heeft geen `settings/`-map) — de live profielscreen is `/app/profile`
  (`src/components/po/routes.ts`). `auth/confirm/route.ts`'s e-mailwijziging-fallback,
  en de no-op `revalidatePath('/settings/profile')` in `profile-actions.ts` en
  `session-actions.ts`, wezen alle drie naar het dode pad — een bevestigde
  e-mailwijziging landde via de `/app`-catch-all-guard stil op de home-tab in plaats
  van het profiel. Alle drie nu naar `/app/profile`; `entry-redirect.ts`'s comment
  ook gecorrigeerd. *(Zelfde bug-klasse gevonden maar buiten scope gelaten:
  `revalidatePath('/admin/team')` en `/admin/sessions')` in `invite-actions.ts` /
  `session-actions.ts` wijzen ook naar niet-bestaande paden — live routes zijn
  `/app/team` en `/app/sessions`. Los als eigen taak.)*
- **#57 (middleware dropt `?next=`).** De authed-op-`/login`-redirect zette
  `url.search = ''` onvoorwaardelijk, dus een deep-link als
  `/login?next=/app/profile` (stale tab, of een oude sessie die alsnog authed
  blijkt) viel altijd terug op kaal `/app`. Nu respecteert `/login` (niet de
  marketing-root `/`) `?next=` via `safeNextPath` — dezelfde open-redirect-guard
  die de anonieme kant al gebruikt.
- **#53 (login-orakel/account-enumeratie) — UI-niveau fix, geen volledige sluiting.**
  `signInWithOtp({ shouldCreateUser: false })` op een niet-uitgenodigd adres gaf een
  fout die `OtpLoginForm` zichtbaar anders afhandelde ("dit account bestaat niet...",
  blijft op e-mail-stap) dan het "we hebben een code gestuurd"-succespad voor een
  bekend adres — de aanwezigheid van dat verschil ZELF is het lek, los van de teksten.
  Fix: nieuwe `isUnknownAccountOtpError` in `errors.ts`; `OtpLoginForm` behandelt die
  fout nu identiek aan succes (zelfde stap-overgang, zelfde bericht). Echte fouten
  (rate-limit, netwerk) blijven gewoon zichtbaar. **Belangrijke nuance (fresh-session
  /security-review op PR #243):** dit dicht alleen de UI-respons. Het onderliggende
  `POST /auth/v1/otp`-endpoint blijft rechtstreeks aanroepbaar (publieke anon-key,
  altijd al zo) en verraadt via zijn eigen response nog steeds of een adres bestaat —
  dat is GoTrue-platformgedrag, niet iets wat deze PR kan dichten zonder een
  server-side proxy + rate-limiting (buiten scope, apart af te wegen). Geaccepteerd
  restrisico voor een invite-only B2B-tool.
- **#54 (invite-actions volgorde).** `inviteUserAction` provisionede het auth-account
  + verstuurde de uitnodigingsmail vóórdat de RLS-geverifieerde `invites`-insert
  liep. Bij een denial of een duplicate-invite-conflict (23505) bleef een levend
  auth-account + verstuurde mail achter zonder invite-rij om 'm te verzilveren.
  Omgedraaid: insert eerst, provisioning/mail pas na succes. `sendInviteEmail` is
  idempotent (zelfde patroon als `resendInviteAction`), dus een latere
  provisioning-fout is herstelbaar via resend.
- **#55 (health-endpoint met service-role).** `/api/health` is publiek,
  middleware-exempt en zonder rate-limit, maar gebruikte de service-role-client —
  onnodig, want een `head+count`-query op `venues` bewijst de Postgres-roundtrip
  ook met de anon-key (RLS filtert dan gewoon naar 0 rijen, geen fout). Nieuwe
  `src/lib/supabase/health-client.ts` (anon-key, geen cookies-afhankelijkheid);
  route + test omgezet.

**Tests toegevoegd:** `src/middleware.test.ts` (8 tests — next-param behoud, open-redirect-
guard, marketing-root ongemoeid, bestaand anon-gedrag onveranderd), uitbreiding van
`errors.test.ts` (`isUnknownAccountOtpError`), nieuw `OtpLoginForm.test.tsx` (3 tests —
bekend/onbekend e-mail geven identieke UI, echte rate-limit blijft zichtbaar), nieuw
`invite-actions.test.ts` (3 tests — insert-vóór-mail volgorde, geen mail bij denial/conflict),
`health/route.test.ts` aangepast op de nieuwe client. **Vitest 840/844 groen** (4 falen +
6 suites falen op ontbrekende `node_modules` — `stripe`, `@tanstack/react-virtual`,
`fake-indexeddb`, `@sentry/nextjs` — een pre-existing worktree-install-gat, bevestigd
losstaand van deze wijzigingen: geen van de 5 punten raakt die packages, en `next lint`
faalt om dezelfde reden (`@sentry/nextjs` ontbreekt in `next.config.js`'s require-pad).
Gerichte `eslint` op alle aangepaste bestanden: schoon. `tsc --noEmit`: zie sessieverslag/PR.
`pnpm install` in deze worktree draaien is aanbevolen vóór de volgende sessie die hier lint/build nodig heeft.

---

## 2026-08-11 — Door search + po shell re-render scope, review-corrected (86ey9e9vc)

Branch `perf/86ey9e9vc-render-scope-memo`, [PR #261](https://github.com/Max-Seffelaar/PlusOne/pull/261).
Two findings from the perf-scale audit (#44/#45), re-verified against `main` (PR #225
had already split `sync` off `DoorProvider` but left `listFilters` bundled) and then
corrected by a fresh-session `/code-review`. Milestone: Now (door-search feel + a
`react-hooks/exhaustive-deps` lint-silencer on the sole source of truth for nav).

- **#44 — door search re-rendered the whole door tree.** `listFilters`/`setListFilters`
  lived in `DoorContext`'s broad `value` memo, so every keystroke changed `value`'s
  identity and re-rendered every `useDoor()` consumer before the 140ms debounce even
  ran. Split into a new `DoorFiltersContext` (`useDoorFilters()`,
  `src/features/door/DoorProvider.tsx`); `CheckInList` is the only real consumer
  (confirmed via grep — **not** Taken/GuestDetail/AddOnSpot, which the first version of
  this fix's own comment wrongly listed: `screens/door.tsx`'s `screen` is a single
  if/else-if chain, so those three are unmounted whenever the search field exists).
  State stays in the provider — checking a guest in pushes a detail screen and the pop
  remounts the list, so provider state is what keeps "Onderweg" selected across that
  remount (feedback Joeri 1/7). This is why `#225` left it bundled and it survived:
  nothing encoded the invariant. Fixed with a real regression test —
  `DoorProvider.test.tsx` now has two SEPARATE probe components (one per context, not
  one calling both hooks) proving `setListFilters` re-renders the filters consumer but
  not a `useDoor()`-only one; verified it actually fails by temporarily re-adding
  `listFilters` to the broad `value` memo's deps and confirming red, then reverting.
- **#45, first pass — resize debounce.** The first version of this PR debounced
  `useViewport`'s `resize` listener by 120ms. **Review reverted this** — it saved zero
  renders and regressed the one path it mattered on. `setIsMobile(mql.matches)`
  already gets React's eager-state bailout on a non-crossing frame (no unchanged-value
  setState schedules work), and on an actual crossing frame the (necessarily
  un-debounced) `matchMedia` `change` listener fires in the same task per the HTML
  "update the rendering" steps — so a 1s edge-drag across the breakpoint cost 1 render
  before the debounce and 1 render after it. Meanwhile `resize` exists specifically
  because DevTools device-mode and some webviews reflow WITHOUT firing `change` — on
  that path (the Capacitor wrap target, #37) `resize` is the ONLY signal, and the
  debounce's `clearTimeout`-on-every-event meant `update()` never ran during a
  continuous reflow, lagging the desktop-cockpit/outbox-backed-`DoorProvider` split and
  `DoorRoute.tsx`'s hard `window.location.replace`. Reverted to a plain listener; added
  the `typeof window.matchMedia !== 'function'` guard the sibling call sites
  (`platform.ts`, `datetime-field.tsx`) already carry, since the previous version was
  unguarded and consequently untestable — `use-viewport.test.ts` is new (5 cases:
  serverHint seed + correction, `change` listener, `resize` fallback, listener
  cleanup on unmount, no-`matchMedia` guard).
- **#45, completed — the door subtree's own bailout.** The PR's actual stated goal for
  app.tsx stopped one step short: `<PoDoorTab>` was constructed inline inside
  `<DoorProvider>`, so `children` was a NEW object every `PlusOneApp` render and
  React's element-identity bailout could never fire — PoDoorTab, SyncBar and the
  virtualized CheckInList all re-rendered regardless of the DoorContext splits, since
  the re-render arrived structurally from above, not through context. Fixed by
  `useCallback`-wrapping `pushDoorState`/`replaceDoorState`/`openGuest`/`openAdd`/
  `closeOverlay`/`onDoorTab`/`onChangeDoorEvent` and wrapping the `<PoDoorTab>` element
  itself in `useMemo` (`app.tsx`); `DoorProvider`/`DoorQueryProvider` just forward
  `children` unmodified, so a stable element reference there is what lets React reuse
  the whole subtree. New test: `screens/door-tab-render-scope.test.tsx` — mounts the
  real `PoDoorTab` (dependencies mocked) through a non-memoized pass-through mirroring
  `DoorProvider`'s shape, proves an unrelated ancestor re-render doesn't re-invoke it
  (counts `useDoor()` calls, which happen unconditionally at the top of `PoDoorTab`,
  as a render-count proxy) but a real prop change (the overlay opening) does; verified
  by temporarily removing the `useMemo` and confirming the assertion goes red.
- **Correctness/cleanup from the same review pass**, none behavior-changing: dropped an
  `eslint-disable-next-line react-hooks/exhaustive-deps` on the `target` memo (rebuilt
  the `URLSearchParams` from the already-tracked string instead of depending on the
  live `searchParams` object — `parseAppUrl` only ever calls `.get(...)` on it); gave
  `liveEvents ?? []` / `doorCandidatesQuery.data ?? []` stable module-level `EMPTY_*`
  fallbacks (a fresh `[]` per render was a dep of the stale-door-refetch effect, tearing
  it down and re-running it on every render for as long as the query stayed unresolved
  — same idiom as `EventDayCockpit`'s `EMPTY_GUESTS`/`EMPTY_TIERS`); removed
  `switchToVenue`'s `venueId === activeVenueId` → `nav.back()` branch, unreachable from
  the UI (`settings/venue.tsx` only wires the switch button in the `!cur` branch) and
  contradicting its own doc comment ("a no-op for the already-active venue") — this is
  dead-code/doc-drift cleanup only, not a perf win, since `nav` was already a `po` memo
  dep regardless; and corrected three comment blocks (`app.tsx` ×3, `DoorProvider.tsx`
  ×1) that claimed benefits the architecture doesn't deliver — through context alone
  the `target`/`nav`/`po` memos protect zero consumers today (`grep -rn "memo("` finds
  exactly one hit, `CockpitGuestList`, which reads neither hook); their real payoff is
  dep-array stability for direct consumers (`Templates`' "skip to new template" effect)
  and, after the #45 completion above, the door subtree's element-identity bailout.
- **Why `listFilters` must stay on its own narrow context, not fold back into
  `DoorContext`:** the state itself has to live in `DoorProvider` (guest-detail
  push/pop must not reset it), but nothing else in the tree needs it — every keystroke
  is the highest-frequency write against this provider by a wide margin (once per
  character vs. once per check-in), so bundling it with anything that has broader
  consumers (which is every other field on `DoorContextValue`) reintroduces #44 by
  construction. This is the rationale PR #225 didn't write down, which is how the bug
  survived that split; it's now load-bearing in both the `DoorFiltersContext` comment
  and the new regression test.
- Tests: `pnpm vitest run` — 107 files / 1094 passed, 0 failed (added: 2 in
  `door-tab-render-scope.test.tsx`, 5 in `use-viewport.test.ts`, 1 in
  `DoorProvider.test.tsx` — the rest of the delta vs. the pre-review-fix baseline is
  `main` growing under this branch across two rebases, not new coverage from this pass).
  `pnpm run type-check` clean. `pnpm lint` clean (only the pre-existing unrelated
  `datetime-field.tsx` a11y warnings).
- Left for Max: a fresh-session `/code-review` on the corrected diff (DoorProvider.tsx
  is a listed high-risk surface — the building session doesn't self-approve), then the
  per-screen Deur-tab test handoff, then merge.

## 2026-08-11 — Silent 0-row event/link updates + Home Lock/Edit role-gating (86ey9e9gn + 86ey9tkav)

Branch `fix/86ey9e9gn-86ey9tkav-event-write-guards-home-gating`. Two overlapping,
CONFIRMED findings tackled together: same failure class (C15 silent-success pattern),
and #2 is the visible symptom of #1 on the Home board. Milestone: Now (correctness +
a UI control that misleads a real venue-role user).

- **Root cause (86ey9e9gn).** Several state-changing server actions did
  `.update(patch).eq('id', …)` and returned `{ ok: true }` without checking how many
  rows PostgREST actually touched. When RLS filters the caller down to 0 rows (no
  access, list already in the target state, or a stale id), Postgrest returns no error
  — the action reported success while nothing changed. Fixed by adding
  `{ count: 'exact' }` to each `.update()` and returning the existing `notFound()`
  helper (`src/lib/db-errors.ts`) when `count` is falsy, mirroring the established
  `changeGuestsTierBulk`/`rotateInfluencerStatsToken` pattern:
  `changeEventStatus`, `setEventCancelled`, `setLandingActive`, `setListLock`,
  `setAutoLock`, `setEventAllowUncheck` (`src/features/events/actions.ts`) +
  `updateRequestLink`, `revokeInfluencerStatsToken` (`src/features/links/actions.ts`).
  `updateEvent` and the template CRUD actions were left alone — out of scope, not
  reported as affected.
- **Home board Lock/Edit gating (86ey9tkav).** `src/components/po/screens/home.tsx`
  passed `onEdit`/`onLock` to every `EventRow` unconditionally, so an
  ungeprivilegieerde role (e.g. a bare `user_manager`) saw a Lock button that flipped
  optimistically and — pre-fix — never got corrected, because the silent-success bug
  above meant the doomed mutation reported `ok:true`. Fixed at the root: added a
  bulk, venue-scoped `fetchOrganizerEventIds` query (`src/features/po/queries.ts`,
  mirrors `fetchOrganizesAtVenue`'s `events!inner(venue_id)` pattern — one request for
  the whole board, not N+1) threaded through `usePoHomeEvents` → `HomeEvent.canManage`
  → `toBoardEvents` → `BoardEvent.canManage` (`src/features/po/hooks.ts`,
  `src/features/po/adapters.ts`, `src/components/po/event-row.tsx`). `home.tsx` now
  passes `onEdit`/`onLock` only when `e.canManage` — same admin-OR-organizer-of-THIS-
  event rule as `usePoEventForEdit`/`edit.tsx`/`EventDayCockpit.tsx`, just role-hidden
  instead of shown-and-disabled (Home already role-hides `showNewGuest` the same way).
  With 86ey9e9gn's guard in place, even a stale `canManage` (cache race) now fails
  safely — the action returns `not_found` and the existing `onError` rollback in
  `onLock` (home.tsx) restores the optimistic flip and shows a toast.
- **Gotcha vs. the ClickUp test-handoff assumption.** The task asked for the live
  test handoff to confirm Lock "onzichtbaar voor manager@, wél werkend voor
  door@/admin@". Checked the actual RLS policy (`events_update_admin_organizer`,
  `admin OR is_event_organizer(id)`) and the seed data (`supabase/seed.sql`): the only
  seeded organizer is `organizer@plusone.test`, not `door@` — a bare doorhost has
  no lock rights by design. Implemented to match RLS/spec, not the handoff assumption;
  flagged instead of silently building either version.
- Tests: `src/features/events/actions.test.ts` (new, 18 cases) + `src/features/links/actions.test.ts`
  (new, 6 cases) — count 0/no-error → `not_found`, count 1 → unaffected success, Postgrest
  error → unaffected `mapMutationError` path, for every touched action. `src/features/po/queries.test.ts`
  gained 3 cases for `fetchOrganizerEventIds` (error passthrough, id-set mapping, skip-when-missing-args).
  `src/features/po/adapters.test.ts` fixtures updated for the new `HomeEvent.canManage` field.
  `pnpm vitest run` on the touched suites (`events/actions`, `links/actions`,
  `guests/actions`, `po/queries`, `po/adapters`): 116 passed, 0 failed. `pnpm lint` clean
  on touched files.
  `tsc --noEmit`: no new errors (pre-existing unrelated `Cannot find module` errors — this
  worktree's `node_modules` needed a fresh `pnpm install`, done this session — and one
  pre-existing `@tanstack/react-virtual` gap in `EventDayCockpit.tsx`, untouched by this PR).
- **Live-verified** (after `pnpm install` + clearing a corrupted `.next` cache — this
  sandbox's dev server crashed twice on a stale/interrupted cache before a clean start
  worked): dev-logged in as `manager@plusone.test` — Home board shows only "Open" on
  every event card, no Edit/Lock/Door/Requests. Dev-logged in as `admin@plusone.test` —
  both event cards show Edit + Lock, and clicking Lock round-tripped through the real
  local Supabase stack (button flipped "Lock list" → "Unlock list"), confirming the
  full pipeline (action → count-check → RLS → DB write → cache invalidation → UI).
  Did not verify `organizer@plusone.test` live (session got signed out by the sandbox's
  own instability — HMR loops / an intermittently-timing-out local GoTrue admin API,
  unrelated to this change) — Max should cover that case in the handoff below.
- ClickUp: could not update 86ey9e9gn/86ey9tkav from this session — the ClickUp MCP
  connector was unavailable at pickup and, once it reconnected mid-session, the
  workspace was rate-limited (~16h). Max needs to link the two tasks and move status
  manually once the rate limit clears.

---

## 2026-08-11 — Dev-build sneller: Turbopack default + .next/cache-cap (86ey9e9zd)

Branch `perf/86ey9e9zd-turbopack-dev` (PR: zie taak). Dev-only DX-perf (B5+B6 uit de
perf-audit); `pnpm build` blijft webpack. Milestone: Now (sessiesnelheid van elke
dev/test-loop).

- **`pnpm dev` draait nu `next dev --turbopack`** (spawn in `scripts/dev-env.mjs`);
  escape hatch `DEV_WEBPACK=1 pnpm dev`. Gemeten (onbelaste machine, verse worktree,
  Next 15.5.19): cold Ready 5,8s vs 8,5s webpack; eerste `/app`-compile **2,4s vs
  9,4s**; landing 6,1s vs 10,1s; HMR (Fast Refresh, browser-gemeten) **20–253ms vs
  545–1973ms**. Onder zware parallelle-sessie-load was webpack-cold zelfs 119s Ready /
  69–352s per route-compile — precies de pijn die de taak aankaartte. Turbopack heeft
  géén persistente dev-cache: warm ≈ cold (5,6s Ready), terwijl webpack-warm 7,6s
  Ready maar nog steeds 8–10s per eerste route-compile deed. Netto wint turbopack in
  élk scenario.
- **Gevalideerd onder turbopack:** dev-login-flow, `/app` home met live seed-data,
  Deur-tab incl. check-in door de outbox (DB-rij `offline_synced:true` geasserteerd),
  Sentry lazy facade (`window.__SENTRY__` na idle — de dynamic import van
  `sentry.client.init` werkt), HMR op i18n- én screen-bestanden, en `pnpm e2e:smoke`
  3/3 groen (incl. de rAF-gestubde never-painted-tab hydration-guard). CSP-dev
  (`unsafe-eval`) dekt turbopack al.
- **`.next/cache`-cap:** één `pnpm build` zet ~776 MB webpack-cache neer die turbopack-dev
  nooit leest. `pnpm dev` pruned nu bij start `.next/cache` boven 500 MB (logregel,
  faalt nooit hard); handmatig: nieuw script `pnpm clean:next`. Live getest: 775 MB →
  gepruned bij eerstvolgende `pnpm dev`.
- **`E2E_PORT`** override in `playwright.config.ts` (default 3000, CI ongewijzigd):
  lokaal bleken poorten 3000 én 3010 bezet door parked `groeniek-onderhoud`-servers
  die elke route 404'en — `reuseExistingServer` liet de suite dáártegen draaien, alle
  3 specs rood zonder dat er iets stuk was. Met `E2E_PORT=3033`: 3/3 groen.
- **Gotcha (gedocumenteerd in `next.config.js`):** `turbopack.root`/`outputFileTracingRoot`
  pinnen op `__dirname` om de multi-lockfile-warning te dempen breekt in een
  pnpm-worktree de resolutie van `@sentry/nextjs` in `sentry.server.config.ts`
  ("Module not found") → dev-server kapot. De inferred parent-root werkt; warning is
  cosmetisch. Niet pinnen.
- **Sentry/OTel-warning weg:** `require-in-the-middle` (OTel-dep, op Next's
  `serverExternalPackages`-default) als devDependency toegevoegd — pnpm hoist hem
  niet, turbopack warnde er elke start over.
- Gates: lint ✅, type-check ✅, vitest 867/867 ✅, `pnpm build` ✅, e2e:smoke 3/3 ✅.
  CLAUDE.md: turbopack-regel + cache-prune-note in de local-dev-sectie. NB: de
  CI-e2e-smoke draait via `pnpm dev` en test dus voortaan óók tegen turbopack.

---

## 2026-08-11 — strictMode, viewport zoom, timer leaks, unsafe casts (86ey9ea09, 86ey9ea1g, 86ey9ea2y)

Branch `claude/sharp-swirles-7f3da7` (PR #255), three finder-only tasks combined into one
branch/PR per instruction. Milestone: Now. High-risk surfaces touched (door outbox,
auth/confirm route) — see the review-fix round below for the required adversarial
security-research prompt.

- **`next.config.js`**: `reactStrictMode: false → true`. Audited every realtime-subscription
  and outbox-init effect for the double-invoke bugs Strict Mode's dev-only mount→cleanup→mount
  is designed to surface; `useDoorSync`/`usePoEventRealtime`'s channel effects were already safe
  via a `cancelled`-closure guard. Found and fixed one real gap: `OutboxStore.init()`
  (`src/features/door/outbox/store.ts`) had no in-flight dedup, so two calls fired back-to-back
  before the first IndexedDB read resolved could both pass the `loaded` guard and read+merge
  concurrently — fixed with a cached in-flight promise.
- **Viewport lock removed from the public `/e`, `/r`, `/i` routes** (WCAG 1.4.4 pinch-zoom) via
  a page-level `viewport` export; `/app` and other authenticated routes keep the root layout's
  lock. Gotcha, found by testing live against the dev server rather than trusting the Next.js
  docs: Next merges `viewport` **per-key** across the route segment tree rather than replacing
  wholesale, so simply omitting `maximumScale`/`userScalable` in the page override silently left
  the root's `maximum-scale=1, user-scalable=no` in the rendered meta tag — they have to be set
  explicitly (`maximumScale: 5, userScalable: true`).
- **Timer cleanups**: `home.tsx`'s `showToast` had no timer ref at all — a real bug where an
  earlier toast's timer could wipe a later one prematurely. `EventDayCockpit`'s notify/flash and
  `DoorProvider`'s toast timer now also clear on unmount, all on one consistent ref pattern
  (superseded by `useTransientValue` in the review-fix round below).
- **Zod-validated** the `auth/confirm` route's `type` query param (was a blind `as EmailOtpType`
  cast) and the `submit_guest_request` RPC result (was a hand cast).
- **`service.ts`**: the missing-env check moved from a silent `!` assertion to an eager, named
  throw inside `createServiceClient()` — deliberately NOT module-top-level, since that broke
  `stripe-webhook.test.ts`'s pure `mapStripeEvent` tests (they import the module transitively
  without ever calling the function) — caught by actually running the suite, not just reasoning
  about it.
- Gates (pre-review-fix): `pnpm lint` clean, 867/867 vitest green with `reactStrictMode: true`,
  manual dev-server smoke (Door tab live counts + no console errors, public `/e` viewport
  confirmed zoomable).
- **Environment note**: this session hit the same `pnpm install`/disk-contention wall as the
  door wake-lock entry above (~46 concurrent `node.exe` processes) — one install attempt got
  killed mid-write and left a corrupted `node_modules/.pnpm` entry for `next` (empty package
  dir, valid symlink); `pnpm install --force` re-extracted cleanly. Also hit a `gh pr merge`
  auto-mode-classifier block on direct user instruction — that action needs Max to run it
  himself, no working-around it.

### 2026-08-11 — Review-fix round (fresh-session `/code-review`, 15 verified findings)

Base branch had drifted 3 door-PRs behind `main` (main renamed `clearSynced`→`clearSettled`,
reworked the drain-summary shape, rewrote `store.test.ts`, removed the global JSX namespace
repo-wide). `git merge origin/main` conflicted in exactly the 4 files the review predicted
(`home.tsx` + the 3 public pages — resolved by keeping both sides' imports, per the review's
own instructions); everything else auto-merged clean. Full lint/type-check/vitest run on the
merged tree before touching any finding, per instruction — clean.

- **Outbox `reset()`/`doInit()` race** (findings 1–2): `reset()` (sign-out isolation, 86ey9et07)
  now also nulls `initPromise` — a next-user `init()` arriving while the previous user's load was
  still in flight would otherwise join the stale pre-wipe promise. `doInit()` now captures
  `idbEpoch()` at entry and bails post-await on a mismatch (mirrors the existing
  `persistMerged`/`onRemoteChange` guard) — a sign-out landing mid-load could otherwise
  repopulate the store with the previous user's entries (guest PII) into the next user's clean
  DB. Two new tests in `store.test.ts`: concurrent `init()` reads IndexedDB once; a sign-out
  mid-load leaves the snapshot empty and a later `init()` re-reads.
- **`submitGuestRequest`'s post-write parse failure** (finding 4) used to return `invalidInput()`
  — blaming the guest, discarding their one-time `/r/[token]` link, logging nothing — for a
  failure that happens *after* the RPC already inserted the row. Now logs (issue paths only, no
  payload — PII rule) and returns the same generic error the `rpc error` branch above it does.
  `submitGuestRequestResultSchema` (finding 5) is now a required `status` enum (every
  `submit_guest_request` return path sets it) + `auto_approved: z.unknown()` (display-only,
  shouldn't veto a real success) instead of both fields optional; dropped the dead
  `SubmitGuestRequestResult` export. Same bug class in `contacts/actions.ts` (finding 7):
  `upsert_contacts`/`add_contacts_to_event`'s hand-cast RPC results replaced with schemas read
  from their actual migration (`20260707160000_add_contacts_to_event.sql`), same post-write
  log-and-generic-error handling.
- **`auth/confirm/route.ts`** (findings 8–9): an unrecognized `type` with a present `token_hash`
  now redirects to `/login?error=link` (visible message) instead of a silent bare `/login` — only
  a missing `token_hash` stays a silent bounce. Rewrote the `satisfies z.ZodType<EmailOtpType>`
  comment: `EmailOtpType` is an *open* union (`... | (string & {})`), so that check enforces
  nothing at compile time; a new `route.test.ts` pins the six accepted values plus both guard
  branches.
- **Viewport root-unlock decision** (finding 10): a grep audit for `text-[1[0-4]px]` on
  `<input>/<textarea>/<select>` found ~10 genuine sub-16px form inputs scattered across
  authenticated screens — well past "a handful" — so the root layout's lock stays app-wide
  (unlocking it would re-enable iOS Safari's auto-zoom-on-focus on every one of them). Extracted
  the 3 public pages' duplicated viewport block into one `src/lib/public-route-viewport.ts`
  const instead. Added `touch-action: manipulation` to the one wrapper shared by every door
  surface (`PoDoorTab` in `screens/door.tsx`) — the root's `userScalable:false` never reliably
  stopped iOS double-tap zoom anyway (Safari has ignored that flag since iOS 10), so this is the
  actual fix, not a redundant one. A ClickUp follow-up tracks the root unlock + full input
  migration (**not filed yet — ClickUp MCP hit its rate limit while writing this entry**).
  Fixed the two sub-16px inputs actually reachable from the 3 patched pages (finding 11): the
  `/r` status-link copy input (`landing.tsx`, the named case) plus two more the audit surfaced
  on the same pages' component tree — `/i`'s search input (`influencer-stats.tsx`) and the phone
  field's country-picker search (`country-select.tsx`, reachable from `/e`).
- **`useTransientValue<T>(ttlMs)`** (`src/lib/use-transient-value.ts`, finding 12): the shared
  primitive the repo's "new primitive → shared, same PR" rule calls for, replacing the PR's 4
  hand-rolled toast/flash timers plus 7 sibling `setTimeout(() => setX(null))` sites with the
  same bug shape (`influencer-stats.tsx`, `landing.tsx`, `MfaEnrollCard.tsx`,
  `promotion/roster.tsx`, `promotion/event-links.tsx` ×2, `events/edit.tsx`) — `guests/profile.tsx`
  and `promotion/event-links.tsx`'s `justCreated` flash were correctly left alone (already
  effect-driven with proper cleanup). Adds a mounted-ref the hand-rolled versions didn't have:
  a `trigger()` landing after unmount (an async mutation's `onError`/`onSuccess`, a clipboard
  write's `.then()`) is a no-op instead of a setState-after-unmount warning. A `clear()` escape
  hatch was added after `pnpm type-check` caught a real bug the review didn't: `roster.tsx`
  explicitly resets a stale `copied` flag to `false` when a fresh link is minted (before
  anything has actually been copied for it) — a 2-tuple `[value, trigger]` can't express that.
- **`service.ts` comment** (finding 13) was factually wrong: supabase-js's own constructor
  already throws synchronously on a falsy arg (`'supabaseUrl is required.'` /
  `'supabaseKey is required.'`) — the old `!` pattern never let `undefined` silently reach a
  network call. Rewritten honestly: the guard's real value is naming the actual env var, not
  supabase-js's generic parameter name. Added the optional `requiredServerEnv(name)` helper
  (`src/lib/env.ts`, `server-only`) and used it in all four server-side factories
  (`service.ts`, `server.ts`, `middleware.ts`, `invite-mail.ts`) — deliberately NOT in
  `src/lib/supabase/client.ts`, whose `NEXT_PUBLIC_*` reads must stay literal `process.env.X`
  for Next's build-time inlining into the browser bundle.
- **Gotcha caught only by CI, not `pnpm type-check`**: `route.test.ts`'s pin for
  `emailOtpTypeSchema` (finding 9) lived as an exported const in `route.ts` itself. `tsc --noEmit`
  is happy with that — it's Next.js's own build-time Route Handler validation, not TypeScript
  structural checking, that rejects any named export from a Route Handler file other than the
  small set it recognizes (`GET`, `POST`, `config`, …): `"emailOtpTypeSchema" is not a valid
  Route export field.` Broke both the Vercel preview deploy and the CI `lint-and-test` job (which
  runs a real `pnpm build`). Fixed by moving the schema into `features/auth/schemas.ts` (its
  tests moved to the co-located `schemas.test.ts`); confirmed via a local `pnpm build` before
  re-pushing, not just `type-check`. Worth remembering for any future Route Handler file: `tsc
  --noEmit` is not a substitute for `next build` when the file exports anything beyond the HTTP
  method handlers.
- Gates on the merged tree: `pnpm lint` clean, `pnpm type-check` clean (one real error caught —
  see `useTransientValue`'s `clear()` above), `pnpm build` succeeds, 1046/1046 vitest green,
  manual dev-server smoke (Door tab: live check-in/reverse-check-in round-trip with correct
  count updates, no console errors, `touch-action: manipulation` confirmed via computed style;
  public `/e`: viewport meta confirmed still zoomable after the shared-const refactor).
- **Left for Max**: merge PR #255 (`gh pr merge` is blocked for this session by the auto-mode
  classifier, even on direct instruction); the ClickUp root-unlock/input-audit follow-up still
  needs filing once the rate limit clears; a fresh-session `/code-review` is required again
  before merge per the review-gates rule (this round touched the door outbox + auth route, both
  high-risk surfaces) — self-contained adversarial security-research prompt in the PR body.

---

## 2026-08-11 — Review fixes on the SW cache split: offline boot, wipe completeness (86ey9e9mn)

Same branch/PR (#246) as the entry below. A fresh-session `/code-review` (15 findings) plus
`/security-review` (no new vulnerabilities; the PR is a net security win) ran on the cache-scoping
work. The security half held up; the **offline half did not** — three of the findings were ways
the new scoping quietly broke invariant #25, which the original entry claimed it preserved.
Milestone: Now. All 15 addressed; suites: Vitest 86 files / **923** tests (the three SW suites grew
28 → 63), pgTAP unchanged, lint + type-check clean.

- **Offline boot was actually broken in three places** (merge-blocking half of the review):
  - *Installed PWA could not launch offline.* `manifest.json` `start_url` is `/` with
    `display: standalone`, but `/` classified as "never store" and had no fallback, so a
    home-screen launch offline hit the browser error page — where the pre-PR universal
    `caches.match('/door')` fallback had booted it. `/` is `src/app/page.tsx`: static, no auth, no
    redirect, so it now routes to the SHELL bucket and is its own fallback. Fixed in the SW rather
    than the manifest deliberately — a `start_url` change never reaches an already-installed PWA.
    Caught while wiring this up: middleware 307s a *signed-in* user off `/` to `/app`, so both a
    real navigation and a credentialed seed come back redirected and store nothing — the offline
    launch would have stayed broken for exactly the people who use the installed app. `/` is
    therefore seeded with `credentials: 'omit'`, which also makes "this entry holds no session
    data" true by construction instead of by inspection.
  - *The shell was never seeded.* Removing the install precache was right (`cache.addAll` sends
    cookies), but "the shell fills itself from real navigations" was false: every in-app move is a
    `<Link>`/RSC fetch (`mode: 'cors'`), so the SW never sees a `navigate` request for
    `/door/<eventId>` — a first-session tablet cached zero navigation HTML and died on an offline
    reload. Added a `seed-shell` message: `register-sw.tsx` posts the paths it wants after
    `serviceWorker.ready`, the SW re-fetches them with `credentials: 'same-origin'`. The path list
    is treated as untrusted — each entry must classify as SHELL via `navigationCache` on its own
    merits, so a compromised client cannot talk the worker into persisting `/app`.
  - *The "next doorhost still cold-starts offline" claim was not delivered and is now corrected
    rather than engineered around.* `fallbackFor('/door/<id>')` points at `/door`, which is
    session-scoped and therefore gone after sign-out; and falling back across events is not an
    option (the flight payload embeds the eventId — it would render the wrong event). The honest
    version, now in the SW header, CLAUDE.md and the entry below: the persistent bucket buys static
    assets + exact-URL door pages; a signed-out device can't work the door offline anyway (no
    session, no IDB snapshot), and the next doorhost's bootable HTML comes from their own online
    login via seeding.
- **Cache writes could be dropped.** `putInCache` was fire-and-forget, so a worker terminated
  after the response but before the write committed lost it — worst on WebKit/iPad, the door's
  device class. It now returns its promise and every call site passes it to `event.waitUntil`.
- **`ignoreSearch` on navigation lookups.** Without it, an entry under `/app/door?event=X` (the
  canonical Deur-tab URL, `doorPath()`) could not satisfy `/app/door?event=X&seg=taken`, so a
  query-only screen change died offline. `ignoreSearch` ignores the query only, never the path —
  no cross-event bleed, asserted both ways.
- **Sign-out ordering reversed (this changes #233 behaviour deliberately).** The wipes ran *before*
  the lingering-session checks, so the `sign-out-incomplete` throw path — where we intentionally
  keep the user signed in — destroyed that still-working doorhost's un-synced check-ins and offline
  shell mid-shift while protecting nothing (their token is still on the device either way). The
  wipe now runs only once the session is confirmed gone, immediately before the redirect. The
  #233 test that asserted "PII still wiped" on the throw path was inverted to match, with the
  reasoning recorded next to it.
- **Sign-out wipe completeness (security-shaped):**
  - The MFA wall's escape hatch called `supabase.auth.signOut()` raw — no IndexedDB wipe, no cache
    wipe — on a surface reachable from a shared tablet. The device-wipe sign-out moved to
    `src/features/auth/sign-out-device.ts` (so `features/*` doesn't import from
    `components/po/screens/`); both call sites use it, `_shared.tsx` re-exports it.
  - Cache Storage had no re-population guard. `clearDeviceCaches()` now posts `{type:'session-wipe'}`
    to the worker, which bumps a `sessionEpoch` — the Cache Storage counterpart of `idbEpoch()` —
    so a sibling tab's in-flight navigation cannot resurrect the cache we just deleted, and deletes
    the bucket once more from inside the worker. An epoch rather than a sticky flag: it self-heals,
    so the next user's own navigations cache normally.
  - A remotely revoked device runs no code, so its session cache outlived revocation. The SW now
    drops `plusone-session-*` when a SESSION-path navigation comes back as an opaqueredirect (the
    post-revoke 307 to `/login`). Deliberately not "any non-200" — a 502 on flaky venue wifi must
    not wipe the cache. Residual, now documented in CLAUDE.md: a device that never comes online
    again keeps its cache; nothing running on it can be reached.
- **Migration robustness.** `activate` used `Promise.all` with no catch, so one rejected
  `caches.delete` skipped the rest of the purge *and* `clients.claim()` — and activate never fires
  again for that script version. Now `allSettled` with an unconditional claim; same split in the
  `sw.js` stub so a failed delete can never skip `registration.unregister()`. Added a lazy
  purge at worker startup: the SW we replaced keeps finishing in-flight events, so a fire-and-forget
  write can re-create a purged legacy cache seconds after `activate` ran.
- **Docs-vs-code.** The `redirected` guard's documented mechanism didn't exist on the navigation
  path (redirect mode is `manual` → opaqueredirect, status 0, `redirected` false). Comments, the
  changelog entry below and the test fixture now model the real shape; the guard stays because it
  *is* live for the static and seed-fetch paths, with a test for each.
- **Guards that could not fail.** `toContain('sw.js')` was satisfied by the explanatory comment
  above the middleware matcher, and `sign-out.test.ts` ran in the node env where `caches` is
  undefined — so deleting either protection kept CI green. The matcher is now compiled from
  `src/middleware.ts` source and asserted behaviourally (`/sw.js` and `/service-worker.js` must NOT
  match, `/app` and `/door/evt-1` must), and `sign-out.test.ts` stubs `caches` and asserts the
  session bucket is deleted during the real `signOutDevice` flow. The `plusone-shell-` prefix was
  triplicated across two SWs and a TS module with no drift guard: `KEEP_PREFIX` is exported and a
  test extracts both cache names from the SW source and asserts the prefix contract, so a rename
  that made sign-out wipe the shell (or spare the credentialed cache) fails CI.
- **Shell PII contract + growth.** `/door/` (trailing slash) classified as SHELL and only Next's
  `trailingSlash: false` kept the credentialed picker out — now excluded explicitly. Added a
  structural guard that `src/app/door/[eventId]/page.tsx` renders only `<DoorRoute eventId
  serverHint>` and serializes no guest data, plus a note that `/_next/image` routing to SHELL is
  only safe while `images.unoptimized: true`. The shell cache is now capped (60 entries, static
  assets evicted first) — nothing bounded it, and origin-quota eviction would have taken the
  IndexedDB outbox with it.

---

## 2026-08-10 — Service worker cached credentialed `/app` HTML + stale next-pwa artefacts (86ey9e9mn)

Branch `fix/86ey9e9mn-sw-pii-cache`. Direct follow-up to 86ey9et07 (PR #233): that one wiped
IndexedDB on sign-out, this one closes the *other* origin-scoped store the door leaves behind —
Cache Storage. Milestone: Now (security/AVG on shared venue tablets). Two confirmed review
findings, both about data that outlives the session that produced it.

- **N1 — the door SW cached every same-origin navigation, including `/app`.**
  `public/service-worker.js` handled `request.mode === 'navigate'` with no path scope at all, so
  the network-first branch wrote the response of *any* navigation into one persistent cache
  (`plusone-door-v1`). `/app` is not a static shell: `src/app/app/layout.tsx` resolves identity
  server-side and the RSC flight payload embedded in the HTML carries user id, venue id, venue
  name, roles, display name and the whole membership set. `/door` (the picker) SSRs the caller's
  event + venue list. Sign-out cleared IndexedDB but never touched Cache Storage, so on a tablet
  passed from doorhost A to B, A's `/app` HTML stayed readable in devtools (and would be served
  to B on an offline boot).
- **Fix — two caches, two lifetimes.** The SW now decides per pathname which bucket a navigation
  may go in, and defaults to *not storing it at all*:
  - `plusone-shell-v2` (persistent, PII-free): static assets + `/door/<eventId>`, which
    deliberately SSRs no guest data. Kept across sign-out on purpose — wiping it would cost the
    *next* doorhost their offline cold start (invariant #25).
  - `plusone-session-v1` (session-scoped): `/app`, `/app/*` and the `/door` picker. Wiped by
    `clearDeviceCaches()` (`src/features/door/offline/sw-cache.ts`) from `signOutDevice`, right
    next to `idbClearAll()` — Cache Storage now has the same lifetime as IndexedDB.
  - Everything else same-origin (`/login`, `/e/<slug>`, `/onboarding`, `/r/<token>`, `/`) is
    network-only: not needed for offline boot, so not worth storing credentialed.
  - Offline fallback is per-surface (`/door*` → cached `/door`, `/app*` → cached `/app`, else a
    network error). The old code fell back to the door shell for *any* failed navigation — the
    exact wrong-shell hazard `routes.ts` warns about.
  - `putInCache` refuses redirected responses. (Corrected by the review, see the 2026-08-11 entry:
    on the *navigation* path the 307 to `/login` arrives as an **opaqueredirect**, so it is the
    `status !== 200` check that keeps the login page out of the `/app` key — the `redirected` flag
    is live for the redirect-mode-`follow` paths, static assets and the seed fetch.)
  - Renaming the caches is the migration: `activate` deletes every bucket that isn't one of the
    two, so devices already holding leaked `/app` HTML in `plusone-door-v1` are cleaned on the
    first post-deploy activation. The install-time precache of `/door` is gone (`cache.addAll`
    sends cookies — it was putting the credentialed picker in the persistent cache).
- **N2 — a retired Workbox SW was still live on real browsers.** `public/sw.js` and
  `public/workbox-e9849328.js` were next-pwa build output from before fase 9. next-pwa is
  disabled in `next.config.js`, but a service worker is not retired by deleting its source:
  a browser that ever registered `/sw.js` keeps running the installed copy, and that copy
  `registerRoute`d **cross-origin** GETs into a `NetworkFirst` cache with a 1h TTL — Supabase
  REST bodies, i.e. guest PII, in an origin-scoped cache that outlived sign-out. Visiting `/door`
  replaces the registration (same scope), so only clients that never opened the door were
  affected — `/app`-only users and landing-page visitors.
  Fix: `public/sw.js` is now a **self-destructing stub** (skipWaiting → delete every cache except
  `plusone-shell-*` → `registration.unregister()` → renavigate open clients). Browsers re-fetch a
  registered SW script on navigation, so this is what actually kills those workers.
  `public/workbox-e9849328.js` deleted and the commented-out `withPWA` blocks in `next.config.js`
  replaced by a do-not-reinstate note. **`next-pwa` itself is still in `package.json`** — the
  `pnpm remove` stalled for 45+ minutes against a dozen concurrent `pnpm install` processes from
  other sessions on this machine and was abandoned rather than left half-applied (a package.json
  without a matching lockfile breaks CI's `--frozen-lockfile`). It is inert (nothing requires it)
  and guarded by a test; dropping the dependency is a one-line follow-up for a quiet machine.
  `clearDeviceCaches()` deny-lists by prefix (delete everything except `plusone-shell-*`) rather
  than allow-listing known names, so the Workbox buckets (`apis`, `others`, `cross-origin`,
  `workbox-precache-*`) are wiped on sign-out too, on devices that still have them.
- **Middleware.** `sw.js` and `service-worker.js` stay excluded from the auth matcher — a 307 to
  `/login` in place of a SW script is unparseable JS, and the browser would keep the previously
  installed worker, i.e. the stub would never take effect. Documented inline. `workbox-` dropped
  from the matcher along with the artefact it served.
- **Tests.** `tests/unit/service-worker-cache-scope.test.ts` evaluates the real
  `public/service-worker.js` inside a fake ServiceWorker global (self/caches/fetch/Response),
  fires actual `fetch`/`activate` events and asserts *which cache bucket* each URL lands in —
  a regex-over-source guard would not have caught this class of bug. Includes the offline
  cold-start cases so the fix cannot silently trade #25 for privacy.
  `src/features/door/offline/sw-cache.test.ts` covers the sign-out wipe (keeps the shell, wipes
  session + legacy Workbox buckets, no-ops without CacheStorage, swallows storage errors).
  `tests/unit/no-stale-pwa-artifacts.test.ts` fails CI if the stub is replaced by a generated
  Workbox SW, if a workbox runtime reappears, if next-pwa comes back, if the middleware
  exclusions are dropped, or if sign-out stops wiping Cache Storage.
- **Known gap, deliberately not changed here:** only `/door` registers the service worker
  (`src/app/door/layout.tsx`), so an `/app`-only device has no offline shell at all. Extending
  registration to `/app` would widen the caching surface and belongs in its own task.

---

## 2026-08-10 — Door wake-lock toggle + stale-resume sync guard (86ey6x56p)

Branch `feat/86ey6x56p-door-wakelock-stale-resume` (PR #252, **not merged yet** — a fresh-session
xhigh `/code-review` found 15 verified findings, all fixed 2026-08-11 in a review-fix round below;
the PR still needs that gate re-confirmed + Max's manual test handoff before merge). Milestone: Now.
No migration; no RLS/auth/service_role/PII surface touched — both features are read-only consumers
of the existing `useDoorSync` status plus a device-local browser API, so the review prompt in the PR
body is framed as correctness/reliability, not security.

- **Screen Wake Lock toggle.** `src/features/door/sync/wakeLock.ts` wraps the Wake Lock API
  feature-detected + try/catch end to end (never throws — the API is absent in most Capacitor
  webviews, checklist #37). `useWakeLock.ts` defaults it ON where supported, re-acquires on every
  `visibilitychange → visible` (the OS silently drops the lock the instant a tab is hidden and never
  restores it on its own), and race-guards a request that resolves after the user already toggled
  off (releases immediately instead of surprise-relocking the screen). Wired into `SyncBar` as a
  small icon toggle, hidden entirely (not shown inert) when unsupported.
- **Stale-resume guard.** `staleResume.ts` is a pure edge-detector (same shape as `reconnect.ts`):
  fires only on a genuine hidden→visible transition — never first mount, never a same-state no-op —
  when the last successful sync is ≥5 min old (configurable). `useStaleResumeGuard.ts` wires that
  into the EXISTING `useDoorSync` status (`forceSync`/`syncing`/`online`/`lastSyncAt` — no second sync
  mechanism) via a 3-phase state machine (`closed` / `syncing` / `blocked`), rendered by
  `StaleResumeOverlay.tsx` and mounted once in `PoDoorTab`. **Covers the mobile `/door/[eventId]`
  route and the mobile `/app` Deur tab only** (both render `PoDoorTab`/`DoorProvider`, so
  guest-detail/add-on-spot are blocked too) — corrected 2026-08-11: an earlier version of this note,
  the overlay's own doc comment, and the PR body all wrongly claimed desktop cockpit coverage. The
  desktop (≥1024px) `/app` Deur tab renders `EventDayCockpitGate` (app.tsx), a completely separate
  online-only React Query tree with no `DoorProvider`/outbox and therefore none of this wiring — never
  actually built. Follow-up spawned (see review-fix round below) rather than built into this PR. Online,
  the guard force-syncs and auto-closes; offline (or a hung request past an 8s backstop timeout) it
  degrades to an explicit "Continue anyway" warning — hard requirement from the task spec that the
  door must never lock up with no way out. `blocked` also self-heals to `closed` the moment ANY later
  sync (not just its own forced one — the 60s safety interval or a reconnect) lands fresh. Mesh/peer
  sync is parked per the task; only online/offline-alone paths are built.
- **Gotcha found while writing the hook's own tests**: `forceSync()` and `useDoorSync`'s own
  `setSyncing(true)` land in the same React commit in production (both triggered synchronously inside
  the same `visibilitychange` dispatch), but nothing *guarantees* `sync.syncing` is already `true` on
  the very first render after opening the overlay — an early version of the resolve-effect could
  downgrade `syncing → blocked` before the forced sync had even started. Fixed with an `attemptSeenRef`
  that only allows the downgrade after `sync.syncing === true` has actually been observed once.
- Suites (2026-08-10, before the review-fix round): `pnpm vitest run src/features/door/sync` 50/50
  new+existing pass; full suite 900/901 (the 1 failure, `realtime-throttle.test.ts` timing out under
  full-suite load, was pre-existing/unrelated and passed cleanly in isolation — environmental
  flakiness on a heavily loaded dev machine, not this branch). `pnpm type-check` and `pnpm lint` clean.
- **Environment note**: `pnpm install` in this worktree took roughly 40 minutes (970 packages all
  already in the pnpm store — pure hardlink/copy, no downloads — throttled to a crawl, almost
  certainly AV/disk contention from ~46 concurrently running `node.exe` processes on the machine at
  the time). Not a repo issue; flagging in case a future session hits the same wall.

### 2026-08-11 — Review-fix round (fresh-session xhigh `/code-review`, 15 verified findings)

The state-machine core (`closed`/`syncing`/`blocked`, `attemptSeenRef` ordering, the 8s backstop,
`inFlight` idempotence with `useDoorSync`) was verified SOUND and left untouched — every fix below is
surgical, same files as the original entry above plus `src/components/po/kit.tsx` (one prop, see
P1-5) and `src/features/door/sync/useDoorSync.ts` (one line, see P1-6).

**P0 — merge blockers:**
- **SSR hydration mismatch** (`useWakeLock.ts`): `supported` now starts `false` on every render
  (`useState(false)`) and upgrades in a mount effect, exactly like the documented `navigator.onLine`
  guard pattern in `useDoorSync.ts` — computing it eagerly during render read differently on the
  server (no `navigator.wakeLock`) than a real browser's first client render, an immediate hydration
  error on every real door-device load. Tested via `renderToString` (SSR never runs effects, so it
  directly proves the pre-hydration output).
- **False desktop-cockpit coverage claim** — corrected in this file (above), the overlay's doc
  comment, and the PR body; follow-up task spawned rather than built here.
- **Wake-lock toggle asserted protection it didn't have** (`SyncBar.tsx`, `useWakeLock.ts`): the
  button now renders three distinct states — off (gray) / enabled-but-not-holding (gold, reuses the
  "stale" traffic-light colour) / on-and-holding (accent, filled) — and `onSentinelReleased` now
  retries once immediately when the browser revokes a lock while the document stays visible
  (documented battery-saver behaviour), not just on the next resume.
- **`acquire()` race guards**: (a) a sentinel obtained by a concurrent acquire that lost the race is
  released immediately instead of orphaned/overwriting the held one; (b) a sentinel whose `.released`
  flipped `true` without ever firing the `'release'` event (iOS pre-18.4 gap) is now detected and
  cleared instead of permanently blocking every future acquire.

**P1 — fixed in this round:**
- **Focus containment**: the door content (everything except the overlay itself) gets React 19's
  `inert` boolean prop while `phase !== 'closed'` (a wrapper div in `PoDoorTab`, lifted the
  `useStaleResumeGuard()` call up there so `StaleResumeOverlay` is now purely presentational and only
  ONE state machine instance exists) — a hardware keyboard or barcode-scanner wedge could otherwise
  type into `AddOnSpot`'s autofocused, Enter-to-commit field behind the overlay. "Continue anyway" is
  now `autoFocus` (added an `autoFocus?: boolean` passthrough prop to `kit.tsx`'s `Btn`, one line).
- **Realtime-reconnect self-heal didn't actually work**: `useDoorSync.ts`'s resubscribe-after-drop
  path called `onSyncRef.current()` directly, bypassing `runSync` — so a reconnect refetch never
  updated `lastSyncAt`/`syncing`, and the guard's self-heal claim silently didn't apply to that path.
  Pre-existing line, routed through `runSync` now.
- **Blocked state got a "Try again" action** (`retry()` on the guard, a secondary Btn on the
  overlay) and the copy no longer falsely claims "still trying" once an attempt has already settled.
- **Hidden-mount resume**: `prevVisibility` now seeds from the actual `document.visibilityState` at
  listener registration (not `null`), so a door screen that mounts already backgrounded is guarded on
  its first reveal instead of that reveal being mistaken for "the initial observation."
- **Explicit wake-lock OFF now persists** (`plusone-door-wakelock-off` in localStorage, same
  guarded try/catch pattern as `getDeviceId` in `offline/device.ts`) — previously reset to ON on
  every reload.
- **Clock-jump hardening + one source of truth**: exported `isSyncStale(lastSyncAt, now, thresholdMs)`
  from `staleResume.ts`, used by both the open predicate and the guard's close predicate (previously
  hand-mirrored complements in two files); a backward clock jump now degrades loudly (treated as
  stale) instead of silently never firing.

**P2 — judgment calls (defaults chosen, stated here per the task instructions):**
- **Offline re-block friction**: `continueAnyway()` while offline now suppresses re-opening the
  overlay on every subsequent screen unlock for the rest of that offline period — the doorhost
  already acknowledged the risk once. Suppression clears the moment `sync.online` flips true.
- **Doomed pre-resume attempt**: the resolve effect now gives ONE internal retry (guarded by a ref,
  so it can only fire once per `syncing` phase) before downgrading to `blocked`, covering the case
  where a pre-existing sync (not our own `forceSync()` call, silently swallowed by `useDoorSync`'s
  shared `inFlight` guard) was the one that settled unfresh. Also dropped the `sync.online` condition
  from the "fresh" check — a `lastSyncAt` that just landed already proves connectivity worked at that
  moment, even if `online` is flickering false for an unrelated reason.
- **`liveRef` reset**: now explicitly set `true` at the top of the mount effect (not just relied on
  the `useRef(true)` initializer) — hardens against `next.config.ts`'s `reactStrictMode: false`
  ("temporarily") ever being re-enabled, whose dev-only double-invoke would otherwise leave it stuck
  `false` after the simulated remount, permanently killing every future acquire. Verified with a
  `<StrictMode>`-wrapped test.

Suites after the review-fix round: `pnpm vitest run src/features/door/sync` 68/68, door+po component
suites 270/270, full suite 919/919 (no flakes this run). `pnpm type-check` and `pnpm lint` clean (no
new warnings). Follow-up task spawned for desktop-cockpit coverage (not built here, per the review's
explicit instruction). ClickUp session comment couldn't be posted — the ClickUp MCP write API was
rate-limited workspace-wide for ~23h at the start of this round; exact comment text handed to Max.

**Merged `origin/main` into the branch after pushing the fixes** — `main` had moved substantially
(PR #247's repo-wide `JSX.Element` → explicit-import codemod + new `tests/unit/jsx-namespace-imported.test.ts`
guard, PR #249's door outbox coalescing/`onBeforeForceSync` restructure of `useDoorSync.ts`, PR #253's
atomic check-out, PR #250's request-link venue isolation). Only real conflict was two changelog
entries landing at the top simultaneously (trivial, kept both). `useDoorSync.ts` auto-merged cleanly
with BOTH this task's finding-6 fix (the realtime-reconnect self-heal routed through `runSync`) and
#249's new `forceSync`/`onBeforeForceSync` split intact — verified by reading the merged file, not
just trusting the auto-merge. The JSX codemod predates this branch's new files, so
`StaleResumeOverlay.tsx` and `useWakeLock.test.ts` needed the same `import type { JSX } from 'react'`
fix by hand; caught by re-running the guard test, not by manual inspection. Full suite re-run
post-merge: 966/966, type-check + lint clean, PR now shows `MERGEABLE`.

## 2026-08-10 — Dependabot: refuse Next/React majors, unblock the safe bumps (86eyd39gn)

Branch `chore/86eyd39gn-deps-ignore-majors-safe-bumps` (PR #247, closes the deadlocked #239).
Milestone: Now — dependency
hygiene keeps the security-patch stream flowing, and a permanently-red deps PR trains everyone
to ignore Dependabot. No migration, no schema change, no runtime behaviour change.

- **The problem with PR #239.** Dependabot groups by `dependency-type`, so *one* group PR carried
  14 updates: Next 15.5.19 → **16.2.12**, Stripe 18 → **22**, zod 3 → **4**, uuid 10 → **14**,
  tailwind-merge 2 → **3**, recharts 3.8 → 3.10, plus six genuinely safe in-major bumps. The stack
  is pinned by CLAUDE.md (Next 15 / React 19), so the majors can't merge — and because they share
  a PR with the safe ones, *nothing* merged. The group had been stuck since 6/8.
- **Fix: refuse the majors at the source.** `.github/dependabot.yml` gained an `ignore` block for
  `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom` limited to
  `update-types: ["version-update:semver-major"]`. Minor/patch keeps arriving weekly. A framework
  major stays what it is — a migration with its own task (**86eyd39mx**, parked), not a bump.
  Deliberately *not* ignored: Stripe/zod/uuid/tailwind-merge majors. Those are ordinary library
  migrations we do want proposed; they just need their own PRs, so they'll come back regrouped
  once #239 is closed.
- **Safe bumps taken.** `pnpm update` on the six in-major updates:
  `@sentry/nextjs` 10.64.0 → 10.70.0 · `@supabase/ssr` 0.12.0 → 0.12.4 ·
  `@supabase/supabase-js` 2.108.1 → 2.112.2 · `@tanstack/react-query` +
  `@tanstack/react-query-persist-client` 5.101.0 → 5.101.4 · `@tanstack/react-virtual` 3.14.3 → 3.14.9.
  `pnpm update` also raises the caret floors in `package.json` (e.g. the vague `@sentry/nextjs: ^10`
  → `^10.70.0`), which is what Dependabot does and is worth keeping — the floor then documents the
  version actually tested, and the `ssr`/`supabase-js` pairing below becomes explicit instead of
  implied. `next` and `react` did not move (they appear in the lockfile diff only as peer context
  inside Sentry's version string); the transitive churn is OpenTelemetry 2.9 → 2.10 under Sentry.
  The CLAUDE.md invariant (`@supabase/ssr` aligned with `supabase-js`, ≥0.12 for js ≥2.108) holds
  and was re-verified the way it actually fails: type-checking real `.from()`/`.rpc()` calls against
  the repo's own `database.types.ts` to prove the typed client doesn't collapse to `never`. The row
  type came back fully resolved (`{ id: string; status: "pending" | … ; plus_ones: number }`), and a
  negative control (a bogus column) still errors, so the check isn't vacuous.
- **Removed a landmine for the parked React migration.** `JSX.Element` resolved through the
  *global* `JSX` namespace in **269 places across 107 files**. @types/react 18.3.31 already marks
  that global `@deprecated` ("Use `React.JSX` instead"), and @types/react 19.2.18 drops the
  `declare global` block entirely — verified by A/B-ing both patterns against both real typings:
  the bare annotation fails under 19 with `TS2503: Cannot find namespace 'JSX'`, the explicit
  import compiles clean under **both** 18 and 19. So 86eyd39mx would have opened with 269 type
  errors before touching a line of React. Now it opens with zero.
  - Mechanical and annotation-preserving: every `JSX.Element` is byte-identical, only imports
    changed, and all 107 files are one-line diffs — merged into an existing single-line `react`
    import where it fit prettier's `printWidth: 100`, otherwise its own
    `import type { JSX } from 'react';`.
  - **Gotcha for the next codemod author.** The first pass matched react imports with
    `/^import\s+([\s\S]*?)\s+from\s+['"]react['"]/gm`; `[\s\S]*?` happily spans *statements*, so a
    match starting at an earlier `import` line ran on until the next `from 'react'` and the
    specifier got spliced into the **wrong module's** braces — `type JSX` landed in
    `next/navigation`, `vitest`, and (worst) the `@/lib/observability/sentry-client` facade that
    CLAUDE.md requires stay untouched. Caught by inspection before committing, then rewritten to
    match one single line with `[^;\n]` so a match cannot cross a statement boundary. If you
    codemod imports here: forbid `;` and newlines in the specifier, and assert afterwards that
    every touched import line still ends in `from 'react';`.
- **Gotcha worth keeping: `pnpm --lockfile-only` when the box is busy.** The dev box was running
  **15–17 concurrent `pnpm install`/`update` processes** from sibling worktree sessions, free RAM
  down to ~3 GB of 64 GB. Resolution and extraction were fine (976 dirs in `.pnpm`), but the
  top-level **linking** phase starved for over an hour and never produced a `node_modules`, so no
  local gate could run. `pnpm update --lockfile-only` skips linking entirely and finished the same
  work **in 59 seconds**. For a dependency-only task that's all you need — the lockfile is the
  deliverable and CI does the verifying — so reach for it first instead of waiting on a full
  install. (Corollary, same spirit as CLAUDE.md's "one DB owner": a sibling session's `pnpm install`
  is not free, since every worktree competes for one global store.)
- **Verification ran on CI, deliberately.** With no local `node_modules`, the pre-lockfile commits
  were pushed and `lint-and-test` (lint · type-check · vitest · pgTAP · quota concurrency · e2e
  smoke) went **green on a clean runner**, plus a passing Vercel `next build` — a better gate than
  a thrashing local box. The dependency-bump commit lands after that and gets its own CI run, which
  is the one that actually matters for the bumps (CI installs with `--frozen-lockfile`).

---

## 2026-08-10 — request_links: cross-venue link-id disclosure hardening (86ey9thm6)

Branch `fix/86ey9thm6-request-link-venue-isolation`, PR not yet opened at session end.
CONFIRMED, low severity, milestone Now (cross-tenant isolation is a core invariant, #1).
Filed by the 86ey9p8zh/PR #224 fresh-session review as an out-of-scope finding (see
2026-07-14 entry below). Touches a trigger function → high-risk surface per the review
gates: **not self-merged**, fresh-session `/code-review` + `/security-review` required.

- **Root cause.** `enforce_request_link_max()` (`20260706101000_request_link_attribution.sql`,
  relocked in `20260714160000`) looked up the request link by `rl.id = new.request_link_id`
  only — never checking it belongs to `new.event_id`. Nothing else in the schema enforces
  that match either (`guests.request_link_id` has only a single-column FK to
  `request_links(id)`; `guests_insert`'s WITH CHECK constrains `source`/`added_by`, not
  `request_link_id`). An admin/organizer (exempt from the `source` allowlist) with raw API
  access to their own venue could POST a guest on their own event carrying a
  `request_link_id` copied from ANOTHER venue's link; the trigger would then recompute that
  foreign link's consumption against its cap and, on a breach, raise 45006 with hint
  `link_full;consumed=%s;max=%s` — disclosing another venue's private link fill numbers.
- **Fix.** New migration `20260810100000_request_link_venue_isolation.sql`,
  `CREATE OR REPLACE` on the existing function: reject a `request_link_id` whose
  `event_id` doesn't match the guest's own event (23514, generic message) BEFORE the
  foreign link's row is used for anything — same posture as
  `set_request_link_scope()`'s influencer-venue check. A same-event link falls through to
  the unchanged cap logic (advisory-lock ordering from 20260714160000 preserved verbatim).
- **Out of scope (documented in the migration, not built).** A theoretical multi-link
  advisory-lock deadlock (40P01) — unreachable today since every shipped writer of
  `guests.request_link_id` touches exactly one guest/one link per statement; fail-safe if
  it ever becomes reachable (Postgres's deadlock detector aborts one side, retryable, same
  shape 86ey9e8ar/PR #216 already handles for the other three lock domains).
- **Test.** Extended `supabase/tests/database/request_links.test.sql` with C8 (denied:
  cross-venue attribution rejected before any foreign-link computation, no guest row
  created, foreign link's consumption stays untouched) and C9 (allowed: same-event
  attribution still succeeds) — 34/34 in that file. `supabase db reset` clean, `supabase
  test db` **52 files / 1009 tests, PASS**. `pnpm lint` clean (2 pre-existing unrelated
  a11y warnings in `datetime-field.tsx`). `pnpm vitest run` 866/867 — the one failure
  (`realtime-throttle.test.ts`, unrelated to this change) is a timeout flake under heavy
  machine load, confirmed passing in isolation.
- **Gotcha — shared local Supabase stack under heavy concurrent load.** ~50 worktree
  sessions were active simultaneously; `supabase db reset` failed with `unexpected EOF`
  three times in a row (another session's concurrent reset/restart cycling the shared db
  container), and a stale reset once left an unrelated migration
  (`20260810120000`, from a *different* worktree/branch not containing this session's
  migration) as the latest applied version — silently reverting this fix's trigger back to
  pre-patch behaviour and producing a real (not flaky) `request_links.test.sql` failure on
  the first attempt. Confirmed via `supabase db query` against `pg_proc.prosrc` that the
  live function body didn't match the migration before diagnosing it as a collision, not a
  logic bug. Resolved by chaining `db reset` immediately followed by a single targeted
  pgTAP file run (via `docker exec … psql`) to shrink the collision window, then a full
  `supabase test db` once the stack settled. Also: **timestamp collision** — two unrelated
  concurrent sessions independently picked `20260810120000` for their own migrations
  (`atomic_check_out_guest` vs `scale_tier_occupancy_link_funnel`); this task's migration
  used `20260810100000`, unique against `origin/main` at branch time, but the collision
  between those two other branches will need resolving at merge time per CLAUDE.md's
  timestamp-collision rule.
- **ClickUp bookkeeping not done by this session.** The ClickUp MCP connector returned
  `RATE_LIMIT_EXCEEDED` (~17h cooldown) for the entire session, so the pickup/status
  comments and status transitions described by the `clickup-task` skill could not be
  posted. Task 86ey9thm6 needs manual pickup/status sync once the PR is up.

---

## 2026-08-10 — Atomic partial check-out + offline void/revive peer-steal (86ey9e9q2)

Branch `fix/86ey9e9q2-atomic-checkout-outbox-peer-steal`. Two findings from the review
backlog (#34, #35), both about a check-in row changing hands between the moment a device
observes it and the moment its write lands. Milestone: Now — both corrupt the headcount and
the audit trail at the door, which is the product's core promise. Each bug was reproduced
with a failing test BEFORE the fix (the tests are in the PR; they fail on the parent commit).

- **#34 — a partial check-out was two round trips.** `check_ins` holds one row per guest with
  a MONOTONE `plus_ones_arrived`, so "3 of the 4 in this party leave" cannot be a plain UPDATE:
  the cap trigger only lets the count drop across a revive (voided → active). `usePoCheckOut`
  therefore voided the row, then re-checked the smaller party in from the browser. A transient
  failure between the two (network flap, edge 502, tab closed) left the guest FULLY checked out
  — headcount −4 where the host asked for −2 — and the cockpit's cache disagreed with the
  database until the 60s safety sync.
  **Fix:** migration `20260810183000_atomic_check_out_guest.sql` adds
  `public.check_out_guest(p_guest_id, p_remaining_heads, p_check_in_id)` — SECURITY INVOKER, so
  RLS (incl. the S1.1 uncheck gate) still decides — doing both writes in one transaction. Also
  fixed two behaviours that were wrong in the old dance: `checked_by`/`checked_at` are now
  PRESERVED (the guest never left, so the first-wins arrival identity and instroom bucket must
  not move to whoever pressed ✗), and the remaining-heads argument is clamped so a stale client
  can never *raise* a party via the check-out path.
- **#35 — an offline void/revive could hijack a colleague's check-in.** `check_ins.guest_id` is
  UNIQUE, so matching a replayed write on `guest_id` alone reaches whatever row exists at drain
  time. Doorhost A works offline (check in → undo → re-check-in queued); meanwhile doorhost B
  checks the same guest in for real. On reconnect A's insert correctly settled as `duplicate`,
  but the void then voided B's ACTIVE row (guest reads onderweg while standing inside) and the
  revive stamped A over B's `checked_by` — the same C10 first-wins corruption the cockpit's
  revive fallback already guards against.
  **Fix:** the observed `check_ins.id` travels with the outbox entry (`checkInId` on the void and
  revive payloads, zod-`nullish` so a doorhost upgrading mid-shift keeps their queued entries
  instead of having them quarantined) and the gateway adds `.eq('id', …)`. A peer's newer row is
  then a 0-row no-op = synced, the same "server's first write wins" rule as the 23505 duplicate
  path. The cockpit passes the id too, via a new `id` on `CheckinArrival`.
- **Residual, deliberately not fixed here:** if a peer voids AND re-checks-in the SAME row while
  we are offline, the row id is unchanged, so our stale void still applies. Closing that needs
  optimistic concurrency on `checked_at`, which a device cannot do for its own offline inserts
  (the server stamps `checked_at`, the device only knows its client timestamp). Flagged in the
  PR's security-research prompt.
- Tests: `mutations.checkout.test.tsx` (hook against a fake gateway with real write semantics —
  asserts DB-equivalent state, not `ok: true`), `peer-checkin.test.ts` (a full outbox drain against
  an in-memory `check_ins` with the unique/void/revive constraints), gateway filter tests, and
  `check_out_guest.test.sql` (15 pgTAP assertions: allowed/denied per role, preserved identity,
  clamping, stale-id no-op, and the atomicity proof — an uncheck-disabled event rejects the whole
  call and leaves the guest untouched).
- Gotcha for later pgTAP work: `composite IS NOT NULL` is only true when EVERY field is non-null,
  so a function returning a table row must be asserted via `(f(...)).id`, and that field-selection
  form does not resolve untyped literals — the arguments need explicit `::uuid` casts.
- Local-stack note: `20260810120000` collided with a sibling worktree's migration
  (`scale_tier_occupancy_link_funnel`, branch `perf/86ey9e9wv-…`), caught because the shared local
  DB had it applied; renamed to `20260810183000`.

## 2026-08-10 — Landing request-form validation UX: red errors, name-required, e-mail sanity check (86eyd3men)

Branch `fix/86eyd3men-landing-request-validation-ux`. Found by Max while testing 86ey9e8z5 (the
public request form, `/e/[slug]` + `/r/[token]`, `src/components/po/landing.tsx`). Milestone: Now
(request-form UX Max personally hit while testing). Three fixes, all UX/validation-only — no
migration.

- **Errors were lavender, not red.** `FieldError` and the invalid-field border used `border-acc`/
  `text-acc-soft` (the same accent used for focus/selection elsewhere), so an error read as
  "active", not "wrong". Added `fieldErrorText`/`fieldErrorBorder`/`FieldErrorText` to `kit.tsx`
  (`text-red-300`/`border-red-400` — the color already used by ~15 other screens, just never
  centralized) and wired landing.tsx's field errors, the phone-field border, and the
  submit-failure banner onto it.
- **Empty name was silently disabled, no feedback.** The submit button used to `disabled={!ok}`
  so a native `disabled` button never fires `onClick` — there was no way to surface *why* nothing
  happened. Button now only disables on `pending`; `submit()` gates on `!ok` first and sets a new
  `nameErr` (copy: "Add your name so we can save your spot."), clearing it as soon as the
  requester types.
- **`isValidEmail` was too permissive.** The old regex (`[^\s@]+@[^\s@]+\.[^\s@]+`) accepted
  anything with an `@` and a dot anywhere in the domain — 1-char TLDs, numeric TLDs, doubled/
  leading/trailing dots, leading-hyphen labels. New regex in `src/features/requests/validation.ts`
  requires a real-looking local part and a domain with a 2–24 char alphabetic TLD.
  `submitGuestRequestSchema` (`schemas.ts`) now imports the same `EMAIL_RE` instead of Zod's
  built-in `.email()`, so client and server never disagree.
  - **Known, deliberate gap:** this is a structural sanity check, not a deliverability check — a
    syntactically well-formed but fake domain (Max's test case, `max@hoiu.dsadas`) still passes,
    because telling it apart from a real one needs either a bundled TLD allowlist (~5-10 kB gz on
    the exact page PR #236 just spent effort shrinking, plus a maintenance burden and false-reject
    risk on legitimate uncommon TLDs) or a live MX/DNS lookup (new server-side moving part on an
    anonymous public write path). Given email is optional here (#9) and a false rejection costs a
    real guest more than an occasional fake one costs the venue, this was a considered trade-off,
    not an oversight — flagged for Max in case he wants deliverability-grade validation later.
- The public endpoint's no-enumeration guarantee (never reveal whether an e-mail already exists,
  #28) is untouched — `submitGuestRequest` still dedupes silently in the DB regardless of Zod
  outcome.
- Tests: `src/features/requests/validation.test.ts` (+8 cases for the stricter regex),
  `schemas.test.ts` (+1 case proving client/server agree), new `src/components/po/landing.test.tsx`
  (4 RTL cases: name-required blocks submit + clears on typing, malformed e-mail blocks submit and
  is styled red, valid submit still reaches `action` — phone-lazy mocked out, hermetic). `pnpm lint`
  clean, `tsc --noEmit` clean. Full `vitest run` (833 tests) is flaky on this dev machine under full
  84-file parallelism — 8 unrelated pre-existing files (billing/webhook, door, realtime, health-check,
  sign-out) time out under CPU contention but pass individually and in a smaller batch; none touch
  the files this PR changed.

---

## 2026-08-10 — /r and /i IP-salt fail-closed regression (86ey9e9my, C5)

Branch `fix/86ey9e9my-landing-ip-salt-fail-closed` (PR [#242](https://github.com/Max-Seffelaar/PlusOne/pull/242)). Follow-up review finding on the
Requests-epic influencer/status pages: C5 (security review 2026-07-07) fixed the landing page
(`/e/[slug]`) to fail closed on a missing `LANDING_IP_SALT` in production via the shared
`landingIpSalt()`/`landingClientIpHash()` helpers (`src/features/requests/ip-hash.ts`), but two
sibling routes — `/r/[token]` (guest status) and `/i/[token]` (influencer stats) — each carried
their own inline `statusIpHash`/`statsIpHash` with `process.env.LANDING_IP_SALT ?? 'plusone-landing-dev-salt'`.
That committed constant is a real fallback, not just a dev convenience: if `LANDING_IP_SALT` is
ever unset in production those two routes would silently hash every visitor IP with a
publicly-known salt instead of failing loudly, reopening the exact brute-forceable `ip_hash`
C5 closed. Milestone: Now (security regression on a live prod surface).

- **Fix.** Deleted both inline helpers; both routes now import `landingClientIpHash` from the
  shared module, same as `/e/[slug]`. No behavior change outside the missing-env-in-prod case —
  local/dev/test still get the deterministic dev salt.
- **Test added.** `tests/unit/landing-ip-hash-fail-closed.test.ts` — structural scan proving both
  routes call the shared helper and contain no reintroduced `LANDING_IP_SALT ?? '...'` fallback,
  plus a behavioral test proving `landingIpSalt()` throws with `NODE_ENV=production` and no env
  var set, and returns the configured salt when it is set.
- **Gates:** `pnpm lint` + `pnpm vitest run` — see PR for results. Non-UI, no migration, no test
  handoff needed.

---

## 2026-08-10 — Door-outbox housekeeping: double-tap, flush-coalescing, tombstone-pruning (86ey9e9p5)

Branch `fix/86ey9e9p5-door-outbox-housekeeping` (PR [#249](https://github.com/Max-Seffelaar/PlusOne/pull/249)). Three findings from the door-outbox
review — O8 (CONFIRMED) plus finders #32/#33, all re-verified against the code before building.
Builds on PR #233's wipe-epoch + `reset()`; sign-out isolation untouched. Milestone: Now (this is
the door, on the offline path — invariant #25).

- **O8 — a double-tap queued a second check-in and blamed a colleague.** `checkIn()` guarded only
  the optimistic cache patch (`if (s.checkIns.some(...)) return s`), never the enqueue, so tap #2
  produced a second `check_in` entry with a fresh `check_ins.id`. `check_ins.guest_id` is UNIQUE
  (one row per guest ever, #11 — `20260613000000_full_schema.sql:273`), so that entry's ONLY
  possible outcome on replay is 23505-on-guest_id, which `replay.ts` correctly classifies as
  `duplicate` → the toast **"Was already checked in on another device"**. A doorhost who
  double-tapped their own tablet was told a colleague did it — and #32 below made that far more
  likely, because a refetch could wipe the optimistic patch and make the guest look un-checked-in
  again. Fix: guard the ENQUEUE, reading the two sources the first tap mutated synchronously — the
  query cache (also the channel realtime patches through, so a peer's check-in counts too) and the
  outbox (new pure helper `outbox/dedup.ts` `hasOpenCheckIn`, FIFO-aware: a `check_in_void` reopens
  the guest, an `error` never created a row so a retry stays allowed). The blocked tap toasts
  "already inside" rather than doing nothing.
- **#32 — a mutation enqueued during a flush was dropped twice over.** `flush()` kept a single
  in-flight promise and handed it to any concurrent caller, queueing nothing; `drainOutbox` snapshots
  the queue once at the start, and the `invalidateQueries` that follows overwrites the cache with a
  server snapshot that predates the new write. So checking in the next guest during the ~1s
  drain+refetch — the normal case at a busy door, not an edge case — lost both the drain and the
  optimistic patch: the guest visibly fell back to "onderweg" until the 60s safety sync. Fix:
  remember that someone asked while a flush ran and rerun the whole cycle (drain THEN refetch),
  bounded by `MAX_COALESCED_RERUNS`, so the last refetch of a burst always includes the new write.
  The in-flight flag is cleared in the same synchronous step as the final queued-check, so no
  request can land in the gap. `useDoorSync` gained a `coalesce` option: the manual "sync nu" press
  now forwards into that coalescing instead of being silently dropped when a sync is already running.
- **#33 — tombstones were immortal and the error toast showed the wrong one.** `clearSynced()`
  dropped only `synced`, so every `duplicate`/`error` entry stayed queued for good AND was
  re-serialized to IndexedDB on every later commit (this runs after every drain — each mutation plus
  the 60s sync), i.e. the per-write cost climbed all night on the device that can least afford it.
  On top of that the flush error toast did `find(e => e.status === 'error' && e.message)` — the
  OLDEST error still queued — so a doorhost hitting "tier zit vol" could be shown an unrelated
  rejection from hours earlier. Fix: `clearSettled(now)` prunes `duplicate`/`error` past a 12h TTL
  (a full night; the CheckInList duplicate marker and the manual retry need them within the shift)
  and returns without committing when nothing settled; `DrainSummary.lastError` carries the
  just-failed message out of the drain; and `retryErrors()` — which existed with **no callers at
  all** — is wired to the sync-bar button only (`onBeforeForceSync`), never to an automatic drain,
  so dead-lettering still means something while a terminal error finally has a recovery path.
- **Tests.** New `DoorProvider.test.tsx` (6 behavioural cases driving the real provider, real outbox
  and real drain against a fake gateway that models the UNIQUE guest_id constraint), new
  `outbox/dedup.test.ts` (7), plus additions to `store.test.ts` (4 pruning cases incl. "no IndexedDB
  write when nothing settled") and `replay.test.ts` (2 × `lastError`). **Every new test was verified
  to fail against the pre-fix sources** (`git checkout HEAD~1 -- <sources>`, new tests kept): 7
  failures with exactly the described symptoms — `['g-anna','g-anna']` for one double-tap,
  `expected ['g-anna'] to include 'g-bram'` for the mid-flush check-in, `lastError` undefined.
- Vitest 886/886 green (85 files), `next lint` clean (only the two pre-existing
  `datetime-field.tsx` aria warnings). No migration. Unrelated env fix: the shared `node_modules`
  lacked `@tanstack/react-virtual` (declared in package.json + lockfile) — `pnpm install` restored it.
  `realtime-throttle.test.ts` sat ~200ms under the 5s default (it does `resetModules()` + a cold
  dynamic import of the door device graph); the extra parallel load tipped it over, so that one case
  got an explicit 20s timeout.
---

## 2026-08-10 — M4 follow-up PR A: cockpit fully on the canonical selector (86ey9c5fp)

Branch `claude/86ey9c5fp-m4-followup-cockpit-dedup`. Part 1 of the M4 review follow-up
(non-blocking findings from the fresh-session `/code-review` of `86ey7dzdc`, PR #—):
client-only, no migration, behaviour-neutral — every touched function returns exactly
what it did before.

- **`src/features/po/eventday/cockpit.ts` no longer hand-rolls any koppen math** (the
  exact duplication M4 exists to kill, flagged non-blocking at the M4 review):
  `arrivedHeads` delegates to the canonical `arrivedHeadsOf` (`../headcount.ts`);
  `cockpitCounts` reads `computeHeadcounts`' row counts (`onListRows`/`onTheWayRows`/
  `insideRows`/`refusedRows`) instead of filtering four times; `perTierLive` no longer
  pre-filters refused before handing rows to `computeHeadcounts` (which filters refused
  itself) — the tier skip now keys on `onListRows === 0`, same outcome. The local
  `onList()` helper is gone.
- **`headcount.ts`: dead `?? 0` removed from `arrivedHeadsOf`** (`plus` is a required
  number) — the no-arrival-count fallback now delegates to `heads(row)`, so "full
  registered party" has exactly one definition and one `|| 0` idiom.
- **Changelog wording fix in the 2026-07-12 M4 entry:** it claimed "`c` joined only on
  non-voided rows" for `venue_event_headcounts`, but the SQL joins `check_ins` without a
  voided filter — `g.status = 'checked_in'` alone gates presence (door_status_sync flips
  a voided check-in back to `approved`). Corrected in place, marked as a 10/8 edit.

Part 2 (the two design decisions — quarter-chart refused-after-checked-in, and
`guest_personal_contribution` charging invisible `pending` guests) is presented to Max
with advice first, per the task; any build lands as its own migration + pgTAP in a
separate PR. Research already done this session: no production flow inserts
`guests.status = 'pending'` (all request paths insert `approved`, the column defaults to
`approved`; `guest_requests` owns the pending lifecycle) — only the seed's Aïcha and raw
PostgREST inserts could produce one. *(Corrected 11/8: that last clause read "RLS doesn't pin
status, `added_by` pinned to self" as if it were a harmless gap. It was the vulnerability —
see the `86ey9c5fp` entry at the top of this file. `guests_insert`/`guests_update` pin the
status column since `20260811160000`, so a raw PostgREST insert can no longer produce one
either.)*

Tests: see PR — vitest suite + lint/tsc (no DB change, no pgTAP needed for part 1).

---

## 2026-08-10 — Event capacity counted on a dead column — hard cap could be overfilled (86ey9e9r9)

Branch `fix/86ey9e9r9-event-capacity-inside-rule` (PR #244). Review finding SW3, verified against the
current effective definitions before touching anything. Milestone: Now (fraud/quota integrity —
a hard room cap that does not hold is worse than no cap). High-risk surface (quota/capacity
triggers) → not self-merged; fresh-session `/code-review` first.

- **Root cause.** `20260624200000_event_lifecycle_capacity.sql` repointed the *personal*-quota
  engine from `events.went_live_at` onto "is the guest physically inside" (a non-voided
  `check_ins` row) when the status machine was retired the same day. The *event-capacity* engine
  (`guest_capacity_contribution`, migration `20260624090000`) was not repointed and kept its
  `p_went_live_at` argument — including in its most recent rewrite,
  `20260714100000_quota_capacity_trigger_locking.sql`. Nothing sets `events.status = 'live'`
  anymore (`changeEventStatus` / `usePoChangeStatus` exist but have zero call sites, and the UI
  has no status control), so `went_live_at` is permanently NULL and the branch guarded by it is
  unreachable.
- **Impact.** A guest who checked in and was then set to `removed` contributed **0** to event
  capacity while still contributing `1 + plus_ones` to the adder's personal quota — the two
  engines disagreed about the same guest, and the room-capacity one under-counted. On a
  hard-capped event that means `enforce_event_capacity` never raises 45005 for those slots, so
  the cap can be filled past its limit by checking people in and removing them. The
  auto-approve path (`submit_via_request_link`) leans on the same 45005 as a guard, so it
  inherited the hole.
- **Fix** (`20260810171500_event_capacity_inside_rule.sql`): `guest_capacity_contribution` takes
  `p_is_inside boolean` and uses the exact same basis as `guest_personal_contribution`;
  `event_capacity_consumption` computes `is_inside` per guest (the `events` join is gone with
  `went_live_at`); `enforce_event_capacity` keeps its advisory-lock serialisation from
  `20260714100000` unchanged and only swaps the contribution basis. The dead
  `(guests, timestamptz)` overload is dropped so the name resolves to one signature, and the new
  overload is re-revoked (a fresh function is granted to PUBLIC by default).
- **Deliberate divergence preserved:** capacity has **no** source exemption — a
  `landing`/`permanent` guest occupies the room; #31 exempts them from the personal fraud limit
  only. Guarded by a test that asserts both halves on the same row.
- **Secondary correction in the same rewrite:** `refused` guests no longer consume capacity
  unless they are inside. The old function only zeroed `denied` and the dead removed-branch, so
  a guest turned away at the door still held their slots — contradicting spec #44 ("refused
  never contributes to on-list/inside anywhere"). The refused-after-check-in case
  (`sync_guest_status_from_refusal` flips the status without voiding the check-in) keeps
  counting via `p_is_inside`, exactly as it does for personal quota.
- **Known asymmetry, unchanged and now documented in the migration:** the cap is enforced by a
  trigger on `guests` only. A check-in that flips a removed guest to `checked_in` computes the
  same `is_inside` for OLD and NEW, so there is no net increase and no cap re-check — parity
  with the quota engine, and deliberate: the door is never blocked by an admin-side limit (#25).
- **Tests.** New pgTAP `event_capacity_inside.test.sql` (12): the removed-but-inside guest keeps
  their slots, capacity and personal quota return the *same* number for that row, the cap
  actually rejects the next guest with 45005 (this insert succeeded before the fix), voiding the
  check-in frees the room again, the landing divergence, refused-frees (#44), and a guard that
  exactly one `guest_capacity_contribution` overload remains. `event_templates.test.sql` D1–D3
  stay green (labels reworded off "before go-live"). Spec §Capaciteitsregel amended.
- **Gotcha for the next session (local stack).** Three sibling worktree sessions were writing
  migrations at the same moment; one had already claimed `20260810100000` and another reset the
  shared local DB mid-run (a `supabase test db` against a DB missing your own migration fails as
  ~15 files "No plan found", not as a clean assertion failure). Verify
  `supabase_migrations.schema_migrations` actually contains your version before believing a red
  suite, and pick minute-precision migration timestamps.

---

## 2026-08-11 — Cockpit check-in flicker + po cache-invalidation gaps (86ey9e9rz)(86ey9e9v5)

Branch `fix/86ey9e9rz-86ey9e9v5-po-cache-invalidation` (PR #259). Two ClickUp tasks combined
(86ey9e9rz confirmed root-cause, 86ey9e9v5 finder — its four points were re-verified against
current `main` before touching anything). Milestone: Now (door speed is a core value — a
guest visibly bouncing back to "onderweg" after check-in is a fraud-resistance/trust issue
at the door, not cosmetic).

- **Root cause (86ey9e9rz).** `usePoCheckIn`/`usePoVoidCheckIn` (`src/features/po/mutations.ts`)
  only cancelled `poKeys.guests` in `onMutate` before their optimistic patch, but the shared
  `optimisticCheckin()` helper writes BOTH `poKeys.guests` AND `poKeys.arrivals`. An in-flight
  arrivals refetch (the cockpit's own polling, or a sibling tab) could land right after the
  patch and silently overwrite it with pre-mutation data — a just-checked-in guest visibly
  snapped back to "onderweg" on the event-dag cockpit. `usePoCheckOut` had the identical bug
  (same helper, same file, not named in the original task) and got the same fix for
  consistency. Extracted a shared `cancelCheckinQueries` helper so the two cancels can't drift
  apart again.
- **86ey9e9v5, re-verified one by one:**
  - (a) `usePoHomeEvents` vs `usePoEvents` — re-checked as NOT a literal duplicate fetcher:
    Home is deliberately windowed to 7 days (PR #229's scale fix), so merging the two queries
    would regress that windowing. The actual bug was that `useInvalidateEvent` (and the two
    create-event mutations) never invalidated `poKeys.home`, so the Home board lagged the
    Events tab by up to one 10s poll after create/cancel/status-change. Fixed there instead;
    PR #228's ad hoc home-invalidation on the lock toggle is now redundant and removed.
  - (b) `usePoEventStats` + `usePoEventActivity` — confirmed duplicate: both called the
    identical `fetchEventStats` 5-RPC bundle under two separate cache keys. Now share
    `poKeys.eventStats`, varying shape with React Query `select` (per CLAUDE.md's "share a
    base query" rule) — mounting both no longer double-fetches, and an invalidation (e.g. the
    check-in realtime hook, which only ever targeted `eventStats`) now refreshes both instead
    of silently leaving the Activity panel stale.
  - (c) `togglePause` in `event-links.tsx` — confirmed: a bare `setQueryData` with no
    `cancelQueries` before it, same race class as the check-in bug. Moved the optimistic patch
    + rollback into `usePoUpdateLink`'s `onMutate`/`onError` (its only caller).
  - (d) `usePoBulkAddToEvent` — confirmed `onSuccess`-only invalidation. Switched to
    `onSettled` (matches `usePoAddGuest`) so a mid-loop exception still reconciles the target
    event's caches.
- Re-checked line numbers/behaviour against recent merges (#235 door-QueryClient singleton,
  #228 Home lock mutation, #229 windowed home poll) before editing — no regressions to any.
- **Tests.** 3 new files (`mutations.checkin.test.tsx`, `mutations.homeInvalidate.test.tsx`,
  `hooks.eventStatsShared.test.tsx`) + additions to `mutations.test.tsx`, one per fix above.
  `pnpm lint` clean, `tsc --noEmit` 0 errors, `pnpm vitest run` on `src/features/po` +
  `src/components/po`: 21 files / 270 tests green (after rebasing twice onto a fast-moving
  `main` — #253's atomic check-out RPC needed the `checkOutGuest` mock added to the new
  `usePoCheckOut` test). No migration — pure React Query cache-layer change.
- **Gotcha hit mid-session:** ClickUp's MCP API was rate-limited for ~975 minutes at pickup
  time, so the task status flip + end-of-session comment for both tasks couldn't be posted
  from this session — needs a manual update or a later session once the limit clears.
- **Open:** PR #259 awaiting Max's manual test pass (handoff questions in the PR body) + merge.

---

## 2026-08-10 — M4 follow-up: kill stale "check_ins has no event_id" comment + embeds (86ey9c5d2)

Branch `fix/86ey9c5d2-checkin-event-id-comment` (PR [#251](https://github.com/Max-Seffelaar/PlusOne/pull/251)).
Mechanical follow-up flagged in PR #189's review round: `20260622140000_checkin_event_scope.sql`
gave `check_ins`/`refusals` a NOT NULL, indexed, trigger-filled `event_id` (+ `venue_id`) back on
22/6, but three read paths still filtered via a `guests!inner(event_id)` embed as if that column
didn't exist — the same false premise that once caused a wrong "fix" to the realtime subscription
filter (see the **2026-07-12** changelog entry below — "UX/IA 8/7 M4: canonical headcount rules" —
and decision #44 in the spec). Milestone: Now (removes a stale trap that already misled one session).

- **`fetchCheckinArrivals`** (`src/features/po/queries.ts`) — replaced the `guests!inner(event_id)`
  embed + `.eq('guests.event_id', eventId)` with a direct `.eq('event_id', eventId)` on
  `check_ins`; rewrote the doc comment that claimed "check_ins carries no event_id".
- **`fetchDoorSnapshot`** (`src/features/door/queries.ts`) — same fix for both the `check_ins`
  and `refusals` ranged reads. Since neither read needs any `guests` field once the embed is
  gone, `select('*, guests!inner(event_id)')` collapsed to `select('*')`, which made the
  `stripEmbeddedGuests` helper (existed solely to drop the now-absent embed before returning
  rows) dead code — deleted. Comments updated, including the module header's RLS claim, which
  was itself stale (said "check_ins/refusals are scoped to those guests" — the live policies
  key on `venue_id`/`event_id` directly, no join through `guests`).
- **`fetchRecentCheckins`** (`src/features/po/queries.ts`) — same stale-embed-as-filter pattern,
  found via the grep sweep (not explicitly named in the task, but the identical mistake). This
  one genuinely needs `guests.id`/`guests.full_name` for the returned rows, so the embed stays;
  only the filter moved from `.eq('guests.event_id', eventId)` to `.eq('event_id', eventId)` on
  `check_ins` directly (and the now-redundant `event_id` dropped from the embed's column list).
- **RLS unaffected — but not because the policies changed.** `check_ins_select`/`refusals_select`
  key on the row's own `venue_id`/`event_id` (`20260622140000`, unchanged since), and
  `guests_select` grants a strict superset of those two branches (same admin/finance/doorhost-on-
  venue and organizer-on-event, plus a `staff`/`added_by=auth.uid()` branch `check_ins_select`
  doesn't have) — pinned by `supabase/tests/database/rls.test.sql` and `checkin_scope.test.sql`.
  So dropping the `guests!inner` join removes a *redundant* filter, not a widening one. This
  reasoning is specific to `check_ins`/`refusals`'s subset relationship to `guests` — it would
  NOT hold for a table whose own policy is broader than `guests_select`.
- **Grep sweep** of `src/` + docs for other live claims that `check_ins`/`refusals` lack
  `event_id`: none found. `useDoorSync.ts`'s realtime-filter comment already states the correct
  fact. `docs/changelog.md` history and the historical `perf-scale-track-3.5.md`/
  `perf-scale-audit-megaevent.md` audit docs were left untouched (dated snapshots of past state,
  not live documentation).

**Fresh-session `/code-review` before merge (per the review gate — touches the door snapshot
read path), 2026-08-11 — 15 findings survived verification, all addressed:**

- **Rebase conflict with PR #253** (merged to `main` after this branch was cut) — #253 rewrote
  the same `fetchCheckinArrivals` lines to add `id` to `CheckinArrival`/`CheckinArrivalRow`
  (row-scoped offline check-out, #35). Resolved keeping BOTH: `id`/`.select('id, guest_id, …')`
  from #253, `.eq('event_id', eventId)` (no embed) from this PR.
- **Swallowed read errors in `fetchDoorSnapshot`** — the `Promise.all` destructured `venues`/
  `guest_tiers` without checking `error`, and a swallowed `venues` error would resolve
  `allowUncheck` to `true` (via `?? true`) on a venue with uitchecken actually OFF — the door
  would show the uncheck button, queue an offline void, and only get rejected at outbox replay
  by the RESTRICTIVE `check_ins_void_requires_uncheck` policy, after the UI already misled the
  doorhost. Now both errors are checked and thrown.
- **Unbounded `.in()` on `user_profiles`** — the `added_by`/`note_acknowledged_by`/`checked_by`
  id set was passed to `.in()` unchunked (CLAUDE.md: chunk to ≤120), the exact anti-pattern the
  surrounding comment warns against nine lines above. Chunked via `chunkIds` (already imported
  by this file's neighbor `paging.ts`) at 120; the error from each chunk is now also checked
  instead of falling back to `.data ?? []`.
- **`fetchCheckinArrivals` filtered `voided_at` in JS** — `fetchRecentCheckins` already does
  `.is('voided_at', null)` server-side; moved the same filter server-side here (`check_ins.guest_id`
  is UNIQUE, so this can't under-return) and dropped `voided_at` from the select/type.
- **Migration citation was half-right** — `20260622140000` made the column fill-when-null, not
  trustworthy against a forged write; `20260713190000_checkin_scope_venue_pin` is what made it
  unconditionally server-derived. Both are now cited where the trust claim is made.
- **No test pinned the filter shape** — reverting any of the three fixes to the embed pattern
  would have passed the full suite. Added `tests/unit/checkin-event-id-scope.test.ts`, a
  regression guard using a new shared `tests/unit/helpers/spy-client.ts` (promoted from the
  single-table spy in `scale5-venue-scope.test.ts`, now itself refactored onto the shared
  helper) — asserts all three reads issue `.eq('event_id', …)` and never `.eq('guests.event_id',
  …)`. Verified the guard actually catches the regression: hand-reverted `fetchDoorSnapshot`'s
  `check_ins` read to the old embed pattern, confirmed the new test fails, restored the fix.
- **Directionality/date error in this entry's own back-pointer** — fixed above ("above" → the
  2026-07-12 entry is below in this newest-first file; "13/7" → the entry is dated 2026-07-12,
  13/7 was a `/code-review` sub-section within it).
- **Changelog's "door outbox surface" mislabel** — the outbox is `src/features/door/outbox/`;
  this PR touches `src/features/door/queries.ts`, the snapshot *read* path. Fixed here and in
  the review-gate line below.
- **CLAUDE.md's scale-rule list of `venue_id`-carrying tables didn't mention `check_ins`/
  `refusals`** despite them carrying `event_id`+`venue_id` since 22/6 — exactly the kind of
  "which tables can I filter directly" fact a future session forms its mental model from.
  Added a clause.
- **Duplicated ranged-event-scope reads lost their cross-references** when `stripEmbeddedGuests`
  (whose docstring said "one helper serves both tables") was deleted. Restored
  `fetchDoorSnapshot` ↔ `fetchCheckinArrivals`/`fetchRecentCheckins` breadcrumb comments. **Not
  done:** extracting a shared `eventScopedRanged(client, table, eventId, columns)` helper next
  to `fetchAllRanged` — the three call sites have different columns and one has an extra
  `.is('voided_at', null)` filter, and typing a generic PostgREST chain wrapper without `any`
  turned out to be more machinery than three call sites justify. Flagged for Max instead of
  built; comments are the proportionate fix until/unless a fourth call site appears.
- Fixed the unbalanced paren in this entry's own `select('*, guests!inner(event_id))')` quote
  (one `)` too many) and the "1h17m install" aside is `pnpm install` contention from concurrent
  sessions on this machine, not a repo problem — left as-is, just noting it's not a regression
  risk.

**Deferred, not built — needs Max's call:**
- **`check_ins.event_id` isn't re-pinned if a guest moves events post-check-in.**
  `set_checkin_scope()` only fires on `check_ins`/`refusals` writes, never on a `guests` update;
  `guests_update`'s RLS re-checks write access but nothing re-derives `check_ins.event_id`. Not
  reachable today (`updateGuest` never patches `event_id`), so this is latent, not exploitable
  via any current UI/API path. Two options if Max wants it closed: (a) a `pin_guest_event`
  trigger + pgTAP proving a guest-event move is rejected (new migration), or (b) a comment at
  each read recording that `check_ins.event_id == guests.event_id` is now load-bearing and must
  stay true. Neither built this session — needs a decision, not more code.
- **`select('*')` on `check_ins`/`refusals` in `fetchDoorSnapshot`** fetches several columns the
  door never reads (all ids/timestamps/flags, no PII beyond `refusals.reason` which IS rendered
  and must stay). Not a regression (pre-PR was `'*, guests!inner(event_id)'`, same breadth) and
  narrowing isn't a one-liner — `CheckInRow` is also built in full by `DoorProvider.tsx`'s
  optimistic paths and realtime, so narrowing needs a `Pick<>` + a `projectDoorCheckIn` mirror +
  its own drift guard, mirroring `DOOR_GUEST_SELECT`/`projectDoorGuest`. Recommend deferring
  unless Max wants P-IDB7 extended to non-PII payload trimming for consistency.

**Tests:** `pnpm vitest run` 418/418 green on the touched suites (door, po, the new/refactored
`tests/unit/*`), full suite unchanged elsewhere. `tsc --noEmit` zero errors. `pnpm lint` clean.
No migration — behaviourally neutral for RLS visibility (see above), so no new pgTAP; the F4
trigger question is explicitly deferred, not silently skipped.

**Review gate:** touches `src/features/door/queries.ts` (door snapshot read path, not the
outbox) — got the fresh-session `/code-review` above before merge, per CLAUDE.md's review gates.

---

## 2026-08-10 — Scale: tier occupancy + request-link reads/funnel now DB-aggregated (86ey9e9wv)

Branch `perf/86ey9e9wv-scale-tiers-links-funnel` (PR #260). Milestone: Now (scale/front-end
discipline from the 2026-07 engineering review). Three fetchers in `src/features/po/queries.ts`
violated "aggregate on the database, never download every row and sum in JS" / "reads must be
windowed at large N" — fixed with DB-side aggregation + windowing. **A fresh-session
`/code-review` at max effort found 15 further issues in the first version of this fix** (4
blocking, 5 should-fix, cleanups, 2 design decisions put to Max) — this entry describes the
repaired, merged state; see PR #260 for the full finding list and fix-by-fix response.

- **`fetchTiersWithUsage`.** Downloaded every guest row of the event (`tier_id`, `status`) and
  summed per-tier occupancy in JS, re-fetched on every check-in. The ClickUp ticket suggested
  reusing `event_tier_stats` — **re-verified and rejected**: `event_tier_stats`'s "registered"
  counts only `approved`/`checked_in`, but the tier-max occupancy bar must match
  `guest_tier_contribution`/`tier_consumption` (the actual capacity-trigger semantics), which
  excludes only `removed`/`denied`. The review's first pass re-typed that exclusion rule as a
  literal instead of calling `guest_tier_contribution` directly — a duplicate copy that could
  silently drift from the trigger on a future `guest_status` addition. Fixed properly: the new
  `event_tier_occupancy(uuid)` RPC now delegates to `guest_tier_contribution(g)` itself (granted
  `EXECUTE` to `authenticated` for the first time — it was quota-engine-internal before), so the
  two can never disagree.
- **`fetchRequestLinks` funnel counting + `fetchVenueRequestLinks`'s influencer lookup.** The
  `guest_requests` read for per-link requests/approved had no `.range()`; the venue-wide link
  read's influencer lookup chunked an unbounded `.in()` id list at the wrong size (`chunkIds`'
  1000-default renders ~37 kB of query string — CLAUDE.md's own measured 414 threshold is ~210
  ids); and the hand-rolled `approvedHeads`/`checkedInHeads` JS counted denied/refused guests as
  full headcount (the real cap, `link_headcount_contribution`, does not) and used registered
  `plus_ones` instead of `plus_ones_arrived` for checked-in heads (the #44 overcount, already
  fixed elsewhere). Rather than add a THIRD place computing "heads through this link" with its
  own scoping, **`fetchRequestLinks` was folded onto the existing `event_link_funnel` RPC**
  (`20260707100000_promotion_dashboard_rpcs.sql`, already used by the Promotion screen and
  already correct on both counts) — widened with `approved`/`tier_id`/`created_at` (a
  `returns table` widening needs drop+recreate, Postgres rejects it under `create or replace`,
  so its grants had to be explicitly re-declared). This deleted the four batched reads, both
  funnel `Map`s, and every client-side heads loop — nothing left in `fetchRequestLinks` to get
  wrong. `fetchVenueRequestLinks`'s influencer lookup now filters `.eq('venue_id', venueId)`
  directly instead of chunking an `.in()` id list at all (an organizer's `influencers` RLS grant
  is venue-wide even though `request_links`'s is per-event, so this can resolve a few names the
  caller's own links never reference — harmless, just unused map entries).
- Migration `20260810190000_scale_tier_occupancy_link_funnel.sql` (re-stamped after
  `20260810183000` post-rebase — the first version sorted BETWEEN two already-merged migrations,
  which `supabase db push --include-all` would have needed to catch). Both RPCs' grants are
  explicit (`revoke … from public, anon[, authenticated, service_role]` +
  `grant … to authenticated, service_role`), matching the `venue_event_headcounts` precedent —
  the first version relied on the Postgres default (`EXECUTE TO PUBLIC`), which `anon` could call
  (harmlessly, since `guests`/`guest_requests` RLS still denies the underlying read, but a lost
  second lock nonetheless).
- **New CI guard**, `tests/unit/rpc-migration-exists.test.ts`: scans every `client.rpc('name')`
  literal in `src/` against every `create [or replace] function public.<name>` in
  `supabase/migrations/`, so code that calls an RPC no migration ever created fails `pnpm test`
  instead of silently 404ing in prod for however long it takes someone to notice (CLAUDE.md's
  migration-before-code expand–contract flow assumes the migration is pushed before the code
  deploys; this PR's own migration briefly wasn't, per the note on `fetchEventHeadcounts`).
- pgTAP: `analytics.test.sql` §12 covers `event_tier_occupancy` (per-status inclusion, the staff
  RLS-scoping, and its privilege grants) using an **isolated fixture event** (`e2../d2../c2..`
  ids, with an explicit `event_quotas` override so it doesn't silently lean on the seed's default
  quota) rather than the shared seed event — the shared local Supabase stack is used concurrently
  by every worktree session against the same fixed seed ids, so exact-count assertions against
  the shared event are flaky by construction (confirmed while first writing this: the seed's
  Regular/VIP tier counts drifted between two otherwise-identical runs). `promotion_stats.test.sql`
  gained the `approved`/`tier_id`/`created_at` coverage plus `event_link_funnel`'s privilege
  grants, extending its existing fixture rather than duplicating one. Full suite: pgTAP 1049
  (was 1005), vitest 1118 (was 857, incl. unrelated `main` growth from other merges).
- No client-facing behaviour change: same shapes, same numbers, same RLS-scoped visibility —
  purely a where-the-aggregation-happens change.

## 2026-07-14 — Door outbox/cache not wiped on sign-out — shared-device isolation (86ey9et07)

Branch `fix/86ey9et07-door-outbox-clear-on-signout` (PR #233). Follow-up carved out of the
adversarial security-review of PR #212 (door-outbox durability, `86ey9e85u`) — the leak is in
the logout lifecycle, not #212's outbox-merge/lock code. Milestone: Now (security/AVG + audit
integrity on shared venue tablets). **Scope was widened after a fresh-session `/security-review`
of the first (narrow) fix found it insufficient** — five confirmed gaps, incl. a verified
account-takeover on the "log out everywhere" button. Max chose the robust fix over merge-and-defer.

- **Root cause.** The door persists to the origin-scoped `plusone-door` IndexedDB under two
  keys — `door-outbox` (the offline queue: guest UUIDs, arrival times, refusal reasons, plaintext
  guest names on `add_guest`) and `door-query-cache` (the full guest-list snapshot). `idbClearAll()`
  existed but was wired up **nowhere**; `signOutDevice` only did `auth.signOut()` + redirect. On a
  shared door tablet: (1) doorhost B could read A's queued PII from IndexedDB via devtools (no XSS),
  and (2) A's un-synced entries would replay under B on the next login, attributing A's check-ins to
  B in the append-only audit trail.
- **Why the naive fix wasn't enough.** "Delete the IDB + navigate, let the reload clean up the rest"
  doesn't hold on a shared device with sibling tabs, throttled writes, a module singleton, and an
  auth client that returns (not throws) on a failed revoke. The security review (verified against the
  real code) surfaced five gaps; the robust fix addresses each:
  1. **Sibling-tab blocks the delete (`#1`).** `openDb()` set no `onversionchange`, so a second door
     tab (Deur tab + standalone `/door/[id]`) kept its connection open → `deleteDatabase` blocked
     forever → A's data survived. Fix: every connection gets an `onversionchange` that closes it, so a
     sibling releases and the delete completes. (`idb.ts`)
  2. **In-memory outbox singleton (`#2`).** `outbox` is module-scoped and outlives a route change.
     Added `OutboxStore.reset()` (clears `entries`, sets `loaded=false`) called on sign-out, so the
     next doorhost inherits nothing and their `init()` re-reads the clean DB. (`outbox/store.ts`)
  3. **Re-persist race (`#3`).** A throttled persister write or an in-flight `persistMerged` could
     re-create the just-deleted DB with A's data. Added a wipe **epoch** in `idb.ts` (bumped by
     `idbClearAll`); the persister captures it when arming its timer and the outbox captures it when
     starting a read-merge, and both drop the write if the epoch moved. No permanent tombstone, so the
     next user's writes still work. (`idb.ts`, `persister.ts`, `outbox/store.ts`)
  4. **Lingering session → account-takeover (`#4`, the severe one).** Verified against
     `@supabase/auth-js@2.108.1` `GoTrueClient._signOut`: on a server-revoke error that isn't
     401/403/404 (e.g. a 5xx on flaky venue wifi) it `return`s `{ error }` **before** `_removeSession()`
     and **does not throw** — A's tokens stay on the device. Navigating to `/login` then lets
     `middleware.ts` ("a signed-in user has no business on /login → /app") hand the next user a live
     session **as A**. Fix: `signOutDevice` now verifies via `getSession()` that no token remains before
     redirecting, retries a local-scope sign-out once (clears local tokens on a 401/403), and if a
     session still remains (truly offline) **throws instead of redirecting** — the caller surfaces the
     failure and the device stays put rather than silently handing off an account. (`_shared.tsx` +
     error handling in `settings.tsx`/`profile.tsx`, new `signOutFailed` copy)
  5. **Completeness (`#5`).** The persisted `door-query-cache` is wiped by `idbClearAll`; the in-memory
     RQ cache is component-scoped (the door query client lives in `DoorQueryProvider` and is dropped on
     unmount), so no extra `queryClient.clear()` plumbing was warranted. `localStorage` device-id is
     intentionally stable (device attribution) and left as-is.
- **`idbClearAll` hardening (from the first pass).** Closes its own tracked connection before
  `deleteDatabase` so the delete isn't deferred via `onblocked` until navigation.
- Tests (all against a real in-memory IndexedDB where relevant; `fake-indexeddb` added as a
  devDependency): `sign-out.test.ts` (new, 7 cases — both door keys empty after sign-out, in-memory
  `outbox.reset()`, scope + redirect, the `#4` fail-safe both cleared-on-retry and offline-throws
  paths); `persister.test.ts` (+1: epoch-guarded trailing write dropped); `store.test.ts` (+2:
  `reset()` empties the queue, in-flight commit doesn't re-persist after an epoch bump).
- Suites green on a fresh run: Vitest **843 passed** (76 files), `tsc --noEmit` clean, `pnpm lint`
  clean. High-risk surface (door outbox + auth) → the widened fix needs a **re-run** of fresh-session
  `/code-review` + `/security-review` before merge (the checkout-mismatch note: the first review ran
  against `main` + the inline prompt, not the branch — re-point it at the branch).

---

## 2026-07-17 — behavioural CI guard: /app must render events, even in a never-painted tab (86eyaz44q)

Follow-up to 86eya4yuf/PR #237. That fix already had a *structural* guard
(`tests/unit/app-shell-no-ssr-suspense.test.ts`). This task adds the *behavioural* layer so
the "Home/Deur silently shows no events" failure can never ship unnoticed again — Max's ask
after the fix landed.

- **New e2e `tests/e2e/app-home-events-visible.spec.ts`** (door@, read-only against the seed's
  always-upcoming `PLUSONE Launch Night`), two tests: (1) `/app` renders event cards on a
  normal load — the broad "empty board" guard, also catching future data/RLS/windowing
  regressions; (2) the same load with `requestAnimationFrame` stubbed to a no-op — the exact
  precondition of the hydration hang (a never-painted tab). Terms pre-accepted via the
  `acceptConsent` admin helper so dev-login lands straight on `/app`, no consent gate.
- **Wired into CI:** `e2e:smoke` now runs this spec alongside `core-flow.spec.ts`, so the
  required `lint-and-test` job enforces it on every push.
- **Proven to discriminate (the point of the exercise).** On the shipped `ssr:false` mount:
  both tests green (`2 passed`). Temporarily restoring the pre-#237 `<Suspense><PlusOneApp/>`
  shape: the rAF-starved test fails — `getByText('PLUSONE Launch Night')` times out, board
  never renders. So the test genuinely catches a regression that a normal headless run (which
  paints, so rAF fires) would miss. Safe because `/app` content is CSS-animated
  (tailwindcss-animate) and React commits via its MessageChannel scheduler — neither is
  gated on rAF.
- **Docs:** CLAUDE.md line-58 invariant now names both guards + generalises the rule to any
  route root (a client component that suspends during SSR must mount `ssr:false`, never under
  a page `<Suspense>`); a matching hard "don't do this / never weaken these guards" line added
  to *What NOT to do*.
- **Suites:** type-check clean; lint clean (only the 2 pre-existing `datetime-field` ARIA
  warnings); `app-shell-no-ssr-suspense` + `claude-md-references` green. No migration, no
  runtime code touched — tests + docs + one `package.json` script.

## 2026-07-15 — /app never hydrated in unpainted tabs → Home/Deur "no events" (86eya4yuf)

Demo-blocker reported as "Home board + mobile Deur tab show NO events while the Events tab
works". PR pending on `fix/86eya4yuf-home-door-no-events`. Two real defects found; the
headline one is NOT the suspected 7-day window but a hydration hang.

- **Root cause (MODE B, reproduced deterministically + proven end-to-end).** The /app page
  rendered `PlusOneApp` directly under `<Suspense fallback={null}>`. `useSearchParams()`
  suspends during SSR, so the ENTIRE shell streamed as a late `$RC("B:0","S:0")`-completed
  boundary. Next 15.5.19's inline fizz runtime gates that boundary's reveal (`$RV`) — and
  React's hydration retry (`comment._reactRetry`) — on `requestAnimationFrame`, with no
  timeout fallback while `$RT` is unset (i.e. before a first paint). A tab that loads
  without painting (opened in the background, headless webview) never fires rAF → the
  boundary never reveals (blank page) or reveals but never hydrates (static SSR HTML).
  Either way ZERO queries mount and ZERO fetches fire, forever — and the SSR zeros render
  as a plausible, settled "no events" board. Foreground loads hydrate normally, which is
  exactly why the Events tab "worked" when navigated to directly (each sidebar click was a
  full page load in a visible tab). Diagnosed by fiber-walking the live page (140-node
  committed tree, `dehydrated: true`, `lanes: 0`); proven by manually running the starved
  `$RV(window.$RB)` + `_reactRetry()` in the stuck tab → 13 REST fetches fired instantly
  and all 7 events appeared.
- **Fix.** `src/components/po/app-client.tsx`: mount the shell via `next/dynamic` with
  `ssr: false` (honest boot mark instead of fake-zero SSR HTML); the server never suspends
  on the shell, so the streamed boundary no longer exists (verified: /app HTML now has 0
  pending markers / 0 `$RC` calls). Client-render markers hydrate on the normal,
  non-rAF-gated path. CI guard `tests/unit/app-shell-no-ssr-suspense.test.ts` pins both
  halves (page must import `app-client`, wrapper must keep `ssr: false`). The standalone
  `/door/[eventId]` route was checked and is immune (no `useSearchParams`, synchronous
  client tree); no other page-level `<Suspense>` exists under `src/app`.
- **MODE A (windowed door pick, 86ey9e8gt regression) also fixed.** `usePoDoorEvent` fed
  7-day-windowed rows into `pickDoorEvent`, whose last-resort fallback is "most recent
  already-started event" — a venue whose newest event is >7 days old resolved to null. Now
  fetches unwindowed (one-shot, single `venue_id`, no 414 risk); the stale "windowed is
  safe" comment is corrected. Note: the hook currently has NO call sites (Deur tab uses
  `usePoDoorCandidates`, already unwindowed; Home's windowed board cutoff is deliberate
  M11 behaviour) — fixed anyway so the next caller doesn't inherit the trap.
  `usePoDoorCandidates` still drops `past` events by design (Max 7/7: picker offers
  live/future only; late check-outs go via the direct `/door/[eventId]` URL).
- **Live verification** (fresh dev server, worst-case permanently-hidden tab, door@):
  Home renders "Club Vesper · 7 upcoming" with the full board, Deur tab shows the 7-event
  picker and opens PLUSONE Launch Night's check-in list (25 on the way / 8 inside,
  realtime connected), Events tab lists all 7 — all with zero manual intervention.
- **Watch-outs for later sessions.** (1) The local repro environment was churned: the
  sibling worktree's dev server on :7000 was half-dead (6.9s /login, intermittent
  connection-refused) and this worktree's node_modules was incomplete — neither was the
  bug. (2) Prod-drift check still open: migration `20260714171523` (two-arg
  `venue_event_headcounts`) merged 14/7; if prod hasn't had `supabase db push` since, the
  deployed Home ALSO breaks with PGRST202 (Events tab unaffected) — run the prod-push flow.
- Tests: vitest 847/80 files green (+4 new), `tsc --noEmit` clean, lint clean (pre-existing
  warnings only). No migration. Files: `src/app/app/[[...segments]]/page.tsx`,
  `src/components/po/app-client.tsx` (new), `src/features/po/hooks.ts`,
  `src/features/po/door-event.test.ts`, `src/features/po/hooks.doorEvent.test.tsx` (new),
  `tests/unit/app-shell-no-ssr-suspense.test.ts` (new).

---

## 2026-07-14 — First Load JS afslanken: Sentry defer + lazy phone + QuickAdd split (86ey9e8z5)

DONE — PR [#236](https://github.com/Max-Seffelaar/PlusOne/pull/236) (`perf/86ey9e8z5-first-load-js`),
merged to main. Three levers on the measured bundle (before → after via `pnpm build`); tested live by
Max on the local stack.

- **Lever 1 — Sentry off every route (biggest win).** `instrumentation-client.ts` used to
  `Sentry.init` synchronously, pinning the ~131 kB gz browser SDK into the First Load of EVERY route
  (offline door + public guest links included). Now a lazy facade
  (`src/lib/observability/sentry-client.ts`, `import type` only) idle-loads the SDK
  (`requestIdleCallback`) from a new `src/sentry.client.init.ts`; every client caller (app shell,
  `PoLiveProvider`, `DoorProvider`, `outbox/store`, `capture`, `global-error`) routes through it.
  **Pure defer — no route loses coverage** (deliberately NOT a per-route exclusion; the door stays
  instrumented). Facade `.catch()`es a failed chunk fetch so the door's offline path (#25) never
  throws. **Shared-by-all 189 → 105 kB.**
- **Lever 2 — QuickAdd split** out of the `/app` page entry via `next/dynamic` from its leaf module
  (dropped from the guests barrel re-export). Guarded by `app.code-split.test.ts`.
- **Lever 3 — lazy phone field** (`src/components/po/phone-lazy.tsx`): `react-phone-number-input`
  (flags + libphonenumber, ~102 kB gz) code-split; all 5 consumers import
  `CountrySelect`/`PhoneInput`/`isPhoneValid`/`phoneCountryOf`/`useStoredPhoneCountry` from there.
  Validators deferred (async); the render-time `parsePhoneNumber` "initial flag" derive moved to an
  effect. Country locale switched to English (`en.json`); dimension-matched skeletons so the field
  fills in without a flash. **Public `/e`+`/r` 330 → 141 kB (−57%), `/consent` 331 → 142 kB.**
- **Net:** `/app` 540 → 346 kB (−36%), `/door/[eventId]` 373 → 288 kB, every other route −83…−85 kB.
- **Guardrails:** `tests/unit/{sentry,phone}-lazy-imports.test.ts` fail CI if a static import of
  `@sentry/nextjs` / `react-phone-number-input` creeps back into a first-load graph.
- **Tests:** `pnpm build` exit 0, type-check + lint clean, `pnpm vitest run` 839 passed
  (`store.test.ts` mocks the facade). Live: `/app` + public `/e`/`/r` zero console errors; Sentry
  loads as a deferred async chunk; English country picker (245 countries); door + Sentry tests ✅.
- **Follow-up (pre-existing landing validation UX, out of scope):** red errors, name-required,
  stronger e-mail check → task 86eyd3men.
- **Gotcha:** the Sentry init module must NOT be named `sentry.client.config.ts` (the Sentry Next.js
  plugin auto-registers that filename as an eager entry, which would undo the split).

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
   filter (where g.status = 'checked_in')` — the join carries no voided filter;
   `g.status = 'checked_in'` alone gates presence (the door_status_sync trigger flips a
   voided check-in back to `approved`). Exact arrived heads where `check_ins` is readable,
   the old full-party behaviour where it isn't (a hidden row joins to `null`, `coalesce`
   falls back). *(Wording corrected 10/8, `86ey9c5fp` — this entry originally claimed "`c`
   joined only on non-voided rows", which the SQL never did.)* New pgTAP case covers staff
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
