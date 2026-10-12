-- pgTAP — templates keep the guest texts (z8uq9m4pnk,
-- 20261016160000_template_guest_texts.sql). Proves: the two columns exist with
-- the same CHECKs as events (house_rules 1..500, guest_info 1..1000 with no
-- control characters except tab/LF/CR); Save as template copies both from the
-- event; an event created from a template gets both; NULL stays NULL both ways;
-- the RPCs keep their role checks (staff denied, a venue-1 organizer allowed on
-- their own venue's event but denied on a venue-2 event, so another company's
-- texts never leak into a template); RLS on the new columns is the existing
-- event_templates matrix (incl. cross-tenant: 0 rows on a venue-2 template); the RPCs stay
-- SECURITY DEFINER with an empty search_path and the same grants.
-- Seed: venue aa..01 (Max admin, Tom staff, Yusuf organizer of ee..01, no
-- membership), venue aa..02 (only Max). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

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

-- ── Columns + CHECKs ─────────────────────────────────────────────────────────
select col_is_null('public', 'event_templates', 'house_rules', 'event_templates.house_rules is nullable');
select col_is_null('public', 'event_templates', 'guest_info', 'event_templates.guest_info is nullable');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'event_templates_house_rules_len'),
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'events_house_rules_len'),
  'the template house_rules CHECK is the events one');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'event_templates_guest_info_check'),
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'events_guest_info_check'),
  'the template guest_info CHECK is the events one');

update public.events
   set house_rules = 'No sneakers. 18+ only.',
       guest_info = E'Park at the P2 garage.\nSide entrance after 23:00.'
 where id = 'ee000000-0000-7000-8000-000000000001';

-- ── Save as template copies both ─────────────────────────────────────────────
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, admin
insert into ids values ('tpl', public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Club night'));
reset role;

select is(
  (select house_rules from public.event_templates where id = (select v from ids where k = 'tpl')),
  'No sneakers. 18+ only.',
  'create_template_from_event copies the house rules');
select is(
  (select guest_info from public.event_templates where id = (select v from ids where k = 'tpl')),
  E'Park at the P2 garage.\nSide entrance after 23:00.',
  'create_template_from_event copies the guest info (newline kept)');

-- ── Create from template puts both on the new event ──────────────────────────
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into ids values ('ev', public.create_event_from_template(
  (select v from ids where k = 'tpl'), 'Club night II', now() + interval '10 days', null));
reset role;

select is(
  (select row(house_rules, guest_info)::text from public.events where id = (select v from ids where k = 'ev')),
  (select row(house_rules, guest_info)::text from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'create_event_from_template puts both texts on the new event');

-- ── NULL stays NULL ──────────────────────────────────────────────────────────
update public.events set house_rules = null, guest_info = null
 where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into ids values ('tpl0', public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Plain'));
insert into ids values ('ev0', public.create_event_from_template(
  (select v from ids where k = 'tpl0'), 'Plain night', now() + interval '11 days', null));
reset role;

select is(
  (select row(house_rules, guest_info)::text from public.event_templates where id = (select v from ids where k = 'tpl0')),
  '(,)', 'an event without guest texts makes a template without them');
select is(
  (select row(house_rules, guest_info)::text from public.events where id = (select v from ids where k = 'ev0')),
  '(,)', 'a template without guest texts makes an event without them');

-- ── Role checks unchanged ────────────────────────────────────────────────────
select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff
select throws_ok(
  $$ select public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Staff tpl') $$,
  '42501', null, 'staff cannot save a template');
select throws_ok(
  format($$ select public.create_event_from_template(%L, 'Staff ev', now() + interval '12 days', null) $$,
         (select v from ids where k = 'tpl')),
  '42501', null, 'staff cannot create an event from a template');
select is(
  pg_temp.rowcount(format($$ update public.event_templates set guest_info = 'Hacked' where id = %L $$,
                          (select v from ids where k = 'tpl'))),
  0, 'staff cannot change a template''s guest info (RLS: 0 rows)');
reset role;

-- Cross-tenant: an event at venue 2 with guest texts; Yusuf organizes at
-- venue 1 only, so neither RPC lets him copy venue 2's texts.
insert into public.events (id, venue_id, name, starts_at, landing_slug, house_rules, guest_info)
values ('ee000000-0000-7000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000002',
        'Marktzaal night', now() + interval '14 days', '', 'V2 rules', 'V2 info');
select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- Yusuf, organizer at venue 1
select throws_ok(
  $$ select public.create_template_from_event('ee000000-0000-7000-8000-0000000000b2', 'Stolen') $$,
  '42501', null, 'cross-tenant: a venue-1 organizer cannot save a venue-2 event as a template');
select throws_ok(
  format($$ select public.create_event_from_template(%L, 'Org ev', now() + interval '12 days', null) $$,
         (select v from ids where k = 'tpl')),
  '42501', null, 'an organizer cannot create an event from a template (admin-only)');
reset role;

-- Allowed: an organizer of an event at venue 1 may save it as a template
-- (organizes_event_at_venue), and both texts come along.
update public.events
   set house_rules = 'Org rules', guest_info = 'Org info'
 where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('44444444-4444-4444-8444-444444444444');
insert into ids values ('tpl_org', public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Org save'));
reset role;
select is(
  (select row(house_rules, guest_info)::text from public.event_templates where id = (select v from ids where k = 'tpl_org')),
  '("Org rules","Org info")',
  'a venue-1 organizer can save their event as a template, with both texts');

-- Cross-tenant RLS on the new columns: a venue-2 template is out of reach.
insert into public.event_templates (id, venue_id, name, house_rules, guest_info)
values ('eeeeeeee-0000-7000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000002',
        'Marktzaal tpl', 'V2 tpl rules', 'V2 tpl info');
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  pg_temp.rowcount($$ update public.event_templates set guest_info = 'Hijacked'
                      where id = 'eeeeeeee-0000-7000-8000-0000000000b2' $$),
  0, 'cross-tenant: a venue-1 organizer cannot change a venue-2 template''s guest info (RLS: 0 rows)');
reset role;
select is(
  (select count(*)::int from public.event_templates where guest_info = 'V2 info' or house_rules = 'V2 rules'),
  0, 'no template holds venue 2''s texts');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount(format($$ update public.event_templates set guest_info = 'Ring the bell', house_rules = 'Be kind' where id = %L $$,
                          (select v from ids where k = 'tpl'))),
  1, 'admin can change a template''s guest texts');
reset role;

select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('role', 'anon', true);
select throws_ok(
  $$ select public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Anon tpl') $$,
  '42501', null, 'anon: create_template_from_event refuses');
reset role;

-- ── Caps + control characters ────────────────────────────────────────────────
select throws_ok(
  format($$ update public.event_templates set house_rules = repeat('x', 501) where id = %L $$,
         (select v from ids where k = 'tpl')),
  '23514', null, 'template house_rules is capped at 500 characters');
select throws_ok(
  format($$ update public.event_templates set guest_info = repeat('x', 1001) where id = %L $$,
         (select v from ids where k = 'tpl')),
  '23514', null, 'template guest_info is capped at 1000 characters');
select throws_ok(
  format($$ update public.event_templates set guest_info = E'bell\x07' where id = %L $$,
         (select v from ids where k = 'tpl')),
  '23514', null, 'template guest_info refuses control characters');

-- ── Function hygiene unchanged ───────────────────────────────────────────────
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""'])
     from pg_proc where oid in ('public.create_template_from_event(uuid, text)'::regprocedure,
                                'public.create_event_from_template(uuid, text, timestamptz, timestamptz)'::regprocedure)),
  'both RPCs stay SECURITY DEFINER with an empty search_path');
select ok(
  not has_function_privilege('anon', 'public.create_template_from_event(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.create_event_from_template(uuid, text, timestamptz, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.create_template_from_event(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_event_from_template(uuid, text, timestamptz, timestamptz)', 'execute'),
  'grants unchanged: anon cannot execute either RPC, authenticated can');

select * from finish();
rollback;
