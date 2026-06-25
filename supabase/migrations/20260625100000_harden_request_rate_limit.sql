-- Security: harden submit_guest_request rate limit (#12/#28)
--
-- Two fixes in this migration; the function signature is unchanged.
--
-- Fix 1 — Rate limit BEFORE slug resolution.
--   Previously the rate-limit upsert ran AFTER the slug lookup. A bot could
--   therefore probe unlimited slugs (each returning 'closed') without ever
--   consuming its rate-limit budget. Moving the check first means every
--   attempt — valid slug or not — burns quota.
--
-- Fix 2 — Tighten window constants.
--   window_min 10 → 15 min, max_per_win 10 → 5.
--   Peak throughput per IP: 60 req/hr → 20 req/hr. Still sufficient for
--   legitimate error-retry (one real guest submits once; 5 retries/15 min
--   is generous).
--
-- The rest of the body (input guard, contact capture, dedup) is unchanged
-- from 20260615170000_guest_request_birthdate. Only the two constants and
-- the ordering of the rate-limit block vs. the slug lookup differ.

drop function if exists
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date);

create function public.submit_guest_request(
  p_slug            text,
  p_full_name       text,
  p_email           text,
  p_phone           text,
  p_plus_ones       integer,
  p_motivation      text,
  p_ip_hash         text,
  p_marketing_opt_in boolean,
  p_birthdate       date default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fix 2: tightened from 10 min / 10 per window.
  window_min   constant integer := 15;
  max_per_win  constant integer := 5;
  v_event_id   uuid;
  v_venue      uuid;
  v_name       text    := nullif(btrim(p_full_name), '');
  v_email      text    := nullif(lower(btrim(p_email)), '');
  v_phone      text    := nullif(btrim(p_phone), '');
  v_phone_dig  text;
  v_motivation text    := nullif(btrim(p_motivation), '');
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

  -- Fix 1: rate limit FIRST, before slug resolution. Previously non-existent
  -- slugs returned 'closed' before this block ran, so a bot could probe slugs
  -- indefinitely without burning any quota. Now every attempt — known or not —
  -- consumes a slot. A null ip_hash (not sent by the app in practice) skips
  -- throttling and cannot be bucketed.
  if p_ip_hash is not null then
    insert into public.landing_request_throttle as t
      (ip_hash, window_started_at, request_count)
    values (p_ip_hash, now(), 1)
    on conflict (ip_hash) do update
      set request_count = case
            when t.window_started_at < now() - make_interval(mins => window_min)
              then 1
            else t.request_count + 1
          end,
          window_started_at = case
            when t.window_started_at < now() - make_interval(mins => window_min)
              then now()
            else t.window_started_at
          end,
          updated_at = now()
    returning t.request_count into v_count;

    if v_count > max_per_win then
      return 'rate_limited';
    end if;
  end if;

  -- Slug resolution runs AFTER rate limit so non-existent slug probes burn quota.
  -- Closed/unknown slugs are still indistinguishable (#28, no enumeration).
  select e.id into v_event_id
  from public.events e
  where e.landing_slug = p_slug
    and e.landing_active
    and e.status <> 'closed';
  if v_event_id is null then
    return 'closed';
  end if;

  -- Dedup fingerprint: e-mail, else phone digits (same normalisation as contacts).
  v_phone_dig := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  v_key := coalesce(v_email, v_phone_dig);

  -- Insert. The partial unique index makes a duplicate pending request a
  -- unique_violation, swallowed silently — caller cannot tell new from dedup (#28).
  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation,
       marketing_opt_in, dedupe_key, birthdate)
    values
      (v_event_id, v_name, v_email, v_phone, v_plus, v_motivation,
       v_marketing, v_key, p_birthdate);
  exception when unique_violation then
    null; -- silent dedup
  end;

  -- #8: capture into the venue address book. Only when there is a dedup key
  -- (e-mail or phone); name-only requests are not captured.
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
          email     = coalesce(email,     v_email),
          phone     = coalesce(phone,     v_phone),
          birthdate = coalesce(birthdate, p_birthdate)
        where id = v_contact_id;
      else
        insert into public.contacts
          (venue_id, full_name, email, phone, birthdate, source, created_by)
        values
          (v_venue, v_name, v_email, v_phone, p_birthdate, 'guest_request', null);
      end if;
    exception when unique_violation then
      null; -- concurrent capture; ignore
    end;
  end if;

  return 'ok';
end;
$$;

-- Re-establish the same privilege surface as the previous version.
revoke execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date)
from public, anon, authenticated, service_role;

grant execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date)
to anon, authenticated, service_role;
