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
-- Only the guest-status scope changes; the voided-check-in filter, the
-- first-check-in-wins `distinct on` (#11) and the bucket math are untouched.
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
    select distinct on (c.guest_id) c.guest_id, c.checked_at, c.plus_ones_arrived
    from public.check_ins c
    join public.guests g on g.id = c.guest_id
    where g.event_id = p_event_id
      and g.status in ('approved', 'checked_in')
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
