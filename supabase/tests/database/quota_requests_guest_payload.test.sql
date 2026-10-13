-- pgTAP — Quota-aanvraag Q (z8uq9m2xyp, migration 20261016180000; run:
-- pnpm db:test). A quota request may name the guest; approving it raises the
-- requester's quota AND adds that guest in one transaction, on the
-- requester's name, through the ordinary guest triggers; a decline needs a
-- reason in the database; the requester dismisses a decision (seen_at) and
-- nobody else can; the payload is PII and follows the retention rules.
--
-- Proves:
--   P. filing: a valid payload is stored; a tier of another company's event,
--      negative/oversized plus-ones, an unknown key or a blank name are
--      refused; guest_id/seen_at cannot be filed; nobody can change a payload.
--   A. approve with payload: override +n, exactly one guest (tier, +N, name,
--      added_by = requester, source app, approved), request approved with
--      guest_id, audit rows for the guest, the override and the request.
--   B. approve without payload: quota only, no guest, guest_id null.
--   C. payload over the new quota (45001), a locked list for a staff
--      requester (45007) and a tier that is gone (45008) roll EVERYTHING back
--      (override, guest, status); a doorhost requester on a locked list works.
--   D. decline: no reason / whitespace / invisible-only reason refused
--      (23514) on the RLS path and as the owner; with a reason it works.
--   E. seen_at: the requester sets it on a decided own request only
--      (server-stamped, never back to null); another member, an admin, and a
--      pending row: refused; the requester cannot touch the decision.
--   F. role matrix: read others' requests / file / approve, per role (staff,
--      doorhost, user_manager, finance, admin, crew, outsider).
--   G. retention: the nightly job nulls payloads of expired events and
--      scrubs them from the audit diffs; anonymizing the created guest nulls
--      its payload.
--
-- Seed (supabase/seed.sql): venue A aa..01 (Max 11.. admin, Noor 22..
-- user_manager, Femke 33.. finance, Tom 55.. staff, Lisa 66.. doorhost+staff),
-- organizer Yusuf 44.. (crew on ee..01, no membership), venue B aa..02.
-- Tom has a default quota of 10 at venue A, Lisa 5. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.owner()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
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

-- ── Fixtures (as the owner) ─────────────────────────────────────────────────
-- E: open event in venue A (fresh, so nobody has consumed anything there).
-- L: locked event in venue A. X: event in venue B. An outsider with no ties.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '0b000000-0000-4000-8000-0000000000aa', 'authenticated',
  'authenticated', 'outsider@q.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', '');
insert into public.user_profiles (id, full_name, email)
values ('0b000000-0000-4000-8000-0000000000aa', 'Outsider', 'outsider@q.test')
on conflict (id) do nothing;

insert into public.events (id, venue_id, name, starts_at, ends_at, status, list_locked, locked_by, locked_at) values
  ('ee000000-0000-7000-8000-0000000a0001', 'aa000000-0000-7000-8000-000000000001', 'Quota Night',
   now() + interval '3 days', now() + interval '3 days 6 hours', 'open', false, null, null),
  ('ee000000-0000-7000-8000-0000000a0002', 'aa000000-0000-7000-8000-000000000001', 'Locked Night',
   now() + interval '4 days', now() + interval '4 days 6 hours', 'open', true,
   '11111111-1111-4111-8111-111111111111', now()),
  ('ee000000-0000-7000-8000-0000000a0003', 'aa000000-0000-7000-8000-000000000002', 'Other Company Night',
   now() + interval '5 days', now() + interval '5 days 6 hours', 'open', false, null, null);

insert into public.guest_tiers (id, event_id, name, color) values
  ('dd000000-0000-7000-8000-0000000a1001', 'ee000000-0000-7000-8000-0000000a0001', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-0000000a1002', 'ee000000-0000-7000-8000-0000000a0001', 'Backstage', '#B5A6FF'),
  ('dd000000-0000-7000-8000-0000000a1003', 'ee000000-0000-7000-8000-0000000a0002', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-0000000a1004', 'ee000000-0000-7000-8000-0000000a0003', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-0000000a1005', 'ee000000-0000-7000-8000-0000000a0001', 'Gone soon', '#8A8A93');

-- Requests filed as the owner (the insert path itself is tested in P/F).
insert into public.quota_requests (id, event_id, user_id, requested_extra, motivation, guest_payload) values
  -- r2: no payload
  ('9e000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-0000000a0001',
   '55555555-5555-4555-8555-555555555555', 3, 'Crew', null),
  -- r3: payload that will not fit (+20 = 21 spots)
  ('9e000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-0000000a0001',
   '55555555-5555-4555-8555-555555555555', 2, 'Team outing',
   '{"name": "Big Group", "plus_ones": 20, "tier_id": "dd000000-0000-7000-8000-0000000a1001"}'),
  -- r4: Tom (staff) on the locked list
  ('9e000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-0000000a0002',
   '55555555-5555-4555-8555-555555555555', 1, 'Friend',
   '{"name": "Sam", "plus_ones": 0, "tier_id": "dd000000-0000-7000-8000-0000000a1003"}'),
  -- r5: Lisa (doorhost + staff) on the locked list
  ('9e000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-0000000a0002',
   '66666666-6666-4666-8666-666666666666', 1, 'Friend',
   '{"name": "Robin", "plus_ones": 0, "tier_id": "dd000000-0000-7000-8000-0000000a1003"}'),
  -- r6: tier that will be deleted before the decision
  ('9e000000-0000-7000-8000-000000000006', 'ee000000-0000-7000-8000-0000000a0001',
   '55555555-5555-4555-8555-555555555555', 1, 'Friend',
   '{"name": "Kim", "plus_ones": 0, "tier_id": "dd000000-0000-7000-8000-0000000a1005"}'),
  -- r7: to decline; r8: stays pending; r9: approve matrix
  ('9e000000-0000-7000-8000-000000000007', 'ee000000-0000-7000-8000-0000000a0001',
   '55555555-5555-4555-8555-555555555555', 1, 'Friend', null),
  ('9e000000-0000-7000-8000-000000000008', 'ee000000-0000-7000-8000-0000000a0001',
   '55555555-5555-4555-8555-555555555555', 1, 'Friend', null),
  ('9e000000-0000-7000-8000-000000000009', 'ee000000-0000-7000-8000-0000000a0001',
   '55555555-5555-4555-8555-555555555555', 1, 'Friend', null);

select plan(77);

-- ---------------------------------------------------------------------------
-- P. Filing a request with a guest
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ insert into public.quota_requests (id, event_id, user_id, requested_extra, motivation, guest_payload)
     values ('9e000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-0000000a0001',
             '55555555-5555-4555-8555-555555555555', 2, 'Birthday',
             '{"name": "Lisa de Vries", "plus_ones": 1, "tier_id": "dd000000-0000-7000-8000-0000000a1002",
               "phone": "+31612345678", "note": "Birthday girl"}') $$,
  'P1 staff files a request that names the guest');

select is(
  (select guest_payload ->> 'name' from public.quota_requests where id = '9e000000-0000-7000-8000-000000000001'),
  'Lisa de Vries', 'P2 the requester reads their own payload back');

select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, guest_payload)
     values ('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555', 1, 'x',
             '{"name": "Eve", "plus_ones": 0, "tier_id": "dd000000-0000-7000-8000-0000000a1004"}') $$,
  '23514', null, 'P3 a tier of another company''s event is refused');

select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, guest_payload)
     values ('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555', 1, 'x',
             '{"name": "Eve", "plus_ones": -1, "tier_id": "dd000000-0000-7000-8000-0000000a1001"}') $$,
  '23514', null, 'P4 negative plus-ones are refused');

select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, guest_payload)
     values ('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555', 1, 'x',
             '{"name": "Eve", "plus_ones": 51, "tier_id": "dd000000-0000-7000-8000-0000000a1001"}') $$,
  '23514', null, 'P5 plus-ones above 50 are refused');

select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, guest_payload)
     values ('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555', 1, 'x',
             '{"name": "Eve", "plus_ones": 0, "tier_id": "dd000000-0000-7000-8000-0000000a1001", "added_by": "x"}') $$,
  '23514', null, 'P6 an unknown key in the payload is refused');

select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, guest_payload)
     values ('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555', 1, 'x',
             jsonb_build_object('name', E'​ ', 'plus_ones', 0, 'tier_id', 'dd000000-0000-7000-8000-0000000a1001')) $$,
  '23514', null, 'P7 an invisible-only name is refused');

select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, guest_id)
     values ('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555', 1, 'x',
             (select id from public.guests limit 1)) $$,
  '42501', null, 'P8 a client cannot file a request with a guest_id');

select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, seen_at)
     values ('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555', 1, 'x', now()) $$,
  '42501', null, 'P9 a client cannot file a request as already seen');

select throws_ok(
  $$ update public.quota_requests
        set guest_payload = '{"name": "Mallory", "plus_ones": 9, "tier_id": "dd000000-0000-7000-8000-0000000a1002"}'
      where id = '9e000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'P10 the requester cannot change the payload after filing');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.quota_requests set guest_payload = null
      where id = '9e000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'P11 an admin cannot change someone''s payload either');

-- ---------------------------------------------------------------------------
-- A. Approve with a payload
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000001') $$,
  'A1 the admin approves the request with a guest');

select pg_temp.owner();

select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000a0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  12, 'A2 the override is the old quota (10) + 2');

select is(
  (select count(*)::int from public.guests where event_id = 'ee000000-0000-7000-8000-0000000a0001'),
  1, 'A3 exactly one guest was added');

select is(
  (select row(g.full_name, g.plus_ones, g.tier_id, g.added_by, g.source::text, g.status::text, g.phone, g.note)::text
     from public.guests g where g.event_id = 'ee000000-0000-7000-8000-0000000a0001'),
  row('Lisa de Vries', 1, 'dd000000-0000-7000-8000-0000000a1002'::uuid,
      '55555555-5555-4555-8555-555555555555'::uuid, 'app', 'approved', '+31612345678', 'Birthday girl')::text,
  'A4 the guest has the payload''s name, +N, tier, phone and note, added by the requester');

select is(
  (select row(q.status::text, q.guest_id, q.decided_by)::text from public.quota_requests q
    where q.id = '9e000000-0000-7000-8000-000000000001'),
  row('approved', (select id from public.guests where event_id = 'ee000000-0000-7000-8000-0000000a0001'),
      '11111111-1111-4111-8111-111111111111'::uuid)::text,
  'A5 the request is fulfilled: approved, guest_id points at the new guest');

select is(
  (select count(*)::int from public.audit_log a
    where a.entity_type = 'guests' and a.action = 'create'
      and a.entity_id = (select id from public.guests where event_id = 'ee000000-0000-7000-8000-0000000a0001')
      and a.actor_id = '11111111-1111-4111-8111-111111111111'),
  1, 'A6 the guest insert is audited (actor = the approving admin)');

select is(
  (select count(*)::int from public.audit_log a
    where a.entity_type = 'quota_requests' and a.action = 'approve'
      and a.entity_id = '9e000000-0000-7000-8000-000000000001'),
  1, 'A7 the approval is audited');

select ok(
  exists (select 1 from public.audit_log a
           where a.entity_type = 'event_quotas' and a.action = 'quota_grant'
             and a.event_id = 'ee000000-0000-7000-8000-0000000a0001'),
  'A8 the override is audited');

select is(
  public.user_event_consumption('ee000000-0000-7000-8000-0000000a0001', '55555555-5555-4555-8555-555555555555'),
  2, 'A9 the guest consumes 1 + N of the requester''s quota');

-- ---------------------------------------------------------------------------
-- B. Approve without a payload
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000002') $$,
  'B1 the admin approves a request without a guest');
select pg_temp.owner();

select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000a0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  15, 'B2 the override went up by 3');
select is(
  (select count(*)::int from public.guests where event_id = 'ee000000-0000-7000-8000-0000000a0001'),
  1, 'B3 no guest was added');
select is(
  (select row(status::text, guest_id)::text from public.quota_requests where id = '9e000000-0000-7000-8000-000000000002'),
  row('approved', null::uuid)::text, 'B4 approved, guest_id null');

-- ---------------------------------------------------------------------------
-- C. Failures roll everything back
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000003') $$,
  '45001', null, 'C1 a guest above the new quota is refused (45001)');
select pg_temp.owner();

select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000a0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  15, 'C2 ...and the override is not raised');
select is(
  (select row(status::text, guest_id)::text from public.quota_requests where id = '9e000000-0000-7000-8000-000000000003'),
  row('pending', null::uuid)::text, 'C3 ...and the request is still pending');
select is(
  (select count(*)::int from public.guests where full_name = 'Big Group'),
  0, 'C4 ...and no guest exists');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000004') $$,
  '45007', null, 'C5 a staff requester on a locked list: refused (45007)');
select pg_temp.owner();
select is(
  (select count(*)::int from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000a0002' and user_id = '55555555-5555-4555-8555-555555555555'),
  0, 'C6 ...no override was written');
select is(
  (select count(*)::int from public.guests where event_id = 'ee000000-0000-7000-8000-0000000a0002'),
  0, 'C7 ...no guest on the locked list');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000005') $$,
  'C8 a doorhost requester keeps write access on a locked list (#23)');
select pg_temp.owner();
select is(
  (select count(*)::int from public.guests
    where event_id = 'ee000000-0000-7000-8000-0000000a0002' and added_by = '66666666-6666-4666-8666-666666666666'),
  1, 'C9 ...and the guest is on the list on the doorhost''s name');

delete from public.guest_tiers where id = 'dd000000-0000-7000-8000-0000000a1005';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000006') $$,
  '45008', null, 'C10 a tier that is gone: refused (45008)');
select pg_temp.owner();
select is(
  (select status::text from public.quota_requests where id = '9e000000-0000-7000-8000-000000000006'),
  'pending', 'C11 ...and the request is still pending');

-- ---------------------------------------------------------------------------
-- D. A decline needs a reason
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
      where id = '9e000000-0000-7000-8000-000000000007' $$,
  '23514', null, 'D1 a decline without a reason is refused (RLS path)');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now(),
            decision_reason = '   '
      where id = '9e000000-0000-7000-8000-000000000007' $$,
  '23514', null, 'D2 a whitespace reason is no reason');
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now(),
            decision_reason = E'​​'
      where id = '9e000000-0000-7000-8000-000000000007' $$,
  '23514', null, 'D3 an invisible-only reason is no reason');
select pg_temp.owner();
select throws_ok(
  $$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
      where id = '9e000000-0000-7000-8000-000000000007' $$,
  '23514', null, 'D4 not even the owner can decline without a reason');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.quota_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now(),
            decision_reason = 'The list is full'
      where id = '9e000000-0000-7000-8000-000000000007' $$),
  1, 'D5 a decline with a reason works');

-- ---------------------------------------------------------------------------
-- E. seen_at — the requester's "Got it"
-- ---------------------------------------------------------------------------
-- Another member (Lisa) cannot mark Tom's decision as seen.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(
  pg_temp.rowcount($$ update public.quota_requests set seen_at = now()
      where id = '9e000000-0000-7000-8000-000000000007' $$),
  0, 'E1 another staff member cannot set someone else''s seen_at');

-- An admin cannot either: on a decided row no policy matches...
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.quota_requests set seen_at = now()
      where id = '9e000000-0000-7000-8000-000000000007' $$),
  0, 'E2 an admin cannot set a requester''s seen_at on a decided request');
-- ...and on a pending row the guard refuses.
select throws_ok(
  $$ update public.quota_requests set seen_at = now()
      where id = '9e000000-0000-7000-8000-000000000008' $$,
  '42501', null, 'E3 an admin cannot set seen_at on a pending request');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$ update public.quota_requests set seen_at = now()
      where id = '9e000000-0000-7000-8000-000000000008' $$),
  0, 'E4 the requester cannot mark a pending request as seen');
select is(
  pg_temp.rowcount($$ update public.quota_requests set seen_at = '2020-01-01'
      where id = '9e000000-0000-7000-8000-000000000007' $$),
  1, 'E5 the requester marks their decided request as seen');
select is(
  (select seen_at from public.quota_requests where id = '9e000000-0000-7000-8000-000000000007'),
  now(), 'E6 ...server-stamped (a client timestamp is ignored)');
select throws_ok(
  $$ update public.quota_requests set seen_at = null
      where id = '9e000000-0000-7000-8000-000000000007' $$,
  '42501', null, 'E7 seen cannot be undone');
select throws_ok(
  $$ update public.quota_requests set status = 'approved'
      where id = '9e000000-0000-7000-8000-000000000007' $$,
  '42501', null, 'E8 the requester cannot change the decision through the seen policy');
select throws_ok(
  $$ update public.quota_requests set decision_reason = 'never mind'
      where id = '9e000000-0000-7000-8000-000000000007' $$,
  '42501', null, 'E9 ...nor rewrite the reason');
select is(
  pg_temp.rowcount($$ update public.quota_requests set seen_at = now()
      where id = '9e000000-0000-7000-8000-000000000001' $$),
  1, 'E10 the requester dismisses a fulfilled request too');

-- ---------------------------------------------------------------------------
-- F. Role matrix
-- ---------------------------------------------------------------------------
-- F-read: rows of OTHER people each role can see (venue A has Tom's + Lisa's).
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.quota_requests where user_id <> '55555555-5555-4555-8555-555555555555'),
  0, 'F1 staff reads only their own requests');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is((select count(*)::int from public.quota_requests where user_id <> '66666666-6666-4666-8666-666666666666'),
  0, 'F2 doorhost reads only their own requests');
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.quota_requests), 0, 'F3 user_manager reads no requests');
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.quota_requests), 0, 'F4 crew (organizer) reads no requests');
select pg_temp.login('0b000000-0000-4000-8000-0000000000aa');
select is((select count(*)::int from public.quota_requests), 0, 'F5 an outsider reads nothing');
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select ok((select count(*) from public.quota_requests
            where event_id = 'ee000000-0000-7000-8000-0000000a0001' and guest_payload is not null) > 0,
  'F6 finance reads the company''s requests, payload included');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select ok((select count(*) from public.quota_requests
            where event_id = 'ee000000-0000-7000-8000-0000000a0001' and guest_payload is not null) > 0,
  'F7 admin reads the company''s requests, payload included');

-- F-file: who can file a request (with a guest) on event E.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, guest_payload)
     values ('ee000000-0000-7000-8000-0000000a0001', '66666666-6666-4666-8666-666666666666', 1, 'x',
             '{"name": "Noa", "plus_ones": 0, "tier_id": "dd000000-0000-7000-8000-0000000a1001"}') $$,
  'F8 doorhost can file');
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select lives_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation)
     values ('ee000000-0000-7000-8000-0000000a0001', '22222222-2222-4222-8222-222222222222', 1, 'x') $$,
  'F9 user_manager (a member) can file');
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation)
     values ('ee000000-0000-7000-8000-0000000a0001', '44444444-4444-4444-8444-444444444444', 1, 'x') $$,
  '42501', null, 'F10 crew without a membership cannot file');
select pg_temp.login('0b000000-0000-4000-8000-0000000000aa');
select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation)
     values ('ee000000-0000-7000-8000-0000000a0001', '0b000000-0000-4000-8000-0000000000aa', 1, 'x') $$,
  '42501', null, 'F11 an outsider cannot file');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation)
     values ('ee000000-0000-7000-8000-0000000a0001', '66666666-6666-4666-8666-666666666666', 1, 'x') $$,
  '42501', null, 'F12 staff cannot file on someone else''s name');

-- F-approve: only an admin of the company.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000009') $$,
  '42501', null, 'F13 staff cannot approve (not even their own request)');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000009') $$,
  '42501', null, 'F14 doorhost cannot approve');
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok($$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000009') $$,
  '42501', null, 'F15 user_manager cannot approve');
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select throws_ok($$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000009') $$,
  '42501', null, 'F16 finance cannot approve');
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok($$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000009') $$,
  '42501', null, 'F17 crew cannot approve');
select pg_temp.login('0b000000-0000-4000-8000-0000000000aa');
select throws_ok($$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000009') $$,
  '42501', null, 'F18 an outsider cannot approve');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$ select public.approve_quota_request('9e000000-0000-7000-8000-000000000009') $$,
  'F19 the admin can');

-- ---------------------------------------------------------------------------
-- G. Retention
-- ---------------------------------------------------------------------------
select pg_temp.owner();

-- The guest Lisa's request created is anonymized → its payload goes.
update public.guests set full_name = 'Gast #1', anonymized_at = now()
 where id = (select guest_id from public.quota_requests where id = '9e000000-0000-7000-8000-000000000005');
select is(
  (select guest_payload from public.quota_requests where id = '9e000000-0000-7000-8000-000000000005'),
  null::jsonb, 'G1 anonymizing the created guest nulls the payload it came from');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'quota_requests' and entity_id = '9e000000-0000-7000-8000-000000000005'
      and (jsonb_typeof(diff -> 'before' -> 'guest_payload') = 'object'
           or jsonb_typeof(diff -> 'after' -> 'guest_payload') = 'object')),
  0, 'G2 ...and scrubs it from that request''s audit diffs');

-- Event E moves past the venue's retention window → the nightly job.
update public.events
   set starts_at = now() - interval '3 years', ends_at = now() - interval '3 years' + interval '6 hours'
 where id = 'ee000000-0000-7000-8000-0000000a0001';
select ok(public.run_quota_request_payload_retention() >= 1,
  'G3 the retention job nulls payloads of expired events');
select is(
  (select count(*)::int from public.quota_requests
    where event_id = 'ee000000-0000-7000-8000-0000000a0001' and guest_payload is not null),
  0, 'G4 ...every payload on that event is gone');
select is(
  (select count(*)::int from public.audit_log a
     join public.quota_requests q on q.id = a.entity_id
    where a.entity_type = 'quota_requests' and q.event_id = 'ee000000-0000-7000-8000-0000000a0001'
      and (jsonb_typeof(a.diff -> 'before' -> 'guest_payload') = 'object'
           or jsonb_typeof(a.diff -> 'after' -> 'guest_payload') = 'object')),
  0, 'G5 ...and from their audit diffs');
select is(
  (select count(*)::int from public.quota_requests
    where event_id = 'ee000000-0000-7000-8000-0000000a0002' and id = '9e000000-0000-7000-8000-000000000004'
      and guest_payload is not null),
  1, 'G6 a request of a still-retained event keeps its payload');
select is(public.run_quota_request_payload_retention(), 0, 'G7 a second run changes nothing');

select ok(
  not has_function_privilege('authenticated', 'public.run_quota_request_payload_retention()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.quota_requester_can_add_guests(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.redact_quota_request_payload_audit(uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.approve_quota_request(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.approve_quota_request(uuid)', 'EXECUTE'),
  'G8 helpers are owner-only; approve_quota_request keeps its ACL');

select * from finish();
rollback;
