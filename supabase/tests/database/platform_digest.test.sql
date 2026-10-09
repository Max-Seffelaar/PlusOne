-- pgTAP — platform digest (z8uq9m2ybj vervolg, 20261013150000_platform_digest.sql).
-- Run: pnpm db:test.
--
-- Proves (D1 needs 20261012150000, which adds trialing_payment_set_up):
--   A. privileges: the aggregate wrappers, platform_digest_begin and
--      log_platform_digest_mail are service_role-only; config/kick/tick/today
--      are owner-only; both new tables are closed to every app role;
--   B. denied: authenticated (a venue admin) and anon get 42501 on every
--      service-role function, before anything is read;
--   C. the digest sleeps without the Vault URL; with it, a kick queues one
--      pg_net request carrying a fresh token stored only as its sha256; begin
--      gates on that token (unknown / null / expired / replayed => 42501) and
--      returns aggregates + the CURRENT platform admins (banned excluded);
--   D. parity: every wrapper returns exactly what its Overview twin returns
--      for a platform admin, on seed data that hits several buckets;
--   E. log_platform_digest_mail: one mail per recipient per Amsterdam day
--      (queued/sent => NULL, no second row), a failed attempt may retry, a
--      previous day never blocks today, non-admins and banned admins => 42501,
--      the row is venue-less and holds only the hashed address;
--   F. the tick drops expired tokens and never raises.
--
-- The Vault secret and the pg_net requests roll back with the transaction, so
-- nothing is ever sent. Seed: admin@ (1111) is a venue admin, NOT a platform
-- admin; the two platform admins here are fixtures.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.as_service() returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

create function pg_temp.login(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.login_anon() returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

create function pg_temp.as_postgres() returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end;
$fn$;

create function pg_temp.queued() returns int language sql as $fn$
  select count(*)::int from net.http_request_queue
  where url = 'http://127.0.0.1:9/functions/v1/platform-digest';
$fn$;

select plan(55);

select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- Fixtures: two platform admins with no venue membership; 9998 gets banned
-- later in the file.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('full_name', u.name),
       now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('99999999-9999-4999-8999-999999999999'::uuid, 'Platform@PlusOne.test', 'Joeri Platform'),
  ('99999999-9999-4999-8999-999999999998'::uuid, 'second-platform@plusone.test', 'Second Platform')
) as u (id, email, name);

insert into public.user_profiles (id, full_name, email) values
  ('99999999-9999-4999-8999-999999999999', 'Joeri Platform', 'platform@plusone.test'),
  ('99999999-9999-4999-8999-999999999998', 'Second Platform', 'second-platform@plusone.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id in ('99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-999999999998');
select set_config('plusone.platform_admin_write', 'off', true);

-- ---------------------------------------------------------------------------
-- A. Privileges
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', f, 'EXECUTE')
  and not has_function_privilege('authenticated', f, 'EXECUTE')
  and not has_function_privilege('anon', f, 'EXECUTE'),
  'A' || n || ' ' || f || ': service_role only')
from (values
  (1, 'public.platform_digest_subscription_counts()'),
  (2, 'public.platform_digest_trial_funnel()'),
  (3, 'public.platform_digest_usage_30d()'),
  (4, 'public.platform_digest_begin(text)'),
  (5, 'public.log_platform_digest_mail(uuid)')
) as x (n, f)
order by n;

select is_empty($$
  select r || ' -> ' || f
  from unnest(array['anon', 'authenticated', 'service_role']) r
  cross join unnest(array[
    'public.platform_digest_today()',
    'public.platform_digest_setting(text)',
    'public.kick_platform_digest()',
    'public.platform_digest_tick()']) f
  where has_function_privilege(r, f, 'EXECUTE')
$$, 'A6 config / kick / tick / today are owner-only');

select is_empty($$
  select r || ':' || t || ':' || p
  from unnest(array['anon', 'authenticated', 'service_role']) r
  cross join unnest(array['public.platform_digest_tokens', 'public.platform_digest_deliveries']) t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r, t, p)
$$, 'A7 no role but the owner holds any privilege on the two new tables');

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.platform_digest_tokens'::regclass, 'public.platform_digest_deliveries'::regclass)),
  'A8 RLS is enabled on both new tables');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('platform_digest_subscription_counts', 'platform_digest_trial_funnel',
                                'platform_digest_usage_30d', 'platform_digest_begin',
                                'log_platform_digest_mail', 'platform_digest_setting',
                                'kick_platform_digest', 'platform_digest_tick')
              and p.prosecdef
              and p.proconfig @> array['search_path=""']),
  8, 'A9 every definer function has an empty search_path');

-- ---------------------------------------------------------------------------
-- B. Denied for app roles (permission denied = 42501, nothing read)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- venue admin
select throws_ok($$ select * from public.platform_digest_subscription_counts() $$, '42501', null,
  'B1 venue admin: subscription wrapper 42501');
select throws_ok($$ select * from public.platform_digest_usage_30d() $$, '42501', null,
  'B2 venue admin: usage wrapper 42501');
select throws_ok($$ select public.platform_digest_begin(repeat('ab', 32)) $$, '42501', null,
  'B3 venue admin: begin 42501');
select throws_ok($$ select public.log_platform_digest_mail('11111111-1111-4111-8111-111111111111') $$, '42501', null,
  'B4 venue admin: log 42501');

select pg_temp.login('99999999-9999-4999-8999-999999999999'); -- platform admin, via the API
select throws_ok($$ select * from public.platform_digest_trial_funnel() $$, '42501', null,
  'B5 even a platform admin JWT cannot call the wrappers (Overview is their path)');

select pg_temp.login_anon();
select throws_ok($$ select public.platform_digest_begin(repeat('ab', 32)) $$, '42501', null,
  'B6 anon: begin 42501');
select throws_ok($$ select * from public.platform_digest_trial_funnel() $$, '42501', null,
  'B7 anon: funnel wrapper 42501');

select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
-- F (first, while unconfigured). Tick hygiene
-- ---------------------------------------------------------------------------

insert into public.platform_digest_tokens (token_hash, created_at)
values (extensions.digest('pgtap-stale', 'sha256'), now() - interval '11 minutes');
select is(public.platform_digest_tick(), false, 'F1 the tick is a no-op while unconfigured (any hour)');
select is((select count(*)::int from public.platform_digest_tokens), 0, 'F2 …and drops expired tokens');

-- ---------------------------------------------------------------------------
-- C. Asleep, then configured: kick + begin
-- ---------------------------------------------------------------------------

select is(public.platform_digest_setting('plusone_platform_digest_url'), null, 'C1 no URL on a fresh stack');
select is(public.kick_platform_digest(), false, 'C2 kick is a no-op while unconfigured');
select is((select count(*)::int from public.platform_digest_tokens), 0, 'C3 …and mints no token');
select is(public.platform_digest_setting('plusone_push_dispatch_url'), null,
  'C4 the config reader refuses every name but its own');

select vault.create_secret('http://127.0.0.1:9/functions/v1/platform-digest', 'plusone_platform_digest_url');

select is(public.kick_platform_digest(), true, 'C5 kick queues a request once configured');
select is(pg_temp.queued(), 1, 'C6 exactly one pg_net request to the configured URL');
select set_config('pgtap.tok', (
  select headers ->> 'x-platform-digest-token' from net.http_request_queue
  where url = 'http://127.0.0.1:9/functions/v1/platform-digest' order by id desc limit 1), true);
select ok(
  current_setting('pgtap.tok') ~ '^[0-9a-f]{64}$'
  and exists (select 1 from public.platform_digest_tokens t
               where t.token_hash = extensions.digest(current_setting('pgtap.tok'), 'sha256'))
  and not exists (select 1 from public.platform_digest_tokens t
                   where t.token_hash = convert_to(current_setting('pgtap.tok'), 'UTF8')),
  'C7 the header carries a fresh 256-bit token, stored only as its sha256');

insert into public.platform_digest_tokens (token_hash, created_at)
values (extensions.digest('pgtap-expired', 'sha256'), now() - interval '11 minutes');

select pg_temp.as_service();
select throws_ok($$ select public.platform_digest_begin(repeat('cd', 32)) $$, '42501', null,
  'C8 begin refuses a token that was never issued');
select throws_ok($$ select public.platform_digest_begin(null) $$, '42501', null, 'C9 begin refuses a missing token');
select throws_ok($$ select public.platform_digest_begin('pgtap-expired') $$, '42501', null,
  'C10 begin refuses an expired token');

create temp table began on commit drop as
  select public.platform_digest_begin(current_setting('pgtap.tok')) as doc;

select is((select doc ->> 'digest_date' from began), (now() at time zone 'Europe/Amsterdam')::date::text,
  'C11 the digest date is the Amsterdam calendar day');
select is(
  (select array_agg(r ->> 'id' order by r ->> 'id') from began, jsonb_array_elements(doc -> 'recipients') r),
  array['99999999-9999-4999-8999-999999999998', '99999999-9999-4999-8999-999999999999'],
  'C12 recipients = exactly the current platform admins (the venue admin is not one)');
select ok(
  (select bool_and(k in ('id', 'email'))
     from began, jsonb_array_elements(doc -> 'recipients') r, jsonb_object_keys(r) k),
  'C13 a recipient carries only id + login address');
select is(
  (select array_agg(k order by k) from began, jsonb_object_keys(doc) k),
  array['digest_date', 'funnel', 'recipients', 'subscriptions', 'usage'],
  'C14 the document holds the date, three aggregate blocks and the recipients, nothing else');
select throws_ok(format($$ select public.platform_digest_begin(%L) $$, current_setting('pgtap.tok')), '42501', null,
  'C15 a token works once: a replay is refused');

-- ---------------------------------------------------------------------------
-- D. Parity with the Overview RPCs (platform admin uid, as owner)
-- ---------------------------------------------------------------------------

select pg_temp.as_postgres();
-- Spread the seed over one more bucket: De Marktzaal pays monthly.
update public.subscriptions set status = 'active', billing_interval = 'month'
 where venue_id = 'aa000000-0000-7000-8000-000000000002';

select set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-4999-8999-999999999999', 'role', 'authenticated')::text, true);

select is((select to_jsonb(d) from public.platform_digest_subscription_counts() d),
          (select to_jsonb(o) from public.platform_subscription_counts() o),
          'D1 subscription wrapper = platform_subscription_counts()');
select is((select to_jsonb(d) from public.platform_digest_trial_funnel() d),
          (select to_jsonb(o) from public.platform_trial_funnel() o),
          'D2 funnel wrapper = platform_trial_funnel()');
select is((select to_jsonb(d) from public.platform_digest_usage_30d() d),
          (select to_jsonb(o) from public.platform_usage_30d() o),
          'D3 usage wrapper = platform_usage_30d()');
select is((select paid_monthly from public.platform_digest_subscription_counts()), 1,
          'D4 the wrapper sees the monthly payer (the parity is not 0 = 0)');

select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
-- E. log_platform_digest_mail
-- ---------------------------------------------------------------------------

select pg_temp.as_service();
select set_config('pgtap.m1',
  public.log_platform_digest_mail('99999999-9999-4999-8999-999999999999')::text, true);
select pg_temp.as_postgres();

select ok(current_setting('pgtap.m1') <> '', 'E1 the first call for a platform admin returns a mail_log id');
select is(
  (select type || '/' || coalesce(venue_id::text, 'no venue') || '/' || status from public.mail_log
    where id = current_setting('pgtap.m1')::uuid),
  'platform_digest/no venue/queued', 'E2 the row is a venue-less, queued platform_digest');
select is(
  (select recipient_hash from public.mail_log where id = current_setting('pgtap.m1')::uuid),
  encode(extensions.digest('platform@plusone.test', 'sha256'), 'hex'),
  'E3 only the sha256 of the trimmed, lowercased login address is stored');
select is(
  (select mail_log_id::text from public.platform_digest_deliveries
    where recipient_id = '99999999-9999-4999-8999-999999999999'
      and digest_date = (now() at time zone 'Europe/Amsterdam')::date),
  current_setting('pgtap.m1'), 'E4 the ledger points today''s delivery at that row');

select pg_temp.as_service();
select is(public.log_platform_digest_mail('99999999-9999-4999-8999-999999999999'), null,
  'E5 a second run the same day while queued returns NULL (nothing to send)');
select is(public.record_mail_send_result(current_setting('pgtap.m1')::uuid, 'sent', 'msg-pgtap-1'), true,
  'E6 the existing settle RPC settles the digest row');
select is(public.log_platform_digest_mail('99999999-9999-4999-8999-999999999999'), null,
  'E7 …and once sent, a repeated run still mails nothing');
select pg_temp.as_postgres();
select is((select count(*)::int from public.mail_log
            where type = 'platform_digest'
              and recipient_hash = encode(extensions.digest('platform@plusone.test', 'sha256'), 'hex')),
  1, 'E8 one mail_log row for that recipient today, however often the job ran');

-- A failed attempt (nothing went out) may be retried the same day.
select pg_temp.as_service();
select set_config('pgtap.m2',
  public.log_platform_digest_mail('99999999-9999-4999-8999-999999999998')::text, true);
select public.record_mail_send_result(current_setting('pgtap.m2')::uuid, 'failed', null, 'provider_unavailable');
select set_config('pgtap.m3',
  coalesce(public.log_platform_digest_mail('99999999-9999-4999-8999-999999999998')::text, ''), true);
select pg_temp.as_postgres();
select ok(current_setting('pgtap.m3') not in ('', current_setting('pgtap.m2')),
  'E9 after a failed attempt the retry gets a NEW mail_log id (new Idempotency-Key)');
select is(
  (select mail_log_id::text from public.platform_digest_deliveries
    where recipient_id = '99999999-9999-4999-8999-999999999998'
      and digest_date = (now() at time zone 'Europe/Amsterdam')::date),
  current_setting('pgtap.m3'), 'E10 …and the ledger now points at the retry');

-- Yesterday's sent digest never blocks today: move today's ledger row back.
update public.platform_digest_deliveries set digest_date = digest_date - 1
 where recipient_id = '99999999-9999-4999-8999-999999999999';
select pg_temp.as_service();
select isnt(public.log_platform_digest_mail('99999999-9999-4999-8999-999999999999'), null,
  'E11 a delivery on a previous day does not block today''s');

select throws_ok($$ select public.log_platform_digest_mail('11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'E12 a venue admin who is not a platform admin can never be a recipient');
select throws_ok($$ select public.log_platform_digest_mail(null) $$, '42501', null,
  'E13 a null recipient is refused');

select pg_temp.as_postgres();
update auth.users set banned_until = now() + interval '1 day'
 where id = '99999999-9999-4999-8999-999999999998';
insert into public.platform_digest_tokens (token_hash) values (extensions.digest('pgtap-token-2', 'sha256'));
select pg_temp.as_service();
select is(
  (select jsonb_agg(r ->> 'id') from jsonb_array_elements(
     public.platform_digest_begin('pgtap-token-2') -> 'recipients') r),
  '["99999999-9999-4999-8999-999999999999"]'::jsonb,
  'E14 a banned platform admin is no longer a recipient');
select pg_temp.as_postgres();
delete from public.platform_digest_deliveries where recipient_id = '99999999-9999-4999-8999-999999999998';
select pg_temp.as_service();
select throws_ok($$ select public.log_platform_digest_mail('99999999-9999-4999-8999-999999999998') $$,
  '42501', null, 'E15 …and cannot be logged as one either');
select pg_temp.as_postgres();

select is(public.mail_venue_cap_reached('aa000000-0000-7000-8000-000000000001'), false,
  'E16 digest rows carry no venue, so no company''s daily mail cap moves');

-- The digest row (sent above, inside the window) does not start the 60-second
-- recipient window of log_mail_attempt: a team mail right after it goes out.
select pg_temp.as_service();
select isnt(
  public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001',
    encode(extensions.digest('platform@plusone.test', 'sha256'), 'hex')),
  null, 'E17 a team mail to a platform admin right after the digest is not throttled');
select throws_ok(
  $$ select public.log_mail_attempt('team_resend', 'aa000000-0000-7000-8000-000000000001',
       encode(extensions.digest('platform@plusone.test', 'sha256'), 'hex')) $$,
  'PM429', null, 'E18 …while a second team mail within the window still is (the window itself is unchanged)');
select pg_temp.as_postgres();

select * from finish();
rollback;
