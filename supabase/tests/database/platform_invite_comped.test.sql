-- pgTAP — comped platform invite (Onboarding A, z8uq9m2vg5),
-- 20261012140000_platform_invite_comped.sql.
--
-- Threat model: the invitee holds an authenticated session and can call
-- create_venue_with_owner and PostgREST directly. "Always free" must come
-- only from platform_invites.comped, set by a platform admin, used once, for
-- the address the invitee actually signed in with. This file proves:
--   * a platform admin can create a comped invite, but never pre-stamp
--     comped_venue_id, and can't flip comped or comped_venue_id later;
--   * the invitee's first company starts comped (status comped, no trial
--     end), the invite records that company, and audit_log carries the comped
--     decision on the INVITER (actor = invited_by);
--   * a second company by the same invitee is a normal trial (one comp);
--   * no invite, a non-comped invite, a revoked comped invite, or a comped
--     invite whose inviter lost the platform-admin flag: a normal trial and
--     no 'comped' audit row;
--   * the Stripe webhook RPC never overwrites the comped status;
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
  insert into public.platform_invites (id, email, invited_by, comped) values
    ('c2000000-0000-4000-8000-000000000011', 'ADE-Club@klant.test',
     'c1000000-0000-4000-8000-000000000001', true),
    ('c2000000-0000-4000-8000-000000000012', 'plain@klant.test',
     'c1000000-0000-4000-8000-000000000001', false),
    ('c2000000-0000-4000-8000-000000000013', 'revoked@klant.test',
     'c1000000-0000-4000-8000-000000000001', true)
$$, 'A1 a platform admin inserts comped and plain invites');

select is((select comped from public.platform_invites
           where id = 'c2000000-0000-4000-8000-000000000012'),
          false, 'A2 comped defaults to false');

select throws_ok($$
  insert into public.platform_invites (email, invited_by, comped, comped_venue_id) values
    ('sneaky@klant.test', 'c1000000-0000-4000-8000-000000000001', true,
     (select id from public.venues limit 1))
$$, '42501', null, 'A3 comped_venue_id cannot be set on insert (policy)');

select throws_ok($$
  update public.platform_invites set comped = true
   where id = 'c2000000-0000-4000-8000-000000000012'
$$, '42501', null, 'A4 comped is frozen after insert');

select throws_ok($$
  update public.platform_invites set comped_venue_id = (select id from public.venues limit 1)
   where id = 'c2000000-0000-4000-8000-000000000011'
$$, '42501', null, 'A5 a platform admin cannot stamp comped_venue_id directly');

update public.platform_invites
   set revoked_at = now(), revoked_by = 'c1000000-0000-4000-8000-000000000001'
 where id = 'c2000000-0000-4000-8000-000000000013';

-- Second platform admin invites Olga comped, then loses the flag.
select pg_temp.login('c1000000-0000-4000-8000-000000000002');
insert into public.platform_invites (email, invited_by, comped) values
  ('orphan@klant.test', 'c1000000-0000-4000-8000-000000000002', true);
reset role;

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = false
 where id = 'c1000000-0000-4000-8000-000000000002';
select set_config('plusone.platform_admin_write', 'off', true);

-- ---------------------------------------------------------------------------
-- B. The comped invitee creates a company
-- ---------------------------------------------------------------------------

select pg_temp.login('c1000000-0000-4000-8000-000000000011');
select set_config('test.cas1', public.create_venue_with_owner(
  p_name => 'ADE Club', p_address => null, p_venue_type => 'club',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;

select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.cas1')::uuid),
          'comped', 'B1 the comped invitee''s company starts comped');

select is((select trial_ends_at from public.subscriptions
           where venue_id = current_setting('test.cas1')::uuid),
          null, 'B2 a comped company has no trial end (set_venue_comped end state)');

select is((select comped_venue_id from public.platform_invites
           where id = 'c2000000-0000-4000-8000-000000000011'),
          current_setting('test.cas1')::uuid, 'B3 the invite records the company that used it');

select is((select count(*)::int from public.audit_log a
           where a.venue_id = current_setting('test.cas1')::uuid
             and a.action = 'comped'
             and a.entity_type = 'subscriptions'
             and a.actor_id = 'c1000000-0000-4000-8000-000000000001'),
          1, 'B4 audit_log records the comped decision on the inviter');

select is((select diff ->> 'platform_invite_id' from public.audit_log a
           where a.venue_id = current_setting('test.cas1')::uuid and a.action = 'comped'),
          'c2000000-0000-4000-8000-000000000011', 'B5 the audit row names the invite');

select is((select count(*)::int from public.audit_log a
           where a.venue_id = current_setting('test.cas1')::uuid
             and a.entity_type = 'subscriptions' and a.action = 'create'
             and a.actor_id = 'c1000000-0000-4000-8000-000000000011'),
          1, 'B6 the subscription insert itself stays audited on the creator');

-- The invitee can read the comped decision in their own company's audit.
select pg_temp.login('c1000000-0000-4000-8000-000000000011');
select is((select count(*)::int from public.subscriptions
           where venue_id = current_setting('test.cas1')::uuid and status = 'comped'),
          1, 'B7 the new owner sees their own subscription as comped');
reset role;

-- A second company (switcher quick-create) is a normal trial: one invite, one comp.
select pg_temp.login('c1000000-0000-4000-8000-000000000011');
select set_config('test.cas2', public.create_venue_with_owner(
  p_name => 'ADE Club Two', p_address => null, p_venue_type => 'bar',
  p_retention_months => 24, p_complete => true, p_terms_version => '2026-10-06')::text, false);
reset role;

select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.cas2')::uuid),
          'trialing', 'B8 a second company of the same invitee is a normal trial');

select is((select count(*)::int from public.audit_log a
           where a.venue_id = current_setting('test.cas2')::uuid and a.action = 'comped'),
          0, 'B9 and gets no comped audit row');

-- ---------------------------------------------------------------------------
-- C. Everyone else gets the normal trial
-- ---------------------------------------------------------------------------

select pg_temp.login('c1000000-0000-4000-8000-000000000012');
select set_config('test.pia', public.create_venue_with_owner(
  p_name => 'Plain Bar', p_address => null, p_venue_type => 'bar',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.pia')::uuid),
          'trialing', 'C1 a plain (non-comped) invite gives a normal trial');

select pg_temp.login('c1000000-0000-4000-8000-000000000013');
select set_config('test.rik', public.create_venue_with_owner(
  p_name => 'Revoked Venue', p_address => null, p_venue_type => 'club',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.rik')::uuid),
          'trialing', 'C2 a revoked comped invite gives a normal trial');

select pg_temp.login('c1000000-0000-4000-8000-000000000014');
select set_config('test.olga', public.create_venue_with_owner(
  p_name => 'Orphan Org', p_address => null, p_venue_type => 'organizer',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.olga')::uuid),
          'trialing', 'C3 a comped invite whose inviter is no longer a platform admin gives a normal trial');

select is((select comped_venue_id from public.platform_invites
           where lower(email) = 'orphan@klant.test'),
          null, 'C4 and that invite stays unused');

select pg_temp.login('c1000000-0000-4000-8000-000000000015');
select set_config('test.nina', public.create_venue_with_owner(
  p_name => 'Nobody Club', p_address => null, p_venue_type => 'club',
  p_retention_months => 24, p_terms_version => '2026-10-06')::text, false);
reset role;
select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.nina')::uuid),
          'trialing', 'C5 no invite at all gives a normal trial');

select is((select count(*)::int from public.audit_log a
           where a.venue_id in (current_setting('test.pia')::uuid, current_setting('test.rik')::uuid,
                                current_setting('test.olga')::uuid, current_setting('test.nina')::uuid)
             and a.action = 'comped'),
          0, 'C6 none of them has a comped audit row');

-- ---------------------------------------------------------------------------
-- D. Stripe state never overwrites comped; mail_log type
-- ---------------------------------------------------------------------------

select is(public.apply_stripe_subscription_update(
  p_event_id => 'evt_comped_test_1', p_event_type => 'customer.subscription.updated',
  p_venue_id => current_setting('test.cas1')::uuid,
  p_stripe_customer_id => 'cus_comped_test', p_status => 'past_due'),
  true, 'D1 a webhook for the comped company is applied');

select is((select status::text from public.subscriptions
           where venue_id = current_setting('test.cas1')::uuid),
          'comped', 'D2 the webhook left the comped status alone');

select lives_ok($$ select public.log_mail_attempt('platform_invite', null, repeat('c', 64)) $$,
  'D3 mail_log accepts the venue-less platform_invite type');

select throws_ok($$ select public.log_mail_attempt('platform_invite', null, repeat('c', 64)) $$,
  'PM429', null, 'D4 the per-recipient window applies to it');

select throws_ok($$ select public.log_mail_attempt('company_whatever', null, repeat('d', 64)) $$,
  '23514', null, 'D5 an unknown mail type is still refused');

select * from finish();
rollback;
