-- pgTAP — event location (z8uq9m2vqc): events.location_name/location_address
-- and their exposure through get_landing_event, the ONLY anon path to event
-- data. Proves: anon sees exactly the existing five columns plus the two new
-- ones; the event's own location comes through raw; an unset location is NULL
-- (the company address is never a fallback here — spec #48(c)); a closed link
-- (landing off) returns nothing at all; anon still has no direct read on events;
-- RLS on the columns is the existing events matrix (admin writes, staff cannot).
-- Seed: venue aa..01 (Club Vesper, Wibautstraat 150), event ee..01 with the
-- open default link 'plusone-launch-night'. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

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

-- ── Shape ───────────────────────────────────────────────────────────────────
select is(
  pg_get_function_result('public.get_landing_event(text, text)'::regprocedure),
  'TABLE(event_name text, starts_at timestamp with time zone, via_label text, spots_left integer, venue_name text, location_name text, location_address text)',
  'get_landing_event = the existing five columns + location_name + location_address, nothing else');

select is(
  (select prosecdef from pg_proc where oid = 'public.get_landing_event(text, text)'::regprocedure),
  true, 'still SECURITY DEFINER');

select is(
  (select proconfig from pg_proc where oid = 'public.get_landing_event(text, text)'::regprocedure),
  array['search_path=""'], 'still pinned to an empty search_path');

-- ── Unset location: NULL, never the company address ──────────────────────────
select pg_temp.login_anon();

select is(
  (select row(location_name, location_address)::text
     from public.get_landing_event('plusone-launch-night', 'ip-loc-1')),
  '(,)',
  'no event location → both NULL (the venue address Wibautstraat 150 is not disclosed)');

select is(
  (select venue_name from public.get_landing_event('plusone-launch-night', 'ip-loc-2')),
  'Club Vesper', 'the existing venue_name column is unchanged');

-- ── Own location comes through ───────────────────────────────────────────────
reset role;
update public.events
   set location_name = 'Paradiso', location_address = 'Weteringschans 6, Amsterdam'
 where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();

select is(
  (select row(location_name, location_address)::text
     from public.get_landing_event('plusone-launch-night', 'ip-loc-3')),
  '(Paradiso,"Weteringschans 6, Amsterdam")',
  'an event with its own location exposes exactly that');

select throws_ok(
  $$ select location_name from public.events $$,
  '42501', null,
  'anon still has no direct read on events (incl. the new columns)');

-- ── Closed link: nothing at all ──────────────────────────────────────────────
reset role;
update public.events set landing_active = false
 where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'ip-loc-4')),
  0, 'a closed (unpublished) request link returns no row, so no location either');

select is(
  (select count(*)::int from public.get_landing_event('does-not-exist', 'ip-loc-5')),
  0, 'an unknown slug returns nothing');

reset role;
update public.events set landing_active = true
 where id = 'ee000000-0000-7000-8000-000000000001';

-- ── RLS on the columns = the existing events matrix ─────────────────────────
-- Max = admin at aa..01: may write.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.events set location_name = 'Melkweg'
                       where id = 'ee000000-0000-7000-8000-000000000001' $$),
  1, 'admin can set the event location');

-- Tom = staff at aa..01: reads the event, cannot write it.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select location_name from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'Melkweg', 'staff (venue member) reads the location');
select is(
  pg_temp.rowcount($$ update public.events set location_name = 'Hacked'
                       where id = 'ee000000-0000-7000-8000-000000000001' $$),
  0, 'staff cannot change the event location (RLS: 0 rows)');

reset role;

-- ── Length caps (mirror the Zod schema) ──────────────────────────────────────
select throws_ok(
  $$ update public.events set location_name = repeat('x', 121)
      where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'location_name is capped at 120 characters');

select ok(
  has_function_privilege('anon', 'public.get_landing_event(text, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid = 'public.get_landing_event(text, text)'::regprocedure
                     and a.grantee = 0),
  'grant matrix unchanged: anon may execute, PUBLIC holds nothing');

select * from finish();
rollback;
