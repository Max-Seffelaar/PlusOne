-- MFA fully optional — drop the AAL2 requirement from the remaining sensitive
-- actions (decision refinement on #20, 2026-07-02; T1 PR c, ClickUp 86ey4j1dz).
--
-- Before (20260624160000): MFA enrollment was MANDATORY for admin/finance and
-- AAL2 was still required in RLS for the "grant / destroy access" actions
-- (invite, revoke-invite, member add/change/remove, remote-logout).
--
-- After: MFA is a RECOMMENDATION for every role. No hard gate anywhere — the
-- pilot feedback was that forced MFA causes enough friction to lose customers,
-- and Max explicitly accepted the security trade-off (1/7 review). The venue
-- role checks below remain the security boundary (RLS, #1); the second-factor
-- requirement is dropped:
--   • invite a teammate              (invites_insert        — role-only now)
--   • revoke a pending invite        (invites_delete        — role-only now)
--   • add / change-roles / remove a member
--                                    (venue_memberships_*   — role-only now)
--   • list / remote-logout another user's sessions
--                                    (admin_list_user_sessions /
--                                     admin_revoke_session  — role-only now)
--
-- The app nudges instead: a recommendation screen with "Ask me in 7 days" /
-- "Don't ask again", tracked per user in user_profiles.mfa_snooze_until.
-- is_aal2() and current_user_requires_mfa() stay defined (the latter now drives
-- the *recommendation*, not a gate).

-- ── Invites — role-only (escalation + event-scope guards unchanged) ──────────
-- Recreated from 20260622120000_invite_event_scopes.sql minus is_aal2().
drop policy invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and invited_by = (select auth.uid())
    and accepted_at is null
    and expires_at > now()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
    -- Event-organizer scope is admin-only (mirrors assignOrganizer).
    and (
      cardinality(event_ids) = 0
      or public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    )
  );

-- Recreated from 20260613190000_auth_invites_sessions.sql minus is_aal2().
alter policy invites_delete on public.invites
  using (
    accepted_at is null
    and public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

-- ── Memberships — role-only (escalation guard unchanged) ─────────────────────
alter policy venue_memberships_insert on public.venue_memberships
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

alter policy venue_memberships_update on public.venue_memberships
  using (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  )
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

alter policy venue_memberships_delete on public.venue_memberships
  using (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

-- ── Session RPCs — admin-at-a-shared-venue, role-only ────────────────────────
-- Recreated from 20260613190000_auth_invites_sessions.sql minus the AAL2 check.
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

-- ── MFA-recommendation snooze ─────────────────────────────────────────────────
-- null = never decided (recommend on next app entry, for roles where we advise
-- it); a timestamp = ask again after that moment; far-future = don't ask again.
alter table public.user_profiles
  add column mfa_snooze_until timestamptz;

comment on column public.user_profiles.mfa_snooze_until is
  'MFA-recommendation snooze (#20, optional-MFA refinement 2026-07-02): null = not yet decided, timestamp = ask again after it, far-future (9999) = don''t ask again. Self-written via user_profiles_update_self.';
