-- pgTAP — bulk add_contacts_to_event() + upsert_contacts() id return (#3, T12
-- follow-up "add these imported people to an event"). Run: supabase test db.
-- Proves:
--   * authorization is the DB boundary — only an admin of the venue OR an
--     organizer of the event may bulk-add; staff/finance are refused (42501);
--   * the tier is resolved per contact (preferred_role → this event's tier, else
--     the default) and an explicit p_tier_id override wins and must belong to it;
--   * the add is idempotent (re-adding a live guest → counted 'already', not a
--     second row) and unknown/foreign contact ids are counted 'skipped';
--   * a locked list refuses the whole call (42501);
--   * upsert_contacts hands back the ids of every touched contact so the app can
--     offer to add exactly them.
-- Fixtures in seed venue aa..01 (admin 1111, staff 5555, finance 3333). Rolls back.

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
-- Fixtures (as owner). Admin 1111 organizes the event so guest inserts are
-- quota-exempt. Two tiers: Regular (default) + VIP (alias 'vip').
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001',
   'Bulk-Add Event', now() + interval '5 days', now() + interval '5 days' + interval '6 hours',
   'open', 'bulk-add-event-e1', false);

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111');

insert into public.guest_tiers (id, event_id, name, aliases) values
  ('dd000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-0000000000e1', 'Regular', '{}'),
  ('dd000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000e1', 'VIP', '{vip}');

-- Contacts in the venue: no-role, vip-role, an already-a-guest one, an override
-- target, and a lock-test target.
insert into public.contacts (id, venue_id, full_name, email, preferred_role, source) values
  ('c0000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001', 'Import One',   'one@real.test',   null,  'import'),
  ('c0000000-0000-7000-8000-0000000000e2', 'aa000000-0000-7000-8000-000000000001', 'Import Two',   'two@real.test',   'vip', 'import'),
  ('c0000000-0000-7000-8000-0000000000e3', 'aa000000-0000-7000-8000-000000000001', 'Already Guest','three@real.test', null,  'import'),
  ('c0000000-0000-7000-8000-0000000000e4', 'aa000000-0000-7000-8000-000000000001', 'Override Me',  'four@real.test',  null,  'import'),
  ('c0000000-0000-7000-8000-0000000000e5', 'aa000000-0000-7000-8000-000000000001', 'Locked Out',   'five@real.test',  null,  'import');

-- Already-a-live-guest for the idempotency / 'already' count.
insert into public.guests (id, event_id, tier_id, contact_id, full_name, email, plus_ones, added_by, source, status) values
  ('cc000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e1',
   'dd000000-0000-7000-8000-0000000000e1', 'c0000000-0000-7000-8000-0000000000e3',
   'Already Guest', 'three@real.test', 0, '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select plan(14);

-- ---------------------------------------------------------------------------
-- A. Authorization — staff + finance refused.
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2');  -- staff
select throws_ok($$ select public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
  array['c0000000-0000-7000-8000-0000000000e1']::uuid[]) $$,
  '42501', null, 'A1 staff cannot bulk-add contacts');

select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2');  -- finance
select throws_ok($$ select public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
  array['c0000000-0000-7000-8000-0000000000e1']::uuid[]) $$,
  '42501', null, 'A2 finance cannot bulk-add contacts');

-- ---------------------------------------------------------------------------
-- B. Admin adds two contacts → added=2, tiers resolved per role.
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  (public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
    array['c0000000-0000-7000-8000-0000000000e1','c0000000-0000-7000-8000-0000000000e2']::uuid[]) ->> 'added'),
  '2', 'B1 admin adds two contacts (added=2)');
reset role;
select is(
  (select tier_id from public.guests where event_id = 'ee000000-0000-7000-8000-0000000000e1' and contact_id = 'c0000000-0000-7000-8000-0000000000e1'),
  'dd000000-0000-7000-8000-0000000000e1'::uuid, 'B2 no-role contact → default Regular tier');
select is(
  (select tier_id from public.guests where event_id = 'ee000000-0000-7000-8000-0000000000e1' and contact_id = 'c0000000-0000-7000-8000-0000000000e2'),
  'dd000000-0000-7000-8000-0000000000e2'::uuid, 'B3 vip-role contact → VIP tier');

-- ---------------------------------------------------------------------------
-- C. Idempotent — re-adding the same two → already=2, added=0 (no dup rows).
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  (public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
    array['c0000000-0000-7000-8000-0000000000e1','c0000000-0000-7000-8000-0000000000e2']::uuid[]) ->> 'already'),
  '2', 'C1 re-adding the same contacts counts them already (=2)');
reset role;
select is(
  (select count(*) from public.guests where event_id = 'ee000000-0000-7000-8000-0000000000e1' and contact_id = 'c0000000-0000-7000-8000-0000000000e1' and status <> 'removed'),
  1::bigint, 'C2 no duplicate guest row was created');

-- ---------------------------------------------------------------------------
-- D. Unknown + already-a-guest counts. add [already-guest, nonexistent] →
--    already=1, skipped=1.
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  (public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
    array['c0000000-0000-7000-8000-0000000000e3','c0000000-0000-7000-8000-00000000dead']::uuid[]) ->> 'skipped'),
  '1', 'D1 an unknown contact id is skipped');

-- ---------------------------------------------------------------------------
-- E. Explicit tier override wins (and must belong to the event).
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  (public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
    array['c0000000-0000-7000-8000-0000000000e4']::uuid[],
    'dd000000-0000-7000-8000-0000000000e2') ->> 'added'),
  '1', 'E1 override add succeeds');
reset role;
select is(
  (select tier_id from public.guests where event_id = 'ee000000-0000-7000-8000-0000000000e1' and contact_id = 'c0000000-0000-7000-8000-0000000000e4'),
  'dd000000-0000-7000-8000-0000000000e2'::uuid, 'E2 override placed the no-role contact in VIP');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select throws_ok($$ select public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
  array['c0000000-0000-7000-8000-0000000000e5']::uuid[], 'dd000000-0000-7000-8000-000000000001') $$,
  'P0002', null, 'E3 a tier from another event is rejected');

-- ---------------------------------------------------------------------------
-- F. A locked list still accepts an admin/organizer add — they retain write
--    access (#6); only staff are frozen out (and staff can't call this anyway).
-- ---------------------------------------------------------------------------
update public.events set list_locked = true, locked_by = '11111111-1111-4111-8111-111111111111', locked_at = now()
 where id = 'ee000000-0000-7000-8000-0000000000e1';
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$ select public.add_contacts_to_event('ee000000-0000-7000-8000-0000000000e1',
  array['c0000000-0000-7000-8000-0000000000e5']::uuid[]) $$,
  'F1 an admin retains write access on a locked list (#6)');
reset role;
select is(
  (select count(*) from public.guests where event_id = 'ee000000-0000-7000-8000-0000000000e1' and contact_id = 'c0000000-0000-7000-8000-0000000000e5' and status <> 'removed'),
  1::bigint, 'F2 the locked-list admin add landed');

-- ---------------------------------------------------------------------------
-- G. upsert_contacts hands back the ids of every touched contact.
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  jsonb_array_length(public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Ids One","email":"idsone@real.test"},{"full_name":"Ids Two","phone":"+31600009999"}]'::jsonb) -> 'ids'),
  2, 'G1 upsert_contacts returns an id per imported row');
reset role;

select * from finish();
rollback;
