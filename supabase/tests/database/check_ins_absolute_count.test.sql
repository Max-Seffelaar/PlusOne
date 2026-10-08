-- pgTAP — absolute-count check-in upsert (z8uq9m2vg6,
-- 20261010120000_checkin_absolute_count_guard.sql). Proves, as the door's own
-- write (an upsert on check_ins.id, exactly what PostgREST runs for
-- `.upsert(row, { onConflict: 'id' })`):
--   * a replay of the same outbox item mutates nothing and writes no audit row;
--   * void/revive are ordered by client_timestamp (the stamp of the last
--     void-state change, never moved by count writes); a superseded one, and
--     any change to a voided row, raise PO409 for every role — never silent;
--   * count-only writes always count, also from a clock running behind;
--   * client_timestamp is clamped to now(); check_out_guest is server-stamped;
--   * a check-in cannot move to another guest or be inserted already undone
--     (reviews of PR #423);
--   * the count is never above 1 + plus_ones, through the upsert and a direct
--     insert alike (clamped, decision Max 2026-10-06);
--   * checked_by / checked_at / device_id stay first-wins when a colleague sends
--     "+1" on the row (#11); a revive may move them;
--   * every real change leaves an audit row.
-- Seed: admin Max (11..1), doorhost Lisa (66..6) on Club Vesper (aa..01), event
-- ee..01, tier dd..01.

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

-- The door's write, verbatim in shape: PostgREST names every payload column in
-- the INSERT and sets every one of them again in ON CONFLICT DO UPDATE.
create function pg_temp.upsert(p_id uuid, p_guest uuid, p_by uuid, p_arrived int, p_ts timestamptz, p_device text)
returns void language sql as $fn$
  insert into public.check_ins
    (id, guest_id, event_id, checked_by, plus_ones_arrived, client_timestamp, device_id, offline_synced)
  values
    (p_id, p_guest, 'ee000000-0000-7000-8000-000000000001', p_by, p_arrived, p_ts, p_device, true)
  on conflict (id) do update set
    guest_id = excluded.guest_id,
    event_id = excluded.event_id,
    checked_by = excluded.checked_by,
    plus_ones_arrived = excluded.plus_ones_arrived,
    client_timestamp = excluded.client_timestamp,
    device_id = excluded.device_id,
    offline_synced = excluded.offline_synced;
$fn$;

create function pg_temp.audits(p_id uuid)
returns bigint language sql security definer as $fn$
  select count(*) from public.audit_log where entity_type = 'check_ins' and entity_id = p_id;
$fn$;

select plan(38);

-- Fixture (owner): two guests, +3 and +1, plus the setting on so the doorhost
-- may void in the void/revive part (the role split has its own file).
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by) values
  ('cc000000-0000-7000-8000-0000000ab001', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Absolute Gast', 3, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000ab002', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Direct Gast', 1, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000ab003', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Future Gast', 2, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000ab004', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Skew Gast', 2, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000ab005', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Checkout Gast', 1, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000ab006', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Slow Admin Gast', 1, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000ab007', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Nobody Gast', 0, '11111111-1111-4111-8111-111111111111');
update public.venues set allow_uncheck = true where id = 'aa000000-0000-7000-8000-000000000001';

-- ── A. First tap, replay, second tap ────────────────────────────────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 0, (now() - interval '1 hour' + interval '1 seconds'), 'door-A');
reset role;
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 1::bigint,
  'A1 the first tap inserts the row and writes one audit row (check_in)');
create temp table _first as
  select checked_at, checked_by, device_id from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001';

-- Replay of the same outbox item: identical payload.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 0, (now() - interval '1 hour' + interval '1 seconds'), 'door-A')$$,
  'A2 a replay of the same item is accepted (synced, not an error)');
reset role;
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 1::bigint,
  'A3 the replay writes no audit row');
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), 0,
  'A4 the replay mutates nothing');

-- "Check in 1" twice offline, coalesced to one item with the last absolute count.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 2, (now() - interval '1 hour' + interval '5 seconds'), 'door-A');
reset role;
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), 2,
  'A5 a newer absolute count lands');
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 2::bigint,
  'A6 and is audited (update)');

-- ── B. Stale count ──────────────────────────────────────────────────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 1, (now() - interval '1 hour' + interval '3 seconds'), 'door-A');
reset role;
select is((select (plus_ones_arrived, client_timestamp)::text from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'),
  (2, (now() - interval '1 hour' + interval '1 seconds'))::text,
  'B1 an older count-only write cannot lower the count, and count writes never move the ordering stamp');
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 2::bigint,
  'B2 the stale write leaves no audit row');

-- ── C. Never above 1 + plus_ones ────────────────────────────────────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 9, (now() - interval '1 hour' + interval '9 seconds'), 'door-A');
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), 3,
  'C1 an upsert above the maximum is clamped to plus_ones (3), not refused');
insert into public.check_ins (id, guest_id, event_id, checked_by, plus_ones_arrived, client_timestamp)
values ('ca000000-0000-7000-8000-0000000ab002', 'cc000000-0000-7000-8000-0000000ab002',
        'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 99, (now() - interval '1 hour' + interval '60 seconds'));
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'), 1,
  'C2 a direct insert above the maximum is clamped too');
update public.check_ins set plus_ones_arrived = 50, client_timestamp = (now() - interval '1 hour' + interval '120 seconds')
 where id = 'ca000000-0000-7000-8000-0000000ab002';
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'), 1,
  'C3 a direct update above the maximum is clamped too');
reset role;

-- ── D. First-wins identity under a colleague's "+1" ─────────────────────────
-- Back to 2 arrivals is impossible (monotonic), so use the second guest's row:
-- Lisa checked them in; admin Max taps "Check in 1" on that row from his device.
create temp table _direct as
  select checked_at, checked_by, device_id from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002';
update public.guests set plus_ones = 2 where id = 'cc000000-0000-7000-8000-0000000ab002';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab002', 'cc000000-0000-7000-8000-0000000ab002',
  '11111111-1111-4111-8111-111111111111', 2, (now() - interval '1 hour' + interval '180 seconds'), 'door-B');
reset role;
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'), 2,
  'D1 a colleague''s "+1" raises the count');
select is((select (checked_by, checked_at, device_id)::text from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'),
  (select (checked_by, checked_at, device_id)::text from _direct),
  'D2 checked_by / checked_at / device_id stay first-wins (#11)');

-- ── E. Void and revive are ordered by client_timestamp ──────────────────────
-- Row A's ordering stamp is its first check-in ((now() - interval '1 hour' + interval '1 seconds')); count writes never
-- moved it. A void stamped before that is superseded: refused, never silent.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$update public.check_ins
   set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666',
       client_timestamp = (now() - interval '1 hour' + interval '0 seconds')
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is null$$,
  'PO409', null, 'E1 a superseded void is refused with PO409 (the outbox settles it), never a silent success');
select is((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), null,
  'E1b and the guest stays inside');

update public.check_ins
   set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666',
       client_timestamp = (now() - interval '1 hour' + interval '600 seconds')
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is null;
select isnt((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), null,
  'E2 a newer void lands');

-- A revive queued BEFORE that void (an older device) must not undo it.
select throws_ok($$update public.check_ins
   set voided_at = null, voided_by = null, plus_ones_arrived = 0,
       checked_by = '66666666-6666-4666-8666-666666666666', checked_at = now(),
       client_timestamp = (now() - interval '1 hour' + interval '300 seconds')
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is not null$$,
  'PO409', null, 'E3 a superseded revive is refused with PO409');
select isnt((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), null,
  'E3b and the newer void stands');
reset role;

-- A newer revive by admin Max starts a new arrival: identity may move.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.check_ins
   set voided_at = null, voided_by = null, plus_ones_arrived = 1,
       checked_by = '11111111-1111-4111-8111-111111111111', checked_at = now(),
       client_timestamp = (now() - interval '1 hour' + interval '1200 seconds')
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is not null;
reset role;
select is((select (voided_at is null, plus_ones_arrived, checked_by)::text
             from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'),
  (true, 1, '11111111-1111-4111-8111-111111111111'::uuid)::text,
  'E4 a newer revive brings the guest back and re-attributes the arrival');

-- ── G. Device clocks (reviews of PR #423) ──────────────────────────────────
-- G1/G2: a planted far-future stamp is clamped, so an admin's undo still lands.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab003', 'cc000000-0000-7000-8000-0000000ab003',
  '66666666-6666-4666-8666-666666666666', 0, '2099-01-01 00:00:00+00', 'door-A');
reset role;
select is((select client_timestamp from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab003'), now(),
  'G1 a far-future client_timestamp is clamped to the server''s now() (INSERT leg)');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.check_ins
   set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111', client_timestamp = now()
 where id = 'ca000000-0000-7000-8000-0000000ab003' and voided_at is null;
reset role;
select isnt((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab003'), null,
  'G2 an admin''s undo after a future-dated write still voids the check-in');

-- G3/G4: a colleague whose clock runs behind still gets their "+1" counted,
-- and a count write never moves the ordering stamp.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab004', 'cc000000-0000-7000-8000-0000000ab004',
  '66666666-6666-4666-8666-666666666666', 0, now() - interval '10 minutes', 'door-A');
reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab004', 'cc000000-0000-7000-8000-0000000ab004',
  '11111111-1111-4111-8111-111111111111', 1, now() - interval '20 minutes', 'door-B');
-- …and a NEWER "+1" (a minute ago) does not move it forward either.
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab004', 'cc000000-0000-7000-8000-0000000ab004',
  '11111111-1111-4111-8111-111111111111', 2, now() - interval '1 minute', 'door-B');
reset role;
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab004'), 2,
  'G3 "+1"s from a colleague count, also from a clock running behind');
select is((select client_timestamp from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab004'),
  now() - interval '10 minutes', 'G4 count writes never move the ordering stamp, either way');
-- G5: so an offline undo stamped BETWEEN the check-in and that later "+1" is
-- not superseded by the "+1" (S1b).
select pg_temp.login('66666666-6666-4666-8666-666666666666');
update public.check_ins
   set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666',
       client_timestamp = now() - interval '5 minutes'
 where id = 'ca000000-0000-7000-8000-0000000ab004' and voided_at is null;
reset role;
select isnt((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab004'), null,
  'G5 an offline undo older than a colleague''s later "+1" still lands');

-- G6/G7: a queued "+1" that lands after the undo (row G1 is voided) is
-- reported as superseded for every role, with or without the undo right (S2).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab003', 'cc000000-0000-7000-8000-0000000ab003',
  '11111111-1111-4111-8111-111111111111', 1, now(), 'door-B')$$,
  'PO409', null, 'G6 an admin''s "+1" on a voided row is refused with PO409, not silently dropped');
reset role;
select is((select (voided_at is not null, plus_ones_arrived)::text from public.check_ins
            where id = 'ca000000-0000-7000-8000-0000000ab003'),
  (true, 0)::text, 'G6b nobody is counted on a voided row');
update public.venues set allow_uncheck = false where id = 'aa000000-0000-7000-8000-000000000001';
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab003', 'cc000000-0000-7000-8000-0000000ab003',
  '66666666-6666-4666-8666-666666666666', 1, now(), 'door-A')$$,
  'PO409', null, 'G7 the doorhost without the undo right gets the same PO409 (not a raw 42501)');
reset role;

-- ── H. Superseded and forged writes (review of PR #423) ────────────────────
-- H1: an admin's undo from a clock running behind is reported, not swallowed.
insert into public.check_ins (id, guest_id, event_id, checked_by, plus_ones_arrived, client_timestamp)
values ('ca000000-0000-7000-8000-0000000ab006', 'cc000000-0000-7000-8000-0000000ab006',
        'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 0, now() - interval '10 minutes'),
       ('ca000000-0000-7000-8000-0000000ab005', 'cc000000-0000-7000-8000-0000000ab005',
        'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 1, now() - interval '10 minutes');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$update public.check_ins
   set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111',
       client_timestamp = now() - interval '15 minutes'
 where id = 'ca000000-0000-7000-8000-0000000ab006' and voided_at is null$$,
  'PO409', null, 'H1 an admin''s undo stamped before the check-in (clock behind) is refused with PO409, not reported as done');

-- H2/H3: the cockpit's check_out_guest is stamped by the server, so an older
-- revive from a door device cannot overrule it (S1a).
select ok((public.check_out_guest('cc000000-0000-7000-8000-0000000ab005'::uuid, 0)).id is not null,
  'H2 admin checks the guest out from the cockpit');
reset role;
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$update public.check_ins
   set voided_at = null, voided_by = null, plus_ones_arrived = 1,
       checked_by = '66666666-6666-4666-8666-666666666666', checked_at = now(),
       client_timestamp = now() - interval '5 minutes'
 where id = 'ca000000-0000-7000-8000-0000000ab005' and voided_at is not null$$,
  'PO409', null, 'H3 a door revive queued before that check-out is refused with PO409');

-- H4-H6: a check-in cannot move to another guest (B1), via PATCH or upsert.
select throws_ok($$update public.check_ins set guest_id = 'cc000000-0000-7000-8000-0000000ab007'
                    where id = 'ca000000-0000-7000-8000-0000000ab002'$$,
  '42501', null, 'H4 moving a check-in to another guest (PATCH) is refused');
select throws_ok($$select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab002', 'cc000000-0000-7000-8000-0000000ab007',
  '66666666-6666-4666-8666-666666666666', 3, now(), 'door-A')$$,
  '42501', null, 'H5 moving a check-in to another guest (upsert on id) is refused');
reset role;
select is((select (guest_id, plus_ones_arrived)::text from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'),
  ('cc000000-0000-7000-8000-0000000ab002'::uuid, 2)::text, 'H6 the check-in stays with its guest, count untouched');

-- H7: a check-in cannot be created already undone (it would squat the guest's row).
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$insert into public.check_ins (guest_id, event_id, checked_by, plus_ones_arrived, voided_at, voided_by)
                    values ('cc000000-0000-7000-8000-0000000ab007', 'ee000000-0000-7000-8000-000000000001',
                            '66666666-6666-4666-8666-666666666666', 0, now(), '66666666-6666-4666-8666-666666666666')$$,
  '42501', null, 'H7 inserting an already-undone check-in is refused');
reset role;

-- ── F. Audit trail + scope ──────────────────────────────────────────────────
select is(
  (select array_agg(action order by created_at, id) from public.audit_log
    where entity_type = 'check_ins' and entity_id = 'ca000000-0000-7000-8000-0000000ab001'),
  array['check_in', 'update', 'update', 'update', 'update'],
  'F1 audit rows: the insert, the count, the clamp, the void, the revive — nothing for replays or stale items');
select ok((select bool_and(actor_id is not null) from public.audit_log
            where entity_type = 'check_ins' and entity_id = 'ca000000-0000-7000-8000-0000000ab001'),
  'F2 every audit row names its actor');

-- Owner writes (migrations, retention, fixtures) are not client replays: the
-- guard leaves them alone, so a stale-looking owner write still lands.
update public.check_ins set client_timestamp = '2026-01-01 00:00:00+00'
 where id = 'ca000000-0000-7000-8000-0000000ab001';
select is((select client_timestamp from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'),
  '2026-01-01 00:00:00+00'::timestamptz, 'F3 the guard applies to client writes only');

select has_trigger('public', 'check_ins', 'check_ins_a_stale_guard', 'F4 the stale-guard trigger exists');

select * from finish();
rollback;
