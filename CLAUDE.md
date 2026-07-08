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
- **MFA (TOTP) is fully OPTIONAL for every role, including `admin` and `finance`** (decided 2026-07-01, shipped 2026-07-02 in T1 `86ey4j1dz` PR c). Rationale (Max, trade-off accepted deliberately): forcing MFA creates too much onboarding friction and risks losing customers; passwordless OTP already gates account access — MFA is a recommended extra layer, not a wall. **No hard gate and no AAL2 requirement in RLS anywhere** — invite / revoke-invite / member add-remove-rolechange / remote-logout are **role-only** (migration `20260702120000_mfa_fully_optional`, supersedes `20260624160000_mfa_scope_sensitive_actions`; quota grants, organizer assignment and audit-log viewing were already role-only). Admin/finance instead get a well-explained, **skippable recommendation** on app entry (`recommendMfaIfDue` → `/mfa/enroll` with "Ask me in 7 days" / "Don't ask again", persisted on `user_profiles.mfa_snooze_until`). Any role can self-enable/disable MFA from the profile (S4.3); the step-up sheet (`useMfaGate`) remains as plumbing for voluntary enrollment only. Backlog counterweight: venue-policy "require MFA" toggle (`86ey4uv97`).
- Short-lived access tokens, refresh rotation on. Admin screen for per-user session list + remote logout.
- The `service_role` key only ever appears in server-side code (Edge Functions / Route Handlers running on the server). If you ever find it referenced in client-bundled code, stop and fix immediately.

## Billing (decision #32 — fase 13 PR 1 SHIPPED 2026-07-06)

- **Stripe Billing** for subscriptions; payment methods **SEPA Direct Debit + iDEAL only** (no card as default — cheaper and stickier for Dutch B2B). An iDEAL confirmation sets up the SEPA mandate for renewals.
- **Abstraction layer is mandatory.** The app reads venue entitlement exclusively from the `subscriptions` table (status: `trialing/active/past_due/canceled/comped`). No feature code ever calls Stripe directly; all Stripe interaction lives in `src/features/billing/` behind the `BillingProvider` interface (a vitest guard fails the suite if `stripe` is imported elsewhere). Without `STRIPE_SECRET_KEY` the stub provider serves keyless local dev/CI — checkout/portal report `unavailable`, trial/comped venues keep working.
- **Prices are config-driven** (decided 2026-07-06 — amounts not fixed yet): the Stripe dashboard owns the amounts; the app only knows env price ids (`STRIPE_PRICE_PREMIUM_MONTHLY`, plus `STRIPE_TAX_RATE_ID` for the manual 21% BTW rate). Only a plan WITH a configured price id gets a checkout path (indie/free skips Stripe entirely; pro = on request/manual). No publishable key — hosted Checkout/Portal are pure redirects, no Stripe.js.
- Stripe state flows in via **webhooks only** (`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`) → `POST /api/webhooks/stripe` (the app's only API route; middleware exempts `/api/webhooks/` — auth is the signature, not a session). Signature verification over the raw body; idempotency via the `stripe_webhook_events` ledger + the service_role-only RPC `apply_stripe_subscription_update` (migration `20260706120000`) — replay mutates nothing. This is the documented service-role exception; security-reviewed 2026-07-06, no findings.
- **Trial: 14 days, soft block** (decided 2026-07-06). App-side display trial (`created_at + TRIAL_DAYS`), carried into Stripe as `trial_end` at checkout. A lapsed trial without payment method blocks admin features (new events, invites, import — PR 3) but NEVER the door of planned events or data access. `past_due` grace = 14 days **delegated to Stripe dunning** (Smart Retries ~2 weeks, final action cancel → webhook → `canceled`); no app-side timers, the app only renders the PAST DUE banner.
- `comped` status exists so venues can run without billing during MVP/pilots — set manually by us (SQL runbook in `docs/stripe-setup.md`), logged via the audit trigger on `subscriptions`, and **never overwritten by webhook state** (guard in the RPC). Set existing pilot venues to `comped` before deploying the trial-nudge/gating PRs.
- **Store-tax (hard requirement, Apple IAP):** account creation is browser-first (already true: invite-only + web onboarding). The native (Capacitor) shell shows billing **read-only** — no checkout, portal, pricing or upgrade UI, not even a link; the seam is `isNativeShell()` (`src/lib/platform.ts`, PR 2).
- Never store card/IBAN details ourselves; Stripe customer portal handles payment-method management and invoices. We persist only `stripe_customer_id`/`stripe_subscription_id`.
- Dashboard setup + local test-mode script (incl. the iDEAL→SEPA-mandate verification): `docs/stripe-setup.md`. Go-live checklist: ClickUp `86ey6bga8`. PR 2 (checkout/portal buttons + trial nudge + `isNativeShell()` seam) and PR 3 (soft-block gating via `src/features/billing/gate.ts` on create-event/from-template/invite/import + `useBillingBlocked()` UX locks; customer-mismatch guard in `apply_stripe_subscription_update`, migration `20260706130000` — security-review follow-up) are built; the door outbox and guest mutations on planned events are deliberately never gated.

## Design (decision #38)

**The UI layer is already implemented in `src/` and is the source of truth for the UI — reuse and extend it, never regenerate a screen.** ~26 screens live as React/TS components, now **wired to live Supabase data** via the shared `src/features/po/` layer (some `src/lib/po/` mock data persists for types + small fallbacks):

- `src/components/po/` — design-system kit (`kit.tsx`, `icon.tsx`, `shell.tsx`), app shell + nav stack (`app.tsx`, `context.tsx`), and all screens under `src/components/po/screens/` (`auth`, `events`, `guests`, `door`, `approvals`, `settings`).
- `src/lib/po/` — typed mock data (`data.ts`, `types.ts`), the deterministic quick-add parser (`parse.ts`, decision #33), and raw token helpers (`theme.ts`).
- Mounted at the `/app` route (`src/app/app/page.tsx`). Design tokens + the two fonts live in `tailwind.config.ts`.

Per Werkwijze v2 (`bouwplan-claude-code.md`): a UI phase now means **building the backend under an existing screen and replacing its mock data with real Supabase data while preserving the component API** — not rebuilding the screen.

**One responsive surface (launch architecture — surface-unification, merged 2026-06-21 via PR #50; this supersedes the earlier "two surfaces, one viewport-switch" plan).** There is now **one UI**: the responsive **`po` app at `/app`** (`ResponsiveShell` — mobile bottom-tabs <1024px, desktop sidebar ≥1024px). Every authenticated entry lands on `/app`; there is **no viewport dispatcher** — phones and desktops share the same surface. The old desktop `(app)` dashboard is **retired**: its routes (`/dashboard`, `/events/*`, `/admin/*`, `/settings/*`, and since the T9 fold also `/eventday`) redirect to `/app`. The Event-dag cockpit is the **desktop (≥1024px) variant of the Deur tab** inside `/app` (T9 fold, 2026-07-07); mobile keeps the outbox-backed door tab. All screens read/write live data via the shared `src/features/po/` layer (React Query reads over the browser client + existing `src/features/*` server actions for writes; mirror `src/features/stats/po-adapter.ts`). **Desktop density is per-screen** via a `WIDE_DESKTOP` width map in `src/components/po/app.tsx` + the shell's `mainMaxClass` + Tailwind `lg:`/`xl:` (done: Home, Gastenlijst, Statistieken, Audit, Events, Gebruikers). Breakpoint 1024px; keep it Capacitor-safe (#37). Never duplicate the door's offline outbox — the `po` Deur tab reuses `src/features/door/DoorProvider`.

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

The full launch plan — STAP 0 status report, screen inventory (stable IDs S0–S13), design briefs, and STAP 1–4 — lives in `launchplan-claude-code.md` (repo root; note its viewport-switch/"Strategy A" framing is **superseded** by the surface-unification below). Build state: backend + RLS + audit + quota-engine + door PWA + landing + stats + AVG are done and live. The **surface-unification** (PR #50, 2026-06-21) collapsed the desktop `(app)` dashboard and the mobile `po /app` into **one responsive surface** at `/app`: every login lands there, the `(app)` shell is retired (routes redirect), and the po screens are wired live via `src/features/po/`. The **T9 fold (2026-07-07)** retired the standalone `/eventday` route too: the Event-dag cockpit is now the desktop Deur tab inside `/app` (`EventDayCockpitGate` mounted lazily in `src/components/po/app.tsx`, event choice shared with the mobile door via `doorEventId`); `/eventday` redirects to `/app`. Desktop layouts are done for Home, Gastenlijst, Statistieken, Audit, Events, Gebruikers and Deur (cockpit); remaining polish = tablet (641–1023px) layouts and `/app` deep-linking. Work proceeds in separate sessions, one ClickUp task at a time.

**Settings polish — #39 test-feedback (S4.1–S4.3, [PR #56](https://github.com/Max-Seffelaar/PlusOne/pull/56), 2026-06-22).** The settings-cluster feedback is in: (S4.1) invite role-selection is chip toggles with **nothing pre-selected**, and an **admin** can assign the invitee as **event organizer** of one/several/all upcoming events — captured on `invites.event_ids` and granted on acceptance by `accept_pending_invites()` (admin-only via the `invites_insert` RLS, mirrors `assignOrganizer`; migration `20260622120000`). (S4.2) the active-sessions label shows the **OS** (`deviceLabel` in `src/lib/ua.ts`; dev-login forwards the browser UA), the venue **BTW/company grid no longer overflows ≤390px**, and team/invites/sessions have **load spinners**. (S4.3) **optional roles can self-enable/disable MFA** (reusing the `mfa-gate` enroll step); admin/finance stay verplicht. No screen was regenerated — backend wired under the existing po screens per Werkwijze v2.

**Tiers editor — feedback 1/7 T3 ([PR #116](https://github.com/Max-Seffelaar/PlusOne/pull/116), 2026-07-06).** The guest-tier editor (`src/components/po/screens/events.tsx`) replaced its single "door price" field with a **Free/Paid toggle**; a paid tier now carries a display-only **VAT-%** (`guest_tiers.vat_percent` / `event_template_tiers.vat_percent`, default 9 — no billing, migration `20260706140000`). The color palette grew from 6 to 11 (`src/lib/po/tier-colors.ts`), disables a color already used by another tier in the same event, and allows reuse with a warning once every color is taken. Explicit **Save / Save & add another / Cancel** actions replaced the single "add tier" button, and the empty state is now a clickable "+ Add your first tier" CTA instead of a hidden top-right icon. The compact "create a tier on the spot" flow (quick-add/bulk/contacts) got the same toggle/palette/VAT field for consistency. Also fixed a pre-existing bug where `create_template_from_event` silently dropped `door_price_cents` when snapshotting a tier into a template.

**Team & external crew — feedback 1/7 T8 ([PR #121](https://github.com/Max-Seffelaar/PlusOne/pull/121), 2026-07-07, prod-pushed).** The Team screen (`Gebruikers` in `src/components/po/screens/settings.tsx`) now has **two sections**: Venue members and **External crew** (venue-wide `event_organizers`, deduped, members excluded — `fetchVenueCrew`/`usePoVenueCrew`). The invites list includes accepted/expired invites with a **status chip** (Accepted = immutable history, Expired = red) and pending/expired invites get **Resend + Revoke**. Resend of a venue invite = fresh 7-day expiry + a new mail; the expiry bump is the ONLY client-UPDATE path on `invites` ever — column-grant limited to `expires_at` behind RLS `invites_update_resend` (manager role, pending only, escalation guard, ≤30 days; migration `20260707113000`), audited by the existing trigger. A crew member's "accepted" state is derived from `user_profiles.terms_accepted_at` (set at first-login consent); crew resend re-mails their login (admin-only). **Two invariants to keep:** (1) all invite/resend mail goes through `src/features/auth/invite-mail.ts` `sendInviteEmail` — invite-first with magic-link fallback, because `signInWithOtp` hard-refuses UNCONFIRMED accounts ("Signups not allowed"), which is every invitee who never accepted; (2) crew provisioning uses `inviteUserByEmail`, never `admin.createUser` — createUser sends no e-mail at all (the pre-T8 bug: crew were invited into silence).

**Performance (STAP 3.5).** The read-only baseline (`perf-baseline-3.5a.md`, incl. a 1500-guest stress test) and the six **3.5b** code-fixes are done and merged: ranged reads (#0a — fixes the 1000-row PostgREST truncation that hid ~532 guests at the door on large events), realtime throttle 10→200 eps + refetch-on-reconnect (#0b), list virtualization + search debounce (#1a/#1b), `/app` code-split + eventday first-paint + deur-CLS (#2a/#2b) — via [PR #53](https://github.com/Max-Seffelaar/PlusOne/pull/53) (correctheid + deur) and [PR #54](https://github.com/Max-Seffelaar/PlusOne/pull/54) (polish). No schema change. What remains of STAP 3.5 is the **scale-track (#3)** for the 500+-concurrent-org target (realtime `postgres_changes`→Broadcast, polling/caching, Supabase compute-tier + Supavisor pooling sizing, cost model, hosted realtime load-test) — its own session, **not an MVP/pilot blocker** (the DB writes are rock-solid: 495 check-ins/sec, p95 13 ms). **Scale-track progress (2026-06-23, `perf-scale-track-3.5.md`):** design + cheap ops-checks done (compute-tier/pooling sanity + cost model ≈ €0,25/org/mnd; the bindende as = realtime concurrent-connections, niet pooling). The **linchpin shipped + pushed to prod**: `check_ins`/`refusals` now carry `event_id`+`venue_id` (filled by the `set_checkin_scope` BEFORE-trigger), the SELECT-policies collapsed to one membership check on the indexed `venue_id`, the door/cockpit realtime subscriptions filter `event_id=eq.X`, and the typed client + insert paths are wired ([PR #59](https://github.com/Max-Seffelaar/PlusOne/pull/59) + [#60](https://github.com/Max-Seffelaar/PlusOne/pull/60) collision-fix + the realtime-filter/types wiring PR). Remaining: `postgres_changes`→**Broadcast**, polling/caching trims, and the **hosted load-test** (vóór/na bewijs, `scripts/perf/realtime-loadtest-hosted.mjs`).

**Testen & QA (STAP 4.1, 2026-06-23 — `docs/test-report.md`).** De uitvoerbare test-suites draaien sequentieel groen: **Vitest 39 files / 434 tests** en **pgTAP 22 files / 529 tests** op een verse `supabase db reset` (een schone reset bewijst meteen: geen migratie-timestamp-collisies), met `pnpm lint` + `type-check` schoon. Toegevoegd voor bestaande logica: offline-outbox `refusal`/`ack_note` replay (nu 8/8 kinds) + de statushelpers (`isPending`/`isRetryable`/`hasUnsynced`), en een **secret-grep** guard die de `service_role`-key buiten client-code houdt (faalt als de key buiten de éne `server-only`-module of in een `'use client'`-component opduikt; draait in de bestaande `pnpm test`-CI-stap). **Uitgesteld** (feature bestaat nog niet): Stripe-webhook, ticketing-adapter/Vault, deur-push/realtime-taken. Open: geen line-coverage-meting, server-`actions.ts` alleen indirect gedekt (RLS = grens), en de e2e-kernflow = STAP 4.3.

**Full-app review remediation (2026-07-07, remediation artifact linked from ClickUp `86ey6xdjp`; NOTE: the `engineering-review-2026-07.md` "flagship doc" this section used to cite was never actually committed — treat any reference to it as stale until someone writes it).** A 10-angle review (35 verified findings, 7 phases P0–P6, ClickUp list `901818739469`) is being shipped one phase-PR at a time. **P0 security DONE + prod** (PR #131 `fe248f4` — crew-invite authz, anon RLS surface, approval race; migration `20260707170000`). **P1 door outbox data-integrity DONE + merged** (PR #133 `43086bc`, **no migrations**): C8 `syncing`-orphan recovery on `store.init` (`resumeStuckEntries`), C9 terminal codes → dead-letter + drain skips past a wedged entry (only a code-less/network failure pauses), C10 `reviveCheckIn` voided-only guard, C11 door realtime `check_ins` `event:'*'` (peer void/top-up visible ~1s vs ≤60s), C12 empty-name add-on-spot block, C13 `getDeviceId` storage guard + `DoorErrorBoundary`, C14 persist buster, C28 door TZ pinned. Perf/verification record: `perf-outbox-p1-133.md` (`scripts/perf/outbox-drain-bench.mjs` — wedge-drain 0→4999/5000). **P2 audit/quota/stats DONE** (migration `20260708100000`): C6 `event_user_additions` restored the `where c.voided_at is null` filter its own predecessor carried (a voided check-in had silently counted as present in the per-member "Added by" breakdown); C7 `events.default_member_quota` changes now audit AND the three per-column `events` audit triggers were consolidated into one (`audit_events`, `WHEN (list_locked OR allow_uncheck OR default_member_quota changed)`) — the two pre-existing single-column triggers (`audit_events_lock`/`audit_events_allow_uncheck`, both already-applied migrations) never fired for this column, so it wrote zero audit rows despite a migration comment claiming otherwise; rather than bolt on a third near-identical trigger, this migration DROPs the old two and replaces them with the one consolidated trigger (forward-only DDL — legal without editing the old migration files); K10 the four historically "keep in LOCKSTEP by comment" functions (`audit_trigger`, `run_privacy_retention`, `submit_guest_request`, `approve_guest_request`) now have a checked-in canonical body each under `supabase/canonical/` plus a guard test (`tests/unit/canonical-functions.test.ts`, runs in `pnpm vitest run`/CI) that fails if a future migration redefines one with a different body. **P3 cache invalidation & false-success DONE + MERGED** (PR #136 `e652588`, **no migrations**; all 8 subtasks C15/C16/C17/C18/C19/C24/C25/G2): C15 `updateGuest`/`changeGuestTier`/`removeGuest` now use `{ count: 'exact' }` + a new `notFound()` helper (`db-errors.ts`) so an RLS-filtered 0-row write returns an error instead of `ok:true`; C16 the shared `guestMutation` factory (mutations.ts) also invalidates `poKeys.quota(eventId)` now; C17/C18 `usePoApproveRequest`/`usePoForgetContact` invalidate the venue-wide All-Guests cache (a separate cache from the per-event `guests` prefix each already invalidated); C19 `usePoEventRealtime`'s `invalidate()` also refreshes venue-guests + `eventDetail`; C24 `switchToVenue` clears the persisted nav-state before the post-switch reload and clears the "Switching…" toast on a rejected `setActiveVenueAction` instead of leaving it stuck; C25 `stats/data.ts` now throws on a real RPC/query error instead of collapsing it into an empty shape indistinguishable from the legitimate role-gated empty case — Analytics shows an error+retry state; G2 `usePoUpdateInfluencer` invalidates the Promotion link-funnel/promo prefixes. New tests: `guests/actions.test.ts`, `po/mutations.test.tsx`, `po/hooks.eventRealtime.test.tsx`, `stats/data.test.ts`. **Same-PR follow-up from manual test feedback** (2nd commit, same #136): `upsertContact`'s generic "This already exists." now names the conflicting field via `mapContactUniqueError` (both `contacts_venue_email_uidx`/`contacts_venue_phone_uidx` are venue-scoped, confirmed — never a cross-venue collision), and the contact-edit / save-as-contact ("Save as contact") flows in `ContactProfile` now show a "Saved."/"Saved as contact." confirmation toast instead of closing silently. **Dev-mode gotcha found + resolved this session (not a code issue): a long-running `pnpm dev` session recompiled all ~3900 modules on nearly every request (2.4–2.9s each) instead of serving from cache, making the app FEEL slow (7s contact saves, sluggish venue switch) — clearing `.next` + restarting the dev server fixed it (`POST /app` back to ~800ms).** **P4 input & date correctness DONE + MERGED** (PR #138 `0e37cf6`, migration `20260708110000`): C20 the quick-add tokenizer's `+`-split ran *before* contact-token extraction, silently swallowing a plus-addressed email's mailbox tag (`jan+vip@x.nl` → `jan`); contact-token extraction now runs first, on plain-whitespace tokens. C21 `buildEventSlug()` sliced the UTC day off `starts_at`, baking the wrong (previous) day into the permanent, never-editable slug for a 00:00–02:00 Amsterdam start (CEST/CET is ahead of UTC); fixed both the app helper and its DB backstop trigger (`events_set_landing_slug`) to use the event's Amsterdam calendar day. C22 the auto-lock save comparison string-compared `toISOString()` (`…Z`) against PostgREST's `…+00:00` for the same instant, so it was always "dirty" and fired a redundant write on every save; normalized through the existing `splitLocal` helper. C23 template auto-lock "hours before doors" used a plain `Number()`, so a Dutch decimal (`1,5`) silently became `NaN`→`null` while the UI kept showing "Locks 1,5 hours"; reuses the price/VAT `,`→`.` normalization (`parseAutoLockOffsetMinutes`) and now blocks Save with an inline error instead of silently nulling. C27 deleted `PeriodControls` (stats preset from-date, UTC-sliced local date) — zero importers anywhere in the app. **P5 mock-data purge, billing & cleanup: 6/8 findings DONE + MERGED** (PR #139 `f3f31ac` mock-purge, PR #140 `05da737` billing+cleanup, **no migrations**; K6/K11 deliberately deferred — see below): K1 the per-event Allowance screen (100% mock members, steppers wrote nothing) is wired to live `event_quotas` — a new `usePoEventAllowance`/`usePoSetAllowance` reuses the existing `setEventUserQuota` write path (`event_quotas` is admin-role-only RLS, no AAL2, since the 2026-06-24 refinement), per-row save mirroring `MemberQuotaRow`, a calendar-icon sheet to pick the event; K2 the venue-switcher's mock "Max Seffelaar" fallback (shown while the profile query loads/errors) is now a neutral placeholder — also removed the now-fully-dead `account`/`allowanceData` mock fixtures (`lib/po/data.ts`). K5 `createCheckoutSessionAction`/`createPortalSessionAction` now catch a `StripeAdapter` throw (network/rate-limit/invalid-request) instead of crashing the server action, returning the existing `unavailable` shape (raw error logged server-side only). K7 removed the stale AAL2 wall + step-up sheet on admin-sessions — `admin_list_user_sessions`/`admin_revoke_session` dropped their AAL2 check in the 2026-07-02 MFA-fully-optional refinement (confirmed in `20260702120000_mfa_fully_optional.sql`); deleted the now-dead `usePoAal2` hook (its only consumer). K4 the stripe-confinement test now also catches a dynamic `import('stripe')`, not just `from`/`require`. C26 the billing checkout/portal redirect's `mutateAsync().then()` had no rejection handler — a real unhandled-promise-rejection, reproduced live via the Next.js dev overlay on a trialing venue (Set up payment → "Runtime Error" overlay) before the fix, confirmed gone after. **K6 (delete dead pre-login mock-auth flow) and K11 (guests-tab tier-role collapse, same change as FE-2) deliberately skipped this round** — K6 touches `app.tsx`, which P3's C24 also touches; K11 is the same `tierRole` change as FE-2 — both belong in their own sessions to avoid merge collisions.

**Unrelated ad-hoc fix (2026-07-08, reported by Max via screenshot, not a review finding):** the desktop sidebar (`ResponsiveShell`, ≥1024px, `shell-responsive.tsx`) had no scroll container — the nav list + a `flex-1` spacer + the profile footer sat inside a fixed-height, `overflow-hidden` `aside`, so a short browser window or a long nav list clipped items (and sometimes the profile footer itself) with no way to reach them. Fixed by making the nav list itself the flexible, scrollable region (`min-h-0 flex-1 overflow-y-auto`) instead of a fixed list + separate spacer, with the profile footer as a `flex-none` sibling that always stays visible. PR #141 `b108349`, merged.

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
   - Real routes (`/door/[id]`, `/e/[slug]`): `http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=<route>`. (The old `(app)/*` pages incl. `/eventday` are retired — they redirect to `/app`; the cockpit is the desktop Deur tab.)
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

## Scale & front-end discipline (2026-07 review — enforce on every PR)

Established by the full-app review + scale audit (`engineering-review-2026-07.md`,
`perf-scale-audit-megaevent.md`). These are hard rules, not preferences — they exist because the
fast-parallel-PR workflow created the exact debt they prevent.

**Scale (a query that works at 150 rows must work at 25 000 and after 400 events):**
- **Never pass an unbounded id list to PostgREST `.in()`.** A venue-wide read must filter by
  `venue_id` in SQL (`events!inner(venue_id)` embed, a denormalized `venue_id`, or an aggregate
  RPC) — **never** `.in('event_id', <all venue event ids>)`. That URL crosses the ~8 KB gateway
  limit at ~205 events and hard-fails 414 for every venue within a year. **Fixed 2026-07-09**
  (migration `20260708120000_venue_scope_denormalization.sql` — `guests`/`guest_requests`/
  `quota_requests`/`guest_tiers` now carry `venue_id`; `request_links` already did); this rule
  is what keeps it fixed. Applies to reads AND writes (`.in('id', [hundreds])` 414s too — chunk
  to ≤120 ids if a list is truly unavoidable).
- **Aggregate on the database, not the client.** Headcounts/stats over many rows = a `GROUP BY`
  RPC returning ~one row per group, not "download every guest row and sum in JS" (K8, fixed via
  `venue_event_headcounts` — SECURITY INVOKER, not DEFINER, so headcounts stay role-relative:
  a staff member's tile is still scoped to their own added guests, never a blanket bypass).
- **Reads must be windowed at large N.** The door snapshot is ~0.55 kB/guest; at 25k that's 13.6 MB
  over 32 sequential round-trips. Load a working set + search server-side; don't ship the whole event.
- **Don't re-fetch a large snapshot on every mutation** — rely on the optimistic patch + realtime +
  the 60 s safety sync (K9).
- Local numbers are a floor: the service client bypasses RLS and loopback hides the Vercel `fra1` ↔
  Supabase `eu-west-1` latency. Realtime concurrency + RLS-read CPU are **hosted-only** to measure
  (`scripts/perf/realtime-loadtest-hosted.mjs`, throwaway project — never prod).

**Front-end (one canonical model, thin view-models, primitives in the kit):**
- **One canonical domain type per entity** (`src/features/po/domain/`: `Guest`/`Event`/`Tier`/…).
  Screen/feature shapes are `Pick<>`/projection *view-models* of it — **do not** invent a new
  `interface XGuest` per screen. (Today Guest has 8 shapes, Event 7 — that is the anti-pattern.)
- **Exactly one adapter per entity** (DB row → domain). No second "optimistic" or per-screen mapper;
  no re-deriving `tierRole` or re-formatting dates in a fifth place (one `format.ts`).
- **Share a base query; vary shape with React-Query `select`.** New "fetch the same table, slightly
  different columns/scope" = a scope param on the existing fetcher, not a new `fetchX` (FE-3 — done
  for guests/tiers: `fetchGuests`/`fetchTiers` now take a `{eventId}|{venueId}` scope; the crew trio
  already followed this pattern before the review, so it was left as-is).
- **New UI primitive → it goes in `kit.tsx`** (or `shell.tsx`), exported, used everywhere. Do not
  hand-roll `press`/`cardPress`/segmented-tabs/confirm-sheets/chips in a screen. If the kit lacks it,
  add it to the kit in the same PR.
- **No mock-data imports in shipped screens.** `src/lib/po/data.ts` fixtures are for types/tests, not
  render paths (K1/K2/K3). A screen that can render `data.ts` in prod is a bug.
- **Screen files stay under ~800 LOC.** `events.tsx` (2090) / `settings.tsx` (1976) are refactor
  targets, not a template — extract sub-screens/sheets into their own files.

## What NOT to do

- Do not add auth providers, password login, or third-party auth services.
- Do not use the service-role client to "make RLS problems go away".
- Do not hard-delete rows or disable triggers, even in seed/test helpers.
- Do not introduce server state for door-app search/filtering — that stays local-first.
- Do not start a task by rewriting earlier phases; build incrementally on the existing migrations.
