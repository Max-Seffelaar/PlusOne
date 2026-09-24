-- pgTAP — push dispatch wiring (Fase 17 N2, 86ey6bfbe; migration
-- 20260925120100). Run: pnpm db:test.
--
-- Proves: privilege boundaries (the three Edge Function RPCs are service_role-
-- only; kick/config/sweep/TTL are owner-only; the invocation-token table is
-- closed to app roles); the pipeline SLEEPS without Vault config (kick no-ops,
-- no token exists, claim refuses everyone); with config, an outbox insert
-- queues exactly one pg_net request and a dedupe hit none; the header each kick
-- sends is a fresh single-use token stored only as a hash — so a request read
-- out of pg_net's queue (which Supabase leaves readable by app roles, a
-- platform grant postgres cannot revoke) holds nothing reusable; claim gates on
-- that token (unknown / expired / reused → 42501) and hands out only
-- live-session FCM tokens; complete's retry/backoff/max-attempts state
-- machine; token pruning; the stuck-row + expired-token sweep; and the
-- 90-day / dead-session TTL.
--
-- The Vault secret and every pg_net request created here roll back with the
-- transaction, so nothing is ever sent. Seed users as in push_tokens.test.sql.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.as_service()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

create function pg_temp.queued()
returns int language sql as $fn$
  select count(*)::int from net.http_request_queue
  where url = 'http://127.0.0.1:9/functions/v1/push-dispatch';
$fn$;

select plan(39);

select set_config('request.jwt.claims', '{}', true);

-- Isolate from rows the seed's requests queued at reset.
update public.notification_outbox set status = 'sent' where status in ('pending', 'sending');

-- ---------------------------------------------------------------------------
-- A. Privileges
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.claim_push_outbox(text, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_push_outbox(uuid, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.prune_push_tokens(uuid[])', 'EXECUTE'),
  'A1 service_role can call the three Edge Function RPCs');

select is_empty($$
  select r || ' -> ' || f
  from unnest(array['anon', 'authenticated']) r
  cross join unnest(array[
    'public.claim_push_outbox(text, integer)',
    'public.complete_push_outbox(uuid, text, text)',
    'public.prune_push_tokens(uuid[])']) f
  where has_function_privilege(r, f, 'EXECUTE')
$$, 'A2 no app role can call the Edge Function RPCs');

select is_empty($$
  select r || ' -> ' || f
  from unnest(array['anon', 'authenticated', 'service_role']) r
  cross join unnest(array[
    'public.kick_push_dispatch()',
    'public.push_dispatch_setting(text)',
    'public.push_outbox_sweep()',
    'public.prune_stale_push_tokens()',
    'public.notification_outbox_kick()',
    'public.push_tokens_stamp()']) f
  where has_function_privilege(r, f, 'EXECUTE')
$$, 'A3 config/kick/sweep/TTL/trigger functions are owner-only');

select ok((select relrowsecurity from pg_class where oid = 'public.push_dispatch_tokens'::regclass),
  'A4 RLS is enabled on push_dispatch_tokens');

select is_empty($$
  select r || ':' || p
  from unnest(array['anon','authenticated']) r
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r, 'public.push_dispatch_tokens', p)
$$, 'A5 no app role holds any privilege on push_dispatch_tokens');

-- ---------------------------------------------------------------------------
-- B. Asleep without config
-- ---------------------------------------------------------------------------
select is(public.push_dispatch_setting('plusone_push_dispatch_url'), null,
  'B1 no dispatch URL configured on a fresh stack');
select is(public.kick_push_dispatch(), false, 'B2 kick is a no-op while unconfigured');
select is((select count(*)::int from public.push_dispatch_tokens), 0,
  'B3 …and mints no invocation token (the seed''s kicks minted none either)');
select is(public.push_dispatch_setting('plusone_push_dispatch_secret'), null,
  'B4 the config reader refuses every name but the URL');

select pg_temp.as_service();
select throws_ok($$select * from public.claim_push_outbox(repeat('ab', 32), 10)$$,
  '42501', null, 'B5 claim refuses every caller while no token has been issued');
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- C. Configured: kick + claim
-- ---------------------------------------------------------------------------
select vault.create_secret('http://127.0.0.1:9/functions/v1/push-dispatch', 'plusone_push_dispatch_url');

select is(public.kick_push_dispatch(), true, 'C1 kick queues a request once configured');
select is(pg_temp.queued(), 1, 'C2 exactly one pg_net request to the configured URL');
select ok(
  (select q.headers ->> 'x-push-dispatch-token' ~ '^[0-9a-f]{64}$'
          and exists (select 1 from public.push_dispatch_tokens t
                      where t.token_hash = extensions.digest(q.headers ->> 'x-push-dispatch-token', 'sha256'))
   from net.http_request_queue q
   where q.url = 'http://127.0.0.1:9/functions/v1/push-dispatch' limit 1),
  'C3 the request carries a fresh 256-bit token, stored server-side only as its sha256');

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('5d550000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', now(), now(), 'aal1');

insert into public.push_tokens (id, user_id, session_id, transport, token) values
  ('7d000000-0000-4000-8000-00000000000a', '55555555-5555-4555-8555-555555555555',
   '5d550000-0000-4000-8000-000000000001', 'fcm', 'tok-live'),
  ('7d000000-0000-4000-8000-00000000000b', '55555555-5555-4555-8555-555555555555',
   '5d550000-0000-4000-8000-0000000000de', 'fcm', 'tok-dead-session'),
  ('7d000000-0000-4000-8000-00000000000c', '55555555-5555-4555-8555-555555555555',
   '5d550000-0000-4000-8000-000000000001', 'web-push', 'tok-web');

insert into public.notification_outbox (id, kind, source_id, venue_id, recipient_user_id, dedupe_key, payload)
values
  ('9d000000-0000-7000-8000-000000000001', 'guest_request_created', gen_random_uuid(),
   'aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'pgtap:1', '{"kind":"guest_request_created"}'),
  ('9d000000-0000-7000-8000-000000000002', 'guest_request_created', gen_random_uuid(),
   'aa000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 'pgtap:2', '{"kind":"guest_request_created"}');
select is(pg_temp.queued(), 2, 'C4 an outbox insert wakes the function once per statement');

insert into public.notification_outbox (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload)
values ('guest_request_created', gen_random_uuid(), 'aa000000-0000-7000-8000-000000000001',
        '55555555-5555-4555-8555-555555555555', 'pgtap:1', '{}')
on conflict (dedupe_key, recipient_user_id) do nothing;
select is(pg_temp.queued(), 2, 'C5 a dedupe hit inserts nothing and wakes nothing');

-- The token the latest kick actually sent, as an attacker reading the queue
-- (or the real function) would see it.
select set_config('pgtap.tok', (
  select headers ->> 'x-push-dispatch-token' from net.http_request_queue
  where url = 'http://127.0.0.1:9/functions/v1/push-dispatch' order by id desc limit 1), true);

-- Extra tokens for the later claims (known plaintexts, stored hashed like
-- kick_push_dispatch does), plus one past its 10-minute lifetime.
insert into public.push_dispatch_tokens (token_hash, created_at)
select extensions.digest(t, 'sha256'), c
from (values ('pgtap-token-2', now()), ('pgtap-token-3', now()), ('pgtap-token-4', now()),
             ('pgtap-token-5', now()), ('pgtap-expired', now() - interval '11 minutes')) v (t, c);

select pg_temp.as_service();
select throws_ok($$select * from public.claim_push_outbox(repeat('cd', 32), 10)$$,
  '42501', null, 'C6 claim refuses a token that was never issued');
select throws_ok($$select * from public.claim_push_outbox(null, 10)$$,
  '42501', null, 'C7 claim refuses a missing token');
select throws_ok($$select * from public.claim_push_outbox('pgtap-expired', 10)$$,
  '42501', null, 'C8 claim refuses an expired token');

create temp table claimed on commit drop as
  select * from public.claim_push_outbox(current_setting('pgtap.tok'), 10);

select is((select count(*)::int from claimed), 2, 'C9 the sent token claims both due rows');
select is(
  (select tokens from claimed where id = '9d000000-0000-7000-8000-000000000001'),
  '[{"id": "7d000000-0000-4000-8000-00000000000a", "token": "tok-live"}]'::jsonb,
  'C10 only FCM tokens on a LIVE session are handed out (dead session and web-push excluded)');
select is(
  (select tokens from claimed where id = '9d000000-0000-7000-8000-000000000002'),
  '[]'::jsonb, 'C11 a recipient without devices gets an empty token list');
select throws_ok($$select * from public.claim_push_outbox(current_setting('pgtap.tok'), 10)$$,
  '42501', null, 'C12 a token works once: replaying it is refused');
select is((select count(*)::int from public.claim_push_outbox('pgtap-token-2', 10)), 0,
  'C13 a claimed row is not handed out twice');

reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  (select status || '/' || attempts || '/' || (locked_at is not null)
   from public.notification_outbox where id = '9d000000-0000-7000-8000-000000000001'),
  'sending/1/true', 'C14 claiming moves the row to sending, counts the attempt and locks it');

-- ---------------------------------------------------------------------------
-- D. complete_push_outbox state machine
-- ---------------------------------------------------------------------------
select pg_temp.as_service();

select is(public.complete_push_outbox('9d000000-0000-7000-8000-000000000001', 'retry', 'fcm:UNAVAILABLE'),
  'pending', 'D1 a transient failure goes back to pending');
select is(
  (select (next_attempt_at between now() + interval '1 minute' and now() + interval '3 minutes')
          and last_error = 'fcm:UNAVAILABLE' and locked_at is null
   from public.notification_outbox where id = '9d000000-0000-7000-8000-000000000001'),
  true, 'D2 …with exponential backoff (2 min after attempt 1), the error code, and the lock released');
select is((select count(*)::int from public.claim_push_outbox('pgtap-token-3', 10)), 0,
  'D3 a backed-off row is not claimable yet');

select is(public.complete_push_outbox('9d000000-0000-7000-8000-000000000002', 'sent', null),
  'sent', 'D4 a delivered row is marked sent');
select is(public.complete_push_outbox('9d000000-0000-7000-8000-000000000002', 'retry', 'late'),
  null, 'D5 only a row in sending can be completed (no resurrecting a sent row)');
select throws_ok($$select public.complete_push_outbox('9d000000-0000-7000-8000-000000000002', 'bogus', null)$$,
  '22023', null, 'D6 unknown outcomes are rejected');

reset role;
select set_config('request.jwt.claims', '{}', true);
update public.notification_outbox set attempts = 4, next_attempt_at = now() - interval '1 second'
where id = '9d000000-0000-7000-8000-000000000001';

select pg_temp.as_service();
select is((select attempts from public.claim_push_outbox('pgtap-token-4', 10)), 5,
  'D7 the fifth attempt is claimed');
select is(public.complete_push_outbox('9d000000-0000-7000-8000-000000000001', 'retry', 'fcm:UNAVAILABLE'),
  'failed', 'D8 a retry after the fifth attempt is terminal');

-- ---------------------------------------------------------------------------
-- E. Token pruning (FCM said UNREGISTERED)
-- ---------------------------------------------------------------------------
select is(public.prune_push_tokens(array['7d000000-0000-4000-8000-00000000000a']::uuid[]), 1,
  'E1 prune_push_tokens deletes the reported device row');

reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- F. Sweep: rows a crashed invocation left in sending
-- ---------------------------------------------------------------------------
insert into public.notification_outbox
  (id, kind, source_id, venue_id, recipient_user_id, dedupe_key, payload, status, attempts, locked_at, next_attempt_at)
values
  ('9d000000-0000-7000-8000-000000000003', 'guest_request_created', gen_random_uuid(),
   'aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'pgtap:3', '{}',
   'sending', 2, now() - interval '10 minutes', now() - interval '10 minutes'),
  ('9d000000-0000-7000-8000-000000000004', 'guest_request_created', gen_random_uuid(),
   'aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'pgtap:4', '{}',
   'sending', 5, now() - interval '10 minutes', now() - interval '10 minutes'),
  ('9d000000-0000-7000-8000-000000000005', 'guest_request_created', gen_random_uuid(),
   'aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'pgtap:5', '{}',
   'sending', 1, now() - interval '1 minute', now() - interval '1 minute');

select is(public.push_outbox_sweep(), 1, 'F1 the sweep reports the one row it made due again');
select is(
  (select array_agg(status order by id) from public.notification_outbox
   where id in ('9d000000-0000-7000-8000-000000000003', '9d000000-0000-7000-8000-000000000004',
                '9d000000-0000-7000-8000-000000000005')),
  array['pending', 'failed', 'sending'],
  'F2 stuck rows go back to pending (or failed at the attempt cap); a fresh claim is left alone');
select is(
  (select array_agg(t order by t) from (values ('pgtap-token-5'), ('pgtap-expired')) v (t)
   where exists (select 1 from public.push_dispatch_tokens d where d.token_hash = extensions.digest(t, 'sha256'))),
  array['pgtap-token-5'],
  'F3 the sweep drops expired invocation tokens and keeps fresh unused ones');

-- ---------------------------------------------------------------------------
-- G. TTL: 90 days unseen, or bound to a session that is gone
-- ---------------------------------------------------------------------------
insert into public.push_tokens (id, user_id, session_id, transport, token, last_seen_at) values
  ('7d000000-0000-4000-8000-00000000000d', '55555555-5555-4555-8555-555555555555',
   '5d550000-0000-4000-8000-000000000001', 'fcm', 'tok-old', now() - interval '91 days'),
  ('7d000000-0000-4000-8000-00000000000e', '55555555-5555-4555-8555-555555555555',
   '5d550000-0000-4000-8000-000000000001', 'fcm', 'tok-fresh', now() - interval '89 days');

insert into public.notification_outbox
  (id, kind, source_id, venue_id, recipient_user_id, dedupe_key, payload, status, created_at)
values
  ('9d000000-0000-7000-8000-000000000006', 'guest_request_created', gen_random_uuid(),
   'aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'pgtap:6', '{}',
   'sent', now() - interval '31 days'),
  ('9d000000-0000-7000-8000-000000000007', 'guest_request_created', gen_random_uuid(),
   'aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'pgtap:7', '{}',
   'pending', now() - interval '31 days');

select is(public.prune_stale_push_tokens(), 2,
  'G1 the TTL sweep removes the 91-day-old token and the dead-session token');
select is(
  (select array_agg(token order by token) from public.push_tokens
   where user_id = '55555555-5555-4555-8555-555555555555'),
  array['tok-fresh', 'tok-web'],
  'G2 recent tokens on a live session survive');
select is(
  (select array_agg(id order by id) from public.notification_outbox
   where id in ('9d000000-0000-7000-8000-000000000006', '9d000000-0000-7000-8000-000000000007')),
  array['9d000000-0000-7000-8000-000000000007'::uuid],
  'G3 finished outbox rows older than 30 days are dropped; unfinished ones are kept');

select * from finish();
rollback;
