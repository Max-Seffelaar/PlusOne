-- Hardening (86ey9thm6, follow-up to 86ey9p8zh/PR #224) — enforce_request_link_max()
-- never checked that the link it looked up actually belongs to the guest's own
-- event, letting a forged attribution cross the venue boundary (#1 tenant
-- isolation).
--
-- THE HOLE. Both legitimate writers of guests.request_link_id
-- (approve_guest_request, submit_guest_request's auto-approve path,
-- 20260706103000_submit_via_request_link.sql) always copy a link that is
-- already pinned to the guest's own event. But guests_insert's WITH CHECK
-- (20260623140200_guest_source_insert_guard.sql) never constrains
-- request_link_id at all — an admin/organizer (exempt from the source
-- allowlist) or, via that same exemption, anyone with raw API access to their
-- own venue could POST /rest/v1/guests with an event_id they own and a
-- request_link_id copied from ANOTHER venue's link. enforce_request_link_max()
-- (public.request_links rl where rl.id = new.request_link_id) then happily
-- recomputes that FOREIGN link's consumption against ITS max_headcount and, on
-- a cap breach, raises 45006 with hint 'link_full;consumed=%s;max=%s' —
-- disclosing another venue's private link fill numbers to a user who has no
-- membership there. Nothing else in the schema denies cross-event attribution
-- (guests.request_link_id only has a single-column FK to request_links(id),
-- no event match), so this trigger was the only, and an insufficient, gate.
--
-- THE FIX. Reject a request_link_id that does not belong to new.event_id
-- BEFORE any cap computation touches the foreign link's row — same posture as
-- set_request_link_scope()'s influencer-venue check
-- (20260706100000_influencers_request_links.sql): validate scope first, fail
-- generic (23514, no consumed/max numbers) and cheap. A same-event link falls
-- through to the existing cap logic unchanged (locking from 20260714160000
-- preserved verbatim).
--
-- OUT OF SCOPE (documented, not built — same task, filed as a second finding
-- by the 86ey9p8zh review): a theoretical multi-link deadlock. If a single
-- statement/transaction took the domain-4 advisory lock
-- (pg_advisory_xact_lock(4, hashtext(request_link_id::text))) for TWO
-- different request_link_ids in an order that races a concurrent transaction
-- locking the same two links in reverse, Postgres's deadlock detector would
-- abort one side with 40P01 — a transient, retryable failure, not a data or
-- security defect (the same shape 86ey9e8ar/PR #216 already handles with
-- retry logic for the personal/tier/capacity domains). It stays unreachable
-- today: every shipped writer of guests.request_link_id
-- (approve_guest_request, submit_guest_request) touches exactly one guest row
-- attributed to exactly one link per statement, so a single transaction never
-- holds more than one domain-4 lock at a time. It would only become reachable
-- if a future feature bulk-inserted guests attributed to MULTIPLE different
-- links in one statement (addGuestsBulk today never sets request_link_id) —
-- if that ever lands, give it the same lock-ordering discipline
-- (sort by link id before iterating) the other bulk paths use, or accept
-- 40P01 as a retryable outcome like #216 already does.

create or replace function public.enforce_request_link_max()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.request_links;
  v_is_inside boolean;
  v_old int := 0;
  v_new int;
  v_total int;
begin
  if new.request_link_id is null then
    return null;
  end if;

  select rl.* into v_link
  from public.request_links rl where rl.id = new.request_link_id;

  -- Attribution must stay inside the guest's own event (#1 tenant isolation).
  -- A mismatch means request_link_id was forged past the RPCs (both always
  -- copy a same-event link) — reject it before the foreign link's row is
  -- used for anything, so no other venue's cap/consumption is ever computed,
  -- let alone disclosed via the 45006 hint below.
  if v_link.event_id is distinct from new.event_id then
    raise exception using errcode = '23514',
      message = 'Deze aanvraaglink hoort niet bij dit event.';
  end if;

  if v_link.max_headcount is null then
    return null;                       -- uncapped link
  end if;

  v_is_inside := exists (
    select 1 from public.check_ins ci
    where ci.guest_id = new.id and ci.voided_at is null
  );

  v_new := public.link_headcount_contribution(new, v_is_inside);
  if tg_op = 'UPDATE' and old.request_link_id = new.request_link_id then
    v_old := public.link_headcount_contribution(old, v_is_inside);
  end if;

  -- Only a net increase can breach the cap.
  if v_new > v_old then
    -- Serialise concurrent adds into this same request link (20260714160000):
    -- block until any other in-flight add for this link has committed/rolled
    -- back, so the recompute below always sees the true prior state.
    perform pg_advisory_xact_lock(4, hashtext(new.request_link_id::text));

    v_total := public.request_link_consumption(new.request_link_id);
    if v_total > v_link.max_headcount then
      raise exception using
        errcode = '45006',
        message = format('Deze aanvraaglink zit vol: %s van %s plekken bezet.', v_total, v_link.max_headcount),
        hint = format('link_full;consumed=%s;max=%s', v_total, v_link.max_headcount);
    end if;
  end if;
  return null;
end;
$$;

-- CREATE OR REPLACE preserves existing grants; already revoked from
-- public/anon/authenticated/service_role (20260706101000) and stays that way —
-- internal trigger function only.
