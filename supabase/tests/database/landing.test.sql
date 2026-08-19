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

-- Calls submit_guest_request p_n times (distinct names AND contact details so
-- each is a real insert), returns the LAST status — used to exhaust the
-- rate-limit window. Since 86eyke279 every attempt must carry a usable e-mail
-- and phone, otherwise it is refused before it reaches the throttle at all.
create function pg_temp.submit_n(p_n int, p_ip text)
returns text language plpgsql as $fn$
declare r text; i int;
begin
  for i in 1..p_n loop
    r := public.submit_guest_request(
      'plusone-launch-night', 'RL ' || i,
      'rl' || i || '@x.test', '+3161100' || lpad(i::text, 4, '0'),
      0, null, p_ip, false) ->> 'status';
  end loop;
  return r;
end;
$fn$;

select plan(39);

-- ---------------------------------------------------------------------------
-- A. submit_guest_request — the hardened anon path (#12/#28) + marketing (8b)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Dup Tester', 'dup@x.test', '+31612000001', 0, null, 'ip-a', false) ->> 'status',
  'ok', 'A1 anon files a landing request → ok');
select is(
  public.submit_guest_request('plusone-launch-night', 'Dup Tester 2', 'dup@x.test', '+31612000002', 1, null, 'ip-a', false) ->> 'status',
  'ok', 'A2 a duplicate (same e-mail) is silently accepted (no leak, #28)');

reset role;
select is(
  (select count(*)::int from public.guest_requests where email = 'dup@x.test' and status = 'pending'),
  1, 'A3 the duplicate is de-duplicated: exactly one pending row');

select pg_temp.login_anon();
select is(
  public.submit_guest_request('this-slug-does-not-exist', 'Ghost Aanvrager', 'ghost@x.test', '+31612000004', 0, null, 'ip-a', false) ->> 'status',
  'closed', 'A4 unknown/closed slug → closed (unknown and inactive are identical: no enumeration)');
reset role;
select is(
  (select count(*)::int from public.guest_requests where full_name = 'Ghost Aanvrager'),
  0, 'A5 a closed submission inserts nothing');

select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'A', 'shortname@x.test', '+31612000006', 0, null, 'ip-a', false) ->> 'status',
  'invalid', 'A6 a too-short name is rejected server-side (contacts valid — this isolates the name rule)');

-- Rate limit: a fresh IP, window max = 5 (tightened in 20260625100000). The 5th
-- still passes, the 6th trips.
select is(pg_temp.submit_n(5, 'ip-rl'), 'ok', 'A7a five submissions within the window stay ok');
select is(
  public.submit_guest_request('plusone-launch-night', 'RL Over', 'rlover@x.test', '+31612000007', 0, null, 'ip-rl', false) ->> 'status',
  'rate_limited', 'A7b the 6th submission from the same IP is rate-limited');

-- Marketing opt-in (8b): the consent flag is persisted as given.
select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Marketing Janus', 'market@x.test', '+31612000008', 0, null, 'ip-mk', true) ->> 'status',
  'ok', 'A8 a submission with marketing consent → ok');
reset role;
select is(
  (select marketing_opt_in from public.guest_requests where email = 'market@x.test'),
  true, 'A9 the marketing opt-in is stored on the request (AVG)');

-- ---------------------------------------------------------------------------
-- A'. 86eyke279 — e-mail AND phone are mandatory on the public request path
-- ---------------------------------------------------------------------------
-- The client (submitGuestRequestSchema + the form) enforces the same rule, but
-- this RPC is granted to `anon`: a hand-rolled PostgREST call skips the client
-- entirely. These cases are the ones that must hold when it does.
--
-- Each uses its OWN ip hash: a refusal must be provable on its own merits, not
-- accidentally passing because a shared bucket ran out of throttle budget.

select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Geen Mail', null, '+31612100001', 0, null, 'ip-rq-1', false) ->> 'status',
  'invalid', 'A10 a request WITHOUT an e-mail is refused (null)');
select is(
  public.submit_guest_request('plusone-launch-night', 'Lege Mail', '', '+31612100002', 0, null, 'ip-rq-2', false) ->> 'status',
  'invalid', 'A11 an empty-string e-mail is refused');
select is(
  public.submit_guest_request('plusone-launch-night', 'Spatie Mail', '   ', '+31612100003', 0, null, 'ip-rq-3', false) ->> 'status',
  'invalid', 'A12 a whitespace-only e-mail is refused (spaces are not a value)');
select is(
  public.submit_guest_request('plusone-launch-night', 'Tab Mail', E'\t\n', '+31612100004', 0, null, 'ip-rq-4', false) ->> 'status',
  'invalid', 'A13 a tab/newline-only e-mail is refused (btrim(x) alone would have let this through)');
select is(
  public.submit_guest_request('plusone-launch-night', 'Junk Mail', 'x', '+31612100005', 0, null, 'ip-rq-5', false) ->> 'status',
  'invalid', 'A14 a present-but-unusable e-mail is refused — the rule is a reachable channel, not a filled box');

select is(
  public.submit_guest_request('plusone-launch-night', 'Geen Tel', 'tel0@x.test', null, 0, null, 'ip-rq-6', false) ->> 'status',
  'invalid', 'A15 a request WITHOUT a phone is refused (null)');
select is(
  public.submit_guest_request('plusone-launch-night', 'Lege Tel', 'tel1@x.test', '', 0, null, 'ip-rq-7', false) ->> 'status',
  'invalid', 'A16 an empty-string phone is refused');
select is(
  public.submit_guest_request('plusone-launch-night', 'Spatie Tel', 'tel2@x.test', '   ', 0, null, 'ip-rq-8', false) ->> 'status',
  'invalid', 'A17 a whitespace-only phone is refused');
select is(
  public.submit_guest_request('plusone-launch-night', 'Tab Tel', 'tel3@x.test', E'\t', 0, null, 'ip-rq-9', false) ->> 'status',
  'invalid', 'A18 a tab-only phone is refused');
select is(
  public.submit_guest_request('plusone-launch-night', 'Nationaal Tel', 'tel4@x.test', '0612345678', 0, null, 'ip-rq-10', false) ->> 'status',
  'invalid', 'A19 a national number without a country code is refused (unreachable from the door)');

select is(
  public.submit_guest_request('plusone-launch-night', 'Niks Erbij', '', '', 0, null, 'ip-rq-11', false) ->> 'status',
  'invalid', 'A20 a name-only request is refused');

-- The positive control: the SAME shape, now complete, is accepted — so A10-A20
-- prove the guard, not some unrelated breakage of the whole RPC.
select is(
  public.submit_guest_request('plusone-launch-night', 'Compleet Persoon', 'compleet@x.test', '+31612100099', 0, null, 'ip-rq-12', false) ->> 'status',
  'ok', 'A21 the same request WITH both e-mail and phone is accepted');

reset role;
select is(
  (select count(*)::int from public.guest_requests
   where full_name in ('Geen Mail','Lege Mail','Spatie Mail','Tab Mail','Junk Mail',
                       'Geen Tel','Lege Tel','Spatie Tel','Tab Tel','Nationaal Tel','Niks Erbij')),
  0, 'A22 not one refused request reached the table — refusal, not a silent partial insert');
select is(
  (select count(*)::int from public.guest_requests where email = 'compleet@x.test'),
  1, 'A23 the complete request DID land');
-- The address book must not be polluted by refused submissions either (#8).
select is(
  (select count(*)::int from public.contacts
   where venue_id = 'aa000000-0000-7000-8000-000000000001'
     and email_norm in ('tel0@x.test','tel1@x.test','tel2@x.test','tel3@x.test','tel4@x.test')),
  0, 'A24 a refused request captures no contact into the address book');

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

-- ---------------------------------------------------------------------------
-- D. Re-approve a denied request (#12 — "die persoon mag soms toch gewoon gaan")
-- ---------------------------------------------------------------------------
-- Kevin (bb..03) was denied in the seed. An organizer may still add him after
-- all: approve_guest_request now accepts a denied request (only an already-
-- approved one is "done"), creating the guest and clearing the denial reason.

reset role;
select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer
select isnt(
  public.approve_guest_request(
    'bb000000-0000-7000-8000-000000000003',     -- Kevin (denied in seed)
    'dd000000-0000-7000-8000-000000000001'),    -- Regular tier
  null, 'D1 a denied request can be re-approved → returns the new guest id');

reset role;
select is(
  (select count(*)::int from public.guests
   where full_name = 'Kevin de Lange' and source = 'landing' and status = 'approved'),
  1, 'D2 re-approval creates the landing guest after all');
select is(
  (select status::text || coalesce(':' || decision_reason, ':null')
   from public.guest_requests where id = 'bb000000-0000-7000-8000-000000000003'),
  'approved:null', 'D3 the request flips to approved and the denial reason is cleared');

reset role;

select * from finish();

rollback;
