-- z8uq9m2xz2 9-DB — one permissive UPDATE policy on check_ins (Supabase
-- advisor multiple_permissive_policies, perf audit 2026-10).
--
-- Before: two permissive UPDATE policies for `authenticated`, which Postgres
-- ORs together — USING_door OR USING_own, and WITH CHECK_door OR CHECK_own:
--   check_ins_update_door        using can_check_in(guest_event(guest_id))
--                                check can_check_in(guest_event(guest_id))
--                                      and (synced_by is null or synced_by = uid)
--   check_ins_update_own_device  using checked_by = uid
--                                check checked_by = uid
-- After: one policy whose USING and WITH CHECK are exactly those two ORs, the
-- cheap own-device test first. Permissive policies combine per clause, not per
-- policy (a row may pass USING through one and WITH CHECK through the other),
-- and the merged policy does the same, so the allowed set is unchanged.
-- The RESTRICTIVE check_ins_void_requires_uncheck (undo needs the uncheck
-- right, z8uq9m2vg6) is untouched and still ANDs on top.
-- Proof: supabase/tests/database/rls_set_based_parity.test.sql (old pair
-- restored vs merged policy, same probe matrix) + the existing check-in suites.

drop policy check_ins_update_door on public.check_ins;
drop policy check_ins_update_own_device on public.check_ins;

create policy check_ins_update on public.check_ins
  as permissive
  for update
  to authenticated
  using (
    checked_by = (select auth.uid())
    or public.can_check_in(public.guest_event(guest_id))
  )
  with check (
    checked_by = (select auth.uid())
    or (
      public.can_check_in(public.guest_event(guest_id))
      and (synced_by is null or synced_by = (select auth.uid()))
    )
  );
