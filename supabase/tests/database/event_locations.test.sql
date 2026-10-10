-- pgTAP — event locations (z8uq9m444c, migration 20261013160000).
-- Run: pnpm db:test.
--
-- Proves:
--   A. company_locations: exact columns, RLS on, the grant matrix (anon
--      nothing; authenticated select/insert + UPDATE on the editable columns
--      only; no DELETE, no TRUNCATE, venue_id immutable);
--   B. per role, allowed AND denied: members of the venue read (admin,
--      user_manager, finance, staff, doorhost), a non-member reads nothing
--      (event organizer without membership, member of the other venue); only
--      an admin inserts / updates / archives; nobody deletes;
--   D. the narrowed backfill: only not-over events without a live share link,
--      without any guest request and without any location, at a company
--      with an address, get filled;
--      owner-only function, idempotent (review #452, decision Max 2026-10-10);
--   C. get_request_status: still SECURITY DEFINER with an empty search_path,
--      same grants; every found payload has exactly the documented key set;
--      it carries the EVENT's own location in every state (mirror included)
--      and never the company address (the venue_* keys stay, always null,
--      until the contract migration); the function no longer reads venues.
--
-- Seed: venue aa..01 Club Vesper (company address Wibautstraat 150, 1091 GR
-- Amsterdam) with admin 11.., user_manager 22.., finance 33.., staff 55..,
-- doorhost+staff 66..; organizer 44.. organizes event ee..01 without a
-- membership. Venue aa..02 De Marktzaal: admin 11.. only. All rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(60);

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
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

create function pg_temp.keys(p jsonb)
returns text language sql as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures (as owner, RLS bypassed — like the seed)
-- ---------------------------------------------------------------------------

insert into public.company_locations (id, venue_id, name, address_line, postal_code, city, country) values
  ('c1000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
   'Club Vesper', 'Wibautstraat 150', '1091 GR', 'Amsterdam', 'NL'),
  ('c1000000-0000-7000-8000-000000000002', 'aa000000-0000-7000-8000-000000000001',
   'Paradiso', 'Weteringschans 6', '1017 SG', 'Amsterdam', 'NL'),
  ('c1000000-0000-7000-8000-000000000003', 'aa000000-0000-7000-8000-000000000002',
   'Marktzaal', 'Grote Gracht 76', '6211 SZ', 'Maastricht', 'NL');

-- The seed event takes the second saved location (a copy, as the app saves it).
update public.events
   set location_name = 'Paradiso', location_address = 'Weteringschans 6, 1017 SG Amsterdam'
 where id = 'ee000000-0000-7000-8000-000000000001';

-- An event with no location at all (created after the backfill).
insert into public.events (id, venue_id, name, starts_at, ends_at, landing_slug, landing_active) values
  ('9e100000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
   'EL Bare Night', now() + interval '8 days', now() + interval '8 days 6 hours', 'el-bare-night', true);

insert into public.guest_requests (id, event_id, full_name, email, phone, plus_ones, status_token_hash) values
  ('9a100000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
   'Pending Pam', 'pam@el.test', '+31611800001', 1, 'tok-el-pam'),
  ('9a100000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
   'Approved Ada', 'ada@el.test', '+31611800002', 2, 'tok-el-ada'),
  ('9a100000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
   'Denied Dex', 'dex@el.test', '+31611800003', 0, 'tok-el-dex'),
  ('9a100000-0000-7000-8000-000000000004', '9e100000-0000-7000-8000-000000000001',
   'Bare Bram', 'bram@el.test', '+31611800004', 0, 'tok-el-bram');

update public.guest_requests set status = 'denied', decision_reason = 'Full',
       decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
 where id = '9a100000-0000-7000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- A. Table shape + grant matrix
-- ---------------------------------------------------------------------------

select columns_are('public', 'company_locations', array[
  'id', 'venue_id', 'name', 'address_line', 'postal_code', 'city', 'country',
  'place_id', 'archived_at', 'created_at', 'updated_at'
], 'A1 company_locations has exactly the documented columns');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.company_locations'::regclass),
  'A2 RLS is enabled on company_locations');
select ok(
  not has_table_privilege('anon', 'public.company_locations', 'SELECT')
  and not has_table_privilege('anon', 'public.company_locations', 'INSERT')
  and not has_any_column_privilege('anon', 'public.company_locations', 'UPDATE'),
  'A3 anon holds nothing on company_locations');
select ok(
  has_table_privilege('authenticated', 'public.company_locations', 'SELECT')
  and has_column_privilege('authenticated', 'public.company_locations', 'name', 'INSERT')
  and has_column_privilege('authenticated', 'public.company_locations', 'venue_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.company_locations', 'created_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.company_locations', 'archived_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.company_locations', 'id', 'INSERT'),
  'A4 authenticated selects and inserts the content columns only (RLS decides which rows); id, archived_at, created_at are server-set');
select ok(
  not has_table_privilege('authenticated', 'public.company_locations', 'DELETE')
  and not has_table_privilege('authenticated', 'public.company_locations', 'TRUNCATE'),
  'A5 authenticated has no DELETE and no TRUNCATE: locations are archived, never removed');
select ok(
  has_column_privilege('authenticated', 'public.company_locations', 'name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.company_locations', 'archived_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.company_locations', 'venue_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.company_locations', 'id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.company_locations', 'created_at', 'UPDATE'),
  'A6 UPDATE only on the editable columns: venue_id, id and created_at are not client-writable');

-- ---------------------------------------------------------------------------
-- B. Per role: read allowed/denied
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.company_locations), 3,
  'B1 admin of both venues reads the saved locations of both');
reset role;
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.company_locations), 2,
  'B2 user_manager of venue 1 reads venue 1''s two locations, not venue 2''s');
reset role;
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select is((select count(*)::int from public.company_locations), 2,
  'B3 finance reads its venue''s locations');
reset role;
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.company_locations), 2,
  'B4 staff reads its venue''s locations');
select is((select count(*)::int from public.company_locations
            where venue_id = 'aa000000-0000-7000-8000-000000000002'), 0,
  'B5 staff of venue 1 reads nothing of venue 2');
reset role;
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is((select count(*)::int from public.company_locations), 2,
  'B6 doorhost reads its venue''s locations');
reset role;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.company_locations), 0,
  'B7 an event organizer without a venue membership reads no saved locations');
reset role;
select pg_temp.login_anon();
select throws_ok($$ select * from public.company_locations $$, '42501', null,
  'B8 anon cannot read company_locations at all');
reset role;

-- ---------------------------------------------------------------------------
-- B. Per role: write allowed/denied
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ insert into public.company_locations (venue_id, name, address_line, postal_code, city, country, place_id)
     values ('aa000000-0000-7000-8000-000000000001', 'Melkweg', 'Lijnbaansgracht 234A', '1017 PH', 'Amsterdam', 'NL', 'ChIJ-test') $$,
  'B9 admin inserts a saved location');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name, created_at)
     values ('aa000000-0000-7000-8000-000000000001', 'Backdated', now() - interval '1 year') $$,
  '42501', null, 'B9b not even an admin can backdate a location to the front of the list (created_at is server-set)');
select is(
  pg_temp.rowcount($$ update public.company_locations set name = 'Paradiso Grote Zaal'
                      where id = 'c1000000-0000-7000-8000-000000000002' $$),
  1, 'B10 admin renames a saved location');
select is(
  pg_temp.rowcount($$ update public.company_locations set archived_at = now()
                      where id = 'c1000000-0000-7000-8000-000000000001' $$),
  1, 'B11 admin archives a saved location');
select throws_ok(
  $$ update public.company_locations set venue_id = 'aa000000-0000-7000-8000-000000000002'
      where id = 'c1000000-0000-7000-8000-000000000002' $$,
  '42501', null, 'B12 not even an admin can move a location to another venue (venue_id has no UPDATE grant)');
select throws_ok(
  $$ delete from public.company_locations where id = 'c1000000-0000-7000-8000-000000000002' $$,
  '42501', null, 'B13 not even an admin can delete a location (archive instead)');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name)
     values ('aa000000-0000-7000-8000-000000000001', '   ') $$,
  '23514', null, 'B14 a blank name is refused (CHECK)');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name, address_line)
     values ('aa000000-0000-7000-8000-000000000001', 'Long', repeat('x', 121)) $$,
  '23514', null, 'B15 an over-long street is refused, so a copy always fits events.location_address');
reset role;

select is(
  (select name from public.company_locations where id = 'c1000000-0000-7000-8000-000000000002'),
  'Paradiso Grote Zaal', 'B16 the rename landed');
select is(
  (select location_name from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'Paradiso', 'B17 renaming a saved location does not touch an event that used it (the event keeps its copy)');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name)
     values ('aa000000-0000-7000-8000-000000000001', 'By manager') $$,
  '42501', null, 'B18 user_manager cannot add a location');
select is(
  pg_temp.rowcount($$ update public.company_locations set name = 'Hijacked'
                      where id = 'c1000000-0000-7000-8000-000000000002' $$),
  0, 'B19 user_manager cannot rename a location (RLS filters the row)');
reset role;

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name)
     values ('aa000000-0000-7000-8000-000000000001', 'By finance') $$,
  '42501', null, 'B20 finance cannot add a location');
select is(
  pg_temp.rowcount($$ update public.company_locations set archived_at = now()
                      where id = 'c1000000-0000-7000-8000-000000000002' $$),
  0, 'B21 finance cannot archive a location');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name)
     values ('aa000000-0000-7000-8000-000000000001', 'By staff') $$,
  '42501', null, 'B22 staff cannot add a location');
select is(
  pg_temp.rowcount($$ update public.company_locations set name = 'Hijacked'
                      where id = 'c1000000-0000-7000-8000-000000000002' $$),
  0, 'B23 staff cannot rename a location');
reset role;

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name)
     values ('aa000000-0000-7000-8000-000000000001', 'By door') $$,
  '42501', null, 'B24 doorhost cannot add a location');
reset role;

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name)
     values ('aa000000-0000-7000-8000-000000000001', 'By organizer') $$,
  '42501', null, 'B25 an event organizer cannot add a location to the company');
reset role;

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ insert into public.company_locations (venue_id, name)
     values ('aa000000-0000-7000-8000-000000000002', 'Cross venue') $$,
  '42501', null, 'B26 a member of venue 1 cannot add a location to venue 2');
reset role;

select is(
  (select count(*)::int from public.company_locations where name = 'Hijacked'),
  0, 'B27 no denied rename landed');

-- ---------------------------------------------------------------------------
-- C. get_request_status: the event location, never the company address
-- ---------------------------------------------------------------------------

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p
    where p.oid = 'public.get_request_status(text,text)'::regprocedure),
  'C1 get_request_status is still SECURITY DEFINER with an empty search_path');
select ok(
  has_function_privilege('anon', 'public.get_request_status(text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_request_status(text,text)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.get_request_status(text,text)'::regprocedure
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'C2 anon + authenticated execute; PUBLIC does not');
select ok(
  pg_get_functiondef('public.get_request_status(text,text)'::regprocedure) !~* 'public\.venues',
  'C3 the function no longer reads public.venues at all');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('9a100000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001') $$,
  'C4 the admin approves Ada');
reset role;

select pg_temp.login_anon();
select is(
  pg_temp.keys(public.get_request_status('tok-el-ada', 'ip-el-1')),
  'approved_plus_ones,decision_message,ends_at,event_name,found,full_name,location_address,location_name,plus_ones,starts_at,status,venue_address_line,venue_city,venue_postal_code',
  'C5 a found payload has exactly the documented keys');
select ok(
  (select r ->> 'status' = 'approved'
          and r ->> 'location_name' = 'Paradiso'
          and r ->> 'location_address' = 'Weteringschans 6, 1017 SG Amsterdam'
     from public.get_request_status('tok-el-ada', 'ip-el-2') r),
  'C6 approved: the event''s own location (name + address)');
select ok(
  (select r ->> 'venue_address_line' is null and r ->> 'venue_postal_code' is null and r ->> 'venue_city' is null
     from public.get_request_status('tok-el-ada', 'ip-el-3') r),
  'C7 approved: the legacy venue_* keys are null (expand–contract)');
select ok(
  (select r::text !~ 'Wibautstraat|1091 GR'
     from public.get_request_status('tok-el-ada', 'ip-el-4') r),
  'C8 approved: the company address appears nowhere in the payload');
select ok(
  (select r ->> 'status' = 'pending' and r ->> 'location_name' = 'Paradiso'
          and r ->> 'venue_address_line' is null and r::text !~ 'Wibautstraat'
     from public.get_request_status('tok-el-pam', 'ip-el-5') r),
  'C9 pending: the event location too (it is on the share link), no company address');
select ok(
  (select r ->> 'status' = 'denied' and r ->> 'location_name' = 'Paradiso'
          and not (r ? 'decision_reason') and r::text !~ 'Wibautstraat'
     from public.get_request_status('tok-el-dex', 'ip-el-6') r),
  'C10 denied: the event location, still no deny reason, no company address');
select ok(
  (select r ->> 'found' = 'true' and r ->> 'location_name' is null and r ->> 'location_address' is null
          and r ->> 'venue_address_line' is null and r::text !~ 'Wibautstraat|Club Vesper'
     from public.get_request_status('tok-el-bram', 'ip-el-7') r),
  'C11 an event without its own location: null location, and NO fallback to the company');
select is(
  public.get_request_status('tok-el-nope', 'ip-el-8'),
  '{"found": false}'::jsonb,
  'C12 an unknown token still gets exactly {"found": false}');

-- Mirror: a second, silently deduped submission on the same e-mail.
select is(
  public.submit_guest_request('plusone-launch-night', 'Mirror Mia', 'pam@el.test',
    '+31611800009', 0, null, 'ip-el-m1', false, null, 'tok-el-mia') ->> 'status',
  'ok', 'C13 a second submission on Pam''s e-mail is silently deduped (a mirror)');
select ok(
  (select r ->> 'full_name' = 'Mirror Mia' and r ->> 'location_name' = 'Paradiso'
          and r ->> 'venue_address_line' is null and r::text !~ 'Wibautstraat'
     from public.get_request_status('tok-el-mia', 'ip-el-m2') r),
  'C14 the mirror token gets the event location (public on the link) and no company address');
select is(
  pg_temp.keys(public.get_request_status('tok-el-mia', 'ip-el-m3')),
  pg_temp.keys(public.get_request_status('tok-el-pam', 'ip-el-m3')),
  'C15 mirror and fresh payloads carry the same key set');
reset role;

-- ---------------------------------------------------------------------------
-- D. The narrowed backfill (review #452 blocker 3, decision Max 2026-10-10):
--    no address goes public without someone choosing it. As owner, on fresh
--    fixtures, through the same function the migration ran once.
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.backfill_event_locations_from_company()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.backfill_event_locations_from_company()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.backfill_event_locations_from_company()', 'EXECUTE'),
  'D1 the backfill function is owner-only: no app role and not service_role can run it');

-- Venue 2 loses its address for this test, so "company without an address" is covered.
update public.venues set address_line = null, postal_code = null, city = null
 where id = 'aa000000-0000-7000-8000-000000000002';

insert into public.events (id, venue_id, name, starts_at, ends_at, landing_slug, landing_active, location_name) values
  ('9e200000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
   'BF live link', now() + interval '3 days', now() + interval '3 days 6 hours', 'bf-live-link', true, null),
  ('9e200000-0000-7000-8000-000000000002', 'aa000000-0000-7000-8000-000000000001',
   'BF past', now() - interval '10 days', now() - interval '9 days 18 hours', 'bf-past', false, null),
  ('9e200000-0000-7000-8000-000000000003', 'aa000000-0000-7000-8000-000000000001',
   'BF future no link', now() + interval '4 days', now() + interval '4 days 6 hours', 'bf-future', false, null),
  ('9e200000-0000-7000-8000-000000000004', 'aa000000-0000-7000-8000-000000000001',
   'BF future no end', now() + interval '5 days', null, 'bf-no-end', false, null),
  ('9e200000-0000-7000-8000-000000000005', 'aa000000-0000-7000-8000-000000000001',
   'BF own name', now() + interval '6 days', now() + interval '6 days 6 hours', 'bf-own', false, 'Garden'),
  ('9e200000-0000-7000-8000-000000000006', 'aa000000-0000-7000-8000-000000000002',
   'BF no company address', now() + interval '7 days', now() + interval '7 days 6 hours', 'bf-no-addr', false, null);

select is(public.backfill_event_locations_from_company(), 2,
  'D2 the backfill fills exactly the two not-over, link-off, location-less events at a company with an address');
select is(
  (select location_name || ' | ' || location_address from public.events where id = '9e200000-0000-7000-8000-000000000003'),
  'Club Vesper | Wibautstraat 150, 1091 GR Amsterdam',
  'D3 a future event without a share link gets the company name + address');
select is(
  (select location_name from public.events where id = '9e200000-0000-7000-8000-000000000004'),
  'Club Vesper', 'D4 ...also when it has no end time (anchored on the start, #26)');
select ok(
  (select location_name is null and location_address is null from public.events where id = '9e200000-0000-7000-8000-000000000001'),
  'D5 an event with a LIVE share link is not filled: its link keeps showing only the company name');
select ok(
  (select location_name is null and location_address is null from public.events where id = '9e200000-0000-7000-8000-000000000002'),
  'D6 a past event is not filled');
select ok(
  (select location_name = 'Garden' and location_address is null from public.events where id = '9e200000-0000-7000-8000-000000000005'),
  'D7 an event with its own location name is left exactly as it was');
select ok(
  (select location_name is null and location_address is null from public.events where id = '9e200000-0000-7000-8000-000000000006'),
  'D8 an event at a company without an address is not filled');
select is(public.backfill_event_locations_from_company(), 0, 'D9 a second run changes nothing (idempotent)');

-- D10 (delta review #452): a future event whose link was ON, got a request,
-- and is now paused. Its status token must not start resolving to the
-- company address.
insert into public.events (id, venue_id, name, starts_at, ends_at, landing_slug, landing_active) values
  ('9e200000-0000-7000-8000-000000000007', 'aa000000-0000-7000-8000-000000000001',
   'BF paused link', now() + interval '8 days', now() + interval '8 days 6 hours', 'bf-paused', true);
insert into public.guest_requests (id, event_id, full_name, email, phone, plus_ones, status_token_hash) values
  ('9a200000-0000-7000-8000-000000000001', '9e200000-0000-7000-8000-000000000007',
   'Paused Pia', 'paused@el.test', '+31611800099', 0, 'tok-el-paused');
update public.events set landing_active = false where id = '9e200000-0000-7000-8000-000000000007';
select is(public.backfill_event_locations_from_company(), 0,
  'D10 a future event with a paused link and an existing request is not filled');
select ok(
  (select r ->> 'location_address' is null and r::text !~ 'Wibautstraat'
     from public.get_request_status('tok-el-paused', 'ip-el-d10') r),
  'D11 ...so that request''s status token still gets no address at all');

select * from finish();
rollback;
