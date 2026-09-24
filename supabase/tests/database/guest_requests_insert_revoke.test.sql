-- pgTAP — a landing request is created by submit_guest_request and by nothing
-- else (F-3, migration 20260924100000; run: supabase test db).
--
-- Before that migration `authenticated` held a table-wide INSERT grant and
-- guest_requests_insert_public pinned only status='pending' + a landing-active
-- event, so ANY logged-in user — including staff, a role with no decide rights
-- and no SELECT on the table — could POST straight to /rest/v1/guest_requests
-- for their own venue's event and:
--
--   * SUPPRESS a real applicant silently. A planted row with anonymized_at set
--     and the victim's e-mail as dedupe_key is invisible in the approvals inbox
--     (which filters anonymized_at is null) yet still occupies
--     guest_requests_dedupe_idx, so the victim's submission trips the dedup
--     branch: the RPC answers {"status":"ok"}, nothing is stored, and
--     /r/[token] answers {"found": false}.
--   * READ whether a given e-mail applied. `on conflict do nothing` returns 0
--     rows for a taken address and 1 for a free one (a plain insert raises
--     23505) — the exact fact guest_requests_select exists to withhold.
--   * SKIP every guard that lives in the RPC rather than the table: throttle,
--     honeypot, name/e-mail format, motivation truncation, one row at a time.
--
-- Proves, in that order: the grant/policy layer; each attack refused for every
-- role; and that the paths that must keep working still do — anon submit incl.
-- silent dedup, auto-approve, approve_guest_request, the client deny, the
-- retention job, the seed's privilege level and service_role (the perf
-- scripts).
--
-- Seed as in landing.test.sql: venue1 aa..01 with event ee..01 (landing_active,
-- open) and tier dd..01; Max 11.. = admin, Noor 22.. = user_manager, Yusuf
-- 44.. = organizer of ee..01, Tom 55.. = staff, Lisa 66.. = doorhost+staff.
-- Everything rolls back.

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

select plan(29);

-- A request link on the seed event: submit_guest_request resolves a LINK slug,
-- not the event's landing slug, so every anon call below needs one.
insert into public.request_links (id, event_id, label, slug, tier_id, auto_approve, active)
values
  ('2c000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-000000000001',
   'F3 handmatig', 'f3-manual', 'dd000000-0000-7000-8000-000000000001', false, true),
  ('2c000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-000000000001',
   'F3 auto', 'f3-auto', 'dd000000-0000-7000-8000-000000000001', true, true);

-- ---------------------------------------------------------------------------
-- A. The grant and policy layer
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.guest_requests', 'INSERT'),
  'A1 authenticated holds no INSERT on guest_requests');

-- Regression on 20260707170000 (C2): anon lost the same grant first, for the
-- same reason. If it ever comes back the RPC stops being the only front door.
select ok(
  not has_table_privilege('anon', 'public.guest_requests', 'INSERT'),
  'A2 anon holds no INSERT on guest_requests either (C2 regression)');

-- has_table_privilege is blind to a column-only grant, and event_id +
-- dedupe_key is all the squat needs.
select is_empty($$
  select a.attname || ' -> ' || x.grantee::regrole::text as offender
  from pg_attribute a
  cross join lateral aclexplode(a.attacl) x
  where a.attrelid = 'public.guest_requests'::regclass
    and a.attnum > 0 and not a.attisdropped
    and x.privilege_type = 'INSERT'
    and x.grantee in ('anon'::regrole, 'authenticated'::regrole)
$$, 'A3 ...and no column-level INSERT for either role');

-- The policy is dropped, not narrowed: with RLS on, zero applicable INSERT
-- policies is itself the deny. Catalog-driven, so a policy added later by any
-- name shows up here.
select is(
  (select coalesce(string_agg(polname, ',' order by polname), '(none)')
     from pg_policy
    where polrelid = 'public.guest_requests'::regclass and polcmd = 'a'),
  '(none)',
  'A4 guest_requests has no FOR INSERT policy at all (insert_public is dropped)');

-- The revoke did not overshoot: reading the inbox and the deny path are
-- untouched (the four columns are 20260919150000's).
select ok(
  has_table_privilege('authenticated', 'public.guest_requests', 'SELECT')
  and (select string_agg(a.attname::text, ',' order by a.attname::text)
         from pg_attribute a
        where a.attrelid = 'public.guest_requests'::regclass
          and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))
      = 'decided_at,decided_by,decision_reason,status',
  'A5 authenticated keeps SELECT and exactly the four deny columns');

-- ---------------------------------------------------------------------------
-- B. The silent-suppression squat — refused for every role
-- ---------------------------------------------------------------------------
-- The row the attack needs: pending (so it holds the dedup slot) + anonymized
-- (so the inbox never shows it) + the victim's address as dedupe_key.

select pg_temp.login('55555555-5555-4555-8555-555555555555');   -- staff
select throws_ok(
  $$ insert into public.guest_requests
       (event_id, full_name, email, dedupe_key, anonymized_at)
     values ('ee000000-0000-7000-8000-000000000001', 'Squat',
             'slachtoffer@f3.test', 'slachtoffer@f3.test', now()) $$,
  '42501', null, 'B1 staff cannot plant the suppression squat (the F-3 repro)');
reset role;

-- Not a staff-only fix: the grant was the boundary, so no app role keeps it —
-- including the ones that may decide requests. A venue admin who wants a
-- request on the list uses approve_guest_request; nobody creates one by hand.
select pg_temp.login('11111111-1111-4111-8111-111111111111');   -- admin
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name)
     values ('ee000000-0000-7000-8000-000000000001', 'Admin Direct') $$,
  '42501', null, 'B2 a venue admin cannot insert a request by hand either');
reset role;

select pg_temp.login('44444444-4444-4444-8444-444444444444');   -- organizer
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name)
     values ('ee000000-0000-7000-8000-000000000001', 'Organizer Direct') $$,
  '42501', null, 'B3 the event organizer cannot insert a request');
reset role;

select pg_temp.login('66666666-6666-4666-8666-666666666666');   -- doorhost+staff
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name)
     values ('ee000000-0000-7000-8000-000000000001', 'Doorhost Direct') $$,
  '42501', null, 'B4 a doorhost cannot insert a request');
reset role;

select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name)
     values ('ee000000-0000-7000-8000-000000000001', 'Anon Direct') $$,
  '42501', null, 'B5 anon cannot insert a request (C2 regression, at the row level)');
reset role;

-- ...so the victim's own submission is not swallowed. This is the assertion
-- that would have failed before the migration: with the squat planted, the RPC
-- answered ok and stored nothing.
select pg_temp.login_anon();
select is(
  public.submit_guest_request('f3-manual', 'Slachtoffer Echt', 'slachtoffer@f3.test',
    '+31611990001', 1, 'Graag', 'ip-f3-b6', false, null, 'tok-f3-b6') ->> 'status',
  'ok', 'B6 the real applicant submits through the RPC');
reset role;
select is(
  (select full_name || '|' || status::text || '|' || (anonymized_at is null)::text
     from public.guest_requests where dedupe_key = 'slachtoffer@f3.test'),
  'Slachtoffer Echt|pending|true',
  'B6b ...and their request is the one that is stored, visible to the inbox');

select pg_temp.login_anon();
select is(
  (public.get_request_status('tok-f3-b6', 'ip-f3-b7') ->> 'found')
  || '|' || coalesce(public.get_request_status('tok-f3-b6', 'ip-f3-b8') ->> 'full_name', '-'),
  'true|Slachtoffer Echt',
  'B7 ...and their status page resolves, with their own name (was {"found": false})');
reset role;

-- ---------------------------------------------------------------------------
-- C. The e-mail oracle — both probes now answer identically
-- ---------------------------------------------------------------------------
-- Precondition: staff cannot read the table, which is what made the oracle a
-- privilege escalation rather than a convoluted SELECT.

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select count(*)::int from public.guest_requests),
  0, 'C1 staff still sees no guest_requests row at all (guest_requests_select)');

-- 'slachtoffer@f3.test' has a pending request (B6) and so occupies
-- guest_requests_dedupe_idx; 'onbekend@f3.test' has none. Before the migration
-- these two returned 0 and 1 rows respectively. Now both are refused before the
-- index is ever consulted, so the answers are indistinguishable.
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name, dedupe_key)
     values ('ee000000-0000-7000-8000-000000000001', 'probe-taken',
             'slachtoffer@f3.test')
     on conflict do nothing $$,
  '42501', null, 'C2 the oracle probe on an address that DID apply is refused');

select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name, dedupe_key)
     values ('ee000000-0000-7000-8000-000000000001', 'probe-free',
             'onbekend@f3.test')
     on conflict do nothing $$,
  '42501', null, 'C3 ...and the probe on one that did NOT apply gets the same 42501');

-- The plain-insert variant leaked through the SQLSTATE instead of the row
-- count: 23505 on a taken address, success on a free one. Now 42501 either way.
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name, dedupe_key)
     values ('ee000000-0000-7000-8000-000000000001', 'probe-taken-plain',
             'slachtoffer@f3.test') $$,
  '42501', null, 'C4 the plain-insert variant raises 42501, no longer 23505');
reset role;

-- ---------------------------------------------------------------------------
-- D. Validation / throttle bypass
-- ---------------------------------------------------------------------------
-- The RPC's guards are in the function, so a direct insert never met them:
-- email='x', phone null, plus_ones=99, 500 rows in one statement, no throttle.

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ insert into public.guest_requests (event_id, full_name, email, phone, plus_ones)
     select 'ee000000-0000-7000-8000-000000000001', 'junk' || i, 'x', null, 99
     from generate_series(1, 500) i $$,
  '42501', null, 'D1 the 500-row junk batch is refused');
reset role;
select is(
  (select count(*)::int from public.guest_requests where email = 'x'),
  0, 'D2 ...and nothing landed');

-- ---------------------------------------------------------------------------
-- E. The legitimate paths still work
-- ---------------------------------------------------------------------------
-- guest_requests is not FORCE ROW LEVEL SECURITY, so each SECURITY DEFINER
-- function below runs as the table owner and is bound by neither the dropped
-- policy nor the revoked grant.

-- E1. Silent dedup (#28): a second submission for the same address on the same
-- event still answers ok and still stores nothing extra — the behaviour the
-- squat abused, intact for the case it exists for.
select pg_temp.login_anon();
select is(
  public.submit_guest_request('f3-manual', 'Slachtoffer Echt', 'slachtoffer@f3.test',
    '+31611990001', 1, 'Nogmaals', 'ip-f3-e1', false, null, 'tok-f3-e1') ->> 'status',
  'ok', 'E1 a duplicate submission still answers ok (silent dedup)');
reset role;
select is(
  (select count(*)::int from public.guest_requests where dedupe_key = 'slachtoffer@f3.test'),
  1, 'E1b ...and still stores exactly one request');

-- E2. approve_guest_request: the only path that creates the guest.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request(
       (select id from public.guest_requests where dedupe_key = 'slachtoffer@f3.test'),
       'dd000000-0000-7000-8000-000000000001') $$,
  'E2 the admin approves the request through the RPC');
reset role;
select is(
  (select r.status::text || '|' || (select count(*) from public.guests g
      where g.event_id = r.event_id and g.full_name = r.full_name and g.source = 'landing')::text
     from public.guest_requests r where r.dedupe_key = 'slachtoffer@f3.test'),
  'approved|1', 'E2b ...request approved, guest created');

-- E3. Auto-approve inside submit_guest_request (same SECURITY DEFINER call).
select pg_temp.login_anon();
select is(
  public.submit_guest_request('f3-auto', 'Auto Persoon', 'auto@f3.test',
    '+31611990002', 0, null, 'ip-f3-e3', false, null, 'tok-f3-e3') ->> 'auto_approved',
  'true', 'E3 an auto-approve link still approves on submission');
reset role;
select is(
  (select r.status::text || '|' || r.decided_via::text || '|'
          || (select count(*) from public.guests g
               where g.full_name = 'Auto Persoon' and g.source = 'landing')::text
     from public.guest_requests r where r.dedupe_key = 'auto@f3.test'),
  'approved|auto|1', 'E3b ...approved by the system, with its guest');

-- E4. The client deny path (20260919150000) is untouched by this migration.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied',
                            decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Vol'
                      where id = 'bb000000-0000-7000-8000-000000000002'
                        and status = 'pending' $$),
  1, 'E4 an admin can still deny a pending request through the client path');
reset role;

-- E5. The retention job (SECURITY DEFINER, owner) still anonymizes.
insert into public.venues (id, name, slug, retention_months) values
  ('aa000000-0000-7000-8000-0000000000f1', 'F3 Retentie', 'f3-retentie', 1);
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-0000000000f1', 'aa000000-0000-7000-8000-0000000000f1',
   'Oud F3 Event', now() - interval '3 months',
   now() - interval '3 months' + interval '6 hours', 'closed', 'oud-f3-event', false);
insert into public.guest_requests (id, event_id, full_name, email, phone, created_at) values
  ('bb000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-0000000000f1',
   'Oude Aanvraag', 'oud@f3.test', '+31611990003', now() - interval '3 months');

create temp table f3_ret as select * from public.run_privacy_retention();
select is(
  (select full_name || '|' || coalesce(email, '-') || '|' || (anonymized_at is not null)::text
     from public.guest_requests where id = 'bb000000-0000-7000-8000-0000000000f1'),
  'Aanvraag #1|-|true',
  'E5 the retention job still anonymizes an old request');

-- E6. The seed's privilege level. supabase/seed.sql inserts guest_requests
-- directly as the superuser that runs `db reset`; every pgTAP fixture in this
-- suite (including the one three statements up) does the same. Asserted
-- explicitly so an over-broad future revoke shows up here and not as a failing
-- `db reset`.
select lives_ok(
  $$ insert into public.guest_requests (id, event_id, full_name, email, plus_ones, motivation)
     values ('bb000000-0000-7000-8000-0000000000f2',
             'ee000000-0000-7000-8000-000000000001', 'Seed Stijl',
             'seed@f3.test', 1, 'Zoals de seed') $$,
  'E6 the owner (seed / pgTAP fixtures) can still insert a request');

-- E7. service_role: scripts/perf/scale-audit.mjs bulk-inserts requests with the
-- service key. It bypasses RLS by design and this migration deliberately left
-- its grants alone.
set role service_role;
select lives_ok(
  $$ insert into public.guest_requests (id, event_id, full_name, email)
     values ('bb000000-0000-7000-8000-0000000000f3',
             'ee000000-0000-7000-8000-000000000001', 'Perf Script',
             'perf@f3.test') $$,
  'E7 service_role can still insert (the perf scripts)');
reset role;

select * from finish();
rollback;
