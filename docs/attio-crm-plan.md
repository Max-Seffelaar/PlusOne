# Tractie & Attio CRM — implementation plan (2026-07-09)

Decided in discussion Max ↔ Claude, 2026-07-09. Goal: full visibility on new-customer traction
(who was invited, who signed up, who created a venue, who ran a first event/door night, who
converted to paying) and a one-way sync of that lifecycle into **Attio** (CRM), plus the
internal surfaces to act on it (weekly digest, founder dashboard, support access).

**Milestone: Now** — knowing where new customers stall in the funnel is direct sales tooling
toward venue #5. Phases 04/05 (platform admin + impersonation) were challenged as possibly
≥5-material; Max explicitly decided to build them now for support readiness.

## Decisions (all 2026-07-09, Max)

| # | Decision |
|---|----------|
| C1 | **Two-field model in Attio.** `Sales stage` (Attio-native, manual: lead → contacted → meeting booked → trial toegezegd → won/lost) is owned by sales and never touched by the sync. `Product lifecycle` (synced hourly by us) is treated as read-only in Attio. Pre-signup stages therefore live only in Attio. |
| C2 | **Product lifecycle ladder:** `invited → signed_up → venue_created → onboarded → first_event → first_door_night → active` (event in last 30 d) `→ paying` / `comped`; cross-flags `at_risk` (no event in 60 d) and `churned` (canceled). |
| C3 | **Attio scope:** Companies = venues (match key `plusone_venue_id`) **and** People = all team members, **all roles incl. staff/door**, linked to their Company. Guests/contacts (consumer PII) are **never** synced — aggregates only. |
| C4 | **Sync mechanism:** hourly Vercel Cron route `/api/cron/attio-sync` (CRON_SECRET-guarded), full idempotent assert per venue against the Attio REST API. No outbox, no realtime. |
| C5 | **Traction surfaces: all three** — Attio (sales view), weekly digest, founder dashboard. |
| C6 | **Digest lands in Slack AND is persisted** so the founder dashboard shows the historical record. |
| C7 | **Platform-admin concept gets built now**, including **support impersonation** (not deferred to a later decision). Guardrails below are hard requirements. |
| C8 | Plan + tasks are mirrored to ClickUp (list `901818739469`, ClickUp Doc). |

## Privacy / AVG (blocking prerequisites for phase 02)

- Guests, guest_requests, contacts: **never leave the platform.** Only counts/timestamps.
- Syncing all team members (C3) = processing employee personal data in Attio. Required before
  the sync goes live: **Attio DPA signed** (workspace settings), **privacyverklaring updated**
  (Attio as processor, purpose: customer relationship management). Note: staff/door accounts
  often use private e-mail addresses — accepted by Max with the full-roles decision.
- Sync payload per person: name, e-mail, role(s), venue link, created_at. Nothing else.
- When a membership is revoked or a user is deleted, the sync asserts the removal (person
  loses the company link / gets archived) on the next run.

## Architecture

### Data foundation (phase 01)
- Migration: `events.created_by uuid references user_profiles` (nullable, filled by app on
  create; backfill best-effort from audit/organizer data is out of scope).
- `venue_lifecycle` view (or RPC): per venue — created_at, creating user + originating invite,
  onboarding completed, first_event_at, first_checkin_at, events_last_30d, subscription
  status, `lifecycle_stage` (C2 ladder computed in SQL), last_activity_at (max `audit_log`
  row per venue as activity proxy — deliberately better than login tracking; we do NOT add
  last-login tracking).
- `user_activation` view: per user — invited_at/by, accepted_at, profile created_at,
  memberships, whether they created a venue.
- Both views are cross-venue ⇒ **revoked from `authenticated`**, readable only via
  service_role (sync/digest) and later the platform-admin RPCs (phase 04). pgTAP proves the
  deny case for every venue role.

### Attio sync (phase 02)
- `src/features/crm/` behind a `CrmProvider` interface — same pattern as billing: all Attio
  API calls live here (vitest guard: no Attio imports elsewhere), stub provider when
  `ATTIO_API_KEY` is absent so local/CI stays keyless.
- Hourly Vercel Cron → `/api/cron/attio-sync`, `CRON_SECRET` guard, middleware-exempt like
  `/api/webhooks/`. Reads `venue_lifecycle` + team members via service_role (read-only —
  documented service-role exception #2, needs security review), asserts Companies and People
  via `PUT /v2/objects/{object}/records?matching_attribute=…` (match: `plusone_venue_id`,
  people by e-mail). Full-state assert each run ⇒ a missed run self-heals; no cursor state.
- Attio workspace setup (one-time, scripted or manual): custom attributes on Company —
  `plusone_venue_id`, `product_lifecycle` (select, C2 values), `subscription_status`,
  `first_event_at`, `events_last_30d`, `last_activity_at`, `app_url`. `Sales stage` is
  configured by Max in Attio and never written by us (C1).
- **High-risk surface** (service_role + cron auth): fresh-session `/code-review` +
  `/security-review` before merge.

### Weekly digest (phase 03)
- Weekly Vercel Cron → builds digest from the same views: new invites, invites accepted,
  new venues, first events, first door nights, conversions to paying, at-risk venues.
- Delivery: Slack incoming webhook (`SLACK_DIGEST_WEBHOOK_URL`) **and** persisted to a
  `founder_digests` table (jsonb payload + created_at) so the founder dashboard renders the
  history (C6). No e-mail (no outbound mail infra until F3/Resend).

### Platform admin + founder dashboard (phase 04)
- `platform_admins` table (user ids; Max + optionally Joeri). **No blanket RLS rewrite**: the
  dashboard reads through dedicated `SECURITY DEFINER` RPCs (`platform_venue_lifecycle()`,
  `platform_user_activation()`, `platform_digests()`) that check `platform_admins`
  membership and write an audit entry per call (`action='platform_read'`). Existing venue
  RLS and its pgTAP proofs stay untouched.
- Founder dashboard: internal route (e.g. `/internal`), platform-admins only, shows the
  lifecycle funnel, per-venue drill-down, digest history. Not part of the `po` 5-tab surface.

### Support impersonation (phase 05 — hard guardrails)
Max decided to build this now. Non-negotiable design constraints:
1. **Audit truth is never falsified.** All actions during a support session are attributed to
   the platform admin (actor = admin's own `auth.uid()`), never to the customer. We do NOT
   mint a session as the customer's user. Access is granted via a scoped mechanism (e.g. a
   short-lived `support_venue_id` claim or support-session table consulted by RLS policies
   that get an additive support path) — exact mechanism is a phase-05 design decision with
   its own review. Any audit-trigger change requires Max's explicit confirmation first.
2. **Time-boxed** (session expires ≤ 60 min) and **explicitly started/stopped** — both
   transitions are audit actions (`support_session_start` / `support_session_end`) with the
   target venue.
3. **Visible**: persistent banner in the UI during a support session; the venue's own audit
   feed shows support actions attributed as support, so the customer's fraud trail stays clean.
4. Fresh-session `/code-review` + `/security-review` mandatory; every touched policy re-proved
   in pgTAP (allowed for platform admin in active session, denied otherwise, denied after expiry).

## Phases → ClickUp tasks (list `901818739469`, prefix "Tractie/Attio 9/7")

| Task | Scope | Model | Milestone |
|------|-------|-------|-----------|
| 01 Lifecycle-fundament | `events.created_by` + `venue_lifecycle`/`user_activation` views + pgTAP deny-proofs | Opus | Now |
| 02 Attio-sync | `src/features/crm/` provider + hourly cron + workspace setup + guards | Opus | Now |
| 03 Weekly digest | Slack webhook + `founder_digests` persistence | Sonnet | Now |
| 04 Platform-admin + founder-dashboard | `platform_admins`, platform RPCs (audited), `/internal` dashboard | Opus | Now |
| 05 Support-impersonation | design + build per guardrails above | Fable (design) → Opus (build) | Now |
| 06 Max-acties | Attio API key, DPA, privacyverklaring, Slack webhook, `Sales stage` pipeline in Attio | — | Now |

Order: 01 → 02 → 03 → 04 → 05. 02 and 05 are high-risk surfaces (review gates apply).
Dependencies: 03 needs 01; the dashboard part of 03's record view lands with 04.

## Out of scope (explicitly)

- Two-way sync / writing sales data back into the app.
- Deals/pipeline automation from the app (Attio workflows can react to `product_lifecycle`).
- Syncing guests/contacts or any consumer PII to Attio — never.
- Last-login tracking (audit-activity proxy is the deliberate choice).
- PostHog product analytics (separate parked plan, after G1).
