-- pgTAP — Billing-mails B1 (z8uq9m2z19), 20261012180000_billing_mail_types.sql.
--
-- Proves, per role and with the database state asserted:
--   A. Grants: the four tables closed to every app role (service_role too);
--      the job/webhook RPCs service_role only; the Platform RPCs
--      authenticated only (platform-admin check inside); helpers owner-only.
--   B. Token: billing_mails_begin refuses an unknown, reused or expired token
--      (42501) and consumes a valid one.
--   C. begin: trialing companies near a mail moment (the seed-style trials
--      created 7, 12, 14 and 21 days before their mail), never comped, never
--      paused.
--   D. log_billing_mail: only admin/finance of THAT company (manager, staff,
--      another company's admin: 42501); once per company per trial type (a
--      second call is NULL, a failed attempt may be retried); the trial needs
--      a trialing company (55000); keys and types validated (22023); the
--      recipient hash is the sha256 of the login address; comped: 42501.
--   E. Stripe: a webhook replay queues nothing twice — enqueue only for an
--      event in stripe_webhook_events, keyed per event; every new event gets
--      its own mail; stale, old, wrong-type, unknown-customer, comped: none.
--   F. Invitation limits: billing mails never count toward the company cap or
--      the 60-second recipient window; log_mail_attempt refuses them.
--   G. Platform: timeline + pause are platform-admin only (manager@ and the
--      company's own admin get 42501); pausing stops begin and log.
--   H. Sleeping job: without the Vault URL the kick mints nothing.
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

-- A token the job would receive: inserted as owner, returned in clear.
create function pg_temp.mint(p_age interval default interval '0') returns text
language plpgsql as $fn$
declare
  v text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.billing_mail_tokens (token_hash, created_at)
  values (extensions.digest(v, 'sha256'), now() - p_age);
  return v;
end;
$fn$;

select plan(70);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner)
-- ---------------------------------------------------------------------------
-- Seed: admin@ 1111 (admin at aa…01 comped and aa…02 trialing), manager@
-- 2222 (user_manager at aa…01), finance@ 3333 (finance at aa…01), staff@ 5555.
-- Added here: platform admin 9999 (no membership); company B3 (trialing,
-- admin 1111 + finance 3333 + user_manager 2222 + staff 5555, Stripe customer
-- cus_bm3); four trials T7/T12/T14/T21 whose mail moment is one hour ago.

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
  ('bb000000-0000-7000-8000-0000000000b3', 'Billing Three', 'billing-three'),
  ('bb000000-0000-7000-8000-0000000000d7', 'Trial Seven', 'trial-seven'),
  ('bb000000-0000-7000-8000-0000000000d2', 'Trial Twelve', 'trial-twelve'),
  ('bb000000-0000-7000-8000-0000000000d4', 'Trial Fourteen', 'trial-fourteen'),
  ('bb000000-0000-7000-8000-0000000000d1', 'Trial TwentyOne', 'trial-twentyone'),
  ('bb000000-0000-7000-8000-0000000000e9', 'Long Ago', 'long-ago');

-- Default 14-day trials, created so each mail moment lies 1 hour ago:
-- day 7 = created 7 d ago, day 12 = 12 d, ended = 14 d, day 21 = 21 d.
insert into public.subscriptions (venue_id, status, plan_id, created_at, stripe_customer_id) values
  ('bb000000-0000-7000-8000-0000000000b3', 'trialing', 'pro', now() - interval '3 days', 'cus_bm3'),
  ('bb000000-0000-7000-8000-0000000000d7', 'trialing', 'pro', now() - interval '7 days 1 hour', null),
  ('bb000000-0000-7000-8000-0000000000d2', 'trialing', 'pro', now() - interval '12 days 1 hour', null),
  ('bb000000-0000-7000-8000-0000000000d4', 'trialing', 'pro', now() - interval '14 days 1 hour', null),
  ('bb000000-0000-7000-8000-0000000000d1', 'trialing', 'pro', now() - interval '21 days 1 hour', null),
  ('bb000000-0000-7000-8000-0000000000e9', 'trialing', 'pro', now() - interval '60 days', null);

insert into public.venue_memberships (venue_id, user_id, roles) values
  ('bb000000-0000-7000-8000-0000000000b3', '11111111-1111-4111-8111-111111111111', '{admin}'),
  ('bb000000-0000-7000-8000-0000000000b3', '33333333-3333-4333-8333-333333333333', '{finance}'),
  ('bb000000-0000-7000-8000-0000000000b3', '22222222-2222-4222-8222-222222222222', '{user_manager}'),
  ('bb000000-0000-7000-8000-0000000000b3', '55555555-5555-4555-8555-555555555555', '{staff}'),
  ('bb000000-0000-7000-8000-0000000000d7', '11111111-1111-4111-8111-111111111111', '{admin}'),
  ('bb000000-0000-7000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', '{admin}'),
  ('bb000000-0000-7000-8000-0000000000d4', '11111111-1111-4111-8111-111111111111', '{admin}'),
  ('bb000000-0000-7000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', '{admin}');

-- ---------------------------------------------------------------------------
-- A. Grants
-- ---------------------------------------------------------------------------

select is_empty($$
  select t || ':' || r || ':' || p
    from unnest(array['billing_mail_settings', 'billing_mail_events', 'billing_mail_deliveries', 'billing_mail_tokens']) t
   cross join unnest(array['anon', 'authenticated', 'service_role']) r
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.' || t, p)
$$, 'A1 the four billing-mail tables are closed to anon, authenticated and service_role');

select ok(
  (select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('public.billing_mail_settings'::regclass, 'public.billing_mail_events'::regclass,
                    'public.billing_mail_deliveries'::regclass, 'public.billing_mail_tokens'::regclass)),
  'A2 RLS is enabled on all four');

select is_empty($$
  select f || ':' || r
    from unnest(array[
      'public.enqueue_billing_event_mail(text, text, timestamptz)',
      'public.billing_mails_begin(text)',
      'public.billing_mail_recipients(uuid)',
      'public.log_billing_mail(uuid, text, text, uuid)']) f
   cross join unnest(array['anon', 'authenticated']) r
   where has_function_privilege(r, f, 'EXECUTE')
$$, 'A3 the job/webhook RPCs are not executable by anon or authenticated');

select ok(
  has_function_privilege('service_role', 'public.enqueue_billing_event_mail(text, text, timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.billing_mails_begin(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.billing_mail_recipients(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.log_billing_mail(uuid, text, text, uuid)', 'EXECUTE'),
  'A4 service_role executes the job/webhook RPCs');

select ok(
  has_function_privilege('authenticated', 'public.platform_billing_mail_timeline(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_billing_mails_paused(uuid, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.platform_billing_mail_timeline(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.set_billing_mails_paused(uuid, boolean)', 'EXECUTE'),
  'A5 the Platform RPCs: authenticated only (the check is inside)');

select is_empty($$
  select f || ':' || r
    from unnest(array[
      'public.billing_mail_blocked(uuid)', 'public.billing_mail_recipient_rows(uuid)',
      'public.billing_mails_setting(text)', 'public.kick_billing_mails()', 'public.billing_mails_tick()']) f
   cross join unnest(array['anon', 'authenticated', 'service_role']) r
   where has_function_privilege(r, f, 'EXECUTE')
$$, 'A6 helpers, kick and tick are owner-only');

-- ---------------------------------------------------------------------------
-- B. Token
-- ---------------------------------------------------------------------------

select set_config('test.token', pg_temp.mint(), true);
select set_config('test.old_token', pg_temp.mint(interval '11 minutes'), true);

select pg_temp.login_service();
select throws_ok($$ select public.billing_mails_begin(repeat('0', 64)) $$, '42501', null,
  'B1 an unknown token is refused');
select throws_ok($$ select public.billing_mails_begin(current_setting('test.old_token')) $$, '42501', null,
  'B2 a token older than 10 minutes is refused');
select set_config('test.begin', public.billing_mails_begin(current_setting('test.token'))::text, true);
select ok(current_setting('test.begin')::jsonb ? 'trials', 'B3 a fresh token opens a run');
select throws_ok($$ select public.billing_mails_begin(current_setting('test.token')) $$, '42501', null,
  'B4 the same token a second time is refused (single use)');
reset role;

-- ---------------------------------------------------------------------------
-- C. begin content
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(t ->> 'venue_id' order by t ->> 'venue_id')
     from jsonb_array_elements(current_setting('test.begin')::jsonb -> 'trials') t
    where t ->> 'venue_id' like 'bb%'),
  array['bb000000-0000-7000-8000-0000000000d1',
        'bb000000-0000-7000-8000-0000000000d2', 'bb000000-0000-7000-8000-0000000000d4',
        'bb000000-0000-7000-8000-0000000000d7'],
  'C1 the trials near a mail moment are in (T7, T12, T14, T21); B3 (day 3) and the 60-day-old one are not');

select ok(
  not exists (select 1 from jsonb_array_elements(current_setting('test.begin')::jsonb -> 'trials') t
               where t ->> 'venue_id' = 'aa000000-0000-7000-8000-000000000001'),
  'C2 the comped seed company is never in a run');

select is(
  (select (t ->> 'trial_ends_at')::timestamptz
     from jsonb_array_elements(current_setting('test.begin')::jsonb -> 'trials') t
    where t ->> 'venue_id' = 'bb000000-0000-7000-8000-0000000000d4'),
  (select created_at + interval '14 days' from public.subscriptions
    where venue_id = 'bb000000-0000-7000-8000-0000000000d4'),
  'C3 trial_ends_at is the effective end (created_at + 14 days without override)');

select ok(
  (select bool_and(t ? 'venue_id' and t ? 'created_at' and t ? 'trial_ends_at' and t ? 'stripe_linked'
                   and not t ? 'email')
     from jsonb_array_elements(current_setting('test.begin')::jsonb -> 'trials') t),
  'C4 begin carries facts only, no address');

-- ---------------------------------------------------------------------------
-- D. log_billing_mail — one run over the four seed-style trials, then again
-- ---------------------------------------------------------------------------

select pg_temp.login_service();

select set_config('test.m7', public.log_billing_mail('bb000000-0000-7000-8000-0000000000d7',
  'billing_trial_day7', 'billing_trial_day7', '11111111-1111-4111-8111-111111111111')::text, true);
select set_config('test.m12', public.log_billing_mail('bb000000-0000-7000-8000-0000000000d2',
  'billing_trial_day12', 'billing_trial_day12', '11111111-1111-4111-8111-111111111111')::text, true);
select set_config('test.m14', public.log_billing_mail('bb000000-0000-7000-8000-0000000000d4',
  'billing_trial_ended', 'billing_trial_ended', '11111111-1111-4111-8111-111111111111')::text, true);
select set_config('test.m21', public.log_billing_mail('bb000000-0000-7000-8000-0000000000d1',
  'billing_trial_day21', 'billing_trial_day21', '11111111-1111-4111-8111-111111111111')::text, true);

select ok(current_setting('test.m7') <> '' and current_setting('test.m12') <> ''
          and current_setting('test.m14') <> '' and current_setting('test.m21') <> '',
  'D1 first run: one mail per company, each with its own type, gets a mail_log id');

select is(public.log_billing_mail('bb000000-0000-7000-8000-0000000000d7',
  'billing_trial_day7', 'billing_trial_day7', '11111111-1111-4111-8111-111111111111'), null,
  'D2 second run: the same company + type + recipient gets NULL (nothing to send)');
select is(public.log_billing_mail('bb000000-0000-7000-8000-0000000000d1',
  'billing_trial_day21', 'billing_trial_day21', '11111111-1111-4111-8111-111111111111'), null,
  'D3 …for every type');

-- A failed attempt (nothing left the building) may be retried; a sent one not.
select ok(public.record_mail_send_result(current_setting('test.m12')::uuid, 'failed', null, 'timeout'),
  'D4 settle the day-12 mail as failed');
select set_config('test.m12b', public.log_billing_mail('bb000000-0000-7000-8000-0000000000d2',
  'billing_trial_day12', 'billing_trial_day12', '11111111-1111-4111-8111-111111111111')::text, true);
select ok(current_setting('test.m12b') <> '' and current_setting('test.m12b') <> current_setting('test.m12'),
  'D5 a failed attempt is retried with a new mail_log row');
select ok(public.record_mail_send_result(current_setting('test.m12b')::uuid, 'sent', 're_m12b', null),
  'D6 the retry is settled as sent');
select is(public.log_billing_mail('bb000000-0000-7000-8000-0000000000d2',
  'billing_trial_day12', 'billing_trial_day12', '11111111-1111-4111-8111-111111111111'), null,
  'D7 …and after that it is never sent again');

-- Recipients: admin and finance of that company, nobody else.
select ok(public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_trial_day0', 'billing_trial_day0', '33333333-3333-4333-8333-333333333333') is not null,
  'D8 finance of the company is a recipient');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_trial_day0', 'billing_trial_day0', '22222222-2222-4222-8222-222222222222') $$,
  '42501', null, 'D9 a user_manager of the company is not (42501)');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_trial_day0', 'billing_trial_day0', '55555555-5555-4555-8555-555555555555') $$,
  '42501', null, 'D10 staff is not (42501)');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000d7',
  'billing_trial_day7', 'billing_trial_day7', '33333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'D11 finance of ANOTHER company is not (42501): no mail to the wrong company');
select throws_ok($$ select public.log_billing_mail('aa000000-0000-7000-8000-000000000001',
  'billing_trial_day7', 'billing_trial_day7', '11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'D12 a comped company gets nothing, even from the service role');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000d7',
  'billing_trial_day7', 'billing_trial_day12', '11111111-1111-4111-8111-111111111111') $$,
  '22023', null, 'D13 a trial mail is keyed by its own type');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000d7',
  'team_join', 'team_join', '11111111-1111-4111-8111-111111111111') $$,
  '22023', null, 'D14 only billing types pass');

-- A rejected mail (bad address) is never retried: no hourly hammering.
select ok(public.record_mail_send_result(current_setting('test.m14')::uuid, 'failed', null, 'provider_rejected'),
  'D14b settle the trial-ended mail as rejected by the provider');
select is(public.log_billing_mail('bb000000-0000-7000-8000-0000000000d4',
  'billing_trial_ended', 'billing_trial_ended', '11111111-1111-4111-8111-111111111111'), null,
  'D14c a provider_rejected mail is not retried (only transient failures are)');

reset role;
select is(
  (select m.recipient_hash from public.mail_log m where m.id = current_setting('test.m7')::uuid),
  encode(extensions.digest('admin@plusone.test', 'sha256'), 'hex'),
  'D15 mail_log holds the sha256 of the login address, never the address');
select is(
  (select m.type || ':' || m.venue_id::text || ':' || m.status from public.mail_log m
    where m.id = current_setting('test.m7')::uuid),
  'billing_trial_day7:bb000000-0000-7000-8000-0000000000d7:queued',
  'D16 type + company + queued');
select is(
  (select count(*)::int from public.billing_mail_deliveries
    where venue_id = 'bb000000-0000-7000-8000-0000000000d2' and dedupe_key = 'billing_trial_day12'),
  1, 'D17 the ledger keeps one row per company/key/recipient (the retry replaced the failed one)');

-- ---------------------------------------------------------------------------
-- E. Stripe: webhook replay is idempotent; every new event mails
-- ---------------------------------------------------------------------------

select pg_temp.login_service();

select ok(public.apply_stripe_subscription_update('evt_pf_1', 'invoice.payment_failed', null, 'cus_bm3',
  null, 'past_due', null, null, now() - interval '5 minutes'),
  'E1 the webhook applies invoice.payment_failed (ledger row written)');
select ok(public.enqueue_billing_event_mail('evt_pf_1', 'cus_bm3', now() - interval '5 minutes'),
  'E2 and queues its billing mail');
select ok(not public.apply_stripe_subscription_update('evt_pf_1', 'invoice.payment_failed', null, 'cus_bm3',
  null, 'past_due', null, null, now() - interval '5 minutes'),
  'E3 Stripe replays the event: the ledger refuses it');
select ok(not public.enqueue_billing_event_mail('evt_pf_1', 'cus_bm3', now() - interval '5 minutes'),
  'E4 the replay queues nothing (keyed per Stripe event)');

select set_config('test.pf1', public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_payment_failed', 'stripe:evt_pf_1', '11111111-1111-4111-8111-111111111111')::text, true);
select ok(current_setting('test.pf1') <> '', 'E5 the payment-failed mail is logged for the admin');
select is(public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_payment_failed', 'stripe:evt_pf_1', '11111111-1111-4111-8111-111111111111'), null,
  'E6 a second job run for the same event: NULL, no second mail');

-- The next failed attempt is a new event: a new mail (not unique per company+type).
select ok(public.apply_stripe_subscription_update('evt_pf_2', 'invoice.payment_failed', null, 'cus_bm3',
  null, 'past_due', null, null, now() - interval '1 minute'), 'E7 a second payment_failed event');
select ok(public.enqueue_billing_event_mail('evt_pf_2', 'cus_bm3', now() - interval '1 minute'),
  'E8 is queued too');
select ok(public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_payment_failed', 'stripe:evt_pf_2', '11111111-1111-4111-8111-111111111111') is not null,
  'E9 and mails again: every event gets its mail');

select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_payment_failed', 'stripe:evt_never', '11111111-1111-4111-8111-111111111111') $$,
  '55000', null, 'E10 no mail for an event that was never queued');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000d7',
  'billing_payment_failed', 'stripe:evt_pf_1', '11111111-1111-4111-8111-111111111111') $$,
  '55000', null, 'E11 an event queued for company B3 cannot be mailed to company T7');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_canceled', 'stripe:evt_pf_1', '11111111-1111-4111-8111-111111111111') $$,
  '55000', null, 'E12 nor as another type');

select ok(not public.enqueue_billing_event_mail('evt_not_in_ledger', 'cus_bm3', now()),
  'E13 an event the ledger never accepted is not queued');
select ok(public.apply_stripe_subscription_update('evt_paid_1', 'invoice.paid', null, 'cus_bm3',
  null, 'active', null, null, now()), 'E14 invoice.paid (newest event)');
select ok(not public.enqueue_billing_event_mail('evt_paid_1', 'cus_bm3', now()),
  'E15 an invoice.paid event never queues a mail (type comes from the ledger)');
select ok(public.apply_stripe_subscription_update('evt_pf_late', 'invoice.payment_failed', null, 'cus_bm3',
  null, 'past_due', null, null, now() - interval '30 minutes'),
  'E16 a late, out-of-order payment_failed reaches the ledger');
select ok(not public.enqueue_billing_event_mail('evt_pf_late', 'cus_bm3', now() - interval '30 minutes'),
  'E17 …but queues nothing: a newer event already said "paid"');
select ok(public.apply_stripe_subscription_update('evt_del_old', 'customer.subscription.deleted', null, 'cus_bm3',
  null, null, null, null, null), 'E18 a deleted event without a created stamp');
select ok(not public.enqueue_billing_event_mail('evt_del_old', 'cus_bm3', now() - interval '4 days'),
  'E19 an event older than 3 days (a dashboard resend) queues nothing');
select ok(not public.enqueue_billing_event_mail('evt_pf_1', 'cus_unknown', now()),
  'E20 an unknown customer queues nothing');

select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000b3',
  'billing_trial_day7', 'billing_trial_day7', '11111111-1111-4111-8111-111111111111') $$,
  '55000', null, 'E21 trial mails stop once the company is no longer trialing');
reset role;

select is((select count(*)::int from public.billing_mail_events
            where venue_id = 'bb000000-0000-7000-8000-0000000000b3'), 2,
  'E22 exactly two queued events for B3 (evt_pf_1, evt_pf_2)');

-- ---------------------------------------------------------------------------
-- F. Invitation limits are untouched by billing mail
-- ---------------------------------------------------------------------------

insert into public.mail_log (type, venue_id, recipient_hash, status)
select 'billing_payment_failed', 'bb000000-0000-7000-8000-0000000000d7', repeat('c', 64), 'sent'
  from generate_series(1, 30);
select is(public.mail_venue_cap_reached('bb000000-0000-7000-8000-0000000000d7'), false,
  'F1 thirty billing mails in a day do not touch the company invitation cap');

select pg_temp.login_service();
select ok(public.log_mail_attempt('team_join', 'bb000000-0000-7000-8000-0000000000d7',
  encode(extensions.digest('admin@plusone.test', 'sha256'), 'hex')) is not null,
  'F2 a team mail to someone who just got a billing mail is not held by the 60-second window');
select throws_ok($$ select public.log_mail_attempt('billing_trial_day7', 'bb000000-0000-7000-8000-0000000000d7', repeat('d', 64)) $$,
  '22023', null, 'F3 log_mail_attempt refuses billing types (one path: log_billing_mail)');
reset role;

-- ---------------------------------------------------------------------------
-- G. Platform: timeline + pause
-- ---------------------------------------------------------------------------

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok($$ select public.platform_billing_mail_timeline('bb000000-0000-7000-8000-0000000000b3') $$,
  '42501', null, 'G1 manager@ gets 42501 on the timeline');
reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.platform_billing_mail_timeline('bb000000-0000-7000-8000-0000000000b3') $$,
  '42501', null, 'G2 the company''s own admin gets 42501 too');
select throws_ok($$ select public.set_billing_mails_paused('bb000000-0000-7000-8000-0000000000d7', true) $$,
  '42501', null, 'G3 and cannot pause billing mail');
reset role;

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select set_config('test.tl', public.platform_billing_mail_timeline('bb000000-0000-7000-8000-0000000000b3')::text, true);
reset role;
select is(
  (select jsonb_agg(jsonb_build_array(m ->> 'type', m ->> 'dedupe_key', (m ->> 'recipients')::int) order by m ->> 'dedupe_key')
     from jsonb_array_elements(current_setting('test.tl')::jsonb -> 'mails') m),
  '[["billing_trial_day0", "billing_trial_day0", 1],
    ["billing_payment_failed", "stripe:evt_pf_1", 1],
    ["billing_payment_failed", "stripe:evt_pf_2", 1]]'::jsonb,
  'G4 the platform admin sees one line per mail, with recipient counts');
select ok(
  (current_setting('test.tl')::jsonb ->> 'paused')::boolean = false
  and current_setting('test.tl')::jsonb -> 'subscription' ->> 'status' = 'active'
  and position('@' in current_setting('test.tl')) = 0,
  'G5 not paused, subscription facts included, no address anywhere');

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select lives_ok($$ select public.set_billing_mails_paused('bb000000-0000-7000-8000-0000000000d7', true) $$,
  'G6 the platform admin pauses billing mail for T7');
reset role;
select is(
  (select paused::text || ':' || updated_by::text from public.billing_mail_settings
    where venue_id = 'bb000000-0000-7000-8000-0000000000d7'),
  'true:99999999-9999-4999-8999-999999999999', 'G7 stamped with who paused it');

select set_config('test.token2', pg_temp.mint(), true);
select pg_temp.login_service();
select ok(
  not exists (select 1 from jsonb_array_elements(public.billing_mails_begin(current_setting('test.token2')) -> 'trials') t
               where t ->> 'venue_id' = 'bb000000-0000-7000-8000-0000000000d7'),
  'G8 a paused company is not in a run');
select throws_ok($$ select public.log_billing_mail('bb000000-0000-7000-8000-0000000000d7',
  'billing_trial_ended', 'billing_trial_ended', '11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'G9 and the service role cannot log a mail for it');
select is(public.billing_mail_recipients('bb000000-0000-7000-8000-0000000000d7') -> 'recipients', '[]'::jsonb,
  'G10 nor read its recipients');
reset role;

-- ---------------------------------------------------------------------------
-- H. Sleeping job: no Vault URL, no token
-- ---------------------------------------------------------------------------

select is(public.kick_billing_mails(), false, 'H1 without plusone_billing_mails_url the kick does nothing');
select is((select count(*)::int from public.billing_mail_tokens where created_at >= now() - interval '10 minutes'), 0,
  'H2 …and mints no token (the two used ones were consumed)');

select * from finish();
rollback;
