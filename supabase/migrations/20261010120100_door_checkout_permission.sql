-- Check-in D (z8uq9m2vg6) — undoing a check-in becomes role-dependent.
--
-- No new setting. Undo / check-out already exists as venues.allow_uncheck
-- (company default) + events.allow_uncheck (per-event override, NULL = inherit)
-- + the RESTRICTIVE policy check_ins_void_requires_uncheck (20260622000000),
-- which was role-agnostic: off meant nobody could undo, on meant every
-- door-capable user could. Decisions 2026-10-06 (§7 "Check-in", §9 loose end 16):
--
--   * admin and user_manager may ALWAYS undo, whatever the setting says;
--   * everyone else who can reach a check-in at all — doorhost, external crew /
--     organizer (event_organizers), staff — only while the effective setting is
--     on;
--   * platform admins follow has_venue_role (decision #49), so they count as
--     admin here like everywhere else.
--
-- "Who may update a check-in at all" is unchanged: check_ins_update_door
-- (can_check_in) and check_ins_update_own_device stay the permissive policies.
-- A pure user_manager or staff membership still has no door access, so for them
-- this is moot; it matters for a user_manager who also holds doorhost.
--
-- check_out_guest (20260810183000) is SECURITY INVOKER, so its void leg is
-- governed by this policy too — pgTAP proves it.
--
-- Default goes to false (decision "default false"). That CHANGES BEHAVIOUR for
-- existing companies: until now the column default was true and nobody had a
-- reason to touch it, so every company had door undo on for everyone. After
-- this migration every company starts with door undo OFF for doorhosts and crew;
-- admins and user managers keep it. An admin turns it back on in Company
-- settings → At the door. The backfill below runs as the migration owner, so the
-- audit trigger (audit_venues_allow_uncheck) records one 'update' per company
-- with a NULL actor = system. Per-event overrides (events.allow_uncheck) are
-- explicit choices and are left untouched.

-- ---------------------------------------------------------------------------
-- Who may undo a check-in at this event
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: it only combines two SECURITY DEFINER helpers that already
-- resolve the event/venue regardless of the caller's row visibility. Also
-- exposed to the door UI (one rpc call per snapshot) so the "Undo check-in"
-- button and the database answer the same question the same way; the database
-- stays the boundary. It reveals nothing new: event_allows_uncheck is already
-- executable by authenticated, and has_venue_role only answers for the caller.

create or replace function public.can_uncheck_check_in(p_event_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(public.event_allows_uncheck(p_event_id), false)
      or public.has_venue_role(public.event_venue(p_event_id), '{admin,user_manager}'::public.venue_role[]);
$$;

comment on function public.can_uncheck_check_in(uuid) is
  'True when the CURRENT user may undo (soft-void) a check-in at this event: always for admin / user_manager (and platform admins, via has_venue_role), otherwise only while the effective allow_uncheck setting is on. Used by the RESTRICTIVE check_ins_void_requires_uncheck policy and by the door UI (z8uq9m2vg6).';

revoke execute on function public.can_uncheck_check_in(uuid) from public, anon;
grant execute on function public.can_uncheck_check_in(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The policy: same shape, role-aware predicate
-- ---------------------------------------------------------------------------
-- Still constrains the RESULTING row: any update that leaves the row voided must
-- be allowed for this caller. Revive and top-ups on an active row always pass.

alter policy check_ins_void_requires_uncheck on public.check_ins
  with check (
    voided_at is null
    or public.can_uncheck_check_in(public.guest_event(guest_id))
  );

comment on policy check_ins_void_requires_uncheck on public.check_ins is
  'RESTRICTIVE: an update that leaves a check-in voided needs can_uncheck_check_in — admin/user_manager always, doorhost/crew/staff only while allow_uncheck is on for the event (z8uq9m2vg6).';

-- ---------------------------------------------------------------------------
-- Default false + backfill
-- ---------------------------------------------------------------------------

alter table public.venues
  alter column allow_uncheck set default false;

update public.venues
   set allow_uncheck = false
 where allow_uncheck;

comment on column public.venues.allow_uncheck is
  'Company-wide default: may doorhosts and crew undo a check-in (soft void, #3) at the door & cockpit? Admins and user managers always may (can_uncheck_check_in). Default false since z8uq9m2vg6. Overridable per event via events.allow_uncheck.';

comment on column public.events.allow_uncheck is
  'Per-event override for undoing check-ins by doorhosts and crew (soft void, #3). NULL inherits the company default (venues.allow_uncheck). Admins and user managers always may (can_uncheck_check_in).';
