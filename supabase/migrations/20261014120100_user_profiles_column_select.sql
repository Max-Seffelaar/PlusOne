-- user_profiles: authenticated's table-level SELECT becomes an explicit column
-- list (contract step after 20261014120000_my_profile_rpc).
--
-- The hole: 20260613000000 granted `select` on the whole table and
-- 20260923120000 left it there ("SELECT is deliberately left at table level"),
-- narrowing only INSERT/UPDATE. user_profiles_select lets a user read every
-- profile can_view_profile() admits — their own, anyone they share a venue
-- with, anyone they share an event with as organizer — so every colleague
-- could read every column of the others' rows: is_platform_admin (who the
-- PlusOne operators are), mfa_snooze_until (who skipped MFA), phone, and any
-- column added later, because a table-level grant covers future columns too.
-- A column-level REVOKE does not narrow a table-level GRANT, so the table
-- grant has to go and a column list replaces it.
--
-- What `authenticated` keeps — exactly the columns the app reads on ANOTHER
-- user's row (inventory 2026-10-10, src/ + every invoker view/function):
--   id                 join key for every embed (venue_memberships,
--                      event_organizers, guests.added_by, audit_feed) and the
--                      WHERE of the self-UPDATE in profile/consent/MFA actions
--   full_name          team, crew and organizer lists, "added by", audit_feed
--                      (security_invoker view: actor/subject names), exports
--   email              team/crew/organizer lists, crew invite + resend lookup
--   terms_accepted_at  crew list "joined" state (fetchVenueCrew)
--
-- What it loses: is_platform_admin, mfa_snooze_until, phone, first_name,
-- last_name, terms_version, created_at, updated_at. Own-row reads of those go
-- through my_profile() (and is_platform_admin() for the flag), which the app
-- switched to in the same PR as this migration. Platform admins are not an
-- exception here: they read colleagues' rows through the same grant, and
-- their own row through the same functions.
--
-- Expand–contract: push this only after the app version that reads through
-- my_profile()/is_platform_admin() is live (Vercel deploys on merge; the prod
-- push follows). The previous app version reads mfa_snooze_until,
-- terms_version, phone and is_platform_admin directly and would get 42501.
--
-- Unchanged: the column-level INSERT/UPDATE grants from 20260923120000, the
-- RLS policies, and every SECURITY DEFINER function (they run as the owner).
-- anon never had SELECT. service_role keeps its defaults.
--
-- A new column on user_profiles is therefore closed for reading as well as
-- writing until a migration names it here — the rule CLAUDE.md "Platform
-- admins" states, and grant_matrix.test.sql now enforces.

revoke select on public.user_profiles from authenticated;

grant select (id, full_name, email, terms_accepted_at)
  on public.user_profiles to authenticated;
