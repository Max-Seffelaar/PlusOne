-- mark_guest_regular(p_guest_id) — bulk "mark as regular" from the Guests tab (T11).
--
-- "Regular" lives on the address-book contact (contacts.is_permanent, #11): a
-- regular lands on every new guest list automatically. Marking a GUEST as regular
-- therefore means: ensure the guest is linked to a contact, then star that contact.
--
-- A name-only guest has no contact yet. Rather than making the caller promote each
-- one by hand, this function AUTO-PROMOTES a name-only guest to a name-only contact
-- (same logic as promote_guest_to_contact, 20260625100100) and then stars it — so a
-- bulk "mark as regular" over a mixed selection just works (decided with Max, 7/7).
--
-- SECURITY DEFINER because staff-role users lack a direct contacts INSERT/UPDATE
-- under RLS (20260615120000 / 20260615130000). Unlike promote_guest_to_contact this
-- one WRITES the is_permanent flag, so it self-guards the SAME predicate as the
-- contacts write policies: admin of the venue, OR organizer of an event at it.
-- Anyone else gets an insufficient-privilege error (42501), surfaced as "no rights".

create or replace function public.mark_guest_regular(p_guest_id uuid)
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
  -- Resolve the guest + its venue (DEFINER bypasses RLS, so the authorization
  -- check below is the boundary — not this read).
  select g.full_name, g.email, g.phone, g.event_id, e.venue_id, g.contact_id
    into v_full_name, v_email, v_phone, v_event_id, v_venue, v_contact_id
    from public.guests g
    join public.events e on e.id = g.event_id
   where g.id = p_guest_id
     and g.status <> 'removed'
     and g.anonymized_at is null;

  if not found then
    raise exception 'Guest not found or not accessible' using errcode = 'P0002';
  end if;

  -- Authorization: admin of the venue, or an organizer of an event at it — the
  -- exact predicate contacts_insert / contacts_update enforce (20260615130000).
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(v_venue)
  ) then
    raise exception 'Not allowed to manage regulars for this venue'
      using errcode = '42501';
  end if;

  -- Already linked → just star that contact.
  if v_contact_id is null then
    -- Promote a name-only guest: dedup by e-mail then phone (mirrors
    -- guests_autolink_contact / promote_guest_to_contact), else create name-only.
    v_email_norm := nullif(lower(btrim(coalesce(v_email, ''))), '');
    v_phone_dig  := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');

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

    if v_contact_id is null then
      begin
        insert into public.contacts (venue_id, full_name, email, phone, source, created_by)
        values (v_venue, v_full_name, v_email, v_phone, 'guest_list', auth.uid())
        returning id into v_contact_id;
      exception when unique_violation then
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

    -- Back-link the guest unless another live guest on the event already holds this
    -- contact (partial-unique guests_event_contact_uidx).
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
  end if;

  -- Star the contact (idempotent — re-marking an already-regular is a harmless no-op).
  if v_contact_id is not null then
    update public.contacts
       set is_permanent = true
     where id = v_contact_id
       and anonymized_at is null
       and is_permanent = false;
  end if;
end;
$$;

revoke execute on function public.mark_guest_regular(uuid) from public, anon;
grant  execute on function public.mark_guest_regular(uuid) to authenticated;
