-- Security: go-live hardening — periodic cleanup of landing_request_throttle
-- (ClickUp 86ey2czr6, point 1/3).
--
-- landing_request_throttle (20260614100000) holds one row per throttle key
-- (ip_hash, now prefixed per-surface since 20260706102000: 'req:'/'pv:'/'st:'/'if:')
-- and is written on every anonymous hit to the public landing/request-link surfaces.
-- Nothing has ever pruned it, so on a live venue it grows without bound. The table
-- carries no PII (ip_hash is a hash of the IP, not the IP itself — spec §5), so this
-- is a pure housekeeping job, not an AVG retention concern.
--
-- Every window used against this table today is well under 2 hours (submit=15min,
-- pageview/status/influencer windows are all <=60min per 20260706102000/103000): once
-- a row's updated_at is more than 2 hours old it can never again affect a
-- consume_public_throttle() decision, so it is safe to delete outright.
--
-- Same shape as the existing AVG retention job (20260614230000, decisions #16/#29):
-- a SECURITY DEFINER function not callable by any app role, scheduled via pg_cron,
-- guarded so `supabase db reset` stays green even where the local image does not
-- preload pg_cron.

create or replace function public.cleanup_landing_request_throttle()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.landing_request_throttle
  where updated_at < now() - interval '2 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Internal only — landing_request_throttle is already service_role-only (no anon/
-- authenticated table privilege); this function stays owner-only on top of that.
revoke execute on function public.cleanup_landing_request_throttle()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schedule — pg_cron, best-effort and guarded, mirroring 20260614230000.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-throttle-cleanup',
        '0 * * * *', -- hourly; well within the 2h retention window, no overlap risk
        'select public.cleanup_landing_request_throttle();');
      raise notice 'pg_cron: scheduled plusone-throttle-cleanup (hourly).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.cleanup_landing_request_throttle() hourly by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.cleanup_landing_request_throttle() hourly by other means.';
  end if;
end;
$$;
