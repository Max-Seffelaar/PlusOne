# Changelog — shipped-phase history

Session-end status reports live here, **newest first**. CLAUDE.md holds only current
invariants and open work; when a task ships, its narrative (PRs, commits, root causes,
gotchas) is appended here instead of CLAUDE.md. Older history than this file covers:
`launchplan-claude-code.md` (STAP 0–4 framing), `docs/test-report.md`, the `perf-*.md`
records (repo root), and `engineering-review-2026-07.md`.

---

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
