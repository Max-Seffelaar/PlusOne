-- A company always keeps at least one admin (onboarding programme task 0g,
-- golf B; bug Max 2026-10-07, "Giorke Kantoor").
--
-- Why a trigger: the last-admin rule lived only in the app
-- (removalWouldOrphanVenue / roleChangeWouldOrphanVenue in
-- src/features/venues/access.ts, called by removeMemberAction and
-- updateMemberRolesAction). RLS itself happily allowed it:
-- venue_memberships_delete and venue_memberships_update (role-only since
-- 20260702120000) let any admin of the venue, and every platform admin via the
-- has_venue_role disjunct (20260923120000), delete or demote ANY admin row,
-- their own included, straight from PostgREST. The app check is also a
-- read-then-write (count other admins, then delete) with no lock, so two
-- admins removing each other at the same moment both pass it. A venue without
-- an admin cannot invite anyone any more (invites need admin/user_manager) and
-- needs a manual SQL fix. The database is the boundary (CLAUDE.md rule 1), so
-- the rule moves here; the app check stays as the friendly early refusal.
--
-- Change: one BEFORE trigger on public.venue_memberships,
--   BEFORE UPDATE OF venue_id, roles OR DELETE, FOR EACH ROW,
-- that raises SQLSTATE P0LA1 when the row is the venue's last membership
-- holding 'admin' and the change takes admin away from that venue:
--   * DELETE of a row whose roles contain admin;
--   * UPDATE whose NEW.roles no longer contain admin;
--   * UPDATE that moves an admin row to another venue (venue_id is not
--     client-writable since 20261007150200, but the owner/service_role can).
-- user_id changes keep an admin on the venue (another person), so they pass.
--
-- Who it applies to: everyone. No platform-admin exception (a company without
-- an admin is never the intent), no service_role exception, no JWT check. The
-- demo-membership trigger (refuse_demo_member_self_change, 20260925150000)
-- fires first (triggers fire in name order: refuse_demo_* < refuse_last_*)
-- and still answers 42501 for the demo row; this one never makes that row
-- writable. The demo seed (scripts/seed-demo-venue.mjs) only upserts the demo
-- user's own row with {admin,doorhost} and deletes stray NON-demo members, so
-- the demo user stays the venue's admin and the seed passes.
--
-- Role-array tricks: membership is tested with 'admin' = any(roles). A
-- duplicate ({admin,admin}) still counts as one admin row (we count ROWS, not
-- array elements); '{ADMIN}' is not a venue_role value and fails the enum cast
-- before any trigger runs; NULL and '{}' are refused by the column's NOT NULL
-- and array_length >= 1 check.
--
-- Cascades. Every FK into venue_memberships is ON DELETE RESTRICT today
-- (venue_id -> venues, user_id -> user_profiles -> auth.users, all RESTRICT,
-- 20260613000000), and no migration, RPC, retention job or script deletes a
-- venue, a profile or an auth user. So no cascade reaches this table now: a
-- venue or user with memberships cannot be deleted at all, before and after
-- this migration. The trigger is still written for the day one of those FKs
-- becomes ON DELETE CASCADE (account erasure, venue deletion): it lets the row
-- go when its venue row or its user_profiles row no longer exists. Both are
-- deleted before the cascade fires the child's row triggers, so the check is
-- exact, and it can't be forged from the API: authenticated holds no DELETE on
-- venues or user_profiles (grant_matrix.test.sql), and while the FK is
-- RESTRICT a parent row can't disappear with a membership still pointing at
-- it. A venue that is being deleted needs no admin; an erased account must not
-- be blocked by a support rule (an orphaned company after an erasure is a
-- support case, not a refusal). pg_trigger_depth() was rejected as the test:
-- it is > 1 for ANY nested trigger write, not just an FK cascade, so a future
-- trigger that deletes memberships would silently skip the guard.
--
-- Concurrency. The trigger takes a transaction-scoped advisory lock per venue
-- (pg_advisory_xact_lock(hashtext('last_admin_guard'), hashtext(venue_id)))
-- before counting the venue's OTHER admin rows. Two transactions changing
-- admins of the same venue therefore run the count-and-change one after the
-- other; the lock is held until commit/rollback, so the second one counts
-- after the first one's change is committed. Under READ COMMITTED (PostgREST,
-- every RPC, the default) each statement inside the volatile trigger function
-- takes a fresh snapshot, so that second count sees the first change and
-- refuses. Under REPEATABLE READ / SERIALIZABLE the snapshot is the
-- transaction's first one and could predate the other commit, so there the
-- count also locks the rows it counts (FOR UPDATE): a row deleted or demoted
-- by a committed concurrent transaction raises 40001 instead of being counted.
-- No client can choose those isolation levels through PostgREST; this covers
-- direct connections. A hash collision between two venues only makes them
-- wait for each other, never skips the check. Within one statement
-- (`delete ... where venue_id = X` hitting every admin) the row triggers see
-- the rows the same statement already processed, so the last one refuses and
-- the whole statement rolls back.
--
-- Function: SECURITY DEFINER (owner postgres) so the count sees every
-- membership of the venue whatever the caller's RLS shows (an RLS-filtered
-- count would only produce false refusals, but the rule should not depend on
-- who asks), pinned empty search_path, fully qualified names. It reads
-- OLD/NEW and counts; it writes nothing. A trigger function needs no EXECUTE
-- grant to fire, so execute is revoked from every app role. No new table or
-- view, so no grant matrix to state. Existing objects are untouched.
--
-- App side: src/lib/db-errors.ts maps P0LA1 to the existing copy ("This is the
-- last admin. Make someone else an admin first.") and treats it as an expected
-- user error (no Sentry exception).

create function public.refuse_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other int;
begin
  -- Only a row that holds admin today can take the venue's last admin away.
  if not ('admin'::public.venue_role = any (old.roles)) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- An UPDATE that keeps admin on the same venue removes nothing.
  if tg_op = 'UPDATE'
     and new.venue_id = old.venue_id
     and 'admin'::public.venue_role = any (new.roles) then
    return new;
  end if;

  -- FK cascade from a deleted venue or account (see header): let it through.
  if not exists (select 1 from public.venues v where v.id = old.venue_id)
     or not exists (select 1 from public.user_profiles p where p.id = old.user_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- One admin change per venue at a time (see header, Concurrency).
  perform pg_advisory_xact_lock(hashtext('last_admin_guard'), hashtext(old.venue_id::text));

  if current_setting('transaction_isolation') = 'read committed' then
    select count(*) into v_other
    from public.venue_memberships m
    where m.venue_id = old.venue_id
      and m.id <> old.id
      and 'admin'::public.venue_role = any (m.roles);
  else
    select count(*) into v_other
    from (
      select 1
      from public.venue_memberships m
      where m.venue_id = old.venue_id
        and m.id <> old.id
        and 'admin'::public.venue_role = any (m.roles)
      for update
    ) locked;
  end if;

  if v_other = 0 then
    raise exception 'a company always keeps at least one admin'
      using errcode = 'P0LA1',
            hint = 'Make someone else an admin first.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function public.refuse_last_admin_removal() is
  'BEFORE UPDATE OF venue_id, roles OR DELETE trigger on venue_memberships '
  '(20261012120000): refuses (P0LA1) removing or demoting the last admin of a '
  'venue that still exists, for every role incl. platform admins and '
  'service_role. Per-venue advisory lock against concurrent removals.';

revoke execute on function public.refuse_last_admin_removal() from public, anon, authenticated;

create trigger refuse_last_admin_removal
  before update of venue_id, roles or delete on public.venue_memberships
  for each row execute function public.refuse_last_admin_removal();
