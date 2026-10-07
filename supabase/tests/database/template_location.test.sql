-- pgTAP — templates keep the event location (z8uq9m2vqc follow-up,
-- 20261007135000_template_location.sql). Proves: Save as template copies the
-- event's location; an event created from a template gets the template's
-- location; NULL stays NULL both ways (company fallback); the RPCs keep their
-- role checks (staff / anon denied); RLS on the new columns is the existing
-- event_templates matrix (admin writes, staff cannot); CHECK caps; the RPCs stay
-- SECURITY DEFINER with an empty search_path and the same grants.
-- Seed: venue aa..01 (Max admin, Tom staff), event ee..01. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
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

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

update public.events
   set location_name = 'Paradiso', location_address = 'Weteringschans 6, Amsterdam'
 where id = 'ee000000-0000-7000-8000-000000000001';

-- ── Save as template copies the location ─────────────────────────────────────
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, admin
insert into ids values ('tpl', public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Off-site'));
reset role;

select is(
  (select row(location_name, location_address)::text from public.event_templates where id = (select v from ids where k = 'tpl')),
  '(Paradiso,"Weteringschans 6, Amsterdam")',
  'create_template_from_event copies the event location into the template');

-- ── Create from template sets it on the new event ────────────────────────────
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into ids values ('ev', public.create_event_from_template(
  (select v from ids where k = 'tpl'), 'Off-site night', now() + interval '10 days', null));
reset role;

select is(
  (select row(location_name, location_address)::text from public.events where id = (select v from ids where k = 'ev')),
  '(Paradiso,"Weteringschans 6, Amsterdam")',
  'create_event_from_template puts the template location on the new event');

-- ── NULL stays NULL (company fallback) ───────────────────────────────────────
update public.events set location_name = null, location_address = null
 where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into ids values ('tpl0', public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'At home'));
insert into ids values ('ev0', public.create_event_from_template(
  (select v from ids where k = 'tpl0'), 'Home night', now() + interval '11 days', null));
reset role;

select is(
  (select row(location_name, location_address)::text from public.event_templates where id = (select v from ids where k = 'tpl0')),
  '(,)', 'an event without a location makes a template without one');
select is(
  (select row(location_name, location_address)::text from public.events where id = (select v from ids where k = 'ev0')),
  '(,)', 'a template without a location makes an event without one (company fallback)');

-- ── Role checks unchanged ────────────────────────────────────────────────────
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff
select throws_ok(
  $$ select public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Staff tpl') $$,
  '42501', null, 'staff cannot save a template (location or not)');
select throws_ok(
  format($$ select public.create_event_from_template(%L, 'Staff ev', now() + interval '12 days', null) $$,
         (select v from ids where k = 'tpl')),
  '42501', null, 'staff cannot create an event from a template');

-- RLS on the new template columns = the existing event_templates matrix.
select is(
  pg_temp.rowcount(format($$ update public.event_templates set location_name = 'Hacked' where id = %L $$,
                          (select v from ids where k = 'tpl'))),
  0, 'staff cannot change a template location (RLS: 0 rows)');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount(format($$ update public.event_templates set location_name = 'Melkweg' where id = %L $$,
                          (select v from ids where k = 'tpl'))),
  1, 'admin can change a template location');
reset role;

select is(
  (select location_name from public.event_templates where id = (select v from ids where k = 'tpl')),
  'Melkweg', 'the admin edit landed');

select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('role', 'anon', true);
select throws_ok(
  $$ select public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Anon tpl') $$,
  '42501', null, 'anon: create_template_from_event refuses');
reset role;

-- ── Caps ─────────────────────────────────────────────────────────────────────
select throws_ok(
  format($$ update public.event_templates set location_name = repeat('x', 121) where id = %L $$,
         (select v from ids where k = 'tpl')),
  '23514', null, 'template location_name is capped at 120 characters');
select throws_ok(
  format($$ update public.event_templates set location_address = repeat('x', 201) where id = %L $$,
         (select v from ids where k = 'tpl')),
  '23514', null, 'template location_address is capped at 200 characters');

-- ── Function hygiene unchanged ───────────────────────────────────────────────
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""'])
     from pg_proc where oid in ('public.create_template_from_event(uuid, text)'::regprocedure,
                                'public.create_event_from_template(uuid, text, timestamptz, timestamptz)'::regprocedure)),
  'both RPCs stay SECURITY DEFINER with an empty search_path');
select ok(
  not has_function_privilege('anon', 'public.create_template_from_event(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.create_event_from_template(uuid, text, timestamptz, timestamptz)', 'execute'),
  'anon still cannot execute either RPC');
select ok(
  has_function_privilege('authenticated', 'public.create_template_from_event(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_event_from_template(uuid, text, timestamptz, timestamptz)', 'execute'),
  'authenticated still may execute both RPCs');

select * from finish();
rollback;
