# Platform support write access — CEO plan review (working plan)

Status: IN REVIEW (/plan-ceo-review, started 2026-10-14). Branch at start: `claude/golf-f-followup-train`.
Milestone (CLAUDE.md milestone rule): **Now** — support quality for the first venues.

## Problem (Max, 2026-10-14)

A PlusOne platform admin who switches into a customer company (Platform > Venues > switch) cannot make any change there. Goal: a platform admin can do every action a company admin can do, the logging is correct, and the support logging is fully visible to the platform but not shown to the customer by default (Max: "We prefer not to show the admin logs to customers").

## Evidence (static read, 2026-10-14)

- Root cause of "cannot change anything": `src/app/app/layout.tsx:130-138` gives a platform admin in a venue without a real membership a synthetic membership with `roles: []` (`getPlatformAdminVenue`, `src/lib/auth/memberships.ts:228-234`). Every role-gated control in the `po` UI reads `identity.roles`, so all edit controls are hidden. The comment at `memberships.ts:220-224` names this as a known limitation.
- RLS already admits the writes: `or public.is_platform_admin()` is the last disjunct in `is_venue_member`, `has_venue_role`, `is_venue_organizer`, `is_event_organizer` (decision #49b).
- Audit: support writes already land in `audit_log` under the operator's own `auth.uid()` (rule #4, #49c). The company sees them as "PlusOne support" (spec #64a, `venue_actor_names`, `ActorName` chip).
- Access trail: `platform_access_log` (`supabase/migrations/20261006130000_platform_access_log.sql`) — one row per switch, optional `reason` (≤500 chars), platform-only SELECT, append-only. Documented residuals: one row per switch (cookie lives a year), hand-set cookie bypass, no per-action link.
- **Contract text that binds the visibility question:**
  - DPA 4.4 (`docs/legal/data-processing-agreement.md:38`): every support change "is recorded in the append-only audit log under the identity of the PlusOne operator concerned, where the Customer can see it."
  - ToS 10.3(d) (`docs/legal/terms-of-service.md:154`): every write in the audit log "visible to the Customer in the same way as its own Users' actions."
  - Privacy policy (`docs/legal/privacy-policy.md:141`): "Any change they make is written to the audit trail under their own name, exactly as for any other user."
  - Access (entering a venue) is already platform-only, "made available to the Customer on request" — that part already matches Max's wish.
- Prior design: `docs/attio-crm-plan.md:84-100` "Support impersonation — hard guardrails": audit truth never falsified, time-boxed ≤60 min, start/stop as audit actions, persistent banner, "the venue's own audit feed shows support actions attributed as support". Heavy DB-enforced support sessions = backlog `z8uq9m0vyk` (≥25), legal README decision 3.
- **Gate map (Explore agent, static read, 2026-10-14):**
  - UI: about 60 role-check expressions across 29 files read `identity.roles` through `src/features/auth/roles.ts` helpers (`isManager`, `canManageGuests`, `canGrantRoles`, …), `venueCapabilities` (`src/features/venues/access.ts:43-58`), and hooks in `src/features/po/hooks.ts` (`usePoCanManageTemplates` :745, `usePoEventForEdit` :780, …). Only five places OR in the platform flag today (`app-chrome.tsx:214/275`, `settings.tsx:68/71`, `settings/export.tsx:76`). `getReportingVenues` (memberships.ts:120) reads real memberships only, so Stats/Promotion are hidden too.
  - Server pages: `src/app/door/[eventId]/page.tsx:32-48` and `src/app/door/page.tsx:17-27` `notFound()` a platform admin.
  - Server actions: no shared helper. Four copy-pasted `callerRolesAt`-style helpers plus inline reads refuse a platform admin at 10 call sites in 6 files: `venues/actions.ts:46` (settings :230, member roles :303, remove member :362), `auth/invite-actions.ts:31` (invite :111), `quotas/default-quota-actions.ts:17` (:53), `billing/actions.ts:77` (deliberately excludes PA: "billing stays the company's"), inline `venues/contact-actions.ts:31-39`, `events/actions.ts:645-654` (external crew invite), `:821-826` (crew resend). `events/actions.ts:92-104` already does it right via the `has_venue_role` RPC.
  - DB: only two SECURITY DEFINER RPCs refuse a platform admin: `admin_list_user_sessions` (`20261016170000`) and `admin_revoke_session` (`20260925120200`). No RLS policy blocks one.
  - Audit actor: `audit_trigger()` stores `actor_id = auth.uid()` only. No column says the write was a support write. `is_support` in `venue_actor_names` is computed at **read time** from the current flag and membership, so a past support write flips to the operator's real name if they later join the venue or lose the flag.
  - Audit coverage gaps (a support write here leaves no trail anywhere): `events` INSERT and updates to name/times/status/cancel/landing/contact/auto-lock; `venues` name, retention, settings, company profile, contacts; `event_organizers` (crew assign/remove); `guest_requests` INSERT.
- Industry pattern (web, vendor/practitioner sources, not standards): just-in-time, time-boxed elevation with reason + ticket reference, immutable log of actor/target/time/justification, alerting on use.

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| D1 — customer visibility of support changes (Max) | DPA 4.4, ToS 10.3(d), Privacy §8 promise customer-visible support writes; #64a renders them as "PlusOne support"; fraud-resistance core value | Support changes stay visible to the company as "PlusOne support" (never the operator's name); who exactly, reason, ticket and session detail are platform-only | — | approved | Max, AskUserQuestion D1, 2026-10-14: "Keep changes visible, details platform-only". Scope: customer visibility of support writes only; no contract text change. |
| D3 — review mode (Max) | 0E, ~22 files [estimated] | SCOPE REDUCTION | — | approved | Max, AskUserQuestion D3, 2026-10-14. Admin choice, approves no plan change. |
| D4 — P1 audit coverage gaps (Max, owner 0G) | DPA 4.4 "every change … recorded"; gap list from Explore agent | Kept in scope: audit triggers for `events` INSERT + missing update fields, `venues` name/settings/profile/contacts, `event_organizers`, `guest_requests` INSERT, plus audit-feed phrasing | — | approved | Max, AskUserQuestion D4, 2026-10-14: "Keep it in scope". |
| D5 — P2 admin view outside a session (Max, owner 0G) | D2 "look, always" | Kept in scope: switched in = every admin screen visible; a support write without an open session is refused by the database; the app turns that refusal into the Start-session sheet | — | approved | Max, AskUserQuestion D5, 2026-10-14: "Keep it in scope". |
| D6 — P3 write-time support marker (Max, owner 0G) | `is_support` read-time (`20261016140000`) | Deferred to TODOS.md | — | deferred | Max, AskUserQuestion D6, 2026-10-14: "Defer to TODOS.md". |
| D7 — P4 digest line for support sessions (Max, owner 0G) | decision #57 digest | Deferred to TODOS.md | — | deferred | Max, AskUserQuestion D7, 2026-10-14: "Defer to TODOS.md". |
| D8 — session length + extension (Max, owner Section 4) | D2 time-box; attio guardrail 2 "≤60 min" | TTL 60 min; banner Extend sets expires_at = now() + 60 min, same note; no cap on extends; expiry closes lazily | — | approved | Max, AskUserQuestion D8, 2026-10-14: "60 min, one-tap Extend". |
| D9 — note retention (Max, owner Section 3) | note may hold guest PII; Privacy §10 support correspondence 2 years; `platform_access_log` no anonymisation | `run_privacy_retention()` blanks `note` + `ticket_ref` 24 months after `coalesce(ended_at, expires_at)` and stamps `anonymized_at`; row, times, links stay; Privacy policy §10 gets the line | — | approved | Max, AskUserQuestion D9, 2026-10-14: "Blank note after 24 months". |
| D2 — approach (Max) | see 0A–0C below | Look always (no reason needed, switch still writes one `platform_access_log` row). Edits only inside a support session: required note (why we are in the company + which customer request), optional ticket ref, time-boxed, banner, every write stamped with the session id. Billing actions stay excluded. RLS unchanged. | — | approved | Max, AskUserQuestion D2, 2026-10-14 (free text): "We should be able to look, always, in the company. If we indeed start to make edits, then I do not mind that we need to make a note and say why we are in the company and with what request." Maps to option B with read access always on. Session length/extension and the read-only view shape remain implementation choices (pending). Decision log c07abf38. |

## 0A. Premise

- Real problem: PlusOne cannot deliver hands-on support. When a customer says "can you fix my list / add my door person / change the event time", the operator has to talk them through it or edit prod by SQL (which decision 8 discourages and which skips the app's own guards).
- Do-nothing cost: support by SQL editor = no Zod, no app guards, and writes on non-audited tables (events, venue settings, crew) leave no trace at all. That is the real fraud/trust risk, larger than the visibility question.
- The ask "do all actions a normal admin can do" is solved directly by giving the operator effective admin capabilities in the app. The ask "logging is correct" is only partly solved by that: today `is_support` is decided at read time and several tables are not audited at all.
- Premise challenges:
  1. "Everything a normal admin can do" should exclude billing (checkout/portal, `billing/actions.ts:74-76` "billing stays the company's") — a PlusOne operator starting a Stripe checkout on a customer's card is a different trust problem. Pending as part of D2 scope.
  2. Always-on write power whenever the operator is switched in (cookie lives a year) is how accidental edits happen. A support session with a reason and an end time is the industry norm and matches `docs/attio-crm-plan.md` guardrails.

## 0C. Dream state

```
  CURRENT STATE                  THIS PLAN                          12-MONTH IDEAL
  Operator can enter a  --->    Operator starts a support    --->   Customer can grant/deny support
  company read-only;            session (reason, ticket,            access per company; sessions are
  writes need SQL; no           time-box, banner), acts as          DB-enforced (z8uq9m0vyk, >=25);
  link between an entry         company admin; every write          every support write is stamped
  and what was changed.         is stamped with the session;        at write time and the Platform tab
                                Platform tab shows session ->       answers "what did we do at venue X
                                writes. Customer still sees         this month" in one screen; shared
                                "PlusOne support" (D1).             on request as a PDF/CSV.
```

## Mode

SCOPE REDUCTION (Max, AskUserQuestion D3, 2026-10-14; recommended because ~22 files [estimated] for the full design). Handoff line: "Mode: SCOPE REDUCTION; approved decisions: D1, D2."

## 0G. Accepted scope (after D4–D7)

1. **Support session record** — new table `platform_support_sessions` (`id`, `admin_id = auth.uid()`, `venue_id` FK cascade, `note` required (trimmed, 10–500 chars: why we are in the company + which customer request), `ticket_ref` optional ≤100, `started_at` / `expires_at` server-stamped, `ended_at`, `end_reason` `ended|expired|superseded`). Platform-only SELECT (`is_platform_admin()`), no INSERT/UPDATE/DELETE grant for app roles: written only by SECURITY DEFINER RPCs `start_support_session(venue_id, note, ticket_ref)`, `extend_support_session(id)`, `end_support_session(id)` (own session only). Viewing keeps the existing `platform_access_log` row per switch (D2: look always, no note).
2. **Admin capabilities in the app** — switched into a company without a real membership, the platform admin gets effective `roles: ['admin']` in `PoIdentity` (view always, D5) plus `support: { sessionId, expiresAt, note } | null`. Billing actions stay excluded in the UI and server (`billing/actions.ts:74-76`). A persistent banner: "Viewing as PlusOne support" (no session) or "Support session · <note> · <mm> left · Extend · End" (session).
3. **One server-side gate** — a shared `callerHasVenueRole(venueId, roles)` over the `has_venue_role` RPC (the pattern at `events/actions.ts:92-104`) replaces the four copy-pasted `callerRolesAt` helpers and the inline reads (10 call sites, 6 files; billing keeps its deliberate exclusion). Fix `admin_list_user_sessions` / `admin_revoke_session` (add the platform-admin path) and the two `/door` pages.
4. **DB write guard + write stamp, one place** — a BEFORE INSERT trigger on `audit_log` (not a change to the canonical `audit_trigger()`, `supabase/canonical/audit_trigger.sql` stays byte-identical): when `actor_id` is a platform admin with no real `venue_memberships` row at `venue_id` (crew scope does not exempt, same rule as `platform_access_log`), it requires an open, unexpired session for (`actor_id`, `venue_id`) and records the link; with none it raises a dedicated SQLSTATE that rolls back the original write. Exempt: `action = 'export'` (a read, `log_venue_export`), rows with `venue_id is null`, and `actor_id is null` (cron/service). The link lives in a platform-only table `platform_support_session_writes (session_id, audit_log_id)`, written by the same trigger (an AFTER INSERT ROW trigger on `audit_log`, so the FK to the inserted row holds; raising there still rolls back the whole statement). Not a column on `audit_log`: that table has a table-level SELECT grant for `authenticated` (`20260613000000_full_schema.sql:411`), so a new column would be readable by venue admins and break D1.
5. **Audit coverage (D4)** — audit triggers for `events` INSERT and the update fields not yet audited (name, starts/ends, status, cancelled_at, landing_active, contact_email, auto_lock_at), `venues` (name, settings, company profile, contacts, retention, guest_confirmation_default), `event_organizers` I/U/D, `guest_requests` INSERT; audit-feed phrasing for each (`src/features/audit/translate.ts`, i18n).
6. **Write refused → Start-session sheet (D5)** — `src/lib/db-errors.ts` maps the new SQLSTATE to a typed `support_session_required` result; the global `MutationCache` in `PoLiveProvider.tsx:46` opens the sheet; server actions return the typed result unchanged; the door outbox classifies it as a non-retryable, visible failure (never dropped, never auto-retried).
7. **D1 leak fix** — any mail or screen that prints the acting user's name outside the actor-label system shows "PlusOne support" for a support actor: team invite mail `inviterName` (`src/features/auth/invite-actions.ts:58`), crew invite/resend mail (`events/actions.ts` inviteExternalCrew/resendCrewInvite), and any other template found by grep for `inviterName`/`full_name` in `src/features/mail`.
8. **Note retention (D9)** — `run_privacy_retention()` step blanks `note` and `ticket_ref` 24 months after the session closed (`anonymized_at` stamped, frozen after); Privacy policy §10 retention table gains the line.
9. **Platform tab: Support sessions** — list (operator, venue, note, ticket, start, end/expired, write count) and per-session list of its audited writes (platform-only RPC; D1).

Deferred (D6, D7) — see NOT in scope.

## Answered decision record (D2)

Commitment comparison:

| Commitment | Source/approval or pending | Current | A | B | C |
|---|---|---|---|---|---|
| Operator can do every company-admin action in the app | Max ask | no | yes, whenever switched in | yes, only during an active support session | yes, only during an active session |
| Billing actions (checkout/portal) | `billing/actions.ts:74-76` | excluded | excluded | excluded | excluded |
| Reason required to get write power | pending | optional, never set | no | yes (+ optional ticket ref) | yes |
| Time-box + explicit end + persistent banner | attio plan guardrail 2-3 | no | no | yes (60 min, extendable) | yes |
| Writes stamped with support session at write time | logging correctness | no (read-time `is_support`) | no | yes (`audit_log.support_session_id`) | yes |
| Close audit gaps (events insert/update, venues, crew) | logging correctness | gaps | separate decision | separate decision | separate decision |
| Enforced in DB (raw API / SQL also gated) | z8uq9m0vyk (>=25) | no | no | no (app-layer gate, RLS unchanged) | yes, RLS helpers check an active session |
| Customer visibility | D1 approved | "PlusOne support" | unchanged | unchanged | unchanged |

Question: D2 — Which approach gives operators admin powers inside a customer company?
Header: Approach
A) Always-on admin when switched in
Platform admin gets admin capabilities in any company they switch into; fix the 10 server-action gates, 2 session RPCs and door pages. No session, no reason. Effort S, risk medium.
B) Support session with reason + time-box (recommended)
"Start support session" asks reason (+ ticket), lasts 60 min, shows a banner, unlocks admin capabilities in the app; every write is stamped with the session id; Platform tab shows session to writes. RLS unchanged. Effort M, risk low.
C) DB-enforced support sessions
B plus RLS helpers only admit a platform admin during an active session (the heavy z8uq9m0vyk variant). Effort L, risk high.

## Answered decision record (D1)

Commitment comparison:

| Commitment | Source/approval or pending | Current | A | B | C |
|---|---|---|---|---|---|
| Support change visible in company audit feed | DPA 4.4 / ToS 10.3 | yes, "PlusOne support" | yes, "PlusOne support" (unchanged) | no (platform-only, shared on request) | yes, but hidden behind a "Show PlusOne support" filter, off by default |
| Operator identity (which PlusOne person) shown to company | #64a | no | no | no | no |
| Support session detail (start/stop, reason, ticket, per-action link) | pending | access row only | platform-only | platform-only | platform-only |
| "Added by PlusOne support" on guest list / door / stats | #64a | yes | yes | must also be hidden (else feed hiding leaks) | yes |
| Contract text change + re-consent | legal | none | none | DPA 4.4, ToS 10.3, Privacy §8 rewrite, lawyer, TERMS_VERSION bump | small wording change to ToS 10.3(d) / DPA 4.4, lawyer check |

Question: D1 — Should support changes stay visible to the customer, or be hidden from them?
Header: Visibility
A) Keep changes visible, details platform-only (recommended)
The customer keeps seeing each support change as "PlusOne support" (never the operator's name). Everything else (who exactly, reason, ticket, session start/stop) stays platform-only. Effort S, risk low.
B) Hide support changes from the customer
Audit rows still exist but every customer surface hides them. Requires DPA/ToS/Privacy rewrite, lawyer review and re-consent. Effort L, risk high.
C) Visible, but filtered out by default
The feed hides support rows unless the customer toggles "Show PlusOne support". Small contract wording change. Effort M, risk medium.

## Review sections (SCOPE REDUCTION, implementation-ready depth)

### Section 1: Architecture

```
                         Platform > Venues "Switch in"            (existing)
                                   |  switchActiveVenueAction -> platform_access_log row (view, no note)
                                   v
  src/app/app/layout.tsx  --getPlatformAdminVenue-->  PoIdentity { roles:['admin'], support: session|null }  (CHANGED)
        |  reads my open session: rpc my_support_session(venue_id)                                          (NEW)
        v
  PoLiveProvider (MutationCache) --typed error support_session_required--> StartSupportSessionSheet         (NEW)
        |                                                                       | rpc start_/extend_/end_support_session (NEW, definer)
        v                                                                       v
  server actions (shared callerHasVenueRole -> rpc has_venue_role)        platform_support_sessions          (NEW, platform-only)
  + RLS-only actions + door outbox (check_ins)                                   ^
        |  INSERT/UPDATE on audited table                                         | lookup open session (actor, venue)
        v                                                                         |
  audit_trigger() (canonical, UNCHANGED) --insert--> audit_log --AFTER INSERT--> support_write_guard()       (NEW)
                                                                 | PA without real membership:
                                                                 |   session open -> insert platform_support_session_writes
                                                                 |   no session   -> RAISE (SQLSTATE PSS01) -> whole write rolls back
                                                                 v
                                   Platform tab > Support sessions (rpc platform_support_sessions_list / _writes)  (NEW)
  New audit triggers (D4): events INSERT + fields, venues fields, event_organizers I/U/D, guest_requests INSERT
```

Data flow, start session:
- Happy: note valid, PA, venue exists -> row (started_at = now(), expires_at = now() + TTL) -> banner shows session.
- Nil: note missing -> Zod refuses client-side; RPC refuses null/blank (22023) -> sheet shows field error.
- Empty: whitespace-only or under 10 chars after trim -> same refusal.
- Error: RPC fails (network, 42501 not PA) -> sheet stays open with a generic error; no partial session.

State machine `platform_support_sessions`:
```
   (none) --start(note)--> OPEN --extend--> OPEN (expires_at = now() + TTL)
                            |  \--end-----> ENDED   (ended_at = now(), end_reason 'ended')
                            |  \--now() > expires_at--> EXPIRED (derived; closed lazily: ended_at = expires_at, 'expired')
                            \--start again, same venue--> previous OPEN closed 'superseded', new OPEN
   Invalid: ENDED/EXPIRED -> OPEN (extend refuses, start makes a new row); end/extend of another admin's
   session (refused: admin_id = auth.uid()); start by a non-PA (42501); start where the caller is a real
   member (refused: they already hold their roles).
```
- One OPEN session per (admin, venue): partial unique index on `(admin_id, venue_id) where ended_at is null`; `start` first closes stale expired rows.
- New coupling: `audit_log` gets a second trigger. Justified: it is the one point every audited write passes through, including RLS-only server actions, SECURITY DEFINER RPCs (they keep `auth.uid()`) and the door outbox.
- Scaling: guard cost = fast exit when `actor_id is null`, else one PK lookup on `user_profiles` per audit row, plus one index lookup for PA rows. A 25 000-guest import = 25 000 PK lookups [estimated: low hundreds of ms]; measured in Section 7.
- Single point of failure: the guard function. A bug that raises for non-PA actors blocks every audited write, the door included. Mitigations in Sections 2, 6 and 9.
- Rollback: a hotfix migration `drop trigger` restores today's behaviour; the tables stay.
- Value test (Platform > Support sessions): consumers are Max/Joeri ("what did we do at venue X") and DPA 4.4 ("made available to the Customer on request"). Smallest version = list + per-session writes. Retires when z8uq9m0vyk replaces it.
- **Finding A1 (applied under D1):** the operator's name leaks outside the actor-label system in team/crew invite mails (`src/features/auth/invite-actions.ts:58` `inviterName: profile.full_name`). Core item 7.
- **Finding A2 (applied under D2, billing excluded):** effective `roles: ['admin']` would show checkout/portal buttons; the UI must also hide billing actions when the `support` identity is set.

### Section 2: Error & Rescue Map

```
  CODEPATH                         | WHAT CAN GO WRONG                           | CLASS
  ---------------------------------|---------------------------------------------|-----------------------
  start_support_session (rpc)      | caller not PA                               | 42501
                                   | note blank / too short / too long           | 22023 (field error)
                                   | venue missing / caller is a real member     | P0002 / 22023
  extend_/end_support_session      | not own session / already closed            | 42501 / 22023
  support_write_guard (trigger)    | PA write, no open session                   | PSS01 (new, rolls back)
                                   | session expired mid-form                    | PSS01
                                   | guard bug raises for a non-PA               | any -> CRITICAL, see tests
  layout my_support_session read   | rpc error                                   | PostgrestError
  server actions                   | PSS01 flattened into a generic message      | typed result missing
  door outbox replay               | PA check-in replayed after expiry           | PSS01
  invite/crew mail                 | support label resolution fails              | fallback label

  CLASS / CASE                 | RESCUED? | RESCUE ACTION                                   | USER SEES
  -----------------------------|----------|-------------------------------------------------|--------------------------------
  42501 start/extend/end       | Y        | generic error, Sentry breadcrumb                | "Couldn't start the session"
  22023 note                   | Y        | field error on the note                         | inline message
  PSS01 (no/expired session)   | Y        | db-errors.ts -> support_session_required ->     | Start-session sheet (note
                               |          | MutationCache opens the sheet; no auto-retry    | prefilled if it expired)
  my_support_session read fail | Y        | treat as no session (view mode): fail-closed    | "Viewing as PlusOne support"
  server action flattens PSS01 | GAP -> Y | every action passes the db-errors mapping; test | the sheet, not "Something went wrong"
  outbox PSS01                 | Y        | non-retryable, kept visible; never dropped      | failed row "Needs a support session"
  guard raises for a non-PA    | MUST NOT HAPPEN: fast path + pgTAP per role + one-statement rollback | door blocked
  mail label resolution fails  | Y        | send with "PlusOne support" (never the name)    | invite mail
```
- Logging: start/extend/end are rows themselves; Sentry breadcrumb on PSS01 with venue id and action name, never the note or guest data.

### Section 3: Security & Threat Model

| Threat | Likelihood | Impact | Mitigated? |
|---|---|---|---|
| PA writes through raw PostgREST without a session | Low | Med | Yes for every audited table (guard). Residual: non-audited venue tables (`contact_event_exclusions`, `request_link_pageviews_daily`), listed and accepted. |
| PA self-grants a real membership to skip sessions | Low | High | Yes: `venue_memberships` is audited, so that insert itself needs a session, and the membership shows in the team list. |
| PA self-grants crew scope to skip sessions | Low | Med | Yes: crew does not exempt (guard checks real membership only); `event_organizers` audited by D4. |
| Forged or back-dated session | Low | High | Yes: no write grant; definer RPCs stamp `admin_id = auth.uid()` and server time; only end/extend of your own session. |
| Customer learns the operator's identity or the note | Med | Med | Yes: sessions + link table platform-only SELECT; mails say "PlusOne support" (A1). |
| SQL editor / service-role writes | Low | High | Not covered (`auth.uid()` null). Accepted under decision 8. |
| Note holds guest PII (guest names) | High | Low | Partly: UI hint "describe the request, no guest details"; note + ticket blanked after 24 months (D9). |
| Guard DoS: a bug blocks all audited writes | Low | High | Fast path for non-PA, pgTAP proof per role, one-statement rollback. |
| Note/ticket injection | Low | Low | Zod + CHECK lengths; React escapes on render; never interpolated into SQL. |
- No new secrets, no new dependencies.
- High-risk surfaces: new SECURITY DEFINER RPCs, a trigger on `audit_log`, new audit triggers, `admin_*_session` RPC changes, layout/auth. Review gate: fresh-session `/code-review` + `/security-review`, and the building session writes the adversarial security-research prompt in its wrap-up (CLAUDE.md review gates).

### Section 4: Data flow & interaction edge cases

```
  INPUT(note, ticket) -> Zod(trim, 10..500 / <=100) -> RPC start (PA? venue? member?) -> INSERT session -> banner
     nil/empty -> field error | too long -> field error | 42501 -> generic | open one exists -> superseded
  WRITE(any) -> RLS (PA passes) -> table trigger -> audit_trigger -> audit_log INSERT -> guard
     no session -> PSS01 rollback -> sheet | expired -> PSS01 -> sheet "ended, start again" | ok -> link row
```
Async ordering. Invariant: a write by a PA without membership commits only if a session was OPEN in that write's snapshot.
```
  op W (write)                         op E (end)                     shared: session row
  INSERT guest ... guard reads OPEN                                    OPEN
                                       end_support_session commits     ENDED
  W commits (+ link row)                                               ENDED
  --- other order ---
                                       end_support_session commits     ENDED
  INSERT guest ... guard reads ENDED -> PSS01, rollback                ENDED
```
Both orders keep the invariant: a write that read OPEN is attributed to that session (the link row proves it); a write that read ENDED is refused. Mechanism: the guard reads the session row in the write's own transaction. Regression proof: two-session concurrency script (`scripts/*-concurrency-test.mjs` pattern), not pgTAP.

| Interaction | Edge case | Handled? | How |
|---|---|---|---|
| Start session | double tap | Yes | partial unique index; the second call returns the open session |
| Start session | two tabs, two venues | Yes | one open session per (admin, venue) |
| Edit | session expires with a form open | Yes | PSS01 -> sheet with the note prefilled; form state kept |
| Edit | switch venue mid-session | Yes | session stays open until expiry/end; other venue shows view mode |
| Door outbox | PA offline check-in, session expires before replay | Yes | visible non-retryable failure; retry after a new session |
| Extend | extend after expiry | Yes | refused; sheet offers a new session with the same note |
| End | end while a write is in flight | Yes | see ordering above |
| Bulk import | 500 rows in one session | Yes | each audit row links to the session |
| Session length / extension | 60 min, Extend +60 | Yes | D8 |

### Section 5: Code quality
- Duplicated behavior: four copy-pasted `callerRolesAt` helpers (`src/features/venues/actions.ts:46`, `src/features/auth/invite-actions.ts:31`, `src/features/quotas/default-quota-actions.ts:17`, `src/features/billing/actions.ts:77`) and three inline reads. One shared helper in `src/lib/auth/` replaces them; billing keeps its own documented rule.
- Naming: identity field `support`, `SupportSessionBanner`, `StartSupportSessionSheet`, trigger `support_write_guard`, SQLSTATE `PSS01`.
- No abstraction beyond one helper and one trigger. Guard has 4 branches (null actor, not PA, real member, session), under the 5-branch limit.

### Section 6: Tests

| New thing | Type | Happy | Failure | Edge |
|---|---|---|---|---|
| sessions table + RPCs | pgTAP | PA starts/extends/ends own | non-PA 42501; another admin's session refused; blank note 22023 | extend after expiry refused; double start supersedes |
| grant matrix | pgTAP (`grant_matrix.test.sql`) | new tables: nothing for anon, no write grant | — | link table platform-only |
| guard | pgTAP | PA + session -> write + link row | PA without session -> PSS01 and the row is absent (DB state) | **every non-PA role (admin, manager, staff, doorhost, finance, crew) writes exactly as before with the guard installed, door check-in upsert included**; export exempt; null actor exempt; PA who is a real member exempt |
| audit gaps (D4) | pgTAP | each new trigger writes one row with a diff | no-op update writes none | event created by the template RPC |
| admin_*_session | pgTAP | PA lists/revokes inside a session | PA revoke without a session refused | — |
| write/end race | concurrency script | both orders from Section 4 | — | — |
| shared role helper | Vitest | PA passes, member passes | crew-only refused for admin actions | billing still refuses PA |
| db-errors mapping | Vitest | PSS01 -> support_session_required | unknown code stays generic | — |
| outbox | Vitest | PSS01 non-retryable and kept | — | `OUTBOX_BUSTER` unchanged (`src/features/door/outbox/persistence.ts:36`) |
| mail label | Vitest | support actor -> "PlusOne support" | — | real member keeps the name |
| flow | `tests/flows/platform-support.flow.ts` | switch in -> view -> edit -> sheet -> start -> save -> banner -> end | expired -> sheet | phone, iPad, native shell |
- 2am-Friday test: "every non-PA role writes exactly as before with the guard installed", door path included.
- Hostile QA: raw PostgREST insert as PA without a session; PA inserts their own membership; PA inserts a crew row.
- Flakiness: expiry tests set `expires_at` in the past server-side; no sleeps.

### Section 7: Performance
- Guard: fast exit on `actor_id is null`; else a PK lookup on `user_profiles(id)`; PA rows add one lookup on the partial index. Measure a 25 000-guest import before/after [re-measure before gate].
- Layout: one extra RPC, only for a platform admin in a non-member venue (zero cost for customers).
- Platform lists paginated, indexed on `started_at desc` and `session_id`. No N+1, no new connections.

### Section 8: Observability
- The session table is the log; the Platform tab is the admin UI.
- Sentry: tag `support_session=true` on errors during a session; breadcrumb on PSS01.
- Alerting: none new (D7 deferred).
- Runbook lines (`docs/runbook.md`): "audited writes failing with PSS01 for non-support users" -> hotfix migration that drops the guard trigger; "operator stuck" -> end the stale session through the RPC.
- Three weeks later: session row + link rows + audit diffs reconstruct what support did.

### Section 9: Deployment & rollout
- Migrations, additive only: sessions table + RPCs; link table + guard trigger; D4 audit triggers; `admin_*_session` RPC change. Unique timestamps checked against `origin/main`.
- Order: migrate first, then deploy. Old app on the new DB: PA writes refused with a generic error (only platform admins affected). New app on the old DB is never deployed.
- Feature flag: not needed; the guard only affects platform admins and is reversible in one migration.
- First 5 minutes: `pnpm e2e:smoke`; one check-in by a normal doorhost; Max starts a session in a test company, edits, ends; Platform tab shows the session and its writes.
- Rollback: hotfix migration `drop trigger` (minutes); app revert through Vercel.

### Section 10: Long-term trajectory
- Debt: residual non-audited venue tables; read-time `is_support` (D6); no digest alert (D7).
- Path dependency: positive; z8uq9m0vyk can use `platform_support_sessions` as its source of truth.
- Reversibility: 4/5.
- 1-year question: one table, one trigger, one banner, one sheet.

### Section 11: Design & UX
```
  Platform > Venues --Switch in--> /app  [banner: "Viewing as PlusOne support · Start support session"]
        | taps Save anywhere (no session) --PSS01--> StartSupportSessionSheet (note, ticket) --Start-->
        v                                                                       (user taps Save again)
  [banner: "Support session · <note> · 42 min left · Extend · End"] --End--> view mode
        | expiry -> next write --PSS01--> sheet "Session ended. Start again?" (note prefilled)
  Platform > Support sessions --> session detail (its writes)
```
| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Banner | skeleton line | view-mode text | view mode (fail-closed) | session line + timer | — |
| Start sheet | button spinner | — | field error / generic | sheet closes, toast | — |
| Support sessions list | skeleton rows | "No support sessions yet" | inline retry | rows | paginated |
- Kit only: banner and sheet live in `kit.tsx`/`shell.tsx`; lavender accent; banner below the safe area; 44px targets; works at 390/768/1024/1280; native shell safe (no billing, no `_blank`).
- SCOPE REDUCTION: no `/plan-design-review` recommended; the flow harness covers it.

## Outside voice

Codex CLI is not installed on this machine (`CODEX_MODE: not_installed`). The native fallback needs a blocking task-output tool this session does not have. Outside voice unavailable, so there is no external review coverage. Logged as `codex-plan-review` `outside_status: unavailable`.

## Approval readiness

Approval readiness: PASS. Checked D1, D2, D4, D5, D8, D9 (approved; answers in the ledger), D6 and D7 (deferred; answers in the ledger), D3 (mode, approves no change). Findings A1 (invite-mail name leak) and A2 (billing UI) are applications of D1 and D2, not new remedies. The guard's mechanism (AFTER INSERT on `audit_log`, link table instead of a column) applies D2 + D5 + D1 within their scope.

## NOT in scope

- Hiding support changes from the customer (D1: rejected option B, contract and fraud trail).
- DB-enforced read gating for platform admins: RLS helpers checking an open session (D2: option C, stays backlog `z8uq9m0vyk`, ≥25).
- Billing actions (checkout, portal) for platform admins: excluded by D2 / `billing/actions.ts:74-76`.
- Write-time support marker on every actor label (D6, deferred to TODOS.md).
- Support sessions in the daily platform digest (D7, deferred to TODOS.md).
- Audit of non-venue/own-user tables (`user_notification_prefs`, `push_tokens`, mail/outbox plumbing) and venue tables `contact_event_exclusions`, `request_link_pageviews_daily`: residual, accepted (Section 3).
- Read-audit of what an operator looked at (decision #49 open point; unchanged).

## What already exists (reused)

- RLS that already admits platform admins (`is_venue_member`/`has_venue_role`/… `or is_platform_admin()`): reused unchanged.
- `switchActiveVenueAction` + `platform_access_log`: reused for viewing (D2).
- `getPlatformAdminVenue` / layout platform branch (`src/app/app/layout.tsx:130-138`): extended (roles + support identity).
- `has_venue_role` RPC gate pattern (`src/features/events/actions.ts:92-104`): becomes the shared helper.
- `audit_trigger()` canonical body: untouched; guard sits beside it.
- Actor-label system (`venue_actor_names`, `ActorName`, `t.shared.actor.support`): customer side of D1 already done.
- `MutationCache` in `src/features/po/PoLiveProvider.tsx:46` + `src/lib/db-errors.ts`: one place to turn PSS01 into the sheet.
- `run_privacy_retention()` and the `platform_invites` 24-month sweep: pattern for D9.
- Platform tab screens (`src/components/po/screens/platform-*.tsx`): pattern for the sessions list.

## Dream state delta

After this plan: operators look anywhere, edit with a noted, 60-minute, banner-visible session, every audited write is tied to its session, the main audit blind spots are closed, and customers see "PlusOne support" exactly as the contract says. Still between us and the 12-month ideal: the customer-side grant/deny toggle, DB-enforced read gating (z8uq9m0vyk), a write-time label on every surface (D6), digest alerting (D7) and a one-click "support report for venue X" export for DPA requests.

## Error & Rescue Registry

See Section 2 (10 codepath rows; 1 former GAP (server action flattening PSS01) now has a required rescue + test; the "guard raises for a non-PA" row is a MUST-NOT-HAPPEN guarded by tests, not a rescue).

## Failure Modes Registry

```
  CODEPATH                    | FAILURE MODE                         | RESCUED? | TEST?        | USER SEES?                    | LOGGED?
  ----------------------------|--------------------------------------|----------|--------------|-------------------------------|--------
  support_write_guard         | raises for a non-PA actor            | N (must  | Y pgTAP per  | door/list writes fail         | Sentry
                              |                                      | not occur)| role + door  |                               |
  support_write_guard         | PA write without session             | Y        | Y pgTAP      | Start-session sheet           | breadcrumb
  support_write_guard         | session expired mid-form             | Y        | Y pgTAP+flow | sheet, note prefilled         | breadcrumb
  server action               | PSS01 flattened to generic           | Y        | Y Vitest     | sheet                         | Sentry
  door outbox replay          | PSS01 after expiry                   | Y        | Y Vitest     | failed row, kept              | outbox log
  start_support_session       | non-PA / bad note                    | Y        | Y pgTAP      | generic / field error         | —
  layout session read         | RPC error                            | Y        | Y Vitest     | view mode (fail-closed)       | Sentry
  invite/crew mail            | operator name leak                   | Y        | Y Vitest     | "PlusOne support"             | —
  retention step (D9)         | note not blanked                     | Y        | Y pgTAP      | —                             | job log
  write/end race              | write after End attributed wrongly   | Y        | Y concurrency| —                             | link row
```
0 CRITICAL GAPS (no row is RESCUED=N + TEST=N + silent).

## Reality rows

REALITY: premise-table pass — every factual claim above carries a file:line receipt (layout.tsx:130-138, memberships.ts:228-234, DPA :38, ToS :154, privacy :141, full_schema.sql:411, Explore-agent gate map); unverified=1 (guard cost on a 25 000-row import is [estimated]).
REALITY: already-done pass (checked at origin/main eb16e888) — `git log origin/main --since=2026-10-10` on memberships.ts/layout.tsx/venues/actions.ts shows no support-session work; no open `support` branch on origin.
REALITY: surface-check pass named commands pnpm db:test, pnpm qa:flows, pnpm e2e:smoke exist as package.json scripts package.json:1
REALITY: binding-decisions pass — decisions 0c128fe6 (D1) and c07abf38 (D2) logged; no earlier binding decision on platform write access overruled; legal README decision 3 (access log platform-only) kept.
REALITY: numbers finding (role gate src/app/app/layout.tsx:149) — "~22 files" and "~60 role checks / 29 files" are [estimated] / [measured: Explore agent static grep]; guard cost [re-measure before gate].
REALITY: deferred-asks pass (asks at docs/designs/platform-support-write-access-ceo-plan.md:6) — Max's three asks (do all admin actions, correct logging, platform-visible not customer-visible logging) all covered; billing deliberately excluded.
REALITY: pr-count finding (split follows the task list, migrations in supabase/migrations/20261006130000_platform_access_log.sql:62 pattern) — no `.gstack/ship-policy.json`; default one PR per wave. Recommended split below: PR 1 DB (sessions, guard, D4 triggers, retention), PR 2 app (identity, gate, sheet, banner, Platform tab, mails). Cost: one extra review cycle; PR 1 is safe alone (no PA can write in a non-member company until PR 2, same as today).

PLAN_REALITY: phase=ceo rows=7/7 missing=none unverified=1 verdict=complete (checked with CRLF stripped: the checker's line regex misses CRLF files on Windows)

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Model routing per CLAUDE.md: Opus builds, high-risk review in a fresh session.

- [ ] **T1 (P1, human: ~1 day / CC: ~40 min)** — DB — Support sessions table + start/extend/end/my_support_session RPCs + grant matrix
  - Surfaced by: 0G core 1, Section 1 state machine, D8
  - Files: `supabase/migrations/<new>_platform_support_sessions.sql`, `supabase/tests/database/platform_support_sessions.test.sql`, `supabase/tests/database/grant_matrix.test.sql`, `src/lib/database.types.ts`
  - Verify: `supabase db reset && pnpm db:test`
- [ ] **T2 (P1, human: ~1 day / CC: ~40 min)** — DB — Support write guard + `platform_support_session_writes` link table
  - Surfaced by: 0G core 4, Section 2 CRITICAL row, Section 3
  - Files: `supabase/migrations/<new>_support_write_guard.sql`, `supabase/tests/database/support_write_guard.test.sql` (every role writes as before, door upsert included; PA no session refused; export/null actor/real member exempt), `scripts/support-session-concurrency-test.mjs`
  - Verify: `pnpm db:test` + the concurrency script; `supabase/canonical/audit_trigger.sql` unchanged
- [ ] **T3 (P1, human: ~1.5 days / CC: ~45 min)** — DB + audit feed — Close audit coverage gaps (D4)
  - Surfaced by: 0B gap list, D4
  - Files: `supabase/migrations/<new>_audit_coverage_events_venues_crew.sql`, pgTAP file, `src/features/audit/translate.ts`, `src/lib/i18n/surfaces/audit.ts`
  - Verify: `pnpm db:test`; `pnpm vitest run src/features/audit`
- [ ] **T4 (P1, human: ~0.5 day / CC: ~20 min)** — DB — `admin_list_user_sessions` / `admin_revoke_session` platform-admin path
  - Surfaced by: gate map §3
  - Files: `supabase/migrations/<new>_admin_sessions_platform_admin.sql`, its pgTAP
  - Verify: `pnpm db:test`
- [ ] **T5 (P2, human: ~0.5 day / CC: ~20 min)** — DB — Note retention step (D9) + Privacy §10 line
  - Surfaced by: Section 3, D9
  - Files: retention migration, `supabase/canonical/run_privacy_retention.sql`, retention pgTAP, `docs/legal/privacy-policy.md`
  - Verify: `pnpm db:test` (canonical guard `tests/unit/canonical-functions.test.ts` green)
- [ ] **T6 (P1, human: ~1 day / CC: ~40 min)** — server — Shared `callerHasVenueRole` helper replaces 4 helpers + 3 inline reads; `/door` pages admit PA
  - Surfaced by: gate map §2, Section 5
  - Files: `src/lib/auth/venue-role.ts` (new), `src/features/venues/actions.ts`, `src/features/auth/invite-actions.ts`, `src/features/quotas/default-quota-actions.ts`, `src/features/venues/contact-actions.ts`, `src/features/events/actions.ts`, `src/app/door/[eventId]/page.tsx`, `src/app/door/page.tsx`
  - Verify: `pnpm vitest run src/features` ; billing still refuses PA
- [ ] **T7 (P1, human: ~1.5 days / CC: ~1 h)** — app — Identity `roles:['admin']` + `support`, banner, Start-session sheet, PSS01 mapping in `db-errors.ts` + `MutationCache`, outbox non-retryable classification, billing UI exclusion
  - Surfaced by: 0G core 2 + 6, A2, Section 11
  - Files: `src/app/app/layout.tsx`, `src/lib/auth/memberships.ts`, `src/features/po/PoLiveProvider.tsx`, `src/lib/db-errors.ts`, `src/components/po/kit.tsx`, `src/components/po/shell.tsx`, `src/features/door/outbox/replay.ts`, `src/components/po/screens/settings/billing.tsx`, `src/lib/i18n/en.ts`
  - Verify: `pnpm vitest run`; `pnpm qa:flows platform-support`
- [ ] **T8 (P1, human: ~0.5 day / CC: ~20 min)** — mail — "PlusOne support" instead of the operator's name in invite/crew mails (A1)
  - Surfaced by: Section 1 finding A1
  - Files: `src/features/auth/invite-actions.ts`, `src/features/events/actions.ts`, mail templates found by grep
  - Verify: Vitest on the mail payload
- [ ] **T9 (P2, human: ~1 day / CC: ~40 min)** — Platform tab — Support sessions list + session detail
  - Surfaced by: 0G core 9, Section 1 value test
  - Files: `src/components/po/screens/platform-support-sessions.tsx` (new), `src/features/po/queries.ts`, `src/features/po/hooks.ts`, platform nav, visibility test
  - Verify: visibility test (platform admins only); flow screenshot
- [ ] **T10 (P2, human: ~0.5 day / CC: ~20 min)** — docs — spec decision row (#66), CLAUDE.md Platform admins paragraph, runbook lines, changelog
  - Surfaced by: Section 8, Definition of Done 6–7
  - Files: `gastenlijst-app-spec.md`, `CLAUDE.md`, `docs/runbook.md`, `docs/changelog.md`
  - Verify: `tests/unit/claude-md-references.test.ts`

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SCOPE REDUCTION                             |
  | System Audit         | roles:[] in layout hides all edits; 10     |
  |                      | action gates + 2 RPCs refuse PA; audit has |
  |                      | no write-time support marker; events/venue |
  |                      | settings/crew not audited                  |
  | Step 0               | D1 keep visible as PlusOne support; D2 look|
  |                      | always, edit in noted session; D4/D5 kept, |
  |                      | D6/D7 deferred                             |
  | Section 1  (Arch)    | 2 issues found (A1 mail leak, A2 billing)  |
  | Section 2  (Errors)  | 10 error paths mapped, 1 GAP (now rescued) |
  | Section 3  (Security)| 9 threats, 0 High unmitigated; 1 decision  |
  | Section 4  (Data/UX) | 9 edge cases mapped, 0 unhandled           |
  | Section 5  (Quality) | 1 issue (copy-pasted role helpers)         |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                   |
  | Section 7  (Perf)    | 1 measure-before-gate item                 |
  | Section 8  (Observ)  | 1 gap (runbook lines, task T10)            |
  | Section 9  (Deploy)  | 1 risk flagged (old app + new DB window)   |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 3          |
  | Section 11 (Design)  | 0 issues; flow + states specified          |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (7 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 10 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 10 total, 0 CRITICAL GAPS                   |
  | TODOS.md updates     | 2 items (D6, D7)                            |
  | Scope proposals      | 0 proposed, 0 accepted (REDUCTION mode)     |
  | CEO plan             | skipped by mode                             |
  | Outside voice        | codex: unavailable (CLI not installed)      |
  | Lake Score           | 0/1 (D2: chose B 9/10 over C 10/10)        |
  | Diagrams produced    | 6 (architecture, data flow, state machine, |
  |                      | error map, async ordering, UX flow)        |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows, 1 unverified                      |
  +====================================================================+
```
Lake Score note: the only coverage-scored question was D2 (A=6, B=9, C=10). Max chose B, so strictly 0/1 chose the 10/10 option.

## Eng review (2026-10-14)

Target: this file (`docs/designs/platform-support-write-access-ceo-plan.md`), fixed. Report file: this file; eng records sit here, before the terminal report.

### Scope record (Scope Challenge B)

feature answers: none proposed (feature list fixed by CEO D1–D9); structure: B "Original arrangement" (Max, AskUserQuestion D11, 2026-10-14); accepted scope: the CEO plan's 0G items 1–9 in the original arrangement: 5 migrations (sessions + RPCs incl. `my_support_session`; guard + link table; D4 audit coverage; `admin_*_session` platform path; D9 retention), tasks T1–T10 as written; pending remedies: R1 (platform-RPC exemption), R2 (typed error through `mutations.ts`), R3 (crew-invite acceptance by a platform admin).

Scope Challenge result: scope accepted as-is.

### Scope Challenge findings

1. [P1] (confidence: 9/10) `supabase/migrations/20261008120200_platform_trial_override.sql:64,96` — `if auth.uid() is null or not public.is_platform_admin() then` … `update public.subscriptions s`. `subscriptions` is audited (`20260706120000:48` `create trigger audit_subscriptions after insert or update on public.subscriptions`), the row carries `venue_id`, and the actor is a platform admin with no membership there. The planned guard would refuse every Platform-tab "Always free" / trial-end action without a support session, and the same for the planned Fase 14 `set_company_fee_settings`. Reviewer: Claude (eng review).
2. [P1] (confidence: 9/10) `src/lib/db-errors.ts:155-156` — "`po/mutations.ts` rethrows a server action's MutationError as `new Error(res.message)`, so by the time it reaches React Query's MutationCache the `code` is gone". Plan item 6 ("MutationCache opens the sheet on PSS01") cannot work for server-action writes as written: the code never arrives. Browser-client writes (supabase-js) keep `error.code`.
3. [P2] (confidence: 7/10) `supabase/migrations/20261007150000_explicit_invite_accept.sql:195-211` — `accept_invite_for_caller` inserts `event_organizers` for a crew-only invite with no `venue_memberships` row. With D4 auditing `event_organizers`, a platform admin accepting a crew invite at a customer company would be refused by the guard. Rare (operators don't take crew invites today).
4. [P3] (confidence: 9/10) `src/features/door/outbox/replay.ts:94` — `if (code) return { status: 'pending', message: …, codedReject: true };` then dead-letter after `MAX_ATTEMPTS = 5` (`:31`). PSS01 needs its own branch so it is not retried five times. Covered by the approved plan item 6 ("non-retryable, visible failure"); no new decision.

### Section 1: Architecture (eng)

```
  BEFORE                                   AFTER
  write -> RLS(PA ok) -> audit_trigger     write -> RLS(PA ok) -> audit_trigger -> audit_log
        -> audit_log                                                   | AFTER INSERT support_write_guard
                                                                       |  actor null / venue null / export   -> ok
                                                                       |  plusone.platform_op = on (R1/R3)   -> ok
                                                                       |  not PA / PA real member            -> ok
                                                                       |  PA + open session (actor, venue)   -> ok + link row
                                                                       |  else                               -> RAISE PSS01
```
Findings:
1. [P2] (confidence: 8/10) `src/app/app/layout.tsx:106` — `const venues = await getReportingVenues().catch(() => []);` feeds `statsAccess`, and `getReportingVenues` (`src/lib/auth/memberships.ts:120-123`) filters REAL memberships, so Stats/Promotion stay hidden in a support venue even with `roles: ['admin']`. Applied under D5 ("every admin screen visible"): the layout adds the support venue to `statsAccess` when `viaPlatformAdmin`. No new decision.
2. [P2] (confidence: 8/10) `src/features/venues/actions.ts:303-308` — callers need the caller's ROLES, not a yes/no (`canGrantRoles(callerRoles, …)`), so a boolean `has_venue_role` helper is not a drop-in. Resolved in R4 (Section 2).
3. [P3] (confidence: 7/10) `src/features/auth/roles.ts:32` `MFA_ROLES = ['admin','finance']` — effective `['admin']` makes client-side MFA hints treat the operator as an admin; the server nudge (`current_user_requires_mfa`) already excludes platform admins. Cosmetic; implementation keeps MFA UI keyed on real memberships. No decision.
Realistic production failure: the guard's `is_platform_admin()` lookup errors (e.g. a grant change) → every audited write by everyone fails → door down. Covered by the regression contract (R5) and the one-statement rollback.
Distribution: no new artifacts. No issues.
Dispositions: 1 applied (D5); 2 → R4; 3 no change.

### Section 2: Code quality (eng)

1. [P2] (confidence: 8/10) shared role lookup — see R4 (approved, D15).
2. [P3] (confidence: 7/10) guard function branch count: null actor, venue null/export, flag, not PA / real member, session = 5 branches, at the limit. Keep each as an early `return new;` with one comment line; no refactor needed.
3. [P3] (confidence: 9/10) stale diagram: CEO Section 1 architecture diagram lacks the R1/R3 flag branch; the eng diagram above supersedes it. Implementation adds the same ASCII block as the header comment of the guard migration.
Dispositions: 1 → R4 approved; 2, 3 applied in the plan text, no decision needed.

### Section 3: Tests (eng)

Framework (CLAUDE.md Stack): Vitest (unit), Playwright (e2e/flows), pgTAP via `pnpm db:test`, concurrency scripts `scripts/*-concurrency-test.mjs`.

```
CODE PATHS                                                   USER FLOWS
[+] supabase: platform_support_sessions + RPCs               [+] Switch in -> view admin screens
  |- start (PA, note ok)            [GAP->planned pgTAP]        |- [GAP->planned flow Q1-3] all admin screens visible, Stats incl.
  |- start (non-PA 42501, blank 22023, real member 22023)       [+] Edit without session
  |- start twice (supersede)                                    |- [GAP->planned flow] save -> sheet -> start -> save again succeeds
  |- extend own / other admin / expired                         |- [GAP->planned Vitest] server action PSS01 -> SupportSessionRequiredError
  |- end own / other admin                                      |- [GAP->planned Vitest] browser-client PSS01 -> same class
  |- my_support_session read                                    [+] Session lifecycle
[+] supabase: support_write_guard (AFTER INSERT audit_log)      |- [GAP->planned flow] banner timer, Extend, End -> view mode
  |- null actor / venue null / export -> ok   [R5 matrix]       |- [GAP->planned flow] expiry -> sheet with note prefilled
  |- flag on (R1/R3) -> ok, no link           [R5 matrix]       [+] Door
  |- not PA / PA real member -> ok            [R5 matrix]       |- [GAP->planned Vitest] outbox PSS01 -> terminal, visible, not 5 retries
  |- PA + session -> ok + link               [R5 matrix]       |- [planned pgTAP R5] normal doorhost check-in unchanged
  |- PA no/expired session -> PSS01, nothing written [R5]       [+] Platform tab
  |- write vs end race              [GAP->planned concurrency]  |- [GAP->planned Vitest] Support sessions visible to PA only
[+] supabase: D4 audit triggers (events/venues/crew/requests)   |- [GAP->planned pgTAP] comped/trial RPC works without session (R1)
  |- each writes one row with diff; no-op update writes none    [+] Invites
[+] supabase: admin_*_session PA path; D9 retention step        |- [GAP->planned Vitest] invite/crew mail says "PlusOne support"
[+] src/lib/auth/venue-roles.ts getCallerRolesAt  [R4 Vitest]   |- [GAP->planned pgTAP] PA accepts crew-only invite (R3)
[+] src/lib/db-errors.ts + mutations.ts rethrow   [R2 Vitest]
[+] layout identity (roles ['admin'], support, statsAccess)     [GAP->planned Vitest]

COVERAGE (planned): 100% of new paths have a planned ★★★ test; 0 exist today (all new code).
GAPS without a planned test: 0.   E2E: 1 flow (tests/flows/platform-support.flow.ts).   EVAL: none (no LLM change).
```
Regression (IRON RULE): R5 approved (D16). Tests made obsolete: none; the three `callerRolesAt` copies have no dedicated tests (`git ls-files | grep callerRolesAt` → none) [static read].
2am-Friday test: R5 matrix. Hostile QA: raw PostgREST insert as PA without session; PA self-inserts membership; PA calls a non-allowlisted function hoping it sets the flag (catalog check). Chaos: guard migration applied, `is_platform_admin()` revoked from `authenticated` by mistake → R5 matrix fails in CI (the guard's lookup must run as definer, not invoker).
Findings:
1. [P2] (confidence: 8/10) the guard must call the platform-admin lookup with definer rights (it runs inside `audit_trigger`'s SECURITY DEFINER chain, but a future grant change on `is_platform_admin()` must not make every audited write fail) — covered by the R5 matrix + making the guard `security definer set search_path = ''`. Applied under R5; no new decision.
Dispositions: 1 applied (R5).

### Section 4: Performance (eng)

1. [P3] (confidence: 6/10, medium confidence — verify) guard cost per audited row: fast exits first (`actor_id is null`, flag, `venue_id is null`), then one PK lookup `user_profiles(id)` [scale: one per audit row; a 25 000-guest import = 25 000 lookups, unmeasured]. Task: time `supabase/tests` bulk insert of 25 000 guests before/after in the PR body [re-measure before gate]. No decision; it is proof of the approved design.
2. [P3] (confidence: 8/10) session lookup needs the partial unique index `(admin_id, venue_id) where ended_at is null`; link table PK `(session_id, audit_log_id)` plus index on `audit_log_id`. Platform lists paginate on `started_at desc`. Applied.
No N+1, no new connections, no unbounded `.in()` (Platform lists filter by `session_id`/`venue_id` in SQL).
Dispositions: 1, 2 applied, no decision.

### Outside voice (eng)

Codex CLI not installed (`CODEX_MODE: not_installed`); native fallback needs a blocking task-output tool this session does not have. Outside voice unavailable; no external coverage.

### TODOs (eng)

No new TODO proposals; D6/D7 deferrals from the CEO review stand.

## Decision ledger (eng review)

### R1: Platform-tab RPCs vs the support write guard
Finding: #1, P1, confidence 9/10, `supabase/migrations/20261008120200_platform_trial_override.sql:64,96`, Claude eng review
Plan baseline: CEO plan 0G item 4 — guard exempts only `action = 'export'`, `venue_id is null`, `actor_id is null` (D2 + D5 scope). No exemption for platform-level RPCs.
Runtime evidence: `set_venue_comped` / `set_venue_trial_end` update `public.subscriptions` (audited, `20260706120000:48`) as a platform admin without membership (static read).
Comparison grid:
| Commitment | Current | A | B | C |
|---|---|---|---|---|
| Platform-tab comped/trial work without a session | refused by planned guard | yes | yes | no, needs a session at that company |
| Mechanism | — | transaction-local flag set only inside allowlisted SECURITY DEFINER platform RPCs; guard skips when set | guard skips `entity_type = 'subscriptions'` | none (sheet from Platform tab) |
| Raw PA write to subscriptions without session | — | refused | allowed | refused |
| New platform RPCs (Fase 14 fee settings) | — | add one `set_config` line | add table to the list | need a session |
| Proof | — | pgTAP: RPC works w/o session; flag not settable by a client; raw write refused | pgTAP: RPC works | pgTAP: RPC refused w/o session |
Question D12:
D12 — R1: How should Platform-tab actions (Always free, trial end) get past the new support guard?
Header: Platform RPCs
A) Allowlisted RPC flag (recommended)
B) Exempt the subscriptions table
C) Require a session there too
State: approved
Actual answer: A "Allowlisted RPC flag" (Max, AskUserQuestion D12, 2026-10-14)
Accepted scope: `set_venue_comped` and `set_venue_trial_end` (and any later platform RPC that writes audited company rows, e.g. Fase 14 `set_company_fee_settings`) call `perform set_config('plusone.platform_op', 'on', true)` after their `is_platform_admin()` check; the guard returns early while `current_setting('plusone.platform_op', true) = 'on'`. pgTAP: both RPCs succeed without a session; a raw PA update of `subscriptions` without a session is refused; no exposed function lets a client set the flag (catalog check: no `public` function other than the allowlist calls `set_config` with that name).
History: —

### R2: Carry "support session required" to the MutationCache as a type
Finding: #2, P1, confidence 9/10, `src/lib/db-errors.ts:155-156`, Claude eng review
Plan baseline: CEO plan 0G item 6 (D5) — `db-errors.ts` maps PSS01 to `support_session_required`; MutationCache opens the sheet.
Runtime evidence: `mutations.ts` rethrows server-action failures as `new Error(res.message)` (`src/lib/db-errors.ts:155` comment; e.g. `src/features/po/mutations.ts:601`), so the code is lost before the MutationCache.
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| Server-action PSS01 reaches the sheet | no | yes, typed `SupportSessionRequiredError` | yes, by crafted message |
| Browser-client PSS01 reaches the sheet | n/a | yes (`error.code` → same class) | yes (message) |
| Mechanism | — | actions return `code: 'support_session_required'`; one rethrow helper in `mutations.ts` throws the class; MutationCache checks `instanceof` | add the message to `EXPECTED_MESSAGES`; MutationCache matches text |
| Proof | — | Vitest: helper throws the class for the code; MutationCache opens sheet; generic errors unchanged | Vitest: message match |
Question D13:
D13 — R2: How does "start a support session" reach the screen when a server action is refused?
Header: Error type
A) Typed error class (recommended)
B) Match the message text
State: approved
Actual answer: A "Typed error class" (Max, AskUserQuestion D13, 2026-10-14)
Accepted scope: `src/lib/db-errors.ts` maps SQLSTATE PSS01 to code `support_session_required`; server actions return that code unchanged; one rethrow helper in `src/features/po/mutations.ts` throws `SupportSessionRequiredError` for it (browser-client PSS01 maps to the same class); the `MutationCache` in `PoLiveProvider.tsx` opens `StartSupportSessionSheet` on `instanceof`. Vitest: helper throws the class for the code; MutationCache opens the sheet; every other error keeps today's toast.
History: —

### R3: Platform admin accepting a crew-only invite at a customer company
Finding: #3, P2, confidence 7/10, `supabase/migrations/20261007150000_explicit_invite_accept.sql:195-211`, Claude eng review
Plan baseline: guard exemptions per CEO 0G item 4 + R1 flag (platform RPCs only).
Runtime evidence: `accept_invite_for_caller` inserts `event_organizers` for a crew-only invite with no membership row; D4 audits `event_organizers`, so the guard would refuse it (static read).
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| PA accepts a crew-only invite without a session | refused by planned guard | works | refused; start a session first |
| Mechanism | — | `accept_invite_for_caller` sets the R1 flag (accepting your own invite is your own action, not support) | none; documented in the runbook |
| Proof | — | pgTAP: PA accepts crew invite, rows written, no link row | pgTAP: refusal is PSS01 |
Question D14:
D14 — R3: Should a platform admin be able to accept a crew-only invite without a support session?
Header: Crew invite
A) Flag inside accept_invite (recommended)
B) Leave refused, document it
State: approved
Actual answer: A "Flag inside accept_invite" (Max, AskUserQuestion D14, 2026-10-14)
Accepted scope: `accept_invite_for_caller` sets the R1 transaction-local flag before its writes; the flag allowlist is `set_venue_comped`, `set_venue_trial_end`, `accept_invite_for_caller` (+ later platform RPCs per R1). pgTAP: a platform admin accepts a crew-only invite with no session, rows written, no link row.
History: —

### R4: Shared server-side role lookup
Finding: Section 1 #2 + Section 2 shared-code rubric, P2, confidence 8/10, Claude eng review
Plan baseline: CEO 0G item 3 proposed `callerHasVenueRole` (boolean over `has_venue_role`); not separately approved.
Runtime evidence: three identical 10-line `callerRolesAt` helpers (`src/features/venues/actions.ts:46`, `src/features/auth/invite-actions.ts:31`, `src/features/quotas/default-quota-actions.ts:17`) return `VenueRole[]`; two inline reads (`src/features/venues/contact-actions.ts:31-39`, `src/features/events/actions.ts:645-654`, `:821-826`); billing (`src/features/billing/actions.ts:77`) deliberately excludes PA.
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| Where the lookup lives | 3 copies + 3 inline | one `getCallerRolesAt(supabase, venueId)` in `src/lib/auth/venue-roles.ts`: membership roles, else `['admin']` when `is_platform_admin()` (session enforced by the DB guard) | each of 6 sites patched in place with the same PA fallback |
| Billing exclusion | kept | kept (billing keeps its own helper) | kept |
| Lines | — | ~-50 removed / ~+25 added impl [estimated]; +~40 test | ~+30 added across 6 sites [estimated] |
| Blast radius of a bug | per site | every gated action (one tested place) | per site, 6 places to test |
| Proof | — | Vitest on the helper (member, PA, crew-only, none) + one caller test per file | Vitest per site |
Question D15:
D15 — R4: One shared role lookup for server actions, or patch the six places?
Header: Role helper
A) One shared helper (recommended)
B) Patch each call site
State: approved
Actual answer: A "One shared helper" (Max, AskUserQuestion D15, 2026-10-14)
Accepted scope: `getCallerRolesAt(supabase, venueId): Promise<VenueRole[]>` in `src/lib/auth/venue-roles.ts` (user-scoped client; membership roles, else `['admin']` when `is_platform_admin()` RPC returns true; read error throws, never fails open). Migrate `venues/actions.ts`, `auth/invite-actions.ts`, `quotas/default-quota-actions.ts`, `venues/contact-actions.ts`, `events/actions.ts` (inviteExternalCrew, resendCrewInvite); delete the three copies. `billing/actions.ts` keeps its own PA exclusion. Vitest: helper for member / platform admin / crew-only / nobody / RPC error; one caller test per migrated file.
History: —

### R5: Regression contract for the support write guard (IRON RULE)
Finding: Section 3, CRITICAL regression risk, confidence 9/10 — the guard runs on every `audit_log` insert (`audit_trigger()` inserts at `supabase/migrations/20260706100000_influencers_request_links.sql:580-584`), so it sits on every audited write in the product, the door outbox's `check_ins` upsert included (`src/features/door/outbox/gateway.ts:91-121`).
Plan baseline: CEO Section 6 proposed "every non-PA role writes exactly as before with the guard installed, door check-in upsert included" — a proposal, not an approved contract.
Runtime evidence: no guard exists yet; current suites prove today's writes (pgTAP 1180+ assertions, `pnpm db:test`).
Behaviour to preserve: for every actor who is not a platform admin without real membership, and for platform admins who are real members, every audited write commits exactly as today: same row, same `audit_log` row, no link row, no extra error. Intentional change: a platform admin without real membership and without an open session (and outside the R1/R3 flag) is refused with PSS01 and nothing is written.
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| Actors covered | — | admin, user_manager, finance, staff, doorhost, crew-only organizer, PA real member, null actor (cron/retention) | admin, doorhost, null actor |
| Tables covered | — | one write per audited table class (guests insert/update/soft-delete, check_ins upsert, refusals, quotas, event_quotas, venue_memberships, invites, contacts, templates, request_links, subscriptions, company_locations, events, venues, event_organizers, guest_requests) | guests, check_ins, venue_memberships |
| Intentional-change assertions | — | PA no session: PSS01 + row absent; PA session: row + link; flag RPCs: row, no link | same |
| Door path | — | `check_ins` upsert via the outbox gateway shape (insert + on-conflict update) | `check_ins` insert only |
| Cost | — | one table-driven pgTAP file, ~120 assertions [estimated] | ~25 assertions [estimated] |
Question D16:
D16 — R5: How wide must the "nothing changes for normal users" proof be?
Header: Regression
A) Full role × table matrix (recommended)
B) Representative subset
State: approved
Actual answer: A "Full role × table matrix" (Max, AskUserQuestion D16, 2026-10-14)
Accepted scope: `supabase/tests/database/support_write_guard.test.sql`, table-driven: actors admin, user_manager, finance, staff, doorhost, crew-only organizer, platform admin who is a real member, null actor; one write per audited table class listed in the grid (door `check_ins` insert + on-conflict update shape included); each asserts the row and its `audit_log` row exist and no link row exists. Intentional-change cases: PA without session → PSS01 and row + audit row absent; PA with open session → row + link row; R1/R3 flag RPCs → row, no link; expired session → PSS01. Gate: `pnpm db:test` green on a fresh `supabase db reset`.
History: —

Approval readiness: PASS. Checked R1 (D12), R2 (D13), R3 (D14), R4 (D15), R5 (D16) and structure (D11); CEO rows D1–D9 unchanged. Items applied without a new decision carry their governing answer: statsAccess (D5), definer lookup in the guard (R5), indexes and the timing proof (approved design), outbox PSS01 branch (CEO item 6).

## Eng review outputs

### Reality rows (eng)

REALITY: premise-table pass — receipts for every claim (platform RPC supabase/migrations/20261008120200_platform_trial_override.sql:64, rethrow src/lib/db-errors.ts:155, crew accept supabase/migrations/20261007150000_explicit_invite_accept.sql:195, outbox src/features/door/outbox/replay.ts:94); unverified=1 (guard cost at 25 000 rows)
REALITY: already-done pass — no support-session work on origin/main at eb16e888; history of replay.ts, db-errors.ts and mutations.ts shows only unrelated merges (43b48011)
REALITY: surface-check pass — pnpm db:test, pnpm qa:flows and pnpm e2e:smoke exist as scripts package.json:20
REALITY: binding-decisions pass — CEO decisions 0c128fe6 (D1), c07abf38 (D2) and 662eebba (D4–D9) honoured; billing exclusion kept per src/features/billing/actions.ts:74
REALITY: numbers finding — ~120 pgTAP assertions and ~-50/+25 helper lines are [estimated]; 10 gated call sites [measured: Explore agent static read] src/features/venues/actions.ts:46
REALITY: deferred-asks pass — no ask dropped; D6 and D7 deferrals recorded TODOS.md:1
REALITY: pr-count finding — no .gstack/ship-policy.json; two PRs (DB, then app); one extra review cycle; PR 1 is safe alone because no app path lets a platform admin write in a non-member company until PR 2 (src/app/app/layout.tsx:149 roles [])
REALITY: transaction-semantics pass — the guard runs inside the writing transaction (AFTER ROW trigger chained from audit_trigger, supabase/migrations/20260706100000_influencers_request_links.sql:580); the set_config(..., true) flag ends with the transaction; no pool or driver change

### NOT in scope (eng)

- Merging migrations: the original arrangement stays (D11).
- Caching `is_platform_admin()` per transaction inside the guard: only if the 25 000-row timing proof (E11) shows a problem.
- Everything in the CEO "NOT in scope" section.

### What already exists (eng)

- `has_venue_role` RPC pattern (`src/features/events/actions.ts:92-104`) informs `getCallerRolesAt`; the three `callerRolesAt` copies are removed (R4).
- `classifyError` in `src/features/door/outbox/replay.ts` gets a PSS01 branch; `OUTBOX_BUSTER` untouched.
- `MutationCache` in `src/features/po/PoLiveProvider.tsx:46` opens the sheet (R2).
- Canonical-function guard (`tests/unit/canonical-functions.test.ts`, `supabase/canonical/`): `audit_trigger.sql` stays byte-identical; `run_privacy_retention.sql` changes with D9.

### Failure modes (eng)

| Path | Production failure | Test | Error handling | User sees |
|---|---|---|---|---|
| support_write_guard | raises for a non-PA actor | R5 matrix | one-statement rollback migration | — (blocked in CI) |
| support_write_guard | PA write without a session | R5 | PSS01 → typed error | sheet |
| platform RPCs | flag line missing | R1 pgTAP | — | caught in CI |
| accept_invite | flag line missing | R3 pgTAP | — | caught in CI |
| mutations.ts rethrow | code lost | R2 Vitest | typed class | sheet, not a toast |
| outbox replay | PSS01 retried 5 times | Vitest | terminal branch | failed row "Needs a support session" |
| getCallerRolesAt | RPC error | R4 Vitest | throws (fail closed) | generic error |
| layout statsAccess | support venue missing | flow | — | caught in the flow |

0 critical gaps.

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| DB: sessions, guard, flag, D4, admin sessions, retention | supabase/migrations, supabase/tests, supabase/canonical | — |
| Server: role helper + mail label | src/lib/auth, src/features/venues, src/features/auth, src/features/quotas, src/features/events | — |
| App: identity, banner, sheet, typed error, outbox branch, Platform screen | src/app/app, src/features/po, src/components/po, src/features/door, src/lib | DB (regenerated types) |

Lane A: DB. Lane B: server helper + mails. Launch A + B. Merge both. Then lane C (app) on the regenerated `src/lib/database.types.ts`. Conflict flags: `src/features/events/actions.ts` only in lane B; `src/lib/db-errors.ts` only in lane C.

## Implementation Tasks (eng revision)

Supersedes the CEO task list where they differ. P1 blocks ship.

- [ ] **E1 (P1, human: ~1 day / CC: ~40 min)** — DB — Sessions table + start/extend/end/my_support_session RPCs (TTL 60 min, D8) + grant matrix
  - Surfaced by: CEO 0G item 1; D11 original arrangement
  - Files: `supabase/migrations/<ts>_platform_support_sessions.sql`, `supabase/tests/database/platform_support_sessions.test.sql`, `supabase/tests/database/grant_matrix.test.sql`
  - Verify: `supabase db reset && pnpm db:test`
- [ ] **E2 (P1, human: ~1.5 days / CC: ~1 h)** — DB — Guard + link table + R1/R3 flag (`set_venue_comped`, `set_venue_trial_end`, `accept_invite_for_caller`) + R5 role × table matrix + concurrency script
  - Surfaced by: CEO 0G item 4; eng findings 1 and 3; R1, R3, R5
  - Files: `supabase/migrations/<ts>_support_write_guard.sql`, `supabase/tests/database/support_write_guard.test.sql`, `scripts/support-session-concurrency-test.mjs`
  - Verify: `pnpm db:test`; the concurrency script; `tests/unit/canonical-functions.test.ts` green
- [ ] **E3 (P1, human: ~1.5 days / CC: ~45 min)** — DB + audit feed — D4 audit coverage
  - Files: `supabase/migrations/<ts>_audit_coverage.sql`, its pgTAP, `src/features/audit/translate.ts`, `src/lib/i18n/surfaces/audit.ts`
  - Verify: `pnpm db:test`; `pnpm vitest run src/features/audit`
- [ ] **E4 (P1, human: ~0.5 day / CC: ~20 min)** — DB — `admin_list_user_sessions` / `admin_revoke_session` platform path
  - Files: `supabase/migrations/<ts>_admin_sessions_platform_admin.sql`, its pgTAP
  - Verify: `pnpm db:test`
- [ ] **E5 (P2, human: ~0.5 day / CC: ~20 min)** — DB — D9 retention step + Privacy §10 line
  - Files: `supabase/migrations/<ts>_support_note_retention.sql`, `supabase/canonical/run_privacy_retention.sql`, retention pgTAP, `docs/legal/privacy-policy.md`
  - Verify: `pnpm db:test`; canonical guard green
- [ ] **E6 (P1, human: ~0.5 day / CC: ~20 min)** — server — `getCallerRolesAt` (R4), migrate 6 sites; `/door` pages admit a platform admin
  - Files: `src/lib/auth/venue-roles.ts`, `src/features/venues/actions.ts`, `src/features/auth/invite-actions.ts`, `src/features/quotas/default-quota-actions.ts`, `src/features/venues/contact-actions.ts`, `src/features/events/actions.ts`, `src/app/door/[eventId]/page.tsx`, `src/app/door/page.tsx`
  - Verify: `pnpm vitest run src/lib/auth src/features`
- [ ] **E7 (P1, human: ~0.5 day / CC: ~20 min)** — mail — "PlusOne support" as inviter (CEO finding A1)
  - Files: `src/features/auth/invite-actions.ts`, `src/features/events/actions.ts`
  - Verify: Vitest on the mail payloads
- [ ] **E8 (P1, human: ~1.5 days / CC: ~1 h)** — app — identity (`roles:['admin']`, `support`, statsAccess), banner, sheet, R2 typed error through `mutations.ts` + MutationCache, outbox PSS01 terminal branch, billing UI exclusion
  - Files: `src/app/app/layout.tsx`, `src/lib/auth/memberships.ts`, `src/features/po/PoLiveProvider.tsx`, `src/features/po/mutations.ts`, `src/lib/db-errors.ts`, `src/components/po/kit.tsx`, `src/components/po/shell.tsx`, `src/features/door/outbox/replay.ts`, `src/components/po/screens/settings/billing.tsx`, `src/lib/i18n/en.ts`, `tests/flows/platform-support.flow.ts`, `tests/flows/flows.mjs`
  - Verify: `pnpm vitest run`; `pnpm qa:flows platform-support`
- [ ] **E9 (P2, human: ~1 day / CC: ~40 min)** — Platform tab — Support sessions list + detail
  - Files: `src/components/po/screens/platform-support-sessions.tsx`, `src/features/po/queries.ts`, `src/features/po/hooks.ts`, a visibility test
  - Verify: visibility test; flow screenshot
- [ ] **E10 (P2, human: ~0.5 day / CC: ~20 min)** — docs — spec row #66, CLAUDE.md Platform admins paragraph, runbook (drop-guard hotfix, PSS01), changelog, adversarial security-research prompt in the PR body
  - Files: `gastenlijst-app-spec.md`, `CLAUDE.md`, `docs/runbook.md`, `docs/changelog.md`
  - Verify: `tests/unit/claude-md-references.test.ts`
- [ ] **E11 (P3, human: ~1 h / CC: ~10 min)** — perf proof — 25 000-guest bulk insert timing before/after the guard, recorded in the PR body
  - Verify: numbers recorded [re-measure before gate]

### Unresolved decisions (eng)

None.

### Eng completion summary

- Step 0: Scope Challenge — scope accepted as-is (structure: original arrangement, D11)
- Reality rows: 8/8 applicable rows emitted, 1 unverified premise
- Architecture Review: 3 issues found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 1 gap identified (regression contract, resolved by R5)
- Performance Review: 2 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; no native fallback tool)
- Parallelization: 3 lanes, 2 parallel / 1 sequential
- Lake Score: 5/5 (D12–D16 each chose the 10/10 option)

PLAN_REALITY: phase=eng rows=8/8 missing=none unverified=1 verdict=complete (checked with CRLF stripped)

## Design review (2026-10-14)

Target: this file, Section 11 (Design & UX) plus the UI parts of 0G items 2, 6, 9 and findings A2. Reviewer: Claude (`/plan-design-review`), decisions by Max via AskUserQuestion. Design source: `design-system.md` (no `DESIGN.md`); visual frames in Paper (see Approved designs). Classifier: OPERATE (app UI). The gstack designer was not used (no OpenAI key on this machine; Max asked for Paper).

Initial rating 5/10: Section 11 had a flow and a states table, but no banner placement per chrome, no timer behaviour toward zero, no sheet anatomy, no rule for the refused save after Start, no billing treatment and no Platform layout.

### Design decisions (Max, AskUserQuestion, 2026-10-14)

| ID | Question | Answer | Applied as |
|---|---|---|---|
| UX1 | Banner placement | A: one strip above every screen | `SupportBanner` mounted by the shell, above the screen header, below the top safe area, on every `po` screen including the Deur tab (outbox door and cockpit). Not per screen. Desktop: spans the content column only, never the sidebar. |
| UX2 | Session details | A: tap banner opens the session sheet | Phone banner shows company, time left, Extend. Tapping anywhere else on the banner opens `SupportSessionSheet` (company, note, ticket chip, started at, time left, Extend, End). iPad/desktop show note and End inline; tap opens the same sheet. |
| UX3 | Platform view of sessions | A: Access log with two segments | Platform > Access log gets a segmented control: **Sessions** (default) and **Switches** (today's list). Same company filter for both. A session row opens a session detail screen listing that session's audited writes. Replaces 0G item 9's separate "Support sessions" screen; no new PlatformNav row; no union RPC. |
| UX4 | Timer toward zero | A: warn at 5 min, flip at 0 | ≤ 5 min: banner switches to the `stale` tone and reads "5 min left · Extend". At 0 the client flips the banner to "Session ended · Start again" (note prefilled) without waiting for the lazy DB close; no modal. The DB stays the source of truth (PSS01). |
| UX5 | Refused save after Start | A: "Start session & save" | The PSS01 sheet's primary button starts the session and re-runs the refused mutation once (the first attempt rolled back entirely, so the retry is safe); toast "Session started · saved". Opened from the banner (nothing pending) the button reads "Start session". Mechanism: the MutationCache keeps the refused mutation and its variables for one retry. |
| UX6 | Empty and error states | A: as proposed | Sessions empty: "No support sessions yet. They appear here when someone starts one from a company." Session detail without writes: "Nothing changed in this session." Door outbox PSS01 row: "Not saved · needs a support session" + button "Start session", then the row is resent. Loading = existing skeleton rows; error = existing inline "Try again". |
| UX7 | What the operator is told | A: both lines (wording refined by F3) | Under the note: hint "Describe the request. No guest details." and a box with the `ActorName` support chip plus "The company sees this label. Your note stays with PlusOne." (F3, Max in the Paper feedback round: chip + short line, so "PlusOne support" is not said twice). |
| UX16 | Change count in the session sheet | F2: keep | `SupportSessionSheet` shows "Changes so far: N" (count of `platform_support_session_writes` rows for the session), the same number as the Access log Changes column. |
| UX8 | End | A: one tap + toast | End closes at once; toast "Session ended. You're viewing again."; banner back to view mode. No confirm. |
| UX9 | Banner colour per state | A: neutral / accent-dim / stale | View: `bg-elev`, `border-line`, shield icon in accent, text `dim`. Session: `bg-acc-dim`, `border-acc`, text `acc`. ≤ 5 min: `stale` tint and text. Never filled lavender (that is the Toast). |
| UX10 | Component vocabulary | A: as proposed | `SupportBanner` in `shell.tsx`; `StartSupportSessionSheet` and `SupportSessionSheet` on the existing `Sheet` + `Label` + `TextArea` (counter 0/500) + `Field` (ticket) + `FieldErrorFor` + `Btn`; ticket as `MiniChip`; operator names in Platform lists as plain names, company side through the existing `ActorName` support chip. New colour token `stale` = `#E8C98A`, replacing the hardcoded `SYNC_STATUS_COLOR.stale`. |
| UX11 | Layout per width | A: as proposed | 390: banner 48 px, one line; sheets bottom-aligned. 768: banner with truncated note + Extend + End; sheets max 560 px. 1280: banner over the content column with note, ticket chip, time, Extend, End; Access log Sessions as a table (Operator, Company, Note, Ticket, Started, Duration, Changes). |
| UX12 | Accessibility | A: as proposed | Banner `role="region"` `aria-label="PlusOne support session"`; timer announced only at 5 min and at the end (`aria-live="polite"`), never per minute; Extend/End/Start ≥ 44 px hit area (`hitRing*` where visually smaller); sheet opens with focus in the note field, Esc closes, focus returns to the opener; field errors via `FieldErrorFor` (`aria-describedby`); `stale` text on `stale` tint ≥ 4.5:1. |
| UX13 | Billing for a platform admin | A: read-only + Note | Billing screen renders read-only (the native-shell path): plan, status, trial end visible; Checkout/Portal hidden; `Note`: "Billing stays with the company. Support can't change it." |
| UX14 | Company name in the banner | A: yes | View: "<Company> · viewing as support · Start". Session: "<Company> · 42 min · Extend". Long names ellipsize; the full name is in the session sheet. |
| UX15 | Ticket ref | A: free text, chip | Placeholder "e.g. PLU-123 or mail subject"; shown as `MiniChip` in the desktop banner, session sheet and Access log. No auto-link. |

### Screen structure (UX1–UX3, UX14)

```
  PHONE 390 / IPAD 768                         DESKTOP 1280
  +--------------------------------+           +---------+------------------------------------------+
  | safe area                      |           | sidebar | [banner: Club Paradiso · note · PLU-123 · |
  | [banner 48: Club P. · 42 min · |           |  252px  |  42 min left · Extend · End]             |
  |  Extend]  (tap = session sheet)|           |         |------------------------------------------|
  |--------------------------------|           |         | Top (screen title)                       |
  | Top (screen title)             |           |         | screen content                           |
  | screen content                 |           |         |                                          |
  |                                |           |         |                                          |
  | TabBar                         |           +---------+------------------------------------------+
  +--------------------------------+
  Hierarchy in the banner: 1 company, 2 state (viewing / time left), 3 action (Start / Extend), 4 note + End (wide only)
```

```
  Platform > Access log
  [ Sessions | Switches ]  [Company filter]
  Sessions row: operator · company · note (1 line) · ticket chip · started · duration · N changes  ->  Session detail
  Session detail: header (operator, company, note, ticket, start-end) + list of audited writes (actor chip, action sentence, time)
```

### Interaction states (supersedes the Section 11 table)

```
  FEATURE              | LOADING              | EMPTY                          | ERROR                                 | SUCCESS                              | PARTIAL
  ---------------------|----------------------|--------------------------------|---------------------------------------|--------------------------------------|------------------------
  Banner (view)        | skeleton line 48px   | n/a                            | session read fails: view mode         | "<Co> · viewing as support · Start"  | n/a
  Banner (session)     | n/a                  | n/a                            | n/a                                   | "<Co> · 42 min · Extend" (accent)    | ≤5 min: stale tone
  Banner (ended)       | n/a                  | n/a                            | n/a                                   | "Session ended · Start again"        | n/a
  Start sheet          | button spinner       | note empty: Start disabled     | field error under note / generic line | closes; toast "Session started"      | n/a
  PSS01 sheet          | button spinner       | note prefilled after expiry    | same as Start sheet                   | "Session started · saved" toast      | retry fails: normal error toast
  Session sheet        | n/a                  | no ticket: chip omitted        | Extend/End fail: inline error         | Extend: time resets; End: toast      | n/a
  Door outbox row      | n/a                  | n/a                            | "Not saved · needs a support session" | resent after Start                   | n/a
  Access log Sessions  | skeleton rows        | "No support sessions yet. …"   | inline "Try again"                    | rows / table                         | paginated 50
  Session detail       | skeleton rows        | "Nothing changed in this session." | inline "Try again"                | write list                           | paginated 50
  Billing (support)    | existing             | existing                       | existing                              | read-only + Note                     | n/a
```

### Journey storyboard (operator)

```
  STEP | USER DOES                                   | USER FEELS                         | PLAN SPECIFIES
  -----|---------------------------------------------|------------------------------------|----------------------------------------------
  1    | Switches into Club Paradiso from Platform   | "Am I in the right company?"       | UX1/UX14 banner names the company, neutral tone
  2    | Looks around (lists, settings, door)        | Safe: looking changes nothing      | View mode, no note needed (D2)
  3    | Edits a guest, taps Save                    | Expects it to just work            | PSS01 sheet, not an error toast (D5, UX5)
  4    | Writes the note, taps "Start session & save"| Slight friction, but understood    | UX7 tells what the customer sees; UX5 saves
  5    | Works for 40 minutes                        | Focus on the customer's problem    | Banner accent + time; no interruptions
  6    | Sees "5 min left"                           | Mild nudge                         | UX4 stale tone + Extend
  7    | Taps End                                    | Done, clean exit                   | UX8 one tap + toast
  8    | Later: "what did we do at Paradiso?"        | Wants one answer                   | UX3 Access log > Sessions > detail
  Customer side: sees the changes as "PlusOne support" in Audit log, guest list, door (D1, existing ActorName).
```
Time horizons: 5 s = company + state readable in the banner; 5 min = the save-and-session loop costs one sheet; 5 years = the Access log answers DPA 4.4 requests without SQL.

### Pass scores

| Pass | Before | After | Remaining gap |
|---|---|---|---|
| 1 Information architecture | 4 | 9 | verified only on live screens |
| 2 Interaction states | 5 | 9 | retry edge cases (UX5) proven in the flow |
| 3 Journey | 4 | 9 | real operator use |
| 4 AI slop | 6 | 9 | no hard rejection; litmus 7/7 yes (cards only in the existing mobile list pattern) |
| 5 Design system | 6 | 9 | `stale` token refactor lands in the build |
| 6 Responsive & a11y | 3 | 9 | contrast and screen-reader checks on device |

Overall (lowest pass): 3 → 9.

### NOT in scope (design)

- A customer-facing indicator that support is active right now (D1 keeps support visible in the audit trail only; a live "support is here" banner for the company is a new product decision).
- Linking ticket refs to Linear (UX15).
- A separate Support sessions screen (UX3 replaces it).
- Motion beyond the existing sheet slide-up and toast.

### What already exists (design)

`Sheet`, `ConfirmSheet`, `Toast` (`src/components/po/shell.tsx`); `Btn`, `Field`, `TextArea`, `Label`, `MiniChip`, `Note`, `FieldErrorFor`, `ActorName`/`ActorPhrase`, `hitRing*` (`src/components/po/kit.tsx`); the access-log list/table pattern (`src/components/po/screens/platform-access-log.tsx`); the company audit feed (`src/components/po/screens/audit.tsx`); the native-shell read-only billing path (`src/components/po/screens/settings/billing.tsx`); `SYNC_STATUS_COLOR.stale` (`#E8C98A`).

### Approved designs

| Screen | Where | Direction | Notes |
|---|---|---|---|
| All support-session screens | Paper file "Admin Platform — Support sessions", https://app.paper.design/file/01M4XACGMNVHHPXBBP4JSJ92TX | 17 frames: P1–P10 phone 390, I1–I2 iPad 768, D1–D4 desktop 1280, plus a read-me artboard | Approved by Max 2026-10-14 ("Goed zo, geen wijzigingen"); feedback F2 (keep change count, UX16) and F3 (chip + short line, UX7) applied. Tokens copied from `design-system.md`; one new token `--color-stale`. |

### Eng impact of the design decisions

UX5 (retry the refused mutation once) and UX16 (change count in the sheet) add work the eng review did not see: the MutationCache keeps the refused mutation and its variables, and the session sheet reads the link-table count. Both are inside PLU-106; neither touches the DB design. UX3 moves 0G item 9 into the existing Access log screen (PLU-107). No new eng decision needed; a delta re-run of `/plan-eng-review` is optional.

### Implementation Tasks (design revision)

Build issues live in Linear under PLU-66 (project Admin Platform). They supersede E1–E11 where they differ; each carries a Model label, the milestone label Now, and `high-risk` where it touches RLS, triggers, SECURITY DEFINER, auth or the door outbox.

- [ ] **PLU-98 (P1, Opus, high-risk)** — DB: `platform_support_sessions` + start/extend/end/`my_support_session` RPCs + grant matrix (E1)
- [ ] **PLU-99 (P1, Opus, high-risk)** — DB: D4 audit triggers + feed phrasing (E3)
- [ ] **PLU-102 (P1, Opus, high-risk)** — DB: support write guard + link table + R1/R3 flag + R5 matrix + concurrency script + E11 timing (E2) — blocked by PLU-98, PLU-99
- [ ] **PLU-103 (P2, Opus, high-risk)** — DB: `admin_*_session` platform path (E4) — blocked by PLU-98
- [ ] **PLU-104 (P3, Opus, high-risk)** — DB: D9 note retention + Privacy §10 (E5) — blocked by PLU-98
- [ ] **PLU-100 (P2, Opus, high-risk)** — server: `getCallerRolesAt` (R4) + `/door` pages (E6) — blocked by PLU-102 (the guard must be live before server actions admit a platform admin)
- [ ] **PLU-101 (P2, Sonnet)** — mail: "PlusOne support" as inviter (E7)
- [ ] **PLU-105 (P2, Opus, high-risk)** — app: identity, UI gates, statsAccess, billing read-only (E8a, UX13) — blocked by PLU-98, PLU-100, PLU-102
- [ ] **PLU-106 (P2, Opus, high-risk)** — app: SupportBanner, sheets, typed error + retry, outbox PSS01 (E8b, UX1–UX16) — blocked by PLU-102, PLU-105
- [ ] **PLU-107 (P3, Opus, high-risk)** — Platform: Access log segments + session detail (E9, UX3) — blocked by PLU-102
- [ ] **PLU-108 (P3, Sonnet)** — flow `tests/flows/platform-support.flow.ts` + test handoff — blocked by PLU-106, PLU-107
- [ ] **PLU-109 (P3, Sonnet)** — docs: spec #66, CLAUDE.md, runbook, changelog (E10) — blocked by PLU-108

### TODOS (design)

No new design debt deferred; every approved decision is in a build issue. D6 and D7 stay deferred from the CEO review.

### Design completion summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; design-system.md + Paper tokens|
  |                      | UI scope: banner, 3 sheets, door row, billing|
  |                      | Access log, company audit feed               |
  | Step 0               | 5/10; all 7 passes (D1); Paper new file (D2) |
  | Pass 1  (Info Arch)  | 4/10 -> 9/10 after fixes                    |
  | Pass 2  (States)     | 5/10 -> 9/10 after fixes                    |
  | Pass 3  (Journey)    | 4/10 -> 9/10 after fixes                    |
  | Pass 4  (AI Slop)    | 6/10 -> 9/10 after fixes                    |
  | Pass 5  (Design Sys) | 6/10 -> 9/10 after fixes                    |
  | Pass 6  (Responsive) | 3/10 -> 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 3 resolved (UX13-UX15), 0 deferred          |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 17 Paper frames, approved                   |
  | Decisions made       | 17 (UX1-UX15 + F2 + F3)                     |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 -> 9/10                                |
  +====================================================================+
```
Why not 10: every remaining point needs the live screens (`/design-review` after PLU-106/PLU-107 land, plus a device pass for contrast and screen readers). Outside design voices (Codex / independent subagent) were not run in this review.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | mode: SCOPE_REDUCTION, 0 critical gaps |
| Outside Review | codex (`codex-plan-review`) | Independent 2nd opinion | 2 | unavailable | Codex CLI not installed (CEO and Eng phases); no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 9 issues, 0 critical gaps (all resolved: R1–R5 approved, rest applied) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 5/10 → 9/10 (lowest pass 3 → 9), 17 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable in the CEO and Eng phases (CLI not installed). Design phase: outside design voices not run (skipped, not offered); no external design review.
- **VERDICT:** CEO + DESIGN CLEARED. Eng review is ISSUES OPEN by the status rule (9 findings, all resolved into tasks, 0 unresolved decisions, 0 critical gaps), so the dashboard reads NOT CLEARED — eng review required. The design decisions add UI work inside PLU-106/PLU-107 only; an eng delta re-run is optional.

NO UNRESOLVED DECISIONS
