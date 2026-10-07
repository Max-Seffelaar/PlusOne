-- Templates keep the event location (z8uq9m2vqc follow-up, PR B).
--
-- Max's prod report ("an event from a template loses its location") traced to
-- Save as template: event_templates had no location, so create_template_from_event
-- dropped it and create_event_from_template could not set it. Event location
-- itself landed in 20261007120000_event_location.sql (spec #53).
--
-- 1. event_templates.location_name / location_address: nullable, expand-only,
--    the SAME length caps as events (120 / 200, mirrored in Zod). No RLS
--    change: the existing event_templates policies cover the new columns —
--    insert/update/delete = has_venue_role(admin) OR
--    organizes_event_at_venue(venue_id) (20260624091000), so an event-scoped
--    organizer can set a template location too, the same trust it already has
--    over capacity, tiers and landing_active. Grant matrix: event_templates carries TABLE-level grants
--    only (authenticated select/insert/update/delete — it is on the config
--    allowlist of grant_matrix.test.sql; no column-level grants exist), so the
--    new columns are covered by them; nothing to revoke or restate.
-- 2. create_template_from_event copies the event's location into the template.
-- 3. create_event_from_template puts the template's location on the new event.
--    Both stay SECURITY DEFINER, search_path '', same role checks, same
--    signatures (create or replace, no return-type change); the bodies below are
--    20260706140000_tier_vat_percent.sql with only the location columns added.
--    Grants restated as before: revoke from public/anon, grant to authenticated.

alter table public.event_templates
  add column location_name text,
  add column location_address text;

alter table public.event_templates
  add constraint event_templates_location_name_len
    check (location_name is null or char_length(location_name) <= 120),
  add constraint event_templates_location_address_len
    check (location_address is null or char_length(location_address) <= 200);

comment on column public.event_templates.location_name is
  'Per-template event location name (z8uq9m2vqc). Copied from / onto events by the two template RPCs. NULL = the company.';
comment on column public.event_templates.location_address is
  'Per-template event location address (z8uq9m2vqc). Copied from / onto events by the two template RPCs. NULL = the company.';

-- ---------------------------------------------------------------------------
-- create_event_from_template: the new event gets the template's location.
-- ---------------------------------------------------------------------------
create or replace function public.create_event_from_template(
  p_template_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tpl public.event_templates;
  v_event_id uuid;
  v_auto_lock timestamptz;
  v_tier public.event_template_tiers;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_tpl from public.event_templates where id = p_template_id;
  if v_tpl.id is null then
    raise exception using errcode = 'P0002', message = 'Template niet gevonden.';
  end if;

  if not public.has_venue_role(v_tpl.venue_id, '{admin}'::public.venue_role[]) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin mag een event aanmaken voor deze locatie.';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'event name required' using errcode = '23514';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'event end must be after start' using errcode = '23514';
  end if;

  v_auto_lock := case
    when v_tpl.auto_lock_offset_minutes is null then null
    else p_starts_at + make_interval(mins => v_tpl.auto_lock_offset_minutes)
  end;

  insert into public.events
    (venue_id, name, starts_at, ends_at, landing_slug, landing_active,
     capacity, allow_uncheck, auto_lock_at, location_name, location_address)
  values
    (v_tpl.venue_id, btrim(p_name), p_starts_at, p_ends_at, '', v_tpl.landing_active,
     v_tpl.capacity, v_tpl.allow_uncheck, v_auto_lock, v_tpl.location_name, v_tpl.location_address)
  returning id into v_event_id;

  for v_tier in
    select * from public.event_template_tiers
    where template_id = p_template_id
    order by position, created_at
  loop
    insert into public.guest_tiers
      (event_id, name, description, color, max_guests, aliases, door_price_cents, vat_percent)
    values
      (v_event_id, v_tier.name, v_tier.description, v_tier.color,
       v_tier.max_guests, v_tier.aliases, v_tier.door_price_cents, v_tier.vat_percent);
  end loop;

  return v_event_id;
end;
$$;

revoke execute on function public.create_event_from_template(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_event_from_template(uuid, text, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- create_template_from_event: the template keeps the event's location.
-- ---------------------------------------------------------------------------
create or replace function public.create_template_from_event(
  p_event_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_template_id uuid;
  v_offset int;
  v_tier public.guest_tiers;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception using errcode = 'P0002', message = 'Event niet gevonden.';
  end if;

  if not (
    public.has_venue_role(v_event.venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(v_event.venue_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator mag een template opslaan.';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'template name required' using errcode = '23514';
  end if;

  -- Absolute auto_lock_at → a start-relative offset (minutes); NULL stays NULL.
  v_offset := case
    when v_event.auto_lock_at is null then null
    else (extract(epoch from (v_event.auto_lock_at - v_event.starts_at)) / 60)::int
  end;

  insert into public.event_templates
    (venue_id, name, capacity, allow_uncheck, landing_active, auto_lock_offset_minutes,
     location_name, location_address)
  values
    (v_event.venue_id, btrim(p_name), v_event.capacity, v_event.allow_uncheck,
     v_event.landing_active, v_offset, v_event.location_name, v_event.location_address)
  returning id into v_template_id;

  -- Snapshot the event's tiers into the template (venue_id stamped by the trigger).
  for v_tier in
    select * from public.guest_tiers where event_id = p_event_id order by created_at
  loop
    insert into public.event_template_tiers
      (template_id, name, description, color, max_guests, aliases, door_price_cents, vat_percent)
    values
      (v_template_id, v_tier.name, v_tier.description, v_tier.color,
       v_tier.max_guests, v_tier.aliases, v_tier.door_price_cents, v_tier.vat_percent);
  end loop;

  return v_template_id;
end;
$$;

revoke execute on function public.create_template_from_event(uuid, text) from public, anon;
grant execute on function public.create_template_from_event(uuid, text) to authenticated;
