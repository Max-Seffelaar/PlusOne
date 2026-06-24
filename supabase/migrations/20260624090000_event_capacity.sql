-- Event templates · part 1/3 — hard total-event capacity (ClickUp 86exyp8gn).
--
-- A reusable event template (parts 2/3) carries a headline capacity like "1200
-- normaal / 1800 open air". That number is a HARD physical-room limit on the whole
-- event, seeded onto events.capacity when an event is created from a template. This
-- migration adds the column + its enforcement independently of templates — an event
-- can carry a manual cap with no template.
--
-- Capacity is enforced exactly like the quota engine (20260613180000): an AFTER
-- trigger on guests that recomputes the event total and raises on a NET increase
-- past the cap. It counts SLOTS (1 + plus_ones) = people through the door — the same
-- unit as personal quota — with the same removal/denied live-rule (#22), with ONE
-- deliberate divergence: LANDING guests DO count (they occupy the room; #31 exempts
-- landing from PERSONAL quota only, a per-staffer fraud limit, not a room limit).
-- There is NO exempt actor: admins and organizers also cannot overfill the room.
-- NULL capacity = no cap (every existing event), so the trigger is a no-op until a
-- cap is set — existing guest/quota behaviour is unchanged.

alter table public.events
  add column capacity integer check (capacity is null or capacity > 0);

comment on column public.events.capacity is
  'Optional HARD total-event capacity: max people through the door, counted as '
  'slots = sum(1 + plus_ones) over non-removed/non-denied guests (landing included). '
  'NULL = no cap. Enforced by enforce_event_capacity (SQLSTATE 45005); seeded from a '
  'template on create.';

-- ---------------------------------------------------------------------------
-- Capacity math — SECURITY DEFINER so the trigger/helper see every guest
-- regardless of the caller's RLS scope. Pinned search_path; only the UI counter
-- (event_capacity_status) is granted to app roles, mirroring event_quota_status.
-- ---------------------------------------------------------------------------

-- Per-row contribution to TOTAL EVENT CAPACITY. Mirrors guest_personal_contribution
-- but WITHOUT the landing exemption: a landing guest occupies a slot like anyone else.
create or replace function public.guest_capacity_contribution(g public.guests, p_went_live_at timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when g.status = 'denied' then 0                  -- never came through the door
    when g.status <> 'removed' then 1 + g.plus_ones
    -- removed: only counts if removed at/after go-live (#22 anti-reuse)
    when p_went_live_at is not null and g.removed_at >= p_went_live_at then 1 + g.plus_ones
    else 0
  end;
$$;

-- Total capacity consumption for one event.
create or replace function public.event_capacity_consumption(p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(public.guest_capacity_contribution(g, e.went_live_at)), 0)::int
  from public.guests g
  join public.events e on e.id = g.event_id
  where g.event_id = p_event_id;
$$;

-- Enforcement (AFTER INSERT/UPDATE on guests), mirroring enforce_guest_quota:
-- short-circuit when the event has no cap; only a NET increase can breach; recompute
-- the total from the table (correct for bulk inserts — the running total only grows,
-- so an over-cap batch trips here and the whole statement rolls back).
create or replace function public.enforce_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity int;
  v_went_live_at timestamptz;
  v_old int := 0;
  v_new int;
  v_total int;
begin
  select e.capacity, e.went_live_at into v_capacity, v_went_live_at
  from public.events e where e.id = new.event_id;

  if v_capacity is null then
    return null;                          -- no cap on this event → nothing to enforce
  end if;

  v_new := public.guest_capacity_contribution(new, v_went_live_at);
  if tg_op = 'UPDATE' and old.event_id = new.event_id then
    v_old := public.guest_capacity_contribution(old, v_went_live_at);
  end if;

  -- Only a net increase can breach the cap (lowering plus_ones / removing is free).
  if v_new > v_old then
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

create trigger enforce_event_capacity
  after insert or update on public.guests
  for each row execute function public.enforce_event_capacity();

-- UI capacity counter (parity with event_quota_status, #17). Returns an aggregate
-- for an event the caller can already see (member or organizer) — a non-member gets
-- no row, so it leaks nothing. Doorhost is a venue member → the door can read it.
create or replace function public.event_capacity_status(p_event_id uuid)
returns table (capacity integer, consumed integer, remaining integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.capacity,
    public.event_capacity_consumption(p_event_id),
    case when e.capacity is null then null
         else greatest(e.capacity - public.event_capacity_consumption(p_event_id), 0) end
  from public.events e
  where e.id = p_event_id
    and (public.is_venue_member(e.venue_id) or public.is_event_organizer(e.id));
$$;

-- ---------------------------------------------------------------------------
-- Privileges — internal math stays internal; only the UI counter is callable.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.guest_capacity_contribution(public.guests, timestamptz),
  public.event_capacity_consumption(uuid),
  public.enforce_event_capacity()
from public, anon, authenticated, service_role;

revoke execute on function public.event_capacity_status(uuid) from public, anon;
grant execute on function public.event_capacity_status(uuid) to authenticated, service_role;
