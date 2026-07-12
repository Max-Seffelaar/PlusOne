-- Quick-add duplicate safeguard (ClickUp 86ey8w7ek).
--
-- WHY. The add-guest duplicate check was purely client-side: it indexed the
-- FULL fetched guest list of the event and compared the typed name in JS. At
-- thousands of guests that list loads slowly (ranged, 1000/req), and until it
-- lands the submit button is live with NO duplicate warning at all — in
-- practice the same guest got added 3-5×. The server had no safeguard either.
--
-- FIX. One indexed, RLS-scoped point lookup the quick-add calls at submit
-- time, independent of whether/when the list loaded. Not a unique constraint:
-- two different guests may legitimately share a name — the UI asks ("add
-- anyway"), the database only needs to answer fast.

-- Case-insensitive, whitespace-tolerant name lookup per event. btrim on BOTH
-- sides (input AND stored column — full_name has no whitespace constraint, so
-- padded legacy rows are real and must stay findable; review finding 12/7).
-- Partial: `removed` rows never count as duplicates (soft delete #21) and
-- stay out of the index.
create index guests_event_lower_name_idx
  on public.guests (event_id, lower(btrim(full_name)))
  where status <> 'removed';

-- SECURITY INVOKER on purpose: the lookup runs under the caller's own
-- guests_select policy, so a staff member only matches their OWN guests —
-- exactly the rows they may update, and exactly what the client-side index
-- (built from the RLS-scoped list read) matched before. Oldest match wins so
-- repeated "add anyway" duplicates keep pointing at the original row.
create or replace function public.find_event_guest_by_name(p_event_id uuid, p_name text)
returns table (id uuid, full_name text, plus_ones integer)
language sql
stable
set search_path = ''
as $$
  select g.id, g.full_name, g.plus_ones
    from public.guests g
   where g.event_id = p_event_id
     and lower(btrim(g.full_name)) = lower(btrim(p_name))
     and g.status <> 'removed'
   order by g.created_at, g.id
   limit 1;
$$;

revoke execute on function public.find_event_guest_by_name(uuid, text) from public, anon;
grant execute on function public.find_event_guest_by_name(uuid, text) to authenticated, service_role;
