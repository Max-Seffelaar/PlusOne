# Traction & CRM — what do we actually build? CEO plan review (working plan)

Status: DECIDED (CEO review + eng review 2026-10-14, matching update 2026-10-15). Build: Linear project Tractie & CRM (PLU-110, PLU-111, PLU-112, PLU-114, PLU-115; Max actions PLU-16).
Linear: project Tractie & CRM, PLU-69 (this review), PLU-16 (Max actions).
Plan under review: `docs/attio-crm-plan.md` (2026-07-09, series 01–05, "Nothing built" per `docs/changelog.md:11443-11447`).

## Problem (Max, 2026-10-14)

"The Platform tab is nice, but traction information also has to land in our CRM (Attio)." Decide what we build, what stays manual and what is dropped.

## Evidence (static read + Explore agent, 2026-10-14)

- **Platform tab already covers most of the 9/7 founder dashboard (old task 04).**
  - Invites screen (`src/components/po/screens/platform.tsx:70-75, 149-150, 356-373`): per-invite funnel `invited → signed_in → company_created → first_event` (+ `revoked`), fed by `platform_invite_stage_rows()` (`supabase/migrations/20260923150000_platform_invites.sql:248-296`). "first_event" = the invitee is a member of any venue that has an event.
  - Overview (`platform-overview.tsx:4-6`): companies per billing status, MRR/ARR, trial funnel, 30-day usage (`20261012130000_platform_overview_rpcs.sql`).
  - Venues (`platform-venues.tsx:4-6`) and the company card (`platform-company.tsx:4-10`): status, event count + latest event, owner's last login, last check-in, switch.
  - Audit, access log, mail log, billing mails, resend cooldown.
- **Funnel gaps in the Platform tab:** the per-invite funnel stops at `first_event`; no `first_door_night` (first check-in), no per-company `paying` stage on the funnel, no at-risk / churned flag per company. No `venue_lifecycle` / `user_activation` views; `events.created_by` does not exist (`20260613000000_full_schema.sql:118-136`).
- **Daily platform digest (PR #440, decision #57, `gastenlijst-app-spec.md:75`)** replaces the weekly Slack digest (old task 03): pg_cron `plusone-platform-digest` → Edge Function `supabase/functions/platform-digest/`, mail via Resend to every platform admin, counts only, no company names, no MRR (`template.ts:108-150`). No `founder_digests` table, no Slack.
- **Legal (decision Max 2026-10-05, `legal-v03-plan-claude-code.md:98`):** Attio is section B, "used manually by the PlusOne team; no automated sync from the app" (`docs/legal/subprocessors.md:32`, `privacy-policy.md:135`). Guest data never (`privacy-policy.md:81`). CRM retention 24 months after last contact (`privacy-policy.md:170`). A **People** sync needs a new legal-basis decision by the lawyer first (`docs/legal/README.md:64`); once Attio gets code, the subprocessor row and Privacy §8 change in the same PR (`README.md:103`). Verdict: a sync is not ruled out, it is gated.
- **Stale legal row:** the Slack subprocessor row (`subprocessors.md:33`) still says "a weekly digest of platform activity"; the digest moved to mail (#440). Docs-only fix.
- **No CRM code:** no `src/features/crm`, no `ATTIO_API_KEY`, no `CRON_SECRET`, no `/api/cron`, no Vercel crons. All scheduling is pg_cron → Edge Function; the 9/7 plan's hourly Vercel route conflicts with that pattern.
- **Old task 05 (support impersonation)** is superseded by `docs/designs/platform-support-write-access-ceo-plan.md` (CEO + eng review done 2026-10-14, project Admin Platform).
- **Attio API (web, docs + integrator pages):** `PUT /v2/objects/{object}/records?matching_attribute=…` asserts (create-or-update) a record on a unique attribute; scopes `record_permission:read-write`, `object_configuration:read`. Practitioner view (vendor-biased): founder-led sales first, add a usage sync around 10–20 paying customers, prefer few signals.

## 0A. Premise

- **Real problem:** two systems answer "where is this customer?". Attio holds the sales side (lead → meeting → trial agreed → won/lost); the Platform tab holds the product side (signed in, company, first event, paying). Max wants one place while selling.
- **Do-nothing cost [estimated]:** at today's volume (under 5 companies, a handful of open invites) copying a stage into Attio by hand is minutes per week. The cost grows linearly with companies; it starts to hurt somewhere in the 10–25 range.
- **Proxy risk:** "a sync" is a means. The outcome is "Max never chases a prospect that already went live, and never misses one that stalled". A link between the two records plus a complete funnel in the Platform tab delivers most of that without moving data.

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| D1 — CRM approach (Max) | legal README:64, :103; subprocessors.md:32; no CRM code | **A) full 9/7 sync: Companies + People, automated** (recommendation was C, no sync now) | — | approved | Max, AskUserQuestion D1, 2026-10-14: "A) Volledige 9/7-sync". Scope: an automated one-way sync of Companies and People into Attio. |
| D2 — review mode (Max) | 0E; 9/7 plan >15 files [estimated] | SCOPE REDUCTION | — | approved | Max, AskUserQuestion D2, 2026-10-14. Admin choice, approves no plan change. |
| D3 — People into Attio (Max) | legal README:64 | **All team members, all roles** (Max: "Iedereen moet gewoon Attio in, het zijn commerciële doeleinden dus dat gaat prima privacy wise") | — | approved | Max, AskUserQuestion D3 (free text), 2026-10-14. Scope: who is synced. How the legal gate in README:64 is handled is D5. |
| D4 — fate of the old series 01–05 (Max) | PLU-69 description; Explore report | Max decides per item | — | approved | Max, AskUserQuestion D4, 2026-10-14: "Nee, ik wil per item kiezen". |
| D4.1 — old 01 lifecycle foundation (Max) | no lifecycle function; invite stages stop at first_event (`20260923150000_platform_invites.sql:248-296`); no `events.created_by` | **Kept, rescoped:** one platform-only SQL function for the company lifecycle (ladder + flags) shared by the sync and the Platform tab; `events.created_by` dropped | — | approved | Max, AskUserQuestion D4.1, 2026-10-14: "Houden, herscoped". |
| D4.2 — old 03 weekly Slack digest (Max) | daily mail digest #440, spec #57; stale Slack row `subprocessors.md:33` | **Dropped.** Daily mail digest is the digest; Slack webhook leaves PLU-16; Slack subprocessor row corrected | — | approved | Max, AskUserQuestion D4.2, 2026-10-14: "Vervalt". |
| D4.3 — old 04 founder dashboard (Max) | Platform tab live (#49, Platform R) | **Kept as an extra traction view** beside the existing Platform screens (recommendation was: drop) | shape = D6 | approved | Max, AskUserQuestion D4.3, 2026-10-14: "Houden als extra". |
| D5 — legal gate for the People sync (Max) | legal README:64; privacy-policy.md:135; subprocessors.md:32 | **B) Live on Max's own legitimate-interest decision; no lawyer gate.** Privacy §8, subprocessor row and legal README:64 updated in the same PR (recommendation was A) | — | approved | Max, AskUserQuestion D5, 2026-10-14: "B) Live op eigen besluit". Supersedes the 2026-10-05 line in README:64 for this sync. |
| D4.4 — old 05 support impersonation (Max) | `docs/designs/platform-support-write-access-ceo-plan.md` (CEO + eng reviewed) | **Merged into project Admin Platform**; nothing built here | — | approved | Max, AskUserQuestion D4.4, 2026-10-14: "Opgegaan in Admin Platform". |
| D6 — shape of the traction view (Max) | CLAUDE.md "one responsive surface", G1 URLs, T1 tablet | **Platform › Traction** sub-screen: lifecycle-ladder funnel, companies per stage, at-risk/churned list, link to the Attio record; fed by the D4.1 function | — | approved | Max, AskUserQuestion D6, 2026-10-14: "Platform › Traction". |
| D7 — objection / opt-out for the People sync (Max) | GDPR art. 21 under legitimate interest (D5) | Max chose "manual in Attio" (recommendation was a DB flag + LIA). Reopened as D7b: a manual delete in Attio is undone by the next full-state run | D7b | superseded by D7b | Max, AskUserQuestion D7, 2026-10-14: "Handmatig in Attio". |
| D7b — how a manual opt-out survives the sync (Max) | full-state hourly assert re-creates a deleted person | **Checkbox `plusone_crm_opt_out` on the Attio person, set by hand; the sync skips that person and clears the synced values** | — | approved | Max, AskUserQuestion D7b, 2026-10-14: "A) Vinkje in Attio". |
| D8 — who is "everyone" (Max) | `venue_memberships`, `event_organizers` | **Members (all roles) + crew** (event_organizers), crew linked to the company of their events (recommendation was members only) | — | approved | Max, AskUserQuestion D8, 2026-10-14: "Members + crew". |
| R1 — sync runtime (Max, owner Section 1) | all scheduling is pg_cron → Edge Function (`20261013150000_platform_digest.sql`); `vercel.json` has no crons | **pg_cron → Edge Function `attio-sync`**, single-use invocation token like the digest, `ATTIO_API_KEY` as an Edge Function secret | — | approved | Max, AskUserQuestion R1, 2026-10-14. Replaces the 9/7 `/api/cron/attio-sync` + `CRON_SECRET`. |
| R2 — sync frequency (Max, owner Section 7) | ~275 writes/run at 25 companies [estimated] | **Hourly; compute the full state, write only records whose payload hash changed** (`crm_sync_state`: Attio record id + hash) | — | approved | Max, AskUserQuestion R2, 2026-10-14: "Uurlijks + hash-diff". |
| R3 — leavers and stopped companies (Max, owner Section 4) | privacy-policy.md:170 | **Never delete from the sync.** Unlink + `plusone_status = former` + `former_since`; company gets lifecycle `churned`. Max: "Die 24 maanden gaan alleen om klanten. Dus deze mensen blijven in de CRM staan." | — | approved | Max, AskUserQuestion R3 (free text), 2026-10-14. |
| R3b — retention for former team members and crew (Max, owner Section 3) | GDPR art. 5(1)(e), art. 13(2)(a); privacy-policy.md:170 covers customers/prospects only | **A longer fixed term**: 60 months after the person's last company link, as a new row in the privacy policy retention table. Clean-up stays manual in Attio, filtered on `former_since` | — | approved | Max, AskUserQuestion R3b, 2026-10-14: "Langere vaste termijn". The number 60 is the option's example; Max can change it in the legal PR. |
| R4 — Attio match keys (Max, owner Section 4) | rule #7 (users change their own e-mail) | **People match on a unique custom attribute `plusone_user_id`** (e-mail is a value); Companies on `plusone_venue_id`; company links via a multi-reference `plusone_companies` (a person can sit at several companies) | — | approved | Max, AskUserQuestion R4, 2026-10-14. |
| R5 — Attio workspace attributes (Max, owner Section 9) | key scope `record_permission:read-write`, `object_configuration:read` | **Manual checklist in PLU-16 + a preflight in every run** that reads the object configuration and fails loudly (Sentry, run-log) naming the missing slug | — | approved | Max, AskUserQuestion R5, 2026-10-14. |
| R6 — sync monitoring (Max, owner Section 8) | Prime directive 5; digest #440 | **`crm_sync_runs` run-log (platform-only), Sentry on every failure, "last good sync" on Platform › Traction, one digest line when the last good run is older than 3 hours** | — | approved | Max, AskUserQuestion R6, 2026-10-14. |
| M1 — milestones (Max) | CLAUDE.md milestone rule | **Everything Now**: lifecycle function, Platform › Traction, Attio sync + legal text (first answer "sync ≥5" reversed) | — | approved | Max, AskUserQuestion M1, 2026-10-14 ("Lifecycle+Traction Now, sync ≥5"), reversed by Max in chat 2026-10-14: "Sync mag direct". |
| S1 — opt-out memory (Max, owner Section 3) | D7b; a deleted Attio record loses its checkbox | **`crm_sync_state.opted_out_at`**, set when the sync first sees the Attio checkbox; never cleared by the sync | — | approved | Max, AskUserQuestion S1, 2026-10-14. |
| S2 — legitimate-interest assessment (Max, owner Section 3) | GDPR art. 5(2) accountability; D5 | **Short LIA note in `docs/legal/` in the same PR as the privacy text** | — | approved | Max, AskUserQuestion S2, 2026-10-14. |
| S3 — prospects from platform invites (Max, owner Section 4) | C2 ladder starts at invited; `platform_invites` (`20260923150000`) | **Non-revoked, non-anonymized platform invites sync as People with `plusone_invite_stage`** | — | approved | Max, AskUserQuestion S3, 2026-10-14. |

Approval readiness: PASS — rows D1, D2, D3, D4, D4.1–D4.4, D5, D6, D7 (superseded by D7b), D7b, D8, R1–R6, R3b, M1, S1–S3 each cite the AskUserQuestion answer named in their last column (2026-10-14). The working plan below applies only those answers. No pending rows.

## Decision (the outcome of PLU-69)

1. **Build an automated one-way sync into Attio** (Companies + People: members of every role, crew, and platform-invite prospects). Milestone **Now** (M1, reversed 2026-10-14). Legal basis: legitimate interest, Max's own decision (no lawyer gate), documented in a short LIA; Privacy §8, the Attio subprocessor row, a new retention row (60 months for former team/crew) and legal README:64 change in the same PR.
2. **Build one platform-only company lifecycle function and a Platform › Traction screen** on top of it. Milestone **Now**.
3. **Stays manual:** the sales pipeline in Attio (`Sales stage`, never written by the sync), opt-out ticks in Attio, the 24/60-month clean-up in Attio, and the Attio attribute setup (checklist).
4. **Dropped:** old 01 as written (views + `events.created_by`), old 03 (weekly Slack digest, Slack webhook), the 9/7 Vercel cron route and `CRON_SECRET`. **Moved:** old 05 to project Admin Platform. **Kept:** old 04 as Platform › Traction.

## Current scope (after Step 0)

Mode: SCOPE REDUCTION (D2). Accepted: D1, D3, D4.1, D4.3/D6, D5, D7b, D8, R1–R6, R3b, S1–S3, M1. Dropped: old 01 views and `events.created_by`, old 03 (D4.2), the Vercel route (R1). Moved: old 05 (D4.4). Pending: none.

## Section 1 — Architecture

```
                         Postgres (prod)                                  Edge runtime                 Attio (UK)
  +--------------------------------------------------------+     +-------------------------+     +-------------------+
  | venues, venue_memberships, event_organizers, events,    |     |                         |     |                   |
  | check_ins, subscriptions, audit_log, platform_invites,  |     |  attio-sync (Deno)      |     | Companies         |
  | user_profiles                                           |     |  1 begin(token)         |     |  plusone_venue_id |
  |            |                                            |     |  2 preflight attributes |---->|  product_lifecycle|
  |            v                                            |     |  3 read opt-outs        |<----|  ...              |
  |  company_lifecycle_rows()  (SECURITY DEFINER, no grant) |     |  4 load payload (RPC)   |     | People            |
  |     |                 |                                 |     |  5 hash-diff vs state   |---->|  plusone_user_id  |
  |     v                 v                                 |     |  6 assert changed rows  |     |  plusone_companies|
  | platform_company_   crm_sync_payload()  (service_role)  |<----|  7 write state + run    |     |  crm_opt_out [man]|
  | lifecycle()         crm_sync_state / crm_sync_runs      |     +-------------------------+     | Sales stage [man] |
  | (is_platform_admin) crm_sync_tokens                     |                 ^                   +-------------------+
  |     |               crm_sync_tick() <- pg_cron hourly --|---- pg_net -----+
  +-----|--------------------------------------------------+
        v
  Platform › Traction (po, React Query)      platform-digest Edge Function: "CRM sync stale" line (R6)
```

- **One lifecycle source (D4.1):** an internal `company_lifecycle_rows()` holds the SQL once. Two thin wrappers expose it: `platform_company_lifecycle()` for the Traction screen (gated on `is_platform_admin()`, same pattern as `platform_venue_overview`) and `crm_sync_payload()` for the sync (granted to `service_role` only, like the digest RPCs). Company stage ladder (C2, adapted): `company_created → first_event → first_door_night → active → paying | comped`, with `churned` (subscription canceled) taking precedence and `at_risk` (no event in 60 days, company older than 60 days) as a separate flag so a paying company can still be at risk. "onboarded" is dropped: the onboarding wizard ends in `create_venue_with_owner`, so it equals `company_created`. Pre-company stages (`invited`, `signed_in`) live on People via S3, reusing `platform_invite_stage_rows()` (`20260923150000_platform_invites.sql:248-296`).
- **Runtime (R1):** the digest pattern copied, not invented: `crm_sync_tick()` mints a single-use token and calls the function through pg_net; the function's first call `crm_sync_begin(token)` consumes it (`20261013150000_platform_digest.sql:47-51` explains why no static secret). `verify_jwt = false` in `supabase/config.toml` like platform-digest.
- **Coupling:** new outbound dependency on Attio's REST API. Confined to `supabase/functions/attio-sync/`; a unit guard (like `src/features/billing/stripe-confinement.test.ts`) fails if `api.attio.com` appears anywhere else. The app never calls Attio; Attio never calls the app (one-way, no inbound surface).
- **Security architecture:** no new public endpoint that reads data without the single-use token; the payload RPC is service_role-only; the Traction RPC is platform-admin-only. Who can call what: see Section 3.
- **Scaling (10x/100x):** at 250 companies × ~10 people ≈ 2 750 people [estimated] the hash-diff keeps steady-state writes to the changed rows; the daily full re-assert (Section 4) is the peak. Attio rate limits are unverified [re-measure before gate]; the sync must back off on 429 and resume next run.
- **Single points of failure:** the Attio API key (expiry/revocation), the Attio attribute schema (manual, R5), pg_net/pg_cron (shared with digest and mail jobs).
- **Rollback:** unschedule the cron job (`cron.unschedule('plusone-attio-sync')`) or remove the `ATTIO_API_KEY` secret (function then runs the stub path and logs `skipped_no_key`). Data already in Attio stays; nothing in the app depends on it. Time: minutes.
- **Value test:** the run-log (R6) and Traction "last good sync" are product observability (Prime directive 5), not process artifacts.

Findings: 2 — (1) the 9/7 Vercel route conflicted with the scheduling pattern (resolved R1); (2) lifecycle logic must exist once for two consumers (resolved D4.1).

## Section 2 — Error & Rescue Map

```
  CODEPATH                         | WHAT CAN GO WRONG                          | ERROR CLASS
  ---------------------------------|--------------------------------------------|---------------------------
  crm_sync_begin(token)            | token missing/used/expired                 | 42501 (as digest)
  preflight: GET object attributes | 401/403 (key revoked, scope)               | AttioAuthError
                                   | required slug missing / wrong type         | AttioSchemaError
  read opt-outs (query People)     | 5xx / timeout                              | AttioUnavailableError
  crm_sync_payload()               | SQL error / timeout                        | PayloadError
  assert Company / Person          | 429                                        | AttioRateLimitError
                                   | 400 validation (bad value, unique clash)   | AttioValidationError
                                   | 404 on update by stored record id          | AttioRecordGoneError
                                   | 5xx / timeout                              | AttioUnavailableError
  write crm_sync_state / runs      | SQL error                                  | StateWriteError

  ERROR CLASS            | RESCUED | ACTION                                                        | WHO SEES
  -----------------------|---------|---------------------------------------------------------------|---------------------------
  42501                  | Y       | refuse, nothing read                                          | run-log row status=refused
  AttioAuthError         | Y       | abort run, Sentry error                                       | Traction "sync failing", digest line after 3 h
  AttioSchemaError       | Y       | abort run, Sentry error naming the slug                       | same
  AttioUnavailableError  | Y       | opt-out read: abort the People phase (fail closed); assert:    | run-log partial; next run retries
                         |         | stop run, keep state of written rows                          |
  PayloadError           | Y       | abort run, Sentry                                             | Traction "sync failing"
  AttioRateLimitError    | Y       | honour Retry-After once, then stop run; next run resumes      | run-log partial (counts)
  AttioValidationError   | Y       | skip that record, count it, Sentry warning with record kind   | run-log failed_records > 0
                         |         | + internal id (never e-mail/name)                             |
  AttioRecordGoneError   | Y       | clear stored record id + hash, re-assert by match key         | transparent
  StateWriteError        | Y       | abort run; next run re-asserts (idempotent)                   | run-log / Sentry
```

Rules applied: no catch-all; every rescue either retries next run (idempotent assert), degrades with a visible run status, or aborts with Sentry context (run id, phase, record kind, internal id). **The People phase never runs without a successful opt-out read** (fail closed, D7b/S1). No CRITICAL GAP.

## Section 3 — Security & Threat Model

| Threat | Likelihood | Impact | Mitigation in plan |
|---|---|---|---|
| Venue user reads cross-tenant lifecycle via the new RPCs | Med | High | `platform_company_lifecycle()` checks `is_platform_admin()`; `crm_sync_payload()`/`company_lifecycle_rows()` have no grant to `authenticated`/`anon`; pgTAP proves deny for every venue role + anon, allow for platform admin / service_role. `grant_matrix.test.sql` covers the new tables (revoke first, then grant). |
| Anyone triggers the Edge Function to exfiltrate the payload | Low | High | Single-use token consumed in `crm_sync_begin` before any read (digest pattern); the function returns `{ok:true}` only, never data. |
| Attio key leak | Low | High | Edge Function secret only; never in `src/`; secret-grep guard extended to `ATTIO_API_KEY` (pin to `supabase/functions/attio-sync/`). Rotation = replace secret, no redeploy. |
| Guest data leaks to Attio | Low | High | Payload RPC selects only from venues/memberships/organizers/user_profiles/platform_invites/subscriptions and aggregates of events/check_ins; a unit test asserts the payload key set; no `guests`, `guest_requests`, `contacts` columns anywhere. |
| Objection not honoured | Med | High (GDPR) | D7b checkbox + S1 `opted_out_at` memory + fail-closed opt-out read; synced values cleared on opt-out. |
| PII in logs | Med | Med | run-log stores counts and internal ids only; Sentry context never carries e-mail/name. |
| Personal data in Attio without basis/notice | — | High | D5 legitimate interest + S2 LIA + Privacy §8 + subprocessor row + retention row (R3b) in the same PR; legal README:64 updated. |
| Attio-written values injected back into the app | — | — | none: one-way; the only read is the opt-out checkbox (boolean) and record ids. |

Data classification: names, e-mail addresses (often private for door/staff/crew), roles, company links → personal data, processed by PlusOne as controller; Attio = processor (DPA in PLU-16). Audit: sync writes nothing to app tables covered by audit triggers; `crm_sync_runs` is the trail. High-risk surfaces touched: SECURITY DEFINER RPCs, service_role (Edge Function), third party → fresh-session `/code-review` + `/security-review` on T1 and T3/T4.

Findings: 3 (retention gap → R3b; opt-out memory → S1; accountability → S2), all resolved.

## Section 4 — Data flow & edge cases

```
  INPUT (Postgres rows) -> PAYLOAD RPC (shape + minimise) -> HASH vs crm_sync_state -> ASSERT (Attio) -> STATE + RUN LOG
     |nil company name        -> skip company, failed_records++ (cannot happen: venues.name not null)
     |user without e-mail     -> person asserted without e-mail value (match is plusone_user_id)
     |empty venue (no members)-> company asserted, no people
     |e-mail changed (rule #7)-> same plusone_user_id, e-mail value updated (R4)
     |person at 2 companies   -> one person, plusone_companies = both (R4)
     |crew at several events  -> linked to each event's company (D8)
     |invite revoked/anonymized -> not in payload; existing Attio person keeps last values,
     |                           plusone_invite_stage cleared on next diff
     |membership removed      -> plusone_companies minus that company; if none left: status former + former_since (R3)
     |company canceled        -> lifecycle churned; people unchanged (R3)
     |opt-out ticked in Attio -> opted_out_at set (S1); synced values cleared once; never asserted again
     |record deleted in Attio -> stored id 404 -> re-assert by match key; if opted_out_at set -> skip (S1)
     |Attio 429 / timeout     -> stop run, written rows keep new hash, rest next run
```

- **Self-heal with hash-diff (R2):** a manual edit in Attio to a synced field is not seen by the hash (state says "unchanged"). Rule: one run per day (first run after 03:00 Europe/Amsterdam) ignores the hashes and re-asserts every non-opted-out record. This keeps R2's "zelfherstellend" promise.
- **Async ordering:** invariant "an opted-out person is never written after `opted_out_at` is set". Overlapping runs are the risk (a slow run overlapping the next hourly tick). Mechanism: `crm_sync_begin` takes `pg_try_advisory_lock` (or refuses when a run is `running` and younger than 50 min); a second run exits `skipped_overlap`. Within one run the opt-out read happens before any People write. Regression proof: pgTAP for the begin lock; unit test with a controlled pause between opt-out read and assert, ticking the box in between, asserting the next run clears and skips.
- **Interaction edge cases (Traction screen):** zero companies (empty state), 250 companies (server-side sort/filter by stage; list virtualisation not needed below ~500 [estimated]), stale data (React Query refetch on focus), no sync yet (`last good sync: never`).

Findings: 2 (hash-diff blind spot → daily full re-assert; overlapping runs → begin lock), both applied as direct consequences of R2 and D7b/S1; no new behaviour.

## Section 5 — Code quality

- Reuse: digest token/tick/begin pattern (`20261013150000_platform_digest.sql`), digest.ts/index.ts split for vitest, `platform_invite_stage_rows()` for invite stages, `effectiveTrialEndsAt` rule in SQL (`coalesce(trial_ends_at, created_at + 14 d)`), Platform screen + `platform-company.tsx` card, `src/features/po/queries.ts` fetcher pattern.
- Do not duplicate the stage logic in TypeScript: the Traction screen renders the stage string from the RPC; one enum in `src/lib/po` for labels.
- Keep the Edge Function small: `sync.ts` (orchestration), `attio.ts` (HTTP + error classes), `payload.ts` (pure mapping + hash), each unit-tested under vitest like `platform-digest/digest.ts`.
- No `CrmProvider` interface (9/7): one provider, Deno, no app import site; the confinement guard is the seam. Over-engineering avoided.

Findings: 1 (9/7 `CrmProvider` seam dropped as unneeded with R1). No issues beyond that.

## Section 6 — Tests

```
  NEW THING                              | TYPE        | HAPPY                          | FAILURE                         | EDGE
  ---------------------------------------|-------------|--------------------------------|---------------------------------|------------------------------
  company_lifecycle_rows / platform_*    | pgTAP       | each stage reached from seed   | deny every venue role + anon    | canceled+active events = churned; paying+60d idle = at_risk
  crm_sync_payload                       | pgTAP       | members, crew, invitees present| deny authenticated              | revoked/anonymized invite absent; guest columns absent
  crm_sync_begin / tick / lock           | pgTAP       | token consumed once            | reused token 42501              | overlapping run skipped
  payload.ts mapping + hash              | vitest      | stable hash for same input     | —                               | multi-company person; e-mail change keeps id
  sync.ts orchestration (mock fetch)     | vitest      | only changed records written   | 429 stops run; 401 aborts       | opt-out read fails => no People writes; 404 => re-assert
  opt-out flow                           | vitest      | ticked => cleared once, skipped| —                               | record deleted after opt-out => still skipped (S1)
  confinement + secret guard             | vitest      | api.attio.com only in function | —                               | ATTIO_API_KEY only in function
  Platform › Traction                    | flow (QA-0) | funnel + list render           | RPC error state                 | empty, platform-admin only, 390/768/1280
```

Every assertion checks database state or the outbound request list, not `ok:true`. `no_claim`: Attio's real acceptance of payloads (mocked fetch; unit only) → covered by a manual first run against a test Attio workspace before the prod key is set (T4 acceptance). The 2am-Friday test: "tick opt-out, delete the record, run twice: zero writes for that person". Flakiness: the daily-full-re-assert rule depends on time → inject the clock.

## Section 7 — Performance

- `company_lifecycle_rows()` aggregates per venue in SQL (`GROUP BY venue_id`), never `.in()` lists (CLAUDE.md scale rule). Indexes: `check_ins(venue_id)`, `events(venue_id, starts_at)`, `audit_log(venue_id, created_at)` exist or must be confirmed in T1 (`EXPLAIN` on the seeded perf DB).
- Sync payload size at 250 companies: ~3 000 rows [estimated], one RPC call; hash compare in memory.
- Attio calls: steady state = changed rows only; daily full re-assert ≈ companies + people writes; sequential with a small concurrency (≤5) and backoff.
- Edge Function wall-clock limit applies; the run stops cleanly and resumes next hour.

Findings: 0 beyond the index confirmation in T1.

## Section 8 — Observability

- `crm_sync_runs`: id, started_at, finished_at, status (`ok|partial|failed|refused|skipped_overlap|skipped_no_key`), phase reached, counts (companies/people asserted, skipped, failed, opted_out), error_class. Platform-admin read, service_role write, append-only.
- Sentry: every non-ok run with run id + error class.
- Platform › Traction header: "Last good sync: <time>" and a warning chip when older than 3 hours or the last run failed.
- Digest (#440): one line "CRM sync: last good run <time>" only when older than 3 hours (R6).
- Runbook (`docs/runbook.md`): key revoked → rotate secret; schema error → fix slug per PLU-16 checklist; repeated 429 → check run counts; objection request → tick the Attio box, never delete.

Findings: 0 open (R6 covers alerting and dashboards).

## Section 9 — Deployment & rollout

1. T1 migration (lifecycle function) — additive, no table locks; prod push via the standard flow.
2. T2 Traction screen — ships behind the existing platform-admin gate.
3. T3/T4: migration (tables + RPCs + cron job created **unscheduled** or scheduled with the function returning `skipped_no_key`) → deploy function → Max completes PLU-16 checklist + test workspace run → legal PR content live (same PR) → set `ATTIO_API_KEY` → first run watched in the run-log → digest line.
- Feature flag: the presence of `ATTIO_API_KEY` is the switch.
- Old code / new code overlap: none; nothing in the app reads the new tables except the Traction screen.
- Post-deploy: first run `ok`, counts match `select count(*)` of members + crew + open invites; spot-check 3 records in Attio.

Findings: 1 (key-as-switch must also gate the People phase until the legal text is live) — covered by step order.

## Section 10 — Long-term trajectory

- Debt: a manual Attio schema (R5) can drift; the preflight makes drift loud. Opt-out lives in two places (Attio box + `opted_out_at`) by design.
- Reversibility: 4/5 — unschedule + delete secret; Attio data stays (manual clean-up).
- The 1-year question: one lifecycle function, one function directory, one runbook entry — obvious to a new engineer.
- Path: a later two-way flow (Attio "contract signed" → invite) stays parked (9/7 §Parked) and would need its own review.

Debt items: 2.

## Section 11 — Design & UX (Platform › Traction)

```
  Platform tab ──> [Traction] ──> funnel (company_created → first_event → first_door_night → active → paying/comped)
                         │            └─ tap a stage ─> list of companies in that stage (name, since, last activity, at_risk chip)
                         │                                  └─ tap a company ─> existing platform-company card (+ "Open in Attio")
                         └─ header: last good sync / warning chip (after T4)
```

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Funnel | kit skeleton | "No companies yet" | kit error + retry | counts per stage | — |
| Stage list | skeleton rows | "No companies in this stage" | error + retry | rows | at_risk chip |
| Sync status | — | "Never synced" | "Sync failing since …" | "Last good sync …" | "Partial run …" |

Rules: real URL via `routes.ts` (G1), works at 390/768/1024/1280 (T1), ≥44px targets on touch, kit primitives only, no `target=_blank` (Attio link through `openExternal()`), visible only to platform admins, hidden MRR rules unchanged. "Open in Attio" needs the Attio record id from `crm_sync_state`, so it appears only after T4. Recommend a Paper design pass (Linear label Design) before T2 is built.

## Outside voice

Codex CLI not installed; native fallback needs TaskOutput, which this session does not have → **unavailable**. No outside coverage; no clean-review credit.

## NOT in scope

- Old 01 as written: `venue_lifecycle`/`user_activation` views and `events.created_by` — D4.1 (rescoped to one function).
- Old 03: weekly Slack digest, `founder_digests`, Slack webhook — D4.2.
- 9/7 Vercel cron route, `CRON_SECRET`, `CrmProvider` interface — R1.
- Deleting people from Attio on departure — R3.
- Old 05 support impersonation — D4.4 (project Admin Platform).
- Two-way sync, writing `Sales stage`, auto-invite on contract signed — 9/7 out-of-scope/parked, unchanged.
- Guest/contact data in Attio — never.

## What already exists (reused)

- Platform tab screens and RPCs (`platform_invite_stage_rows`, `platform_company_details`, `platform_venue_overview`, overview RPCs).
- Digest pipeline pattern: token table, tick, begin, pg_net, `verify_jwt=false`, vitest-testable Deno split.
- `effectiveTrialEndsAt` rule, subscriptions table, `check_ins.venue_id`, `audit_log.venue_id`.
- Confinement-guard pattern (`stripe-confinement.test.ts`) and the secret-grep guard.

## Dream state delta

```
  CURRENT                                   THIS PLAN                                   12-MONTH IDEAL
  Attio by hand; Platform funnel stops  --> one lifecycle truth (Now), Traction screen --> Attio shows live product stage for every
  at first_event; no at-risk view           (Now), hourly one-way sync incl. people        prospect/customer; workflows react to stage;
                                            and prospects (Now), monitored                Max acts on at-risk lists, not spreadsheets
```

## Error & Rescue Registry

See Section 2 table (10 failure classes, all rescued, 0 critical gaps).

## Failure Modes Registry

```
  CODEPATH              | FAILURE MODE                           | RESCUED? | TEST? | USER SEES?                 | LOGGED?
  ----------------------|----------------------------------------|----------|-------|----------------------------|--------
  begin(token)          | reused/forged token                    | Y        | Y     | nothing (refused)          | Y
  preflight             | key revoked / slug missing             | Y        | Y     | Traction warning, digest   | Y
  opt-out read          | Attio down                             | Y (fail closed) | Y | partial run                 | Y
  payload RPC           | SQL error                              | Y        | Y     | Traction warning           | Y
  assert                | 429 / 5xx / timeout                    | Y        | Y     | partial run, next run      | Y
  assert                | 400 on one record                      | Y        | Y     | failed_records count       | Y
  assert                | stored record deleted in Attio (404)   | Y        | Y     | transparent                | Y
  opt-out               | record with ticked box deleted         | Y (S1)   | Y     | person stays out           | Y
  hash-diff             | manual edit of a synced field in Attio | Y (daily full re-assert) | Y | corrected within a day | Y
  scheduling            | overlapping runs                       | Y (lock) | Y     | skipped_overlap            | Y
  Traction screen       | RPC error                              | Y        | Y     | error + retry              | Sentry (client)
```

0 CRITICAL GAPS.

## Stale diagram audit

`docs/attio-crm-plan.md` has no ASCII diagrams; its architecture text (Vercel cron, `CrmProvider`, views, `/internal`) is superseded by this plan — a pointer is added at its top.

## Reality rows

REALITY: premise-table pass 14 claims with receipts (Evidence section), unverified=2 (Attio rate limits; Attio multi-reference on People) `docs/designs/tractie-crm-ceo-plan.md:12`
REALITY: already-done pass git log origin/main since 2026-10-01 shows only the daily digest (#440) and mail work; no CRM/lifecycle code `supabase/migrations/20261013150000_platform_digest.sql:1`
REALITY: surface-check pass Attio `PUT /v2/objects/{object}/records?matching_attribute=` (Attio docs); pg_cron/pg_net pattern exists; the 9/7 `/api/cron/attio-sync` route does not exist and is dropped `supabase/migrations/20261013150000_platform_digest.sql:585`
REALITY: binding-decisions finding the 2026-10-05 legal decision ("lawyer decides before any sync", manual Attio) is overruled explicitly by Max in D5/D1; docs change in the same PR `docs/legal/README.md:64`
REALITY: numbers pass ~275 writes/run at 25 companies and ~2 750 people at 250 are [estimated]; Attio rate limits [re-measure before gate] `docs/designs/tractie-crm-ceo-plan.md:12`
REALITY: deferred-asks pass PLU-69 asks (decision doc, issues, PLU-69 Done, PLU-16 update) all covered; old ClickUp tasks 86ey7u0jr/na/p8/qe/un are not edited here (Linear is the tracker now) `docs/attio-crm-plan.md:100`
REALITY: pr-count pass no `.gstack/ship-policy.json`; default one PR per wave: wave Now = T0, T1, T2; wave 2 = T3+T4 (one PR incl. legal), T5 `docs/designs/tractie-crm-ceo-plan.md:1`

## Implementation Tasks

Synthesized from this review's findings. Each task becomes one Linear issue in project Tractie & CRM.

- [ ] **T0 (P2, Now, Sonnet, human: ~30min / CC: ~5min)** — legal docs — Correct the Slack subprocessor row (no weekly digest; digest is mail via Resend)
  - Surfaced by: D4.2 — stale row `docs/legal/subprocessors.md:33`
  - Files: `docs/legal/subprocessors.md`, version history in the same file
  - Verify: `pnpm test` (claude-md/legal reference guards), read-through
- [ ] **T1 (P1, Now, Opus, high-risk, human: ~1d / CC: ~1h)** — db — Company lifecycle function: `company_lifecycle_rows()` + `platform_company_lifecycle()`
  - Surfaced by: D4.1, Section 1, Section 3, Section 7
  - Files: new migration in `supabase/migrations/`, new pgTAP file in `supabase/tests/database/`, `src/lib/database.types.ts`
  - Verify: `pnpm db:test`; stage per seeded company; deny every venue role + anon; `EXPLAIN` uses venue_id indexes
- [ ] **T2 (P1, Now, Opus, Design, human: ~2d / CC: ~2h)** — po — Platform › Traction screen
  - Surfaced by: D4.3, D6, Section 11
  - Files: `src/components/po/screens/platform-traction.tsx` (new), `src/components/po/screens/platform.tsx`, `src/components/po/routes.ts`, `src/features/po/queries.ts`, `src/features/po/hooks.ts`, `src/lib/i18n/en.ts`, `tests/flows/` (new flow)
  - Verify: `pnpm qa:flows platform-traction`; layout suite; platform-admin only
- [ ] **T3 (P1, Now, Opus, high-risk, human: ~1.5d / CC: ~1.5h)** — db — Sync data layer: `crm_sync_state`, `crm_sync_runs`, `crm_sync_tokens`, `crm_sync_payload()`, `crm_sync_begin()`, `crm_sync_tick()` + pg_cron job
  - Surfaced by: R1, R2, R6, S1, S3, D8, Section 4 (lock)
  - Files: new migration, new pgTAP file, `src/lib/database.types.ts`
  - Verify: `pnpm db:test` incl. grant matrix; token single-use; overlap skipped; payload has no guest columns
- [ ] **T4 (P1, Now, Opus, high-risk, human: ~3d / CC: ~3h)** — edge — `attio-sync` Edge Function + legal text in the same PR
  - Surfaced by: D1, D3, D5, D7b, D8, R1–R5, R3b, S1–S3, Sections 2–6
  - Files: `supabase/functions/attio-sync/{index,sync,attio,payload}.ts`, `supabase/config.toml`, unit tests, confinement + secret guard tests, `docs/legal/privacy-policy.md`, `docs/legal/subprocessors.md`, `docs/legal/README.md`, `docs/legal/crm-legitimate-interest.md` (new), `docs/runbook.md`, `gastenlijst-app-spec.md` (decision row), `docs/changelog.md`
  - Verify: vitest suite; manual run against a test Attio workspace; first prod run `ok` with counts matching SQL
- [ ] **T5 (P2, Now, Sonnet, human: ~3h / CC: ~20min)** — monitoring — "Last good sync" on Traction + digest line when stale > 3 h
  - Surfaced by: R6, Section 8
  - Files: `src/components/po/screens/platform-traction.tsx`, `supabase/functions/platform-digest/{digest,template}.ts`, migration for the digest read if needed
  - Verify: unit test for the 3-hour rule; flow screenshot of the warning chip

Task JSONL not written: `jq` is not installed (autoplan aggregation unavailable).

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SCOPE REDUCTION                             |
  | System Audit         | 9/7 plan unbuilt; Platform tab + digest     |
  |                      | cover old 03/04; legal gate on any sync     |
  | Step 0               | full sync (D1), lifecycle + Traction: Now  |
  |                      | Now, per-item fate of 01-05, legal via LIA  |
  | Section 1  (Arch)    | 2 issues found                              |
  | Section 2  (Errors)  | 10 error paths mapped, 0 GAPS               |
  | Section 3  (Security)| 3 issues found, 0 High open                 |
  | Section 4  (Data/UX) | 13 edge cases mapped, 0 unhandled           |
  | Section 5  (Quality) | 1 issue found                               |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 0 gaps found                                |
  | Section 9  (Deploy)  | 1 risk flagged                              |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | 0 issues; design pass recommended           |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (7 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 10 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 11 total, 0 CRITICAL GAPS                   |
  | TODOS.md updates     | 0 items proposed                            |
  | Scope proposals      | 0 proposed, 0 accepted (REDUCTION)          |
  | CEO plan             | skipped by mode                             |
  | Outside voice        | codex not installed; native unavailable     |
  | Lake Score           | N/A (no option scored 10/10)                |
  | Diagrams produced    | 5 (architecture, data flow, error, UX flow, |
  |                      | dream state)                                |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows, 2 unverified                      |
  +====================================================================+
```

Unresolved decisions: none.

## Eng review (2026-10-14)

Target: this file (`docs/designs/tractie-crm-ceo-plan.md`), named by Max ("Ga dan door naar /plan-eng-review"). Milestone change before the review: Max in chat 2026-10-14, "Sync mag direct" → M1 = everything Now (ledger row M1, PLU-113/114/115 relabelled Now).

### Evidence (static read, Explore agent + direct reads, 2026-10-14)

- Digest pattern (`supabase/migrations/20261013150000_platform_digest.sql`): token table with sha256 only (87-90), URL from Vault secret `plusone_platform_digest_url` (474-495), pg_net post with header `x-platform-digest-token` and `timeout_milliseconds := 60000` (515-517), `begin()` deletes a token younger than 10 minutes or raises 42501 (301-335), service_role-only grants (551-572), `cron.schedule('plusone-platform-digest', '45 5,6 * * *', …)` (585-588). **No run-level overlap lock and no run-log table**; idempotency is per recipient (`platform_digest_deliveries` + `pg_advisory_xact_lock` inside `log_platform_digest_mail`, 368-369).
- `platform_invite_stage_rows()` is SECURITY DEFINER, owner-only, and gates inside: `where public.is_platform_admin();` (`20260923150000_platform_invites.sql:295`). `is_platform_admin()` returns false when `auth.uid()` is null (`20260923120000_platform_admin.sql:82-83`). A service_role payload that reuses it gets **0 rows, no error**. The digest solved the same problem with ungated service_role-only twins (`platform_digest_usage_30d`, `platform_digest_trial_funnel`, `20261013150000:231-270`).
- `subscriptions.status` enum: `trialing, active, past_due, canceled, comped` (`full_schema.sql:73`); trial end inlined as `coalesce(s.trial_ends_at, s.created_at + interval '14 days')` (e.g. `20261012130000:148`).
- Indexes: `check_ins (venue_id, checked_at desc)` (`20261012130000:38-39`), `audit_log (venue_id, created_at)` (`full_schema.sql:315`), `events (venue_id, status)` (`full_schema.sql:138`); no `events (venue_id, starts_at)`.
- **No error reporter in any Edge Function** (no Sentry under `supabase/functions/`); platform-digest logs `console.log(JSON.stringify({ fn: 'platform-digest', event, ... }))` (`supabase/functions/platform-digest/digest.ts:262`).
- Edge Function tests: `tests/unit/platform-digest.test.ts` imports `supabase/functions/platform-digest/digest` directly (14-15); `vitest.config.ts:15` includes `tests/unit/**/*.test.ts`.
- Confinement guards: `src/lib/supabase/service-confinement.test.ts:112-122` scans `src/` only; `src/features/mail/mail-confinement.test.ts:46,69` also scans `supabase/functions` ("no Edge Function but platform-digest talks to Resend").
- No account erasure flow: "Delete account" opens an external request page (`src/components/po/screens/settings/profile.tsx:420-428`); `user_profiles` is never anonymised.
- Platform routing: `src/components/po/routes.ts:127-142` (build) and `:283-293` (parse); `platform.tsx:214-238` links sub-screens via `nav.push`.
- Existing coverage of invite stages: `supabase/tests/database/platform_invites.test.sql`, `platform_overview.test.sql`.
- Attio (official docs, Mintlify mirror): 100 read/s and 25 write/s across the API; 429 always carries `Retry-After` as an HTTP date; record-reference attributes support `is_multiselect`; `is_unique` is enforced only for new data and not supported on every type.

### Scope Challenge

Count [estimated]: ~25 changed files (2 migrations, 2 pgTAP files, types, 4 function files, `config.toml`, 3 unit tests, 1 guard test, Traction screen + routes + platform.tsx + queries/hooks + i18n + flow, 7 docs) and 2 new services (Edge Function `attio-sync`, lifecycle function family). Gate trips (≥8 files, ≥2 new services). No feature cuts proposed: the CEO review already reduced scope item by item.

Findings:
1. [P1] (confidence: 9/10) `20260923150000_platform_invites.sql:295` — `where public.is_platform_admin();` makes the planned reuse in `crm_sync_payload()` (T3) return zero prospects silently.
2. [P1] (confidence: 9/10) `supabase/functions/platform-digest/digest.ts:262` — no Edge Function reports to Sentry; R6's "Sentry on every failure" has no transport today.
3. [P2] (confidence: 8/10) plan Section 4 "pg_try_advisory_lock (or … running row)" — an advisory lock taken inside the `crm_sync_begin` RPC ends with that call's transaction (PostgREST), and a session lock is unsafe with pooled connections; only a lease row in `crm_sync_runs` holds across the run. Factual correction, same behaviour: the overlap guard is the lease row (status `running`, younger than 50 min, closed by a `crm_sync_finish` RPC).
4. [P2] (confidence: 7/10) plan Section 4 "first run after 03:00 ignores the hashes" — one daily full pass of ~3 000 records [estimated] at ≤25 writes/s needs ≥120 s, close to the Edge Function wall-clock limit [re-measure before gate]; a pass cut short is not resumed until the next day.
5. [P3] (confidence: 8/10) `src/lib/supabase/service-confinement.test.ts:112-122` scans `src/` only — the `ATTIO_API_KEY` / `api.attio.com` guard must follow `mail-confinement.test.ts` and scan `supabase/functions` too. Implementation detail of the approved guard; added to T4.
6. [P3] (confidence: 6/10) prospects (S3) need a stable `plusone_user_id`: an invitee without an `auth.users` row yet cannot be matched without creating a later duplicate. Rule added to T3: skip (and count) invitees without an auth user id. Medium confidence, verify against `sendInviteEmail` that every sent invite has an auth row.
7. [P3] (confidence: 8/10) `profile.tsx:420-428` — erasure requests are handled by hand; with S1 memory an erasure can delete the Attio record safely. Runbook line added to T4: erasure = tick the opt-out box, wait for one run (sets `opted_out_at`), then delete the Attio record.
8. [P3] (confidence: 8/10) `full_schema.sql:73` — "paying" must be defined on the enum: `active` and `past_due` = paying, `comped` = comped, `canceled` = churned, `trialing` = not paying. Added to T1 acceptance.

### Decision ledger (eng review)

#### E1: arrangement of the build (Scope Challenge B)
Finding: complexity gate, ~25 files, 2 new services (estimated)
Plan baseline: six issues: T0, T1, T2, T3 (data layer PR), T4 (Edge Function + legal PR), T5 (monitoring PR) — CEO plan Implementation Tasks
Runtime evidence: n/a (arrangement)
Comparison grid:
| Commitment | Current | A Original | B Smaller |
|---|---|---|---|
| Feature list, contracts, approved fixes | approved (CEO ledger) | unchanged | unchanged |
| T3 and T4 | two high-risk PRs, two fresh-session review rounds | two PRs | one PR (data layer + function + legal), one review round |
| T5 | own PR | own PR | own PR |
| T0, T1, T2 | own PRs | own PRs | own PRs |
| Pending remedies E2–E4 | pending | pending | pending |
State: approved
Actual answer: Smaller arrangement (recommended) — Max, AskUserQuestion D1 (eng review), 2026-10-14
Accepted scope: T3 and T4 become one PR (migration, pgTAP, Edge Function, tests, legal text); T0, T1, T2, T5 stay separate. Feature list, contracts and approved fixes unchanged.
History: —

#### E2: prospects in the payload despite the platform-admin gate (finding 1)
Finding: 1, P1, 9/10, `20260923150000_platform_invites.sql:295`, reviewer: Claude (eng review)
Plan baseline: T3 "reuse `platform_invite_stage_rows()`" (CEO plan, S3)
Runtime evidence: gated on `is_platform_admin()`; service_role gets 0 rows
Comparison grid:
| Commitment | Current | A Extract ungated twin | B Copy stage SQL into payload |
|---|---|---|---|
| Stage logic | one gated function | one internal ungated function (owner-only) + existing gated function becomes a thin wrapper | two copies |
| Existing invite funnel | unchanged | behaviour unchanged, proved by existing `platform_invites.test.sql` + `platform_overview.test.sql` unchanged and green | untouched |
| Prospects in sync | 0 rows (bug) | correct | correct |
State: approved
Actual answer: A) Ongegate twin (recommended) — Max, AskUserQuestion D2 (eng review), 2026-10-14
Accepted scope: Owner-only internal function holds the invite-stage SQL; platform_invite_stage_rows() becomes a thin wrapper keeping its is_platform_admin() gate; crm_sync_payload() calls the twin. Existing platform_invites.test.sql and platform_overview.test.sql stay unchanged and green (regression contract).
History: —

#### E3: failure alerting from the Edge Function (finding 2, reopens R6's Sentry part)
Finding: 2, P1, 9/10, `supabase/functions/platform-digest/digest.ts:262`, reviewer: Claude (eng review)
Plan baseline: R6 approved: run-log + Sentry on every failure + Traction status + digest line when stale > 3 h
Runtime evidence: no Sentry or other reporter in any Edge Function
Comparison grid:
| Commitment | Current | A Sentry via fetch | B No Sentry |
|---|---|---|---|
| Run-log, Traction status, digest line | approved R6 | unchanged | unchanged |
| Alert transport | Sentry (does not exist in functions) | minimal Sentry envelope POST with `fetch`, DSN as function secret, no SDK, no PII | structured `console.log` (digest pattern) only |
| Worst-case detection | — | minutes | next digest (≤ ~24 h) or next Traction visit |
State: approved
Actual answer: A) Sentry via fetch (recommended) — Max, AskUserQuestion D3 (eng review), 2026-10-14
Accepted scope: Minimal Sentry envelope POST with fetch from the Edge Function on every non-ok run; DSN as a function secret; payload carries run id, phase and error class only, never name or e-mail; no SDK. Run-log, Traction status and digest line (R6) unchanged.
History: —

#### E4: self-heal pass mechanism (finding 4)
Finding: 4, P2, 7/10, plan Section 4, reviewer: Claude (eng review)
Plan baseline: "one run per day (first after 03:00 Europe/Amsterdam) ignores the hashes and re-asserts every non-opted-out record" (direct consequence of R2, written by the CEO review)
Runtime evidence: Attio 25 writes/s; ~3 000 records at 250 companies [estimated]; Edge wall-clock limit [re-measure before gate]
Comparison grid:
| Commitment | Current | A Rolling re-assert + time budget | B Keep daily pass |
|---|---|---|---|
| Self-heal within a day | approved goal (R2 "zelfherstellend") | kept | kept while the pass fits |
| Mechanism | one run ignores hashes | each run also re-asserts records whose `asserted_at` is older than 24 h, oldest first, inside a fixed per-run time budget; run ends `partial` and the next run continues | first run after 03:00 re-asserts all |
| Long pass cut off | not resumed until tomorrow | resumed next hour | not resumed until tomorrow |
State: approved
Actual answer: A) Rollend + tijdsbudget (recommended) — Max, AskUserQuestion D4 (eng review), 2026-10-14
Accepted scope: crm_sync_state.asserted_at; each run writes changed records first, then records with asserted_at older than 24 h (oldest first) until a fixed per-run time budget is used; a cut-off run ends partial and the next run continues. Replaces the 03:00 full pass; goal self-heal within a day unchanged.
History: —

#### R4b: matching on e-mail (supersedes R4's match key for first contact)
Finding: Max 2026-10-15 — an Attio lead that gets invited must be updated, not duplicated; R4 (match on `plusone_user_id`) would create a second person for every manually entered lead.
Runtime evidence (live, read-only, Attio MCP on workspace `plus-one-io`, 2026-10-15): People `email_addresses` is `is_unique: true`, `is_multiselect: true`; People `company` is a single record reference (reverse: Companies `team`, multi); Companies `domains` unique; no `plusone_*` attribute exists yet; Deals has `stage` (Lead / In Progress / Won / Lost); the MCP has no tool that creates attributes.
State: approved
Actual answer: Max in chat 2026-10-15: "matchen op e-mailadres … nieuwe user aanmaken of updaten" and "Met companies lijkt me dat hetzelfde … company ook meteen koppelen. Anders … company aanmaken"; "Als dat zo is, dan zijn we game."
Accepted scope: known person/company = update by stored Attio record id (e-mail change safe); unknown person = upsert on `email_addresses` (existing lead updated + `plusone_user_id`, else created); new company = adopt the founding admin's existing Attio `company` when it has no `plusone_venue_id`, else create and set as the person's `company` when empty; multi-company links in `plusone_companies`; conflicts create nothing and count. Leavers: R3 unchanged; Max 2026-10-15: "We zullen alles verwijderen met de hand" — the sync never deletes; a hand-deleted former person or churned company is not re-created (404 drops its state row), a hand-deleted current record is re-created (use the opt-out box for current people); the rolling re-assert covers current records only. Multi-company (Max 2026-10-15): many-to-many relationship `plusone_companies` ↔ `plusone_members`, native `company` = primary pointer only (founding company, else oldest membership, never overwritten once set), `plusone_roles` per company, `former` only when no company is left.
History: R4 (match on `plusone_user_id`, Max 2026-10-14) kept as the stored-id identity; e-mail is the first-contact key.

Approval readiness (eng): PASS — E1 (D1), E2 (D2), E3 (D3), E4 (D4), each "approved" with Max's AskUserQuestion answer of 2026-10-14 cited in its record. Findings 3, 5, 6, 7, 8 are factual corrections or direct consequences of approved rows (R2/R6 lease guard, T4 guard, S3, S1, D4.1) and change no approved behaviour. No pending rows.

### Section 1 — Architecture

Scope Challenge result: scope accepted as-is (E1 = smaller arrangement, same features).

```
  pg_cron (hourly) -- crm_sync_tick() -- mint token -- pg_net POST (x-crm-sync-token) --+
                                                                                       v
  Edge Function attio-sync (verify_jwt=false)
   1 crm_sync_begin(token)  -> 42501 | {run_id} | skipped_overlap (lease row < 50 min)
   2 no ATTIO_API_KEY       -> crm_sync_finish(run, skipped_no_key)
   3 preflight attributes   -> AttioSchemaError/AttioAuthError -> finish(failed) + Sentry
   4 read opt-outs          -> fail => People phase skipped (fail closed)
   5 crm_sync_payload()     -> company_lifecycle_rows() + invite-stage twin (E2)
                               + members + crew
   6 write changed records, then asserted_at > 24 h oldest first, until time budget (E4)
   7 crm_sync_state upserts; former = state rows absent from payload
   8 crm_sync_finish(run, ok|partial|failed, counts); non-ok -> Sentry envelope (E3)
   9 return {ok:true}
```

Findings:
1. [P1] (confidence: 9/10) invite-stage gate — resolved by E2.
2. [P1] (confidence: 9/10) no Edge Function alert transport — resolved by E3.
3. [P2] (confidence: 8/10) overlap guard must be a lease row, not an advisory lock — factual correction applied (T4).
4. [P3] (confidence: 7/10) Traction reads sync status and record ids through a new platform-admin RPC (`platform_crm_sync_status()`), never a direct table SELECT, matching every other `platform_*` read — applied to T5.

Dispositions: 1 accepted (D2), 2 accepted (D3), 3 and 4 applied as corrections.

### Section 2 — Code quality

- The Sentry envelope helper lives in `supabase/functions/attio-sync/` (one caller today; the shared-code rubric needs two verified callers, so no `_shared/` extraction now).
- Payload mapping, hashing and the time-budget loop stay pure functions with injected `fetch` and clock (digest.ts pattern) so vitest covers them without Deno.
- Stage enum mapping (finding 8) lives once in SQL; the UI only maps stage keys to `en.ts` labels.

Findings: 1. [P3] (confidence: 8/10) paying/comped/churned mapping on the subscription enum (`full_schema.sql:73`) — added to T1 acceptance. No other issues found.

### Section 3 — Tests

```
CODE PATHS                                               USER FLOWS
[+] company_lifecycle_rows / platform_company_lifecycle  [+] Platform > Traction
  |-- [GAP->pgTAP] each stage + churned precedence         |-- [GAP->flow] funnel -> stage -> company card
  |-- [GAP->pgTAP] at_risk flag                            |-- [GAP->flow] empty / error states
  `-- [GAP->pgTAP] deny venue roles + anon                 `-- [GAP->flow] non-admin cannot reach
[+] invite-stage twin (E2)                               [+] Sync status (T5)
  `-- [★★★ TESTED] platform_invites + platform_overview     |-- [GAP->unit] 3 h stale rule (injected clock)
       pgTAP stay unchanged (regression contract)          `-- [GAP->flow] warning chip / never synced
[+] crm_sync_tick / begin / finish / payload
  |-- [GAP->pgTAP] token single-use, lease overlap + expiry, grants
  `-- [GAP->pgTAP] payload: members, crew, invitees, no guest columns, invitee without auth user skipped
[+] attio-sync sync.ts (mock fetch + clock)
  |-- [GAP->unit] changed-only writes; rolling asserted_at; time budget -> partial
  |-- [GAP->unit] 401/schema abort; 429 Retry-After (HTTP date); 400 skip+count; 404 re-assert
  |-- [GAP->unit] opt-out read failure -> no People writes; opt-out + deleted record stays out
  |-- [GAP->unit] Sentry envelope on non-ok run, no PII fields; Sentry down never fails the run
  `-- [GAP->E2E manual] first run against an Attio test workspace
[+] guards
  `-- [GAP->unit] api.attio.com + ATTIO_API_KEY only under supabase/functions/attio-sync (scans supabase/functions like mail-confinement)

COVERAGE: 1/17 paths tested today (the reused invite-stage contract); every other path has a planned test in T1/T2/T4/T5
```

Regression rule: the E2 refactor touches the live invite funnel; the approved contract is "existing `platform_invites.test.sql` and `platform_overview.test.sql` unchanged and green". Test plan artifact: `~/.gstack/projects/Max-Seffelaar-PlusOne/Maxse-main-eng-review-test-plan-20261014-173708.md`.

Findings: no gap left without a planned test.

### Section 4 — Performance

- Lifecycle aggregates: `check_ins (venue_id, checked_at desc)` and `audit_log (venue_id, created_at)` indexes exist; events per venue are dozens, so `events (venue_id, status)` suffices. No new index [re-measure with EXPLAIN in T1].
- Sync: ≤25 writes/s (Attio docs); steady state writes only changed rows; the rolling re-assert (E4) caps each run by the time budget. Payload is one RPC call, ~3 000 rows at 250 companies [estimated].
- No N+1: crew and memberships aggregated in SQL per person (array of company ids), not per-person queries.

Findings: No issues found.

### Outside voice (eng)

Codex CLI not installed; native fallback needs TaskOutput, not available in this session → unavailable. No outside coverage.

### Failure modes (eng additions)

| Path | Failure | Test | Handling | User sees |
|---|---|---|---|---|
| payload invite stages | gate returns 0 rows | pgTAP payload invitees present | E2 twin | n/a |
| run lease | crashed run leaves `running` | pgTAP lease expiry 50 min | next run after expiry | partial/failed row |
| time budget | Edge wall clock hit before finish | unit (injected clock) | budget below the limit, finish always called | partial, continues next hour |
| Sentry POST | Sentry down | unit | fire-and-forget, never fails the run | run-log still records |

0 critical gaps.

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| T0 legal row | docs/legal | — |
| T1 lifecycle | supabase/migrations, supabase/tests | — |
| T2 Traction UI | src/components/po, src/features/po, src/lib/i18n, tests/flows | T1 |
| T3+T4 sync PR | supabase/migrations, supabase/tests, supabase/functions, tests/unit, docs/legal, docs | T1 |
| T5 monitoring | src/components/po, supabase/functions/platform-digest | T2, T3+T4 |

Lane A: T1 → T2 → T5. Lane B: T0 (independent). Lane C: T3+T4 after T1 merges. Launch T1 + T0. Merge T1. Then T2 and T3+T4 in parallel (disjoint modules except `supabase/migrations`: pick unique timestamps). Then T5.

### Implementation Tasks (eng revision)

- [ ] **T0 (P2, human: ~30min / CC: ~5min)** — legal — Slack subprocessor row (PLU-112). Unchanged.
- [ ] **T1 (P1, human: ~1d / CC: ~1h)** — db — lifecycle function (PLU-110) + finding 8 enum mapping. Verify: `pnpm db:test`.
- [ ] **T2 (P1, human: ~2d / CC: ~2h)** — po — Platform › Traction (PLU-111); route via `routes.ts:127-142` + parse `:283-293` + `nav.push` row in `platform.tsx:214-238`. Verify: `pnpm qa:flows platform-traction`.
- [ ] **T3+T4 (P1, human: ~4d / CC: ~4h)** — db + edge — one PR (E1): data layer + E2 twin + lease guard + `attio-sync` with E3 Sentry envelope and E4 rolling budget + guard scanning `supabase/functions` + invitee-without-auth-user skip + legal text + runbook erasure line (PLU-114; PLU-113 merged into it). Verify: `pnpm db:test`, `pnpm test`, manual run on an Attio test workspace.
- [ ] **T5 (P2, human: ~3h / CC: ~20min)** — monitoring — via `platform_crm_sync_status()` RPC (PLU-115). Verify: unit 3 h rule + flow screenshot.

Task JSONL not written: `jq` not installed.

### Completion summary (eng)

- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, same features)
- Reality rows: 7/7 (see REALITY lines), 2 unverified premises (Edge wall-clock limit; every sent invite has an auth row)
- Architecture Review: 4 issues found
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 0 gaps without a planned test
- Performance Review: 0 issues found
- NOT in scope: unchanged from the CEO section
- What already exists: digest token/tick/begin pattern, digest ungated twins, digest.ts test split, mail-confinement scan of supabase/functions, platform routes
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex unavailable (not installed); native fallback unavailable
- Parallelization: 3 lanes, 2 parallel / 1 sequential
- Lake Score: N/A (no option scored 10/10)

REALITY: premise-table pass 12 claims with receipts in the eng Evidence list, unverified=2 `supabase/migrations/20261013150000_platform_digest.sql:515`
REALITY: already-done pass no CRM, lifecycle or attio code on origin/main since 2026-10-01 `supabase/migrations/20261013150000_platform_digest.sql:1`
REALITY: surface-check finding `platform_invite_stage_rows()` is gated and unusable from service_role (fixed by E2) `supabase/migrations/20260923150000_platform_invites.sql:295`
REALITY: binding-decisions pass CEO ledger rows and Max's "Sync mag direct" applied; no overruled default reintroduced `docs/designs/tractie-crm-ceo-plan.md:56`
REALITY: numbers pass 25 writes/s [measured: Attio docs]; ~3 000 records and ≥120 s pass [estimated]; wall-clock limit [re-measure before gate] `supabase/functions/platform-digest/digest.ts:262`
REALITY: deferred-asks pass PLU-69 asks all covered; nothing left out `docs/attio-crm-plan.md:1`
REALITY: pr-count pass no ship-policy; E1 cuts six PRs to five (T3+T4 merged), saving one high-risk review round `docs/designs/tractie-crm-ceo-plan.md:1`

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | CLEAR | mode: SCOPE_REDUCTION, 0 critical gaps (this plan; the earlier run on this branch reviewed the support-write-access plan) |
| Outside Review | codex (not installed) | Independent 2nd opinion | 5 | unavailable | no completed external review (codex CLI not installed; native fallback lacks TaskOutput) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | ISSUES OPEN | 5 issues, 0 critical gaps; all 5 resolved into approved tasks (E1–E4 + corrections), 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 for this plan | — | Platform › Traction needs a Paper pass before T2 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase (CEO and eng), unavailable both times (CLI not installed); no native fallback ran (TaskOutput not available). No outside findings.
- **VERDICT:** CEO CLEARED. Eng status issues_open means mapped work, not failure: every finding is resolved into an approved task, 0 unresolved, 0 critical gaps — eng review required only if the plan changes again.

NO UNRESOLVED DECISIONS
