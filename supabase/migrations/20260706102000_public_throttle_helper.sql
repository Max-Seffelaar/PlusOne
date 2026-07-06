-- Requests-epic F1 · part 3/4 — Generalized public-endpoint throttle.
--
-- The fixed-window rate limiter built for submit_guest_request (#28, hardened in
-- 20260625100000) is needed by three more anon surfaces in this epic: pageview
-- recording, the guest status page and (F2) the influencer stats page. Rather
-- than four copies of the upsert, ONE helper consumes from the existing
-- landing_request_throttle table with a PREFIXED key ('req:'/'pv:'/'st:'/'if:' +
-- ip_hash), so every surface gets its own independent window per IP.
--
-- Existing un-prefixed rows simply orphan and stop being touched — no data
-- migration needed (the table holds only transient counters, no PII).

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
  v_count integer;
begin
  -- No key (no client IP) cannot be bucketed → skip throttling, same stance as
  -- the original inline block.
  if p_key is null then
    return true;
  end if;

  insert into public.landing_request_throttle as t
    (ip_hash, window_started_at, request_count)
  values (p_key, now(), 1)
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

-- Internal only: called from the SECURITY DEFINER public RPCs, never directly.
revoke execute on function public.consume_public_throttle(text, integer, integer)
from public, anon, authenticated, service_role;
