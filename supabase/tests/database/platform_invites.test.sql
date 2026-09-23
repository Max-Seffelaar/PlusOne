-- pgTAP — platform_invites, the open-beta outreach log (P-03, z8uq9m0tnv).
--
-- Threat model (CLAUDE.md #1): the anon/auth key ships to the browser, so every
-- claim has to hold against raw PostgREST calls. This file proves:
--
--   * a platform admin can SELECT / INSERT / UPDATE (resend + revoke);
--   * no app role holds DELETE — revoking is a soft stamp;
--   * every other venue role (admin, user_manager, finance, staff, doorhost,
--     organizer) sees nothing and writes nothing;
--   * anon reaches neither the table nor any of the three new functions;
--   * the identity columns are immutable and a revoke is one-way;
--   * platform_invite_overview()/_funnel() answer only for a platform admin,
--     and the funnel stage actually follows invited → signed_in →
--     company_created → first_event;
--   * the audit trigger records insert + update with the platform admin as
--     actor and venue_id null.
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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(51);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — RLS bypassed, like the seed)
-- ---------------------------------------------------------------------------
-- Joeri is the platform admin and a member of no venue at all. The three
-- invitees exist as auth users at different funnel depths.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', u.confirmed,
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('99999999-9999-4999-8999-999999999999'::uuid, 'platform@plusone.test', 'Joeri Platform', now()),
  -- A SECOND platform admin: attribution must be safe from colleagues too.
  ('98888888-8888-4888-8888-888888888888'::uuid, 'platform2@plusone.test', 'Second Platform', now()),
  -- Confirmed, no membership → signed_in
  ('aa999999-9999-4999-8999-999999999991'::uuid, 'beta-signed@klant.test', 'Signed Sam', now()),
  -- Confirmed + membership in a venue with an event → first_event
  ('aa999999-9999-4999-8999-999999999992'::uuid, 'beta-live@klant.test', 'Live Lena', now()),
  -- Never confirmed → invited
  ('aa999999-9999-4999-8999-999999999993'::uuid, 'beta-cold@klant.test', 'Cold Carl', null)
) as u (id, email, full_name, confirmed);

insert into public.user_profiles (id, full_name, email) values
  ('99999999-9999-4999-8999-999999999999', 'Joeri Platform', 'platform@plusone.test'),
  ('98888888-8888-4888-8888-888888888888', 'Second Platform', 'platform2@plusone.test'),
  ('aa999999-9999-4999-8999-999999999991', 'Signed Sam',     'beta-signed@klant.test'),
  ('aa999999-9999-4999-8999-999999999992', 'Live Lena',      'beta-live@klant.test'),
  ('aa999999-9999-4999-8999-999999999993', 'Cold Carl',      'beta-cold@klant.test');

-- Bootstrap path from 20260923120000: the flag only moves with the GUC on.
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id in ('99999999-9999-4999-8999-999999999999',
              '98888888-8888-4888-8888-888888888888');
select set_config('plusone.platform_admin_write', 'off', true);

-- Lena's own company + first event (what the wizard would have produced).
insert into public.venues (id, name, slug) values
  ('ab000000-0000-7000-8000-0000000000b1', 'Lena''s Loods', 'lenas-loods');
insert into public.venue_memberships (venue_id, user_id, roles) values
  ('ab000000-0000-7000-8000-0000000000b1',
   'aa999999-9999-4999-8999-999999999992', '{admin}'::public.venue_role[]);
insert into public.events (id, venue_id, name, starts_at, landing_slug, status) values
  ('eb000000-0000-7000-8000-0000000000b1',
   'ab000000-0000-7000-8000-0000000000b1',
   'Lena Opening', '2026-11-01 22:00:00+01', 'lena-opening', 'open');

-- Sam self-onboarded no further than the login.
-- Carl never even confirmed.

-- GoTrue's e-mail uniqueness is PARTIAL (unique where is_sso_user = false), so
-- a second row may legitimately carry Sam's address. And a soft-deleted account
-- must not make Carl look like he signed in — it is deliberately OLDER than his
-- own row, so a join that ignored deleted_at would pick it first. Both extras
-- are is_sso_user rows, because that is exactly the gap users_email_partial_key
-- leaves open.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  is_sso_user, deleted_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change,
  phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), u.sso, u.deleted,
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
  u.created, now(), '', '', '', '', '', '', '', ''
from (values
  ('aa999999-9999-4999-8999-999999999994'::uuid, 'beta-signed@klant.test',
   true, null::timestamptz, now()),
  ('aa999999-9999-4999-8999-999999999995'::uuid, 'beta-cold@klant.test',
   true, now(), now() - interval '1 day')
) as u (id, email, sso, deleted, created);

-- ---------------------------------------------------------------------------
-- A. Grants — the layer under RLS
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('anon', 'public.platform_invites', 'SELECT')
      and not has_table_privilege('anon', 'public.platform_invites', 'INSERT')
      and not has_table_privilege('anon', 'public.platform_invites', 'UPDATE'),
  'A1 anon holds no privilege on platform_invites');

select ok(has_table_privilege('authenticated', 'public.platform_invites', 'SELECT')
      and has_table_privilege('authenticated', 'public.platform_invites', 'INSERT')
      and has_table_privilege('authenticated', 'public.platform_invites', 'UPDATE'),
  'A2 authenticated keeps select/insert/update');

select ok(not has_table_privilege('authenticated', 'public.platform_invites', 'DELETE')
      and not has_table_privilege('authenticated', 'public.platform_invites', 'TRUNCATE'),
  'A3 no DELETE and no TRUNCATE for authenticated (soft revoke only)');

select ok(not has_function_privilege('anon',
            'public.platform_invite_overview(integer, integer)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.platform_invite_funnel()', 'EXECUTE')
      and not has_function_privilege('anon',
            'public.consume_platform_invite_throttle()', 'EXECUTE'),
  'A4 anon cannot execute any of the new functions');

-- service_role bypasses RLS, so if it could run these it would read every
-- invite and every matched auth.users row with no is_platform_admin() in sight.
select ok(not has_function_privilege('service_role',
            'public.platform_invite_overview(integer, integer)', 'EXECUTE')
      and not has_function_privilege('service_role',
            'public.platform_invite_funnel()', 'EXECUTE')
      and not has_function_privilege('service_role',
            'public.consume_platform_invite_throttle()', 'EXECUTE'),
  'A5 service_role cannot execute them either');

-- The shared stage helper is internal: no app role at all, service_role included.
select ok(not has_function_privilege('anon',
            'public.platform_invite_stage_rows()', 'EXECUTE')
      and not has_function_privilege('authenticated',
            'public.platform_invite_stage_rows()', 'EXECUTE')
      and not has_function_privilege('service_role',
            'public.platform_invite_stage_rows()', 'EXECUTE'),
  'A6 the internal stage helper is reachable by no app role');

-- ---------------------------------------------------------------------------
-- B. The platform admin: full CRUD-minus-DELETE
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');

select lives_ok($$
  insert into public.platform_invites (id, email, note, invited_by) values
    ('fb000000-0000-7000-8000-0000000000b1', 'beta-signed@klant.test', 'Via ADE',
     '99999999-9999-4999-8999-999999999999'),
    ('fb000000-0000-7000-8000-0000000000b2', 'beta-live@klant.test', null,
     '99999999-9999-4999-8999-999999999999'),
    ('fb000000-0000-7000-8000-0000000000b3', 'beta-cold@klant.test', null,
     '99999999-9999-4999-8999-999999999999')
$$, 'B1 platform admin inserts open-beta invites');

select is((select count(*)::int from public.platform_invites), 3,
  'B2 platform admin reads them all back');

-- A DISTINCT timestamp on purpose: inside one transaction now() is frozen, so
-- `set last_sent_at = now()` writes the value the insert default already put
-- there, audit_changed() sees no diff and the audit trigger returns without a
-- row — the rowcount would still be 1 and the resend audit would be untested.
select is(
  pg_temp.rowcount($$update public.platform_invites
                        set last_sent_at = now() + interval '1 minute'
                      where id = 'fb000000-0000-7000-8000-0000000000b1'$$),
  1, 'B3 resend = bump last_sent_at');

select is((select count(*)::int from public.audit_log
            where entity_type = 'platform_invites'
              and entity_id = 'fb000000-0000-7000-8000-0000000000b1'
              and action = 'update'
              and actor_id = '99999999-9999-4999-8999-999999999999'), 1,
  'B3b the resend itself is audited, with the platform admin as actor');

select throws_ok($$
  insert into public.platform_invites (email, invited_by)
  values ('BETA-signed@klant.test', '99999999-9999-4999-8999-999999999999')
$$, '23505', null, 'B4 a second OPEN invite for the same address is refused (case-insensitive)');

select throws_ok($$
  insert into public.platform_invites (email, invited_by)
  values ('someone@klant.test', 'aa999999-9999-4999-8999-999999999991')
$$, '42501', null, 'B5 invited_by is pinned to the acting session');

select throws_ok($$
  update public.platform_invites set email = 'hijack@klant.test'
   where id = 'fb000000-0000-7000-8000-0000000000b1'
$$, '42501', null, 'B6 email is immutable');

select throws_ok($$
  update public.platform_invites set invited_by = 'aa999999-9999-4999-8999-999999999991'
   where id = 'fb000000-0000-7000-8000-0000000000b1'
$$, '42501', null, 'B7 invited_by is immutable');

select is(
  pg_temp.rowcount($$update public.platform_invites
                        set revoked_at = now(),
                            revoked_by = '99999999-9999-4999-8999-999999999999'
                      where id = 'fb000000-0000-7000-8000-0000000000b3'$$),
  1, 'B8 revoke is a soft stamp on the row');

select throws_ok($$
  update public.platform_invites set revoked_at = null, revoked_by = null
   where id = 'fb000000-0000-7000-8000-0000000000b3'
$$, '42501', null, 'B9 a revoke is one-way');

select lives_ok($$
  insert into public.platform_invites (email, invited_by)
  values ('beta-cold@klant.test', '99999999-9999-4999-8999-999999999999')
$$, 'B10 a revoked address can be re-invited');

select throws_ok($$
  delete from public.platform_invites where id = 'fb000000-0000-7000-8000-0000000000b2'
$$, '42501', null, 'B11 even the platform admin cannot DELETE a row');

-- The insert policy forces a new invite to be born OPEN. A pre-stamped revoke
-- would otherwise let someone file an invite that is already "handled" —
-- history without the audited UPDATE that should have produced it.
select throws_ok($$
  insert into public.platform_invites (email, invited_by, revoked_at, revoked_by)
  values ('prestamped@klant.test', '99999999-9999-4999-8999-999999999999',
          now(), '99999999-9999-4999-8999-999999999999')
$$, '42501', null, 'B12 an invite cannot be inserted already revoked');

select throws_ok($$
  update public.platform_invites set note = 'rewritten after the fact'
   where id = 'fb000000-0000-7000-8000-0000000000b3'
$$, '42501', null, 'B13 the note of a revoked invite is frozen too');

reset role;

-- A colleague platform admin must not be able to claim someone else's revoke.
select pg_temp.login('98888888-8888-4888-8888-888888888888');
select throws_ok($$
  update public.platform_invites
     set revoked_by = '98888888-8888-4888-8888-888888888888'
   where id = 'fb000000-0000-7000-8000-0000000000b3'
$$, '42501', null, 'B14 a second platform admin cannot re-stamp revoked_by');
reset role;

select pg_temp.login('99999999-9999-4999-8999-999999999999');

-- The budget actually runs out: 20 through, the 21st refused.
select is((select bool_and(public.consume_platform_invite_throttle())
           from generate_series(1, 20)), true,
  'B15 the first 20 outbound mails fit in the hourly budget');
select is(public.consume_platform_invite_throttle(), false,
  'B16 the 21st is refused');

reset role;

-- ---------------------------------------------------------------------------
-- C. Every other role sees and writes nothing
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, venue admin
select is((select count(*)::int from public.platform_invites), 0,
  'C1 a venue admin sees no platform invites');
select is(
  pg_temp.rowcount($$update public.platform_invites set last_sent_at = now()$$),
  0, 'C2 a venue admin updates nothing (RLS filters to zero rows)');
select throws_ok($$
  insert into public.platform_invites (email, invited_by)
  values ('sneaky@klant.test', '11111111-1111-4111-8111-111111111111')
$$, '42501', null, 'C3 a venue admin cannot insert');
reset role;

select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- Noor, user_manager
select is((select count(*)::int from public.platform_invites), 0,
  'C4 a user_manager sees nothing');
select throws_ok($$
  insert into public.platform_invites (email, invited_by)
  values ('sneaky@klant.test', '22222222-2222-4222-8222-222222222222')
$$, '42501', null, 'C5 a user_manager cannot insert');
reset role;

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- Femke, finance
select is((select count(*)::int from public.platform_invites), 0,
  'C6 finance sees nothing');
reset role;

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff
select is((select count(*)::int from public.platform_invites), 0,
  'C7 staff sees nothing');
reset role;

select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- Lisa, doorhost
select is((select count(*)::int from public.platform_invites), 0,
  'C8 a doorhost sees nothing');
reset role;

select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- Yusuf, organizer
select is((select count(*)::int from public.platform_invites), 0,
  'C9 an event organizer sees nothing');
reset role;

select pg_temp.login_anon();
select throws_ok($$select count(*) from public.platform_invites$$,
  '42501', null, 'C10 anon is refused at the grant layer');
select throws_ok($$select * from public.platform_invite_overview()$$,
  '42501', null, 'C11 anon cannot execute the overview');
reset role;

-- ---------------------------------------------------------------------------
-- D. Status source — stages and the GROUP BY roll-up
-- ---------------------------------------------------------------------------

select pg_temp.login('99999999-9999-4999-8999-999999999999');

select is((select stage from public.platform_invite_overview()
            where id = 'fb000000-0000-7000-8000-0000000000b1'), 'signed_in',
  'D1 a confirmed invitee with no company is signed_in');

select is((select stage from public.platform_invite_overview()
            where id = 'fb000000-0000-7000-8000-0000000000b2'), 'first_event',
  'D2 an invitee with a company AND an event is first_event');

select is((select stage from public.platform_invite_overview()
            where email = 'beta-cold@klant.test' and revoked_at is null), 'invited',
  'D3 an unconfirmed invitee is still just invited');

select is((select stage from public.platform_invite_overview()
            where id = 'fb000000-0000-7000-8000-0000000000b3'), 'revoked',
  'D4 a revoked invite reports the revoked stage');

select is((select venue_count from public.platform_invite_overview()
            where id = 'fb000000-0000-7000-8000-0000000000b2'), 1,
  'D5 venue_count is aggregated in SQL');

select is((select invite_count from public.platform_invite_funnel()
            where stage = 'signed_in'), 1,
  'D6 the funnel rolls up per stage');

select is((select sum(invite_count)::int from public.platform_invite_funnel()), 4,
  'D7 the funnel covers every invite row exactly once');

-- The partial-uniqueness duplicate must not fan the invite out into two rows.
select is((select count(*)::int from public.platform_invite_overview()
            where id = 'fb000000-0000-7000-8000-0000000000b1'), 1,
  'D7a a second auth.users row for the same address does not duplicate the invite');

-- A soft-deleted account never counts as "signed in", even when it is the
-- oldest row for that address.
select is((select stage from public.platform_invite_overview()
            where email = 'beta-cold@klant.test' and revoked_at is null), 'invited',
  'D7b a deleted auth account does not promote the stage');

-- Windowing: the list is paged and capped, the funnel is not.
select is((select count(*)::int from public.platform_invite_overview(2, 0)), 2,
  'D7c the overview honours p_limit');
select is((select count(*)::int from public.platform_invite_overview(2, 3)), 1,
  'D7d the overview honours p_offset');
select is((select count(*)::int from public.platform_invite_overview(100000, 0)), 4,
  'D7e an absurd p_limit is capped, not obeyed blindly');

reset role;

-- A non-platform-admin gets zero rows rather than an error — no oracle.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.platform_invite_overview()), 0,
  'D8 the overview is empty for a venue admin');
select is((select count(*)::int from public.platform_invite_funnel()), 0,
  'D8b the funnel is empty for a venue admin too');
select throws_ok($$select public.consume_platform_invite_throttle()$$,
  '42501', null, 'D9 the throttle RPC refuses a non-platform-admin');
reset role;

-- ---------------------------------------------------------------------------
-- E. Audit (#4)
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.audit_log
            where entity_type = 'platform_invites'
              and entity_id = 'fb000000-0000-7000-8000-0000000000b1'
              and action = 'create'
              and actor_id = '99999999-9999-4999-8999-999999999999'
              and venue_id is null), 1,
  'E1 the insert is audited with the platform admin as actor and no venue');

select cmp_ok((select count(*)::int from public.audit_log
                where entity_type = 'platform_invites'
                  and entity_id = 'fb000000-0000-7000-8000-0000000000b3'
                  and action = 'update'), '>', 0,
  'E2 the revoke is audited as an update');

select * from finish();
rollback;
