-- Sessie C — Guest-request → adresboek-capture (#8).
--
-- The public request form gains a birthdate, and a submission now CAPTURES the
-- requester into the venue address book (contacts, source=guest_request) so the
-- venue can re-add them later + get stats — even before any approval, and even
-- on a silently-deduped duplicate request. Capture happens only when there is a
-- dedup key (e-mail or phone); name-only requests are not captured (they cannot
-- be deduped, mirroring the request dedupe_key rule). On approval, the created
-- guest is linked back to that contact via guests.contact_id.
--
-- The confirmation e-mail ("je staat op de lijst") stays OUT OF SCOPE — outbound
-- is parked (spec #10, revisit after pilot).
--
-- submit_guest_request runs as anon via SECURITY DEFINER, so it writes contacts
-- past the manager-only RLS without granting anon any contacts privilege.

alter table public.guest_requests
  add column birthdate date;

comment on column public.guest_requests.birthdate is
  'Optionele geboortedatum (#8). Mee gevangen in het adresboek (contacts) bij indienen.';

-- ---------------------------------------------------------------------------
-- submit_guest_request — + birthdate + address-book capture
-- ---------------------------------------------------------------------------

drop function if exists public.submit_guest_request(text, text, text, text, integer, text, text, boolean);

create function public.submit_guest_request(
  p_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_plus_ones integer,
  p_motivation text,
  p_ip_hash text,
  p_marketing_opt_in boolean,
  p_birthdate date default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_min   constant integer := 10;
  max_per_win  constant integer := 10;
  v_event_id   uuid;
  v_venue      uuid;
  v_name       text := nullif(btrim(p_full_name), '');
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := nullif(btrim(p_phone), '');
  v_phone_dig  text;
  v_motivation text := nullif(btrim(p_motivation), '');
  v_plus       integer := least(greatest(coalesce(p_plus_ones, 0), 0), 20);
  v_marketing  boolean := coalesce(p_marketing_opt_in, false);
  v_key        text;
  v_count      integer;
  v_contact_id uuid;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    return 'invalid';
  end if;
  if v_motivation is not null and char_length(v_motivation) > 1000 then
    v_motivation := left(v_motivation, 1000);
  end if;

  select e.id into v_event_id
  from public.events e
  where e.landing_slug = p_slug
    and e.landing_active
    and e.status <> 'closed';
  if v_event_id is null then
    return 'closed';
  end if;

  if p_ip_hash is not null then
    insert into public.landing_request_throttle as t (ip_hash, window_started_at, request_count)
    values (p_ip_hash, now(), 1)
    on conflict (ip_hash) do update
      set request_count = case
            when t.window_started_at < now() - make_interval(mins => window_min) then 1
            else t.request_count + 1
          end,
          window_started_at = case
            when t.window_started_at < now() - make_interval(mins => window_min) then now()
            else t.window_started_at
          end,
          updated_at = now()
    returning t.request_count into v_count;

    if v_count > max_per_win then
      return 'rate_limited';
    end if;
  end if;

  -- Dedup fingerprint: e-mail, else phone digits (same normalisation as contacts).
  v_phone_dig := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  v_key := coalesce(v_email, v_phone_dig);

  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation, marketing_opt_in, dedupe_key, birthdate)
    values
      (v_event_id, v_name, v_email, v_phone, v_plus, v_motivation, v_marketing, v_key, p_birthdate);
  exception when unique_violation then
    null; -- silent dedup
  end;

  -- #8: capture into the venue address book. Only with a dedup key (e-mail or
  -- phone); name-only requests are not captured (cannot be deduped). Runs even on
  -- a duplicate request — the address book is independent of request dedup.
  if v_email is not null or v_phone_dig is not null then
    v_venue := public.event_venue(v_event_id);
    begin
      v_contact_id := null;
      if v_email is not null then
        select id into v_contact_id from public.contacts
         where venue_id = v_venue and anonymized_at is null and email_norm = v_email
         limit 1;
      end if;
      if v_contact_id is null and v_phone_dig is not null then
        select id into v_contact_id from public.contacts
         where venue_id = v_venue and anonymized_at is null and phone_norm = v_phone_dig
         limit 1;
      end if;

      if v_contact_id is not null then
        -- Fill blanks only; never overwrite known data.
        update public.contacts set
          email = coalesce(email, v_email),
          phone = coalesce(phone, v_phone),
          birthdate = coalesce(birthdate, p_birthdate)
        where id = v_contact_id;
      else
        insert into public.contacts (venue_id, full_name, email, phone, birthdate, source, created_by)
        values (v_venue, v_name, v_email, v_phone, p_birthdate, 'guest_request', null);
      end if;
    exception when unique_violation then
      null; -- concurrent capture; ignore
    end;
  end if;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- approve_guest_request — link the created guest back to the captured contact
-- ---------------------------------------------------------------------------

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
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003', message = 'Deze aanvraag is al afgehandeld.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  if not exists (
    select 1 from public.guest_tiers gt
    where gt.id = p_tier_id and gt.event_id = v_req.event_id
  ) then
    raise exception using errcode = '23514', message = 'Kies een geldige tier voor dit event.';
  end if;

  -- #8: find the address-book contact captured at submit time, to link it.
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

  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones, contact_id, added_by, source, status)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_req.plus_ones, v_contact_id, (select auth.uid()), 'landing', 'approved')
  returning id into v_guest_id;

  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id;

  return v_guest_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges — re-establish for the new submit signature; approve unchanged sig.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date)
from public, anon, authenticated, service_role;

grant execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date)
to anon, authenticated, service_role;
