-- my_profile(): the caller's own user_profiles row, through a function instead
-- of a direct SELECT (expand step of the user_profiles column-SELECT narrowing).
--
-- Why: `authenticated` holds table-level SELECT on user_profiles, so every user
-- who passes can_view_profile() for a colleague can read every column of that
-- colleague's row — is_platform_admin, mfa_snooze_until, phone, and whatever
-- column is added next. A column-level REVOKE does not narrow a table-level
-- GRANT in Postgres, and a column grant is the same for every row: it cannot
-- say "your own phone, but not your colleague's". So the follow-up contract
-- migration replaces the table-level SELECT with an explicit column list that
-- only holds what the app reads ACROSS users (id, full_name, email,
-- terms_accepted_at), and own-row reads of everything else move here.
--
-- Expand–contract: this migration only adds a function; the deployed app does
-- not call it and is unaffected. The app switches its own-row reads to this
-- function (and to is_platform_admin() for the flag) in the next PR, and the
-- grant narrows only after that app version is live.
--
-- Security shape (CLAUDE.md #1, #24):
--   * SECURITY DEFINER, `set search_path = ''`, STABLE.
--   * Row scope is `id = auth.uid()` and nothing else: no parameter, so there
--     is no id for a caller to swap. anon / a missing JWT => auth.uid() is
--     null => zero rows (and anon has no EXECUTE anyway).
--   * Returns the caller's own data only. is_platform_admin is deliberately
--     not in the result: callers use public.is_platform_admin() for that, so
--     the flag keeps exactly one read path.
--   * EXECUTE: authenticated only (revoked from public, anon, service_role —
--     the service role has no auth.uid(), so the function means nothing there).

create function public.my_profile()
returns table (
  id uuid,
  email text,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  terms_accepted_at timestamptz,
  terms_version text,
  mfa_snooze_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.first_name, p.last_name, p.phone,
         p.terms_accepted_at, p.terms_version, p.mfa_snooze_until
  from public.user_profiles p
  where p.id = (select auth.uid());
$$;

revoke execute on function public.my_profile() from public, anon, service_role;
grant execute on function public.my_profile() to authenticated;
