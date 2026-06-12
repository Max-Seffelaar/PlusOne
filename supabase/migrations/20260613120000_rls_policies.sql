-- Fase 2 — RLS-policies: the role matrix (spec §2) enforced in the database.
--
-- Design notes:
--   * Helper functions are SECURITY DEFINER so policies can consult
--     venue_memberships / events / event_organizers without RLS recursion.
--     They are STABLE, pin search_path, and are executable by authenticated
--     and service_role only.
--   * Every policy is granted to `authenticated` explicitly; the only anon
--     surface is the landing page (read an active event, file a request).
--   * AAL2 (MFA) is required for quota grants, role changes and audit-log
--     access (CLAUDE.md §Auth).
--   * List lock (#23): when events.list_locked, staff lose guest mutations;
--     admin, organizer and doorhost keep them. Closed events: only admin
--     mutates guests; organizer keeps read access for reports (the §2 note
--     "toegang vervalt zodra het event is afgesloten" is interpreted as
--     write access — read access is needed for the organizer's reporting
--     capability in the matrix).
--   * Quota math (#22) and audit triggers (#4) are NOT here — next phase.
--     RLS scopes who may touch rows; quota limits come on top via triggers.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- True when the current session is MFA-verified (AAL2).
create or replace function public.is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Membership at a venue, any role.
create or replace function public.is_venue_member(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venue_memberships m
    where m.venue_id = p_venue_id and m.user_id = auth.uid()
  );
$$;

-- Membership at a venue holding at least one of the given roles.
create or replace function public.has_venue_role(p_venue_id uuid, p_roles public.venue_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venue_memberships m
    where m.venue_id = p_venue_id
      and m.user_id = auth.uid()
      and m.roles && p_roles
  );
$$;

create or replace function public.is_event_organizer(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_organizers eo
    where eo.event_id = p_event_id and eo.user_id = auth.uid()
  );
$$;

create or replace function public.event_venue(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.venue_id from public.events e where e.id = p_event_id;
$$;

create or replace function public.guest_event(p_guest_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.event_id from public.guests g where g.id = p_guest_id;
$$;

-- Organizer scope grants visibility of the venue the event belongs to.
create or replace function public.organizes_event_at_venue(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_organizers eo
    join public.events e on e.id = eo.event_id
    where e.venue_id = p_venue_id and eo.user_id = auth.uid()
  );
$$;

-- A profile is visible to yourself and to anyone you share a venue or an
-- event scope with (member lists, "toegevoegd door"-names, organizer names).
create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = auth.uid()
    or exists (
      select 1
      from public.venue_memberships a
      join public.venue_memberships b on b.venue_id = a.venue_id
      where a.user_id = auth.uid() and b.user_id = p_profile_id
    )
    or exists (
      select 1
      from public.event_organizers eo
      join public.events e on e.id = eo.event_id
      join public.venue_memberships m on m.venue_id = e.venue_id
      where (eo.user_id = p_profile_id and m.user_id = auth.uid())
         or (eo.user_id = auth.uid() and m.user_id = p_profile_id)
    )
    or exists (
      select 1
      from public.event_organizers a
      join public.event_organizers b on b.event_id = a.event_id
      where a.user_id = auth.uid() and b.user_id = p_profile_id
    );
$$;

-- Guest-mutation gate per decision #23 (+ closed-event interpretation above):
--   closed  -> admin only
--   locked  -> admin, organizer, doorhost
--   open    -> admin, organizer, doorhost, staff
create or replace function public.can_write_guests(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.id is null then false
    when public.has_venue_role(e.venue_id, '{admin}'::public.venue_role[]) then true
    when e.status = 'closed' then false
    when public.is_event_organizer(e.id) then true
    when public.has_venue_role(e.venue_id, '{doorhost}'::public.venue_role[]) then true
    when e.list_locked then false
    else public.has_venue_role(e.venue_id, '{staff}'::public.venue_role[])
  end
  from public.events e
  where e.id = p_event_id;
$$;

-- Check-in/refusal gate: door roles only, while the event can receive guests.
create or replace function public.can_check_in(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select e.status in ('open', 'live')
    and (
      public.has_venue_role(e.venue_id, '{admin,doorhost}'::public.venue_role[])
      or public.is_event_organizer(e.id)
    )
  from public.events e
  where e.id = p_event_id;
$$;

revoke execute on function
  public.is_aal2(),
  public.is_venue_member(uuid),
  public.has_venue_role(uuid, public.venue_role[]),
  public.is_event_organizer(uuid),
  public.event_venue(uuid),
  public.guest_event(uuid),
  public.organizes_event_at_venue(uuid),
  public.can_view_profile(uuid),
  public.can_write_guests(uuid),
  public.can_check_in(uuid)
from public, anon;

grant execute on function
  public.is_aal2(),
  public.is_venue_member(uuid),
  public.has_venue_role(uuid, public.venue_role[]),
  public.is_event_organizer(uuid),
  public.event_venue(uuid),
  public.guest_event(uuid),
  public.organizes_event_at_venue(uuid),
  public.can_view_profile(uuid),
  public.can_write_guests(uuid),
  public.can_check_in(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- user_profiles — decision #24: only the user touches their own profile
-- ---------------------------------------------------------------------------

create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (public.can_view_profile(id));

create policy user_profiles_insert_self on public.user_profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------

create policy venues_select_member on public.venues
  for select to authenticated
  using (public.is_venue_member(id) or public.organizes_event_at_venue(id));

create policy venues_update_admin on public.venues
  for update to authenticated
  using (public.has_venue_role(id, '{admin}'::public.venue_role[]))
  with check (public.has_venue_role(id, '{admin}'::public.venue_role[]));

-- Venue creation stays server-side (service_role) during onboarding.

-- ---------------------------------------------------------------------------
-- venue_memberships — role changes need AAL2; a user_manager can never
-- grant, modify or remove admin memberships (escalation guard, #3/#8)
-- ---------------------------------------------------------------------------

create policy venue_memberships_select on public.venue_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_venue_role(venue_id, '{admin,user_manager,finance}'::public.venue_role[])
  );

create policy venue_memberships_insert on public.venue_memberships
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and public.is_aal2()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

create policy venue_memberships_update on public.venue_memberships
  for update to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and public.is_aal2()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  )
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and public.is_aal2()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

create policy venue_memberships_delete on public.venue_memberships
  for delete to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and public.is_aal2()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

-- ---------------------------------------------------------------------------
-- events — members see their venue's events; the landing page exposes an
-- event publicly only while landing_active (#12/#28); lock/unlock is an
-- UPDATE by admin/organizer (#23)
-- ---------------------------------------------------------------------------

create policy events_select_member on public.events
  for select to authenticated
  using (public.is_venue_member(venue_id) or public.is_event_organizer(id));

create policy events_select_landing on public.events
  for select to anon, authenticated
  using (landing_active = true and status <> 'closed');

create policy events_insert_admin on public.events
  for insert to authenticated
  with check (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]));

create policy events_update_admin_organizer on public.events
  for update to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.is_event_organizer(id)
  )
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.is_event_organizer(id)
  );

-- The public surface of an event is a fixed column subset: anon can never
-- read venue_id, lock state or audit-ish fields.
revoke select on table public.events from anon;
grant select (id, name, starts_at, ends_at, landing_slug, landing_active, status)
  on table public.events to anon;

-- ---------------------------------------------------------------------------
-- event_organizers — assigning an organizer is an admin role-grant (AAL2)
-- ---------------------------------------------------------------------------

create policy event_organizers_select on public.event_organizers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_venue_member(public.event_venue(event_id))
  );

create policy event_organizers_insert_admin on public.event_organizers
  for insert to authenticated
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  );

create policy event_organizers_delete_admin on public.event_organizers
  for delete to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  );

-- ---------------------------------------------------------------------------
-- guest_tiers — admin + organizer of that event (§2)
-- ---------------------------------------------------------------------------

create policy guest_tiers_select on public.guest_tiers
  for select to authenticated
  using (
    public.is_venue_member(public.event_venue(event_id))
    or public.is_event_organizer(event_id)
  );

create policy guest_tiers_insert on public.guest_tiers
  for insert to authenticated
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

create policy guest_tiers_update on public.guest_tiers
  for update to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  )
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

create policy guest_tiers_delete on public.guest_tiers
  for delete to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

-- ---------------------------------------------------------------------------
-- guests — the heart of the matrix:
--   read:  admin/finance/doorhost venue-wide, organizer own event,
--          staff only their own guests
--   write: see can_write_guests() (#23); added_by is always the actor (#27);
--          anonymized rows are frozen for app roles (#29)
-- ---------------------------------------------------------------------------

create policy guests_select on public.guests
  for select to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin,finance,doorhost}'::public.venue_role[])
    or public.is_event_organizer(event_id)
    or (
      public.has_venue_role(public.event_venue(event_id), '{staff}'::public.venue_role[])
      and added_by = (select auth.uid())
    )
  );

create policy guests_insert on public.guests
  for insert to authenticated
  with check (
    public.can_write_guests(event_id)
    and added_by = (select auth.uid())
  );

create policy guests_update on public.guests
  for update to authenticated
  using (
    anonymized_at is null
    and public.can_write_guests(event_id)
    and (
      added_by = (select auth.uid())
      or public.has_venue_role(public.event_venue(event_id), '{admin,doorhost}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  )
  with check (
    anonymized_at is null
    and public.can_write_guests(event_id)
    and (
      added_by = (select auth.uid())
      or public.has_venue_role(public.event_venue(event_id), '{admin,doorhost}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  );

-- ---------------------------------------------------------------------------
-- guest_requests — public INSERT while the landing link is active (#12/#28);
-- deciding is admin/organizer; a decision always carries the actor
-- ---------------------------------------------------------------------------

create policy guest_requests_select on public.guest_requests
  for select to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin,finance}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

create policy guest_requests_insert_public on public.guest_requests
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.landing_active and e.status <> 'closed'
    )
  );

create policy guest_requests_decide on public.guest_requests
  for update to authenticated
  using (
    status = 'pending'
    and (
      public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  )
  with check (
    decided_by = (select auth.uid())
    and (
      public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  );

-- ---------------------------------------------------------------------------
-- quotas / event_quotas — staff see their own numbers ("8 van 10 over", #17);
-- granting/changing quota is admin-only and needs AAL2
-- ---------------------------------------------------------------------------

create policy quotas_select on public.quotas
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
  );

create policy quotas_insert_admin on public.quotas
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[]) and public.is_aal2()
  );

create policy quotas_update_admin on public.quotas
  for update to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[]) and public.is_aal2()
  )
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[]) and public.is_aal2()
  );

create policy quotas_delete_admin on public.quotas
  for delete to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[]) and public.is_aal2()
  );

create policy event_quotas_select on public.event_quotas
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_venue_role(public.event_venue(event_id), '{admin,finance}'::public.venue_role[])
  );

create policy event_quotas_insert_admin on public.event_quotas
  for insert to authenticated
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  );

create policy event_quotas_update_admin on public.event_quotas
  for update to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  )
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  );

create policy event_quotas_delete_admin on public.event_quotas
  for delete to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  );

-- ---------------------------------------------------------------------------
-- quota_requests — staff file their own request (#5); admin decides (AAL2);
-- a request can only be decided once (USING pins status = 'pending')
-- ---------------------------------------------------------------------------

create policy quota_requests_select on public.quota_requests
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_venue_role(public.event_venue(event_id), '{admin,finance}'::public.venue_role[])
  );

create policy quota_requests_insert_own on public.quota_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and public.is_venue_member(public.event_venue(event_id))
  );

create policy quota_requests_decide_admin on public.quota_requests
  for update to authenticated
  using (
    status = 'pending'
    and public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  )
  with check (
    decided_by = (select auth.uid())
    and public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and public.is_aal2()
  );

-- ---------------------------------------------------------------------------
-- check_ins / refusals — door roles only (#10); the actor is always the
-- session user; staff have no visibility (#17)
-- ---------------------------------------------------------------------------

create policy check_ins_select on public.check_ins
  for select to authenticated
  using (
    public.has_venue_role(public.event_venue(public.guest_event(guest_id)), '{admin,finance,doorhost}'::public.venue_role[])
    or public.is_event_organizer(public.guest_event(guest_id))
  );

create policy check_ins_insert on public.check_ins
  for insert to authenticated
  with check (
    checked_by = (select auth.uid())
    and public.can_check_in(public.guest_event(guest_id))
  );

create policy check_ins_update_own_device on public.check_ins
  for update to authenticated
  using (checked_by = (select auth.uid()))
  with check (checked_by = (select auth.uid()));

create policy refusals_select on public.refusals
  for select to authenticated
  using (
    public.has_venue_role(public.event_venue(public.guest_event(guest_id)), '{admin,finance,doorhost}'::public.venue_role[])
    or public.is_event_organizer(public.guest_event(guest_id))
  );

create policy refusals_insert on public.refusals
  for insert to authenticated
  with check (
    refused_by = (select auth.uid())
    and public.can_check_in(public.guest_event(guest_id))
  );

-- ---------------------------------------------------------------------------
-- audit_log — admin + finance, read-only, AAL2 (CLAUDE.md §Auth). The
-- per-guest "logboek" at the door (#39) is served from guests/check_ins
-- data the door roles already see, not from this table.
-- ---------------------------------------------------------------------------

create policy audit_log_select_aal2 on public.audit_log
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
    and public.is_aal2()
  );

-- ---------------------------------------------------------------------------
-- subscriptions — every member may read the venue's entitlement (#32);
-- writes happen exclusively via the billing webhook (service_role)
-- ---------------------------------------------------------------------------

create policy subscriptions_select_member on public.subscriptions
  for select to authenticated
  using (public.is_venue_member(venue_id));
