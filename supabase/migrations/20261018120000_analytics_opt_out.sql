-- Analytics PH (PostHog), PR 1 foundation (onboarding programme task 10;
-- plan: docs/posthog-implementation-plan.md §5, decision 1 of 2026-07-06).
--
-- In-app product analytics is ON by default for signed-in company users and
-- every user can turn it off for themselves in Profile. That choice lives here:
--
--   user_profiles.analytics_opt_out_at timestamptz NULL
--     NULL      = tracked (the default)
--     timestamp = opted out, since then
--
-- Same single-column shape as mfa_snooze_until. It is the user's own private
-- preference, so the grant matrix is:
--
--   UPDATE (analytics_opt_out_at) to authenticated
--     Row scope comes from the existing RLS policy user_profiles_update_self
--     (using/with check id = auth.uid()): a user writes this column on their
--     own row only. A cross-user UPDATE is filtered to 0 rows by RLS, the same
--     behaviour rls.test L2 pins for email. No INSERT grant: the row is created
--     by ensure_my_profile()/invite acceptance (SECURITY DEFINER) and a new
--     row starts NULL = tracked.
--
--   no SELECT for authenticated
--     Since 20261016120100 authenticated reads user_profiles by an explicit
--     column list that holds only what the app reads on ANOTHER user's row
--     (id, full_name, email, has_joined), because user_profiles_select admits
--     every colleague. A colleague has no business knowing who opted out, so
--     the column stays out of that list (grant_matrix.test.sql 4c enforces it).
--     The owner reads it through my_profile() below, the documented path for
--     own-row private columns.
--
-- my_profile() gains the column. Its OUT columns change, which `create or
-- replace` cannot do, so it is dropped and recreated in this transaction with
-- the same body, security shape and EXECUTE grants as 20261016120000, plus
-- one trailing column. Expand-only for the deployed app: it selects named
-- columns from the function (`.rpc('my_profile').select('…')`), and an extra
-- column changes none of them. Nothing in the database depends on the
-- function (no view, no policy), so the drop cascades to nothing.
--
-- Not touched: RLS policies, the INSERT/UPDATE column grants of the other
-- columns, is_platform_admin and its guard.

alter table public.user_profiles
  add column analytics_opt_out_at timestamptz;

comment on column public.user_profiles.analytics_opt_out_at is
  'In-app product analytics opt-out (PostHog, decision 1 of 2026-07-06): null = '
  'tracked (default), timestamp = opted out since then. Self-written via the '
  'column UPDATE grant + user_profiles_update_self; read only through my_profile().';

grant update (analytics_opt_out_at) on public.user_profiles to authenticated;

drop function public.my_profile();

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
  mfa_snooze_until timestamptz,
  analytics_opt_out_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.first_name, p.last_name, p.phone,
         p.terms_accepted_at, p.terms_version, p.mfa_snooze_until,
         p.analytics_opt_out_at
  from public.user_profiles p
  where p.id = (select auth.uid());
$$;

comment on function public.my_profile() is
  'The caller''s own user_profiles row (auth.uid() only, no parameter). The read '
  'path for own-row private columns that authenticated holds no column SELECT on.';

revoke execute on function public.my_profile() from public, anon, service_role;
grant execute on function public.my_profile() to authenticated;
