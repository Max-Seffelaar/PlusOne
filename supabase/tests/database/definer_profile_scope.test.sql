-- pgTAP — SECURITY DEFINER read paths stay inside the profile boundary
-- (20261014130000, follow-up to the user_profiles column-SELECT audit).
--
-- A definer function runs as the owner, so neither RLS nor the user_profiles
-- column grant applies inside it: whatever it returns is the boundary. Claims:
--   * the "added by" stats never name a PlusOne platform admin the caller
--     cannot see under can_view_profile (support work in a venue they are no
--     member of), while their counts still add up;
--   * everyone else keeps their name — the operator once they are a real
--     member, the operator reading their own stats, and a former member;
--   * admin_list_user_sessions never reveals another member's MFA level (aal),
--     while list_own_sessions still shows the caller their own;
--   * the existing gates are unchanged (staff gets no stats rows, cannot list
--     a colleague's sessions; anon executes none of it).
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

select plan(15);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Seed: venue 1 = Club Vesper, Max admin, Tom staff,
-- Lisa staff+door; event ee…01. A platform admin who is a member of nothing
-- adds one guest (+2) to that event as support.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000', 'a9000000-0000-4000-8000-0000000000a1',
  'authenticated', 'authenticated', 'dps-operator@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "Secret Operator"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);
insert into public.user_profiles (id, full_name, email)
values ('a9000000-0000-4000-8000-0000000000a1', 'Secret Operator', 'dps-operator@plusone.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'a9000000-0000-4000-8000-0000000000a1';
select set_config('plusone.platform_admin_write', 'off', true);

insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
select 'cc000000-0000-7000-8000-0000000000d1', 'ee000000-0000-7000-8000-000000000001',
       (select id from public.guest_tiers where event_id = 'ee000000-0000-7000-8000-000000000001' limit 1),
       'Support Added Guest', 2, 'a9000000-0000-4000-8000-0000000000a1', 'app', 'approved';

-- Two sessions for Tom: one with MFA.
insert into auth.sessions (id, user_id, created_at, updated_at, aal, ip, user_agent)
values
  ('5e000000-0000-4000-8000-0000000000a1', '55555555-5555-4555-8555-555555555555',
   now(), now(), 'aal2', '203.0.113.7', 'probe-agent'),
  ('5e000000-0000-4000-8000-0000000000a2', '55555555-5555-4555-8555-555555555555',
   now() - interval '1 hour', now() - interval '1 hour', 'aal1', '203.0.113.8', 'probe-agent');

-- ---------------------------------------------------------------------------
-- A. "Added by" stats, as the venue admin
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, venue admin

select is((select count(*)::int from public.user_profiles
            where id = 'a9000000-0000-4000-8000-0000000000a1'), 0,
  'A1 precondition: the venue admin cannot see the operator''s profile');
select is(
  (select row(full_name, added, added_headcount)::text
     from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
    where user_id = 'a9000000-0000-4000-8000-0000000000a1'),
  row(null::text, 1, 3)::text,
  'A2 event_user_additions: the operator''s row keeps its counts but carries no name');
select is(
  (select row(full_name, added, added_headcount)::text
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001', null, null)
    where user_id = 'a9000000-0000-4000-8000-0000000000a1'),
  row(null::text, 1, 3)::text,
  'A3 venue_user_additions: same');
select ok(not exists (
    select 1 from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
     where full_name = 'Secret Operator'),
  'A4 the operator''s name appears nowhere in the result');
select is(
  (select full_name from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
    where user_id = '55555555-5555-4555-8555-555555555555'),
  'Tom Bakker',
  'A5 a venue member keeps their name');
reset role;

-- A former member keeps their name: membership gone, history stays (#24).
delete from public.venue_memberships
 where venue_id = 'aa000000-0000-7000-8000-000000000001'
   and user_id = '66666666-6666-4666-8666-666666666666';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select full_name from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
    where user_id = '66666666-6666-4666-8666-666666666666'),
  'Lisa van den Berg',
  'A6 a former member (not a platform admin) keeps their name');
reset role;

-- ---------------------------------------------------------------------------
-- B. When the operator may be seen, they are named
-- ---------------------------------------------------------------------------

select pg_temp.login('a9000000-0000-4000-8000-0000000000a1'); -- the operator
select is(
  (select full_name from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
    where user_id = 'a9000000-0000-4000-8000-0000000000a1'),
  'Secret Operator',
  'B1 the operator reading the stats sees their own name');
reset role;

insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000a1', '{staff}');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select full_name from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
    where user_id = 'a9000000-0000-4000-8000-0000000000a1'),
  'Secret Operator',
  'B2 a platform admin who is a real member of the venue is named like any member');
reset role;

-- ---------------------------------------------------------------------------
-- C. Sessions: no MFA level for someone else's sessions
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, admin of Tom's venue
select is((select count(*)::int from public.admin_list_user_sessions('55555555-5555-4555-8555-555555555555')), 2,
  'C1 the admin still lists the member''s sessions (remote logout works)');
select is((select count(*)::int from public.admin_list_user_sessions('55555555-5555-4555-8555-555555555555')
            where aal is not null), 0,
  'C2 …but every aal is null');
select is((select ip from public.admin_list_user_sessions('55555555-5555-4555-8555-555555555555')
            order by updated_at desc limit 1), '203.0.113.7',
  'C3 ip is unchanged (open product decision, not part of this fix)');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom himself
select is((select array_agg(aal order by updated_at desc) from public.list_own_sessions()),
  array['aal2', 'aal1'],
  'C4 list_own_sessions still shows the caller their own aal');
select throws_ok($$ select * from public.admin_list_user_sessions('11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'C5 staff still cannot list a colleague''s sessions');
select is((select count(*)::int from public.event_user_additions('ee000000-0000-7000-8000-000000000001')), 0,
  'C6 staff still gets no stats rows (can_read_event_stats unchanged)');
reset role;

-- ---------------------------------------------------------------------------
-- D. Grants
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.event_user_additions(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.venue_user_additions(uuid, timestamptz, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_list_user_sessions(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_list_user_sessions(uuid)', 'EXECUTE'),
  'D1 anon executes none of the three; authenticated keeps EXECUTE');

select * from finish();

rollback;
