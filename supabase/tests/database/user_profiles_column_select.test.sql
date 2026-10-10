-- pgTAP — user_profiles column-level SELECT (20261014120100).
--
-- Threat model: any signed-in user holds the anon key + their own JWT and can
-- send raw PostgREST requests. user_profiles_select (can_view_profile) admits
-- the profiles of everyone they share a venue or an event with, so the
-- question is not WHICH rows they see — RLS answers that, unchanged — but
-- WHICH COLUMNS. Before this migration: every column, including
-- is_platform_admin and mfa_snooze_until. After: id, full_name, email,
-- terms_accepted_at, for every row they can see, their own included (a column
-- grant is row-blind); their own private columns come from my_profile() and
-- is_platform_admin().
--
-- Roles covered: a colleague (staff reading the venue admin), the user
-- themselves, a platform admin (sees every row, still not every column), anon.
-- Every denial is a hard 42501 rather than an empty result, so a filter or an
-- ORDER BY on a private column cannot be used as an oracle either.
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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(29);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Seed: Max (admin) and Tom (staff) share venue 1.
-- A platform admin who is a member of no venue.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000', 'a8000000-0000-4000-8000-0000000000a1',
  'authenticated', 'authenticated', 'ucs-platform@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "Ucs Platform"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);

insert into public.user_profiles (id, full_name, email)
values ('a8000000-0000-4000-8000-0000000000a1', 'Ucs Platform', 'ucs-platform@plusone.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'a8000000-0000-4000-8000-0000000000a1';
select set_config('plusone.platform_admin_write', 'off', true);

update public.user_profiles
   set phone = '+31600000011', mfa_snooze_until = '2030-01-01 00:00:00+00'
 where id = '11111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- A. The grant itself (catalog)
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('authenticated', 'public.user_profiles', 'SELECT'),
  'A1 authenticated holds no table-level SELECT on user_profiles');

select is(
  (select array_agg(a.attname::text order by a.attname::text)
     from pg_attribute a
    where a.attrelid = 'public.user_profiles'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')),
  array['email', 'full_name', 'id', 'terms_accepted_at'],
  'A2 authenticated can SELECT exactly id, full_name, email, terms_accepted_at');

select ok(not has_any_column_privilege('anon', 'public.user_profiles', 'SELECT'),
  'A3 anon holds no SELECT on any user_profiles column');

select ok(
  has_column_privilege('authenticated', 'public.user_profiles', 'phone', 'UPDATE')
  and has_column_privilege('authenticated', 'public.user_profiles', 'mfa_snooze_until', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.user_profiles', 'is_platform_admin', 'UPDATE'),
  'A4 the 20260923120000 write grants are untouched');

-- ---------------------------------------------------------------------------
-- B. Colleague: staff reads the venue admin's row
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff

select is(
  (select row(id, full_name, email)::text from public.user_profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  row('11111111-1111-4111-8111-111111111111'::uuid, 'Max de Vries', 'admin@plusone.test')::text,
  'B1 a colleague still reads id, full_name, email');
select lives_ok($$ select terms_accepted_at from public.user_profiles
                    where id = '11111111-1111-4111-8111-111111111111' $$,
  'B2 …and terms_accepted_at (crew "joined" state)');
select lives_ok($$ select count(*) from public.user_profiles $$,
  'B3 count(*) still works');
select is((select count(*)::int from public.venue_memberships m
             join public.user_profiles p on p.id = m.user_id
            where m.user_id = '55555555-5555-4555-8555-555555555555'), 1,
  'B4 the join the PostgREST embeds use still works');

select throws_ok($$ select is_platform_admin from public.user_profiles
                    where id = '11111111-1111-4111-8111-111111111111' $$, '42501', null,
  'B5 colleague is_platform_admin: denied');
select throws_ok($$ select mfa_snooze_until from public.user_profiles
                    where id = '11111111-1111-4111-8111-111111111111' $$, '42501', null,
  'B6 colleague mfa_snooze_until: denied');
select throws_ok($$ select phone from public.user_profiles
                    where id = '11111111-1111-4111-8111-111111111111' $$, '42501', null,
  'B7 colleague phone: denied');
select throws_ok($$ select * from public.user_profiles $$, '42501', null,
  'B8 select * is denied (it names every column)');
select throws_ok($$ select id from public.user_profiles where phone = '+31600000011' $$, '42501', null,
  'B9 a WHERE on a private column is denied (no oracle)');
select throws_ok($$ select id from public.user_profiles order by is_platform_admin $$, '42501', null,
  'B10 an ORDER BY on a private column is denied (no oracle)');

-- RLS still decides which rows: the platform admin shares no venue with Tom.
select is((select count(*)::int from public.user_profiles
            where id = 'a8000000-0000-4000-8000-0000000000a1'), 0,
  'B11 RLS unchanged: a stranger''s row stays invisible');
reset role;

-- ---------------------------------------------------------------------------
-- C. Self: the column grant is row-blind, own private data comes via RPC
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, venue admin

select throws_ok($$ select mfa_snooze_until from public.user_profiles
                    where id = '11111111-1111-4111-8111-111111111111' $$, '42501', null,
  'C1 own mfa_snooze_until is not readable from the table either');
select throws_ok($$ select is_platform_admin from public.user_profiles
                    where id = '11111111-1111-4111-8111-111111111111' $$, '42501', null,
  'C2 own is_platform_admin is not readable from the table either');
select is((select row(phone, mfa_snooze_until)::text from public.my_profile()),
  row('+31600000011', '2030-01-01 00:00:00+00'::timestamptz)::text,
  'C3 own phone + mfa_snooze_until come through my_profile()');
select ok(not public.is_platform_admin(),
  'C4 own flag comes through is_platform_admin()');

-- The self-UPDATEs (profile, consent, MFA snooze) filter on id, which needs
-- SELECT on id — kept. RLS still pins them to the own row.
select is(pg_temp.rowcount($$ update public.user_profiles set phone = '+31600000012'
                               where id = '11111111-1111-4111-8111-111111111111' $$), 1,
  'C5 own-row UPDATE still works');
select is(pg_temp.rowcount($$ update public.user_profiles set full_name = 'Hijacked'
                               where id = '55555555-5555-4555-8555-555555555555' $$), 0,
  'C6 a colleague''s row is still not updatable (RLS filters it to 0 rows)');
reset role;

-- ---------------------------------------------------------------------------
-- D. Platform admin: every row (RLS, #49), still only the granted columns
-- ---------------------------------------------------------------------------

select pg_temp.login('a8000000-0000-4000-8000-0000000000a1');

select is((select full_name from public.user_profiles
            where id = '55555555-5555-4555-8555-555555555555'), 'Tom Bakker',
  'D1 a platform admin reads a profile in a venue they are no member of');
select throws_ok($$ select is_platform_admin from public.user_profiles $$, '42501', null,
  'D2 …but not is_platform_admin on anyone''s row');
select throws_ok($$ select phone from public.user_profiles
                    where id = '11111111-1111-4111-8111-111111111111' $$, '42501', null,
  'D3 …nor phone');
select ok(public.is_platform_admin(),
  'D4 their own flag still reads true through is_platform_admin()');
select is((select array_agg(id) from public.my_profile()),
  array['a8000000-0000-4000-8000-0000000000a1'::uuid],
  'D5 my_profile() gives them only their own row');
reset role;

-- ---------------------------------------------------------------------------
-- E. anon
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select throws_ok($$ select id from public.user_profiles $$, '42501', null,
  'E1 anon cannot read user_profiles at all');
select throws_ok($$ select full_name from public.user_profiles $$, '42501', null,
  'E2 …not even full_name');
select throws_ok($$ select * from public.my_profile() $$, '42501', null,
  'E3 …nor call my_profile()');
reset role;

select * from finish();

rollback;
