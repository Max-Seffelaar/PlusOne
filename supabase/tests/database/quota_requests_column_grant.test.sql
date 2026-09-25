-- pgTAP — a client write on quota_requests can only DENY a pending request,
-- and only on the four deny columns (migration 20260925140000; run:
-- pnpm db:test). Mirrors guest_requests_decide.test.sql (20260919150000).
--
-- Before that migration `authenticated` held a table-wide UPDATE and the decide
-- policy pinned neither the new status nor any other column: an admin could
-- approve by a direct write (no event_quotas override — approve_quota_request
-- never ran) and, in the same PATCH as a decision, rewrite user_id / event_id /
-- venue_id / requested_extra / motivation / created_at.
--
-- Proves:
--   A. the grant layer: no table-wide UPDATE, exactly four updatable columns,
--      SELECT/INSERT untouched, anon holds nothing;
--   B. admin of venue A: only pending -> denied, as themselves; approve, upsert
--      approve and "touch" are refused; a deny naming any other column is
--      refused (42501); the legit deny works and is audited; decided rows match
--      nothing; approve_quota_request still works and raises the override;
--   C. staff: files requests (INSERT, untouched) and can change nothing after;
--   D. admin of venue B only: cannot decide venue A's request, can decide their
--      own venue's; an admin of both cannot move a request across venues;
--   E. anon: no privilege at all;
--   F. approve_quota_request (20260925140100): refuses a request that was
--      denied first (45003, no override), still security definer with a pinned
--      search_path, same ACL, locks the row and only flips a pending one;
--   G. decided_at is stamped by the server on a decision (20260925140200): a
--      client-supplied timestamp is ignored.
--
-- Seed (supabase/seed.sql): venue A aa..01 with event ee..01; venue B aa..02.
-- Max 11.. = admin of A and B, Noor 22.. = user_manager of A (made admin of B
-- below), Tom 55.. = staff of A. Everything rolls back.

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

-- The request as the owner sees it: every column an attacker would rewrite.
create function pg_temp.req_state(p_id uuid)
returns text language sql as $fn$
  select status::text || '|' || coalesce(decided_by::text, '-') || '|' || user_id::text
         || '|' || event_id::text || '|' || venue_id::text || '|' || requested_extra::text
         || '|' || coalesce(motivation, '-')
  from public.quota_requests where id = p_id;
$fn$;

-- Fixtures (as the owner). A second event in venue B; Noor becomes admin of
-- venue B only; four pending requests.
insert into public.events (id, venue_id, name, starts_at, ends_at, status) values
  ('ee000000-0000-7000-8000-00000000c001', 'aa000000-0000-7000-8000-000000000002',
   'Marktzaal Night', now() + interval '7 days', now() + interval '7 days' + interval '5 hours',
   'open');
insert into public.venue_memberships (venue_id, user_id, roles) values
  ('aa000000-0000-7000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '{admin}');

insert into public.quota_requests (id, event_id, user_id, requested_extra, motivation) values
  ('9c000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
   '55555555-5555-4555-8555-555555555555', 2, 'Verjaardag'),
  ('9c000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
   '55555555-5555-4555-8555-555555555555', 2, 'Vrienden'),
  ('9c000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-00000000c001',
   '11111111-1111-4111-8111-111111111111', 1, null);

create temp table r1_before as
  select pg_temp.req_state('9c000000-0000-7000-8000-000000000001') as s;
create temp table tom_quota_before as
  select public.user_event_quota('ee000000-0000-7000-8000-000000000001',
                                 '55555555-5555-4555-8555-555555555555') as q;

select plan(37);

-- ---------------------------------------------------------------------------
-- A. The grant layer
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.quota_requests', 'UPDATE'),
  'A1 authenticated holds no table-wide UPDATE on quota_requests');

-- Catalog-driven: a column added later shows up as not updatable unless a
-- migration grants it on purpose.
select is(
  (select string_agg(a.attname::text, ',' order by a.attname::text)
     from pg_attribute a
    where a.attrelid = 'public.quota_requests'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')),
  'decided_at,decided_by,decision_reason,status',
  'A2 authenticated may UPDATE exactly the four columns the deny path writes');

select ok(
  has_table_privilege('authenticated', 'public.quota_requests', 'SELECT')
  and has_table_privilege('authenticated', 'public.quota_requests', 'INSERT')
  and not has_table_privilege('authenticated', 'public.quota_requests', 'DELETE'),
  'A3 SELECT and INSERT for authenticated are unchanged; still no DELETE');

-- has_any_column_privilege sees table-level AND column-level grants.
select ok(
  not has_any_column_privilege('anon', 'public.quota_requests', 'SELECT')
  and not has_any_column_privilege('anon', 'public.quota_requests', 'INSERT')
  and not has_any_column_privilege('anon', 'public.quota_requests', 'UPDATE')
  and not has_table_privilege('anon', 'public.quota_requests', 'DELETE'),
  'A4 anon holds no privilege on quota_requests, table- or column-level');

-- ---------------------------------------------------------------------------
-- C. Staff — files a request, changes nothing after
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$ update public.quota_requests
                        set status = 'denied', decided_by = '55555555-5555-4555-8555-555555555555',
                            decided_at = now()
                      where id = '9c000000-0000-7000-8000-000000000001' $$),
  0, 'C1 staff cannot decide (or withdraw) their own request: matches no row');
select throws_ok(
  $$ update public.quota_requests set requested_extra = 50
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'C2 staff cannot inflate their own pending request (requested_extra)');
select throws_ok(
  $$ update public.quota_requests set user_id = '66666666-6666-4666-8666-666666666666'
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'C3 staff cannot hand their request to someone else (user_id)');
reset role;

-- ---------------------------------------------------------------------------
-- D. Admin of venue B only — cannot reach venue A
-- ---------------------------------------------------------------------------

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is(
  pg_temp.rowcount($$ update public.quota_requests
                        set status = 'denied', decided_by = '22222222-2222-4222-8222-222222222222',
                            decided_at = now(), decision_reason = 'x'
                      where id = '9c000000-0000-7000-8000-000000000001' $$),
  0, 'D1 admin of venue B cannot deny a venue A request');
select is(
  pg_temp.rowcount($$ update public.quota_requests
                        set status = 'denied', decided_by = '22222222-2222-4222-8222-222222222222',
                            decided_at = now(), decision_reason = 'Vol'
                      where id = '9c000000-0000-7000-8000-000000000005' $$),
  1, 'D2 ...but denies a request of their own venue');
reset role;
select is(pg_temp.req_state('9c000000-0000-7000-8000-000000000001'), (select s from r1_before),
  'D3 staff and the venue B admin left the venue A request exactly as filed');

-- ---------------------------------------------------------------------------
-- B. Admin of venue A — only pending -> denied, as themselves, four columns
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.quota_requests
        set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now()
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B1 admin cannot approve by a direct write (no override would be granted)');
-- The proposed insert row passes quota_requests_insert_own (own user_id,
-- pending, member), so this reaches the ON CONFLICT DO UPDATE and its policy.
select throws_ok(
  $$ insert into public.quota_requests (id, event_id, user_id, requested_extra)
     values ('9c000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 1)
     on conflict (id) do update
       set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111',
           decided_at = now() $$,
  '42501', null, 'B2 ...nor through an upsert (ON CONFLICT DO UPDATE is an UPDATE)');
select throws_ok(
  $$ update public.quota_requests set decision_reason = 'notitie'
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B3 admin cannot write a pending request without denying it');

-- A deny that also names any other column: refused by the column grant.
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), user_id = '66666666-6666-4666-8666-666666666666'
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B4 a deny cannot re-assign the request to another member (user_id)');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), event_id = 'ee000000-0000-7000-8000-00000000c001'
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B5 an admin of both venues cannot move a request to another venue''s event (event_id)');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), venue_id = 'aa000000-0000-7000-8000-000000000002'
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B6 a deny cannot name venue_id');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), requested_extra = 99
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B7 a deny cannot rewrite the amount (requested_extra)');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), motivation = 'Iets anders'
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B8 a deny cannot rewrite what the requester wrote (motivation)');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), created_at = now() - interval '30 days'
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B9 a deny cannot backdate the request (created_at)');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '22222222-2222-4222-8222-222222222222',
            decided_at = now()
      where id = '9c000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'B10 a deny is recorded as the actor, never as someone else');
reset role;
select is(pg_temp.req_state('9c000000-0000-7000-8000-000000000001'), (select s from r1_before),
  'B11 every refused write left the request exactly as filed');

-- The live deny path (decideQuotaRequest, src/features/quotas/actions.ts).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.quota_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Lijst zit vol'
                      where id = '9c000000-0000-7000-8000-000000000001' $$),
  1, 'B12 admin denies a pending request (the deny path still works)');
reset role;
-- req_state includes venue_id: B12 is where set_event_scope (BEFORE UPDATE)
-- runs under the column grant, so this also proves the trigger left venue_id
-- intact (triggers are not subject to column grants).
select is(
  pg_temp.req_state('9c000000-0000-7000-8000-000000000001') || '|' ||
    (select decision_reason from public.quota_requests
      where id = '9c000000-0000-7000-8000-000000000001'),
  replace((select s from r1_before), 'pending|-|',
          'denied|11111111-1111-4111-8111-111111111111|') || '|Lijst zit vol',
  'B13 the row is denied by the admin, with everything the requester filed (incl. venue_id) intact');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'quota_requests' and action = 'deny'
      and entity_id = '9c000000-0000-7000-8000-000000000001'
      and actor_id = '11111111-1111-4111-8111-111111111111'),
  1, 'B14 the denial is audited as the admin');

-- Decided rows match nothing: no un-deny, no re-decide, no editing the reason.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.quota_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Andere reden'
                      where id = '9c000000-0000-7000-8000-000000000001' $$),
  0, 'B15 a decided request cannot be re-denied or have its reason rewritten');

-- Approval is the SECURITY DEFINER RPC, unaffected by the column grant.
select lives_ok(
  $$ select public.approve_quota_request('9c000000-0000-7000-8000-000000000002') $$,
  'B16 admin approves through approve_quota_request');
reset role;
select is(
  (select status::text || '|' || decided_by::text from public.quota_requests
    where id = '9c000000-0000-7000-8000-000000000002')
  || '|' || (public.user_event_quota('ee000000-0000-7000-8000-000000000001',
                                     '55555555-5555-4555-8555-555555555555')
             - (select q from tom_quota_before))::text,
  'approved|11111111-1111-4111-8111-111111111111|2',
  'B17 ...which marks it approved AND raises the override by the granted extra');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'quota_requests' and action = 'approve'
      and entity_id = '9c000000-0000-7000-8000-000000000002'
      and actor_id = '11111111-1111-4111-8111-111111111111'),
  1, 'B18 the approval is audited as the admin');

-- ---------------------------------------------------------------------------
-- E. anon — nothing
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select throws_ok(
  $$ update public.quota_requests set status = 'denied'
      where id = '9c000000-0000-7000-8000-000000000002' $$,
  '42501', null, 'E1 anon cannot update quota_requests at all');
reset role;

-- ---------------------------------------------------------------------------
-- F. approve_quota_request — row lock + pending-only flip (20260925140100)
-- ---------------------------------------------------------------------------

-- Request 1 was denied in B12. Approving it now is the losing side of the
-- deny-vs-approve race: refused, and no override is written.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9c000000-0000-7000-8000-000000000001') $$,
  '45003', null, 'F1 approve after a deny is refused (45003)');
reset role;
select is(
  (select status::text from public.quota_requests where id = '9c000000-0000-7000-8000-000000000001')
  || '|' || (public.user_event_quota('ee000000-0000-7000-8000-000000000001',
                                     '55555555-5555-4555-8555-555555555555')
             - (select q from tom_quota_before))::text,
  'denied|2',
  'F2 ...the deny stands and the override is unchanged (only B16''s +2)');

select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p where p.oid = 'public.approve_quota_request(uuid)'::regprocedure),
  'F3 approve_quota_request is still SECURITY DEFINER with search_path pinned to empty');
select ok(
  has_function_privilege('authenticated', 'public.approve_quota_request(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.approve_quota_request(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.approve_quota_request(uuid)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.approve_quota_request(uuid)'::regprocedure
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'F4 same ACL: EXECUTE for authenticated + service_role, not anon, not PUBLIC');
-- The race itself needs two sessions (not possible inside one pgTAP
-- transaction); pin the two mechanisms that close it instead.
select ok(
  (select p.prosrc ~* 'where\s+id\s*=\s*p_request_id\s+for\s+update'
      and p.prosrc ~* 'and\s+status\s*=\s*''pending'''
     from pg_proc p where p.oid = 'public.approve_quota_request(uuid)'::regprocedure),
  'F5 the request row is read FOR UPDATE and only a still-pending row is flipped');

-- ---------------------------------------------------------------------------
-- G. decided_at is the server's clock (20260925140200)
-- ---------------------------------------------------------------------------

insert into public.quota_requests (id, event_id, user_id, requested_extra) values
  ('9c000000-0000-7000-8000-000000000006', 'ee000000-0000-7000-8000-000000000001',
   '55555555-5555-4555-8555-555555555555', 1);
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.quota_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = '2020-01-01T00:00:00Z', decision_reason = 'x'
                      where id = '9c000000-0000-7000-8000-000000000006' $$),
  1, 'G1 a deny with a client-chosen decided_at still succeeds');
reset role;
select is(
  (select decided_at from public.quota_requests where id = '9c000000-0000-7000-8000-000000000006'),
  now(), 'G2 ...but decided_at is the transaction time, not the backdated value');
select ok(
  (select not p.prosecdef and p.proconfig = array['search_path=""']
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
     from pg_proc p where p.oid = 'public.quota_requests_stamp_decided_at()'::regprocedure),
  'G3 the stamp trigger function is SECURITY INVOKER, search_path pinned, not callable by app roles');

select * from finish();

rollback;
