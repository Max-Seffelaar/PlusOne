-- Quota approval: adjust before approving (z8uq9m5kux). Max's test of the
-- golf-F train (#502, 2026-10-13): a quota request that names a guest could
-- only be approved or declined as a whole. The admin now adjusts it first, the
-- way the Requests E approve sheet already does for landing requests. Max
-- confirmed three adjustments: another tier, fewer plus-ones, fewer extra spots.
-- Round 2 (Max's test of train #507, 2026-10-14): spots and plus-ones may go UP
-- too ("could be both"), a request that names a guest always asks for enough
-- spots for that guest, and the decision mail names the guest it put on the list.
-- Slot 20261018130000 (prod is on 20261017120300; …120000 is taken by the
-- open PostHog branches, analytics_opt_out).
--
-- WHAT THIS ADDS
--
--   1. quota_requests.approved_extra / approved_tier_id / approved_plus_ones —
--      what the approval actually granted. Written only by
--      approve_quota_request (no client UPDATE grant on them, and the client
--      INSERT guard refuses them). approved_extra is set on every approval
--      from now on; the two guest columns only when the approval added the
--      named guest. NULL on rows approved before this migration ("as asked").
--      The requester's Home card and the decision mail read them, so a
--      trimmed approval never reads as the full one. Not PII (a count and a
--      tier id), so the payload retention leaves them alone. No FK on
--      approved_tier_id: it is a record of the decision, and the guest row
--      already holds the live tier reference.
--   2. approve_quota_request(p_request_id, p_extra, p_tier_id, p_plus_ones):
--      the three new arguments are optional and default to "as asked".
--        p_extra      1 .. 100 (the request form's own cap); up or down
--        p_tier_id    a tier of the request's own event; only with a guest
--        p_plus_ones  0 .. 50 (PLUS_ONES_MAX); up or down; only with a guest
--      Anything else is 22023 with a hint, after the admin check (an outsider
--      learns nothing). "As asked" always fits the guest: when p_extra is
--      left out and the request names a guest, the spots granted are
--      greatest(requested_extra, what the guest needs right now), computed
--      under the quota lock from the requester's quota and consumption at that
--      moment (they may have added guests since filing). An explicit p_extra
--      is taken as given, so a too-small explicit number still fails cleanly
--      (45001, nothing changes). Everything else is the 20261016190000 body: row lock,
--      admin, requester still tied, the override under the quota trigger's
--      advisory lock, the requester's list-lock rule, ONE guest insert through
--      the ordinary triggers (quota 45001 with the trimmed override, tier max
--      45002, capacity 45005, audit), one audited request update. Any failure
--      rolls the whole decision back.
--   3. team_mails_claim: the decision mail says the spots granted
--      (coalesce(approved_extra, requested_extra)), and when the approval put
--      the named guest on the list, that guest (first name only, the granted
--      +N and tier, and whether the admin changed anything). Body otherwise
--      identical to 20261013180600.
--   4. fit_quota_request_to_guest (BEFORE INSERT): the bug Max hit on
--      2026-10-14. The app computed requested_extra on the requester's device
--      from a cached event_quota_status; an approval made on the admin's
--      device (which raises the override AND adds a guest on the requester's
--      name) never refreshed that cache, so a second request for a +4 guest
--      went out as "+1" while the requester had 0 left. A request that names a
--      guest now asks for at least what that guest needs at filing time,
--      from database truth: requested_extra = greatest(client value,
--      1 + plus_ones - remaining). Quota-exempt requesters are left alone.
--   5. Delta review of round 2 (2026-10-14):
--        S1 requested_extra gets a database bound, 1..100 (the form's cap):
--           any older row above it is capped first, then the CHECK is
--           validated. The trigger refuses to derive more than 100, and
--           approve_quota_request refuses v_extra > 100 on every path, both
--           with a hinted 22023, so a raw 23514 never reaches the admin.
--        S2 approved_with_changes: true only when the admin's explicit
--           arguments differ from the request (tier compared as uuid). A
--           server-side fit (the trigger or the default approval granting
--           more because the requester's room shrank) is not a change. The
--           decision mail and the Home card read this flag, nothing else.
--
-- EXPAND–CONTRACT: four nullable columns (no rewrite) and CHECKs every
-- existing row meets (all null). The 1-argument approve_quota_request is
-- dropped and recreated with the new arguments defaulted (precedent
-- 20261017120300): two overloads would make PostgREST answer PGRST203, and the
-- deployed app's call {p_request_id} resolves to this function unchanged. The
-- app in this PR sends an argument only when it differs from the request, so a
-- plain approval works against either schema version. ACL re-asserted.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.quota_requests
  add column approved_extra integer,
  add column approved_tier_id uuid,
  add column approved_plus_ones integer,
  add column approved_with_changes boolean;

comment on column public.quota_requests.approved_extra is
  'z8uq9m5kux: the extra spots the approval granted (1..100; more or fewer than asked). Set by '
  'approve_quota_request only; null on rows approved before 20261018130000 (= requested_extra).';
comment on column public.quota_requests.approved_tier_id is
  'z8uq9m5kux: the tier the approval put the named guest on (may differ from the payload). '
  'Set by approve_quota_request only.';
comment on column public.quota_requests.approved_with_changes is
  'z8uq9m5kux: true when the admin explicitly changed the spots, tier or plus-ones before approving; '
  'false when approved as asked (a server-side fit is not a change). Set by approve_quota_request only.';
comment on column public.quota_requests.approved_plus_ones is
  'z8uq9m5kux: the plus-ones the approval gave the named guest (0..50; may differ from the payload). '
  'Set by approve_quota_request only.';

alter table public.quota_requests
  add constraint quota_requests_approved_extra_range
    check (approved_extra is null or approved_extra between 1 and 100),
  add constraint quota_requests_approved_plus_ones_range
    check (approved_plus_ones is null or approved_plus_ones between 0 and 50),
  add constraint quota_requests_approved_only_approved
    check ((approved_extra is null and approved_tier_id is null and approved_plus_ones is null
            and approved_with_changes is null)
           or status = 'approved'),
  add constraint quota_requests_approved_guest_pair
    check ((approved_tier_id is null) = (approved_plus_ones is null));

-- The client INSERT guard (20261016190000) refuses the new columns too. The
-- column UPDATE grant already leaves them out, so a client update is 42501.

-- S1: a database bound on what a request asks for. The app's form caps at 100
-- (QUOTA_EXTRA_MAX); only a raw API insert could exceed it. Defensive for any
-- such row already stored (prod has none): cap it first, so the CHECK can be
-- validated and a later decision on that row never trips it.
update public.quota_requests set requested_extra = 100 where requested_extra > 100;
alter table public.quota_requests
  add constraint quota_requests_requested_extra_range check (requested_extra between 1 and 100);

-- ---------------------------------------------------------------------------
-- 2. approve_quota_request — with optional adjustments
-- ---------------------------------------------------------------------------

drop function if exists public.approve_quota_request(uuid);

create function public.approve_quota_request(
  p_request_id uuid,
  p_extra integer default null,
  p_tier_id uuid default null,
  p_plus_ones integer default null
)
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
  v_extra int;
  v_tier uuid;
  v_plus int;
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

  -- z8uq9m5kux: the adjustments, checked only now (an outsider learns nothing).
  -- Up or down within sane bounds (Max 2026-10-14: "could be both").
  if p_extra is not null and (p_extra < 1 or p_extra > 100) then
    raise exception using errcode = '22023',
      message = 'Approve between 1 and 100 spots.',
      hint = 'extra_out_of_range';
  end if;
  v_extra := coalesce(p_extra, v_req.requested_extra);
  if v_extra > 100 then
    raise exception using errcode = '22023',
      message = 'Approve between 1 and 100 spots.',
      hint = 'extra_out_of_range';
  end if;

  if v_req.guest_payload is null and (p_tier_id is not null or p_plus_ones is not null) then
    raise exception using errcode = '22023',
      message = 'This request names no guest to adjust.',
      hint = 'no_guest';
  end if;

  if v_req.guest_payload is not null then
    v_tier := coalesce(p_tier_id, (v_req.guest_payload ->> 'tier_id')::uuid);
    v_plus := coalesce(p_plus_ones, (v_req.guest_payload ->> 'plus_ones')::integer);
    if v_plus < 0 or v_plus > 50 then
      raise exception using errcode = '22023',
        message = 'Plus-ones go from 0 to 50.',
        hint = 'plus_ones_out_of_range';
    end if;
    -- A chosen tier must be on this event (so: this company). The payload's
    -- own tier that has gone since keeps its own code (45008) below.
    if p_tier_id is not null and not exists (
      select 1 from public.guest_tiers t where t.id = p_tier_id and t.event_id = v_req.event_id
    ) then
      raise exception using errcode = '22023',
        message = 'Pick a tier of this event.',
        hint = 'tier_not_on_event';
    end if;
  end if;

  -- New override = the requester's current effective quota + the granted extra.
  -- Same key as enforce_guest_quota (domain 1, event:adder), so it nests: two
  -- concurrent approvals for one requester serialise here and the second one
  -- reads the first one's override instead of overwriting it.
  perform pg_advisory_xact_lock(1, hashtext(v_req.event_id::text || ':' || v_req.user_id::text));
  v_current := public.user_event_quota(v_req.event_id, v_req.user_id);
  -- "As asked" always fits the named guest (Max 2026-10-14): with no explicit
  -- p_extra, grant at least what the guest needs now, read under this lock.
  if p_extra is null
     and v_req.guest_payload is not null
     and not public.user_is_quota_exempt(v_req.event_id, v_req.user_id) then
    v_extra := greatest(
      v_extra,
      1 + v_plus - (v_current - public.user_event_consumption(v_req.event_id, v_req.user_id)));
    if v_extra > 100 then
      raise exception using errcode = '22023',
        message = 'Approve between 1 and 100 spots.',
        hint = 'extra_out_of_range';
    end if;
  end if;
  insert into public.event_quotas (event_id, user_id, quota_override)
  values (v_req.event_id, v_req.user_id, v_current + v_extra)
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
       v_plus,
       v_req.user_id, 'app', 'approved')
    returning id into v_guest;
  end if;

  -- One audited update: what was granted travels in the diff.
  update public.quota_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      guest_id = v_guest,
      approved_extra = v_extra,
      approved_tier_id = case when v_guest is not null then v_tier end,
      approved_plus_ones = case when v_guest is not null then v_plus end,
      -- S2: only what the admin explicitly changed counts as a change; a
      -- server-side fit of the spots (above) does not. Tier as uuid.
      approved_with_changes =
           (p_extra is not null and p_extra <> v_req.requested_extra)
        or (v_req.guest_payload is not null and p_tier_id is not null
            and p_tier_id <> (v_req.guest_payload ->> 'tier_id')::uuid)
        or (v_req.guest_payload is not null and p_plus_ones is not null
            and p_plus_ones <> (v_req.guest_payload ->> 'plus_ones')::integer)
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

comment on function public.approve_quota_request(uuid, integer, uuid, integer) is
  'Approve a pending quota request (admin of the event''s company; requester still tied). Raises '
  'the requester''s event override by p_extra (1..100; default requested_extra, raised to what the named '
  'guest needs) and, when the '
  'request names a guest (z8uq9m2xyp), adds that guest on the requester''s name in the same '
  'transaction, optionally on another tier of the event (p_tier_id) and with other plus-ones '
  '(p_plus_ones 0..50) (z8uq9m5kux). Bad adjustments 22023; quota 45001, tier 45002, capacity '
  '45005, list lock 45007, tier gone 45008, cannot add guests 45009 all roll everything back.';

revoke execute on function public.approve_quota_request(uuid, integer, uuid, integer) from public, anon;
grant execute on function public.approve_quota_request(uuid, integer, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Client INSERT guard: also refuses the approved_* columns (body of
-- 20261016190000 otherwise unchanged).
-- ---------------------------------------------------------------------------

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
    if new.guest_id is not null or new.seen_at is not null
       -- z8uq9m5kux: what the decision approved is the decision's to write.
       or new.approved_extra is not null
       or new.approved_tier_id is not null
       or new.approved_plus_ones is not null
       or new.approved_with_changes is not null then
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

-- ---------------------------------------------------------------------------
-- 4. A request that names a guest asks for enough spots (BEFORE INSERT)
-- ---------------------------------------------------------------------------
-- The bug of 2026-10-14: requested_extra came from the requester's cached
-- event_quota_status. An approval made on another device raised their quota
-- and put a guest on their name without refreshing that cache, so the next
-- request asked for "+1" for a +4 guest while 0 spots were left, and the
-- approval then failed (45001). The count the guest needs is now taken from
-- database truth whatever the client sends: at least 1 + plus_ones minus what
-- the requester has left on that event right now. Only up, never down (the
-- requester may ask for more than strictly needed). SECURITY DEFINER so it
-- can call the quota helpers whatever their grants are; it reads only the
-- inserting row's own (event, user) numbers and writes only NEW.requested_extra
-- (the INSERT policy already pins user_id to the caller).

create or replace function public.fit_quota_request_to_guest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  -- A malformed payload falls through to the shape CHECK (23514); only a
  -- pending request is filed by a client.
  -- N1: user_is_quota_exempt's platform-admin branch keys on auth.uid() =
  -- the user, so a non-member platform admin filing their own request is
  -- exempt here (they file it themselves) but not at approval, where
  -- auth.uid() is the approving admin. Same behaviour as enforce_guest_quota;
  -- the admin-membership branch agrees at both points.
  if new.guest_payload is null
     or new.status is distinct from 'pending'
     or not public.quota_guest_payload_is_valid(new.guest_payload)
     or public.user_is_quota_exempt(new.event_id, new.user_id) then
    return new;
  end if;
  v_remaining := public.user_event_quota(new.event_id, new.user_id)
               - public.user_event_consumption(new.event_id, new.user_id);
  new.requested_extra := greatest(
    new.requested_extra,
    1 + (new.guest_payload ->> 'plus_ones')::integer - v_remaining);
  -- S1: never derive past the 1..100 bound (only reachable when the
  -- requester is far over their quota already); say so instead of a raw CHECK.
  if new.requested_extra > 100 then
    raise exception using errcode = '22023',
      message = 'A request asks for at most 100 spots.',
      hint = 'extra_out_of_range';
  end if;
  return new;
end;
$$;

comment on function public.fit_quota_request_to_guest() is
  'z8uq9m5kux: BEFORE INSERT on quota_requests. A request that names a guest asks for at least '
  '1 + plus_ones minus what the requester has left on the event, from database truth (the client '
  'value came from a cache that an approval on another device made stale).';

revoke execute on function public.fit_quota_request_to_guest() from public, anon, authenticated, service_role;

-- Name sorts before quota_requests_guard_client_write: both are BEFORE INSERT
-- and the guard only refuses server-owned columns, so the order is immaterial.
create trigger quota_requests_fit_guest
  before insert on public.quota_requests
  for each row execute function public.fit_quota_request_to_guest();

-- ---------------------------------------------------------------------------
-- 3. team_mails_claim — the decision mail says the spots granted (body of
-- 20261013180600 otherwise unchanged; grants and comment carry over).
-- ---------------------------------------------------------------------------

create or replace function public.team_mails_claim(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 0), 500);
  v_mails jsonb := '[]'::jsonb;
  v_g record;
  v_rep record;
  v_user record;
  v_ids uuid[];
  v_ok uuid[];
  v_type text;
  v_pref text;
  v_skip text;
  v_count integer;
  v_events integer;
  v_log uuid;
  v_token text;
  v_extra jsonb;
  v_event jsonb;
  v_company jsonb;
  v_local timestamp := now() at time zone 'Europe/Amsterdam';
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_digest jsonb;
  v_du uuid;
  -- Daily budgets (UTC day), the guest-mail pattern: over budget, rows wait.
  v_global_left integer := public.team_mail_daily_cap() - public.team_mail_sent_today(null);
  v_venue_left jsonb := '{}'::jsonb;
  v_left integer;
  v_full uuid[] := public.team_mail_full_venues();
begin
  -- A row left 'sending' (the job died after the provider call, or before
  -- settle): unknown outcome, never re-sent.
  update public.notification_outbox o
     set status = 'failed', last_error = 'unknown_outcome', locked_at = null
   where o.channel = 'email' and o.status = 'sending'
     and o.locked_at < now() - interval '15 minutes';

  if v_limit = 0 then
    return jsonb_build_object('now', now(), 'mails', '[]'::jsonb);
  end if;

  for v_g in
    -- Fair over companies (review #458 S4, the guest_mails_claim pattern): a
    -- company over budget is left out, and no company fills the window with
    -- more than 100 rows, so one busy company never holds up the others.
    with ranked as (
      select o.id,
             row_number() over (partition by o.venue_id order by o.next_attempt_at, o.id) as rn
        from public.notification_outbox o
       where o.channel = 'email' and o.status = 'pending' and o.next_attempt_at <= now()
         and not (o.venue_id = any (v_full))
    ), due as (
      select o.id, o.collapse_key, o.recipient_user_id, o.venue_id, o.next_attempt_at
        from public.notification_outbox o
        join ranked r on r.id = o.id
       where r.rn <= 100
       order by o.next_attempt_at
       limit v_limit
       for update of o skip locked
    )
    select coalesce(d.collapse_key, d.id::text) as grp, d.recipient_user_id, d.venue_id,
           min(d.next_attempt_at) as first_due
      from due d
     group by 1, 2, 3
     order by 4
  loop
    exit when v_global_left <= 0;

    -- Per-company budget, computed once per company per run.
    if not v_venue_left ? v_g.venue_id::text then
      v_venue_left := v_venue_left || jsonb_build_object(
        v_g.venue_id::text,
        public.team_mail_venue_daily_cap() - public.team_mail_sent_today(v_g.venue_id));
    end if;
    v_left := (v_venue_left ->> v_g.venue_id::text)::int;
    if v_left <= 0 then
      continue; -- stays pending until tomorrow (or is skipped once decided)
    end if;

    -- Every due member of this group (a slot is never split), claimed.
    with m as (
      select o.id
        from public.notification_outbox o
       where o.channel = 'email' and o.status = 'pending' and o.next_attempt_at <= now()
         and o.recipient_user_id = v_g.recipient_user_id
         and (o.id::text = v_g.grp or o.collapse_key = v_g.grp)
       for update skip locked
    ), upd as (
      update public.notification_outbox o
         set status = 'sending', attempts = o.attempts + 1, locked_at = now()
       where o.id in (select m.id from m)
      returning o.id
    )
    select array_agg(upd.id order by upd.id) into v_ids from upd;
    if v_ids is null then
      continue;
    end if;

    select o.kind, o.venue_id into v_rep
      from public.notification_outbox o
     where o.id = v_ids[array_length(v_ids, 1)];

    select p.id, p.email, p.first_name, p.full_name,
           public.notification_prefs_effective(coalesce(n.notification_prefs, '{}'::jsonb)) as prefs
      into v_user
      from public.user_profiles p
      left join public.user_notification_prefs n on n.user_id = p.id
     where p.id = v_g.recipient_user_id;

    v_type := case v_rep.kind
                when 'guest_request_created' then 'team_request'
                when 'quota_request_created' then 'team_quota'
                else 'team_decision' end;
    v_pref := case v_rep.kind
                when 'guest_request_created' then 'requests'
                when 'quota_request_created' then 'quota'
                else 'decisions' end;
    v_skip := null;

    if v_user.id is null or v_user.email is null then
      v_skip := 'no_address';
    elsif v_pref in ('requests', 'quota') and v_user.prefs -> v_pref ->> 'email' <> 'immediate' then
      v_skip := 'pref_off';
    elsif v_pref = 'decisions' and not (v_user.prefs -> 'decisions' ->> 'email')::boolean then
      v_skip := 'pref_off';
    end if;
    if v_skip is not null then
      update public.notification_outbox o
         set status = 'skipped', last_error = v_skip, locked_at = null
       where o.id = any (v_ids);
      continue;
    end if;

    -- Access, per member, at send time (review #458 B1/S3): guest requests
    -- for an admin of the company or the organizer of THAT member's event;
    -- quota requests for an admin; a decision for someone still in the
    -- company (a member, or crew on the request's event). A member the
    -- recipient lost access to is skipped on its own; the rest still go.
    select array_agg(o.id order by o.id) into v_ok
      from public.notification_outbox o
     where o.id = any (v_ids)
       and case v_pref
             when 'requests' then
               exists (select 1 from public.venue_memberships m
                        where m.venue_id = o.venue_id and m.user_id = v_user.id
                          and m.roles @> '{admin}'::public.venue_role[])
               or exists (select 1 from public.event_organizers eo
                           where eo.event_id = (o.payload ->> 'event_id')::uuid and eo.user_id = v_user.id)
             when 'quota' then
               exists (select 1 from public.venue_memberships m
                        where m.venue_id = o.venue_id and m.user_id = v_user.id
                          and m.roles @> '{admin}'::public.venue_role[])
             else
               exists (select 1 from public.venue_memberships m
                        where m.venue_id = o.venue_id and m.user_id = v_user.id)
               or exists (select 1 from public.event_organizers eo
                           where eo.event_id = (o.payload ->> 'event_id')::uuid and eo.user_id = v_user.id)
           end;
    update public.notification_outbox o
       set status = 'skipped', last_error = 'no_access', locked_at = null
     where o.id = any (v_ids) and not (o.id = any (coalesce(v_ok, '{}'::uuid[])));
    if v_ok is null then
      continue;
    end if;
    v_ids := v_ok;

    -- How many of the group's requests are still open, over how many events
    -- (a single mail about a request decided in the meantime is pointless).
    if v_pref = 'requests' then
      select count(*)::int, count(distinct r.event_id)::int into v_count, v_events
        from public.notification_outbox o
        join public.guest_requests r on r.id = o.source_id
       where o.id = any (v_ids) and r.status = 'pending';
    elsif v_pref = 'quota' then
      select count(*)::int, count(distinct q.event_id)::int into v_count, v_events
        from public.notification_outbox o
        join public.quota_requests q on q.id = o.source_id
       where o.id = any (v_ids) and q.status = 'pending';
    else
      v_count := array_length(v_ids, 1);
      v_events := 1;
    end if;
    if v_count = 0 then
      update public.notification_outbox o
         set status = 'skipped', last_error = 'already_decided', locked_at = null
       where o.id = any (v_ids);
      continue;
    end if;

    -- The newest member the recipient may still see speaks for the group.
    select o.kind, o.venue_id, o.source_id, o.payload into v_rep
      from public.notification_outbox o
     where o.id = v_ids[array_length(v_ids, 1)];

    select jsonb_build_object('id', v.id, 'name', v.name) into v_company
      from public.venues v where v.id = v_rep.venue_id;
    -- A bundle over more than one event names none (review #458 S3): the
    -- mail says the company and the button opens all requests.
    v_event := null;
    if v_events = 1 then
      select jsonb_build_object('id', e.id, 'name', e.name, 'starts_at', e.starts_at)
        into v_event
        from public.events e
       where e.id = (v_rep.payload ->> 'event_id')::uuid;
    end if;

    v_extra := '{}'::jsonb;
    if v_pref = 'requests' and v_count = 1 then
      select jsonb_build_object('request', jsonb_build_object(
               'first_name', nullif(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), ''),
               'plus_ones', r.plus_ones))
        into v_extra
        from public.notification_outbox o
        join public.guest_requests r on r.id = o.source_id
       where o.id = any (v_ids) and r.status = 'pending'
       limit 1;
    elsif v_pref = 'quota' then
      select jsonb_build_object('quota', jsonb_build_object(
               'requester', coalesce(nullif(btrim(coalesce(up.full_name, '')), ''), 'A team member'),
               'extra', q.requested_extra))
        into v_extra
        from public.quota_requests q
        left join public.user_profiles up on up.id = q.user_id
       where q.id = v_rep.source_id;
    elsif v_pref = 'decisions' then
      -- z8uq9m5kux: the spots actually granted (a trimmed approval), else
      -- what was asked (a decline, or a row approved before this migration).
      -- When the approval put the named guest on the list, say so (Max
      -- 2026-10-14): first name only (the rule of these mails), the granted
      -- +N and tier, and whether the admin changed anything.
      select jsonb_build_object('decision', jsonb_build_object(
               'status', q.status, 'extra', coalesce(q.approved_extra, q.requested_extra))
             || case when q.status = 'approved' and g.id is not null then
                  jsonb_build_object('guest', jsonb_build_object(
                    'first_name', nullif(split_part(btrim(coalesce(g.full_name, '')), ' ', 1), ''),
                    'plus_ones', g.plus_ones,
                    'tier', t.name,
                    -- S2: the admin's explicit change only, never a server-side fit.
                    'changed', coalesce(q.approved_with_changes, false)))
                else '{}'::jsonb end)
        into v_extra
        from public.quota_requests q
        left join public.guests g on g.id = q.guest_id and g.anonymized_at is null
        left join public.guest_tiers t on t.id = g.tier_id
       where q.id = v_rep.source_id;
    end if;

    insert into public.mail_log (type, venue_id, recipient_hash)
    values (v_type, v_rep.venue_id,
            encode(extensions.digest(lower(btrim(v_user.email)), 'sha256'), 'hex'))
    returning id into v_log;
    v_global_left := v_global_left - 1;
    v_venue_left := jsonb_set(v_venue_left, array[v_g.venue_id::text], to_jsonb(v_left - 1));

    v_token := public.guest_mail_new_token();
    insert into public.team_mail_links (token_hash, user_id, pref, mail_log_id, expires_at)
    values (public.guest_mail_token_hash(v_token), v_user.id, v_pref, v_log, now() + interval '180 days');

    v_mails := v_mails || jsonb_build_array(jsonb_build_object(
      'queue_ids', to_jsonb(v_ids),
      'mail_log_id', v_log,
      'type', v_type,
      'to', v_user.email,
      'first_name', nullif(btrim(coalesce(v_user.first_name,
                      split_part(btrim(coalesce(v_user.full_name, '')), ' ', 1))), ''),
      'link', jsonb_build_object('token', v_token, 'pref', v_pref),
      'company', v_company,
      'event', v_event,
      'count', v_count) || coalesce(v_extra, '{}'::jsonb));
  end loop;

  -- The daily summary: 09:00 to 11:59 Amsterdam, once per user per day,
  -- within the global budget (a summary has no company).
  if v_local::time >= time '09:00' and v_local::time < time '12:00' then
    for v_du in select d.user_id from public.team_digest_due(v_today, v_limit) d
    loop
      exit when v_global_left <= 0;
      insert into public.team_digest_deliveries (user_id, local_date)
      values (v_du, v_today)
      on conflict do nothing;
      if not found then
        continue;
      end if;

      select p.id, p.email, p.first_name, p.full_name into v_user
        from public.user_profiles p where p.id = v_du;
      v_digest := public.team_digest_items(v_du);
      if v_user.email is null or jsonb_array_length(v_digest) = 0 then
        continue;
      end if;

      insert into public.mail_log (type, venue_id, recipient_hash)
      values ('team_digest', null, encode(extensions.digest(lower(btrim(v_user.email)), 'sha256'), 'hex'))
      returning id into v_log;
      v_global_left := v_global_left - 1;
      update public.team_digest_deliveries d set mail_log_id = v_log
       where d.user_id = v_du and d.local_date = v_today;

      v_token := public.guest_mail_new_token();
      insert into public.team_mail_links (token_hash, user_id, pref, mail_log_id, expires_at)
      values (public.guest_mail_token_hash(v_token), v_du, 'digest', v_log, now() + interval '180 days');

      v_mails := v_mails || jsonb_build_array(jsonb_build_object(
        'queue_ids', '[]'::jsonb,
        'mail_log_id', v_log,
        'type', 'team_digest',
        'to', v_user.email,
        'first_name', nullif(btrim(coalesce(v_user.first_name,
                        split_part(btrim(coalesce(v_user.full_name, '')), ' ', 1))), ''),
        'link', jsonb_build_object('token', v_token, 'pref', 'digest'),
        'local_date', v_today,
        'digest', v_digest));
    end loop;
  end if;

  return jsonb_build_object('now', now(), 'mails', v_mails);
end;
$$;

