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

-- The dropped policies carried the security rationale in the catalog; keep it.
comment on policy check_ins_update on public.check_ins is
  'One permissive UPDATE policy (20261017120100, was check_ins_update_door + '
  'check_ins_update_own_device). Door branch: can_check_in on the guest''s event, '
  'and WITH CHECK pins synced_by to null or auth.uid(). Own-device branch: '
  'checked_by = auth.uid(). checked_by/voided_by on UPDATE are bounded to '
  'door-capable users of the event by the guard_check_in_actor_change trigger — '
  'before 86ey9et0h there was no bound on either, which made the own-device pin '
  'non-binding. Undo additionally needs the RESTRICTIVE check_ins_void_requires_uncheck.';

comment on column public.check_ins.synced_by is
  'Who transmitted the INSERT that created this row, when that was not the doorhost who admitted the guest (shared tablet, doorhost hand-off). Scope is deliberately the insert only: later UPDATEs (top-up, uitchecken, revive) do not maintain it, so NULL means "this row was inserted by its own actor", never "no hand-off ever touched it". The audit log is the complete per-change record. Pinned to auth.uid() on INSERT by RLS; on UPDATE only the door branch of check_ins_update pins it, so treat it as advisory provenance rather than a security control (86ey9et0h).';
