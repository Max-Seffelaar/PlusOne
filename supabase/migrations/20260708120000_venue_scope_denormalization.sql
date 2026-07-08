-- SCALE-5 / K8 / FE-3 — denormalize venue_id onto guests, guest_requests,
-- quota_requests, guest_tiers; add a GROUP BY headcount RPC.
--
-- WHY (ClickUp 86ey6yaph / 86ey6xfd9 / 86ey6yphp, perf-scale-audit-megaevent.md
-- §SCALE-5). The venue-wide reads (Home/Guests/Requests) pass EVERY event id of
-- a venue into a PostgREST `.in('event_id', […])`. The URL grows ~39 chars/event
-- and crosses Kong's ~8 KB URI limit at ~205 events → HTTP 414 → the read THROWS.
-- At "dozens of events/month" a venue crosses that line in 6-10 months, so every
-- active venue hard-fails within its first year on: the Home headcount tile
-- (fetchEventHeadcounts, K8), the All-Guests tab (fetchVenueGuests/
-- fetchVenueTiers), and the Requests inbox (fetchGuestRequests/
-- fetchQuotaRequests/fetchVenueRequestLinks — the last already had venue_id via
-- request_links, so only its usePoVenueLinks() plumbing needs to drop the
-- eventIds dependency in the app layer, no migration for that table).
--
-- FIX: give each table its own venue_id so every venue-wide read sends ONE id,
-- never a list — exactly the shape check_ins/refusals already got in
-- 20260622140000_checkin_event_scope.sql (the precedent this migration mirrors:
-- nullable column -> backfill -> NOT NULL -> index -> BEFORE-trigger fills it
-- from event_id going forward -> SELECT policies rewritten to use it directly).
--
-- guest_tiers gets the same column (fetchVenueTiers has the identical .in(ids)
-- shape) even though it isn't in the SCALE-5 title, because FE-3 explicitly folds
-- the guests/tiers venue-scope fix together (same shape, same fetch pattern).
--
-- event_organizers is NOT touched here: fetchVenueCrew/fetchAssignableCrew
-- already use an `events!inner(venue_id)` embed filter (no id-list, no 414 risk)
-- — that pattern predates this migration and needs no change.
--
-- Per the P1 precedent, only SELECT policies are rewritten. INSERT/UPDATE
-- policies key off a single client-supplied event_id and run once per write, not
-- once per row of a read — they are neither the URL-length nor the RLS-cost
-- problem this migration fixes, so they are left exactly as-is (event_venue()
-- indirection and all).

-- ── columns (nullable first, so the backfill can populate them) ──────────────
alter table public.guests
  add column venue_id uuid references public.venues (id) on delete restrict;

alter table public.guest_requests
  add column venue_id uuid references public.venues (id) on delete restrict;

alter table public.quota_requests
  add column venue_id uuid references public.venues (id) on delete restrict;

alter table public.guest_tiers
  add column venue_id uuid references public.venues (id) on delete restrict;

-- ── backfill from the row's event ────────────────────────────────────────────
update public.guests g
   set venue_id = e.venue_id
  from public.events e
 where e.id = g.event_id
   and g.venue_id is null;

update public.guest_requests r
   set venue_id = e.venue_id
  from public.events e
 where e.id = r.event_id
   and r.venue_id is null;

update public.quota_requests q
   set venue_id = e.venue_id
  from public.events e
 where e.id = q.event_id
   and q.venue_id is null;

update public.guest_tiers t
   set venue_id = e.venue_id
  from public.events e
 where e.id = t.event_id
   and t.venue_id is null;

-- ── lock them down once populated ────────────────────────────────────────────
alter table public.guests alter column venue_id set not null;
alter table public.guest_requests alter column venue_id set not null;
alter table public.quota_requests alter column venue_id set not null;
alter table public.guest_tiers alter column venue_id set not null;

-- Backs both the rewritten SELECT policies below and the new headcount RPC.
create index guests_venue_id_idx on public.guests (venue_id);
create index guest_requests_venue_id_idx on public.guest_requests (venue_id);
create index quota_requests_venue_id_idx on public.quota_requests (venue_id);
create index guest_tiers_venue_id_idx on public.guest_tiers (venue_id);

-- ── keep it correct going forward (BEFORE INSERT/UPDATE) ─────────────────────
-- One shared function serves all four tables (all carry event_id already);
-- fills venue_id only when absent, so it's idempotent on retry/replay and a
-- no-op on later updates. SECURITY DEFINER + pinned search_path so it can read
-- events past RLS regardless of the caller's own event/venue visibility.
create or replace function public.set_event_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.venue_id is null then
    select e.venue_id into new.venue_id
      from public.events e
     where e.id = new.event_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_event_scope() from public, anon;

create trigger guests_set_scope
  before insert or update on public.guests
  for each row execute function public.set_event_scope();

create trigger guest_requests_set_scope
  before insert or update on public.guest_requests
  for each row execute function public.set_event_scope();

create trigger quota_requests_set_scope
  before insert or update on public.quota_requests
  for each row execute function public.set_event_scope();

create trigger guest_tiers_set_scope
  before insert or update on public.guest_tiers
  for each row execute function public.set_event_scope();

-- ── lighter SELECT policies (drop the event_venue(event_id) indirection) ────
drop policy guests_select on public.guests;
create policy guests_select on public.guests
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance,doorhost}'::public.venue_role[])
    or public.is_event_organizer(event_id)
    or (
      public.has_venue_role(venue_id, '{staff}'::public.venue_role[])
      and added_by = (select auth.uid())
    )
  );

drop policy guest_requests_select on public.guest_requests;
create policy guest_requests_select on public.guest_requests
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

drop policy quota_requests_select on public.quota_requests;
create policy quota_requests_select on public.quota_requests
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
  );

drop policy guest_tiers_select on public.guest_tiers;
create policy guest_tiers_select on public.guest_tiers
  for select to authenticated
  using (
    public.is_venue_member(venue_id)
    or public.is_event_organizer(event_id)
  );

-- ── K8: GROUP BY headcount RPC (one row per event, not one row per guest) ───
-- Deliberately SECURITY INVOKER (no `security definer`): it must run under the
-- CALLER's own guests_select visibility, not a blanket bypass — a staff member
-- only ever sees their own added guests, so their headcount tile must stay
-- scoped to those rows too, exactly like the row-by-row read it replaces. Every
-- reference is schema-qualified, so an unset search_path is safe here.
-- Unbounded by event status ON PURPOSE: the Events tab shows registered/present
-- on past (closed) events too, so bounding to "non-closed" would blank their
-- cards — a regression. This still fully resolves K8 (aggregation happens in
-- the database — one row per event, never one row per guest) and SCALE-5 (one
-- venue_id, never an event-id list).
create or replace function public.venue_event_headcounts(p_venue_id uuid)
returns table (event_id uuid, registered integer, present integer)
language sql
stable
set search_path = ''
as $$
  select
    g.event_id,
    coalesce(sum(1 + g.plus_ones) filter (where g.status in ('approved', 'checked_in')), 0)::int as registered,
    coalesce(sum(1 + g.plus_ones) filter (where g.status = 'checked_in'), 0)::int as present
  from public.guests g
  where g.venue_id = p_venue_id
  group by g.event_id;
$$;

revoke execute on function public.venue_event_headcounts(uuid) from public, anon;
grant execute on function public.venue_event_headcounts(uuid) to authenticated, service_role;
