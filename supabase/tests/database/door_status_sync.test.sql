-- pgTAP — door status sync (20260619120000_door_status_sync.sql). Proves that a
-- check-in / void / revive / refusal at the door moves guests.status to mirror
-- the action (so the Gastenlijst reflects it for every role, incl. staff who
-- cannot read check_ins/refusals), idempotently, without resurrecting a removed
-- guest, and quota-neutral. Seed: admin Max (11..1) on Club Vesper, open event
-- ee..01, regular tier dd..01. Everything rolls back.

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

select plan(8);

select pg_temp.login('11111111-1111-4111-8111-111111111111');

-- Fresh approved guests added by the admin.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by) values
  ('cc000000-0000-7000-8000-0000000d0001', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Sync Gast A', 2, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000d0002', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Sync Gast B', 0, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000d0003', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Sync Gast C', 0, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000d0004', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Sync Gast D', 1, '11111111-1111-4111-8111-111111111111');

-- 1. A check-in flips the guest to 'checked_in'.
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-0000000d0001', '11111111-1111-4111-8111-111111111111', 1);
select is((select status::text from public.guests where id = 'cc000000-0000-7000-8000-0000000d0001'),
  'checked_in', '1 check-in moves guests.status to checked_in');

-- 2. Soft-void returns the guest to 'approved' (onderweg).
update public.check_ins set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
  where guest_id = 'cc000000-0000-7000-8000-0000000d0001';
select is((select status::text from public.guests where id = 'cc000000-0000-7000-8000-0000000d0001'),
  'approved', '2 voiding the check-in returns guests.status to approved');

-- 3. Revive (un-void) flips it back to 'checked_in'.
update public.check_ins set voided_at = null, voided_by = null, plus_ones_arrived = 0
  where guest_id = 'cc000000-0000-7000-8000-0000000d0001';
select is((select status::text from public.guests where id = 'cc000000-0000-7000-8000-0000000d0001'),
  'checked_in', '3 reviving the check-in flips guests.status back to checked_in');

-- 4. A refusal flips an approved guest to 'refused'.
insert into public.refusals (guest_id, refused_by, reason)
values ('cc000000-0000-7000-8000-0000000d0002', '11111111-1111-4111-8111-111111111111', 'Geen ID');
select is((select status::text from public.guests where id = 'cc000000-0000-7000-8000-0000000d0002'),
  'refused', '4 refusal moves guests.status to refused');

-- 5. A second refusal is idempotent — status stays 'refused', no error.
insert into public.refusals (guest_id, refused_by, reason)
values ('cc000000-0000-7000-8000-0000000d0002', '11111111-1111-4111-8111-111111111111', 'Tweede');
select is((select status::text from public.guests where id = 'cc000000-0000-7000-8000-0000000d0002'),
  'refused', '5 a second refusal keeps status refused (idempotent)');

-- 6. A refusal never resurrects a removed guest (#21 soft delete wins).
update public.guests set status = 'removed' where id = 'cc000000-0000-7000-8000-0000000d0003';
insert into public.refusals (guest_id, refused_by, reason)
values ('cc000000-0000-7000-8000-0000000d0003', '11111111-1111-4111-8111-111111111111', 'n.v.t.');
select is((select status::text from public.guests where id = 'cc000000-0000-7000-8000-0000000d0003'),
  'removed', '6 a removed guest is not flipped to refused');

-- 7. Quota-neutral: a refused guest still consumes 1 + plus_ones, so the adder's
--    consumption is unchanged across the refusal (only denied/removed free a slot).
reset role;
create temp table _c(before int, after int);
insert into _c(before)
  select public.user_event_consumption('ee000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.refusals (guest_id, refused_by, reason)
values ('cc000000-0000-7000-8000-0000000d0004', '11111111-1111-4111-8111-111111111111', 'Lijst vol');
reset role;
update _c set after =
  public.user_event_consumption('ee000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111');
select is((select after - before from _c), 0, '7 refusing a guest is quota-neutral (refused still consumes)');

-- 8. The status mirror is auditable AND idempotent: guest B was refused twice but
--    the status flipped once, so there is exactly one guests 'refuse' entry
--    (alongside the two refusals rows' own entries).
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'guests' and entity_id = 'cc000000-0000-7000-8000-0000000d0002'
     and action = 'refuse'), 1,
  '8 the synced status transition is audited once (idempotent re-refusal adds none)');

select * from finish();

rollback;
