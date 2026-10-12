# Product analytics (PostHog) — catalog, consent, dashboards

The canonical description of what PlusOne measures, when, and on what legal footing. Spec decision **#65**; implementation plan `docs/posthog-implementation-plan.md` (2026-07, partly outdated: where it and this file differ, this file and the code win). Built in three PRs (foundation, instrumentation, docs), shipped **without a key**: nothing is sent until `NEXT_PUBLIC_POSTHOG_KEY` (client) and `POSTHOG_KEY` (server) are set.

**Adding an event = a member in `src/features/analytics/events.ts` + its keys in `EVENT_PROPERTY_KEYS` (a type error otherwise) + a row in the catalog below.** The PII lint (`events.pii.test.ts`) fails on any property key that reads like personal data or free text; widening it is never the fix.

## Where the code lives

| What | Where |
|---|---|
| Event catalog (typed) | `src/features/analytics/events.ts` |
| Adapter singleton (`analytics.capture`, enable, opt-out, reset) | `src/features/analytics/provider.ts` |
| posthog-js (the ONLY importer, dynamic `import()` only) | `src/features/analytics/posthog-client.ts` |
| Client config (everything automatic off) | `src/features/analytics/config.ts` |
| Category consent (banner decision, localStorage) | `src/features/analytics/consent.ts` |
| Banner + anonymous public boot | `src/features/analytics/PublicConsent.tsx`, `CookieBanner.tsx` |
| In-app gate (`/app`, `/door/<id>`) | `src/features/analytics/AnalyticsGate.tsx`, `DoorAnalyticsGate.tsx` |
| Profile opt-out | `src/features/analytics/actions.ts`, `src/components/po/screens/settings/analytics-opt-out.tsx` |
| Server events (posthog-node) | `src/features/analytics/server.ts` |
| Opt-out column + grants | `supabase/migrations/20261018120000_analytics_opt_out.sql` |

## Consent model

| Where | Rule |
|---|---|
| Signed in (`/app`, `/door/<id>`, native shell) | **On by default**, part of the terms (decision 1). Disclosed in one line on the consent screen; the off-switch is Profile → Privacy → Product analytics (`user_profiles.analytics_opt_out_at`). The account setting wins over any banner choice on that device. An unreadable value counts as opted out. |
| Public marketing pages (`/`, `/login`) | Only after the cookie banner's **analytics** category is granted. Before a choice: no posthog-js, no storage, no request. Anonymous (`person_profiles: identified_only`); a later in-app identify merges the funnel. |
| Guest request form (`/e/<slug>`) | Shows the banner (for future marketing pixels) but **never loads PostHog**. Guests are never tracked (decision 4). |
| Bearer pages (`/s/`, `/r/`, `/i/`, `/n/`, `/u/`) | No banner, no tracking. |
| Native shell | Never a banner. In-app analytics follows the account setting. |

Banner categories (`plusone.consent.v1`, versioned; bump `CONSENT_VERSION` to re-ask everyone):

- `necessary`: always on.
- `analytics`: PostHog on `/` and `/login`.
- `marketing`: nothing yet. A later Google/Meta/TikTok pixel is a loader behind `onConsentChange`, plus a CSP extension.

**Sign-out** (`signOutDevice`) resets PostHog's device identity, so a shared door tablet never merges two users.

## Transport

The browser only talks to `/ingest` on our own origin (Next rewrites to PostHog Cloud EU). No CSP change, and adblockers don't drop it.

- `/ingest` is excluded from the middleware matcher (like `/monitoring`) and never cached by the service worker.
- `skipTrailingSlashRedirect` is on for the proxy; the middleware does the `/x/` → `/x` 308 itself for every other route.
- The server sends directly to `POSTHOG_HOST` with `captureImmediate` (Vercel freezes lambdas).

**Off on purpose:** autocapture, pageviews/pageleave, session replay, heatmaps, dead clicks, exception capture, feature flags, surveys, product tours, web experiments, external scripts. URL properties leave the device without query or hash. If you ever turn replay on, set up input and text masking first.

## Event catalog v1

**Super properties** (after identify): `venue_id`, `roles`, `app_surface` (`po` | `door`).
**Person properties:** `venue_id`, `roles`. The person id is the Supabase user UUID; there is no name or e-mail, ever.

| Event | Where | Properties |
|---|---|---|
| `user_signed_up` | server, `acceptTermsAction`, first consent only | `via` (`invite` if a team/crew invite is waiting, else `onboarding`) |
| `app_opened` | `AnalyticsGate`, once per page load | `surface` |
| `screen_viewed` | shell, URL-derived screen id, consecutive duplicates dropped | `screen` (an id like `events`, `eventDetail`, `deur`, never a path) |
| `onboarding_step_completed` | onboarding wizard | `step` (`welcome` / `company` / `team`) |
| `onboarding_completed` | onboarding wizard, Team step finish | — |
| `venue_created` | server, `createVenueAction` | `venue_id` |
| `event_created` | create / from template hooks | `event_id`, `from_template` |
| `guest_added` | add guest / add contact hooks | `event_id`, `method` (`quick_add` / `contact` / `door`), `plus_ones` |
| `guests_added_bulk` | bulk add hook | `event_id`, `count` |
| `guest_removed` | remove hook | `event_id` |
| `list_lock_toggled` | both lock hooks | `event_id`, `locked` |
| `extra_slots_requested` | quota request hook | `event_id`, `amount` |
| `request_approved` | approve + decide hooks (anyone got a spot) | `event_id` |
| `request_denied` | decide hook (nobody got a spot) | `event_id` |
| `door_checkin` | `DoorProvider`, first arrival or revive, at enqueue | `event_id`, `total_people`, `captured_offline` |
| `door_checkin_voided` | `DoorProvider`, at enqueue | `event_id`, `captured_offline` |
| `door_refusal` | `DoorProvider`, at enqueue (never the reason) | `event_id`, `captured_offline` |
| `door_guest_added` | `DoorProvider`, at enqueue (never the name) | `event_id`, `plus_ones`, `captured_offline` |
| `member_invited` | invite hook | `roles_granted`, `event_count` |
| `landing_viewed` | `/`, only with banner analytics consent | — |

Door events are directionally correct, not exact. They are captured at enqueue (never from the outbox replay). An event made offline survives in a living tab and is lost if the tab is killed before it reconnects. `check_ins` + `audit_log` are the truth.

Captures made before the gate decides (the first `screen_viewed`, the onboarding steps on `/onboarding`) wait in a 25-entry memory queue. They are sent after identify or dropped on opt-out or when no consent is given.

## Dashboards (weekly review, set up in PostHog by Max)

1. **Activity:** DAU / WAU / MAU on `app_opened`, and the DAU/MAU ratio.
2. **Activation funnel:** `user_signed_up` → first `event_created` → first `guest_added` or `guests_added_bulk` → first `door_checkin`, over 14 days, broken down by `via`.
3. **Retention:** weekly on `app_opened`.
4. **Feature adoption:** `screen_viewed` broken down by `screen`; "first time seen" per `venue_id` for every feature event (it shows what a company never used).
5. **Door volume:** `door_checkin` count by `venue_id`, split by `captured_offline`; `door_refusal` and `door_checkin_voided` beside it.
6. **Guest pipeline:** `guest_added` (by `method`) + `guests_added_bulk` (sum of `count`) per week; `request_approved` vs `request_denied`.
7. **Onboarding:** `onboarding_step_completed` funnel welcome → company → team → `onboarding_completed`.

Group analytics (`group('venue', …)`) is sent but is a paid add-on. Every breakdown above works on the `venue_id` super property without it.

## Go-live checklist (Max)

1. Create a PostHog **Cloud EU** project. Turn "Discard client IP data" on, autocapture and replay off at project level, timezone Europe/Amsterdam.
2. Vercel env: `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_KEY` (same value), `POSTHOG_HOST=https://eu.i.posthog.com`.
3. Sign the PostHog DPA.
4. Legal round (repo `Plus-One.io`, task z8uq9m2vh6):
   - subprocessor list: PostHog from C to A, plus DPA Annex 2;
   - a cookie policy with the three categories;
   - the privacy policy (team: on by default with the Profile switch; visitors: consent);
   - only after that, the key.
5. Build the dashboards above and subscribe to the weekly e-mail.
