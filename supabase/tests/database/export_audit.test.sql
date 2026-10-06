-- pgTAP — venue data export audit + opt-in derivation (legal v0.3 E1,
-- z8uq9m2hm6, migration 20261006160000).
--
-- Threat model (CLAUDE.md #1): the anon/auth key ships to the browser, so every
-- claim has to hold against raw PostgREST calls. Footholds:
--   * a venue admin of venue X who wants to write (or read) an export row for
--     venue Y, or pin an event of Y onto an export of X (scope mismatch);
--   * a finance / staff member who wants to log an export at all;
--   * an anonymous caller;
--   * anyone who wants to bypass the RPC and forge an audit row directly.
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

select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — RLS bypassed, like the seed)
-- ---------------------------------------------------------------------------
-- Seed: admin@ (1111…) is admin at Club Vesper (…0001) and De Marktzaal
-- (…0002); finance@ (3333…) and staff@ (5555…) are members of Club Vesper.
-- A third venue nobody from the seed belongs to, with its own event.

insert into public.venues (id, name, slug) values
  ('ac000000-0000-7000-8000-0000000000e1', 'Export Elsewhere', 'export-elsewhere');

insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug) values
  ('ec000000-0000-7000-8000-0000000000e1', 'ac000000-0000-7000-8000-0000000000e1',
   'Elsewhere Night', now() + interval '3 days', now() + interval '3 days 6 hours',
   'open', 'export-elsewhere-night');

-- Contacts at Club Vesper + requests that decide their opt-in state.
insert into public.contacts (id, venue_id, full_name, email, phone) values
  ('c0000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001',
   'Opted In', 'optin@export.test', null),
  ('c0000000-0000-7000-8000-0000000000e2', 'aa000000-0000-7000-8000-000000000001',
   'Withdrew Later', 'withdrew@export.test', null),
  ('c0000000-0000-7000-8000-0000000000e3', 'aa000000-0000-7000-8000-000000000001',
   'Phone Only', null, '+31 6 1234 9876'),
  ('c0000000-0000-7000-8000-0000000000e4', 'ac000000-0000-7000-8000-0000000000e1',
   'Elsewhere Contact', 'optin@export.test', null);

insert into public.guest_requests
  (event_id, full_name, email, phone, plus_ones, marketing_opt_in, created_at) values
  -- Opted In: a single request, ticked (e-mail match is case/space-insensitive).
  ('ee000000-0000-7000-8000-000000000001', 'Opted In', '  OptIn@Export.test ', null, 0, true,
   now() - interval '2 days'),
  -- Withdrew Later: ticked once, then a newer request without the tick.
  ('ee000000-0000-7000-8000-000000000001', 'Withdrew Later', 'withdrew@export.test', null, 0, true,
   now() - interval '5 days'),
  ('ee000000-0000-7000-8000-000000000001', 'Withdrew Later', 'withdrew@export.test', null, 0, false,
   now() - interval '1 day'),
  -- Phone Only: matched on phone digits.
  ('ee000000-0000-7000-8000-000000000001', 'Phone Only', null, '+31612349876', 1, true,
   now() - interval '3 days'),
  -- Same e-mail at the OTHER venue, ticked: must not leak into Club Vesper.
  ('ec000000-0000-7000-8000-0000000000e1', 'Elsewhere Contact', 'optin@export.test', null, 0, true,
   now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- A. Shape + grants
-- ---------------------------------------------------------------------------

select has_function('public', 'log_venue_export',
  array['uuid', 'uuid', 'integer', 'integer', 'integer', 'integer'],
  'log_venue_export exists');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_venue_export'),
  true,
  'log_venue_export is SECURITY DEFINER (authenticated holds no INSERT on audit_log)');

select ok(
  not has_function_privilege('anon',
    'public.log_venue_export(uuid, uuid, integer, integer, integer, integer)', 'execute'),
  'anon cannot execute log_venue_export');

select ok(
  has_function_privilege('authenticated',
    'public.log_venue_export(uuid, uuid, integer, integer, integer, integer)', 'execute'),
  'authenticated can execute log_venue_export');

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'insert'),
  'audit_log grant matrix unchanged: authenticated still holds no INSERT');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contact_marketing_opt_ins'),
  false,
  'contact_marketing_opt_ins is SECURITY INVOKER (RLS-relative)');

select ok(
  not has_function_privilege('anon', 'public.contact_marketing_opt_ins(uuid)', 'execute'),
  'anon cannot execute contact_marketing_opt_ins');

-- ---------------------------------------------------------------------------
-- B. Allowed: venue admin, venue + event scope
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');

select isnt(
  public.log_venue_export('aa000000-0000-7000-8000-000000000001', null, 30, 12, 7, 4),
  null,
  'admin logs a venue-wide export');

reset role;

select results_eq(
  $$ select actor_id, entity_type, entity_id, action, event_id,
            diff ->> 'scope', (diff -> 'rows' ->> 'guests')::int, (diff -> 'rows' ->> 'door')::int
       from public.audit_log
      where action = 'export' and venue_id = 'aa000000-0000-7000-8000-000000000001'
        and event_id is null $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, 'venues'::text,
             'aa000000-0000-7000-8000-000000000001'::uuid, 'export'::text, null::uuid,
             'venue'::text, 30, 4) $$,
  'the row names the caller, the venue, scope venue and the counts');

select pg_temp.login('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.log_venue_export('aa000000-0000-7000-8000-000000000001',
       'ee000000-0000-7000-8000-000000000001', 30, 5, 3, 2) $$,
  'admin logs a per-event export');

reset role;

select is(
  (select diff ->> 'scope' from public.audit_log
    where action = 'export' and event_id = 'ee000000-0000-7000-8000-000000000001'),
  'event',
  'per-event export is stamped with its event and scope event');

-- The venue's own admin can read the trail back (audit_log_select_admin).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.audit_log
    where action = 'export' and venue_id = 'aa000000-0000-7000-8000-000000000001'),
  2,
  'the venue admin sees both export rows in the audit log');

-- ---------------------------------------------------------------------------
-- C. Denied
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.log_venue_export('ac000000-0000-7000-8000-0000000000e1', null, 1, 1, 1, 1) $$,
  '42501', 'not allowed',
  'admin of X cannot log an export for a venue they do not administer');

select throws_ok(
  $$ select public.log_venue_export('aa000000-0000-7000-8000-000000000001',
       'ec000000-0000-7000-8000-0000000000e1', 1, 1, 1, 1) $$,
  '42501', 'not allowed',
  'an event of another venue cannot be pinned onto this venue''s export (scope mismatch)');

select throws_ok(
  $$ select public.log_venue_export('aa000000-0000-7000-8000-000000000001', null, -1, 0, 0, 0) $$,
  '22023', null,
  'a negative count is refused');

select throws_ok(
  $$ select public.log_venue_export('aa000000-0000-7000-8000-000000000001', null, 50001, 0, 0, 0) $$,
  '22023', null,
  'a count above the 50 000 export cap is refused');

select throws_ok(
  $$ insert into public.audit_log (actor_id, venue_id, entity_type, entity_id, action)
     values ('11111111-1111-4111-8111-111111111111', 'aa000000-0000-7000-8000-000000000001',
             'venues', 'aa000000-0000-7000-8000-000000000001', 'export') $$,
  '42501', null,
  'a direct audit_log insert is still refused — the RPC is the only writer');

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.log_venue_export('aa000000-0000-7000-8000-000000000001', null, 1, 1, 1, 1) $$,
  '42501', 'not allowed',
  'finance cannot log an export (admin only)');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.log_venue_export('aa000000-0000-7000-8000-000000000001', null, 1, 1, 1, 1) $$,
  '42501', 'not allowed',
  'staff cannot log an export');

select pg_temp.login_anon();
select throws_ok(
  $$ select public.log_venue_export('aa000000-0000-7000-8000-000000000001', null, 1, 1, 1, 1) $$,
  '42501', null,
  'anon cannot call log_venue_export');

reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'export'),
  2,
  'no denied call left a row behind');

-- ---------------------------------------------------------------------------
-- D. contact_marketing_opt_ins
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');

select ok(
  exists (select 1 from public.contact_marketing_opt_ins('aa000000-0000-7000-8000-000000000001')
           where contact_id = 'c0000000-0000-7000-8000-0000000000e1'),
  'a contact whose latest request is ticked is opted in (normalised e-mail match)');

select ok(
  not exists (select 1 from public.contact_marketing_opt_ins('aa000000-0000-7000-8000-000000000001')
               where contact_id = 'c0000000-0000-7000-8000-0000000000e2'),
  'a later unticked request withdraws the opt-in');

select ok(
  exists (select 1 from public.contact_marketing_opt_ins('aa000000-0000-7000-8000-000000000001')
           where contact_id = 'c0000000-0000-7000-8000-0000000000e3'),
  'a phone-only contact matches on phone digits');

select is(
  (select count(*)::int from public.contact_marketing_opt_ins('ac000000-0000-7000-8000-0000000000e1')),
  0,
  'admin of X reads no opt-ins of a venue they are not a member of (RLS)');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select count(*)::int from public.contact_marketing_opt_ins('aa000000-0000-7000-8000-000000000001')),
  0,
  'staff reads no opt-ins (contacts + requests RLS)');

select * from finish();
rollback;
