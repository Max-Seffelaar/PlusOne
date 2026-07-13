-- Bulk duplicate safeguard (ClickUp 86ey8xg4p — follow-up to 86ey8w7ek).
--
-- WHY. The quick-add duplicate check (migration 20260712120000) is one indexed
-- point lookup at submit time. Bulk-paste and the name-only path of
-- "add-to-event" still ran the OLD client-only pattern: dedupe against the
-- fetched guest list in JS. At a big/not-yet-loaded event that list read can
-- lag or truncate, so the same 3-5x-duplication incident (86ey8w7ek) could
-- still happen there. Contact-linked adds are unaffected — add_contact_to_event
-- / add_contacts_to_event already insert idempotently via the
-- (event_id, contact_id) partial unique constraint.
--
-- FIX. A set-based sibling of find_event_guest_by_name: one query that matches
-- many pasted/candidate names at once instead of N point lookups. Same
-- SECURITY INVOKER + soft-delete-aware semantics; "oldest match wins" per name
-- carries over so repeated "add anyway" duplicates keep resolving to the
-- original row.

create or replace function public.find_event_guests_by_names(p_event_id uuid, p_names text[])
returns table (id uuid, full_name text, plus_ones integer)
language sql
stable
set search_path = ''
as $$
  select distinct on (lower(btrim(g.full_name)))
         g.id, g.full_name, g.plus_ones
    from public.guests g
   where g.event_id = p_event_id
     and g.status <> 'removed'
     -- Callers chunk to <=100 names per call; this cap is defense-in-depth
     -- against a hand-crafted oversized array, not the primary guard.
     and coalesce(array_length(p_names, 1), 0) between 1 and 200
     and lower(btrim(g.full_name)) = any (
           select lower(btrim(x)) from unnest(p_names) as x
         )
   order by lower(btrim(g.full_name)), g.created_at, g.id;
$$;

revoke execute on function public.find_event_guests_by_names(uuid, text[]) from public, anon;
grant execute on function public.find_event_guests_by_names(uuid, text[]) to authenticated, service_role;
