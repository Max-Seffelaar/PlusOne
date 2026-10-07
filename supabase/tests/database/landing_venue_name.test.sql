-- pgTAP — get_landing_event exposes the venue name to anon (Legal v0.3 B2,
-- z8uq9m2hm4) and nothing else new. Seed: event ee..01 (venue aa..01, Club Vesper).
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('role', 'anon', true);

select is(
  (select venue_name from public.get_landing_event('plusone-launch-night', 'ip-lvn')),
  'Club Vesper',
  'anon resolves the venue name through the sanctioned RPC');

select is(
  pg_get_function_result('public.get_landing_event(text, text)'::regprocedure),
  'TABLE(event_name text, starts_at timestamp with time zone, via_label text, spots_left integer, venue_name text, location_name text, location_address text)',
  'the result is venue_name + the event-location pair (z8uq9m2vqc) and no other column');

select is(
  (select count(*)::int from public.get_landing_event('does-not-exist', 'ip-lvn')),
  0, 'an unknown slug still returns nothing (no venue-name oracle)');

select throws_ok(
  $$ select name from public.venues $$,
  '42501', null,
  'anon still has no direct read on venues');

reset role;

select ok(
  has_function_privilege('anon', 'public.get_landing_event(text, text)', 'execute'),
  'grant matrix unchanged: anon may execute');

select ok(
  not has_function_privilege('public', 'public.get_landing_event(text, text)', 'execute')
  or (select bool_or(a.grantee = 0) from pg_proc p, aclexplode(p.proacl) a
       where p.oid = 'public.get_landing_event(text, text)'::regprocedure) is not true,
  'PUBLIC holds no EXECUTE on get_landing_event');

select * from finish();
rollback;
