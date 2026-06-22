-- S2.1 — Auto-contact (part 2/2): grow the venue address book automatically when
-- a guest is added to an event gastenlijst, and back-link guests.contact_id.
--
-- Today only the address-book "+" (add_contact_to_event), import (upsert_contacts),
-- permanent sync and the landing form (submit_guest_request) put a guest in
-- contacts. A plain add (quick-add #33 / bulk-paste / landing-approve) leaves
-- contact_id null, so those guests never reach the address book. This BEFORE
-- INSERT trigger closes that gap for ALL insert paths at once (audit/quota live in
-- the DB, #4/#5 — so this does too, rather than per-call-site app code).
--
-- Rules (decided with Max):
--   * Only when the guest has an e-mail OR phone. Name-only guests get NO contact
--     — they have no dedup key, so they would pile up duplicates (the trap Max saw
--     on import). Dedup uses the SAME normalised keys as upsert_contacts /
--     submit_guest_request / the contacts unique indexes: e-mail first, else phone.
--   * Never double-create: if new.contact_id is already set (address-book "+",
--     permanent sync), do nothing. The landing path doesn't set contact_id but
--     submit_guest_request already made the contact, so the e-mail/phone dedup
--     links to it instead of making a second one.
--   * AVG (#29): skip anonymized rows entirely — never create or touch a contact
--     for a guest that is already scrubbed.
--   * The contact is venue-scoped via event_venue(new.event_id).
--   * BEFORE INSERT sets new.contact_id in one write. The contact creation shares
--     the guest's transaction, so a guest that later fails (quota / tier-max in the
--     AFTER triggers) rolls its auto-contact back too — no orphan contacts.
--
-- SECURITY DEFINER: a staff add must still grow the address book even though staff
-- lack a direct contacts INSERT under RLS (20260615130000). The function is the
-- only thing that writes the contact, on the actor's behalf; auth.uid() still
-- attributes the contact's audit row to the real actor.

create or replace function public.guests_autolink_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue      uuid;
  v_email_norm text;
  v_phone_dig  text;
  v_contact_id uuid;
begin
  -- Already linked (address-book "+", permanent sync) or AVG-scrubbed → leave it.
  if new.contact_id is not null or new.anonymized_at is not null then
    return new;
  end if;

  -- Need a dedup key. Same normalisation as the contacts generated columns +
  -- upsert_contacts, so import / request-capture / auto-contact all agree on
  -- "the same person". Name-only → no key → no contact.
  v_email_norm := nullif(lower(btrim(coalesce(new.email, ''))), '');
  v_phone_dig  := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
  if v_email_norm is null and v_phone_dig is null then
    return new;
  end if;

  select venue_id into v_venue from public.events where id = new.event_id;
  if v_venue is null then
    return new;
  end if;

  -- Dedup: e-mail first, else phone digits (ignoring anonymised contacts, so an
  -- AVG-scrubbed contact's freed key can be re-claimed — mirrors the unique indexes).
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

  -- No match → create the contact. A concurrent insert can win the race on the
  -- partial unique index; treat that as "already there" and re-read by the key.
  if v_contact_id is null then
    begin
      insert into public.contacts (venue_id, full_name, email, phone, source, created_by)
      values (v_venue, new.full_name, new.email, new.phone, 'guest_list', (select auth.uid()))
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

  -- Back-link, UNLESS another LIVE guest on this event already holds this contact
  -- (the guests_event_contact_uidx partial unique index). In that rare case leave
  -- the guest unlinked so a duplicate add never fails — the contact still exists.
  if v_contact_id is not null
     and not exists (
       select 1 from public.guests g
        where g.event_id = new.event_id
          and g.contact_id = v_contact_id
          and g.status <> 'removed'
          and g.id <> new.id
     ) then
    new.contact_id := v_contact_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.guests_autolink_contact() from public, anon;

-- BEFORE the audit/quota AFTER triggers, so the audited row already carries
-- contact_id and the auto-contact is part of the same (atomic) insert.
create trigger autolink_contact_before_insert
  before insert on public.guests
  for each row execute function public.guests_autolink_contact();
