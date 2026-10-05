-- pgTAP — platform_access_log (legal v0.3 B3, z8uq9m2hm5).
--
-- Threat model (CLAUDE.md #1): the anon/auth key ships to the browser, so every
-- claim has to hold against raw PostgREST calls. Two footholds:
--   * a venue admin WITHOUT the platform flag, who must neither read the log
--     (decision 3: the customer never sees it) nor write into it;
--   * a platform admin who wants to wipe, rewrite or forge their own trail —
--     insert on someone else's name, back-date a row, update or delete one.
--
-- This file proves:
--   * grants: authenticated holds SELECT + INSERT only; anon holds nothing;
--   * a platform admin inserts for themself (default and explicit admin_id),
--     never for another platform admin;
--   * created_at is server-stamped — a client-supplied value is overwritten;
--   * UPDATE and DELETE are refused for a platform admin too;
--   * venue admin / staff see zero rows and cannot insert, also not on a
--     platform admin's name;
--   * anon reaches nothing;
--   * rows go with their venue (on delete cascade).
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

select plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — RLS bypassed, like the seed)
-- ---------------------------------------------------------------------------
-- Two platform admins with no venue membership. The seed's admin@plusone.test
-- (1111…) is a venue admin at Club Vesper and NOT a platform admin; staff@
-- (5555…) is staff there.

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
  ('99999999-9999-4999-8999-999999999999'::uuid, 'platform@plusone.test', 'Joeri Platform'),
  ('98888888-8888-4888-8888-888888888888'::uuid, 'platform2@plusone.test', 'Second Platform')
) as u (id, email, full_name);

insert into public.user_profiles (id, full_name, email) values
  ('99999999-9999-4999-8999-999999999999', 'Joeri Platform', 'platform@plusone.test'),
  ('98888888-8888-4888-8888-888888888888', 'Second Platform', 'platform2@plusone.test');

-- Bootstrap path from 20260923120000: the flag only moves with the GUC on.
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id in ('99999999-9999-4999-8999-999999999999',
              '98888888-8888-4888-8888-888888888888');
select set_config('plusone.platform_admin_write', 'off', true);

-- A throwaway venue for the cascade check.
insert into public.venues (id, name, slug) values
  ('ac000000-0000-7000-8000-0000000000c1', 'Cascade Club', 'cascade-club');

-- ---------------------------------------------------------------------------
-- A. Grants + RLS — the layer under the policies
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.platform_access_log', 'SELECT')
  and not has_table_privilege('anon', 'public.platform_access_log', 'INSERT'),
  'A1 anon holds neither SELECT nor INSERT'
);

select ok(
  has_table_privilege('authenticated', 'public.platform_access_log', 'SELECT')
  and has_table_privilege('authenticated', 'public.platform_access_log', 'INSERT'),
  'A2 authenticated holds SELECT + INSERT'
);

select ok(
  not has_table_privilege('authenticated', 'public.platform_access_log', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.platform_access_log', 'DELETE')
  and not has_table_privilege('authenticated', 'public.platform_access_log', 'TRUNCATE'),
  'A3 authenticated holds no UPDATE, DELETE or TRUNCATE — append-only'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_access_log'::regclass),
  'A4 RLS is enabled'
);

select has_trigger('public', 'platform_access_log', 'stamp_platform_access_log',
  'A5 created_at is stamped by a BEFORE INSERT trigger');

-- ---------------------------------------------------------------------------
-- B. Platform admin — inserts for self only, cannot rewrite or wipe
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');

select lives_ok($$
  insert into public.platform_access_log (venue_id)
  values ('aa000000-0000-7000-8000-000000000001')
$$, 'B1 platform admin logs a switch (admin_id defaults to auth.uid())');

select lives_ok($$
  insert into public.platform_access_log (admin_id, venue_id, reason)
  values ('99999999-9999-4999-8999-999999999999',
          'aa000000-0000-7000-8000-000000000002', 'ticket-42')
$$, 'B2 platform admin logs a switch with an explicit own admin_id + reason');

select throws_ok($$
  insert into public.platform_access_log (admin_id, venue_id)
  values ('98888888-8888-4888-8888-888888888888',
          'aa000000-0000-7000-8000-000000000001')
$$, '42501', null, 'B3 platform admin cannot insert on another platform admin''s name');

select lives_ok($$
  insert into public.platform_access_log (venue_id, reason, created_at)
  values ('aa000000-0000-7000-8000-000000000001', 'backdated', '2020-01-01 00:00:00+00')
$$, 'B4 an insert that supplies created_at is accepted …');

select is(
  (select created_at from public.platform_access_log where reason = 'backdated'),
  now(),
  'B5 … but created_at is the server clock, not the client value'
);

select is(
  (select count(*)::int from public.platform_access_log
    where admin_id = '99999999-9999-4999-8999-999999999999'),
  3,
  'B6 every row the platform admin wrote carries their own admin_id'
);

select throws_ok($$
  update public.platform_access_log set reason = 'rewritten'
$$, '42501', null, 'B7 platform admin cannot UPDATE a row');

select throws_ok($$
  delete from public.platform_access_log
$$, '42501', null, 'B8 platform admin cannot DELETE a row');

select pg_temp.login('98888888-8888-4888-8888-888888888888');

select lives_ok($$
  insert into public.platform_access_log (venue_id)
  values ('ac000000-0000-7000-8000-0000000000c1')
$$, 'B9 a second platform admin logs their own switch');

select is(
  (select count(*)::int from public.platform_access_log),
  4,
  'B10 a platform admin reads every row, including a colleague''s'
);

-- ---------------------------------------------------------------------------
-- C. Venue admin (no platform flag) and staff — nothing in, nothing out
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');

select is(
  (select count(*)::int from public.platform_access_log),
  0,
  'C1 a venue admin sees zero rows, also for their own venue (decision 3)'
);

select throws_ok($$
  insert into public.platform_access_log (venue_id)
  values ('aa000000-0000-7000-8000-000000000001')
$$, '42501', null, 'C2 a venue admin cannot insert for themself');

select throws_ok($$
  insert into public.platform_access_log (admin_id, venue_id)
  values ('99999999-9999-4999-8999-999999999999',
          'aa000000-0000-7000-8000-000000000001')
$$, '42501', null, 'C3 a venue admin cannot insert on a platform admin''s name');

select throws_ok($$
  delete from public.platform_access_log
$$, '42501', null, 'C4 a venue admin cannot DELETE');

select pg_temp.login('55555555-5555-4555-8555-555555555555');

select is(
  (select count(*)::int from public.platform_access_log),
  0,
  'C5 staff sees zero rows'
);

-- ---------------------------------------------------------------------------
-- D. anon
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();

select throws_ok($$select count(*) from public.platform_access_log$$,
  '42501', null, 'D1 anon cannot read the log');

select throws_ok($$
  insert into public.platform_access_log (admin_id, venue_id)
  values ('99999999-9999-4999-8999-999999999999',
          'aa000000-0000-7000-8000-000000000001')
$$, '42501', null, 'D2 anon cannot insert');

-- ---------------------------------------------------------------------------
-- E. Retention — rows live as long as the venue (ToS 16.6)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);

delete from public.venues where id = 'ac000000-0000-7000-8000-0000000000c1';

select is(
  (select count(*)::int from public.platform_access_log
    where venue_id = 'ac000000-0000-7000-8000-0000000000c1'),
  0,
  'E1 deleting the venue removes its access-log rows (on delete cascade)'
);

select * from finish();

rollback;
