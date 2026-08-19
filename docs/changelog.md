# Changelog — shipped-phase history

Session-end status reports live here, **newest first**. CLAUDE.md holds only current
invariants and open work; when a task ships, its narrative (PRs, commits, root causes,
gotchas) is appended here instead of CLAUDE.md. Older history than this file covers:
`launchplan-claude-code.md` (STAP 0–4 framing), `docs/test-report.md`, the `perf-*.md`
records (repo root), and `engineering-review-2026-07.md`.

---

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
