-- Fix ownership-bypass regression from 20260714130000 (fresh-session /security-review).
--
-- 20260714130000 widened the gate to `has_venue_role(admin,user_manager,staff,
-- doorhost) or organizes_event_at_venue`, reasoning it mirrored
-- guests_autolink_contact's "staff can grow the address book" carve-out. That
-- reasoning didn't hold: guests_autolink_contact fires on the actor's OWN row
-- being inserted, so a caller can never target someone else's existing guest
-- through it. promote_guest_to_contact takes an arbitrary caller-chosen
-- p_guest_id — reviewed and CONFIRMED (high confidence) that a plain staff
-- member could pass ANY guest UUID at their venue, including one added by a
-- colleague/doorhost/admin, and the DEFINER bypass would read that guest's
-- PII and write contacts/guests.contact_id on a row they don't own — staff's
-- real guests_select/guests_update boundary is added_by = auth.uid()-scoped
-- (20260613120000_rls_policies.sql), not venue-wide.
--
-- Fix: staff only qualifies when they added the specific target guest,
-- mirroring guests_update's own predicate exactly. admin/doorhost/organizer
-- stay venue-wide — they already have venue-wide guests_select/guests_update
-- access, so no new exposure there.
--
-- Also drops user_manager from the allow-list (decided with Max): the spec's
-- role matrix (gastenlijst-app-spec.md §2) explicitly marks user_manager "—"
-- for both guest visibility and guest edit — it has zero guest/contacts
-- access anywhere else in the schema, and an ownership-scoped grant would
-- have been a no-op anyway (user_manager can never be added_by on a guest;
-- can_write_guests never grants it insert rights). "Everyone but finance"
-- narrows to "every role that already touches guests, except finance."

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
  v_added_by   uuid;
  v_email_norm text;
  v_phone_dig  text;
  v_contact_id uuid;
begin
  -- Resolve the guest + its venue (DEFINER bypasses RLS, so the authorization
  -- check below is the boundary — not this read).
  select g.full_name, g.email, g.phone, g.event_id, e.venue_id, g.added_by
    into v_full_name, v_email, v_phone, v_event_id, v_venue, v_added_by
    from public.guests g
    join public.events e on e.id = g.event_id
   where g.id = p_guest_id
     and g.status <> 'removed'
     and g.anonymized_at is null;

  if not found then
    raise exception 'Guest not found or not accessible' using errcode = 'P0002';
  end if;

  -- Authorization: admin/doorhost already have venue-wide guest RLS access, as
  -- does an organizer of this event. Staff's guest RLS access is scoped to
  -- guests they added — mirror that here rather than granting venue-wide
  -- access to a role whose real boundary is per-guest ownership.
  if not (
    public.has_venue_role(v_venue, '{admin,doorhost}'::public.venue_role[])
    or public.organizes_event_at_venue(v_venue)
    or (
      public.has_venue_role(v_venue, '{staff}'::public.venue_role[])
      and v_added_by = auth.uid()
    )
  ) then
    raise exception 'Not allowed to promote guests to contacts for this venue'
      using errcode = '42501';
  end if;

  -- Already linked → nothing to do.
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
