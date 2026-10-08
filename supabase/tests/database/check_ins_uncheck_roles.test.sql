-- pgTAP — undoing a check-in is role-dependent (z8uq9m2vg6,
-- 20261010120100_door_checkout_permission.sql). Proves:
--   * the company default is now false, and existing companies were backfilled;
--   * with the setting OFF: doorhost, crew/organizer and staff cannot undo
--     (staff never could reach the row), admin and a user_manager can;
--   * with the setting ON: doorhost and crew/organizer can;
--   * a per-event override OFF beats a company ON for the doorhost, never for
--     admin;
--   * check_out_guest (SECURITY INVOKER) inherits all of it — the whole call
--     aborts for a doorhost with the setting off, and nothing is applied;
--   * can_uncheck_check_in answers the same question for the door UI;
--   * every allowed undo is audited.
-- Seed: admin Max (11..1), user_manager Noor (22..2), organizer/crew Yusuf
-- (44..4, event_organizers on ee..01), staff Tom (55..5), doorhost Lisa (66..6);
-- Club Vesper aa..01, event ee..01, tier dd..01.

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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- Owner helper: put the guest back inside between cases.
create function pg_temp.reset_guest()
returns void language sql as $fn$
  update public.check_ins set voided_at = null, voided_by = null
   where id = 'ca000000-0000-7000-8000-0000000ac001';
$fn$;

select plan(26);

-- ── Default + backfill ──────────────────────────────────────────────────────
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'venues' and column_name = 'allow_uncheck'),
  'false', '1 venues.allow_uncheck defaults to false');
select is((select count(*) from public.venues where allow_uncheck), 0::bigint,
  '2 existing companies were backfilled to off');

-- Fixture (owner): a +2 guest checked in by doorhost Lisa. Noor (manager@) also
-- holds doorhost for this file only — a pure user_manager has no door access
-- (can_check_in) and could not reach the row at all.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-0000000ac001', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Undo Gast', 2, '11111111-1111-4111-8111-111111111111');
insert into public.check_ins (id, guest_id, event_id, checked_by, plus_ones_arrived)
values ('ca000000-0000-7000-8000-0000000ac001', 'cc000000-0000-7000-8000-0000000ac001',
        'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 2);
update public.venue_memberships set roles = '{user_manager,doorhost}'
 where venue_id = 'aa000000-0000-7000-8000-000000000001' and user_id = '22222222-2222-4222-8222-222222222222';

-- ── Setting OFF (the new default) ───────────────────────────────────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(public.can_uncheck_check_in('ee000000-0000-7000-8000-000000000001'), false,
  '3 can_uncheck_check_in is false for a doorhost with the setting off');
select throws_ok($$update public.check_ins
    set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$,
  '42501', null, '4 doorhost undo is refused with the setting off (RLS 42501)');
select throws_ok($$select public.check_out_guest('cc000000-0000-7000-8000-0000000ac001'::uuid, 0)$$,
  '42501', null, '5 check_out_guest inherits the policy: doorhost full check-out refused');
select throws_ok($$select public.check_out_guest('cc000000-0000-7000-8000-0000000ac001'::uuid, 1)$$,
  '42501', null, '6 check_out_guest: doorhost partial check-out refused too');
reset role;
select is((select (voided_at is null, plus_ones_arrived)::text from public.check_ins
            where id = 'ca000000-0000-7000-8000-0000000ac001'),
  (true, 2)::text, '7 nothing was applied by the refused attempts');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok($$update public.check_ins
    set voided_at = now(), voided_by = '44444444-4444-4444-8444-444444444444'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$,
  '42501', null, '8 crew/organizer undo is refused with the setting off (decision 16)');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now() where id = 'ca000000-0000-7000-8000-0000000ac001'$$),
  0, '9 staff cannot undo (no door access at all)');
select is(public.can_uncheck_check_in('ee000000-0000-7000-8000-000000000001'), false,
  '10 can_uncheck_check_in is false for staff with the setting off');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(public.can_uncheck_check_in('ee000000-0000-7000-8000-000000000001'), true,
  '11 can_uncheck_check_in is true for an admin with the setting off');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$),
  1, '12 admin may always undo');
reset role;
select pg_temp.reset_guest();

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is(public.can_uncheck_check_in('ee000000-0000-7000-8000-000000000001'), true,
  '13 can_uncheck_check_in is true for a user_manager with the setting off');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now(), voided_by = '22222222-2222-4222-8222-222222222222'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$),
  1, '14 user_manager may always undo');
reset role;
select pg_temp.reset_guest();

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select ok((public.check_out_guest('cc000000-0000-7000-8000-0000000ac001'::uuid, 1)).id is not null,
  '15 check_out_guest works for an admin with the setting off');
reset role;
select is((select (voided_at is null, plus_ones_arrived)::text from public.check_ins
            where id = 'ca000000-0000-7000-8000-0000000ac001'),
  (true, 0)::text, '16 admin partial check-out applied (1 head stays)');

-- ── Setting ON ──────────────────────────────────────────────────────────────
update public.venues set allow_uncheck = true where id = 'aa000000-0000-7000-8000-000000000001';

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(public.can_uncheck_check_in('ee000000-0000-7000-8000-000000000001'), true,
  '17 can_uncheck_check_in is true for a doorhost with the setting on');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$),
  1, '18 doorhost undo is allowed with the setting on');
reset role;
select pg_temp.reset_guest();

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now(), voided_by = '44444444-4444-4444-8444-444444444444'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$),
  1, '19 crew/organizer undo is allowed with the setting on');
reset role;
select pg_temp.reset_guest();

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select ok((public.check_out_guest('cc000000-0000-7000-8000-0000000ac001'::uuid, 0)).id is not null,
  '20 check_out_guest works for a doorhost with the setting on');
reset role;
select pg_temp.reset_guest();

-- ── Event override OFF beats company ON — for the doorhost only ─────────────
update public.events set allow_uncheck = false where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$update public.check_ins
    set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$,
  '42501', null, '21 event override off: doorhost refused although the company allows it');
-- A revive and a count change on an ACTIVE row are never blocked by the setting.
select is(pg_temp.rowcount($$update public.check_ins
    set plus_ones_arrived = 2, client_timestamp = now()
    where id = 'ca000000-0000-7000-8000-0000000ac001'$$),
  1, '22 "Check in 1" on an active row is not an undo and passes');
reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
    where id = 'ca000000-0000-7000-8000-0000000ac001' and voided_at is null$$),
  1, '23 event override off: admin still may undo');
reset role;

-- ── Audit ───────────────────────────────────────────────────────────────────
select ok(
  (select count(*) from public.audit_log
    where entity_type = 'check_ins' and entity_id = 'ca000000-0000-7000-8000-0000000ac001'
      and action = 'update' and diff -> 'after' ? 'voided_at'
      and (diff -> 'after' ->> 'voided_at') is not null) >= 6,
  '24 every allowed undo left an audit row with the void in its diff');
select is(
  (select count(*) from public.audit_log
    where entity_type = 'check_ins' and entity_id = 'ca000000-0000-7000-8000-0000000ac001'
      and actor_id in ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444')
      and (diff -> 'after' ->> 'voided_at') is not null),
  3::bigint, '25 the doorhost/crew undos are on record under their own names (only the allowed ones)');
select is(
  (select count(*) from public.audit_log
    where entity_type = 'venues' and entity_id = 'aa000000-0000-7000-8000-000000000001'
      and action = 'update' and diff -> 'after' ? 'allow_uncheck'),
  1::bigint, '26 flipping the company setting is audited');

select * from finish();
rollback;
