-- pgTAP — 86ey9e84m: cross-tenant venue_id integrity (S1 + S4, adversarial
-- review CONFIRMED). Proves migration 20260713160000_venue_id_rls_integrity
-- closes both exploits:
--   S1 — a client-forged venue_id on guests/guest_requests (and, via the same
--        shared trigger, quota_requests/guest_tiers) is always overwritten
--        from the row's own event, never trusted, regardless of role or
--        insert vs. update.
--   S4 — events.venue_id is pinned: a WITH CHECK that still passes (organizer
--        keeps event-scoped access after a forged venue_id) never actually
--        moves the row, because the BEFORE trigger resets it before the
--        WITH CHECK is evaluated.
-- Relies on the same seed as rls.test.sql (venue1=aa..01 Club Vesper,
-- venue2=aa..02 De Marktzaal, event ee..01 in venue1, tier dd..01, admin=1111
-- staff=5555 organizer=4444). Everything rolls back.

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

select plan(9);

-- ---------------------------------------------------------------------------
-- S1a. Regression: the everyday path (no venue_id sent at all) still fills
-- correctly — the fix removes the null-guard but the unconditional overwrite
-- covers it identically.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
insert into public.guests (id, event_id, tier_id, full_name, added_by, source)
values ('cc000000-0000-7000-8000-0000000000b1',
        'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001',
        'Scope Regression Gast', '55555555-5555-4555-8555-555555555555', 'app');
select is(
  (select venue_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000b1'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1a venue_id auto-fills from event_id when omitted (regression)');
reset role;

-- ---------------------------------------------------------------------------
-- S1b. Guest injection: staff (non-exempt) forges venue_id to the OTHER
-- venue on INSERT — must be silently corrected back to their own venue.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
insert into public.guests (id, event_id, tier_id, full_name, added_by, source, venue_id)
values ('cc000000-0000-7000-8000-0000000000b2',
        'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001',
        'Forged Venue Gast', '55555555-5555-4555-8555-555555555555', 'app',
        'aa000000-0000-7000-8000-000000000002');
select is(
  (select venue_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000b2'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1b forged venue_id on guest INSERT is ignored, pinned to the event''s real venue');
reset role;

-- ---------------------------------------------------------------------------
-- S1c. Same exploit via UPDATE of an existing row (admin, event_id unchanged).
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.guests
   set venue_id = 'aa000000-0000-7000-8000-000000000002'
 where id = 'cc000000-0000-7000-8000-0000000000b2';
select is(
  (select venue_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000b2'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1c forged venue_id on guest UPDATE is ignored too');
reset role;

-- ---------------------------------------------------------------------------
-- S1d. guest_requests: there is no longer a client insert to forge on.
-- This case used to plant the row as staff through guest_requests_insert_public
-- and assert the trigger corrected venue_id. 20260924100000 (F-3) revoked
-- INSERT on guest_requests from `authenticated` and dropped that policy — a
-- landing request is created by submit_guest_request (SECURITY DEFINER) and by
-- nothing else — so the client arm is now a 42501, and the trigger arm is
-- asserted on the privilege level that still reaches the table (owner/
-- service_role, i.e. the seed and the perf scripts). Both halves matter: the
-- first is the F-3 fix, the second keeps the shared BEFORE trigger covered for
-- guest_requests, which is what this file is about.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name, venue_id)
     values ('ee000000-0000-7000-8000-000000000001', 'Forged Venue Request',
             'aa000000-0000-7000-8000-000000000002') $$,
  '42501', null,
  'S1d staff can no longer insert a guest_request at all (F-3, 20260924100000)');
reset role;

insert into public.guest_requests (event_id, full_name, venue_id)
values ('ee000000-0000-7000-8000-000000000001', 'Forged Venue Request',
        'aa000000-0000-7000-8000-000000000002');
select is(
  (select venue_id from public.guest_requests
    where event_id = 'ee000000-0000-7000-8000-000000000001'
      and full_name = 'Forged Venue Request'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1d2 ...and a forged venue_id on the owner path is still overwritten from the event');

-- ---------------------------------------------------------------------------
-- S1e. Same shared trigger, quota_requests: staff forges venue_id on their
-- own quota request.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
insert into public.quota_requests (event_id, user_id, requested_extra, venue_id)
values ('ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555',
        2, 'aa000000-0000-7000-8000-000000000002');
select is(
  (select venue_id from public.quota_requests
    where event_id = 'ee000000-0000-7000-8000-000000000001'
      and user_id = '55555555-5555-4555-8555-555555555555'
      and requested_extra = 2),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1e forged venue_id on a quota_request is ignored');
reset role;

-- ---------------------------------------------------------------------------
-- S1f. Same shared trigger, guest_tiers: admin forges venue_id on a new tier.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.guest_tiers (event_id, name, venue_id)
values ('ee000000-0000-7000-8000-000000000001', 'Forged Venue Tier',
        'aa000000-0000-7000-8000-000000000002');
select is(
  (select venue_id from public.guest_tiers
    where event_id = 'ee000000-0000-7000-8000-000000000001'
      and name = 'Forged Venue Tier'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1f forged venue_id on a guest_tier is ignored');
reset role;

-- ---------------------------------------------------------------------------
-- S4a. Event repoint: organizer keeps event-scoped WITH CHECK access after a
-- forged venue_id, but the BEFORE trigger pins it back before that check
-- ever sees the new value — the row never actually moves.
-- ---------------------------------------------------------------------------

select pg_temp.login('44444444-4444-4444-8444-444444444444');
update public.events
   set venue_id = 'aa000000-0000-7000-8000-000000000002'
 where id = 'ee000000-0000-7000-8000-000000000001';
select is(
  (select venue_id from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S4a organizer cannot repoint events.venue_id to another venue');

-- ---------------------------------------------------------------------------
-- S4b. Regression: the pin trigger must not block legitimate field updates.
-- ---------------------------------------------------------------------------

update public.events
   set name = 'PLUSONE Launch Night (renamed)'
 where id = 'ee000000-0000-7000-8000-000000000001';
select is(
  (select name from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'PLUSONE Launch Night (renamed)',
  'S4b organizer can still update other event fields with the pin trigger active');
reset role;

select * from finish();

rollback;
