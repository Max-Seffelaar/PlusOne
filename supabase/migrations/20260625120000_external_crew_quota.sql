-- External crew get a real guest quota (ClickUp 86ey21vre, refines #22/#31).
--
-- Until now an EVENT ORGANIZER was quota-EXEMPT (unlimited guest adds), same as a
-- venue admin (user_is_quota_exempt, fase-7 quota engine). The product model has
-- shifted: venue Team members already work every event via their roles, so the
-- "organizer" scope is now used only for EXTERNAL crew (a DJ, artist, guest
-- organizer added to one event). Those people must add guests within an explicit
-- limit, not unlimited.
--
-- Change: only a venue ADMIN stays quota-exempt. An organizer (external crew) now
-- gets a real personal limit, resolved the normal way:
--   event_quotas.quota_override ?? quotas.default_count (none for a non-member) ?? 0.
-- So the add-crew flow sets an event_quotas override; with none, the limit is 0.
--
-- RLS is unchanged (event_quotas / event_organizers writes are already admin
-- role-only since 20260624160000); this only edits the exemption predicate the
-- enforcement trigger + the UI counter consult.

create or replace function public.user_is_quota_exempt(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Admin of the event's venue only. Organizers (external crew) are NOT exempt —
  -- they carry an explicit event_quotas override (see #22/#31, 86ey21vre).
  select exists (
    select 1
    from public.events e
    join public.venue_memberships m on m.venue_id = e.venue_id
    where e.id = p_event_id
      and m.user_id = p_user_id
      and m.roles && '{admin}'::public.venue_role[]
  );
$$;

-- Internal math stays internal (mirrors the fase-7 grant matrix). CREATE OR REPLACE
-- preserves the existing revoke, but re-assert it so the privilege intent is explicit.
revoke execute on function public.user_is_quota_exempt(uuid, uuid)
  from public, anon, authenticated, service_role;
