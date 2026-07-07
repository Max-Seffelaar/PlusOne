-- P0 security hotfixes (full-app review 2026-07-07, ClickUp 86ey6xdgh).
--
-- Four DB-side fixes; the fifth/sixth (C1 crew-invite auth check, C5 IP-salt
-- fail-closed) are app-layer changes in the same PR.
--
--   * C3 — retire events_select_landing: anon could list EVERY tenant's active
--     landing events (name/dates/slug), defeating the random-suffix design.
--   * C2 — revoke the anon direct-INSERT on guest_requests: force all public
--     submissions through submit_guest_request (throttle + dedup + honeypot).
--   * C4 — throttle get_landing_event: an unthrottled resolver is a free slug
--     oracle. Adds p_ip_hash and consumes the public throttle first.
--   * G1 — approve_guest_request: add the FOR UPDATE link lock the auto-approve
--     path already has, closing the concurrent-approval link-cap race.

-- ---------------------------------------------------------------------------
-- C3. Retire the anon cross-venue event-enumeration surface
-- ---------------------------------------------------------------------------
-- events_select_landing let anon (and any authenticated user) SELECT every
-- tenant's landing-active events with no venue scope — a `select * from events`
-- returned all venues' live links. The landing page now resolves a single slug
-- through get_landing_event (SECURITY DEFINER), so anon needs no direct events
-- access at all. Drop the policy AND the anon column grant: the RPC is the only
-- anon path to event data.

drop policy if exists events_select_landing on public.events;
revoke select on table public.events from anon;

-- ---------------------------------------------------------------------------
-- C2. Force anon submissions through the throttled RPC
-- ---------------------------------------------------------------------------
-- The direct anon INSERT grant let a bot POST straight to /rest/v1/guest_requests
-- and flood the pending-approval queue, bypassing the RPC's rate limit, silent
-- dedup and honeypot. submit_guest_request is SECURITY DEFINER and runs its
-- insert as the function owner, so revoking the anon grant does not touch the
-- sanctioned path — the same RPC already inserts into contacts, a table anon has
-- never held a grant on. The guest_requests_insert_public policy stays (it still
-- governs authenticated direct inserts); with no anon grant its anon arm is inert.

revoke insert on table public.guest_requests from anon;

-- ---------------------------------------------------------------------------
-- C4. Throttle the landing resolver (slug oracle)
-- ---------------------------------------------------------------------------
-- get_landing_event had no rate limit: unbounded slug probing, each hit
-- confirming an open link and leaking the event name + influencer label at zero
-- cost. Add p_ip_hash and consume the public throttle FIRST, matching the sibling
-- anon RPCs (record_link_pageview / get_request_status). A rate-limited probe
-- gets the empty result — indistinguishable from a closed/unknown slug (#28).
-- Return-type is unchanged; the arg-list change requires drop + recreate.

drop function if exists public.get_landing_event(text);

create function public.get_landing_event(p_slug text, p_ip_hash text)
returns table (
  event_name text,
  starts_at  timestamptz,
  via_label  text,
  -- Remaining approvable headcount on a CAPPED link (0 = full); NULL when the
  -- link has no max — then nothing about capacity is disclosed (#28/#43).
  spots_left integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same budget as record_link_pageview (a venue's door WiFi NATs many phones
  -- behind one IP). Burns first, so probing costs budget even on a closed slug.
  if not public.consume_public_throttle('slug:' || p_ip_hash, 15, 60) then
    return;
  end if;

  return query
  select
    e.name,
    e.starts_at,
    case when rl.is_default then null
         else coalesce(i.name, rl.label) end,
    case when rl.max_headcount is null then null
         else greatest(rl.max_headcount - public.request_link_consumption(rl.id), 0) end
  from public.request_links rl
  join public.events e on e.id = rl.event_id
  left join public.influencers i on i.id = rl.influencer_id
  where rl.slug = p_slug
    and public.request_link_open(rl);
end;
$$;

revoke execute on function public.get_landing_event(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_landing_event(text, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- G1. Close the manual-approval link-cap race
-- ---------------------------------------------------------------------------
-- Body = 20260706103000 (attribution + 45006 rollback) PLUS the FOR UPDATE link
-- lock the auto-approve path already carries (submit RPC). Without it, two
-- concurrent manual approvals on the same capped link both pass the 45006 cap
-- under read-committed and overfill the link (26/25). The row lock serializes
-- them; the max/tier triggers recompute from committed state. A null link (a
-- pre-links request) needs no lock.

create or replace function public.approve_guest_request(
  p_request_id uuid,
  p_tier_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req      public.guest_requests;
  v_venue    uuid;
  v_guest_id uuid;
begin
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;
  if v_req.status = 'approved' then
    raise exception using errcode = '45003', message = 'Deze aanvraag staat al op de lijst.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  if not exists (
    select 1 from public.guest_tiers gt
    where gt.id = p_tier_id and gt.event_id = v_req.event_id
  ) then
    raise exception using errcode = '23514', message = 'Kies een geldige tier voor dit event.';
  end if;

  -- G1: serialize concurrent approvals on the same link before the guest insert,
  -- exactly like the auto-approve path. The link-max (45006) trigger recomputes
  -- from committed state, so without this lock two approvers can both pass the cap.
  if v_req.request_link_id is not null then
    perform 1 from public.request_links rl where rl.id = v_req.request_link_id for update;
  end if;

  -- Create the guest with the request's link attribution. added_by = the
  -- approver (#31: source='landing' never charges their quota); tier-max
  -- (45002) and link-max (45006) roll the whole approval back.
  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones,
     added_by, source, status, request_link_id)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_req.plus_ones, (select auth.uid()), 'landing', 'approved', v_req.request_link_id)
  returning id into v_guest_id;

  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decided_via = 'manual',
      decision_reason = null
  where id = p_request_id;

  return v_guest_id;
end;
$$;
