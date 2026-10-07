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

  -- 1. Stale: an outbox item older than what the row already reflects is a
  --    no-op. Returning OLD writes an identical row, so the audit trigger
  --    (diff only) logs nothing and the client sees success = synced. Covers
  --    check-in, "Check in 1", void and revive alike: they all send
  --    client_timestamp now.
  if new.client_timestamp is not null
     and old.client_timestamp is not null
     and new.client_timestamp < old.client_timestamp then
    return old;
  end if;

  -- 2. First-wins identity (#11). Only a revive (voided -> active) starts a new
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
  'BEFORE UPDATE on check_ins, client writes only: drops a write whose client_timestamp is older than the stored one (no-op, no audit row), and pins checked_by/checked_at/device_id/offline_synced/synced_by to the first arrival unless the update is a revive. Sorts before the cap trigger (z8uq9m2vg6, spike 9.2).';

drop trigger if exists check_ins_a_stale_guard on public.check_ins;
create trigger check_ins_a_stale_guard
  before update on public.check_ins
  for each row execute function public.check_in_stale_guard();
