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

select plan(91);

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

-- v_email has an explicit char_length cap (matching Zod's `.max(254)`) — unlike
-- phone, the shape regex alone puts no upper bound on it, and this is an anon
-- write path. Below the cap, still accepted; at 255 it must be refused as
-- cleanly as any other unusable value, not merely "eventually rejected by a
-- storage limit" (an oversized-but-compressible value can slip under Postgres's
-- btree row-size ceiling and land anyway; an incompressible one can escape the
-- function entirely with a raw 54000 error — the cap must catch both before
-- either happens).
select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Lengte Op De Grens',
    repeat('a', 247) || '@x.test',  -- 254 chars total, exactly at the cap
    '+31612100013', 0, null, 'ip-rq-13', false) ->> 'status',
  'ok', 'A25 an e-mail exactly at the 254-char cap is accepted');
select is(
  public.submit_guest_request('plusone-launch-night', 'Lengte Over De Grens',
    repeat('a', 248) || '@x.test',  -- 255 chars total, one over the cap
    '+31612100014', 0, null, 'ip-rq-14', false) ->> 'status',
  'invalid', 'A26 an e-mail one char over the 254-char cap is refused');
reset role;
select is(
  (select count(*)::int from public.guest_requests where full_name = 'Lengte Over De Grens'),
  0, 'A27 the over-cap e-mail landed no row (refused before the insert, not by a storage limit)');

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

-- ---------------------------------------------------------------------------
-- E. submit_guest_request — `auto_approved` is not an enumeration oracle
--    (z8uq9m0gvy, follow-up from the PR #276 review)
-- ---------------------------------------------------------------------------
--
-- submit_guest_request is SECURITY DEFINER and granted to `anon`, so every call
-- below is one an attacker can make straight off the public key plus a link
-- slug. `p_ip_hash` is an ARGUMENT, so a direct PostgREST caller picks its own
-- throttle bucket: there is no effective rate limit on probing.
--
-- Before the fix, on an auto-approve link with an unlocked list the answer was
-- `false` EXACTLY when the submitted e-mail already held an approved request on
-- that event — a reliable yes/no to "is this named person on the list for this
-- event?", which the CLAUDE.md checklist forbids outright ("public endpoints
-- ... never reveal whether a guest/e-mail exists") and which is AVG-relevant.
--
-- Jayden's seed link (2c..01, slug launch-night-jayden) is the auto-approve one:
-- tier Regular, max_headcount 25, and event ee..01 has no capacity cap. E1's
-- `true` is therefore a genuine approval with real headroom — not a vacuous
-- pass from a link that is simply full, which is the way this whole section
-- could otherwise go green for the wrong reason.
--
-- This section runs LAST on purpose: it auto-approves guests, which would
-- otherwise perturb C2's audit-row count and section B's tier-max arithmetic.

select pg_temp.login_anon();
select is(
  public.submit_guest_request('launch-night-jayden', 'Oracle Victim',
    'oracle-victim@x.test', '+31612200001', 0, null, 'ip-orc-1', false) ->> 'auto_approved',
  'true', 'E1 a fresh submission on an auto-approve link IS auto-approved (the baseline the probes are read against)');

-- The oracle itself: the same e-mail, re-submitted by someone who is not its
-- owner. This used to answer `false`.
select is(
  public.submit_guest_request('launch-night-jayden', 'Probing Attacker',
    'oracle-victim@x.test', '+31612200002', 0, null, 'ip-orc-2', false) ->> 'auto_approved',
  'true', 'E2 re-submitting an ALREADY-APPROVED e-mail answers the same as a fresh one (was false — the oracle)');
select is(
  public.submit_guest_request('launch-night-jayden', 'Probing Attacker',
    'oracle-stranger@x.test', '+31612200003', 0, null, 'ip-orc-3', false) ->> 'auto_approved',
  'true', 'E3 probing an e-mail the event has never seen answers identically — E2 and E3 are indistinguishable');

-- A SECOND probe of the same address takes the silent-dedup path instead (E2
-- left a pending row, so this insert trips the partial unique index and
-- v_request_id comes back NULL). Fixing only E2 would move the oracle one probe
-- later rather than close it: probe any e-mail twice and the second call would
-- answer `false` for a known address and `true` for an unknown one.
select is(
  public.submit_guest_request('launch-night-jayden', 'Probing Attacker',
    'oracle-victim@x.test', '+31612200004', 0, null, 'ip-orc-4', false) ->> 'auto_approved',
  'true', 'E4 a SECOND probe (silent-dedup path) answers the same — the oracle does not just move one probe later');
select is(
  public.submit_guest_request('launch-night-jayden', 'Probing Attacker',
    'oracle-stranger@x.test', '+31612200005', 0, null, 'ip-orc-5', false) ->> 'auto_approved',
  'true', 'E5 ...and so does the second probe of the unknown address — all four probes agree');

-- The reported bit changed; the BEHAVIOUR deliberately did not. A re-submit
-- still lands as a NEW pending row for staff to judge manually, and the person
-- is still never auto-approved a second time.
reset role;
select is(
  (select count(*)::int from public.guest_requests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and dedupe_key = 'oracle-victim@x.test' and status = 'pending'),
  1, 'E6 the repeat submission still leaves a NEW pending row for staff (unchanged, deliberate)');
select is(
  (select count(*)::int from public.guests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and email = 'oracle-victim@x.test' and status <> 'removed'),
  1, 'E7 ...and still creates no second guest row — `true` reports standing, it does not re-approve');

-- The denied half (DoD #3): a LOCKED list takes no automatic additions (#23),
-- and it has to say so to every e-mail alike. If the standing answer leaked
-- past the lock gate, an approved address would answer `true` here while a
-- stranger answered `false` — trading one oracle for another.
update public.events
  set list_locked = true,
      locked_by = '11111111-1111-4111-8111-111111111111',
      locked_at = now()
  where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login_anon();
select is(
  public.submit_guest_request('launch-night-jayden', 'Oracle Victim',
    'oracle-victim@x.test', '+31612200006', 0, null, 'ip-orc-6', false) ->> 'auto_approved',
  'false', 'E8 on a LOCKED list an already-approved e-mail is NOT auto-approved (#23)');
select is(
  public.submit_guest_request('launch-night-jayden', 'Probing Attacker',
    'oracle-unseen@x.test', '+31612200007', 0, null, 'ip-orc-7', false) ->> 'auto_approved',
  'false', 'E9 ...and a never-seen e-mail answers the same — lock state stays a property of the event, not of the e-mail');

reset role;

-- ---------------------------------------------------------------------------
-- F. submit_guest_request — the silent dedup does not hand out somebody
--    else's status token (z8uq9m0h2v)
-- ---------------------------------------------------------------------------
-- Before 20260918140000 the dedup branch rotated the EXISTING row's
-- `status_token_hash` to the value the CALLER passed in. An anonymous caller
-- who guessed an e-mail address could therefore point a token they chose at a
-- stranger's pending request, read that stranger's name and plus-ones back out
-- of `get_request_status`, and kill the stranger's own status URL in the same
-- call — one unauthenticated request, one existence oracle, one PII
-- disclosure, one denial of service.
--
-- Both directions are asserted here, and on DATABASE STATE rather than on an
-- `ok` (the whole bug lived in a row the response never mentions): the
-- victim's row keeps its own token and its own identity (F5/F6), and the
-- attacker's chosen token reads back the attacker's OWN submission (F9/F10).
--
-- F11 is the constraint the fix had to respect while doing that: the deduped
-- caller's payload stays byte-identical to a fresh submission's, so closing
-- the hijack does not install an enumeration oracle in its place.

-- E8 left the list locked; the dedup path is not lock-gated, but an unlocked
-- event keeps this section independent of what ran before it.
update public.events
  set list_locked = false, locked_by = null, locked_at = null
  where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();

select is(
  public.submit_guest_request('plusone-launch-night', 'Hijack Victim',
    'hijack-victim@x.test', '+31612300001', 3, 'graag', 'ip-hj-1', false,
    null, 'tok-hj-victim') ->> 'status',
  'ok', 'F1 the victim files a request through a manual-review link');
reset role;

select is(
  (select gr.status_token_hash from public.guest_requests gr
    where gr.event_id = 'ee000000-0000-7000-8000-000000000001'
      and gr.email = 'hijack-victim@x.test' and gr.status = 'pending'),
  'tok-hj-victim', 'F2 the row carries the victim''s own token hash');

-- The attack: the victim's e-mail, an attacker-chosen token hash.
select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Hijack Attacker',
    'hijack-victim@x.test', '+31612399999', 0, 'x', 'ip-hj-2', false,
    null, 'tok-hj-attacker') ->> 'status',
  'ok', 'F3 the attacker''s deduped submission still reports a plain ok (#28)');
reset role;

select is(
  (select count(*)::int from public.guest_requests gr
    where gr.event_id = 'ee000000-0000-7000-8000-000000000001'
      and gr.email = 'hijack-victim@x.test'),
  1, 'F4 ...and still produced no second row — the silent dedup is intact');

select is(
  (select gr.status_token_hash from public.guest_requests gr
    where gr.event_id = 'ee000000-0000-7000-8000-000000000001'
      and gr.email = 'hijack-victim@x.test' and gr.status = 'pending'),
  'tok-hj-victim',
  'F5 the victim''s row STILL holds the victim''s token — the attacker''s hash was not written onto it');

select is(
  (select gr.full_name || '|' || gr.plus_ones::text from public.guest_requests gr
    where gr.event_id = 'ee000000-0000-7000-8000-000000000001'
      and gr.email = 'hijack-victim@x.test' and gr.status = 'pending'),
  'Hijack Victim|3',
  'F6 ...and the victim''s identity on it is untouched (no overwrite-instead-of-rotate)');

select pg_temp.login_anon();
select is(
  public.get_request_status('tok-hj-victim', 'ip-hj-r') ->> 'found',
  'true', 'F7 the victim''s own status URL still resolves (the DoS is closed)');

select is(
  public.get_request_status('tok-hj-victim', 'ip-hj-r') ->> 'full_name',
  'Hijack Victim', 'F8 ...and still shows the victim their own request');

select is(
  public.get_request_status('tok-hj-attacker', 'ip-hj-r') ->> 'full_name',
  'Hijack Attacker',
  'F9 the attacker''s chosen token reads back the ATTACKER''s name, never the victim''s');

select is(
  public.get_request_status('tok-hj-attacker', 'ip-hj-r') ->> 'plus_ones',
  '0',
  'F10 ...and the attacker''s own plus-ones, not the victim''s 3 (no headcount disclosure either)');

-- The constraint the fix had to respect: a deduped caller must not be able to
-- tell they were deduped. Same name, same plus-ones, same link — only the
-- e-mail differs, and that one has never been seen before, so this submission
-- takes the fresh-insert path.
select is(
  public.submit_guest_request('plusone-launch-night', 'Hijack Attacker',
    'hijack-control@x.test', '+31612399998', 0, 'x', 'ip-hj-3', false,
    null, 'tok-hj-control') ->> 'status',
  'ok', 'F11a the same payload against an unseen e-mail takes the fresh path');

select is(
  public.get_request_status('tok-hj-attacker', 'ip-hj-r'),
  public.get_request_status('tok-hj-control', 'ip-hj-r'),
  'F11b deduped and fresh return an IDENTICAL status payload — the hijack fix opens no enumeration oracle in its place');

reset role;

-- The mirror itself: one row, holding what the attacker submitted, hanging off
-- the victim's request. Bounded by the primary key — a prober cannot grow this
-- table past one row per pending request.
select is(
  (select m.full_name || '|' || m.plus_ones::text
     from public.guest_request_status_mirrors m
     join public.guest_requests gr on gr.id = m.request_id
    where gr.email = 'hijack-victim@x.test'),
  'Hijack Attacker|0',
  'F12 the mirror stores the ATTACKER''s own submission against the victim''s request id');

select ok(
  not has_table_privilege('anon', 'public.guest_request_status_mirrors', 'SELECT')
  and not has_table_privilege('anon', 'public.guest_request_status_mirrors', 'INSERT')
  and not has_table_privilege('anon', 'public.guest_request_status_mirrors', 'UPDATE')
  and not has_table_privilege('anon', 'public.guest_request_status_mirrors', 'DELETE'),
  'F13 anon holds no privilege on the mirror table — it is reachable only through the two SECURITY DEFINER RPCs');

select ok(
  not has_table_privilege('authenticated', 'public.guest_request_status_mirrors', 'SELECT')
  and not has_table_privilege('authenticated', 'public.guest_request_status_mirrors', 'INSERT')
  and not has_table_privilege('authenticated', 'public.guest_request_status_mirrors', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.guest_request_status_mirrors', 'DELETE'),
  'F14 ...and neither does authenticated — staff read the request, never the mirror');

select ok(
  (select c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'guest_request_status_mirrors'),
  'F15 RLS is enabled on the mirror table (defence in depth under the empty grant set)');

-- Denial proved at the BEHAVIOUR level, not just from the catalog: F13/F14 read
-- has_table_privilege, which is the grant layer. These two run the query.
select pg_temp.login_anon();
select throws_ok(
  $$ select full_name from public.guest_request_status_mirrors $$,
  '42501', null,
  'F16 an anon caller selecting the mirror table directly is refused (42501)');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- venue admin
select throws_ok(
  $$ select full_name from public.guest_request_status_mirrors $$,
  '42501', null,
  'F17 ...and so is a venue ADMIN — staff read the request, the mirror is RPC-only');
reset role;

-- A SECOND probe of the same e-mail with a DIFFERENT chosen token. The mirror is
-- keyed by request_id, so this overwrites rather than accumulating: the growth
-- bound is one row per pending request, however many times it is probed.
select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Second Prober',
    'hijack-victim@x.test', '+31612399997', 1, 'x', 'ip-hj-4', false,
    null, 'tok-hj-attacker-2') ->> 'status',
  'ok', 'F18 a second probe of the same e-mail also reports a plain ok');
select is(
  public.get_request_status('tok-hj-attacker-2', 'ip-hj-r2') ->> 'full_name',
  'Second Prober',
  'F19 ...and its token answers with the SECOND prober''s own name — still never the victim''s');
select is(
  public.get_request_status('tok-hj-attacker', 'ip-hj-r2') ->> 'found',
  'false',
  'F20 ...while the first prober''s token is the one that dies (last writer wins on the single mirror slot)');
reset role;

select is(
  (select count(*)::int from public.guest_request_status_mirrors m
     join public.guest_requests gr on gr.id = m.request_id
    where gr.email = 'hijack-victim@x.test'),
  1,
  'F21 exactly ONE mirror row survives for the victim''s request — probing cannot grow the table');

select is(
  (select gr.status_token_hash from public.guest_requests gr
    where gr.event_id = 'ee000000-0000-7000-8000-000000000001'
      and gr.email = 'hijack-victim@x.test' and gr.status = 'pending'),
  'tok-hj-victim',
  'F22 and after two probes the victim''s row STILL holds the victim''s own token');

-- ---------------------------------------------------------------------------
-- G. The two blockers from the PR #300 security review (z8uq9m0h2v)
-- ---------------------------------------------------------------------------
-- G1–G3  F-1: an oversized p_status_token_hash used to raise 54000 naming a
--        DIFFERENT index per path, which PostgREST forwards verbatim — a
--        one-call "is this e-mail taken?" oracle. The hash is now capped with
--        the other argument-only guards, so neither path can reach the ceiling.
-- G4–G7  F-2: retention leaves an anonymized request `pending` with its
--        dedupe_key, so later submissions kept landing on the dedup branch and
--        mirroring a fresh caller's real name onto a row no sweep would revisit.
-- G8–G11 F-3: the three regimes the migration header now scopes its
--        indistinguishability claim to, pinned so a future change cannot flip
--        them silently.

-- The probe payload MUST be incompressible: repeat('A', 5000) never reaches the
-- btree ceiling because pglz squashes it inside the index tuple, so a test
-- built on a repeated character passes whether or not the guard exists.
create function pg_temp.big_hash(p_len int)
returns text language sql as $fn$
  select substr(string_agg(md5(random()::text || clock_timestamp()::text), ''), 1, p_len)
  from generate_series(1, (p_len / 32) + 2);
$fn$;

select is(char_length(pg_temp.big_hash(2700)), 2700, 'G0 the probe builder returns an incompressible hash of the asked-for length');

select pg_temp.login_anon();

-- hijack-victim@x.test already holds a pending request from section F, so this
-- is the DEDUP path; hijack-g-fresh@x.test has never been seen — the FRESH one.
select is(
  public.submit_guest_request('plusone-launch-night', 'G Prober',
    'hijack-victim@x.test', '+31612388001', 0, null, 'ip-g-1', false,
    null, pg_temp.big_hash(2700)) ->> 'status',
  'invalid',
  'G1 an over-long status-token hash is refused on the DEDUP path, not raised');

select is(
  public.submit_guest_request('plusone-launch-night', 'G Prober',
    'hijack-g-fresh@x.test', '+31612388002', 0, null, 'ip-g-2', false,
    null, pg_temp.big_hash(2700)) ->> 'status',
  'invalid',
  'G2 ...and on the FRESH path');

select is(
  public.submit_guest_request('plusone-launch-night', 'G Prober',
    'hijack-victim@x.test', '+31612388003', 0, null, 'ip-g-3', false,
    null, pg_temp.big_hash(2700)),
  public.submit_guest_request('plusone-launch-night', 'G Prober',
    'hijack-g-fresh@x.test', '+31612388004', 0, null, 'ip-g-4', false,
    null, pg_temp.big_hash(2700)),
  'G3 ...and the two answers are IDENTICAL — no index name, no branch, nothing to compare');

reset role;

select is(
  (select count(*)::int from public.guest_requests
    where email = 'hijack-g-fresh@x.test'),
  0, 'G4 an over-long hash writes nothing at all (refused above the throttle, before any row)');

-- F-2: an event past the venue's retention window whose landing link was never
-- switched off — request_link_open() has no date check, so this is the default.
insert into public.events (id, venue_id, name, starts_at, ends_at, landing_active)
values ('ee000000-0000-7000-8000-00000000f201', 'aa000000-0000-7000-8000-000000000001',
        'G Old Event', now() - interval '14 months', now() - interval '14 months' + interval '6 hours', true);
insert into public.request_links (id, event_id, venue_id, label, slug, auto_approve, active)
values ('11100000-0000-7000-8000-00000000f201', 'ee000000-0000-7000-8000-00000000f201',
        'aa000000-0000-7000-8000-000000000001', 'G link', 'g-old-link', false, true);

select pg_temp.login_anon();
select is(
  public.submit_guest_request('g-old-link', 'G Old Victim', 'g-old@x.test',
    '+31612388005', 0, null, 'ip-g-5', false, null, 'tok-g-old-victim') ->> 'status',
  'ok', 'G5 someone files a request on that old event');
reset role;

select lives_ok($$ select * from public.run_privacy_retention() $$,
  'G6 the first retention run anonymizes it');

select is(
  (select gr.status::text || '|' || (gr.anonymized_at is not null)::text || '|' || coalesce(gr.dedupe_key, '(null)')
     from public.guest_requests gr where gr.event_id = 'ee000000-0000-7000-8000-00000000f201'),
  'pending|true|g-old@x.test',
  'G7 ...and leaves it PENDING with its dedupe_key — which is why later submissions still dedup against it');

-- The late probe: before the fix this wrote a mirror carrying this caller's real
-- name against a request no later sweep would ever look at again.
select pg_temp.login_anon();
select is(
  public.submit_guest_request('g-old-link', 'G Late Caller', 'g-old@x.test',
    '+31612388006', 3, null, 'ip-g-6', false, null, 'tok-g-late') ->> 'status',
  'ok', 'G8 a late submission on the same e-mail still reports a plain ok');
select is(
  public.get_request_status('tok-g-late', 'ip-g-r') ->> 'found',
  'false',
  'G9 ...its token does not resolve — unchanged by the fix, an anonymized request is refused either way');
reset role;

select is(
  (select count(*)::int from public.guest_request_status_mirrors m
     join public.guest_requests gr on gr.id = m.request_id
    where gr.event_id = 'ee000000-0000-7000-8000-00000000f201'),
  0,
  'G10 and NO mirror was written onto the anonymized request — the late caller''s name is not parked in the table');

-- The self-healing half: an orphan written by an older build is swept even
-- though no request is anonymized on this run.
-- `on conflict` on purpose: G13 must pin the SWEEP half on its own, whether or
-- not the write half (G10) is in place. Without it, a build that still mirrors
-- onto anonymized requests already occupies this request_id, the plain insert
-- trips the primary key, and the abort hides whether the sweep works at all.
insert into public.guest_request_status_mirrors (request_id, token_hash, full_name, plus_ones)
select gr.id, 'tok-g-orphan', 'G Orphan Name', 2
  from public.guest_requests gr where gr.event_id = 'ee000000-0000-7000-8000-00000000f201'
on conflict (request_id) do update
  set token_hash = excluded.token_hash, full_name = excluded.full_name, plus_ones = excluded.plus_ones;
select is(
  (select count(*)::int from public.guest_request_status_mirrors where token_hash = 'tok-g-orphan'),
  1, 'G11 an orphan mirror planted on an already-anonymized request exists');

select lives_ok($$ select * from public.run_privacy_retention() $$,
  'G12 a later retention run — which anonymizes nothing new — still runs');

select is(
  (select count(*)::int from public.guest_request_status_mirrors where token_hash = 'tok-g-orphan'),
  0,
  'G13 ...and sweeps the orphan anyway: the delete drives off anonymized_at, not that run''s id list');

-- F-3: pin the three regimes the header now scopes its claim to. The auto-approve
-- split is documented and inherited (20260918100000), not introduced here — but
-- nothing pinned it, so a future change could flip it in either direction.
update public.events
  set list_locked = false, locked_by = null, locked_at = null, capacity = null
  where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();
select is(
  public.submit_guest_request('launch-night-jayden', 'G Auto Probe',
    'hijack-victim@x.test', '+31612388007', 0, null, 'ip-g-7', false, null, 'tok-g-auto-dedup') ->> 'auto_approved',
  'false',
  'G14 auto-approve link BELOW capacity: a deduped probe answers false (documented residual, inherited)');
select is(
  public.submit_guest_request('launch-night-jayden', 'G Auto Probe',
    'g-auto-fresh@x.test', '+31612388008', 0, null, 'ip-g-8', false, null, 'tok-g-auto-fresh') ->> 'auto_approved',
  'true',
  'G15 ...where a fresh one answers true — this is the split the header must NOT claim away');
select is(
  (public.get_request_status('tok-g-auto-dedup', 'ip-g-r2') ->> 'status') || '/' ||
  (public.get_request_status('tok-g-auto-fresh', 'ip-g-r2') ->> 'status'),
  'pending/approved',
  'G16 ...and it reaches the status payload too, which is exactly why the claim is scoped to manual-review links');
reset role;

select * from finish();

rollback;
