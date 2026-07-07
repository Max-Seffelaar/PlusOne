-- pgTAP — bulk "mark as regular" mark_guest_regular() (T11, #11).
-- Run: supabase test db. Proves:
--   * authorization is the DB boundary — only an admin of the venue OR an
--     organizer of an event at it may mark a guest regular; staff/finance are
--     refused (42501) and star nothing;
--   * a guest already linked to a contact → that contact becomes is_permanent;
--   * a NAME-ONLY guest is auto-promoted to a contact (source guest_list) that is
--     back-linked to the guest AND starred, in one call;
--   * the action is idempotent (re-marking is a harmless no-op);
--   * a non-existent guest raises not-found.
-- Fixtures live in seed venue aa..01 (admin 1111 is admin there, staff 5555 is
-- staff, finance 3333 is finance). Rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_aal text default 'aal2')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — bypasses RLS; triggers still fire). Admin 1111 organizes
-- the event so the guest inserts are quota-exempt.
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-0000000000d1', 'aa000000-0000-7000-8000-000000000001',
   'Regular Event', now() + interval '5 days', now() + interval '5 days' + interval '6 hours',
   'open', 'regular-event-d1', false);

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111');

insert into public.guest_tiers (id, event_id, name) values
  ('dd000000-0000-7000-8000-0000000000d1', 'ee000000-0000-7000-8000-0000000000d1', 'Regular');

-- A contact (NOT yet permanent) + a guest linked to it.
insert into public.contacts (id, venue_id, full_name, email, is_permanent, source) values
  ('c0000000-0000-7000-8000-0000000000d1', 'aa000000-0000-7000-8000-000000000001',
   'Linked Person', 'linked@real.test', false, 'manual'),
  ('c0000000-0000-7000-8000-0000000000d3', 'aa000000-0000-7000-8000-000000000001',
   'Organizer Target', 'orgtarget@real.test', false, 'manual');

insert into public.guests
  (id, event_id, tier_id, contact_id, full_name, email, plus_ones, added_by, source, status)
values
  -- linked guest
  ('cc000000-0000-7000-8000-0000000000d1', 'ee000000-0000-7000-8000-0000000000d1',
   'dd000000-0000-7000-8000-0000000000d1', 'c0000000-0000-7000-8000-0000000000d1',
   'Linked Person', 'linked@real.test', 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved'),
  -- name-only guest (no contact, no dedup key)
  ('cc000000-0000-7000-8000-0000000000d2', 'ee000000-0000-7000-8000-0000000000d1',
   'dd000000-0000-7000-8000-0000000000d1', null,
   'Nameless Guest', null, 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved'),
  -- guest for the organizer-path test
  ('cc000000-0000-7000-8000-0000000000d3', 'ee000000-0000-7000-8000-0000000000d1',
   'dd000000-0000-7000-8000-0000000000d1', 'c0000000-0000-7000-8000-0000000000d3',
   'Organizer Target', 'orgtarget@real.test', 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select plan(12);

-- ---------------------------------------------------------------------------
-- A. Authorization — staff + finance are refused and star nothing.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2');  -- staff
select throws_ok($$ select public.mark_guest_regular('cc000000-0000-7000-8000-0000000000d1') $$,
  '42501', null, 'A1 staff cannot mark a guest regular');

select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2');  -- finance
select throws_ok($$ select public.mark_guest_regular('cc000000-0000-7000-8000-0000000000d1') $$,
  '42501', null, 'A2 finance cannot mark a guest regular');

reset role;
select is(
  (select is_permanent from public.contacts where id = 'c0000000-0000-7000-8000-0000000000d1'),
  false, 'A3 the denied calls starred nothing');

-- ---------------------------------------------------------------------------
-- B. Admin marks a linked guest → the contact becomes permanent.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$ select public.mark_guest_regular('cc000000-0000-7000-8000-0000000000d1') $$,
  'B0 admin marks the linked guest regular');
reset role;
select is(
  (select is_permanent from public.contacts where id = 'c0000000-0000-7000-8000-0000000000d1'),
  true, 'B1 the linked contact is now permanent');

-- ---------------------------------------------------------------------------
-- C. Admin marks a NAME-ONLY guest → auto-promote to a contact + star it.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$ select public.mark_guest_regular('cc000000-0000-7000-8000-0000000000d2') $$,
  'C0 admin marks the name-only guest regular');
reset role;
select ok(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000d2') is not null,
  'C1 the name-only guest is now linked to a fresh contact');
select ok(
  (select c.is_permanent and c.source = 'guest_list'
     from public.contacts c
     join public.guests g on g.contact_id = c.id
    where g.id = 'cc000000-0000-7000-8000-0000000000d2'),
  'C2 the auto-created contact is permanent + source guest_list');

-- ---------------------------------------------------------------------------
-- D. Idempotent — re-marking the linked guest is a harmless no-op.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$ select public.mark_guest_regular('cc000000-0000-7000-8000-0000000000d1') $$,
  'D1 re-marking an already-regular guest does not error');
reset role;

-- ---------------------------------------------------------------------------
-- E. Organizer path — a non-admin organizer of the event may mark too.
-- ---------------------------------------------------------------------------

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000d1', '55555555-5555-4555-8555-555555555555');

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2');  -- now an organizer here
select lives_ok($$ select public.mark_guest_regular('cc000000-0000-7000-8000-0000000000d3') $$,
  'E1 an event organizer can mark a guest regular');
reset role;
select is(
  (select is_permanent from public.contacts where id = 'c0000000-0000-7000-8000-0000000000d3'),
  true, 'E2 the organizer-marked contact is permanent');

-- ---------------------------------------------------------------------------
-- F. Not found.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select throws_ok($$ select public.mark_guest_regular('cc000000-0000-7000-8000-00000000dead') $$,
  'P0002', null, 'F1 a non-existent guest raises not-found');
reset role;

select * from finish();
rollback;
