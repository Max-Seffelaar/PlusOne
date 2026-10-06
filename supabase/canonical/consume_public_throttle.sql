-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20261006170000_public_throttle_bind_raw_callers.sql:93.

create or replace function public.consume_public_throttle(
  p_key        text,
  p_window_min integer,
  p_max        integer
)
returns boolean -- true = within budget, false = rate-limited
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key    text := p_key;
  v_prefix text;
  v_secret text;
  v_count  integer;
begin
  if v_key is null then
    -- Only a raw caller passing p_ip_hash => null gets here (the app always
    -- sends a hash). One shared bucket instead of no throttle at all.
    v_key := 'anon:~untrusted';
  else
    v_prefix := split_part(v_key, ':', 1);
    -- Prefixes whose key embeds a CALLER-SUPPLIED p_ip_hash. Server-derived
    -- keys (e.g. 'pinv:' || auth.uid()) are not in the list and are untouched.
    if v_prefix in ('req', 'pv', 'st', 'if', 'slug')
       and exists (select 1 from public.public_throttle_trusted_callers) then
      v_secret := nullif(current_setting('request.headers', true), '')::json
                  ->> 'x-plusone-throttle-trust';
      if v_secret is null or not exists (
        select 1
        from public.public_throttle_trusted_callers c
        where c.secret_sha256 = extensions.digest(v_secret, 'sha256')
      ) then
        v_key := v_prefix || ':~untrusted';
      end if;
    end if;
  end if;

  insert into public.landing_request_throttle as t
    (ip_hash, window_started_at, request_count)
  values (v_key, now(), 1)
  on conflict (ip_hash) do update
    set request_count = case
          when t.window_started_at < now() - make_interval(mins => p_window_min)
            then 1
          else t.request_count + 1
        end,
        window_started_at = case
          when t.window_started_at < now() - make_interval(mins => p_window_min)
            then now()
          else t.window_started_at
        end,
        updated_at = now()
  returning t.request_count into v_count;

  return v_count <= p_max;
end;
$$;
