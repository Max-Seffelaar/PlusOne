-- pgTAP tests — Fase 1 schema (run: supabase test db)
-- Covers: table set, RLS enabled everywhere (default-deny — policies come in a
-- later migration and get their own allowed/denied tests), no hard delete for
-- app roles, key constraints/indexes, UUIDv7, and seed sanity.

begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

-- Schema -------------------------------------------------------------------

select tables_are(
  'public',
  array[
    'user_profiles', 'venues', 'venue_memberships', 'events',
    'event_organizers', 'guest_tiers', 'guests', 'guest_requests',
    'quotas', 'event_quotas', 'quota_requests', 'check_ins', 'refusals',
    'audit_log', 'subscriptions',
    -- Fase 4 (auth layer): invite-only account provisioning.
    'invites',
    -- Fase 8 (public aanvraagflow): per-IP rate-limit state (#28).
    'landing_request_throttle'
  ],
  'public schema contains exactly the MVP tables (Fase 1 + invites + landing)'
);

-- RLS: on for every table, no exceptions (default-deny without policies) ----

select is_empty(
  $$ select tablename from pg_tables
     where schemaname = 'public' and not rowsecurity $$,
  'RLS is enabled on every public table'
);

-- UUIDv7 -------------------------------------------------------------------

select ok(
  substring(public.uuid_generate_v7()::text from 15 for 1) = '7',
  'uuid_generate_v7() emits version-7 UUIDs (not the old v4 placeholder)'
);

-- Hard delete is revoked for app roles (decision #21 / #4) ------------------

select ok(
  not has_table_privilege('anon', 'public.guests', 'DELETE')
  and not has_table_privilege('authenticated', 'public.guests', 'DELETE'),
  'DELETE on guests revoked for anon + authenticated'
);

select ok(
  not has_table_privilege('anon', 'public.check_ins', 'DELETE')
  and not has_table_privilege('authenticated', 'public.check_ins', 'DELETE'),
  'DELETE on check_ins revoked for anon + authenticated'
);

select ok(
  not has_table_privilege('anon', 'public.refusals', 'DELETE')
  and not has_table_privilege('authenticated', 'public.refusals', 'DELETE'),
  'DELETE on refusals revoked for anon + authenticated'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
  and not has_table_privilege('authenticated', 'public.audit_log', 'INSERT'),
  'audit_log is append-only for app roles (insert via triggers only)'
);

select ok(
  not has_table_privilege('service_role', 'public.guests', 'DELETE')
  and not has_table_privilege('service_role', 'public.audit_log', 'DELETE'),
  'even service_role cannot hard-delete guest data or audit history'
);

select ok(
  has_table_privilege('authenticated', 'public.guests', 'SELECT')
  and has_table_privilege('authenticated', 'public.guests', 'INSERT')
  and has_table_privilege('authenticated', 'public.guests', 'UPDATE'),
  'authenticated keeps select/insert/update on guests (rows scoped by RLS)'
);

select ok(
  has_table_privilege('anon', 'public.guest_requests', 'INSERT')
  and not has_table_privilege('anon', 'public.guests', 'SELECT'),
  'anon may only file landing requests, never read guests'
);

-- Fase 8: the throttle table is reachable ONLY through the SECURITY DEFINER
-- submit RPC — app roles have no direct grip on it (#28).
select ok(
  not has_table_privilege('anon', 'public.landing_request_throttle', 'SELECT')
  and not has_table_privilege('anon', 'public.landing_request_throttle', 'INSERT')
  and not has_table_privilege('authenticated', 'public.landing_request_throttle', 'SELECT')
  and not has_table_privilege('authenticated', 'public.landing_request_throttle', 'INSERT'),
  'landing_request_throttle is server-only: no anon/authenticated access'
);

-- Fase 8: anon may submit a request; only authenticated may approve one (#12).
select ok(
  has_function_privilege('anon',
    'public.submit_guest_request(text,text,text,text,integer,text,text,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated',
    'public.approve_guest_request(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.approve_guest_request(uuid,uuid)', 'EXECUTE'),
  'anon may submit_guest_request; approve_guest_request is authenticated-only'
);

-- Constraints & indexes ------------------------------------------------------

select col_is_unique(
  'public', 'check_ins', 'guest_id',
  'check_ins.guest_id is UNIQUE (double-check-in prevention)'
);

select has_index('public', 'guests', 'guests_event_id_status_idx',
  'guests has (event_id, status) index');

select has_index('public', 'venue_memberships', 'venue_memberships_user_id_idx',
  'venue_memberships has user_id index');

select has_index('public', 'audit_log', 'audit_log_venue_id_created_at_idx',
  'audit_log has (venue_id, created_at) index');

-- Seed sanity (fresh `supabase db reset`) ------------------------------------

select is((select count(*) from public.venues), 2::bigint, 'seed: 2 venues');

select is((select count(*) from public.user_profiles), 6::bigint, 'seed: 6 users');

select is((select count(*) from public.guests), 30::bigint, 'seed: 30 guests');

select is(
  (select count(*) from public.check_ins), 3::bigint,
  'seed: every checked_in guest has a check_ins row'
);

select is(
  (select cardinality(roles) from public.venue_memberships
   where user_id = '66666666-6666-4666-8666-666666666666'
     and venue_id = 'aa000000-0000-7000-8000-000000000001'),
  2,
  'seed: doorhost Lisa holds two roles on one membership (decision #8)'
);

select * from finish();

rollback;
