-- pgTAP — rate-limit hardening 1/3 (86ey2czr6): landing_request_throttle
-- cleanup. Proves the sweep deletes only rows past the 2h staleness window
-- and stays owner-only (no app-role EXECUTE, matching run_privacy_retention).
-- Run: supabase test db. Rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

-- ---------------------------------------------------------------------------
-- Fixtures: one stale row (untouched 3h), one fresh row (touched 10min ago),
-- one right at the edge (touched 2h ago minus a second — still fresh).
-- ---------------------------------------------------------------------------

insert into public.landing_request_throttle (ip_hash, window_started_at, request_count, updated_at) values
  ('test:stale',  now() - interval '3 hours',           5, now() - interval '3 hours'),
  ('test:fresh',  now() - interval '10 minutes',         2, now() - interval '10 minutes'),
  ('test:edge',   now() - interval '1 hour 59 minutes',  1, now() - interval '1 hour 59 minutes');

select is(
  (select count(*)::int from public.landing_request_throttle where ip_hash like 'test:%'),
  3, 'A1 fixtures present before cleanup');

select is(
  public.cleanup_landing_request_throttle(), 1,
  'A2 cleanup reports exactly one deleted row');

select is(
  (select count(*)::int from public.landing_request_throttle where ip_hash = 'test:stale'),
  0, 'A3 the stale row is gone');

select is(
  (select count(*)::int from public.landing_request_throttle where ip_hash in ('test:fresh', 'test:edge')),
  2, 'A4 fresh and edge rows survive');

select ok(
  not has_function_privilege('anon', 'public.cleanup_landing_request_throttle()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.cleanup_landing_request_throttle()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.cleanup_landing_request_throttle()', 'EXECUTE'),
  'A5 cleanup is owner-only (no app-role EXECUTE)');

select * from finish();
rollback;
