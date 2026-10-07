-- Crew invites (z8uq9m2yvp, onboarding okt 2026 task 0d; decision Max 2026-10-07).
--
-- External crew (#6/#24) is now ALWAYS added through an open invite that the
-- person accepts, for a new and an existing account alike. Max's privacy rule:
-- "Data only becomes visible once it has been filled in, the user has been
-- added and the invite has been accepted." Before this migration
-- inviteExternalCrew wrote event_organizers straight away, and that row opens
-- the target's whole profile to the inviting company (can_view_profile,
-- organizer leg) — for ANY account whose e-mail an admin of ANY company typed
-- (review of PR #412, reproduced). Now nothing changes for the target until
-- they accept; the server never resolves an account id from an e-mail.
--
-- 1. invites can be crew-only: no venue roles, exactly ONE event (one row per
--    event, so the pending-unique key below is per event), plus an optional
--    per-event guest quota (crew_quota). Team invites are unchanged.
-- 2. invites_insert: a crew-only invite is an admin grant (already true for any
--    non-empty event_ids), and its event must belong to the invite's venue.
-- 3. Acceptance. accept_pending_invites() is the LOGIN path (/auth/callback,
--    /auth/confirm, dev-login, consent): it accepts team invites as before, but
--    crew invites only for a FRESH account (no user_profiles row before this
--    call, i.e. nothing the user filled in exists yet). Otherwise an existing
--    user who simply logs in would accept an invite they never saw, which is
--    the leak above with one extra step. Existing accounts accept crew invites
--    explicitly through the banner: accept_my_invites().
--    Per crew invite: no venue membership; an event_organizers row for the one
--    event (if it still belongs to the invite's venue); the guest quota only
--    when that row is NEW (already crew = quota untouched); and nothing at all
--    when the user is a member of that venue (a team member never becomes crew
--    of their own company's event through an invite — review should-fix).
-- 4. my_pending_invites(): what the banner shows — company name, roles and, for
--    crew, the event name — for the caller's own open invites only. The invitee
--    has no read on venues/events of a company they are not in yet.
--
-- Grant matrix: no new table or view. The new column crew_quota is covered by
-- the existing TABLE-level grants on public.invites (select, insert, delete to
-- authenticated; update only on expires_at). Functions: revoke from public/anon,
-- then grant execute to authenticated for the two callable entry points; the
-- internal worker is not executable by any app role.

-- ── 1. Columns + constraints ────────────────────────────────────────────────

alter table public.invites
  add column crew_quota integer;

comment on column public.invites.crew_quota is
  'Crew-only invites (no roles, one event): the per-event guest quota written to event_quotas.quota_override on acceptance, only when the event_organizers row is new. Null = none.';

alter table public.invites drop constraint invites_roles_check;
alter table public.invites
  add constraint invites_roles_or_crew_check check (
    cardinality(roles) >= 1
    or cardinality(event_ids) = 1
  ),
  add constraint invites_crew_quota_check check (
    crew_quota is null
    or (cardinality(roles) = 0 and crew_quota between 0 and 9999)
  );

-- One open TEAM invite per (venue, e-mail), as before; one open CREW invite per
-- (venue, e-mail, event). Re-inviting someone for the same event hits 23505,
-- which the action turns into a resend (expiry bump), never a quota change.
drop index public.invites_pending_unique;
create unique index invites_pending_unique
  on public.invites (venue_id, lower(email))
  where accepted_at is null and cardinality(roles) > 0;
create unique index invites_pending_crew_unique
  on public.invites (venue_id, lower(email), (event_ids[1]))
  where accepted_at is null and cardinality(roles) = 0;

-- ── 2. Insert policy ────────────────────────────────────────────────────────
-- Recreated from 20260702120000_mfa_fully_optional.sql; added: a crew invite's
-- event belongs to the invite's venue (it must never point at another company's
-- event; acceptance filters again), and crew_quota is admin-only.
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
    -- Event-organizer scope (team invite with events, or a crew-only invite)
    -- and a crew quota are admin-only (mirrors assignOrganizer).
    and (
      (cardinality(event_ids) = 0 and crew_quota is null)
      or public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    )
    -- A crew-only invite's event must belong to the invite's venue. (A team
    -- invite's event ids keep the existing behaviour: cross-venue ids are
    -- filtered at acceptance, auth.invites.test.sql G2/G5.)
    and (
      cardinality(roles) > 0
      or exists (
        select 1 from public.events e
        where e.id = event_ids[1] and e.venue_id = invites.venue_id
      )
    )
  );

-- ── 3. Acceptance ───────────────────────────────────────────────────────────

create function public.accept_invites_for_caller(p_include_crew boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_fresh boolean;
  v_count integer := 0;
  v_new_crew uuid;
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

  -- A fresh account has no profile yet: nothing the user filled in exists, so
  -- accepting a crew invite at its first login exposes nothing (see header).
  v_fresh := not exists (select 1 from public.user_profiles p where p.id = v_uid);

  -- Profile is owned by the user (decision #24); create it on first acceptance.
  insert into public.user_profiles (id, full_name, email)
  values (v_uid, v_full_name, v_email)
  on conflict (id) do nothing;

  -- Team invites first, so a membership granted in this same call already
  -- counts for the crew check below.
  for r in
    select i.id, i.venue_id, i.roles, i.default_quota, i.event_ids, i.crew_quota
    from public.invites i
    where i.accepted_at is null
      and i.expires_at > now()
      and lower(i.email) = v_email
    order by cardinality(i.roles) desc, i.created_at
    for update
  loop
    if cardinality(r.roles) > 0 then
      -- ── Team invite: unchanged from 20260622120000_invite_event_scopes.sql ──
      insert into public.venue_memberships as vm (venue_id, user_id, roles)
      values (r.venue_id, v_uid, r.roles)
      on conflict (venue_id, user_id) do update
        set roles = (
          select array(
            select distinct e
            from unnest(vm.roles || excluded.roles) as e
          )::public.venue_role[]
        );

      if r.default_quota is not null then
        insert into public.quotas (venue_id, user_id, default_count)
        values (r.venue_id, v_uid, r.default_quota)
        on conflict (venue_id, user_id) do nothing;
      end if;

      insert into public.event_organizers (event_id, user_id)
      select e.id, v_uid
      from unnest(r.event_ids) as eid
      join public.events e on e.id = eid and e.venue_id = r.venue_id
      on conflict (event_id, user_id) do nothing;
    else
      -- ── Crew-only invite ──
      -- Login path, existing account: leave it open for the banner.
      if not p_include_crew and not v_fresh then
        continue;
      end if;

      -- A member of this company never becomes crew through an invite; the
      -- invite is consumed without effect.
      if not exists (
        select 1 from public.venue_memberships m
        where m.venue_id = r.venue_id and m.user_id = v_uid
      ) then
        v_new_crew := null;
        insert into public.event_organizers (event_id, user_id)
        select e.id, v_uid
        from public.events e
        where e.id = r.event_ids[1] and e.venue_id = r.venue_id
        on conflict (event_id, user_id) do nothing
        returning event_id into v_new_crew;

        -- Quota only for a NEW crew row: already crew = quota untouched, and
        -- an existing quota row is never overwritten either.
        if v_new_crew is not null and r.crew_quota is not null then
          insert into public.event_quotas (event_id, user_id, quota_override)
          values (v_new_crew, v_uid, r.crew_quota)
          on conflict (event_id, user_id) do nothing;
        end if;
      end if;
    end if;

    update public.invites
      set accepted_at = now(), accepted_by = v_uid
      where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.accept_invites_for_caller(boolean) is
  'Internal worker for accept_pending_invites() (login path: crew invites only for a fresh account) and accept_my_invites() (explicit banner accept: everything). Acts only on the caller''s own open invites (auth.uid()). Not executable by app roles.';

create or replace function public.accept_pending_invites()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.accept_invites_for_caller(false);
$$;

comment on function public.accept_pending_invites() is
  'Login path (callback, confirm, dev-login, consent): accepts the caller''s open team invites, and crew invites only for a fresh account. Existing accounts accept crew invites via accept_my_invites() (banner). z8uq9m2yvp.';

create function public.accept_my_invites()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.accept_invites_for_caller(true);
$$;

comment on function public.accept_my_invites() is
  'Explicit accept (the incoming-invite banner): every open invite addressed to the caller, crew invites included. z8uq9m2yvp.';

-- ── 4. Banner read ──────────────────────────────────────────────────────────

create function public.my_pending_invites()
returns table (
  id uuid,
  company_name text,
  roles public.venue_role[],
  event_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, v.name, i.roles, ev.name, i.created_at
  from public.invites i
  join auth.users u on u.id = auth.uid()
  join public.venues v on v.id = i.venue_id
  left join public.events ev
    on cardinality(i.roles) = 0 and ev.id = i.event_ids[1] and ev.venue_id = i.venue_id
  where i.accepted_at is null
    and i.expires_at > now()
    and lower(i.email) = lower(u.email)
    -- A crew invite to the caller's own company is a no-op on accept: don't show it.
    and not (
      cardinality(i.roles) = 0
      and exists (
        select 1 from public.venue_memberships m
        where m.venue_id = i.venue_id and m.user_id = auth.uid()
      )
    )
  order by i.created_at desc;
$$;

comment on function public.my_pending_invites() is
  'The incoming-invite banner: the caller''s OWN open, unexpired invites (matched on their auth.users e-mail) with only the company name, roles and, for crew, the event name. No other venue/event field. z8uq9m2yvp.';

-- ── Function grants ─────────────────────────────────────────────────────────
-- (The existing grant on accept_pending_invites() survives CREATE OR REPLACE.)
revoke execute on function public.accept_invites_for_caller(boolean) from public, anon, authenticated;
revoke execute on function public.accept_my_invites() from public, anon;
revoke execute on function public.my_pending_invites() from public, anon;
grant execute on function public.accept_my_invites() to authenticated;
grant execute on function public.my_pending_invites() to authenticated;
