-- pgTAP — atomic (partial) check-out via public.check_out_guest
-- (20260810183000_atomic_check_out_guest.sql, review finding #34, 86ey9e9q2).
--
-- Proves per role WHO may run it (doorhost/admin yes, staff no), the DATABASE
-- state it leaves behind (lowered arrivals, preserved first-wins identity,
-- guests.status mirror), that it can only ever lower a party, that a stale
-- p_check_in_id makes it a no-op instead of touching a peer's row (#35), and —
-- the point of the whole migration — that a rejected check-out applies NOTHING:
-- the void leg is rolled back with it. Seed: admin Max (11..1), staff Tom
-- (55..5), doorhost Lisa (66..6) on Club Vesper, open event ee..01, tier dd..01.

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

-- NULL checks read the returned row's `.id` rather than comparing the composite
-- itself: pgTAP's is() cannot infer a type for a bare NULL, and `composite IS NOT
-- NULL` is only true when EVERY field is non-null (voided_by is null on a live
-- row), so testing the whole record would misreport a perfectly good result.
select plan(15);

-- ── Fixture: a +3 guest, whole party of 4 inside, checked in by ADMIN Max ────
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-00000000d001', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Checkout Gast', 3,
        '11111111-1111-4111-8111-111111111111');
insert into public.check_ins (id, guest_id, checked_by, plus_ones_arrived)
values ('cd000000-0000-7000-8000-00000000d001', 'cc000000-0000-7000-8000-00000000d001',
        '11111111-1111-4111-8111-111111111111', 3);

create temp table _t(checked_at timestamptz);
insert into _t select checked_at from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001';
reset role;

-- 1. Staff has no door scope: no row is visible to update, so the call is a
--    no-op returning NULL — never a partial write.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select ok(
  (select (public.check_out_guest('cc000000-0000-7000-8000-00000000d001'::uuid, 2)).id) is null,
  '1 staff cannot check a guest out (RLS) — NULL, no change');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select plus_ones_arrived from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001'),
  3, '2 staff attempt left the party untouched');
reset role;

-- 3-6. Doorhost partially checks the party out: 4 koppen inside, 2 leave.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select ok(
  (select (public.check_out_guest('cc000000-0000-7000-8000-00000000d001'::uuid, 2,
                                  'cd000000-0000-7000-8000-00000000d001'::uuid)).id) is not null,
  '3 doorhost may partially check a guest out');
select is(
  (select plus_ones_arrived from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001'),
  1, '4 party lowered to 2 koppen (guest + 1 companion)');
select ok(
  (select voided_at from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001') is null,
  '5 the guest is still inside — the void leg did not survive');
select is(
  (select status from public.guests where id = 'cc000000-0000-7000-8000-00000000d001'),
  'checked_in', '6 guests.status still mirrors "binnen" after a partial check-out');

-- 7-8. First-wins arrival identity stays with whoever checked them in (C10):
--      part of the party leaving is not a new arrival.
select is(
  (select checked_by from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  '7 checked_by is preserved, not re-stamped to the checker-out');
select is(
  (select checked_at from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001'),
  (select checked_at from _t),
  '8 checked_at is preserved (the instroom bucket does not move)');

-- 9. A check-out can only LOWER the count: asking for more heads than are
--    inside is clamped, never used to check extra people in.
select public.check_out_guest('cc000000-0000-7000-8000-00000000d001', 4);
select is(
  (select plus_ones_arrived from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001'),
  1, '9 a stale higher head count cannot raise the party');

-- 10. A stale/foreign p_check_in_id matches nothing — the row is untouched (#35).
select ok(
  (select (public.check_out_guest('cc000000-0000-7000-8000-00000000d001'::uuid, 1,
                                  'cd000000-0000-7000-8000-0000000000ff'::uuid)).id) is null,
  '10 a p_check_in_id that is not this guest''s row is a no-op');
select is(
  (select plus_ones_arrived from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d001'),
  1, '11 ... and it left the real check-in alone');

-- 12. Full check-out (0 heads staying) soft-voids the row (#3) and mirrors the
--     guest back to onderweg.
select public.check_out_guest('cc000000-0000-7000-8000-00000000d001', 0);
select is(
  (select voided_at is not null and status = 'approved'
   from public.check_ins c join public.guests g on g.id = c.guest_id
   where c.id = 'cd000000-0000-7000-8000-00000000d001'),
  true, '12 remaining 0 = full soft-void, guest back to onderweg');

-- 13. Already checked out: idempotent NULL, no error, nothing to roll back.
select ok(
  (select (public.check_out_guest('cc000000-0000-7000-8000-00000000d001'::uuid, 0)).id) is null,
  '13 checking out an already-out guest is an idempotent no-op');
reset role;

-- ── 14. ATOMICITY: a rejected check-out applies NOTHING ──────────────────────
-- Uitchecken off for this event (S1.1) makes the RESTRICTIVE policy reject the
-- void leg with 42501. Because both legs share the function's transaction, the
-- guest must come out of it exactly as they went in — this is the failure mode
-- the two-round-trip client had (voided, then stuck).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-00000000d002', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Atomic Gast', 3,
        '11111111-1111-4111-8111-111111111111');
insert into public.check_ins (id, guest_id, checked_by, plus_ones_arrived)
values ('cd000000-0000-7000-8000-00000000d002', 'cc000000-0000-7000-8000-00000000d002',
        '11111111-1111-4111-8111-111111111111', 3);
update public.events set allow_uncheck = false where id = 'ee000000-0000-7000-8000-000000000001';
reset role;

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$select public.check_out_guest('cc000000-0000-7000-8000-00000000d002', 2,
                                  'cd000000-0000-7000-8000-00000000d002')$$,
  '42501', NULL, '14 uncheck disabled rejects the whole check-out (RLS)');
reset role;

-- The rejection aborted the function's transaction, so nothing was applied.
-- (throws_ok caught it; the surrounding test transaction is still usable.)
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select voided_at is null and plus_ones_arrived = 3
   from public.check_ins where id = 'cd000000-0000-7000-8000-00000000d002'),
  true, '15 ... and the guest is untouched: not half-checked-out');
reset role;

select * from finish();

rollback;
