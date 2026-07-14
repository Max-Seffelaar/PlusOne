-- Widen promote_guest_to_contact()'s gate — everyone but finance (86ey9e880 follow-up).
--
-- 20260714120000 closed the cross-tenant hole by copying mark_guest_regular /
-- add_contacts_to_event's predicate: admin of the venue, or an organizer of an
-- event at it. Those two siblings read/mutate the shared contacts table
-- directly (contacts_insert/update, 20260615130000), so they inherit its
-- manager-only boundary — but that's the wrong sibling to copy here.
--
-- promote_guest_to_contact only ever touches ONE guest the caller can already
-- see and edit; it doesn't grant any new visibility into the address book.
-- guests_autolink_contact (20260622130100) already does the exact same kind of
-- write for that reason, deliberately SECURITY DEFINER so "a staff add must
-- still grow the address book even though staff lack a direct contacts INSERT
-- under RLS". Decided with Max: every venue role may promote a guest to a
-- contact except finance (finance stays read-only everywhere in the PII/
-- contacts domain, consistent with contacts_select granting it read but never
-- insert/update). A user holding finance alongside another role still
-- qualifies via that other role (#8 — roles are a set, never a single value).

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
  -- Resolve the guest + its venue (DEFINER bypasses RLS, so the authorization
  -- check below is the boundary — not this read).
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

  -- Authorization: every venue role except a pure finance membership, or an
  -- organizer of an event at the venue.
  if not (
    public.has_venue_role(v_venue, '{admin,user_manager,staff,doorhost}'::public.venue_role[])
    or public.organizes_event_at_venue(v_venue)
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
