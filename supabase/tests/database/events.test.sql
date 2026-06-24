-- pgTAP — Fase 6: event management (run: supabase test db)
-- Proves the status state machine (graph + WHO), landing-slug generation, and
-- tier-max enforcement from 20260613200000_event_management.sql (+ the fase-7
-- quota engine for tier-max). Relies on the seed: venue aa..01 (Club Vesper)
-- with Max=admin (11..1), Yusuf=organizer of event ee..01 (44..4, no venue
-- membership), Tom=staff (55..5); event ee..01 is 'open'. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- Identity helpers (same as rls.test.sql): PostgREST-style JWT claims + role.
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
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

-- A second event in 'draft' for the from-draft transitions, plus an external
-- organizer scope on it (Yusuf) to prove reversals stay admin-only even for an
-- organizer. Inserted as superuser (RLS/role checks bypassed; the validate
-- trigger only fires on UPDATE, so any initial status is fine).
insert into public.events (id, venue_id, name, starts_at, status, landing_slug, landing_active)
values ('ee000000-0000-7000-8000-0000000000ff',
        'aa000000-0000-7000-8000-000000000001',
        'Transition Test', now() + interval '7 days', 'draft', 'transition-test', false);

insert into public.event_organizers (event_id, user_id)
values ('ee000000-0000-7000-8000-0000000000ff', '44444444-4444-4444-8444-444444444444');

-- A tier capped at 1 for the tier-max test.
insert into public.guest_tiers (id, event_id, name, max_guests)
values ('dd000000-0000-7000-8000-0000000000f1',
        'ee000000-0000-7000-8000-000000000001', 'MaxOne', 1);

select plan(46);

-- ---------------------------------------------------------------------------
-- A. Pure state machine (graph + admin matrix) — mirrors status.ts
-- ---------------------------------------------------------------------------

select ok(public.is_valid_event_status_transition('draft', 'open'),  'A1 draft->open valid');
select ok(public.is_valid_event_status_transition('draft', 'closed'),'A2 draft->closed valid');
select ok(public.is_valid_event_status_transition('open', 'live'),   'A3 open->live valid');
select ok(public.is_valid_event_status_transition('open', 'closed'), 'A4 open->closed valid');
select ok(public.is_valid_event_status_transition('open', 'draft'),  'A5 open->draft valid');
select ok(public.is_valid_event_status_transition('live', 'closed'), 'A6 live->closed valid');
select ok(public.is_valid_event_status_transition('live', 'open'),   'A7 live->open valid');
select ok(public.is_valid_event_status_transition('closed', 'open'), 'A8 closed->open valid');

select ok(not public.is_valid_event_status_transition('draft', 'live'),   'A9 draft->live invalid (skip)');
select ok(not public.is_valid_event_status_transition('live', 'draft'),   'A10 live->draft invalid');
select ok(not public.is_valid_event_status_transition('closed', 'draft'), 'A11 closed->draft invalid');
select ok(not public.is_valid_event_status_transition('closed', 'live'),  'A12 closed->live invalid');

select ok(public.event_transition_requires_admin('open', 'draft'),  'A13 open->draft is admin-only');
select ok(public.event_transition_requires_admin('live', 'open'),   'A14 live->open is admin-only');
select ok(public.event_transition_requires_admin('closed', 'open'), 'A15 closed->open is admin-only');
select ok(not public.event_transition_requires_admin('draft', 'open'),  'A16 draft->open not admin-only');
select ok(not public.event_transition_requires_admin('open', 'live'),   'A17 open->live not admin-only');
select ok(not public.event_transition_requires_admin('live', 'closed'), 'A18 live->closed not admin-only');

-- ---------------------------------------------------------------------------
-- B. Trigger enforcement (savepoint-isolated; ee..01 returns to 'open')
-- ---------------------------------------------------------------------------

-- B1: organizer may take their event live (forward).
savepoint b1;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$update public.events set status = 'live'
  where id = 'ee000000-0000-7000-8000-000000000001'$$,
  'B1 organizer: open->live (forward) ok');
reset role;
rollback to savepoint b1;

-- B2: organizer may NOT un-publish (reverse, admin-only).
savepoint b2;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok($$update public.events set status = 'draft'
  where id = 'ee000000-0000-7000-8000-000000000001'$$,
  '45004', null, 'B2 organizer: open->draft blocked (admin-only)');
reset role;
rollback to savepoint b2;

-- B3: admin may un-publish (reverse).
savepoint b3;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$update public.events set status = 'draft'
  where id = 'ee000000-0000-7000-8000-000000000001'$$,
  'B3 admin: open->draft (reverse) ok');
reset role;
rollback to savepoint b3;

-- B4: illegal jump is rejected even for admin (draft->live).
savepoint b4;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$update public.events set status = 'live'
  where id = 'ee000000-0000-7000-8000-0000000000ff'$$,
  '45004', null, 'B4 admin: draft->live invalid jump blocked');
reset role;
rollback to savepoint b4;

-- B5: admin valid forward on the draft event (draft->open).
savepoint b5;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$update public.events set status = 'open'
  where id = 'ee000000-0000-7000-8000-0000000000ff'$$,
  'B5 admin: draft->open ok');
reset role;
rollback to savepoint b5;

-- B6: organizer may cancel/close (forward).
savepoint b6;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$update public.events set status = 'closed'
  where id = 'ee000000-0000-7000-8000-000000000001'$$,
  'B6 organizer: open->closed (cancel) ok');
reset role;
rollback to savepoint b6;

-- B7: went_live_at is stamped on go-live (interaction with the fase-7 live-rule).
savepoint b7;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events set status = 'live'
  where id = 'ee000000-0000-7000-8000-000000000001';
select isnt((select went_live_at from public.events
             where id = 'ee000000-0000-7000-8000-000000000001'), null,
  'B7 went_live_at stamped on go-live');
reset role;
rollback to savepoint b7;

-- B8: admin may reopen a closed event.
savepoint b8;
update public.events set status = 'closed'
  where id = 'ee000000-0000-7000-8000-0000000000ff';   -- superuser: draft->closed valid
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$update public.events set status = 'open'
  where id = 'ee000000-0000-7000-8000-0000000000ff'$$,
  'B8 admin: closed->open (reopen) ok');
reset role;
rollback to savepoint b8;

-- B9: organizer may NOT reopen a closed event (reverse, admin-only).
savepoint b9;
update public.events set status = 'closed'
  where id = 'ee000000-0000-7000-8000-0000000000ff';
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok($$update public.events set status = 'open'
  where id = 'ee000000-0000-7000-8000-0000000000ff'$$,
  '45004', null, 'B9 organizer: closed->open reopen blocked (admin-only)');
reset role;
rollback to savepoint b9;

-- B10: staff cannot change status at all — RLS filters the UPDATE (0 rows).
savepoint b10;
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.events set status = 'live'
    where id = 'ee000000-0000-7000-8000-000000000001'$$),
  0, 'B10 staff cannot change event status (RLS)');
reset role;
rollback to savepoint b10;

-- ---------------------------------------------------------------------------
-- C. Landing-slug generation (BEFORE INSERT trigger + slugify)
-- ---------------------------------------------------------------------------

select is(public.slugify('PLUSONE Launch Night'), 'plusone-launch-night',
  'C1 slugify lowercases and dashes');

-- Blank slug -> generated from the name.
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000f2',
        'aa000000-0000-7000-8000-000000000001', 'FRENZY', now(), '');
select is((select landing_slug from public.events
           where id = 'ee000000-0000-7000-8000-0000000000f2'), 'frenzy',
  'C2 blank slug is generated from the name');

-- NULL slug -> generated, non-empty (NOT NULL is satisfied by the trigger).
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000f4',
        'aa000000-0000-7000-8000-000000000001', 'Gala Night', now(), null);
select is((select landing_slug from public.events
           where id = 'ee000000-0000-7000-8000-0000000000f4'), 'gala-night',
  'C3 NULL slug is generated, NOT NULL satisfied');

-- Collision -> de-collided with a suffix.
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000f3',
        'aa000000-0000-7000-8000-000000000001', 'FRENZY', now(), '');
select ok(
  (select landing_slug from public.events where id = 'ee000000-0000-7000-8000-0000000000f3')
    like 'frenzy-%'
  and (select landing_slug from public.events where id = 'ee000000-0000-7000-8000-0000000000f3')
    <> 'frenzy',
  'C4 colliding generated slug gets a unique suffix');

-- Explicit slug is respected as-is.
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000f5',
        'aa000000-0000-7000-8000-000000000001', 'Zomerfeest', now(), 'mijn-eigen-link');
select is((select landing_slug from public.events
           where id = 'ee000000-0000-7000-8000-0000000000f5'), 'mijn-eigen-link',
  'C5 explicit slug is kept verbatim');

-- ---------------------------------------------------------------------------
-- D. Tier max (#8) — enforced by the fase-7 quota engine (SQLSTATE 45002)
-- ---------------------------------------------------------------------------
-- Admin is exempt from PERSONAL quota but tier-max applies to everyone.

select pg_temp.login('11111111-1111-4111-8111-111111111111');

select lives_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, added_by)
  values ('cc000000-0000-7000-8000-0000000000f1',
          'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-0000000000f1', 'Tier Gast 1',
          '11111111-1111-4111-8111-111111111111')
$$, 'D1 first guest fills the max-1 tier');

select throws_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, added_by)
  values ('cc000000-0000-7000-8000-0000000000f2',
          'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-0000000000f1', 'Tier Gast 2',
          '11111111-1111-4111-8111-111111111111')
$$, '45002', null, 'D2 second guest is rejected — tier full');

-- A removed guest frees the tier entry (occupancy excludes removed/denied).
update public.guests set status = 'removed'
  where id = 'cc000000-0000-7000-8000-0000000000f1';
select lives_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, added_by)
  values ('cc000000-0000-7000-8000-0000000000f3',
          'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-0000000000f1', 'Tier Gast 3',
          '11111111-1111-4111-8111-111111111111')
$$, 'D3 a removed guest frees the tier slot');

reset role;

-- ---------------------------------------------------------------------------
-- E. Organizer assignment (#6/#24) — admin role only (event_organizers RLS).
--    AAL2 was dropped for organizer assignment (migration 20260624160000):
--    it now needs the admin role and succeeds at AAL1. Wrong-role denial stays.
--    Backs the assignOrganizer / inviteOrganizer / removeOrganizer actions.
-- ---------------------------------------------------------------------------

-- E1: admin (still works at AAL2) assigns an existing user as organizer.
savepoint e1;
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('ee000000-0000-7000-8000-000000000001',
          '55555555-5555-4555-8555-555555555555')
$$, 'E1 admin (AAL2) assigns an organizer');
reset role;
rollback to savepoint e1;

-- E2: admin at AAL1 may now assign an organizer (AAL2 no longer required).
savepoint e2;
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select lives_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('ee000000-0000-7000-8000-000000000001',
          '55555555-5555-4555-8555-555555555555')
$$, 'E2 admin (AAL1) assigns an organizer — role-only, no MFA');
reset role;
rollback to savepoint e2;

-- E3: an organizer cannot assign further organizers (not admin).
savepoint e3;
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal2');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('ee000000-0000-7000-8000-000000000001',
          '55555555-5555-4555-8555-555555555555')
$$, '42501', null, 'E3 organizer cannot assign organizers');
reset role;
rollback to savepoint e3;

-- E4: admin with MFA removes an organizer scope (the account is untouched, #24).
savepoint e4;
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  pg_temp.rowcount($$delete from public.event_organizers
    where event_id = 'ee000000-0000-7000-8000-000000000001'
      and user_id = '44444444-4444-4444-8444-444444444444'$$),
  1, 'E4 admin (AAL2) removes an organizer scope');
reset role;
-- As superuser (RLS bypassed): the profile row physically persists (#24).
select is((select count(*)::int from public.user_profiles
           where id = '44444444-4444-4444-8444-444444444444'),
  1, 'E5 the removed organizer''s account still exists (#24)');
rollback to savepoint e4;

-- ---------------------------------------------------------------------------
-- F. Auto-lock op tijd (#23) — effective lock once auto_lock_at <= now().
--    Same role split as the manual lock: staff blocked, door roles keep writing.
-- ---------------------------------------------------------------------------

-- F1: auto-lock in the PAST -> staff can no longer add (RLS can_write_guests).
savepoint f1;
update public.events set auto_lock_at = now() - interval '1 hour'
  where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Auto-lock Staff',
          '55555555-5555-4555-8555-555555555555')
$$, '42501', null, 'F1 auto-lock passed: staff cannot add');
reset role;
rollback to savepoint f1;

-- F2: doorhost still adds at the door after the auto-lock.
savepoint f2;
update public.events set auto_lock_at = now() - interval '1 hour'
  where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Auto-lock Deur',
          '66666666-6666-4666-8666-666666666666', 'door')
$$, 'F2 auto-lock passed: doorhost still adds at the door');
reset role;
rollback to savepoint f2;

-- F3: organizer keeps write access after the auto-lock.
savepoint f3;
update public.events set auto_lock_at = now() - interval '1 hour'
  where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Auto-lock Organizer',
          '44444444-4444-4444-8444-444444444444')
$$, 'F3 auto-lock passed: organizer keeps write access');
reset role;
rollback to savepoint f3;

-- F4: auto-lock in the FUTURE -> staff can still add (not locked yet).
savepoint f4;
update public.events set auto_lock_at = now() + interval '1 hour'
  where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Pre-lock Staff',
          '55555555-5555-4555-8555-555555555555')
$$, 'F4 auto-lock not yet reached: staff can still add');
reset role;
rollback to savepoint f4;

-- F5: admin always keeps write access.
-- This is the LAST assertion in the file and is deliberately NOT savepoint-wrapped.
-- pgTAP's test counter (curr_test, which finish() reports) lives in a temp table and
-- is transactional, while the printed `ok N` numbering comes from a non-transactional
-- sequence. `rollback to savepoint` reverts the counter but not the numbering, so a
-- trailing savepoint-isolated section desyncs finish() from the plan (it under-reports
-- the tests run). The earlier savepoint sections (B, E, F1–F4) stay correct only because
-- committed assertions run after them; this final assertion must commit so curr_test
-- reaches 46. The outer `rollback` still discards its writes. Any section added below
-- MUST keep a committed (non-rolled-back) assertion last.
update public.events set auto_lock_at = now() - interval '1 hour'
  where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Auto-lock Admin',
          '11111111-1111-4111-8111-111111111111')
$$, 'F5 auto-lock passed: admin keeps write access');
reset role;

select * from finish();

rollback;
