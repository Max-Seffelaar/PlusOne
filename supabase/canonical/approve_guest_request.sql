-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20260707170000_p0_security_hotfixes.sql:104.

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
