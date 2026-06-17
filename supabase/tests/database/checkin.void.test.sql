-- pgTAP — check-in terugdraaien / soft void (20260617020000_check_in_void.sql).
-- Proves: only a door-scoped user (admin/doorhost/organizer) may void via the
-- new check_ins_update_door policy (staff cannot); a voided check-in is excluded
-- from event_stats_summary present_headcount; and a revive (un-void) clears the
-- flag and re-sets arrivals fresh (the revive-aware cap trigger). Seed: admin Max
-- (11..1) + doorhost Lisa (66..6) on Club Vesper, open event ee..01, tier dd..01.

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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(6);

-- Fixture: a guest checked in with 2 of 3 plus-ones present (heads = 1 + 2 = 3).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-00000000b001', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Void Gast', 3, '11111111-1111-4111-8111-111111111111');
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-00000000b001', '11111111-1111-4111-8111-111111111111', 2);

create temp table _p(b0 int, b1 int, b2 int);
insert into _p(b0) select present_headcount from public.event_stats_summary('ee000000-0000-7000-8000-000000000001');
reset role;

-- 1. Staff (no door scope) cannot void — both update policies filter the row out.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.check_ins set voided_at = now()
                     where guest_id = 'cc000000-0000-7000-8000-00000000b001'$$),
  0, '1 staff cannot void a check-in (RLS)');
reset role;

-- 2. Admin (door scope) soft-voids the check-in.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.check_ins set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
  where guest_id = 'cc000000-0000-7000-8000-00000000b001';
select isnt((select voided_at from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000b001'),
  null, '2 admin voids the check-in (voided_at set)');

-- 3. A voided check-in no longer counts as present (heads drop by 1 + 2 = 3).
update _p set b1 = (select present_headcount from public.event_stats_summary('ee000000-0000-7000-8000-000000000001'));
select is((select b0 - b1 from _p), 3, '3 voiding drops present_headcount by the guest''s heads');

-- 4. Revive (un-void) clears the flag and RE-SETS arrivals fresh (0, not held at 2).
update public.check_ins
  set voided_at = null, voided_by = null, checked_at = now(), plus_ones_arrived = 0
  where guest_id = 'cc000000-0000-7000-8000-00000000b001';
select is(
  (select voided_at is null and plus_ones_arrived = 0
   from public.check_ins where guest_id = 'cc000000-0000-7000-8000-00000000b001'),
  true, '4 revive clears the void and resets arrivals (revive-aware trigger)');

-- 5. After revive the guest is present again (now 1 + 0 = 1 head).
update _p set b2 = (select present_headcount from public.event_stats_summary('ee000000-0000-7000-8000-000000000001'));
select is((select b2 - b1 from _p), 1, '5 a revived guest counts as present again');
reset role;

-- 6. Any door-scoped user may void — doorhost Lisa voids it (last, committed).
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(
  pg_temp.rowcount($$update public.check_ins set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
                     where guest_id = 'cc000000-0000-7000-8000-00000000b001'$$),
  1, '6 a doorhost can void a check-in (can_check_in scope)');
reset role;

select * from finish();

rollback;
