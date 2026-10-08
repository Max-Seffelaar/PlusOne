-- pgTAP — platform trial override (Billing G, decision #32(d) revised 2026-10-06),
-- 20261008120200_platform_trial_override.sql. Proves set_venue_trial_end and
-- set_venue_comped:
--   * grants: authenticated only (anon and service_role hold nothing);
--   * DENIED (42501) for every venue role of the very company — admin, finance,
--     user_manager — the platform-admin check lives inside the function;
--   * ALLOWED for a platform admin with no membership there, with the audit row
--     written by the subscriptions trigger under the admin's own uid;
--   * "Always free" off = trialing until now() + 14 days; idempotent re-comp
--     writes nothing; range/null/unknown-venue validation; a Stripe-linked
--     subscription is refused (55000).
-- Everything rolls back.
--
-- Seed fixtures: venue 1 aa…01 (Club Vesper) is comped, with admin@ (1111),
-- user_manager (2222) and finance (3333) as members; venue 2 aa…02 (De
-- Marktzaal) is trialing — the non-comped venue spike 9.1 asked for. The
-- platform admin (9999) is a fixture here, never in the seed (see
-- platform_admin.test.sql).

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

select plan(33);

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
-- A. Grants: authenticated only
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('anon', 'public.set_venue_trial_end(uuid, timestamptz)', 'EXECUTE'),
  'T1 anon cannot execute set_venue_trial_end');
select ok(not has_function_privilege('anon', 'public.set_venue_comped(uuid, boolean)', 'EXECUTE'),
  'T2 anon cannot execute set_venue_comped');
select ok(not has_function_privilege('service_role', 'public.set_venue_comped(uuid, boolean)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public.set_venue_trial_end(uuid, timestamptz)', 'EXECUTE'),
  'T3 service_role holds no execute either (platform admins act on name)');
select ok(has_function_privilege('authenticated', 'public.set_venue_comped(uuid, boolean)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_venue_trial_end(uuid, timestamptz)', 'EXECUTE'),
  'T4 authenticated may call both — the check is inside');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('set_venue_trial_end', 'set_venue_comped')
             and p.prosecdef and 'search_path=""' = any(p.proconfig)),
  2, 'T5 both are SECURITY DEFINER with an empty search_path');

-- ---------------------------------------------------------------------------
-- B. Denied — every venue role of the company itself, and anon
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin@ (admin at both venues)
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() + interval '30 days') $$,
  '42501', null, 'T6 a venue admin cannot extend their own trial');
select throws_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000002', true) $$,
  '42501', null, 'T7 a venue admin cannot make their own company always free');
reset role;

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- finance@ at Club Vesper
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000001', now() + interval '30 days') $$,
  '42501', null, 'T8 finance cannot set a trial end');
select throws_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000001', false) $$,
  '42501', null, 'T9 finance cannot switch always free off');
reset role;

select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- manager@ at Club Vesper
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000001', now() + interval '30 days') $$,
  '42501', null, 'T10 a manager cannot set a trial end');
select throws_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000001', false) $$,
  '42501', null, 'T11 a manager cannot switch always free off');
reset role;

select pg_temp.login_anon();
select throws_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000002', true) $$,
  '42501', null, 'T12 anon is refused');
reset role;

select is((select string_agg(status::text || ':' || coalesce(trial_ends_at::text, '-'), ',' order by venue_id)
           from public.subscriptions
           where venue_id in ('aa000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000002')),
  'comped:-,trialing:-', 'T13 the denied calls changed nothing');

-- ---------------------------------------------------------------------------
-- C. Allowed — the platform admin, no membership at either venue
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select lives_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000002', true) $$,
  'T14 a platform admin makes De Marktzaal always free');
reset role;
select is((select status::text || ':' || coalesce(trial_ends_at::text, '-') from public.subscriptions
           where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'comped:-', 'T15 status is comped, no trial end');

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select lives_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000002', true) $$,
  'T16 always free again is accepted (idempotent)');
select lives_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000002', false) $$,
  'T17 and switched off again');
reset role;
select ok((select status = 'trialing'
                  and trial_ends_at = now() + interval '14 days'
           from public.subscriptions where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'T18 always free off = trialing until today + 14 days');

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select lives_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() + interval '45 days') $$,
  'T19 a platform admin extends the trial');
select lives_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000001', now() + interval '10 days') $$,
  'T20 a trial end also takes a comped company back to trialing');
reset role;
select ok((select status = 'trialing' and trial_ends_at = now() + interval '45 days'
           from public.subscriptions where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'T21 the extended trial end is stored');
select is((select status::text from public.subscriptions where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  'trialing', 'T22 Club Vesper is trialing now');

-- Audit (decision #4): on, off and the extension — three update rows for
-- De Marktzaal under the platform admin's uid; the idempotent second "on"
-- wrote nothing.
select is((select count(*)::int from public.audit_log
           where entity_type = 'subscriptions' and action = 'update'
             and venue_id = 'aa000000-0000-7000-8000-000000000002'
             and actor_id = '99999999-9999-4999-8999-999999999999'),
  3, 'T23 every change is audited on the platform admin''s name, the no-op is not');

-- ---------------------------------------------------------------------------
-- D. Validation and the Stripe-linked refusal
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() - interval '1 day') $$,
  '22023', null, 'T24 a trial end in the past is refused');
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() + interval '731 days') $$,
  '22023', null, 'T25 a trial end 731 days out is refused (Stripe caps trial_end at 730)');
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() + interval '730 days 1 second') $$,
  '22023', null, 'T25b one second past 730 days is refused');
select lives_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() + interval '730 days') $$,
  'T25c exactly 730 days out is accepted');
select lives_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() + interval '45 days') $$,
  'T25d (restore the 45-day end for the checks below)');
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', null) $$,
  '22004', null, 'T26 a null trial end is refused');
select throws_ok($$ select public.set_venue_comped('00000000-0000-7000-8000-00000000dead', true) $$,
  'P0002', null, 'T27 an unknown company is refused');
reset role;

-- A paying customer: Stripe's clock, not ours.
update public.subscriptions set stripe_subscription_id = 'sub_markt_live'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';

select pg_temp.login('99999999-9999-4999-8999-999999999999');
select throws_ok($$ select public.set_venue_trial_end('aa000000-0000-7000-8000-000000000002', now() + interval '30 days') $$,
  '55000', null, 'T28 a Stripe-linked subscription refuses a trial end');
select throws_ok($$ select public.set_venue_comped('aa000000-0000-7000-8000-000000000002', true) $$,
  '55000', null, 'T29 a Stripe-linked subscription refuses always free');
reset role;

select is((select status::text from public.subscriptions where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  'trialing', 'T30 the refused calls left the linked subscription alone');

select * from finish();

rollback;
