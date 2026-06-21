-- Re-approve a DENIED landing request (#12). A doorman/admin may refuse a guest,
-- but on reflection that person should sometimes still get on the list ("die
-- persoon moet soms toch gewoon gaan"). The ONLY change vs 20260614100000 is the
-- status guard: it now rejects just an ALREADY-APPROVED request (one that already
-- produced a guest), accepting both 'pending' and 'denied'. Re-approving a denied
-- request creates the guest (source='landing', outside personal quota #31, still
-- tier-max checked) and flips the request to 'approved', firing audit 'approve'
-- and clearing the stale denial reason. The pending-only dedup index is untouched.
--
-- Self-guarded (SECURITY DEFINER re-checks admin/organizer, the RLS it bypasses);
-- the function signature is unchanged so the fase-8 GRANT still applies.

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
  -- Re-approval (#12): a denied request may still be approved later; only a
  -- request that already produced a guest is truly "done".
  if v_req.status = 'approved' then
    raise exception using errcode = '45003', message = 'Deze aanvraag staat al op de lijst.';
  end if;

  -- #12 / role matrix §2: admin (venue) or organizer (this event) only.
  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  -- The tier must belong to THIS event (the composite FK enforces it too, but a
  -- pre-check gives clean Dutch copy instead of a raw FK violation).
  if not exists (
    select 1 from public.guest_tiers gt
    where gt.id = p_tier_id and gt.event_id = v_req.event_id
  ) then
    raise exception using errcode = '23514', message = 'Kies een geldige tier voor dit event.';
  end if;

  -- Create the guest. added_by = the approver, source='landing' so it never
  -- charges their quota (#31). enforce_guest_quota still applies tier-max → a full
  -- tier raises 45002 and the whole approval rolls back. audit_guests logs 'create'.
  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones, added_by, source, status)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_req.plus_ones, (select auth.uid()), 'landing', 'approved')
  returning id into v_guest_id;

  -- Flip the request → approved, clearing any prior denial reason. Fires
  -- audit_guest_requests ('approve').
  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_reason = null
  where id = p_request_id;

  return v_guest_id;
end;
$$;
