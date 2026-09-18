-- z8uq9m0hw6 — partial approval + a venue message on the guest status page
-- (Joeri walkthrough, decided by Max 2026-09-18; amends #43(f)).
--
-- WHAT CHANGES
--
--   1. A landing request for 1 + N people can be approved for FEWER plus-ones
--      (never more). The guest row gets the approved count; the request keeps
--      the requested count and records the approved one next to it, so the
--      difference stays visible (and auditable) after the decision.
--   2. The approver may leave an optional plain-text message. It is shown to
--      the requester on /r/[token] and nowhere else outside the venue. The
--      column name is generic (`decision_message`) so the transactional mail
--      of 86ey6bn05 can send the same text later. The DENY reason stays
--      internal, exactly as before (#43(f), Max 6-7-2026).
--   3. get_request_status returns the event's end time, and — for an APPROVED
--      request on the submitter's own token only — the venue address, the
--      approved count and the venue message.
--   4. Retention (#29) wipes the message and the deny reason from EVERY
--      anonymized request and from its audit diffs, backfilling rows the
--      pre-migration job left behind; an anonymized request can no longer be
--      approved at all.
--
-- ---------------------------------------------------------------------------
-- ACCOUNTING — every cap reads the GUEST row, which now carries the approved
-- count, so nothing downstream needed to change (checked, not assumed):
--   * event capacity 45005 — enforce_event_capacity sums
--     guest_capacity_contribution = 1 + guests.plus_ones;
--   * link-max 45006 — request_link_consumption() sums
--     link_headcount_contribution(g, …) over `guests`;
--   * tier-max 45002 is an ENTRY count (guest_tier_contribution = 1 per live
--     guest row), so a party takes one tier slot whether it is reduced or not;
--   * personal quota — source='landing' never charges the approver (#31);
--   * funnel / leaderboard / spots_left — all delegate to the same guests sum.
-- The only readers of `guest_requests.plus_ones` are this function (copying
-- it) and the status page (showing it), and both now distinguish the two.
--
-- ---------------------------------------------------------------------------
-- EXPAND–CONTRACT
-- ---------------------------------------------------------------------------
-- The deployed app calls `approve_guest_request(p_request_id, p_tier_id)`.
-- Postgres cannot `create or replace` across an arg-list change, and adding a
-- 4-arg overload NEXT TO the 2-arg one would make that exact call ambiguous:
-- PostgREST would see two candidates for the same named-argument set and fail
-- with PGRST203. So the 2-arg function is dropped and ONE function with two
-- trailing DEFAULTed params replaces it, in the same transaction — the
-- deployed call keeps resolving (both defaults → "as requested, no message"),
-- there is no instant in which neither exists, and there is never a second
-- candidate. The grants are re-stated because a drop takes them with it.
-- Two nullable columns with no default: no table rewrite. get_request_status
-- keeps its signature and every key it returned before; it only gains keys,
-- which the deployed page ignores.
--
-- ---------------------------------------------------------------------------
-- WHAT THE STATUS PAGE SHOWS PER STATE (the payload decision, #28/#43)
-- ---------------------------------------------------------------------------
--   found=false   {"found": false} — unknown, revoked, anonymized, throttled.
--                 Unchanged: no event, no venue, nothing.
--   pending       event name, start AND end time. No address, no message, no
--                 approved count (the CHECKs below make the last two
--                 impossible on a non-approved row anyway).
--   denied        same as pending. The deny reason stays internal.
--   approved      + the venue address (the person now has to get there),
--                 + `approved_plus_ones`: the count the venue confirmed for
--                   THIS request (the recorded approved count, or the
--                   requested one for an approval that predates the column /
--                   an auto-approval — both put exactly that on the guest),
--                 + `decision_message` when the approver wrote one.
-- Every found payload carries the SAME key set (absent values are JSON null),
-- so a key's presence never says anything.
--
-- The address is held back until approval on purpose. `venues.address_line`
-- is captured on Venue settings next to the company/billing fields; for a club
-- it is the street address everyone already knows, but it is not guaranteed
-- to be a public place, so it goes only to the people the venue said yes to.
--
-- Mirror tokens (z8uq9m0h2v — a silently deduped submission): a mirror answers
-- with the caller's OWN name and plus-ones and the request's live status, and
-- NOTHING the venue decided or disclosed on approval. `approved_plus_ones` and
-- `decision_message` were decided for the deduped-against request's own
-- submitter; the venue address goes only to people the venue said yes to, and
-- the mirror holder is not provably that person (review L1: the safe default,
-- Max can loosen it). The null `approved_plus_ones` is also what tells the page
-- not to claim a party size nobody confirmed for this caller (review L2).
--
-- Consequence for the oracle analysis of 20260918140000, stated rather than
-- hidden: BEFORE a staff decision fresh and mirrored payloads stay
-- byte-identical apart from each caller's own name and count (every new key is
-- null on both). AFTER an approval they come apart — a fresh token carries a
-- confirmed count (and the address, if the venue has one), a mirror carries
-- neither. The residual docs/security-audit.md §4A describes ("an `approved`
-- on a junk submission is evidence the address belongs to somebody who was
-- let in") therefore goes from probable to certain once staff approve the
-- deduped-against request. Still delayed, still needs a staff decision the
-- prober cannot trigger, still yields no name, count, message or address of
-- the other person. Accepted; recorded in §4A and in decision #48(c).

-- ---------------------------------------------------------------------------
-- 1. Columns + invariants
-- ---------------------------------------------------------------------------

alter table public.guest_requests
  add column approved_plus_ones integer,
  add column decision_message text;

comment on column public.guest_requests.approved_plus_ones is
  'Plus-ones actually approved (z8uq9m0hw6). Set by approve_guest_request on a manual approval; NULL otherwise. Never above plus_ones (the requested count), which stays as submitted.';
comment on column public.guest_requests.decision_message is
  'Optional plain-text message from the venue to the requester, shown on /r/[token] (z8uq9m0hw6). Approved requests only; nulled by the retention job. Generic name on purpose: the transactional mail (86ey6bn05) sends the same text. It is untrusted plain text: every HTML consumer (that mail included) must HTML-escape it, never interpolate it raw.';

-- Both only ever exist on an approved row. A request never leaves `approved`
-- (guest_requests_decide only matches `pending`; nothing un-approves), so these
-- hold for the row's whole life.
alter table public.guest_requests
  add constraint guest_requests_approved_plus_ones_check check (
    approved_plus_ones is null
    or (status = 'approved' and approved_plus_ones between 0 and plus_ones)
  ),
  add constraint guest_requests_decision_message_check check (
    decision_message is null
    or (
      status = 'approved'
      and char_length(decision_message) between 1 and 280
      and decision_message ~ '[^[:space:]]'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Client writes cannot touch the counts or the message
-- ---------------------------------------------------------------------------
-- `authenticated` holds a table-wide UPDATE on guest_requests (the deny path,
-- guest_requests_decide), and a table-wide grant covers columns added later.
-- Without this an admin/organizer could PATCH a message or an approved count
-- onto a row straight through PostgREST, bypassing the RPC's validation, and
-- could raise the REQUESTED count on a pending row before approving it — the
-- "never above the request" rule would then be only as strong as a number the
-- approver can rewrite (unaudited: audit_guest_requests fires on a status
-- change only).
--
-- Same shape as guard_guest_added_by_change (20260819100000): a BEFORE UPDATE
-- trigger that validates only a CHANGE, keyed on the ROLE. SECURITY INVOKER on
-- purpose — inside a SECURITY DEFINER function `current_user` is the owner, so
-- approve_guest_request / submit_guest_request / run_privacy_retention pass,
-- while every PostgREST request runs as `authenticated`/`anon` and does not.
-- Verified against the live write paths: denyGuestRequest
-- (src/features/requests/actions.ts) writes status/decided_by/decided_at/
-- decision_reason only; no other client code updates guest_requests.

create or replace function public.guard_guest_request_decision_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.plus_ones is distinct from old.plus_ones
     or new.approved_plus_ones is distinct from old.approved_plus_ones
     or new.decision_message is distinct from old.decision_message then
    raise exception using errcode = '42501',
      message = 'The requested count, the approved count and the venue message are set by the approval only.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_guest_request_decision_fields()
from public, anon, authenticated;

drop trigger if exists guest_requests_guard_decision_fields on public.guest_requests;
create trigger guest_requests_guard_decision_fields
  before update on public.guest_requests
  for each row execute function public.guard_guest_request_decision_fields();

comment on function public.guard_guest_request_decision_fields() is
  'Client writes (authenticated/anon) may not change guest_requests.plus_ones, approved_plus_ones or decision_message; only approve_guest_request (SECURITY DEFINER) sets the latter two (z8uq9m0hw6).';

-- ---------------------------------------------------------------------------
-- 3. approve_guest_request — optional approved count + message
-- ---------------------------------------------------------------------------
-- Body = 20260707170000 (G1 link lock, attribution, 45006 rollback) plus:
--   * an ANONYMIZED request is not found (P0002): its person is gone (#29),
--     and a decision written after anonymization would put a fresh message on
--     a row the retention job already treats as done;
--   * the role check runs on an UNLOCKED read; only then is the row re-read
--     FOR UPDATE and re-checked (still there, not anonymized, still on the
--     event the role was checked against, not yet approved), so an outsider
--     cannot take (or wait on) a row lock on somebody else's request. The lock serializes two approvals of
--     the same request: the second sees `approved` (45003) instead of both
--     inserting a guest (a double-submit from the sheet is the realistic way);
--   * p_plus_ones (NULL = as requested) validated 0..requested AFTER the role
--     check, so an outsider learns nothing about a request from the error;
--   * p_message trimmed with submit_guest_request's whitespace set; anything
--     the CHECK's own [:space:] test would call blank is no message; capped at
--     280. Every rule the CHECKs hold is settled here BEFORE the guest insert,
--     so a constraint never fires mid-approval (its 23514 DETAIL would echo
--     the row, contact details included, back through PostgREST).

drop function if exists public.approve_guest_request(uuid, uuid);

create or replace function public.approve_guest_request(
  p_request_id uuid,
  p_tier_id uuid,
  p_plus_ones integer default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws         constant text := E' \t\n\r\f\x0B';
  v_req      public.guest_requests;
  v_event    uuid;
  v_venue    uuid;
  v_guest_id uuid;
  v_plus     integer;
  v_message  text;
begin
  -- Unlocked read: just enough to know whose request this is.
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null or v_req.anonymized_at is not null then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  -- Authorized: now lock the row and re-check what may have changed meanwhile.
  -- That includes the event: the role check above was made against the event
  -- the unlocked read saw, so a row that moved to another event since then is
  -- a different request as far as this approval goes.
  v_event := v_req.event_id;
  select * into v_req from public.guest_requests where id = p_request_id for update;
  if v_req.id is null
     or v_req.anonymized_at is not null
     or v_req.event_id is distinct from v_event then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;
  if v_req.status = 'approved' then
    raise exception using errcode = '45003', message = 'Deze aanvraag staat al op de lijst.';
  end if;

  -- z8uq9m0hw6: approve for FEWER plus-ones, never more. NULL = as requested,
  -- which is what the 2-arg call of the deployed app resolves to.
  v_plus := coalesce(p_plus_ones, v_req.plus_ones);
  if v_plus < 0 or v_plus > v_req.plus_ones then
    raise exception using errcode = '23514',
      message = 'Approve between 0 plus-ones and the number requested.';
  end if;

  -- Plain text. Trimmed with submit_guest_request's whitespace set, and
  -- anything the CHECK's own test would call blank ([:space:] only) is no
  -- message at all. Both CHECK rules are settled here, before any insert.
  v_message := nullif(btrim(p_message, ws), '');
  if v_message !~ '[^[:space:]]' then
    v_message := null;
  end if;
  if char_length(v_message) > 280 then
    raise exception using errcode = '23514',
      message = 'Keep the message to 280 characters.';
  end if;

  if not exists (
    select 1 from public.guest_tiers gt
    where gt.id = p_tier_id and gt.event_id = v_req.event_id
  ) then
    raise exception using errcode = '23514', message = 'Kies een geldige tier voor dit event.';
  end if;

  -- G1: serialize concurrent approvals on the same link before the guest insert,
  -- exactly like the auto-approve path. The link-max (45006) trigger recomputes
  -- from committed state, so without this lock two approvers can both pass the cap.
  if v_req.request_link_id is not null then
    perform 1 from public.request_links rl where rl.id = v_req.request_link_id for update;
  end if;

  -- Create the guest with the APPROVED count and the request's link
  -- attribution. added_by = the approver (#31: source='landing' never charges
  -- their quota). Capacity (45005) and link-max (45006) sum 1 + plus_ones off
  -- this row, so they charge the approved count; tier-max (45002) counts the
  -- entry. Any of them rolls the whole approval back when it does not fit.
  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones,
     added_by, source, status, request_link_id)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_plus, (select auth.uid()), 'landing', 'approved', v_req.request_link_id)
  returning id into v_guest_id;

  -- One UPDATE with the status flip, so audit_guest_requests records the
  -- approved count and the message in the same 'approve' diff.
  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decided_via = 'manual',
      decision_reason = null,
      approved_plus_ones = v_plus,
      decision_message = v_message
  where id = p_request_id;

  return v_guest_id;
end;
$$;

revoke execute on function public.approve_guest_request(uuid, uuid, integer, text)
from public, anon, authenticated, service_role;
grant execute on function public.approve_guest_request(uuid, uuid, integer, text)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. get_request_status — end time, and on approval: address, count, message
-- ---------------------------------------------------------------------------
-- Same signature, same grants, same throttle, same two lookups. Every key it
-- returned before is still there with the same meaning; see the per-state
-- table in the header for what the new ones carry.

create or replace function public.get_request_status(p_token_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      record;
  v_approved boolean;
begin
  if p_token_hash is null
     or not public.consume_public_throttle('st:' || p_ip_hash, 15, 30) then
    return jsonb_build_object('found', false);
  end if;

  -- 1. The submitter's own row (the fresh-submission path). The confirmed
  --    count is the recorded approved one, or — for an approval that predates
  --    the column, or an auto-approval — the requested one, which is exactly
  --    what those paths put on the guest.
  select gr.full_name, gr.status, gr.plus_ones,
         coalesce(gr.approved_plus_ones, gr.plus_ones) as approved_plus_ones,
         gr.decision_message,
         e.name as event_name, e.starts_at, e.ends_at,
         v.address_line, v.postal_code, v.city
  into v_row
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  join public.venues v on v.id = e.venue_id
  where gr.status_token_hash = p_token_hash
    and gr.anonymized_at is null;

  -- 2. z8uq9m0h2v — a mirror: the token of a submission that was silently
  --    deduped against the row it points at. It answers with the name and
  --    plus-ones THAT caller submitted, never the row's own: the caller proved
  --    they know an e-mail address, which is not proof they are the person
  --    behind it. The request's live `status` is what the dedup premise does
  --    justify handing over, and is the only field taken from the row.
  --    z8uq9m0hw6: for the same reason a mirror gets nothing the venue decided
  --    or disclosed on approval — no confirmed count, no message (both decided
  --    for the row's own submitter), no venue address (it goes only to people
  --    the venue said yes to; see the header for the oracle trade-off).
  if not found then
    select m.full_name, gr.status, m.plus_ones,
           null::integer as approved_plus_ones, null::text as decision_message,
           e.name as event_name, e.starts_at, e.ends_at,
           null::text as address_line, null::text as postal_code, null::text as city
    into v_row
    from public.guest_request_status_mirrors m
    join public.guest_requests gr on gr.id = m.request_id
    join public.events e on e.id = gr.event_id
    where m.token_hash = p_token_hash
      and gr.anonymized_at is null;
  end if;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_approved := v_row.status = 'approved';

  return jsonb_build_object(
    'found', true,
    'status', v_row.status,
    'full_name', v_row.full_name,
    'plus_ones', v_row.plus_ones,
    'event_name', v_row.event_name,
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'approved_plus_ones',
      case when v_approved then v_row.approved_plus_ones end,
    'decision_message',
      case when v_approved then v_row.decision_message end,
    'venue_address_line',
      case when v_approved then nullif(btrim(v_row.address_line), '') end,
    'venue_postal_code',
      case when v_approved then nullif(btrim(v_row.postal_code), '') end,
    'venue_city',
      case when v_approved then nullif(btrim(v_row.city), '') end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. run_privacy_retention — the message is free text: it expires too (#29)
-- ---------------------------------------------------------------------------
-- Body = 20260918160000 plus:
--   * step 2 nulls `decision_message` with the rest of the request's PII;
--   * new step 2c nulls `decision_message` AND `decision_reason` on EVERY
--     anonymized request, not just this run's. Like 2b, it is driven off
--     `anonymized_at`, because the run's id list misses two real cases: rows
--     anonymized by an earlier run, and a decision written onto a request
--     AFTER it was anonymized (it stays `pending`, so the deny path still
--     matches it; approve_guest_request now refuses it);
--   * new step 4b calls redact_anonymized_request_audit_pii() (below), which
--     scrubs those two free-text fields out of the anonymized requests' own
--     approve/deny audit diffs. Step 5's anonymize entry has CLAIMED
--     `decision_reason` as redacted since 20260706101000 while the diff kept
--     it; this makes the claim true, backfilling everything the pre-migration
--     job left behind on its first run.
-- Both new steps only touch rows whose fields are still non-null, so a second
-- run changes nothing (idempotent) and reports 0 for them.

-- A sibling of redact_anonymized_audit_pii / redact_anonymized_contact_audit_pii:
-- the named, owner-only routines are the only writers on audit_log besides the
-- trigger (#29, the fase-3 hardening). Driven off anonymized_at, restricted to
-- diffs that still carry a value, so it backfills and is idempotent. At ≥25
-- venues, if the daily join shows up in pg_stat_statements, a partial index on
-- audit_log(entity_id) where entity_type = 'guest_requests' is the fix.
create or replace function public.redact_anonymized_request_audit_pii()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  update public.audit_log a
  set diff = public.redact_audit_diff(a.diff, jsonb_build_object(
    'decision_message', 'null'::jsonb,
    'decision_reason',  'null'::jsonb))
  from public.guest_requests gr
  where a.entity_type = 'guest_requests'
    and a.entity_id = gr.id
    and gr.anonymized_at is not null
    and a.diff is not null
    and (   (a.diff -> 'before' ->> 'decision_message') is not null
         or (a.diff -> 'after'  ->> 'decision_message') is not null
         or (a.diff -> 'before' ->> 'decision_reason')  is not null
         or (a.diff -> 'after'  ->> 'decision_reason')  is not null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.redact_anonymized_request_audit_pii()
from public, anon, authenticated, service_role;

comment on function public.redact_anonymized_request_audit_pii() is
  'Owner-only AVG scrub (#29, z8uq9m0hw6): nulls decision_message/decision_reason in the audit diffs of every anonymized guest request. Idempotent; called by run_privacy_retention.';

create or replace function public.run_privacy_retention()
returns table (
  guests_anonymized   integer,
  requests_anonymized integer,
  refusals_redacted   integer,
  audit_rows_redacted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest_ids   uuid[];
  v_request_ids uuid[];
  v_contact_ids uuid[];
  v_guests   integer := 0;
  v_requests integer := 0;
  v_refusals integer := 0;
  v_audit    integer := 0;
begin
  -- 1. Anonymize eligible guests (event-anchored). Stats stay invariant.
  with old_events as (
    select e.id as event_id
    from public.events e
    join public.venues v on v.id = e.venue_id
    where coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
  ),
  ranked as (
    select g.id, g.anonymized_at,
           row_number() over (partition by g.event_id order by g.created_at, g.id) as volgnr
    from public.guests g
    join old_events oe on oe.event_id = g.event_id
  ),
  upd as (
    update public.guests g
    set full_name = 'Gast #' || rk.volgnr,
        email = null,
        phone = null,
        note = null,
        anonymized_at = now()
    from ranked rk
    where g.id = rk.id
      and rk.anonymized_at is null
    returning g.id
  )
  select coalesce(array_agg(id), '{}') into v_guest_ids from upd;
  v_guests := coalesce(array_length(v_guest_ids, 1), 0);

  -- 2. Anonymize eligible landing requests + REVOKE their status tokens (F1).
  with old_events as (
    select e.id as event_id
    from public.events e
    join public.venues v on v.id = e.venue_id
    where coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
  ),
  ranked as (
    select gr.id, gr.anonymized_at,
           row_number() over (partition by gr.event_id order by gr.created_at, gr.id) as volgnr
    from public.guest_requests gr
    join old_events oe on oe.event_id = gr.event_id
  ),
  upd as (
    update public.guest_requests gr
    set full_name = 'Aanvraag #' || rk.volgnr,
        email = null,
        phone = null,
        motivation = null,
        decision_reason = null,
        decision_message = null,
        status_token_hash = null,
        anonymized_at = now()
    from ranked rk
    where gr.id = rk.id
      and rk.anonymized_at is null
    returning gr.id
  )
  select coalesce(array_agg(id), '{}') into v_request_ids from upd;
  v_requests := coalesce(array_length(v_request_ids, 1), 0);

  -- 2b. z8uq9m0h2v — drop the status-token mirrors of every ANONYMIZED request,
  --     not just the ones step 2 touched on this run. A mirror holds a name and
  --     plus-ones supplied by the caller of a deduped submission; step 2 nulls
  --     the request's own `status_token_hash`, and this is the matching
  --     revocation for the mirrored one.
  --
  --     Scoping this to `any(v_request_ids)` — what 20260918140000 shipped —
  --     left a hole the fresh-session security review of PR #300 reproduced:
  --     step 2 clears neither `status` nor `dedupe_key`, so an anonymized
  --     request stays `pending` with its fingerprint and keeps catching later
  --     submissions on the dedup branch. Those wrote a mirror carrying the new
  --     caller's real name against a request already anonymized — which this
  --     step, looking only at ids from its own run, never saw again. Retention
  --     run #2 reported `0 0 0 0` and the name survived indefinitely.
  --
  --     Driving the delete off `anonymized_at` instead of the run's id list
  --     makes the sweep self-healing: it cleans orphans written before this
  --     migration as well as any a future path manages to create.
  delete from public.guest_request_status_mirrors m
  using public.guest_requests gr
  where gr.id = m.request_id
    and gr.anonymized_at is not null;

  -- 2c. z8uq9m0hw6 — the free-text decision fields go on EVERY anonymized
  --     request, not only this run's: earlier runs, and a deny written after
  --     anonymization, are otherwise never reached again (same lesson as 2b).
  update public.guest_requests gr
  set decision_message = null,
      decision_reason = null
  where gr.anonymized_at is not null
    and (gr.decision_message is not null or gr.decision_reason is not null);

  -- 3. Redact refusal reasons of the just-anonymized guests.
  update public.refusals
  set reason = '[verwijderd na bewaartermijn]',
      anonymized_at = now()
  where guest_id = any(v_guest_ids)
    and anonymized_at is null;
  get diagnostics v_refusals = row_count;

  -- 4. Scrub the guests/refusals audit diffs + append per-guest 'anonymize'.
  v_audit := public.redact_anonymized_audit_pii(v_guest_ids);

  -- 4b. z8uq9m0hw6 — scrub the free-text decision fields (the venue message
  --     and the deny reason) out of EVERY anonymized request's own
  --     approve/deny diffs, through the named owner-only helper.
  v_audit := v_audit + public.redact_anonymized_request_audit_pii();

  -- 5. Record the request anonymizations (guest_requests aren't otherwise audited).
  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  select
    null, e.venue_id, gr.event_id, 'guest_requests', gr.id, 'anonymize',
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'anonymized_at', to_jsonb(gr.anonymized_at),
        'redacted_fields', '["full_name","email","phone","motivation","decision_reason","decision_message","status_token_hash"]'::jsonb)),
    null
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  where gr.id = any(v_request_ids);

  -- 6. Anonymize eligible address-book contacts (VENUE-anchored). A contact is
  --    eligible when it is inactive past the venue window AND no longer linked to
  --    any guest on a still-retained event. volgnr ranks over the FULL venue
  --    contact set so 'Contact #n' is stable and collision-free across runs.
  with ranked as (
    select c.id, c.venue_id, c.anonymized_at, c.updated_at,
           row_number() over (partition by c.venue_id order by c.created_at, c.id) as volgnr
    from public.contacts c
  ),
  eligible as (
    select r.id, r.volgnr
    from ranked r
    join public.venues v on v.id = r.venue_id
    where r.anonymized_at is null
      and r.updated_at < now() - make_interval(months => v.retention_months)
      and not exists (
        select 1
        from public.guests g
        join public.events e on e.id = g.event_id
        where g.contact_id = r.id
          and coalesce(e.ends_at, e.starts_at) >= now() - make_interval(months => v.retention_months)
      )
  ),
  upd as (
    update public.contacts c
    set full_name = 'Contact #' || el.volgnr,
        email = null,
        phone = null,
        birthdate = null,
        note = null,
        anonymized_at = now()
    from eligible el
    where c.id = el.id
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_contact_ids from upd;

  -- 7. Scrub the contacts audit diffs + append per-contact 'anonymize'. Counted
  --    into the audit total so the summary reflects all redacted rows.
  v_audit := v_audit + public.redact_anonymized_contact_audit_pii(v_contact_ids);

  return query select v_guests, v_requests, v_refusals, v_audit;
end;
$$;
