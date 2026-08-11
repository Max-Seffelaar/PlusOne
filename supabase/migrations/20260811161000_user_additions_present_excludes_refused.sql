-- M4 follow-up (ClickUp 86ey9c5fp, decision D3) — the per-member breakdown's
-- "present" columns follow the canonical on-list rule (#44) like the rest.
--
-- `event_user_additions` (20260708100000_p2_audit_quota_stats_integrity) scopes
-- its `reg` CTE to ('approved','checked_in','refused','removed') — deliberately
-- gross, it is a per-adder ledger of "who put how many on this list, ever". That
-- is right for `added`/`added_headcount`/`removed_headcount` and stays.
--
-- But `present`/`present_headcount` are derived by joining that same gross pool
-- to non-voided check-ins, so a guest refused AFTER checking in still counted as
-- present here. `sync_guest_status_from_refusal` (20260619120000) flips the
-- status without voiding the check-in, so that row survives — the same edge that
-- 20260811150000 just removed from `event_checkins_per_quarter`, and that
-- `event_stats_summary.present` never had. All three render on one panel
-- (`src/features/stats/data.ts` fetches them together), so the per-member column
-- was the last place where one refused-after-check-in guest made the numbers
-- disagree with each other.
--
-- Fix: the check-in CTE now joins only the on-list part of `reg`. Presence is a
-- statement about the on-list population (#44); the gross ledger columns are
-- untouched, so a refused or removed guest still shows up in `added` /
-- `added_headcount` exactly as before.

create or replace function public.event_user_additions(p_event_id uuid)
returns table (
  user_id uuid,
  full_name text,
  added integer,
  added_headcount integer,
  removed_headcount integer,
  present integer,
  present_headcount integer,
  added_free_headcount integer,
  present_free_headcount integer
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
    select g.id, g.added_by, g.plus_ones, g.status,
           coalesce(gt.door_price_cents, 0) = 0 as is_free
    from public.guests g
    left join public.guest_tiers gt on gt.id = g.tier_id
    where g.event_id = p_event_id
      and g.added_by is not null
      -- gross list membership: everything that reached the list, removed included.
      and g.status in ('approved', 'checked_in', 'refused', 'removed')
  ),
  ci as (
    -- earliest NON-VOIDED check-in per guest → the heads that actually arrived
    -- (C6 fix: a soft-voided check-in, #3, must not count as present — matches
    -- event_stats_summary's `where c.voided_at is null`).
    -- On-list only (#44, 86ey9c5fp): a guest refused after checking in keeps a
    -- live check_ins row, but presence follows the on-list population, exactly
    -- as event_stats_summary.present and event_checkins_per_quarter do. The
    -- gross `reg` pool above is unchanged — this narrowing is presence-only.
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
      and reg.status in ('approved', 'checked_in')
    order by c.guest_id, c.checked_at
  )
  select
    reg.added_by,
    p.full_name,
    count(*)::int,
    coalesce(sum(1 + reg.plus_ones), 0)::int,
    coalesce(sum(1 + reg.plus_ones) filter (where reg.status = 'removed'), 0)::int,
    count(ci.guest_id)::int,
    coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null), 0)::int,
    coalesce(sum(1 + reg.plus_ones) filter (where reg.is_free), 0)::int,
    coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null and reg.is_free), 0)::int
  from reg
  join public.user_profiles p on p.id = reg.added_by
  left join ci on ci.guest_id = reg.id
  group by reg.added_by, p.full_name
  order by coalesce(sum(1 + reg.plus_ones), 0)::int desc, p.full_name;
end;
$$;
