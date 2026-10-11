-- venue_user_additions: "present" follows the on-list rule (#44), like the
-- event variant has since 20260811161000 (ClickUp 86ey9c5fp, decision D3).
--
-- The venue-level per-member breakdown derives `present` by joining its `reg`
-- pool (statuses approved, checked_in, refused) to the earliest non-voided
-- check-in per guest. `sync_guest_status_from_refusal` (20260619120000) flips a
-- guest to `refused` without voiding the check-in — the arrival really happened,
-- the refusal is the newer fact — so a guest refused AFTER checking in kept
-- counting as present here. 20260811161000 fixed exactly this edge in
-- `event_user_additions` but left the venue variant alone, so one refused
-- arrival made the venue column read one higher than the sum of its events
-- (reproduced in review: Max present 4 at venue level, 3 at event level).
--
-- Fix: the check-in CTE only joins the on-list part of `reg`
-- (`reg.status in ('approved', 'checked_in')`), mirroring event_user_additions.
-- For the CTE to see the status, `reg` now also selects `g.status`; its row set
-- is unchanged, so `added` / `added_headcount` (the gross ledger: refused guests
-- still count as added) stay exactly as before.
--
-- Body otherwise copied verbatim from 20261014130000_definer_rpc_profile_scope
-- (PR #461): the platform-admin name rule (name null when the adder is a
-- platform admin the caller cannot see via can_view_profile), the `agg` CTE,
-- the sort on the displayed name, the can_read_venue_stats gate. This migration
-- MUST be applied after 20261014130000 — it replaces the same function; the
-- timestamp order guarantees that on `db reset` / `db push`.
--
-- Signature, result type and grants are unchanged (CREATE OR REPLACE keeps the
-- ACL; re-asserted below so the matrix is visible here).

create or replace function public.venue_user_additions(
  p_venue_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
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
    select g.id, g.added_by, g.plus_ones, g.status
    from public.guests g
    join ev on ev.id = g.event_id
    where g.status in ('approved', 'checked_in', 'refused')
  ),
  ci as (
    -- earliest NON-VOIDED check-in per guest, on-list only (#44) — same rule as
    -- event_user_additions (20260811161000): a guest refused after checking in
    -- keeps a live check_ins row but is no longer present.
    select distinct on (c.guest_id) c.guest_id
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
      and reg.status in ('approved', 'checked_in')
    order by c.guest_id, c.checked_at
  ),
  agg as (
    select
      reg.added_by as a_user,
      case
        when p.is_platform_admin and not public.can_view_profile(reg.added_by) then null
        else p.full_name
      end as a_name,
      count(*)::int as a_added,
      coalesce(sum(1 + reg.plus_ones), 0)::int as a_added_heads,
      count(ci.guest_id)::int as a_present
    from reg
    join public.user_profiles p on p.id = reg.added_by
    left join ci on ci.guest_id = reg.id
    group by reg.added_by, p.full_name, p.is_platform_admin
  )
  select agg.a_user, agg.a_name, agg.a_added, agg.a_added_heads, agg.a_present
  from agg
  order by agg.a_added desc, agg.a_name, agg.a_user;
end;
$$;

revoke execute on function public.venue_user_additions(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.venue_user_additions(uuid, timestamptz, timestamptz) to authenticated, service_role;
