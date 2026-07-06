-- pgTAP — Requests-epic F1: guest status tokens (/r/[token], 86ey21vjt).
-- Run: supabase test db.
-- Proves the token round-trip (pending → approved), the minimal no-PII payload,
-- silent-dedup token ROTATION (the caller always leaves with a working URL,
-- new-vs-duplicate indistinguishable #28), the throttle, and retention
-- revocation (anonymization nulls the hash → the saved URL goes generically
-- "niet gevonden"). Seed as in landing.test.sql. All rolls back.

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

select plan(12);

-- ---------------------------------------------------------------------------
-- A. Round-trip: pending → approved, minimal payload
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Status Tester', 'st1@x.test',
    null, 2, 'graag!', 'ip-st-1', false, null, 'tok-st-1') ->> 'status',
  'ok', 'A1 a submission carries the app-generated status-token hash');
select is(
  (select r ->> 'found' || ':' || (r ->> 'status')
   from public.get_request_status('tok-st-1', 'ip-st-a') r),
  'true:pending', 'A2 the token resolves to the pending request');
select ok(
  not (public.get_request_status('tok-st-1', 'ip-st-a')
       ?| array['email', 'phone', 'motivation', 'decision_reason']),
  'A3 the payload carries no contact data, motivation or decision reason');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin approves
select isnt(
  public.approve_guest_request(
    (select id from public.guest_requests where email = 'st1@x.test'),
    'dd000000-0000-7000-8000-000000000001'),
  null, 'A4 the request is approved');
select pg_temp.login_anon();
select is(
  public.get_request_status('tok-st-1', 'ip-st-b') ->> 'status',
  'approved', 'A5 the same URL now shows approved');
select is(
  public.get_request_status('tok-does-not-exist', 'ip-st-c') ->> 'found',
  'false', 'A6 an unknown token is a generic not-found (no enumeration)');
reset role;

-- ---------------------------------------------------------------------------
-- B. Silent dedup rotates the token
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Rotatie Tester', 'st2@x.test',
    null, 0, null, 'ip-st-2', false, null, 'tok-rot-a') ->> 'status',
  'ok', 'B1 first submission with token A');
select is(
  public.submit_guest_request('plusone-launch-night', 'Rotatie Tester Dubbel', 'st2@x.test',
    null, 0, null, 'ip-st-3', false, null, 'tok-rot-b') ->> 'status',
  'ok', 'B2 the duplicate still reports ok (silent dedup)');
select is(
  (select (public.get_request_status('tok-rot-b', 'ip-st-d') ->> 'found')
       || ':'
       || (public.get_request_status('tok-rot-a', 'ip-st-d') ->> 'found')),
  'true:false',
  'B3 the dedup rotated the token: the fresh URL works, the earlier one is dead');
reset role;

-- ---------------------------------------------------------------------------
-- C. Throttle: token probing burns budget
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
do $$
begin
  for i in 1..30 loop
    perform public.get_request_status('probe-' || i, 'ip-st-rl');
  end loop;
end $$;
select is(
  public.get_request_status('tok-st-1', 'ip-st-rl') ->> 'found',
  'false', 'C1 past the window even a VALID token reads not-found (probing costs budget)');
reset role;

-- ---------------------------------------------------------------------------
-- D. Retention revokes the token (#29)
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, ends_at)
values ('ee000000-0000-7000-8000-00000000d001', 'aa000000-0000-7000-8000-000000000001',
        'Old Token Event', now() - interval '14 months',
        now() - interval '14 months' + interval '6 hours');
insert into public.guest_requests (event_id, full_name, status_token_hash)
values ('ee000000-0000-7000-8000-00000000d001', 'Oude Aanvraag', 'tok-old');

select lives_ok($$ select * from public.run_privacy_retention() $$, 'D1 the retention job runs');

select pg_temp.login_anon();
select is(
  public.get_request_status('tok-old', 'ip-st-e') ->> 'found',
  'false', 'D2 anonymization nulled the hash: the saved status URL is generically dead');
reset role;

select * from finish();

rollback;
