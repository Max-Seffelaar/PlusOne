-- pgTAP — Fase 2: RLS-policies (run: supabase test db)
-- Proves the role matrix (spec §2) per role: allowed AND denied paths.
-- Relies on the seed: venue aa..01 (Club Vesper) with Max=admin, Noor=UM,
-- Femke=finance, Tom=staff, Lisa=doorhost+staff, Yusuf=organizer (event
-- scope only), venue aa..02 with Max=admin, event ee..01 (open) with 30
-- guests. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- Identity helpers: PostgREST-style JWT claims + role switch. The session
-- user stays postgres, so switching back and forth is allowed.
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
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

-- Executes a DML statement under the CURRENT role (RLS applies) and returns
-- the number of affected rows — data-modifying CTEs can't sit in subqueries.
create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(74);

-- ---------------------------------------------------------------------------
-- A. guests SELECT — venue-wide vs own-only vs nothing (§2)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.guests), 30, 'A1 admin sees all 30 guests');

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select is((select count(*)::int from public.guests), 30, 'A2 finance sees all 30 guests (read-only)');

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is((select count(*)::int from public.guests), 30, 'A3 doorhost sees the full event list');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.guests), 30, 'A4 organizer sees all guests of own event');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.guests), 8, 'A5 staff sees ONLY own guests (8)');
select is(
  (select count(*)::int from public.guests
   where added_by <> '55555555-5555-4555-8555-555555555555'),
  0, 'A6 staff sees zero guests added by anyone else');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.guests), 0, 'A7 user_manager sees no guests');

reset role;

-- ---------------------------------------------------------------------------
-- B. cross-venue isolation
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.venues), 1, 'B1 staff (venue 1 only) sees exactly 1 venue');
select is(
  (select count(*)::int from public.venues
   where id = 'aa000000-0000-7000-8000-000000000002'),
  0, 'B2 staff cannot see venue 2 (cross-venue leak)');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.venues), 1, 'B3 organizer sees the venue of his event scope');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.venues), 2, 'B4 multi-venue admin sees both venues');

reset role;

-- ---------------------------------------------------------------------------
-- C. guests INSERT — added_by is always the actor (#27)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Test Staff Toevoeging', '55555555-5555-4555-8555-555555555555')
$$, 'C1 staff adds a guest as themselves');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Vervalste Toevoeger', '11111111-1111-4111-8111-111111111111')
$$, '42501', null, 'C2 staff cannot forge added_by to someone else');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'UM Gast', '22222222-2222-4222-8222-222222222222')
$$, '42501', null, 'C3 user_manager cannot add guests');

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Test Deur Toevoeging', '66666666-6666-4666-8666-666666666666', 'door')
$$, 'C4 doorhost adds a guest at the door');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Test Organizer Toevoeging', '44444444-4444-4444-8444-444444444444')
$$, 'C5 organizer adds a guest to own event');

reset role;

-- ---------------------------------------------------------------------------
-- D. guests UPDATE — own rows vs others' rows
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 1
              where full_name = 'Femke Aalders'$$),
  1, 'D1 staff edits their own guest');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 0
              where id = 'cc000000-0000-7000-8000-000000000001'$$),
  0, 'D2 staff cannot edit a guest added by someone else');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 2
              where id = 'cc000000-0000-7000-8000-000000000001'$$),
  1, 'D3 admin edits any guest of the venue');

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(
  pg_temp.rowcount($$update public.guests set note = 'Gezien & opgepakt'
              where full_name = 'Nina Driessen'$$),
  1, 'D4 doorhost edits any guest at the door (note ack #39)');

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 0
              where id = 'cc000000-0000-7000-8000-000000000001'$$),
  0, 'D5 finance is read-only on guests');

reset role;

-- ---------------------------------------------------------------------------
-- E. list lock (#23): staff blocked, admin/organizer/doorhost keep writing
-- ---------------------------------------------------------------------------

update public.events
set list_locked = true,
    locked_by = '11111111-1111-4111-8111-111111111111',
    locked_at = now()
where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Lock Test Staff', '55555555-5555-4555-8555-555555555555')
$$, '42501', null, 'E1 locked list: staff cannot add');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 0
              where full_name = 'Femke Aalders'$$),
  0, 'E2 locked list: staff cannot edit own guest either');

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Lock Test Deur', '66666666-6666-4666-8666-666666666666', 'door')
$$, 'E3 locked list: doorhost still adds at the door');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Lock Test Organizer', '44444444-4444-4444-8444-444444444444')
$$, 'E4 locked list: organizer keeps write access');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 2
              where id = 'cc000000-0000-7000-8000-000000000001'$$),
  1, 'E5 locked list: admin keeps write access');

reset role;
update public.events set list_locked = false
where id = 'ee000000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- F. hard delete is impossible (#21)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ delete from public.guests where full_name = 'Femke Aalders' $$,
  '42501', null, 'F1 staff cannot hard-delete guests');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ delete from public.guests where id = 'cc000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'F2 even admin cannot hard-delete guests');

reset role;

-- ---------------------------------------------------------------------------
-- G. check_ins — door roles only, actor pinned, double check-in blocked
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
  values ('cc000000-0000-7000-8000-000000000008',
          '66666666-6666-4666-8666-666666666666', 1)
$$, 'G1 doorhost checks a guest in');

select throws_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ('cc000000-0000-7000-8000-000000000002',
          '66666666-6666-4666-8666-666666666666')
$$, '23505', null, 'G2 double check-in blocked by unique constraint');

select throws_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ('cc000000-0000-7000-8000-000000000001',
          '11111111-1111-4111-8111-111111111111')
$$, '42501', null, 'G3 doorhost cannot record a check-in as someone else');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ('cc000000-0000-7000-8000-000000000001',
          '55555555-5555-4555-8555-555555555555')
$$, '42501', null, 'G4 staff cannot check guests in');
select is((select count(*)::int from public.check_ins), 0,
  'G5 staff sees no check-ins (#17)');

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select is((select count(*)::int from public.check_ins), 4,
  'G6 finance sees all check-ins (3 seed + 1 new)');

reset role;

-- ---------------------------------------------------------------------------
-- H. refusals — reason mandatory flow, immutable history
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.refusals (guest_id, refused_by, reason)
  select id, '66666666-6666-4666-8666-666666666666', 'Geen geldig ID'
  from public.guests where full_name = 'Sven Hoekstra'
$$, 'H1 doorhost refuses a guest with a reason');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.refusals (guest_id, refused_by, reason)
  values ('cc000000-0000-7000-8000-000000000001',
          '55555555-5555-4555-8555-555555555555', 'Test')
$$, '42501', null, 'H2 staff cannot refuse guests');

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ update public.refusals set reason = 'Aangepast' $$,
  '42501', null, 'H3 refusals are immutable, even for the refuser');

reset role;

-- ---------------------------------------------------------------------------
-- I. memberships — role-only since 20260702120000 (MFA optional; the old
--    "AAL1 is refused" case is deliberately rewritten: the DENIED path is now
--    the wrong ROLE); UM can never touch admin (escalation)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2');
select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000001',
          '44444444-4444-4444-8444-444444444444', '{staff}')
$$, '42501', null, 'I1 staff cannot grant a membership, even at AAL2 (role is the boundary)');

select pg_temp.login('22222222-2222-4222-8222-222222222222', 'aal1');
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000001',
          '44444444-4444-4444-8444-444444444444', '{staff}')
$$, 'I2 user_manager at AAL1 grants a staff membership (MFA optional)');

select throws_ok($$
  update public.venue_memberships
  set roles = '{staff,admin}'
  where venue_id = 'aa000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555'
$$, '42501', null, 'I3 user_manager cannot escalate anyone to admin');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000002',
          '22222222-2222-4222-8222-222222222222', '{admin}')
$$, 'I4 admin at AAL1 may grant an admin membership (role-only)');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.venue_memberships), 1,
  'I5 staff sees only their own membership');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.venue_memberships
   where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  6, 'I6 user_manager sees all venue-1 memberships (5 seed + 1 new)');

reset role;

-- ---------------------------------------------------------------------------
-- J. quotas — staff read own numbers; granting needs the admin role (role-only;
--    AAL2 dropped for quota grants, migration 20260624160000)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select default_count from public.quotas
   where user_id = '55555555-5555-4555-8555-555555555555'),
  10, 'J1 staff reads their own quota');
select is(
  pg_temp.rowcount($$update public.quotas set default_count = 99
              where user_id = '55555555-5555-4555-8555-555555555555'$$),
  0, 'J2 staff cannot raise their own quota');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select is(
  pg_temp.rowcount($$update public.quotas set default_count = 11
              where user_id = '55555555-5555-4555-8555-555555555555'$$),
  1, 'J3 admin grants quota at AAL1 — role-only, MFA no longer required');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  pg_temp.rowcount($$update public.quotas set default_count = 11
              where user_id = '55555555-5555-4555-8555-555555555555'$$),
  1, 'J4 quota grant still succeeds at AAL2');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok($$
  insert into public.quota_requests (event_id, user_id, requested_extra)
  values ('ee000000-0000-7000-8000-000000000001',
          '55555555-5555-4555-8555-555555555555', 2)
$$, 'J5 staff files a quota request for themselves (#5)');
select is(
  pg_temp.rowcount($$update public.quota_requests
              set status = 'approved',
                  decided_by = '55555555-5555-4555-8555-555555555555',
                  decided_at = now()
              where requested_extra = 2$$),
  0, 'J6 staff cannot approve their own request');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  pg_temp.rowcount($$update public.quota_requests
              set status = 'approved',
                  decided_by = '11111111-1111-4111-8111-111111111111',
                  decided_at = now(),
                  decision_reason = 'Akkoord voor launch night'
              where requested_extra = 3$$),
  1, 'J7 admin (AAL2) decides the pending request');

reset role;

-- ---------------------------------------------------------------------------
-- K. audit log — admin/finance only (role-only; AAL2 dropped for audit-log
--    viewing, migration 20260624160000). Other roles still see nothing.
-- ---------------------------------------------------------------------------

insert into public.audit_log (actor_id, venue_id, entity_type, entity_id, action)
values ('11111111-1111-4111-8111-111111111111',
        'aa000000-0000-7000-8000-000000000001',
        'guests', 'cc000000-0000-7000-8000-000000000001', 'test_entry');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select is((select count(*)::int from public.audit_log where action = 'test_entry'), 1,
  'K1 admin reads the audit log at AAL1 — role-only, MFA no longer required');

-- Since fase 3 the seed itself produces trigger-written entries, so K2/K3
-- pin the hand-inserted row instead of counting the whole table.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is((select count(*)::int from public.audit_log where action = 'test_entry'), 1,
  'K2 admin still reads the audit log at AAL2');

select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2');
select is((select count(*)::int from public.audit_log where action = 'test_entry'), 1,
  'K3 finance reads the audit log');

select pg_temp.login('66666666-6666-4666-8666-666666666666', 'aal2');
select is((select count(*)::int from public.audit_log), 0,
  'K4 doorhost never reads the audit log');

reset role;

-- ---------------------------------------------------------------------------
-- L. profiles — only the user changes their own data (#24)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.user_profiles set full_name = 'Tom B.'
              where id = '55555555-5555-4555-8555-555555555555'$$),
  1, 'L1 user edits their own profile');
select is(
  pg_temp.rowcount($$update public.user_profiles set email = 'gekaapt@plusone.test'
              where id = '11111111-1111-4111-8111-111111111111'$$),
  0, 'L2 nobody changes someone else''s e-mail, not even colleagues');
select is(
  (select count(*)::int from public.user_profiles
   where id = '11111111-1111-4111-8111-111111111111'),
  1, 'L3 staff sees colleague profiles at the same venue');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  (select count(*)::int from public.user_profiles
   where id = '55555555-5555-4555-8555-555555555555'),
  1, 'L4 organizer sees staff profiles of the event venue');

reset role;

-- ---------------------------------------------------------------------------
-- M. landing page — the only anon surface (#12/#28)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  (select count(id)::int from public.events
   where landing_slug = 'plusone-launch-night'),
  1, 'M1 anon sees an event with an active landing link');
select throws_ok(
  $$ select list_locked from public.events
     where landing_slug = 'plusone-launch-night' $$,
  '42501', null, 'M2 anon cannot read internal event columns (lock state)');
select lives_ok($$
  insert into public.guest_requests (event_id, full_name, motivation)
  values ('ee000000-0000-7000-8000-000000000001',
          'Anon Aanvrager', 'Via de landingpage')
$$, 'M3 anon files a landing request');

reset role;
update public.events set landing_active = false
where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();
select is(
  (select count(id)::int from public.events
   where landing_slug = 'plusone-launch-night'),
  0, 'M4 deactivated landing link hides the event (#28)');
select throws_ok($$
  insert into public.guest_requests (event_id, full_name)
  values ('ee000000-0000-7000-8000-000000000001', 'Te Laat')
$$, null, null, 'M5 deactivated landing link refuses new requests');

reset role;
update public.events set landing_active = true
where id = 'ee000000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- N. guest_requests — admin/organizer decide, staff see nothing
-- ---------------------------------------------------------------------------

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.guest_requests), 4,
  'N1 organizer sees all requests of own event (3 seed + 1 anon)');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.guest_requests), 0,
  'N2 staff sees no landing requests');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  pg_temp.rowcount($$update public.guest_requests
              set status = 'approved',
                  decided_by = '44444444-4444-4444-8444-444444444444',
                  decided_at = now()
              where full_name = 'Robin Castelijns'$$),
  1, 'N3 organizer approves a pending request (#12)');

reset role;

-- ---------------------------------------------------------------------------
-- O. subscriptions — members read their venue's entitlement, nothing else
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.subscriptions), 1,
  'O1 member reads the venue subscription status');
select is(
  (select count(*)::int from public.subscriptions
   where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  0, 'O2 no cross-venue subscription visibility');
select throws_ok(
  $$ update public.subscriptions set status = 'active' $$,
  '42501', null, 'O3 app roles never write subscriptions (#32)');

reset role;

-- ---------------------------------------------------------------------------
-- P. events & tiers — admin creates, organizer manages own event
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.events), 1,
  'P1 staff sees the venue events');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is(
  pg_temp.rowcount($$update public.events set landing_active = landing_active
              where id = 'ee000000-0000-7000-8000-000000000001'$$),
  0, 'P2 user_manager cannot modify events');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  pg_temp.rowcount($$update public.events set landing_active = landing_active
              where id = 'ee000000-0000-7000-8000-000000000001'$$),
  1, 'P3 organizer modifies own event (lock/landing toggles, #23)');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.guest_tiers (event_id, name)
  values ('ee000000-0000-7000-8000-000000000001', 'Staff Tier')
$$, '42501', null, 'P4 staff cannot define tiers');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  insert into public.guest_tiers (event_id, name, color)
  values ('ee000000-0000-7000-8000-000000000001', 'Backstage', '#B5A6FF')
$$, 'P5 organizer defines a tier for own event (#8)');

reset role;

select * from finish();

rollback;
