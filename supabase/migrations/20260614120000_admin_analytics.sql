-- Fase 10 — Admin/Finance analytics: audit-log feed + event/venue statistics
-- (decisions #15/#17/#26, spec §6). Read-only surface for Admin and the
-- read-only Finance role; staff never see any of it (#17 — only their own
-- quota counter, which already lives in event_quota_status).
--
-- Design (CLAUDE.md "no client-side rekenwerk over duizenden rijen"):
--   * Every aggregation runs in Postgres and returns small, ready-to-render
--     rows. The app never sums check_ins/guests client-side.
--   * Stats functions are SECURITY DEFINER (so one query sees the whole event
--     regardless of the caller's per-row RLS scope) and therefore re-check the
--     caller's role themselves — exactly the event_quota_status pattern. The
--     guard substitutes for the RLS that the definer bypasses; an unauthorized
--     caller gets an EMPTY result, never an error (RLS-like, non-enumerating).
--   * The audit feed is a SECURITY INVOKER view: it inherits the existing
--     audit_log RLS (admin/finance + AAL2, see 20260613120000) unchanged, so it
--     leaks nothing a raw audit_log select would not. security_invoker is
--     MANDATORY here — a default (definer) view runs as its owner and would
--     bypass RLS, exposing every venue's log to any authenticated user.
--
-- "Present" (aanwezig) is derived from check_ins, never guests.status — the door
-- records attendance by inserting a check_in (see src/features/door/model.ts),
-- and the first check-in wins (#11). A registered guest is classified into
-- exactly one bucket, by priority: present (has a check-in) > refused (has a
-- refusal) > no-show (neither). Registered = on the actual list, i.e. status in
-- (approved, checked_in, refused); pending/denied/removed are not "aangemeld".
-- Everything hangs on the event, never the calendar day (#26): buckets and
-- period filters use the event's own timestamps.

-- ---------------------------------------------------------------------------
-- Read guards — mirror the role matrix §2 ("Statistieken & rapportages",
-- "Audit log inzien"). Event stats: venue admin/finance, or the event's
-- organizer (own event). Venue stats: venue admin/finance only.
-- ---------------------------------------------------------------------------

create or replace function public.can_read_event_stats(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_venue_role(public.event_venue(p_event_id), '{admin,finance}'::public.venue_role[])
      or public.is_event_organizer(p_event_id);
$$;

create or replace function public.can_read_venue_stats(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_venue_role(p_venue_id, '{admin,finance}'::public.venue_role[]);
$$;

-- ---------------------------------------------------------------------------
-- EVENT-LEVEL statistics (#26 — all scoped to one event)
-- ---------------------------------------------------------------------------

-- Headline KPIs in one row. attendance_pct is by headcount (heads in / heads
-- expected). Empty when the caller may not read this event's stats.
create or replace function public.event_stats_summary(p_event_id uuid)
returns table (
  registered integer,            -- guest entries on the list
  registered_headcount integer,  -- Σ(1 + plus_ones) on the list
  present integer,               -- guests with a check-in
  present_headcount integer,     -- Σ(1 + plus_ones_arrived) of earliest check-ins
  refused integer,               -- guests refused (no check-in)
  no_shows integer,              -- on the list, neither checked in nor refused
  attendance_pct numeric,        -- round(present_headcount / registered_headcount * 100)
  peak_bucket timestamptz,       -- busiest 15-min check-in window
  peak_count integer             -- check-ins in that window
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
  ci as (  -- earliest check-in per guest (first wins, #11)
    select distinct on (c.guest_id) c.guest_id, c.checked_at, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
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

-- Instroomgrafiek: check-ins per 15-min bucket (#26 — uses the server check-in
-- instant, buckets are TZ-agnostic epoch windows rendered in the client TZ).
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

-- Aanwezig vs. aangemeld per tier.
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

-- Toevoegingen per gebruiker (fraud lens #15 — wie zette wie op de lijst).
-- All adders are listed (landing source counts toward the adder who staged it).
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

-- Weigeringen met redenen (#10/#15).
create or replace function public.event_refusal_reasons(p_event_id uuid)
returns table (reason text, n integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_event_stats(p_event_id) then return; end if;

  return query
  select r.reason, count(*)::int
  from public.refusals r
  join public.guests g on g.id = r.guest_id
  where g.event_id = p_event_id
  group by r.reason
  order by count(*) desc, r.reason;
end;
$$;

-- ---------------------------------------------------------------------------
-- VENUE-LEVEL statistics over a period (zelfde metrics, meerdere events).
-- p_from/p_to filter on events.starts_at; NULL = unbounded. [from, to).
-- ---------------------------------------------------------------------------

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

-- Per-event rollup over the period — the venue trend table.
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

-- Toevoegingen per gebruiker over de periode.
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

create or replace function public.venue_refusal_reasons(
  p_venue_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (reason text, n integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_venue_stats(p_venue_id) then return; end if;

  return query
  select r.reason, count(*)::int
  from public.refusals r
  join public.guests g on g.id = r.guest_id
  join public.events e on e.id = g.event_id
  where e.venue_id = p_venue_id
    and (p_from is null or e.starts_at >= p_from)
    and (p_to is null or e.starts_at < p_to)
  group by r.reason
  order by count(*) desc, r.reason;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit feed — enriches audit_log with the human-readable names the UI needs to
-- compose Dutch sentences ("Max heeft Juri verplaatst van Regular naar VIP").
-- The raw diff stores UUIDs/enums; resolving tier/actor/subject names in one
-- RLS-respecting place keeps that work out of the client. SECURITY INVOKER:
-- inherits audit_log's admin/finance + AAL2 policy and each joined table's RLS.
--   * guest_id     — the guest this entry concerns (guests row, or the guest of
--                    a check_in/refusal), so a per-guest "geschiedenis" is just
--                    a filter on this column.
--   * subject_user_id — the user a quota/membership/request entry is about.
-- ---------------------------------------------------------------------------

create view public.audit_feed
with (security_invoker = on)
as
with base as (
  select
    a.id, a.actor_id, a.venue_id, a.event_id, a.entity_type, a.entity_id,
    a.action, a.diff, a.device_id, a.created_at,
    case
      when a.entity_type = 'guests' then a.entity_id
      when a.entity_type in ('check_ins', 'refusals')
        then coalesce(a.diff -> 'after' ->> 'guest_id', a.diff -> 'before' ->> 'guest_id')::uuid
    end as rel_guest_id,
    case
      when a.entity_type in ('quotas', 'event_quotas', 'quota_requests', 'venue_memberships')
        then coalesce(a.diff -> 'after' ->> 'user_id', a.diff -> 'before' ->> 'user_id')::uuid
    end as rel_user_id,
    (a.diff -> 'before' ->> 'tier_id')::uuid as old_tier_id,
    (a.diff -> 'after' ->> 'tier_id')::uuid as new_tier_id
  from public.audit_log a
)
select
  b.id, b.actor_id, b.venue_id, b.event_id, b.entity_type, b.entity_id,
  b.action, b.diff, b.device_id, b.created_at,
  b.rel_guest_id as guest_id,
  b.rel_user_id as subject_user_id,
  actor.full_name as actor_name,
  g.full_name as guest_name,
  subj.full_name as subject_name,
  ot.name as old_tier_name,
  nt.name as new_tier_name,
  ev.name as event_name
from base b
left join public.user_profiles actor on actor.id = b.actor_id
left join public.guests g on g.id = b.rel_guest_id
left join public.user_profiles subj on subj.id = b.rel_user_id
left join public.guest_tiers ot on ot.id = b.old_tier_id
left join public.guest_tiers nt on nt.id = b.new_tier_id
left join public.events ev on ev.id = b.event_id;

comment on view public.audit_feed is
  'SECURITY INVOKER enrichment of audit_log (inherits its admin/finance + AAL2 RLS). Resolves actor/guest/subject/tier names so the app composes readable Dutch log lines without client-side joins (#15).';

-- ---------------------------------------------------------------------------
-- Privileges — read-only surface. Functions self-guard (admin/finance/organizer
-- checked inside), so they are safe to expose to authenticated. The view leans
-- entirely on audit_log RLS. anon gets nothing.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.can_read_event_stats(uuid),
  public.can_read_venue_stats(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.can_read_event_stats(uuid),
  public.can_read_venue_stats(uuid)
to authenticated, service_role;

revoke execute on function
  public.event_stats_summary(uuid),
  public.event_checkins_per_quarter(uuid),
  public.event_tier_stats(uuid),
  public.event_user_additions(uuid),
  public.event_refusal_reasons(uuid),
  public.venue_stats_summary(uuid, timestamptz, timestamptz),
  public.venue_event_rollup(uuid, timestamptz, timestamptz),
  public.venue_user_additions(uuid, timestamptz, timestamptz),
  public.venue_refusal_reasons(uuid, timestamptz, timestamptz)
from public, anon;
grant execute on function
  public.event_stats_summary(uuid),
  public.event_checkins_per_quarter(uuid),
  public.event_tier_stats(uuid),
  public.event_user_additions(uuid),
  public.event_refusal_reasons(uuid),
  public.venue_stats_summary(uuid, timestamptz, timestamptz),
  public.venue_event_rollup(uuid, timestamptz, timestamptz),
  public.venue_user_additions(uuid, timestamptz, timestamptz),
  public.venue_refusal_reasons(uuid, timestamptz, timestamptz)
to authenticated, service_role;

revoke all on public.audit_feed from public, anon;
grant select on public.audit_feed to authenticated, service_role;
