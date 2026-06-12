# CLAUDE.md — Gastenlijst SaaS

Multi-tenant guest list SaaS for venues (clubs, event spaces). Hundreds of venues, dozens of events/month each, 50–150 guests per event. Core values: **fraud resistance** (everything audited), **door speed** (offline-tolerant check-in), **quota enforcement** (staff get limited guest list slots).

The full functional spec lives in `gastenlijst-app-spec.md` (repo root). Decision numbers referenced below (#1–#39) point to the decision table in that spec. When in doubt, the spec wins. If code and spec conflict, flag it — never silently deviate.

## Stack (fixed — do not substitute)

- **Next.js 15, App Router, TypeScript strict** — PWA. Hosted on **Vercel, region `fra1` only**.
- **Supabase** (project region `eu-central-1`, Frankfurt): Postgres, Auth, Realtime, Edge Functions.
- **Tailwind + shadcn/ui** for UI. **TanStack Query** with IndexedDB persistence for offline.
- **Zod** for all input validation. **Vitest** for unit tests, **Playwright** for e2e, **pgTAP** (via supabase test) for RLS/trigger tests.
- Package manager: **pnpm**.

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
- **MFA (TOTP) mandatory for `admin` and `finance` roles.** Sensitive operations (quota grants, role changes, audit-log access) require AAL2 — enforce in RLS via `auth.jwt()->>'aal'`.
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

The visual source of truth is the token/behaviour summary in `design-system.md` (repo root). The PLUSONE design bundle (Claude Design handoff) is not in the repo yet — when it lands it goes in `docs/design/`. Read the summary before building any UI. Rules: recreate the prototype's visual output in our stack (Tailwind theme from the exact tokens — near-black `#0B0B0D`, one lavender accent `#B5A6FF`, Bricolage Grotesque display + Hanken Grotesk body); never copy the prototype's internal code structure; where prototype and spec conflict, the spec wins (documented in design-system.md). Entrance animations animate `translateY` only, opacity always 1, behind `prefers-reduced-motion`.

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
- Migrations: `supabase/migrations/`, one migration per ClickUp task, never edit an applied migration — write a new one.
- File structure: `src/app` (routes), `src/components`, `src/lib` (clients, utils), `src/features/<domain>` (guests, quotas, events, auth, audit), `supabase/` (migrations, tests, seed).
- Dutch UI copy, English code/comments/commit messages.
- Conventional commits (`feat:`, `fix:`, `chore:`...). Small commits per logical step.

## Definition of Done — every task

1. Code compiles with zero TypeScript errors, `pnpm lint` clean.
2. Security checklist above applied to every touched path.
3. RLS tests (pgTAP) for every new table/policy: prove both **allowed** and **denied** cases per role.
4. Unit tests for quota math, lock behaviour, and any non-trivial logic.
5. Migration applies cleanly on a fresh database (`supabase db reset` passes).
6. Update `docs/spec.md` if a decision was refined; add the change to the decision table.
7. Short summary of what was built + open questions, so it can be pasted into the ClickUp task.

## What NOT to do

- Do not add auth providers, password login, or third-party auth services.
- Do not use the service-role client to "make RLS problems go away".
- Do not hard-delete rows or disable triggers, even in seed/test helpers.
- Do not introduce server state for door-app search/filtering — that stays local-first.
- Do not start a task by rewriting earlier phases; build incrementally on the existing migrations.
