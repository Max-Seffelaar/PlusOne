-- Feedback 1/7 — T8: resend a pending venue invite (86ey4j1mu).
--
-- "Resend" = e-mail the invitee again AND give the pending invite a fresh
-- expiry window. The e-mail is app-side (resendInviteAction); this migration
-- adds the DB side: an UPDATE path on invites, which never existed (acceptance
-- goes through the accept_pending_invites() definer, never a client UPDATE).
--
-- Guardrails:
--   * Column-level grant: authenticated may UPDATE only expires_at. E-mail,
--     roles, venue and acceptance state stay immutable from the client (any
--     attempt fails with a column permission error before RLS even runs).
--   * Policy mirrors invites_delete (role-only since 20260702120000): venue
--     admin/user_manager, pending invites only, and a user_manager can never
--     touch an invite that grants admin (escalation guard).
--   * The new expiry must be in the future and at most 30 days out, so a
--     resend can only ever re-open the normal invite window.
--   * The existing audit trigger on invites records the UPDATE — every resend
--     lands in the audit log with the old/new expiry.

grant update (expires_at) on table public.invites to authenticated;

create policy invites_update_resend on public.invites
  for update to authenticated
  using (
    accepted_at is null
    and public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  )
  with check (
    accepted_at is null
    and expires_at > now()
    and expires_at <= now() + interval '30 days'
    and public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );
