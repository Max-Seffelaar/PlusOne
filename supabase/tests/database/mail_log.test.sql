-- pgTAP — mail_log + resend_webhook_events (Mail-infra F0, z8uq9m2yvt),
-- 20261007130000_mail_log.sql.
--
-- Threat model (CLAUDE.md #1): the anon/auth key ships to the browser, so every
-- claim has to hold against raw PostgREST calls. Footholds:
--   * a venue admin / staff member of venue A who wants to read who got mailed
--     (their own venue or another), forge a delivery status, or replay a
--     webhook event through the RPC;
--   * anon, with nothing but the public key;
--   * the webhook route itself, replaying a delivery (Svix retries) or
--     receiving events out of order.
--
-- This file proves:
--   A. grants: anon holds nothing; authenticated holds SELECT on mail_log only
--      and nothing on the ledger; no app role (service_role included) writes
--      either table directly; the three RPCs are service_role-only;
--   B. the sender RPCs: log_mail_attempt validates type/hash, record_mail_send_result
--      settles a queued row exactly once;
--   C. the webhook RPC: applies a status, a replay returns false and mutates
--      nothing, status only moves forward, an unknown message id is ledgered
--      and touches nothing;
--   D. RLS reads: platform admin sees rows; a venue admin of that very venue,
--      staff and anon see nothing; direct writes are refused;
--   E. rows go with their venue (on delete cascade).
--
-- Everything rolls back.

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

create function pg_temp.login_service()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner)
-- ---------------------------------------------------------------------------
-- admin@ (1111…) is venue admin at Club Vesper (aa…01) and De Marktzaal
-- (aa…02), NOT a platform admin; staff@ (5555…) is staff at Club Vesper.
-- One extra platform admin without any membership.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999',
  'authenticated', 'authenticated', 'platform@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "Joeri Platform"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);
insert into public.user_profiles (id, full_name, email)
values ('99999999-9999-4999-8999-999999999999', 'Joeri Platform', 'platform@plusone.test');
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = '99999999-9999-4999-8999-999999999999';
select set_config('plusone.platform_admin_write', 'off', true);

insert into public.venues (id, name, slug) values
  ('ac000000-0000-7000-8000-0000000000c2', 'Cascade Mail Club', 'cascade-mail-club');

create temp table ids (k text primary key, id uuid);
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- A. Grants
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.mail_log', 'SELECT')
  and not has_table_privilege('anon', 'public.mail_log', 'INSERT')
  and not has_table_privilege('anon', 'public.resend_webhook_events', 'SELECT'),
  'A1 anon holds nothing on mail_log or the ledger'
);
select ok(
  has_table_privilege('authenticated', 'public.mail_log', 'SELECT')
  and not has_table_privilege('authenticated', 'public.mail_log', 'INSERT')
  and not has_table_privilege('authenticated', 'public.mail_log', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.mail_log', 'DELETE'),
  'A2 authenticated holds SELECT only on mail_log'
);
select ok(
  not has_table_privilege('authenticated', 'public.resend_webhook_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.resend_webhook_events', 'INSERT'),
  'A3 authenticated holds nothing on the webhook ledger'
);
select ok(
  not has_table_privilege('service_role', 'public.mail_log', 'INSERT')
  and not has_table_privilege('service_role', 'public.mail_log', 'UPDATE')
  and not has_table_privilege('service_role', 'public.resend_webhook_events', 'INSERT'),
  'A4 service_role has no direct write either: the definer RPCs are the only path'
);
select ok(
  not has_function_privilege('authenticated', 'public.log_mail_attempt(text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_mail_send_result(uuid, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_resend_webhook_event(text, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_resend_webhook_event(text, text, text)', 'EXECUTE'),
  'A5 no app role executes the mail RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.log_mail_attempt(text, uuid, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_mail_send_result(uuid, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.apply_resend_webhook_event(text, text, text)', 'EXECUTE'),
  'A6 service_role executes all three'
);

-- A venue admin calling the RPCs over PostgREST is refused.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.apply_resend_webhook_event('msg_forged', 'email.delivered', 're_x') $$,
  '42501', null, 'A7 a venue admin cannot replay/forge a webhook event through the RPC');
select throws_ok(
  $$ select public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001', repeat('a', 64)) $$,
  '42501', null, 'A8 a venue admin cannot write a mail_log row through the RPC');
reset role;

-- ---------------------------------------------------------------------------
-- B. Sender RPCs (as service_role)
-- ---------------------------------------------------------------------------

select pg_temp.login_service();

insert into ids select 'a', public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001', repeat('a', 64));
insert into ids select 'b', public.log_mail_attempt('team_resend', 'aa000000-0000-7000-8000-000000000002', repeat('b', 64));
insert into ids select 'c', public.log_mail_attempt('team_added_to_event', 'ac000000-0000-7000-8000-0000000000c2', repeat('c', 64));
reset role;

select is((select status from public.mail_log where id = (select id from ids where k = 'a')), 'queued',
  'B1 log_mail_attempt writes a queued row');
select is((select count(*)::int from public.mail_log where id in (select id from ids)), 3,
  'B2 three rows logged');

select pg_temp.login_service();
select throws_ok(
  $$ select public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001', 'crew@example.test') $$,
  '23514', null, 'B3 a plaintext address is not a recipient hash (check constraint)');
select throws_ok(
  $$ select public.log_mail_attempt('guest_marketing', 'aa000000-0000-7000-8000-000000000001', repeat('4', 64)) $$,
  '23514', null, 'B4 an unknown mail type is refused');

select is(
  public.record_mail_send_result((select id from ids where k = 'a'), 'sent', 're_aaa', null), true,
  'B5 record_mail_send_result settles a queued row');
select is(
  public.record_mail_send_result((select id from ids where k = 'a'), 'failed', null, 'timeout'), false,
  'B6 a second settle of the same row is a no-op');
select is(
  public.record_mail_send_result((select id from ids where k = 'b'), 'failed', null, 'daily_quota_exceeded'), true,
  'B7 a quota failure settles as failed');
select is(
  public.record_mail_send_result((select id from ids where k = 'c'), 'sent', 're_ccc', null), true,
  'B8 row c sent');
select throws_ok(
  $$ select public.record_mail_send_result((select id from ids where k = 'b'), 'delivered', null, null) $$,
  '22023', null, 'B9 the sender cannot claim a delivery status');
insert into ids select 'e', public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001', repeat('e', 64));
select throws_ok(
  $$ select public.record_mail_send_result((select id from ids where k = 'e'), 'failed', null, 'Mail to crew@example.test bounced') $$,
  '23514', null, 'B10 an error "code" carrying free text (an address) is refused');
reset role;

select is(
  (select row(status, provider_message_id, error_code)::text from public.mail_log where id = (select id from ids where k = 'a')),
  '(sent,re_aaa,)', 'B11 row a: sent, provider id stamped, no error code');
select is(
  (select row(status, provider_message_id, error_code)::text from public.mail_log where id = (select id from ids where k = 'b')),
  '(failed,,daily_quota_exceeded)', 'B12 row b: failed with the quota code, no provider id');

-- ---------------------------------------------------------------------------
-- T. Send limits in log_mail_attempt (review of PR #413)
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select throws_ok(
  $$ select public.log_mail_attempt('team_resend', 'aa000000-0000-7000-8000-000000000001', repeat('a', 64)) $$,
  'PM429', null, 'T1 a second mail to the same recipient within 60 s is refused');
reset role;
select is((select count(*)::int from public.mail_log where recipient_hash = repeat('a', 64)), 1,
  'T2 ...and logs nothing');

-- 61 s later (backdated as owner) the same recipient may be mailed again.
update public.mail_log set created_at = now() - interval '61 seconds' where recipient_hash = repeat('a', 64);
select pg_temp.login_service();
select lives_ok(
  $$ select public.log_mail_attempt('team_resend', 'aa000000-0000-7000-8000-000000000001', repeat('a', 64)) $$,
  'T3 after the 60 s window the same recipient is allowed again');
reset role;

-- Venue daily cap: fill De Marktzaal (aa…02, already 1 row today) up to 50.
insert into public.mail_log (type, venue_id, recipient_hash)
select 'team_join', 'aa000000-0000-7000-8000-000000000002', encode(extensions.digest('cap' || i, 'sha256'), 'hex')
  from generate_series(1, public.mail_venue_daily_cap() - 1) as i;
select pg_temp.login_service();
select throws_ok(
  $$ select public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000002', repeat('f', 64)) $$,
  'PM429', null, 'T4 a venue at its daily cap is refused, even for a fresh recipient');
select lives_ok(
  $$ select public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001', repeat('f', 64)) $$,
  'T5 another venue is not affected by that cap');
reset role;

-- Yesterday's rows do not count toward today's cap.
update public.mail_log set created_at = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '1 hour'
 where venue_id = 'aa000000-0000-7000-8000-000000000002' and recipient_hash <> repeat('b', 64);
select pg_temp.login_service();
select lives_ok(
  $$ select public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000002', repeat('9', 64)) $$,
  'T6 the cap resets per UTC day');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.mail_venue_daily_cap()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mail_recipient_window()', 'EXECUTE'),
  'T7 the limit constants are not callable by app roles');

-- ---------------------------------------------------------------------------
-- C. Webhook RPC (as service_role)
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select is(public.apply_resend_webhook_event('msg_1', 'email.delivered', 're_aaa'), true,
  'C1 a first delivery applies');
reset role;
select is((select status from public.mail_log where id = (select id from ids where k = 'a')), 'delivered',
  'C2 row a is delivered');

create temp table snap as select id, status, updated_at from public.mail_log;
grant all on snap to public;
select pg_temp.login_service();
select is(public.apply_resend_webhook_event('msg_1', 'email.complained', 're_aaa'), false,
  'C3 a replay of the same Svix id returns false (even with a different type)');
reset role;
select is(
  (select count(*)::int from public.mail_log m join snap s using (id)
    where m.status is distinct from s.status or m.updated_at is distinct from s.updated_at), 0,
  'C4 the replay mutated nothing');
select is((select count(*)::int from public.resend_webhook_events where id = 'msg_1'), 1,
  'C5 the ledger holds the Svix id once');

select pg_temp.login_service();
select is(public.apply_resend_webhook_event('msg_2', 'email.delivery_delayed', 're_aaa'), true,
  'C6 a late delivery_delayed is ledgered');
reset role;
select is((select status from public.mail_log where id = (select id from ids where k = 'a')), 'delivered',
  'C7 status does not move backwards (delivered stays delivered)');

select pg_temp.login_service();
select is(public.apply_resend_webhook_event('msg_3', 'email.bounced', 're_ccc'), true, 'C8 bounce applies');
reset role;
select is((select status from public.mail_log where id = (select id from ids where k = 'c')), 'bounced',
  'C9 row c is bounced');

create temp table snap2 as select id, status, updated_at from public.mail_log;
grant all on snap2 to public;
select pg_temp.login_service();
select is(public.apply_resend_webhook_event('msg_4', 'email.delivered', 're_unknown_auth_mail'), true,
  'C10 an event for a message we never logged (auth SMTP mail) is accepted');
reset role;
select is(
  (select count(*)::int from public.mail_log m join snap2 s using (id)
    where m.status is distinct from s.status or m.updated_at is distinct from s.updated_at), 0,
  'C11 ...and touches no mail_log row');

select pg_temp.login_service();
select throws_ok(
  $$ select public.apply_resend_webhook_event(null, 'email.delivered', 're_aaa') $$,
  '22004', null, 'C12 a missing event id is refused');
reset role;

-- ---------------------------------------------------------------------------
-- D. RLS reads + direct writes
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select is((select count(*)::int from public.mail_log where id in (select id from ids)), 4,
  'D1 a platform admin reads mail_log across venues');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.mail_log), 0,
  'D2 a venue admin reads nothing, not even their own venue''s rows');
select throws_ok(
  $$ insert into public.mail_log (type, venue_id, recipient_hash)
     values ('team_join', 'aa000000-0000-7000-8000-000000000001', repeat('d', 64)) $$,
  '42501', null, 'D3 a venue admin cannot insert into mail_log');
select throws_ok(
  $$ update public.mail_log set status = 'delivered' $$,
  '42501', null, 'D4 a venue admin cannot update a status');
select throws_ok(
  $$ select count(*) from public.resend_webhook_events $$,
  '42501', null, 'D5 a venue admin cannot read the webhook ledger');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.mail_log), 0, 'D6 staff reads nothing');
reset role;

select pg_temp.login_anon();
select throws_ok($$ select count(*) from public.mail_log $$, '42501', null, 'D7 anon cannot read mail_log');
reset role;

-- ---------------------------------------------------------------------------
-- E. Cascade
-- ---------------------------------------------------------------------------

delete from public.venues where id = 'ac000000-0000-7000-8000-0000000000c2';
select is((select count(*)::int from public.mail_log where id = (select id from ids where k = 'c')), 0,
  'E1 rows go with their venue');

select * from finish();
rollback;
