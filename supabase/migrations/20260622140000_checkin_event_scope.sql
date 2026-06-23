-- Schaal-track #3a — denormalize event_id + venue_id onto check_ins / refusals.
--
-- WHY (perf-scale-track-3.5.md · ClickUp 86ey11ayt). Two scale problems share one
-- root cause: check_ins and refusals only carry guest_id — no event_id/venue_id.
--   1. Realtime: the door/cockpit check_ins subscription can NOT filter server-side
--      by event, so every check-in of every venue reaches every subscriber before
--      RLS runs — the documented postgres_changes "RLS per subscriber per change"
--      cost. With event_id the subscription becomes event_id=eq.<id>, and (next
--      #3a step) the stream moves to Broadcast on topic event:{id}.
--   2. RLS: the SELECT policies chain guest_event -> event_venue -> has_venue_role
--      = 3 index lookups PER ROW (4500-6000 for a 1500-row door read). With the
--      columns present the chain collapses to ONE membership check on an index.
--
-- SCOPE OF THIS MIGRATION (the safe, self-contained slice):
--   * add event_id + venue_id (FK on delete restrict, NOT NULL after backfill) + idx
--   * a BEFORE INSERT/UPDATE trigger fills them from the guest, so clients keep
--     sending only guest_id — the offline outbox contract is UNCHANGED (#25), and
--     offline replays stay idempotent.
--   * rewrite ONLY the SELECT policies to use the new columns. The INSERT/UPDATE
--     policies are deliberately left as-is: they key off guest_id (always client-
--     supplied) and run once per write, not per row of a read — so they are neither
--     the scale bottleneck nor sensitive to BEFORE-trigger ordering.
-- NOT here (needs runtime + the hosted load-test to validate — later #3a steps):
--   the realtime subscription event filter and the postgres_changes -> Broadcast
--   switch. This migration is the prerequisite that unblocks both.
--
-- AUDIT (#4): audit_check_ins / audit_refusals (AFTER INSERT/UPDATE/DELETE) are
-- deliberately NOT disabled (CLAUDE.md: never disable triggers). The one-time
-- backfill UPDATE therefore writes one system-actor (auth.uid() = null) audit row
-- per existing row — legitimate provenance of the schema change, and cheap while
-- the tables are still small (one more reason to land this BEFORE large-scale
-- onboarding). New columns simply start appearing in future audit before/after diffs.

-- ── columns (nullable first, so the backfill can populate them) ──────────────
alter table public.check_ins
  add column event_id uuid references public.events (id) on delete restrict,
  add column venue_id uuid references public.venues (id) on delete restrict;

alter table public.refusals
  add column event_id uuid references public.events (id) on delete restrict,
  add column venue_id uuid references public.venues (id) on delete restrict;

-- ── backfill from the guest's event (and the event's venue) ──────────────────
update public.check_ins ci
   set event_id = g.event_id,
       venue_id = e.venue_id
  from public.guests g
  join public.events e on e.id = g.event_id
 where g.id = ci.guest_id
   and (ci.event_id is null or ci.venue_id is null);

update public.refusals r
   set event_id = g.event_id,
       venue_id = e.venue_id
  from public.guests g
  join public.events e on e.id = g.event_id
 where g.id = r.guest_id
   and (r.event_id is null or r.venue_id is null);

-- ── lock them down once populated ────────────────────────────────────────────
alter table public.check_ins
  alter column event_id set not null,
  alter column venue_id set not null;

alter table public.refusals
  alter column event_id set not null,
  alter column venue_id set not null;

-- Backs the realtime event filter AND the rewritten SELECT policies.
create index check_ins_event_id_idx on public.check_ins (event_id);
create index refusals_event_id_idx on public.refusals (event_id);

-- ── keep them correct going forward (BEFORE INSERT/UPDATE) ───────────────────
-- The client sends only guest_id (offline outbox, #25); derive the scope server-
-- side. Fills only when absent, so it is idempotent on offline replay and a no-op
-- on later updates (void/revive). SECURITY DEFINER + pinned search_path, matching
-- the existing helper/trigger functions; reads guests/events past RLS so a doorhost
-- insert always resolves the scope. One function serves both tables (both have
-- guest_id). NOT NULL is checked AFTER this BEFORE trigger, so the column is set.
create or replace function public.set_checkin_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_id is null or new.venue_id is null then
    select g.event_id, e.venue_id
      into new.event_id, new.venue_id
      from public.guests g
      join public.events e on e.id = g.event_id
     where g.id = new.guest_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_checkin_scope() from public, anon;

create trigger check_ins_set_scope
  before insert or update on public.check_ins
  for each row execute function public.set_checkin_scope();

create trigger refusals_set_scope
  before insert or update on public.refusals
  for each row execute function public.set_checkin_scope();

-- ── lighter SELECT policies (the per-row win — same §2 matrix) ───────────────
-- Was: has_venue_role(event_venue(guest_event(guest_id)), {admin,finance,doorhost})
--      or is_event_organizer(guest_event(guest_id))            -- 3 lookups / row
-- Now: one membership check on the indexed venue_id, or organizer on event_id.
drop policy check_ins_select on public.check_ins;
create policy check_ins_select on public.check_ins
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance,doorhost}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

drop policy refusals_select on public.refusals;
create policy refusals_select on public.refusals
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance,doorhost}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );
