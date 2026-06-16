-- Check-in correctie aan de deur ("uitchecken"). Decision (Max, 16 jun): a
-- mistaken check-in may ALWAYS be undone by anyone who may check in at this event
-- (doorhost / organizer / admin) — mits gelogd. The void is a hard DELETE of the
-- check_ins row, so the guest returns to "onderweg". The generic audit trigger
-- (audit_check_ins) already fires on DELETE and logs it as action 'delete' with
-- the before-image, so every correction is recorded — the check-in history is
-- preserved in the audit log even though the row itself is gone.
--
-- This does NOT touch the monotonic plus_ones_arrived rule (cap_check_in_arrivals
-- guards UPDATE increments; a full void is a delete, a different operation). RLS
-- mirrors check_ins_insert: can_check_in() decides door scope, so a doorhost can
-- only void check-ins for an event they actually work.

create policy check_ins_delete on public.check_ins
  for delete to authenticated
  using (public.can_check_in(public.guest_event(guest_id)));

-- DELETE wasn't part of the original check_ins grant (insert/select/update only).
grant delete on table public.check_ins to authenticated;
