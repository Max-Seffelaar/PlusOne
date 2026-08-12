-- pgTAP — go-live hardening: landing_request_throttle cleanup job (86ey2czr6).
-- Proves: the cleanup function deletes only rows older than the 2h window, stays
-- owner-only (no app-role EXECUTE), and — where pg_cron is available — that the
-- scheduled job actually exists (mirrors the guarded scheduling in the migration:
-- `supabase db reset` must stay green even on an image without pg_cron preloaded).

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

-- ---------------------------------------------------------------------------
-- A. privileges — owner-only, same posture as run_privacy_retention()
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.cleanup_landing_request_throttle()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.cleanup_landing_request_throttle()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.cleanup_landing_request_throttle()', 'EXECUTE'),
  'A1 cleanup function is owner-only (no app-role EXECUTE)');

-- ---------------------------------------------------------------------------
-- B. behaviour — deletes only rows past the 2h window
-- ---------------------------------------------------------------------------

insert into public.landing_request_throttle (ip_hash, window_started_at, request_count, updated_at) values
  ('test:stale-hash', now() - interval '3 hours', 5, now() - interval '3 hours'),
  ('test:fresh-hash', now(), 1, now());

select public.cleanup_landing_request_throttle();

select is(
  (select count(*)::int from public.landing_request_throttle where ip_hash = 'test:stale-hash'),
  0, 'B1 row older than 2h is deleted');

select is(
  (select count(*)::int from public.landing_request_throttle where ip_hash = 'test:fresh-hash'),
  1, 'B2 row within the window is kept');

-- ---------------------------------------------------------------------------
-- C. schedule — only checked where pg_cron is actually installed locally,
-- matching the migration's own guarded best-effort scheduling.
-- ---------------------------------------------------------------------------

select case
  when to_regclass('cron.job') is not null then
    (select is(
      (select count(*)::int from cron.job where jobname = 'plusone-throttle-cleanup'),
      1, 'C1 plusone-throttle-cleanup is scheduled in pg_cron'))
  else
    (select skip('pg_cron not installed on this instance'))
end;

select * from finish();

rollback;
