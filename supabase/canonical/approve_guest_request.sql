-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20260918174500_partial_approval_decision_message.sql:204.

create or replace function public.approve_guest_request(
  p_request_id uuid,
  p_tier_id uuid,
  p_plus_ones integer default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws         constant text := E' \t\n\r\f\x0B';
  v_req      public.guest_requests;
  v_event    uuid;
  v_venue    uuid;
  v_guest_id uuid;
  v_plus     integer;
  v_message  text;
begin
  -- Unlocked read: just enough to know whose request this is.
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null or v_req.anonymized_at is not null then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  -- Authorized: now lock the row and re-check what may have changed meanwhile.
  -- That includes the event: the role check above was made against the event
  -- the unlocked read saw, so a row that moved to another event since then is
  -- a different request as far as this approval goes.
  v_event := v_req.event_id;
  select * into v_req from public.guest_requests where id = p_request_id for update;
  if v_req.id is null
     or v_req.anonymized_at is not null
     or v_req.event_id is distinct from v_event then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;
  if v_req.status = 'approved' then
    raise exception using errcode = '45003', message = 'Deze aanvraag staat al op de lijst.';
  end if;

  -- z8uq9m0hw6: approve for FEWER plus-ones, never more. NULL = as requested,
  -- which is what the 2-arg call of the deployed app resolves to.
  v_plus := coalesce(p_plus_ones, v_req.plus_ones);
  if v_plus < 0 or v_plus > v_req.plus_ones then
    raise exception using errcode = '23514',
      message = 'Approve between 0 plus-ones and the number requested.';
  end if;

  -- Plain text. Trimmed with submit_guest_request's whitespace set, and
  -- anything the CHECK's own test would call blank ([:space:] only) is no
  -- message at all. Both CHECK rules are settled here, before any insert.
  v_message := nullif(btrim(p_message, ws), '');
  if v_message !~ '[^[:space:]]' then
    v_message := null;
  end if;
  if char_length(v_message) > 280 then
    raise exception using errcode = '23514',
      message = 'Keep the message to 280 characters.';
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

  -- Create the guest with the APPROVED count and the request's link
  -- attribution. added_by = the approver (#31: source='landing' never charges
  -- their quota). Capacity (45005) and link-max (45006) sum 1 + plus_ones off
  -- this row, so they charge the approved count; tier-max (45002) counts the
  -- entry. Any of them rolls the whole approval back when it does not fit.
  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones,
     added_by, source, status, request_link_id)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_plus, (select auth.uid()), 'landing', 'approved', v_req.request_link_id)
  returning id into v_guest_id;

  -- One UPDATE with the status flip, so audit_guest_requests records the
  -- approved count and the message in the same 'approve' diff.
  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decided_via = 'manual',
      decision_reason = null,
      approved_plus_ones = v_plus,
      decision_message = v_message
  where id = p_request_id;

  return v_guest_id;
end;
$$;
