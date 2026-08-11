-- M4 follow-up (ClickUp 86ey9c5fp), design decision 3A — the instroom-per-kwartier
-- chart now follows the canonical on-list rule (#44) like every other statistic.
--
-- The edge, flagged by the fresh-session `/code-review` of M4 and left as a
-- follow-up in `20260713140000_headcount_canonical_rules.sql`:
-- `sync_guest_status_from_refusal` (20260619120000) flips a guest
-- `checked_in` -> `refused` WITHOUT voiding their check-in — deliberately, the
-- refusal is the newer fact but the check-in really happened and stays as
-- append-only history. `event_checkins_per_quarter` scoped its guest join to
-- ('approved', 'checked_in', 'refused'), so that surviving check-in kept
-- feeding the chart while `event_stats_summary.present` (scope
-- ('approved', 'checked_in')) had already dropped it. Same event, same moment,
-- two different numbers — the exact class of drift M4 exists to remove.
--
-- Note this disagreed with the summary's OWN `peak_bucket`/`peak_count` too:
-- those derive from the summary's `ci` CTE, which is already refused-free. So
-- the chart could show a bucket taller than the peak the same RPC reported.
-- After this migration both read the same population.
--
-- Decision (Max, 11 aug 2026): exclude. Spec #44 fixes ONE meaning for "on the
-- list" everywhere and refused contributes to none of it; a per-surface
-- exception is what let door and cockpit drift in the first place. The refusal
-- itself remains fully visible — `guests.status`, the `refusals` table, the
-- audit trail and `event_stats_summary.refused` all still report it.
--
-- Two mechanical cleanups ride along, both provable from the schema:
--   * the `check_ins` scan had NO bounding predicate of its own — it reached
--     every check-in row in the table and relied on the join to `guests` to
--     discard the rest. `check_ins.event_id` has been server-derived
--     unconditionally since 20260713190000_checkin_scope_venue_pin and is
--     indexed (`check_ins_event_id_idx`), so the scan is now bounded directly.
--   * `distinct on (c.guest_id)` (and the `order by` it forces) eliminated
--     nothing: `check_ins.guest_id` is NOT NULL UNIQUE (20260613000000), so
--     there is at most one row per guest by construction. Dropping it also drops
--     the sort requirement that made an unbounded merge join attractive.
--     Note the old comment credited that clause with #11's "first check-in
--     wins" rule; it never implemented it — the UNIQUE constraint plus the
--     door's 23505 → revive path is what enforces #11.
-- The voided-check-in filter and the bucket math are untouched, and
-- `create or replace` keeps the grants from 20260614120000.

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
    -- On the list (#44): approved + checked_in only. A refused-after-checked-in
    -- guest keeps a live check_ins row (see header) but is no longer part of any
    -- on-list/present population, so their arrival leaves the chart as well.
    -- One row per guest by construction (check_ins.guest_id is unique), so no
    -- de-duplication is needed here.
    select c.guest_id, c.checked_at, c.plus_ones_arrived
    from public.check_ins c
    join public.guests g on g.id = c.guest_id
    where c.event_id = p_event_id
      and g.event_id = p_event_id
      and g.status in ('approved', 'checked_in')
      and c.voided_at is null
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
