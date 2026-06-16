-- Sessie C — Permanente gasten (#11): nieuwe guest_source-waarde 'permanent'.
--
-- Why its own migration file: Postgres forbids USING a freshly-added enum value
-- later in the same transaction it was added in (the value is not committed
-- yet). The quota migration (20260615140000) and the permanent-sync RPC
-- (20260615150000) both reference 'permanent', so the value must be committed
-- first, alone, before anything reads it.
--
-- Semantics: a 'permanent' guest is house-added (the venue's own "vaste gast"
-- auto-synced onto every event). It behaves like 'landing' for PERSONAL quota —
-- it never charges a staffer's slots (guest_personal_contribution returns 0,
-- migration 20260615140000) — but it STILL counts toward tier-max, because a
-- permanent VIP occupies a VIP seat like any other.

alter type public.guest_source add value if not exists 'permanent';
