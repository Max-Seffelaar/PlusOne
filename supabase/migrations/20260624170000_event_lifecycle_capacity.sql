-- Feedback (Joeri/Max, 24 jun 2026) — Event lifecycle simplification + capacity rule.
--
-- The manual status machine (draft/open/live/closed) is being removed from the
-- app: the phase a user sees (Upcoming/Live/Past) is now derived purely from the
-- event's start/end time (in TS, src/features/po/event-phase.ts), and the one
-- explicit state worth keeping — "cancelled" — gets its own column. The status
-- enum column itself is LEFT IN PLACE (vestigial) so we avoid a destructive drop
-- and keep the stats RPCs that still SELECT it working; nothing in the app
-- advances or displays it anymore.
--
-- This forces a deliberate change to the #22 anti-fraud quota rule, confirmed by
-- Max: removing/rejecting a guest now FREES their slot, UNLESS the guest is
-- already physically inside (a non-voided check-in). That decouples the quota
-- engine from events.went_live_at / status='live' (which would otherwise never be
-- stamped once the status machine is gone), and is the intuitive rule: you can't
-- reclaim a slot from someone who is already in the room.
--   * Spec decision #22 is amended accordingly (gastenlijst-app-spec.md).
--   * "inside" = EXISTS a non-voided check_ins row for the guest. This is robust
--     even when a checked-in guest is later set to status='removed' (the row in
--     check_ins is what keeps them counting), and a voided/absent check-in frees.
--
-- DB rules repointed off `status` onto `cancelled_at`:
--   * can_write_guests : a cancelled event is admin-only (was: status='closed').
--   * can_check_in     : check-in allowed unless cancelled (was: status in
--                        open/live) — with the status machine gone, time no longer
--                        maps to a status, and the door must keep working.
--   * events_select_landing / submit_guest_request : a cancelled event stops
--                        taking public requests (was: status<>'closed').

-- ---------------------------------------------------------------------------
-- 1. Cancel state
-- ---------------------------------------------------------------------------

alter table public.events
  add column cancelled_at timestamptz;

comment on column public.events.cancelled_at is
  'When set, the event is cancelled: admin-only writes, no check-in, no public requests. Replaces the status=closed semantics after the status machine was retired (24 jun 2026).';

-- ---------------------------------------------------------------------------
-- 2. Capacity rule — "free on removal/reject, unless already inside"
-- ---------------------------------------------------------------------------
-- New signature: the per-row helper takes whether the guest is physically inside
-- (a non-voided check-in) instead of the event's go-live instant. The caller
-- computes it; the helper stays IMMUTABLE + pure so it remains unit-testable.
-- Preserves the #31/#11 source exemption ('landing','permanent' never charge a
-- personal quota).

create or replace function public.guest_personal_contribution(g public.guests, p_is_inside boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when g.source in ('landing', 'permanent') then 0   -- #31 + #11: outside personal quota
    -- On the list / expected / inside → holds the slot.
    when g.status in ('pending', 'approved', 'checked_in') then 1 + g.plus_ones
    -- removed / denied / refused: frees the slot UNLESS physically inside
    -- (a non-voided check-in) — anti-fraud, you can't reclaim a slot from
    -- someone already in the room (#22, amended 24 jun 2026).
    when p_is_inside then 1 + g.plus_ones
    else 0
  end;
$$;

-- Total personal consumption for one (event, adder). Computes "inside" per guest
-- from a non-voided check-in and feeds it to the pure helper. (No longer needs the
-- events.went_live_at join.)
create or replace function public.user_event_consumption(p_event_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    public.guest_personal_contribution(
      g,
      exists (
        select 1 from public.check_ins ci
        where ci.guest_id = g.id and ci.voided_at is null
      )
    )
  ), 0)::int
  from public.guests g
  where g.event_id = p_event_id
    and g.added_by = p_user_id;
$$;

-- Enforcement trigger (AFTER ROW): unchanged shape from 20260615140000 except the
-- personal-quota contribution now keys off "is the guest inside" instead of the
-- event go-live instant. Computed once (old and new are the same guest id, so the
-- check-in state is identical for both). Tier-max logic is untouched.
create or replace function public.enforce_guest_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_inside boolean;
  v_old_personal int := 0;
  v_new_personal int := 0;
  v_quota int;
  v_consumed int;
  v_tier_max int;
  v_old_tier int := 0;
  v_new_tier int := 0;
  v_tier_count int;
begin
  v_is_inside := exists (
    select 1 from public.check_ins ci
    where ci.guest_id = new.id and ci.voided_at is null
  );

  -- ---- personal quota (non-exempt adders only; landing/permanent never count) ----
  if new.source not in ('landing', 'permanent')
     and not public.user_is_quota_exempt(new.event_id, new.added_by) then

    v_new_personal := public.guest_personal_contribution(new, v_is_inside);
    if tg_op = 'UPDATE'
       and old.added_by = new.added_by
       and old.event_id = new.event_id then
      v_old_personal := public.guest_personal_contribution(old, v_is_inside);
    end if;

    -- Only a net increase can breach the limit.
    if v_new_personal > v_old_personal then
      v_quota := public.user_event_quota(new.event_id, new.added_by);
      v_consumed := public.user_event_consumption(new.event_id, new.added_by);
      if v_consumed > v_quota then
        raise exception using
          errcode = '45001',
          message = format(
            'Quotum overschreden: dit zou %s van %s plekken gebruiken voor dit event.',
            v_consumed, v_quota),
          hint = format('quota_exceeded;consumed=%s;quota=%s', v_consumed, v_quota);
      end if;
    end if;
  end if;

  -- ---- tier max (entry count; landing/permanent included, removed/denied excluded) ----
  select gt.max_guests into v_tier_max
  from public.guest_tiers gt where gt.id = new.tier_id;

  if v_tier_max is not null then
    v_new_tier := public.guest_tier_contribution(new);
    if tg_op = 'UPDATE' and old.tier_id = new.tier_id then
      v_old_tier := public.guest_tier_contribution(old);
    end if;

    if v_new_tier > v_old_tier then
      v_tier_count := public.tier_consumption(new.tier_id);
      if v_tier_count > v_tier_max then
        raise exception using
          errcode = '45002',
          message = format('Tier zit vol: %s van %s plekken bezet.', v_tier_count, v_tier_max),
          hint = format('tier_full;occupied=%s;max=%s', v_tier_count, v_tier_max);
      end if;
    end if;
  end if;

  return null;
end;
$$;

-- The old (guests, timestamptz) overload is now unreferenced (both callers above
-- were recreated to use the boolean overload) — drop it so the name resolves to
-- exactly one signature.
drop function if exists public.guest_personal_contribution(public.guests, timestamptz);

-- Re-assert the internal-only posture. A freshly created function is granted to
-- PUBLIC by default, so the new boolean overload MUST be revoked (it leaks no data
-- but stays internal, matching 20260613180000/20260615140000).
revoke execute on function
  public.guest_personal_contribution(public.guests, boolean),
  public.user_event_consumption(uuid, uuid),
  public.enforce_guest_quota()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Guest-write gate — cancelled (not status='closed') is the admin-only state
-- ---------------------------------------------------------------------------
-- Body identical to 20260613210000 (event_auto_lock) except the closed branch.
create or replace function public.can_write_guests(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.id is null then false
    when public.has_venue_role(e.venue_id, '{admin}'::public.venue_role[]) then true
    when e.cancelled_at is not null then false
    when public.is_event_organizer(e.id) then true
    when public.has_venue_role(e.venue_id, '{doorhost}'::public.venue_role[]) then true
    when e.list_locked or (e.auto_lock_at is not null and now() >= e.auto_lock_at) then false
    else public.has_venue_role(e.venue_id, '{staff}'::public.venue_role[])
  end
  from public.events e
  where e.id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Check-in gate — door roles, unless the event is cancelled
-- ---------------------------------------------------------------------------
-- Was: status in ('open','live'). With the status machine gone there is no live
-- status to gate on, and the door must work whenever the night is on, so the only
-- block is a cancelled event.
create or replace function public.can_check_in(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select e.cancelled_at is null
    and (
      public.has_venue_role(e.venue_id, '{admin,doorhost}'::public.venue_role[])
      or public.is_event_organizer(e.id)
    )
  from public.events e
  where e.id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. Public landing surface — a cancelled event stops taking requests
-- ---------------------------------------------------------------------------

-- The anon "read an event by its active landing link" policy.
alter policy events_select_landing on public.events
  using (landing_active = true and cancelled_at is null);

-- The anon direct-insert path (the app uses submit_guest_request, but keep the
-- policy consistent with the RPC).
alter policy guest_requests_insert_public on public.guest_requests
  with check (
    status = 'pending'
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.landing_active and e.cancelled_at is null
    )
  );

-- That EXISTS subquery reads events under the caller's (anon's) privileges, so anon
-- needs column SELECT on cancelled_at (it already has landing_active/status). The
-- events_select_landing USING clause needs no grant — RLS predicates may read any
-- column — but a cross-table EXISTS does. Extend the anon column grant.
grant select (cancelled_at) on table public.events to anon;

-- The hardened submission RPC: same body as 20260614100000, the slug resolve now
-- gates on cancelled_at instead of status<>'closed'. CREATE OR REPLACE preserves
-- the anon/authenticated EXECUTE grants.
create or replace function public.submit_guest_request(
  p_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_plus_ones integer,
  p_motivation text,
  p_ip_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_min   constant integer := 10;
  max_per_win  constant integer := 10;
  v_event_id   uuid;
  v_name       text := nullif(btrim(p_full_name), '');
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := nullif(btrim(p_phone), '');
  v_phone_dig  text;
  v_motivation text := nullif(btrim(p_motivation), '');
  v_plus       integer := least(greatest(coalesce(p_plus_ones, 0), 0), 20);
  v_key        text;
  v_count      integer;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    return 'invalid';
  end if;
  if v_motivation is not null and char_length(v_motivation) > 1000 then
    v_motivation := left(v_motivation, 1000);
  end if;

  -- Resolve the event by slug, but ONLY while its landing link is open and the
  -- event is not cancelled. A cancelled/unknown slug is indistinguishable → no
  -- enumeration (#28).
  select e.id into v_event_id
  from public.events e
  where e.landing_slug = p_slug
    and e.landing_active
    and e.cancelled_at is null;
  if v_event_id is null then
    return 'closed';
  end if;

  if p_ip_hash is not null then
    insert into public.landing_request_throttle as t (ip_hash, window_started_at, request_count)
    values (p_ip_hash, now(), 1)
    on conflict (ip_hash) do update
      set request_count = case
            when t.window_started_at < now() - make_interval(mins => window_min) then 1
            else t.request_count + 1
          end,
          window_started_at = case
            when t.window_started_at < now() - make_interval(mins => window_min) then now()
            else t.window_started_at
          end,
          updated_at = now()
    returning t.request_count into v_count;

    if v_count > max_per_win then
      return 'rate_limited';
    end if;
  end if;

  v_phone_dig := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
  v_key := coalesce(v_email, v_phone_dig);

  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation, dedupe_key)
    values
      (v_event_id, v_name, v_email, v_phone, v_plus, v_motivation, v_key);
  exception when unique_violation then
    null; -- silent dedup
  end;

  return 'ok';
end;
$$;
