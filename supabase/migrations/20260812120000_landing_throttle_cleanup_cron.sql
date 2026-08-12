-- Rate-limit hardening 1/3 (86ey2czr6) — landing_request_throttle cleanup.
--
-- consume_public_throttle (20260706102000) upserts one row per prefixed
-- ip_hash key ('req:'/'pv:'/'st:'/'if:' + hash) and never deletes anything —
-- the table grows forever even though a row is dead weight the moment its
-- window has expired (worst case: harden_request_rate_limit's window is 10
-- minutes). A daily sweep would still let stale rows sit for up to 24h during
-- an active abuse window, so this runs hourly and drops anything untouched
-- for 2h — comfortably past every current window with margin, cheap on an
-- indexed PK-only table.
create or replace function public.cleanup_landing_request_throttle()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.landing_request_throttle
    where updated_at < now() - interval '2 hours'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- Internal only: the cron job runs it as owner, no app role needs it.
revoke execute on function public.cleanup_landing_request_throttle()
from public, anon, authenticated, service_role;

-- Guarded like run_privacy_retention's schedule (20260614230000) so
-- `supabase db reset` always passes even where the local image doesn't
-- preload pg_cron.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-landing-throttle-cleanup',
        '0 * * * *',
        'select public.cleanup_landing_request_throttle();');
      raise notice 'pg_cron: scheduled plusone-landing-throttle-cleanup (hourly).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.cleanup_landing_request_throttle() hourly by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.cleanup_landing_request_throttle() hourly by other means.';
  end if;
end;
$$;
