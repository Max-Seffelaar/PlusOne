-- pgTAP — Places proxy rate limit (Onboarding A, z8uq9m2vg5),
-- 20261013130100_places_throttle.sql.
--
-- consume_places_throttle() is the only way the proxy route can spend from
-- the internal consume_public_throttle(). Allowed: every signed-in user (a
-- platform admin, every venue role, and a user with no company yet, who is in
-- onboarding). Denied: anon (no EXECUTE) and a session without a uid (42501).
-- The budget is per user: 120 per 10 minutes, and one user's spend never
-- touches another's. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(14);

-- Shape: definer, empty search_path, grants.
select is((select prosecdef from pg_proc where oid = 'public.consume_places_throttle()'::regprocedure),
          true, 'P1 consume_places_throttle is SECURITY DEFINER');
select ok((select proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.consume_places_throttle()'::regprocedure),
          'P2 with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.consume_places_throttle()', 'EXECUTE'),
          'P3 authenticated may execute it');
select ok(not has_function_privilege('anon', 'public.consume_places_throttle()', 'EXECUTE'),
          'P4 anon may not');
select ok(not has_function_privilege('service_role', 'public.consume_places_throttle()', 'EXECUTE'),
          'P5 service_role may not (the route calls it with the user''s session)');
select ok(not has_function_privilege('authenticated', 'public.consume_public_throttle(text, integer, integer)', 'EXECUTE'),
          'P6 the inner throttle stays internal');

-- Allowed: venue roles from the seed, and a user without any company.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(public.consume_places_throttle(), true, 'P7 admin@ (venue admin) is within budget');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(public.consume_places_throttle(), true, 'P8 staff@ is within budget');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(public.consume_places_throttle(), true, 'P9 door@ is within budget');
-- A uid with no membership at all (onboarding): the function never looks at venues.
select pg_temp.login('c3000000-0000-4000-8000-000000000001');
select is(public.consume_places_throttle(), true, 'P10 a user with no company yet is within budget');

-- Budget: 120 per user per window. The no-company user spent 1 above.
select is((select bool_and(public.consume_places_throttle()) from generate_series(1, 119)),
          true, 'P11 calls 2..120 are within budget');
select is(public.consume_places_throttle(), false, 'P12 call 121 is throttled');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(public.consume_places_throttle(), true, 'P13 another user''s budget is untouched');

-- Denied: an authenticated role without a uid.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$ select public.consume_places_throttle() $$, '42501', null,
  'P14 no uid in the session raises 42501');

select * from finish();
rollback;
