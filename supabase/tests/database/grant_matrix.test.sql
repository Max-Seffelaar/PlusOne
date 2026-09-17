-- pgTAP — schema-wide grant matrix for `public` (run: pnpm db:test).
--
-- Why this file exists, when tables.test.sql already checks DELETE on four
-- tables by name: a hand-kept list only guards the objects someone remembered
-- to add to it. Supabase's stock default ACLs grant anon and authenticated the
-- FULL privilege set on every table and view created in public by role
-- postgres, so a new table is open until its migration explicitly closes it.
-- Five tables and one view stayed open for months that way (see migration
-- 20260917100000). These assertions are driven by the catalog instead of by a
-- list, so the next object that forgets its revoke turns this file red on the
-- first CI run rather than on the first audit.
--
-- Nothing here replaces the per-table RLS tests: grants are the layer UNDER
-- RLS (#1). Both have to hold.

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- ---------------------------------------------------------------------------
-- 1. anon holds no table privilege anywhere in public
-- ---------------------------------------------------------------------------
-- Every anon-facing flow goes through a SECURITY DEFINER RPC with its own
-- execute grant. If a future table legitimately needs a direct anon privilege,
-- add its name to the array below WITH a comment saying which flow needs it —
-- so the exception is reviewable in the diff instead of invisible in the ACL.
select is_empty($$
  select c.relname || ' -> ' || p as offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and c.relname <> all (array[]::text[])  -- no anon-reachable tables today
    and has_table_privilege('anon', c.oid, p)
$$, 'anon holds no privilege on any relation in public');

-- ---------------------------------------------------------------------------
-- 2. TRUNCATE is never an app-role privilege
-- ---------------------------------------------------------------------------
-- TRUNCATE is the one write that RLS does not filter: a row policy cannot stop
-- it. PostgREST never issues it, so a grant here buys nothing and costs the
-- whole table if anything ever does run raw SQL as an app role.
select is_empty($$
  select c.relname || ' -> ' || r as offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['anon','authenticated']) r
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and has_table_privilege(r, c.oid, 'TRUNCATE')
$$, 'no app role holds TRUNCATE on any relation in public');

-- ---------------------------------------------------------------------------
-- 3. authenticated DELETE only where a hard delete is actually intended
-- ---------------------------------------------------------------------------
-- Guest data is soft-deleted (#21) and audit history is immutable (#4). The
-- allowlist is config and membership data, where a real row removal is the
-- correct operation and a delete policy exists to scope it.
select is_empty($$
  select c.relname as offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and has_table_privilege('authenticated', c.oid, 'DELETE')
    and c.relname <> all (array[
      'event_organizers', 'event_quotas',      -- event scoping + per-event quota rows
      'event_templates', 'event_template_tiers', -- template config, not guest data
      'guest_tiers',                            -- tier config
      'invites',                                -- withdraw a pending invite
      'quotas',                                 -- venue-level quota rows
      'venue_memberships'                       -- remove a member (#24)
    ])
$$, 'authenticated holds DELETE only on the tables where a hard delete is intended');

-- ---------------------------------------------------------------------------
-- 4. The default ACLs that caused this cannot cause it again
-- ---------------------------------------------------------------------------
select ok(
  not exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where n.nspname = 'public' and d.defaclobjtype = 'r'
      and a.grantee = 'anon'::regrole
  ),
  'no default privilege in public grants anything to anon (new tables start closed)');

select ok(
  not exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where n.nspname = 'public' and d.defaclobjtype = 'r'
      and a.grantee = 'authenticated'::regrole
      and a.privilege_type = 'TRUNCATE'
  ),
  'no default privilege in public grants TRUNCATE to authenticated');

-- ---------------------------------------------------------------------------
-- 5. The revokes did not overshoot — the app still has what it needs
-- ---------------------------------------------------------------------------
-- Without these, every assertion above could be satisfied by revoking
-- everything from everyone, which would pass CI and break the product.
select ok(
  has_table_privilege('authenticated', 'public.guests', 'SELECT')
  and has_table_privilege('authenticated', 'public.guests', 'INSERT')
  and has_table_privilege('authenticated', 'public.guests', 'UPDATE'),
  'authenticated keeps select/insert/update on guests');

select ok(
  has_table_privilege('authenticated', 'public.influencers', 'SELECT')
  and has_table_privilege('authenticated', 'public.influencers', 'INSERT')
  and has_table_privilege('authenticated', 'public.influencers', 'UPDATE'),
  'authenticated keeps select/insert/update on influencers (F1 admin flow)');

select ok(
  has_table_privilege('authenticated', 'public.request_links', 'SELECT')
  and has_table_privilege('authenticated', 'public.request_links', 'INSERT')
  and has_table_privilege('authenticated', 'public.request_links', 'UPDATE'),
  'authenticated keeps select/insert/update on request_links');

select ok(
  has_table_privilege('authenticated', 'public.event_templates', 'SELECT')
  and has_table_privilege('authenticated', 'public.event_templates', 'INSERT')
  and has_table_privilege('authenticated', 'public.event_templates', 'UPDATE')
  and has_table_privilege('authenticated', 'public.event_templates', 'DELETE'),
  'authenticated keeps the full template matrix on event_templates');

select ok(
  has_table_privilege('authenticated', 'public.request_link_pageviews_daily', 'SELECT')
  and has_table_privilege('authenticated', 'public.audit_feed', 'SELECT'),
  'authenticated keeps the read-only surfaces (link counters, audit feed)');

-- service_role is the trusted server role: it bypasses RLS by design and its
-- key never reaches client code, so this migration deliberately left it alone.
select ok(
  has_table_privilege('service_role', 'public.influencers', 'SELECT')
  and has_table_privilege('service_role', 'public.request_link_pageviews_daily', 'INSERT'),
  'service_role privileges are untouched by the hardening');

select * from finish();

rollback;
