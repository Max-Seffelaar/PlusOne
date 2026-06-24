-- Scope MFA/AAL2 to the genuinely sensitive, access-granting actions and let the
-- rest run on role-checks alone (decision refinement on #20, 2026-06-24).
--
-- Before: admin/finance were forced to AAL2 on EVERY screen, so a returning
-- session that had dropped to AAL1 (the access token is short-lived) was bounced
-- to /mfa/verify on the next page view — "re-MFA again and again".
--
-- After: MFA stays MANDATORY to ENROLL for admin/finance, but AAL2 is required
-- only for these "grant / destroy access" actions (the step-up sheet elevates the
-- session in place when one is attempted):
--   • invite a teammate              (invites_insert        — UNCHANGED, keeps is_aal2)
--   • revoke a pending invite        (invites_delete        — UNCHANGED)
--   • add / change-roles / remove a member
--                                    (venue_memberships_*   — UNCHANGED, keeps is_aal2)
--   • remote-logout another user     (admin_revoke_session  — UNCHANGED)
--
-- The following become role-only (the is_aal2() requirement is dropped):
--   • venue default-quota grants     (quotas_*)
--   • per-event quota overrides      (event_quotas_*)
--   • event-organizer assignment     (event_organizers_*)
--   • quota-request approve / deny   (quota_requests_decide_admin + approve_quota_request)
--   • audit-log viewing              (audit_log_select_*)
--
-- RLS stays the security boundary; only the second-factor requirement moves.

-- ── Venue default-quota grants (#4/#5) — role-only ───────────────────────────
alter policy quotas_insert_admin on public.quotas
  with check (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]));
alter policy quotas_update_admin on public.quotas
  using (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]))
  with check (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]));
alter policy quotas_delete_admin on public.quotas
  using (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]));

-- ── Per-event quota overrides — role-only ────────────────────────────────────
alter policy event_quotas_insert_admin on public.event_quotas
  with check (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[]));
alter policy event_quotas_update_admin on public.event_quotas
  using (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[]))
  with check (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[]));
alter policy event_quotas_delete_admin on public.event_quotas
  using (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[]));

-- ── Event-organizer assignment (#6/#24) — role-only ──────────────────────────
alter policy event_organizers_insert_admin on public.event_organizers
  with check (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[]));
alter policy event_organizers_delete_admin on public.event_organizers
  using (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[]));

-- ── Quota-request decide (deny = direct update) — role-only ──────────────────
alter policy quota_requests_decide_admin on public.quota_requests
  using (
    status = 'pending'
    and public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
  )
  with check (
    decided_by = (select auth.uid())
    and public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
  );

-- ── Audit-log viewing — admin/finance, role-only (was AAL2) ──────────────────
drop policy audit_log_select_aal2 on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[]));

-- ── Quota-request approve (RPC) — drop the AAL2 requirement ──────────────────
-- Identical to the quota-engine definition minus the is_aal2() check.
create or replace function public.approve_quota_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quota_requests;
  v_venue uuid;
  v_current int;
begin
  select * into v_req from public.quota_requests where id = p_request_id;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Quota-verzoek niet gevonden.';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not public.has_venue_role(v_venue, '{admin}'::public.venue_role[]) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin mag quota-verzoeken goedkeuren.';
  end if;

  -- New override = the requester's current effective quota + the granted extra.
  v_current := public.user_event_quota(v_req.event_id, v_req.user_id);
  insert into public.event_quotas (event_id, user_id, quota_override)
  values (v_req.event_id, v_req.user_id, v_current + v_req.requested_extra)
  on conflict (event_id, user_id)
  do update set quota_override = excluded.quota_override;

  update public.quota_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id;
end;
$$;
