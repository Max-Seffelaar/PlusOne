-- pgTAP — promote_guest_to_contact() authorization (86ey9e880).
-- Run: supabase test db. Proves:
--   * authorization is the DB boundary — only an admin of the venue OR an
--     organizer of an event at it may promote a guest to a contact; staff and
--     finance are refused (42501) and create nothing (closes the DEFINER
--     bypass: without this gate the read succeeded for ANY guest UUID in ANY
--     venue, regardless of membership);
--   * a NAME-ONLY guest is promoted to a name-only contact (source guest_list)
--     that is back-linked to the guest;
--   * a guest with an e-mail dedups onto an existing contact instead of
--     creating a duplicate;
--   * the action is idempotent (already-linked guest is a harmless no-op);
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
  ('ee000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001',
   'Promote Event', now() + interval '5 days', now() + interval '5 days' + interval '6 hours',
   'open', 'promote-event-e1', false);

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111');

insert into public.guest_tiers (id, event_id, name) values
  ('dd000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-0000000000e1', 'Promote');

-- Two existing contacts: one to dedup onto by e-mail (C), one already linked
-- to a different guest so the idempotency guest (D) has its own contact — the
-- partial-unique index guests_event_contact_uidx forbids two live guests on
-- the same event sharing a contact_id.
insert into public.contacts (id, venue_id, full_name, email, source) values
  ('c0000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001',
   'Dedup Person', 'dedup@real.test', 'manual'),
  ('c0000000-0000-7000-8000-0000000000e3', 'aa000000-0000-7000-8000-000000000001',
   'Already Linked Person', 'already-linked@real.test', 'manual');

insert into public.guests
  (id, event_id, tier_id, contact_id, full_name, email, plus_ones, added_by, source, status)
values
  -- name-only guest, no contact (used by the authz tests + the create-path test)
  ('cc000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-0000000000e1',
   'dd000000-0000-7000-8000-0000000000e1', null,
   'Nameless Guest', null, 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved'),
  -- guest with a dedup e-mail, no contact yet
  ('cc000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000e1',
   'dd000000-0000-7000-8000-0000000000e1', null,
   'Dedup Person', 'dedup@real.test', 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved'),
  -- guest already linked to a contact (idempotency test)
  ('cc000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e1',
   'dd000000-0000-7000-8000-0000000000e1', 'c0000000-0000-7000-8000-0000000000e3',
   'Already Linked Person', 'already-linked@real.test', 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved'),
  -- guest for the organizer-path test
  ('cc000000-0000-7000-8000-0000000000e4', 'ee000000-0000-7000-8000-0000000000e1',
   'dd000000-0000-7000-8000-0000000000e1', null,
   'Organizer Target', null, 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select plan(12);

-- ---------------------------------------------------------------------------
-- A. Authorization — staff + finance are refused and create nothing.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2');  -- staff
select throws_ok($$ select public.promote_guest_to_contact('cc000000-0000-7000-8000-0000000000e1') $$,
  '42501', null, 'A1 staff cannot promote a guest to contact');

select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2');  -- finance
select throws_ok($$ select public.promote_guest_to_contact('cc000000-0000-7000-8000-0000000000e1') $$,
  '42501', null, 'A2 finance cannot promote a guest to contact');

reset role;
select is(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000e1'),
  null::uuid, 'A3 the denied calls linked nothing');

-- ---------------------------------------------------------------------------
-- B. Admin promotes a NAME-ONLY guest → a fresh name-only contact, back-linked.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$ select public.promote_guest_to_contact('cc000000-0000-7000-8000-0000000000e1') $$,
  'B0 admin promotes the name-only guest');
reset role;
select ok(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000e1') is not null,
  'B1 the name-only guest is now linked to a fresh contact');
select ok(
  (select c.source = 'guest_list'
     from public.contacts c
     join public.guests g on g.contact_id = c.id
    where g.id = 'cc000000-0000-7000-8000-0000000000e1'),
  'B2 the auto-created contact has source guest_list');

-- ---------------------------------------------------------------------------
-- C. Admin promotes a guest with a dedup e-mail → links the EXISTING contact.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$ select public.promote_guest_to_contact('cc000000-0000-7000-8000-0000000000e2') $$,
  'C0 admin promotes the dedup-e-mail guest');
reset role;
select is(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000e2'),
  'c0000000-0000-7000-8000-0000000000e1'::uuid,
  'C1 the guest links onto the existing contact instead of creating a duplicate');

-- ---------------------------------------------------------------------------
-- D. Idempotent — an already-linked guest is a harmless no-op.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$ select public.promote_guest_to_contact('cc000000-0000-7000-8000-0000000000e3') $$,
  'D1 re-promoting an already-linked guest does not error');

-- ---------------------------------------------------------------------------
-- E. Organizer path — a non-admin organizer of the event may promote too.
-- ---------------------------------------------------------------------------

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000e1', '55555555-5555-4555-8555-555555555555');

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2');  -- now an organizer here
select lives_ok($$ select public.promote_guest_to_contact('cc000000-0000-7000-8000-0000000000e4') $$,
  'E1 an event organizer can promote a guest to contact');
reset role;
select ok(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000e4') is not null,
  'E2 the organizer-promoted guest is now linked');

-- ---------------------------------------------------------------------------
-- F. Not found.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select throws_ok($$ select public.promote_guest_to_contact('cc000000-0000-7000-8000-00000000dead') $$,
  'P0002', null, 'F1 a non-existent guest raises not-found');
reset role;

select * from finish();
rollback;
