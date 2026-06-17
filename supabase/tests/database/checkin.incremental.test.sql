-- pgTAP — incremental check-in (20260617000000_check_in_incremental.sql).
-- Proves the cap_check_in_arrivals trigger: plus_ones_arrived is clamped into
-- [0, guests.plus_ones] on INSERT and is MONOTONIC on UPDATE (top-up only ever
-- raises, never lowers). Uses the seed: admin Max (11..1) on Club Vesper, open
-- event ee..01 with the regular tier dd..01. Everything rolls back.

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

select plan(6);

-- Admin checks in to the open event (can_check_in: open + admin). All writes
-- below pass RLS (added_by / checked_by pinned to the admin).
select pg_temp.login('11111111-1111-4111-8111-111111111111');

-- Three fresh guests with known allotments (1 + plus_ones).
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by) values
  ('cc000000-0000-7000-8000-00000000a001', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Inc Gast A', 3, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-00000000a002', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Inc Gast B', 5, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-00000000a003', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Inc Gast C', 2, '11111111-1111-4111-8111-111111111111');

-- 1. Insert within allotment is kept verbatim (2 of 3 plus-ones arrive first).
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-00000000a001', '11111111-1111-4111-8111-111111111111', 2);
select is((select plus_ones_arrived from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000a001'),
  2, '1 insert within allotment kept (2 of 3)');

-- 2. Insert over the allotment is clamped down to plus_ones (99 -> 5).
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-00000000a002', '11111111-1111-4111-8111-111111111111', 99);
select is((select plus_ones_arrived from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000a002'),
  5, '2 insert over allotment clamped to plus_ones (5)');

-- 3. Top-up raises arrivals within the allotment (2 -> 3).
update public.check_ins set plus_ones_arrived = 3 where guest_id = 'cc000000-0000-7000-8000-00000000a001';
select is((select plus_ones_arrived from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000a001'),
  3, '3 top-up raises to 3');

-- 4. Top-up over the allotment is clamped to plus_ones (99 -> 3).
update public.check_ins set plus_ones_arrived = 99 where guest_id = 'cc000000-0000-7000-8000-00000000a001';
select is((select plus_ones_arrived from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000a001'),
  3, '4 top-up over allotment clamped to 3');

-- 5. Monotonic: a lower target (stale replay) can never reduce arrivals (1 -> 3).
update public.check_ins set plus_ones_arrived = 1 where guest_id = 'cc000000-0000-7000-8000-00000000a001';
select is((select plus_ones_arrived from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000a001'),
  3, '5 monotonic: lower target ignored, stays 3');

-- 6. Negative arrivals are floored to 0 (last assertion — committed, see events.test.sql).
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-00000000a003', '11111111-1111-4111-8111-111111111111', -5);
select is((select plus_ones_arrived from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000a003'),
  0, '6 negative arrivals floored to 0');

reset role;

select * from finish();

rollback;
