-- Snelheid P1 (ClickUp z8uq9m2xyn): Supabase performance advisor
-- `auth_rls_initplan` (WARN) on `invites_select`.
--
-- The policy (20260613190000_auth_invites_sessions.sql) already wrapped the JWT
-- read in a scalar subquery — `(select auth.jwt() ->> 'email')` — which Postgres
-- plans as a one-off InitPlan. The advisor's check is textual and only accepts
-- the canonical `(select auth.jwt())` shape, so it kept flagging the policy.
-- This rewrites the e-mail arm to that canonical form: `auth.jwt()` is evaluated
-- once per statement, then `->> 'email'` is applied to the result.
--
-- Semantics are IDENTICAL: same two arms (venue admin/user_manager/finance via
-- has_venue_role, or the invitee by case-insensitive e-mail), same role
-- (`authenticated`), same command (SELECT). ALTER POLICY keeps the policy in
-- place — no drop/create window in which the table would read differently.
-- No grant change (the grant matrix of `invites` is untouched).

alter policy invites_select on public.invites
  using (
    public.has_venue_role(venue_id, '{admin,user_manager,finance}'::public.venue_role[])
    or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
