# CLAUDE.md — Gastenlijst SaaS

Multi-tenant guest list SaaS for venues (clubs, event spaces). Hundreds of venues, dozens of events/month each, 50–150 guests per event. Core values: **fraud resistance** (everything audited), **door speed** (offline-tolerant check-in), **quota enforcement** (staff get limited guest list slots).

The full functional spec lives in `gastenlijst-app-spec.md` (repo root). Decision numbers (#1–#39) point to the decision table in that spec. When in doubt, the spec wins. If code and spec conflict, flag it — never silently deviate.

**This file holds current invariants and open work only.** Shipped-phase history (PRs, root causes, gotchas) lives in `docs/changelog.md` — session-end status reports go THERE, newest first; CLAUDE.md changes only when an invariant changes.

## Stack (fixed — do not substitute)

- **Next.js 15, App Router, TypeScript strict** — PWA. Hosted on **Vercel, region `fra1` only**.
- **Supabase** (project region `eu-west-1`, Ireland, ref `tolxwgqhppdcvnogdpel`): Postgres, Auth, Realtime, Edge Functions.
- **Tailwind + shadcn/ui**. **TanStack Query** with IndexedDB persistence for offline.
- **Zod** for all input validation. **Vitest** (unit), **Playwright** (e2e), **pgTAP** via `supabase test` (RLS/triggers).
- Package manager: **pnpm**.
- Keep `@supabase/ssr` aligned with `@supabase/supabase-js` (≥`0.12` for js `2.108`) — a stale `ssr` pin makes the typed client resolve every `.from()`/`.rpc()` to `never`.

## Non-negotiable architecture decisions

1. **RLS is the security boundary.** Every table has Row Level Security enabled. App-layer checks are convenience, not security. A user with the anon/auth key and raw API access must never be able to read or write outside their memberships.
2. **All primary keys are UUIDv7, generated client-side** for entities that can be created offline (`guests`, `check_ins`, `refusals`). All writes from the offline outbox are idempotent upserts. (#25)
3. **Soft delete only.** Guests are never hard-deleted; status becomes `removed`. Hard DELETE is revoked for app roles at the database level. (#21)
4. **Audit log via Postgres triggers**, not application code. Triggers on `guests`, `quotas`, `event_quotas`, `guest_tiers`, `check_ins` write actor, action, and JSONB before/after diff. Never write audit entries from app code; never bypass.
5. **Quota math:** a guest with `plus_ones = N` consumes `1 + N` slots. Removal frees the slot unless already checked in (#22, revised 2026-06-24). Enforce in the database (trigger/constraint), not only in UI.
6. **List lock:** when `events.list_locked = true`, RLS rejects guest mutations from staff-role users; admin, organizer, and doorhost (within quota, at the door) retain write access. Lock/unlock is its own audit action. (#23)
7. **Users exist independently of venues.** Access flows through `venue_memberships` (roles array) and `event_organizers` (event scope). Removing a membership never deletes the user or touches their other venues/events. Only the user can change their own email. (#24)
8. **Multiple roles per user per venue.** Never model role as a single column.
9. **Stats and quotas hang on the event, never the calendar day.** Events cross midnight. (#26)
10. **No ticketing integrations in the core. No outbound invitations (mail/WhatsApp).** Read-only ticketing connectors are a phase-3 layer (#36).
11. **Native apps are planned, not optional (#37).** MVP is a browser PWA; the same codebase gets wrapped with Capacitor (remote-URL model) for both stores. Never introduce a feature that would force a rewrite at wrap time — see the Capacitor checklist below.

## Auth (decision #20)

- Supabase Auth, **passwordless only**: e-mail OTP (6-digit). Password auth disabled in project settings.
- **Invite-only.** Public signups disabled; accounts created exclusively through admin/user-manager invitations.
- **MFA (TOTP) is fully OPTIONAL for every role, including `admin` and `finance`** (decided 2026-07-01 — friction trade-off accepted deliberately by Max; migration `20260702120000_mfa_fully_optional`). **No hard gate and no AAL2 requirement in RLS anywhere** — all privileged actions are role-only. Admin/finance get a skippable enroll recommendation (`recommendMfaIfDue`, snooze on `user_profiles.mfa_snooze_until`); any role can self-enable/disable MFA from the profile. **Ask-first presentation** (decided 2026-07-09, UX/IA 9/7): `recommendMfaIfDue` never fires until 24h after `user_profiles.terms_accepted_at` (not `user.created_at` — the auth row is created when the invite is *sent*, not when the invitee first logs in), and the live `/app` guard (`src/app/app/layout.tsx`) runs the consent gate before it — a fresh invitee sees the app/terms first, the security nudge later. (`requireAppAccess` in `guards.ts` documents the same order but has no live call site today.) `MfaEnrollCard` is two-step: explanation + 3 actions first, QR/verification only after "Set up now" (no auto-enroll on mount). The step-up sheet (`useMfaGate`) is plumbing for voluntary enrollment only. Do not reintroduce an AAL2 gate without an explicit decision.
- Short-lived access tokens, refresh rotation on. Admin screen for per-user session list + remote logout.
- The `service_role` key only ever appears in server-side code. If it shows up in client-bundled code, stop and fix immediately (a secret-grep guard in `pnpm test` enforces this).
- Invite/resend mail goes through `src/features/auth/invite-mail.ts` `sendInviteEmail` (invite-first, magic-link fallback — `signInWithOtp` hard-refuses unconfirmed accounts). Crew provisioning uses `inviteUserByEmail`, never `admin.createUser` (sends no e-mail).

## Billing (decision #32 — live)

- **Stripe Billing**; payment methods **SEPA Direct Debit + iDEAL only**. An iDEAL confirmation sets up the SEPA mandate for renewals.
- **Abstraction layer is mandatory.** Entitlement is read exclusively from the `subscriptions` table (`trialing` / `active` / `past_due` / `canceled` / `comped`). All Stripe interaction lives in `src/features/billing/` behind the `BillingProvider` interface (a vitest guard fails if `stripe` is imported elsewhere, incl. dynamic imports). Without `STRIPE_SECRET_KEY` the stub provider serves keyless local dev/CI.
- **Prices are config-driven:** the Stripe dashboard owns amounts; the app knows only env price ids (`STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_TAX_RATE_ID` for 21% BTW). No publishable key — hosted Checkout/Portal are pure redirects.
- Stripe state flows in via **webhooks only** → `POST /api/webhooks/stripe` (middleware exempts `/api/webhooks/` — auth is the signature). Signature over the raw body; idempotency via the `stripe_webhook_events` ledger + the service_role-only RPC `apply_stripe_subscription_update` — replay mutates nothing. This is the documented service-role exception (security-reviewed 2026-07-06).
- **Trial: 14 days, soft block.** A lapsed trial blocks admin features (`src/features/billing/gate.ts` on create-event/from-template/invite/import) but NEVER the door of planned events or data access. `past_due` grace is delegated to Stripe dunning; the app only renders the banner. The door outbox and guest mutations on planned events are deliberately never gated.
- `comped` = pilot venues without billing; set manually (SQL runbook in `docs/stripe-setup.md`), audited, **never overwritten by webhook state** (guard in the RPC).
- **Store-tax (Apple IAP):** the native shell shows billing **read-only** — no checkout/portal/pricing/upgrade UI, not even a link; seam = `isNativeShell()` (`src/lib/platform.ts`).
- Never store card/IBAN details; we persist only `stripe_customer_id`/`stripe_subscription_id`. Setup + test-mode script: `docs/stripe-setup.md`; go-live checklist ClickUp `86ey6bga8`.

## Design & surface (decision #38)

**The UI layer is implemented in `src/` and is the source of truth — reuse and extend it, never regenerate a screen.** A UI phase means building the backend under an existing screen and replacing mock data with live Supabase data while preserving the component API (Werkwijze v2, `bouwplan-claude-code.md`).

- **One responsive surface:** the `po` app at `/app` (`ResponsiveShell` — mobile bottom-tabs <1024px, desktop sidebar ≥1024px). Every authenticated entry lands on `/app`; the old `(app)` dashboard routes (incl. `/eventday`) redirect there. The Event-dag cockpit is the desktop variant of the Deur tab.
- `src/components/po/` — kit (`kit.tsx`, `icon.tsx`, `shell.tsx`), shell + nav (`app.tsx`, `context.tsx`, `routes.ts`), screens under `src/components/po/screens/`. Data via `src/features/po/` (React Query reads over the browser client + `src/features/*` server actions for writes). Desktop density per-screen via the `WIDE_DESKTOP` map in `app.tsx`.
- **Every screen has a real, bookmarkable URL (G1)** — `src/components/po/routes.ts` is the canonical `screenPath`/`tabPath`/`doorPath` ↔ `parseAppUrl` scheme; `app.tsx` derives the active screen from `usePathname()`/`useSearchParams()` on every render (no in-memory nav stack, no sessionStorage restore-after-refresh hack). Identity/venue resolution + `PoLiveProvider` live in `src/app/app/layout.tsx`, which stays mounted across screen navigations — `[[...segments]]/page.tsx` itself does zero server data work (no `searchParams` read) so query-string-only navigation (door overlay, event picks) stays fully client-side; this matters for the door's offline invariant (#25), not just performance. The shell mounts via `src/components/po/app-client.tsx` (`ssr: false`, 86eya4yuf) — **never render `PlusOneApp` under a server-streamed Suspense boundary**: `useSearchParams` suspends during SSR and Next 15.5's rAF-gated boundary reveal never hydrates in a tab that hasn't painted (background tab/webview) → the whole app sits on zero-filled SSR HTML with zero fetches, forever. Guards (both in the CI-required `lint-and-test`): `tests/unit/app-shell-no-ssr-suspense.test.ts` (structure — page mounts via `app-client`, `ssr:false` kept) + `tests/e2e/app-home-events-visible.spec.ts` (behaviour — `/app` must render event cards, incl. a `requestAnimationFrame`-stubbed never-painted tab; wired into `pnpm e2e:smoke`). The same trap applies to ANY route root: a client component that suspends during SSR (`useSearchParams`/`use(promise)`/`cookies` in a client boundary) must mount `ssr:false`, never under a page `<Suspense>`.
- **Never duplicate the door's offline outbox** — the Deur tab reuses `DoorProvider.tsx` (`src/features/door`).
- **Device storage is session-scoped unless it is provably PII-free (86ey9e9mn).** `public/service-worker.js` writes to two caches: `plusone-shell-*` (static assets, `/` the auth-free landing = the PWA `start_url`, and `/door/<eventId>`, which SSRs no guest data) is persistent; `plusone-session-*` (`/app*` — its RSC payload carries user id, venue, roles, name, memberships — plus the `/door` picker) is wiped by `clearDeviceCaches()` from `signOutDevice` (`src/features/auth/sign-out-device.ts`, the ONE sign-out — the MFA wall uses it too), exactly like `idbClearAll()`. Any other navigation is network-only; adding a path to the persistent bucket means asserting its HTML is PII-free on a shared tablet. **What the persistent bucket actually buys across sign-out:** static assets + door pages already cached under that exact URL — *not* a bootable door for an event the next doorhost hasn't opened (its fallback is the `/door` picker, which is session-scoped, and one event's HTML must never be served for another). That's fine: a signed-out device has no session and no IDB snapshot, so it can't work the door offline anyway. Fresh door HTML comes from that doorhost's own online login via the SW's `seed-shell` message — in-app moves are `<Link>`/RSC fetches, so the SW never sees them as navigations and **the shell only fills if something seeds it**. Sign-out wipes only after the session is confirmed gone (on the `sign-out-incomplete` throw the user stays signed in, so their data stays too). A revoked session self-cleans on the device's next *online* visit (the 307→/login arrives as an opaqueredirect); a device that never comes online again keeps its session cache — accepted residual. `public/sw.js` is a self-destructing stub for the retired next-pwa worker — never regenerate a Workbox SW there (it cached cross-origin Supabase REST bodies). Guards: `tests/unit/service-worker-cache-scope.test.ts` + `tests/unit/no-stale-pwa-artifacts.test.ts`.
- Tokens/behaviour reference: `design-system.md` (repo root). Near-black `#0B0B0D`, one lavender accent `#B5A6FF`, Bricolage Grotesque display + Hanken Grotesk body. Entrance animations animate `translateY` only, opacity always 1, behind `prefers-reduced-motion`. Where prototype and spec conflict, the spec wins.
- Remaining polish: tablet (641–1023px) layouts.

## Capacitor-readiness checklist — EVERY new `po` screen (decision #37)

The `po` surface gets wrapped via the **remote-URL model** (native webview loads the live app). Build every screen so the wrap needs no rewrite:

- [ ] Webview-safe: no browser-only API without a fallback; never **depend** on the service worker; guard `navigator`/`window`/`document`.
- [ ] Reads stay client-side (React Query, `src/features/po/hooks`). Online-only writes use the shared server actions.
- [ ] Offline-critical (door-adjacent) writes go through the door outbox (`src/features/door`), **never** a server action (#25).
- [ ] No push/notification transport called directly — go through `src/features/notifications`.
- [ ] Auth/redirects use the cookie-session + URL-navigation flow (no OAuth popups, no browser-redirect-only logic).
- [ ] Safe-area/notch tolerant; Android hardware back button handled; `/app` standalone.
- [ ] No billing/plan-upgrade/checkout surfaced inside the mobile app (Apple IAP).

Open native item (Phase 3, door only): cold-start-offline may need the door route bundled locally — validate with a spike before native launch (Capacitor plan: `capacitor-plan-claude-code.md`).

## Scale & front-end discipline (2026-07 review — enforce on every PR)

Established by `engineering-review-2026-07.md` + `perf-scale-audit-megaevent.md`. Hard rules, not preferences.

**Scale (a query that works at 150 rows must work at 25 000 and after 400 events):**
- **Never pass an unbounded id list to PostgREST `.in()`.** A venue-wide read filters by `venue_id` in SQL (`events!inner(venue_id)` embed, denormalized `venue_id`, or an aggregate RPC) — never `.in('event_id', <all venue event ids>)` (414 at ~205 events). Applies to writes too — chunk to ≤120 ids if a list is truly unavoidable. `guests`/`guest_requests`/`quota_requests`/`guest_tiers`/`request_links` carry `venue_id` (migration `20260708120000`).
- **Aggregate on the database, not the client.** Headcounts/stats = a `GROUP BY` RPC (e.g. `venue_event_headcounts` — SECURITY INVOKER so results stay role-relative), never "download every row and sum in JS".
- **Reads must be windowed at large N.** Load a working set + search server-side; don't ship the whole event.
- **Don't re-fetch a large snapshot on every mutation** — optimistic patch + realtime + the 60 s safety sync.
- Local numbers are a floor: realtime concurrency + RLS-read CPU are hosted-only to measure (`scripts/perf/realtime-loadtest-hosted.mjs`, throwaway project — never prod).

**Front-end (one canonical model, thin view-models, primitives in the kit):**
- **One canonical domain type per entity** (a domain module under `src/features/po` — to be created as FE-1 lands); screen shapes are `Pick<>`/projection view-models — do not invent a new `interface XGuest` per screen.
- **Exactly one adapter per entity** (DB row → domain); no per-screen mappers, one `format.ts`.
- **Share a base query; vary shape with React-Query `select`.** Same-table-different-scope = a scope param on the existing fetcher (`fetchGuests`/`fetchTiers` take `{eventId}|{venueId}`), not a new `fetchX`.
- **New UI primitive → `kit.tsx`** (or `shell.tsx`), exported, used everywhere. If the kit lacks it, add it to the kit in the same PR.
- **No mock-data imports in shipped screens.** The prototype fixture module (formerly src/lib/po/data.ts) is deleted — screens read live data via `src/features/po`; `tests/unit/no-mock-data-imports.test.ts` fails CI if a fixture import reappears in a shipped path.
- **Screen files stay under ~800 LOC** — `events.tsx`/`settings.tsx` are refactor targets, not a template.

## Current state (2026-07-09)

Live on prod: backend + RLS + audit + quota engine + door PWA (offline outbox) + landing + stats + AVG retention + billing (pilots `comped`) + the unified responsive `/app` surface. Suites green: Vitest 434 + pgTAP 529 on a fresh reset. **Branch protection on `main` is on** (`lint-and-test` required, admins included). Full history: `docs/changelog.md`.

Open work (ClickUp list `901818739469`, one task per session): **Prod-ready 9/7** program 01–13 (this file's slim-down = 01; Sentry, uptime, hooks, e2e smoke, restore drill, legal, incident skill…), **UX/IA 8/7** tasks (12, build order fixed, after the prod-ready core), P6 + K6/K11 review leftovers, tablet layouts. Parked by milestone: door mesh (≥5 venues), scale-track remainder (≥25), PostHog (after G1 — G1 itself shipped, see Design & surface above).

## Env & prod-push

**No staging.** One Supabase project — prod, ref `tolxwgqhppdcvnogdpel`. The app reads plain env names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY` (the `_STAGING`/`_PROD` names in `.env.example` are stale). Local dev/tests run against the local stack.

**Prod-push flow** (schema deploy after a merge — run from the **linked main checkout** `…/PlusOne Guestlist`, never a worktree: worktrees aren't `supabase link`-ed, `db push` fails there):
1. `git pull --ff-only origin main` — push the COMPLETE merged migration set, never one branch's subset.
2. `supabase db reset` + `supabase test db` on that full set — a clean reset proves no duplicate/broken migrations; the suite must be green.
3. `supabase db push --dry-run` — review the pending list.
4. `supabase db push`; then `--dry-run` again to confirm "Remote database is up to date".

Regenerate `src/lib/database.types.ts` and wire any new NOT-NULL columns into the typed insert paths in the SAME PR (omit trigger-filled columns from the gateway row type + cast).

## Local dev & testing (frictionless login — ALWAYS use these links)

Run locally against the **local Supabase stack**, never prod. Once per machine: `pnpm supabase:start` (seed: 2 venues, 6 users covering all roles, 1 always-upcoming event + 30 guests). Then `pnpm install && pnpm dev` — `pnpm dev` auto-writes `.env.local` via `scripts/dev-env.mjs` (skips if one exists, so the prod-pointing main checkout is untouched). Manual refresh: `pnpm dev:env`.

**Worktrees share the ONE local stack** (fixed 553xx ports). Only the dev-server port varies: `pnpm dev` claims 7000 if free, else a stable per-worktree `70xx`, and prints that port's dev-login links. Force with `PORT=7005 pnpm dev`.

**A port is a checkout, not a PR.** Each running `pnpm dev` serves whatever branch is checked out in *that* directory — a port number carries no branch identity, so a bookmarked `localhost:9000` link from a past session can silently serve `main` again if that checkout was reset or reused for something else. **Before testing an open PR, confirm the server you're hitting is actually running that PR's branch** (`git branch --show-current` in the directory that owns the port) — don't infer it from the port number alone. If a screen doesn't match what a PR claims to change, checkout mismatch is the first thing to rule out, ahead of assuming the change is broken. A stale `.next` cache from before the PR's commits is the second thing to rule out (`rm -rf .next` and restart).

**One DB owner.** Only ONE session runs a destructive DB command at a time. Before a test pass: `pnpm db:fresh` (= reset + `pnpm dev:mfa`). While someone tests, no other session resets/pushes. RPCs missing after a foreign reset → `pnpm dev:mfa`, never a full reset mid-test.

**Dev-login** (stable, no OTP/MFA):

```
http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=/app
http://localhost:7000/auth/dev-login?email=staff@plusone.test&next=/app
http://localhost:7000/auth/dev-login?email=door@plusone.test&next=/app
```

- `src/app/auth/dev-login/route.ts` mints + verifies a magic-link server-side. Hard-gated: `NODE_ENV !== 'production'` AND localhost Supabase URL — 404s in prod.
- `manager`/`staff`/`door@plusone.test` log in instantly. `admin@`/`finance@` work one-click too once TOTP is stamped (`pnpm db:fresh` or `pnpm dev:mfa`, fixed secret `PLUSONELOCALADMINDEVSECRET234567`) — the route completes the MFA challenge server-side. `&aal1=1` exercises the real `/mfa/verify` wall. AAL2 persists for the session (~30 days).
- OTP fallback: `/login` → code in **Mailpit** `http://127.0.0.1:55324`. Studio: `http://127.0.0.1:55323`.

## Security checklist — EVERY route, server action, and Edge Function

- [ ] Session verified server-side (`supabase.auth.getUser()`, never trust `getSession()` alone).
- [ ] Venue membership + required role(s) checked for the resource being touched. Roles are the ONLY privilege gate — no AAL2 requirements exist anywhere (see Auth); don't add one without a decision.
- [ ] All input parsed through a Zod schema before use. No `any`, no raw `formData` passthrough.
- [ ] Client-supplied resource IDs are untrusted: query through the user-scoped client so RLS confirms ownership — never the service client unless strictly necessary and documented why.
- [ ] Mutations idempotent where they can be retried (outbox).
- [ ] Public endpoints have rate limiting and never reveal whether a guest/e-mail exists.
- [ ] No PII in URLs, query strings, or logs.
- [ ] Errors to the client are generic; details go to server logs only.

## Review gates — independent verification before merge

The building session never solo-approves risky work; a fresh session has no investment in believing it. **High-risk surfaces:** migrations touching RLS policies / triggers / `SECURITY DEFINER` functions; anything referencing `service_role`; auth & middleware; the billing webhook; the door outbox.

- A PR touching a high-risk surface gets a **fresh-session `/code-review`** before merge, plus `/security-review` for the security-shaped ones. Everything else: blocking CI is the floor.
- **Security research prompts are proactive, not requested.** Security reviews run in a separate session/tool from the one that built the change — Max never wants to ask for the handoff prompt. Whenever a session touches a high-risk or security-shaped surface, write a self-contained adversarial security-research prompt as part of that session's wrap-up (PR body or final message), without being asked: attacker foothold/threat model stated explicitly, the relevant code inline (assume the reviewing session may not have repo access), and concrete attack questions specific to what changed — not a generic checklist.
- **Path-claim verification:** before recording "X exists at path Y" in CLAUDE.md, memory, or ClickUp, verify with `git ls-files`. For CLAUDE.md this is enforced in CI by `tests/unit/claude-md-references.test.ts`.
- **Milestone rule:** every new engineering initiative states which venue-count milestone it serves — **Now (gets venue #5 signed) / ≥5 / ≥25 / ≥100 / ≥200**. Not "Now" → park it in the backlog under that milestone. Challenge over-engineering actively, including when Max proposes it.

## Conventions

- Server Components by default; Client Components only where interactivity demands it.
- Mutations via Server Actions or Route Handlers; DB access through the typed client (`src/lib/database.types.ts`, regenerate after every migration).
- Migrations: `supabase/migrations/`, one per ClickUp task, **never edit an applied migration** — write a new one. Pick a UNIQUE timestamp: check `git ls-files supabase/migrations | grep <YYYYMMDD>` against `origin/main` before merging (collisions break `db push`/`db reset`; if one lands, rename the later one in a follow-up PR).
- **Expand–contract:** a migration must never break the currently deployed app version — add the new column/path first, migrate code, drop later in a separate migration. Never rename/drop something live code still reads.
- File structure: `src/app` (routes), `src/components`, `src/lib`, `src/features/<domain>`, `supabase/` (migrations, tests, seed).
- Dutch UI copy, English code/comments/commit messages. Conventional commits, small commits per logical step.
- **Model routing** (session/task planning): Fable for decisions & planning, Opus for building, Sonnet for mechanical execution. Every ClickUp task carries a `Model:` line.
- **ClickUp task lifecycle** is owned by the `clickup-task` skill (`.claude/skills/clickup-task/SKILL.md`): exact statuses, the complete-gate (merged AND tested), concurrency check, comment cadence, task id in branch + PR title. End-of-session sync is enforced by the Stop hook `scripts/hooks/clickup-sync-check.mjs` (marker: gitignored `.claude/clickup-session.json`); a daily scheduled reconcile run reports ClickUp↔GitHub drift.

## Definition of Done — every task

1. Zero TypeScript errors, `pnpm lint` clean.
2. Security checklist applied to every touched path; review gates respected for high-risk surfaces.
3. RLS tests (pgTAP) for every new table/policy: prove both **allowed** and **denied** cases per role.
4. Unit tests for quota math, lock behaviour, and any non-trivial logic — asserting **database state**, not just UI/`ok:true` success.
5. Migration applies cleanly on a fresh database (`supabase db reset` passes).
6. Update `gastenlijst-app-spec.md` if a decision was refined; add it to the decision table.
7. Session-end status report appended to `docs/changelog.md` (newest first) + a short summary for the ClickUp task.
8. **UI tasks:** end with the per-screen test handoff below.

## Per-screen test handoff (UI tasks — ALWAYS end with this)

1. **A direct dev-login link to the screen:** real routes (`/door/[id]`, `/e/[slug]`) via `…/auth/dev-login?email=…&next=<route>`; `po` screens via `…&next=/app` + name the tab/screen to open. Pick the seed user whose role actually exercises the screen.
2. **10–15 concrete, numbered yes/no test questions**, specific to that screen: core action end-to-end · live data (persists after refresh) · responsive (≤390px and ≥1280px, tap-targets ≥44px) · empty/loading/error states · permissions (locked for roles without rights) · 1–2 screen-specific edge cases (quota exceeded, list locked, +N math, offline outbox…) · visual match (spacing, lavender accent, fonts).

Number them so Max can answer "1 ✅, 2 ❌ — …" as feedback per component.

## What NOT to do

- Do not add auth providers, password login, or third-party auth services.
- Do not use the service-role client to "make RLS problems go away".
- Do not hard-delete rows or disable triggers, even in seed/test helpers.
- Do not introduce server state for door-app search/filtering — that stays local-first.
- Do not start a task by rewriting earlier phases; build incrementally on the existing migrations.
- Do not put shipped-work history in this file — it goes in `docs/changelog.md`.
- Do not render a client component that suspends during SSR (`useSearchParams`, `use(promise)`, …) at a route root under a page `<Suspense>` — mount it `ssr:false` instead. In Next 15.5 the server-streamed boundary is rAF-gated and never hydrates in a never-painted tab (background/webview), silently freezing the whole route on zero-data SSR HTML (86eya4yuf). `/app` mounts via `app-client.tsx`; guarded by `app-shell-no-ssr-suspense.test.ts` + `app-home-events-visible.spec.ts`. Never weaken/skip those guards to make CI pass.
