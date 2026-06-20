-- Keep guests.status a faithful mirror of door actions AT RUNTIME (test feedback
-- Max, 19 jun 2026: "het weigeren zit niet overal goed erin").
--
-- The door records presence in check_ins and refusals in refusals (offline-first,
-- #25); the door view + analytics derive from those tables, so they are correct.
-- But the Gastenlijst reads guests.status directly, and a STAFF member may not
-- read check_ins/refusals at all (RLS #17) — guests.status is the only signal
-- they have. The door flow only inserted into check_ins/refusals and never moved
-- guests.status, so a check-in or refusal done at the door stayed invisible in
-- the Gastenlijst ("onderweg" forever). The seed already assumes the mirror
-- (it hand-sets status checked_in/refused next to the check_ins/refusals rows);
-- these triggers make the runtime match the seed.
--
-- Quota-neutral: user_event_consumption (#22) counts approved/checked_in/refused
-- alike (only denied/removed differ), so none of these transitions change a
-- user's consumption — the quota trigger never fires a raise on them.
--
-- Audit: the status transition is itself recorded (the audit trigger already maps
-- checked_in->'check_in', refused->'refuse'); this is an intentional state record
-- alongside the check_ins/refusals detail row, not a replacement for it.
--
-- SECURITY DEFINER: a doorhost may INSERT a check_in/refusal but not UPDATE guests
-- (RLS) — the system reflects the high-level status on their behalf. Each guard
-- (status precondition) makes an offline replay / duplicate idempotent.

-- ── Check-in / void / revive → guests.status ────────────────────────────────
create or replace function public.sync_guest_status_from_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A fresh, non-voided check-in: the guest is now inside.
    if new.voided_at is null then
      update public.guests set status = 'checked_in'
       where id = new.guest_id and status = 'approved';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.voided_at is null and new.voided_at is not null then
      -- Soft-void ("check-in terugdraaien", #3): back to onderweg.
      update public.guests set status = 'approved'
       where id = new.guest_id and status = 'checked_in';
    elsif old.voided_at is not null and new.voided_at is null then
      -- Re-checkin (revive): inside again.
      update public.guests set status = 'checked_in'
       where id = new.guest_id and status = 'approved';
    end if;
    -- A plain top-up (plus_ones_arrived changes, voided_at unchanged) keeps the
    -- guest 'checked_in' — no status move needed.
  end if;
  return null; -- AFTER trigger: return value ignored
end;
$$;

create trigger check_ins_sync_guest_status
  after insert or update on public.check_ins
  for each row execute function public.sync_guest_status_from_checkin();

-- ── Refusal → guests.status ─────────────────────────────────────────────────
create or replace function public.sync_guest_status_from_refusal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Turned away at the door: reflect it on the guest. Only from an on-the-list
  -- status; never resurrect a removed/denied guest, and re-refusals are no-ops.
  update public.guests set status = 'refused'
   where id = new.guest_id and status in ('approved', 'checked_in');
  return null;
end;
$$;

create trigger refusals_sync_guest_status
  after insert on public.refusals
  for each row execute function public.sync_guest_status_from_refusal();
