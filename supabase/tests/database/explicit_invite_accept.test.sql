-- pgTAP — explicit invite accept / decline (z8uq9m2yvp,
-- 20261007150000_explicit_invite_accept.sql).
--
-- Max's rule: "Data only becomes visible once it has been filled in, the user has
-- been added and the invite has been accepted." A TEAM invite used to auto-accept
-- at login, which let any company admin make an existing account a member (and
-- read its profile) by typing its address. Now nothing accepts at login; each
-- invite is accepted or declined by its invitee, one at a time.
--
-- Footholds: the invitee (Vera), an admin of the inviting company (Max, admin at
-- v1 and v2), an outsider (Eve), anon, and a user_manager. Proves, allowed and
-- denied:
--   A. login path: ensure_my_profile only makes the profile; accept_pending_invites
--      accepts nothing (team or crew); nothing is visible to the company
--   B. nobody but the addressee can accept or decline an invite
--   C. accept is per invite (the other stays open), then the profile opens
--   D. decline: one transition, recorded, audited, closes the invite, grants nothing
--   E. a declined invite frees the slot (re-invite), cannot be resent, cannot be
--      accepted, and nobody can write declined_at directly
--   F. expired invites can be neither accepted nor declined
--   G. declined_invite_mail_context: service_role only, declined invites only
--   H. grants
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.login_service() returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

create function pg_temp.rowcount(p_sql text) returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
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
end;
$fn$;

select plan(41);

-- ── Fixtures (as the migration owner) ───────────────────────────────────────
-- Vera: an auth account with NO profile yet (as right after an invite mail).
-- Eve: an outsider with a profile and no membership. Max (admin v1 + v2) and
-- Noor (user_manager v1) come from the seed. v2 gets a crew event.
select pg_temp.mk_user('e1000000-0000-4000-8000-0000000000a1', 'vera@invite.test');
select pg_temp.mk_user('e1000000-0000-4000-8000-0000000000e1', 'eve@evil.test');
insert into public.user_profiles (id, full_name, email) values
  ('e1000000-0000-4000-8000-0000000000e1', 'Eve', 'eve@evil.test');
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug) values
  ('e1000000-0000-7000-8000-0000000000e2', 'aa000000-0000-7000-8000-000000000002', 'Marktzaal Crew Night',
   now() + interval '4 days', now() + interval '4 days 6 hours', 'open', 'pgtap-explicit-accept-night');

-- Max invites Vera: a TEAM invite at v1 and a CREW invite (quota 4) at v2.
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at) values
  ('e1000000-0000-7000-8000-0000000000b1', 'aa000000-0000-7000-8000-000000000001', 'Vera@Invite.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
insert into public.invites (id, venue_id, email, roles, event_ids, crew_quota, invited_by, expires_at) values
  ('e1000000-0000-7000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000002', 'vera@invite.test', '{}',
   '{e1000000-0000-7000-8000-0000000000e2}', 4,
   '11111111-1111-4111-8111-111111111111', now() + interval '7 days');

-- ---------------------------------------------------------------------------
-- A. The login path creates the profile and accepts nothing
-- ---------------------------------------------------------------------------
select pg_temp.login('e1000000-0000-4000-8000-0000000000a1', 'vera@invite.test');
select lives_ok($$ select public.ensure_my_profile() $$, 'A1 ensure_my_profile runs for a fresh account');
select is((select count(*)::int from public.user_profiles where id = 'e1000000-0000-4000-8000-0000000000a1'),
          1, 'A2 ... and it created the profile');
select is(public.accept_pending_invites(), 0, 'A3 the login path (accept_pending_invites) accepts no invite');
reset role;
select is((select count(*)::int from public.venue_memberships where user_id = 'e1000000-0000-4000-8000-0000000000a1')
          + (select count(*)::int from public.event_organizers where user_id = 'e1000000-0000-4000-8000-0000000000a1'),
          0, 'A4 ... so neither a membership nor crew access exists');
select is((select count(*)::int from public.invites
            where lower(email) = 'vera@invite.test' and accepted_at is null and declined_at is null),
          2, 'A5 both invites are still open');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select is((select count(*)::int from public.user_profiles where id = 'e1000000-0000-4000-8000-0000000000a1'),
          0, 'A6 the inviting company cannot read the invitee''s profile before accept');

select pg_temp.login('e1000000-0000-4000-8000-0000000000a1', 'vera@invite.test');
select is((select count(*)::int from public.my_pending_invites()), 2, 'A7 the invitee sees both invites');

-- ---------------------------------------------------------------------------
-- B. Only the addressee can accept or decline
-- ---------------------------------------------------------------------------
select pg_temp.login('e1000000-0000-4000-8000-0000000000e1', 'eve@evil.test');
select is(public.accept_invite('e1000000-0000-7000-8000-0000000000b1'), false,
          'B1 an outsider cannot accept someone else''s invite');
select is(public.decline_invite('e1000000-0000-7000-8000-0000000000b1'), false,
          'B2 an outsider cannot decline someone else''s invite');
select pg_temp.login('22222222-2222-4222-8222-222222222222', 'manager@plusone.test');
select is(public.accept_invite('e1000000-0000-7000-8000-0000000000b1'), false,
          'B3 a user_manager of the inviting company cannot accept it on the invitee''s behalf');
reset role;
select is((select count(*)::int from public.invites
            where lower(email) = 'vera@invite.test' and accepted_at is null and declined_at is null),
          2, 'B4 both invites are untouched');
select pg_temp.login('e1000000-0000-4000-8000-0000000000a1', 'vera@invite.test');
select is(public.accept_invite('00000000-0000-4000-8000-000000000000'), false, 'B5 an unknown id accepts nothing');

-- ---------------------------------------------------------------------------
-- C. Accept is per invite
-- ---------------------------------------------------------------------------
select is(public.accept_invite('e1000000-0000-7000-8000-0000000000b1'), true, 'C1 the invitee accepts the team invite');
reset role;
select is((select roles::text from public.venue_memberships
            where user_id = 'e1000000-0000-4000-8000-0000000000a1' and venue_id = 'aa000000-0000-7000-8000-000000000001'),
          '{staff}', 'C2 ... and is a staff member of v1');
select is((select count(*)::int from public.invites
            where id = 'e1000000-0000-7000-8000-0000000000b2' and accepted_at is null and declined_at is null),
          1, 'C3 the other invite is still open');
select is((select count(*)::int from public.event_organizers where user_id = 'e1000000-0000-4000-8000-0000000000a1'),
          0, 'C4 ... and gave no crew access');
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select is((select count(*)::int from public.user_profiles where id = 'e1000000-0000-4000-8000-0000000000a1'),
          1, 'C5 after accept the company can read the profile');
select pg_temp.login('e1000000-0000-4000-8000-0000000000a1', 'vera@invite.test');
select is(public.accept_invite('e1000000-0000-7000-8000-0000000000b1'), false, 'C6 accepting twice is a no-op');

-- ---------------------------------------------------------------------------
-- D. Decline
-- ---------------------------------------------------------------------------
select is(public.decline_invite('e1000000-0000-7000-8000-0000000000b2'), true, 'D1 the invitee declines the crew invite');
select is(public.decline_invite('e1000000-0000-7000-8000-0000000000b2'), false,
          'D2 declining twice is no transition (so no second mail)');
select is((select count(*)::int from public.my_pending_invites()), 0, 'D3 it is gone from the invitee''s open list');
select is(public.accept_invite('e1000000-0000-7000-8000-0000000000b2'), false, 'D4 a declined invite can no longer be accepted');
reset role;
select is((select declined_by from public.invites where id = 'e1000000-0000-7000-8000-0000000000b2'),
          'e1000000-0000-4000-8000-0000000000a1'::uuid, 'D5 declined_at and declined_by are recorded');
select is((select count(*)::int from public.event_organizers where user_id = 'e1000000-0000-4000-8000-0000000000a1'),
          0, 'D6 a decline grants nothing');
select is((select count(*)::int from public.audit_log
            where entity_id = 'e1000000-0000-7000-8000-0000000000b2'
              and entity_type = 'invites'
              and actor_id = 'e1000000-0000-4000-8000-0000000000a1'
              and diff::text like '%declined_at%'),
          1, 'D7 the decline is audited under the decliner''s own id');

-- ---------------------------------------------------------------------------
-- E. After a decline
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, event_ids, crew_quota, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000002', 'vera@invite.test', '{}',
          '{e1000000-0000-7000-8000-0000000000e2}', 2,
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, 'E1 the company can invite them again (a declined invite frees the slot)');
select is(pg_temp.rowcount($$
  update public.invites set expires_at = now() + interval '9 days'
   where id = 'e1000000-0000-7000-8000-0000000000b2'
$$), 0, 'E2 a declined invite cannot be resent (RLS: no row to update)');
select throws_ok($$
  update public.invites set declined_at = null where id = 'e1000000-0000-7000-8000-0000000000b2'
$$, '42501', null, 'E3 an admin cannot rewrite declined_at (no column grant)');
select pg_temp.login('e1000000-0000-4000-8000-0000000000a1', 'vera@invite.test');
select throws_ok($$
  update public.invites set declined_at = null where id = 'e1000000-0000-7000-8000-0000000000b2'
$$, '42501', null, 'E4 the invitee cannot reopen their own declined invite directly either');
select is((select count(*)::int from public.my_pending_invites()), 1, 'E5 the new invite is open for them');
reset role;
select throws_ok($$
  update public.invites set accepted_at = now(), accepted_by = 'e1000000-0000-4000-8000-0000000000a1'
   where id = 'e1000000-0000-7000-8000-0000000000b2'
$$, '23514', null, 'E6 a row can never be both accepted and declined (table constraint)');

-- ---------------------------------------------------------------------------
-- F. Expired invites
-- ---------------------------------------------------------------------------
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at) values
  ('e1000000-0000-7000-8000-0000000000b4', 'aa000000-0000-7000-8000-000000000002', 'vera@invite.test', '{finance}',
   '11111111-1111-4111-8111-111111111111', now() - interval '1 day');
select pg_temp.login('e1000000-0000-4000-8000-0000000000a1', 'vera@invite.test');
select is(public.accept_invite('e1000000-0000-7000-8000-0000000000b4'), false, 'F1 an expired invite cannot be accepted');
select is(public.decline_invite('e1000000-0000-7000-8000-0000000000b4'), false, 'F2 ... nor declined (no mail for a dead invite)');

-- ---------------------------------------------------------------------------
-- G. The mail context: service_role only, declined invites only
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from public.declined_invite_mail_context('e1000000-0000-7000-8000-0000000000b2') $$,
                 '42501', null, 'G1 the invitee cannot read the inviter''s address');
reset role;
set local role anon;
select throws_ok($$ select * from public.declined_invite_mail_context('e1000000-0000-7000-8000-0000000000b2') $$,
                 '42501', null, 'G2 anon cannot call it');
reset role;
select pg_temp.login_service();
select is((select row(inviter_email, invitee_email, company_name, is_crew, event_name)::text
             from public.declined_invite_mail_context('e1000000-0000-7000-8000-0000000000b2')),
          '(admin@plusone.test,vera@invite.test,"De Marktzaal",t,"Marktzaal Crew Night")',
          'G3 the service role gets inviter, the address as typed, company, crew flag and event');
select is((select count(*)::int from public.declined_invite_mail_context('e1000000-0000-7000-8000-0000000000b1')),
          0, 'G4 an ACCEPTED invite yields no context');
reset role;

-- ---------------------------------------------------------------------------
-- H. Grants
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.accept_invite(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.decline_invite(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.ensure_my_profile()', 'execute'),
          'H1 authenticated can accept, decline and ensure a profile');
select ok(not has_function_privilege('anon', 'public.accept_invite(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.decline_invite(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.ensure_my_profile()', 'execute'),
          'H2 anon can do none of them');
select ok(not has_function_privilege('authenticated', 'public.accept_invite_for_caller(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.declined_invite_mail_context(uuid)', 'execute'),
          'H3 the internal worker and the mail context are not callable by an app role');
select ok(has_function_privilege('service_role', 'public.declined_invite_mail_context(uuid)', 'execute'),
          'H4 only the service role may read the mail context');

select * from finish();

rollback;
