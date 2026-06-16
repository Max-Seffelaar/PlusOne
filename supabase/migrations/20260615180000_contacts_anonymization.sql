-- Sessie C — AVG: adresboek-retentie (#8/#10/#11, decisions #16/#29).
--
-- The contacts table is a new PII carrier (name/email/phone/BIRTHDATE) and must
-- fold into the existing retention job. Contacts are VENUE-level, not event-
-- anchored, so the rule differs from guests: anonymize a contact once it is no
-- longer referenced by any guest on a still-retained event AND has had no
-- activity within the venue retention window. Reuse is the point of the address
-- book, so a contact lingers as long as it is in active use.
--
-- Scrub: full_name -> 'Contact #n' (stable per venue), email/phone/birthdate/note
-- -> null, anonymized_at stamped. The generated email_norm/phone_norm recompute
-- to null, which also frees the dedup unique-index slots. Because contacts are
-- audited, the prior audit diffs are redacted in the same transaction, mirroring
-- the guests path. run_privacy_retention keeps its 4-column summary; the contacts
-- sweep is a side effect (verify by querying contacts.anonymized_at).

-- ---------------------------------------------------------------------------
-- Audit redaction for anonymized contacts (sibling of redact_anonymized_audit_pii)
-- ---------------------------------------------------------------------------

create or replace function public.redact_anonymized_contact_audit_pii(p_contact_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  if p_contact_ids is null or array_length(p_contact_ids, 1) is null then
    return 0;
  end if;

  -- Rewrite PII values in every 'contacts' diff to mirror the now-anonymized
  -- live row; the generated *_norm columns appear in diffs too, so null them.
  update public.audit_log a
  set diff = public.redact_audit_diff(a.diff, jsonb_build_object(
    'full_name',  to_jsonb(c.full_name),  -- already 'Contact #n'
    'email',      'null'::jsonb,
    'email_norm', 'null'::jsonb,
    'phone',      'null'::jsonb,
    'phone_norm', 'null'::jsonb,
    'birthdate',  'null'::jsonb,
    'note',       'null'::jsonb))
  from public.contacts c
  where a.entity_type = 'contacts'
    and a.entity_id = c.id
    and c.id = any(p_contact_ids)
    and a.diff is not null;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- One clean 'anonymize' entry per contact (venue-scoped, no event). actor null = system.
  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  select
    null, c.venue_id, null, 'contacts', c.id, 'anonymize',
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'anonymized_at', to_jsonb(c.anonymized_at),
        'redacted_fields', '["full_name","email","phone","birthdate","note"]'::jsonb)),
    null
  from public.contacts c
  where c.id = any(p_contact_ids);

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Extend the retention job with the contacts sweep (same 4-column summary)
-- ---------------------------------------------------------------------------

create or replace function public.run_privacy_retention()
returns table (
  guests_anonymized   integer,
  requests_anonymized integer,
  refusals_redacted   integer,
  audit_rows_redacted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest_ids   uuid[];
  v_request_ids uuid[];
  v_contact_ids uuid[];
  v_guests   integer := 0;
  v_requests integer := 0;
  v_refusals integer := 0;
  v_audit    integer := 0;
begin
  -- 1. Anonymize eligible guests (event-anchored). Stats stay invariant.
  with old_events as (
    select e.id as event_id
    from public.events e
    join public.venues v on v.id = e.venue_id
    where coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
  ),
  ranked as (
    select g.id, g.anonymized_at,
           row_number() over (partition by g.event_id order by g.created_at, g.id) as volgnr
    from public.guests g
    join old_events oe on oe.event_id = g.event_id
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
      and rk.anonymized_at is null
    returning g.id
  )
  select coalesce(array_agg(id), '{}') into v_guest_ids from upd;
  v_guests := coalesce(array_length(v_guest_ids, 1), 0);

  -- 2. Anonymize eligible landing requests (event-anchored, own PII carrier).
  with old_events as (
    select e.id as event_id
    from public.events e
    join public.venues v on v.id = e.venue_id
    where coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
  ),
  ranked as (
    select gr.id, gr.anonymized_at,
           row_number() over (partition by gr.event_id order by gr.created_at, gr.id) as volgnr
    from public.guest_requests gr
    join old_events oe on oe.event_id = gr.event_id
  ),
  upd as (
    update public.guest_requests gr
    set full_name = 'Aanvraag #' || rk.volgnr,
        email = null,
        phone = null,
        motivation = null,
        decision_reason = null,
        anonymized_at = now()
    from ranked rk
    where gr.id = rk.id
      and rk.anonymized_at is null
    returning gr.id
  )
  select coalesce(array_agg(id), '{}') into v_request_ids from upd;
  v_requests := coalesce(array_length(v_request_ids, 1), 0);

  -- 3. Redact refusal reasons of the just-anonymized guests.
  update public.refusals
  set reason = '[verwijderd na bewaartermijn]',
      anonymized_at = now()
  where guest_id = any(v_guest_ids)
    and anonymized_at is null;
  get diagnostics v_refusals = row_count;

  -- 4. Scrub the guests/refusals audit diffs + append per-guest 'anonymize'.
  v_audit := public.redact_anonymized_audit_pii(v_guest_ids);

  -- 5. Record the request anonymizations (guest_requests aren't otherwise audited).
  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  select
    null, e.venue_id, gr.event_id, 'guest_requests', gr.id, 'anonymize',
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'anonymized_at', to_jsonb(gr.anonymized_at),
        'redacted_fields', '["full_name","email","phone","motivation","decision_reason"]'::jsonb)),
    null
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  where gr.id = any(v_request_ids);

  -- 6. Anonymize eligible address-book contacts (VENUE-anchored). A contact is
  --    eligible when it is inactive past the venue window AND no longer linked to
  --    any guest on a still-retained event. volgnr ranks over the FULL venue
  --    contact set so 'Contact #n' is stable and collision-free across runs.
  with ranked as (
    select c.id, c.venue_id, c.anonymized_at, c.updated_at,
           row_number() over (partition by c.venue_id order by c.created_at, c.id) as volgnr
    from public.contacts c
  ),
  eligible as (
    select r.id, r.volgnr
    from ranked r
    join public.venues v on v.id = r.venue_id
    where r.anonymized_at is null
      and r.updated_at < now() - make_interval(months => v.retention_months)
      and not exists (
        select 1
        from public.guests g
        join public.events e on e.id = g.event_id
        where g.contact_id = r.id
          and coalesce(e.ends_at, e.starts_at) >= now() - make_interval(months => v.retention_months)
      )
  ),
  upd as (
    update public.contacts c
    set full_name = 'Contact #' || el.volgnr,
        email = null,
        phone = null,
        birthdate = null,
        note = null,
        anonymized_at = now()
    from eligible el
    where c.id = el.id
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_contact_ids from upd;

  -- 7. Scrub the contacts audit diffs + append per-contact 'anonymize'. Counted
  --    into the audit total so the summary reflects all redacted rows.
  v_audit := v_audit + public.redact_anonymized_contact_audit_pii(v_contact_ids);

  return query select v_guests, v_requests, v_refusals, v_audit;
end;
$$;

revoke execute on function
  public.redact_anonymized_contact_audit_pii(uuid[]),
  public.run_privacy_retention()
from public, anon, authenticated, service_role;
