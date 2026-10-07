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
-- client_timestamp comes from the DEVICE clock (review of PR #423), so it is
-- trusted only as far as it must be: clamped to the server's now() on every
-- client write, used to order only the writes that flip the void state, and
-- kept monotonic on the row. Count-only writes are never dropped for being
-- older; the cap trigger already makes them safe to reorder.
--
-- Maximum: decision Max 2026-10-06 — above 1 + plus_ones the count is CLAMPED,
-- not refused. cap_check_in_arrivals stays exactly as it is. A refusal would turn
-- an offline replay into a dead letter whenever an admin lowered plus_ones in the
-- meantime, losing a real door action. pgTAP proves "never above 1 + plus_ones",
-- including through a direct upsert.
--
-- Trigger order: Postgres fires BEFORE ROW triggers in name order. This one is
-- named check_ins_a_stale_guard so it runs before check_ins_cap_arrivals,
-- check_ins_guard_actor_change and check_ins_set_scope: a stale write is turned
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
  -- client write and IS guarded; it never sends client_timestamp, so its rows
  -- keep the stored one and are never stale.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- 0. Clock clamp (review of PR #423). client_timestamp is device-controlled:
  --    a clock running ahead, or a hand-crafted PostgREST call, could plant
  --    2099-… and turn every later write — an admin's undo included — into a
  --    silent "stale" no-op. Never store a moment later than the server's now.
  --    Clamped to now(), not now() + a tolerance: with a tolerance, an undo
  --    stamped "now" within that window would still lose to the planted value.
  --    Applies to the first INSERT too, so a check-in cannot be born frozen.
  if new.client_timestamp is not null and new.client_timestamp > now() then
    new.client_timestamp := now();
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- 1. Stale void/revive: only a write that CHANGES the void state is ordered
  --    by client_timestamp — an old revive must not undo a newer void (or the
  --    reverse). Returning OLD writes an identical row, so the audit trigger
  --    (diff only) logs nothing and the client sees success = synced.
  --    Count-only writes are NOT dropped when older: cap_check_in_arrivals keeps
  --    the count monotonic and capped, so a colleague whose clock runs behind
  --    still gets their "+1" counted.
  if (old.voided_at is null) <> (new.voided_at is null) then
    if new.client_timestamp is not null
       and old.client_timestamp is not null
       and new.client_timestamp < old.client_timestamp then
      return old;
    end if;
  elsif old.voided_at is not null then
    -- 2. A count change on a VOIDED row (a queued "+1" that lands after
    --    someone undid the check-in) is not a check-in: nobody is inside.
    --    No-op rather than counting people on a void. (Without the undo right
    --    the RESTRICTIVE policy still refuses the resulting voided row with
    --    42501; the outbox settles that case, see replay.ts.)
    return old;
  end if;

  -- 3. The stored client_timestamp never moves back: an older count-only write
  --    still lands its count but keeps the newer stamp, so a later void/revive
  --    is ordered against the latest write the row has seen.
  if old.client_timestamp is not null
     and (new.client_timestamp is null or new.client_timestamp < old.client_timestamp) then
    new.client_timestamp := old.client_timestamp;
  end if;

  -- 4. First-wins identity (#11). Only a revive (voided -> active) starts a new
  --    arrival and may move these; every other update — a "+1" from a colleague,
  --    a replay, a void — keeps the original arrival.
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
  'BEFORE INSERT/UPDATE on check_ins, client writes only: clamps client_timestamp to now(); drops a void/revive older than the stored client_timestamp (no-op, no audit row); refuses a count change on a voided row (no-op); keeps the stored client_timestamp monotonic; pins checked_by/checked_at/device_id/offline_synced/synced_by to the first arrival unless the update is a revive. Sorts before the cap trigger (z8uq9m2vg6, spike 9.2, review of PR #423).';

drop trigger if exists check_ins_a_stale_guard on public.check_ins;
create trigger check_ins_a_stale_guard
  before insert or update on public.check_ins
  for each row execute function public.check_in_stale_guard();
