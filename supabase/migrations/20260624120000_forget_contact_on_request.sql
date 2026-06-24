-- On-request erasure — "vergeet mij nu" (AVG art. 17 / right to be forgotten),
-- decisions #16/#29. Companion to the nightly retention job
-- (20260614230000 / 20260615180000): same anonymization machinery, but triggered
-- by an admin on a SINGLE person on demand, IGNORING the retention window.
--
-- Scope of one erasure = the person within ONE venue (the controller scope under
-- the AVG): the address-book CONTACT + every guest row linked to it
-- (guests.contact_id) across all the venue's events + those guests' refusal
-- reasons + all of their audit diffs. Landing requests and plus-one-only contacts
-- are NOT cascaded here (no reliable person key) — they remain covered by the
-- nightly window-based sweep.
--
-- "Forget" = ANONYMIZE, never hard delete (#21: soft-delete only, DELETE is
-- revoked for every app role). Names become 'Gast #n' / 'Contact #n', other PII
-- is nulled, anonymized_at is stamped, and is_permanent is cleared so an
-- anonymized contact never auto-syncs onto a new event (#11). Only PII +
-- anonymized_at change, so quota consumption and tier occupancy stay invariant
-- (#22), exactly like the scheduled job.
--
-- Authorization — the DATABASE is the security boundary (#1). Unlike the
-- owner-only scheduled job, this is callable by an authenticated user, so it
-- SELF-GUARDS: admin of the contact's venue. Admin is an MFA-mandatory role
-- (#20), so in prod the caller already passed MFA at login; we deliberately do
-- NOT add a per-action AAL2 step-up — erasure-on-request must stay frictionless
-- for an admin handling a GDPR request. The venue is DERIVED from the contact,
-- never trusted from the caller. SECURITY DEFINER so it may write past RLS
-- (anonymized rows are frozen for app roles) and reuse the owner-only redaction
-- routines.

create or replace function public.forget_contact(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id   uuid;
  v_already    timestamptz;
  v_guest_ids  uuid[];
  v_guests     integer := 0;
  v_refusals   integer := 0;
  v_contact    boolean := false;
begin
  -- 0. Resolve the contact + its venue (venue is derived, never client-supplied).
  select venue_id, anonymized_at into v_venue_id, v_already
  from public.contacts
  where id = p_contact_id;
  if v_venue_id is null then
    raise exception using errcode = 'P0002', message = 'Contact niet gevonden.';
  end if;

  -- 1. Self-guard: admin of THIS venue. Admin is MFA-mandatory (#20) so the actor
  --    has already passed MFA at login; no per-action AAL2 step-up here on purpose
  --    (erasure-on-request must stay frictionless). The app-layer button is gated
  --    on the same admin capability — convenience on top of this boundary.
  if not public.has_venue_role(v_venue_id, '{admin}'::public.venue_role[]) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin van deze locatie mag een contact op verzoek wissen.';
  end if;

  -- 2. Anonymize every guest row of this person, across all their events in the
  --    venue. volgnr ranks over the FULL guest set of each touched event
  --    (created_at, id) so 'Gast #n' is exactly what the nightly job would assign
  --    — stable, gap-free per event, collision-free across runs. Touches PII +
  --    anonymized_at ONLY, so statistics stay invariant.
  with ranked as (
    select g.id, g.contact_id, g.anonymized_at,
           row_number() over (partition by g.event_id order by g.created_at, g.id) as volgnr
    from public.guests g
    where g.event_id in (
      select gg.event_id from public.guests gg where gg.contact_id = p_contact_id
    )
  ),
  upd as (
    update public.guests g
    set full_name = 'Gast #' || rk.volgnr,
        email = null,
        phone = null,
        note = null,
        anonymized_at = now()
    from ranked rk
    where g.id = rk.id
      and rk.contact_id = p_contact_id
      and rk.anonymized_at is null
    returning g.id
  )
  select coalesce(array_agg(id), '{}') into v_guest_ids from upd;
  v_guests := coalesce(array_length(v_guest_ids, 1), 0);

  -- 3. Redact the free-text refusal reasons of those guests (reason is NOT NULL,
  --    so a fixed marker replaces it). This UPDATE trips audit_refusals; the new
  --    diff is scrubbed alongside the rest in step 4.
  update public.refusals
  set reason = '[verwijderd na bewaartermijn]',
      anonymized_at = now()
  where guest_id = any(v_guest_ids)
    and anonymized_at is null;
  get diagnostics v_refusals = row_count;

  -- 4. Scrub the guests/refusals audit diffs (structure kept, PII out) + append
  --    one clean 'anonymize' entry per guest. Reuses the privacy-job routine.
  perform public.redact_anonymized_audit_pii(v_guest_ids);

  -- 5. Anonymize the contact record itself (venue-ranked 'Contact #n') and CLEAR
  --    is_permanent so it never auto-syncs onto a new event (#11). Idempotent:
  --    skip if a prior run / the nightly sweep already anonymized it.
  if v_already is null then
    with ranked as (
      select c.id,
             row_number() over (partition by c.venue_id order by c.created_at, c.id) as volgnr
      from public.contacts c
      where c.venue_id = v_venue_id
    )
    update public.contacts c
    set full_name = 'Contact #' || rk.volgnr,
        email = null,
        phone = null,
        birthdate = null,
        note = null,
        is_permanent = false,
        anonymized_at = now()
    from ranked rk
    where c.id = rk.id
      and c.id = p_contact_id;
    perform public.redact_anonymized_contact_audit_pii(array[p_contact_id]);
    v_contact := true;
  end if;

  return jsonb_build_object(
    'guests_anonymized', v_guests,
    'refusals_redacted', v_refusals,
    'contact_anonymized', v_contact);
end;
$$;

comment on function public.forget_contact(uuid) is
  'AVG #29 on-request erasure: immediately anonymizes one address-book contact + all its linked guests (and their refusals), ignoring the retention window. Admin-of-venue only (self-guarded; admin is an MFA-mandatory role, so no extra per-action AAL2 step-up). Audit diffs are scrubbed structure-preserving and the action is logged. Reuses run_privacy_retention machinery scoped to one person.';

-- Least privilege: an authenticated admin calls it (self-guarded inside); never
-- anon, and not service_role (server actions use the user-scoped client, CLAUDE.md).
revoke execute on function public.forget_contact(uuid) from public, anon, service_role;
grant execute on function public.forget_contact(uuid) to authenticated;
