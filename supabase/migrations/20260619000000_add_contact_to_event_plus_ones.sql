-- S3 Adresboek — give the manual "add contact to event" path an optional
-- plus-ones count (the Adresboek "+" sheet asks "hoeveel extra plekken?"). It
-- mirrors add_guest's plus_ones; the quota trigger charges 1 + plus_ones
-- atomically on insert (#22), so a manager picking +2 spends 3 slots in one go.
--
-- We DROP the old 3-arg signature first and recreate with the new trailing
-- defaulted arg, so there is no overload ambiguity (a 3-arg call would otherwise
-- be "function is not unique"). Body is otherwise identical to 20260615150000.

drop function if exists public.add_contact_to_event(uuid, uuid, uuid);

create or replace function public.add_contact_to_event(
  p_contact_id uuid,
  p_event_id uuid,
  p_tier_id uuid default null,
  p_plus_ones integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid := public.event_venue(p_event_id);
  v_contact public.contacts;
  v_tier uuid;
  v_guest_id uuid;
begin
  if v_venue is null then
    raise exception using errcode = 'P0002', message = 'Event niet gevonden.';
  end if;

  select * into v_contact from public.contacts where id = p_contact_id;
  if v_contact.id is null or v_contact.venue_id <> v_venue or v_contact.anonymized_at is not null then
    raise exception using errcode = 'P0002', message = 'Contact niet gevonden in deze locatie.';
  end if;

  if not public.can_write_guests(p_event_id) then
    raise exception using errcode = '42501',
      message = 'Je mag geen gasten toevoegen aan dit event.';
  end if;

  -- A deliberate manual add overrides a prior "respect the removal" exclusion.
  delete from public.contact_event_exclusions
   where event_id = p_event_id and contact_id = p_contact_id;

  v_tier := coalesce(p_tier_id, public.resolve_tier_for_contact(p_event_id, v_contact.preferred_role));
  if v_tier is null then
    raise exception using errcode = 'P0002', message = 'Geen tier beschikbaar voor dit event.';
  end if;

  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones, contact_id, added_by, source, status)
  values
    (p_event_id, v_tier, v_contact.full_name, v_contact.email, v_contact.phone,
     greatest(coalesce(p_plus_ones, 0), 0), v_contact.id, (select auth.uid()), 'app', 'approved')
  on conflict (event_id, contact_id) where contact_id is not null and status <> 'removed'
    do nothing
  returning id into v_guest_id;

  -- Already on the list (idempotent): return the existing live guest id. (We do
  -- not retro-edit plus_ones on a re-add — change it from the gastenlijst.)
  if v_guest_id is null then
    select id into v_guest_id from public.guests
     where event_id = p_event_id and contact_id = p_contact_id and status <> 'removed'
     limit 1;
  end if;

  return v_guest_id;
end;
$$;

revoke execute on function public.add_contact_to_event(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.add_contact_to_event(uuid, uuid, uuid, integer) to authenticated, service_role;
