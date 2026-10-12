-- pgTAP — user_profiles.analytics_opt_out_at (20261018120000): the in-app
-- product-analytics opt-out (PostHog, decision 1 of 2026-07-06).
--
-- Claims:
--   A. Grant matrix: authenticated may UPDATE the column, may not SELECT or
--      INSERT it; anon holds nothing on it.
--   B. Per role (admin, manager, finance, organizer, staff, door): a user sets
--      AND clears the column on their own row (both directions)...
--   C. ...and never on anyone else's — not a colleague in the same company,
--      not as a platform admin. RLS filters the row: 0 rows, value unchanged.
--   D. The owner reads it back through my_profile(), and only their own.
--   E. A direct SELECT of the column is refused (42501), so no colleague
--      learns who opted out.
--
-- Everything rolls back.

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

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

-- The value on a row, read as the table owner (bypasses grants + RLS).
create function pg_temp.opt_out_of(p_user uuid)
returns timestamptz language sql security definer as $fn$
  select analytics_opt_out_at from public.user_profiles where id = p_user;
$fn$;

-- As p_actor, try to set the column on p_target's row. Returns the rows the
-- statement touched (0 when RLS filters the row out).
create function pg_temp.try_set(p_actor uuid, p_target uuid, p_value timestamptz)
returns int language plpgsql as $fn$
declare
  n int;
begin
  perform pg_temp.login(p_actor);
  update public.user_profiles set analytics_opt_out_at = p_value where id = p_target;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  return n;
end;
$fn$;


select plan(38);

-- Seed (supabase/seed.sql): all six share venue 1 (Club Vesper).
--   admin 1111…  manager 2222…  finance 3333…  organizer 4444…  staff 5555…  door 6666…
-- Plus one platform admin who is a member of nothing.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', 'a8000000-0000-4000-8000-0000000000a1',
  'authenticated', 'authenticated', 'ao-platform@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "Ao Platform"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);
insert into public.user_profiles (id, full_name, email)
values ('a8000000-0000-4000-8000-0000000000a1', 'Ao Platform', 'ao-platform@plusone.test')
on conflict (id) do nothing;
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'a8000000-0000-4000-8000-0000000000a1';
select set_config('plusone.platform_admin_write', 'off', true);

-- ---------------------------------------------------------------------------
-- A. Shape + grant matrix
-- ---------------------------------------------------------------------------

select col_type_is('public', 'user_profiles', 'analytics_opt_out_at', 'timestamp with time zone',
  'A1 analytics_opt_out_at is a timestamptz');
select col_is_null('public', 'user_profiles', 'analytics_opt_out_at',
  'A2 …nullable (null = tracked)');
select ok(has_column_privilege('authenticated', 'public.user_profiles', 'analytics_opt_out_at', 'UPDATE'),
  'A3 authenticated may UPDATE the column (RLS scopes the row)');
select ok(not has_column_privilege('authenticated', 'public.user_profiles', 'analytics_opt_out_at', 'SELECT'),
  'A4 authenticated may NOT SELECT it (colleagues would see who opted out)');
select ok(not has_column_privilege('authenticated', 'public.user_profiles', 'analytics_opt_out_at', 'INSERT'),
  'A5 authenticated may NOT INSERT it (a new row starts null = tracked)');
select ok(
  not has_column_privilege('anon', 'public.user_profiles', 'analytics_opt_out_at', 'SELECT')
  and not has_column_privilege('anon', 'public.user_profiles', 'analytics_opt_out_at', 'UPDATE'),
  'A6 anon holds nothing on it');
select is(
  (select pg_get_function_result('public.my_profile()'::regprocedure) like '%analytics_opt_out_at timestamp with time zone%'),
  true,
  'A7 my_profile() returns analytics_opt_out_at');
select ok(
  has_function_privilege('authenticated', 'public.my_profile()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_profile()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.my_profile()', 'EXECUTE')
  and (select prosecdef from pg_proc where oid = 'public.my_profile()'::regprocedure),
  'A8 recreated my_profile keeps its shape: SECURITY DEFINER, EXECUTE authenticated only');

-- ---------------------------------------------------------------------------
-- B. Own row, every role, both directions
-- ---------------------------------------------------------------------------

select is(pg_temp.try_set('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '2026-10-18 10:00+00'), 1,
  'B1 admin opts out on their own row');
select is(pg_temp.opt_out_of('11111111-1111-4111-8111-111111111111'), '2026-10-18 10:00+00'::timestamptz,
  'B2 …and it is stored');
select is(pg_temp.try_set('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '2026-10-18 10:00+00'), 1,
  'B3 manager opts out on their own row');
select is(pg_temp.try_set('33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', '2026-10-18 10:00+00'), 1,
  'B4 finance opts out on their own row');
select is(pg_temp.try_set('44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444', '2026-10-18 10:00+00'), 1,
  'B5 organizer opts out on their own row');
select is(pg_temp.try_set('55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', '2026-10-18 10:00+00'), 1,
  'B6 staff opts out on their own row');
select is(pg_temp.try_set('66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666', '2026-10-18 10:00+00'), 1,
  'B7 door opts out on their own row');
select is(pg_temp.opt_out_of('66666666-6666-4666-8666-666666666666'), '2026-10-18 10:00+00'::timestamptz,
  'B8 …and it is stored');
select is(pg_temp.try_set('a8000000-0000-4000-8000-0000000000a1', 'a8000000-0000-4000-8000-0000000000a1', '2026-10-18 10:00+00'), 1,
  'B9 a platform admin opts out on their own row');

-- The other direction: back on.
select is(pg_temp.try_set('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', null), 1,
  'B10 admin turns analytics back on (own row)');
select is(pg_temp.opt_out_of('11111111-1111-4111-8111-111111111111'), null::timestamptz,
  'B11 …and the column is null again');
select is(pg_temp.try_set('66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666', null), 1,
  'B12 door turns analytics back on (own row)');
select is(pg_temp.opt_out_of('66666666-6666-4666-8666-666666666666'), null::timestamptz,
  'B13 …and the column is null again');

-- ---------------------------------------------------------------------------
-- C. Never on another row — same company, every role, platform admin too
-- ---------------------------------------------------------------------------
-- Target: admin (1111, currently null after B10) for everyone else; door
-- (6666, null after B12) for the admin.

select is(pg_temp.try_set('11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666666', '2026-10-18 11:00+00'), 0,
  'C1 admin cannot set a colleague''s opt-out');
select is(pg_temp.try_set('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '2026-10-18 11:00+00'), 0,
  'C2 manager cannot set a colleague''s opt-out');
select is(pg_temp.try_set('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '2026-10-18 11:00+00'), 0,
  'C3 finance cannot set a colleague''s opt-out');
select is(pg_temp.try_set('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '2026-10-18 11:00+00'), 0,
  'C4 organizer cannot set a colleague''s opt-out');
select is(pg_temp.try_set('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', '2026-10-18 11:00+00'), 0,
  'C5 staff cannot set a colleague''s opt-out');
select is(pg_temp.try_set('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '2026-10-18 11:00+00'), 0,
  'C6 door cannot set a colleague''s opt-out');
select is(pg_temp.try_set('a8000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '2026-10-18 11:00+00'), 0,
  'C7 a platform admin cannot set anyone else''s opt-out either');
select is(pg_temp.opt_out_of('11111111-1111-4111-8111-111111111111'), null::timestamptz,
  'C8 the admin''s value is untouched by C2–C7');
select is(pg_temp.opt_out_of('66666666-6666-4666-8666-666666666666'), null::timestamptz,
  'C9 the door user''s value is untouched by C1');
-- Clearing someone else's opt-out is just as closed (staff is opted out, B6).
select is(pg_temp.try_set('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555', null), 0,
  'C10 admin cannot turn a colleague''s analytics back on');
select is(pg_temp.opt_out_of('55555555-5555-4555-8555-555555555555'), '2026-10-18 10:00+00'::timestamptz,
  'C11 …staff stays opted out');

select pg_temp.login_anon();
select throws_ok(
  $$update public.user_profiles set analytics_opt_out_at = now() where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'C12 anon cannot write the column at all');
reset role;

-- ---------------------------------------------------------------------------
-- D. Read back through my_profile(), own row only
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select analytics_opt_out_at from public.my_profile()), '2026-10-18 10:00+00'::timestamptz,
  'D1 staff reads their own opt-out through my_profile()');
reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select array_agg(analytics_opt_out_at) from public.my_profile()), array[null::timestamptz],
  'D2 admin gets their own value (null), not the staff member''s');
reset role;

-- ---------------------------------------------------------------------------
-- E. A direct read is refused — no colleague learns who opted out
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$select analytics_opt_out_at from public.user_profiles where id = '55555555-5555-4555-8555-555555555555'$$,
  '42501', null, 'E1 admin cannot SELECT a colleague''s opt-out');
select throws_ok(
  $$select analytics_opt_out_at from public.user_profiles where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'E2 …nor their own directly (my_profile() is the path)');
reset role;
select pg_temp.login('a8000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$select analytics_opt_out_at from public.user_profiles$$,
  '42501', null, 'E3 a platform admin cannot SELECT it either');
reset role;

select * from finish();
rollback;
