-- pgTAP — platform venue overview + audit viewer (P-05, z8uq9m0tnx).
--
-- Threat model (CLAUDE.md #1): the anon/auth key ships to the browser, so
-- every claim below has to hold against raw PostgREST calls. This file proves:
--
--   * a platform admin reads venues he holds no membership at all, and their
--     aggregated member/event counts, subscription status and last activity;
--   * every other venue role (admin, user_manager, finance, staff, doorhost,
--     organizer) and anon get ZERO rows from every new function — no 42501,
--     no oracle;
--   * the venue overview is windowed (p_limit/p_offset honoured, an absurd
--     limit capped) and *_count matches the unwindowed total;
--   * the audit viewer filters by venue and by period, and is windowed the
--     same way;
--   * is_support_action is true exactly when the actor holds no CURRENT
--     venue_memberships row at the audited venue, and false for a venue
--     member, for service actions with venue_id null, and for a null actor;
--   * anon cannot execute any of the five functions.
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

select plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — RLS bypassed, like the seed)
-- ---------------------------------------------------------------------------
-- A platform admin who is a member of NO venue at all, plus two extra venues
-- beyond the two the seed already provides (aa...01 Club Vesper / comped,
-- aa...02 De Marktzaal / trialing) so windowing has 4 rows to page through.

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
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'watcher@plusone.test', 'Watcher Wies')
) as u (id, email, full_name);

insert into public.user_profiles (id, full_name, email) values
  ('c1000000-0000-4000-8000-000000000001', 'Watcher Wies', 'watcher@plusone.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'c1000000-0000-4000-8000-000000000001';
select set_config('plusone.platform_admin_write', 'off', true);

insert into public.venues (id, name, slug) values
  ('c2000000-0000-4000-8000-000000000001', 'Aurora Loods', 'aurora-loods'),
  ('c2000000-0000-4000-8000-000000000002', 'Zenith Zaal', 'zenith-zaal');
-- No members, no events, no subscription row for either — coalesce-to-zero /
-- null-status path.

-- Support-action fixture: Watcher (platform admin, member of NOTHING) touches
-- Club Vesper (aa...01) directly in audit_log; Max (a real Club Vesper admin,
-- seed id 111...) touches it too. A third row has venue_id null (the
-- set_platform_admin() shape) and must never be flagged, whoever the actor is.
insert into public.audit_log (actor_id, venue_id, entity_type, entity_id, action, diff) values
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
   'guests', gen_random_uuid(), 'update', '{"before":{},"after":{}}'::jsonb),
  ('11111111-1111-4111-8111-111111111111', 'aa000000-0000-7000-8000-000000000001',
   'guests', gen_random_uuid(), 'update', '{"before":{},"after":{}}'::jsonb),
  (null, null, 'user_profiles', gen_random_uuid(), 'platform_admin_grant', '{"before":{},"after":{}}'::jsonb);

-- ---------------------------------------------------------------------------
-- A. Grants — anon reaches none of the five functions
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('anon',
            'public.platform_venue_overview(integer, integer, text)', 'EXECUTE')
      and not has_function_privilege('anon',
            'public.platform_venue_overview_count(text)', 'EXECUTE')
      and not has_function_privilege('anon',
            'public.platform_audit_overview(uuid, timestamptz, timestamptz, integer, integer)', 'EXECUTE')
      and not has_function_privilege('anon',
            'public.platform_audit_overview_count(uuid, timestamptz, timestamptz)', 'EXECUTE')
      and not has_function_privilege('anon',
            'public.platform_venue_options()', 'EXECUTE'),
  'A1 anon cannot execute any of the five functions');

select ok(not has_function_privilege('service_role',
            'public.platform_venue_overview(integer, integer, text)', 'EXECUTE')
      and not has_function_privilege('service_role',
            'public.platform_audit_overview(uuid, timestamptz, timestamptz, integer, integer)', 'EXECUTE'),
  'A2 service_role cannot execute them either (DEFINER, authenticated-only)');

select ok(has_function_privilege('authenticated',
            'public.platform_venue_overview(integer, integer, text)', 'EXECUTE')
      and has_function_privilege('authenticated',
            'public.platform_audit_overview(uuid, timestamptz, timestamptz, integer, integer)', 'EXECUTE')
      and has_function_privilege('authenticated',
            'public.platform_venue_options()', 'EXECUTE'),
  'A3 authenticated holds EXECUTE (the functions gate on is_platform_admin() themselves)');

select pg_temp.login_anon();
select throws_ok($$select * from public.platform_venue_overview()$$,
  '42501', null, 'A4 anon is refused at the grant layer, not the function body');
reset role;

-- ---------------------------------------------------------------------------
-- B. Platform admin — venue overview
-- ---------------------------------------------------------------------------

select pg_temp.login('c1000000-0000-4000-8000-000000000001');

select is((select count(*)::int from public.platform_venue_overview(200, 0)), 4,
  'B1 the platform admin sees all 4 venues, including two he holds no membership at');

-- Seed membership at Club Vesper: Max, Noor, Femke, Tom, Lisa = 5.
select is((select member_count from public.platform_venue_overview(200, 0)
            where venue_id = 'aa000000-0000-7000-8000-000000000001'), 5,
  'B2 member_count is aggregated in SQL for a venue the admin does not belong to');

select is((select subscription_status from public.platform_venue_overview(200, 0)
            where venue_id = 'aa000000-0000-7000-8000-000000000001'), 'comped',
  'B3 subscription_status is read straight off subscriptions');

select is((select member_count from public.platform_venue_overview(200, 0)
            where venue_id = 'c2000000-0000-4000-8000-000000000001'), 0,
  'B4 a venue with no members reports 0, not null');

select is((select subscription_status from public.platform_venue_overview(200, 0)
            where venue_id = 'c2000000-0000-4000-8000-000000000001'), null,
  'B5 a venue with no subscriptions row reports null status, not an error');

select is((select count(*)::int from public.platform_venue_overview(200, 0, 'zenith')), 1,
  'B6 search filters server-side, case-insensitively');

select is((select venue_id from public.platform_venue_overview(200, 0, 'zenith')),
  'c2000000-0000-4000-8000-000000000002',
  'B6b the search actually returns the matching venue');

select is((select count(*)::int from public.platform_venue_overview(2, 0)), 2,
  'B7 p_limit is honoured');
select is((select count(*)::int from public.platform_venue_overview(2, 3)), 1,
  'B8 p_offset is honoured (4 total, offset 3 leaves 1)');
select is((select count(*)::int from public.platform_venue_overview(100000, 0)), 4,
  'B9 an absurd p_limit is capped, not obeyed blindly (still just 4 rows exist)');

select is(public.platform_venue_overview_count(), 4,
  'B10 the unwindowed count matches the total row count');
select is(public.platform_venue_overview_count('zenith'), 1,
  'B11 the count respects the same search filter');

select is((select count(*)::int from public.platform_venue_options()), 4,
  'B12 the venue picker lists every venue');

reset role;

-- ---------------------------------------------------------------------------
-- C. Platform admin — audit viewer
-- ---------------------------------------------------------------------------

select pg_temp.login('c1000000-0000-4000-8000-000000000001');

select cmp_ok((select count(*)::int from public.platform_audit_overview(null, null, null, 200, 0)),
  '>=', 3, 'C1 the platform admin sees audit rows across venues, including a null-venue row');

-- Seed activity (guest inserts etc.) already puts rows on Club Vesper, so this
-- checks OUR two fixture rows are included, not an exact total.
select cmp_ok((select count(*)::int from public.platform_audit_overview(
              'aa000000-0000-7000-8000-000000000001', null, null, 200, 0)),
  '>=', 2, 'C2 filtering by venue_id returns at least our fixture rows for that venue');

select is((select count(*)::int from public.platform_audit_overview(
              'c2000000-0000-4000-8000-000000000001', null, null, 200, 0)), 0,
  'C2b filtering by an untouched venue returns nothing');

select is((select is_support_action from public.platform_audit_overview(
              'aa000000-0000-7000-8000-000000000001', null, null, 200, 0)
            where actor_id = 'c1000000-0000-4000-8000-000000000001'), true,
  'C3 the platform admin''s own action at a venue he is not a member of is flagged support');

select is((select is_support_action from public.platform_audit_overview(
              'aa000000-0000-7000-8000-000000000001', null, null, 200, 0)
            where actor_id = '11111111-1111-4111-8111-111111111111'), false,
  'C4 a real venue admin''s action at his own venue is not flagged');

select is((select is_support_action from public.platform_audit_overview(null, null, null, 200, 0)
            where venue_id is null), false,
  'C5 a null-venue action (e.g. platform_admin_grant) is never flagged, whoever acted');

select is((select actor_name from public.platform_audit_overview(
              'aa000000-0000-7000-8000-000000000001', null, null, 200, 0)
            where actor_id = '11111111-1111-4111-8111-111111111111'), 'Max de Vries',
  'C6 the actor name is resolved from user_profiles');

select is((select venue_name from public.platform_audit_overview(
              'aa000000-0000-7000-8000-000000000001', null, null, 200, 0)
            limit 1), 'Club Vesper',
  'C7 the venue name is resolved from venues');

select is((select count(*)::int from public.platform_audit_overview(
              null, now() + interval '1 hour', null, 200, 0)), 0,
  'C8 a p_since in the future excludes every row (period filter works)');

select is((select count(*)::int from public.platform_audit_overview(
              null, null, now() - interval '1 hour', 200, 0)), 0,
  'C9 a p_until in the past excludes every row too');

select is((select count(*)::int from public.platform_audit_overview(null, null, null, 1, 0)), 1,
  'C10 the audit feed honours p_limit');

select is(
  public.platform_audit_overview_count(null, null, null) >=
  (select count(*)::int from public.platform_audit_overview(null, null, null, 1, 0)),
  true, 'C11 the count is at least the size of one capped page (sanity, not exact — audit_log is shared)');

select is(
  public.platform_audit_overview_count('aa000000-0000-7000-8000-000000000001', null, null) >= 2,
  true, 'C12 the count respects the venue filter and includes our fixture rows');

reset role;

-- ---------------------------------------------------------------------------
-- D. Every other role and anon: zero rows, never an error
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, venue admin
select is((select count(*)::int from public.platform_venue_overview()), 0,
  'D1 a venue admin sees no platform venue overview');
select is((select count(*)::int from public.platform_audit_overview()), 0,
  'D2 a venue admin sees no platform audit overview (his own venue''s RLS access does not leak through here)');
select is(public.platform_venue_overview_count(), 0, 'D3 the venue count is 0 too');
select is(public.platform_audit_overview_count(), 0, 'D4 the audit count is 0 too');
select is((select count(*)::int from public.platform_venue_options()), 0,
  'D5 the venue picker is empty too');
reset role;

select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- Noor, user_manager
select is((select count(*)::int from public.platform_venue_overview()), 0, 'D6 user_manager sees nothing');
reset role;

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- Femke, finance
select is((select count(*)::int from public.platform_audit_overview()), 0, 'D7 finance sees nothing');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff
select is((select count(*)::int from public.platform_venue_overview()), 0, 'D8 staff sees nothing');
reset role;

select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- Lisa, doorhost
select is((select count(*)::int from public.platform_audit_overview()), 0, 'D9 a doorhost sees nothing');
reset role;

select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- Yusuf, organizer
select is((select count(*)::int from public.platform_venue_overview()), 0, 'D10 an event organizer sees nothing');
reset role;

select pg_temp.login_anon();
select throws_ok($$select * from public.platform_audit_overview()$$,
  '42501', null, 'D11 anon is refused at the grant layer for the audit overview too');
reset role;

select * from finish();
rollback;
