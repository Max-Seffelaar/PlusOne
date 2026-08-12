-- Rate-limit hardening 1/3 (86ey2czr6) — landing_request_throttle cleanup.
--
-- consume_public_throttle (20260706102000) upserts one row per prefixed
-- ip_hash key ('req:'/'pv:'/'st:'/'if:'/'slug:' + hash) and never deletes
-- anything — the table grows forever even though a row is dead weight the
-- moment its window has expired. Every current caller passes window_min=15
-- (submit_guest_request tightened 10→15 in 20260625100000; pageview/status/
-- influencer-stats/slug-resolve all followed at 15 too — see the comment on
-- consume_public_throttle below for where that ceiling is enforced). A daily
-- sweep would still let stale rows sit for up to 24h during an active abuse
-- window, so this runs hourly and drops anything untouched for 2h —
-- comfortably past every current window with margin. Not indexed: the
-- DELETE is a sequential scan over updated_at, which stays cheap only
-- because this sweep is what keeps the table small in the first place — an
-- index would just be dead weight on a table with no other query pattern.
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

-- Records the ceiling this cleanup job imposes, at the function future
-- callers will actually look at when adding a new throttled surface.
comment on function public.consume_public_throttle(text, integer, integer) is
  'Fixed-window per-IP throttle (20260706102000). p_window_min must stay well '
  'under 2h: cleanup_landing_request_throttle (20260812120000) deletes any row '
  'idle >2h, so a window close to or past that ceiling would let its own '
  'counter get swept mid-window.';

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
