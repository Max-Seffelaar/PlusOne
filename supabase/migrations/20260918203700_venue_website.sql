-- Venue website (z8uq9m0hw2, Joeri walkthrough). The venue settings "Landing
-- page" row showed a dead `plus.one/<venue-slug>` address. Max's call (option A):
-- that row becomes the venue's OWN website, an optional URL the admin types in.
--
-- Security surface: nothing new. venues keeps its row policies
-- (venues_select_member / venues_update_admin, 20260613120000) and its
-- table-level `grant select, update on table public.venues to authenticated`
-- (20260613000000), which covers a new column without a column grant. The write
-- path is the plain user-scoped UPDATE in updateVenueSettingsAction, under that
-- admin-only policy; no trigger and no SECURITY DEFINER function reads or writes
-- this column (audit_venues_allow_uncheck only fires on allow_uncheck).
--
-- Expand-only: nullable, no default, no backfill. The currently deployed app
-- never names the column, so it is unaffected.
--
-- The CHECK backstops the Zod rule (trimmed, http(s) only, <= 200 chars): a
-- direct API call can't store `javascript:` or any other scheme that the
-- settings screen would render as a link. The scheme match is case-insensitive
-- because URL schemes are.

alter table public.venues
  add column website text
    constraint venues_website_http_check
    check (website is null or (char_length(website) <= 200 and website ~* '^https?://'));

comment on column public.venues.website is
  'The venue''s own website (optional), shown in venue settings. http(s) only, max 200 chars. Set by an admin (venues_update_admin).';
