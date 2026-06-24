-- pgTAP — ATTACKER suite (security-audit 4.2): quota-omzeiling via API.
-- Run: supabase test db. NEW file (does not touch quota.test.sql).
--
-- The quota engine (#22/#31) charges STAFF/DOORHOST 1 + plus_ones per guest,
-- EXCEPT guests with source in ('landing','permanent') — those are 0 slots
-- (public-page / house guests). Because the anon/auth key reaches the raw API,
-- a staffer could try to FORGE that source on their own add to escape their
-- personal quota. This file proves:
--   * the numeric limit still bites on a normal add (45001);
--   * forging source='landing'/'permanent' on a DIRECT insert is now rejected by
--     the guests_insert WITH CHECK (42501) — migration 20260623140200;
--   * a forged bulk batch is rejected wholesale;
--   * the LEGITIMATE source='landing'/'door' paths still work (the RPC + the
--     door), so the guard is a guard, not a regression.
-- Seed: Tom (staff 55..) consumes 10 of an event-override 12 on event ee..01;
-- Lisa (doorhost 66..) consumes 2 of a venue default 5. Everything rolls back.

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

select plan(7);

-- Pin Tom to exactly zero free slots, so ANY personal-quota add must be blocked
-- and the ONLY way "through" would be a forged source.
update public.event_quotas
  set quota_override = public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555')
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';

select pg_temp.login('55555555-5555-4555-8555-555555555555');

-- Control: the numeric limit works — a normal add over the limit is blocked.
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Eentje Teveel', 0,
          '55555555-5555-4555-8555-555555555555', 'app')
$$, '45001', null, '1 normal add over quota is blocked by the engine (45001)');

-- THE FIX: forging source='landing' to dodge the quota is rejected outright by
-- RLS (42501) — not silently let through, and not even reaching the 45001 path.
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Landing Forge', 5,
          '55555555-5555-4555-8555-555555555555', 'landing')
$$, '42501', null, '2 staff cannot forge source=landing on a direct insert (quota bypass closed)');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Permanent Forge', 5,
          '55555555-5555-4555-8555-555555555555', 'permanent')
$$, '42501', null, '3 staff cannot forge source=permanent either');

-- A whole forged bulk batch is rejected by the same guard.
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  select 'ee000000-0000-7000-8000-000000000001',
         'dd000000-0000-7000-8000-000000000001',
         'Bulk Forge ' || g, '55555555-5555-4555-8555-555555555555', 'landing'
  from generate_series(1, 50) as g
$$, '42501', null, '4 a forged bulk batch is rejected wholesale');

reset role;

-- The LEGITIMATE landing path is unaffected: approve_guest_request (SECURITY
-- DEFINER, runs past RLS) still creates a source='landing' guest. Organizer
-- approves the seed's pending request (Robin, bb..01).
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  select public.approve_guest_request(
    'bb000000-0000-7000-8000-000000000001',
    'dd000000-0000-7000-8000-000000000001')
$$, '5 the RPC still creates a legitimate landing guest (guard is not a regression)');
reset role;

select is(
  (select count(*)::int from public.guests
   where full_name = 'Robin Castelijns' and source = 'landing'),
  1, '6 approved request landed as a source=landing guest');

-- The door's own legitimate path (source=door) is allowed and quota-charged.
-- Lisa has 3 free slots (2 of 5 used); a +0 door add fits.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Deur Toevoeging', 0,
          '66666666-6666-4666-8666-666666666666', 'door')
$$, '7 a legitimate source=door add within quota still works');
reset role;

select * from finish();

rollback;
