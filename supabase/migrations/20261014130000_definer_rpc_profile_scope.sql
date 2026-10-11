-- SECURITY DEFINER read paths that reached past the profile boundary
-- (follow-up to the user_profiles column-SELECT audit, 2026-10-11).
--
-- 1. event_user_additions / venue_user_additions — "added by" stats.
--    Both join user_profiles as the owner and returned full_name for every
--    guests.added_by, including a PlusOne platform admin who added a guest as
--    support in a venue they are no member of. The same venue admin cannot see
--    that profile under RLS (can_view_profile is false) and audit_feed shows
--    the actor's name as null, but the stats named them — which tells the
--    venue that a PlusOne operator worked in their list and who, while
--    platform_access_log is deliberately never shown to the venue (legal v0.3).
--
--    Rule now: the name is null when the adder is a platform admin AND the
--    caller cannot view their profile. Everyone else keeps their name, former
--    members included (their stats history is the venue's own, #24 — they
--    simply lost the membership, not the record). The app labels the null
--    "PlusOne support". Sorting uses the displayed name, so a hidden name
--    cannot be located alphabetically between two visible ones. user_id and
--    the counts stay: the venue already sees that actor id on its audit_log.
--
--    Signatures, result types, grants, the can_read_*_stats gates and every
--    count are unchanged (CREATE OR REPLACE keeps the ACL).
--
-- 2. admin_list_user_sessions — a venue admin's view of a member's sessions.
--    It returned, per session, `aal` (whether that member signed in with MFA,
--    the same class of information as user_profiles.mfa_snooze_until, closed
--    in 20261014120100) and the raw `ip`. Both are now always null (decision
--    Max 2026-10-11, spec #61b):
--      * the remote-logout list needs which session (device + last active),
--        not where it came from or how it was secured — data minimisation,
--        GDPR art. 5(1)(c); an IP address is personal data;
--      * sessions belong to the ACCOUNT, not the company (#24: users exist
--        independently of venues), so the admin of company A also saw the IPs
--        of sessions the member uses for company B.
--    user_agent stays: it is how the admin tells the sessions apart ("iPhone,
--    Safari"). Both columns stay in the result type so the deployed app keeps
--    working (expand–contract); a later migration drops them.
--    list_own_sessions is unchanged — your own IP and aal are your own data.

-- ---------------------------------------------------------------------------
-- 1a. event_user_additions
-- ---------------------------------------------------------------------------

create or replace function public.event_user_additions(p_event_id uuid)
returns table (
  user_id uuid, full_name text, added integer, added_headcount integer,
  removed_headcount integer, present integer, present_headcount integer,
  added_free_headcount integer, present_free_headcount integer
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
    -- earliest NON-VOIDED check-in per guest, on-list only (#44, 86ey9c5fp);
    -- unchanged from 20260811161000.
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
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
      coalesce(sum(1 + reg.plus_ones) filter (where reg.status = 'removed'), 0)::int as a_removed_heads,
      count(ci.guest_id)::int as a_present,
      coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null), 0)::int as a_present_heads,
      coalesce(sum(1 + reg.plus_ones) filter (where reg.is_free), 0)::int as a_added_free_heads,
      coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null and reg.is_free), 0)::int as a_present_free_heads
    from reg
    join public.user_profiles p on p.id = reg.added_by
    left join ci on ci.guest_id = reg.id
    group by reg.added_by, p.full_name, p.is_platform_admin
  )
  select agg.a_user, agg.a_name, agg.a_added, agg.a_added_heads, agg.a_removed_heads,
         agg.a_present, agg.a_present_heads, agg.a_added_free_heads, agg.a_present_free_heads
  from agg
  order by agg.a_added_heads desc, agg.a_name, agg.a_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1b. venue_user_additions
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. admin_list_user_sessions: ip and aal always null (columns kept for the deployed app)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_user_sessions(p_target uuid)
returns table (
  session_id uuid, created_at timestamptz, updated_at timestamptz,
  not_after timestamptz, user_agent text, ip text, aal text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.venue_memberships caller
    join public.venue_memberships target on target.venue_id = caller.venue_id
    where caller.user_id = auth.uid()
      and caller.roles @> '{admin}'::public.venue_role[]
      and target.user_id = p_target
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select
      s.id, s.created_at, s.updated_at, s.not_after,
      s.user_agent, null::text, null::text
    from auth.sessions s
    where s.user_id = p_target
    order by s.updated_at desc;
end;
$$;

-- Grants are kept by CREATE OR REPLACE; re-asserted so the matrix is visible here.
revoke execute on function public.event_user_additions(uuid) from public, anon;
grant execute on function public.event_user_additions(uuid) to authenticated, service_role;
revoke execute on function public.venue_user_additions(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.venue_user_additions(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke execute on function public.admin_list_user_sessions(uuid) from public, anon;
grant execute on function public.admin_list_user_sessions(uuid) to authenticated, service_role;
