-- Check-in D (z8uq9m2vg6) — absolute-count upsert: stale guard + first-wins pin.
--
-- Design: onboarding-orchestration-claude-code.md §9.2 (spike, 2026-10-06).
--
-- The door now records a party's arrival as ONE check_ins row per guest whose
-- plus_ones_arrived is an ABSOLUTE number, written as an upsert on the row's own
-- id (`.upsert(row, { onConflict: 'id' })`). "Check in all (N)" and "Check in 1"
-- are the same write with a different number; a second tap offline replaces the
-- first in the outbox instead of being refused (#25). There is no check-in RPC
-- and no server action: the outbox writes check_ins directly through RLS
-- (check_ins_insert / check_ins_update_door), so every rule lives in a trigger.
--
-- The existing cap_check_in_arrivals trigger already keeps the count in range
-- and monotonic. Two gaps remained once the write became an upsert (measured in
-- the spike as door@ over PostgREST):
--
--   1. Staleness. An outbox item that reaches the server AFTER a newer write
--      (another device, or a reordered replay) still landed: it moved
--      client_timestamp backwards and wrote a pointless audit row. For void and
--      revive it was worse — an old revive could put a guest back inside after a
--      colleague's newer void.
--   2. Identity. PostgREST's ON CONFLICT update sets EVERY column in the payload.
--      A "+1" from colleague B on the row colleague A created would rewrite
--      checked_by/checked_at/device_id to B, breaking first-wins (#11) and moving
--      the guest into another inflow bucket. guard_check_in_actor_change allows it
--      (B is door-capable), so it has to be pinned, not merely validated.
--
-- client_timestamp comes from the DEVICE clock (reviews of PR #423), so it is
-- trusted only as far as it must be: clamped to the server's now(), and used
-- only to order the writes that flip the void state (it is the stamp of the
-- last such change; count-only writes neither read nor move it). A superseded
-- void/revive, and any change to a row that is voided, raise SQLSTATE PO409 —
-- never a silent success — which the outbox settles and the door refetches.
-- A check-in is pinned to its guest, and cannot be inserted already undone.
--
-- Maximum: decision Max 2026-10-06 — above 1 + plus_ones the count is CLAMPED,
-- not refused. cap_check_in_arrivals stays exactly as it is. A refusal would turn
-- an offline replay into a dead letter whenever an admin lowered plus_ones in the
-- meantime, losing a real door action. pgTAP proves "never above 1 + plus_ones",
-- including through a direct upsert.
--
-- Trigger order: Postgres fires BEFORE ROW triggers in name order. This one is
-- named check_ins_a_stale_guard so it runs before check_ins_cap_arrivals,
-- check_ins_guard_actor_change and check_ins_set_scope: a superseded write is refused
-- into a no-op before any clamp or validation sees it, and the identity columns
-- are restored before the actor guard asks "is this statement changing the
-- actor?" (it then sees no change).

create or replace function public.check_in_stale_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Client writes only — the same discriminator as guard_check_in_actor_change
  -- (20260812140000): PostgREST runs every client request as authenticated/anon.
  -- Migrations, seeds, pgTAP fixtures and retention jobs run as the owner and
  -- are not outbox replays. check_out_guest is SECURITY INVOKER, so it is a
  -- client write and IS guarded.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- 0. Clock clamp. client_timestamp is device-controlled: a clock running
  --    ahead, or a hand-crafted PostgREST call, could plant 2099-… and make
  --    every later undo look stale. Never store a moment later than now().
  if new.client_timestamp is not null and new.client_timestamp > now() then
    new.client_timestamp := now();
  end if;

  if tg_op = 'INSERT' then
    -- A check-in is born active. An already-undone row would only squat the
    -- guest's one row (guest_id is UNIQUE) and turn their real check-in into a
    -- "duplicate" (review of PR #423).
    if new.voided_at is not null or new.voided_by is not null then
      raise exception using errcode = '42501',
        message = 'A check-in cannot be created already undone.';
    end if;
    return new;
  end if;

  -- 1. A check-in belongs to one guest for good (review of PR #423, B1).
  --    Moving it to another guest is an undo without the undo right (the
  --    first guest stops counting) and would carry arrivals past the new
  --    guest's allotment (the cap keeps greatest(new, OLD)). event_id and
  --    venue_id follow guest_id (check_ins_set_scope re-derives them).
  if new.guest_id is distinct from old.guest_id then
    raise exception using errcode = '42501',
      message = 'A check-in cannot move to another guest.';
  end if;

  -- 2. Ordering. client_timestamp on the row is the stamp of the last change
  --    of the void state (the first check-in, an undo, a re-check-in). Only
  --    those writes are ordered by it; a count-only write ("+1") neither
  --    reads nor moves it, so a colleague's later "+1" cannot make a
  --    legitimate offline undo look stale (S1b).
  if (old.voided_at is null) <> (new.voided_at is null) then
    if new.client_timestamp is null or new.client_timestamp = old.client_timestamp then
      -- No fresh stamp sent (check_out_guest, an older bundle): the server
      -- stamps the moment it happened, so a later stale revive can be told
      -- apart (S1a).
      new.client_timestamp := now();
    elsif old.client_timestamp is not null and new.client_timestamp < old.client_timestamp then
      -- Superseded: someone changed this check-in after this action was
      -- taken. Never a silent "synced" (S1c): the outbox settles PO409 and
      -- the door refetches.
      raise exception using errcode = 'PO409',
        message = 'This check-in changed on another device. Showing the latest.';
    end if;
  else
    if old.voided_at is not null then
      -- A count change (or a replay) landing on a check-in that was undone
      -- meanwhile: nobody is inside to count. Reported, for every role (S2).
      raise exception using errcode = 'PO409',
        message = 'This check-in was undone on another device. Showing the latest.';
    end if;
    new.client_timestamp := old.client_timestamp;
  end if;

  -- 3. First-wins identity (#11). Only a revive (voided -> active) starts a
  --    new arrival and may move these; every other update — a "+1" from a
  --    colleague, a replay, a void — keeps the original arrival.
  if not (old.voided_at is not null and new.voided_at is null) then
    new.checked_by     := old.checked_by;
    new.checked_at     := old.checked_at;
    new.device_id      := old.device_id;
    new.offline_synced := old.offline_synced;
    new.synced_by      := old.synced_by;
  end if;
  return new;
end;
$$;

comment on function public.check_in_stale_guard() is
  'BEFORE INSERT/UPDATE on check_ins, client writes only: clamps client_timestamp to now(); refuses an already-voided INSERT and moving a check-in to another guest (42501); orders void/revive by client_timestamp (the stamp of the last void-state change; count-only writes never move it) and raises PO409 for a superseded void/revive or any change to a voided row; stamps now() on a void/revive that sent no fresh stamp; pins checked_by/checked_at/device_id/offline_synced/synced_by to the first arrival unless reviving (z8uq9m2vg6, reviews of PR #423).';

drop trigger if exists check_ins_a_stale_guard on public.check_ins;
create trigger check_ins_a_stale_guard
  before insert or update on public.check_ins
  for each row execute function public.check_in_stale_guard();
