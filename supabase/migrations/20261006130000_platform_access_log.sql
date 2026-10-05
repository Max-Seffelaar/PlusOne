-- Legal v0.3 B3 — platform_access_log (z8uq9m2hm5, legal-v03-plan §3 B3,
-- decisions 3 + 8).
--
-- Light variant of "audit trail for read-only cross-venue platform-admin
-- support sessions" (the heavy, DB-enforced variant is backlog item
-- z8uq9m0vyk, milestone ≥25). One row every time a PlusOne platform admin
-- (decision #49) switches INTO a venue through the app while holding no own
-- membership there. The row is written by `switchActiveVenueAction`
-- (src/features/venues/actions.ts) through the caller's own user-scoped client,
-- so the INSERT policy below is what proves who wrote it.
--
-- What this is NOT:
--   * Not an enforcement point. A platform admin reads every venue through RLS
--     (decision #49) — raw PostgREST calls, SQL editor, MCP. Those reads are
--     not logged here; CLAUDE.md §Platform admins states the working rule for
--     them (decision 8).
--   * Not customer-visible (decision 3): SELECT is platform admins only. We
--     share rows with a venue on request (DPA 4.4).
--
-- Integrity (an operator must not be able to forge or wipe their own trail
-- through the API):
--   * INSERT only as yourself: `admin_id = auth.uid()` in WITH CHECK, and only
--     while `is_platform_admin()`.
--   * `created_at` is stamped by a BEFORE INSERT trigger from the server clock,
--     whatever the client sends — no back-dating.
--   * No UPDATE, DELETE or TRUNCATE grant for anon/authenticated and no policy
--     for them: rows are append-only for every app role. `grant_matrix.test.sql`
--     needs no allowlist change (it only allows DELETE on config tables).
--   * No audit trigger: the table IS the audit record and can't change after
--     insert, so an audit_log row would duplicate it one-for-one.
--
-- Retention: no anonymisation (operator log). Rows live as long as the venue
-- and go with it (`on delete cascade`, ToS 16.6) — named in Privacy §10 by A1.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table public.platform_access_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null default auth.uid() references auth.users (id),
  venue_id uuid not null references public.venues (id) on delete cascade,
  -- Optional free-form operator note ("ticket #123"). Plain text, rendered as
  -- text only.
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.platform_access_log is
  'Append-only log of PlusOne platform admins switching into a venue they hold '
  'no membership at, through the app (decision 3, legal v0.3). Platform admins '
  'only (RLS); never visible to the venue. Direct DB/API reads are not logged.';

create index platform_access_log_venue_created_idx
  on public.platform_access_log (venue_id, created_at desc);
create index platform_access_log_created_idx
  on public.platform_access_log (created_at desc);
create index platform_access_log_admin_idx
  on public.platform_access_log (admin_id);

alter table public.platform_access_log enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Server-stamped created_at
-- ---------------------------------------------------------------------------

create or replace function public.stamp_platform_access_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

comment on function public.stamp_platform_access_log() is
  'BEFORE INSERT on platform_access_log: created_at always comes from the '
  'server clock, never from the client.';

revoke execute on function public.stamp_platform_access_log()
  from public, anon, authenticated, service_role;

create trigger stamp_platform_access_log
  before insert on public.platform_access_log
  for each row execute function public.stamp_platform_access_log();

-- ---------------------------------------------------------------------------
-- 3. RLS — platform admins only; insert as yourself; no update/delete
-- ---------------------------------------------------------------------------

create policy platform_access_log_select on public.platform_access_log
  for select to authenticated
  using (public.is_platform_admin());

create policy platform_access_log_insert on public.platform_access_log
  for insert to authenticated
  with check (
    public.is_platform_admin()
    and admin_id = (select auth.uid())
  );

-- No UPDATE / DELETE policy, and no grant for either below.

-- ---------------------------------------------------------------------------
-- 4. Grant matrix — explicit, revoke first (never `on all tables in schema`)
-- ---------------------------------------------------------------------------

revoke all on table public.platform_access_log from anon, authenticated;
grant select, insert on table public.platform_access_log to authenticated;
-- service_role keeps its stock defaults, like every other table: its key is
-- server-only and no app flow writes this table through it.
