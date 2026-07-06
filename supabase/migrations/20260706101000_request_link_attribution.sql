-- Requests-epic F1 · part 2/4 — Attribution columns + auto-approve constraints +
-- link-max enforcement (ClickUp 86ey21vjt).
--
-- Attribution must survive to the check-in: a request records WHICH link it came
-- in through (guest_requests.request_link_id), the approval copies that onto the
-- guest (guests.request_link_id, wired in part 4/4), and check-in attribution is
-- then check_ins → guests.request_link_id → request_links.influencer_id. No new
-- column on check_ins needed.
--
-- Auto-approve (part 4/4) is recorded TRUTHFULLY as a system decision — never
-- attributed to a human who didn't act (#4/#15 fraud-resistance):
--   * guest_requests.decided_via enum('manual','auto'); the status CHECK now
--     allows decided_by NULL for auto decisions (decided_at stays mandatory).
--   * guests.added_by becomes nullable, guarded: only an auto-approved landing
--     guest (source='landing' + attributed to a link) may lack an adder.
--   * The audit trigger fires as usual; actor_id NULL = system (same precedent
--     as the anonymize job).
--
-- Link max (#22-consistent): max_headcount caps the APPROVED HEADCOUNT
-- sum(1 + plus_ones) attributed to a link. Requests cost nothing until approved;
-- removal frees the slot unless the guest is already inside (non-voided
-- check-in) — the same amended rule as personal quota (24 jun 2026). Enforced by
-- an AFTER trigger on guests raising SQLSTATE 45006 (45001 personal / 45002 tier
-- / 45005 event capacity are taken).

-- ---------------------------------------------------------------------------
-- 1. decision_source + guest_requests columns
-- ---------------------------------------------------------------------------

create type public.decision_source as enum ('manual', 'auto');

alter table public.guest_requests
  add column request_link_id uuid references public.request_links (id) on delete restrict,
  -- sha256 of the guest status-URL token (/r/[token]); generated app-side, the
  -- token itself never touches the DB. Nulled by the retention job (revocation).
  add column status_token_hash text,
  add column decided_via public.decision_source not null default 'manual';

comment on column public.guest_requests.request_link_id is
  'Which request link the submission came through (attribution, ClickUp 86ey21vjt). Copied onto the guest on approval.';
comment on column public.guest_requests.status_token_hash is
  'sha256 of the /r/[token] status-URL token. NULL after retention anonymization (auto-revocation).';
comment on column public.guest_requests.decided_via is
  '''manual'' = a human decided (decided_by set); ''auto'' = auto-approve via the link (decided_by NULL, audit actor NULL = system).';

-- Status consistency: an auto decision has a moment but no human actor.
alter table public.guest_requests
  drop constraint guest_requests_check,
  add constraint guest_requests_check check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (
      status <> 'pending'
      and decided_at is not null
      and (decided_by is not null or decided_via = 'auto')
    )
  );

create unique index guest_requests_status_token_idx
  on public.guest_requests (status_token_hash) where status_token_hash is not null;
create index guest_requests_link_status_idx
  on public.guest_requests (request_link_id, status)
  where request_link_id is not null;

-- Backfill: existing requests all came through the event's (now default) link.
update public.guest_requests gr
set request_link_id = rl.id
from public.request_links rl
where rl.event_id = gr.event_id
  and rl.is_default
  and gr.request_link_id is null;

-- ---------------------------------------------------------------------------
-- 2. guests: attribution + nullable added_by (system-approved landing guests)
-- ---------------------------------------------------------------------------

alter table public.guests
  add column request_link_id uuid references public.request_links (id) on delete restrict;

comment on column public.guests.request_link_id is
  'Request-link attribution (immutable once set): which link brought this guest in. Check-in attribution joins through this column.';

create index guests_request_link_idx
  on public.guests (request_link_id) where request_link_id is not null;

alter table public.guests
  alter column added_by drop not null,
  add constraint guests_added_by_check check (
    added_by is not null
    or (source = 'landing' and request_link_id is not null)
  );

comment on column public.guests.added_by is
  'Who put this guest on the list. NULL only for auto-approved landing guests (source=landing + request_link_id set) — the system, not a person, decided (#4/#15). UI shows "via {link}".';

-- Attribution is immutable (fraud: staff must not be able to re-credit an
-- influencer after the fact). NULL → NULL passes (idempotent outbox replays);
-- any actual change is rejected.
create or replace function public.guard_guest_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_link_id is distinct from old.request_link_id then
    raise exception using errcode = '23514',
      message = 'De aanvraaglink-attributie van een gast is vast.';
  end if;
  return new;
end;
$$;

create trigger guard_guest_attribution
  before update on public.guests
  for each row execute function public.guard_guest_attribution();

-- ---------------------------------------------------------------------------
-- 3. Link-max enforcement (SQLSTATE 45006)
-- ---------------------------------------------------------------------------
-- Same shape as enforce_event_capacity/enforce_guest_quota: a pure per-row
-- helper, a SECURITY DEFINER consumption sum, and an AFTER trigger that only
-- raises on a NET increase. "Inside" (non-voided check-in) keeps counting after
-- removal — you can't reclaim a slot from someone already in the room (#22 as
-- amended 24 jun 2026).

create or replace function public.link_headcount_contribution(g public.guests, p_is_inside boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when g.status in ('pending', 'approved', 'checked_in') then 1 + g.plus_ones
    when p_is_inside then 1 + g.plus_ones
    else 0
  end;
$$;

create or replace function public.request_link_consumption(p_link_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    public.link_headcount_contribution(
      g,
      exists (
        select 1 from public.check_ins ci
        where ci.guest_id = g.id and ci.voided_at is null
      )
    )
  ), 0)::int
  from public.guests g
  where g.request_link_id = p_link_id;
$$;

create or replace function public.enforce_request_link_max()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
  v_is_inside boolean;
  v_old int := 0;
  v_new int;
  v_total int;
begin
  if new.request_link_id is null then
    return null;
  end if;

  select rl.max_headcount into v_max
  from public.request_links rl where rl.id = new.request_link_id;
  if v_max is null then
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
    v_total := public.request_link_consumption(new.request_link_id);
    if v_total > v_max then
      raise exception using
        errcode = '45006',
        message = format('Deze aanvraaglink zit vol: %s van %s plekken bezet.', v_total, v_max),
        hint = format('link_full;consumed=%s;max=%s', v_total, v_max);
    end if;
  end if;
  return null;
end;
$$;

create trigger enforce_request_link_max
  after insert or update on public.guests
  for each row execute function public.enforce_request_link_max();

-- ---------------------------------------------------------------------------
-- 4. Retention job: kill the status token with the PII (#29)
-- ---------------------------------------------------------------------------
-- Body = 20260617030000_restore_contacts_retention (the contacts-aware v2 —
-- keep in LOCKSTEP with it) with two additions in step 2: status_token_hash →
-- NULL (the saved /r/[token] URL of an anonymized request goes generically
-- "niet gevonden") and the redacted_fields list gains the column.

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

  -- 2. Anonymize eligible landing requests + REVOKE their status tokens (F1).
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
        status_token_hash = null,
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
        'redacted_fields', '["full_name","email","phone","motivation","decision_reason","status_token_hash"]'::jsonb)),
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

-- ---------------------------------------------------------------------------
-- Privileges — internal math/triggers stay internal (posture of the siblings).
-- ---------------------------------------------------------------------------
revoke execute on function
  public.guard_guest_attribution(),
  public.link_headcount_contribution(public.guests, boolean),
  public.request_link_consumption(uuid),
  public.enforce_request_link_max(),
  public.run_privacy_retention()
from public, anon, authenticated, service_role;
