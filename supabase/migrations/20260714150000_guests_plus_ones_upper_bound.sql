-- Door-add + quick-add plus_ones ceiling (86ey9e8bd).
--
-- Zod caps plusOnes at 50 on every guest-write path (schemas.ts), but the
-- door outbox replay inserts guests directly (src/features/door/outbox/
-- gateway.ts insertGuest) with no server action re-validating the payload —
-- the client-side Zod guard added alongside this migration (DoorProvider's
-- addOnSpot) is defence, not the boundary. The only DB-level guard was
-- `plus_ones >= 0` (no ceiling), so a stray large value (mistyped door-add,
-- a replayed pre-fix client, a direct API call) could still land and corrupt
-- quota/headcount math with a single row. Additive only — the existing
-- `plus_ones >= 0` check stays untouched.

alter table public.guests
  add constraint guests_plus_ones_upper_bound check (plus_ones <= 50);
