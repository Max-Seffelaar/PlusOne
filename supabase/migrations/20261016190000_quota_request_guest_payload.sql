-- Quota-aanvraag Q (z8uq9m2xyp): the requester hears back, can name the guest
-- the extra slots are for, and that guest is on the list the moment the
-- request is approved. Decisions Max 2026-10-06 (both halves now; naming the
-- guest is optional). Slot 20261016190000, assigned by the golf-F orchestrator
-- (…120000 taken by #459, …170000 by #480, …180000 by #479 template_guest_texts).
--
-- WHAT THIS ADDS
--
--   1. quota_requests.guest_payload jsonb — optional, filed with the request:
--        { "name": text, "plus_ones": int 0..50, "tier_id": uuid,
--          "phone": text?, "note": text? }
--      Shape-checked by a CHECK (quota_guest_payload_is_valid); the tier must
--      belong to the request's event (BEFORE INSERT guard). PII: same retention
--      as guest_requests (6. below). Nobody can change it after filing: there
--      is no UPDATE grant on the column.
--   2. quota_requests.guest_id — the guest an approval created. Status choice
--      (expand-only, as the task asked): a fulfilled request is
--      status = 'approved' AND guest_id IS NOT NULL. Not a new request_status
--      value: that enum is shared with guest_requests, every TS switch over it
--      and the push/mail/audit vocabulary; a new value would be an expand that
--      the deployed app cannot read (it filters on 'pending'/'approved'/
--      'denied'). A column changes nothing for the deployed app.
--      Set only by approve_quota_request (SECURITY DEFINER).
--   3. quota_requests.seen_at — the requester's "Got it" on the Home Updates
--      card. Column UPDATE grant (seen_at only) + policy
--      quota_requests_seen_own (own, decided rows). Server-stamped.
--   4. A decline needs a visible reason, on every path (the RLS deny update,
--      a direct PATCH, an owner write): AFTER UPDATE guard, 23514, same
--      request_note_is_blank as Requests E. Transition-only, so declined rows
--      already on prod without a reason stay valid.
--   5. approve_quota_request: the #469 definition (20261016150000: row lock,
--      admin, requester still tied to the company) plus, when a payload is
--      present, ONE guest insert in the same transaction:
--        added_by = the requester, source 'app', status 'approved' — so the
--        quota engine (enforce_guest_quota, 1 + N on the requester, now with
--        the raised override), the tier max, the event capacity and the audit
--        trigger all run exactly as for a guest the requester adds by hand.
--      The list lock is evaluated for the REQUESTER (RLS does not run inside a
--      definer function, so can_write_guests' rule is applied explicitly by
--      quota_requester_guest_block): a staff-only requester on a locked or
--      auto-locked list → 45007; a requester who cannot add guests at all
--      (user_manager/finance only) or a cancelled event → 45009 with neutral
--      copy (review #494 nit). A tier that is no longer on the event → 45008.
--      Any failure rolls back the override too. The read of the current quota
--      and the override write run under the quota trigger's own advisory lock
--      for (event, requester), so two concurrent approvals for one requester
--      both count (review #494 nit; pre-existing since #469).
--      Signature and `returns void` unchanged (the deployed app ignores the
--      result), ACL re-asserted.
--   6. Retention / erasure of the payload (PII):
--        * run_quota_request_payload_retention(): nulls guest_payload on
--          requests of events past the venue's retention window (the same
--          event anchor run_privacy_retention uses for guest_requests) and
--          scrubs guest_payload out of their audit diffs. Daily 03:40 UTC via
--          pg_cron (guarded like the other schedules). The audit scrub covers
--          this run's ids plus a 7-day trailing window of expiries, so it is
--          self-healing without rescanning all history every night.
--        * a guest created from a payload that is anonymized (retention step 1
--          or forget_contact) takes the payload with it (AFTER UPDATE trigger
--          on guests.anonymized_at), audit diffs included.
--        * erasure on request (review #494, blocking): when a contact is
--          anonymized (forget_contact, or retention step 6) every payload in
--          that contact's company with the same phone digits goes too, pending,
--          declined or approved alike: AFTER UPDATE trigger on
--          contacts.anonymized_at, reading OLD.phone_norm. Phone only, the
--          same fallback key forget_contact 5b uses for guest_requests (a
--          payload has no e-mail); a name-only payload has no person key and
--          is covered by the retention window, like a name-only landing
--          request.
--
-- ROLE MATRIX (unchanged where not named): file = any member (insert_own);
-- read own = requester; read all = admin/finance of the company; decide =
-- admin (deny via RLS, approve via this RPC); seen_at = the requester only,
-- and only on a decided request.
--
-- EXPAND–CONTRACT: three nullable columns (no rewrite), a CHECK that holds for
-- every existing row (payload null), new policy + triggers, one function body
-- replaced behind an unchanged signature. The deployed app files requests
-- without a payload and declines with a reason (the decline sheet requires
-- one; Zod too), so nothing it does starts failing.

-- ---------------------------------------------------------------------------
-- 1–3. Columns
-- ---------------------------------------------------------------------------

alter table public.quota_requests
  add column guest_payload jsonb,
  add column guest_id uuid references public.guests (id) on delete restrict,
  add column seen_at timestamptz;

comment on column public.quota_requests.guest_payload is
  'z8uq9m2xyp: optional guest the extra slots are for ({name, plus_ones, tier_id, phone?, note?}). '
  'PII — nulled by run_quota_request_payload_retention after the venue retention window, '
  'and when the guest made from it is anonymized. Never updatable by a client.';
comment on column public.quota_requests.guest_id is
  'z8uq9m2xyp: the guest approve_quota_request created from guest_payload. '
  'status = approved AND guest_id IS NOT NULL = fulfilled. Set by that RPC only.';
comment on column public.quota_requests.seen_at is
  'z8uq9m2xyp: when the requester dismissed the decision on Home ("Got it" / "Add guests"). '
  'Server-stamped; only the requester, only on a decided request.';

create index quota_requests_guest_id_idx on public.quota_requests (guest_id)
  where guest_id is not null;

-- The Updates card: my decided, unseen requests.
create index quota_requests_user_unseen_idx on public.quota_requests (user_id, decided_at desc)
  where status <> 'pending' and seen_at is null;

alter table public.quota_requests
  add constraint quota_requests_guest_id_only_approved
  check (guest_id is null or status = 'approved');

-- Shape of a payload. Pure and data-free; the tier/event match needs a lookup
-- and lives in the insert guard below.
create or replace function public.quota_guest_payload_is_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     -- only known keys
     and not exists (
       select 1 from jsonb_object_keys(p) k
        where k not in ('name', 'plus_ones', 'tier_id', 'phone', 'note'))
     -- name: required, visible, at most 500 (the guests form cap)
     and jsonb_typeof(p -> 'name') = 'string'
     and char_length(p ->> 'name') between 1 and 500
     and not public.request_note_is_blank(p ->> 'name')
     -- plus_ones: whole number 0..50 (PLUS_ONES_MAX), never negative
     and jsonb_typeof(p -> 'plus_ones') = 'number'
     and (p ->> 'plus_ones') ~ '^[0-9]{1,2}$'
     and (p ->> 'plus_ones')::integer <= 50
     -- tier_id: a uuid
     and jsonb_typeof(p -> 'tier_id') = 'string'
     and (p ->> 'tier_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     -- optional text
     and (not p ? 'phone' or jsonb_typeof(p -> 'phone') = 'null'
          or (jsonb_typeof(p -> 'phone') = 'string' and char_length(p ->> 'phone') <= 40))
     and (not p ? 'note' or jsonb_typeof(p -> 'note') = 'null'
          or (jsonb_typeof(p -> 'note') = 'string' and char_length(p ->> 'note') <= 500));
$$;

comment on function public.quota_guest_payload_is_valid(jsonb) is
  'z8uq9m2xyp: true when a quota_requests.guest_payload has the documented shape.';

revoke execute on function public.quota_guest_payload_is_valid(jsonb) from public, anon, authenticated, service_role;
-- The CHECK evaluates it as the writing role (a client INSERT runs as authenticated).
grant execute on function public.quota_guest_payload_is_valid(jsonb) to authenticated, service_role;

alter table public.quota_requests
  add constraint quota_requests_guest_payload_shape
  check (guest_payload is null or public.quota_guest_payload_is_valid(guest_payload));

-- ---------------------------------------------------------------------------
-- Client write guards (INSERT and UPDATE)
-- ---------------------------------------------------------------------------
-- authenticated keeps its table-wide INSERT (the deployed app inserts four
-- columns; quota_requests_column_grant.test.sql A3 pins it), so the new
-- server-owned columns are refused here instead. On UPDATE the column grant
-- already limits a client to status/decided_by/decided_at/decision_reason/
-- seen_at; because the new seen policy is PERMISSIVE (OR'ed with
-- quota_requests_decide_admin), this guard is what keeps a requester from
-- using it to change a decision: decision columns move only off a pending row
-- and only for an admin of the event's company — exactly the decide policy.

create or replace function public.guard_quota_request_client_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Inside a SECURITY DEFINER function current_user is the owner, so
  -- approve_quota_request and the retention jobs pass.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.guest_id is not null or new.seen_at is not null then
      raise exception using errcode = '42501',
        message = 'These fields are set by the decision, not by the request.';
    end if;
    -- Only a well-formed payload is looked up: a malformed one (e.g. a tier_id
    -- that is no uuid) falls through to the shape CHECK (23514), instead of
    -- failing the cast here with 22P02 (review #494 nit).
    if new.guest_payload is not null
       and public.quota_guest_payload_is_valid(new.guest_payload)
       and not exists (
      select 1 from public.guest_tiers t
       where t.id = (new.guest_payload ->> 'tier_id')::uuid
         and t.event_id = new.event_id
    ) then
      raise exception using errcode = '23514',
        message = 'Pick a tier of this event for the guest.';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.status, new.decided_by, new.decided_at, new.decision_reason)
     is distinct from (old.status, old.decided_by, old.decided_at, old.decision_reason)
     and not (
       old.status = 'pending'
       and public.has_venue_role(public.event_venue(old.event_id), '{admin}'::public.venue_role[])
     ) then
    raise exception using errcode = '42501',
      message = 'Only an admin can decide a pending request.';
  end if;

  if new.seen_at is distinct from old.seen_at then
    if old.user_id is distinct from (select auth.uid())
       or old.status = 'pending'
       or new.seen_at is null then
      raise exception using errcode = '42501',
        message = 'Only the requester can mark a decision as seen.';
    end if;
    new.seen_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_quota_request_client_write() from public, anon, authenticated, service_role;

create trigger quota_requests_guard_client_write
  before insert or update on public.quota_requests
  for each row execute function public.guard_quota_request_client_write();

-- 3. seen_at: the requester's own decided rows, that one column.
create policy quota_requests_seen_own on public.quota_requests
  for update to authenticated
  using (user_id = (select auth.uid()) and status <> 'pending')
  with check (user_id = (select auth.uid()) and status <> 'pending');

comment on policy quota_requests_seen_own on public.quota_requests is
  'z8uq9m2xyp: the requester dismisses their own decided request (seen_at). The column grant '
  'limits the write; guard_quota_request_client_write refuses any decision-column change through '
  'this policy (it is OR''ed with quota_requests_decide_admin).';

-- Revoke first, then grant (a table-level REVOKE drops column grants of the
-- same kind): the four deny columns from 20260925140000 plus seen_at.
revoke update on table public.quota_requests from authenticated;
grant update (status, decided_by, decided_at, decision_reason, seen_at)
  on table public.quota_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A decline needs a reason, whatever path writes it
-- ---------------------------------------------------------------------------

create or replace function public.guard_quota_request_decline_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'denied'
     and old.status is distinct from 'denied'
     and public.request_note_is_blank(new.decision_reason) then
    raise exception using errcode = '23514',
      message = 'Add a reason when you decline a request.';
  end if;
  return null;
end;
$$;

revoke execute on function public.guard_quota_request_decline_reason() from public, anon, authenticated, service_role;

-- AFTER, like guard_guest_request_decision_note: RLS and the column grant
-- judge a forged write first (42501); only an otherwise allowed decline
-- without a reason fails here.
create trigger quota_requests_guard_decline_reason
  after update of status, decision_reason on public.quota_requests
  for each row execute function public.guard_quota_request_decline_reason();

-- ---------------------------------------------------------------------------
-- 5. approve_quota_request — raise the quota, add the named guest, atomically
-- ---------------------------------------------------------------------------

-- can_write_guests (20260624200000) for a given user instead of auth.uid():
-- the list-lock rule (#23) for the requester. Null = may add guests; else the
-- reason why not: 'list_locked', 'event_cancelled', 'no_guest_rights'.
-- Owner-only.
create or replace function public.quota_requester_guest_block(p_event_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select ev.id, ev.venue_id, ev.cancelled_at, ev.list_locked, ev.auto_lock_at
      from public.events ev where ev.id = p_event_id
  ),
  m as (
    select coalesce(vm.roles, '{}'::public.venue_role[]) as roles
      from e
      left join public.venue_memberships vm
        on vm.venue_id = e.venue_id and vm.user_id = p_user_id
  )
  select case
    when not exists (select 1 from e) then 'no_guest_rights'
    when (select roles from m) && '{admin}'::public.venue_role[] then null
    when (select cancelled_at from e) is not null then 'event_cancelled'
    when exists (select 1 from public.event_organizers eo
                  where eo.event_id = p_event_id and eo.user_id = p_user_id) then null
    when (select roles from m) && '{doorhost}'::public.venue_role[] then null
    when not ((select roles from m) && '{staff}'::public.venue_role[]) then 'no_guest_rights'
    when (select list_locked from e)
      or ((select auto_lock_at from e) is not null and now() >= (select auto_lock_at from e)) then 'list_locked'
    else null
  end;
$$;

comment on function public.quota_requester_guest_block(uuid, uuid) is
  'z8uq9m2xyp: can_write_guests'' rule (list lock #23, cancelled event, guest-writing role) evaluated '
  'for p_user_id. Null = may add guests, else the reason. Used by approve_quota_request, where RLS '
  'does not run. Owner-only.';

revoke execute on function public.quota_requester_guest_block(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.approve_quota_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quota_requests;
  v_venue uuid;
  v_current int;
  v_rows int;
  v_tier uuid;
  v_guest uuid;
  v_block text;
begin
  select * into v_req from public.quota_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Quota-verzoek niet gevonden.';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not public.has_venue_role(v_venue, '{admin}'::public.venue_role[]) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin mag quota-verzoeken goedkeuren.';
  end if;

  -- #469 (20261016150000): the requester must still be tied to the company.
  if not (public.is_platform_admin() or public.is_tied_to_venue(v_venue, v_req.user_id)) then
    raise exception using errcode = '42501',
      message = 'Deze aanvrager hoort niet meer bij deze company.';
  end if;

  -- New override = the requester's current effective quota + the granted extra.
  -- Same key as enforce_guest_quota (domain 1, event:adder), so it nests: two
  -- concurrent approvals for one requester serialise here and the second one
  -- reads the first one's override instead of overwriting it.
  perform pg_advisory_xact_lock(1, hashtext(v_req.event_id::text || ':' || v_req.user_id::text));
  v_current := public.user_event_quota(v_req.event_id, v_req.user_id);
  insert into public.event_quotas (event_id, user_id, quota_override)
  values (v_req.event_id, v_req.user_id, v_current + v_req.requested_extra)
  on conflict (event_id, user_id)
  do update set quota_override = excluded.quota_override;

  -- z8uq9m2xyp: the named guest, on the requester's name, in this transaction.
  if v_req.guest_payload is not null then
    v_block := public.quota_requester_guest_block(v_req.event_id, v_req.user_id);
    if v_block = 'list_locked' then
      raise exception using errcode = '45007',
        message = 'The list is locked for this person, so the guest could not be added. Nothing was changed.',
        hint = 'list_locked';
    elsif v_block is not null then
      raise exception using errcode = '45009',
        message = 'This person cannot add guests to this event, so the guest could not be added. Nothing was changed.',
        hint = v_block;
    end if;

    v_tier := (v_req.guest_payload ->> 'tier_id')::uuid;
    if not exists (
      select 1 from public.guest_tiers t where t.id = v_tier and t.event_id = v_req.event_id
    ) then
      raise exception using errcode = '45008',
        message = 'The guest''s tier is no longer on this event. Nothing was changed.',
        hint = 'tier_gone';
    end if;

    -- The ordinary guest triggers run: quota (45001, on added_by = requester,
    -- now with the raised override), tier max (45002), capacity (45005),
    -- audit 'create' (actor = the approving admin, added_by = the requester).
    insert into public.guests
      (event_id, tier_id, full_name, phone, note, plus_ones, added_by, source, status)
    values
      (v_req.event_id, v_tier,
       btrim(v_req.guest_payload ->> 'name'),
       nullif(btrim(coalesce(v_req.guest_payload ->> 'phone', '')), ''),
       nullif(btrim(coalesce(v_req.guest_payload ->> 'note', '')), ''),
       (v_req.guest_payload ->> 'plus_ones')::integer,
       v_req.user_id, 'app', 'approved')
    returning id into v_guest;
  end if;

  update public.quota_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      guest_id = v_guest
  where id = p_request_id
    and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    -- Unreachable while the row lock above holds; raising rolls back the
    -- override (and the guest) written above.
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;
end;
$$;

comment on function public.approve_quota_request(uuid) is
  'Approve a pending quota request (admin of the event''s company; requester still tied). Raises '
  'the requester''s event override by requested_extra and, when the request names a guest '
  '(z8uq9m2xyp), adds that guest on the requester''s name in the same transaction (quota 45001, '
  'tier 45002, capacity 45005, list lock 45007, tier gone 45008, cannot add guests 45009 all roll '
  'everything back).';

revoke execute on function public.approve_quota_request(uuid) from public, anon;
grant execute on function public.approve_quota_request(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Retention and erasure of the payload
-- ---------------------------------------------------------------------------

-- Scrub guest_payload out of the audit diffs of the given requests. Owner-only.
create or replace function public.redact_quota_request_payload_audit(p_request_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if p_request_ids is null or cardinality(p_request_ids) = 0 then
    return 0;
  end if;
  update public.audit_log a
     set diff = public.redact_audit_diff(a.diff, jsonb_build_object('guest_payload', 'null'::jsonb))
   where a.entity_type = 'quota_requests'
     and a.entity_id = any(p_request_ids)
     and a.diff is not null
     and (   jsonb_typeof(a.diff -> 'before' -> 'guest_payload') = 'object'
          or jsonb_typeof(a.diff -> 'after'  -> 'guest_payload') = 'object');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.redact_quota_request_payload_audit(uuid[]) from public, anon, authenticated, service_role;

-- Nightly: requests of events past the venue retention window (the event
-- anchor of run_privacy_retention step 2). Returns the payloads nulled.
create or replace function public.run_quota_request_payload_retention()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with upd as (
    update public.quota_requests q
       set guest_payload = null
      from public.events e
      join public.venues v on v.id = e.venue_id
     where e.id = q.event_id
       and q.guest_payload is not null
       and coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
    returning q.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from upd;

  -- This run's ids, plus a 7-day trailing window of expiries so a missed night
  -- heals itself, without rescanning all history every night (review #494).
  perform public.redact_quota_request_payload_audit(v_ids || array(
    select q.id
      from public.quota_requests q
      join public.events e on e.id = q.event_id
      join public.venues v on v.id = e.venue_id
     where coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
       and coalesce(e.ends_at, e.starts_at) >= now() - make_interval(months => v.retention_months) - interval '7 days'));

  return coalesce(cardinality(v_ids), 0);
end;
$$;

comment on function public.run_quota_request_payload_retention() is
  'z8uq9m2xyp: AVG retention (#29) for quota_requests.guest_payload — same event anchor and '
  'venue window as guest_requests. Nulls the payload and scrubs it from the audit diffs. Owner-only, pg_cron 03:40 UTC.';

revoke execute on function public.run_quota_request_payload_retention() from public, anon, authenticated, service_role;

-- The guest made from a payload is anonymized (retention or forget_contact):
-- the payload it came from goes too.
create or replace function public.quota_request_payload_follows_guest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with upd as (
    update public.quota_requests q
       set guest_payload = null
     where q.guest_id = new.id
       and q.guest_payload is not null
    returning q.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from upd;

  perform public.redact_quota_request_payload_audit(
    array(select q.id from public.quota_requests q where q.guest_id = new.id));
  return null;
end;
$$;

revoke execute on function public.quota_request_payload_follows_guest() from public, anon, authenticated, service_role;

create trigger guests_anonymize_quota_payload
  after update of anonymized_at on public.guests
  for each row
  when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function public.quota_request_payload_follows_guest();

-- Erasure on request (review #494, blocking). forget_contact (and retention
-- step 6) anonymize the contact row; OLD still has the phone digits. Every
-- payload in that company carrying the same digits is nulled, whatever the
-- request's status, and scrubbed from the audit diffs.
create or replace function public.quota_request_payload_follows_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if old.phone_norm is null then
    return null;
  end if;
  with upd as (
    update public.quota_requests q
       set guest_payload = null
     where q.venue_id = old.venue_id
       and q.guest_payload is not null
       and nullif(regexp_replace(coalesce(q.guest_payload ->> 'phone', ''), '[^0-9]', '', 'g'), '')
           = old.phone_norm
    returning q.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from upd;

  perform public.redact_quota_request_payload_audit(v_ids);
  return null;
end;
$$;

revoke execute on function public.quota_request_payload_follows_contact() from public, anon, authenticated, service_role;

create trigger contacts_anonymize_quota_payload
  after update of anonymized_at on public.contacts
  for each row
  when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function public.quota_request_payload_follows_contact();

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-quota-request-payload-retention',
        '40 3 * * *',
        'select public.run_quota_request_payload_retention();');
      raise notice 'pg_cron: scheduled plusone-quota-request-payload-retention (daily 03:40 UTC).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.run_quota_request_payload_retention() daily by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.run_quota_request_payload_retention() daily by other means.';
  end if;
end;
$$;
