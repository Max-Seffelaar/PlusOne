-- Fase 8b — Landingpage: marketing-toestemming + telefoon mét landcode.
--
-- Refinements on the fase-8 aanvraagflow (20260614100000_landing_request_flow):
--   1. guest_requests.marketing_opt_in — expliciete AVG-toestemming om de
--      contactgegevens voor marketing te gebruiken ("houd me op de hoogte").
--      Default false (opt-in, nooit aangevinkt vooraf).
--   2. submit_guest_request krijgt een extra parameter p_marketing_opt_in.
--      De signatuur wijzigt, dus de fase-8-functie wordt gedropt en opnieuw
--      aangemaakt (geen overload). Telefoonnummers worden door de app al als
--      E.164 (+<landcode><nummer>) aangeleverd; de RPC slaat ze ongewijzigd op.

alter table public.guest_requests
  add column marketing_opt_in boolean not null default false;

comment on column public.guest_requests.marketing_opt_in is
  'AVG-toestemming: mag de aanvrager voor marketing benaderd worden ("houd me op de hoogte"). Default false; alleen true als de aanvrager dit expliciet aanvinkt.';

-- Replace the fase-8 function with the marketing-aware version.
drop function if exists public.submit_guest_request(text, text, text, text, integer, text, text);

create function public.submit_guest_request(
  p_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_plus_ones integer,
  p_motivation text,
  p_ip_hash text,
  p_marketing_opt_in boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_min   constant integer := 10;   -- fixed-window length (minutes)
  max_per_win  constant integer := 10;    -- max submissions per window per IP
  v_event_id   uuid;
  v_name       text := nullif(btrim(p_full_name), '');
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := nullif(btrim(p_phone), '');
  v_phone_dig  text;
  v_motivation text := nullif(btrim(p_motivation), '');
  v_plus       integer := least(greatest(coalesce(p_plus_ones, 0), 0), 20);
  v_marketing  boolean := coalesce(p_marketing_opt_in, false);
  v_key        text;
  v_count      integer;
begin
  -- Minimal server-side guard (the app's Zod schema is the primary one).
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    return 'invalid';
  end if;
  if v_motivation is not null and char_length(v_motivation) > 1000 then
    v_motivation := left(v_motivation, 1000);
  end if;

  -- Resolve the event by slug, but ONLY while its landing link is open. A
  -- closed/unknown slug is indistinguishable → no enumeration (#28).
  select e.id into v_event_id
  from public.events e
  where e.landing_slug = p_slug
    and e.landing_active
    and e.status <> 'closed';
  if v_event_id is null then
    return 'closed';
  end if;

  -- Rate limit per IP (fixed window). Atomic upsert; the window resets once it
  -- has elapsed. A null ip_hash (no client IP) skips throttling.
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

  -- Dedup fingerprint: e-mail, else phone digits. Name-only stays NULL (never
  -- auto-deduped). Phone normalised to digits so "+31 6 12" == "+31612".
  v_phone_dig := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
  v_key := coalesce(v_email, v_phone_dig);

  -- Insert. The partial unique index makes a second identical PENDING request a
  -- unique_violation, which we swallow → the caller cannot tell "new" from
  -- "duplicate" (#28). Race-proof: the index, not a read-then-write, decides.
  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation, marketing_opt_in, dedupe_key)
    values
      (v_event_id, v_name, v_email, v_phone, v_plus, v_motivation, v_marketing, v_key);
  exception when unique_violation then
    null; -- silent dedup
  end;

  return 'ok';
end;
$$;

-- Re-establish the fase-8 privilege surface for the new signature.
revoke execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean)
from public, anon, authenticated, service_role;

grant execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean)
to anon, authenticated, service_role;
