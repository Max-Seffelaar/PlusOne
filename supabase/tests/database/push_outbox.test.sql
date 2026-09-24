-- pgTAP — notification_outbox + the approvals-loop enqueue triggers (Fase 17
-- N2, 86ey6bfbe; migration 20260925120000). Run: pnpm db:test.
--
-- Proves: the outbox is closed to every app role; (a) a quota request reaches
-- exactly the venue's admins, (b) a guest request exactly the venue's admins
-- + that event's organizers, (c) a quota decision exactly the requester as
-- filed (old.user_id), even when the decision rewrites user_id;
-- nobody from ANOTHER venue is ever a recipient (a venue-2-only admin, Vera,
-- and venue-1's organizer are the probes); payloads carry ids, not names;
-- re-fires and replays do not duplicate; and a broken outbox never fails the
-- request that triggered it.
--
-- Seed: venue1 aa..01 — Max 11.. admin (also admin of venue2 aa..02), Noor
-- 22.. user_manager, Finn 33.. finance, Yusuf 44.. organizer of ee..01, Tom
-- 55.. staff, Lisa 66.. doorhost+staff. Rolls back.

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

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

create function pg_temp.recipients(p_source uuid, p_kind text)
returns uuid[] language sql as $fn$
  select coalesce(array_agg(recipient_user_id order by recipient_user_id), '{}')
  from public.notification_outbox
  where source_id = p_source and kind = p_kind;
$fn$;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner): Vera — admin of venue2 ONLY; a venue2 event.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '77770000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'vera@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "Vera Venue2"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', '');

insert into public.user_profiles (id, full_name, email)
values ('77770000-0000-4000-8000-000000000002', 'Vera Venue2', 'vera@plusone.test');

insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000002', '77770000-0000-4000-8000-000000000002', '{admin}');

insert into public.events (id, venue_id, name, starts_at, landing_slug, status)
values ('ee000000-0000-7000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000002',
        'Push Night Venue2', now() + interval '10 days', 'push-night-venue2', 'open');

-- ---------------------------------------------------------------------------
-- A. Closed to app roles
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.notification_outbox'::regclass),
  'A1 RLS is enabled on notification_outbox');

select is_empty($$
  select r || ':' || p
  from unnest(array['anon','authenticated']) r
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r, 'public.notification_outbox', p)
$$, 'A2 neither anon nor authenticated holds any privilege on notification_outbox');

select ok(
  not has_function_privilege('authenticated', 'public.enqueue_quota_request_push()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enqueue_guest_request_push()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enqueue_guest_request_push()', 'EXECUTE'),
  'A3 the enqueue trigger functions are not callable by app roles');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$select count(*) from public.notification_outbox$$, '42501', null,
  'A4 even a venue admin cannot read the outbox');
select pg_temp.login_anon();
select throws_ok($$insert into public.notification_outbox (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload)
                   values ('guest_request_created', gen_random_uuid(), 'aa000000-0000-7000-8000-000000000001',
                           '11111111-1111-4111-8111-111111111111', 'x', '{}')$$,
  '42501', null, 'A5 anon cannot plant an outbox row');

-- ---------------------------------------------------------------------------
-- B. (a) quota request created → venue admins only
-- ---------------------------------------------------------------------------
select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- Lisa, staff at venue1
select lives_ok($$
  insert into public.quota_requests (id, event_id, user_id, requested_extra)
  values ('9a000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
          '66666666-6666-4666-8666-666666666666', 2)
$$, 'B1 staff files a quota request through RLS (trigger runs under the client role)');

reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  pg_temp.recipients('9a000000-0000-7000-8000-000000000001', 'quota_request_created'),
  array['11111111-1111-4111-8111-111111111111']::uuid[],
  'B2 recipients = the venue''s admins (Max) — not user_manager, finance, organizer, or venue2''s Vera');

select is(
  (select payload from public.notification_outbox
   where source_id = '9a000000-0000-7000-8000-000000000001'),
  jsonb_build_object(
    'kind', 'quota_request_created',
    'venue_id', 'aa000000-0000-7000-8000-000000000001',
    'event_id', 'ee000000-0000-7000-8000-000000000001',
    'request_id', '9a000000-0000-7000-8000-000000000001'),
  'B3 payload carries ids and a kind only — no names');

select is(
  (select status || '/' || attempts from public.notification_outbox
   where source_id = '9a000000-0000-7000-8000-000000000001'),
  'pending/0', 'B4 new rows start pending with zero attempts');

-- An admin filing a request is not notified about their own request.
insert into public.quota_requests (id, event_id, user_id, requested_extra)
values ('9a000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111', 1);
select is(
  pg_temp.recipients('9a000000-0000-7000-8000-000000000002', 'quota_request_created'),
  '{}'::uuid[], 'B5 the requester is never their own approver-recipient');

-- ---------------------------------------------------------------------------
-- C. (b) guest request created → venue admins + that event's organizers
-- ---------------------------------------------------------------------------
insert into public.guest_requests (id, event_id, full_name, email)
values ('9b000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        'Push Applicant', 'push-applicant@example.test');
select is(
  pg_temp.recipients('9b000000-0000-7000-8000-000000000001', 'guest_request_created'),
  array['11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444']::uuid[],
  'C1 venue1 guest request → Max (admin) + Yusuf (organizer of that event)');

insert into public.guest_requests (id, event_id, full_name)
values ('9b000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-0000000000b2', 'Venue2 Applicant');
select is(
  pg_temp.recipients('9b000000-0000-7000-8000-000000000002', 'guest_request_created'),
  array['11111111-1111-4111-8111-111111111111', '77770000-0000-4000-8000-000000000002']::uuid[],
  'C2 venue2 guest request → venue2''s admins only (Max, Vera) — venue1''s organizer is not a recipient');

select is(
  (select count(*)::int from public.notification_outbox
   where recipient_user_id = '77770000-0000-4000-8000-000000000002'
     and venue_id = 'aa000000-0000-7000-8000-000000000001'),
  0, 'C3 the venue2-only admin received nothing about venue1');

select is(
  (select count(*)::int from public.notification_outbox o
   where o.payload ?| array['full_name', 'email', 'phone', 'motivation']),
  0, 'C4 no outbox payload carries applicant PII');

insert into public.guest_requests (id, event_id, full_name, status, decided_by, decided_at)
values ('9b000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
        'Auto Approved', 'approved', '11111111-1111-4111-8111-111111111111', now());
select is(
  pg_temp.recipients('9b000000-0000-7000-8000-000000000003', 'guest_request_created'),
  '{}'::uuid[], 'C5 a request inserted already decided (auto-approve) queues nothing');

-- ---------------------------------------------------------------------------
-- D. (c) quota request decided → the requester
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$select public.approve_quota_request('9a000000-0000-7000-8000-000000000001')$$,
  'D1 the admin approves Lisa''s request through the real RPC');

reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  pg_temp.recipients('9a000000-0000-7000-8000-000000000001', 'quota_request_decided'),
  array['66666666-6666-4666-8666-666666666666']::uuid[],
  'D2 the decision goes to the requester only');

select is(
  (select payload ->> 'status' from public.notification_outbox
   where source_id = '9a000000-0000-7000-8000-000000000001' and kind = 'quota_request_decided'),
  'approved', 'D3 the decision payload says which way it went');

-- Replay: an update that does not change status queues nothing; a status
-- that goes back and comes again lands on the dedupe key.
update public.quota_requests set decision_reason = 'ok'
where id = '9a000000-0000-7000-8000-000000000001';
update public.quota_requests set status = 'pending', decided_by = null, decided_at = null
where id = '9a000000-0000-7000-8000-000000000001';
update public.quota_requests
   set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
where id = '9a000000-0000-7000-8000-000000000001';
select is(
  (select count(*)::int from public.notification_outbox
   where source_id = '9a000000-0000-7000-8000-000000000001' and kind = 'quota_request_decided'),
  1, 'D4 a replayed decision does not queue a second push (dedupe key)');

update public.quota_requests
   set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
where id = '9a000000-0000-7000-8000-000000000002';
select is(
  pg_temp.recipients('9a000000-0000-7000-8000-000000000002', 'quota_request_decided'),
  '{}'::uuid[], 'D5 a self-decided request notifies nobody');

-- The decision goes to the requester AS FILED. authenticated still holds a
-- table-wide UPDATE on quota_requests and the decide policy does not pin
-- user_id, so an admin's decision PATCH can rewrite it; the push must not
-- follow that rewrite into another venue (Vera is venue-2-only).
insert into public.quota_requests (id, event_id, user_id, requested_extra)
values ('9a000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-000000000001',
        '66666666-6666-4666-8666-666666666666', 1);
update public.quota_requests
   set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now(),
       user_id = '77770000-0000-4000-8000-000000000002'
 where id = '9a000000-0000-7000-8000-000000000004';
select is(
  pg_temp.recipients('9a000000-0000-7000-8000-000000000004', 'quota_request_decided'),
  array['66666666-6666-4666-8666-666666666666']::uuid[],
  'D6 a decision that rewrites user_id still notifies only the original requester — never the rewritten (venue-2) user');

-- ---------------------------------------------------------------------------
-- E. Broken plumbing never fails the request
-- ---------------------------------------------------------------------------
-- NOT VALID still checks every NEW row: from here on each outbox insert fails.
alter table public.notification_outbox add constraint pgtap_break check (false) not valid;

select lives_ok($$
  insert into public.guest_requests (id, event_id, full_name)
  values ('9b000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-000000000001', 'Survivor')
$$, 'E1 a guest request is stored even when the outbox insert fails');

select lives_ok($$
  insert into public.quota_requests (id, event_id, user_id, requested_extra)
  values ('9a000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
          '66666666-6666-4666-8666-666666666666', 1)
$$, 'E2 …and so is a quota request');

alter table public.notification_outbox drop constraint pgtap_break;

select is(
  (select count(*)::int from public.guest_requests where id = '9b000000-0000-7000-8000-000000000004')
  + (select count(*)::int from public.quota_requests where id = '9a000000-0000-7000-8000-000000000003')
  + (select count(*)::int from public.notification_outbox
     where source_id in ('9b000000-0000-7000-8000-000000000004', '9a000000-0000-7000-8000-000000000003')),
  2, 'E3 both requests persisted, with no outbox rows for them');

select * from finish();
rollback;
