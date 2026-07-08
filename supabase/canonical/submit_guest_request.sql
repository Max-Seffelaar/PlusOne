-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20260624200000_event_lifecycle_capacity.sql:256.

create or replace function public.submit_guest_request(
  p_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_plus_ones integer,
  p_motivation text,
  p_ip_hash text
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
  v_name       text := nullif(btrim(p_full_name), '');
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := nullif(btrim(p_phone), '');
  v_phone_dig  text;
  v_motivation text := nullif(btrim(p_motivation), '');
  v_plus       integer := least(greatest(coalesce(p_plus_ones, 0), 0), 20);
  v_key        text;
  v_count      integer;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    return 'invalid';
  end if;
  if v_motivation is not null and char_length(v_motivation) > 1000 then
    v_motivation := left(v_motivation, 1000);
  end if;

  -- Resolve the event by slug, but ONLY while its landing link is open and the
  -- event is not cancelled. A cancelled/unknown slug is indistinguishable → no
  -- enumeration (#28).
  select e.id into v_event_id
  from public.events e
  where e.landing_slug = p_slug
    and e.landing_active
    and e.cancelled_at is null;
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

  v_phone_dig := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
  v_key := coalesce(v_email, v_phone_dig);

  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation, dedupe_key)
    values
      (v_event_id, v_name, v_email, v_phone, v_plus, v_motivation, v_key);
  exception when unique_violation then
    null; -- silent dedup
  end;

  return 'ok';
end;
$$;
