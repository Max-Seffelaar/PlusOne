-- pgTAP — Snelheid P1 (ClickUp z8uq9m2xyn).
-- Proves 20261007100100_guests_venue_created_idx.sql (the Guests-tab window
-- index exists with the window's column order) and
-- 20261007100200_invites_select_initplan.sql: the rewritten invites_select
-- keeps the exact allowed/denied matrix — venue managers/finance see their
-- venue's invites, an invitee sees invites addressed to their own e-mail
-- (case-insensitive), nobody else sees anything — and now has the canonical
-- `(select auth.jwt())` shape the advisor accepts.
--
-- Seed identities (venue aa..01): Max=admin (also admin @ aa..02),
-- Noor=user_manager, Femke=finance, Tom=staff, Lisa=doorhost+staff,
-- Yusuf=organizer (no membership). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1',
    'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.reset()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

select plan(11);

-- 1-2: the window index, in the window's order (venue_id, created_at desc, id desc).
select has_index('public', 'guests', 'guests_venue_created_idx', array['venue_id', 'created_at', 'id'],
  '1 guests_venue_created_idx exists on (venue_id, created_at, id)');
select ok(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'guests_venue_created_idx')
    like '%(venue_id, created_at DESC, id DESC)%',
  '2 guests_venue_created_idx sorts created_at and id descending');

-- 3: canonical initplan shape (what the auth_rls_initplan advisor checks for).
select ok(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'invites'
     and policyname = 'invites_select') like '%( SELECT auth.jwt() AS jwt)%',
  '3 invites_select reads auth.jwt() through a (select ...) initplan');

-- Fixtures as superuser: one pending invite per venue, addressed to an
-- outsider e-mail (no account needed — the e-mail arm keys on the JWT claim).
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at) values
  ('ab000000-0000-7000-8000-0000000000f1', 'aa000000-0000-7000-8000-000000000001',
   'p1-invitee@plusone.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('ab000000-0000-7000-8000-0000000000f2', 'aa000000-0000-7000-8000-000000000002',
   'p1-other@plusone.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day');

-- 4: user_manager sees their venue's invite.
select pg_temp.login('22222222-2222-4222-8222-222222222222', 'manager@plusone.test');
select is((select count(*)::int from public.invites where id = 'ab000000-0000-7000-8000-0000000000f1'),
          1, '4 user_manager sees an invite of their venue');
-- 5: ...but not another venue's.
select is((select count(*)::int from public.invites where id = 'ab000000-0000-7000-8000-0000000000f2'),
          0, '5 user_manager does not see another venue''s invite');

-- 6: finance sees their venue's invite.
select pg_temp.reset();
select pg_temp.login('33333333-3333-4333-8333-333333333333', 'finance@plusone.test');
select is((select count(*)::int from public.invites where id = 'ab000000-0000-7000-8000-0000000000f1'),
          1, '6 finance sees an invite of their venue');

-- 7: staff (no manager role, not the invitee) sees nothing.
select pg_temp.reset();
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select is((select count(*)::int from public.invites
            where id in ('ab000000-0000-7000-8000-0000000000f1', 'ab000000-0000-7000-8000-0000000000f2')),
          0, '7 staff sees no invites');

-- 8: doorhost sees nothing either.
select pg_temp.reset();
select pg_temp.login('66666666-6666-4666-8666-666666666666', 'door@plusone.test');
select is((select count(*)::int from public.invites
            where id in ('ab000000-0000-7000-8000-0000000000f1', 'ab000000-0000-7000-8000-0000000000f2')),
          0, '8 doorhost sees no invites');

-- 9: the invitee (no membership) sees the invite addressed to them, with the
-- claim in different case — the e-mail arm is case-insensitive.
select pg_temp.reset();
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'P1-Invitee@PlusOne.test');
select is((select count(*)::int from public.invites where id = 'ab000000-0000-7000-8000-0000000000f1'),
          1, '9 invitee sees their own invite (case-insensitive e-mail)');
-- 10: ...and nobody else's.
select is((select count(*)::int from public.invites where id = 'ab000000-0000-7000-8000-0000000000f2'),
          0, '10 invitee does not see an invite addressed to someone else');

-- 11: no e-mail claim at all reads as no match (coalesce to ''), not as all rows.
select pg_temp.reset();
select pg_temp.login('44444444-4444-4444-8444-444444444444', null);
select is((select count(*)::int from public.invites
            where id in ('ab000000-0000-7000-8000-0000000000f1', 'ab000000-0000-7000-8000-0000000000f2')),
          0, '11 a session without an e-mail claim sees no invites');

select * from finish();
rollback;
