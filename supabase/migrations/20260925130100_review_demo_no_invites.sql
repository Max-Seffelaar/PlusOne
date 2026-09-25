-- Store-review demo venue never invites (Fase 17 S3, ClickUp 86ey6bfug, PR #332 round 3).
--
-- 20260925130000_review_demo_guard.sql stops the demo account (fixed id
-- de300000-…a001) from creating a venue. It still holds {admin,doorhost} on the
-- demo venue, so a code holder could invite their own mailbox into it, log in
-- through normal OTP (accept_pending_invites adds the membership) and create a
-- venue as THAT account: the same permanent tenant on invite-only prod, one hop
-- later. The review login and the seed only detect the stray member afterwards.
--
-- Change: a BEFORE INSERT trigger on public.invites that refuses (42501) any
-- invite whose venue_id is the demo venue (fixed id de300000-…0001 =
-- DEMO_VENUE_ID in src/features/auth/review-window.ts and
-- scripts/seed-demo-venue.mjs). It holds for every role, service_role included:
-- there is no legitimate invite into the demo venue. The only insert path into
-- invites in the codebase is createInviteAction (src/features/auth/invite-actions.ts),
-- via the user-scoped client; no RPC, seed or script inserts invites, and the
-- demo seed creates its one membership directly. Without an invite,
-- accept_pending_invites can never add a member to the demo venue, and
-- venue_memberships_insert only ever adds EXISTING users (it mints no account).
--
-- UPDATE is not covered on purpose: authenticated may update only expires_at
-- (column grant, 20260707113000), so venue_id cannot be moved onto the demo
-- venue from the client.
--
-- The function only reads NEW, so it is security invoker (the minimum), with a
-- pinned empty search_path. A trigger function needs no EXECUTE grant to fire,
-- so execute is revoked from every app role. No existing object is changed.
--
-- If the demo venue ever needs another id, this constant moves with it (a new
-- migration, never an edit of this one).

create function public.refuse_demo_venue_invite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.venue_id = 'de300000-0000-7000-8000-000000000001'::uuid then
    raise exception 'the demo venue cannot invite' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_demo_venue_invite() from public, anon, authenticated;

create trigger refuse_demo_venue_invite
  before insert on public.invites
  for each row execute function public.refuse_demo_venue_invite();
