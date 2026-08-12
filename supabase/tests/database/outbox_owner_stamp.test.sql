-- pgTAP — 86ey9et0h: door outbox owner-stamp + cross-user sync.
-- Proves migration 20260812120000_outbox_owner_stamp_sync: a door write may name
-- a DIFFERENT actor than the caller (a shared tablet drained after a doorhost
-- hand-off), but only a door-capable one, and `synced_by` stays pinned to the
-- caller. Also proves the UPDATE hole that migration closes on the way past.
--
-- Relies on the same seed as rls.test.sql (venue1=aa..01 Club Vesper,
-- venue2=aa..02 De Marktzaal, event ee..01 open in venue1; admin=1111,
-- finance=3333, organizer=4444, staff=5555, doorhost=6666). Everything rolls back.
--
-- Reading the roles the way the policy does:
--   1111 admin      -> door-capable (has_venue_role admin)
--   4444 organizer  -> door-capable (is_event_organizer on ee..01)
--   6666 doorhost   -> door-capable
--   5555 staff      -> NOT door-capable  (the forgery target that must fail)
--   3333 finance    -> NOT door-capable

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(16);

-- ---------------------------------------------------------------------------
-- A. INSERT — the hand-off this feature exists for: ALLOWED
-- ---------------------------------------------------------------------------

-- Doorhost Lisa (6666) is the one online now; the queued check-in was tapped by
-- admin Max (1111) before the tablet changed hands. The row must keep Max.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.check_ins (guest_id, checked_by, synced_by, plus_ones_arrived, offline_synced)
  values ((select id from public.guests where full_name = 'Nina Driessen'),
          '11111111-1111-4111-8111-111111111111',
          '66666666-6666-4666-8666-666666666666', 0, true)
$$, 'A1 doorhost may replay a door-capable colleague''s queued check-in');

select is(
  (select checked_by from public.check_ins where guest_id = (select id from public.guests where full_name = 'Nina Driessen')),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'A2 the actor stored is the doorhost who admitted the guest, not the one who synced');

select is(
  (select synced_by from public.check_ins where guest_id = (select id from public.guests where full_name = 'Nina Driessen')),
  '66666666-6666-4666-8666-666666666666'::uuid,
  'A3 synced_by records who transmitted it');

-- The audit trail must name the SESSION, not the stamped actor — that is what
-- keeps "who transmitted this" independently verifiable (guardrail: the audit
-- log may never be forged, whatever the row says about the door).
-- Read as admin: audit_log has a single admin-only SELECT policy, so asserting
-- this as the doorhost would compare NULL against NULL-ish and prove nothing.
-- Pinned to the exact row rather than "latest", so it cannot pass by accident.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select actor_id from public.audit_log
    where entity_type = 'check_ins'
      and entity_id = (select id from public.check_ins
                        where guest_id = (select id from public.guests where full_name = 'Nina Driessen'))),
  '66666666-6666-4666-8666-666666666666'::uuid,
  'A4 audit actor is the syncing session, independent of checked_by');
select pg_temp.login('66666666-6666-4666-8666-666666666666');

-- An organizer is door-capable through event scope rather than a venue role.
select lives_ok($$
  insert into public.check_ins (guest_id, checked_by, synced_by, plus_ones_arrived)
  values ((select id from public.guests where full_name = 'Ruben Cornelissen'),
          '44444444-4444-4444-8444-444444444444',
          '66666666-6666-4666-8666-666666666666', 0)
$$, 'A5 an event organizer also counts as a door-capable actor');

-- ---------------------------------------------------------------------------
-- B. INSERT — everything the bound still refuses: DENIED
-- ---------------------------------------------------------------------------

-- The pin is relaxed to a bound, not removed. A staff member never works the
-- door, so attributing a check-in to them is forgery, not a hand-off.
select throws_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ((select id from public.guests where full_name = 'Isa van der Laan'),
          '55555555-5555-4555-8555-555555555555')
$$, '42501', null, 'B1 cannot attribute a check-in to a staff member (no door role)');

select throws_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ((select id from public.guests where full_name = 'Isa van der Laan'),
          '33333333-3333-4333-8333-333333333333')
$$, '42501', null, 'B2 cannot attribute a check-in to finance');

-- synced_by answers "who transmitted this", which the server knows for certain.
-- There is no reason to accept a client's claim about it, so it stays pinned.
select throws_ok($$
  insert into public.check_ins (guest_id, checked_by, synced_by)
  values ((select id from public.guests where full_name = 'Isa van der Laan'),
          '66666666-6666-4666-8666-666666666666',
          '11111111-1111-4111-8111-111111111111')
$$, '42501', null, 'B3 synced_by cannot name anyone but the caller');

-- Staff could not check anyone in before this migration and still cannot —
-- the relaxation must not have handed the door to a non-door role.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ((select id from public.guests where full_name = 'Isa van der Laan'),
          '66666666-6666-4666-8666-666666666666')
$$, '42501', null, 'B4 a staff member still cannot check anyone in, under any name');

-- ---------------------------------------------------------------------------
-- C. refusals — same bound
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.refusals (guest_id, refused_by, synced_by, reason)
  values ((select id from public.guests where full_name = 'Thijs Brouwer'),
          '11111111-1111-4111-8111-111111111111',
          '66666666-6666-4666-8666-666666666666', 'Not on the list')
$$, 'C1 a queued refusal replays keeping its own refuser');

select throws_ok($$
  insert into public.refusals (guest_id, refused_by, reason)
  values ((select id from public.guests where full_name = 'Mila Schouten'),
          '55555555-5555-4555-8555-555555555555', 'Not on the list')
$$, '42501', null, 'C2 a refusal cannot be attributed to a non-door role');

-- ---------------------------------------------------------------------------
-- D. UPDATE — the pre-existing hole this migration closes
-- ---------------------------------------------------------------------------
-- Before 20260812120000, `check_ins_update_door` carried NO predicate on
-- checked_by, and because permissive policies are OR-ed that made the sibling
-- own-device pin non-binding: any door-scoped user could rewrite the actor of
-- an existing check-in to an arbitrary uuid. `reviveCheckIn` writes that column
-- on exactly this path.

select throws_ok($$
  update public.check_ins
     set checked_by = '55555555-5555-4555-8555-555555555555'
   where guest_id = (select id from public.guests where full_name = 'Nina Driessen')
$$, '42501', null, 'D1 a door user can no longer rewrite checked_by to a non-door role');

select is(
  (select checked_by from public.check_ins where guest_id = (select id from public.guests where full_name = 'Nina Driessen')),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'D2 the original actor survives the rejected rewrite');

-- The legitimate revive path (naming a door-capable actor) still works, so the
-- fix bounds the column without breaking the outbox write that uses it.
select lives_ok($$
  update public.check_ins
     set checked_by = '66666666-6666-4666-8666-666666666666'
   where guest_id = (select id from public.guests where full_name = 'Nina Driessen')
$$, 'D3 a door-capable actor is still an accepted value on UPDATE');

-- ---------------------------------------------------------------------------
-- E. guests — the same hand-off for a door-added walk-in, scoped to source='door'
-- ---------------------------------------------------------------------------
-- Without this, a door-add queued by A and drained by B is rejected 42501 and
-- dead-lettered, taking the check-in chained behind it down with it (FK 23503).
-- NOTE the deliberate consequence, quota-wise: enforce_guest_quota charges
-- `new.added_by`, so a door add replayed for a colleague consumes THAT
-- colleague's allowance, exactly as a same-session drain would have. It also
-- means a door-capable user can charge a walk-in to a door-capable colleague's
-- meter. The guest is never free (the shared event/tier pools still move) and
-- audit_log records the real session as actor; accepted with the 2026-08-12
-- decision as the price of not losing door adds.

select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Handed-over walk-in', '11111111-1111-4111-8111-111111111111', 'door')
$$, 'E1 a queued door add replays keeping the doorhost who added the guest');

-- The relaxation is scoped to the door: added_by on the staff/app path still
-- drives per-adder quota ownership and the staff-scoped guests_select boundary,
-- so it keeps its hard pin.
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'App-path forgery', '11111111-1111-4111-8111-111111111111', 'app')
$$, '42501', null, 'E2 the app/staff path still pins added_by to the caller');

reset role;

select * from finish();
rollback;
