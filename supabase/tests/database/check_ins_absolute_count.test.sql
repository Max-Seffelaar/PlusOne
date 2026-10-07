-- pgTAP — absolute-count check-in upsert (z8uq9m2vg6,
-- 20261010120000_checkin_absolute_count_guard.sql). Proves, as the door's own
-- write (an upsert on check_ins.id, exactly what PostgREST runs for
-- `.upsert(row, { onConflict: 'id' })`):
--   * a replay of the same outbox item mutates nothing and writes no audit row;
--   * an older client_timestamp is ignored — for a count, a void and a revive;
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

select plan(21);

-- Fixture (owner): two guests, +3 and +1, plus the setting on so the doorhost
-- may void in the void/revive part (the role split has its own file).
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by) values
  ('cc000000-0000-7000-8000-0000000ab001', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Absolute Gast', 3, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000ab002', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Direct Gast', 1, '11111111-1111-4111-8111-111111111111');
update public.venues set allow_uncheck = true where id = 'aa000000-0000-7000-8000-000000000001';

-- ── A. First tap, replay, second tap ────────────────────────────────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 0, '2026-10-10 22:00:01+00', 'door-A');
reset role;
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 1::bigint,
  'A1 the first tap inserts the row and writes one audit row (check_in)');
create temp table _first as
  select checked_at, checked_by, device_id from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001';

-- Replay of the same outbox item: identical payload.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 0, '2026-10-10 22:00:01+00', 'door-A')$$,
  'A2 a replay of the same item is accepted (synced, not an error)');
reset role;
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 1::bigint,
  'A3 the replay writes no audit row');
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), 0,
  'A4 the replay mutates nothing');

-- "Check in 1" twice offline, coalesced to one item with the last absolute count.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 2, '2026-10-10 22:00:05+00', 'door-A');
reset role;
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), 2,
  'A5 a newer absolute count lands');
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 2::bigint,
  'A6 and is audited (update)');

-- ── B. Stale count ──────────────────────────────────────────────────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 1, '2026-10-10 22:00:03+00', 'door-A');
reset role;
select is((select (plus_ones_arrived, client_timestamp)::text from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'),
  (2, '2026-10-10 22:00:05+00'::timestamptz)::text,
  'B1 an older client_timestamp is ignored: count and timestamp stay');
select is(pg_temp.audits('ca000000-0000-7000-8000-0000000ab001'), 2::bigint,
  'B2 the stale write leaves no audit row');

-- ── C. Never above 1 + plus_ones ────────────────────────────────────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select pg_temp.upsert('ca000000-0000-7000-8000-0000000ab001', 'cc000000-0000-7000-8000-0000000ab001',
  '66666666-6666-4666-8666-666666666666', 9, '2026-10-10 22:00:09+00', 'door-A');
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), 3,
  'C1 an upsert above the maximum is clamped to plus_ones (3), not refused');
insert into public.check_ins (id, guest_id, event_id, checked_by, plus_ones_arrived, client_timestamp)
values ('ca000000-0000-7000-8000-0000000ab002', 'cc000000-0000-7000-8000-0000000ab002',
        'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 99, '2026-10-10 22:01:00+00');
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'), 1,
  'C2 a direct insert above the maximum is clamped too');
update public.check_ins set plus_ones_arrived = 50, client_timestamp = '2026-10-10 22:02:00+00'
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
  '11111111-1111-4111-8111-111111111111', 2, '2026-10-10 22:03:00+00', 'door-B');
reset role;
select is((select plus_ones_arrived from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'), 2,
  'D1 a colleague''s "+1" raises the count');
select is((select (checked_by, checked_at, device_id)::text from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab002'),
  (select (checked_by, checked_at, device_id)::text from _direct),
  'D2 checked_by / checked_at / device_id stay first-wins (#11)');

-- ── E. Void and revive honour client_timestamp too ──────────────────────────
-- Row A is at ts 22:00:09. A void stamped earlier is a stale outbox item.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
update public.check_ins
   set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666',
       client_timestamp = '2026-10-10 22:00:07+00'
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is null;
select is((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), null,
  'E1 a stale void is ignored: the guest stays inside');

update public.check_ins
   set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666',
       client_timestamp = '2026-10-10 22:10:00+00'
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is null;
select isnt((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), null,
  'E2 a newer void lands');

-- A revive queued BEFORE that void (an older device) must not undo it.
update public.check_ins
   set voided_at = null, voided_by = null, plus_ones_arrived = 0,
       checked_by = '66666666-6666-4666-8666-666666666666', checked_at = now(),
       client_timestamp = '2026-10-10 22:05:00+00'
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is not null;
select isnt((select voided_at from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'), null,
  'E3 a stale revive is ignored: the newer void stands');
reset role;

-- A newer revive by admin Max starts a new arrival: identity may move.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.check_ins
   set voided_at = null, voided_by = null, plus_ones_arrived = 1,
       checked_by = '11111111-1111-4111-8111-111111111111', checked_at = now(),
       client_timestamp = '2026-10-10 22:20:00+00'
 where id = 'ca000000-0000-7000-8000-0000000ab001' and voided_at is not null;
reset role;
select is((select (voided_at is null, plus_ones_arrived, checked_by)::text
             from public.check_ins where id = 'ca000000-0000-7000-8000-0000000ab001'),
  (true, 1, '11111111-1111-4111-8111-111111111111'::uuid)::text,
  'E4 a newer revive brings the guest back and re-attributes the arrival');

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
