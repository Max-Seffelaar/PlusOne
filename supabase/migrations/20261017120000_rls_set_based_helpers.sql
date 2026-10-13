-- z8uq9m2xz2 9-DB — set-based RLS on the hot tables (perf audit 2026-10,
-- finding 13: "the platform-admin check doubled the per-row RLS cost").
--
-- Problem. The policies on guests / check_ins / refusals / guest_requests /
-- events call has_venue_role(venue_id, …), is_event_organizer(event_id) and
-- is_venue_member(venue_id) with a COLUMN as argument. Those are SECURITY
-- DEFINER SQL functions — never inlined — so Postgres runs them once per row,
-- and since 20260923120000 every one of them ends in `or is_platform_admin()`,
-- a second lookup per call. guests_select as staff was ~5 function calls per
-- row: 3.2–4.1 s for a 25 000-guest list (scripts/perf/rls-set-based-*.sql).
--
-- Fix. Ask "which venues / events does the caller have?" ONCE per statement
-- instead of "does the caller have this row's venue?" per row:
--
--   has_venue_role(v, R)               →  (select public.is_platform_admin())
--                                         or v in (select public.my_venue_ids_with_roles(R))
--   has_venue_role(event_venue(e), R)  →  … or e in (select public.my_event_ids_with_roles(R))
--   is_event_organizer(e)              →  … or e in (select public.my_organized_event_ids())
--   is_venue_member(v)                 →  … or v in (select public.my_venue_ids())
--
-- Each new helper takes only constants, so `x in (select f(const))` plans as an
-- uncorrelated (hashed) SubPlan and `(select is_platform_admin())` as an
-- InitPlan: both are evaluated once per statement, not per row.
--
-- Semantics are kept EXACTLY (spec #49 platform admins stay the deliberate
-- cross-tenant exception). Every rewrite is a local substitution of the helper
-- by its definition: has_venue_role(v,R) = M(v,R) or P, so where the old helper
-- sat inside an AND (guest_requests_decide, guests_update, guests_insert), the
-- platform-admin disjunct P stays inside that same AND; it only became a
-- top-level disjunct where the old expression was already a pure OR of
-- helpers (the SELECT policies, events_*). `has_venue_role(event_venue(e), R)`
-- becomes `e in my_event_ids_with_roles(R)` — the same question (event e is at
-- a venue where I hold R), answered through the events row, the closest copy
-- of the old expression. (`venue_id in my_venue_ids_with_roles(R)` would be
-- equivalent too: set_event_scope overwrites venue_id from the event on every
-- write since 20260713160000 and events_pin_venue keeps events.venue_id
-- immutable. Not switched here — this migration only substitutes.)
-- `x in (…)` yields NULL instead of FALSE for a NULL x; none of these policies
-- negates a helper, so NULL and FALSE deny alike.
-- Proof: supabase/tests/database/rls_set_based_parity.test.sql runs one probe
-- matrix (9 personas × 5 tables × select/insert/update) under these policies
-- AND under the old ones restored in the same transaction, and requires both
-- to be identical.
--
-- Not changed, deliberately:
--   * has_venue_role / is_event_organizer / is_venue_member / is_venue_organizer
--     themselves — RPCs and the other ~50 policies still call them; this is
--     expand-only. Further tables can move over table by table.
--   * the event-scoped write helpers inside these policies (can_write_guests,
--     can_check_in, can_record_check_in_for, can_uncheck_check_in): they decide
--     on events columns (cancelled_at, list_locked, auto_lock_at, the uncheck
--     setting), are called once per written row, and a set-based copy would be
--     a second implementation of the list-lock rule (#23) to keep in sync.
--   * check_ins UPDATE: merged into one policy in 20261017120100 (advisor).
--
-- Grant matrix (functions; CLAUDE.md conventions): EXECUTE revoked from
-- public/anon, granted to authenticated (the policies run as the caller) and
-- service_role. Callable through /rpc like the existing helpers; each returns
-- only the CALLER's own venue/event ids (auth.uid()), which the caller can
-- already read via venue_memberships / event_organizers / events.

-- ─── Helpers ────────────────────────────────────────────────────────────────

create function public.my_venue_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.venue_id
  from public.venue_memberships m
  where m.user_id = (select auth.uid());
$$;

comment on function public.my_venue_ids() is
  'Set-based RLS helper (20261017120000): the venues the caller is a member of, '
  'any role. Use as `venue_id in (select public.my_venue_ids())` beside '
  '`(select public.is_platform_admin())` — the set form of is_venue_member().';

create function public.my_venue_ids_with_roles(p_roles public.venue_role[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.venue_id
  from public.venue_memberships m
  where m.user_id = (select auth.uid())
    and m.roles && p_roles;
$$;

comment on function public.my_venue_ids_with_roles(public.venue_role[]) is
  'Set-based RLS helper (20261017120000): the venues where the caller holds at '
  'least one of p_roles. Pass a CONSTANT so the subquery hoists. Set form of '
  'has_venue_role() minus its platform-admin disjunct, which the policy adds '
  'itself as `(select public.is_platform_admin())`.';

create function public.my_event_ids_with_roles(p_roles public.venue_role[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.events e
  join public.venue_memberships m on m.venue_id = e.venue_id
  where m.user_id = (select auth.uid())
    and m.roles && p_roles;
$$;

comment on function public.my_event_ids_with_roles(public.venue_role[]) is
  'Set-based RLS helper (20261017120000): the events at venues where the caller '
  'holds at least one of p_roles. Set form of has_venue_role(event_venue(event_id), '
  'p_roles) minus the platform-admin disjunct. Pass a CONSTANT.';

create function public.my_organized_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select eo.event_id
  from public.event_organizers eo
  where eo.user_id = (select auth.uid());
$$;

comment on function public.my_organized_event_ids() is
  'Set-based RLS helper (20261017120000): the events the caller organizes (crew). '
  'Set form of is_event_organizer() minus its platform-admin disjunct.';

revoke execute on function public.my_venue_ids() from public, anon;
revoke execute on function public.my_venue_ids_with_roles(public.venue_role[]) from public, anon;
revoke execute on function public.my_event_ids_with_roles(public.venue_role[]) from public, anon;
revoke execute on function public.my_organized_event_ids() from public, anon;
grant execute on function public.my_venue_ids() to authenticated, service_role;
grant execute on function public.my_venue_ids_with_roles(public.venue_role[]) to authenticated, service_role;
grant execute on function public.my_event_ids_with_roles(public.venue_role[]) to authenticated, service_role;
grant execute on function public.my_organized_event_ids() to authenticated, service_role;

-- The access rule now has two spellings: the per-row helpers (still used by
-- ~50 policies and RPCs) and the set helpers above (the 12 hot policies). Each
-- side names the other so a later change touches both; rls_set_based_parity.
-- test.sql asserts they agree for every fixture user × venue/event × role set.
comment on function public.has_venue_role(uuid, public.venue_role[]) is
  'Per-row RLS helper: caller holds one of p_roles at p_venue_id, or is a platform '
  'admin. Set-based copy: my_venue_ids_with_roles / my_event_ids_with_roles '
  '(20261017120000) — change both together; parity asserted in '
  'rls_set_based_parity.test.sql.';
comment on function public.is_venue_member(uuid) is
  'Per-row RLS helper: caller is a member (any role) of p_venue_id, or a platform '
  'admin. Set-based copy: my_venue_ids (20261017120000) — change both together.';
comment on function public.is_event_organizer(uuid) is
  'Per-row RLS helper: caller organizes p_event_id (crew), or is a platform admin. '
  'Set-based copy: my_organized_event_ids (20261017120000) — change both together.';

-- ─── guests ─────────────────────────────────────────────────────────────────
-- old: has_venue_role(venue_id,'{admin,finance,doorhost}') or is_event_organizer(event_id)
--      or (has_venue_role(venue_id,'{staff}') and added_by = uid)
-- P absorbs the staff branch's P∧added_by, so P moves to the top.
alter policy guests_select on public.guests
  using (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids_with_roles('{admin,finance,doorhost}'::public.venue_role[]))
    or event_id in (select public.my_organized_event_ids())
    or (
      venue_id in (select public.my_venue_ids_with_roles('{staff}'::public.venue_role[]))
      and added_by = (select auth.uid())
    )
  );

-- Only the last AND-group had role helpers; P stays inside that group.
alter policy guests_insert on public.guests
  with check (
    public.can_write_guests(event_id)
    and (
      added_by = (select auth.uid())
      or (source = 'door'::public.guest_source and public.can_record_check_in_for(event_id, added_by))
    )
    and status = 'approved'::public.guest_status
    and (
      source = any (array['app'::public.guest_source, 'door'::public.guest_source])
      or (select public.is_platform_admin())
      or event_id in (select public.my_event_ids_with_roles('{admin}'::public.venue_role[]))
      or event_id in (select public.my_organized_event_ids())
    )
  );

alter policy guests_update on public.guests
  using (
    anonymized_at is null
    and public.can_write_guests(event_id)
    and (
      added_by = (select auth.uid())
      or (select public.is_platform_admin())
      or event_id in (select public.my_event_ids_with_roles('{admin,doorhost}'::public.venue_role[]))
      or event_id in (select public.my_organized_event_ids())
    )
  )
  with check (
    anonymized_at is null
    and public.can_write_guests(event_id)
    and (
      added_by = (select auth.uid())
      or (select public.is_platform_admin())
      or event_id in (select public.my_event_ids_with_roles('{admin,doorhost}'::public.venue_role[]))
      or event_id in (select public.my_organized_event_ids())
    )
    and status <> all (array['pending'::public.guest_status, 'denied'::public.guest_status])
  );

-- ─── check_ins / refusals (SELECT) ──────────────────────────────────────────
-- venue_id on both is server-derived (20260713190000); same column as before.
alter policy check_ins_select on public.check_ins
  using (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids_with_roles('{admin,finance,doorhost}'::public.venue_role[]))
    or event_id in (select public.my_organized_event_ids())
  );

alter policy refusals_select on public.refusals
  using (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids_with_roles('{admin,finance,doorhost}'::public.venue_role[]))
    or event_id in (select public.my_organized_event_ids())
  );

-- ─── guest_requests ─────────────────────────────────────────────────────────
alter policy guest_requests_select on public.guest_requests
  using (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids_with_roles('{admin,finance}'::public.venue_role[]))
    or event_id in (select public.my_organized_event_ids())
  );

-- P stays inside the AND: a platform admin may decide only a pending,
-- un-anonymized request, exactly as before.
alter policy guest_requests_decide on public.guest_requests
  using (
    status = 'pending'::public.request_status
    and anonymized_at is null
    and (
      (select public.is_platform_admin())
      or event_id in (select public.my_event_ids_with_roles('{admin}'::public.venue_role[]))
      or event_id in (select public.my_organized_event_ids())
    )
  )
  with check (
    status = 'denied'::public.request_status
    and decided_by = (select auth.uid())
    and (
      (select public.is_platform_admin())
      or event_id in (select public.my_event_ids_with_roles('{admin}'::public.venue_role[]))
      or event_id in (select public.my_organized_event_ids())
    )
  );

-- ─── events ─────────────────────────────────────────────────────────────────
alter policy events_select_member on public.events
  using (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids())
    or id in (select public.my_organized_event_ids())
  );

alter policy events_insert_admin on public.events
  with check (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids_with_roles('{admin}'::public.venue_role[]))
  );

alter policy events_update_admin_organizer on public.events
  using (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids_with_roles('{admin}'::public.venue_role[]))
    or id in (select public.my_organized_event_ids())
  )
  with check (
    (select public.is_platform_admin())
    or venue_id in (select public.my_venue_ids_with_roles('{admin}'::public.venue_role[]))
    or id in (select public.my_organized_event_ids())
  );
