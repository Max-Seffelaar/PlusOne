-- pgTAP — quota grants only for people tied to the company (20261016150000).
--
-- Claims:
--   * a venue admin can grant a venue quota to a member and an event quota to a
--     member or to crew of the venue (on that event or another event of it);
--   * a venue admin can NOT grant either to a uuid with no tie to the venue —
--     an existing account and a non-existent uuid get the SAME 42501 RLS error,
--     so the FK error (23503) is no longer an account-existence oracle, and no
--     audit row is written for the stranger;
--   * the app's PostgREST upsert shape (ON CONFLICT DO UPDATE) still works for a
--     tied target and is refused for an untied one;
--   * key columns (user_id, venue_id / event_id, id) cannot be changed by
--     UPDATE — not to a stranger, not to another member, not even by the owner;
--   * an untied row (forged before the fix) is invisible to the update policy
--     (USING) but the admin can still delete it;
--   * a non-admin member still cannot grant; a platform admin still can
--     (decision #49, same as event_organizers_insert_admin).
--
-- Own fixtures only (fresh uuids) so the file does not depend on the seed's
-- quota rows. Everything rolls back.

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

create function pg_temp.mk_user(p_id uuid, p_email text, p_name text) returns void language plpgsql as $fn$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('full_name', p_name),
    now(), now(), '', '', '', '', '', '', '', ''
  );
  insert into public.user_profiles (id, full_name, email) values (p_id, p_name, p_email);
end;
$fn$;

select plan(31);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Company Q (venue q…f1) with events q…e1 and q…e2:
--   admin  q…a1   member (staff) q…a2   member 2 (staff) q…a3
--   crew   q…a4 (event_organizers on e1 only)
--   stranger q…a5 (real account, no tie to Q)
--   operator q…a6 (platform admin, no tie to Q)
-- Company R (venue q…f2) with event q…e3, admin q…a1 too (for venue repointing).
-- ---------------------------------------------------------------------------

select pg_temp.mk_user('9a700000-0000-4000-8000-0000000000a1', 'qt-admin@plusone.test',    'Quota Admin');
select pg_temp.mk_user('9a700000-0000-4000-8000-0000000000a2', 'qt-member@plusone.test',   'Quota Member');
select pg_temp.mk_user('9a700000-0000-4000-8000-0000000000a3', 'qt-member2@plusone.test',  'Quota Member Two');
select pg_temp.mk_user('9a700000-0000-4000-8000-0000000000a4', 'qt-crew@plusone.test',     'Quota Crew');
select pg_temp.mk_user('9a700000-0000-4000-8000-0000000000a5', 'qt-stranger@plusone.test', 'Quota Stranger');
select pg_temp.mk_user('9a700000-0000-4000-8000-0000000000a6', 'qt-operator@plusone.test', 'Quota Operator');

insert into public.venues (id, name, slug) values
  ('9a700000-0000-7000-8000-0000000000f1', 'Quota Club', 'pgtap-quota-club'),
  ('9a700000-0000-7000-8000-0000000000f2', 'Quota Other', 'pgtap-quota-other');
insert into public.venue_memberships (venue_id, user_id, roles) values
  ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a1', '{admin}'),
  ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a2', '{staff}'),
  ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a3', '{staff}'),
  ('9a700000-0000-7000-8000-0000000000f2', '9a700000-0000-4000-8000-0000000000a1', '{admin}');
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug) values
  ('9a700000-0000-7000-8000-0000000000e1', '9a700000-0000-7000-8000-0000000000f1', 'Quota Night One',
   now() + interval '3 days', now() + interval '3 days 6 hours', 'open', 'pgtap-quota-one'),
  ('9a700000-0000-7000-8000-0000000000e2', '9a700000-0000-7000-8000-0000000000f1', 'Quota Night Two',
   now() + interval '4 days', now() + interval '4 days 6 hours', 'open', 'pgtap-quota-two'),
  ('9a700000-0000-7000-8000-0000000000e3', '9a700000-0000-7000-8000-0000000000f2', 'Quota Night Elsewhere',
   now() + interval '5 days', now() + interval '5 days 6 hours', 'open', 'pgtap-quota-three');
insert into public.event_organizers (event_id, user_id) values
  ('9a700000-0000-7000-8000-0000000000e1', '9a700000-0000-4000-8000-0000000000a4');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = '9a700000-0000-4000-8000-0000000000a6';
select set_config('plusone.platform_admin_write', 'off', true);

-- ---------------------------------------------------------------------------
-- A. Allowed: tied targets
-- ---------------------------------------------------------------------------
select pg_temp.login('9a700000-0000-4000-8000-0000000000a1');

select lives_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a2', 4)
$$, 'A1 admin grants a venue quota to a member');

select lives_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e1', '9a700000-0000-4000-8000-0000000000a2', 6)
$$, 'A2 admin grants an event quota to a member');

select lives_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e1', '9a700000-0000-4000-8000-0000000000a4', 3)
$$, 'A3 admin grants an event quota to crew of that event');

select lives_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e2', '9a700000-0000-4000-8000-0000000000a4', 2)
$$, 'A4 crew of another event of the same venue is tied too (returning-crew pool)');

-- The app's write shape: PostgREST upsert = INSERT … ON CONFLICT DO UPDATE SET
-- every payload column (incl. the unchanged key columns) = EXCLUDED.
select lives_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a2', 7)
  on conflict (venue_id, user_id) do update
    set venue_id = excluded.venue_id, user_id = excluded.user_id, default_count = excluded.default_count
$$, 'A5 setDefaultQuotaAction upsert shape on an existing row still works');

select lives_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e1', '9a700000-0000-4000-8000-0000000000a4', 5)
  on conflict (event_id, user_id) do update
    set event_id = excluded.event_id, user_id = excluded.user_id, quota_override = excluded.quota_override
$$, 'A6 upsertCrewQuota upsert shape on an existing row still works');

select lives_ok($$
  update public.quotas set default_count = 8
   where venue_id = '9a700000-0000-7000-8000-0000000000f1'
     and user_id = '9a700000-0000-4000-8000-0000000000a2'
$$, 'A7 a plain count update on a member''s row works');
reset role;

select is((select default_count from public.quotas
            where venue_id = '9a700000-0000-7000-8000-0000000000f1'
              and user_id = '9a700000-0000-4000-8000-0000000000a2'), 8,
  'A8 DB state: the member''s venue quota is 8 after the upsert + update');
select is((select quota_override from public.event_quotas
            where event_id = '9a700000-0000-7000-8000-0000000000e1'
              and user_id = '9a700000-0000-4000-8000-0000000000a4'), 5,
  'A9 DB state: the crew override is 5 after the upsert');

-- ---------------------------------------------------------------------------
-- B. Denied: untied targets on INSERT (and the existence oracle is gone)
-- ---------------------------------------------------------------------------
select pg_temp.login('9a700000-0000-4000-8000-0000000000a1');

select throws_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a5', 3)
$$, '42501', 'new row violates row-level security policy for table "quotas"',
  'B1 venue quota for an existing but untied account is refused');

select throws_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000ff', 3)
$$, '42501', 'new row violates row-level security policy for table "quotas"',
  'B2 …and a uuid with no account gets the identical error (no 23503 existence oracle)');

select throws_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e1', '9a700000-0000-4000-8000-0000000000a5', 3)
$$, '42501', 'new row violates row-level security policy for table "event_quotas"',
  'B3 event quota for an existing but untied account is refused');

select throws_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e1', '9a700000-0000-4000-8000-0000000000ff', 3)
$$, '42501', 'new row violates row-level security policy for table "event_quotas"',
  'B4 …and a uuid with no account gets the identical error');

select throws_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a5', 3)
  on conflict (venue_id, user_id) do update set default_count = excluded.default_count
$$, '42501', null, 'B5 the upsert shape for an untied account is refused too');

select throws_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e3', '9a700000-0000-4000-8000-0000000000a4', 3)
$$, '42501', null,
  'B6 crew of company Q is not tied to company R, even for the same admin');
reset role;

select is((select count(*)::int from public.audit_log
            where entity_type in ('quotas', 'event_quotas')
              and (diff -> 'after' ->> 'user_id') in ('9a700000-0000-4000-8000-0000000000a5',
                                                      '9a700000-0000-4000-8000-0000000000ff')), 0,
  'B7 no audit row names the stranger or the made-up uuid');

-- A member who is not admin still cannot grant, not even to themselves.
select pg_temp.login('9a700000-0000-4000-8000-0000000000a3');
select throws_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a3', 50)
$$, '42501', null, 'B8 a staff member cannot grant themselves a quota');
reset role;

-- ---------------------------------------------------------------------------
-- C. Denied: repointing key columns on UPDATE
-- ---------------------------------------------------------------------------
select pg_temp.login('9a700000-0000-4000-8000-0000000000a1');

select throws_ok($$
  update public.quotas set user_id = '9a700000-0000-4000-8000-0000000000a5'
   where venue_id = '9a700000-0000-7000-8000-0000000000f1'
     and user_id = '9a700000-0000-4000-8000-0000000000a2'
$$, '42501', null, 'C1 repointing a venue quota to an untied account is refused');

select throws_ok($$
  update public.quotas set user_id = '9a700000-0000-4000-8000-0000000000a3'
   where venue_id = '9a700000-0000-7000-8000-0000000000f1'
     and user_id = '9a700000-0000-4000-8000-0000000000a2'
$$, '42501', 'quotas.user_id cannot be changed',
  'C2 …and to another member too: user_id is immutable');

select throws_ok($$
  update public.quotas set venue_id = '9a700000-0000-7000-8000-0000000000f2'
   where venue_id = '9a700000-0000-7000-8000-0000000000f1'
     and user_id = '9a700000-0000-4000-8000-0000000000a2'
$$, '42501', 'quotas.venue_id cannot be changed',
  'C3 moving a venue quota to another company of the same admin is refused');

select throws_ok($$
  update public.event_quotas set user_id = '9a700000-0000-4000-8000-0000000000a5'
   where event_id = '9a700000-0000-7000-8000-0000000000e1'
     and user_id = '9a700000-0000-4000-8000-0000000000a4'
$$, '42501', null, 'C4 repointing an event quota to an untied account is refused');

select throws_ok($$
  update public.event_quotas set event_id = '9a700000-0000-7000-8000-0000000000e3'
   where event_id = '9a700000-0000-7000-8000-0000000000e1'
     and user_id = '9a700000-0000-4000-8000-0000000000a4'
$$, '42501', 'event_quotas.event_id cannot be changed',
  'C5 moving an event quota to another venue''s event is refused');
reset role;

select throws_ok($$
  update public.quotas set user_id = '9a700000-0000-4000-8000-0000000000a3'
   where venue_id = '9a700000-0000-7000-8000-0000000000f1'
     and user_id = '9a700000-0000-4000-8000-0000000000a2'
$$, '42501', 'quotas.user_id cannot be changed',
  'C6 the key is immutable for the owner as well (trigger, not just RLS)');

-- ---------------------------------------------------------------------------
-- D. A row forged before the fix (only the owner can make one now)
-- ---------------------------------------------------------------------------
insert into public.quotas (venue_id, user_id, default_count)
values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a5', 9);
create temp table d1_hits on commit drop as select -1::bigint as n;
grant all on d1_hits to authenticated;

select pg_temp.login('9a700000-0000-4000-8000-0000000000a1');
with u as (
  update public.quotas set default_count = 1
   where venue_id = '9a700000-0000-7000-8000-0000000000f1'
     and user_id = '9a700000-0000-4000-8000-0000000000a5'
  returning 1
)
update d1_hits set n = (select count(*) from u);
select is((select n::int from d1_hits), 0,
  'D1 the admin''s update cannot reach a forged untied row (USING)');
select lives_ok($$
  delete from public.quotas
   where venue_id = '9a700000-0000-7000-8000-0000000000f1'
     and user_id = '9a700000-0000-4000-8000-0000000000a5'
$$, 'D2 …but can delete it (delete policy unchanged)');
reset role;
select is((select count(*)::int from public.quotas
            where venue_id = '9a700000-0000-7000-8000-0000000000f1'
              and user_id = '9a700000-0000-4000-8000-0000000000a5'), 0,
  'D3 DB state: the forged row is gone');

-- ---------------------------------------------------------------------------
-- E. Platform admin (decision #49): same exception as event_organizers
-- ---------------------------------------------------------------------------
select pg_temp.login('9a700000-0000-4000-8000-0000000000a6');
select lives_ok($$
  insert into public.quotas (venue_id, user_id, default_count)
  values ('9a700000-0000-7000-8000-0000000000f1', '9a700000-0000-4000-8000-0000000000a3', 2)
$$, 'E1 a platform admin (no membership) grants a member a quota');
select lives_ok($$
  insert into public.event_quotas (event_id, user_id, quota_override)
  values ('9a700000-0000-7000-8000-0000000000e2', '9a700000-0000-4000-8000-0000000000a5', 2)
$$, 'E2 a platform admin may still grant to an untied account (mirrors event_organizers_insert_admin)');
select throws_ok($$
  update public.event_quotas set user_id = '9a700000-0000-4000-8000-0000000000a3'
   where event_id = '9a700000-0000-7000-8000-0000000000e2'
     and user_id = '9a700000-0000-4000-8000-0000000000a5'
$$, '42501', 'event_quotas.user_id cannot be changed',
  'E3 …but cannot repoint a key column either');
reset role;

-- ---------------------------------------------------------------------------
-- F. Catalog: both policies carry the tie, both triggers exist
-- ---------------------------------------------------------------------------
select ok((select bool_and(pg_get_expr(polwithcheck, polrelid) like '%is_tied_to_venue%')
             from pg_policy
            where polname in ('quotas_insert_admin', 'quotas_update_admin',
                              'event_quotas_insert_admin', 'event_quotas_update_admin')),
  'F1 every quota insert/update WITH CHECK calls is_tied_to_venue');
select ok((select bool_and(pg_get_expr(polqual, polrelid) like '%is_tied_to_venue%')
             from pg_policy
            where polname in ('quotas_update_admin', 'event_quotas_update_admin')),
  'F2 both update policies also require the tie on the existing row (USING)');

select * from finish();
rollback;
