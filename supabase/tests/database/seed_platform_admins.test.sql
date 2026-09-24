-- pgTAP — seed platform admins migration (P-06, z8uq9m0tny, decision #49).
--
-- 20260924130000_seed_platform_admins.sql already ran once, at reset time,
-- before this file's transaction opens — and on this local database neither
-- real target address exists, so that first run was a no-op. This file
-- proves public.seed_platform_admin_by_email_hash()'s properties directly,
-- against fixture addresses that are NOT the real ones (no real e-mail
-- appears anywhere in this repo, which is public):
--
--   * calling it with a fixture hash flags that account, audits the grant,
--     and is idempotent (running it twice is the same end state, no error,
--     no duplicate audit row);
--   * a fixture account whose hash was never passed in is never flagged;
--   * the helper is not reachable by any app role — only the owner (the
--     migration, and this suite) can call it;
--   * the real local seed users (admin@plusone.test and friends) are still
--     ordinary, non-platform-admin accounts after a fresh reset —
--     platform_admin.test.sql's fixtures depend on that exact fact.
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures — two stand-in addresses to grant, one decoy never passed to the
-- helper, none colliding with seed.sql's or platform_admin.test.sql's ids.
-- Hashes below are sha256(lower(address)) for these FIXTURE addresses only —
-- unrelated to the real hashes in the migration.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('f0000000-0000-4000-8000-000000000001'::uuid, 'fixture-max@example.test',   'Fixture Max'),
  ('f0000000-0000-4000-8000-000000000002'::uuid, 'fixture-joeri@example.test', 'Fixture Joeri'),
  ('f0000000-0000-4000-8000-000000000003'::uuid, 'fixture-decoy@example.test', 'Fixture Decoy')
) as u (id, email, full_name);

insert into public.user_profiles (id, full_name, email) values
  ('f0000000-0000-4000-8000-000000000001', 'Fixture Max',   'fixture-max@example.test'),
  ('f0000000-0000-4000-8000-000000000002', 'Fixture Joeri', 'fixture-joeri@example.test'),
  ('f0000000-0000-4000-8000-000000000003', 'Fixture Decoy', 'fixture-decoy@example.test');

-- ---------------------------------------------------------------------------
-- Run 1 — grant to the two fixture hashes, decoy's hash never passed
-- ---------------------------------------------------------------------------

select lives_ok($$
  select public.seed_platform_admin_by_email_hash(
    '66173f455a0f8ba77db621d5088a4b270856a141b9a08a657d3e62d06b3c8341')
$$, 'A1 the helper runs without error for the fixture-max hash');

select lives_ok($$
  select public.seed_platform_admin_by_email_hash(
    'a1f69c21315735fd58f3bc17149800f9b831aeaa700b0b51f6519062774948bc')
$$, 'A2 the helper runs without error for the fixture-joeri hash');

select ok((select is_platform_admin from public.user_profiles
           where id = 'f0000000-0000-4000-8000-000000000001'),
  'B1 fixture-max is flagged after run 1');

select ok((select is_platform_admin from public.user_profiles
           where id = 'f0000000-0000-4000-8000-000000000002'),
  'B2 fixture-joeri is flagged after run 1');

select ok(not (select is_platform_admin from public.user_profiles
                where id = 'f0000000-0000-4000-8000-000000000003'),
  'B3 the decoy fixture (its hash was never passed in) is never flagged');

select is((select count(*)::int from public.audit_log
           where entity_type = 'user_profiles'
             and action = 'platform_admin_grant'
             and entity_id in ('f0000000-0000-4000-8000-000000000001',
                                'f0000000-0000-4000-8000-000000000002')
             and actor_id is null), 2,
  'B4 exactly one audited grant per fixture, actor_id null (system action, like #29)');

-- ---------------------------------------------------------------------------
-- Run 2 — same two hashes again: idempotent, no error, no extra audit rows
-- ---------------------------------------------------------------------------

select lives_ok($$
  select public.seed_platform_admin_by_email_hash(
    '66173f455a0f8ba77db621d5088a4b270856a141b9a08a657d3e62d06b3c8341')
$$, 'C1 calling the helper again for the same hash does not error');

select lives_ok($$
  select public.seed_platform_admin_by_email_hash(
    'a1f69c21315735fd58f3bc17149800f9b831aeaa700b0b51f6519062774948bc')
$$, 'C2 …nor does the second');

select is((select count(*)::int from public.audit_log
           where entity_type = 'user_profiles'
             and action = 'platform_admin_grant'
             and entity_id in ('f0000000-0000-4000-8000-000000000001',
                                'f0000000-0000-4000-8000-000000000002')
             and actor_id is null), 2,
  'C3 run 2 wrote NO extra audit rows — same 2 as after run 1');

-- ---------------------------------------------------------------------------
-- The helper is not reachable by any app role — only the owner (migrations,
-- this suite) can call it, same shape as the internal math it sits beside
-- (user_is_quota_exempt, I5 in platform_admin.test.sql).
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated',
    'public.seed_platform_admin_by_email_hash(text)', 'EXECUTE'),
  'D1 authenticated cannot execute seed_platform_admin_by_email_hash');

select ok(
  not has_function_privilege('anon',
    'public.seed_platform_admin_by_email_hash(text)', 'EXECUTE'),
  'D2 …neither can anon');

select ok(
  not has_function_privilege('service_role',
    'public.seed_platform_admin_by_email_hash(text)', 'EXECUTE'),
  'D3 …nor service_role');

-- ---------------------------------------------------------------------------
-- The real local seed users must be untouched: platform_admin.test.sql treats
-- admin@plusone.test as a venue admin who is NOT a platform admin.
-- ---------------------------------------------------------------------------

select is((select bool_or(is_platform_admin) from public.user_profiles
           where id in ('11111111-1111-4111-8111-111111111111',
                        '22222222-2222-4222-8222-222222222222',
                        '33333333-3333-4333-8333-333333333333',
                        '44444444-4444-4444-8444-444444444444',
                        '55555555-5555-4555-8555-555555555555',
                        '66666666-6666-4666-8666-666666666666')), false,
  'E1 every local seed user (admin@plusone.test and friends) is still false');

select * from finish();
rollback;
