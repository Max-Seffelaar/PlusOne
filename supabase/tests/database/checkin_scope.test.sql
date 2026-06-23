-- pgTAP — schaal-track #3a: check_ins/refusals event_id+venue_id denormalisatie
-- (migration 20260622120000_checkin_event_scope). Run: supabase test db.
--
-- Proves: (1) the columns auto-populate from the guest on insert (the BEFORE
-- trigger), (2) the backfill left every existing row correctly scoped, and (3) the
-- rewritten SELECT policies preserve the §2 role matrix — door/finance/organizer
-- may read, staff/user_manager may not. Relies on the same seed as rls.test.sql
-- (venue aa..01 Club Vesper, event ee..01 open with 30 guests, the 6 role users).
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- PostgREST-style JWT claims + role switch (mirrors rls.test.sql).
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(13);

-- IDs from the seed: admin=1111 UM=2222 finance=3333 organizer=4444 staff=5555
-- doorhost=6666 · venue1=aa..01 · event(open)=ee..01 · tier=dd..01.

-- 0. Schema shape -----------------------------------------------------------
select has_column('public', 'check_ins', 'event_id', '0a check_ins has event_id');
select has_column('public', 'check_ins', 'venue_id', '0b check_ins has venue_id');
select col_not_null('public', 'check_ins', 'event_id', '0c check_ins.event_id is NOT NULL');
select col_not_null('public', 'refusals', 'event_id', '0d refusals.event_id is NOT NULL');

-- 1. Backfill correctness: no seed row is mis-scoped -------------------------
select is(
  (select count(*)::int from public.check_ins ci
     join public.guests g on g.id = ci.guest_id
    where ci.event_id <> g.event_id),
  0, '1a every check_in.event_id matches its guest''s event (backfill)');
select is(
  (select count(*)::int from public.refusals r
     join public.guests g on g.id = r.guest_id
    where r.event_id <> g.event_id),
  0, '1b every refusal.event_id matches its guest''s event (backfill)');

-- 2. The BEFORE trigger fills the scope on a fresh door check-in ------------
select pg_temp.login('66666666-6666-4666-8666-666666666666');
insert into public.guests (id, event_id, tier_id, full_name, added_by, source)
  values ('cc000000-0000-7000-8000-0000000000a1',
          'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001',
          'Scope Test Gast', '66666666-6666-4666-8666-666666666666', 'door');
insert into public.check_ins (guest_id, checked_by, device_id)
  values ('cc000000-0000-7000-8000-0000000000a1',
          '66666666-6666-4666-8666-666666666666', 'scope-test');
select is(
  (select event_id from public.check_ins
    where guest_id = 'cc000000-0000-7000-8000-0000000000a1'),
  'ee000000-0000-7000-8000-000000000001'::uuid,
  '2a check_in.event_id auto-filled from the guest');
select is(
  (select venue_id from public.check_ins
    where guest_id = 'cc000000-0000-7000-8000-0000000000a1'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  '2b check_in.venue_id auto-filled from the event');

-- 3. Rewritten SELECT policy preserves the §2 matrix ------------------------
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select ok((select count(*)::int from public.check_ins) > 0, '3a doorhost reads check_ins');

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select ok((select count(*)::int from public.check_ins) > 0, '3b finance reads check_ins');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select ok((select count(*)::int from public.check_ins) > 0, '3c organizer reads own-event check_ins');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.check_ins), 0, '3d staff may NOT read check_ins');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.check_ins), 0, '3e user_manager may NOT read check_ins');

reset role;
select * from finish();
rollback;
