-- Feedback (Joeri/Max, 1 jul 2026) — T3 tiers editor: Free/Paid + VAT-%.
--
-- Adds a display-only VAT percentage next to door_price_cents (20260624180000 /
-- 20260625010000). A tier is "Paid" in the UI iff door_price_cents is set; VAT
-- only makes sense on a paid tier, so it's constrained to require a price.
-- Still no payment processing (#34) — this is copy shown next to the price,
-- default 9% (NL verlaagd tarief voor entree) chosen in the UI, not enforced here.

alter table public.guest_tiers
  add column vat_percent numeric(4, 1)
    check (vat_percent is null or (vat_percent >= 0 and vat_percent <= 100)),
  add constraint guest_tiers_vat_requires_price
    check (vat_percent is null or door_price_cents is not null);

comment on column public.guest_tiers.vat_percent is
  'Display-only VAT percentage for a paid tier — no billing/payment processing (#34). NULL unless door_price_cents is set.';

alter table public.event_template_tiers
  add column vat_percent numeric(4, 1)
    check (vat_percent is null or (vat_percent >= 0 and vat_percent <= 100)),
  add constraint event_template_tiers_vat_requires_price
    check (vat_percent is null or door_price_cents is not null);

comment on column public.event_template_tiers.vat_percent is
  'Display-only VAT percentage carried into guest_tiers on create_event_from_template. NULL unless door_price_cents is set.';

-- ---------------------------------------------------------------------------
-- create_event_from_template: carry vat_percent into guest_tiers.
-- Body otherwise unchanged from 20260625010000_template_tier_door_price.sql.
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
      (event_id, name, description, color, max_guests, aliases, door_price_cents, vat_percent)
    values
      (v_event_id, v_tier.name, v_tier.description, v_tier.color,
       v_tier.max_guests, v_tier.aliases, v_tier.door_price_cents, v_tier.vat_percent);
  end loop;

  return v_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_template_from_event: fix a pre-existing bug where the tier snapshot
-- silently dropped door_price_cents (20260624093000_create_template_from_event.sql
-- predates the door_price_cents column), and carry vat_percent along too.
-- Rest of the function is unchanged.
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
    (venue_id, name, capacity, allow_uncheck, landing_active, auto_lock_offset_minutes)
  values
    (v_event.venue_id, btrim(p_name), v_event.capacity, v_event.allow_uncheck,
     v_event.landing_active, v_offset)
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
