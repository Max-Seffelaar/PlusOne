-- pgTAP — venue_actor_names: one who-did-what rule (20261016140000, spec #64a).
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
--     the result has exactly three columns;
--   * review round 1 (20261016140100): a forged quota/event_quota is no
--     footprint; the label words and a blank name cannot be taken as a name;
--     crew of another venue's event and a null venue get nothing;
--   * review round 2: Unicode spaces and invisible characters do not get a
--     label word or a blank past the CHECK or the new-row sanitizer;
--   * review round 3: neither does any default-ignorable, control or format
--     code point, the braille blank or a Hangul filler; 'Unknown' is reserved;
--   * review round 4: NFKC-styled look-alikes and names containing
--     "plusone support" are refused; ZWJ/ZWNJ/U+FE0F are allowed in names;
--   * review round 5: "plusone label" (the chip's accessible-name hint) too.
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

select plan(84);

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

-- ---------------------------------------------------------------------------
-- F. Review round 1 (P1-1): a forged quota is no footprint
-- ---------------------------------------------------------------------------
-- Any company admin can grant a quota to an arbitrary uuid (quotas_insert_admin
-- checks the caller, not the target). That must not turn venue_actor_names into
-- a name directory, nor reveal that a uuid is a PlusOne operator.

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
    ('a9000000-0000-4000-8000-0000000000b6'::uuid, 'van-victim@plusone.test',  'Victim Person'),
    ('a9000000-0000-4000-8000-0000000000b7'::uuid, 'van-v2crew@plusone.test',  'Venue Two Crew'),
    ('a9000000-0000-4000-8000-0000000000b8'::uuid, 'van-former2@plusone.test', 'Former Two')
  ) as u(id, email, name);
insert into public.user_profiles (id, full_name, email)
values
  ('a9000000-0000-4000-8000-0000000000b6', 'Victim Person',  'van-victim@plusone.test'),
  ('a9000000-0000-4000-8000-0000000000b7', 'Venue Two Crew', 'van-v2crew@plusone.test'),
  ('a9000000-0000-4000-8000-0000000000b8', 'Former Two',     'van-former2@plusone.test');

-- Max (admin of venue 2) forges a venue quota and an event quota for the victim
-- and for the operator, who have no tie to venue 2 at all.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.quotas (venue_id, user_id, default_count) values
  ('aa000000-0000-7000-8000-000000000002', 'a9000000-0000-4000-8000-0000000000b6', 3),
  ('aa000000-0000-7000-8000-000000000002', 'a9000000-0000-4000-8000-0000000000b1', 3);
insert into public.event_quotas (event_id, user_id, quota_override) values
  ('ee000000-0000-7000-8000-0000000000a3', 'a9000000-0000-4000-8000-0000000000b6', 4),
  ('ee000000-0000-7000-8000-0000000000a3', 'a9000000-0000-4000-8000-0000000000b1', 4);
select is((select count(*)::int from public.audit_log
            where venue_id = 'aa000000-0000-7000-8000-000000000002'
              and entity_type in ('quotas', 'event_quotas')
              and (diff -> 'after' ->> 'user_id') in ('a9000000-0000-4000-8000-0000000000b6',
                                                      'a9000000-0000-4000-8000-0000000000b1')), 4,
  'F1 precondition: the forged quota and event_quota rows are audited with the victim as subject');
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000002',
            array['a9000000-0000-4000-8000-0000000000b6'::uuid])), 0,
  'F2 a forged quota / event_quota for an untied uuid returns no row (no name)');
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000002',
            array['a9000000-0000-4000-8000-0000000000b1'::uuid])), 0,
  'F3 …and a forged quota for an operator does not reveal is_support either');
reset role;

-- ---------------------------------------------------------------------------
-- G. More gate / crew edges
-- ---------------------------------------------------------------------------

-- Crew of a venue-2 event only.
insert into public.event_organizers (event_id, user_id)
values ('ee000000-0000-7000-8000-0000000000a3', 'a9000000-0000-4000-8000-0000000000b7');
select pg_temp.login('a9000000-0000-4000-8000-0000000000b7');
select is((select count(*)::int from public.venue_actor_names('aa000000-0000-7000-8000-000000000001',
            array['55555555-5555-4555-8555-555555555555'::uuid])), 0,
  'G1 crew of a venue-2 event passing venue 1 gets zero rows');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.venue_actor_names(null,
            array['55555555-5555-4555-8555-555555555555'::uuid])), 0,
  'G2 p_venue_id null returns nothing');
reset role;
select pg_temp.login('a9000000-0000-4000-8000-0000000000b1'); -- a platform admin
select is((select count(*)::int from public.venue_actor_names(null,
            array['55555555-5555-4555-8555-555555555555'::uuid])), 0,
  'G3 …also for a platform admin');
reset role;

-- Former crew: Other Crew loses the ee…a2 tie; their guest there stays.
delete from public.event_organizers
 where event_id = 'ee000000-0000-7000-8000-0000000000a2'
   and user_id = 'a9000000-0000-4000-8000-0000000000b4';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b4'),
  row('Other Crew', false)::text, 'G4 former crew are named for members');
reset role;

-- Former Two: a member who acted only on ee…a2, then left.
insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b8', '{doorhost}');
insert into public.audit_log (actor_id, venue_id, event_id, entity_type, entity_id, action)
values ('a9000000-0000-4000-8000-0000000000b8', 'aa000000-0000-7000-8000-000000000001',
        'ee000000-0000-7000-8000-0000000000a2', 'check_ins', 'cc000000-0000-7000-8000-0000000000b4', 'check_in');
delete from public.venue_memberships
 where venue_id = 'aa000000-0000-7000-8000-000000000001'
   and user_id = 'a9000000-0000-4000-8000-0000000000b8';
select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- crew of ee…01 only
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b8'),
  null, 'G5 crew do not see a former member who acted only on another event');
reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000b8'),
  row('Former Two', false)::text, 'G6 …while members do');
reset role;

-- ---------------------------------------------------------------------------
-- H. Review round 1 (P1-2): the labels are not a name anyone can take
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom renames himself
select throws_ok(
  $$ update public.user_profiles set full_name = 'PlusOne support' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'H1 "PlusOne support" is refused as an own name');
select throws_ok(
  $$ update public.user_profiles set full_name = '   ' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'H2 a blank name is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = '  SYSTEM ' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'H3 "System" is refused, whatever the case or padding');
select throws_ok(
  $$ update public.user_profiles set full_name = 'plusone   Support' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'H4 …and inner whitespace does not get around it');
select lives_ok(
  $$ update public.user_profiles set full_name = 'Tom Bakker' where id = '55555555-5555-4555-8555-555555555555' $$,
  'H5 an ordinary name still saves');
reset role;

-- A new profile born with a reserved name (invite seeds the e-mail local part,
-- e.g. system@…) is not refused — that would break the first login — but stored as 'User'.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', 'a9000000-0000-4000-8000-0000000000b9',
  'authenticated', 'authenticated', 'system@van.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "system"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);
insert into public.user_profiles (id, full_name, email)
values ('a9000000-0000-4000-8000-0000000000b9', 'system', 'system@van.test');
select is((select full_name from public.user_profiles where id = 'a9000000-0000-4000-8000-0000000000b9'),
  'User', 'H6 a NEW profile with a reserved name is stored as "User", not refused');

-- A look-alike passes the CHECK (accepted residual) but never becomes support:
-- is_support is the platform-admin flag, not the name.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.user_profiles set full_name = 'PIusOne support' where id = '55555555-5555-4555-8555-555555555555';
reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.actor('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  row('PIusOne support', false)::text, 'H7 a spoofed look-alike name is just a name: is_support stays false');
reset role;

-- ---------------------------------------------------------------------------
-- I. Review round 2 (N1): Unicode whitespace and invisible characters
-- ---------------------------------------------------------------------------
-- btrim() strips only ASCII spaces; public.profile_name_key() normalises every
-- Unicode space and drops control/format characters, and the CHECK refuses
-- those characters outright. chr() keeps the probes visible in this file:
-- 9 tab, 10 LF, 13 CR, 160 NBSP, 8203 zero-width space, 12288 ideographic space.

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, own row
select throws_ok(
  $$ update public.user_profiles set full_name = chr(160) || 'PlusOne support' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I1 NBSP-prefixed "PlusOne support" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'PlusOne support' || chr(10) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I2 newline-suffixed "PlusOne support" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'System' || chr(13) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I3 CR-suffixed "System" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(9) || 'System' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I4 tab-prefixed "System" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'PlusOne' || chr(8203) || ' support' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I5 a zero-width space inside "PlusOne support" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(8203) || 'System' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I6 zero-width-prefixed "System" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'PlusOne' || chr(160) || 'support' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I7 "PlusOne support" with an inner NBSP is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(12288) || chr(12288) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I8 an ideographic-space-only blank is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(9) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I9 a tab-only blank is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(8203) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'I10 a zero-width-only blank is refused');
select lives_ok(
  $$ update public.user_profiles set full_name = 'Anne' || chr(160) || 'Marie' where id = '55555555-5555-4555-8555-555555555555' $$,
  'I11 a normal name with an inner NBSP ("Anne Marie") is accepted');
update public.user_profiles set full_name = 'Tom Bakker' where id = '55555555-5555-4555-8555-555555555555';
reset role;

-- ensure_my_profile builds the first profile row from auth metadata (the
-- invite seeds it): a spoofed label there becomes 'User'; an invisible
-- character is stripped instead of locking the invitee out.
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
    ('a9000000-0000-4000-8000-0000000000c1'::uuid, 'van-spoof-meta@plusone.test', chr(160) || 'PlusOne support'),
    ('a9000000-0000-4000-8000-0000000000c2'::uuid, 'van-zw-meta@plusone.test',    'Mila' || chr(8203) || ' Jansen')
  ) as u(id, email, name);

select pg_temp.login('a9000000-0000-4000-8000-0000000000c1');
select public.ensure_my_profile();
reset role;
select is((select full_name from public.user_profiles where id = 'a9000000-0000-4000-8000-0000000000c1'),
  'User', 'I12 ensure_my_profile with metadata NBSP+"PlusOne support" stores "User"');

select pg_temp.login('a9000000-0000-4000-8000-0000000000c2');
select public.ensure_my_profile();
reset role;
select is((select full_name from public.user_profiles where id = 'a9000000-0000-4000-8000-0000000000c2'),
  'Mila Jansen', 'I13 an invisible character in the metadata name is stripped, not a locked-out login');

-- ---------------------------------------------------------------------------
-- J. Review round 3 (N1 widened): every default-ignorable / control / format
-- code point, the braille blank, the Hangul fillers and 'Unknown'
-- ---------------------------------------------------------------------------
-- chr(): 8294 U+2066 LRI, 847 U+034F CGJ, 65039 U+FE0F VS16, 12644 U+3164 Hangul
-- filler, 10240 U+2800 braille blank, 917505 U+E0001 language tag, 6158 U+180E
-- Mongolian vowel separator, 1564 U+061C Arabic letter mark, 4447 U+115F Hangul
-- choseong filler, 65440 U+FFA0 halfwidth Hangul filler.

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, own row
select throws_ok(
  $$ update public.user_profiles set full_name = 'System' || chr(8294) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J1 "System" + U+2066 is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'PlusOne support' || chr(847) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J2 "PlusOne support" + U+034F (combining grapheme joiner) is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'Unnamed' || chr(65039) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J3 "Unnamed" + U+FE0F (variation selector) is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(12644) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J4 a U+3164 (Hangul filler) only name is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(10240) || chr(10240) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J5 a U+2800 (braille blank) only name is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'Tom' || chr(917505) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J6 a U+E0001 (tag) character is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = ' Unknown ' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J7 "Unknown" is reserved too');
select throws_ok(
  $$ update public.user_profiles set full_name = 'Tom' || chr(6158) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J8 a U+180E character is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(1564) || 'System' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J9 a U+061C character is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(4447) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J10 a U+115F-only name is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(65440) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'J11 a U+FFA0-only name is refused');
select lives_ok(
  $$ update public.user_profiles set full_name = 'Jos' || chr(233) || ' M' || chr(252) || 'ller' where id = '55555555-5555-4555-8555-555555555555' $$,
  'J12 an ordinary accented name ("Jose Muller" with e-acute / u-umlaut) is accepted');
update public.user_profiles set full_name = 'Tom Bakker' where id = '55555555-5555-4555-8555-555555555555';
reset role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', 'a9000000-0000-4000-8000-0000000000c3',
  'authenticated', 'authenticated', 'van-lri-meta@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('full_name', 'System' || chr(8294)),
  now(), now(), '', '', '', '', '', '', '', ''
);
select pg_temp.login('a9000000-0000-4000-8000-0000000000c3');
select public.ensure_my_profile();
reset role;
select is((select full_name from public.user_profiles where id = 'a9000000-0000-4000-8000-0000000000c3'),
  'User', 'J13 ensure_my_profile with metadata "System" + U+2066 stores "User"');

-- ---------------------------------------------------------------------------
-- K. Review round 4: styled look-alikes (NFKC), the "plusone support" phrase,
-- and the joiners a real name may carry
-- ---------------------------------------------------------------------------
-- Helpers build the styled forms from ASCII so the probes stay readable:
-- Mathematical Sans-Serif Italic (U+1D608 A / U+1D622 a), Mathematical Bold
-- (U+1D400 A / U+1D41A a), fullwidth (U+FF21.., ideographic space U+3000).
create function pg_temp.styled(p text, p_upper int, p_lower int, p_space int)
returns text language sql immutable as $fn$
  select string_agg(
    case
      when ascii(c) between 65 and 90 then chr(p_upper + ascii(c) - 65)
      when ascii(c) between 97 and 122 then chr(p_lower + ascii(c) - 97)
      when c = ' ' then chr(p_space)
      else c
    end, '' order by i)
  from regexp_split_to_table(p, '') with ordinality as t(c, i);
$fn$;
grant execute on function pg_temp.styled(text, int, int, int) to authenticated;

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, own row
select throws_ok(
  $$ update public.user_profiles
        set full_name = chr(9960) || pg_temp.styled('PlusOne support', 120328, 120354, 10240)
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'K1 shield + Mathematical Sans-Serif Italic "PlusOne" + U+2800 + "support" is refused');
select throws_ok(
  $$ update public.user_profiles
        set full_name = pg_temp.styled('PlusOne support', 65313, 65345, 12288)
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'K2 fullwidth "PlusOne support" is refused');
select throws_ok(
  $$ update public.user_profiles
        set full_name = pg_temp.styled('System', 119808, 119834, 32)
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'K3 Mathematical Bold "System" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = chr(9960) || ' PlusOne support desk' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'K4 a name CONTAINING "plusone support" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'System' || chr(8205) where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'K5 "System" + ZWJ is refused (ZWJ is allowed in a name, but stripped from the key)');
select lives_ok(
  $$ update public.user_profiles set full_name = 'Systema Smith' where id = '55555555-5555-4555-8555-555555555555' $$,
  'K6 "Systema Smith" is accepted (single words are token-equal, not contains)');
select lives_ok(
  $$ update public.user_profiles set full_name = 'Zo' || chr(235) || ' ' || chr(26446) where id = '55555555-5555-4555-8555-555555555555' $$,
  'K7 "Zoe (diaeresis) Li (CJK)" is accepted');
select lives_ok(
  $$ update public.user_profiles set full_name = 'Family ' || chr(128104) || chr(8205) || chr(128105) where id = '55555555-5555-4555-8555-555555555555' $$,
  'K8 an emoji ZWJ sequence is accepted');
select lives_ok(
  $$ update public.user_profiles set full_name = 'Heart ' || chr(10084) || chr(65039) where id = '55555555-5555-4555-8555-555555555555' $$,
  'K9 an emoji with U+FE0F is accepted');
update public.user_profiles set full_name = 'Tom Bakker' where id = '55555555-5555-4555-8555-555555555555';
reset role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', 'a9000000-0000-4000-8000-0000000000c4',
  'authenticated', 'authenticated', 'van-styled-meta@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', chr(9960) || pg_temp.styled('PlusOne support', 120328, 120354, 10240)),
  now(), now(), '', '', '', '', '', '', '', ''
);
select pg_temp.login('a9000000-0000-4000-8000-0000000000c4');
select public.ensure_my_profile();
reset role;
select is((select full_name from public.user_profiles where id = 'a9000000-0000-4000-8000-0000000000c4'),
  'User', 'K10 ensure_my_profile with the styled look-alike stores "User"');

-- ---------------------------------------------------------------------------
-- L. Review round 5: the chip's accessible-name hint is reserved too
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, own row
select throws_ok(
  $$ update public.user_profiles set full_name = 'Max (PlusOne label, not a name)' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'L1 a name containing "PlusOne label" is refused');
select throws_ok(
  $$ update public.user_profiles set full_name = 'Syst' || chr(1077) || 'm, PlusOne' || chr(160) || 'label' where id = '55555555-5555-4555-8555-555555555555' $$,
  '23514', null, 'L2 a Cyrillic-e "System" carrying the hint text (NBSP between words) is refused');
reset role;

select * from finish();

rollback;
