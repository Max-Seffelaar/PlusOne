-- Perf (86ey9e8gt): Home's usePoHomeEvents polls fetchEvents + fetchEventHeadcounts
-- every 10s with no date window, so the poll's cost grows with the venue's total
-- event history (400-1000 events after months) instead of staying flat. The Home
-- screen already only ever DISPLAYS recent-past + upcoming events (PAST_WINDOW_MS,
-- 7 days, in home.tsx) — this migration lets the query apply that same cutoff
-- instead of downloading the full history and throwing most of it away in JS.
--
-- `p_since` is optional (default null = unbounded, today's behaviour) so every
-- existing caller (Events tab's "Past" view, stats) keeps working unchanged —
-- only the po hooks that opt in by passing a cutoff get the smaller scan.
--
-- The old single-argument signature can't be widened via CREATE OR REPLACE
-- (different argument list = a new overload, not a replacement), so the old
-- function is dropped first — safe for the currently-deployed app: PostgREST
-- resolves an rpc call with only `p_venue_id` in the body to this new function
-- with `p_since` defaulting to null, identical to the old behaviour.

drop function if exists public.venue_event_headcounts(uuid);

create function public.venue_event_headcounts(p_venue_id uuid, p_since timestamptz default null)
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
    -- Role-preserving: coalesce(c.plus_ones_arrived, g.plus_ones) falls back
    -- to the full party when `c` is null — either no check-in exists, or RLS
    -- hid it from a caller without check_ins SELECT (staff). guests.status
    -- = 'checked_in' already excludes a voided check-in (the door_status_sync
    -- trigger flips it back to 'approved' on void), so the filter alone
    -- gates presence correctly regardless of whether `c` is visible.
    coalesce(
      sum(1 + coalesce(c.plus_ones_arrived, g.plus_ones)) filter (where g.status = 'checked_in'),
      0
    )::int as present
  from public.guests g
  join public.events e on e.id = g.event_id
  left join public.check_ins c on c.guest_id = g.id
  where g.venue_id = p_venue_id
    and (p_since is null or e.starts_at >= p_since)
  group by g.event_id;
$$;

revoke execute on function public.venue_event_headcounts(uuid, timestamptz) from public, anon;
grant execute on function public.venue_event_headcounts(uuid, timestamptz) to authenticated, service_role;
