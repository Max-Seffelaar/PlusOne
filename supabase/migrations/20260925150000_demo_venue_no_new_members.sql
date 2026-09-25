-- Store-review demo venue never gains a member (Fase 17 S3, ClickUp 86ey6bfug,
-- round 8).
--
-- 20260925130100_review_demo_no_invites.sql closed the invite hop: no invite
-- into the demo venue, so accept_pending_invites can never add anyone there.
-- One direct path was left: venue_memberships_insert lets a venue admin insert
-- a membership row for an EXISTING user straight from the REST API (no invite,
-- no e-mail). The demo account holds {admin,doorhost} on the demo venue, so a
-- review-code holder could add any existing user id to it. That breaks the
-- venue's isolation: the review login (/auth/review-login) then refuses with
-- `venue_not_isolated`, locking the next reviewer out, and the added user
-- would see the demo venue's data.
--
-- Change: a BEFORE INSERT (and UPDATE, see below) trigger on public.venue_memberships that refuses
-- (42501) any row for the demo venue (fixed id de300000-…0001 = DEMO_VENUE_ID
-- in src/features/auth/review-window.ts and scripts/seed-demo-venue.mjs) whose
-- user_id is not the demo user (fixed id de300000-…a001 = DEMO_USER_ID). It
-- holds for every role, service_role included: the demo user is the only
-- legitimate member. The seed's own membership upsert (service role, user_id =
-- the demo user) passes; its stray-member cleanup is a DELETE, not covered.
--
-- The same hop exists one table over: event_organizers_insert_admin lets a
-- venue admin put any existing user on an event's crew (assignOrganizer, the
-- crew sheet's "add returning crew"), which gives that user event-scoped
-- access to the demo venue. The demo seed creates no crew, so a second BEFORE
-- INSERT trigger refuses every event_organizers row on a demo-venue event.
--
-- UPDATE is covered for venue_memberships (unlike invites, whose client grant
-- is expires_at only): authenticated holds a table-wide UPDATE grant there and
-- venue_memberships_update only checks the admin role, so the demo admin could
-- rewrite its OWN row's user_id to another existing user and hand that user
-- the demo venue. The trigger fires on UPDATE OF venue_id, user_id and applies
-- the same check to NEW, so role/job_title updates of the demo user's own row
-- (the seed's on-conflict upsert included) are untouched. event_organizers has
-- no UPDATE policy, so authenticated cannot update it at all; INSERT suffices.
--
-- Both functions only read NEW (the crew one resolves the event's venue via
-- public.event_venue, the existing security definer helper every crew policy
-- already uses), so they are security invoker (the minimum), with a
-- pinned empty search_path. A trigger function needs no EXECUTE grant to fire,
-- so execute is revoked from every app role. Round 8 changes no existing
-- object; round 9 (a) below replaces one function body.
--
-- Round 9 adds two more closures to this (still unapplied) file:
--
-- (a) An invite ADDRESSED to the demo e-mail, from any venue.
--     refuse_demo_venue_invite (20260925130100) keyed on new.venue_id only, so
--     any other venue's admin could invite app-review@demo.plus-one.io. The
--     review login then refuses (venue_not_isolated: an open invite to the demo
--     address), locking the reviewer out, and on the reviewer's consent step
--     accept_pending_invites would hand the demo account a membership in a real
--     venue. The function is replaced (create or replace: same signature, same
--     trigger, owner and ACL kept) with a second predicate on
--     lower(btrim(new.email)); accept_pending_invites matches addresses
--     case-insensitively, so the check does too. Still INSERT only: authenticated
--     may update invites.expires_at only (column grant, 20260707113000).
--
-- (b) Self-lockout. The demo user is admin of the demo venue, and
--     venue_memberships_update / venue_memberships_delete only check the admin
--     role, so it could demote itself (roles-only UPDATE: the new-member trigger
--     above fires on venue_id/user_id only) or delete its own row. Either one
--     locks every later reviewer out (review-login refuses roles_changed /
--     membership_venue) until a re-seed. A BEFORE UPDATE OF venue_id, user_id,
--     roles OR DELETE trigger refuses any change to THAT row (OLD = demo venue +
--     demo user) unless the request runs as service_role (the seed's upsert).
--     The actor is read from the request's JWT role (request.jwt.claims, what
--     PostgREST sets for every API call), not current_user, so a SECURITY
--     DEFINER RPC called by the demo user is refused too. A statement with no
--     JWT at all (the table owner in the SQL editor or a migration) passes when
--     current_user is not an API role: it already holds every privilege there
--     is. (No FK cascade reaches this table: its FKs are ON DELETE RESTRICT.)
--     job_title-only updates are untouched (the column list), and every other
--     membership row is out of scope (the OLD check).
--
-- Both functions only read NEW/OLD and request settings, so they are security
-- invoker with a pinned empty search_path, and execute is revoked from every
-- app role, like the two above.
--
-- Round 10 closes the mirror image of both round-8 triggers (independent
-- re-review): refuse_demo_venue_new_member also refuses any row that puts the
-- demo USER in another venue, and refuse_demo_venue_new_crew any organizer row
-- for the demo user, for every writer. The seed only writes the demo user's
-- demo-venue row, so it needs no exception.
--
-- If the demo venue, user or e-mail ever needs another value, these constants
-- move with it (a new migration, never an edit of this one once applied).

create function public.refuse_demo_venue_new_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.venue_id = 'de300000-0000-7000-8000-000000000001'::uuid
     and new.user_id is distinct from 'de300000-0000-7000-8000-00000000a001'::uuid then
    raise exception 'the demo venue cannot gain members' using errcode = '42501';
  end if;
  -- Round 10: the other direction. Any other venue's admin could insert the
  -- demo user into THEIR venue (venue_memberships_insert checks the caller's
  -- role on the target venue, nothing about user_id), locking every later
  -- reviewer out (membership_count) and giving whoever holds the review code
  -- a seat in a real venue. The seed only ever writes the demo-venue row.
  if new.user_id = 'de300000-0000-7000-8000-00000000a001'::uuid
     and new.venue_id is distinct from 'de300000-0000-7000-8000-000000000001'::uuid then
    raise exception 'the demo account cannot join another venue' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_demo_venue_new_member() from public, anon, authenticated;

create trigger refuse_demo_venue_new_member
  before insert or update of venue_id, user_id on public.venue_memberships
  for each row execute function public.refuse_demo_venue_new_member();

create function public.refuse_demo_venue_new_crew()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.event_venue(new.event_id) = 'de300000-0000-7000-8000-000000000001'::uuid then
    raise exception 'the demo venue cannot gain crew' using errcode = '42501';
  end if;
  -- Round 10: nor is the demo account crew on any other venue's event (the
  -- same asymmetry as the membership trigger above; the seed creates no crew).
  if new.user_id = 'de300000-0000-7000-8000-00000000a001'::uuid then
    raise exception 'the demo account cannot be crew' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_demo_venue_new_crew() from public, anon, authenticated;

create trigger refuse_demo_venue_new_crew
  before insert on public.event_organizers
  for each row execute function public.refuse_demo_venue_new_crew();

-- ── round 9 (a): no invite addressed to the demo e-mail, from any venue ──────

create or replace function public.refuse_demo_venue_invite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.venue_id = 'de300000-0000-7000-8000-000000000001'::uuid then
    raise exception 'the demo venue cannot invite' using errcode = '42501';
  end if;
  if lower(btrim(new.email)) = 'app-review@demo.plus-one.io' then
    raise exception 'the demo account cannot be invited' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_demo_venue_invite() from public, anon, authenticated;

-- ── round 9 (b): the demo user cannot demote, move or delete its own row ─────

create function public.refuse_demo_member_self_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Same resolution as auth.role(): the legacy per-claim setting first, then
  -- the claims object PostgREST sets for every request.
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
begin
  if old.venue_id = 'de300000-0000-7000-8000-000000000001'::uuid
     and old.user_id = 'de300000-0000-7000-8000-00000000a001'::uuid
     and v_jwt_role is distinct from 'service_role'
     and (v_jwt_role is not null or current_user in ('authenticated', 'anon')) then
    raise exception 'the demo membership can only be changed by the demo seed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_demo_member_self_change() from public, anon, authenticated;

create trigger refuse_demo_member_self_change
  before update of venue_id, user_id, roles or delete on public.venue_memberships
  for each row execute function public.refuse_demo_member_self_change();
