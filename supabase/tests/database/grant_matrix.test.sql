-- pgTAP — schema-wide grant matrix for `public` (run: pnpm db:test).
--
-- Why this file exists, when tables.test.sql already checks DELETE on four
-- tables by name: a hand-kept list only guards the objects someone remembered
-- to add to it. 20260613000000 zeroed the privileges of every table that
-- existed on 2026-06-13 with `revoke all on all tables in schema public`, which
-- is a snapshot and not a rule, and Supabase's stock default ACLs then handed
-- anon and authenticated the full privilege set on each table created after it.
-- Six objects stayed open for three months (see 20260917100000).
--
-- So every assertion here is driven by the catalog, never by a list of today's
-- objects. The two allowlists that do appear are pairs of (object, privilege)
-- with a comment saying which flow needs them — an exception you can see in a
-- diff, rather than an ACL nobody reads.
--
-- Nothing here replaces the per-table RLS tests: grants are the layer UNDER
-- RLS (#1). Both have to hold.

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- 1. anon holds no table privilege in public, bar one documented exception
-- ---------------------------------------------------------------------------
-- Every anon-facing flow goes through a SECURITY DEFINER RPC with its own
-- execute grant. The exception is request_links.SELECT, granted on purpose by
-- 20260706103000: the `guest_requests_insert_public` policy's WITH CHECK
-- subquery reads that table as the anon caller, and /api/health probes it
-- because the grant means the query never 42501s while the absent anon SELECT
-- policy means it always returns zero rows.
select is_empty($$
  select c.relname || ' -> ' || p as offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and has_table_privilege('anon', c.oid, p)
    and (c.relname || ':' || p) <> all (array[
      'request_links:SELECT'  -- /api/health probe + guest_requests insert policy
    ])
$$, 'anon holds no privilege in public beyond the documented request_links.SELECT');

-- ---------------------------------------------------------------------------
-- 2. …and no column-level privilege either
-- ---------------------------------------------------------------------------
-- `has_table_privilege` returns false for a column-only grant, so assertion 1
-- cannot see one. This schema had exactly that shape once — 20260624200000
-- granted anon `select (cancelled_at)` on events — and it was only cleaned up
-- as a side effect of a table-level revoke in the P0 hotfix.
select is_empty($$
  select c.relname || '.' || a.attname || ' -> ' || x.privilege_type as offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  cross join lateral aclexplode(a.attacl) x
  where n.nspname = 'public' and x.grantee = 'anon'::regrole
$$, 'anon holds no column-level privilege anywhere in public');

-- ---------------------------------------------------------------------------
-- 3. TRUNCATE is never an app-role privilege
-- ---------------------------------------------------------------------------
-- TRUNCATE is the one write RLS does not filter: a row policy cannot stop it.
-- PostgREST never issues it, so the grant buys nothing and costs the whole
-- table if anything ever does run raw SQL as an app role.
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
-- 4. authenticated DELETE only where a hard delete is actually intended
-- ---------------------------------------------------------------------------
-- Guest data is soft-deleted (#21) and audit history is immutable (#4). The
-- allowlist is config and membership data, where a real row removal is the
-- correct domain action and a delete policy exists to scope it.
select is_empty($$
  select c.relname as offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and has_table_privilege('authenticated', c.oid, 'DELETE')
    and c.relname <> all (array[
      'event_organizers', 'event_quotas',        -- event scoping + per-event quota rows
      'event_templates', 'event_template_tiers', -- template config, not guest data
      'guest_tiers',                             -- tier config
      'invites',                                 -- withdraw a pending invite
      'quotas',                                  -- venue-level quota rows
      'venue_memberships'                        -- remove a member (#24)
    ])
$$, 'authenticated holds DELETE only on the tables where a hard delete is intended');

-- ---------------------------------------------------------------------------
-- 5. The default ACLs that caused this cannot cause it again
-- ---------------------------------------------------------------------------
-- Scoped to the roles that actually OWN relations here rather than to `postgres`
-- by name. 20260917100000 can only close the postgres defaults — postgres is not
-- a member of supabase_admin on hosted Supabase, so revoking that role's
-- defaults would succeed locally and fail in production. Deriving the role set
-- from pg_class instead means a table that ever arrives under a different owner
-- (the dashboard, a platform upgrade, `create extension … schema public`) fails
-- the build rather than quietly inheriting that owner's open defaults.
select is_empty($$
  select pg_get_userbyid(o.owner) || ' default-grants ' || a.privilege_type || ' to anon' as offender
  from (
    select distinct c.relowner as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  ) o
  join pg_default_acl d on d.defaclrole = o.owner and d.defaclobjtype = 'r'
  left join pg_namespace dn on dn.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where a.grantee = 'anon'::regrole
    and (dn.nspname = 'public' or d.defaclnamespace = 0)
$$, 'no owner of a relation in public has default privileges that grant anon anything');

select is_empty($$
  select pg_get_userbyid(o.owner) || ' default-grants TRUNCATE to authenticated' as offender
  from (
    select distinct c.relowner as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  ) o
  join pg_default_acl d on d.defaclrole = o.owner and d.defaclobjtype = 'r'
  left join pg_namespace dn on dn.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where a.grantee = 'authenticated'::regrole
    and a.privilege_type = 'TRUNCATE'
    and (dn.nspname = 'public' or d.defaclnamespace = 0)
$$, 'no owner of a relation in public default-grants TRUNCATE to authenticated');

-- ---------------------------------------------------------------------------
-- 6. The revokes did not overshoot — the app still has what it needs
-- ---------------------------------------------------------------------------
-- Without these, every assertion above could be satisfied by revoking
-- everything from everyone, which passes CI and breaks the product. That is not
-- hypothetical: the first draft of 20260917100000 did `revoke all … from anon`
-- on request_links and took out /api/health and the public request form with it.
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

-- The exception from assertion 1, asserted positively: an over-eager revoke
-- here breaks /api/health and every attributed public request, and it should
-- say so HERE rather than 21 subtests deep in request_links.test.sql.
select ok(
  has_table_privilege('anon', 'public.request_links', 'SELECT'),
  'anon keeps SELECT on request_links (/api/health probe + insert-policy subquery)');

-- service_role is the trusted server role: it bypasses RLS by design and its
-- key never reaches client code, so this migration deliberately left it alone.
select ok(
  has_table_privilege('service_role', 'public.influencers', 'SELECT')
  and has_table_privilege('service_role', 'public.request_link_pageviews_daily', 'INSERT'),
  'service_role privileges are untouched by the hardening');

select * from finish();

rollback;
