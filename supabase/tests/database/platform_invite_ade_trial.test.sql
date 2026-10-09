-- pgTAP — "Free until end of ADE" platform invite (Onboarding A, z8uq9m2vg5),
-- 20261013130000_platform_invite_ade_trial.sql.
--
-- Threat model: the invitee holds an authenticated session and can call
-- create_venue_with_owner and PostgREST directly. The longer trial must come
-- only from platform_invites.free_until_ade, set by a platform admin, used
-- once, for the address the invitee actually signed in with. This file proves:
--   * a platform admin can create such an invite, but never pre-stamp
--     ade_trial_venue_id, and can't flip free_until_ade or the stamp later;
--   * the invitee's first company starts as an ordinary trialing Pro whose
--     trial ends at greatest(2026-10-27 00:00 Amsterdam, now() + 14 days),
--     never comped; the invite records that company; audit_log carries the
--     trial end on the INVITER (action 'update', like set_venue_trial_end);
--   * a second company by the same invitee is a normal trial (one invite);
--   * no invite, a plain invite, a revoked invite, or an invite whose
--     inviter lost the platform-admin flag: a normal trial (trial_ends_at
--     null) and no invite audit row;
--   * mail_log accepts the venue-less 'platform_invite' type.
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

select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner)
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
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'pa-one@plusone.test',   'Platform One'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'pa-two@plusone.test',   'Platform Two'),
  ('c1000000-0000-4000-8000-000000000011'::uuid, 'ade-club@klant.test',   'Comped Cas'),
  ('c1000000-0000-4000-8000-000000000012'::uuid, 'plain@klant.test',      'Plain Pia'),
  ('c1000000-0000-4000-8000-000000000013'::uuid, 'revoked@klant.test',    'Revoked Rik'),
  ('c1000000-0000-4000-8000-000000000014'::uuid, 'orphan@klant.test',     'Orphan Olga'),
  ('c1000000-0000-4000-8000-000000000015'::uuid, 'nobody@klant.test',     'Nobody Nina')
) as u (id, email, full_name);

insert into public.user_profiles (id, full_name, email) values
  ('c1000000-0000-4000-8000-000000000001', 'Platform One', 'pa-one@plusone.test'),
  ('c1000000-0000-4000-8000-000000000002', 'Platform Two', 'pa-two@plusone.test');

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id in ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002');
select set_config('plusone.platform_admin_write', 'off', true);

-- ---------------------------------------------------------------------------
-- A. Writing the invite (platform admin, through RLS)
-- ---------------------------------------------------------------------------

select pg_temp.login('c1000000-0000-4000-8000-000000000001');

select lives_ok($$
  insert into public.platform_invites (id, email, invited_by, free_until_ade) values
    ('c2000000-0000-4000-8000-000000000011', 'ADE-Club@klant.test',
     'c1000000-0000-4000-8000-000000000001', true),
    ('c2000000-0000-4000-8000-000000000012', 'plain@klant.test',
     'c1000000-0000-4000-8000-000000000001', false),
    ('c2000000-0000-4000-8000-000000000013', 'revoked@klant.test',
     'c1000000-0000-4000-8000-000000000001', true)
$$, 'A1 a platform admin inserts ADE and plain invites');

select is((select free_until_ade from public.platform_invites
           where id = 'c2000000-0000-4000-8000-000000000012'),
          false, 'A2 free_until_ade defaults to false');

select throws_ok($$
  insert into public.platform_invites (email, invited_by, free_until_ade, ade_trial_venue_id) values
    ('sneaky@klant.test', 'c1000000-0000-4000-8000-000000000001', true,
     (select id from public.venues limit 1))
$$, '42501', null, 'A3 ade_trial_venue_id cannot be set on insert (policy)');

select throws_ok($$
  update public.platform_invites set free_until_ade = true
   where id = 'c2000000-0000-4000-8000-000000000012'
$$, '42501', null, 'A4 free_until_ade is frozen after insert');

select throws_ok($$
  update public.platform_invites set ade_trial_venue_id = (select id from public.venues limit 1)
   where id = 'c2000000-0000-4000-8000-000000000011'
$$, '42501', null, 'A5 a platform admin cannot stamp ade_trial_venue_id directly');

update public.platform_invites
   set revoked_at = now(), revoked_by = 'c1000000-0000-4000-8000-000000000001'
 where id = 'c2000000-0000-4000-8000-000000000013';

-- Second platform admin invites Olga for ADE, then loses the flag.
select pg_temp.login('c1000000-0000-4000-8000-000000000002');
insert into public.platform_invites (email, invited_by, free_until_ade) values
  ('orphan@klant.test', 'c1000000-0000-4000-8000-000000000002', true);
reset role;

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = false
 where id = 'c1000000-0000-4000-8000-000000000002';
select set_config('plusone.platform_admin_write', 'off', true);

-- ---------------------------------------------------------------------------
-- B. The ADE invitee creates a company
-- ---------------------------------------------------------------------------

select pg_temp.login('c1000000-0000-4000-8000-000000000011');
select set_config('test.cas1', public.create_venue_with_owner(
  p_name => 'ADE Club', p_address => null, p_venue_type => 'club',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;

select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.cas1')::uuid),
          'trialing', 'B1 the ADE invitee''s company is an ordinary trial, never comped');

select is((select trial_ends_at from public.subscriptions
           where venue_id = current_setting('test.cas1')::uuid),
          greatest(timestamptz '2026-10-27 00:00:00 Europe/Amsterdam', now() + interval '14 days'),
          'B2 the trial ends at the later of 27 Oct 00:00 Amsterdam and the normal 14 days');

select is((select ade_trial_venue_id from public.platform_invites
           where id = 'c2000000-0000-4000-8000-000000000011'),
          current_setting('test.cas1')::uuid, 'B3 the invite records the company that used it');

select is((select count(*)::int from public.audit_log a
           where a.venue_id = current_setting('test.cas1')::uuid
             and a.action = 'update'
             and a.entity_type = 'subscriptions'
             and a.diff ->> 'source' = 'platform_invite_ade'
             and a.actor_id = 'c1000000-0000-4000-8000-000000000001'),
          1, 'B4 audit_log records the trial end on the inviter');

select is((select diff ->> 'platform_invite_id' from public.audit_log a
           where a.venue_id = current_setting('test.cas1')::uuid
             and a.diff ->> 'source' = 'platform_invite_ade'),
          'c2000000-0000-4000-8000-000000000011', 'B5 the audit row names the invite');

select is((select count(*)::int from public.audit_log a
           where a.venue_id = current_setting('test.cas1')::uuid
             and a.entity_type = 'subscriptions' and a.action = 'create'
             and a.actor_id = 'c1000000-0000-4000-8000-000000000011'),
          1, 'B6 the subscription insert itself stays audited on the creator');

-- The invitee reads the longer trial on their own subscription.
select pg_temp.login('c1000000-0000-4000-8000-000000000011');
select ok((select trial_ends_at > now() + interval '14 days' from public.subscriptions
           where venue_id = current_setting('test.cas1')::uuid),
          'B7 the new owner sees a trial end past the normal 14 days (while before ADE)');
reset role;

-- A second company (switcher quick-create) is a normal trial: one invite, one comp.
select pg_temp.login('c1000000-0000-4000-8000-000000000011');
select set_config('test.cas2', public.create_venue_with_owner(
  p_name => 'ADE Club Two', p_address => null, p_venue_type => 'bar',
  p_retention_months => 24, p_complete => true, p_terms_version => '2026-10-06')::text, false);
reset role;

select is((select trial_ends_at from public.subscriptions
           where venue_id = current_setting('test.cas2')::uuid),
          null, 'B8 a second company of the same invitee is a normal trial');

select is((select count(*)::int from public.audit_log a
           where a.venue_id = current_setting('test.cas2')::uuid
             and a.diff ->> 'source' = 'platform_invite_ade'),
          0, 'B9 and gets no invite audit row');

-- ---------------------------------------------------------------------------
-- C. Everyone else gets the normal trial
-- ---------------------------------------------------------------------------

select pg_temp.login('c1000000-0000-4000-8000-000000000012');
select set_config('test.pia', public.create_venue_with_owner(
  p_name => 'Plain Bar', p_address => null, p_venue_type => 'bar',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select trial_ends_at from public.subscriptions
           where venue_id = current_setting('test.pia')::uuid),
          null, 'C1 a plain invite gives the normal trial (no trial end set)');

select pg_temp.login('c1000000-0000-4000-8000-000000000013');
select set_config('test.rik', public.create_venue_with_owner(
  p_name => 'Revoked Venue', p_address => null, p_venue_type => 'club',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select trial_ends_at from public.subscriptions
           where venue_id = current_setting('test.rik')::uuid),
          null, 'C2 a revoked ADE invite gives the normal trial');

select pg_temp.login('c1000000-0000-4000-8000-000000000014');
select set_config('test.olga', public.create_venue_with_owner(
  p_name => 'Orphan Org', p_address => null, p_venue_type => 'organizer',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select trial_ends_at from public.subscriptions
           where venue_id = current_setting('test.olga')::uuid),
          null, 'C3 an ADE invite whose inviter is no longer a platform admin gives the normal trial');

select is((select ade_trial_venue_id from public.platform_invites
           where lower(email) = 'orphan@klant.test'),
          null, 'C4 and that invite stays unused');

select pg_temp.login('c1000000-0000-4000-8000-000000000015');
select set_config('test.nina', public.create_venue_with_owner(
  p_name => 'Nobody Club', p_address => null, p_venue_type => 'club',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select trial_ends_at from public.subscriptions
           where venue_id = current_setting('test.nina')::uuid),
          null, 'C5 no invite at all gives the normal trial');

select is((select count(*)::int from public.audit_log a
           where a.venue_id in (current_setting('test.pia')::uuid, current_setting('test.rik')::uuid,
                                current_setting('test.olga')::uuid, current_setting('test.nina')::uuid)
             and a.diff ->> 'source' = 'platform_invite_ade'),
          0, 'C6 none of them has an invite audit row');

-- ---------------------------------------------------------------------------
-- D. Never comped through this route; the Platform tab still owns the trial; mail_log type
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.subscriptions
           where status = 'comped'
             and venue_id in (current_setting('test.cas1')::uuid, current_setting('test.cas2')::uuid,
                              current_setting('test.pia')::uuid, current_setting('test.rik')::uuid,
                              current_setting('test.olga')::uuid, current_setting('test.nina')::uuid)),
          0, 'D1 no company created here is comped ("Always free" stays the Platform tab''s)');

select pg_temp.login('c1000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.set_venue_trial_end(current_setting('test.cas1')::uuid, now() + interval '60 days') $$,
  'D2 a platform admin can still move the ADE company''s trial end afterwards');
reset role;

select lives_ok($$ select public.log_mail_attempt('platform_invite', null, repeat('c', 64)) $$,
  'D3 mail_log accepts the venue-less platform_invite type');

select throws_ok($$ select public.log_mail_attempt('platform_invite', null, repeat('c', 64)) $$,
  'PM429', null, 'D4 the per-recipient window applies to it');

select throws_ok($$ select public.log_mail_attempt('company_whatever', null, repeat('d', 64)) $$,
  '23514', null, 'D5 an unknown mail type is still refused');

select * from finish();
rollback;
