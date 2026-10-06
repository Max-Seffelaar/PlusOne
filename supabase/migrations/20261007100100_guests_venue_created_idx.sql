-- Snelheid P1 (ClickUp z8uq9m2xyn), perf audit 2026-10 finding 8.
--
-- The Guests tab's venue-wide window (`fetchVenueGuestsWindow`,
-- src/features/po/queries.ts) reads
--   where venue_id = $1 and status in (...) order by created_at desc, id desc limit 50
-- and the only index on that path was `guests_venue_id_idx (venue_id)`: Postgres
-- fetched every guest of the venue and sorted them to return the newest page.
-- This composite index serves the filter AND the order, so the window is an
-- index range scan that stops after the page.
--
-- Additive only (expand–contract): `guests_venue_id_idx` stays — it is a prefix
-- of this one and can be dropped in a later, separate migration once prod
-- advisors confirm it is unused. Plain CREATE INDEX (not CONCURRENTLY: migrations
-- run in a transaction); at today's guest volume the build lock is brief.
-- No RLS, grant or trigger change.

create index if not exists guests_venue_created_idx
  on public.guests (venue_id, created_at desc, id desc);
