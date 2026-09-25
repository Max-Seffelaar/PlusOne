-- pgTAP — the store-review demo venue never invites (Fase 17 S3, 86ey6bfug),
-- 20260925130100_review_demo_no_invites.sql.
--
-- Threat model: anyone holding the per-submission review code is signed in as
-- the demo account (fixed id de300000-…a001, {admin,doorhost} on the demo venue
-- de300000-…0001) and holds the anon key + its JWT. Inviting their own mailbox
-- into the demo venue would mint a real account that can create a venue of its
-- own (the create_venue_with_owner guard keys on the demo id only). Proves:
--   * an invite into the demo venue is refused (42501) for the demo admin, the
--     service role and the table owner alike, and no row is written;
--   * accept_pending_invites therefore has nothing to accept: the would-be
--     invitee gets no demo-venue membership and the demo user stays the only member;
--   * an invite into a normal venue still works;
--   * the trigger shape: BEFORE INSERT, security invoker, pinned search_path,
--     no execute for app roles.
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(12);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — RLS bypassed, like the demo seed): the demo user, the
-- demo venue and the demo membership, on the fixed ids the app keys on.
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

insert into public.venue_memberships (venue_id, user_id, roles)
values ('de300000-0000-7000-8000-000000000001', 'de300000-0000-7000-8000-00000000a001',
        '{admin,doorhost}');

-- ---------------------------------------------------------------------------
-- A. no invite into the demo venue, whoever writes it
-- ---------------------------------------------------------------------------

-- The hop itself: the demo admin invites a real mailbox (Yusuf's) as admin.
select pg_temp.login('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('de300000-0000-7000-8000-000000000001', 'organizer@plusone.test', '{admin}',
          'de300000-0000-7000-8000-00000000a001', now() + interval '7 days')
$$, '42501', 'the demo venue cannot invite',
  'T1 the demo admin cannot invite into the demo venue');

select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('de300000-0000-7000-8000-000000000001', 'someone@plusone.test', '{doorhost}',
          'de300000-0000-7000-8000-00000000a001', now() + interval '7 days')
$$, '42501', 'the demo venue cannot invite',
  'T2 not with a lesser role either');
reset role;

select set_config('role', 'service_role', true);
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('de300000-0000-7000-8000-000000000001', 'organizer@plusone.test', '{staff}',
          'de300000-0000-7000-8000-00000000a001', now() + interval '7 days')
$$, '42501', 'the demo venue cannot invite',
  'T3 the service role cannot invite into the demo venue');
reset role;

select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('de300000-0000-7000-8000-000000000001', 'organizer@plusone.test', '{staff}',
          'de300000-0000-7000-8000-00000000a001', now() + interval '7 days')
$$, '42501', 'the demo venue cannot invite',
  'T4 nor can the table owner');

select is(
  (select count(*)::int from public.invites
    where venue_id = 'de300000-0000-7000-8000-000000000001'),
  0, 'T5 no invite row exists for the demo venue');

-- ---------------------------------------------------------------------------
-- B. so accept_pending_invites has nothing to add to the demo venue
-- ---------------------------------------------------------------------------

-- Yusuf (organizer@plusone.test): the address the demo admin tried to invite.
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'organizer@plusone.test');
select lives_ok($$ select public.accept_pending_invites() $$,
  'T6 the would-be invitee logs in and accepts pending invites');
reset role;

select is(
  (select count(*)::int from public.venue_memberships
    where venue_id = 'de300000-0000-7000-8000-000000000001'
      and user_id = '44444444-4444-4444-8444-444444444444'),
  0, 'T7 the would-be invitee got no demo-venue membership');

select is(
  (select array_agg(user_id) from public.venue_memberships
    where venue_id = 'de300000-0000-7000-8000-000000000001'),
  array['de300000-0000-7000-8000-00000000a001'::uuid],
  'T8 the demo user is still the only member of the demo venue');

-- ---------------------------------------------------------------------------
-- C. a normal venue still invites
-- ---------------------------------------------------------------------------

-- Max = admin of venue 1 (Club Vesper) in the seed.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'demo-guard-control@plusone.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, 'T9 an admin of a normal venue can still invite');
reset role;

-- ---------------------------------------------------------------------------
-- D. shape: BEFORE INSERT trigger, security invoker, pinned search_path, no
--    execute for app roles
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'invites'
      and t.tgname = 'refuse_demo_venue_invite'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      -- tgtype bits: 1 = ROW, 2 = BEFORE, 4 = INSERT; nothing else set.
      and t.tgtype = (1 | 2 | 4)
  ),
  'T10 refuse_demo_venue_invite is an enabled BEFORE INSERT row trigger on invites');

select is(
  (select not p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'refuse_demo_venue_invite'),
  true, 'T11 the trigger function is security invoker with search_path pinned to empty');

select ok(
  not has_function_privilege('authenticated', 'public.refuse_demo_venue_invite()', 'execute')
  and not has_function_privilege('anon', 'public.refuse_demo_venue_invite()', 'execute'),
  'T12 no execute on the trigger function for authenticated or anon');

select * from finish();

rollback;
