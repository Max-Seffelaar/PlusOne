-- Incremental check-in (test feedback Max, 15 jun 2026): a guest with +N may
-- arrive in parts ("2 nu, 3 later"). We keep ONE check_in row per guest
-- (`guest_id` is unique — first device wins, #11) but allow `plus_ones_arrived`
-- to be RAISED over time via the door's "nog inchecken" action.
--
-- This trigger enforces the model in the database (#22, not only in the UI):
--   * caps `plus_ones_arrived` at the guest's allotment (`guests.plus_ones`), so
--     a door can never check in more people than the guest was given;
--   * on UPDATE the count is MONOTONIC — it only goes up, so an offline replay or
--     a stale value can never lower it (idempotent increments).
--
-- The first check-in's identity + time stay put: the increment path writes only
-- `plus_ones_arrived`, and the existing `check_ins_update_own_device` RLS keeps an
-- update scoped to that device's own check-in.

create or replace function public.cap_check_in_arrivals()
returns trigger
language plpgsql
as $$
declare
  v_allotment integer;
begin
  select plus_ones into v_allotment from public.guests where id = NEW.guest_id;
  -- Clamp into [0, allotment].
  NEW.plus_ones_arrived := least(greatest(coalesce(NEW.plus_ones_arrived, 0), 0), coalesce(v_allotment, 0));
  if TG_OP = 'UPDATE' then
    -- Arrivals are monotonic: never decrease below what already arrived.
    NEW.plus_ones_arrived := greatest(NEW.plus_ones_arrived, OLD.plus_ones_arrived);
  end if;
  return NEW;
end;
$$;

-- BEFORE so it shapes NEW prior to the AFTER audit trigger (decision #4).
create trigger check_ins_cap_arrivals
  before insert or update on public.check_ins
  for each row execute function public.cap_check_in_arrivals();
