-- pgTAP — Event templates (86exyp8gn): RLS, the venue_id scope trigger, the hard
-- capacity trigger (45005), the create_event_from_template RPC, and audit.
-- Relies on the seed: venue aa..01 (Club Vesper) with Max=admin (11..1),
-- Yusuf=organizer of event ee..01 (44..4, NO venue membership), Tom=staff (55..5);
-- venue aa..02 (De Marktzaal) where only Max is a member. Everything rolls back.

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

-- ── Fixtures (superuser) ─────────────────────────────────────────────────────
-- T1: a venue-1 template with a hard capacity + default settings + one tier.
-- T2: a venue-2 template (cross-tenant). A capacity-test event with capacity 3.
insert into public.event_templates
  (id, venue_id, name, capacity, allow_uncheck, landing_active, auto_lock_offset_minutes)
values
  ('7e000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
   'Lofi Open Air', 1800, false, true, -120),
  ('7e000000-0000-7000-8000-000000000002', 'aa000000-0000-7000-8000-000000000002',
   'Marktzaal Standard', 500, null, false, null);

-- venue_id deliberately omitted — set_template_tier_scope must stamp it (venue 1).
insert into public.event_template_tiers (id, template_id, name, color, max_guests, aliases)
values
  ('7d000000-0000-7000-8000-000000000001', '7e000000-0000-7000-8000-000000000001',
   'VIP', '#B5A6FF', 100, '{vip}');

insert into public.events (id, venue_id, name, starts_at, status, landing_slug, landing_active, capacity)
values ('ee000000-0000-7000-8000-0000000000ca', 'aa000000-0000-7000-8000-000000000001',
        'Capacity Test', now() + interval '7 days', 'open', 'capacity-test', false, 3);

insert into public.guest_tiers (id, event_id, name)
values ('dd000000-0000-7000-8000-0000000000c1', 'ee000000-0000-7000-8000-0000000000ca', 'CapTier');

select plan(41);

-- ---------------------------------------------------------------------------
-- A. Scope trigger — venue_id is stamped from the parent template, and a forged
--    venue_id is overwritten (closing the RLS hole).
-- ---------------------------------------------------------------------------
-- Section A runs in the MAIN transaction (no savepoint): every later section
-- rolls back its savepoint, which also reverts pgTAP's result cache — so without
-- at least one non-rolled-back test, finish() sees zero and raises "No tests run!".
-- The two temp tiers are deleted right after, so T1 keeps its single fixture tier.
insert into public.event_template_tiers (id, template_id, name)
values ('7d000000-0000-7000-8000-0000000000a1', '7e000000-0000-7000-8000-000000000001', 'ScopeT');
select is(
  (select venue_id from public.event_template_tiers where id = '7d000000-0000-7000-8000-0000000000a1'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'A1 tier venue_id is stamped from the parent template');

-- Forge venue_id = venue 2 on a venue-1 template's tier → trigger corrects it.
insert into public.event_template_tiers (id, template_id, venue_id, name)
values ('7d000000-0000-7000-8000-0000000000a2', '7e000000-0000-7000-8000-000000000001',
        'aa000000-0000-7000-8000-000000000002', 'ForgeT');
select is(
  (select venue_id from public.event_template_tiers where id = '7d000000-0000-7000-8000-0000000000a2'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'A2 a forged venue_id is overwritten with the template''s venue');
delete from public.event_template_tiers
  where id in ('7d000000-0000-7000-8000-0000000000a1', '7d000000-0000-7000-8000-0000000000a2');

-- ---------------------------------------------------------------------------
-- B. event_templates RLS — admin OR venue-organizer manage; members read.
-- ---------------------------------------------------------------------------
savepoint b1;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$insert into public.event_templates (id, venue_id, name)
  values ('7e000000-0000-7000-8000-00000000000a', 'aa000000-0000-7000-8000-000000000001', 'Admin Tpl')$$,
  'B1 admin can create a template');
reset role;
rollback to savepoint b1;

savepoint b2;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$update public.event_templates set name = 'Renamed'
  where id = '7e000000-0000-7000-8000-000000000001'$$, 'B2 admin can edit a template');
reset role;
rollback to savepoint b2;

savepoint b3;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$delete from public.event_templates where id = '7e000000-0000-7000-8000-000000000001'$$,
  'B3 admin can delete a template');
reset role;
rollback to savepoint b3;

savepoint b4;
select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer, no membership
select lives_ok($$insert into public.event_templates (id, venue_id, name)
  values ('7e000000-0000-7000-8000-00000000000b', 'aa000000-0000-7000-8000-000000000001', 'Org Tpl')$$,
  'B4 venue-organizer can create a template (organizes_event_at_venue)');
reset role;
rollback to savepoint b4;

savepoint b5;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$update public.event_templates set name = 'Org Renamed'
  where id = '7e000000-0000-7000-8000-000000000001'$$, 'B5 venue-organizer can edit a template');
reset role;
rollback to savepoint b5;

savepoint b6;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$delete from public.event_templates where id = '7e000000-0000-7000-8000-000000000001'$$,
  'B6 venue-organizer can delete a template');
reset role;
rollback to savepoint b6;

savepoint b7;
select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff (member)
select is(
  pg_temp.rowcount($$select 1 from public.event_templates where id = '7e000000-0000-7000-8000-000000000001'$$),
  1, 'B7 staff (member) can read the venue''s templates');
reset role;
rollback to savepoint b7;

savepoint b8;
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$insert into public.event_templates (venue_id, name)
  values ('aa000000-0000-7000-8000-000000000001', 'Staff Tpl')$$,
  '42501', null, 'B8 staff cannot create a template (RLS)');
reset role;
rollback to savepoint b8;

savepoint b9;
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.event_templates set name = 'x'
    where id = '7e000000-0000-7000-8000-000000000001'$$),
  0, 'B9 staff cannot edit a template (RLS filters → 0 rows)');
reset role;
rollback to savepoint b9;

savepoint b10;
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$delete from public.event_templates where id = '7e000000-0000-7000-8000-000000000001'$$),
  0, 'B10 staff cannot delete a template (RLS filters → 0 rows)');
reset role;
rollback to savepoint b10;

savepoint b11;
select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer at venue 1, NOT venue 2
select throws_ok($$insert into public.event_templates (venue_id, name)
  values ('aa000000-0000-7000-8000-000000000002', 'Cross Tpl')$$,
  '42501', null, 'B11 cross-tenant: organizer cannot create a template at another venue');
reset role;
rollback to savepoint b11;

savepoint b12;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  pg_temp.rowcount($$select 1 from public.event_templates where id = '7e000000-0000-7000-8000-000000000002'$$),
  0, 'B12 cross-tenant: organizer cannot read another venue''s templates');
reset role;
rollback to savepoint b12;

-- ---------------------------------------------------------------------------
-- C. event_template_tiers RLS — same authority via the denormalized venue_id.
-- ---------------------------------------------------------------------------
savepoint c1;
select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer
select lives_ok($$insert into public.event_template_tiers (template_id, name)
  values ('7e000000-0000-7000-8000-000000000001', 'Org Tier')$$,
  'C1 venue-organizer can add a tier to a template');
reset role;
rollback to savepoint c1;

savepoint c2;
select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff
select throws_ok($$insert into public.event_template_tiers (template_id, name)
  values ('7e000000-0000-7000-8000-000000000001', 'Staff Tier')$$,
  '42501', null, 'C2 staff cannot add a template tier (RLS)');
reset role;
rollback to savepoint c2;

savepoint c3;
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$select 1 from public.event_template_tiers
    where template_id = '7e000000-0000-7000-8000-000000000001'$$),
  1, 'C3 staff (member) can read template tiers');
reset role;
rollback to savepoint c3;

savepoint c4;
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$delete from public.event_template_tiers
    where id = '7d000000-0000-7000-8000-000000000001'$$),
  0, 'C4 staff cannot delete a template tier (RLS filters → 0 rows)');
reset role;
rollback to savepoint c4;

-- ---------------------------------------------------------------------------
-- D. Capacity enforcement (45005) on the cap-3 event — slots = 1 + plus_ones,
--    with the removal-frees-unless-inside rule (#22; the removed-but-inside half
--    lives in event_capacity_inside.test.sql).
-- ---------------------------------------------------------------------------
savepoint dcap;
select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin (exempt from quota, not capacity)
select lives_ok($$insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
  values ('cc000000-0000-7000-8000-0000000000d1', 'ee000000-0000-7000-8000-0000000000ca',
          'dd000000-0000-7000-8000-0000000000c1', 'Cap A', 2, '11111111-1111-4111-8111-111111111111')$$,
  'D1 +2 (3 slots) exactly fills capacity 3');
select throws_ok($$insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by)
  values ('ee000000-0000-7000-8000-0000000000ca', 'dd000000-0000-7000-8000-0000000000c1',
          'Cap B', 0, '11111111-1111-4111-8111-111111111111')$$,
  '45005', null, 'D2 one more guest over capacity is blocked');
update public.guests set status = 'removed' where id = 'cc000000-0000-7000-8000-0000000000d1';
select lives_ok($$insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by)
  values ('ee000000-0000-7000-8000-0000000000ca', 'dd000000-0000-7000-8000-0000000000c1',
          'Cap C', 0, '11111111-1111-4111-8111-111111111111')$$,
  'D3 removing the never-checked-in +2 frees the slot');
reset role;
rollback to savepoint dcap;

-- ---------------------------------------------------------------------------
-- E. create_event_from_template — admin-only; seeds capacity + settings +
--    auto_lock_at + tiers atomically.
-- ---------------------------------------------------------------------------
savepoint erpc;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$select public.create_event_from_template('7e000000-0000-7000-8000-000000000001',
    'RPC Event', '2026-07-01 23:00:00+02')$$,
  'E1 admin creates an event from a template');
reset role;
select is((select capacity from public.events where name = 'RPC Event'), 1800,
  'E2 seeded event carries the template capacity');
select is((select landing_active from public.events where name = 'RPC Event'), true,
  'E3a seeded event carries landing_active');
select is((select allow_uncheck from public.events where name = 'RPC Event'), false,
  'E3b seeded event carries allow_uncheck');
select is((select auto_lock_at from public.events where name = 'RPC Event'),
  '2026-07-01 21:00:00+02'::timestamptz, 'E4 auto_lock_at = start + offset (2h before doors)');
select is((select count(*)::int from public.guest_tiers gt
           join public.events e on e.id = gt.event_id where e.name = 'RPC Event'), 1,
  'E5 the template''s tier is seeded onto the event');
select is((select gt.name from public.guest_tiers gt
           join public.events e on e.id = gt.event_id where e.name = 'RPC Event'), 'VIP',
  'E5b seeded tier keeps its name');
rollback to savepoint erpc;

savepoint erpc2;
select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer (manages templates, NOT admin)
select throws_ok(
  $$select public.create_event_from_template('7e000000-0000-7000-8000-000000000001',
    'Org Event', '2026-07-01 23:00:00+02')$$,
  '42501', null, 'E6 organizer cannot create an event from a template (admin-only)');
reset role;
rollback to savepoint erpc2;

savepoint erpc3;
select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff
select throws_ok(
  $$select public.create_event_from_template('7e000000-0000-7000-8000-000000000001',
    'Staff Event', '2026-07-01 23:00:00+02')$$,
  '42501', null, 'E7 staff cannot create an event from a template');
reset role;
rollback to savepoint erpc3;

savepoint erpc4;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$select public.create_event_from_template('7e000000-0000-7000-8000-0000000000ee',
    'Ghost Event', '2026-07-01 23:00:00+02')$$,
  'P0002', null, 'E8 an unknown template is rejected');
reset role;
select is((select count(*)::int from public.events where name = 'Ghost Event'), 0,
  'E8b no event leaks when the RPC fails');
rollback to savepoint erpc4;

-- ---------------------------------------------------------------------------
-- F. Audit (#4) — the generic trigger scopes both tables via venue_id.
-- ---------------------------------------------------------------------------
savepoint faud;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.event_templates (id, venue_id, name)
values ('7e000000-0000-7000-8000-0000000000af', 'aa000000-0000-7000-8000-000000000001', 'Audit Tpl');
reset role;
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'event_templates' and entity_id = '7e000000-0000-7000-8000-0000000000af'
     and action = 'create' and venue_id = 'aa000000-0000-7000-8000-000000000001'
     and actor_id = '11111111-1111-4111-8111-111111111111'),
  1, 'F1 template create is audited with venue scope + actor');
rollback to savepoint faud;

savepoint faud2;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.event_template_tiers (id, template_id, name)
values ('7d000000-0000-7000-8000-0000000000af', '7e000000-0000-7000-8000-000000000001', 'Audit Tier');
reset role;
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'event_template_tiers' and entity_id = '7d000000-0000-7000-8000-0000000000af'
     and venue_id = 'aa000000-0000-7000-8000-000000000001'),
  1, 'F2 template tier create is audited with venue scope (denormalized venue_id)');
rollback to savepoint faud2;

-- ---------------------------------------------------------------------------
-- G. create_template_from_event — snapshot an event's setup into a new template
--    (the reverse of E). Admin OR venue-organizer; staff denied.
-- ---------------------------------------------------------------------------
savepoint g1;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$select public.create_template_from_event('ee000000-0000-7000-8000-0000000000ca', 'From Cap')$$,
  'G1 admin saves an event as a template');
reset role;
select is((select capacity from public.event_templates where name = 'From Cap'), 3,
  'G2 the saved template snapshots the event capacity');
select is(
  (select count(*)::int from public.event_template_tiers tt
   join public.event_templates t on t.id = tt.template_id where t.name = 'From Cap'),
  1, 'G3 the saved template snapshots the event tiers');
rollback to savepoint g1;

savepoint g2;
update public.events set auto_lock_at = starts_at - interval '1 hour'
  where id = 'ee000000-0000-7000-8000-0000000000ca';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$select public.create_template_from_event('ee000000-0000-7000-8000-0000000000ca', 'From Lock')$$,
  'G4a admin saves an event that has an auto-lock');
reset role;
select is((select auto_lock_offset_minutes from public.event_templates where name = 'From Lock'), -60,
  'G4 auto_lock_at is snapshotted as a start-relative offset (-60 min before doors)');
rollback to savepoint g2;

savepoint g3;
select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer of ee..01
select lives_ok(
  $$select public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Org Save')$$,
  'G5 a venue-organizer can save their event as a template');
reset role;
rollback to savepoint g3;

savepoint g4;
select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff
select throws_ok(
  $$select public.create_template_from_event('ee000000-0000-7000-8000-000000000001', 'Staff Save')$$,
  '42501', null, 'G6 staff cannot save an event as a template');
reset role;
rollback to savepoint g4;

select * from finish();

rollback;
