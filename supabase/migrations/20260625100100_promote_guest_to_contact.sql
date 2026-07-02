-- promote_guest_to_contact(p_guest_id) — explicit user-initiated contact creation.
--
-- The auto-link trigger (20260622130100 + 20260624170000) requires an e-mail or
-- phone to deduplicate. That is correct for the automated path (name-only contacts
-- would pile up duplicates on import). But when a staff member deliberately taps
-- "Save as contact" on a name-only guest's profile, they want to create a
-- contact even without a dedup key — it's an intentional action.
--
-- This function closes that gap by:
--   1. Deduping by e-mail / phone if present (same logic as guests_autolink_contact).
--   2. Creating a name-only contact if no match (source = 'guest_list').
--   3. Back-linking guests.contact_id in the same call.
--
-- SECURITY DEFINER because staff-role users lack a direct contacts INSERT under RLS
-- (20260615120000); the function self-guards: caller must be the guest's venue
-- member, verified via the RLS on the guests read.
--
-- Called by the promoteGuestToContact server action when email + phone are both
-- absent (the updateGuest path already handles the email/phone case via the trigger).

create or replace function public.promote_guest_to_contact(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name  text;
  v_email      text;
  v_phone      text;
  v_event_id   uuid;
  v_venue      uuid;
  v_email_norm text;
  v_phone_dig  text;
  v_contact_id uuid;
begin
  -- Read the guest through the user-scoped view so RLS enforces membership:
  -- if the caller can't see this guest, this raises a no-data-found (not a
  -- permission leak — the function just no-ops on bad IDs).
  select g.full_name, g.email, g.phone, g.event_id, e.venue_id
    into v_full_name, v_email, v_phone, v_event_id, v_venue
    from public.guests g
    join public.events e on e.id = g.event_id
   where g.id = p_guest_id
     and g.status <> 'removed'
     and g.anonymized_at is null;

  if not found then
    raise exception 'Guest not found or not accessible' using errcode = 'P0002';
  end if;

  -- Already linked → nothing to do.
  -- Re-read contact_id separately so the SECURITY DEFINER context sees it.
  if exists (select 1 from public.guests where id = p_guest_id and contact_id is not null) then
    return;
  end if;

  -- Normalise dedup keys (mirrors guests_autolink_contact exactly).
  v_email_norm := nullif(lower(btrim(coalesce(v_email, ''))), '');
  v_phone_dig  := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');

  -- 1. Try to find an existing contact by e-mail, then phone.
  if v_email_norm is not null then
    select id into v_contact_id
      from public.contacts
     where venue_id = v_venue and anonymized_at is null and email_norm = v_email_norm
     limit 1;
  end if;
  if v_contact_id is null and v_phone_dig is not null then
    select id into v_contact_id
      from public.contacts
     where venue_id = v_venue and anonymized_at is null and phone_norm = v_phone_dig
     limit 1;
  end if;

  -- 2. No match → create. Accepts name-only (no e-mail / phone) unlike the
  --    auto-link trigger; this is the whole point of the explicit promote action.
  if v_contact_id is null then
    begin
      insert into public.contacts (venue_id, full_name, email, phone, source, created_by)
      values (v_venue, v_full_name, v_email, v_phone, 'guest_list', auth.uid())
      returning id into v_contact_id;
    exception when unique_violation then
      -- Race: another session won the race on the same dedup key. Re-read it.
      if v_email_norm is not null then
        select id into v_contact_id from public.contacts
         where venue_id = v_venue and anonymized_at is null and email_norm = v_email_norm limit 1;
      end if;
      if v_contact_id is null and v_phone_dig is not null then
        select id into v_contact_id from public.contacts
         where venue_id = v_venue and anonymized_at is null and phone_norm = v_phone_dig limit 1;
      end if;
    end;
  end if;

  -- 3. Back-link the guest, unless another live guest on the event already holds
  --    this contact (partial-unique index guests_event_contact_uidx).
  if v_contact_id is not null
     and not exists (
       select 1 from public.guests g
        where g.event_id = v_event_id
          and g.contact_id = v_contact_id
          and g.status <> 'removed'
          and g.id <> p_guest_id
     ) then
    update public.guests set contact_id = v_contact_id where id = p_guest_id;
  end if;
end;
$$;

revoke execute on function public.promote_guest_to_contact(uuid) from public, anon;
grant  execute on function public.promote_guest_to_contact(uuid) to authenticated;
