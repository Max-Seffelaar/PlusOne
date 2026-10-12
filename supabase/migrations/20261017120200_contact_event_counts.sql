-- Snelheid P2, finding 6 (docs/perf-audit-2026-10.md; ClickUp z8uq9m2xz2, 9-FE).
--
-- The address book ("X× on a list") and the Guests tab's "Regulars" filter
-- counted each contact's distinct events in the browser: the client downloaded
-- every guest row (contact_id, event_id) for the venue's contacts, in a
-- sequential loop over 120-id `.in()` chunks, each chunk ranged by 1000 rows.
-- At 3 000 contacts that is ~28 sequential round-trips before the list renders.
--
-- This RPC does the same count as ONE GROUP BY on the database:
--   * SECURITY INVOKER — it reads public.guests (and public.contacts for the
--     permanent-only filter) under the caller's own RLS, so the result is
--     role-relative exactly like the client loop was: an event organizer counts
--     only the events they can see, staff/doorhost (no contacts SELECT) get no
--     rows when p_permanent_only is set and only what guests RLS already shows
--     them otherwise — never more than a direct PostgREST read of guests gives.
--   * venue-scoped in SQL (guests.venue_id, denormalized in 20260708120000) —
--     no id list crosses the wire, so no 414 at any venue size.
--   * same semantics as the loop it replaces: distinct events per contact over
--     non-removed guest rows.
--   * p_permanent_only narrows the result to starred contacts (the Regulars
--     filter); the join uses contacts_venue_permanent_idx.
--
-- Ordered by contact_id so the client can page it with .range() past 1 000 rows.
-- New function in public → explicit execute grant matrix (CLAUDE.md
-- Conventions): nothing for public/anon, authenticated + service_role only.

create function public.contact_event_counts(
  p_venue_id uuid,
  p_permanent_only boolean default false
)
returns table (contact_id uuid, event_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.contact_id, count(distinct g.event_id)::int as event_count
    from public.guests g
   where g.venue_id = p_venue_id
     and g.contact_id is not null
     and g.status <> 'removed'
     and (
       not p_permanent_only
       or exists (
         select 1
           from public.contacts c
          where c.id = g.contact_id
            and c.venue_id = p_venue_id
            and c.is_permanent
       )
     )
   group by g.contact_id
   order by g.contact_id;
$$;

revoke execute on function public.contact_event_counts(uuid, boolean) from public, anon;
grant execute on function public.contact_event_counts(uuid, boolean) to authenticated, service_role;
