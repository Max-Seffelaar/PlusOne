-- M4 follow-up (ClickUp 86ey9c5fp), design decision 4A — a `pending` guest row
-- no longer holds a personal-quota or request-link slot.
--
-- The finding (fresh-session `/code-review` of M4, non-blocking):
-- `guest_personal_contribution` (20260624200000) charges 1 + plus_ones for
-- status 'pending', but no shipped surface renders a pending guest —
-- `fetchGuests` (src/features/po/queries.ts) and the door's own query both scope
-- to ('approved','checked_in','refused'), and the po `Guest` type has no pending
-- variant. The slot was consumed invisibly: a staff member could be at their
-- quota with nothing on screen accounting for it, and no UI to free it.
--
-- Why 'pending' is inert rather than merely under-rendered (verified 11 aug 2026
-- across every write path):
--   * `public.guests.status` DEFAULTS to 'approved';
--   * every guest-creating RPC inserts 'approved' explicitly — the whole request
--     flow (submit_via_request_link / approve_guest_request / the landing and
--     permanent-sync paths) keeps the awaiting-approval state on
--     `guest_requests.status`, and only materializes a `guests` row on approval;
--   * the app's own insert paths (guests/actions.ts, the door outbox gateway)
--     never send a status at all.
-- The only producers are the seed's Aïcha fixture (source 'landing', already
-- exempt under #31) and a hand-written PostgREST insert. The branch is therefore
-- vestigial: it dates from before `guest_requests` owned the pending lifecycle.
--
-- Decision (Max, 11 aug 2026): stop charging it, rather than build UI for a
-- state that is never produced.
--
-- SECURITY NOTE — this widens no bypass. A hand-crafted insert with
-- status='pending' now consumes 0 personal/link slots, but such a row is inert
-- in both directions: it is invisible to every list AND to the door (the door
-- query excludes it), so it can never be checked in while pending. The moment it
-- becomes usable — an UPDATE to 'approved'/'checked_in' — `enforce_guest_quota`
-- and `enforce_request_link_max` both fire on a NET INCREASE in contribution and
-- charge it in full, which is exactly the pgTAP case added with this migration.
-- `guests_insert` RLS still pins `added_by` to the caller, so no third party's
-- quota can be touched either way.
--
-- DELIBERATELY UNCHANGED: `guest_capacity_contribution` (hard event capacity,
-- 45005) keeps counting pending. Capacity answers a different question — "does
-- this person occupy a spot in the room" — and has no #31 source exemption, so
-- folding pending out of it is a separate decision about capacity, not part of
-- the flagged personal-quota bug. Flagged for Max, not silently changed.
--
-- ⚠ IN-FLIGHT INTERACTION (86ey9e9r9, PR #244, open at the time of writing):
-- that PR rewrites `guest_capacity_contribution` onto the same `p_is_inside`
-- basis as the personal engine, explicitly so "both engines answer the amended
-- #22 identically", and its rewrite KEEPS the 'pending' branch. Once both land,
-- the two helpers are identical in shape except for the #31 source exemption
-- and exactly one thing: pending. A pending row would then consume hard event
-- capacity while consuming no personal quota. Unreachable in practice (no write
-- path produces a pending guest — see above), so this is a consistency wart,
-- not a live bug. Whichever of the two PRs merges second should decide the
-- pending branch for BOTH helpers in one place; recommendation is to drop it in
-- capacity too, for the same reason it is dropped here.

-- ── 1. Personal quota per adder (#22, #31) ──────────────────────────────────

create or replace function public.guest_personal_contribution(g public.guests, p_is_inside boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when g.source in ('landing', 'permanent') then 0   -- #31 + #11: outside personal quota
    -- On the list / expected / inside → holds the slot. 'pending' is NOT on the
    -- list: no surface renders it and the door cannot check it in (see header).
    when g.status in ('approved', 'checked_in') then 1 + g.plus_ones
    -- pending / removed / denied / refused: frees the slot UNLESS physically
    -- inside (a non-voided check-in) — anti-fraud, you can't reclaim a slot from
    -- someone already in the room (#22, amended 24 jun 2026).
    when p_is_inside then 1 + g.plus_ones
    else 0
  end;
$$;

-- ── 2. Per-request-link headcount cap (45006) ───────────────────────────────
-- Same vestigial branch, same reasoning: the link flow itself only ever inserts
-- 'approved' (auto-approve and manual approval alike), so this is dead weight
-- with the same invisible-hold footgun. Kept in lockstep with the personal rule
-- so "holds a slot" means one thing across the quota engine.

create or replace function public.link_headcount_contribution(g public.guests, p_is_inside boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when g.status in ('approved', 'checked_in') then 1 + g.plus_ones
    when p_is_inside then 1 + g.plus_ones
    else 0
  end;
$$;
