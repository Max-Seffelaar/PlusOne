-- pgTAP — Event lifecycle + capacity rule (feedback Joeri/Max, 24 jun 2026).
-- Proves the amended decision #22: removing/rejecting a guest FREES their slot
-- UNLESS the guest is already inside (a non-voided check-in), and the cancel-based
-- gates that replaced status='closed' (can_write_guests / can_check_in / the public
-- request flow). Seed baseline as in quota.test.sql; everything rolls back.

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

select plan(19);

-- Headroom so the personal limit never interferes; only the free/hold RULE is tested.
update public.event_quotas set quota_override = 100000
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';

create temp table cap0 as
  select public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555') as c;

-- ── 1/2: an expected guest consumes a slot; removing them (not inside) frees it ──
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Cap Expected', 0,
        '55555555-5555-4555-8555-555555555555', 'app', 'approved');
select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  (select c from cap0) + 1, '1 adding an expected guest consumes a slot');

update public.guests set status = 'removed' where id = 'cc000000-0000-7000-8000-0000000000f1';
select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  (select c from cap0), '2 removing an expected (not-inside) guest frees the slot');

-- ── 3/4: the pure helper's two branches on a removed guest ──
select is(public.guest_personal_contribution(
  (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000f1'), false),
  0, '3 removed + not inside contributes 0');
select is(public.guest_personal_contribution(
  (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000f1'), true),
  1, '4 removed + inside still contributes its slot (anti-fraud)');

-- ── 5/6: a checked-in guest keeps the slot when removed; voiding frees it ──
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Cap Inside', 0,
        '55555555-5555-4555-8555-555555555555', 'app', 'approved');
-- Check-in (trigger flips the guest to checked_in; set_checkin_scope fills event/venue).
insert into public.check_ins (guest_id, checked_by)
values ('cc000000-0000-7000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111');
update public.guests set status = 'removed' where id = 'cc000000-0000-7000-8000-0000000000f2';
select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  (select c from cap0) + 1, '5 removing a checked-in guest does NOT free the slot');

update public.check_ins set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
  where guest_id = 'cc000000-0000-7000-8000-0000000000f2';
select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  (select c from cap0), '6 voiding the check-in of a removed guest frees the slot');

-- ── 7/8: gates while the event is NOT cancelled ──
select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- doorhost
select is(public.can_check_in('ee000000-0000-7000-8000-000000000001'), true,
  '7 a doorhost can check in to a non-cancelled event (no status gate)');
reset role;
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select is(public.can_write_guests('ee000000-0000-7000-8000-000000000001'), true,
  '8 staff can write to a non-cancelled, unlocked event');
reset role;

-- ── 9: the public request flow accepts a request to an active, non-cancelled event ──
update public.events set landing_active = true
  where id = 'ee000000-0000-7000-8000-000000000001';
select is(public.submit_guest_request(
  (select landing_slug from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'Cap Submitter', null, null, 0, null, null, false) ->> 'status', 'ok',
  '9 a request to an active, non-cancelled event is accepted');

-- ===========================================================================
-- 14.x — M4 follow-up 4A (86ey9c5fp, migration 20260811151000): a `pending`
-- guest row holds NO personal-quota or request-link slot. No shipped surface
-- renders a pending guest (fetchGuests and the door query both scope to
-- approved/checked_in/refused) and no write path produces one, so charging it
-- meant an invisible, unfreeable slot. The anti-fraud "inside keeps the slot"
-- branch (#22) still wins over pending, and promoting the row to approved
-- charges it in full — that is the no-bypass case (14.4).
--
-- Placed before the cancel block below so these writes run against a live
-- event; numbered 14 to keep the existing case numbers stable.
-- ===========================================================================

create temp table cap_pending as
  select public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555') as c;

-- A pending guest with a +2 party (would be 3 slots if it were on the list).
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000f3', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Cap Pending', 2,
        '55555555-5555-4555-8555-555555555555', 'app', 'pending');

select is(public.guest_personal_contribution(
  (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000f3'), false),
  0, '14.1 a pending guest who is not inside contributes 0 personal slots');

select is(public.guest_personal_contribution(
  (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000f3'), true),
  3, '14.2 a pending guest who IS inside still holds its slots (anti-fraud #22 wins)');

select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  (select c from cap_pending),
  '14.3 adding a pending guest does not raise the adder''s consumption');

-- No bypass: the moment the row becomes usable, the quota engine charges it.
update public.guests set status = 'approved'
  where id = 'cc000000-0000-7000-8000-0000000000f3';
select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  (select c from cap_pending) + 3,
  '14.4 promoting pending -> approved charges the full 1 + plus_ones (no bypass)');

-- Same rule for the per-request-link cap (45006), kept in lockstep.
update public.guests set status = 'pending'
  where id = 'cc000000-0000-7000-8000-0000000000f3';
select is(public.link_headcount_contribution(
  (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000f3'), false),
  0, '14.5 a pending guest contributes 0 to a request link''s headcount cap');

update public.guests set status = 'approved'
  where id = 'cc000000-0000-7000-8000-0000000000f3';
select is(public.link_headcount_contribution(
  (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000f3'), false),
  3, '14.6 the same guest approved contributes its full party to the link cap');

-- Leave the fixture off the list so the cancel-gate cases below are unaffected.
update public.guests set status = 'removed'
  where id = 'cc000000-0000-7000-8000-0000000000f3';

-- ── Cancel the event ──
update public.events set cancelled_at = now()
  where id = 'ee000000-0000-7000-8000-000000000001';

-- ── 10/11/12: gates after cancel ──
select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- doorhost
select is(public.can_check_in('ee000000-0000-7000-8000-000000000001'), false,
  '10 a cancelled event blocks check-in');
reset role;
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select is(public.can_write_guests('ee000000-0000-7000-8000-000000000001'), false,
  '11 a cancelled event blocks staff writes');
reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
select is(public.can_write_guests('ee000000-0000-7000-8000-000000000001'), true,
  '12 an admin can still write to a cancelled event');
reset role;

-- ── 13: a cancelled event stops taking public requests (no enumeration) ──
select is(public.submit_guest_request(
  (select landing_slug from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'Cap Submitter Two', null, null, 0, null, null, false) ->> 'status', 'closed',
  '13 a cancelled event stops taking public requests');

select * from finish();

rollback;
