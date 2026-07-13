-- pgTAP — bulk duplicate safeguard (migration 20260713150000, ClickUp
-- 86ey8xg4p, follow-up to 86ey8w7ek). Run: supabase test db.
--
-- Proves: (1) the set-based RPC exists and is SECURITY INVOKER, (2) it matches
-- several names in one call, case-insensitively and trimmed, (3) unmatched
-- names return nothing (no false positives), (4) soft-removed guests never
-- match (#21), (5) RLS still scopes the result to the caller's own guests,
-- (6) the oldest row wins on a double entry, (7) an empty/oversized array is a
-- safe no-op. Relies on the same seed as rls.test.sql. Everything rolls back.

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

select plan(11);

-- IDs from the seed: admin=1111 UM=2222 staff(Tom)=5555 ·
-- event(open, venue1)=ee..01 · tier=dd..01.

-- 0. Schema shape -------------------------------------------------------------
select has_function('public', 'find_event_guests_by_names', array['uuid', 'text[]'],
  '0a batched lookup RPC exists');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'find_event_guests_by_names'),
  false, '0b RPC is SECURITY INVOKER, not DEFINER');

-- 1. Fixtures (admin adds two guests) -----------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000e001', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Bulk Dupe Een', 1,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000e002', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Bulk Dupe Twee', 0,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');

-- 2. Match semantics: several names in one call, mixed hit/miss ---------------
select is(
  (select count(*)::int from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001',
     array['bulk dupe een', '  BULK DUPE TWEE  ', 'Niet Op De Lijst'])),
  2, '2a matches exactly the two known names out of three, case/whitespace-insensitive');
select is(
  (select d.plus_ones from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001', array['Bulk Dupe Een']) d),
  1, '2b returns the existing plus-ones');

-- Oldest row wins when the name is on the list twice.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000e003', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Bulk Dupe Een', 3,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');
select is(
  (select d.id from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001', array['Bulk Dupe Een']) d),
  'cc000000-0000-7000-8000-00000000e001'::uuid,
  '2c oldest match wins on a double entry');

-- 3. Soft-removed rows never match (#21) --------------------------------------
update public.guests set status = 'removed' where id = 'cc000000-0000-7000-8000-00000000e002';
select is(
  (select count(*)::int from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001', array['Bulk Dupe Twee'])),
  0, '3a removed guest is not a duplicate');

-- 4. SECURITY INVOKER: RLS stays the boundary ---------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000e004', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Staff Bulk Gast', 0,
          '55555555-5555-4555-8555-555555555555', 'app', 'approved');
select is(
  (select count(*)::int from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001', array['Staff Bulk Gast', 'Bulk Dupe Een'])),
  1, '4a staff matches their OWN guest but not admin''s (RLS-scoped)');

select set_config('role', 'anon', true);
select throws_ok(
  $$select * from public.find_event_guests_by_names(
      'ee000000-0000-7000-8000-000000000001', array['Bulk Dupe Een'])$$,
  '42501', null, '5a anon is denied EXECUTE on the RPC');
select set_config('role', 'postgres', true);

-- 6. Empty / oversized array is a safe no-op (defense-in-depth cap) -----------
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
select is(
  (select count(*)::int from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001', array[]::text[])),
  0, '6a empty array returns nothing');
select is(
  (select count(*)::int from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001',
     (select array_agg('Bulk Dupe Een' || i) from generate_series(1, 201) i))),
  0, '6b an array over the 200-name cap returns nothing rather than a partial scan');
select is(
  (select count(*)::int from public.find_event_guests_by_names(
     'ee000000-0000-7000-8000-000000000001', null)),
  0, '6c a null array returns nothing');

select * from finish();
rollback;
