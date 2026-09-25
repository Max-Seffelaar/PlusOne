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
-- so execute is revoked from every app role. No existing object is changed.
--
-- If the demo venue or user ever needs another id, these constants move with
-- it (a new migration, never an edit of this one).

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
  return new;
end;
$$;

revoke execute on function public.refuse_demo_venue_new_crew() from public, anon, authenticated;

create trigger refuse_demo_venue_new_crew
  before insert on public.event_organizers
  for each row execute function public.refuse_demo_venue_new_crew();
