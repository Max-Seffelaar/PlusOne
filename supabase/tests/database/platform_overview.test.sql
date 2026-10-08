-- pgTAP — Platform R (z8uq9m2ybj), 20261012130000_platform_overview_rpcs.sql.
-- Proves the four new platform RPCs (platform_company_details,
-- platform_subscription_counts, platform_trial_funnel, platform_usage_30d):
--   * grants: authenticated only (anon and service_role hold nothing);
--   * DENIED with 42501 — not an empty result — for every venue role of the
--     seed company (admin, user_manager, finance, staff) and for anon;
--   * ALLOWED for a platform admin, and the counts follow status changes;
-- plus the expand-only company_ids column on platform_invite_overview(), and
-- (20261012150000) the trialing_payment_set_up subset of trialing.
-- Everything rolls back.
--
-- Seed: venue aa…01 (Club Vesper) is comped with one upcoming event; venue
-- aa…02 (De Marktzaal) is trialing with no events. admin@ (1111) is admin of
-- both; manager (2222) user_manager, finance (3333), staff (5555) of aa…01.
-- The platform admin (9999) is a fixture here, never in the seed.

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

create function pg_temp.login_anon() returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

create function pg_temp.as_postgres() returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
end;
$fn$;

select plan(50);

-- ---------------------------------------------------------------------------
-- Fixture: one platform admin with no venue membership
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- A. Grants: authenticated only, on every new function
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('anon', f, 'EXECUTE')
          and not has_function_privilege('service_role', f, 'EXECUTE')
          and has_function_privilege('authenticated', f, 'EXECUTE'),
          'T' || n || ' ' || f || ': authenticated only')
from (values
  (1, 'public.platform_company_details(uuid[])'),
  (2, 'public.platform_subscription_counts()'),
  (3, 'public.platform_trial_funnel()'),
  (4, 'public.platform_usage_30d()'),
  (5, 'public.platform_invite_overview(integer, integer)')
) as x (n, f)
order by n;

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('platform_company_details', 'platform_subscription_counts',
                                'platform_trial_funnel', 'platform_usage_30d')
              and p.prosecdef
              and p.proconfig @> array['search_path=""']),
  4, 'T6 all four are SECURITY DEFINER with an empty search_path');

-- ---------------------------------------------------------------------------
-- B. Denied: 42501 for every venue role and for anon — never an empty set
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- venue admin
select throws_ok($$ select * from public.platform_company_details(array['aa000000-0000-7000-8000-000000000001'::uuid]) $$,
  '42501', null, 'T7 venue admin: company_details 42501 (even for their own company)');
select throws_ok($$ select * from public.platform_subscription_counts() $$, '42501', null, 'T8 venue admin: subscription_counts 42501');
select throws_ok($$ select * from public.platform_trial_funnel() $$, '42501', null, 'T9 venue admin: trial_funnel 42501');
select throws_ok($$ select * from public.platform_usage_30d() $$, '42501', null, 'T10 venue admin: usage_30d 42501');
select throws_ok($$ select * from public.platform_company_details(null) $$, '42501', null,
  'T11 venue admin: the check runs before the empty-input early return');

select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- user_manager
select throws_ok($$ select * from public.platform_company_details(array['aa000000-0000-7000-8000-000000000001'::uuid]) $$,
  '42501', null, 'T12 manager: company_details 42501');
select throws_ok($$ select * from public.platform_subscription_counts() $$, '42501', null, 'T13 manager: subscription_counts 42501');
select throws_ok($$ select * from public.platform_trial_funnel() $$, '42501', null, 'T14 manager: trial_funnel 42501');
select throws_ok($$ select * from public.platform_usage_30d() $$, '42501', null, 'T15 manager: usage_30d 42501');

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- finance
select throws_ok($$ select * from public.platform_company_details(array['aa000000-0000-7000-8000-000000000001'::uuid]) $$,
  '42501', null, 'T16 finance: company_details 42501');
select throws_ok($$ select * from public.platform_subscription_counts() $$, '42501', null, 'T17 finance: subscription_counts 42501');
select throws_ok($$ select * from public.platform_trial_funnel() $$, '42501', null, 'T18 finance: trial_funnel 42501');
select throws_ok($$ select * from public.platform_usage_30d() $$, '42501', null, 'T19 finance: usage_30d 42501');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select throws_ok($$ select * from public.platform_company_details(array['aa000000-0000-7000-8000-000000000001'::uuid]) $$,
  '42501', null, 'T20 staff: company_details 42501');
select throws_ok($$ select * from public.platform_subscription_counts() $$, '42501', null, 'T21 staff: subscription_counts 42501');
select throws_ok($$ select * from public.platform_trial_funnel() $$, '42501', null, 'T22 staff: trial_funnel 42501');
select throws_ok($$ select * from public.platform_usage_30d() $$, '42501', null, 'T23 staff: usage_30d 42501');
select is((select count(*)::int from public.platform_invite_overview()), 0,
  'T24 staff: platform_invite_overview keeps its zero-rows behaviour (unchanged, not new)');

select pg_temp.login_anon();
select throws_ok($$ select * from public.platform_company_details(array['aa000000-0000-7000-8000-000000000001'::uuid]) $$,
  '42501', null, 'T25 anon: company_details permission denied');
select throws_ok($$ select * from public.platform_subscription_counts() $$, '42501', null, 'T26 anon: subscription_counts permission denied');
select throws_ok($$ select * from public.platform_trial_funnel() $$, '42501', null, 'T27 anon: trial_funnel permission denied');
select throws_ok($$ select * from public.platform_usage_30d() $$, '42501', null, 'T28 anon: usage_30d permission denied');

-- ---------------------------------------------------------------------------
-- C. Allowed: the platform admin gets data matching the seed
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');

select results_eq(
  $$ select total_companies, trialing, trial_lapsed, paid_monthly, paid_yearly, paid_unknown,
            past_due, canceled, comped, no_subscription
       from public.platform_subscription_counts() $$,
  $$ values (2, 1, 0, 0, 0, 0, 0, 0, 1, 0) $$,
  'T29 seed: two companies — one trialing, one always free');

select results_eq(
  $$ select name, subscription_status, event_count, last_event_name is not null
       from public.platform_company_details(array[
         'aa000000-0000-7000-8000-000000000001'::uuid,
         'aa000000-0000-7000-8000-000000000002'::uuid]) $$,
  $$ values ('Club Vesper'::text, 'comped'::text, 1, true),
            ('De Marktzaal'::text, 'trialing'::text, 0, false) $$,
  'T30 company_details: status, event count and latest event per company');

select is(
  (select d.trial_ends_at from public.platform_company_details(array['aa000000-0000-7000-8000-000000000002'::uuid]) d),
  (select s.created_at + interval '14 days' from public.subscriptions s
    where s.venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'T31 company_details: trial end = created_at + 14 days without an override');

select is(
  (select d.trial_ends_at from public.platform_company_details(array['aa000000-0000-7000-8000-000000000001'::uuid]) d),
  null::timestamptz,
  'T32 company_details: no trial end for a comped company');

select throws_ok(
  $$ select * from public.platform_company_details(array(select gen_random_uuid() from generate_series(1, 201))) $$,
  '22023', null, 'T33 company_details refuses more than 200 ids');

select is((select count(*)::int from public.platform_company_details('{}'::uuid[])), 0,
  'T34 company_details: an empty list is an empty answer');

-- Invite for admin@ (member of both seed companies) -> company_ids carries both.
insert into public.platform_invites (email, invited_by)
values ('admin@plusone.test', '99999999-9999-4999-8999-999999999999');
select is(
  (select cardinality(o.company_ids) from public.platform_invite_overview() o
    where o.email = 'admin@plusone.test'),
  2, 'T35 platform_invite_overview: company_ids lists the invitee''s companies');

-- ---------------------------------------------------------------------------
-- D. Counts follow status changes
-- ---------------------------------------------------------------------------

select pg_temp.as_postgres();
update public.subscriptions
   set status = 'active', billing_interval = 'month',
       trial_ends_at = now() - interval '10 days'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';
select pg_temp.login('99999999-9999-4999-8999-999999999999');

select results_eq(
  $$ select trialing, paid_monthly, paid_yearly, comped from public.platform_subscription_counts() $$,
  $$ values (0, 1, 0, 1) $$,
  'T36 after activation: paid monthly 1, trialing 0');
select results_eq(
  $$ select ended_30d, converted_30d, ended_90d, converted_90d from public.platform_trial_funnel() $$,
  $$ values (1, 1, 1, 1) $$,
  'T37 trial ended 10 days ago and pays: cohort 1, converted 1 (comped excluded)');

select pg_temp.as_postgres();
update public.subscriptions set billing_interval = 'year'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select results_eq(
  $$ select paid_monthly, paid_yearly from public.platform_subscription_counts() $$,
  $$ values (0, 1) $$,
  'T38 yearly interval moves the company to paid yearly');

select pg_temp.as_postgres();
update public.subscriptions set status = 'canceled'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select results_eq(
  $$ select canceled, paid_yearly from public.platform_subscription_counts() $$,
  $$ values (1, 0) $$,
  'T39 canceled bucket');
select results_eq(
  $$ select canceled_30d, converted_30d from public.platform_trial_funnel() $$,
  $$ values (1, 0) $$,
  'T40 cancellation in the last 30 days comes from the audit trail; no longer converted');

select pg_temp.as_postgres();
update public.subscriptions
   set status = 'trialing', billing_interval = null, trial_ends_at = now() - interval '1 day'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select results_eq(
  $$ select trialing, trial_lapsed from public.platform_subscription_counts() $$,
  $$ values (0, 1) $$,
  'T41 a passed override without Stripe is a lapsed trial, not a running one');

select pg_temp.as_postgres();
update public.subscriptions set trial_ends_at = now() + interval '3 days'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select results_eq(
  $$ select ending_7d from public.platform_trial_funnel() $$,
  $$ values (1) $$,
  'T42 an override ending in 3 days counts as ending within 7 days');

-- ---------------------------------------------------------------------------
-- E. Usage over 30 days
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select active_companies, events, dormant_companies from public.platform_usage_30d() $$,
  $$ values (0, 0, 1) $$,
  'T43 seed: only an upcoming event; De Marktzaal (no event, no sign-in) is dormant');

select pg_temp.as_postgres();
insert into public.events (venue_id, name, starts_at, ends_at, status)
values ('aa000000-0000-7000-8000-000000000002', 'Past Night',
        now() - interval '2 days', now() - interval '2 days' + interval '6 hours', 'closed');
select pg_temp.login('99999999-9999-4999-8999-999999999999');

select results_eq(
  $$ select active_companies, events, check_ins, dormant_companies from public.platform_usage_30d() $$,
  $$ values (1, 1, 0, 0) $$,
  'T44 an event two days ago: one active company, nobody dormant');

select is(
  (select d.last_event_name from public.platform_company_details(array['aa000000-0000-7000-8000-000000000002'::uuid]) d),
  'Past Night', 'T45 company_details picks up the new latest event');

select pg_temp.as_postgres();
update public.events set cancelled_at = now()
 where venue_id = 'aa000000-0000-7000-8000-000000000002' and name = 'Past Night';
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select results_eq(
  $$ select event_count, last_event_name from public.platform_company_details(
       array['aa000000-0000-7000-8000-000000000002'::uuid]) $$,
  $$ values (0, null::text) $$,
  'T46 a cancelled event counts in neither the event count nor the latest event');

-- ---------------------------------------------------------------------------
-- F. Trial, payment set up (20261012150000): a subset of trialing
-- ---------------------------------------------------------------------------

select is(
  (select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'platform_subscription_counts'
      and 'trialing_payment_set_up' = any (p.proargnames)),
  'platform_subscription_counts',
  'T47 platform_subscription_counts returns trialing_payment_set_up (and is not overloaded)');

-- State from D: De Marktzaal trialing, override 3 days ahead, no Stripe.
select results_eq(
  $$ select trialing, trialing_payment_set_up, trial_lapsed from public.platform_subscription_counts() $$,
  $$ values (1, 0, 0) $$,
  'T48 a trial without a Stripe subscription has no payment set up');

select pg_temp.as_postgres();
update public.subscriptions set stripe_subscription_id = 'sub_pgtap_trial_paid'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select results_eq(
  $$ select total_companies, trialing, trialing_payment_set_up, trial_lapsed, comped
       from public.platform_subscription_counts() $$,
  $$ values (2, 1, 1, 0, 1) $$,
  'T49 the trial gets a Stripe subscription: payment set up 1, still inside trialing');

select pg_temp.as_postgres();
update public.subscriptions set trial_ends_at = now() - interval '1 day'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select results_eq(
  $$ select trialing, trialing_payment_set_up, trial_lapsed from public.platform_subscription_counts() $$,
  $$ values (1, 1, 0) $$,
  'T50 with Stripe, Stripe''s clock decides: a passed local end is not a lapsed trial');

select * from finish();
rollback;
