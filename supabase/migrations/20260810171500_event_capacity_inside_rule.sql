-- Fix (review SW3, ClickUp 86ey9e9r9) — the EVENT-CAPACITY engine still keyed the
-- "removal frees the slot" rule on events.went_live_at, which is dead.
--
-- 20260624200000 (event lifecycle) repointed the PERSONAL-quota engine off
-- events.went_live_at onto "is the guest physically inside" (a non-voided
-- check_ins row), because the status machine that stamped went_live_at was
-- retired the same day. `guest_capacity_contribution` — the hard total-event
-- capacity engine from 20260624090000 — was NOT repointed and kept its
-- `p_went_live_at` parameter. Nothing sets events.status = 'live' anymore
-- (changeEventStatus has no call site; the UI has no status control), so
-- went_live_at is permanently NULL and that branch is unreachable:
--
--   * A guest who checked in and was afterwards set to status='removed'
--     contributed 0 to event capacity while contributing 1 + plus_ones to the
--     personal quota of the staffer who added them. Two engines, same guest,
--     opposite answers — and the room-capacity one under-counted, so a
--     hard-capped event could be filled past its cap (45005 never fires) by
--     checking people in and removing them.
--
-- Fix: same is_inside basis as guest_personal_contribution, so both engines
-- answer the amended #22 identically ("removal frees the slot unless the guest
-- is already in the room"). The one deliberate divergence from the personal
-- engine is preserved: capacity has NO source exemption — a landing/permanent
-- guest occupies the room like anyone else (#31 exempts them from the PERSONAL
-- fraud limit only, not from the physical room).
--
-- Secondary correction, same rewrite: `refused` guests no longer consume
-- capacity unless they are inside. The old function counted them (its only
-- zero-branches were 'denied' and the dead removed/go-live one), which
-- contradicted spec #44 ("refused never contributes to on-list/inside
-- anywhere") — someone turned away at the door does not occupy the room. The
-- refused-after-check-in case (sync_guest_status_from_refusal flips the status
-- without voiding the check-in) keeps counting via p_is_inside, exactly as it
-- does for the personal quota.
--
-- Known, unchanged asymmetry (parity with the quota engine, not a regression):
-- the cap is enforced by a trigger on `guests` only. A check-in that flips a
-- removed guest to checked_in computes the same is_inside for OLD and NEW, so
-- there is no net increase and no cap re-check — by design, the door is never
-- blocked by an admin-side limit (#25).

-- ---------------------------------------------------------------------------
-- 1. Per-row contribution — is_inside basis
-- ---------------------------------------------------------------------------
create or replace function public.guest_capacity_contribution(g public.guests, p_is_inside boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    -- On the list / expected / inside → occupies the room.
    when g.status in ('pending', 'approved', 'checked_in') then 1 + g.plus_ones
    -- removed / denied / refused: frees the room UNLESS physically inside
    -- (a non-voided check-in) — #22 as amended 24 jun 2026.
    when p_is_inside then 1 + g.plus_ones
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Total consumption for one event — computes is_inside per guest
-- ---------------------------------------------------------------------------
-- Mirrors user_event_consumption; the events join is gone with went_live_at.
create or replace function public.event_capacity_consumption(p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    public.guest_capacity_contribution(
      g,
      exists (
        select 1 from public.check_ins ci
        where ci.guest_id = g.id and ci.voided_at is null
      )
    )
  ), 0)::int
  from public.guests g
  where g.event_id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Enforcement trigger — body unchanged from 20260714100000 (incl. the
--    advisory-lock serialisation) except for the contribution basis.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity int;
  v_is_inside boolean;
  v_old int := 0;
  v_new int;
  v_total int;
begin
  select e.capacity into v_capacity
  from public.events e where e.id = new.event_id;

  if v_capacity is null then
    return null;                          -- no cap on this event → nothing to enforce
  end if;

  -- OLD and NEW are the same guest row, so their check-in state is identical.
  v_is_inside := exists (
    select 1 from public.check_ins ci
    where ci.guest_id = new.id and ci.voided_at is null
  );

  v_new := public.guest_capacity_contribution(new, v_is_inside);
  if tg_op = 'UPDATE' and old.event_id = new.event_id then
    v_old := public.guest_capacity_contribution(old, v_is_inside);
  end if;

  -- Only a net increase can breach the cap (lowering plus_ones / removing is free).
  if v_new > v_old then
    -- Serialise concurrent adds into this same event's total capacity.
    perform pg_advisory_xact_lock(3, hashtext(new.event_id::text));

    v_total := public.event_capacity_consumption(new.event_id);
    if v_total > v_capacity then
      raise exception using
        errcode = '45005',
        message = format('Capaciteit bereikt: dit zou %s van %s plekken voor dit event gebruiken.',
                         v_total, v_capacity),
        hint = format('capacity_exceeded;consumed=%s;capacity=%s', v_total, v_capacity);
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Retire the dead overload + re-assert the internal-only posture
-- ---------------------------------------------------------------------------
-- Both callers above now resolve to the boolean overload; drop the timestamptz
-- one so the name has exactly one signature (as 20260624200000 did for the
-- personal helper).
drop function if exists public.guest_capacity_contribution(public.guests, timestamptz);

-- A freshly created function is granted to PUBLIC by default, so the new
-- boolean overload MUST be revoked to keep the posture of 20260624090000.
revoke execute on function
  public.guest_capacity_contribution(public.guests, boolean),
  public.event_capacity_consumption(uuid),
  public.enforce_event_capacity()
from public, anon, authenticated, service_role;
