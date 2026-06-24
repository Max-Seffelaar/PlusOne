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

select plan(23);

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

-- ---------------------------------------------------------------------------
-- E. switcher quick-create — company/billing fields persist + p_complete
-- ---------------------------------------------------------------------------
-- The in-app "New venue" switcher (ClickUp 86ey1khun) creates a READY-TO-USE
-- venue: company/billing fields persist in the same transaction, onboarding is
-- stamped complete, and the resume guard is skipped so an established owner who
-- still has an in-onboarding venue (test.vid2 from T15) gets a NEW venue.

select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select set_config(
  'test.vid3',
  public.create_venue_with_owner(
    p_name => 'Switcher Co',
    p_address => '',
    p_venue_type => 'bar',
    p_retention_months => 12,
    p_city => 'Amsterdam',
    p_kvk_number => '87654321',
    p_vat_number => 'NL999999999B01',
    p_finance_email => 'Bill@Switcher.NL',
    p_complete => true,
    p_terms_version => '2026-06-24-test'
  )::text,
  false
);
reset role;

-- p_complete bypasses the resume guard: the owner still has test.vid2 in
-- onboarding, yet this is a brand-new venue, not test.vid2.
select isnt(current_setting('test.vid3')::uuid, current_setting('test.vid2')::uuid,
  'T16 p_complete skips the resume guard — a new venue, not the in-onboarding one');

select is((select city from public.venues where id = current_setting('test.vid3')::uuid),
          'Amsterdam', 'T17 the switcher city is persisted on the venue');

select is((select kvk_number || '|' || vat_number || '|' || finance_email
           from public.venues where id = current_setting('test.vid3')::uuid),
          '87654321|NL999999999B01|bill@switcher.nl',
          'T18 KvK + VAT persist and the finance e-mail is lowercased');

select is((select (settings #>> '{onboarding,completed}')::boolean from public.venues
           where id = current_setting('test.vid3')::uuid),
          true, 'T19 p_complete stamps onboarding.completed=true (no wizard bounce)');

select is((select roles @> '{admin}'::public.venue_role[] from public.venue_memberships
           where venue_id = current_setting('test.vid3')::uuid
             and user_id = '44444444-4444-4444-8444-444444444444'),
          true, 'T20 the creator is Admin of the switcher-created venue (#40a)');

-- ---------------------------------------------------------------------------
-- F. company consent recorded at venue creation (#40, ClickUp 86ey1khun)
-- ---------------------------------------------------------------------------

select is((select terms_version from public.venues where id = current_setting('test.vid3')::uuid),
          '2026-06-24-test', 'T21 the accepted terms version is recorded on the venue');

select is(
  (select terms_accepted_by = '44444444-4444-4444-8444-444444444444'
            and terms_accepted_at is not null
     from public.venues where id = current_setting('test.vid3')::uuid),
  true, 'T22 company consent records the accepting actor + a timestamp');

-- A create WITHOUT a terms version (e.g. the seed/legacy path) leaves the consent
-- columns null — no false consent is ever recorded.
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1', 'organizer@plusone.test');
select set_config('test.vid4',
  public.create_venue_with_owner('No Consent', 'x', 'club', 12, null, false,
    null, null, null, null, true)::text, false);
reset role;

select is((select terms_version from public.venues where id = current_setting('test.vid4')::uuid),
          null, 'T23 a create without a terms version records no consent (no false consent)');

select * from finish();

rollback;
