# Security audit — Gastenlijst SaaS

**Task:** ClickUp [Claude] 4.2 — security-audit + aanvaller-tests (launchplan DEEL D).
**Date:** 2026-06-23 · **Branch:** `claude/distracted-bell-8328bd`
**Method:** every route, server action, database RPC and RLS policy walked past the
CLAUDE.md security checklist; adversarial pgTAP added under `supabase/tests/database/attacker_*.test.sql`; service-role exposure analysed statically + at the bundle level.

## Verdict

**One real vulnerability found and fixed** (quota-bypass via `source` forgery, F-1 below).
Everything else is green. The boundary holds: with the raw anon/auth key, an attacker
cannot read or write outside their memberships, cannot exceed quota, cannot mutate a
locked list, cannot tamper the audit log, cannot bypass AAL2, and cannot enumerate the
landing surface. Hard delete of guest data is impossible for every app role.

Adversarial proof: **6 new `attacker_*.test.sql` files**, full suite **583 pgTAP tests
`Result: PASS`** (28 files) with the fix applied.

> Re-run: `supabase test db` (after the new migration is applied via `supabase db reset`
> or `db push`). The fix is `supabase/migrations/20260623140200_guest_source_insert_guard.sql`.

---

## 0. Security model (recap)

- **RLS is the boundary** (decision #1). App-layer checks are convenience + clean error
  copy, never the gate. Every table has RLS enabled; `service_role` is server-only.
- All app reads/writes go through the **user-scoped** Supabase client so RLS applies.
  The **service-role** client appears in exactly 4 server-only locations (§5).
- Sensitive actions (quota grant, role change, organizer assignment, audit read,
  remote-logout) require **AAL2** — enforced in RLS via `auth.jwt()->>'aal'` and
  re-checked in self-guarding `SECURITY DEFINER` RPCs.
- Guest data is **soft-delete only**; `DELETE` is revoked at the GRANT level. The
  **audit log is written by triggers only** — no role (not even `service_role`) may
  `INSERT/UPDATE/DELETE` it.

---

## 1. Route handlers (`src/app/**/route.ts`)

There are **3** route handlers (all `GET`); every other surface is a Server Component +
Server Action. No custom REST API routes exist (the only public write path is the
landing Server Action → `submit_guest_request` RPC, §4).

| Route | Session verified | Input | AAL2 | Service-role | Status |
|---|---|---|---|---|---|
| [auth/callback/route.ts](src/app/auth/callback/route.ts) | `getUser()` server-side; bounces to `/login` if absent | `next` sanitised via `safeNextPath()` (open-redirect guard) | n/a | no | ✅ |
| [auth/confirm/route.ts](src/app/auth/confirm/route.ts) | establishes session via `verifyOtp()` server-side | `token_hash`/`type` presence-checked; `next` via `safeNextPath()` | n/a | no | ✅ |
| [auth/dev-login/route.ts](src/app/auth/dev-login/route.ts) | mints + verifies a magic link server-side | `email` required | bypassed by design (local only) | **yes, but hard-gated** | ✅ |

**dev-login hard gate** — `NODE_ENV !== 'production'` **AND** the Supabase URL is
`localhost`/`127.0.0.1`; 404s otherwise. It does not run in prod and the session it mints
is AAL1 (does not bypass MFA for real step-up). Local-dev affordance only. ✅

---

## 2. Server Actions (`src/features/**/actions.ts`)

**43 exported actions across 11 files.** Pattern (verified): each `'use server'` action
verifies the session server-side (`getUser()` / `getSessionUser()` / `getAuthContext()`),
parses input with Zod, then mutates through the **user-scoped** client so RLS + the quota
engine are the real boundary. `added_by`/`checked_by`/`refused_by` are pinned to the
session user; never accepted from the client (#27).

| File | Actions | getUser | Role/venue | AAL2 (sensitive) | Zod | Client | Status |
|---|---|---|---|---|---|---|---|
| [auth/invite-actions.ts](src/features/auth/invite-actions.ts) | invite / revoke / accept | ✅ (revoke = RLS-only) | RLS + `callerRolesAt` + escalation guard | ✅ invite | ✅ (accept = RPC) | user + **service** (account provisioning) | ✅ |
| [auth/profile-actions.ts](src/features/auth/profile-actions.ts) | updateProfile / updateEmail | ✅ | self-only (RLS #24) | — | ✅ | user | ✅ |
| [auth/session-actions.ts](src/features/auth/session-actions.ts) | revokeOwn / adminRevoke | RPC-guarded / ✅ | RPC re-checks admin-at-shared-venue | ✅ adminRevoke | ✅ | user | ✅ |
| [billing/actions.ts](src/features/billing/actions.ts) | setVenuePlan / completeOnboarding | ✅ | RPC re-checks admin | — (onboarding pre-MFA) | ✅ | user (RPC) | ✅ |
| [contacts/actions.ts](src/features/contacts/actions.ts) | upsert / togglePermanent / sync / addToEvent / import | ✅ | RLS + RPC self-guard | — | ✅ (≤2000 rows) | user | ✅ |
| [events/actions.ts](src/features/events/actions.ts) | create / update / status / landing / lock / autolock / allowUncheck / tiers / organizers | ✅ | RLS admin/organizer | ✅ assign/invite/removeOrganizer | ✅ | user + **service** (organizer provisioning) | ✅ |
| [guests/actions.ts](src/features/guests/actions.ts) | addGuest / bulk / update / changeTier / removeGuest | ✅ | RLS (membership+role+lock+quota) | — | ✅ (removeGuest = UUID regex, O-1) | user | ✅ |
| [quotas/actions.ts](src/features/quotas/actions.ts) | requestExtraSlots / decideQuotaRequest | ✅ | RLS; approve via AAL2 RPC | ✅ (RPC) | ✅ | user | ✅ |
| [quotas/default-quota-actions.ts](src/features/quotas/default-quota-actions.ts) | setDefaultQuota | ✅ | `callerRolesAt` admin | ✅ | ✅ | user | ✅ |
| [requests/actions.ts](src/features/requests/actions.ts) | submitGuestRequest (anon) / approve / deny | anon / ✅ | RPC self-guard / RLS | — | ✅ + honeypot | user (RPC) | ✅ |
| [venues/actions.ts](src/features/venues/actions.ts) | setActiveVenue / updateSettings / updateRoles / removeMember / createVenue | ✅ | `callerRolesAt` + last-admin + escalation guards | ✅ updateRoles/removeMember | ✅ | user (RPC) | ✅ |

**Exceptions / observations** (none are red lines):
- **Two documented service-role uses** — `inviteUserAction` and `inviteOrganizer` call
  `service.auth.admin.createUser()` to provision an auth identity for invite-only OTP
  login (public signups are disabled, so there is no other way to create the account).
  The subsequent `venue_memberships`/`event_organizers` insert runs through the
  **user-scoped** client so RLS (admin + AAL2 + escalation guard) re-validates. ✅
- **O-1** `removeGuest()` validates `guestId` with a `^[0-9a-f-]{36}$` regex instead of a
  Zod schema. Functionally equivalent for a soft-delete keyed on a UUID; RLS is the gate.
  *Low — cosmetic consistency only.*
- **O-2** `revokeInviteAction` / `revokeOwnSessionAction` don't call `getUser()` in app
  code; they rely on RLS (resp. the `revoke_session` RPC) which is the boundary. Adding an
  explicit `getUser()` would only improve the error copy. *Accepted — defense in depth.*

---

## 3. Database RPCs (`SECURITY DEFINER`) — the functions that run past RLS

These bypass RLS by design, so each **re-checks authorisation itself** and pins
`search_path = ''` (blocks search-path injection). Verified:

| RPC | Re-check inside | Notes |
|---|---|---|
| `submit_guest_request` (anon) | event must be `landing_active` & not closed | per-IP rate limit + silent dedup + no slug enumeration; `auto_approved` no longer leaks e-mail existence below capacity but still does at capacity, and the silent-dedup path accepts a caller-chosen status token — three open residuals (§4A) |
| `approve_guest_request` | `admin` (venue) **or** organizer (event) | atomic guest+request; tier-max still enforced; `added_by` = approver (exempt) |
| `approve_quota_request` | `admin` **and** `is_aal2()` | atomic override + request; AAL2 re-checked |
| `sync_permanent_guests_into_event` | `admin`/organizer **and** `can_write_guests` | idempotent; respects list-lock + exclusions |
| `add_contact_to_event` | `can_write_guests` | inserts `source='app'` (quota-charged normally) |
| `create_venue_with_owner` | self (first membership, onboarding #40a) | idempotent |
| `accept_pending_invites` | caller's own invites only | idempotent |

All quota/audit/maintenance helper functions are **not executable** by app roles
(`revoke execute … from public, anon, authenticated, service_role`); only
`event_quota_status`, `approve_quota_request`, `submit_guest_request`,
`sync_permanent_guests_into_event`, `add_contact_to_event` are granted to the surface
that needs them. ✅

---

## 4. RLS policies & the role matrix (the boundary)

The role matrix (spec §2) is enforced in `20260613120000_rls_policies.sql` and proven by
`rls.test.sql` (75 assertions) + the attacker suite. Highlights audited:

- **guests** — read: admin/finance/doorhost venue-wide, organizer own-event, staff own
  rows only; write: `can_write_guests()` (#23 closed→admin, locked→admin/organizer/
  doorhost, open→+staff); `added_by = auth.uid()`; **`source` constrained (F-1 fix)**;
  anonymised rows frozen.
- **check_ins / refusals** — door roles only; actor pinned; `event_id`/`venue_id`
  auto-filled by `set_checkin_scope` (offline outbox contract unchanged); refusals are
  insert-only (no UPDATE grant → immutable).
- **memberships / quotas / event_quotas / event_organizers** — write requires admin (or
  user_manager for non-admin roles) **and** `is_aal2()`; user_manager can never grant/
  modify `admin` (escalation guard).
- **audit_log** — SELECT only, admin/finance + AAL2; trigger-only writes.
- **events** — anon sees a fixed safe column subset only while `landing_active`; internal
  columns (`venue_id`, `list_locked`, …) revoked from anon.

### 4A. The one anon surface — landing requests (#12/#28)

`submit_guest_request` (SECURITY DEFINER, granted to `anon`):
- **Rate limit** — fixed window **5 requests / 15 min per IP-hash**
  (`landing_request_throttle`; tightened from 10/10 in `20260625100000`). The bucket key
  is the `p_ip_hash` **argument**, so it bounds a browser and accidental hammering — a
  direct PostgREST caller picks its own bucket and is not meaningfully throttled.
- **No slug/link enumeration** — unknown, paused, expired and deactivated links all
  return the **same** `'closed'`; which links exist, and how they are configured, never
  reaches the caller.
- **No e-mail enumeration on the auto-approve path, _below capacity_** — `auto_approved`
  reports the requester's *standing* ("you hold an approved spot"), so a fresh address, an
  already-approved one, and a repeat probe of either all answer alike. Before
  `20260918100000` (z8uq9m0gvy) `false` meant precisely "this e-mail is already
  approved on this event" — a clean yes/no oracle for whether a named person is
  attending. Proven by `landing.test.sql` E1–E9. **At capacity the oracle is open
  again, in the opposite direction** — see the residuals below; do not read this
  bullet as an unconditional close.
- **Silent dedup** — duplicate pending request swallowed; caller can't tell new from dup.
  Since `20260918140000` the status token a deduped caller gets back addresses **their own
  submission** (a `guest_request_status_mirrors` row), never the request it deduped against —
  see the residual list for the hijack that closed and the one that remains.
- **No raw PII** — the IP is SHA-256-hashed in the app before it reaches the DB.
- Raw RLS underneath: anon may only insert a **pending** request to an **active** event,
  and has no SELECT on `guest_requests` (can't read who applied).

**Known residuals** (the first two are auto-approve links only; the status-token entry
that follows them is not, and is now a FIXED entry kept for its own residual). Read this
honestly: `20260918100000`
closed the oracle in the below-capacity regime and **opened one in the at-capacity
regime**, where none existed before. It is a swap of which regime leaks, not a pure
reduction. It is still worth having — below capacity is the regime an event spends most
of its life in, and the leak there was unconditional — but the endpoint is **not** free
of e-mail enumeration:
- An e-mail whose request on the event is still **undecided** answers `false` where a
  stranger gets `true`, because that submission genuinely stays pending. Reachable when
  the person applied through a manual-review link. Closing it means auto-deciding a
  request that arrived through a *different* link, which is a workflow change rather
  than a reporting one — left for an explicit decision.
- On a link **at capacity**, an already-approved e-mail answers `true` where a stranger
  gets `false`. **Introduced by `20260918100000`**, not inherited: before it the
  `v_already` arm did not exist, so an already-approved e-mail fell through to `false`
  and matched the stranger whose insert the capacity triggers had just rejected.
  - The rationale previously recorded here — that `guests_event_contact_uidx` rejects the
    duplicate row at index time — is **false** and has been removed.
    `guests_autolink_contact` is BEFORE INSERT and leaves `contact_id` NULL on this path,
    and the index is partial (`where contact_id is not null`), so a probe insert for an
    already-approved e-mail reaches the capacity triggers and raises `45006` like any
    other. Verified live in the PR #296 review.
  - The real reason it is open is that the `v_already` arm skips the capacity verdict the
    stranger gets. Closing it does **not** require duplicating the three capacity rules:
    attempting the same insert in a subtransaction that is always rolled back reuses the
    triggers as the single source of truth. That is a real change to a SECURITY DEFINER
    function on the anon surface and is tracked as its own task.
  - **Not mitigated by one-sidedness.** An attacker establishes the regime for free with
    two throwaway addresses — two `true`s means below capacity, two `false`s means at
    capacity — after which any `true` is a definitive "this person holds an approved
    spot". A `true` is only ambiguous to an attacker who declines to spend two probes.

- ~~**The silent-dedup path accepts a caller-chosen `p_status_token_hash`**~~ (HIGH,
  pre-existing) — **FIXED by `20260918140000` (z8uq9m0h2v)**. Until then, a submission
  that deduped against an existing **pending** request rotated that row's status token to
  the hash the *caller* supplied, so an anon caller who guessed a victim's e-mail could
  point a token they chose at the victim's row, read the victim's real name and plus-ones
  out of `get_request_status`, and invalidate the victim's own status URL — an existence
  oracle, a PII disclosure and a denial of service from one unauthenticated call.
  Reproduced end-to-end over PostgREST with the anon key before the fix, and again after
  it to confirm the close.

  **What holds now.** The dedup branch never writes to the existing row. The caller's
  token hash is stored in `guest_request_status_mirrors` (`request_id` PK, `token_hash`
  unique, plus the `full_name`/`plus_ones` *that caller* submitted), and
  `get_request_status` resolves `guest_requests.status_token_hash` first and the mirror
  second — answering a mirror with the **mirror's own** identity and the request's live
  status. So the victim keeps their URL and their row, the prober reads back only what
  they themselves sent, and a deduped submission returns a **byte-identical** payload to
  a fresh one at submit time and on every read before a staff decision (asserted as a
  jsonb equality in `landing.test.sql` F11b). The table has RLS on, **no policies and no
  grants** to `anon`/`authenticated` — the two SECURITY DEFINER RPCs are its only
  readers and writers — and it is bounded to one row per pending request, so a prober
  cannot grow it. `run_privacy_retention` deletes mirrors alongside the request
  anonymization they belong to (#29).

  **Why not the two obvious fixes.** "Ignore the caller's hash on dedup" and "accept it
  only when `status_token_hash is null`" both close the disclosure and hand back a clean
  one-call enumeration oracle — my token resolves ⇒ fresh address, my token does not ⇒
  taken address — which is a *newer* and *better* oracle than the ones above, and on
  manual-review links (where `auto_approved` is constant `false`) it would be the only
  one. It is not blunted by anything else on the anon surface either: `anon` holds no
  INSERT on `guest_requests` since `20260707170000`, so the partial dedupe index is not
  reachable as a 409-vs-201 probe without a session (verified in the catalog).

  **Residual, stated rather than claimed away.** A mirror reports the deduped-against
  request's **live status**. Before a staff decision that is `pending` either way, so the
  probe itself learns nothing. *After* a decision the two can come apart: a mirror shows
  the verdict staff gave the victim's request, a fresh submission the verdict they gave
  the prober's own. An attacker who submits obvious junk and polls after the event can
  read an `approved` as evidence that the address belongs to someone who was let in.
  Delayed, dependent on a staff action the attacker cannot trigger, probabilistic, and it
  yields no name, no plus-ones and no denial of service — where the bug it replaces was
  instant, certain and gave all three. Freezing a mirror at `pending` was weighed and
  rejected: it installs the mirror image of the same signal ("still pending long after
  the event") *and* breaks the legitimate re-submitter, whose second URL would then never
  show their approval.

  **Sharpened by `20260919090000` (z8uq9m0hw6, decision #48), accepted.** Since partial
  approval, an approved request's own token also carries the confirmed plus-ones count
  and the venue address, and a mirror carries neither: the count and the venue message
  were decided for the original submitter, and the address goes only to people the
  venue said yes to (review L1, the safe default; Max can loosen it). So *after an
  approval* a mirror is recognisable as one, and the evidence above goes from probable
  to certain. Still delayed, still gated on a staff decision the prober cannot trigger,
  still no name, count, message or address of the other person. Before a decision
  nothing changed: fresh and mirrored payloads stay identical apart from each caller's
  own name and count (pinned by `partial_approval.test.sql` F10/F13/F14).

  **Second review round (fresh session, `REQUEST CHANGES`) — two defects, both fixed in
  `20260918160000`, not carried as residuals.** The reviewer rebuilt the stack from scratch,
  reproduced 59/1202 and 144/1493 exactly, got 14 assertions red on reverting the function
  body, and could not break the mirror on any of the six attack questions. What it found:

  - **F-1, a regression introduced by `20260918140000`.** `p_status_token_hash` is
    anon-controlled unbounded `text` landing in a unique btree index on both paths; past the
    ~2704-byte index-row ceiling postgres raises `54000`, and once the mirror existed the two
    paths named **different indexes** in the message (`guest_request_status_mirrors_token_idx`
    vs `guest_requests_status_token_idx`). PostgREST forwards `message`/`detail` verbatim in
    its 500 body, so that was a one-call e-mail-existence oracle — the exact class the mirror
    design was chosen to avoid. Pre-`20260918140000` both paths hit the same index, so it was
    a regression, not an inheritance. **Fixed** by capping the argument at 128 chars with the
    other argument-only guards above the throttle — the same rule `86eyke279` already applies
    to `v_email` in this function, for this same ceiling. Both paths now answer
    `{"status":"invalid"}`, verified over anon PostgREST. Note the reproduction needs
    **incompressible** input: `repeat('A', 5000)` never reaches the ceiling because pglz
    compresses it inside the index tuple, so a length test built on a repeated character
    passes vacuously; `landing.test.sql` G0–G4 use random hex and G3 asserts the two answers
    are identical.
  - **F-2, an AVG retention gap.** Step 2b deleted only the mirrors of requests *that run*
    had anonymized. But retention clears neither `status` nor `dedupe_key`, so an anonymized
    request stays `pending` with its fingerprint, keeps catching later submissions on the
    dedup branch, and those wrote a mirror carrying **the new caller's real name** onto a row
    no later sweep would revisit. Reproduced: retention run #2 reported `0 0 0 0` and the name
    survived indefinitely. Preconditions are ordinary — an event past `retention_months` whose
    landing link was never switched off, and `request_link_open()` has **no date check at
    all**. Not a disclosure (`get_request_status` refuses an anonymized request) but a
    permanent PII residue. **Fixed on both halves:** the sweep now drives off `anonymized_at`
    rather than the run's id list (self-healing, cleans orphans already written), and the
    dedup branch refuses to mirror onto an anonymized request. Pinned by G10 and G13, which
    go red independently when either half is reverted.

  **Still open — F-4, pre-existing, not introduced by either migration.** Past the retention
  window, on an event whose link is still open, the dedup path *is* oracle (a): a taken
  (anonymized) address answers `{"found": false}` where a fresh one answers `{"found": true}`.
  The reviewer confirmed the identical split before the fix, and F-2's write-side half does
  not change it — that token answered `{"found": false}` before and after, verified live. The
  structural close is to make `request_link_open()` treat a link as shut once its event is
  past the venue's retention window, which would take F-2's precondition and F-4 together;
  that is a behaviour change to the public landing surface and belongs in its own task.

  **Not changed by the fix, in either capacity regime.** On an *auto-approve* link the
  `status` a token resolves to has always separated "this e-mail already has an undecided
  pending request" (`pending`) from a stranger (`approved` below capacity), because the
  dedup path never auto-approves. That is the first residual listed above, visible in the
  very same response through `auto_approved`, and the pre-fix code leaked it identically
  (it pointed the rotated token at the same pending row). At capacity nothing separates
  them on this channel at all: every request row stays `pending`, fresh and mirrored
  alike. Verified against the live stack in both regimes.

Lock state is **not** a residual: every branch hangs off one `not v_locked` gate, so a
locked list answers `false` to every e-mail alike (proven by E8/E9).

---

## 5. Secrets — `service_role` is never in the client bundle

**Mechanism (compile-time guarantee):** `src/lib/supabase/service.ts` begins with
`import 'server-only'`. If that module is ever imported into a Client Component, the
Next.js build **fails** — this is stronger than a bundle grep. Additionally,
`SUPABASE_SERVICE_ROLE_KEY` is **not** a `NEXT_PUBLIC_*` var, so Next.js never inlines it
into client JS.

**Static analysis (repo-wide grep):** `service_role` / `createServiceClient` /
`SUPABASE_SERVICE_ROLE_KEY` appear **only** in:

| File | Server-only? |
|---|---|
| [lib/supabase/service.ts](src/lib/supabase/service.ts) | `import 'server-only'` |
| [app/auth/dev-login/route.ts](src/app/auth/dev-login/route.ts) | route handler (+ hard-gated) |
| [features/auth/invite-actions.ts](src/features/auth/invite-actions.ts) | `'use server'` |
| [features/events/actions.ts](src/features/events/actions.ts) | `'use server'` |

No `'use client'` module references any of them. ✅

**Bundle-level confirmation (command):**
```bash
pnpm build && grep -rn "SUPABASE_SERVICE_ROLE_KEY\|service_role\|sb_secret" .next/static && echo "LEAK" || echo "clean"
```
Expected: `clean` (no client chunk contains the key or `service_role`).

**Confirmed (2026-06-23):** `pnpm build` succeeded and produced **51 client JS chunks**;
the grep over `.next/static` returned **`clean`** — no `service_role`, no service-role key,
no `sb_secret_` token in any client chunk. `pnpm type-check` and `pnpm lint` both pass. ✅

---

## 6. Cross-cutting hardening (abuse · injection · IDOR · deployment)

### 6A. Abuse / rate-limiting / bots
- **Login** is passwordless OTP via Supabase GoTrue (built-in send/verify rate limits);
  **public signup disabled** → no bot account creation (invite-only, admin-gated).
- **API endpoints** — every Server Action requires a verified session + RLS; there is no
  unauthenticated mutation surface except the landing form, which is throttled (§4A) +
  honeypot (`company` field) + dedup.
- **AI generation requests** — none in the product (no LLM endpoints). n/a.
- **Scraping** — anon can only read the safe landing column-subset of an active event;
  every other table returns `42501`. No bulk public data to scrape.

### 6B. Input validation / injection
- **Validation** — all input parsed through Zod before use (42/43 actions; `removeGuest`
  uses a UUID regex, O-1). No raw `formData` passthrough, no `any`.
- **SQL injection** — data access is via supabase-js/PostgREST (parameterised) and
  `plpgsql` RPCs with `set search_path = ''` and parameterised values; **no
  string-concatenated SQL anywhere** (grep clean).
- **Command injection** — no `child_process`/`exec*` in `src` (grep clean).
- **Script / XSS injection** — no `dangerouslySetInnerHTML`, `eval`, `new Function`,
  `innerHTML` in `src` (grep clean); React escapes output by default.
- **Unsafe file upload** — the only upload is the contacts **CSV import**, parsed by a
  bounded parser ([import/parse.ts](src/features/contacts/import/parse.ts)) + Zod (≤2000
  rows) and inserted via an RPC; no file is stored or executed.

### 6C. IDOR / ownership
Every resource ID from the client is untrusted and resolved through the **user-scoped**
client, so RLS enforces ownership on read **and** write. Proven by
`attacker_cross_tenant.test.sql` (IDOR read/write of another adder's and another venue's
guest, and a cross-tenant door check-in) — all denied.

### 6D. Secure deployment
- **HTTPS** — hosted on Vercel (`fra1`), TLS enforced.
- **Secrets** — service-role key server-only (§5); never client-bundled. The active-venue
  cookie holds a **UUID only** (no PII).
- **DB access** — Postgres is reachable only via the Supabase API with keys; RLS is
  default-deny; the service-role key is confined to server code. No public direct-DB port.
- **Logging / monitoring** — domain mutations land in the **append-only audit log**
  (actor, action, before/after diff, device); errors returned to the client are **generic**
  (details to server logs only); **no PII in URLs, query strings or logs** (the IP is
  hashed before storage; cookies are UUID-only).

---

## 7. Findings

### F-1 — [HIGH, FIXED] Quota bypass via `source` forgery
**Where:** `guests` INSERT (RLS) + quota engine (`guest_personal_contribution`).
**Attack:** the anon/auth key reaches the browser, so a staffer/doorhost could
`POST /rest/v1/guests` with `source='landing'` (or `'permanent'`) and `added_by=self`.
The quota trigger treats those sources as **0 personal slots** (#31/#11), so the forged
guests never counted — unlimited free slots, defeating the DB-enforced quota (#5/#22).
The old `guests_insert` `WITH CHECK` constrained `can_write_guests` + `added_by` but
**not** `source`.

**Why it was reachable only via forgery:** the legitimate `'landing'`/`'permanent'`
producers are the `SECURITY DEFINER` RPCs `approve_guest_request` /
`sync_permanent_guests_into_event`, whose `added_by` is always the approving
admin/organizer — i.e. a quota-**exempt** user. So the `source→0` rule is only ever
load-bearing for the forge.

**Fix** (`20260623140200_guest_source_insert_guard.sql`): a direct authenticated insert
may set `source in ('landing','permanent')` **only** when the adder is quota-exempt
(venue admin / event organizer — who have no limit to bypass); non-exempt staff/doorhost
are pinned to `('app','door')`. The RPCs (owner, past RLS) and the seed (superuser) are
unaffected. The Zod `guestSource` enum is narrowed to `('app','door')` as defense in depth
([guests/schemas.ts](src/features/guests/schemas.ts)).

**Proof:** `attacker_quota_bypass.test.sql` (forge rejected `42501`, numeric limit still
`45001`, legit RPC landing + door add still work). Two existing assertions that used the
forge as a shortcut to test #31/#11 were re-pointed to the function level
(`quota.test.sql` 3.1/3.2, `permanent.test.sql` B2) — see §9.

### F-2 — [MEDIUM, FIXED] Direct approve of a landing request without a guest (L5)
**Where:** `guest_requests` UPDATE (RLS policy `guest_requests_decide` + the table grant).
**Found by:** the fresh-session review of PR #308 (18-9-2026), pre-existing.
**Attack:** an admin/organizer PATCHes `/rest/v1/guest_requests` with
`status='approved'`. The policy pinned the old row (`pending`), the actor and the role,
but not the new status, so it succeeded (UPDATE 1) with no guest created: none of the
caps (`45002`/`45005`/`45006`) ran, and `/r/[token]` told the requester they were on a
list they were not on. The table-wide UPDATE grant also let the deny path rewrite any
other column (`event_id`, `full_name`/`email`/`phone`, `status_token_hash`,
`decided_via`, `request_link_id`, `anonymized_at`). Reproduced on the local stack.

**Fix** (`20260919150000_guest_requests_decide_deny_only.sql`): the policy's `WITH CHECK`
now requires `status = 'denied'`, so the only client transition is `pending → denied`,
and `authenticated` holds UPDATE on exactly `status`, `decided_by`, `decided_at`,
`decision_reason` (what `denyGuestRequest` writes). Approval, including re-approval of a
denied request, is `approve_guest_request` only. The SECURITY DEFINER paths (approve,
auto-approve in `submit_guest_request`, retention) run as the owner and are unaffected.

**Proof:** `guest_requests_decide.test.sql` (grant set is catalog-checked; admin/organizer
direct approve, upsert-approve and extra-column denies are `42501`; staff, doorhost,
user_manager and anon change nothing; the RPC, auto-approve and retention still work).
`rls.test.sql` N3 asserted the direct approve as allowed and was re-pointed.

### Observations (low / accepted)
- **O-1** `removeGuest` uses a UUID regex, not Zod. Low (RLS is the gate).
- **O-2** `revokeInviteAction`/`revokeOwnSessionAction` lean on RLS/RPC for the session
  check. Accepted (boundary is RLS).
- **O-3** `dev-login` uses a fixed local TOTP secret + service-role, hard-gated to
  non-prod + localhost (404 in prod). Accepted (local-only).
- **O-4** the landing throttle is skipped when `p_ip_hash` is `null`. The app always sends
  a hash; a direct anon RPC call with `null` would not be rate-limited, but still needs a
  valid active slug and is dedup'd + honeypotted. *Residual — low; could default a
  per-session bucket if abuse appears.*

---

## 8. Adversarial test inventory (`supabase/tests/database/attacker_*.test.sql`)

NEW files (no existing test edited except the two #31/#11 re-points in §9):

| File | Proves |
|---|---|
| `attacker_cross_tenant.test.sql` | raw anon key blocked on every non-landing table; venue-1 token can't read/write venue-2 rows; IDOR read/write of another adder's & another venue's guest; cross-tenant door check-in denied |
| `attacker_quota_bypass.test.sql` | `source` forge (`landing`/`permanent`) rejected `42501`; numeric over-quota `45001`; forged bulk batch rejected; legit RPC-landing + door add still work |
| `attacker_list_lock.test.sql` | locked list: staff can't add/edit/**self-unlock**/forge-`added_by`; lock stays; doorhost+admin keep writing (#23) |
| `attacker_audit_aal2.test.sql` | audit log un-forgeable/un-editable/un-deletable even for admin+AAL2; AAL1 admin refused quota grant, role grant, organizer assign; AAL2 anchor works |
| `attacker_delete_outbox.test.sql` | hard-delete of guests/check_ins/refusals refused (`42501`) even for admin; soft-delete keeps the row; outbox replay can't double-check-in (`23505`); no-op replay writes no audit |
| `attacker_landing_spam.test.sql` | per-IP rate limit (6th `rate_limited`); unknown == deactivated == `'closed'` (no slug enumeration); anon can't self-approve or read requests |

**Result:** `supabase test db` → **Files=28, Tests=583, `Result: PASS`** (with the fix
applied). Each file is self-contained (own `pg_temp` login helpers) and rolls back.

---

## 9. Files changed

| File | Change |
|---|---|
| `supabase/migrations/20260623140200_guest_source_insert_guard.sql` | **new** — F-1 fix (RLS `source` guard) |
| `src/features/guests/schemas.ts` | `guestSource` enum narrowed to `('app','door')` (defense in depth) |
| `supabase/tests/database/attacker_*.test.sql` | **new** — 6 adversarial suites |
| `supabase/tests/database/quota.test.sql` | 3.1/3.2 re-pointed to test #31 at the function level (was a staff `source='landing'` forge) |
| `supabase/tests/database/permanent.test.sql` | B2 re-pointed to test #11 at the function level (was a staff `source='permanent'` forge) |
| `docs/security-audit.md` | this report |

> **Coordination note (4.1):** `quota.test.sql` and `permanent.test.sql` were edited (2
> assertions each region) because they encoded the *forge* as expected behaviour — the
> fix necessarily changes them. Flag for the 4.1 merge.

---

## 10. How to re-verify

```bash
# from the linked main checkout (not a worktree) after merge, or locally after db:fresh
supabase db reset           # applies 20260623140200 + seed
supabase test db            # expect Files=28, Tests=583, Result: PASS
```
DB-window hygiene: coordinate with parallel sessions — do not `db reset` while another is
mid-test (shared local stack).
