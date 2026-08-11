-- pgTAP — hard event capacity follows the is_inside rule (review SW3, 86ey9e9r9).
-- Proves that the total-event-capacity engine answers the amended decision #22
-- exactly like the personal-quota engine: a removed guest frees the room UNLESS
-- they are physically inside (a non-voided check-in). Before migration
-- 20260810100000 the capacity engine keyed on the dead events.went_live_at, so a
-- checked-in-then-removed guest contributed 0 and a capped event could be filled
-- past its cap. Relies on the seed: venue aa..01 with Max=admin (11..1),
-- Tom=staff (55..5). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- ── Fixture: a hard-capped event (3 slots) with one tier ─────────────────────
insert into public.events (id, venue_id, name, starts_at, capacity)
values ('ee000000-0000-7000-8000-0000000000cb', 'aa000000-0000-7000-8000-000000000001',
        'Capacity Inside Test', now() + interval '7 days', 3);

insert into public.guest_tiers (id, event_id, name)
values ('dd000000-0000-7000-8000-0000000000cb', 'ee000000-0000-7000-8000-0000000000cb', 'CapTier');

select plan(13);

select is(public.event_capacity_consumption('ee000000-0000-7000-8000-0000000000cb'),
  0, '1 a fresh capped event consumes nothing');

-- ── An expected +2 guest fills the cap exactly ───────────────────────────────
-- added_by = admin: exempt from PERSONAL quota, never from room capacity.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000b1', 'ee000000-0000-7000-8000-0000000000cb',
        'dd000000-0000-7000-8000-0000000000cb', 'Cap Inside A', 2,
        '11111111-1111-4111-8111-111111111111', 'app', 'approved');
select is(public.event_capacity_consumption('ee000000-0000-7000-8000-0000000000cb'),
  3, '2 an expected +2 guest consumes 3 slots');

-- ── THE FIX: check them in, then remove them — the room stays occupied ───────
insert into public.check_ins (guest_id, checked_by)
values ('cc000000-0000-7000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111');
update public.guests set status = 'removed'
  where id = 'cc000000-0000-7000-8000-0000000000b1';

select is(public.event_capacity_consumption('ee000000-0000-7000-8000-0000000000cb'),
  3, '3 removing a checked-in guest does NOT free their capacity slots (#22)');

-- Parity with the quota engine on that exact row: same guest, same answer.
select is(
  public.guest_capacity_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000b1'), true),
  public.guest_personal_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000b1'), true),
  '4 capacity and personal quota contribute the same for a removed-but-inside guest');
select is(
  public.guest_capacity_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000b1'), true),
  3, '5 …and that shared answer is the full party (1 + plus_ones)');

-- The behavioural consequence: the cap actually holds. Pre-migration this insert
-- succeeded (consumption was under-counted as 0), overfilling a hard-capped room.
select throws_ok($$insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-0000000000cb', 'dd000000-0000-7000-8000-0000000000cb',
          'Cap Inside Overflow', 0, '11111111-1111-4111-8111-111111111111', 'app')$$,
  '45005', null, '6 a full room (held by a removed-but-inside guest) rejects the next guest');

-- ── Voiding the check-in frees the room again ───────────────────────────────
update public.check_ins set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
  where guest_id = 'cc000000-0000-7000-8000-0000000000b1';
select is(public.event_capacity_consumption('ee000000-0000-7000-8000-0000000000cb'),
  0, '7 voiding the check-in of a removed guest frees the capacity again');

select lives_ok($$insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('cc000000-0000-7000-8000-0000000000b2', 'ee000000-0000-7000-8000-0000000000cb',
          'dd000000-0000-7000-8000-0000000000cb', 'Cap Inside B', 0,
          '11111111-1111-4111-8111-111111111111', 'app')$$,
  '8 the freed room takes a new guest');

-- ── The deliberate divergence from the personal engine: no source exemption ──
-- A landing guest occupies the room (#31 exempts them from the PERSONAL fraud
-- limit only). 1 (Cap Inside B) + 2 (landing +1) = the full cap of 3.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000b3', 'ee000000-0000-7000-8000-0000000000cb',
        'dd000000-0000-7000-8000-0000000000cb', 'Cap Inside Landing', 1,
        '11111111-1111-4111-8111-111111111111', 'landing', 'approved');
select is(public.event_capacity_consumption('ee000000-0000-7000-8000-0000000000cb'),
  3, '9 a landing guest occupies the room like anyone else (#31 is personal-only)');
select is(
  public.guest_personal_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000b3'), false),
  0, '10 …while that same landing guest costs no personal quota (#31)');

-- ── refused, not inside → frees the room (spec #44) ─────────────────────────
update public.guests set status = 'refused'
  where id = 'cc000000-0000-7000-8000-0000000000b3';
select is(public.event_capacity_consumption('ee000000-0000-7000-8000-0000000000cb'),
  1, '11 a refused guest who never got inside frees the room (#44)');

-- ── The dead timestamptz overload is gone (one signature, one rule) ─────────
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guest_capacity_contribution'),
  1, '12 exactly one guest_capacity_contribution overload remains');

-- ── 13 (86ey9c5fp): the SAME parity assertion on a `pending` row ────────────
-- Case 4 above only exercised a `removed` guest, so it stayed green while an
-- earlier version of PR #262 dropped `pending` from the personal engine alone —
-- capacity said 1 + plus_ones, personal said 0, for the identical row. That
-- change was reverted; this case is what would have caught it.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000b9', 'ee000000-0000-7000-8000-0000000000cb',
        'dd000000-0000-7000-8000-0000000000cb', 'Cap Pending Parity', 1,
        '11111111-1111-4111-8111-111111111111', 'app', 'pending');
select is(
  public.guest_capacity_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000b9'), false),
  public.guest_personal_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000b9'), false),
  '13 capacity and personal quota contribute the same for a pending guest');

select * from finish();

rollback;
