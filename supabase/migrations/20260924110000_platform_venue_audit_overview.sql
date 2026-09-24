-- P-05 — Platform (system) admin: venue overview + audit viewer (z8uq9m0tnx).
--
-- Goal: a PlusOne platform admin (P-02, `is_platform_admin()`) can see which
-- companies exist, jump into one to help, and see back who did what — with a
-- name, across EVERY venue.
--
-- Security shape (CLAUDE.md #1 — RLS is the boundary, this is not app-layer
-- theatre):
--   * All five functions are SECURITY DEFINER and re-check `is_platform_admin()`
--     in their own body/WHERE, exactly like `platform_invite_overview()`
--     (20260923150000). A non-platform-admin gets ZERO rows, never an error —
--     no oracle that the surface exists.
--   * `audit_log` already lets a platform admin SELECT every row directly
--     (P-02 widened `has_venue_role()`, which `audit_log_select_admin` calls),
--     so this migration adds no new read path to audit_log — it only aggregates
--     what RLS already permits and joins in the names.
--   * DEFINER is required for `platform_venue_overview*` too: it aggregates
--     `venue_memberships`/`events`/`audit_log` ACROSS every venue in one
--     GROUP BY-shaped query, which a SECURITY INVOKER function would have to
--     run once per venue under the caller's own RLS (fine for a platform admin
--     since `is_venue_member()` is `or is_platform_admin()`, but the point of a
--     single aggregate query is to do the counting in the database once, not
--     per-row in a loop).
--
-- Windowing (CLAUDE.md "never ship the whole table"): every list function caps
-- `p_limit` server-side (venues: 200, audit: 200) — a caller asking for more
-- gets the cap, not the full table. The two `*_count` functions exist so the
-- screens can render "X of Y" without ever pulling Y rows.
--
-- Support-action flag: `is_support_action` is true when the audited row has a
-- venue AND an actor, and that actor holds NO `venue_memberships` row at that
-- venue AT THE TIME OF THE QUERY (not a historical snapshot — venue_memberships
-- carries no history, so "was a member when the action happened" is not
-- reconstructable; a platform admin who is later added to a venue would see
-- their own past support actions stop being flagged). This is the same
-- limitation every other "is member" check in this codebase has (RLS itself
-- is always evaluated against CURRENT membership) and is documented rather
-- than solved here. It is indicative, not forensic: `is_platform_admin()`
-- already satisfies `venue_memberships_insert`'s role check for ANY venue
-- (review finding, z8uq9m0tnx), so a platform admin can self-insert a real
-- membership row (itself audited) and un-flag their own past support rows —
-- an audited trail, not a tamper-proof one.
--
-- No new table, so no grant-matrix entry: only new functions, `authenticated`
-- only, `revoke` before `grant` per convention.
--
-- Index (review finding, z8uq9m0tnx): the platform-wide default view of
-- `platform_audit_overview`/`_count` (no `p_venue_id`) scans + sorts the
-- WHOLE table by `created_at`, and the only existing index on `audit_log` is
-- the composite `(venue_id, created_at)` — useless for a query with no
-- venue_id predicate. `audit_log` is append-only and grows without bound
-- (CLAUDE.md "the audit table grows hard"), so this index is not optional at
-- scale.

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);

comment on index public.audit_log_created_at_idx is
  'Supports the platform-wide (no venue filter) path of platform_audit_overview/'
  '_count — an ORDER BY created_at DESC + LIMIT/OFFSET scan across every venue.';

-- ---------------------------------------------------------------------------
-- 1. Venue overview — GROUP BY aggregate, windowed
-- ---------------------------------------------------------------------------

create or replace function public.platform_venue_overview(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null
)
returns table (
  venue_id uuid,
  name text,
  slug text,
  member_count integer,
  event_count integer,
  subscription_status text,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id,
    v.name,
    v.slug,
    coalesce(mc.member_count, 0)::int,
    coalesce(ec.event_count, 0)::int,
    s.status::text,
    greatest(v.updated_at, ec.last_event_at, al.last_audit_at)
  from public.venues v
  left join lateral (
    select count(*)::int as member_count
    from public.venue_memberships vm
    where vm.venue_id = v.id
  ) mc on true
  left join lateral (
    select count(*)::int as event_count, max(e.updated_at) as last_event_at
    from public.events e
    where e.venue_id = v.id
  ) ec on true
  left join public.subscriptions s on s.venue_id = v.id
  left join lateral (
    select max(a.created_at) as last_audit_at
    from public.audit_log a
    where a.venue_id = v.id
  ) al on true
  where public.is_platform_admin()
    and (p_search is null or v.name ilike '%' || btrim(p_search) || '%')
  -- `id` is a tiebreaker, not cosmetic: two venues can share a `name` and
  -- `order by name` alone gives Postgres no stable order between them, so a
  -- row can be skipped or repeated across pages (review finding, z8uq9m0tnx).
  order by v.name asc, v.id asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.platform_venue_overview(integer, integer, text) is
  'Windowed venue overview for platform admins: member/event counts and last '
  'activity, aggregated in one GROUP BY-shaped query (default 50 rows, hard '
  'cap 200, ordered by name). Returns zero rows for anyone who is not a '
  'platform admin.';

revoke execute on function public.platform_venue_overview(integer, integer, text)
  from public, anon, service_role;
grant execute on function public.platform_venue_overview(integer, integer, text)
  to authenticated;

-- Total matching row count, for "X of Y" pagination without pulling Y rows.
create or replace function public.platform_venue_overview_count(p_search text default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.venues v
  where public.is_platform_admin()
    and (p_search is null or v.name ilike '%' || btrim(p_search) || '%');
$$;

comment on function public.platform_venue_overview_count(text) is
  'Total venue count matching platform_venue_overview''s search filter. Zero '
  'for anyone who is not a platform admin.';

revoke execute on function public.platform_venue_overview_count(text)
  from public, anon, service_role;
grant execute on function public.platform_venue_overview_count(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Audit viewer — filtered, windowed, support-action flag computed in SQL
-- ---------------------------------------------------------------------------

create or replace function public.platform_audit_overview(
  p_venue_id uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  actor_id uuid,
  actor_name text,
  venue_id uuid,
  venue_name text,
  event_id uuid,
  entity_type text,
  entity_id uuid,
  action text,
  diff jsonb,
  device_id text,
  is_support_action boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.created_at,
    a.actor_id,
    p.full_name,
    a.venue_id,
    v.name,
    a.event_id,
    a.entity_type,
    a.entity_id,
    a.action,
    a.diff,
    a.device_id,
    (
      a.venue_id is not null
      and a.actor_id is not null
      and not exists (
        select 1
        from public.venue_memberships vm
        where vm.venue_id = a.venue_id
          and vm.user_id = a.actor_id
      )
    ) as is_support_action
  from public.audit_log a
  left join public.user_profiles p on p.id = a.actor_id
  left join public.venues v on v.id = a.venue_id
  where public.is_platform_admin()
    and (p_venue_id is null or a.venue_id = p_venue_id)
    and (p_since is null or a.created_at >= p_since)
    and (p_until is null or a.created_at <= p_until)
  -- `id` is a tiebreaker, not cosmetic: audit_trigger() writes a whole
  -- trigger-batch (e.g. several guests inserted in one statement) with
  -- IDENTICAL created_at (the enclosing transaction's now()), so `order by
  -- created_at desc` alone gives no stable order within a batch — a row can
  -- be duplicated on one page and skipped on the next as p_offset advances
  -- (review finding, z8uq9m0tnx). id is a UUIDv7 (time-ordered within the
  -- same timestamp for rows inserted in sequence), so this also keeps the
  -- within-batch order close to insertion order, not just stable.
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.platform_audit_overview(uuid, timestamptz, timestamptz, integer, integer) is
  'Windowed, filterable audit feed across every venue for platform admins '
  '(default 100 rows, hard cap 200, newest first). is_support_action is true '
  'when the actor holds no CURRENT venue_memberships row at the audited venue '
  '(see header comment for the historical-snapshot caveat). Zero rows for '
  'anyone who is not a platform admin.';

revoke execute on function public.platform_audit_overview(uuid, timestamptz, timestamptz, integer, integer)
  from public, anon, service_role;
grant execute on function public.platform_audit_overview(uuid, timestamptz, timestamptz, integer, integer)
  to authenticated;

create or replace function public.platform_audit_overview_count(
  p_venue_id uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.audit_log a
  where public.is_platform_admin()
    and (p_venue_id is null or a.venue_id = p_venue_id)
    and (p_since is null or a.created_at >= p_since)
    and (p_until is null or a.created_at <= p_until);
$$;

comment on function public.platform_audit_overview_count(uuid, timestamptz, timestamptz) is
  'Total audit_log row count matching platform_audit_overview''s filters. Zero '
  'for anyone who is not a platform admin.';

revoke execute on function public.platform_audit_overview_count(uuid, timestamptz, timestamptz)
  from public, anon, service_role;
grant execute on function public.platform_audit_overview_count(uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Venue picker for the audit filter — id + name only, capped
-- ---------------------------------------------------------------------------
-- A separate, tiny function rather than reusing platform_venue_overview: the
-- filter dropdown needs every venue's name (never just the current page), and
-- none of the aggregate columns.

create or replace function public.platform_venue_options()
returns table (venue_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.name
  from public.venues v
  where public.is_platform_admin()
  order by v.name asc
  limit 500;
$$;

comment on function public.platform_venue_options() is
  'Every venue''s id + name (capped 500) for the platform audit filter''s venue '
  'picker. Zero rows for anyone who is not a platform admin.';

revoke execute on function public.platform_venue_options()
  from public, anon, service_role;
grant execute on function public.platform_venue_options() to authenticated;
