-- Door outbox owner-stamp + cross-user sync (ClickUp 86ey9et0h, decision #40).
--
-- ── The problem ─────────────────────────────────────────────────────────────
-- A venue door tablet passes between successive doorhosts. Doorhost A works a
-- shift offline, taps N check-ins into the outbox, and hands the tablet over
-- before it ever reconnects. #233 (86ey9et07) made sign-out wipe the device, so
-- A's un-synced check-ins were DESTROYED rather than misattributed to B. That
-- traded one harm for a worse one: a lost door check-in is unacceptable
-- (decision by Max, 2026-08-12), and the guest is standing inside the venue
-- whether or not the row ever reached Postgres.
--
-- The fix keeps the entries and drains them under B's session. For that to be
-- honest, the row must still say A did the check-in — B only transported it.
--
-- ── Why RLS had to move ─────────────────────────────────────────────────────
-- `check_ins_insert` (20260613120000) pinned `checked_by = auth.uid()`. At drain
-- time the only live session is B's, so the pin left exactly two outcomes:
--   * write `checked_by = B`  -> the append-only audit trail now states that B
--     admitted guests they never saw. Falsifying the audit trail is the one
--     thing this feature may not do.
--   * write `checked_by = A`  -> rejected 42501, which `replay.ts` classifies as
--     TERMINAL, dead-letters the entry, and loses the check-in anyway.
-- So the pin is relaxed to a BOUND rather than an identity: `checked_by` may
-- name someone other than the caller, but only a user who could themselves have
-- worked that event's door. A guest, an outsider, or a staff member with no door
-- role is still rejected. The caller must independently pass `can_check_in`, so
-- this grants nothing to anyone who wasn't already admitting guests.
--
-- What is deliberately NOT claimed: the server cannot verify that A really
-- tapped the button — A's session is long gone, so "A did this" is a client
-- assertion carried in the outbox envelope (`ownerId`, stamped at enqueue).
-- The bound above is what keeps that assertion inside the set of people the
-- venue already trusts at the door, and `synced_by` + the audit log record who
-- actually transmitted it. Residual risk, accepted with the decision: a
-- door-scoped user can attribute a check-in to a door-scoped colleague. That is
-- detectable (audit_log.actor_id is auth.uid(), the diff carries checked_by) and
-- was already possible on the UPDATE path before this migration — see below.
--
-- ── The UPDATE hole this also closes ────────────────────────────────────────
-- `check_ins_update_door` (20260617020000) checked only `can_check_in(event)`
-- with NO predicate on `checked_by`. Since permissive policies are OR-ed, that
-- made the sibling `check_ins_update_own_device` pin non-binding: any
-- door-scoped user could UPDATE an existing check-in and rewrite `checked_by`
-- to an arbitrary uuid — including a user with no relation to the venue at all.
-- `reviveCheckIn` (src/features/door/outbox/gateway.ts) writes that column on
-- exactly this path. It is now held to the same bound as INSERT, so this
-- migration nets out TIGHTER than the status quo despite relaxing the pin.
--
-- ── Expand-contract ─────────────────────────────────────────────────────────
-- Every change is a widening of a WITH CHECK plus one nullable column, so the
-- currently deployed bundle (which always sends checked_by = its own uid and no
-- synced_by) keeps passing unchanged. No column is renamed or dropped.

-- ---------------------------------------------------------------------------
-- Helper: may the CURRENT user record a door write attributed to p_actor_id?
-- ---------------------------------------------------------------------------
-- Mirrors can_check_in's role test for an arbitrary user instead of auth.uid().
-- Both halves are required: the caller must be able to work this door right now
-- (event open/live + door role), and the named actor must be door-capable at
-- this event too. Folding the caller check in here rather than AND-ing it at
-- each call site also bounds the information this function can leak — it only
-- ever answers for events the caller already works.
--
-- The actor branch deliberately does NOT re-test event status: A tapped the
-- check-in while the event was live, and an event that has since moved to
-- 'closed' must not strand A's queued entries. The caller's own can_check_in
-- already refuses a drain into a closed event.
create or replace function public.can_record_check_in_for(p_event_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_check_in(p_event_id)
    and (
      p_actor_id = (select auth.uid())
      or exists (
        select 1
        from public.events e
        where e.id = p_event_id
          and (
            exists (
              select 1 from public.venue_memberships m
              where m.venue_id = e.venue_id
                and m.user_id = p_actor_id
                and m.roles && '{admin,doorhost}'::public.venue_role[]
            )
            or exists (
              select 1 from public.event_organizers eo
              where eo.event_id = e.id and eo.user_id = p_actor_id
            )
          )
      )
    );
$$;

revoke execute on function public.can_record_check_in_for(uuid, uuid) from public, anon;
grant execute on function public.can_record_check_in_for(uuid, uuid) to authenticated, service_role;

comment on function public.can_record_check_in_for(uuid, uuid) is
  'True when the current user may record a door write naming p_actor_id as its actor: the caller must pass can_check_in for the event, and p_actor_id must be the caller or another door-capable user of that event (86ey9et0h).';

-- ---------------------------------------------------------------------------
-- synced_by — who transmitted the row, when that is not who performed it
-- ---------------------------------------------------------------------------
-- Nullable on purpose: the overwhelmingly common case is a device draining its
-- own entries under its own session, where checked_by already answers "who",
-- and writing a redundant copy of auth.uid() on every check-in buys nothing.
-- It is populated only when the outbox owner differs from the draining session,
-- which makes a non-null value self-documenting: "this row was carried across a
-- user switch on a shared device". The audit log independently records the
-- transmitting user as actor_id; this column exists so the door/cockpit UI can
-- show the hand-off without joining the audit trail.
alter table public.check_ins
  add column if not exists synced_by uuid references public.user_profiles (id) on delete restrict;
alter table public.refusals
  add column if not exists synced_by uuid references public.user_profiles (id) on delete restrict;

comment on column public.check_ins.synced_by is
  'Who transmitted the INSERT that created this row, when that was not the doorhost who admitted the guest (shared tablet, doorhost hand-off). Scope is deliberately the insert only: later UPDATEs (top-up, uitchecken, revive) do not maintain it, so NULL means "this row was inserted by its own actor", never "no hand-off ever touched it". The audit log is the complete per-change record. Pinned to auth.uid() on INSERT by RLS; on UPDATE only check_ins_update_door pins it, so treat it as advisory provenance rather than a security control (86ey9et0h).';
comment on column public.refusals.synced_by is
  'See check_ins.synced_by — the session that transmitted this refusal''s INSERT, when that differs from refused_by. refusals has no UPDATE policy at all, so here the value is immutable (86ey9et0h).';

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- INSERT: actor bound (above) replaces the auth.uid() identity pin. synced_by is
-- pinned hard — it answers "who transmitted this", which the server DOES know,
-- so there is no reason to accept a client's claim about it.
alter policy check_ins_insert on public.check_ins
  with check (
    public.can_record_check_in_for(public.guest_event(guest_id), checked_by)
    and (synced_by is null or synced_by = (select auth.uid()))
  );

alter policy refusals_insert on public.refusals
  with check (
    public.can_record_check_in_for(public.guest_event(guest_id), refused_by)
    and (synced_by is null or synced_by = (select auth.uid()))
  );

-- UPDATE: only `synced_by` is bounded by the policy. The actor columns are
-- guarded by a trigger instead — see below for why a WITH CHECK cannot do this
-- job correctly.
alter policy check_ins_update_door on public.check_ins
  with check (
    public.can_check_in(public.guest_event(guest_id))
    and (synced_by is null or synced_by = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Actor guard on UPDATE — a trigger, deliberately not a policy
-- ---------------------------------------------------------------------------
-- The hole being closed: `check_ins_update_door` (20260617020000) had NO
-- predicate on `checked_by`, and because permissive policies are OR-ed that made
-- the sibling `check_ins_update_own_device` pin non-binding — any door-scoped
-- user could UPDATE an existing check-in and rewrite the actor to an arbitrary
-- uuid. `reviveCheckIn` (src/features/door/outbox/gateway.ts) writes that column
-- on exactly this path.
--
-- The first version of this migration closed it with `WITH CHECK
-- (can_record_check_in_for(..., checked_by))`. That is WRONG, and the review of
-- this PR caught it: WITH CHECK evaluates the RESULTING ROW, not the columns the
-- statement touched. So a plain top-up or check-out — which never mention
-- `checked_by` — would be re-validated against whoever already sat in that
-- column. Concretely: an external organizer checks a guest in during build-up,
-- an admin later removes them from `event_organizers` (the External-crew screen
-- does precisely this), and from then on every "uitchecken" of that guest fails
-- 42501 — and offline it dead-letters terminally, losing a real door action.
-- Revoking someone's access must never retroactively freeze rows they touched.
--
-- A BEFORE UPDATE trigger can see OLD, so it can ask the question that actually
-- matters: "is this statement CHANGING the actor?" Unchanged actors are left
-- alone no matter what their role is today. It also binds strictly harder than a
-- policy would: `check_ins` is not FORCE ROW LEVEL SECURITY, so a SECURITY
-- DEFINER function bypasses RLS entirely — but never a trigger. Verified that no
-- definer path writes `checked_by`: `check_out_guest` (20260810183000) only ever
-- touches `voided_at`/`voided_by`/`plus_ones_arrived`.
-- SECURITY INVOKER on purpose: the guard needs to see WHICH ROLE is writing, and
-- inside a SECURITY DEFINER function `current_user` is always the owner, which
-- would make the exemption below unreachable.
create or replace function public.guard_check_in_actor_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Client writes only. A trigger fires for EVERYONE — including the superuser
  -- running migrations, seeds and pgTAP fixtures, and every SECURITY DEFINER
  -- function. Those are exactly the paths RLS deliberately does not apply to
  -- either (no table here is FORCE ROW LEVEL SECURITY), so bounding them would
  -- be a behaviour change well outside this task: it broke two unrelated pgTAP
  -- suites that arrange state by writing `voided_by` directly.
  --
  -- The discriminator is the ROLE, not `auth.uid()`. A first attempt exempted
  -- "no JWT" and still broke, because `reset role` restores the role WITHOUT
  -- clearing `request.jwt.claims` — so `auth.uid()` happily returns the last
  -- logged-in user while the write is really running as a superuser. PostgREST
  -- always executes client requests as `authenticated`/`anon`, so keying on that
  -- exempts nothing a client can reach.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Only a CHANGE is validated; NULL-ing voided_by (check_out_guest's re-checkin
  -- branch) is a clearing, not an attribution, so it needs no actor.
  if new.checked_by is distinct from old.checked_by
     and not public.can_record_check_in_for(new.event_id, new.checked_by) then
    raise exception using errcode = '42501',
      message = 'Je mag een check-in niet op naam van deze gebruiker zetten.';
  end if;
  if new.voided_by is distinct from old.voided_by
     and new.voided_by is not null
     and not public.can_record_check_in_for(new.event_id, new.voided_by) then
    raise exception using errcode = '42501',
      message = 'Je mag een uitcheck niet op naam van deze gebruiker zetten.';
  end if;
  return new;
end;
$$;

drop trigger if exists check_ins_guard_actor_change on public.check_ins;
create trigger check_ins_guard_actor_change
  before update on public.check_ins
  for each row execute function public.guard_check_in_actor_change();

comment on function public.guard_check_in_actor_change() is
  'Bounds check_ins.checked_by/voided_by to door-capable users of the event, but only when an UPDATE actually changes them — a WITH CHECK would re-validate an unchanged actor and freeze rows whose original actor later lost access (86ey9et0h).';

-- guests: the outbox's `add_guest` kind carries the same hand-off problem —
-- `added_by` was pinned to auth.uid() (20260613120000, last altered
-- 20260811160000), so a door-add queued by A and drained by B would 42501 and
-- dead-letter, taking the check-in chained behind it down with it (FK 23503).
-- The relaxation is scoped to source='door' so the staff/app path — where
-- added_by drives per-adder quota ownership and the staff-scoped
-- guests_select/guests_update boundary — keeps its hard pin. A door add already
-- charges the doorhost's own meter, so preserving A here is also the arithmetic
-- that would have happened had A synced their own queue.
--
-- Known consequence, accepted with the 2026-08-12 decision: `enforce_guest_quota`
-- charges `new.added_by`, so this also lets a door-capable user attribute a
-- walk-in to a door-capable COLLEAGUE. Stated precisely, because the first
-- version of this comment got it wrong and the review of this PR caught it:
--   * named colleague is a doorhost/organizer -> their personal meter is charged;
--   * named colleague is a venue ADMIN -> `user_is_quota_exempt`
--     (20260625120000_external_crew_quota.sql) is true, so `enforce_guest_quota`
--     skips the personal-quota branch entirely. NOBODY's meter is charged.
-- Either way the SHARED pools still move (`events.capacity`, `guest_tiers.
-- max_guests`) and `audit_log.actor_id` still records the real session, so this
-- is a misattribution and an advisory-quota gap, not an unbounded free-guest
-- machine.
--
-- Not a new capability, which is why it is accepted rather than blocking: the
-- same outcome is already reachable on `main` in one write, because
-- `guests_update`'s WITH CHECK (20260811160000) evaluates its role branch on
-- `auth.uid()` rather than on `added_by` — any admin/doorhost/organizer can
-- re-point `added_by` at an exempt admin today. Bounding `added_by` on
-- `guests_update` is the real fix and belongs in its own task; it is pre-existing
-- and out of scope here. Weighed against the alternative (a queued door add, and
-- the check-in chained behind it, silently destroyed on a tablet hand-off), the
-- relaxation is the smaller harm.
alter policy guests_insert on public.guests
  with check (
    public.can_write_guests(event_id)
    and (
      added_by = (select auth.uid())
      or (source = 'door' and public.can_record_check_in_for(event_id, added_by))
    )
    and status = 'approved'
    and (
      source in ('app', 'door')
      or public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  );

comment on policy check_ins_insert on public.check_ins is
  'checked_by must name a door-capable user of this event (usually the caller; a different one only when a shared-device outbox is drained under another session), and synced_by is pinned to auth.uid() (86ey9et0h).';
comment on policy check_ins_update_door on public.check_ins is
  'Door-scoped update. checked_by/voided_by are bounded to door-capable users of the event — before 86ey9et0h this policy had no predicate on either, which made the own-device pin non-binding.';
comment on policy refusals_insert on public.refusals is
  'refused_by must name a door-capable user of this event; synced_by is pinned to auth.uid() (86ey9et0h).';
comment on policy guests_insert on public.guests is
  'Client inserts: own added_by (or another door-capable user for source=door outbox hand-offs, 86ey9et0h), app/door source (RPC-only sources for exempt roles), and status pinned to approved (86ey9c5fp).';
