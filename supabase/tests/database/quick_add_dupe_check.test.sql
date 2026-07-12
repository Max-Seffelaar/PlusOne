-- pgTAP — quick-add duplicate safeguard (migration 20260712120000, ClickUp
-- 86ey8w7ek). Run: supabase test db.
--
-- Proves: (1) the lookup index + RPC exist, (2) the match is case-insensitive
-- and trims the input, (3) soft-removed guests never match (#21), (4) the RPC
-- is SECURITY INVOKER so RLS stays the boundary: staff only match their OWN
-- guests (allowed on own, denied on someone else's), a user_manager matches
-- nothing, (5) the oldest row wins when the same name is on the list twice.
-- Relies on the same seed as rls.test.sql. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- PostgREST-style JWT claims + role switch (mirrors venue_scope test).
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(15);

-- IDs from the seed: admin=1111 UM=2222 staff(Tom)=5555 ·
-- event(open, venue1)=ee..01 · tier=dd..01 · venue2=aa..02.

-- 0. Schema shape -------------------------------------------------------------
select has_function('public', 'find_event_guest_by_name', array['uuid', 'text'],
  '0a lookup RPC exists');
select has_index('public', 'guests', 'guests_event_lower_name_idx',
  '0b partial lower(btrim(full_name)) index exists');
-- Regression tripwire: the whole design hangs on the caller's OWN RLS applying
-- inside the function — flipping it to DEFINER must fail loudly here.
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'find_event_guest_by_name'),
  false, '0c RPC is SECURITY INVOKER, not DEFINER');

-- 1. Fixtures (admin adds one guest with +2) ----------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000d001', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Dupe Check Gast', 2,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');

-- 2. Match semantics ----------------------------------------------------------
select is(
  (select d.id from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'Dupe Check Gast') d),
  'cc000000-0000-7000-8000-00000000d001'::uuid,
  '2a exact name matches');
select is(
  (select d.id from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', '  dupe check GAST  ') d),
  'cc000000-0000-7000-8000-00000000d001'::uuid,
  '2b match is case-insensitive and trims the input');
select is(
  (select d.plus_ones from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'Dupe Check Gast') d),
  2, '2c returns the existing plus-ones (drives the add/replace choice)');
select is(
  (select count(*)::int from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'Niet Op De Lijst') ),
  0, '2d unknown name matches nothing');

-- Oldest row wins when the name is on the list twice ("add anyway" happened).
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000d002', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Dupe Check Gast', 0,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');
select is(
  (select d.id from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'dupe check gast') d),
  'cc000000-0000-7000-8000-00000000d001'::uuid,
  '2e oldest match wins on a double entry');

-- 3. Soft-removed rows never match (#21) --------------------------------------
update public.guests set status = 'removed'
 where id in ('cc000000-0000-7000-8000-00000000d001', 'cc000000-0000-7000-8000-00000000d002');
select is(
  (select count(*)::int from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'Dupe Check Gast') ),
  0, '3a removed guests are not duplicates');

-- 4. SECURITY INVOKER: RLS stays the boundary ---------------------------------
-- Staff (Tom) adds his own guest, then matches it.
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000d003', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Staff Eigen Gast', 0,
          '55555555-5555-4555-8555-555555555555', 'app', 'approved');
select is(
  (select d.id from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'Staff Eigen Gast') d),
  'cc000000-0000-7000-8000-00000000d003'::uuid,
  '4a staff matches their OWN guest (allowed)');

-- Admin re-adds a guest; staff must NOT match it (added_by someone else).
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000d004', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Admin Andermans Gast', 0,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select is(
  (select count(*)::int from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'Admin Andermans Gast') ),
  0, '4b staff does NOT match another member''s guest (RLS-scoped, denied)');

-- A user_manager has no guests_select grant at all → nothing matches.
select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- user_manager
select is(
  (select count(*)::int from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'Admin Andermans Gast') ),
  0, '4c user_manager matches nothing (denied)');

-- 5. Padded stored names still match (btrim on the COLUMN too) ----------------
-- full_name carries no whitespace constraint, so padded rows are real; trimming
-- only the input would make them invisible to the safeguard.
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000d005', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', '  Gepadde Gast  ', 0,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');
select is(
  (select d.id from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-000000000001', 'gepadde gast') d),
  'cc000000-0000-7000-8000-00000000d005'::uuid,
  '5a a whitespace-padded stored name still matches');

-- 6. anon cannot execute the lookup at all ------------------------------------
select set_config('role', 'anon', true);
select throws_ok(
  $$select * from public.find_event_guest_by_name(
      'ee000000-0000-7000-8000-000000000001', 'Dupe Check Gast')$$,
  '42501', null, '6a anon is denied EXECUTE on the RPC');
select set_config('role', 'postgres', true);

-- 7. Cross-venue probe leaks nothing ------------------------------------------
-- An event + guest in venue2 (created past RLS as postgres); staff of venue1
-- probing it must get empty rows — not an error that confirms existence.
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active)
  values ('ee000000-0000-7000-8000-00000000d0e2', 'aa000000-0000-7000-8000-000000000002',
          'Venue2 Probe Event', now() + interval '7 days', now() + interval '7 days 4 hours',
          'open', 'venue2-probe-event', false);
insert into public.guest_tiers (id, event_id, name, color, aliases)
  values ('dd000000-0000-7000-8000-00000000d0e2', 'ee000000-0000-7000-8000-00000000d0e2',
          'Venue2 Tier', '#111111', '{}');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
  values ('cc000000-0000-7000-8000-00000000d006', 'ee000000-0000-7000-8000-00000000d0e2',
          'dd000000-0000-7000-8000-00000000d0e2', 'Venue2 Geheime Gast', 0,
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff of venue1 only
select is(
  (select count(*)::int from public.find_event_guest_by_name(
     'ee000000-0000-7000-8000-00000000d0e2', 'Venue2 Geheime Gast') ),
  0, '7a staff of another venue matches nothing on a cross-venue event');

select * from finish();
rollback;
