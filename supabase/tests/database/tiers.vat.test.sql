-- pgTAP — T3 tiers editor: guest_tiers.vat_percent / event_template_tiers.vat_percent
-- (display-only, #34) + the two template copy functions carrying it correctly.
-- Relies on the seed: venue aa..01 (Club Vesper), Max=admin (11..1). Everything
-- rolls back (either the outer transaction or a savepoint per section).

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

-- ── Fixtures (superuser) ─────────────────────────────────────────────────────
-- A venue-1 event with a paid tier (door_price_cents + vat_percent set) to exercise
-- create_template_from_event, and a venue-1 template with a paid tier to exercise
-- create_event_from_template.
insert into public.events (id, venue_id, name, starts_at, status, landing_slug, landing_active)
values ('9c000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
        'VAT Fixture Event', now() + interval '7 days', 'open', 'vat-fixture-event', false);

insert into public.guest_tiers (id, event_id, name, door_price_cents, vat_percent)
values ('9a000000-0000-7000-8000-000000000001', '9c000000-0000-7000-8000-000000000001',
        'Paid VIP', 2500, 9.0);

insert into public.event_templates (id, venue_id, name)
values ('9e000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
        'VAT Fixture Template');

insert into public.event_template_tiers (id, template_id, name, door_price_cents, vat_percent)
values ('9d000000-0000-7000-8000-000000000001', '9e000000-0000-7000-8000-000000000001',
        'Paid VIP', 2500, 9.0);

select plan(15);

-- ---------------------------------------------------------------------------
-- A. Column exists on both tables.
-- ---------------------------------------------------------------------------
select has_column('public', 'guest_tiers', 'vat_percent', 'A1 guest_tiers has vat_percent');
select has_column('public', 'event_template_tiers', 'vat_percent',
  'A2 event_template_tiers has vat_percent');

-- ---------------------------------------------------------------------------
-- B. Range + cross-column constraints on guest_tiers.
-- ---------------------------------------------------------------------------
savepoint b1;
select throws_ok(
  $$insert into public.guest_tiers (event_id, name, door_price_cents, vat_percent)
    values ('9c000000-0000-7000-8000-000000000001', 'Over', 1000, 150)$$,
  '23514', null, 'B1 vat_percent > 100 is rejected');
rollback to savepoint b1;

savepoint b2;
select throws_ok(
  $$insert into public.guest_tiers (event_id, name, door_price_cents, vat_percent)
    values ('9c000000-0000-7000-8000-000000000001', 'Under', 1000, -1)$$,
  '23514', null, 'B2 a negative vat_percent is rejected');
rollback to savepoint b2;

savepoint b3;
select lives_ok(
  $$insert into public.guest_tiers (event_id, name, door_price_cents, vat_percent)
    values ('9c000000-0000-7000-8000-000000000001', 'Fractional', 1000, 9.5)$$,
  'B3 a fractional vat_percent (9.5) on a paid tier is accepted');
rollback to savepoint b3;

savepoint b4;
select throws_ok(
  $$insert into public.guest_tiers (event_id, name, door_price_cents, vat_percent)
    values ('9c000000-0000-7000-8000-000000000001', 'FreeWithVat', null, 9)$$,
  '23514', null, 'B4 vat_percent on a free tier (door_price_cents null) is rejected');
rollback to savepoint b4;

savepoint b5;
select lives_ok(
  $$insert into public.guest_tiers (event_id, name, door_price_cents, vat_percent)
    values ('9c000000-0000-7000-8000-000000000001', 'FreeNoVat', null, null)$$,
  'B5 a free tier with both null stays valid');
rollback to savepoint b5;

-- ---------------------------------------------------------------------------
-- C. Same constraints mirrored on event_template_tiers.
-- ---------------------------------------------------------------------------
savepoint c1;
select throws_ok(
  $$insert into public.event_template_tiers (template_id, name, door_price_cents, vat_percent)
    values ('9e000000-0000-7000-8000-000000000001', 'Over', 1000, 101)$$,
  '23514', null, 'C1 template tier: vat_percent > 100 is rejected');
rollback to savepoint c1;

savepoint c2;
select throws_ok(
  $$insert into public.event_template_tiers (template_id, name, door_price_cents, vat_percent)
    values ('9e000000-0000-7000-8000-000000000001', 'FreeWithVat', null, 9)$$,
  '23514', null, 'C2 template tier: vat_percent without a price is rejected');
rollback to savepoint c2;

-- ---------------------------------------------------------------------------
-- D. create_event_from_template carries vat_percent into guest_tiers.
-- ---------------------------------------------------------------------------
savepoint d1;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$select public.create_event_from_template('9e000000-0000-7000-8000-000000000001',
    'From Template VAT', '2026-08-01 23:00:00+02')$$,
  'D1 admin creates an event from the VAT-fixture template');
reset role;
select is(
  (select gt.vat_percent from public.guest_tiers gt
   join public.events e on e.id = gt.event_id where e.name = 'From Template VAT'),
  9.0::numeric, 'D2 the seeded guest_tiers row carries the template''s vat_percent');
select is(
  (select gt.door_price_cents from public.guest_tiers gt
   join public.events e on e.id = gt.event_id where e.name = 'From Template VAT'),
  2500, 'D3 the seeded guest_tiers row still carries door_price_cents too');
rollback to savepoint d1;

-- ---------------------------------------------------------------------------
-- E. create_template_from_event carries BOTH door_price_cents and vat_percent
--    into event_template_tiers — regression: the pre-existing snapshot INSERT
--    dropped door_price_cents entirely (fixed in 20260706120000_tier_vat_percent).
-- ---------------------------------------------------------------------------
savepoint e1;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$select public.create_template_from_event('9c000000-0000-7000-8000-000000000001',
    'From Event VAT')$$,
  'E1 admin saves the VAT-fixture event as a template');
reset role;
select is(
  (select tt.door_price_cents from public.event_template_tiers tt
   join public.event_templates t on t.id = tt.template_id where t.name = 'From Event VAT'),
  2500, 'E2 the snapshotted tier carries door_price_cents (regression for the drop bug)');
select is(
  (select tt.vat_percent from public.event_template_tiers tt
   join public.event_templates t on t.id = tt.template_id where t.name = 'From Event VAT'),
  9.0::numeric, 'E3 the snapshotted tier carries vat_percent');
rollback to savepoint e1;

-- ---------------------------------------------------------------------------
-- Re-sync pgTAP's own counter before finish().
--
-- pgTAP keeps "how many tests ran" (curr_test) in the temp TABLE __tcache__, so
-- `rollback to savepoint` reverts it along with everything else in the section.
-- The test *numbers* it prints come from __tresults___numb_seq — a SEQUENCE, and
-- sequences are non-transactional, so those keep counting correctly. The two
-- therefore drift apart: finish() compared plan() against the last assertion that
-- ran outside a savepoint and printed "Looks like you planned N tests but ran 2",
-- even though every assertion had run and passed. Take the count from the
-- sequence, the one place that actually knows what executed.
--
-- num_failed() is reverted the same way and cannot be recovered from a sequence,
-- but a failing assertion still reaches the harness as its own "not ok" line, so
-- pg_prove remains the source of truth for pass/fail.
do $resync$ begin
  perform _set('curr_test', currval('__tresults___numb_seq')::int);
end $resync$;

select * from finish();

rollback;
