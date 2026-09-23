-- P-03 — platform_invites: invite customers into the open beta (z8uq9m0tnv).
--
-- Goal: a PlusOne platform admin (P-02, `is_platform_admin()`) invites a new
-- customer with nothing but an e-mail address. We deliberately create NO venue
-- and NO `public.invites` row — the invitee walks the existing onboarding
-- wizard, creates their own company, accepts the terms themselves and lands on
-- `trialing`. `platform_invites` is therefore a RECORD of the outreach plus the
-- funnel it feeds, never an access grant.
--
-- Security shape (CLAUDE.md #1 — RLS is the boundary):
--   * `platform_invites` is readable/writable by platform admins only. Every
--     policy is `to authenticated` and its USING/WITH CHECK is exactly
--     `public.is_platform_admin()` — the SECURITY DEFINER helper is the only
--     term, so there is nothing to short-circuit and no membership fallback.
--   * Explicit grant matrix (never `on all tables in schema`, per the
--     20260917100000 post-mortem): anon/authenticated are zeroed first, then
--     `authenticated` gets SELECT/INSERT/UPDATE. No DELETE — revoking an invite
--     is a soft `revoked_at` stamp so the audit trail survives (#21 spirit).
--     `service_role` keeps its defaults, untouched, like every other table.
--   * A BEFORE UPDATE guard pins the identity columns (id, email, invited_by,
--     created_at). RLS is row-level; without this a platform admin could
--     re-point an existing row at another address and the audit diff would be
--     the only trace.
--   * `audit_trigger()` is attached unchanged. platform_invites has no
--     venue_id and no event_id, so the generic `else` branch yields
--     venue_id = null — which is exactly right: a null-venue audit row is
--     readable only by platform admins (same shape as
--     `platform_admin_grant` from P-02).
--
-- Status source (scope item 4): `platform_invite_overview()` /
-- `platform_invite_funnel()`. The funnel needs `auth.users.confirmed_at`, which
-- `authenticated` cannot read, so both are SECURITY DEFINER — and both re-check
-- `public.is_platform_admin()` in their own body rather than trusting any
-- caller-side gate, with EXECUTE revoked from public/anon/service_role. They
-- aggregate in SQL; nothing is counted client-side.
--
-- Rate limiting: `consume_platform_invite_throttle()` wraps the existing
-- `consume_public_throttle()` (20260706102000, internal-only) with an
-- `is_platform_admin()` check, bucketed per actor. It covers invite AND resend
-- from one budget, because both end in an outbound e-mail.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table public.platform_invites (
  id uuid primary key default public.uuid_generate_v7(),
  -- Stored as entered (normalised to lowercase by the action's Zod schema);
  -- all matching is case-insensitive via lower(), like public.invites.
  email text not null check (char_length(email) between 3 and 254),
  -- Free-form operator note ("Joeri, via Lowlands"), never shown to the invitee.
  note text check (note is null or char_length(note) <= 500),
  invited_by uuid not null references public.user_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Bumped by every resend; the only column a resend writes, so the audit diff
  -- for a resend is unambiguous.
  last_sent_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.user_profiles (id) on delete restrict,
  -- Revoked rows always record who revoked; open ones never do.
  check ((revoked_at is null) = (revoked_by is null))
);

comment on table public.platform_invites is
  'Open-beta outreach log: one row per customer a PlusOne platform admin '
  'invited by e-mail. Grants no access — the invitee self-onboards. Platform '
  'admins only (RLS); soft revoke via revoked_at, never a DELETE.';

-- One OPEN invite per address; a revoked one no longer constrains, so the same
-- customer can be re-invited later.
create unique index platform_invites_open_unique
  on public.platform_invites (lower(email))
  where revoked_at is null;

-- The overview joins auth.users on lower(email).
create index platform_invites_email_idx on public.platform_invites (lower(email));
create index platform_invites_created_at_idx on public.platform_invites (created_at desc);

alter table public.platform_invites enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Immutability guard
-- ---------------------------------------------------------------------------
-- The only legitimate UPDATEs are "resend" (last_sent_at) and "revoke"
-- (revoked_at + revoked_by). Everything that identifies the invite is frozen.

create or replace function public.guard_platform_invite_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.invited_by is distinct from old.invited_by
     or new.created_at is distinct from old.created_at then
    raise exception 'platform_invites identity columns are immutable'
      using errcode = '42501';
  end if;

  -- A revoke is one-way: un-revoking would silently re-open the unique index
  -- slot and rewrite history. Re-invite by inserting a new row instead.
  if old.revoked_at is not null
     and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked platform invite cannot be changed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_platform_invite_update() is
  'BEFORE UPDATE guard on platform_invites: freezes id/email/invited_by/'
  'created_at and makes a revoke one-way.';

revoke execute on function public.guard_platform_invite_update()
  from public, anon, authenticated, service_role;

create trigger guard_platform_invite_update
  before update on public.platform_invites
  for each row execute function public.guard_platform_invite_update();

-- ---------------------------------------------------------------------------
-- 3. Audit (#4) — triggers, never app code
-- ---------------------------------------------------------------------------

create trigger audit_platform_invites
  after insert or update on public.platform_invites
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 4. RLS — platform admins only, on every verb
-- ---------------------------------------------------------------------------

create policy platform_invites_select on public.platform_invites
  for select to authenticated
  using (public.is_platform_admin());

-- The actor is always invited_by, and an invite is born open. `revoked_by` is
-- pinned to null on insert so a revoke is always a distinct, audited UPDATE.
create policy platform_invites_insert on public.platform_invites
  for insert to authenticated
  with check (
    public.is_platform_admin()
    and invited_by = (select auth.uid())
    and revoked_at is null
    and revoked_by is null
  );

-- Resend (last_sent_at) and revoke. A revoke must name the acting session as
-- revoked_by — the guard trigger above blocks everything else.
create policy platform_invites_update on public.platform_invites
  for update to authenticated
  using (public.is_platform_admin())
  with check (
    public.is_platform_admin()
    and (revoked_by is null or revoked_by = (select auth.uid()))
  );

-- No DELETE policy and no DELETE grant: revoking is a soft stamp.

-- ---------------------------------------------------------------------------
-- 5. Grant matrix — explicit, revoke first (never `on all tables in schema`)
-- ---------------------------------------------------------------------------

revoke all on table public.platform_invites from anon, authenticated;
grant select, insert, update on table public.platform_invites to authenticated;
-- service_role keeps its stock defaults, like every other table here: its key
-- is server-only and it bypasses RLS by design. No app flow writes this table
-- through it — the server action uses the user-scoped client so RLS applies.

-- ---------------------------------------------------------------------------
-- 6. Rate limit — one budget per platform admin, invite + resend together
-- ---------------------------------------------------------------------------
-- `consume_public_throttle` is internal-only (execute revoked from every app
-- role), so this is the sanctioned wrapper. SECURITY DEFINER for that reason
-- alone; it re-checks is_platform_admin() itself.

create or replace function public.consume_platform_invite_throttle()
returns boolean -- true = within budget, false = rate-limited
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- 20 outbound beta mails per platform admin per hour. Generous for a human
  -- operator, small enough that a stolen session cannot mail-bomb at scale.
  return public.consume_public_throttle('pinv:' || v_uid::text, 60, 20);
end;
$$;

comment on function public.consume_platform_invite_throttle() is
  'Fixed-window rate limit for outbound open-beta invite mail, keyed on the '
  'calling platform admin. Raises 42501 for anyone else.';

revoke execute on function public.consume_platform_invite_throttle()
  from public, anon, service_role;
grant execute on function public.consume_platform_invite_throttle() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Status source — SQL aggregation, never a client-side count
-- ---------------------------------------------------------------------------
-- Funnel per scope item 4:
--   invited          — the row exists, nothing else happened yet
--   signed_in        — an auth.users row for that address is confirmed
--   company_created  — that user holds at least one venue_membership
--   first_event      — at least one event exists in a venue they belong to
--   revoked          — revoked_at is set (terminal, orthogonal to progress)
--
-- SECURITY DEFINER is forced by `auth.users`: `authenticated` holds nothing
-- there, so a SECURITY INVOKER view or function cannot answer "did they ever
-- confirm?". The function therefore re-checks is_platform_admin() in its own
-- body and its EXECUTE grant is authenticated-only. What it exposes from
-- auth.users is narrow and deliberate: for an address a platform admin already
-- typed in themselves, the user id, whether it is confirmed, and when they last
-- signed in. No password hashes, no tokens, no metadata, and no way to probe an
-- address that is not already in platform_invites.

create or replace function public.platform_invite_overview()
returns table (
  id uuid,
  email text,
  note text,
  invited_by uuid,
  invited_by_name text,
  created_at timestamptz,
  last_sent_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  user_id uuid,
  confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  venue_count integer,
  event_count integer,
  stage text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The gate is the WHERE below: a non-platform-admin gets zero rows rather
  -- than an error, so the function leaks nothing — not even "there are invites".
  with matched as (
    select
      pi.id, pi.email, pi.note, pi.invited_by, pi.created_at, pi.last_sent_at,
      pi.revoked_at, pi.revoked_by,
      u.id as user_id, u.confirmed_at, u.last_sign_in_at
    from public.platform_invites pi
    left join auth.users u on lower(u.email) = lower(pi.email)
    where public.is_platform_admin()
  ),
  counted as (
    select
      m.*,
      (select count(*) from public.venue_memberships vm
        where vm.user_id = m.user_id)::integer as venue_count,
      (select count(*)
         from public.events e
         join public.venue_memberships vm on vm.venue_id = e.venue_id
        where vm.user_id = m.user_id)::integer as event_count
    from matched m
  )
  select
    c.id, c.email, c.note, c.invited_by,
    p.full_name as invited_by_name,
    c.created_at, c.last_sent_at, c.revoked_at, c.revoked_by,
    c.user_id, c.confirmed_at, c.last_sign_in_at,
    coalesce(c.venue_count, 0), coalesce(c.event_count, 0),
    case
      when c.revoked_at is not null then 'revoked'
      when coalesce(c.event_count, 0) > 0 then 'first_event'
      when coalesce(c.venue_count, 0) > 0 then 'company_created'
      when c.confirmed_at is not null then 'signed_in'
      else 'invited'
    end as stage
  from counted c
  left join public.user_profiles p on p.id = c.invited_by
  order by c.created_at desc;
$$;

comment on function public.platform_invite_overview() is
  'Per-invite open-beta funnel state for platform admins. SECURITY DEFINER '
  'because it reads auth.users.confirmed_at; returns zero rows for anyone who '
  'is not a platform admin.';

revoke execute on function public.platform_invite_overview()
  from public, anon, service_role;
grant execute on function public.platform_invite_overview() to authenticated;

create or replace function public.platform_invite_funnel()
returns table (stage text, invite_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select o.stage, count(*)::integer
  from public.platform_invite_overview() o
  group by o.stage
  order by o.stage;
$$;

comment on function public.platform_invite_funnel() is
  'GROUP BY roll-up of platform_invite_overview(): one row per funnel stage. '
  'Aggregated in the database, never counted client-side.';

revoke execute on function public.platform_invite_funnel()
  from public, anon, service_role;
grant execute on function public.platform_invite_funnel() to authenticated;
