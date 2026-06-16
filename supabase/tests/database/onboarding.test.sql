-- pgTAP — Onboarding & self-service venue-creatie (spec #40a/#40c),
-- 20260615000000_onboarding_venue_creation.sql. Proves create_venue_with_owner,
-- set_venue_plan and mark_onboarding_complete: allowed AND denied paths, the
-- audit actor attribution, and idempotency/resumability. Everything rolls back.
--
-- Subject: Yusuf (organizer@plusone.test, 4444…) has an event scope but NO venue
-- membership — the clean "fresh owner" stand-in. Tom (staff, 5555…) is the
-- non-admin. The new venue id is stashed in a custom GUC because the authenticated
-- role cannot write the superuser-owned temp tables.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(
  p_user uuid,
  p_aal text default 'aal1',
  p_email text default null
) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal, 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(15);

-- ---------------------------------------------------------------------------
-- A. create_venue_with_owner — create, effects, audit actor
-- ---------------------------------------------------------------------------

select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select set_config(
  'test.vid',
  public.create_venue_with_owner('Onboarding Test', 'Teststraat 1', 'club', 12, null, false)::text,
  false
);
reset role;

select isnt(nullif(current_setting('test.vid', true), ''), null,
  'T1 create_venue_with_owner returns a venue id');

select is((select settings #>> '{venue_type}' from public.venues
           where id = current_setting('test.vid')::uuid),
          'club', 'T2 venue stores the type in settings (no column)');

select is((select roles @> '{admin}'::public.venue_role[] from public.venue_memberships
           where venue_id = current_setting('test.vid')::uuid
             and user_id = '44444444-4444-4444-8444-444444444444'),
          true, 'T3 the creator is Admin of the new venue (#40a)');

select is((select count(*)::int from public.subscriptions
           where venue_id = current_setting('test.vid')::uuid
             and status = 'trialing' and plan_id is null),
          1, 'T4 venue starts on a trialing subscription, no plan yet (#40c)');

-- The whole point of the RPC: the membership grant is attributed to the real
-- owner, not a NULL "system" actor (impossible via a raw service-role connection).
select is((select count(*)::int from public.audit_log
           where actor_id = '44444444-4444-4444-8444-444444444444'
             and entity_type = 'venue_memberships'
             and venue_id = current_setting('test.vid')::uuid),
          1, 'T5 the ownership grant is audited with the owner as actor');

-- ---------------------------------------------------------------------------
-- A'. idempotency / resume — a retried create returns the same venue
-- ---------------------------------------------------------------------------

select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select is(public.create_venue_with_owner('Dup', 'x', 'bar', 12, null, false),
          current_setting('test.vid')::uuid,
          'T6 a retried create returns the existing in-onboarding venue');
reset role;

select is((select count(*)::int from public.venues v
           join public.venue_memberships m on m.venue_id = v.id
           where m.user_id = '44444444-4444-4444-8444-444444444444'),
          1, 'T7 still exactly one venue for the owner (no duplicate)');

-- ---------------------------------------------------------------------------
-- B. create_venue_with_owner — denied when unauthenticated
-- ---------------------------------------------------------------------------

select pg_temp.login(null, 'aal1', null);
select throws_ok(
  $$ select public.create_venue_with_owner('NoAuth', 'x', 'club', 12, null, false) $$,
  '42501', null, 'T8 an unauthenticated caller cannot create a venue');
reset role;

-- ---------------------------------------------------------------------------
-- C. set_venue_plan — owner (admin, no MFA) yes; non-admin no
-- ---------------------------------------------------------------------------

-- A fresh AAL1 owner can pick a plan (onboarding happens before MFA enrollment).
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select lives_ok(
  $$ select public.set_venue_plan(current_setting('test.vid')::uuid, 'premium', false) $$,
  'T9 the owner sets the plan without MFA');
reset role;

select is((select plan_id from public.subscriptions where venue_id = current_setting('test.vid')::uuid),
          'premium', 'T10 the chosen plan is stored');

-- Tom is not a member of the new venue → not admin → refused.
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2', 'staff@plusone.test');
select throws_ok(
  $$ select public.set_venue_plan(current_setting('test.vid')::uuid, 'pro', false) $$,
  '42501', null, 'T11 a non-admin cannot set the plan');
reset role;

-- ---------------------------------------------------------------------------
-- D. mark_onboarding_complete — admin only, flips the flag
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2', 'staff@plusone.test');
select throws_ok(
  $$ select public.mark_onboarding_complete(current_setting('test.vid')::uuid) $$,
  '42501', null, 'T12 a non-admin cannot complete onboarding');
reset role;

select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select lives_ok(
  $$ select public.mark_onboarding_complete(current_setting('test.vid')::uuid) $$,
  'T13 the owner completes onboarding');
reset role;

select is((select (settings #>> '{onboarding,completed}')::boolean from public.venues
           where id = current_setting('test.vid')::uuid),
          true, 'T14 onboarding.completed is set to true');

-- A completed venue is no longer reused by the resume guard: a further create
-- makes a fresh venue (proves the guard only matches in-onboarding venues).
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select set_config(
  'test.vid2',
  public.create_venue_with_owner('Second Venue', 'x', 'festival', 12, null, false)::text,
  false
);
reset role;
select isnt(current_setting('test.vid2')::uuid, current_setting('test.vid')::uuid,
  'T15 a completed venue is not reused — a second create makes a new venue');

select * from finish();

rollback;
