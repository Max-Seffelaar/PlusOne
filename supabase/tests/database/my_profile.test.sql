-- pgTAP — public.my_profile() (20261014120000): the caller's own profile row.
--
-- The function exists so own-row reads of private columns (phone,
-- mfa_snooze_until, terms_version, first/last name) do not need a column grant
-- that would also expose them on a colleague's row. So the claims are:
--   * every caller gets exactly their own row — never a colleague's, not even
--     a platform admin (who can SELECT every profile directly);
--   * a user without a profile row gets nothing, not an error;
--   * anon and service_role cannot execute it;
--   * the flag stays out of the result (is_platform_admin() is its one path).
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

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Seed: Max (admin) and Tom (staff) share venue 1.
-- A platform admin who is a member of nothing, and an auth user with no
-- profile row yet.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('a7000000-0000-4000-8000-0000000000a1'::uuid, 'mp-platform@plusone.test', 'Mp Platform'),
  ('a7000000-0000-4000-8000-0000000000a2'::uuid, 'mp-fresh@plusone.test',    'Mp Fresh')
) as u (id, email, full_name);

insert into public.user_profiles (id, full_name, email)
values ('a7000000-0000-4000-8000-0000000000a1', 'Mp Platform', 'mp-platform@plusone.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'a7000000-0000-4000-8000-0000000000a1';
select set_config('plusone.platform_admin_write', 'off', true);

update public.user_profiles
   set phone = '+31600000001', mfa_snooze_until = '2030-01-01 00:00:00+00',
       first_name = 'Tom', last_name = 'Bakker', terms_version = 'v-test'
 where id = '55555555-5555-4555-8555-555555555555';
update public.user_profiles set phone = '+31600000002'
 where id = '11111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- A. Shape
-- ---------------------------------------------------------------------------

select ok((select prosecdef from pg_proc where oid = 'public.my_profile()'::regprocedure),
  'A1 my_profile is SECURITY DEFINER');
select ok((select proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.my_profile()'::regprocedure),
  'A2 my_profile pins an empty search_path');
select ok(
  has_function_privilege('authenticated', 'public.my_profile()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_profile()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.my_profile()', 'EXECUTE'),
  'A3 EXECUTE: authenticated only (not anon, not service_role)');
select ok(not exists (
    select 1 from pg_proc p, unnest(p.proargnames) a
    where p.oid = 'public.my_profile()'::regprocedure and a = 'is_platform_admin'),
  'A4 is_platform_admin is not in the result (is_platform_admin() is its one read path)');

-- ---------------------------------------------------------------------------
-- B. Own row, and only the own row
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff
select is((select count(*)::int from public.my_profile()), 1,
  'B1 staff gets exactly one row');
select is((select row(id, phone, mfa_snooze_until, terms_version)::text from public.my_profile()),
  row('55555555-5555-4555-8555-555555555555'::uuid, '+31600000001',
      '2030-01-01 00:00:00+00'::timestamptz, 'v-test')::text,
  'B2 …which is their own row, private columns included');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, venue admin
select is((select array_agg(id) from public.my_profile()),
  array['11111111-1111-4111-8111-111111111111'::uuid],
  'B3 a venue admin gets only their own row, not a colleague''s');
select is((select phone from public.my_profile()), '+31600000002',
  'B4 …with their own phone, not the staff member''s');
reset role;

select pg_temp.login('a7000000-0000-4000-8000-0000000000a1'); -- platform admin
select is((select array_agg(id) from public.my_profile()),
  array['a7000000-0000-4000-8000-0000000000a1'::uuid],
  'B5 a platform admin also gets only their own row');
reset role;

select pg_temp.login('a7000000-0000-4000-8000-0000000000a2'); -- no profile row
select is((select count(*)::int from public.my_profile()), 0,
  'B6 a user without a profile row gets zero rows, not an error');
reset role;

-- No sub claim at all: auth.uid() is null, so nothing matches.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.my_profile()), 0,
  'B7 authenticated without a sub claim gets zero rows');
reset role;

-- ---------------------------------------------------------------------------
-- C. Denied
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select throws_ok($$ select * from public.my_profile() $$, '42501', null,
  'C1 anon cannot execute my_profile');
reset role;

set local role service_role;
select throws_ok($$ select * from public.my_profile() $$, '42501', null,
  'C2 service_role cannot execute my_profile');
reset role;

-- The function writes nothing: a STABLE function cannot, but assert the flag.
select is((select provolatile from pg_proc where oid = 'public.my_profile()'::regprocedure),
  's'::"char", 'C3 my_profile is STABLE (read-only)');

select * from finish();

rollback;
