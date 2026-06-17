-- Fase 5.1 — Venue company data, profile name/phone, per-venue job title,
-- venue-wide default quota. Feedback round 2026-06-14.
--
-- Drivers (from the live walkthrough):
--   * Venue settings must capture company/legal/finance/address data (it already
--     gets asked in the onboarding VenueCreate screen — the real settings lagged).
--   * The personal quota needs a venue-wide DEFAULT, settable in venue settings,
--     that members inherit when they have no per-user override.
--   * Profiles split full_name into first/last + gain a phone number.
--   * "Functie" (job title) is per venue — the same person can be 'eigenaar' at
--     venue A and 'floormanager' at B — so it lives on the membership (decision:
--     per-venue, not on the global profile #24).
--
-- App-layer security is unchanged: every new column lives on a table whose RLS
-- row policies + column GRANTs (fases 1/2) already gate it — venues_update_admin,
-- user_profiles_update_self, venue_memberships_update (admin/user_manager + AAL2).
-- venue_memberships changes are already audited by the fase-3 trigger; the new
-- job_title therefore lands in the audit log automatically.

-- ---------------------------------------------------------------------------
-- venues — company / legal / finance / address + venue-default personal quota
-- ---------------------------------------------------------------------------

alter table public.venues
  add column company_name text,
  add column kvk_number text,
  add column vat_number text,
  add column finance_email text,
  add column address_line text,
  add column postal_code text,
  add column city text,
  add column country text not null default 'NL',
  -- Fallback personal quota for members without a quotas row at this venue. The
  -- quota engine resolves event override -> per-user default_count -> this -> 0.
  add column default_personal_quota integer not null default 0
    check (default_personal_quota >= 0);

comment on column public.venues.default_personal_quota is
  'Venue-wide fallback for a member''s personal guest-list quota (#22). Used by user_event_quota when the member has no per-user quotas row.';

-- ---------------------------------------------------------------------------
-- user_profiles — split name + phone (full_name stays as a display mirror,
-- maintained by the app on profile edit so existing reads keep working)
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column first_name text,
  add column last_name text,
  add column phone text;

-- Best-effort backfill for profiles created before this migration: first word ->
-- first_name, the remainder (incl. tussenvoegsels like "van den") -> last_name.
update public.user_profiles
  set first_name = nullif(split_part(full_name, ' ', 1), ''),
      last_name  = nullif(regexp_replace(full_name, '^\S+\s*', ''), '')
  where first_name is null and last_name is null;

-- ---------------------------------------------------------------------------
-- venue_memberships — per-venue job title (functie binnen het bedrijf)
-- ---------------------------------------------------------------------------

alter table public.venue_memberships
  add column job_title text;

-- ---------------------------------------------------------------------------
-- Quota engine — fold the venue default into the resolution chain (#22)
-- ---------------------------------------------------------------------------
-- create or replace keeps the existing ACL (fase 7 revoked EXECUTE from app
-- roles; this stays an internal definer helper). Only the COALESCE chain changes:
-- a missing per-user override now falls through to venues.default_personal_quota
-- before 0.

create or replace function public.user_event_quota(p_event_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select eq.quota_override
       from public.event_quotas eq
      where eq.event_id = p_event_id and eq.user_id = p_user_id),
    (select q.default_count
       from public.quotas q
       join public.events e on e.id = p_event_id
      where q.venue_id = e.venue_id and q.user_id = p_user_id),
    (select v.default_personal_quota
       from public.events e
       join public.venues v on v.id = e.venue_id
      where e.id = p_event_id),
    0
  );
$$;
