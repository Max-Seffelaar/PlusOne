-- pgTAP — the store-review demo venue never gains a member (Fase 17 S3,
-- 86ey6bfug round 8), 20260925150000_demo_venue_no_new_members.sql.
--
-- Threat model: anyone holding the per-submission review code is signed in as
-- the demo account (fixed id de300000-…a001, {admin,doorhost} on the demo venue
-- de300000-…0001) and holds the anon key + its JWT. venue_memberships_insert
-- lets a venue admin add an EXISTING user straight from the REST API. Adding
-- anyone to the demo venue breaks its isolation (the review login then refuses
-- with venue_not_isolated) and shows the demo data to that user. Proves:
--   * a new member for the demo venue is refused (42501) for the demo admin,
--     the service role and the table owner alike, and no row is written;
--   * the seed's own path still works: the service role upserts the demo
--     user's membership (insert and on-conflict update);
--   * a normal venue can still add an existing user directly;
--   * the trigger shape: BEFORE INSERT, security invoker, pinned search_path,
--     no execute for app roles.
-- Round 9 (same migration):
--   * an invite ADDRESSED to the demo e-mail is refused from any venue, for
--     any writer, case- and whitespace-insensitively; ordinary invites work;
--   * the demo user cannot demote, move or delete its own demo membership
--     (self-lockout), not even as admin there; a job_title edit still works;
--   * the seed's path (service_role JWT) still can change and delete it;
--   * other venues' memberships are unaffected.
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal2', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- The seed's writer: the service key's JWT role, as PostgREST sets it.
create function pg_temp.as_service()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

select plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — RLS bypassed, like the demo seed): the demo user and
-- the demo venue on the fixed ids the app keys on. The membership itself is
-- written in section B, through the seed's own path.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', 'de300000-0000-7000-8000-00000000a001',
  'authenticated', 'authenticated', 'app-review@demo.plus-one.io', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "App Review"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);

insert into public.user_profiles (id, full_name, email)
values ('de300000-0000-7000-8000-00000000a001', 'App Review', 'app-review@demo.plus-one.io');

insert into public.venues (id, name, slug)
values ('de300000-0000-7000-8000-000000000001', 'PlusOne Demo', 'plusone-demo-test');

-- ---------------------------------------------------------------------------
-- A/B. the seed's path: the service role upserts the demo user's own row
-- ---------------------------------------------------------------------------

select set_config('role', 'service_role', true);
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles, job_title)
  values ('de300000-0000-7000-8000-000000000001', 'de300000-0000-7000-8000-00000000a001',
          '{admin,doorhost}', 'App review')
  on conflict (venue_id, user_id) do update set roles = excluded.roles, job_title = excluded.job_title
$$, 'T1 the seed can insert the demo user''s own membership');

select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles, job_title)
  values ('de300000-0000-7000-8000-000000000001', 'de300000-0000-7000-8000-00000000a001',
          '{admin,doorhost}', 'App review')
  on conflict (venue_id, user_id) do update set roles = excluded.roles, job_title = excluded.job_title
$$, 'T2 and re-run it (on-conflict update) idempotently');
reset role;

-- ---------------------------------------------------------------------------
-- C. nobody else joins the demo venue, whoever writes it
-- ---------------------------------------------------------------------------

-- The hop itself: the demo admin adds an existing user (Yusuf) directly.
select pg_temp.login('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('de300000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444', '{admin}')
$$, '42501', 'the demo venue cannot gain members',
  'T3 the demo admin cannot add an existing user to the demo venue');

select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('de300000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444', '{doorhost}')
$$, '42501', 'the demo venue cannot gain members',
  'T4 not with a lesser role either');
reset role;

select set_config('role', 'service_role', true);
select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('de300000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444', '{staff}')
$$, '42501', 'the demo venue cannot gain members',
  'T5 the service role cannot add another member to the demo venue');
reset role;

select throws_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('de300000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444', '{staff}')
$$, '42501', 'the demo venue cannot gain members',
  'T6 nor can the table owner');

-- The UPDATE hop: the demo admin rewrites its own row onto another user. Since
-- round 9 refuse_demo_member_self_change (fires first: triggers run in name
-- order) refuses any change to that row from the API; T7b proves the
-- new-member trigger still refuses the same move on its own, for a writer the
-- self-change trigger lets through (the owner, no JWT).
select pg_temp.login('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
select throws_ok($$
  update public.venue_memberships set user_id = '44444444-4444-4444-8444-444444444444'
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, '42501', 'the demo membership can only be changed by the demo seed',
  'T7 the demo admin cannot hand its own membership row to another user');
reset role;

select set_config('request.jwt.claims', '', true);
select throws_ok($$
  update public.venue_memberships set user_id = '44444444-4444-4444-8444-444444444444'
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, '42501', 'the demo venue cannot gain members',
  'T7b nor can the table owner (the new-member trigger on its own)');

-- Moving a normal venue's row onto the demo venue is refused too (owner = the
-- strongest writer; RLS would already stop a demo admin who is not admin there).
select throws_ok($$
  update public.venue_memberships set venue_id = 'de300000-0000-7000-8000-000000000001'
   where venue_id = 'aa000000-0000-7000-8000-000000000001'
     and user_id = '55555555-5555-4555-8555-555555555555'
$$, '42501', 'the demo venue cannot gain members',
  'T8 a row cannot be moved onto the demo venue');

select is(
  (select array_agg(user_id) from public.venue_memberships
    where venue_id = 'de300000-0000-7000-8000-000000000001'),
  array['de300000-0000-7000-8000-00000000a001'::uuid],
  'T9 the demo user is still the only member of the demo venue');

select is(
  (select roles from public.venue_memberships
    where venue_id = 'de300000-0000-7000-8000-000000000001'
      and user_id = 'de300000-0000-7000-8000-00000000a001'),
  '{admin,doorhost}'::public.venue_role[],
  'T10 with the seed''s role set');

-- ---------------------------------------------------------------------------
-- D. a normal venue still adds an existing user directly
-- ---------------------------------------------------------------------------

-- Max = admin of venue 1 (Club Vesper) in the seed; Yusuf holds no membership there.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444', '{staff}')
$$, 'T11 an admin of a normal venue can still add an existing user');
reset role;

-- ---------------------------------------------------------------------------
-- D2. no crew on a demo-venue event either (event_organizers hop)
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, ends_at, status)
values ('de300000-0000-7000-8000-0000000000f1', 'de300000-0000-7000-8000-000000000001',
        'Demo Guard Night', now() + interval '2 days', now() + interval '2 days' + interval '6 hours', 'open');

select pg_temp.login('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('de300000-0000-7000-8000-0000000000f1', '44444444-4444-4444-8444-444444444444')
$$, '42501', 'the demo venue cannot gain crew',
  'T12 the demo admin cannot put an existing user on a demo event''s crew');
reset role;

select set_config('role', 'service_role', true);
select throws_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('de300000-0000-7000-8000-0000000000f1', '44444444-4444-4444-8444-444444444444')
$$, '42501', 'the demo venue cannot gain crew',
  'T13 nor can the service role');
reset role;

select is(
  (select count(*)::int from public.event_organizers
    where event_id = 'de300000-0000-7000-8000-0000000000f1'),
  0, 'T14 no crew row exists on the demo event');

-- ---------------------------------------------------------------------------
-- F. round 9 (a): no invite addressed to the demo e-mail, from any venue
-- ---------------------------------------------------------------------------

-- Max = admin of venue 1 (Club Vesper): another venue's admin, not the demo one.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'app-review@demo.plus-one.io', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, '42501', 'the demo account cannot be invited',
  'T19 another venue''s admin cannot invite the demo e-mail');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'App-Review@Demo.PLUS-ONE.io', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, '42501', 'the demo account cannot be invited',
  'T20 not in another case either');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', '  app-review@demo.plus-one.io ', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, '42501', 'the demo account cannot be invited',
  'T21 nor padded with whitespace');
reset role;

select pg_temp.as_service();
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'app-review@demo.plus-one.io', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, '42501', 'the demo account cannot be invited',
  'T22 nor can the service role');
reset role;

select is(
  (select count(*)::int from public.invites
    where lower(btrim(email)) = 'app-review@demo.plus-one.io'),
  0, 'T23 no invite to the demo e-mail exists');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'demo-guard-round9@plusone.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, 'T24 an ordinary invite from a normal venue still works');
reset role;

-- The replaced body keeps the venue predicate (and its own message).
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('de300000-0000-7000-8000-000000000001', 'someone@plusone.test', '{staff}',
          'de300000-0000-7000-8000-00000000a001', now() + interval '7 days')
$$, '42501', 'the demo venue cannot invite',
  'T25 an invite into the demo venue is still refused');

-- ---------------------------------------------------------------------------
-- G. round 9 (b): no self-lockout of the demo membership
-- ---------------------------------------------------------------------------

select pg_temp.login('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
select throws_ok($$
  update public.venue_memberships set roles = '{doorhost}'
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, '42501', 'the demo membership can only be changed by the demo seed',
  'T26 the demo admin cannot demote itself (roles-only update)');

select throws_ok($$
  update public.venue_memberships set roles = '{admin,doorhost,staff}'
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, '42501', 'the demo membership can only be changed by the demo seed',
  'T27 nor change its role set any other way');

select throws_ok($$
  delete from public.venue_memberships
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, '42501', 'the demo membership can only be changed by the demo seed',
  'T28 the demo admin cannot delete its own membership');

select lives_ok($$
  update public.venue_memberships set job_title = 'App review (edited)'
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, 'T29 a job_title-only edit of its own row still works');
reset role;

select is(
  (select roles from public.venue_memberships
    where venue_id = 'de300000-0000-7000-8000-000000000001'
      and user_id = 'de300000-0000-7000-8000-00000000a001'),
  '{admin,doorhost}'::public.venue_role[],
  'T30 the demo membership still exists with the seed''s role set');

-- The seed's path: a service_role JWT may change and delete the row.
select pg_temp.as_service();
select lives_ok($$
  update public.venue_memberships set roles = '{doorhost}'
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, 'T31 the service role can change the demo role set');

select lives_ok($$
  delete from public.venue_memberships
   where venue_id = 'de300000-0000-7000-8000-000000000001'
     and user_id = 'de300000-0000-7000-8000-00000000a001'
$$, 'T32 and delete the demo membership');

select is(
  (select count(*)::int from public.venue_memberships
    where venue_id = 'de300000-0000-7000-8000-000000000001'),
  0, 'T33 the delete really happened');

select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles, job_title)
  values ('de300000-0000-7000-8000-000000000001', 'de300000-0000-7000-8000-00000000a001',
          '{admin,doorhost}', 'App review')
  on conflict (venue_id, user_id) do update set roles = excluded.roles, job_title = excluded.job_title
$$, 'T34 and the seed''s upsert restores it');
reset role;

-- Other venues: Max (admin of venue 1) edits and removes Yusuf's venue-1 row (T11).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select lives_ok($$
  update public.venue_memberships set roles = '{doorhost}'
   where venue_id = 'aa000000-0000-7000-8000-000000000001'
     and user_id = '44444444-4444-4444-8444-444444444444'
$$, 'T35 an admin of a normal venue can still change a member''s roles');
reset role;

select is(
  (select roles from public.venue_memberships
    where venue_id = 'aa000000-0000-7000-8000-000000000001'
      and user_id = '44444444-4444-4444-8444-444444444444'),
  '{doorhost}'::public.venue_role[],
  'T36 and the change landed');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select lives_ok($$
  delete from public.venue_memberships
   where venue_id = 'aa000000-0000-7000-8000-000000000001'
     and user_id = '44444444-4444-4444-8444-444444444444'
$$, 'T37 and remove that member');
reset role;

select is(
  (select count(*)::int from public.venue_memberships
    where venue_id = 'aa000000-0000-7000-8000-000000000001'
      and user_id = '44444444-4444-4444-8444-444444444444'),
  0, 'T38 and the removal landed');

-- ---------------------------------------------------------------------------
-- E. shape: BEFORE INSERT trigger, security invoker, pinned search_path, no
--    execute for app roles
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'venue_memberships'
      and t.tgname = 'refuse_demo_venue_new_member'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      -- tgtype bits: 1 = ROW, 2 = BEFORE, 4 = INSERT, 16 = UPDATE; nothing else set.
      and t.tgtype = (1 | 2 | 4 | 16)
  ),
  'T15 refuse_demo_venue_new_member is an enabled BEFORE INSERT OR UPDATE row trigger on venue_memberships');

select is(
  (select not p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'refuse_demo_venue_new_member'),
  true, 'T16 the trigger function is security invoker with search_path pinned to empty');

select ok(
  not has_function_privilege('authenticated', 'public.refuse_demo_venue_new_member()', 'execute')
  and not has_function_privilege('anon', 'public.refuse_demo_venue_new_member()', 'execute')
  and not has_function_privilege('authenticated', 'public.refuse_demo_venue_new_crew()', 'execute')
  and not has_function_privilege('anon', 'public.refuse_demo_venue_new_crew()', 'execute'),
  'T17 no execute on either trigger function for authenticated or anon');

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'event_organizers'
      and t.tgname = 'refuse_demo_venue_new_crew'
      and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgtype = (1 | 2 | 4)
      and not p.prosecdef and p.proconfig = array['search_path=""']
  ),
  'T18 refuse_demo_venue_new_crew: enabled BEFORE INSERT row trigger, security invoker, pinned search_path');

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'venue_memberships'
      and t.tgname = 'refuse_demo_member_self_change'
      and not t.tgisinternal and t.tgenabled = 'O'
      -- tgtype bits: 1 = ROW, 2 = BEFORE, 8 = DELETE, 16 = UPDATE; no INSERT.
      and t.tgtype = (1 | 2 | 8 | 16)
      and not p.prosecdef and p.proconfig = array['search_path=""']
  ),
  'T39 refuse_demo_member_self_change: enabled BEFORE UPDATE OR DELETE row trigger, security invoker, pinned search_path');

select ok(
  not has_function_privilege('authenticated', 'public.refuse_demo_member_self_change()', 'execute')
  and not has_function_privilege('anon', 'public.refuse_demo_member_self_change()', 'execute')
  and not has_function_privilege('authenticated', 'public.refuse_demo_venue_invite()', 'execute')
  and not has_function_privilege('anon', 'public.refuse_demo_venue_invite()', 'execute'),
  'T40 no execute on the round-9 trigger functions for authenticated or anon');

select * from finish();

rollback;
