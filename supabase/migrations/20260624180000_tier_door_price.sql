-- Feedback (Joeri/Max, 24 jun 2026) — Paid tiers (price label only; NO payments).
--
-- A tier can now carry a door price, so the tier reads "€25" instead of always
-- "Free". We do NOT process payments — ticketing/Tap-to-Pay (#34) stays out of the
-- MVP; this is purely the price the venue charges at the door, shown on the tier.
-- Stored in euro cents (integer) to avoid float money. NULL = free (the default,
-- so every existing tier stays free with no backfill).
--
-- No RLS change: guest_tiers_insert/update already gate admin + organizer of the
-- event (fase 2), and the new column rides along on those policies.

alter table public.guest_tiers
  add column door_price_cents integer check (door_price_cents is null or door_price_cents >= 0);

comment on column public.guest_tiers.door_price_cents is
  'Door price for this tier in euro cents — display only, no payment processing (#34). NULL = free.';
