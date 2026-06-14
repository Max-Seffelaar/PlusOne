-- pgTAP — Fase 8: public aanvraagflow (run: supabase test db)
-- Proves submit_guest_request (rate limit + silent dedup + no enumeration) and
-- approve_guest_request (atomic guest-create + tier-max #31 + permissions), plus
-- the audit trail on request decisions. Relies on the seed: event ee..01 (open,
-- landing_active) with tiers dd..01 (Regular) / dd..02 (VIP); landing requests
-- bb..01 (Robin, pending) / bb..02 (Sofia, pending) / bb..03 (Kevin, denied);
-- Yusuf 44.. = organizer, Tom 55.. = staff, Max 11.. = admin. All rolls back.

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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- Calls submit_guest_request p_n times (distinct names so each is a real
-- insert), returns the LAST status — used to exhaust the rate-limit window.
create function pg_temp.submit_n(p_n int, p_ip text)
returns text language plpgsql as $fn$
declare r text; i int;
begin
  for i in 1..p_n loop
    r := public.submit_guest_request(
      'plusone-launch-night', 'RL ' || i, null, null, 0, null, p_ip);
  end loop;
  return r;
end;
$fn$;

select plan(19);

-- ---------------------------------------------------------------------------
-- A. submit_guest_request — the hardened anon path (#12/#28)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Dup Tester', 'dup@x.test', null, 0, null, 'ip-a'),
  'ok', 'A1 anon files a landing request → ok');
select is(
  public.submit_guest_request('plusone-launch-night', 'Dup Tester 2', 'dup@x.test', null, 1, null, 'ip-a'),
  'ok', 'A2 a duplicate (same e-mail) is silently accepted (no leak, #28)');

reset role;
select is(
  (select count(*)::int from public.guest_requests where email = 'dup@x.test' and status = 'pending'),
  1, 'A3 the duplicate is de-duplicated: exactly one pending row');

select pg_temp.login_anon();
select is(
  public.submit_guest_request('this-slug-does-not-exist', 'Ghost Aanvrager', null, null, 0, null, 'ip-a'),
  'closed', 'A4 unknown/closed slug → closed (unknown and inactive are identical: no enumeration)');
reset role;
select is(
  (select count(*)::int from public.guest_requests where full_name = 'Ghost Aanvrager'),
  0, 'A5 a closed submission inserts nothing');

select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'A', null, null, 0, null, 'ip-a'),
  'invalid', 'A6 a too-short name is rejected server-side');

-- Rate limit: a fresh IP, window max = 10. The 10th still passes, the 11th trips.
select is(pg_temp.submit_n(10, 'ip-rl'), 'ok', 'A7a ten submissions within the window stay ok');
select is(
  public.submit_guest_request('plusone-launch-night', 'RL Over', null, null, 0, null, 'ip-rl'),
  'rate_limited', 'A7b the 11th submission from the same IP is rate-limited');
reset role;

-- ---------------------------------------------------------------------------
-- B. approve_guest_request — atomic create + tier-max + permissions (#12/#31)
-- ---------------------------------------------------------------------------

select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer
select isnt(
  public.approve_guest_request(
    'bb000000-0000-7000-8000-000000000001',     -- Robin (pending)
    'dd000000-0000-7000-8000-000000000001'),    -- Regular tier
  null, 'B1 organizer approves a landing request → returns the new guest id');

reset role;
select is(
  (select count(*)::int from public.guests
   where full_name = 'Robin Castelijns' and source = 'landing' and status = 'approved'
     and added_by = '44444444-4444-4444-8444-444444444444'),
  1, 'B2 a landing guest is created, attributed to the approver (source=landing, #31)');
select is(
  (select status::text from public.guest_requests where id = 'bb000000-0000-7000-8000-000000000001'),
  'approved', 'B3 the request is flipped to approved');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ select public.approve_guest_request(
       'bb000000-0000-7000-8000-000000000001',
       'dd000000-0000-7000-8000-000000000001') $$,
  '45003', null, 'B4 an already-handled request cannot be approved again');

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff
select throws_ok(
  $$ select public.approve_guest_request(
       'bb000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001') $$,
  '42501', null, 'B5 staff cannot approve a landing request (role matrix §2)');

-- Tier-max (#31 "wel binnen tier-max"): fill a max_guests=1 tier, then approve a
-- landing request into it — the AFTER trigger must reject it (45002).
reset role;
insert into public.guest_tiers (id, event_id, name, max_guests)
  values ('dd000000-0000-7000-8000-000000000099',
          'ee000000-0000-7000-8000-000000000001', 'Tiny', 1);
insert into public.guests (event_id, tier_id, full_name, added_by, source, status)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000099', 'Tier Filler',
          '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ select public.approve_guest_request(
       'bb000000-0000-7000-8000-000000000002',     -- Sofia (pending)
       'dd000000-0000-7000-8000-000000000099') $$,  -- the full tier
  '45002', null, 'B6 a landing approval still respects tier-max (#31)');
reset role;
select is(
  (select status::text from public.guest_requests where id = 'bb000000-0000-7000-8000-000000000002'),
  'pending', 'B7 the tier-full approval rolled back atomically: request stays pending');

-- ---------------------------------------------------------------------------
-- C. audit — decisions land in the log (#4/#15)
-- ---------------------------------------------------------------------------

-- Deny Sofia with a reason (mirrors denyGuestRequest under RLS).
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                      set status = 'denied',
                          decided_by = '44444444-4444-4444-8444-444444444444',
                          decided_at = now(),
                          decision_reason = 'Lijst zit vol'
                      where id = 'bb000000-0000-7000-8000-000000000002' and status = 'pending' $$),
  1, 'C1 organizer denies a request with a reason');

reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');  -- admin reads the log
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'guest_requests' and action = 'approve'),
  1, 'C2 the approval is recorded in the audit log');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'guest_requests' and action = 'deny'),
  1, 'C3 the denial is recorded in the audit log');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'guests' and action = 'create'
     and actor_id = '44444444-4444-4444-8444-444444444444'),
  1, 'C4 the approved guest-create is audited as the approver');

reset role;

select * from finish();

rollback;
