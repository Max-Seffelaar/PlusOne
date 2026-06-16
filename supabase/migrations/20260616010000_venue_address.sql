-- Venue address (#platform — "Locatie als volledig adres opslaan"). Stores the
-- venue's full location as a single free-text line ("Straat + nr, postcode,
-- plaats"), matching the venue form. Nullable. Feeds future guest communications
-- (the address is meant to land in the "je staat op de lijst"-mail later).
--
-- No new policy/grant needed: venues already has the admin-only UPDATE policy
-- (venues_update_admin) + the table grants, which cover every column.

alter table public.venues
  add column if not exists address text;

comment on column public.venues.address is
  'Full location address of the venue (single line). Feeds future guest communications; null = not set.';
