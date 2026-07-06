# PostHog implementation plan — product analytics & event tracking

**ClickUp task:** [86ey3x371](https://app.clickup.com/t/86ey3x371) — "[Infra] PostHog implementeren"
**Status:** approved design, ready to build. This document is the single source of truth for the implementation; it is written so a fresh session can execute it end-to-end without additional context.
**Target:** PostHog **Cloud EU** (ingestion `eu.i.posthog.com`, UI `eu.posthog.com`) — consistent with Supabase `eu-west-1` and Vercel `fra1`.

Binding repo rules (read `CLAUDE.md` first): no PII in event properties/URLs/logs, the security checklist for every touched route/action, the Capacitor-readiness checklist (#37), the notifications adapter pattern (`src/features/notifications/provider.ts`), migrations with unique timestamps + pgTAP + regenerated `database.types.ts`, Dutch UI copy / English code.

## Decisions (made by Max, 2026-07-06)

1. **In-app consent = default ON with opt-out.** Product analytics for authenticated venue users is part of the terms (functional product telemetry), with a self-service off-switch in Settings. Deliberate trade-off: maximum data coverage; ePrivacy-grey but common for B2B SaaS. Counterweight: clear disclosure on the consent screen + an easy toggle.
2. **Cookie banner on public pages is required.** Visitors must accept a banner, and the consent setup must be future-proof for **Google, Meta, TikTok** marketing pixels (planned later). So: a category-based consent manager (`necessary` / `analytics` / `marketing`) + a banner on the public site. PostHog runs on public pages only after analytics consent; future pixels hang behind marketing consent with no new infrastructure.
3. **Feature insight without page switches.** The po app lives on a single URL (`/app`), so pageview tracking is meaningless. Which features are used (and which are not) must be directly visible: a `screen_viewed` event per nav-stack screen + an explicit event per feature action.
4. **Guests are never tracked.** No guest-facing events; the public `/e/[slug]` guest form gets the banner but no guest-specific events in v1. Guest PII stays entirely out of PostHog.

## Architecture

### 1. Adapter singleton — `src/features/analytics/`

Mirror `src/features/notifications/provider.ts` exactly (interface → Noop implementation → module singleton). Do **not** build a React `PostHogProvider`: the door surface (`src/app/door/layout.tsx`) and `/eventday` (`src/app/(app)/layout.tsx`) have no shared React tree with the po surface (`src/app/app/page.tsx`), and non-React code (DoorProvider callbacks) must be able to capture. Callers never import `posthog-js` directly.

```
src/features/analytics/
  provider.ts         AnalyticsProvider interface + NoopAnalyticsProvider + `export const analytics` singleton
  posthog-client.ts   posthog-js implementation (lazy dynamic import)
  events.ts           typed event catalog (discriminated union — see Taxonomy)
  consent.ts          category consent manager (see Consent)
  AnalyticsBoot.tsx   root boot component (client, renders null)
  AnalyticsGate.tsx   per-surface identify/reconcile component (client, renders null)
  CookieBanner.tsx    public-route cookie banner (client)
  actions.ts          setAnalyticsConsentAction server action
  server.ts           posthog-node wrapper, `import 'server-only'`
```

Interface: `enable(config)`, `identify(id, props)`, `group(type, key)`, `capture(event)` (typed via `events.ts`), `register(props)`, `reset()`, `optOut()`, `isEnabled()`.

Key behaviours:
- **Lazy load:** `posthog-js` is loaded with a dynamic `await import('posthog-js')` inside `enable()` — never statically. The door route's first paint (perf work STAP 3.5) must not regress; users without consent never download the bundle.
- **No key = Noop forever:** empty/missing `NEXT_PUBLIC_POSTHOG_KEY` keeps the Noop provider. Local dev is silent by default (`scripts/dev-env.mjs` writes no PostHog key).
- `enable()` turns on `posthog.debug()` when `NODE_ENV !== 'production'`.

### 2. Consent manager — `src/features/analytics/consent.ts`

One source of truth for **all** current and future tracking, public and in-app:
- Categories: `necessary` (always granted, not toggleable), `analytics`, `marketing`.
- Persisted in localStorage key `plusone.consent.v1` as JSON: per-category `granted: boolean`, plus `decidedAt` timestamp and a `version` string (bump to re-prompt everyone after a material policy change).
- SSR/webview-guarded (`typeof window` checks — Capacitor checklist), tolerant of corrupt/missing values (treat as "no decision yet").
- A small subscribe API (`onConsentChange(cb)`) so later pixel loaders (GTM/Google/Meta/TikTok) can react to `marketing` being granted without touching this module again.

### 3. Cookie banner — public routes

`CookieBanner.tsx`, mounted in `src/app/layout.tsx`, but **only rendered on public routes when no stored decision exists**. Public routes: `/`, `/e/[slug]`, `/login` (pre-auth). Never render it inside the authenticated app surfaces (`/app`, `/door/*`, `/eventday`) — in-app consent is handled via terms + Settings (see below), and the banner must never appear inside the future Capacitor webview.

- Options: "Alles accepteren" (all categories), "Alleen noodzakelijk" (deny analytics+marketing); optionally a per-category expand. Dutch copy, design-system styling (near-black `#0B0B0D`, lavender accent), clean at ≤390px, tap targets ≥44px.
- **Nothing loads before a decision:** no decision stored → no PostHog init, no analytics storage writes, zero network. This is the ePrivacy requirement and it is absolute.
- Link to the privacy/cookie policy (`PRIVACY_URL` from `src/lib/legal.ts` — currently a placeholder URL; the live policy is a go-live dependency, see Max checklist).
- The `marketing` category exists in the banner from day one even though no pixels ship yet — adding Google/Meta/TikTok later is then only a loader behind `marketing` consent plus a CSP extension (see Risks).

### 4. Initialization & identify lifecycle

- **`<AnalyticsBoot/>`** in `src/app/layout.tsx` (client, renders null): reads the consent manager; if `analytics` is granted, calls `analytics.enable()`. On public pages this yields anonymous capture (only `landing_viewed` — see taxonomy); `person_profiles: 'identified_only'` prevents anonymous person profiles, and anonymous events merge onto the person at later `identify()` — keeping the landing → signup funnel intact.
- **`<AnalyticsGate identity={...} optOut={...} surface="po|door|eventday"/>`** on each authenticated surface:
  - po: `src/app/app/page.tsx` — extend the existing server-side identity resolution with a read of `user_profiles.analytics_opt_out_at`, pass to the gate mounted next to `<PoLiveProvider>`.
  - door: `src/app/door/layout.tsx` — server component; read session user + opt-out there (middleware already guarantees a session). Do not rely on `DoorProvider`'s async `getUser()`.
  - eventday: `src/app/(app)/layout.tsx` — same pattern.
  - The gate: reconcile DB ↔ localStorage (**DB wins for authenticated users**) → `enable()` → `identify(userId, { roles, venue_id })` → `register({ venue_id, roles, app_surface })` (super properties) → `group('venue', venueId)` → `capture('app_opened')`. Identify **before** any capture.
- **Reset on sign-out** — logout lives in two places; call `analytics.reset()` (wraps `posthog.reset()`) in both, before the redirect resolves:
  - `signOutDevice()` in `src/components/po/screens/settings.tsx` (used by two buttons),
  - the inline `signOut()` in `src/features/auth/components/MfaChallengeForm.tsx`.

### 5. In-app consent: default ON, opt-out (decision 1)

- **Migration:** add to `public.user_profiles`: `analytics_opt_out_at timestamptz NULL` (NULL = tracked; set = opted out — same single-column style as `mfa_snooze_until`). Column comment explaining the semantics. Pick a **unique migration timestamp** (check `git ls-files supabase/migrations | grep <YYYYMMDD>` against origin/main). Confirm the existing self-update RLS policy on `user_profiles` covers the new column (extend the column surface if the policy is allowlisted). Regenerate `src/lib/database.types.ts` in the same PR.
- **Disclosure, not a checkbox:** extend the consent-screen copy (`src/features/auth/components/ConsentScreen.tsx`, via its existing i18n surface) with one line: product analytics is on, anonymous at the guest level, and can be disabled in Settings. No new checkbox.
- **Settings toggle:** in `src/components/po/screens/settings.tsx`, profile section (same placement pattern as the MFA self-service rows), copy in the settings i18n surface. Calls `setAnalyticsConsentAction(optOut: boolean)` in `src/features/analytics/actions.ts` — run the CLAUDE.md security checklist: `supabase.auth.getUser()`, Zod-parsed boolean, own-row update through the user-scoped client (RLS enforces ownership). On opt-out: also call `analytics.optOut()` client-side (`posthog.opt_out_capturing()` + clear PostHog localStorage + set consent manager `analytics: denied`). On re-enable: reverse, then re-identify.
- **Edge case (document in code):** a visitor who denied the banner anonymously and then logs in → the DB opt-out status wins in-app (default ON unless the Settings toggle was used). The banner decision keeps governing the public/marketing categories.

### 6. Reverse proxy — `next.config.js`

Route all ingestion through the app's own origin (adblock resilience; same-origin = no CSP change and Capacitor-safe):

```js
skipTrailingSlashRedirect: true, // required by PostHog's Next proxy pattern
rewrites: async () => [
  { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
  { source: '/ingest/:path*',        destination: 'https://eu.i.posthog.com/:path*' },
],
```

- Order matters (static first). `next.config.js` currently has `redirects` and `headers` but **no** `rewrites` block — add it.
- The production CSP is `connect-src 'self' https://*.supabase.co wss://*.supabase.co` — with the proxy, **no CSP change is needed**. If events ever silently fail to arrive, first check whether something bypasses `/ingest`.
- `skipTrailingSlashRedirect` is a global behaviour change — smoke-test a few routes with trailing slashes.
- Client config: `api_host: '/ingest'`, `ui_host: 'https://eu.posthog.com'`.
- **Service worker:** `public/service-worker.js` (door app shell) only caches GETs, and ingestion is POST — but add a defensive early-return in the fetch handler for `url.pathname.startsWith('/ingest')` so `/ingest/static/*` GETs are never cached.

### 7. posthog-js configuration

```js
{
  api_host: '/ingest',
  ui_host: 'https://eu.posthog.com',
  persistence: 'localStorage',          // no cookies — webview-safe (Capacitor #37)
  person_profiles: 'identified_only',
  autocapture: false,                   // single-URL app + DOM text = guest-name PII risk
  capture_pageview: false,
  capture_pageleave: false,
  disable_session_recording: true,      // only ever enable later WITH input/text masking config
  sanitize_properties: (props) => { /* strip query+hash from $current_url / $referrer */ },
}
```

Autocapture and `$pageview` stay OFF: the entire po surface lives on `/app`, so pageviews carry no information, and autocapture would hoover up DOM text (guest names in list rows). Screen granularity comes from the explicit `screen_viewed` event.

### 8. Server-side events — `src/features/analytics/server.ts`

Exactly **two** events are captured server-side (posthog-node); everything else is client-side:
- `user_signed_up` in `acceptTermsAction` (`src/features/auth/consent-actions.ts`) — first consent write = the funnel's reliable first step; the client is mid-redirect here.
- `venue_created` in `createVenueAction` (`src/features/venues/actions.ts`) — read the caller's `analytics_opt_out_at` first (own-row select under RLS) and skip when opted out.

Module rules: `import 'server-only'` (same hygiene as the service-role key — the secret-grep guard in `pnpm test` shows the enforcement pattern); env `POSTHOG_KEY` + `POSTHOG_HOST=https://eu.i.posthog.com` (server talks to PostHog directly, no proxy hop); **Vercel lambda pitfall:** buffered events die with the lambda — use `captureImmediate()` (posthog-node ≥4) or `flushAt: 1, flushInterval: 0` + `await shutdown()`; wrap in try/catch — analytics must never fail a server action; absent key = no-op.

### 9. Offline door capture — capture-at-enqueue

Capture inside the `DoorProvider` callbacks (`src/features/door/DoorProvider.tsx`: `checkIn`, `refuse`, `voidCheckIn`, `reviveCheckIn`, `addOnSpot`) at the moment `enqueueDoorWrite()` is called, with property `captured_offline: !navigator.onLine` (guard `navigator` per the Capacitor checklist). **Do not touch the outbox** (`src/features/door/outbox/`): piggybacking capture on `drainOutbox()` replay would risk double counts, distort timestamps, and couple the perf-critical outbox to analytics.

Honest limitation (accepted): posthog-js retries failed batches from an in-memory queue and attempts `sendBeacon` on unload — events survive transient offline in a living tab but are lost if the tab is killed while offline. Acceptable: analytics is not the audit trail; `check_ins` rows + the Postgres audit log are ground truth and door analytics only needs to be directionally correct.

### 10. Feature insight on a single-URL app (decision 3)

- `screen_viewed { screen }` fires on **every nav push and tab switch** in `src/components/po/app.tsx` (the nav stack). Do **not** fire on the restore-after-refresh hydration path (the nav-state restore from sessionStorage) — that would create phantom views.
- Every feature action has its own explicit event (taxonomy below), so the weekly dashboard can show per-venue feature adoption — including never-used features (PostHog "first time seen" insights) — without any pageview dependency.

## Event taxonomy v1 (`object_action`, typed in `events.ts`)

Hard rule: **only UUIDs, enums, booleans and counts** in properties. Never guest/user names, emails, phone numbers, or free text (e.g. the refusal `reason` — the guest name sits right in the mutation variables; never forward it). Define the catalog as a discriminated union `AnalyticsEvent` so `analytics.capture()` only accepts known event/property combinations; the PII lint test walks this type's property keys.

**Super properties** (after identify): `venue_id`, `roles` (string array), `app_surface` (`'po' | 'door' | 'eventday'`). **Person properties** (`$set`): `roles`, `venue_id` — deliberately no email/name (the PostHog person ID **is** the Supabase user UUID; look people up in Supabase when needed).

| Event | Captured at | Properties |
|---|---|---|
| `user_signed_up` | server — `acceptTermsAction` first consent write | `via` (`'invite'`\|`'onboarding'`) |
| `app_opened` | client — AnalyticsGate mount (once per pageload) | `surface` |
| `onboarding_step_completed` | client — `OnboardingWizard` step advance (`src/features/onboarding/components/OnboardingWizard.tsx`) | `step` (`'welkom'`…`'team'`) |
| `onboarding_completed` | client — wizard finish | — |
| `venue_created` | server — `createVenueAction` | `venue_id` |
| `event_created` | client — `usePoCreateEvent` / `usePoCreateEventFromTemplate` onSuccess | `event_id`, `from_template` |
| `guest_added` | client — `usePoAddGuest` / `usePoAddContactToEvent` onSuccess | `event_id`, `method` (`'quick_add'`\|`'contact'`\|`'door'`), `plus_ones` |
| `guests_added_bulk` | client — `usePoAddGuestsBulk` onSuccess | `event_id`, `count` |
| `guest_removed` | client — `usePoRemoveGuest` onSuccess | `event_id` |
| `list_lock_toggled` | client — `usePoSetListLock` onSuccess | `event_id`, `locked` |
| `extra_slots_requested` | client — `usePoRequestExtraSlots` onSuccess | `event_id`, `amount` |
| `request_approved` | client — `usePoApproveRequest` onSuccess | `event_id` |
| `request_denied` | client — `usePoDenyRequest` onSuccess | `event_id` |
| `door_checkin` | client — `DoorProvider.checkIn`/`reviveCheckIn` at enqueue | `event_id`, `total_people`, `captured_offline` |
| `door_checkin_voided` | client — `DoorProvider.voidCheckIn` at enqueue | `event_id`, `captured_offline` |
| `door_refusal` | client — `DoorProvider.refuse` at enqueue | `event_id`, `captured_offline` (NOT the reason text) |
| `door_guest_added` | client — `DoorProvider.addOnSpot` at enqueue | `event_id`, `plus_ones`, `captured_offline` |
| `screen_viewed` | client — po nav push + tab switch in `src/components/po/app.tsx` | `screen` (required) |
| `member_invited` | client — settings invite flow onSuccess | `roles_granted` (array), `event_count` |
| `landing_viewed` | client — public landing, only after banner analytics consent | — |

All client mutation hooks live in `src/features/po/mutations.ts` (consistent pattern: `mutationFn → throwOnError(serverAction)`, optimistic `onMutate`, `onSettled` invalidate — add `analytics.capture()` in `onSuccess`).

**Core funnel (task requirement):** `user_signed_up` → first `event_created` → first `guest_added`/`guests_added_bulk` → first `door_checkin`. Server and client events merge on the same distinct_id (Supabase user UUID).

**Group analytics:** call `posthog.group('venue', venueId)` on identify — harmless and future-proofs the data — but note the PostHog **group analytics add-on is paid**; the `venue_id` super property already enables per-venue breakdowns/filters on any plan.

## Implementation phasing (three PRs)

**PR 1 — foundation**
1. `pnpm add posthog-js posthog-node`.
2. Migration `analytics_opt_out_at` (unique timestamp!) + pgTAP (own-row update allowed / other-row denied, both directions) + regenerate `src/lib/database.types.ts`.
3. Consent manager + `CookieBanner.tsx` on public routes.
4. Adapter files (`provider.ts`, `posthog-client.ts`, `events.ts`, `consent.ts`, `AnalyticsBoot.tsx`, `AnalyticsGate.tsx`, `actions.ts`).
5. `next.config.js` rewrites + `skipTrailingSlashRedirect` + service-worker `/ingest` early-return.
6. Consent-screen disclosure line; Settings toggle + `setAnalyticsConsentAction`.
7. Mount `AnalyticsBoot` (root) + `AnalyticsGate` (po/door/eventday); `analytics.reset()` in both sign-out paths.
8. `screen_viewed` wiring in the po nav stack.

**PR 2 — instrumentation**
9. Captures in the `onSuccess` handlers of the mutation hooks listed in the taxonomy.
10. Onboarding step/finish captures in `OnboardingWizard.tsx`.
11. Door captures at enqueue in `DoorProvider.tsx` (five callbacks, `captured_offline`).
12. The two server events (`server.ts` + wiring in `acceptTermsAction` / `createVenueAction`).
13. `member_invited` in the settings invite flow.

**PR 3 — docs**
14. `docs/analytics.md`: the event catalog as the canonical taxonomy ("adding an event = extend `events.ts` + this doc"), the consent model, dashboard definitions.
15. Section in `docs/privacy.md` (PostHog EU as processor); spec decision-table entry in `gastenlijst-app-spec.md` if Max considers this a decision refinement.

## Testing / Definition of Done

- **Vitest** (run with `pnpm vitest run`, NOT `pnpm test` — that's watch mode): adapter Noop-by-default; `capture()` before `enable()` is a no-op; `enable()` without key stays Noop; `optOut()` clears consent state; consent-manager category logic + corrupt-value tolerance (SSR-safe); **PII lint test** — walk the typed catalog in `events.ts` and assert no property key matches `/name|email|phone|address|note|reason/i`; `sanitize_properties` strips query strings. Mock `posthog-js` via `vi.mock` for the dynamic import.
- **pgTAP**: new test file for the migration (own-row allowed / other-row denied per role, mirroring existing `user_profiles` policy tests). Fresh `supabase db reset` + `supabase test db` green.
- `pnpm lint` + `pnpm type-check` clean.
- **Manual verification** (local key in `.env.local`, `posthog.debug()` active in dev):
  - Public: banner appears on `/` with no stored decision; **before accepting: zero `/ingest` traffic and zero analytics storage**; after "alleen noodzakelijk": permanently silent; after accepting: events flow. Banner clean at ≤390px.
  - App: dev-login (`http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=/app`); network tab shows `/ingest` POSTs; Settings opt-out stops traffic and clears storage; log out → `reset()` fires.
  - Door: dev-login as `door@plusone.test`, airplane-mode a check-in → `captured_offline: true` arrives after reconnect.

## Manual checklist for Max (cannot be done by the executing model)

1. Create PostHog **EU Cloud** org + project ([eu.posthog.com](https://eu.posthog.com)), pay-as-you-go plan.
2. Copy the project API key (`phc_…`); set Vercel env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_KEY` (same value), `POSTHOG_HOST=https://eu.i.posthog.com`. Optionally add to local `.env.local` for testing.
3. Project settings: enable **"Discard client IP data"** (GDPR); confirm autocapture and session replay are OFF at project level; timezone Europe/Amsterdam.
4. Decide on the **group analytics add-on** (paid; optional — `venue_id` breakdowns work without it).
5. Build the **weekly-review dashboard**: DAU/MAU ratio + WAU on `app_opened`; activation funnel `user_signed_up → event_created → guest_added → door_checkin`; weekly retention on `app_opened`; feature adoption via `screen_viewed` breakdown by `screen`; door volume (`door_checkin` count, breakdown by `venue_id`, `captured_offline` split); guest pipeline (`guest_added` + `guests_added_bulk` weekly). Subscribe yourself to the dashboard by email.
6. Sign the PostHog **DPA** (self-serve in org settings); list PostHog in the privacy **and** cookie policy (the cookie policy must describe the banner's three categories; `TERMS_URL`/`PRIVACY_URL` in `src/lib/legal.ts` are still placeholders — live policies are a go-live dependency).

## Risks & pitfalls (for the executing model)

- **PII vectors:** (1) autocapture DOM text — mitigated, autocapture off; (2) session recording — off; if ever enabled, require masked inputs + text masking first; (3) mutation variables — the guest name is right there in `usePoAddGuest` variables, send only IDs/counts; (4) refusal `reason` free text — never send; (5) `$current_url` — `/app`, `/door/[eventId]`, `/eventday` are UUID-only (consistent with the no-PII-in-URLs rule); still strip query/hash in `sanitize_properties` as defence-in-depth.
- **CSP:** no production change needed thanks to the `/ingest` proxy. If events don't arrive, check first whether something bypasses the proxy. Later Google/Meta/TikTok pixels **will** require CSP extensions (`script-src`/`connect-src`/`img-src`) — handle in the marketing-pixel task, not now.
- **Door perf:** never import posthog-js statically; the adapter's dynamic import after consent keeps the door first paint untouched (STAP 3.5 must not regress).
- **`skipTrailingSlashRedirect`** is global — smoke-test trailing-slash routes.
- **posthog-node on Vercel:** unflushed events are lost when the lambda freezes — `captureImmediate()` / `await shutdown()`.
- **Typed client:** regenerating `database.types.ts` is mandatory in PR 1 or `user_profiles` reads/writes go `never` (CLAUDE.md stack note).
- **Consent boundaries:** never show the banner inside the authenticated surfaces (and thus never in the Capacitor webview; Apple ATT is a separate Phase-3 topic); the anonymous-banner-denial vs. logged-in-DB-status edge case resolves as **DB wins in-app** — document it where the reconcile happens.
- **Do not:** capture from pgTAP-tested server paths with the service client, add analytics to the outbox replay, or define any guest-facing events.
