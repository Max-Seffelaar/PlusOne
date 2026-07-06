-- pgTAP — Stripe Billing (fase 13, decision #32), 20260706120000_stripe_billing.sql.
-- Proves: the stripe_webhook_events ledger and both RPCs are service_role-only;
-- apply_stripe_subscription_update applies each status transition exactly once
-- (replay returns false and mutates nothing); comped is never overwritten by
-- webhook state; stamp_stripe_customer is idempotent and refuses to relink a
-- venue to another customer; subscription changes land in the audit log with a
-- null actor (service/manual writes). Everything rolls back.
--
-- Seed fixtures: venue 1 aa…01 (Club Vesper) is comped, venue 2 aa…02
-- (De Marktzaal) is trialing — exactly the two states this suite needs.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.login_anon() returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

create function pg_temp.login_service() returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

select plan(25);

-- ---------------------------------------------------------------------------
-- A. Privileges: ledger + RPCs are service_role-only
-- ---------------------------------------------------------------------------

-- Max is admin at both venues — the strongest app role must still be denied.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');

select throws_ok($$ select count(*) from public.stripe_webhook_events $$,
  '42501', null, 'T1 authenticated cannot read the webhook ledger');
select throws_ok($$
  select public.apply_stripe_subscription_update('evt_att', 'invoice.paid',
    'aa000000-0000-7000-8000-000000000002') $$,
  '42501', null, 'T2 authenticated cannot execute apply_stripe_subscription_update');
select throws_ok($$
  select public.stamp_stripe_customer('aa000000-0000-7000-8000-000000000002', 'cus_att') $$,
  '42501', null, 'T3 authenticated cannot execute stamp_stripe_customer');
reset role;

select pg_temp.login_anon();
select throws_ok($$ select count(*) from public.stripe_webhook_events $$,
  '42501', null, 'T4 anon cannot read the webhook ledger');
reset role;

-- ---------------------------------------------------------------------------
-- B. stamp_stripe_customer (checkout action persists the customer id)
-- ---------------------------------------------------------------------------

select pg_temp.login_service();

select lives_ok($$
  select public.stamp_stripe_customer('aa000000-0000-7000-8000-000000000002', 'cus_markt') $$,
  'T5 service_role stamps a fresh customer id');
select lives_ok($$
  select public.stamp_stripe_customer('aa000000-0000-7000-8000-000000000002', 'cus_markt') $$,
  'T6 re-stamping the same id is a no-op');
select throws_ok($$
  select public.stamp_stripe_customer('aa000000-0000-7000-8000-000000000002', 'cus_other') $$,
  '45010', null, 'T7 relinking a venue to another customer is refused');
select throws_ok($$
  select public.stamp_stripe_customer('aa000000-0000-7000-8000-0000000000ff', 'cus_x') $$,
  'P0002', null, 'T8 unknown venue raises');
reset role;

-- ---------------------------------------------------------------------------
-- C. checkout.session.completed — match by venue id, ids only (no status)
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select is(public.apply_stripe_subscription_update(
    'evt_checkout_1', 'checkout.session.completed',
    p_venue_id => 'aa000000-0000-7000-8000-000000000002',
    p_stripe_customer_id => 'cus_markt',
    p_stripe_subscription_id => 'sub_markt'),
  true, 'T9 first delivery applies');
reset role;

select is((select status || ':' || stripe_subscription_id from public.subscriptions
           where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'trialing:sub_markt',
  'T10 checkout stamps the subscription id and leaves the status trialing');

-- ---------------------------------------------------------------------------
-- D. invoice.paid — match by customer id, activates + period end
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select is(public.apply_stripe_subscription_update(
    'evt_paid_1', 'invoice.paid',
    p_stripe_customer_id => 'cus_markt',
    p_status => 'active',
    p_current_period_end => '2026-08-06T12:00:00Z'),
  true, 'T11 invoice.paid matches by customer id');
reset role;

select is((select status || ':' || current_period_end::text from public.subscriptions
           where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'active:2026-08-06 12:00:00+00',
  'T12 subscription is active with the invoiced period end');

-- ---------------------------------------------------------------------------
-- E. Replay — the same event id mutates nothing (webhook idempotency, #32)
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select is(public.apply_stripe_subscription_update(
    'evt_paid_1', 'invoice.paid',
    p_stripe_customer_id => 'cus_markt',
    p_status => 'past_due',
    p_current_period_end => '2030-01-01T00:00:00Z'),
  false, 'T13 replaying a processed event returns false');
reset role;

select is((select status || ':' || current_period_end::text from public.subscriptions
           where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'active:2026-08-06 12:00:00+00',
  'T14 the replay changed nothing (even with different payload values)');

-- ---------------------------------------------------------------------------
-- F. Dunning transitions: past_due, then canceled
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select ok(public.apply_stripe_subscription_update(
    'evt_fail_1', 'invoice.payment_failed',
    p_stripe_customer_id => 'cus_markt', p_status => 'past_due'),
  'T15a payment failure applies');
reset role;
select is((select status::text from public.subscriptions
           where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'past_due', 'T15 payment failure marks the venue past_due');

select pg_temp.login_service();
select ok(public.apply_stripe_subscription_update(
    'evt_del_1', 'customer.subscription.deleted',
    p_stripe_customer_id => 'cus_markt', p_status => 'canceled'),
  'T16a dunning cancel applies');
reset role;
select is((select status::text from public.subscriptions
           where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'canceled', 'T16 the end of dunning cancels the subscription');

-- ---------------------------------------------------------------------------
-- G. Comped guard — a pilot venue is never demoted by webhook state
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select is(public.apply_stripe_subscription_update(
    'evt_comped_1', 'customer.subscription.updated',
    p_venue_id => 'aa000000-0000-7000-8000-000000000001',
    p_stripe_customer_id => 'cus_vesper',
    p_status => 'canceled'),
  true, 'T17 the event against a comped venue is still recorded');
reset role;

select is((select status::text from public.subscriptions
           where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  'comped', 'T18 comped survives any webhook status (manual-only, #32)');

select is((select count(*)::int from public.stripe_webhook_events where id = 'evt_comped_1'),
  1, 'T19 the comped event landed in the ledger (no redelivery loop)');

-- ---------------------------------------------------------------------------
-- H. Validation
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select throws_ok($$
  select public.apply_stripe_subscription_update(
    'evt_orphan', 'invoice.paid', p_stripe_customer_id => 'cus_unknown') $$,
  'P0002', null, 'T20 an event for an unknown customer raises (Stripe retries later)');
select throws_ok($$
  select public.apply_stripe_subscription_update('evt_bare', 'invoice.paid') $$,
  '22004', null, 'T21 an event without venue AND customer is rejected');
reset role;

-- The orphan event must NOT be marked processed — the raise rolls back the
-- ledger insert so a retry (after stamp_stripe_customer) can succeed.
select is((select count(*)::int from public.stripe_webhook_events where id = 'evt_orphan'),
  0, 'T22 a failed apply leaves the event unprocessed');

-- ---------------------------------------------------------------------------
-- I. Audit (decision #4): subscription changes are logged, actor null = system
-- ---------------------------------------------------------------------------

select ok((select count(*) from public.audit_log
           where entity_type = 'subscriptions'
             and venue_id = 'aa000000-0000-7000-8000-000000000002'
             and action = 'update'
             and actor_id is null) >= 3,
  'T23 webhook-driven subscription updates are audited with a null actor');

select * from finish();

rollback;
