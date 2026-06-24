-- Event templates · part 3/3 — create_event_from_template (86exyp8gn).
--
-- Atomically create an event from a template and seed its tiers + capacity + default
-- settings in ONE transaction (no half-seeded events — the whole function body
-- commits or rolls back together). SECURITY DEFINER, mirroring create_venue_with_owner
-- (20260615000000): auth.uid() stays the real actor, so the audit trigger attributes
-- the event + tier creation correctly, and the existing events_set_landing_slug
-- BEFORE trigger generates a collision-free slug (it sees every venue past RLS — no
-- SECURITY-INVOKER visibility gap that could pick a colliding slug).
--
-- Authorisation: event creation is admin-only everywhere (events_insert_admin), so
-- this RPC re-checks admin on the template's venue. Template MANAGEMENT is broader
-- (admin OR organizer, part 2), but creating the actual event stays admin-only — the
-- RPC must not become a side-door that lets organizers create events.

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

  -- Event creation is admin-only (events_insert_admin). This is the ONLY guard here
  -- (SECURITY DEFINER bypasses RLS); it sits beside the action's Zod + the user-client.
  if not public.has_venue_role(v_tpl.venue_id, '{admin}'::public.venue_role[]) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin mag een event aanmaken voor deze locatie.';
  end if;

  -- Defense in depth next to the Zod schema in the action.
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'event name required' using errcode = '23514';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'event end must be after start' using errcode = '23514';
  end if;

  -- auto-lock OFFSET (minutes, relative to start) → absolute instant. NULL stays NULL.
  v_auto_lock := case
    when v_tpl.auto_lock_offset_minutes is null then null
    else p_starts_at + make_interval(mins => v_tpl.auto_lock_offset_minutes)
  end;

  -- landing_slug '' → the fase-6 BEFORE trigger fills a unique slug. capacity +
  -- settings seeded from the template. Status defaults to draft (no went_live stamp).
  insert into public.events
    (venue_id, name, starts_at, ends_at, landing_slug, landing_active,
     capacity, allow_uncheck, auto_lock_at)
  values
    (v_tpl.venue_id, btrim(p_name), p_starts_at, p_ends_at, '', v_tpl.landing_active,
     v_tpl.capacity, v_tpl.allow_uncheck, v_auto_lock)
  returning id into v_event_id;

  -- Seed the tiers in template order (unique(event_id,name) holds — the template's
  -- own unique(template_id,name) guarantees no in-template dupes).
  for v_tier in
    select * from public.event_template_tiers
    where template_id = p_template_id
    order by position, created_at
  loop
    insert into public.guest_tiers (event_id, name, description, color, max_guests, aliases)
    values (v_event_id, v_tier.name, v_tier.description, v_tier.color, v_tier.max_guests, v_tier.aliases);
  end loop;

  return v_event_id;
end;
$$;

revoke execute on function public.create_event_from_template(uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.create_event_from_template(uuid, text, timestamptz, timestamptz)
  to authenticated;
