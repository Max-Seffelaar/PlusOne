-- Fase 4 — Auth-laag: invites, sessiebeheer-RPC's en profiel-hardening.
-- Spec: gastenlijst-app-spec.md §5 + beslissingen #20/#24, CLAUDE.md §Auth.
--
-- Scope of this migration (the DB side of the auth layer):
--   * public.invites — invite-only account provisioning (decision #20). An
--     admin/user_manager files an invite; acceptance = the invitee's first OTP
--     login, which provisions their profile + membership.
--   * public.accept_pending_invites() — SECURITY DEFINER: runs as the logged-in
--     invitee, creates user_profile + venue_membership(s) from their pending,
--     unexpired invites. The ONLY path that turns an invite into access.
--   * public.current_user_requires_mfa() — true when the caller holds admin or
--     finance anywhere (CLAUDE.md: MFA mandatory for those roles). The app layer
--     uses it to force enrollment; RLS already enforces AAL2 on the actions.
--   * Session-management RPC's over auth.sessions (spec §5 "Sessiebeheer-scherm
--     voor Admins ... remote logout"): list/revoke own sessions, and the admin
--     variants guarded by admin-role-at-a-shared-venue + AAL2.
--   * auth.users e-mail-change → user_profiles.email sync trigger, plus a
--     column-grant so authenticated may only ever change full_name directly:
--     e-mail changes exclusively through Supabase Auth's confirmed flow,
--     never a raw profile UPDATE (decision #24).
--   * Audit trigger on invites (re-uses the generic fase-3 audit_trigger).
--
-- Follows the fase-1 rule: every privilege is granted explicitly so local and
-- hosted behave identically (see memory: local Supabase grants nothing by
-- default). Helper functions pin search_path and, where they read across
-- memberships/auth, are SECURITY DEFINER like the fase-2 helpers.

-- ---------------------------------------------------------------------------
-- invites
-- ---------------------------------------------------------------------------

create table public.invites (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  -- Stored as entered; all matching is case-insensitive via lower().
  email text not null,
  roles public.venue_role[] not null check (array_length(roles, 1) >= 1),
  invited_by uuid not null references public.user_profiles (id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.user_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Accepted invites always record who accepted; pending ones never do.
  check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  )
);

-- One open invite per (venue, e-mail); accepted invites no longer constrain,
-- so an email can be re-invited later (decision #24: independent of venue).
create unique index invites_pending_unique
  on public.invites (venue_id, lower(email))
  where accepted_at is null;

-- Invitee lookup at acceptance time is by lowercased e-mail.
create index invites_email_idx on public.invites (lower(email));
create index invites_venue_id_idx on public.invites (venue_id);

alter table public.invites enable row level security;

-- ---------------------------------------------------------------------------
-- Helper: does the current user hold a role that mandates MFA?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read venue_memberships without an RLS recursion;
-- mirrors the fase-2 helper style.

create or replace function public.current_user_requires_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venue_memberships m
    where m.user_id = auth.uid()
      and m.roles && '{admin,finance}'::public.venue_role[]
  );
$$;

-- ---------------------------------------------------------------------------
-- accept_pending_invites(): provision profile + membership for the invitee
-- ---------------------------------------------------------------------------
-- Runs as the logged-in user (auth.uid()). SECURITY DEFINER because the
-- invitee themselves may not INSERT a venue_membership under RLS — only an
-- admin/user_manager may. The escalation guard and AAL2 were already enforced
-- when the invite row was created (see invites_insert), so acceptance trusts
-- the roles captured there. Idempotent: re-running merges roles and accepts
-- only still-pending, unexpired invites.

create or replace function public.accept_pending_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_count integer := 0;
  r record;
begin
  if v_uid is null then
    return 0;
  end if;

  select lower(u.email), coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email)
    into v_email, v_full_name
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    return 0;
  end if;

  -- Profile is owned by the user (decision #24); create it on first acceptance.
  insert into public.user_profiles (id, full_name, email)
  values (v_uid, v_full_name, v_email)
  on conflict (id) do nothing;

  for r in
    select i.id, i.venue_id, i.roles
    from public.invites i
    where i.accepted_at is null
      and i.expires_at > now()
      and lower(i.email) = v_email
    for update
  loop
    insert into public.venue_memberships as vm (venue_id, user_id, roles)
    values (r.venue_id, v_uid, r.roles)
    on conflict (venue_id, user_id) do update
      set roles = (
        select array(
          select distinct e
          from unnest(vm.roles || excluded.roles) as e
        )::public.venue_role[]
      );

    update public.invites
      set accepted_at = now(), accepted_by = v_uid
      where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Session management over auth.sessions (spec §5)
-- ---------------------------------------------------------------------------
-- PostgREST never exposes the auth schema, so the app reaches sessions through
-- these SECURITY DEFINER RPC's (owned by the migration role, which can read
-- auth.*). Each one re-derives the caller from auth.uid() and authorizes in
-- the body — the client only ever holds the anon/authenticated key.

-- Your own sessions (profile screen): never needs elevation beyond reading
-- auth.sessions, which the definer can do.
create or replace function public.list_own_sessions()
returns table (
  session_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  not_after timestamptz,
  user_agent text,
  ip text,
  aal text,
  is_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.created_at,
    s.updated_at,
    s.not_after,
    s.user_agent,
    host(s.ip),
    s.aal::text,
    coalesce((auth.jwt() ->> 'session_id')::uuid = s.id, false)
  from auth.sessions s
  where s.user_id = auth.uid()
  order by s.updated_at desc;
$$;

create or replace function public.revoke_own_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions
  where id = p_session_id and user_id = auth.uid();
  return found;
end;
$$;

-- Admin view of another user's sessions. Authorized only when the caller is an
-- admin at a venue the target is also a member of, and the session is AAL2
-- (sensitive operation, CLAUDE.md §Auth). Errors with 42501 so the app shows a
-- generic "geen toegang".
create or replace function public.admin_list_user_sessions(p_target uuid)
returns table (
  session_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  not_after timestamptz,
  user_agent text,
  ip text,
  aal text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_aal2() then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.venue_memberships caller
    join public.venue_memberships target on target.venue_id = caller.venue_id
    where caller.user_id = auth.uid()
      and caller.roles @> '{admin}'::public.venue_role[]
      and target.user_id = p_target
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select
      s.id, s.created_at, s.updated_at, s.not_after,
      s.user_agent, host(s.ip), s.aal::text
    from auth.sessions s
    where s.user_id = p_target
    order by s.updated_at desc;
end;
$$;

create or replace function public.admin_revoke_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  if not public.is_aal2() then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;

  select user_id into v_target from auth.sessions where id = p_session_id;
  if v_target is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.venue_memberships caller
    join public.venue_memberships target on target.venue_id = caller.venue_id
    where caller.user_id = auth.uid()
      and caller.roles @> '{admin}'::public.venue_role[]
      and target.user_id = v_target
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from auth.sessions where id = p_session_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- auth.users e-mail change → user_profiles.email (decision #24)
-- ---------------------------------------------------------------------------
-- The user changes their e-mail exclusively through Supabase Auth (double
-- opt-in). When GoTrue commits the new address, mirror it into the profile.
-- SECURITY DEFINER so it may write the otherwise-locked email column.

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles
    set email = new.email
    where id = new.id and email is distinct from new.email;
  return new;
end;
$$;

create trigger sync_profile_email
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- Audit trigger on invites (re-uses the generic fase-3 trigger function)
-- ---------------------------------------------------------------------------
-- invites carries venue_id, so audit_trigger resolves venue scope via the
-- generic (else) branch: INSERT='create' (invite sent), UPDATE='update'
-- (accepted_at set on acceptance), DELETE='delete' (invite revoked).

create trigger audit_invites
  after insert or update or delete on public.invites
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- RLS — invites
-- ---------------------------------------------------------------------------

-- Read: venue managers see their venue's invites; an invitee sees invites
-- addressed to their own e-mail (drives the "accepteer uitnodiging"-banner).
create policy invites_select on public.invites
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,user_manager,finance}'::public.venue_role[])
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

-- Insert: admin/user_manager only, AAL2 (role grant is sensitive), the actor
-- is always invited_by, the invite must be pending and time-boxed, and a
-- user_manager can never grant an admin role (escalation guard, mirrors
-- venue_memberships_insert).
create policy invites_insert on public.invites
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and public.is_aal2()
    and invited_by = (select auth.uid())
    and accepted_at is null
    and expires_at > now()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

-- Cancel a pending invite: same authority and escalation guard as creating it.
-- Accepted invites are immutable history and cannot be deleted.
create policy invites_delete on public.invites
  for delete to authenticated
  using (
    accepted_at is null
    and public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and public.is_aal2()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

-- No UPDATE policy: acceptance is the only mutation and it runs through
-- accept_pending_invites() (definer), never a client UPDATE.

-- ---------------------------------------------------------------------------
-- Privileges — explicit, per the fase-1 pattern
-- ---------------------------------------------------------------------------

revoke all on table public.invites from anon, authenticated, service_role;
grant select, insert, delete on table public.invites to authenticated;
-- service_role bypasses RLS for documented server flows (none write invites
-- today; the invite row is written through the user-scoped client so RLS
-- applies). Keep DML available for future server-side maintenance.
grant select, insert, update, delete on table public.invites to service_role;

-- Note on profile e-mail (decision #24): identity lives in auth.users and all
-- authorization keys off auth.uid()/memberships, never user_profiles.email —
-- that column is a display mirror kept aligned by the sync_profile_email
-- trigger. A user can only ever UPDATE their OWN profile row (RLS
-- user_profiles_update_self) and the unique constraint blocks claiming another
-- address, so no column-level lockdown is needed; the profile-update action
-- only ever writes full_name and e-mail changes go through Supabase Auth's
-- confirmed flow.

-- Function execution: lock down, then grant the intended surface only.
revoke execute on function
  public.current_user_requires_mfa(),
  public.accept_pending_invites(),
  public.list_own_sessions(),
  public.revoke_own_session(uuid),
  public.admin_list_user_sessions(uuid),
  public.admin_revoke_session(uuid),
  public.sync_profile_email()
from public, anon;

grant execute on function
  public.current_user_requires_mfa(),
  public.accept_pending_invites(),
  public.list_own_sessions(),
  public.revoke_own_session(uuid),
  public.admin_list_user_sessions(uuid),
  public.admin_revoke_session(uuid)
to authenticated, service_role;

-- sync_profile_email is a trigger function only — no role needs EXECUTE at DML
-- time (the trigger fires as its owner); strip it from service_role too.
revoke execute on function public.sync_profile_email() from service_role;
