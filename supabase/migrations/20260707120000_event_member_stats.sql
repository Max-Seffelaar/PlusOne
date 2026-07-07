-- T9 (feedback 1/7, ClickUp 86ey4j1nt) — per-member event stats for Analytics.
--
-- Extends event_user_additions so the "Added by" section shows, per team member
-- (attributed to guests.added_by), in HEADS (1 + plus_ones):
--   • added_headcount       — gross, INCLUDING later-removed guests ("64 added")
--   • removed_headcount      — the subset now soft-removed ("(5 removed)")
--   • present_headcount      — heads that actually arrived (checked in)
--   • added_free_headcount   — of the added heads, on a FREE tier
--   • present_free_headcount — of the checked-in heads, on a FREE tier
-- Free = guest_tiers.door_price_cents is 0/none. Paid tiers are display-only
-- (#T3), so the split is informational; the caller derives paid = total − free.
--
-- Unit + attribution locked with Max (7 jul 2026): heads, removed credited via
-- added_by, check-ins credited to the ADDER (not the door host), per event.
--
-- Unlike event_stats_summary.registered (on-list, removed EXCLUDED), a member's
-- "added" total is GROSS on purpose: it answers "how many did this person put on
-- the list", of which some were later removed. pending/denied never reached the
-- list, so they are not counted as added.
--
-- The return signature grows, so we DROP + recreate (create-or-replace cannot
-- change a function's return type) and re-grant. Guard, SECURITY DEFINER and the
-- empty search_path are preserved exactly from 20260614120000_admin_analytics.

drop function if exists public.event_user_additions(uuid);

create function public.event_user_additions(p_event_id uuid)
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
    -- earliest check-in per guest → the heads that actually arrived.
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
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

revoke execute on function public.event_user_additions(uuid) from public, anon;
grant execute on function public.event_user_additions(uuid) to authenticated, service_role;
