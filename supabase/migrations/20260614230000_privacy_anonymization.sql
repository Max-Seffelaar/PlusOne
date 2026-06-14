-- Fase 5 (AVG-laag) — Privacy: retentie-gedreven anonimisering + audit-redactie
-- (decisions #16/#29, spec §3 "Anonimisering"; event-anchored per #26; built on
-- the soft-delete model #21 and the append-only audit log #4).
--
-- What this migration adds:
--   * guest_requests.anonymized_at / refusals.anonymized_at — markers mirroring
--     guests.anonymized_at (fase 1) so every PII carrier records when it was
--     scrubbed and the job stays idempotent.
--   * public.run_privacy_retention() — the scheduled job entrypoint. Once a day
--     it anonymizes guests, landing requests and refusal reasons whose EVENT is
--     older than the venue retention window (venues.retention_months), then
--     hands the audit log to the redaction routine. Returns a per-run summary.
--   * public.redact_anonymized_audit_pii(uuid[]) — the SEPARATE, LOGGED redaction
--     function (#29: "diffs behouden structuur, namen eruit"). It scrubs the
--     PII values out of existing audit_log diffs for anonymized guests while
--     keeping the diff STRUCTURE intact, and appends an 'anonymize' audit entry
--     per guest. This is the one sanctioned writer-other-than-the-trigger on
--     audit_log; it runs as the table owner exactly as the fase-3 hardening note
--     reserved ("de latere AVG-schoning van diffs (#29) loopt via de table
--     owner"). Append-only still holds for every app role.
--   * pg_cron schedule (best-effort, guarded) calling the job at 03:30 daily.
--
-- Retention anchor (decision #26: everything hangs on the event, not the
-- calendar day): a guest is eligible when coalesce(event.ends_at,
-- event.starts_at) < now() - retention_months. Data is kept for X months AFTER
-- the event happened — the moment it is no longer needed — not X months after
-- the row was created. retention_months already exists per venue (fase 1,
-- default 12, min 1); the fase-5 settings UI binds to that column.
--
-- What is NOT touched (so statistics keep matching — #22/#17): status,
-- plus_ones, tier_id, source, added_by, removed_at, went_live_at. Anonymization
-- only nulls PII (name/email/phone/free-text) and stamps anonymized_at, so quota
-- consumption and tier occupancy are invariant across a run.
--
-- Why the anonymization UPDATE is allowed to trip the audit trigger (and is then
-- scrubbed) instead of bypassing it: decision #4 makes the audit trigger
-- impossible to skip ON PURPOSE — any client-settable "skip audit" flag would be
-- a hole. So the job lets the trigger fire and immediately redacts the resulting
-- (and all prior) diffs in the same transaction. Nothing un-scrubbed is ever
-- visible outside the job's transaction.

-- ---------------------------------------------------------------------------
-- Schema additions — anonymization markers
-- ---------------------------------------------------------------------------

alter table public.guest_requests add column anonymized_at timestamptz;
alter table public.refusals       add column anonymized_at timestamptz;

comment on column public.guest_requests.anonymized_at is
  'AVG (#16/#29): set when landing-request PII (name/email/phone/motivation/decision_reason) was scrubbed after the venue retention window.';
comment on column public.refusals.anonymized_at is
  'AVG (#29): set when the free-text reason was redacted because the linked guest was anonymized.';

-- Partial indexes for the nightly scan: only ever look at rows still carrying PII.
create index guests_event_unanonymized_idx
  on public.guests (event_id) where anonymized_at is null;
create index guest_requests_event_unanonymized_idx
  on public.guest_requests (event_id) where anonymized_at is null;
create index refusals_guest_unanonymized_idx
  on public.refusals (guest_id) where anonymized_at is null;

-- ---------------------------------------------------------------------------
-- JSONB redaction helpers — pure, internal (no app role may call them)
-- ---------------------------------------------------------------------------

-- Overlay redaction values onto the keys of one diff snapshot ({...} object),
-- but ONLY for keys that already exist in it. This preserves diff STRUCTURE
-- (#29): a PII key that was present stays present (value replaced); a key that
-- was absent is never introduced; non-PII keys are untouched.
create or replace function public.redact_jsonb_obj(p_obj jsonb, p_redaction jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_obj is null or jsonb_typeof(p_obj) <> 'object' then p_obj
    else p_obj || coalesce(
      (select jsonb_object_agg(k, p_redaction -> k)
         from jsonb_object_keys(p_redaction) as k
        where p_obj ? k),
      '{}'::jsonb)
  end;
$$;

-- Apply the redaction to both halves of an audit diff ({before, after}).
create or replace function public.redact_audit_diff(p_diff jsonb, p_redaction jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_diff is null then null
    else jsonb_build_object(
      'before', public.redact_jsonb_obj(p_diff -> 'before', p_redaction),
      'after',  public.redact_jsonb_obj(p_diff -> 'after',  p_redaction))
  end;
$$;

-- ---------------------------------------------------------------------------
-- Audit redaction — the separate, logged routine (#29)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: runs as the audit_log owner — the only role that may UPDATE
-- the otherwise append-only log (fase-3 hardening reserved this exact path for
-- the AVG scrub). For each anonymized guest it:
--   1. rewrites the PII values in every 'guests' diff to mirror the now-
--      anonymized live row (full_name -> 'Gast #n', email/phone/note -> null);
--   2. rewrites the reason in every 'refusals' diff to the redacted live value;
--   3. appends ONE clean 'anonymize' audit entry per guest (no PII), so the
--      redaction itself is recorded — append-only in spirit: we only ADD a
--      record of what was scrubbed.
-- Idempotent: re-running over already-scrubbed diffs is a no-op (the PII values
-- are already the anonymized ones).
create or replace function public.redact_anonymized_audit_pii(p_guest_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  if p_guest_ids is null or array_length(p_guest_ids, 1) is null then
    return 0;
  end if;

  -- 1. 'guests' diffs — full_name to the anonymized handle, contact fields to null.
  update public.audit_log a
  set diff = public.redact_audit_diff(a.diff, jsonb_build_object(
    'full_name', to_jsonb(g.full_name),  -- already 'Gast #n'
    'email', 'null'::jsonb,
    'phone', 'null'::jsonb,
    'note',  'null'::jsonb))
  from public.guests g
  where a.entity_type = 'guests'
    and a.entity_id = g.id
    and g.id = any(p_guest_ids)
    and a.diff is not null;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 2. 'refusals' diffs — reason to the redacted live value.
  update public.audit_log a
  set diff = public.redact_audit_diff(a.diff, jsonb_build_object('reason', to_jsonb(r.reason)))
  from public.refusals r
  where a.entity_type = 'refusals'
    and a.entity_id = r.id
    and r.guest_id = any(p_guest_ids)
    and a.diff is not null;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 3. Log the redaction: one clean entry per guest. actor_id null = system job.
  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  select
    null, e.venue_id, g.event_id, 'guests', g.id, 'anonymize',
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'anonymized_at', to_jsonb(g.anonymized_at),
        'redacted_fields', '["full_name","email","phone","note"]'::jsonb)),
    null
  from public.guests g
  join public.events e on e.id = g.event_id
  where g.id = any(p_guest_ids);

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention job — the scheduled entrypoint (#16/#29)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER (owner): bypasses RLS (the guests_update policy deliberately
-- freezes rows once anonymized_at is set, so only the owner can set it) and may
-- write the append-only audit log via the redaction routine. Pins search_path
-- and is NOT executable by any app role — the cron job runs it as owner.
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
  v_guests   integer := 0;
  v_requests integer := 0;
  v_refusals integer := 0;
  v_audit    integer := 0;
begin
  -- 1. Anonymize eligible guests. volgnr is row_number over the FULL set of
  --    guests in the event (ordered by created_at, id) so the handle 'Gast #n'
  --    is stable, gap-free per event and never collides across runs (already-
  --    anonymized rows keep their slot; only unanonymized eligible rows are
  --    written). Touches PII + anonymized_at ONLY (stats stay invariant).
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

  -- 2. Anonymize eligible landing requests (own PII carrier; not audit-tracked,
  --    so no audit scrub needed). decision_reason can name the requester, so it
  --    is nulled too. status/decided_by/decided_at are left intact (CHECK holds).
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

  -- 3. Redact refusal reasons of the just-anonymized guests (reason is NOT NULL,
  --    so a fixed marker replaces it). This UPDATE trips audit_refusals; that
  --    new diff is scrubbed alongside the rest in step 4.
  update public.refusals
  set reason = '[verwijderd na bewaartermijn]',
      anonymized_at = now()
  where guest_id = any(v_guest_ids)
    and anonymized_at is null;
  get diagnostics v_refusals = row_count;

  -- 4. Scrub the audit log for these guests (incl. the diffs the steps above
  --    just produced) and append the per-guest 'anonymize' record.
  v_audit := public.redact_anonymized_audit_pii(v_guest_ids);

  -- 5. Record the request anonymizations too (guest_requests are not otherwise
  --    audited; logging keeps the AVG action in the register).
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

  return query select v_guests, v_requests, v_refusals, v_audit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges — everything internal; nothing callable by app roles
-- ---------------------------------------------------------------------------
-- The job runs as owner via pg_cron; pgTAP and ops run it as owner directly.
-- Least privilege + spec §5 "minimaal lek-oppervlak": no anon/authenticated/
-- service_role surface. (A scheduled Edge Function alternative would need an
-- explicit grant to service_role — intentionally omitted.)
revoke execute on function
  public.redact_jsonb_obj(jsonb, jsonb),
  public.redact_audit_diff(jsonb, jsonb),
  public.redact_anonymized_audit_pii(uuid[]),
  public.run_privacy_retention()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schedule — pg_cron, best-effort and guarded so `supabase db reset` always
-- passes (DoD #5) even where the local image does not preload pg_cron.
-- ---------------------------------------------------------------------------
-- On hosted Supabase pg_cron is available; the job (re)schedules by name so
-- re-applying the migration is idempotent. Where the extension cannot be
-- created we degrade to a NOTICE — run public.run_privacy_retention() daily by
-- other means (e.g. a scheduled Edge Function calling it as owner).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-privacy-retention',
        '30 3 * * *',
        'select public.run_privacy_retention();');
      raise notice 'pg_cron: scheduled plusone-privacy-retention (03:30 daily).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.run_privacy_retention() daily by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.run_privacy_retention() daily by other means.';
  end if;
end;
$$;
