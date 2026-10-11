-- pgTAP — venue_actor_names: one who-did-what rule (20261016140000, spec #62a).
--
-- Claims:
--   * current AND former members/crew are named (full_name only);
--   * a platform admin without a membership/crew tie to the venue is
--     is_support with a null name — named again once they are a real member
--     or crew there;
--   * footprint rule: only ids with history in THAT venue come back — a random
--     uuid and someone else's venue history return nothing;
--   * crew sees the footprint of their own events (+ current members), never
--     past members or the crew of other events;
--   * a non-member gets zero rows, anon cannot execute, the id cap holds, and
--     the result has exactly three columns.
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

-- One row as text, so a missing row reads as null rather than an error.
create function pg_temp.actor(p_venue uuid, p_id uuid)
returns text language sql as $fn$
  select row(display_name, is_support)::text
    from public.venue_actor_names(p_venue, array[p_id]);
$fn$;
grant execute on function pg_temp.actor(uuid, uuid) to authenticated;

select plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Seed: venue 1 aa…01 (Max admin, Tom staff, Lisa
-- staff+door, Femke finance), crew Sven (44…) on event ee…01; venue 2 aa…02
-- (Max admin).
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('full_name', u.name),
       now(), now(), '', '', '', '', '', '', '', ''
  from (values
    ('a9000000-0000-4000-8000-0000000000b1'::uuid, 'van-operator@plusone.test', 'Hidden Operator'),
    ('a9000000-0000-4000-8000-0000000000b2'::uuid, 'van-former@plusone.test',   'Former Floor'),
    ('a9000000-0000-4000-8000-0000000000b3'::uuid, 'van-past@plusone.test',     'Past Member'),
    ('a9000000-0000-4000-8000-0000000000b4'::uuid, 'van-crew2@plusone.test',    'Other Crew'),
    ('a9000000-0000-4000-8000-0000000000b5'::uuid, 'van-outside@plusone.test',  'Elsewhere Person')
  ) as u(id, email, name);
insert into public.user_profiles (id, full_name, email)
values
  ('a9000000-0000-4000-8000-0000000000b1', 'Hidden Operator',  'van-operator@plusone.test'),
  ('a9000000-0000-4000-8000-0000000000b2', 'Former Floor',     'van-former@plusone.test'),
  ('a9000000-0000-4000-8000-0000000000b3', 'Past Member',      'van-past@plusone.test'),
  ('a9000000-0000-4000-8000-0000000000b4', 'Other Crew',       'van-crew2@plusone.test'),
  ('a9000000-0000-4000-8000-0000000000b5', 'Elsewhere Person', 'van-outside@plusone.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'a9000000-0000-4000-8000-0000000000b1';
select set_config('plusone.platform_admin_write', 'off', true);

-- A second event in venue 1 (other crew) and one in venue 2.
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug) values
  ('ee000000-0000-7000-8000-0000000000a2', 'aa000000-0000-7000-8000-000000000001',
   'Actor Names Two', now() + interval '8 days', now() + interval '8 days 6 hours', 'open', 'van-two'),
  ('ee000000-0000-7000-8000-0000000000a3', 'aa000000-0000-7000-8000-000000000002',
   'Actor Names Elsewhere', now() + interval '9 days', now() + interval '9 days 6 hours', 'open', 'van-three');
insert into public.guest_tiers (id, event_id, name) values
  ('dd000000-0000-7000-8000-0000000000a2', 'ee000000-0000-7000-8000-0000000000a2', 'Regular'),
  ('dd000000-0000-7000-8000-0000000000a3', 'ee000000-0000-7000-8000-0000000000a3', 'Regular');

-- The operator adds a guest to venue 1 as support (no membership, no crew tie).
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
select 'cc000000-0000-7000-8000-0000000000b1', 'ee000000-0000-7000-8000-000000000001',
       (select id from public.guest_tiers where event_id = 'ee000000-0000-7000-8000-000000000001' limit 1),
       'Support Guest', 0, 'a9000000-0000-4000-8000-0000000000b1', 'app', 'approved';

-- Former Floor: a member who checked someone in on ee…01, then left.
insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b2', '{doorhost}');
insert into public.audit_log (actor_id, venue_id, event_id, entity_type, entity_id, action)
values ('a9000000-0000-4000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000001',
        'ee000000-0000-7000-8000-000000000001', 'check_ins', 'cc000000-0000-7000-8000-0000000000b1', 'check_in');
delete from public.venue_memberships
 where venue_id = 'aa000000-0000-7000-8000-000000000001'
   and user_id = 'a9000000-0000-4000-8000-0000000000b2';

-- Past Member: a membership that came and went, no actions at all.
insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b3', '{staff}');
delete from public.venue_memberships
 where venue_id = 'aa000000-0000-7000-8000-000000000001'
   and user_id = 'a9000000-0000-4000-8000-0000000000b3';

-- Other Crew: crew of ee…a2 only, added a guest there.
insert into public.event_organizers (event_id, user_id)
values ('ee000000-0000-7000-8000-0000000000a2', 'a9000000-0000-4000-8000-0000000000b4');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000b4', 'ee000000-0000-7000-8000-0000000000a2',
        'dd000000-0000-7000-8000-0000000000a2', 'Crew Two Guest', 0,
        'a9000000-0000-4000-8000-0000000000b4', 'app', 'approved');

-- Elsewhere Person: member of venue 2 only, acted only there.
insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000002', 'a9000000-0000-4000-8000-0000000000b5', '{staff}');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000b5', 'ee000000-0000-7000-8000-0000000000a3',
        'dd000000-0000-7000-8000-0000000000a3', 'Elsewhere Guest', 0,
        'a9000000-0000-4000-8000-0000000000b5', 'app', 'approved');

-- ---------------------------------------------------------------------------
-- A. Venue admin (Max)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');

select is((select count(*)::int from public.user_profiles
            where id in ('a9000000-0000-4000-8000-0000000000b1', 'a9000000-0000-4000-8000-0000000000b2')), 0,
  'A1 precondition: under RLS the admin sees neither the operator nor the former member');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b2'),
  row('Former Floor', false)::text, 'A2 a former member who acted is named');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b3'),
  row('Past Member', false)::text, 'A3 a former member without actions is named (past membership is a footprint)');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b1'),
  row(null::text, true)::text, 'A4 an operator without a tie is PlusOne support: null name, is_support');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b4'),
  row('Other Crew', false)::text, 'A5 crew of any of the venue''s events is named for a member');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  row('Tom Bakker', false)::text, 'A6 a current member is named');
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
            array['0badc0de-0000-4000-8000-000000000000'::uuid])), 0,
  'A7 a random uuid with no footprint returns nothing');
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
            array['a9000000-0000-4000-8000-0000000000b5'::uuid])), 0,
  'A8 someone with history only in ANOTHER venue returns nothing (even for an admin of both)');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000002', 'a9000000-0000-4000-8000-0000000000b5'),
  row('Elsewhere Person', false)::text, 'A9 …and is named when asked for the venue they belong to');
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
            array['55555555-5555-4555-8555-555555555555'::uuid, '55555555-5555-4555-8555-555555555555'::uuid, null])), 1,
  'A10 duplicate and null ids collapse to one row');
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000001', '{}'::uuid[])), 0,
  'A11 an empty array returns nothing');
select throws_ok(
  $$ select * from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
       array(select gen_random_uuid() from generate_series(1, 501))) $$,
  '22023', null, 'A12 more than 500 ids is refused');
select lives_ok(
  $$ select * from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
       array(select gen_random_uuid() from generate_series(1, 500))) $$,
  'A13 500 ids is fine');
reset role;

-- ---------------------------------------------------------------------------
-- B. Staff (Tom) — any member gets the venue-wide rule
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b2'),
  row('Former Floor', false)::text, 'B1 staff sees the former member named');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b1'),
  row(null::text, true)::text, 'B2 staff sees the operator as support');
reset role;

-- ---------------------------------------------------------------------------
-- C. Crew (Sven, organizer of ee…01 only) — their own events
-- ---------------------------------------------------------------------------

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b2'),
  row('Former Floor', false)::text, 'C1 crew sees the former member who acted on their event');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b1'),
  row(null::text, true)::text, 'C2 crew sees the operator who worked their event as support');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  row('Tom Bakker', false)::text, 'C3 crew sees a current member named');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b3'),
  null, 'C4 crew does not get a past member who never touched their events');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b4'),
  null, 'C5 crew does not get the crew of another event');
reset role;

-- ---------------------------------------------------------------------------
-- D. Non-member, anon, grants, shape
-- ---------------------------------------------------------------------------

select pg_temp.login('a9000000-0000-4000-8000-0000000000b5'); -- member of venue 2 only
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
            array['55555555-5555-4555-8555-555555555555'::uuid,
                  'a9000000-0000-4000-8000-0000000000b2'::uuid,
                  'a9000000-0000-4000-8000-0000000000b1'::uuid])), 0,
  'D1 a non-member of the venue gets zero rows');
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
       array['55555555-5555-4555-8555-555555555555'::uuid]) $$,
  '42501', null, 'D2 anon cannot execute');
reset role;

select ok(
  has_function_privilege('authenticated', 'public.venue_actor_names(uuid, uuid[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.venue_actor_names(uuid, uuid[])', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.venue_actor_names(uuid, uuid[])', 'EXECUTE')
  and not has_function_privilege('public', 'public.venue_actor_names(uuid, uuid[])', 'EXECUTE'),
  'D3 grant matrix: authenticated only');
select is(
  (select proargnames from pg_proc where oid = 'public.venue_actor_names(uuid, uuid[])'::regprocedure),
  array['p_venue_id', 'p_ids', 'user_id', 'display_name', 'is_support'],
  'D4 exactly three result columns: user_id, display_name, is_support');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] and provolatile = 's'
     from pg_proc where oid = 'public.venue_actor_names(uuid, uuid[])'::regprocedure),
  'D5 SECURITY DEFINER, empty search_path, STABLE');

-- ---------------------------------------------------------------------------
-- E. The operator with a real tie is named; a former member turned operator is support
-- ---------------------------------------------------------------------------

select pg_temp.login('a9000000-0000-4000-8000-0000000000b1');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  row('Tom Bakker', false)::text, 'E1 a platform admin caller is served like a member');
reset role;

insert into public.event_organizers (event_id, user_id)
values ('ee000000-0000-7000-8000-0000000000a2', 'a9000000-0000-4000-8000-0000000000b1');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b1'),
  row('Hidden Operator', false)::text, 'E2 an operator who is crew of one of the venue''s events is named');
reset role;
delete from public.event_organizers
 where event_id = 'ee000000-0000-7000-8000-0000000000a2'
   and user_id = 'a9000000-0000-4000-8000-0000000000b1';

insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b1', '{staff}');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b1'),
  row('Hidden Operator', false)::text, 'E3 an operator who is a real member is named');
reset role;

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'a9000000-0000-4000-8000-0000000000b2';
select set_config('plusone.platform_admin_write', 'off', true);
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b2'),
  row(null::text, true)::text, 'E4 a former member who is now a platform admin is support (no tie left)');
select ok(not exists (
    select 1 from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
      array['a9000000-0000-4000-8000-0000000000b1'::uuid, 'a9000000-0000-4000-8000-0000000000b2'::uuid,
            'a9000000-0000-4000-8000-0000000000b3'::uuid, 'a9000000-0000-4000-8000-0000000000b4'::uuid])
     where display_name is not null and is_support),
  'E5 is_support never carries a name');
reset role;

select * from finish();

rollback;
