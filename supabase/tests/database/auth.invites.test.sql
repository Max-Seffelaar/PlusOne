-- pgTAP — Fase 4: invites, acceptance, MFA helper and session RPC's.
-- Proves the auth-layer DB surface from 20260613180000_auth_invites_sessions.sql
-- per the role matrix (spec §2) and §5 (sessiebeheer). Allowed AND denied paths.
--
-- Seed identities (venue aa..01 = Club Vesper):
--   Max=admin (also admin @ aa..02), Noor=user_manager, Femke=finance,
--   Tom=staff, Lisa=doorhost+staff, Yusuf=organizer (event scope only, NO
--   venue membership — the clean subject for invite acceptance). Everything
--   rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- PostgREST-style claims + role switch. Carries email + session_id like a real
-- Supabase JWT (the invitee-sees-own policy and is_current both need them).
create function pg_temp.login(
  p_user uuid,
  p_aal text default 'aal1',
  p_email text default null,
  p_session uuid default null
) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal,
    'email', p_email, 'session_id', p_session)::text, true);
  perform set_config('role', 'authenticated', true);
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

-- Fixed UUIDs reused below.
-- v1 = aa000000-0000-7000-8000-000000000001, v2 = ...0002
-- Max=1111…, Noor=2222…, Femke=3333…, Yusuf=4444…, Tom=5555…, Lisa=6666…

select plan(46);

-- ---------------------------------------------------------------------------
-- A. invites INSERT — who may invite, AAL2, escalation guard, forge, x-venue
-- ---------------------------------------------------------------------------

-- A1: admin (AAL2) invites the organizer's e-mail as staff at venue 1.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2', 'admin@plusone.test');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'Organizer@PlusOne.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, 'A1 admin (AAL2) creates an invite');

-- A2: user_manager (AAL2) invites a brand-new staff e-mail.
select pg_temp.login('22222222-2222-4222-8222-222222222222', 'aal2', 'manager@plusone.test');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'newstaff@plusone.test', '{staff}',
          '22222222-2222-4222-8222-222222222222', now() + interval '7 days')
$$, 'A2 user_manager (AAL2) invites a staff member');

-- A3: user_manager can never grant an admin role (escalation guard).
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'wannabe@plusone.test', '{admin}',
          '22222222-2222-4222-8222-222222222222', now() + interval '7 days')
$$, '42501', null, 'A3 user_manager cannot invite an admin (escalation)');

-- A4: AAL2 is mandatory even for admin.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1', 'admin@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'nomfa@plusone.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, '42501', null, 'A4 invite without AAL2 is refused (admin)');

-- A5: staff cannot invite at all.
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2', 'staff@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'x@plusone.test', '{staff}',
          '55555555-5555-4555-8555-555555555555', now() + interval '7 days')
$$, '42501', null, 'A5 staff cannot create invites');

-- A6: invited_by must be the actor (no forging the inviter).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2', 'admin@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'forge@plusone.test', '{staff}',
          '22222222-2222-4222-8222-222222222222', now() + interval '7 days')
$$, '42501', null, 'A6 invited_by cannot be forged to someone else');

-- A7: a manager of venue 1 only cannot invite into venue 2 (cross-venue).
select pg_temp.login('22222222-2222-4222-8222-222222222222', 'aal2', 'manager@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000002', 'crossvenue@plusone.test', '{staff}',
          '22222222-2222-4222-8222-222222222222', now() + interval '7 days')
$$, '42501', null, 'A7 manager cannot invite into a venue they do not manage');

-- ---------------------------------------------------------------------------
-- B. invites SELECT — managers venue-wide, invitee own e-mail, staff nothing
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2', 'admin@plusone.test');
select is((select count(*)::int from public.invites
           where venue_id = 'aa000000-0000-7000-8000-000000000001'),
          2, 'B1 admin sees both venue-1 invites');

select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2', 'finance@plusone.test');
select is((select count(*)::int from public.invites
           where venue_id = 'aa000000-0000-7000-8000-000000000001'),
          2, 'B2 finance sees the venue invites (read)');

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal1', 'staff@plusone.test');
select is((select count(*)::int from public.invites), 0,
          'B3 staff sees no invites');

-- Yusuf, logging in with the e-mail his A1 invite was addressed to, sees it.
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select is((select count(*)::int from public.invites), 1,
          'B4 invitee sees the pending invite addressed to their own e-mail');

reset role;

-- ---------------------------------------------------------------------------
-- D. accept_pending_invites — provision, expiry, idempotency, role merge
-- ---------------------------------------------------------------------------

-- D1: Yusuf (no membership yet) accepts → exactly one invite consumed.
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select is(public.accept_pending_invites(), 1, 'D1 invitee accepts one pending invite');
reset role;
select is((select count(*)::int from public.venue_memberships
           where user_id = '44444444-4444-4444-8444-444444444444'
             and venue_id = 'aa000000-0000-7000-8000-000000000001'),
          1, 'D2 acceptance provisioned the venue membership');
select is((select accepted_at is not null from public.invites
           where lower(email) = 'organizer@plusone.test'
           order by created_at limit 1),
          true, 'D3 the consumed invite is marked accepted');

-- D4: re-accepting with nothing pending is a no-op.
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select is(public.accept_pending_invites(), 0, 'D4 acceptance is idempotent (nothing pending)');
reset role;

-- D5: a second invite (now pending again, since the first is accepted) merges
-- a new role into the existing membership rather than replacing it.
insert into public.invites (venue_id, email, roles, invited_by, expires_at)
values ('aa000000-0000-7000-8000-000000000001', 'organizer@plusone.test', '{doorhost}',
        '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select is(public.accept_pending_invites(), 1, 'D5 a follow-up invite is accepted');
reset role;
select is((select roles @> '{staff,doorhost}'::public.venue_role[]
           from public.venue_memberships
           where user_id = '44444444-4444-4444-8444-444444444444'
             and venue_id = 'aa000000-0000-7000-8000-000000000001'),
          true, 'D6 follow-up invite MERGES the role (staff + doorhost)');

-- D7: an expired invite is never accepted.
insert into public.invites (venue_id, email, roles, invited_by, expires_at)
values ('aa000000-0000-7000-8000-000000000002', 'organizer@plusone.test', '{staff}',
        '11111111-1111-4111-8111-111111111111', now() - interval '1 day');
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select is(public.accept_pending_invites(), 0, 'D7 an expired invite is ignored');
reset role;
select is((select count(*)::int from public.venue_memberships
           where user_id = '44444444-4444-4444-8444-444444444444'
             and venue_id = 'aa000000-0000-7000-8000-000000000002'),
          0, 'D8 expired invite created no membership');

-- D9–D12: quota-at-invite (#4). Accepting an invite that carries default_quota
-- seeds quotas.default_count once; a later invite never clobbers a quota an admin
-- has since adjusted (insert ... on conflict do nothing). Tom (staff) has no
-- venue-2 membership or quota yet, and no other pending venue-2 invite, so it is
-- the clean subject (organizer@ still has the expired venue-2 invite from D7).
insert into public.invites (venue_id, email, roles, invited_by, expires_at, default_quota)
values ('aa000000-0000-7000-8000-000000000002', 'staff@plusone.test', '{staff}',
        '11111111-1111-4111-8111-111111111111', now() + interval '7 days', 9);
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal1', 'staff@plusone.test');
select is(public.accept_pending_invites(), 1, 'D9 an invite carrying a quota is accepted');
reset role;
select is((select default_count from public.quotas
           where user_id = '55555555-5555-4555-8555-555555555555'
             and venue_id = 'aa000000-0000-7000-8000-000000000002'),
          9, 'D10 acceptance seeded quotas.default_count (9) from the invite');

-- Admin later lowers the quota; a fresh invite (99) must NOT overwrite it.
update public.quotas set default_count = 3
  where user_id = '55555555-5555-4555-8555-555555555555'
    and venue_id = 'aa000000-0000-7000-8000-000000000002';
insert into public.invites (venue_id, email, roles, invited_by, expires_at, default_quota)
values ('aa000000-0000-7000-8000-000000000002', 'staff@plusone.test', '{staff}',
        '11111111-1111-4111-8111-111111111111', now() + interval '7 days', 99);
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal1', 'staff@plusone.test');
select is(public.accept_pending_invites(), 1, 'D11 a follow-up invite is accepted');
reset role;
select is((select default_count from public.quotas
           where user_id = '55555555-5555-4555-8555-555555555555'
             and venue_id = 'aa000000-0000-7000-8000-000000000002'),
          3, 'D12 re-accepting never overwrites an adjusted quota (DO NOTHING)');

-- ---------------------------------------------------------------------------
-- C. invites DELETE — revoke a pending invite; accepted invites are immutable
-- ---------------------------------------------------------------------------
-- Clean fixtures inserted as the superuser (RLS bypassed) so the delete checks
-- do not depend on earlier sections.

insert into public.invites (id, venue_id, email, roles, invited_by, expires_at)
values ('ab000000-0000-7000-8000-0000000000c1',
        'aa000000-0000-7000-8000-000000000001', 'del-pending@plusone.test', '{staff}',
        '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at, accepted_at, accepted_by)
values ('ab000000-0000-7000-8000-0000000000c2',
        'aa000000-0000-7000-8000-000000000001', 'del-accepted@plusone.test', '{staff}',
        '11111111-1111-4111-8111-111111111111', now() + interval '7 days',
        now(), '55555555-5555-4555-8555-555555555555');

-- C1: staff cannot revoke (RLS filters the row out → 0 affected).
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2', 'staff@plusone.test');
select is(pg_temp.rowcount($$delete from public.invites
                            where id = 'ab000000-0000-7000-8000-0000000000c1'$$),
          0, 'C1 staff cannot revoke an invite');

-- C2: admin without AAL2 cannot revoke.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1', 'admin@plusone.test');
select is(pg_temp.rowcount($$delete from public.invites
                            where id = 'ab000000-0000-7000-8000-0000000000c1'$$),
          0, 'C2 revoke without AAL2 is refused');

-- C3: admin (AAL2) revokes the pending invite.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2', 'admin@plusone.test');
select is(pg_temp.rowcount($$delete from public.invites
                            where id = 'ab000000-0000-7000-8000-0000000000c1'$$),
          1, 'C3 admin (AAL2) revokes a pending invite');

-- C4: an accepted invite is immutable history — even admin cannot delete it.
select is(pg_temp.rowcount($$delete from public.invites
                            where id = 'ab000000-0000-7000-8000-0000000000c2'$$),
          0, 'C4 accepted invites cannot be deleted (append-only history)');

reset role;

-- ---------------------------------------------------------------------------
-- E. current_user_requires_mfa — admin/finance yes, everyone else no
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(public.current_user_requires_mfa(), true, 'E1 admin requires MFA');

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select is(public.current_user_requires_mfa(), true, 'E2 finance requires MFA');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(public.current_user_requires_mfa(), false, 'E3 staff does not require MFA');

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(public.current_user_requires_mfa(), false, 'E4 doorhost(+staff) does not require MFA');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is(public.current_user_requires_mfa(), false, 'E5 user_manager does not require MFA');

reset role;

-- ---------------------------------------------------------------------------
-- F. session RPC's — own vs admin (shared venue + AAL2), revoke
-- ---------------------------------------------------------------------------

insert into auth.sessions (id, user_id, created_at, updated_at, aal, user_agent, ip) values
  ('55550000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555',
   now(), now(), 'aal1', 'iPhone Safari', '203.0.113.5'),
  ('55550000-0000-4000-8000-000000000002', '66666666-6666-4666-8666-666666666666',
   now(), now(), 'aal1', 'iPad', '203.0.113.9');

-- F1: own sessions, with is_current driven by the session_id claim.
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal1', 'staff@plusone.test',
                     '55550000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.list_own_sessions()), 1,
          'F1 user sees their own session');
select is((select is_current from public.list_own_sessions()
           where session_id = '55550000-0000-4000-8000-000000000001'),
          true, 'F2 the requesting session is flagged current');

-- F3: admin (AAL2) lists a colleague's sessions (shared venue 1).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2', 'admin@plusone.test');
select is((select count(*)::int
           from public.admin_list_user_sessions('55555555-5555-4555-8555-555555555555')),
          1, 'F3 admin (AAL2) lists a member''s sessions');

-- F4: admin without AAL2 is refused.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1', 'admin@plusone.test');
select throws_ok($$ select * from public.admin_list_user_sessions(
                      '55555555-5555-4555-8555-555555555555') $$,
                 '42501', null, 'F4 admin session list needs AAL2');

-- F5: a non-admin cannot list a colleague's sessions even with AAL2.
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2', 'staff@plusone.test');
select throws_ok($$ select * from public.admin_list_user_sessions(
                      '66666666-6666-4666-8666-666666666666') $$,
                 '42501', null, 'F5 non-admin cannot list others'' sessions');

-- F6: a user revokes their own session.
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal1', 'staff@plusone.test',
                     '55550000-0000-4000-8000-000000000001');
select is(public.revoke_own_session('55550000-0000-4000-8000-000000000001'), true,
          'F6 user revokes their own session');
select is((select count(*)::int from public.list_own_sessions()), 0,
          'F7 the revoked session is gone');

-- F8: admin (AAL2) remote-logs-out a member's session; AAL1 is refused.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1', 'admin@plusone.test');
select throws_ok($$ select public.admin_revoke_session(
                      '55550000-0000-4000-8000-000000000002') $$,
                 '42501', null, 'F8 admin remote logout needs AAL2');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2', 'admin@plusone.test');
select is(public.admin_revoke_session('55550000-0000-4000-8000-000000000002'), true,
          'F9 admin (AAL2) remote-logs-out a member''s session');

reset role;

-- ---------------------------------------------------------------------------
-- G. invite event-organizer scope (#6/#24) — admin-only, granted on acceptance
-- ---------------------------------------------------------------------------
-- Two fresh events: one in venue 1 (granted on acceptance) and one in venue 2
-- (must be ignored — the invite belongs to venue 1). Inserted as superuser.

insert into public.events (id, venue_id, name, starts_at, landing_slug) values
  ('ae000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001',
   'Invite Org Test V1', now() + interval '7 days', 'invite-org-test-v1'),
  ('ae000000-0000-7000-8000-0000000000e2', 'aa000000-0000-7000-8000-000000000002',
   'Invite Org Test V2', now() + interval '7 days', 'invite-org-test-v2');

-- G1: a user_manager (AAL2) may invite, but NOT attach event scope (admin-only).
select pg_temp.login('22222222-2222-4222-8222-222222222222', 'aal2', 'manager@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at, event_ids)
  values ('aa000000-0000-7000-8000-000000000001', 'orgscope@plusone.test', '{staff}',
          '22222222-2222-4222-8222-222222222222', now() + interval '7 days',
          array['ae000000-0000-7000-8000-0000000000e1']::uuid[])
$$, '42501', null, 'G1 user_manager cannot attach event scope (admin-only)');

-- G2: an admin (AAL2) may. Capture a venue-1 AND a venue-2 event id; the
-- cross-venue one is ignored at ACCEPTANCE, not refused here.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2', 'admin@plusone.test');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at, event_ids)
  values ('aa000000-0000-7000-8000-000000000001', 'staff@plusone.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days',
          array['ae000000-0000-7000-8000-0000000000e1',
                'ae000000-0000-7000-8000-0000000000e2']::uuid[])
$$, 'G2 admin attaches event scope (incl. a cross-venue id) to an invite');
reset role;

-- G3: the invitee (Tom = staff@) accepts → becomes organizer of the venue-1 event.
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal1', 'staff@plusone.test');
select ok(public.accept_pending_invites() >= 1, 'G3 invitee accepts the event-scope invite');
reset role;
select is((select count(*)::int from public.event_organizers
           where user_id = '55555555-5555-4555-8555-555555555555'
             and event_id = 'ae000000-0000-7000-8000-0000000000e1'),
          1, 'G4 acceptance granted organizer scope on the venue-1 event');

-- G5: the cross-venue event id was filtered out (no organizer row in venue 2).
select is((select count(*)::int from public.event_organizers
           where user_id = '55555555-5555-4555-8555-555555555555'
             and event_id = 'ae000000-0000-7000-8000-0000000000e2'),
          0, 'G5 a cross-venue event id is ignored at acceptance');

reset role;

select * from finish();

rollback;
