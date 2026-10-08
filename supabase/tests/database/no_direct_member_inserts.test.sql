-- pgTAP — no direct member / crew inserts for an arbitrary user id (z8uq9m2yvp,
-- 20261007150200_no_direct_member_inserts.sql; decision Max 2026-10-07).
--
-- The attacker is Eve: she created her own company a minute ago, so she is its
-- admin, and she has the user id of a person (door@, Lisa) from somewhere (the audit
-- row of a decline, a leaked export). Before this migration she could write a
-- membership or a crew row for that id with no accept, which opens the person's
-- whole profile to her (can_view_profile). Proves, allowed AND denied:
--   A. memberships: nobody but a platform admin inserts one directly (Eve, the
--      admin of a normal company, a user_manager); accept_invite still works
--   B. event_organizers: Eve cannot add a stranger; an admin CAN put one of the
--      company's own members on an event and CAN add returning crew (already crew
--      on another event of the same company); not across companies; a non-admin
--      cannot; a platform admin can add either
--   C. the helper answers only for an admin of the venue asked about
--
-- Seed: Max (1111) admin @ v1 + v2, Noor (2222) user_manager @ v1, Tom (5555)
-- staff @ v1, Lisa (6666) doorhost @ v1, Yusuf (4444) crew on the seed v1 event
-- ee…0001 (no membership). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.mk_user(p_id uuid, p_email text) returns void language plpgsql as $fn$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', '', '', '', ''
  );
  insert into public.user_profiles (id, full_name, email) values (p_id, split_part(p_email, '@', 1), p_email);
end;
$fn$;

select plan(26);

-- ── Fixtures (as the migration owner) ───────────────────────────────────────
-- Eve: admin of her own company C with an event. Stranger: an account tied to no
-- company. Priya: a platform admin. Two more v1 events and one v2 event.
select pg_temp.mk_user('f2000000-0000-4000-8000-0000000000e1', 'eve@evil.test');
select pg_temp.mk_user('f2000000-0000-4000-8000-0000000000a1', 'stranger@nowhere.test');
select pg_temp.mk_user('f2000000-0000-4000-8000-0000000000a2', 'priya@plusone.test');
insert into public.venues (id, name, slug) values
  ('f2000000-0000-7000-8000-0000000000c1', 'Eve Club', 'eve-club-nodirect');
insert into public.venue_memberships (venue_id, user_id, roles) values
  ('f2000000-0000-7000-8000-0000000000c1', 'f2000000-0000-4000-8000-0000000000e1', '{admin}');
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug) values
  ('f2000000-0000-7000-8000-0000000000d1', 'f2000000-0000-7000-8000-0000000000c1', 'Eve Night',
   now() + interval '3 days', now() + interval '3 days 6 hours', 'open', 'pgtap-nodirect-eve'),
  ('f2000000-0000-7000-8000-0000000000d2', 'aa000000-0000-7000-8000-000000000001', 'Vesper Second',
   now() + interval '5 days', now() + interval '5 days 6 hours', 'open', 'pgtap-nodirect-vesper-2'),
  ('f2000000-0000-7000-8000-0000000000d3', 'aa000000-0000-7000-8000-000000000002', 'Marktzaal Night',
   now() + interval '6 days', now() + interval '6 days 6 hours', 'open', 'pgtap-nodirect-marktzaal');
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true where id = 'f2000000-0000-4000-8000-0000000000a2';
select set_config('plusone.platform_admin_write', 'off', true);

-- ---------------------------------------------------------------------------
-- A. Memberships
-- ---------------------------------------------------------------------------
select pg_temp.login('f2000000-0000-4000-8000-0000000000e1', 'eve@evil.test');
select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('f2000000-0000-7000-8000-0000000000c1', '66666666-6666-4666-8666-666666666666', '{staff}')
$$, '42501', null, 'A1 Eve cannot make Lisa a member of her company with only her uuid');
select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('f2000000-0000-7000-8000-0000000000c1', 'f2000000-0000-4000-8000-0000000000a1', '{staff}')
$$, '42501', null, 'A2 ... nor a stranger (no accept, no membership)');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000a1', '{staff}')
$$, '42501', null, 'A3 the admin of a normal company cannot insert a membership either');

select pg_temp.login('22222222-2222-4222-8222-222222222222', 'manager@plusone.test');
select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000a1', '{staff}')
$$, '42501', null, 'A4 nor can a user_manager');

select pg_temp.login('f2000000-0000-4000-8000-0000000000a2', 'priya@plusone.test');
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000a1', '{staff}')
$$, 'A5 a platform admin can');
reset role;
select is((select count(*)::int from public.venue_memberships
            where user_id = 'f2000000-0000-4000-8000-0000000000a1'), 1,
          'A6 exactly the platform admin''s row exists, none of the refused ones');
delete from public.venue_memberships where user_id = 'f2000000-0000-4000-8000-0000000000a1';

-- The sanctioned path: the invitee accepts.
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at) values
  ('f2000000-0000-7000-8000-0000000000b1', 'aa000000-0000-7000-8000-000000000001', 'stranger@nowhere.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
select pg_temp.login('f2000000-0000-4000-8000-0000000000a1', 'stranger@nowhere.test');
select is(public.accept_invite('f2000000-0000-7000-8000-0000000000b1'), true,
          'A7 accept_invite still creates the membership (definer, not the policy)');
reset role;
select is((select roles::text from public.venue_memberships
            where user_id = 'f2000000-0000-4000-8000-0000000000a1' and venue_id = 'aa000000-0000-7000-8000-000000000001'),
          '{staff}', 'A8 ... as staff at v1');
delete from public.venue_memberships where user_id = 'f2000000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------------------
-- B. event_organizers
-- ---------------------------------------------------------------------------
select pg_temp.login('f2000000-0000-4000-8000-0000000000e1', 'eve@evil.test');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d1', '66666666-6666-4666-8666-666666666666')
$$, '42501', null, 'B1 Eve cannot put Lisa on her event as crew with only her uuid');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d1', 'f2000000-0000-4000-8000-0000000000a1')
$$, '42501', null, 'B2 ... nor a stranger');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d2', 'f2000000-0000-4000-8000-0000000000a1')
$$, '42501', null, 'B3 an admin of a normal company cannot add a stranger as crew either (invite only)');
select lives_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d2', '55555555-5555-4555-8555-555555555555')
$$, 'B4 the admin can put one of the company''s own members (Tom) on an event');
select lives_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d2', '44444444-4444-4444-8444-444444444444')
$$, 'B5 ... and returning crew (Yusuf, already crew on another event of the company)');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d3', '55555555-5555-4555-8555-555555555555')
$$, '42501', null, 'B6 a member of v1 cannot be put on a v2 event by v2''s admin: only ties to THAT company count');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d3', '44444444-4444-4444-8444-444444444444')
$$, '42501', null, 'B7 ... nor crew of a v1 event (returning crew is per company)');

select pg_temp.login('22222222-2222-4222-8222-222222222222', 'manager@plusone.test');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d2', '66666666-6666-4666-8666-666666666666')
$$, '42501', null, 'B8 a non-admin (user_manager) cannot assign crew, even a member');

select pg_temp.login('f2000000-0000-4000-8000-0000000000a2', 'priya@plusone.test');
select lives_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('f2000000-0000-7000-8000-0000000000d2', 'f2000000-0000-4000-8000-0000000000a1')
$$, 'B9 a platform admin can add a stranger as crew');
reset role;
select is((select count(*)::int from public.event_organizers
            where event_id = 'f2000000-0000-7000-8000-0000000000d2'), 3,
          'B10 exactly Tom, Yusuf and the platform admin''s row exist on the event, none of the refused ones');
select is((select count(*)::int from public.event_organizers
            where user_id = '66666666-6666-4666-8666-666666666666'
              and event_id in ('f2000000-0000-7000-8000-0000000000d1', 'f2000000-0000-7000-8000-0000000000d2')), 0,
          'B11 Lisa is on neither event');

-- The sanctioned path for a stranger: a crew invite the person accepts.
insert into public.invites (id, venue_id, email, roles, event_ids, invited_by, expires_at) values
  ('f2000000-0000-7000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000002', 'stranger@nowhere.test', '{}',
   '{f2000000-0000-7000-8000-0000000000d3}', '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
select pg_temp.login('f2000000-0000-4000-8000-0000000000a1', 'stranger@nowhere.test');
select is(public.accept_invite('f2000000-0000-7000-8000-0000000000b2'), true,
          'B12 accept_invite still puts an invited stranger on the event (definer)');
reset role;
select is((select count(*)::int from public.event_organizers
            where event_id = 'f2000000-0000-7000-8000-0000000000d3'
              and user_id = 'f2000000-0000-4000-8000-0000000000a1'), 1,
          'B13 ... as crew of exactly that event');

-- ---------------------------------------------------------------------------
-- C. The helper only answers for an admin of the venue asked about
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select is(public.is_tied_to_venue('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'), true,
          'C1 the venue''s admin: a member is tied to it');
select is(public.is_tied_to_venue('aa000000-0000-7000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000e1'), false,
          'C2 ... an unrelated user is not');
select pg_temp.login('f2000000-0000-4000-8000-0000000000e1', 'eve@evil.test');
select is(public.is_tied_to_venue('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'), false,
          'C3 Eve asking about another company''s member gets false, not the answer');
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select is(public.is_tied_to_venue('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'), false,
          'C4 staff asking about their own company gets false (admins only)');
reset role;
select ok(has_function_privilege('authenticated', 'public.is_tied_to_venue(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.is_tied_to_venue(uuid, uuid)', 'execute'),
          'C5 callable by authenticated (the policy calls it as the caller), not by anon');

select * from finish();

rollback;
