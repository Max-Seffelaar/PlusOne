-- Event location (z8uq9m2vqc, onboarding programme Oct 2026, task 1).
--
-- An event can name its own location: a company that organizes in other
-- places (a festival, an organizer, a club doing an off-site night) sets it
-- per event; left empty, the app falls back to the company's own address
-- (one helper: src/features/po/adapters.ts `resolveEventLocation`).
--
-- 1. Two nullable text columns, expand-only. No RLS change: the existing
--    events policies (events_insert_admin, events_update_admin_organizer, the
--    member SELECT) cover them, and `events` carries TABLE-level grants only
--    (authenticated: select/insert/update; anon: nothing since 20260707170000;
--    no column-level grants exist on the table), so the new columns are covered
--    by those grants without restating anything. The length caps mirror the Zod
--    schema in src/features/events/schemas.ts.
--
-- 2. get_landing_event (the ONLY anon path to event data, C3) gains exactly
--    two output columns: the event's OWN location_name / location_address, raw
--    (NULL when unset). It deliberately does NOT fall back to the company
--    address: spec #48(c) withholds venues.address_line/postal_code/city from
--    the public until a request is approved ("not guaranteed a public place").
--    The event's own location is different — the organizer typed it for this
--    event, next to a hint that the public request page shows it. Body,
--    predicate (C4 throttle first, request_link_open) and the existing five
--    columns are unchanged. A RETURNS TABLE change cannot be done with
--    CREATE OR REPLACE, so drop + create inside this migration's transaction
--    (same pattern as 20261006150000); the grant matrix is restated in full,
--    identical to before: anon / authenticated / service_role, nobody else.

alter table public.events
  add column location_name text,
  add column location_address text;

alter table public.events
  add constraint events_location_name_len
    check (location_name is null or char_length(location_name) <= 120),
  add constraint events_location_address_len
    check (location_address is null or char_length(location_address) <= 200);

comment on column public.events.location_name is
  'Optional per-event location name (z8uq9m2vqc). NULL = the company''s own place. Shown in the app and on the public request page (get_landing_event).';
comment on column public.events.location_address is
  'Optional per-event location address (z8uq9m2vqc). NULL = fall back to the company address in the app; the public request page never falls back (spec #48(c)).';

drop function if exists public.get_landing_event(text, text);

create function public.get_landing_event(p_slug text, p_ip_hash text)
returns table (
  event_name text,
  starts_at  timestamptz,
  via_label  text,
  -- Remaining approvable headcount on a CAPPED link (0 = full); NULL when the
  -- link has no max — then nothing about capacity is disclosed (#28/#43).
  spots_left integer,
  venue_name text,
  -- The event's OWN location, raw; NULL when unset. Never the company address.
  location_name text,
  location_address text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same budget as record_link_pageview (a venue's door WiFi NATs many phones
  -- behind one IP). Burns first, so probing costs budget even on a closed slug.
  if not public.consume_public_throttle('slug:' || p_ip_hash, 15, 60) then
    return;
  end if;

  return query
  select
    e.name,
    e.starts_at,
    case when rl.is_default then null
         else coalesce(i.name, rl.label) end,
    case when rl.max_headcount is null then null
         else greatest(rl.max_headcount - public.request_link_consumption(rl.id), 0) end,
    v.name,
    e.location_name,
    e.location_address
  from public.request_links rl
  join public.events e on e.id = rl.event_id
  join public.venues v on v.id = e.venue_id
  left join public.influencers i on i.id = rl.influencer_id
  where rl.slug = p_slug
    and public.request_link_open(rl);
end;
$$;

revoke execute on function public.get_landing_event(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_landing_event(text, text)
to anon, authenticated, service_role;
