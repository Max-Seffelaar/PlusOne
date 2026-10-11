-- user_profiles.has_joined: "has this person ever logged in", as a yes/no
-- (expand step; decision Max 2026-10-11).
--
-- The Team screen's crew list shows whether an external crew member has
-- answered their invite yet. It read `terms_accepted_at` on the colleague's
-- row for that — an exact first-login timestamp, while the screen only needs
-- yes/no. The contract migration (20261016120100) grants `has_joined` to
-- authenticated instead of `terms_accepted_at`, so colleagues learn whether,
-- not when.
--
-- A STORED generated column, so it can never disagree with terms_accepted_at
-- and nobody can write it: Postgres refuses an explicit value on INSERT and
-- UPDATE for every role. It is not in the INSERT/UPDATE column grants of
-- 20260923120000 either. Under today's table-level SELECT it is readable like
-- every other column; the deployed app does not read it, so this is
-- expand-only. Adding a stored generated column rewrites the table once —
-- user_profiles is small (one row per user).

alter table public.user_profiles
  add column has_joined boolean
  generated always as (terms_accepted_at is not null) stored;

comment on column public.user_profiles.has_joined is
  'Derived: terms_accepted_at is not null. What colleagues may read instead of the timestamp (20261016120100).';
