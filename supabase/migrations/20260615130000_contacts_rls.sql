-- Sessie C — Adresboek RLS + staff reuse-search (#11, access decision).
--
-- Decision (this session): "staff reuse, PII for managers".
--   * Direct contacts reads (which expose e-mail / phone / birthdate), inserts
--     and updates are for ADMIN + (event) ORGANIZER; FINANCE reads. Staff and
--     doorhost get NO direct table access — RLS denies them.
--   * Staff/doorhost still REUSE the address book when adding guests, via
--     search_contacts_for_reuse(): a SECURITY DEFINER RPC that returns names +
--     role + event-count ONLY (never PII), so the "herbruik in één tik" flow
--     works without exposing the venue's whole CRM to a hired promoter.
--
-- "organizer" here means: holds an event-organizer scope on at least one event
-- of this venue (organizes_event_at_venue), consistent with how organizers are
-- granted venue visibility elsewhere (fase 2).

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy contacts_select on public.contacts
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

-- Anonymised rows are frozen for app roles (#29), like guests.
create policy contacts_update on public.contacts
  for update to authenticated
  using (
    anonymized_at is null
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or public.organizes_event_at_venue(venue_id)
    )
  )
  with check (
    anonymized_at is null
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or public.organizes_event_at_venue(venue_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Staff reuse-search — PII-free address-book lookup for any venue member.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read contacts past the manager-only SELECT policy,
-- but it returns a deliberately narrow projection (id, full_name, preferred_role,
-- event_count) and self-guards: the caller must be a member of, or organize an
-- event at, the venue. Non-members get an empty result (no existence leak). The
-- event_count powers the "X× op een lijst" stat shown in the Adresboek list.

create or replace function public.search_contacts_for_reuse(p_venue_id uuid, p_query text default null)
returns table (
  id uuid,
  full_name text,
  preferred_role public.contact_role,
  event_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.full_name,
    c.preferred_role,
    (
      select count(distinct g.event_id)::int
      from public.guests g
      where g.contact_id = c.id and g.status <> 'removed'
    )
  from public.contacts c
  where c.venue_id = p_venue_id
    and c.anonymized_at is null
    -- Authorisation gate: any member or an organizer at this venue.
    and (public.is_venue_member(p_venue_id) or public.organizes_event_at_venue(p_venue_id))
    and (
      p_query is null
      or btrim(p_query) = ''
      or c.full_name ilike '%' || btrim(p_query) || '%'
    )
  order by c.full_name
  limit 50;
$$;

revoke execute on function public.search_contacts_for_reuse(uuid, text) from public, anon;
grant execute on function public.search_contacts_for_reuse(uuid, text) to authenticated, service_role;
