-- pgTAP — PlusOne platform (system) admin (P-02, z8uq9m0tnt).
--
-- Threat model (CLAUDE.md #1): the anon/auth key ships to the browser, so every
-- claim below has to hold against raw PostgREST calls, not just against the UI.
-- This file proves both sides of the new boundary:
--
--   * a platform admin reads AND writes in a venue he is no member of;
--   * admin / user_manager / finance / staff / doorhost / organizer cannot —
--     unchanged from before this migration;
--   * nobody but a platform admin can set `is_platform_admin`, neither through
--     a direct UPDATE/INSERT on their own profile row nor through the RPC;
--   * anon reaches none of it;
--   * the audit triggers stamp the platform admin as actor on guests,
--     guest_tiers, quotas, event_quotas, check_ins and venue_memberships.
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

select plan(40);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — RLS bypassed, like the seed)
-- ---------------------------------------------------------------------------
-- Users: a platform admin and a plain user, neither of them a member of any
-- venue, plus a third auth user with NO profile row yet (the self-INSERT test).

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
  ('99999999-9999-4999-8999-999999999999'::uuid, 'platform@plusone.test', 'Joeri Platform'),
  ('88888888-8888-4888-8888-888888888888'::uuid, 'plain@plusone.test',    'Plain Pete'),
  ('77777777-7777-4777-8777-777777777777'::uuid, 'fresh@plusone.test',    'Fresh Fiona')
) as u (id, email, full_name);

insert into public.user_profiles (id, full_name, email) values
  ('99999999-9999-4999-8999-999999999999', 'Joeri Platform', 'platform@plusone.test'),
  ('88888888-8888-4888-8888-888888888888', 'Plain Pete',     'plain@plusone.test');

-- Bootstrap path from the migration header: the guard trigger refuses the flag
-- unless this transaction-local GUC says the write comes from the sanctioned
-- route. Turned off again immediately — every assertion below runs without it.
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles
   set is_platform_admin = true
 where id = '99999999-9999-4999-8999-999999999999';
select set_config('plusone.platform_admin_write', 'off', true);

-- A venue-2 event nobody in venue 1 can reach. Venue 2 (De Marktzaal) has
-- exactly one member in the seed: Max (admin) — so it is also a clean target
-- for "an ordinary venue admin of ANOTHER venue".
insert into public.events (id, venue_id, name, starts_at, landing_slug, status)
values ('ee000000-0000-7000-8000-0000000000a2',
        'aa000000-0000-7000-8000-000000000002',
        'Platform Admin Night', '2026-10-01 22:00:00+02', 'pa-marktzaal-night', 'open');

insert into public.guest_tiers (id, event_id, name)
values ('dd000000-0000-7000-8000-0000000000a2',
        'ee000000-0000-7000-8000-0000000000a2', 'Regular');

insert into public.guests (id, event_id, tier_id, full_name, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000a2',
        'ee000000-0000-7000-8000-0000000000a2',
        'dd000000-0000-7000-8000-0000000000a2',
        'Venue2 Secret Guest', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

-- ---------------------------------------------------------------------------
-- A. The helper itself
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, venue admin
select ok(not public.is_platform_admin(),
  'A1 a venue admin is not a platform admin');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff
select ok(not public.is_platform_admin(),
  'A2 staff is not a platform admin');
reset role;

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select ok(public.is_platform_admin(),
  'A3 the platform admin is recognised');
reset role;

-- ---------------------------------------------------------------------------
-- B. Cross-venue READ by the platform admin (member of no venue at all)
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');

select is((select count(*)::int from public.venues), 2,
  'B1 platform admin sees every venue');
select is((select count(*)::int from public.events
           where id = 'ee000000-0000-7000-8000-0000000000a2'), 1,
  'B2 platform admin reads the venue-2 event');
select is((select count(*)::int from public.guests
           where id = 'cc000000-0000-7000-8000-0000000000a2'), 1,
  'B3 platform admin reads the venue-2 guest');
select cmp_ok((select count(*)::int from public.guests
               where event_id = 'ee000000-0000-7000-8000-000000000001'), '>', 0,
  'B4 platform admin reads the venue-1 guest list');
select cmp_ok((select count(*)::int from public.venue_memberships), '>', 0,
  'B5 platform admin reads memberships across venues');
select is((select count(*)::int from public.user_profiles
           where id = '11111111-1111-4111-8111-111111111111'), 1,
  'B6 can_view_profile lets the platform admin read a stranger''s profile');

reset role;

-- ---------------------------------------------------------------------------
-- C. Cross-venue WRITE by the platform admin, and the audit actor stamp
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');

select lives_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, added_by, source, status)
  values ('cc000000-0000-7000-8000-0000000000a3',
          'ee000000-0000-7000-8000-0000000000a2',
          'dd000000-0000-7000-8000-0000000000a2',
          'Added By Platform Admin',
          '99999999-9999-4999-8999-999999999999', 'app', 'approved')
$$, 'C1 platform admin inserts a guest in a venue he is no member of');

select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 2
                      where id = 'cc000000-0000-7000-8000-0000000000a2'$$),
  1, 'C2 platform admin updates an existing venue-2 guest');

select lives_ok($$
  insert into public.guest_tiers (id, event_id, name)
  values ('dd000000-0000-7000-8000-0000000000a3',
          'ee000000-0000-7000-8000-0000000000a2', 'Platform Tier')
$$, 'C3 platform admin inserts a guest tier in venue 2');

select lives_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('aa000000-0000-7000-8000-000000000002',
          '88888888-8888-4888-8888-888888888888', 5)
$$, 'C4 platform admin grants a venue quota in venue 2');

select lives_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('ee000000-0000-7000-8000-0000000000a2',
          '88888888-8888-4888-8888-888888888888', 7)
$$, 'C5 platform admin sets an event quota in venue 2');

select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000002',
          '88888888-8888-4888-8888-888888888888', '{staff}'::public.venue_role[])
$$, 'C6 platform admin adds a membership in venue 2');

select lives_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ('cc000000-0000-7000-8000-0000000000a3',
          '99999999-9999-4999-8999-999999999999')
$$, 'C7 platform admin records a door check-in in venue 2');

reset role;

-- Every one of those writes must carry the platform admin's own id as actor —
-- "elke actie herleidbaar tot hun naam" is the whole point of the design.
select is_empty($$
  select t as entity_without_platform_admin_audit
  from unnest(array['guests','guest_tiers','quotas','event_quotas',
                    'check_ins','venue_memberships']) t
  where not exists (
    select 1 from public.audit_log a
    where a.entity_type = t
      and a.actor_id = '99999999-9999-4999-8999-999999999999'
  )
$$, 'C8 audit triggers stamp the platform admin as actor on all six tables');

-- ---------------------------------------------------------------------------
-- D. Ordinary roles: unchanged, still locked out of the foreign venue
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff, venue 1
select is((select count(*)::int from public.guests
           where id = 'cc000000-0000-7000-8000-0000000000a2'), 0,
  'D1 staff cannot read the venue-2 guest');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source, status)
  values ('ee000000-0000-7000-8000-0000000000a2',
          'dd000000-0000-7000-8000-0000000000a2', 'Staff Cross-tenant',
          '55555555-5555-4555-8555-555555555555', 'app', 'approved')
$$, '42501', null, 'D2 staff cannot write into the venue-2 event');
reset role;

select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- user_manager
select is((select count(*)::int from public.guests
           where id = 'cc000000-0000-7000-8000-0000000000a2'), 0,
  'D3 user_manager cannot read the venue-2 guest');
reset role;

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- finance
select is((select count(*)::int from public.guests
           where id = 'cc000000-0000-7000-8000-0000000000a2'), 0,
  'D4 finance cannot read the venue-2 guest');
reset role;

select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- doorhost
select is((select count(*)::int from public.guests
           where id = 'cc000000-0000-7000-8000-0000000000a2'), 0,
  'D5 doorhost cannot read the venue-2 guest');
reset role;

select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- organizer, event 1
select is((select count(*)::int from public.guests
           where id = 'cc000000-0000-7000-8000-0000000000a2'), 0,
  'D6 event organizer cannot read the venue-2 guest');
reset role;

-- The widening must not leak the other way: a venue admin shares no venue with
-- the platform admin, so can_view_profile still hides that profile from him.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.user_profiles
           where id = '99999999-9999-4999-8999-999999999999'), 0,
  'D7 a venue admin cannot read the platform admin''s profile');
reset role;

-- ---------------------------------------------------------------------------
-- E. The flag is not reachable from any ordinary role
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- venue admin
select throws_ok($$
  update public.user_profiles set is_platform_admin = true
   where id = '11111111-1111-4111-8111-111111111111'
$$, '42501', null,
  'E1 a venue admin cannot set the flag on his own profile (direct UPDATE)');
select throws_ok($$
  select public.set_platform_admin('11111111-1111-4111-8111-111111111111', true)
$$, '42501', null, 'E2 a venue admin cannot grant himself the flag via the RPC');
select throws_ok($$
  select public.set_platform_admin('88888888-8888-4888-8888-888888888888', true)
$$, '42501', null, 'E3 a venue admin cannot grant the flag to someone else');
select throws_ok($$
  select public.set_platform_admin('99999999-9999-4999-8999-999999999999', false)
$$, '42501', null, 'E4 a venue admin cannot revoke the platform admin');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select throws_ok($$
  select public.set_platform_admin('55555555-5555-4555-8555-555555555555', true)
$$, '42501', null, 'E5 staff cannot grant itself the flag via the RPC');
reset role;

-- A brand-new user creating their own profile row (user_profiles_insert_self)
-- must not be able to ship is_platform_admin = true with it.
select pg_temp.login('77777777-7777-4777-8777-777777777777');
select throws_ok($$
  insert into public.user_profiles (id, full_name, email, is_platform_admin)
  values ('77777777-7777-4777-8777-777777777777', 'Fresh Fiona',
          'fresh@plusone.test', true)
$$, '42501', null,
  'E6 a fresh user cannot self-INSERT a profile that is already platform admin');
select lives_ok($$
  insert into public.user_profiles (id, full_name, email)
  values ('77777777-7777-4777-8777-777777777777', 'Fresh Fiona',
          'fresh@plusone.test')
$$, 'E7 …but the ordinary self-INSERT still works');
reset role;

select is((select bool_or(is_platform_admin) from public.user_profiles
           where id <> '99999999-9999-4999-8999-999999999999'), false,
  'E8 after every attempt above, the platform admin is still the only one');

-- ---------------------------------------------------------------------------
-- F. The RPC, used by a platform admin
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');

select lives_ok($$
  select public.set_platform_admin('88888888-8888-4888-8888-888888888888', true)
$$, 'F1 a platform admin can grant the flag');

select throws_ok($$
  select public.set_platform_admin('99999999-9999-4999-8999-999999999999', false)
$$, '42501', null, 'F2 a platform admin cannot revoke his own access (lockout)');

select lives_ok($$
  select public.set_platform_admin('88888888-8888-4888-8888-888888888888', false)
$$, 'F3 …and can revoke it again');

reset role;

select is((select is_platform_admin from public.user_profiles
           where id = '88888888-8888-4888-8888-888888888888'), false,
  'F4 the grant/revoke round trip left the flag off');

select is((select count(*)::int from public.audit_log
           where entity_type = 'user_profiles'
             and entity_id = '88888888-8888-4888-8888-888888888888'
             and actor_id = '99999999-9999-4999-8999-999999999999'
             and action in ('platform_admin_grant', 'platform_admin_revoke')), 2,
  'F5 both the grant and the revoke are audited under the platform admin');

-- ---------------------------------------------------------------------------
-- G. anon reaches none of it
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();

select throws_ok($$ select public.is_platform_admin() $$,
  '42501', null, 'G1 anon cannot execute is_platform_admin()');
select throws_ok($$
  select public.set_platform_admin('88888888-8888-4888-8888-888888888888', true)
$$, '42501', null, 'G2 anon cannot execute set_platform_admin()');
select throws_ok($$ select count(*) from public.user_profiles $$,
  '42501', null, 'G3 anon cannot read user_profiles at all');

reset role;

select * from finish();
rollback;
