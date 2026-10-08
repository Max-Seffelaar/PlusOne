-- No direct member / crew inserts for an arbitrary user id (z8uq9m2yvp, decision Max
-- 2026-10-07 after review round 4 of the explicit-accept PR).
--
-- Max's rule: "Data only becomes visible once the user has been added AND has
-- accepted." The invite path now guarantees that (nothing accepts at login; each
-- invite is accepted by its invitee). But two RLS policies still let an admin of
-- ANY company, including one the attacker created in a minute, write a membership
-- or a crew row for any user id they know, with no accept at all:
--   * venue_memberships_insert: admin / user_manager of the venue
--   * event_organizers_insert_admin: admin of the event's venue
-- A membership (member leg) or an event_organizers row (organizer leg) opens the
-- target's whole profile through can_view_profile. With a user id (which the audit
-- trail of a decline hands to the company's admins) that bypassed the accept rule.
-- This closes the root.
--
-- 1. venue_memberships_insert: platform admins only. Memberships now come from
--    exactly two SECURITY DEFINER functions, which bypass RLS and are unchanged:
--    accept_invite_for_caller (the invitee's own accept) and
--    create_venue_with_owner (a new company's first admin = the caller). No app
--    code inserts a membership with the user client (checked: the only direct
--    writers are service-role scripts, which bypass RLS).
-- 2. event_organizers_insert_admin: still an admin of the event's venue, and now
--    also the target must already be tied to that company: a member of that venue
--    (a team member put on an event), OR already an event organizer on another
--    event of the same venue (the returning-crew pool, assignOrganizer), OR the
--    caller is a platform admin. A stranger can still be added to an event only by
--    an invite they accept (accept_invite). The current policy from prod is the
--    base; only the target condition is added. The demo triggers
--    (refuse_demo_venue_new_member / refuse_demo_venue_new_crew /
--    refuse_demo_member_self_change) are untouched.
--
-- Why a helper function and not an inline subquery: the "already crew on another
-- event" test reads event_organizers from inside event_organizers' own policy,
-- which Postgres rejects as infinite recursion (42P17) through the table's select
-- policy. public.is_tied_to_venue() is SECURITY DEFINER so it reads past RLS, and
-- it answers ONLY for an admin of the venue asked about (or a platform admin):
-- for anyone else it returns false without looking. That is exactly what a venue
-- admin could already see through the select policies on that venue's memberships
-- and organizers, so it is not an oracle on other companies' people.
--
-- Grant matrix (revoke first, then grant): the new function is executable by
-- authenticated only (the policy calls it as the caller); anon and public get
-- nothing. The two tables keep their grants; the policies are the gate.

-- ── helper ──────────────────────────────────────────────────────────────────
create function public.is_tied_to_venue(p_venue_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_venue_role(p_venue_id, '{admin}'::public.venue_role[])
     and (
       exists (
         select 1 from public.venue_memberships m
         where m.venue_id = p_venue_id and m.user_id = p_user_id
       )
       or exists (
         select 1
         from public.event_organizers eo
         join public.events e on e.id = eo.event_id
         where e.venue_id = p_venue_id and eo.user_id = p_user_id
       )
     );
$$;

comment on function public.is_tied_to_venue(uuid, uuid) is
  'RLS helper for event_organizers_insert_admin (20261007150200): true when p_user_id is a member of, or already crew on an event of, p_venue_id. Answers only for an admin of that venue (or a platform admin); false for everyone else without reading anything.';

revoke execute on function public.is_tied_to_venue(uuid, uuid) from public, anon;
grant execute on function public.is_tied_to_venue(uuid, uuid) to authenticated;

-- ── policies ────────────────────────────────────────────────────────────────
alter policy venue_memberships_insert on public.venue_memberships
  with check (public.is_platform_admin());

alter policy event_organizers_insert_admin on public.event_organizers
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and (
      public.is_platform_admin()
      or public.is_tied_to_venue(public.event_venue(event_id), user_id)
    )
  );
