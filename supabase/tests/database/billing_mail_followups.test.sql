-- pgTAP — billing-mail follow-ups (z8uq9m49k4, review #446 nit D1),
-- 20261015150000_billing_mail_unknown_outcome.sql.
--
--   A. A mail whose send ended in a Resend 409 (error_code
--      'idempotency_conflict') is never retried: log_billing_mail returns NULL,
--      so no second mail can follow under a new or the same key.
--   B. The Platform timeline counts it as `unknown`, not `failed`; a real
--      failure (provider_rejected) still counts as `failed`.
--   C. Grants on the re-created RPC unchanged: authenticated only, the
--      platform-admin check inside (42501 for the company's own admin).
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.login_service() returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

select plan(8);

-- Fixtures (as owner): platform admin 9999; trialing company F1 with admin@
-- (1111) and finance@ (3333) as billing recipients.
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
  ('bf000000-0000-7000-8000-0000000000f1', 'Followup One', 'followup-one');
insert into public.subscriptions (venue_id, status, plan_id, created_at) values
  ('bf000000-0000-7000-8000-0000000000f1', 'trialing', 'pro', now() - interval '1 hour');
insert into public.venue_memberships (venue_id, user_id, roles) values
  ('bf000000-0000-7000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '{admin}'),
  ('bf000000-0000-7000-8000-0000000000f1', '33333333-3333-4333-8333-333333333333', '{finance}');

-- ---------------------------------------------------------------------------
-- A. A 409 is never retried
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select set_config('test.m_admin', public.log_billing_mail('bf000000-0000-7000-8000-0000000000f1',
  'billing_trial_day0', 'billing_trial_day0', '11111111-1111-4111-8111-111111111111')::text, true);
select set_config('test.m_fin', public.log_billing_mail('bf000000-0000-7000-8000-0000000000f1',
  'billing_trial_day0', 'billing_trial_day0', '33333333-3333-4333-8333-333333333333')::text, true);
select ok(public.record_mail_send_result(current_setting('test.m_admin')::uuid, 'failed', null, 'idempotency_conflict'),
  'A1 the admin''s send is settled as an idempotency conflict (Resend 409)');
select is(public.log_billing_mail('bf000000-0000-7000-8000-0000000000f1',
  'billing_trial_day0', 'billing_trial_day0', '11111111-1111-4111-8111-111111111111'), null,
  'A2 …and is never retried: the first attempt may have been delivered');
select ok(public.record_mail_send_result(current_setting('test.m_fin')::uuid, 'failed', null, 'provider_rejected'),
  'A3 the finance send is settled as a real rejection');
reset role;

-- ---------------------------------------------------------------------------
-- B. Timeline: unknown vs failed
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select set_config('test.tl', public.platform_billing_mail_timeline('bf000000-0000-7000-8000-0000000000f1')::text, true);
reset role;

select is(
  (select (m ->> 'unknown')::int from jsonb_array_elements(current_setting('test.tl')::jsonb -> 'mails') m
    where m ->> 'dedupe_key' = 'billing_trial_day0'),
  1, 'B1 the 409 counts as unknown');
select is(
  (select (m ->> 'failed')::int from jsonb_array_elements(current_setting('test.tl')::jsonb -> 'mails') m
    where m ->> 'dedupe_key' = 'billing_trial_day0'),
  1, 'B2 only the real rejection counts as failed');
select is(
  (select (m ->> 'recipients')::int from jsonb_array_elements(current_setting('test.tl')::jsonb -> 'mails') m
    where m ->> 'dedupe_key' = 'billing_trial_day0'),
  2, 'B3 recipients still counts both');

-- ---------------------------------------------------------------------------
-- C. Grants and the platform-admin check unchanged
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.platform_billing_mail_timeline(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.platform_billing_mail_timeline(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.platform_billing_mail_timeline(uuid)', 'EXECUTE'),
  'C1 the re-created timeline RPC: authenticated only');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.platform_billing_mail_timeline('bf000000-0000-7000-8000-0000000000f1') $$,
  '42501', null, 'C2 the company''s own admin still gets 42501');
reset role;

select * from finish();
rollback;
