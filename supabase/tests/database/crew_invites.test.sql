-- pgTAP — crew invites (z8uq9m2yvp, 20261007140000_crew_invites.sql).
--
-- External crew is added through an open invite the person ACCEPTS; nothing
-- about the target changes before that (decision Max 2026-10-07). Proves, per
-- role, allowed and denied:
--   A. invites_insert for crew-only invites (admin only, event in the venue,
--      one event per row, quota only on crew invites, one open per event)
--   B. the core privacy property: before accept the inviting company cannot
--      read the target's profile; the LOGIN path does not accept for an
--      existing account; the explicit accept does; then the profile opens
--   C. re-invite of someone already crew never overwrites their quota
--   D. a member of the venue never becomes crew of its own event via an invite
--   E. a FRESH account accepts its crew invite at first login
--   F. my_pending_invites: own invites only, minimal fields; function grants
--
-- Seed: Max (1111) admin @ v1 + v2, Noor (2222) user_manager @ v1, Tom (5555)
-- staff @ v1 with a phone on his profile, Lisa (6666) doorhost @ v1. Mallory is
-- created here: admin of her own company v3 and nothing else, i.e. "anyone who
-- created a venue" (the attacker of the PR #412 review). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.mk_user(p_id uuid, p_email text, p_profile boolean) returns void language plpgsql as $fn$
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
  if p_profile then
    insert into public.user_profiles (id, full_name, email) values (p_id, split_part(p_email, '@', 1), p_email);
  end if;
end;
$fn$;

select plan(34);

-- ── Fixtures (as the migration owner) ───────────────────────────────────────
-- Mallory: her own company v3 with one event; a second v2 event for Max.
select pg_temp.mk_user('c4e00000-0000-4000-8000-0000000000a1', 'mallory@evil.test', true);
insert into public.venues (id, name, slug) values
  ('c4e00000-0000-7000-8000-0000000000f3', 'Mallory Club', 'mallory-club');
insert into public.venue_memberships (venue_id, user_id, roles) values
  ('c4e00000-0000-7000-8000-0000000000f3', 'c4e00000-0000-4000-8000-0000000000a1', '{admin}');
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug) values
  ('c4e00000-0000-7000-8000-0000000000e3', 'c4e00000-0000-7000-8000-0000000000f3', 'Mallory Night',
   now() + interval '3 days', now() + interval '3 days 6 hours', 'open', 'pgtap-crew-mallory-night'),
  ('c4e00000-0000-7000-8000-0000000000e2', 'aa000000-0000-7000-8000-000000000002', 'Marktzaal Crew Night',
   now() + interval '4 days', now() + interval '4 days 6 hours', 'open', 'pgtap-crew-marktzaal-night');
-- A fresh account: auth row, no profile yet (as after inviteUserByEmail).
select pg_temp.mk_user('c4e00000-0000-4000-8000-0000000000b1', 'fresh@crew.test', false);

-- ---------------------------------------------------------------------------
-- A. invites_insert for crew-only invites
-- ---------------------------------------------------------------------------
select pg_temp.login('c4e00000-0000-4000-8000-0000000000a1', 'mallory@evil.test');

select lives_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, crew_quota, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'staff@plusone.test', '{}',
          '{c4e00000-0000-7000-8000-0000000000e3}', 4,
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, 'A1 an admin creates a crew-only invite (no roles, one event, quota) for an existing account');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'door@plusone.test', '{}',
          '{ee000000-0000-7000-8000-000000000001}',
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, '42501', null, 'A2 a crew invite cannot point at another company''s event');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'door@plusone.test', '{}',
          '{ee000000-0000-7000-8000-000000000001}',
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, '42501', null, 'A3 an admin of another company cannot invite crew into a company they are not in');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'staff@plusone.test', '{}',
          '{c4e00000-0000-7000-8000-0000000000e3}',
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, '23505', null, 'A4 one open crew invite per person per event (re-invite = resend, never a new row)');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'two@crew.test', '{}',
          '{c4e00000-0000-7000-8000-0000000000e3,c4e00000-0000-7000-8000-0000000000e3}',
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, '23514', null, 'A5 a crew-only invite carries exactly one event');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, crew_quota, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'team@crew.test', '{staff}', 3,
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, '23514', null, 'A6 crew_quota only on a crew-only invite');

-- As the table owner (RLS refuses it first for an app role): the constraint itself.
reset role;
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'nobody@crew.test', '{}',
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, '23514', null, 'A7 no roles and no event is not an invite (table constraint)');

select pg_temp.login('22222222-2222-4222-8222-222222222222', 'manager@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'dj@crew.test', '{}',
          '{ee000000-0000-7000-8000-000000000001}',
          '22222222-2222-4222-8222-222222222222', now() + interval '7 days')
$$, '42501', null, 'A8 a user_manager cannot invite crew (admin-only grant)');

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'dj@crew.test', '{}',
          '{ee000000-0000-7000-8000-000000000001}',
          '55555555-5555-4555-8555-555555555555', now() + interval '7 days')
$$, '42501', null, 'A9 staff cannot invite crew');

-- A team invite and a crew invite for the same address at one company coexist.
select pg_temp.login('c4e00000-0000-4000-8000-0000000000a1', 'mallory@evil.test');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'both@crew.test', '{staff}',
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days');
  insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
  values ('c4e00000-0000-7000-8000-0000000000f3', 'both@crew.test', '{}',
          '{c4e00000-0000-7000-8000-0000000000e3}',
          'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days')
$$, 'A10 an open team invite and an open crew invite for one address can coexist');

-- ---------------------------------------------------------------------------
-- B. Nothing is visible before accept; the login path does not accept
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.user_profiles where id = '55555555-5555-4555-8555-555555555555'),
          0, 'B1 before accept: the inviting company cannot read the invitee''s profile');
select is((select count(*)::int from public.event_organizers where user_id = '55555555-5555-4555-8555-555555555555'),
          0, 'B2 before accept: no crew row exists');

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select is((select public.accept_pending_invites()), 0,
          'B3 the LOGIN path accepts nothing for an existing account with only a crew invite');
reset role;
select is((select count(*)::int from public.invites
            where lower(email) = 'staff@plusone.test' and accepted_at is null),
          1, 'B4 ... and the crew invite stays open for the banner');

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select results_eq(
  $$ select company_name, roles::text, event_name from public.my_pending_invites() $$,
  $$ values ('Mallory Club'::text, '{}'::text, 'Mallory Night'::text) $$,
  'B5 the banner read gives the company and event name of the invitee''s own open invite');

select is((select public.accept_my_invites()), 1, 'B6 the explicit accept (banner) takes the crew invite');
reset role;
select is((select count(*)::int from public.event_organizers
            where user_id = '55555555-5555-4555-8555-555555555555'
              and event_id = 'c4e00000-0000-7000-8000-0000000000e3'),
          1, 'B7 after accept: crew on exactly that event');
select is((select quota_override from public.event_quotas
            where user_id = '55555555-5555-4555-8555-555555555555'
              and event_id = 'c4e00000-0000-7000-8000-0000000000e3'),
          4, 'B8 after accept: the invite''s guest quota is set');
select is((select count(*)::int from public.venue_memberships
            where user_id = '55555555-5555-4555-8555-555555555555'
              and venue_id = 'c4e00000-0000-7000-8000-0000000000f3'),
          0, 'B9 after accept: no membership of the inviting company (#24)');

select pg_temp.login('c4e00000-0000-4000-8000-0000000000a1', 'mallory@evil.test');
select is((select count(*)::int from public.user_profiles where id = '55555555-5555-4555-8555-555555555555'),
          1, 'B10 only after accept does the company see the crew member''s profile');

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select is((select count(*)::int from public.my_pending_invites()), 0, 'B11 the banner is empty after accept');

-- ---------------------------------------------------------------------------
-- C. Re-invite of someone already crew never overwrites their quota
-- ---------------------------------------------------------------------------
reset role;
update public.event_quotas set quota_override = 10
 where user_id = '55555555-5555-4555-8555-555555555555'
   and event_id = 'c4e00000-0000-7000-8000-0000000000e3';
select pg_temp.login('c4e00000-0000-4000-8000-0000000000a1', 'mallory@evil.test');
insert into public.invites (venue_id, email, roles, event_ids, crew_quota, invited_by, expires_at)
values ('c4e00000-0000-7000-8000-0000000000f3', 'staff@plusone.test', '{}',
        '{c4e00000-0000-7000-8000-0000000000e3}', 2,
        'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days');
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select is((select public.accept_my_invites()), 1, 'C1 the second invite is consumed');
reset role;
select is((select quota_override from public.event_quotas
            where user_id = '55555555-5555-4555-8555-555555555555'
              and event_id = 'c4e00000-0000-7000-8000-0000000000e3'),
          10, 'C2 ... and the quota an admin set since is untouched');

-- ---------------------------------------------------------------------------
-- D. A member of the company never becomes crew of its own event via an invite
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
insert into public.invites (venue_id, email, roles, event_ids, crew_quota, invited_by, expires_at)
values ('aa000000-0000-7000-8000-000000000001', 'door@plusone.test', '{}',
        '{ee000000-0000-7000-8000-000000000001}', 3,
        '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
select pg_temp.login('66666666-6666-4666-8666-666666666666', 'door@plusone.test');
select is((select count(*)::int from public.my_pending_invites()), 0,
          'D1 a crew invite to the user''s own company is not shown in the banner');
select is((select public.accept_my_invites()), 1, 'D2 accept consumes it');
reset role;
select is((select count(*)::int from public.event_organizers
            where user_id = '66666666-6666-4666-8666-666666666666'
              and event_id = 'ee000000-0000-7000-8000-000000000001'),
          0, 'D3 ... without making the team member an organizer of the event');

-- ---------------------------------------------------------------------------
-- E. A FRESH account accepts its crew invite at first login
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
insert into public.invites (venue_id, email, roles, event_ids, crew_quota, invited_by, expires_at)
values ('aa000000-0000-7000-8000-000000000002', 'Fresh@Crew.test', '{}',
        '{c4e00000-0000-7000-8000-0000000000e2}', 5,
        '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
select pg_temp.login('c4e00000-0000-4000-8000-0000000000b1', 'fresh@crew.test');
select is((select public.accept_pending_invites()), 1,
          'E1 a fresh account (no profile yet) accepts its crew invite at first login');
reset role;
select is((select count(*)::int from public.event_organizers
            where user_id = 'c4e00000-0000-4000-8000-0000000000b1'
              and event_id = 'c4e00000-0000-7000-8000-0000000000e2'),
          1, 'E2 ... crew on that event, matched case-insensitively');
select is((select count(*)::int from public.venue_memberships
            where user_id = 'c4e00000-0000-4000-8000-0000000000b1'),
          0, 'E3 ... with no venue membership');

-- ---------------------------------------------------------------------------
-- F. my_pending_invites + function grants
-- ---------------------------------------------------------------------------
select pg_temp.login('c4e00000-0000-4000-8000-0000000000a1', 'mallory@evil.test');
insert into public.invites (venue_id, email, roles, event_ids, invited_by, expires_at)
values ('c4e00000-0000-7000-8000-0000000000f3', 'finance@plusone.test', '{}',
        '{c4e00000-0000-7000-8000-0000000000e3}',
        'c4e00000-0000-4000-8000-0000000000a1', now() + interval '7 days');
-- Lisa logs in carrying Femke's e-mail in her JWT claims: the RPC matches on
-- auth.users, so she still sees nothing of Femke's.
select pg_temp.login('66666666-6666-4666-8666-666666666666', 'finance@plusone.test');
select is((select count(*)::int from public.my_pending_invites()), 0,
          'F1 my_pending_invites returns only invites addressed to the caller''s own auth e-mail');
select throws_ok($$ select public.accept_invites_for_caller(true) $$, '42501', null,
                 'F2 the internal accept worker is not callable by an app role');
reset role;
select ok(not has_function_privilege('anon', 'public.my_pending_invites()', 'execute'),
          'F3 anon cannot execute my_pending_invites');
select ok(not has_function_privilege('anon', 'public.accept_my_invites()', 'execute'),
          'F4 anon cannot execute accept_my_invites');
select ok(has_function_privilege('authenticated', 'public.accept_my_invites()', 'execute'),
          'F5 authenticated can execute accept_my_invites');

select * from finish();
rollback;
