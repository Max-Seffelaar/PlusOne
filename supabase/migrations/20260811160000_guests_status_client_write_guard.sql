-- Quota-engine hardening (ClickUp 86ey9c5fp, decision D1) — a client may no
-- longer choose `guests.status` on INSERT, nor park an existing row in the
-- request-lifecycle statuses on UPDATE.
--
-- ── The hole ────────────────────────────────────────────────────────────────
-- `guests_insert` pins `added_by` (20260613120000) and `source`
-- (20260623140200_guest_source_insert_guard) but never `status`, and
-- `authenticated` holds table-wide INSERT including that column. No BEFORE
-- trigger or CHECK normalises it. So a staff member with nothing but the anon
-- key and their own session JWT could POST /rest/v1/guests with
-- status='pending' and land a row the quota engine charged 0 for.
--
-- `enforce_guest_quota` only raises 45001 on a NET INCREASE
-- (`if v_new_personal > v_old_personal`), and `guest_personal_contribution`
-- returned 0 for a status outside the "holds a slot" set, so on INSERT
-- (old = 0, new = 0) the 45001 branch was never reached at all.
--
-- Reproduced against a local stack, staff user pinned to 0 free slots
-- (8 of 8 used), inside begin/rollback:
--   * a normal `approved` insert            -> 45001 "9 van 8"     (blocked)
--   * the same row with status='pending'
--     and plus_ones=50                      -> INSERT 0 1          (accepted)
-- The forged row still consumed the SHARED pools it is invisible in: event
-- capacity moved by 1 + plus_ones and tier-max by one entry, so a ghost nobody
-- can see or delete could exhaust a hard cap or a tier.
--
-- Note the exposure is not limited to `pending` — the same forge accepts every
-- value of the enum, which is why this guard pins the value rather than
-- blacklisting one. It is also why the companion change to
-- `guest_personal_contribution` was reverted rather than kept: with the status
-- column forgeable, "which statuses are free" is attacker-controlled input.
--
-- ── The guard ───────────────────────────────────────────────────────────────
-- INSERT: a client may only ever create an `approved` row. Verified against
-- every client insert path first — `src/features/guests/actions.ts` (single +
-- bulk) and the door outbox gateway (`add_guest`, src/features/door/outbox/
-- replay.ts) all omit `status` entirely and rely on the column DEFAULT
-- 'approved', so the pin is non-breaking. RLS WITH CHECK sees the row after
-- defaults are applied, so omitting the column still passes.
--
-- UPDATE: a client may not leave a row in `pending` or `denied`. Those two are
-- the request-lifecycle statuses — `guest_requests.status` owns that lifecycle
-- and only materialises a `guests` row on approval — so neither has any
-- client-facing meaning here, and both are invisible to every list
-- (`fetchGuests` and the door query scope to approved/checked_in/refused).
-- Phrased on NEW.status rather than as a transition rule on purpose: WITH CHECK
-- cannot see OLD, and the legitimate client updates all leave the status alone
-- (`ackNote` on a checked_in row, tier changes, note edits) or set it to
-- 'approved' (undoRefusal) / 'removed' (soft delete), which all still pass.
--
-- Trigger- and RPC-driven transitions are unaffected: `sync_guest_status_from_
-- checkin` / `_from_refusal` (20260619120000) and every guest-creating RPC are
-- SECURITY DEFINER owned by a superuser, and `guests` is not FORCE ROW LEVEL
-- SECURITY, so they bypass these policies entirely. That is what keeps
-- approved -> checked_in -> refused working at the door.
--
-- Expand-contract: additive tightening of an existing policy, no column or
-- signature change, so the currently deployed app version keeps working (it
-- never sends a status).

alter policy guests_insert on public.guests
  with check (
    public.can_write_guests(event_id)
    and added_by = (select auth.uid())
    -- A direct client insert always creates an on-the-list guest. Every other
    -- status is produced by a trigger or a SECURITY DEFINER RPC, both of which
    -- bypass RLS. (86ey9c5fp)
    and status = 'approved'
    and (
      -- the only sources a direct client insert legitimately produces …
      source in ('app', 'door')
      -- … unless the adder is quota-exempt (no personal limit to bypass): admin
      -- of the venue or organizer of the event may also carry the RPC-only
      -- sources. A non-exempt staffer/doorhost forging them is rejected here.
      or public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  );

alter policy guests_update on public.guests
  with check (
    anonymized_at is null
    and public.can_write_guests(event_id)
    and (
      added_by = (select auth.uid())
      or public.has_venue_role(public.event_venue(event_id), '{admin,doorhost}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
    -- No client write may park a guest in the request-lifecycle statuses:
    -- both are invisible on every surface, and `pending` additionally used to
    -- read as "holds no slot" on the per-adder meters. (86ey9c5fp)
    and status not in ('pending', 'denied')
  );

comment on policy guests_insert on public.guests is
  'Client inserts: own added_by, app/door source (RPC-only sources for exempt roles), and status pinned to approved (86ey9c5fp). Triggers and SECURITY DEFINER RPCs bypass RLS and produce the other statuses.';

comment on policy guests_update on public.guests is
  'Client updates: own guest or admin/doorhost/organizer, never on an anonymized row, and may never leave the row in pending/denied — guest_requests owns that lifecycle (86ey9c5fp).';
