-- Snelheid P2, P1-review follow-up "single-event headcounts"
-- (docs/perf-audit-2026-10.md; ClickUp z8uq9m2xz2, 9-FE).
--
-- usePoEvent's cache-miss path (a deep link or refresh on an event screen)
-- called venue_event_headcounts with p_since = that event's starts_at, which
-- aggregates EVERY event after it: for the oldest event's recap that is close
-- to the venue's full history. It also ran as a second round-trip after the
-- event row, because the cutoff came from that row.
--
-- This adds an optional p_event_id filter. With it the aggregate covers one
-- event, and the caller can fire it in parallel with the event read (it knows
-- the id up front). The body is otherwise byte-for-byte the canonical rules of
-- 20260714171523 (partial-check-in aware `present`, role-relative fallbacks).
--
-- Still SECURITY INVOKER (now stated explicitly; it was the default): the count
-- stays role-relative through guests/check_ins RLS, so staff still count only
-- their own guests.
--
-- Expand-safe: CREATE OR REPLACE cannot widen the argument list (that would add
-- an overload, and two overloads make PostgREST answer PGRST203), so the
-- 2-argument function is dropped first. The deployed app calls with
-- {p_venue_id} or {p_venue_id, p_since}; PostgREST resolves both to this
-- function with the new argument defaulting to null, identical behaviour.

drop function if exists public.venue_event_headcounts(uuid, timestamptz);

create function public.venue_event_headcounts(
  p_venue_id uuid,
  p_since timestamptz default null,
  p_event_id uuid default null
)
returns table (event_id uuid, registered integer, present integer)
language sql
stable
security invoker
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
    and (p_event_id is null or g.event_id = p_event_id)
  group by g.event_id;
$$;

revoke execute on function public.venue_event_headcounts(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.venue_event_headcounts(uuid, timestamptz, uuid) to authenticated, service_role;
