-- pgTAP — ATTACKER suite (security-audit 4.2): mutation on a LOCKED list (#23).
-- Run: supabase test db. NEW file.
--
-- When events.list_locked, staff lose guest mutations; admin/organizer/doorhost
-- keep them. This file attacks the lock from the staff side — direct write,
-- editing an own row, trying to UNLOCK it, and trying to ride admin's access by
-- forging added_by — then confirms the privileged bypass paths still work.
-- Seed event ee..01, venue aa..01. Everything rolls back.

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

select plan(7);

-- Lock the list (as owner; the CHECK needs locked_by + locked_at set).
update public.events
  set list_locked = true,
      locked_by = '11111111-1111-4111-8111-111111111111',
      locked_at = now()
  where id = 'ee000000-0000-7000-8000-000000000001';

-- ---- staff is blocked every which way ----
select pg_temp.login('55555555-5555-4555-8555-555555555555');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Lock Add Staff',
          '55555555-5555-4555-8555-555555555555')
$$, '42501', null, '1 locked list: staff cannot add a guest');

select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 1
              where full_name = 'Femke Aalders'$$),
  0, '2 locked list: staff cannot edit even their own guest');

-- Attack: unlock the list yourself, then you could write. Events are admin/
-- organizer-only to mutate, so the staff UNLOCK matches no row.
select is(
  pg_temp.rowcount($$update public.events set list_locked = false
              where id = 'ee000000-0000-7000-8000-000000000001'$$),
  0, '3 locked list: staff cannot unlock the event themselves');

-- Attack: ride the admin write-access by forging added_by = admin. can_write_guests
-- checks the SESSION user, and added_by is pinned to auth.uid() — double block.
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Lock Add Forged',
          '11111111-1111-4111-8111-111111111111')
$$, '42501', null, '4 locked list: staff cannot forge added_by=admin to slip a write through');

reset role;

-- The lock is untouched after all the staff attempts.
select is(
  (select list_locked from public.events
   where id = 'ee000000-0000-7000-8000-000000000001'),
  true, '5 the list is still locked after the staff attempts');

-- ---- the privileged bypass paths are exactly the ones that work (#23) ----
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Lock Add Deur',
          '66666666-6666-4666-8666-666666666666', 'door')
$$, '6 locked list: the doorhost still adds at the door (#23)');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 3
              where id = 'cc000000-0000-7000-8000-000000000001'$$),
  1, '7 locked list: admin keeps write access');
reset role;

select * from finish();

rollback;
