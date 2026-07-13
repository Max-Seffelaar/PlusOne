-- 86ey9ekc3 — check_ins/refusals carry the same fill-when-null forge as S1
-- (86ey9e84m, fixed for guests/guest_requests/quota_requests/guest_tiers in
-- 20260713160000_venue_id_rls_integrity.sql). Found during the adversarial
-- /security-review of that PR: the review was explicitly scoped to the four
-- tables sharing set_event_scope() and never looked at check_ins/refusals,
-- which got their event_id/venue_id from a *different* trigger
-- (set_checkin_scope(), 20260622140000_checkin_event_scope.sql) that has the
-- identical bug.
--
-- set_checkin_scope() only resolves event_id/venue_id from the guest
-- `if new.event_id is null or new.venue_id is null`. A client-supplied
-- non-null pair survives unmodified. check_ins_select/refusals_select key
-- directly on the denormalized venue_id, and check_ins_insert/refusals_insert
-- never validate event_id/venue_id at all (only checked_by + can_check_in on
-- guest_id) — so a doorhost/staff in venue A can POST guest_id = their own
-- A-guest, event_id = a real A-event, venue_id = venue B, and the row lands
-- readable from B. Same shape and severity as S1.
--
-- FIX (expand-only, mirrors 20260713160000): set_checkin_scope() always
-- overwrites event_id and venue_id from the guest, dropping the null-guard
-- entirely. Safe for the door outbox: the legitimate client (gateway.ts /
-- replay.ts) sends guest_id + event_id but always omits venue_id, and the
-- event_id it sends is always the guest's own true event — so re-deriving
-- both from guest_id yields identical values on that path. void/revive
-- UPDATEs never touch guest_id either — so the unconditional re-derivation
-- is a no-op on every real code path and only ever corrects a forged value.

create or replace function public.set_checkin_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select g.event_id, e.venue_id
    into new.event_id, new.venue_id
    from public.guests g
    join public.events e on e.id = g.event_id
   where g.id = new.guest_id;
  return new;
end;
$$;
