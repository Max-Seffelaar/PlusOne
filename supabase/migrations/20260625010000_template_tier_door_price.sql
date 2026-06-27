-- Template tier door price (86ey21vna).
--
-- Adds door_price_cents to event_template_tiers so that prices set on a template
-- carry over to guest_tiers when an event is created from that template (the
-- create_event_from_template RPC, part 3/3). Mirrors the guest_tiers column added
-- in 20260624180000_tier_door_price.sql — same semantics: euro cents, NULL = free,
-- display-only (no payment processing, #34).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.event_template_tiers
  add column door_price_cents integer check (door_price_cents is null or door_price_cents >= 0);

-- ---------------------------------------------------------------------------
-- Update create_event_from_template to seed the price into guest_tiers.
-- The rest of the function is unchanged; only the tier INSERT gains the column.
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
     capacity, allow_uncheck, auto_lock_at)
  values
    (v_tpl.venue_id, btrim(p_name), p_starts_at, p_ends_at, '', v_tpl.landing_active,
     v_tpl.capacity, v_tpl.allow_uncheck, v_auto_lock)
  returning id into v_event_id;

  for v_tier in
    select * from public.event_template_tiers
    where template_id = p_template_id
    order by position, created_at
  loop
    insert into public.guest_tiers
      (event_id, name, description, color, max_guests, aliases, door_price_cents)
    values
      (v_event_id, v_tier.name, v_tier.description, v_tier.color,
       v_tier.max_guests, v_tier.aliases, v_tier.door_price_cents);
  end loop;

  return v_event_id;
end;
$$;
