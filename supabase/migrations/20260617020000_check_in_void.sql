-- Check-in terugdraaien aan de deur ("uitchecken"). Decision (Max, 16/17 jun): a
-- mistaken check-in may ALWAYS be undone by anyone who may check in at this event
-- (doorhost / organizer / admin), mits gelogd. Per non-negotiable #3 (soft delete
-- only, hard DELETE revoked for app roles) this is a SOFT void: the check_ins row
-- stays and is flagged voided_at/voided_by — never deleted. The generic audit
-- trigger already fires on UPDATE, so every void (and re-checkin) is recorded with
-- actor + before/after diff. A voided row no longer counts as "aanwezig" anywhere.
--
-- Re-checkin after a void reuses the same row (guest_id is unique, #11): voided_at
-- is cleared and plus_ones_arrived re-set. cap_check_in_arrivals still clamps and
-- keeps arrivals monotonic on that update.

alter table public.check_ins
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.user_profiles (id) on delete restrict;

comment on column public.check_ins.voided_at is
  'When set, this check-in was undone at the door (soft void, #3). The row is kept for the audit trail but no longer counts as present; cleared again on re-checkin.';

-- Voiding / re-checkin is an UPDATE (no DELETE grant — honours #3). The existing
-- check_ins_update_own_device policy only covers the original checker; a void may
-- be done by ANY door-scoped user, so add a can_check_in-scoped UPDATE policy.
-- Policies are OR'd, so this also lifts the own-device limit on the #22 top-up:
-- a colleague at the same door can now top up or correct a check-in. The cap
-- trigger still clamps plus_ones_arrived; the audit trigger logs the actor.
create policy check_ins_update_door on public.check_ins
  for update to authenticated
  using (public.can_check_in(public.guest_event(guest_id)))
  with check (public.can_check_in(public.guest_event(guest_id)));

-- Make the #22 cap/monotonic trigger revive-aware: a re-checkin (voided -> active)
-- re-sets plus_ones_arrived fresh (clamp only), instead of being held monotonic at
-- the pre-void value. Every other UPDATE (a top-up) stays monotonic as before.
create or replace function public.cap_check_in_arrivals()
returns trigger
language plpgsql
as $$
declare
  v_allotment integer;
begin
  select plus_ones into v_allotment from public.guests where id = NEW.guest_id;
  NEW.plus_ones_arrived := least(greatest(coalesce(NEW.plus_ones_arrived, 0), 0), coalesce(v_allotment, 0));
  if TG_OP = 'UPDATE' and not (OLD.voided_at is not null and NEW.voided_at is null) then
    -- Arrivals are monotonic on a normal update; a revive is exempt (resets fresh).
    NEW.plus_ones_arrived := greatest(NEW.plus_ones_arrived, OLD.plus_ones_arrived);
  end if;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics: a voided check-in is NOT "aanwezig". Re-create the seven stats
-- functions that derive presence from check_ins (20260614120000_admin_analytics)
-- with `c.voided_at is null` added to each earliest-check-in CTE. Nothing else
-- changes — same shapes, same guards, same grants (CREATE OR REPLACE keeps them).
-- ---------------------------------------------------------------------------

create or replace function public.event_stats_summary(p_event_id uuid)
returns table (
  registered integer,
  registered_headcount integer,
  present integer,
  present_headcount integer,
  refused integer,
  no_shows integer,
  attendance_pct numeric,
  peak_bucket timestamptz,
  peak_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_event_stats(p_event_id) then return; end if;

  return query
  with reg as (
    select g.id, g.plus_ones
    from public.guests g
    where g.event_id = p_event_id
      and g.status in ('approved', 'checked_in', 'refused')
  ),
  ci as (  -- earliest non-voided check-in per guest (first wins, #11)
    select distinct on (c.guest_id) c.guest_id, c.checked_at, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  ),
  ref as (
    select distinct r.guest_id
    from public.refusals r
    join reg on reg.id = r.guest_id
  ),
  classified as (
    select
      reg.id,
      reg.plus_ones,
      ci.guest_id is not null as is_present,
      ci.plus_ones_arrived,
      (ci.guest_id is null and ref.guest_id is not null) as is_refused
    from reg
    left join ci on ci.guest_id = reg.id
    left join ref on ref.guest_id = reg.id
  ),
  buckets as (
    select to_timestamp(floor(extract(epoch from ci.checked_at) / 900) * 900) as bucket,
           count(*)::int as n
    from ci
    group by 1
  ),
  peak as (
    select bucket, n from buckets order by n desc, bucket limit 1
  )
  select
    (select count(*)::int from classified),
    (select coalesce(sum(1 + plus_ones), 0)::int from classified),
    (select count(*)::int from classified where is_present),
    (select coalesce(sum(1 + plus_ones_arrived), 0)::int from classified where is_present),
    (select count(*)::int from classified where is_refused),
    (select count(*)::int from classified where not is_present and not is_refused),
    (select case when coalesce(sum(1 + plus_ones), 0) = 0 then 0
              else round(
                coalesce(sum(1 + plus_ones_arrived) filter (where is_present), 0)::numeric
                / sum(1 + plus_ones)::numeric * 100, 1)
            end
       from classified),
    (select bucket from peak),
    (select n from peak);
end;
$$;

create or replace function public.event_checkins_per_quarter(p_event_id uuid)
returns table (bucket timestamptz, checkins integer, headcount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_event_stats(p_event_id) then return; end if;

  return query
  with ci as (
    select distinct on (c.guest_id) c.guest_id, c.checked_at, c.plus_ones_arrived
    from public.check_ins c
    join public.guests g on g.id = c.guest_id
    where g.event_id = p_event_id
      and g.status in ('approved', 'checked_in', 'refused')
      and c.voided_at is null
    order by c.guest_id, c.checked_at
  )
  select
    to_timestamp(floor(extract(epoch from ci.checked_at) / 900) * 900) as bucket,
    count(*)::int as checkins,
    coalesce(sum(1 + ci.plus_ones_arrived), 0)::int as headcount
  from ci
  group by 1
  order by 1;
end;
$$;

create or replace function public.event_tier_stats(p_event_id uuid)
returns table (
  tier_id uuid,
  tier_name text,
  color text,
  registered integer,
  registered_headcount integer,
  present integer,
  present_headcount integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_event_stats(p_event_id) then return; end if;

  return query
  with reg as (
    select g.id, g.tier_id, g.plus_ones
    from public.guests g
    where g.event_id = p_event_id
      and g.status in ('approved', 'checked_in', 'refused')
  ),
  ci as (
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  )
  select
    t.id,
    t.name,
    t.color,
    count(reg.id)::int,
    coalesce(sum(1 + reg.plus_ones), 0)::int,
    count(ci.guest_id)::int,
    coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null), 0)::int
  from public.guest_tiers t
  left join reg on reg.tier_id = t.id
  left join ci on ci.guest_id = reg.id
  where t.event_id = p_event_id
  group by t.id, t.name, t.color
  order by t.name;
end;
$$;

create or replace function public.event_user_additions(p_event_id uuid)
returns table (user_id uuid, full_name text, added integer, added_headcount integer, present integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_event_stats(p_event_id) then return; end if;

  return query
  with reg as (
    select g.id, g.added_by, g.plus_ones
    from public.guests g
    where g.event_id = p_event_id
      and g.status in ('approved', 'checked_in', 'refused')
  ),
  ci as (
    select distinct on (c.guest_id) c.guest_id
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  )
  select
    reg.added_by,
    p.full_name,
    count(*)::int,
    coalesce(sum(1 + reg.plus_ones), 0)::int,
    count(ci.guest_id)::int
  from reg
  join public.user_profiles p on p.id = reg.added_by
  left join ci on ci.guest_id = reg.id
  group by reg.added_by, p.full_name
  order by count(*) desc, p.full_name;
end;
$$;

create or replace function public.venue_stats_summary(
  p_venue_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (
  events integer,
  registered integer,
  registered_headcount integer,
  present integer,
  present_headcount integer,
  refused integer,
  no_shows integer,
  attendance_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_venue_stats(p_venue_id) then return; end if;

  return query
  with ev as (
    select e.id
    from public.events e
    where e.venue_id = p_venue_id
      and (p_from is null or e.starts_at >= p_from)
      and (p_to is null or e.starts_at < p_to)
  ),
  reg as (
    select g.id, g.plus_ones
    from public.guests g
    join ev on ev.id = g.event_id
    where g.status in ('approved', 'checked_in', 'refused')
  ),
  ci as (
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  ),
  ref as (
    select distinct r.guest_id from public.refusals r join reg on reg.id = r.guest_id
  ),
  classified as (
    select reg.plus_ones,
           ci.guest_id is not null as is_present,
           ci.plus_ones_arrived,
           (ci.guest_id is null and ref.guest_id is not null) as is_refused
    from reg
    left join ci on ci.guest_id = reg.id
    left join ref on ref.guest_id = reg.id
  )
  select
    (select count(*)::int from ev),
    (select count(*)::int from classified),
    (select coalesce(sum(1 + plus_ones), 0)::int from classified),
    (select count(*)::int from classified where is_present),
    (select coalesce(sum(1 + plus_ones_arrived), 0)::int from classified where is_present),
    (select count(*)::int from classified where is_refused),
    (select count(*)::int from classified where not is_present and not is_refused),
    (select case when coalesce(sum(1 + plus_ones), 0) = 0 then 0
              else round(
                coalesce(sum(1 + plus_ones_arrived) filter (where is_present), 0)::numeric
                / sum(1 + plus_ones)::numeric * 100, 1)
            end
       from classified);
end;
$$;

create or replace function public.venue_event_rollup(
  p_venue_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (
  event_id uuid,
  name text,
  starts_at timestamptz,
  status public.event_status,
  registered integer,
  registered_headcount integer,
  present integer,
  present_headcount integer,
  refused integer,
  attendance_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_venue_stats(p_venue_id) then return; end if;

  return query
  with ev as (
    select e.id, e.name, e.starts_at, e.status
    from public.events e
    where e.venue_id = p_venue_id
      and (p_from is null or e.starts_at >= p_from)
      and (p_to is null or e.starts_at < p_to)
  ),
  reg as (
    select g.id, g.event_id, g.plus_ones
    from public.guests g
    join ev on ev.id = g.event_id
    where g.status in ('approved', 'checked_in', 'refused')
  ),
  ci as (
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  ),
  ref as (
    select distinct r.guest_id from public.refusals r join reg on reg.id = r.guest_id
  ),
  per_event as (
    select
      reg.event_id,
      count(*)::int as registered,
      coalesce(sum(1 + reg.plus_ones), 0)::int as registered_headcount,
      count(ci.guest_id)::int as present,
      coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null), 0)::int as present_headcount,
      count(*) filter (where ci.guest_id is null and ref.guest_id is not null)::int as refused
    from reg
    left join ci on ci.guest_id = reg.id
    left join ref on ref.guest_id = reg.id
    group by reg.event_id
  )
  select
    ev.id, ev.name, ev.starts_at, ev.status,
    coalesce(pe.registered, 0),
    coalesce(pe.registered_headcount, 0),
    coalesce(pe.present, 0),
    coalesce(pe.present_headcount, 0),
    coalesce(pe.refused, 0),
    case when coalesce(pe.registered_headcount, 0) = 0 then 0
         else round(pe.present_headcount::numeric / pe.registered_headcount::numeric * 100, 1)
    end
  from ev
  left join per_event pe on pe.event_id = ev.id
  order by ev.starts_at desc;
end;
$$;

create or replace function public.venue_user_additions(
  p_venue_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (user_id uuid, full_name text, added integer, added_headcount integer, present integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_venue_stats(p_venue_id) then return; end if;

  return query
  with ev as (
    select e.id from public.events e
    where e.venue_id = p_venue_id
      and (p_from is null or e.starts_at >= p_from)
      and (p_to is null or e.starts_at < p_to)
  ),
  reg as (
    select g.id, g.added_by, g.plus_ones
    from public.guests g
    join ev on ev.id = g.event_id
    where g.status in ('approved', 'checked_in', 'refused')
  ),
  ci as (
    select distinct on (c.guest_id) c.guest_id
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  )
  select
    reg.added_by, p.full_name,
    count(*)::int,
    coalesce(sum(1 + reg.plus_ones), 0)::int,
    count(ci.guest_id)::int
  from reg
  join public.user_profiles p on p.id = reg.added_by
  left join ci on ci.guest_id = reg.id
  group by reg.added_by, p.full_name
  order by count(*) desc, p.full_name;
end;
$$;
