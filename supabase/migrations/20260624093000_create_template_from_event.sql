-- Event templates · save-as-template (86exyp8gn). The reverse of
-- create_event_from_template: snapshot an EXISTING event's setup (its tiers +
-- capacity + default settings) into a new reusable template. SECURITY DEFINER
-- (mirrors create_event_from_template / create_venue_with_owner): auth.uid() stays
-- the actor so the template/tier creation is audited correctly, and it reads the
-- event's guest_tiers past RLS.
--
-- Authorisation: template management is admin OR a venue-organizer
-- (organizes_event_at_venue) — the same gate as the event_templates RLS. An
-- organizer of THIS event satisfies it (they organize an event at the venue).

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
      (template_id, name, description, color, max_guests, aliases)
    values
      (v_template_id, v_tier.name, v_tier.description, v_tier.color,
       v_tier.max_guests, v_tier.aliases);
  end loop;

  return v_template_id;
end;
$$;

revoke execute on function public.create_template_from_event(uuid, text) from public, anon;
grant execute on function public.create_template_from_event(uuid, text) to authenticated;
