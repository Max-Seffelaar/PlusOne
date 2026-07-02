# CLAUDE.md — Gastenlijst SaaS

Multi-tenant guest list SaaS for venues (clubs, event spaces). Hundreds of venues, dozens of events/month each, 50–150 guests per event. Core values: **fraud resistance** (everything audited), **door speed** (offline-tolerant check-in), **quota enforcement** (staff get limited guest list slots).

The full functional spec lives in `gastenlijst-app-spec.md` (repo root). Decision numbers referenced below (#1–#39) point to the decision table in that spec. When in doubt, the spec wins. If code and spec conflict, flag it — never silently deviate.

## Stack (fixed — do not substitute)

- **Next.js 15, App Router, TypeScript strict** — PWA. Hosted on **Vercel, region `fra1` only**.
- **Supabase** (project region `eu-west-1`, Ireland — EU region approved by Max 2026-06-13, ref `tolxwgqhppdcvnogdpel`): Postgres, Auth, Realtime, Edge Functions.
- **Tailwind + shadcn/ui** for UI. **TanStack Query** with IndexedDB persistence for offline.
- **Zod** for all input validation. **Vitest** for unit tests, **Playwright** for e2e, **pgTAP** (via supabase test) for RLS/trigger tests.
- Package manager: **pnpm**.
- Keep `@supabase/ssr` aligned with `@supabase/supabase-js` (≥`0.12` for js `2.108`). A stale `ssr` pin makes the typed client resolve every `.from()`/`.rpc()` to `never` — it compiles to nonsense and `tsc` fails wholesale.

## Non-negotiable architecture decisions

1. **RLS is the security boundary.** Every table has Row Level Security enabled. App-layer checks are convenience, not security. A user with the anon/auth key and raw API access must never be able to read or write outside their memberships.
2. **All primary keys are UUIDv7, generated client-side** for entities that can be created offline (`guests`, `check_ins`, `refusals`). All writes from the offline outbox are idempotent upserts. (#25)
3. **Soft delete only.** Guests are never hard-deleted; status becomes `removed`. Hard DELETE is revoked for app roles at the database level. (#21)
4. **Audit log via Postgres triggers**, not application code. Triggers on `guests`, `quotas`, `event_quotas`, `guest_tiers`, `check_ins` write actor, action, and JSONB before/after diff. Never write audit entries from app code; never bypass.
5. **Quota math:** a guest with `plus_ones = N` consumes `1 + N` slots. Removal frees the slot only while `events.status != 'live'`. Enforce in the database (trigger/constraint), not only in UI. (#22)
6. **List lock:** when `events.list_locked = true`, RLS rejects guest mutations from staff-role users; admin, organizer, and doorhost (within quota, at the door) retain write access. Lock/unlock is its own audit action. (#23)
7. **Users exist independently of venues.** Access flows through `venue_memberships` (roles array) and `event_organizers` (event scope). Removing a membership never deletes the user or touches their other venues/events. Only the user can change their own email. (#24)
8. **Multiple roles per user per venue.** Never model role as a single column.
9. **Stats and quotas hang on the event, never the calendar day.** Events cross midnight. (#26)
10. **No ticketing integrations in the core. No outbound invitations (mail/WhatsApp).** Read-only ticketing connectors are a phase-3 layer (#36).
11. **Native apps are planned, not optional (#37).** MVP ships as a browser PWA; afterwards the same codebase is wrapped with Capacitor for the App Store and Play Store. Build Capacitor-compatible from day one: no browser-only APIs without a fallback (everything must work inside a native webview), notifications behind an abstraction (web-push and FCM/APNs as adapters — same pattern as billing), auth flows and deep links must not depend on browser-specific redirect behaviour. Never introduce a feature that would force a rewrite at wrap time.

## Auth (decision #20)

- Supabase Auth, **passwordless only**: e-mail OTP (6-digit). Password auth is disabled in project settings — verify this in setup.
- **Invite-only.** Public signups disabled. Accounts are created exclusively through admin/user-manager invitations.
- **MFA (TOTP) is fully OPTIONAL for every role** (refined 2026-07-02, T1 86ey4j1dz — pilot feedback: forced MFA loses customers; security trade-off explicitly accepted by Max. Was: mandatory enrollment for admin/finance + AAL2 on sensitive actions, 2026-06-24). **No hard gate and no AAL2 requirement in RLS anywhere** — invite / revoke-invite / member add-remove-rolechange / remote-logout are **role-only** (migration `20260702120000_mfa_fully_optional`, supersedes `20260624160000`). Admin/finance instead get a well-explained, **skippable recommendation** on app entry (`recommendMfaIfDue` → `/mfa/enroll` with "Ask me in 7 days" / "Don't ask again", `user_profiles.mfa_snooze_until`). Any role can self-enable/disable MFA from the profile (S4.3); the step-up sheet (`useMfaGate`) remains as plumbing for voluntary enrollment only.
- Short-lived access tokens, refresh rotation on. Admin screen for per-user session list + remote logout.
- The `service_role` key only ever appears in server-side code (Edge Functions / Route Handlers running on the server). If you ever find it referenced in client-bundled code, stop and fix immediately.

## Billing (decision #32 — optional for MVP, schema is not)

- **Stripe Billing** for subscriptions; payment methods **SEPA Direct Debit + iDEAL only** (no card as default — cheaper and stickier for Dutch B2B).
- **Abstraction layer is mandatory.** The app reads venue entitlement exclusively from the `subscriptions` table (status: `trialing/active/past_due/canceled/comped`). No feature code ever calls Stripe directly; all Stripe interaction lives in `src/features/billing/` behind a `BillingProvider` interface so a later switch (e.g. Mollie at scale) only touches the adapter.
- Stripe state flows in via **webhooks only** (`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`). Webhook handler: verify the Stripe signature, idempotent processing (store processed event IDs), service-role writes documented and confined to this handler.
- `comped` status exists so venues can run without billing during MVP/pilots — set manually by us, logged.
- Access gating: middleware/layout checks `subscriptions.status`; `past_due` shows a banner with grace period, `canceled` blocks venue admin features but never destroys data.
- Never store card/IBAN details ourselves; Stripe customer portal handles payment-method management and invoices.

## Design (decision #38)

**The UI layer is already implemented in `src/` and is the source of truth for the UI — reuse and extend it, never regenerate a screen.** ~26 screens live as React/TS components, now **wired to live Supabase data** via the shared `src/features/po/` layer (some `src/lib/po/` mock data persists for types + small fallbacks):

- `src/components/po/` — design-system kit (`kit.tsx`, `icon.tsx`, `shell.tsx`), app shell + nav stack (`app.tsx`, `context.tsx`), and all screens under `src/components/po/screens/` (`auth`, `events`, `guests`, `door`, `approvals`, `settings`).
- `src/lib/po/` — typed mock data (`data.ts`, `types.ts`), the deterministic quick-add parser (`parse.ts`, decision #33), and raw token helpers (`theme.ts`).
- Mounted at the `/app` route (`src/app/app/page.tsx`). Design tokens + the two fonts live in `tailwind.config.ts`.

Per Werkwijze v2 (`bouwplan-claude-code.md`): a UI phase now means **building the backend under an existing screen and replacing its mock data with real Supabase data while preserving the component API** — not rebuilding the screen.

**One responsive surface (launch architecture — surface-unification, merged 2026-06-21 via PR #50; this supersedes the earlier "two surfaces, one viewport-switch" plan).** There is now **one UI**: the responsive **`po` app at `/app`** (`ResponsiveShell` — mobile bottom-tabs <1024px, desktop sidebar ≥1024px). Every authenticated entry lands on `/app`; there is **no viewport dispatcher** — phones and desktops share the same surface. The old desktop `(app)` dashboard is **retired**: its routes (`/dashboard`, `/events/*`, `/admin/*`, `/settings/*`) redirect to `/app`, and only `/eventday` survives as a standalone live cockpit (not yet folded into the Deur view). All screens read/write live data via the shared `src/features/po/` layer (React Query reads over the browser client + existing `src/features/*` server actions for writes; mirror `src/features/stats/po-adapter.ts`). **Desktop density is per-screen** via a `WIDE_DESKTOP` width map in `src/components/po/app.tsx` + the shell's `mainMaxClass` + Tailwind `lg:`/`xl:` (done: Home, Gastenlijst, Statistieken, Audit, Events, Gebruikers). Breakpoint 1024px; keep it Capacitor-safe (#37). Never duplicate the door's offline outbox — the `po` Deur tab reuses `src/features/door/DoorProvider`.

The token/behaviour reference is `design-system.md` (repo root). The original Claude Design handoff is not committed — `src/` is the recreation and supersedes it. Rules unchanged: tokens are near-black `#0B0B0D`, one lavender accent `#B5A6FF`, Bricolage Grotesque display + Hanken Grotesk body; recreate visual output, never copy the prototype's internal code structure; where prototype and spec conflict, the spec wins; entrance animations animate `translateY` only, opacity always 1, behind `prefers-reduced-motion`.

## Capacitor-readiness checklist — EVERY new `po` screen (decision #37)

The `po` surface gets wrapped with Capacitor in Phase 3 via the **remote-URL model** (the native webview loads the live app; server actions keep working — so no write-path rewrite). Build every screen so the wrap needs no rewrite:

- [ ] Webview-safe: no browser-only API without a fallback; never **depend** on the service worker (it doesn't run in the webview); guard `navigator`/`window`/`document`.
- [ ] Reads stay client-side (React Query over the browser client, `src/features/po/hooks`). Online-only writes use the shared `src/features/*` server actions, as today.
- [ ] Offline-critical (door-adjacent) writes go through the door outbox (`src/features/door`), **never** a server action — so they survive connectivity loss (#25).
- [ ] No push/notification transport called directly — go through `src/features/notifications` (the `notifications` provider; web-push ↔ FCM/APNs swap lives there).
- [ ] Auth/redirects use the existing cookie-session + URL-navigation flow (no OAuth popups, no browser-redirect-only logic).
- [ ] Safe-area/notch tolerant; Android hardware back button handled; `/app` standalone.
- [ ] No billing/plan-upgrade/checkout surfaced inside the mobile app (keeps us clear of Apple IAP rules).

Open native item (Phase 3, door only): a remote-URL webview needs network to load the shell on a **cold start**. The door's writes are already offline (outbox); if cold-start-offline matters, bundle the (already client-side) door route locally — the rest stays remote-URL. Validate with a spike before native launch.

## Launch plan & current status

The full launch plan — STAP 0 status report, screen inventory (stable IDs S0–S13), design briefs, and STAP 1–4 — lives in `launchplan-claude-code.md` (repo root; note its viewport-switch/"Strategy A" framing is **superseded** by the surface-unification below). Build state: backend + RLS + audit + quota-engine + door PWA + landing + stats + AVG are done and live. The **surface-unification** (PR #50, 2026-06-21) collapsed the desktop `(app)` dashboard and the mobile `po /app` into **one responsive surface** at `/app`: every login lands there, the `(app)` shell is retired (routes redirect; the `/eventday` cockpit is kept standalone), and the po screens are wired live via `src/features/po/`. Desktop layouts are done for Home, Gastenlijst, Statistieken, Audit, Events and Gebruikers; remaining polish = fold `/eventday` into the desktop Deur view, tablet (641–1023px) layouts, and `/app` deep-linking. Work proceeds in separate sessions, one ClickUp task at a time.

**Settings polish — #39 test-feedback (S4.1–S4.3, [PR #56](https://github.com/Max-Seffelaar/PlusOne/pull/56), 2026-06-22).** The settings-cluster feedback is in: (S4.1) invite role-selection is chip toggles with **nothing pre-selected**, and an **admin** can assign the invitee as **event organizer** of one/several/all upcoming events — captured on `invites.event_ids` and granted on acceptance by `accept_pending_invites()` (admin-only via the `invites_insert` RLS, mirrors `assignOrganizer`; migration `20260622120000`). (S4.2) the active-sessions label shows the **OS** (`deviceLabel` in `src/lib/ua.ts`; dev-login forwards the browser UA), the venue **BTW/company grid no longer overflows ≤390px**, and team/invites/sessions have **load spinners**. (S4.3) **optional roles can self-enable/disable MFA** (reusing the `mfa-gate` enroll step); admin/finance stay verplicht. No screen was regenerated — backend wired under the existing po screens per Werkwijze v2.

**Performance (STAP 3.5).** The read-only baseline (`perf-baseline-3.5a.md`, incl. a 1500-guest stress test) and the six **3.5b** code-fixes are done and merged: ranged reads (#0a — fixes the 1000-row PostgREST truncation that hid ~532 guests at the door on large events), realtime throttle 10→200 eps + refetch-on-reconnect (#0b), list virtualization + search debounce (#1a/#1b), `/app` code-split + eventday first-paint + deur-CLS (#2a/#2b) — via [PR #53](https://github.com/Max-Seffelaar/PlusOne/pull/53) (correctheid + deur) and [PR #54](https://github.com/Max-Seffelaar/PlusOne/pull/54) (polish). No schema change. What remains of STAP 3.5 is the **scale-track (#3)** for the 500+-concurrent-org target (realtime `postgres_changes`→Broadcast, polling/caching, Supabase compute-tier + Supavisor pooling sizing, cost model, hosted realtime load-test) — its own session, **not an MVP/pilot blocker** (the DB writes are rock-solid: 495 check-ins/sec, p95 13 ms). **Scale-track progress (2026-06-23, `perf-scale-track-3.5.md`):** design + cheap ops-checks done (compute-tier/pooling sanity + cost model ≈ €0,25/org/mnd; the bindende as = realtime concurrent-connections, niet pooling). The **linchpin shipped + pushed to prod**: `check_ins`/`refusals` now carry `event_id`+`venue_id` (filled by the `set_checkin_scope` BEFORE-trigger), the SELECT-policies collapsed to one membership check on the indexed `venue_id`, the door/cockpit realtime subscriptions filter `event_id=eq.X`, and the typed client + insert paths are wired ([PR #59](https://github.com/Max-Seffelaar/PlusOne/pull/59) + [#60](https://github.com/Max-Seffelaar/PlusOne/pull/60) collision-fix + the realtime-filter/types wiring PR). Remaining: `postgres_changes`→**Broadcast**, polling/caching trims, and the **hosted load-test** (vóór/na bewijs, `scripts/perf/realtime-loadtest-hosted.mjs`).

**Testen & QA (STAP 4.1, 2026-06-23 — `docs/test-report.md`).** De uitvoerbare test-suites draaien sequentieel groen: **Vitest 39 files / 434 tests** en **pgTAP 22 files / 529 tests** op een verse `supabase db reset` (een schone reset bewijst meteen: geen migratie-timestamp-collisies), met `pnpm lint` + `type-check` schoon. Toegevoegd voor bestaande logica: offline-outbox `refusal`/`ack_note` replay (nu 8/8 kinds) + de statushelpers (`isPending`/`isRetryable`/`hasUnsynced`), en een **secret-grep** guard die de `service_role`-key buiten client-code houdt (faalt als de key buiten de éne `server-only`-module of in een `'use client'`-component opduikt; draait in de bestaande `pnpm test`-CI-stap). **Uitgesteld** (feature bestaat nog niet): Stripe-webhook, ticketing-adapter/Vault, deur-push/realtime-taken. Open: geen line-coverage-meting, server-`actions.ts` alleen indirect gedekt (RLS = grens), en de e2e-kernflow = STAP 4.3.

**Env (no staging).** One Supabase project — prod, ref `tolxwgqhppdcvnogdpel`; there is no staging DB. The app reads **plain** env names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` — **not** the `_STAGING`/`_PROD`-suffixed names still shown in `.env.example` (stale). Local dev/tests run against the local Supabase stack.

**Prod-push flow** (deploy schema after a merge — run from the **linked main checkout** `…/PlusOne Guestlist`, NOT a worktree: worktrees aren't `supabase link`-ed and have no cached prod creds, so `db push` there fails with "Cannot find project ref"):
1. `git pull --ff-only origin main` — push the COMPLETE merged migration set, never one branch's subset.
2. `supabase db reset` + `supabase test db` on that full set first — a clean reset proves there are no duplicate/broken migrations (this is what catches a timestamp collision); the suite must be green.
3. `supabase db push --dry-run` — review the pending list + confirm the connection.
4. `supabase db push`; then `--dry-run` again to confirm "Remote database is up to date".

Regenerate `src/lib/database.types.ts` and wire any new NOT-NULL columns into the typed insert paths in the SAME PR (a NOT-NULL column with no DB default makes the generated `Insert` type require it — omit trigger-filled columns from the gateway row type + cast).

## Local dev & testing (frictionless login — ALWAYS use these links)

Run locally against the **local Supabase stack**, never prod — prod enforces admin/finance MFA, so no-MFA login is a local-only affordance. Setup once per machine: `pnpm supabase:start` (loads the seed — 2 venues, 6 users covering all roles, 1 event + 30 guests). After that a fresh checkout only needs `pnpm install && pnpm dev` — **`pnpm dev` auto-writes `.env.local`** from the running stack via `scripts/dev-env.mjs` (plain names: `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` + server-only `SUPABASE_SERVICE_ROLE_KEY`); it skips when an `.env.local` already exists, so the prod-pointing main checkout is left alone. Manual refresh: `pnpm dev:env`.

**Multiple sessions / git worktrees:** they all share the ONE local Supabase stack (fixed 553xx ports, keyed by `supabase/config.toml`). The only thing that can collide is the **dev-server port** (one process per port). `pnpm dev` now claims **7000 if free, else a stable per-worktree port** (deterministic `70xx`) and prints *that port's* dev-login links on startup — so a second session never silently lands on 7001 while the `:7000` links still point at the first branch's server (the "one had mock data, one didn't" trap). Force a specific port with `PORT=7005 pnpm dev`. You rebuild CODE per worktree (its own `node_modules` + `.next`), never the environment.

**One DB owner (shared-stack hygiene).** The local Postgres + seed are a single shared resource across every worktree, so treat the database as singly-owned — only ONE session runs a destructive DB command at a time. Before a test pass, from the worktree you're testing, run **`pnpm db:fresh`** (= `supabase db reset` + `pnpm dev:mfa`) for a known-clean seed with the onboarding RPCs + admin/finance TOTP re-applied. While someone is testing, **no other session runs `pnpm db:fresh` / `supabase db reset` / `supabase db push`.** If a build session finds its RPCs missing because another worktree reset the stack, re-apply them idempotently with `pnpm dev:mfa` — never a full reset mid-test.

**To log in for testing, always use the dev-login route** — stable, reusable, no OTP/MFA:

```
http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=/app
http://localhost:7000/auth/dev-login?email=staff@plusone.test&next=/app
http://localhost:7000/auth/dev-login?email=door@plusone.test&next=/app
```

- `src/app/auth/dev-login/route.ts` mints + verifies a magic-link server-side. **Hard-gated**: only runs when `NODE_ENV !== 'production'` AND the Supabase URL is localhost — it 404s in prod and does NOT bypass MFA (the session is AAL1).
- The three seed users above (`manager`/`staff`/`door@plusone.test`) need **no MFA** → instant, reusable login. **Admin** (`admin@plusone.test`) + finance are MFA-mandatory, but once their TOTP factor is stamped (`pnpm db:fresh` or `pnpm dev:mfa`, fixed secret `PLUSONELOCALADMINDEVSECRET234567`) the dev-login route **completes the MFA challenge server-side** → their links are **one-click too**, no authenticator app needed. Add `&aal1=1` to land at AAL1 and exercise the real `/mfa/verify` wall (then enter a code from an authenticator holding that secret). Once at AAL2 it **persists for the session (~30 days)** — you do NOT re-enter MFA per action; the in-app step-up only fires when the session is genuinely AAL1.
- OTP fallback (any seed user): `/login` → code from **Mailpit** `http://127.0.0.1:55324`. Studio (DB UI): `http://127.0.0.1:55323`.
- `/app` starts in the authenticated shell (the prototype's mock welcome/login is skipped — real auth is the middleware + `/login`).

## Security checklist — EVERY route, server action, and Edge Function

Run through this list for each new or modified path. No exceptions, including "internal" or "temporary" endpoints:

- [ ] Session verified server-side (`supabase.auth.getUser()`, never trust `getSession()` alone on the server).
- [ ] Venue membership + required role(s) checked for the resource being touched.
- [ ] AAL2 enforced if the action is sensitive (see Auth section).
- [ ] All input parsed through a Zod schema before use. No `any`, no raw `formData` passthrough.
- [ ] Resource IDs from the client are treated as untrusted: confirm the row belongs to the venue/event the user has access to (RLS does this — so prefer querying through the user-scoped client, never the service client, unless strictly necessary and documented why).
- [ ] Mutations are idempotent where they can be retried (outbox).
- [ ] Public endpoints (landing page request form) have rate limiting and never reveal whether a guest/e-mail already exists.
- [ ] No PII in URLs, query strings, or logs.
- [ ] Errors returned to the client are generic; details go to server logs only.

## Conventions

- Server Components by default; Client Components only where interactivity demands it.
- Mutations via Server Actions or Route Handlers; database access through the typed Supabase client (`supabase gen types typescript` output committed to `src/lib/database.types.ts` — regenerate after every migration).
- Migrations: `supabase/migrations/`, one migration per ClickUp task, never edit an applied migration — write a new one. **Parallel sessions must pick a UNIQUE timestamp:** before merging, check `git ls-files supabase/migrations | grep <YYYYMMDD>` on `origin/main` — two migrations sharing a `<timestamp>` version collide (Supabase keys migrations on it) and break `db push`/`db reset` half-way. If a collision lands on main, rename the later one to a unique timestamp in a follow-up PR (and drop any now-redundant one).
- File structure: `src/app` (routes), `src/components`, `src/lib` (clients, utils), `src/features/<domain>` (guests, quotas, events, auth, audit), `supabase/` (migrations, tests, seed).
- Dutch UI copy, English code/comments/commit messages.
- Conventional commits (`feat:`, `fix:`, `chore:`...). Small commits per logical step.

## Definition of Done — every task

1. Code compiles with zero TypeScript errors, `pnpm lint` clean.
2. Security checklist above applied to every touched path.
3. RLS tests (pgTAP) for every new table/policy: prove both **allowed** and **denied** cases per role.
4. Unit tests for quota math, lock behaviour, and any non-trivial logic.
5. Migration applies cleanly on a fresh database (`supabase db reset` passes).
6. Update `gastenlijst-app-spec.md` (repo root) if a decision was refined; add the change to the decision table.
7. Short summary of what was built + open questions, so it can be pasted into the ClickUp task.
8. **UI tasks:** end with the per-screen **test handoff** (direct dev-login link + 10–15 specific test questions) — see below.

## Per-screen test handoff (UI tasks — ALWAYS end with this)

When you finish building/wiring a screen, end with a **test handoff** so Max can verify it and give feedback per part. Two pieces:

1. **A direct dev-login link to the screen** (see "Local dev & testing"):
   - Real routes (`/door/[id]`, `/e/[slug]`, `/eventday`): `http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=<route>`. (The old `(app)/*` pages are retired — they redirect to `/app`.)
   - The `po` screens (one in-app nav stack, no per-screen URL): link to `…&next=/app` and name the tab/screen to open (e.g. "open the **Deur** tab").
   - Pick the seed user whose role actually exercises the screen (e.g. `door@plusone.test` for check-in, `staff@plusone.test` for own-guest quota).

2. **10–15 concrete, numbered yes/no test questions**, specific to that screen (not generic). Cover this spread:
   - **Core action(s)** — the screen's primary task works end-to-end?
   - **Live data** — real data loads (not mock)? writes persist after a refresh?
   - **Responsive** — clean at ≤390px (tabs) and ≥1280px (sidebar)? no horizontal scroll, tap-targets ≥44px?
   - **States** — empty / loading / error handled gracefully?
   - **Permissions** — actions hidden/locked for roles without rights (and the lock-popup shows)?
   - **Edge cases** — 1–2 screen-specific ones (quota exceeded, list locked, +N math, offline outbox, …).
   - **Visual** — matches the Claude Design (spacing, lavender accent, fonts)?

Number them so Max can answer "1 ✅, 2 ❌ — …" and paste it straight back as feedback per component.

## What NOT to do

- Do not add auth providers, password login, or third-party auth services.
- Do not use the service-role client to "make RLS problems go away".
- Do not hard-delete rows or disable triggers, even in seed/test helpers.
- Do not introduce server state for door-app search/filtering — that stays local-first.
- Do not start a task by rewriting earlier phases; build incrementally on the existing migrations.
