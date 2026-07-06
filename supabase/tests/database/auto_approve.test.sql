-- pgTAP — Requests-epic F1: auto-approve + link-max 45006 (86ey21vjt).
-- Run: supabase test db.
-- Proves: an auto-approve link turns a submission into an approved guest with a
-- SYSTEM actor (added_by NULL, decided_via='auto', audit actor NULL — #4/#15);
-- every guard (link max, list lock, duplicate-approved fingerprint) falls back
-- to a plain pending request with an identical 'ok' response (#28); link-max
-- counts approved HEADCOUNT sum(1+N) and 45006 rolls a manual approval back
-- atomically; attribution is immutable. Seed as in landing.test.sql. All rolls
-- back.

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

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

select plan(18);

-- Fixtures: an influencer + three links on the seed event (max 3 heads on the
-- auto link; one paused; one expired).
insert into public.influencers (id, venue_id, name, created_by) values
  ('1f000000-0000-7000-8000-00000000b001', 'aa000000-0000-7000-8000-000000000001',
   'Auto Nova', '11111111-1111-4111-8111-111111111111');
insert into public.request_links (id, event_id, influencer_id, label, slug, tier_id, max_headcount, auto_approve, active, expires_at) values
  ('2c000000-0000-7000-8000-00000000b001', 'ee000000-0000-7000-8000-000000000001',
   '1f000000-0000-7000-8000-00000000b001', null, 'auto-x',
   'dd000000-0000-7000-8000-000000000001', 3, true, true, null),
  ('2c000000-0000-7000-8000-00000000b002', 'ee000000-0000-7000-8000-000000000001',
   null, 'Paused', 'paused-x', null, null, false, false, null),
  ('2c000000-0000-7000-8000-00000000b003', 'ee000000-0000-7000-8000-000000000001',
   null, 'Expired', 'expired-x', null, null, false, true, now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- A. The happy path: submission → approved guest, system actor
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
create temp table r1 as
  select public.submit_guest_request('auto-x', 'AA Een', 'auto1@x.test', null,
    1, null, 'ip-aa-1', false, null, 'tok-aa-1') as r;
reset role;

select is((select r ->> 'status' from r1), 'ok',
  'A1 an auto-link submission reports plain ok');
select is((select r ->> 'auto_approved' from r1), 'true',
  'A2 …and signals auto_approved to the caller');
select is(
  (select status::text || ':' || decided_via::text || ':' || coalesce(decided_by::text, 'system')
   from public.guest_requests where full_name = 'AA Een'),
  'approved:auto:system',
  'A3 the request is decided by the SYSTEM (decided_via=auto, no human actor)');
select ok(
  (select added_by is null and source = 'landing' and status = 'approved'
      and tier_id = 'dd000000-0000-7000-8000-000000000001'
      and request_link_id = '2c000000-0000-7000-8000-00000000b001'
   from public.guests where full_name = 'AA Een'),
  'A4 the guest exists: pinned tier, attributed to the link, added_by NULL (system)');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'guest_requests' and action = 'approve' and actor_id is null),
  1, 'A5 the audit log records the approval with a NULL actor (= system, like the anonymize job)');

-- ---------------------------------------------------------------------------
-- B. Link max (45006): headcount sum(1+N), fallback to pending, atomic manual roll-back
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
create temp table r2 as
  select public.submit_guest_request('auto-x', 'AA Twee', 'auto2@x.test', null,
    0, null, 'ip-aa-2', false, null, 'tok-aa-2') as r;
create temp table r3 as
  select public.submit_guest_request('auto-x', 'AA Drie', 'auto3@x.test', null,
    0, null, 'ip-aa-3', false, null, 'tok-aa-3') as r;
reset role;

select is((select r ->> 'auto_approved' from r2), 'true',
  'B1 the link fills exactly to its max (2+1 = 3 of 3 heads)');
select is((select r ->> 'auto_approved' from r3), 'false',
  'B2 past the max the submission still reports ok but is NOT auto-approved');
select is(
  (select status::text from public.guest_requests where full_name = 'AA Drie'),
  'pending', 'B3 …it landed as a plain pending request for manual review');

select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- organizer
select throws_ok(
  $$ select public.approve_guest_request(
       (select id from public.guest_requests where full_name = 'AA Drie'),
       'dd000000-0000-7000-8000-000000000001') $$,
  '45006', null, 'B4 a manual approval past the link max raises 45006');
reset role;
select is(
  (select status::text from public.guest_requests where full_name = 'AA Drie'),
  'pending', 'B5 the 45006 approval rolled back atomically: request stays pending');

-- ---------------------------------------------------------------------------
-- C. Closed shapes: paused / expired are indistinguishable (#28)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  public.submit_guest_request('paused-x', 'AA Pauze', null, null, 0, null,
    'ip-aa-4', false) ->> 'status',
  'closed', 'C1 a paused link is closed');
select is(
  public.submit_guest_request('expired-x', 'AA Laat', null, null, 0, null,
    'ip-aa-5', false) ->> 'status',
  'closed', 'C2 an expired link is closed — same shape, no enumeration');
reset role;

-- ---------------------------------------------------------------------------
-- D. List lock: auto-adds would undermine the lock (#23) → fallback to pending
-- ---------------------------------------------------------------------------

update public.request_links set max_headcount = 99
  where id = '2c000000-0000-7000-8000-00000000b001';
update public.events
  set list_locked = true,
      locked_by = '11111111-1111-4111-8111-111111111111',
      locked_at = now()
  where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();
create temp table rl as
  select public.submit_guest_request('auto-x', 'AA Locked', 'lock@x.test', null,
    0, null, 'ip-aa-6', false, null, 'tok-aa-6') as r;
reset role;

select is((select r ->> 'auto_approved' from rl), 'false',
  'D1 a locked list blocks the auto-add (submission itself still ok)');
select is(
  (select status::text from public.guest_requests where full_name = 'AA Locked'),
  'pending', 'D2 …the request waits as pending');

update public.events set list_locked = false
  where id = 'ee000000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- E. Duplicate-approved guard: a decided fingerprint is never silently
--    approved twice (max is 99 and the list unlocked — the guard is the ONLY
--    thing standing between this resubmission and a second guest)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
create temp table rd as
  select public.submit_guest_request('auto-x', 'AA Een Dubbel', 'auto1@x.test', null,
    0, null, 'ip-aa-7', false, null, 'tok-aa-7') as r;
reset role;

select is((select r ->> 'auto_approved' from rd), 'false',
  'E1 a fingerprint that was already approved on this event is not auto-approved again');
select is(
  (select count(*)::int from public.guests where email = 'auto1@x.test'),
  1, 'E2 …so the person is on the list exactly once; the repeat waits for staff');

-- ---------------------------------------------------------------------------
-- F. The cap also binds later edits + attribution is immutable
-- ---------------------------------------------------------------------------

-- Pin the max to the current consumption (AA Een 2 + AA Twee 1 = 3 heads).
update public.request_links set max_headcount = 3
  where id = '2c000000-0000-7000-8000-00000000b001';

select throws_ok(
  $$ update public.guests set plus_ones = 2 where full_name = 'AA Een' $$,
  '45006', null, 'F1 bumping plus_ones on an attributed guest past the link max raises 45006');

select throws_ok(
  $$ update public.guests set request_link_id = null where full_name = 'AA Een' $$,
  '23514', null, 'F2 link attribution on a guest is immutable (no re-crediting)');

select * from finish();

rollback;
