-- pgTAP — a company always keeps at least one admin (onboarding task 0g),
-- 20261012120000_last_admin_guard.sql (trigger refuse_last_admin_removal).
--
-- Threat model: a venue admin (or a platform admin, via the has_venue_role
-- disjunct) holds the anon key + their JWT. venue_memberships_delete /
-- venue_memberships_update let them delete or demote ANY admin row of the
-- venue straight from PostgREST, their own included, leaving the company
-- without an admin (nobody can invite any more). Proves:
--   A. trigger shape: BEFORE UPDATE OF venue_id, roles OR DELETE, row level,
--      security definer, pinned search_path, no execute for app roles;
--   B. the only admin (REST role `authenticated`) cannot delete or demote
--      their own row (P0LA1), can still edit their roles while keeping admin,
--      and can remove a non-admin row;
--   C. with a second admin both the demotion and the removal pass; the new
--      last admin is then refused again; one statement that removes every
--      admin rolls back whole; moving the last admin to another venue is
--      refused; {admin,admin} still counts as ONE admin row; {ADMIN} is no
--      role at all;
--   D. a platform admin (no membership), the service role and the table
--      owner are refused alike;
--   E. the demo membership still answers 42501 (its own trigger fires first)
--      and the demo seed's upsert path keeps working;
--   F. cascades: today every FK into venue_memberships is ON DELETE RESTRICT
--      (no cascade reaches the table); with a simulated ON DELETE CASCADE,
--      deleting the venue or the account removes the last admin's row
--      without a P0LA1 — the trigger only guards venues that stay.
--
-- Concurrency (two sessions) cannot be shown in one pgTAP transaction; see
-- scripts/last-admin-concurrency-test.mjs (pnpm db:test:concurrency).
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.as_service()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

-- Back to the migration owner with no JWT at all (SQL editor / migration).
create function pg_temp.as_owner()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

create function pg_temp.mk_user(p_id uuid, p_email text)
returns void language plpgsql as $fn$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', '', '', '', ''
  );
  insert into public.user_profiles (id, full_name, email) values (p_id, split_part(p_email, '@', 1), p_email);
end;
$fn$;

create function pg_temp.roles_of(p_venue uuid, p_user uuid)
returns public.venue_role[] language sql as $fn$
  select roles from public.venue_memberships where venue_id = p_venue and user_id = p_user;
$fn$;

select plan(45);

-- ── Fixtures (as owner) ─────────────────────────────────────────────────────
-- Company X: Ada (only admin) + Sam (staff). Bo joins as second admin in C.
-- Pia: platform admin without any membership. Company Y: a move target.
select pg_temp.mk_user('1a000000-0000-4000-8000-0000000000a1', 'ada@lastadmin.test');
select pg_temp.mk_user('1a000000-0000-4000-8000-0000000000b1', 'bo@lastadmin.test');
select pg_temp.mk_user('1a000000-0000-4000-8000-0000000000c1', 'sam@lastadmin.test');
select pg_temp.mk_user('1a000000-0000-4000-8000-0000000000d1', 'pia@lastadmin.test');
select pg_temp.mk_user('1a000000-0000-4000-8000-0000000000e1', 'una@lastadmin.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true where id = '1a000000-0000-4000-8000-0000000000d1';
select set_config('plusone.platform_admin_write', 'off', true);

insert into public.venues (id, name, slug) values
  ('1a000000-0000-7000-8000-00000000000a', 'Last Admin X', 'last-admin-x'),
  ('1a000000-0000-7000-8000-00000000000b', 'Last Admin Y', 'last-admin-y'),
  ('1a000000-0000-7000-8000-00000000000c', 'Cascade Venue', 'last-admin-cascade-venue'),
  ('1a000000-0000-7000-8000-00000000000d', 'Cascade User', 'last-admin-cascade-user');

insert into public.venue_memberships (venue_id, user_id, roles) values
  ('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a1', '{admin}'),
  ('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000c1', '{staff}'),
  ('1a000000-0000-7000-8000-00000000000b', '1a000000-0000-4000-8000-0000000000b1', '{admin}');

-- ---------------------------------------------------------------------------
-- A. Shape
-- ---------------------------------------------------------------------------

select ok(
  exists (select 1 from pg_trigger
           where tgrelid = 'public.venue_memberships'::regclass
             and tgname = 'refuse_last_admin_removal'
             and not tgisinternal
             -- BEFORE (2) + ROW (1) + DELETE (8) + UPDATE (16) = 27
             and tgtype::int = 27
             and tgattr::int2[] @> array[
               (select attnum from pg_attribute where attrelid = 'public.venue_memberships'::regclass and attname = 'venue_id'),
               (select attnum from pg_attribute where attrelid = 'public.venue_memberships'::regclass and attname = 'roles')]),
  'A1 BEFORE UPDATE OF venue_id, roles OR DELETE row trigger on venue_memberships');

select ok(
  (select prosecdef from pg_proc where oid = 'public.refuse_last_admin_removal()'::regprocedure),
  'A2 the trigger function is security definer');

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.refuse_last_admin_removal()'::regprocedure),
  'A3 with a pinned empty search_path');

select ok(
  not has_function_privilege('authenticated', 'public.refuse_last_admin_removal()', 'execute')
  and not has_function_privilege('anon', 'public.refuse_last_admin_removal()', 'execute'),
  'A4 no execute for anon/authenticated');

-- ---------------------------------------------------------------------------
-- B. The only admin, over the REST role
-- ---------------------------------------------------------------------------

select pg_temp.login('1a000000-0000-4000-8000-0000000000a1', 'ada@lastadmin.test');

select throws_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'B1 the only admin cannot remove themselves');

select throws_ok($$
  update public.venue_memberships set roles = '{staff}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'B2 nor take the admin role off themselves');

select throws_ok($$
  update public.venue_memberships set roles = '{finance,user_manager}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'B3 nor trade admin for other manager roles');

select lives_ok($$
  update public.venue_memberships set roles = '{admin,doorhost}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'B4 a role change that keeps admin still works');

select lives_ok($$
  update public.venue_memberships set roles = '{staff,doorhost}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000c1'
$$, 'B5 a non-admin row''s roles still change');

select lives_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000c1'
$$, 'B6 a non-admin row can still be removed');
select pg_temp.as_owner();

select is(pg_temp.roles_of('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a1'),
  '{admin,doorhost}'::public.venue_role[], 'B7 the admin row is intact (B4''s change only)');
select is(pg_temp.roles_of('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000c1'),
  null, 'B8 and the staff row is really gone');

-- ---------------------------------------------------------------------------
-- C. Second admin, multi-row, moves, array tricks
-- ---------------------------------------------------------------------------

insert into public.venue_memberships (venue_id, user_id, roles) values
  ('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000b1', '{admin}');

select pg_temp.login('1a000000-0000-4000-8000-0000000000a1', 'ada@lastadmin.test');
select lives_ok($$
  update public.venue_memberships set roles = '{staff}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'C1 with a second admin, an admin may drop their own admin role');
select pg_temp.as_owner();
select is(pg_temp.roles_of('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a1'),
  '{staff}'::public.venue_role[], 'C2 the demotion really happened');

-- Bo is the last admin now: refused again, both ways.
select pg_temp.login('1a000000-0000-4000-8000-0000000000b1', 'bo@lastadmin.test');
select throws_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C3 the new last admin cannot remove themselves');
select throws_ok($$
  update public.venue_memberships set roles = '{finance}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C4 nor demote themselves');

-- Promote Ada back, then Bo removes Ada (another admin's row) and Ada's row goes.
select lives_ok($$
  update public.venue_memberships set roles = '{admin}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'C5 promoting someone to admin is never refused');
select lives_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000a1'
$$, 'C6 with a second admin, an admin can remove another admin');
select throws_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C7 and is then the last admin again');
select pg_temp.as_owner();
select is(
  (select count(*)::int from public.venue_memberships where venue_id = '1a000000-0000-7000-8000-00000000000a'),
  1, 'C8 company X has exactly its one admin left');

-- Two admins, one statement deleting both: the second row's trigger sees the
-- first one gone and refuses, so the whole statement rolls back.
insert into public.venue_memberships (venue_id, user_id, roles) values
  ('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000a1', '{admin}');
select pg_temp.login('1a000000-0000-4000-8000-0000000000b1', 'bo@lastadmin.test');
select throws_ok($$
  delete from public.venue_memberships where venue_id = '1a000000-0000-7000-8000-00000000000a'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C9 one statement removing every admin is refused');
select throws_ok($$
  update public.venue_memberships set roles = '{staff}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C10 so is one statement demoting every admin');
select pg_temp.as_owner();
select is(
  (select count(*)::int from public.venue_memberships
    where venue_id = '1a000000-0000-7000-8000-00000000000a' and 'admin' = any (roles)),
  2, 'C11 both admin rows survived C9/C10');

-- Back to one admin (Bo) for the rest.
delete from public.venue_memberships
 where venue_id = '1a000000-0000-7000-8000-00000000000a'
   and user_id = '1a000000-0000-4000-8000-0000000000a1';

-- venue_id is not client-writable (20261007150200), but the owner can move a
-- row: moving the last admin away from X is the same as removing it.
select throws_ok($$
  update public.venue_memberships set venue_id = '1a000000-0000-7000-8000-00000000000c'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C12 moving the last admin to another venue is refused');

-- Array tricks. A duplicate element is still one admin ROW.
update public.venue_memberships set roles = '{admin,admin}'
 where venue_id = '1a000000-0000-7000-8000-00000000000a'
   and user_id = '1a000000-0000-4000-8000-0000000000b1';
select pg_temp.login('1a000000-0000-4000-8000-0000000000b1', 'bo@lastadmin.test');
select throws_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C13 {admin,admin} counts as one admin: still the last');
select throws_ok($$
  update public.venue_memberships set roles = '{ADMIN}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, '22P02', null,
  'C14 {ADMIN} is not a role (enum cast fails before any trigger)');
select throws_ok($$
  update public.venue_memberships set roles = '{}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'C15 an empty role set is refused (the guard fires before the check constraint)');
select pg_temp.as_owner();

-- ---------------------------------------------------------------------------
-- D. No exceptions: platform admin, service role, owner
-- ---------------------------------------------------------------------------

select pg_temp.login('1a000000-0000-4000-8000-0000000000d1', 'pia@lastadmin.test');
select ok(public.is_platform_admin(), 'D1 Pia is a platform admin');
select throws_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'D2 a platform admin cannot remove a company''s last admin');
select throws_ok($$
  update public.venue_memberships set roles = '{staff}'
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'D3 nor demote them');

select pg_temp.as_service();
select throws_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'D4 the service role cannot either');

select pg_temp.as_owner();
select throws_ok($$
  delete from public.venue_memberships
   where venue_id = '1a000000-0000-7000-8000-00000000000a'
     and user_id = '1a000000-0000-4000-8000-0000000000b1'
$$, 'P0LA1', 'a company always keeps at least one admin',
  'D5 nor the table owner without a JWT');

select ok(pg_temp.roles_of('1a000000-0000-7000-8000-00000000000a', '1a000000-0000-4000-8000-0000000000b1') is not null,
  'D6 Bo''s admin row is still there');

-- ---------------------------------------------------------------------------
-- E. Demo venue unchanged
-- ---------------------------------------------------------------------------

select pg_temp.mk_user('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
insert into public.venues (id, name, slug)
values ('de300000-0000-7000-8000-000000000001', 'Demo venue', 'last-admin-demo-venue');
select pg_temp.as_service();
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles, job_title)
  values ('de300000-0000-7000-8000-000000000001', 'de300000-0000-7000-8000-00000000a001',
          '{admin,doorhost}', 'App review')
  on conflict (venue_id, user_id) do update set roles = excluded.roles, job_title = excluded.job_title
$$, 'E1 the demo seed''s upsert writes the demo membership');
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles, job_title)
  values ('de300000-0000-7000-8000-000000000001', 'de300000-0000-7000-8000-00000000a001',
          '{admin,doorhost}', 'App review')
  on conflict (venue_id, user_id) do update set roles = excluded.roles, job_title = excluded.job_title
$$, 'E2 and re-runs it (on-conflict update keeps admin)');

select pg_temp.login('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
select throws_ok($$
  delete from public.venue_memberships
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, '42501', 'the demo membership can only be changed by the demo seed',
  'E3 the demo admin''s self-delete still answers the demo trigger''s 42501 (it fires first)');
select throws_ok($$
  update public.venue_memberships set roles = '{doorhost}'
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, '42501', 'the demo membership can only be changed by the demo seed',
  'E4 and so does its self-demotion');
select pg_temp.as_owner();
select is(pg_temp.roles_of('de300000-0000-7000-8000-000000000001', 'de300000-0000-7000-8000-00000000a001'),
  '{admin,doorhost}'::public.venue_role[], 'E5 the demo membership is unchanged');

-- ---------------------------------------------------------------------------
-- F. Cascades
-- ---------------------------------------------------------------------------

select is(
  (select confdeltype::text from pg_constraint where conname = 'venue_memberships_venue_id_fkey'),
  'r', 'F1 today venue_memberships.venue_id is ON DELETE RESTRICT (no venue cascade reaches it)');
select is(
  (select confdeltype::text from pg_constraint where conname = 'venue_memberships_user_id_fkey'),
  'r', 'F2 and user_id too (no account cascade reaches it)');
select throws_ok($$
  delete from public.venues where id = '1a000000-0000-7000-8000-00000000000a'
$$, '23503', null,
  'F3 so deleting a venue with members fails on the FK, as before, not on the guard');

-- Simulated cascade (rolled back with everything else): the FKs a future
-- account-erasure or venue-delete migration would introduce. audit_log.venue_id
-- also RESTRICTs (its rows are permanent by design), so it is dropped here too
-- for the venue case only. No trigger is disabled.
alter table public.venue_memberships
  drop constraint venue_memberships_venue_id_fkey,
  add constraint venue_memberships_venue_id_fkey
    foreign key (venue_id) references public.venues (id) on delete cascade,
  drop constraint venue_memberships_user_id_fkey,
  add constraint venue_memberships_user_id_fkey
    foreign key (user_id) references public.user_profiles (id) on delete cascade;
alter table public.audit_log drop constraint audit_log_venue_id_fkey;

insert into public.venue_memberships (venue_id, user_id, roles) values
  ('1a000000-0000-7000-8000-00000000000c', '1a000000-0000-4000-8000-0000000000a1', '{admin}'),
  ('1a000000-0000-7000-8000-00000000000d', '1a000000-0000-4000-8000-0000000000e1', '{admin}');

select lives_ok($$
  delete from public.venues where id = '1a000000-0000-7000-8000-00000000000c'
$$, 'F4 a venue delete cascades through its last admin''s row (venue gone, no guard)');
select is(
  (select count(*)::int from public.venue_memberships where venue_id = '1a000000-0000-7000-8000-00000000000c'),
  0, 'F5 and the membership is gone with it');

select lives_ok($$
  delete from public.user_profiles where id = '1a000000-0000-4000-8000-0000000000e1'
$$, 'F6 an account delete cascades through its last-admin row (account gone, no guard)');
select is(
  (select count(*)::int from public.venue_memberships where user_id = '1a000000-0000-4000-8000-0000000000e1'),
  0, 'F7 and the membership is gone with it');

select * from finish();
rollback;
