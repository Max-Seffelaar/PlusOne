-- 86ey9e84m — cross-tenant venue_id integrity is nowhere enforced (S1 + S4,
-- adversarial review CONFIRMED). Two exploits, same root cause: the
-- 20260708120000_venue_scope_denormalization.sql columns are trusted for
-- reads (guests_select, venue_event_headcounts) but nothing pins them to the
-- row's actual event on write.
--
-- S1 — guest injection: public.set_event_scope() only fills venue_id
-- `if new.venue_id is null`. A client-supplied non-null venue_id survives on
-- all four tables the trigger serves (guests/guest_requests/quota_requests/
-- guest_tiers). A staff/doorhost with write access to an event in venue A can
-- POST a row with that event_id but venue_id = <venue B>, and it then shows
-- up in B's venue-wide reads and headcount tile — cross-tenant PII injection.
--
-- S4 — event repoint: events_update_admin_organizer's WITH CHECK re-evaluates
-- `is_event_organizer(id)`, which is event-scoped and stays true after
-- venue_id changes — nothing pins events.venue_id, so an organizer can move
-- their own event (and every guest row keyed on it) into another venue.
--
-- FIX (expand-only, no new columns):
-- 1. set_event_scope() always overwrites venue_id from the row's event_id
--    instead of fill-when-null — closes S1 for all four tables in one place.
-- 2. A new BEFORE UPDATE trigger on events rejects any venue_id change by
--    resetting it to the stored value — closes S4. Confirmed (session
--    research, 13/7) that no app code, RPC, or migration ever legitimately
--    updates events.venue_id after insert, so pinning it is safe.

-- ── S1: always pin venue_id to the row's event, never trust the client ──────
create or replace function public.set_event_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select e.venue_id into new.venue_id
    from public.events e
   where e.id = new.event_id;
  return new;
end;
$$;

-- ── S4: events.venue_id is immutable after creation ─────────────────────────
create or replace function public.pin_event_venue()
returns trigger
language plpgsql
as $$
begin
  new.venue_id := old.venue_id;
  return new;
end;
$$;

create trigger events_pin_venue
  before update on public.events
  for each row execute function public.pin_event_venue();
