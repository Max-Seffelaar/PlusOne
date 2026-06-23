-- Fix (#8 regression): restore the address-book contact-link on guest-request
-- approval. The 20260621120000_reapprove_denied_request migration redefined
-- approve_guest_request branching off the STALE 20260614100000 base (its own
-- comment: "The ONLY change vs 20260614100000 is the status guard"), which
-- silently dropped the contact-linking that 20260615170000_guest_request_birthdate
-- had added — so approved landing guests stopped linking to their captured contact
-- (pgTAP contacts.capture D2: guests.contact_id came back NULL).
--
-- This re-creates the function combining BOTH:
--   * the #12 re-approval status guard from 20260621120000 (accept 'pending' AND
--     'denied'; reject only an already-'approved' request; clear the denial reason),
--   * the #8 contact lookup + (event,contact) collision guard + contact_id INSERT
--     from 20260615170000.
-- Signature + SECURITY DEFINER + search_path unchanged, so the fase-8 GRANT stands.

create or replace function public.approve_guest_request(
  p_request_id uuid,
  p_tier_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req        public.guest_requests;
  v_venue      uuid;
  v_guest_id   uuid;
  v_contact_id uuid;
  v_email_norm text;
  v_phone_dig  text;
begin
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;
  -- #12: a denied request may still be approved later; only a request that already
  -- produced a guest is truly "done".
  if v_req.status = 'approved' then
    raise exception using errcode = '45003', message = 'Deze aanvraag staat al op de lijst.';
  end if;

  -- #12 / role matrix §2: admin (venue) or organizer (this event) only.
  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  -- The tier must belong to THIS event (composite FK enforces it too; pre-check
  -- gives clean Dutch copy instead of a raw FK violation).
  if not exists (
    select 1 from public.guest_tiers gt
    where gt.id = p_tier_id and gt.event_id = v_req.event_id
  ) then
    raise exception using errcode = '23514', message = 'Kies een geldige tier voor dit event.';
  end if;

  -- #8: re-link the address-book contact captured at submit time (RESTORED).
  v_email_norm := nullif(lower(btrim(v_req.email)), '');
  v_phone_dig := nullif(regexp_replace(coalesce(v_req.phone, ''), '[^0-9]', '', 'g'), '');
  if v_email_norm is not null then
    select id into v_contact_id from public.contacts
     where venue_id = v_venue and anonymized_at is null and email_norm = v_email_norm limit 1;
  end if;
  if v_contact_id is null and v_phone_dig is not null then
    select id into v_contact_id from public.contacts
     where venue_id = v_venue and anonymized_at is null and phone_norm = v_phone_dig limit 1;
  end if;
  -- If that contact is already on this event (e.g. permanent sync), don't collide
  -- on the (event, contact) unique index — approve without the link.
  if v_contact_id is not null and exists (
    select 1 from public.guests g
    where g.event_id = v_req.event_id and g.contact_id = v_contact_id and g.status <> 'removed'
  ) then
    v_contact_id := null;
  end if;

  -- Create the guest. added_by = the approver, source='landing' so it never
  -- charges their quota (#31). enforce_guest_quota still applies tier-max.
  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones, contact_id, added_by, source, status)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_req.plus_ones, v_contact_id, (select auth.uid()), 'landing', 'approved')
  returning id into v_guest_id;

  -- Flip the request → approved, clearing any prior denial reason. Fires
  -- audit_guest_requests ('approve').
  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_reason = null
  where id = p_request_id;

  return v_guest_id;
end;
$$;
