-- M4 (UX/IA 8/7, K-10) — canonical headcount rules, spec decision #44.
-- Two independent bugs in the stats/aggregate RPCs, found while root-causing
-- K-10 ("cockpit counts differently than the rest"):
--
-- 1. `venue_event_headcounts.present` (Home cards / EventView, migration
--    20260708120000) summed the FULL registered party (`plus_ones`) for every
--    checked_in guest instead of the heads that actually arrived
--    (`check_ins.plus_ones_arrived`) — a partial check-in was overcounted.
--
-- 2. `event_stats_summary` / `event_tier_stats` / `venue_stats_summary` /
--    `venue_event_rollup` (migration 20260617020000) folded `refused` guests
--    into the same "registered" pool as approved/checked_in, inflating
--    registered/registered_headcount and understating attendance_pct. That
--    was a deliberate, tested choice at the time (see the old
--    supabase/tests/database/analytics.test.sql comment), but the M4 decision
--    (ux-ia-audit-claude-code.md §5.2, spec #44) now fixes ONE rule for
--    "on the list" everywhere: refused never contributes to on-list/inside/
--    on-the-way/attendance anywhere, tracked only as its own separate figure.
--    `refused` itself is still reported — now via a direct status filter
--    instead of the refusals-table join, since guests.status is the
--    authoritative source (see src/features/door/model.ts's own comment).
--
-- `event_user_additions` / `venue_user_additions` (per-adder attribution) are
-- UNCHANGED — they are a deliberately different "gross, incl. removed" ledger
-- ("who added how many, ever"), not the live on-list figure, and stay so.
-- `event_checkins_per_quarter` is unchanged too (no registered/on-list output;
-- refused guests never have a check-in in practice, so its join is inert).

-- ── 1. venue_event_headcounts: present = arrived heads, not registered ──────

create or replace function public.venue_event_headcounts(p_venue_id uuid)
returns table (event_id uuid, registered integer, present integer)
language sql
stable
set search_path = ''
as $$
  select
    g.event_id,
    coalesce(sum(1 + g.plus_ones) filter (where g.status in ('approved', 'checked_in')), 0)::int as registered,
    -- Partial-check-in aware (#44): a +3 with 1 companion present is 2 heads,
    -- not 4. check_ins.guest_id is unique, so this join never fans out.
    coalesce(
      sum(1 + c.plus_ones_arrived) filter (where g.status = 'checked_in' and c.voided_at is null),
      0
    )::int as present
  from public.guests g
  left join public.check_ins c on c.guest_id = g.id
  where g.venue_id = p_venue_id
  group by g.event_id;
$$;

-- ── 2. event_stats_summary: on-list excludes refused ────────────────────────

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
    -- On the list (#44): approved + checked_in only. Refused never
    -- contributes to registered/no_shows/attendance — tracked separately below.
    select g.id, g.plus_ones
    from public.guests g
    where g.event_id = p_event_id
      and g.status in ('approved', 'checked_in')
  ),
  ci as (  -- earliest non-voided check-in per guest (first wins, #11)
    select distinct on (c.guest_id) c.guest_id, c.checked_at, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  ),
  classified as (
    select
      reg.id,
      reg.plus_ones,
      ci.guest_id is not null as is_present,
      ci.plus_ones_arrived
    from reg
    left join ci on ci.guest_id = reg.id
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
    (select count(*)::int from public.guests
       where event_id = p_event_id and status = 'refused'),
    (select count(*)::int from classified where not is_present),
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

-- ── 3. event_tier_stats: same on-list fix, per tier ──────────────────────────

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
      and g.status in ('approved', 'checked_in')
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

-- ── 4. venue_stats_summary: same on-list fix, venue-wide ─────────────────────

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
    where g.status in ('approved', 'checked_in')
  ),
  ci as (
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  ),
  classified as (
    select reg.plus_ones,
           ci.guest_id is not null as is_present,
           ci.plus_ones_arrived
    from reg
    left join ci on ci.guest_id = reg.id
  )
  select
    (select count(*)::int from ev),
    (select count(*)::int from classified),
    (select coalesce(sum(1 + plus_ones), 0)::int from classified),
    (select count(*)::int from classified where is_present),
    (select coalesce(sum(1 + plus_ones_arrived), 0)::int from classified where is_present),
    (select count(*)::int from public.guests g join ev on ev.id = g.event_id
       where g.status = 'refused'),
    (select count(*)::int from classified where not is_present),
    (select case when coalesce(sum(1 + plus_ones), 0) = 0 then 0
              else round(
                coalesce(sum(1 + plus_ones_arrived) filter (where is_present), 0)::numeric
                / sum(1 + plus_ones)::numeric * 100, 1)
            end
       from classified);
end;
$$;

-- ── 5. venue_event_rollup: same on-list fix, per event ────────────────────────

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
    where g.status in ('approved', 'checked_in')
  ),
  ci as (
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  ),
  per_event as (
    select
      reg.event_id,
      count(*)::int as registered,
      coalesce(sum(1 + reg.plus_ones), 0)::int as registered_headcount,
      count(ci.guest_id)::int as present,
      coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null), 0)::int as present_headcount
    from reg
    left join ci on ci.guest_id = reg.id
    group by reg.event_id
  ),
  refused_per_event as (
    select g.event_id, count(*)::int as refused
    from public.guests g
    join ev on ev.id = g.event_id
    where g.status = 'refused'
    group by g.event_id
  )
  select
    ev.id, ev.name, ev.starts_at, ev.status,
    coalesce(pe.registered, 0),
    coalesce(pe.registered_headcount, 0),
    coalesce(pe.present, 0),
    coalesce(pe.present_headcount, 0),
    coalesce(rpe.refused, 0),
    case when coalesce(pe.registered_headcount, 0) = 0 then 0
         else round(pe.present_headcount::numeric / pe.registered_headcount::numeric * 100, 1)
    end
  from ev
  left join per_event pe on pe.event_id = ev.id
  left join refused_per_event rpe on rpe.event_id = ev.id
  order by ev.starts_at desc;
end;
$$;
