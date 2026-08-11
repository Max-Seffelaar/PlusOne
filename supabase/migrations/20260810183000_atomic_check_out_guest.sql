-- Atomic (partial) check-out — review finding #34 (ClickUp 86ey9e9q2).
--
-- check_ins keeps ONE row per guest (guest_id is unique, #11) with a MONOTONE
-- plus_ones_arrived, so "3 of the 4 in this party leave" cannot be expressed as a
-- plain UPDATE: the cap trigger (cap_check_in_arrivals) refuses to lower the
-- count except across a revive (voided -> active). The cockpit therefore did it
-- in TWO round trips from the browser — void, then re-checkin with the smaller
-- party. A transient failure between them (network flap, edge 502, tab closed)
-- left the guest FULLY checked out instead of partially: headcount −4 instead of
-- −2, with the cockpit's cache and the database disagreeing until the next sync.
--
-- This function performs the same two writes inside ONE transaction, so a
-- partial check-out is all-or-nothing. It is the only supported check-out path
-- for the cockpit; the door's own full-void (offline outbox) is unchanged.
--
-- Deliberate semantics:
--   * checked_by / checked_at are PRESERVED on a partial check-out. The guest
--     never left, only part of their party did, so the first-wins arrival
--     identity (#11) and the instroom bucket must not move to whoever operated
--     the ✗ button (this is the same C10 corruption class as a stale revive
--     overwriting a peer's active row).
--   * p_remaining_heads is a TOTAL head count for the guest (1 = the guest
--     alone, 0 = everyone leaves = full soft-void, #3). It can only ever LOWER
--     the party: a stale client asking for more heads than are currently inside
--     is clamped, never used to check extra people in.
--   * p_check_in_id, when supplied, scopes the write to the check_ins row the
--     caller actually observed. A peer's newer row (different id) then matches 0
--     rows and the call is a no-op instead of hijacking their check-in.
--   * SECURITY INVOKER (the default, made explicit): RLS stays the security
--     boundary (CLAUDE.md #1). Who may void is decided by check_ins_update_door
--     / check_ins_update_own_device, and the RESTRICTIVE
--     check_ins_void_requires_uncheck policy (S1.1) still rejects the void leg
--     when "uitchecken" is disabled for the event — in which case the whole
--     function aborts and NOTHING is applied, which is exactly the atomicity
--     this migration exists to provide.
--   * A guest with no active check-in the caller may touch (already out, hidden
--     by RLS, or a peer's row under p_check_in_id) yields NULL — an idempotent
--     no-op, so a retried check-out is harmless (#25).
--
-- The AFTER triggers are unchanged and still fire per statement: the audit log
-- (#4) records the void and the re-checkin, and sync_guest_status_from_checkin
-- moves guests.status checked_in -> approved -> checked_in, ending on
-- 'checked_in' for a partial check-out and 'approved' for a full one.

create function public.check_out_guest(
  p_guest_id uuid,
  p_remaining_heads integer,
  p_check_in_id uuid default null
)
returns public.check_ins
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.check_ins;
begin
  if p_remaining_heads is null or p_remaining_heads < 0 then
    raise exception 'p_remaining_heads must be >= 0 (got %)', p_remaining_heads
      using errcode = '22023';
  end if;

  -- Leg 1 — soft-void the ACTIVE row (#3, never a DELETE). RLS decides whether
  -- this caller may reverse a check-in at all; `voided_at is null` keeps a
  -- repeated call idempotent, and p_check_in_id (when given) pins it to the row
  -- the caller saw.
  update public.check_ins
     set voided_at = now(),
         voided_by = auth.uid()
   where guest_id = p_guest_id
     and voided_at is null
     and (p_check_in_id is null or id = p_check_in_id)
  returning * into v_row;

  if not found then
    return null;
  end if;

  if p_remaining_heads = 0 then
    return v_row; -- full check-out: the void IS the whole operation
  end if;

  -- Leg 2 — put the smaller party back inside. Clearing voided_at makes the cap
  -- trigger revive-aware (it re-sets arrivals instead of holding them monotonic),
  -- which is what allows the count to drop at all. `least(...)` keeps a
  -- check-out from ever raising the headcount; the trigger still clamps to the
  -- guest's allotment on top. checked_by/checked_at are deliberately untouched.
  update public.check_ins
     set voided_at = null,
         voided_by = null,
         plus_ones_arrived = least(p_remaining_heads - 1, v_row.plus_ones_arrived)
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.check_out_guest(uuid, integer, uuid) is
  'Atomic (partial) check-out: voids the guest''s active check-in and, when p_remaining_heads > 0, immediately re-checks the smaller party in — one transaction, so a failure can never leave the guest fully checked out by accident (#34). Preserves checked_by/checked_at (first-wins arrival identity). Returns the resulting check_ins row, or NULL when no active check-in matched.';

revoke execute on function public.check_out_guest(uuid, integer, uuid) from public, anon;
grant execute on function public.check_out_guest(uuid, integer, uuid) to authenticated;
