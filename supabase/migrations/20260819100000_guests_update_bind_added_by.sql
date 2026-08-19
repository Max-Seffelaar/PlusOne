-- Security (ClickUp 86eymckjt) — bind `guests.added_by` on UPDATE, so the
-- per-adder quota stops being advisory.
--
-- ── The hole ────────────────────────────────────────────────────────────────
-- `guests_update` (20260613120000, last altered 20260811160000) evaluates its
-- role branch on `auth.uid()`, never on the value of `added_by`:
--
--   and (
--     added_by = (select auth.uid())
--     or public.has_venue_role(public.event_venue(event_id), '{admin,doorhost}')
--     or public.is_event_organizer(event_id)
--   )
--
-- Enter through the second or third branch and NOTHING constrains what
-- `added_by` ends up holding. Any admin, doorhost or organizer could therefore
-- re-point that column at an arbitrary user in a single UPDATE — while
-- `guests_insert` has pinned it since day one (#27).
--
-- ── Why that made quota enforcement advisory ────────────────────────────────
-- `enforce_guest_quota` (20260714100000, l.55) tests the exemption on the NAMED
-- adder, not on the writer:
--
--   and not public.user_is_quota_exempt(new.event_id, new.added_by)
--
-- and `user_is_quota_exempt` (20260625120000) is true for every venue admin. So
-- pointing `added_by` at an admin skips the personal-quota branch outright:
-- nobody's meter is charged — not the writer's, not the admin's. A doorhost or
-- staffer with zero free slots could add guests without limit by adding one
-- normally-charged row and then re-attributing it, over and over.
-- The same trick also re-points a row at NULL, the "auto-approved via request
-- link" attribution that belongs to no meter at all.
--
-- What this is NOT: a free-guest machine. The SHARED pools still move
-- (`events.capacity`, `guest_tiers.max_guests`) and `audit_log.actor_id` records
-- the real session on every write. The damage is misattribution plus a personal
-- quota that can be walked around — which, for a product whose core values are
-- fraud resistance and quota enforcement, is enough.
--
-- Found by a fresh-session /code-review + /security-review on PR #271
-- (86ey9et0h). It was raised there, then verified to be pre-existing and
-- reachable on `main` in one write, independent of that PR. Its migration header
-- (20260812140000_outbox_owner_stamp_sync.sql) names this task as the real fix,
-- because the door-outbox relaxation it ships leans on this gap staying closed
-- by something.
--
-- ── The rule ────────────────────────────────────────────────────────────────
-- `added_by` may stay exactly as it is, or move to the caller. It may never move
-- to a third party — including NULL.
--
-- Taking ownership of a row is the one direction that grants nothing: it charges
-- the taker's OWN meter (`enforce_guest_quota` recomputes because
-- `old.added_by = new.added_by` no longer holds, and the advisory lock is keyed
-- on the new pair). Residual, deliberate: a venue ADMIN is quota-exempt, so an
-- admin absorbing a staffer's guest frees that staffer's slot. Admins own the
-- quota table outright and can raise it directly, so this adds no capability —
-- it is recorded here because it is the one asymmetry the rule allows.
--
-- ── Why a trigger and not WITH CHECK ────────────────────────────────────────
-- Exactly the trap PR #271 (C4) fell into: `WITH CHECK` evaluates the RESULTING
-- ROW, not the columns the statement touched. A bound on `added_by` in the
-- policy would therefore re-validate every update that never mentions the
-- column — note edits, tier changes (single + bulk), `undoRefusal`, `ackNote`,
-- soft delete — against whoever happens to sit in it. Concretely: staff member
-- Tom adds a guest, an admin later edits that guest's note; the admin is not
-- Tom, so `added_by = auth.uid()` fails and the WITH CHECK falls through to the
-- role branch — which passes today, but only because the role branch is exactly
-- the thing being tightened. Any formulation that pins the value would freeze
-- every other user's rows for the admin/doorhost/organizer who is allowed to
-- edit them, which is the entire point of that role branch.
--
-- A BEFORE UPDATE trigger can see OLD, so it asks the question that actually
-- matters: is this statement CHANGING the attribution? Unchanged values pass
-- untouched, whatever they hold. The trigger also binds strictly harder than a
-- policy: `guests` is not FORCE ROW LEVEL SECURITY, so a SECURITY DEFINER
-- function bypasses RLS entirely — but never a trigger.
--
-- SECURITY INVOKER on purpose: the guard needs to see WHICH ROLE is writing, and
-- inside a SECURITY DEFINER function `current_user` is always the owner, which
-- would make the client-context test below unreachable.
--
-- ── Expand-contract ─────────────────────────────────────────────────────────
-- No column or signature changes; a new BEFORE UPDATE trigger only. Verified
-- against every write path that exists today, so the currently deployed bundle
-- keeps working unchanged:
--   * `src/features/guests/actions.ts` — updateGuest (name/plus_ones/email/
--     phone/note/note_priority), changeGuestTier, bulk tier change, soft delete
--     (`status='removed'`): none send `added_by`.
--   * `src/features/door/outbox/gateway.ts` — `undoRefusal` (status only) and
--     `ackNote` (note_acknowledged_by/_at only); `insertGuest` is a plain
--     INSERT, not an upsert, so a drained door add never reaches this trigger.
--   * SQL: no migration writes `added_by` on an existing row.
--     `promote_guest_to_contact` (20260714140000), `mark_guest_regular`
--     (20260707150000) and the anonymisation sweeps (20260614230000,
--     20260615180000, 20260624120000, 20260706101000) touch `contact_id` /
--     `full_name` / `email` / `phone` / `note` / `anonymized_at` only — and are
--     SECURITY DEFINER anyway, so the client-context test exempts them.
--   * The door status-sync triggers (20260619120000) write `status` only.

-- ---------------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_guest_added_by_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Client writes only. A trigger fires for EVERYONE — including the superuser
  -- running migrations, seeds and pgTAP fixtures, and every SECURITY DEFINER
  -- function. Those are exactly the paths RLS deliberately does not apply to
  -- either (`guests` is not FORCE ROW LEVEL SECURITY), so bounding them here
  -- would be a behaviour change well outside this task.
  --
  -- The discriminator is the ROLE, not `auth.uid()`. Keying on "no JWT" does not
  -- work: `reset role` restores the role WITHOUT clearing `request.jwt.claims`,
  -- so `auth.uid()` happily returns the last logged-in user while the write is
  -- really running as a superuser (the lesson from 20260812140000). PostgREST
  -- always executes client requests as `authenticated`/`anon`, so keying on that
  -- exempts nothing a client can reach.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Only a CHANGE is validated — see the header for why WITH CHECK cannot do
  -- this. `is distinct from` on both sides so NULL behaves: a row whose
  -- `added_by` is already NULL (auto-approved via a request link, F1) stays
  -- editable, and re-pointing any row AT NULL is a change to a third party
  -- (namely: to nobody, and therefore to no quota meter) and is refused.
  if new.added_by is distinct from old.added_by
     and new.added_by is distinct from auth.uid() then
    raise exception using errcode = '42501',
      message = 'Je mag een gast niet op naam van een andere gebruiker zetten.';
  end if;

  return new;
end;
$$;

drop trigger if exists guests_guard_added_by_change on public.guests;
create trigger guests_guard_added_by_change
  before update on public.guests
  for each row execute function public.guard_guest_added_by_change();

comment on function public.guard_guest_added_by_change() is
  'Bounds guests.added_by on UPDATE: it may stay unchanged or move to the caller, never to a third party or NULL. A WITH CHECK cannot express this — it sees the resulting row, not the change — and would freeze every row an admin/doorhost/organizer is meant to be able to edit (86eymckjt).';

comment on policy guests_update on public.guests is
  'Client updates: own guest or admin/doorhost/organizer, never on an anonymized row, and may never leave the row in pending/denied — guest_requests owns that lifecycle (86ey9c5fp). This policy deliberately says nothing about the VALUE of added_by; that is bounded by the guests_guard_added_by_change trigger, which can tell a change from a no-op (86eymckjt).';
