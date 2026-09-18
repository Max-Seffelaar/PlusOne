-- pgTAP — a client write on guest_requests can only DENY a pending request
-- (L5, migration 20260918213000; run: supabase test db).
--
-- Before that migration an admin/organizer could PATCH status = 'approved'
-- straight through PostgREST: UPDATE 1, no guest created, and /r/[token] told
-- the requester they were on a list they were not on. Approval must go through
-- approve_guest_request, which creates the guest and runs every cap.
--
-- Proves, per role:
--   * the grant layer: authenticated may UPDATE exactly status, decided_by,
--     decided_at, decision_reason, and nothing table-wide;
--   * the policy layer: admin/organizer can only move pending -> denied, as
--     themselves; approve, "touch" and upsert-approve are refused; decided rows
--     match nothing;
--   * a deny that also names any other column is refused;
--   * staff / doorhost / user_manager / anon change nothing;
--   * the SECURITY DEFINER paths still work: approve_guest_request (incl.
--     re-approving a denied request), auto-approve in submit_guest_request, and
--     the retention job.
--
-- Seed as in landing.test.sql: event ee..01 (landing_active) with tier dd..01;
-- requests bb..01 (Robin, pending), bb..02 (Sofia, pending), bb..03 (Kevin,
-- denied). Max 11.. = admin, Noor 22.. = user_manager, Yusuf 44.. = organizer,
-- Tom 55.. = staff, Lisa 66.. = doorhost+staff. Everything rolls back.

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

-- Request row as "status|decided_by|landing guests with that name", read as the
-- owner: the state a direct write must not have changed.
create function pg_temp.req_state(p_id uuid)
returns text language sql as $fn$
  select r.status::text || '|' || coalesce(r.decided_by::text, '-') || '|'
         || (select count(*) from public.guests g
              where g.event_id = r.event_id and g.full_name = r.full_name
                and g.source = 'landing')::text
  from public.guest_requests r where r.id = p_id;
$fn$;

select plan(37);

-- ---------------------------------------------------------------------------
-- A. The grant layer
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.guest_requests', 'UPDATE'),
  'A1 authenticated holds no table-wide UPDATE on guest_requests');

-- Catalog-driven, so a column added later shows up here as not updatable
-- unless a migration grants it on purpose.
select is(
  (select string_agg(a.attname::text, ',' order by a.attname::text)
     from pg_attribute a
    where a.attrelid = 'public.guest_requests'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')),
  'decided_at,decided_by,decision_reason,status',
  'A2 authenticated may UPDATE exactly the four columns the deny path writes');

select ok(
  has_table_privilege('authenticated', 'public.guest_requests', 'SELECT')
  and has_table_privilege('authenticated', 'public.guest_requests', 'INSERT'),
  'A3 SELECT and INSERT for authenticated are unchanged (the revoke did not overshoot)');

-- ---------------------------------------------------------------------------
-- B. Admin — only pending -> denied, as themselves, on four columns
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.guest_requests
        set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now()
      where id = 'bb000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B1 admin cannot approve a request by a direct write (the L5 repro)');
select throws_ok(
  $$ insert into public.guest_requests (id, event_id, full_name)
     values ('bb000000-0000-7000-8000-000000000001',
             'ee000000-0000-7000-8000-000000000001', 'Robin Castelijns')
     on conflict (id) do update
       set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111',
           decided_at = now() $$,
  '42501', null, 'B2 ...nor through an upsert (ON CONFLICT DO UPDATE is an UPDATE)');
select throws_ok(
  $$ update public.guest_requests set decision_reason = 'notitie'
      where id = 'bb000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B3 admin cannot write a pending request without denying it');
reset role;
select is(pg_temp.req_state('bb000000-0000-7000-8000-000000000001'), 'pending|-|0',
  'B4 the refused writes left Robin pending, undecided, with no guest');

-- A deny that also names any other column: refused by the column grant.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.guest_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), decision_reason = 'Vol', full_name = 'Iemand Anders'
      where id = 'bb000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B5 a deny cannot rewrite what the requester submitted (full_name)');
select throws_ok(
  $$ update public.guest_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), decision_reason = 'Vol',
            event_id = 'ee000000-0000-7000-8000-000000000001'
      where id = 'bb000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B6 a deny cannot name event_id (move a request between events)');
select throws_ok(
  $$ update public.guest_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), decision_reason = 'Vol', decided_via = 'auto'
      where id = 'bb000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B7 a deny cannot pass itself off as a system decision (decided_via)');
select throws_ok(
  $$ update public.guest_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), decision_reason = 'Vol', status_token_hash = 'forged'
      where id = 'bb000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B8 a deny cannot touch the status-page token');
select throws_ok(
  $$ update public.guest_requests
        set status = 'denied', decided_by = '44444444-4444-4444-8444-444444444444',
            decided_at = now(), decision_reason = 'Vol'
      where id = 'bb000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B9 a deny is recorded as the actor, never as someone else');

-- The live deny path (denyGuestRequest): exactly these four columns.
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Lijst zit vol'
                      where id = 'bb000000-0000-7000-8000-000000000001' and status = 'pending' $$),
  1, 'B10 admin denies a pending request (the deny path still works)');
reset role;
select is(
  (select status::text || '|' || decided_by::text || '|' || decision_reason || '|' || decided_via::text
          || '|' || full_name
     from public.guest_requests where id = 'bb000000-0000-7000-8000-000000000001'),
  'denied|11111111-1111-4111-8111-111111111111|Lijst zit vol|manual|Robin Castelijns',
  'B11 the row is denied by the admin, manual, with the submitted name intact');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'guest_requests' and action = 'deny'
      and entity_id = 'bb000000-0000-7000-8000-000000000001'
      and actor_id = '11111111-1111-4111-8111-111111111111'),
  1, 'B12 the denial is audited as the admin');

-- Decided rows match nothing: no un-deny, no re-decide, no editing the reason.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now()
                      where id = 'bb000000-0000-7000-8000-000000000003' $$),
  0, 'B13 a DENIED request cannot be approved by a direct write (matches no row)');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Andere reden'
                      where id = 'bb000000-0000-7000-8000-000000000001' $$),
  0, 'B14 a decided request cannot be re-denied or have its reason rewritten');
reset role;
select is(
  (select status::text || '|' || decision_reason
     from public.guest_requests where id = 'bb000000-0000-7000-8000-000000000003'),
  'denied|Lijst zit vol voor deze avond', 'B15 Kevin is still denied with the original reason');

-- ---------------------------------------------------------------------------
-- C. Organizer of the event — the same single transition
-- ---------------------------------------------------------------------------

insert into public.guest_requests (id, event_id, full_name, email, phone) values
  ('bb000000-0000-7000-8000-0000000000d1', 'ee000000-0000-7000-8000-000000000001',
   'Orga Proef', 'orga@decide.test', '+31611550001');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ update public.guest_requests
        set status = 'approved', decided_by = '44444444-4444-4444-8444-444444444444',
            decided_at = now()
      where id = 'bb000000-0000-7000-8000-0000000000d1' $$,
  '42501', null, 'C1 the organizer cannot approve by a direct write either');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '44444444-4444-4444-8444-444444444444',
                            decided_at = now(), decision_reason = 'Niet bekend'
                      where id = 'bb000000-0000-7000-8000-0000000000d1' and status = 'pending' $$),
  1, 'C2 ...and can deny');
reset role;

-- ---------------------------------------------------------------------------
-- D. Everyone else changes nothing (Sofia bb..02 stays pending)
-- ---------------------------------------------------------------------------
-- These roles have no SELECT on guest_requests, so the row is invisible to the
-- UPDATE: zero rows, no error, no oracle.

select pg_temp.login('55555555-5555-4555-8555-555555555555');   -- staff
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'approved', decided_by = '55555555-5555-4555-8555-555555555555',
                            decided_at = now()
                      where id = 'bb000000-0000-7000-8000-000000000002' $$),
  0, 'D1 staff cannot approve');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '55555555-5555-4555-8555-555555555555',
                            decided_at = now(), decision_reason = 'x'
                      where id = 'bb000000-0000-7000-8000-000000000002' $$),
  0, 'D2 staff cannot deny');
select pg_temp.login('66666666-6666-4666-8666-666666666666');   -- doorhost (+staff)
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'approved', decided_by = '66666666-6666-4666-8666-666666666666',
                            decided_at = now()
                      where id = 'bb000000-0000-7000-8000-000000000002' $$),
  0, 'D3 a doorhost cannot approve');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '66666666-6666-4666-8666-666666666666',
                            decided_at = now(), decision_reason = 'x'
                      where id = 'bb000000-0000-7000-8000-000000000002' $$),
  0, 'D4 a doorhost cannot deny');
select pg_temp.login('22222222-2222-4222-8222-222222222222');   -- user_manager
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'approved', decided_by = '22222222-2222-4222-8222-222222222222',
                            decided_at = now()
                      where id = 'bb000000-0000-7000-8000-000000000002' $$),
  0, 'D5 a user_manager cannot approve');
select pg_temp.login_anon();
select throws_ok(
  $$ update public.guest_requests set status = 'approved', decided_at = now()
      where id = 'bb000000-0000-7000-8000-000000000002' $$,
  '42501', null, 'D6 anon holds no UPDATE at all');
reset role;
select is(pg_temp.req_state('bb000000-0000-7000-8000-000000000002'), 'pending|-|0',
  'D7 Sofia is untouched by every refused caller');

-- ---------------------------------------------------------------------------
-- E. approve_guest_request (SECURITY DEFINER) still approves
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('bb000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001') $$,
  'E1 admin approves a pending request through the RPC');
reset role;
select is(pg_temp.req_state('bb000000-0000-7000-8000-000000000002'),
  'approved|11111111-1111-4111-8111-111111111111|1',
  'E2 ...the request is approved by the admin AND the guest exists');

-- Robin was denied through the client path in B10; re-approval (#12) is the RPC's.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('bb000000-0000-7000-8000-000000000001',
       'dd000000-0000-7000-8000-000000000001') $$,
  'E3 a request denied through the client path can still be re-approved by the RPC');
reset role;
select is(pg_temp.req_state('bb000000-0000-7000-8000-000000000001'),
  'approved|11111111-1111-4111-8111-111111111111|1',
  'E4 ...approved, with its guest');

select pg_temp.login('55555555-5555-4555-8555-555555555555');   -- staff
select throws_ok(
  $$ select public.approve_guest_request('bb000000-0000-7000-8000-0000000000d1',
       'dd000000-0000-7000-8000-000000000001') $$,
  '42501', null, 'E5 the RPC still refuses staff (its own role check is untouched)');
reset role;

-- ---------------------------------------------------------------------------
-- F. Auto-approve in submit_guest_request (SECURITY DEFINER) still approves
-- ---------------------------------------------------------------------------

insert into public.request_links (id, event_id, label, slug, tier_id, auto_approve, active) values
  ('2c000000-0000-7000-8000-0000000000d1', 'ee000000-0000-7000-8000-000000000001',
   'Decide guard', 'decide-guard-auto', 'dd000000-0000-7000-8000-000000000001', true, true);

select pg_temp.login_anon();
select is(
  public.submit_guest_request('decide-guard-auto', 'Auto Gast', 'autogast@decide.test',
    '+31611550002', 0, null, 'ip-decide-f1', false, null, 'tok-decide-f1') ->> 'auto_approved',
  'true', 'F1 an auto-approve link still approves through the RPC');
reset role;
select is(
  (select r.status::text || '|' || r.decided_via::text || '|'
          || (select count(*) from public.guests g
               where g.full_name = 'Auto Gast' and g.source = 'landing')::text
     from public.guest_requests r where r.full_name = 'Auto Gast'),
  'approved|auto|1', 'F2 ...request approved by the system, guest created');

-- ---------------------------------------------------------------------------
-- G. The retention job (SECURITY DEFINER, owner) still anonymizes
-- ---------------------------------------------------------------------------
-- A 1-month-retention venue with one event three months old. Max organizes it,
-- so the client deny path is exercised on a row the job later anonymizes.

insert into public.venues (id, name, slug, retention_months) values
  ('aa000000-0000-7000-8000-0000000000d0', 'Decide Retentie', 'decide-retentie', 1);
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-0000000000d1', 'aa000000-0000-7000-8000-0000000000d0',
   'Oud Decide Event', now() - interval '3 months', now() - interval '3 months' + interval '6 hours',
   'closed', 'oud-decide-event', false);
insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111');
insert into public.guest_requests (id, event_id, full_name, email, phone, motivation, created_at) values
  ('bb000000-0000-7000-8000-0000000000d2', 'ee000000-0000-7000-8000-0000000000d1',
   'Oud Afgewezen', 'oud1@decide.test', '+31611550003', 'Echte motivatie',
   now() - interval '3 months'),
  ('bb000000-0000-7000-8000-0000000000d3', 'ee000000-0000-7000-8000-0000000000d1',
   'Oud Open', 'oud2@decide.test', '+31611550004', null,
   now() - interval '3 months' + interval '1 minute');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Oud Afgewezen kwam niet binnen'
                      where id = 'bb000000-0000-7000-8000-0000000000d2' and status = 'pending' $$),
  1, 'G1 the organizer denies an old request through the client path');
reset role;

create temp table decide_ret as select * from public.run_privacy_retention();

select ok((select requests_anonymized from decide_ret) >= 2,
  'G2 the retention job runs and anonymizes requests');
select is(
  (select string_agg(status::text || ':' || full_name || ':' || coalesce(email, '-') || ':'
                     || coalesce(decision_reason, '-') || ':' || (anonymized_at is not null)::text,
                     ',' order by id)
     from public.guest_requests
    where id in ('bb000000-0000-7000-8000-0000000000d2', 'bb000000-0000-7000-8000-0000000000d3')),
  'denied:Aanvraag #1:-:-:true,pending:Aanvraag #2:-:-:true',
  'G3 both old requests are anonymized (name, contact, deny reason); statuses untouched');

select * from finish();
rollback;
