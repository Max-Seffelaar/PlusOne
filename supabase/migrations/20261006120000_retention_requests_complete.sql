-- Legal v0.3 B1 (ClickUp z8uq9m2hm3) — retention + on-request erasure cover
-- guest_requests completely; platform_invites gets a 24-month sweep.
-- Brief: legal-v03-plan-claude-code.md §3 B1, decision 5 (§1). Absorbs the
-- platform_invites half of z8uq9m0vyj.
--
-- Three gaps, all verified against main on 2026-10-05:
--
-- 1. run_privacy_retention() step 2 anonymized a landing request but left
--    `dedupe_key` (the e-mail, or the phone digits) and `birthdate` on the row.
--    Both are PII. `dedupe_key` was also the root of the dedup leak 2b's
--    comment describes: an anonymized request stays `pending`, so its
--    fingerprint kept occupying the partial unique index
--    (event_id, dedupe_key) where status = 'pending' and dedupe_key is not null
--    and later submissions with the same address kept landing on the dedup
--    branch. Nulling it closes that structurally — an anonymized request no
--    longer matches anything. Step 2 now nulls both on this run's rows, and
--    step 2c (driven off anonymized_at, like 2b) nulls them on EVERY
--    anonymized request, which backfills the rows earlier runs left behind.
--    Step 2b stays as the self-healing mirror sweep.
--
-- 2. forget_contact() erased the contact + its linked guests but not the
--    person's landing requests ("no reliable person key", 20260624120000).
--    It now matches the venue's not-yet-anonymized requests on the contact's
--    e-mail, with the phone as fallback only (see the function's comment) — read BEFORE the contact itself
--    is scrubbed — and applies exactly the retention scrub to them: 'Aanvraag
--    #n' (ranked over the full event, like the nightly job), contact fields,
--    motivation, decision fields, status token, dedupe_key, birthdate null,
--    anonymized_at stamped; their status-token mirrors deleted; one
--    `anonymize` audit row per request (retention step 5's shape).
--    Scope is the CONTACT's venue, derived server-side — a request with the
--    same e-mail at another venue is a different controller's record and is
--    never touched, even when the caller is admin at both.
--
-- 3. platform_invites (prospect e-mail + operator note) had no retention at
--    all. New step 8 of run_privacy_retention(): an invite whose last activity
--    — greatest(created_at, last_sent_at, revoked_at); the table has no
--    updated_at, and last_sent_at is the "last contact" column — is older than
--    24 months gets e-mail and note nulled and anonymized_at stamped. The
--    audit trigger copies both fields into every invite/resend/revoke diff, so
--    a nulled column alone would leave the address in audit_log; step 8b
--    scrubs email/note out of those diffs through a named owner-only helper,
--    the same structure-preserving redaction the guest/contact/request paths
--    use. (Decision 5 keeps the audit diffs of invites/venue_memberships/
--    influencers; platform_invites is the stated exception that gets a sweep.)
--    Two limits, by design: (a) "anonymized" covers platform_invites only —
--    inviteBetaAction provisions an auth.users row via inviteUserByEmail, and
--    that row keeps the prospect's address; plan decision 4 (inactive accounts:
--    no sweep, erasure "on request") covers it. (b) Funnel decay is intended:
--    a swept invite no longer joins auth.users, so even a converted customer's
--    invite reports `invited`/`revoked` once it is 24 months idle.
--
-- Shape changes (expand-only for the deployed app):
--   * platform_invites.anonymized_at (new, nullable); platform_invites.email
--     becomes nullable, but ONLY on an anonymized row (CHECK below).
--   * run_privacy_retention() returns one extra column,
--     platform_invites_anonymized. A RETURNS TABLE change needs DROP + CREATE;
--     the pg_cron job calls it by name (`select public.run_privacy_retention();`)
--     so the schedule is unaffected, and EXECUTE is re-revoked below.
--   * forget_contact() returns one extra key, requests_anonymized.

-- ---------------------------------------------------------------------------
-- 1. platform_invites — anonymized_at + nullable e-mail on anonymized rows
-- ---------------------------------------------------------------------------

alter table public.platform_invites
  add column anonymized_at timestamptz;

alter table public.platform_invites
  alter column email drop not null;

-- An open/revoked invite always has an address; an anonymized one never has an
-- address or a note. NOT VALID is unnecessary: every existing row has an email
-- and anonymized_at null.
alter table public.platform_invites
  add constraint platform_invites_anonymized_shape check (
    (anonymized_at is null and email is not null)
    or (anonymized_at is not null and email is null and note is null)
  );

comment on column public.platform_invites.anonymized_at is
  'Set by run_privacy_retention() step 8 once the invite has seen no activity '
  'for 24 months: email and note are nulled, the row is frozen. Never set by '
  'the app (platform_invites_insert pins it null; guard_platform_invite_update '
  'refuses it on UPDATE).';

-- Grant matrix: unchanged. The table-level `grant select, insert, update ...
-- to authenticated` from 20260923150000 covers the new column; RLS keeps it
-- platform-admin-only. An invite is born un-anonymized (the policy below, the
-- same pin as revoked_at), and the guard refuses any app-role UPDATE that sets
-- anonymized_at or touches an anonymized row.

alter policy platform_invites_insert on public.platform_invites
  with check (
    public.is_platform_admin()
    and invited_by = (select auth.uid())
    and revoked_at is null
    and revoked_by is null
    and anonymized_at is null
  );

-- ---------------------------------------------------------------------------
-- 2. Immutability guard — admits exactly the owner's anonymize transition
-- ---------------------------------------------------------------------------
-- Body = 20260923150000 plus two rules in front:
--   * an anonymized row is frozen for everyone (the sweep never revisits it);
--   * setting anonymized_at is the owner's job only (current_user is the
--     function owner inside the SECURITY DEFINER sweep; every PostgREST request
--     runs as `authenticated`/`anon` — the same role test
--     guard_guest_request_decision_fields uses), and must null email + note
--     while leaving every other column as it was.
-- SECURITY INVOKER kept, as before — `current_user` must be the real caller.

create or replace function public.guard_platform_invite_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymized_at is not null then
    raise exception 'an anonymized platform invite cannot be changed'
      using errcode = '42501';
  end if;

  if new.anonymized_at is not null then
    if current_user in ('authenticated', 'anon')
       or new.email is not null
       or new.note is not null
       or new.id is distinct from old.id
       or new.invited_by is distinct from old.invited_by
       or new.created_at is distinct from old.created_at
       or new.last_sent_at is distinct from old.last_sent_at
       or new.revoked_at is distinct from old.revoked_at
       or new.revoked_by is distinct from old.revoked_by then
      raise exception 'platform invites are anonymized by the retention job only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.invited_by is distinct from old.invited_by
     or new.created_at is distinct from old.created_at then
    raise exception 'platform_invites identity columns are immutable'
      using errcode = '42501';
  end if;

  -- A revoke is one-way, its attribution is final, and the row becomes a
  -- point-in-time record. `revoked_by` and `note` both have to be named
  -- explicitly: the update policy's WITH CHECK only demands
  -- `revoked_by = auth.uid()`, so without this a SECOND platform admin could
  -- re-stamp an already-revoked row as their own work (or rewrite the note that
  -- explains why it was revoked) while leaving revoked_at untouched. Re-invite
  -- by inserting a new row instead.
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at
          or new.revoked_by is distinct from old.revoked_by
          or new.note is distinct from old.note) then
    raise exception 'a revoked platform invite cannot be changed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_platform_invite_update() is
  'BEFORE UPDATE guard on platform_invites: freezes id/email/invited_by/'
  'created_at, makes a revoke one-way, and admits anonymization (email+note '
  'null, anonymized_at set) only from the retention job; an anonymized row is '
  'frozen.';

revoke execute on function public.guard_platform_invite_update()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Audit scrub for anonymized platform invites — owner-only
-- ---------------------------------------------------------------------------
-- Sibling of redact_anonymized_request_audit_pii(): the named, owner-only
-- routines are the only writers on audit_log besides the trigger (#29).
-- Structure-preserving (redact_audit_diff only overwrites keys that exist),
-- driven off anonymized_at and restricted to diffs that still carry a value,
-- so it backfills and is idempotent. Covers the diff the anonymize UPDATE
-- itself writes (its `before` holds the address) as well as every earlier
-- create/resend/revoke diff.

create or replace function public.redact_anonymized_platform_invite_audit_pii()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  update public.audit_log a
  set diff = public.redact_audit_diff(a.diff, jsonb_build_object(
    'email', 'null'::jsonb,
    'note',  'null'::jsonb))
  from public.platform_invites pi
  where a.entity_type = 'platform_invites'
    and a.entity_id = pi.id
    and pi.anonymized_at is not null
    and a.diff is not null
    and (   (a.diff -> 'before' ->> 'email') is not null
         or (a.diff -> 'after'  ->> 'email') is not null
         or (a.diff -> 'before' ->> 'note')  is not null
         or (a.diff -> 'after'  ->> 'note')  is not null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.redact_anonymized_platform_invite_audit_pii()
  from public, anon, authenticated, service_role;

comment on function public.redact_anonymized_platform_invite_audit_pii() is
  'Owner-only AVG scrub (#29, z8uq9m2hm3): nulls email/note in the audit diffs '
  'of every anonymized platform invite. Idempotent; called by '
  'run_privacy_retention.';

-- ---------------------------------------------------------------------------
-- 3b. redact_anonymized_request_audit_pii — optional id scope
-- ---------------------------------------------------------------------------
-- Body = 20260919090000 plus `p_request_ids`: null (the nightly job) keeps the
-- global, self-healing sweep; forget_contact passes its own ids so a venue
-- admin's click touches only the audit rows of the requests it just erased —
-- never another tenant's, and no join against the whole anonymized population.
-- The zero-arg signature is dropped (CREATE OR REPLACE cannot add a parameter);
-- its only callers are run_privacy_retention and forget_contact, both redefined
-- below. Owner-only, as before.

drop function public.redact_anonymized_request_audit_pii();

create or replace function public.redact_anonymized_request_audit_pii(
  p_request_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  update public.audit_log a
  set diff = public.redact_audit_diff(a.diff, jsonb_build_object(
    'decision_message', 'null'::jsonb,
    'decision_reason',  'null'::jsonb))
  from public.guest_requests gr
  where a.entity_type = 'guest_requests'
    and a.entity_id = gr.id
    and gr.anonymized_at is not null
    and (p_request_ids is null or gr.id = any(p_request_ids))
    and a.diff is not null
    and (   (a.diff -> 'before' ->> 'decision_message') is not null
         or (a.diff -> 'after'  ->> 'decision_message') is not null
         or (a.diff -> 'before' ->> 'decision_reason')  is not null
         or (a.diff -> 'after'  ->> 'decision_reason')  is not null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.redact_anonymized_request_audit_pii(uuid[])
  from public, anon, authenticated, service_role;

comment on function public.redact_anonymized_request_audit_pii(uuid[]) is
  'Owner-only AVG scrub (#29, z8uq9m0hw6): nulls decision_message/decision_reason in the audit diffs of anonymized guest requests — all of them (null, the nightly job) or the given ids (forget_contact). Idempotent.';

-- ---------------------------------------------------------------------------
-- 4. run_privacy_retention — dedupe_key/birthdate + platform_invites sweep
-- ---------------------------------------------------------------------------
-- Body = 20260919090000 plus:
--   * step 2 also nulls dedupe_key + birthdate;
--   * step 2c also nulls them on EVERY anonymized request (backfill, idempotent);
--   * step 5's anonymize entry lists them under redacted_fields;
--   * new step 8 (platform_invites, 24 months since last activity) + 8b (their
--     audit diffs), counted into the new platform_invites_anonymized column and
--     the audit total respectively.

drop function public.run_privacy_retention();

create or replace function public.run_privacy_retention()
returns table (
  guests_anonymized           integer,
  requests_anonymized         integer,
  refusals_redacted           integer,
  audit_rows_redacted         integer,
  platform_invites_anonymized integer
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
  v_invites  integer := 0;
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
  --    z8uq9m2hm3: dedupe_key (the e-mail or phone digits) and birthdate are
  --    PII too. With dedupe_key null an anonymized request no longer occupies
  --    the partial unique dedup index, so later submissions are not deduped
  --    against it — the leak 2b's comment describes is closed at the source.
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
        decision_message = null,
        status_token_hash = null,
        dedupe_key = null,
        birthdate = null,
        anonymized_at = now()
    from ranked rk
    where gr.id = rk.id
      and rk.anonymized_at is null
    returning gr.id
  )
  select coalesce(array_agg(id), '{}') into v_request_ids from upd;
  v_requests := coalesce(array_length(v_request_ids, 1), 0);

  -- 2b. z8uq9m0h2v — drop the status-token mirrors of every ANONYMIZED request,
  --     not just the ones step 2 touched on this run. A mirror holds a name and
  --     plus-ones supplied by the caller of a deduped submission; step 2 nulls
  --     the request's own `status_token_hash`, and this is the matching
  --     revocation for the mirrored one.
  --
  --     Scoping this to `any(v_request_ids)` — what 20260918140000 shipped —
  --     left a hole the fresh-session security review of PR #300 reproduced:
  --     step 2 cleared neither `status` nor `dedupe_key`, so an anonymized
  --     request stayed `pending` with its fingerprint and kept catching later
  --     submissions on the dedup branch. Those wrote a mirror carrying the new
  --     caller's real name against a request already anonymized — which this
  --     step, looking only at ids from its own run, never saw again. Retention
  --     run #2 reported `0 0 0 0` and the name survived indefinitely.
  --     (Since z8uq9m2hm3 step 2 nulls dedupe_key, so that path is closed at
  --     the source; this sweep stays as the self-healing backstop.)
  --
  --     Driving the delete off `anonymized_at` instead of the run's id list
  --     makes the sweep self-healing: it cleans orphans written before this
  --     migration as well as any a future path manages to create.
  delete from public.guest_request_status_mirrors m
  using public.guest_requests gr
  where gr.id = m.request_id
    and gr.anonymized_at is not null;

  -- 2c. z8uq9m0hw6 — the free-text decision fields go on EVERY anonymized
  --     request, not only this run's: earlier runs, and a deny written after
  --     anonymization, are otherwise never reached again (same lesson as 2b).
  --     z8uq9m2hm3 — dedupe_key and birthdate likewise, which backfills every
  --     request anonymized before step 2 nulled them.
  update public.guest_requests gr
  set decision_message = null,
      decision_reason = null,
      dedupe_key = null,
      birthdate = null
  where gr.anonymized_at is not null
    and (gr.decision_message is not null or gr.decision_reason is not null
         or gr.dedupe_key is not null or gr.birthdate is not null);

  -- 3. Redact refusal reasons of the just-anonymized guests.
  update public.refusals
  set reason = '[verwijderd na bewaartermijn]',
      anonymized_at = now()
  where guest_id = any(v_guest_ids)
    and anonymized_at is null;
  get diagnostics v_refusals = row_count;

  -- 4. Scrub the guests/refusals audit diffs + append per-guest 'anonymize'.
  v_audit := public.redact_anonymized_audit_pii(v_guest_ids);

  -- 4b. z8uq9m0hw6 — scrub the free-text decision fields (the venue message
  --     and the deny reason) out of EVERY anonymized request's own
  --     approve/deny diffs, through the named owner-only helper.
  v_audit := v_audit + public.redact_anonymized_request_audit_pii();

  -- 5. Record the request anonymizations (guest_requests aren't otherwise audited).
  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  select
    null, e.venue_id, gr.event_id, 'guest_requests', gr.id, 'anonymize',
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'anonymized_at', to_jsonb(gr.anonymized_at),
        'redacted_fields', '["full_name","email","phone","motivation","decision_reason","decision_message","status_token_hash","dedupe_key","birthdate"]'::jsonb)),
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

  -- 8. z8uq9m2hm3 — platform invites (prospect PII, no venue): 24 months after
  --    the last activity on the row. platform_invites has no updated_at;
  --    last_sent_at is the last contact, revoked_at the last operator action
  --    (greatest() skips the null of an open invite). The anonymize UPDATE
  --    fires audit_platform_invites like any other write — that diff is the
  --    record of the anonymization, and 8b scrubs the address out of it.
  update public.platform_invites pi
  set email = null,
      note = null,
      anonymized_at = now()
  where pi.anonymized_at is null
    and greatest(pi.created_at, pi.last_sent_at, pi.revoked_at)
        < now() - interval '24 months';
  get diagnostics v_invites = row_count;

  -- 8b. Scrub email/note out of every anonymized invite's audit diffs.
  v_audit := v_audit + public.redact_anonymized_platform_invite_audit_pii();

  return query select v_guests, v_requests, v_refusals, v_audit, v_invites;
end;
$$;

revoke execute on function public.run_privacy_retention()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. forget_contact — the person's landing requests go with them
-- ---------------------------------------------------------------------------
-- Body = 20260624120000 plus step 0b (read the person keys) and step 5b (the
-- request scrub). Everything else — the venue derived from the contact, the
-- admin-of-this-venue self-guard, the guest/refusal/contact cascade — is
-- unchanged. SECURITY DEFINER / search_path / grants as before.
--
-- Matching (decision Max, 2026-10-05 — phone is a FALLBACK key): a request of
-- the contact's venue (guest_requests.venue_id AND the event's venue — the
-- denormalized column is server-derived, the join is belt and braces) is erased
-- when (a) its e-mail equals the contact's, or (b) its phone digits equal the
-- contact's AND it carries no e-mail or the contact's own. Keys are
-- contacts.email_norm / phone_norm, with the identical expressions on the
-- request side (same as submit_guest_request and the autolink trigger). Known
-- miss, deliberately not "fixed" here: digits-only normalisation means a
-- contact stored as 06… does not meet a request stored as +316… — the same
-- miss every contact path has today. Equality only, never a prefix/like, and
-- an empty key matches nothing.
-- Already-anonymized requests are skipped (idempotent). A contact that is
-- itself already anonymized has no e-mail/phone left, so a re-run matches no
-- request — the first run is the one that cascades.

create or replace function public.forget_contact(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id    uuid;
  v_already     timestamptz;
  v_email       text;
  v_phone_dig   text;
  v_guest_ids   uuid[];
  v_request_ids uuid[];
  v_guests      integer := 0;
  v_requests    integer := 0;
  v_refusals    integer := 0;
  v_contact     boolean := false;
begin
  -- 0. Resolve the contact + its venue (venue is derived, never client-supplied).
  --    The person keys are the contact's stored generated columns
  --    (20260615110000) — the one normalisation every contact path shares.
  select venue_id, anonymized_at, email_norm, phone_norm
    into v_venue_id, v_already, v_email, v_phone_dig
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

  -- 5b. z8uq9m2hm3 — the person's landing requests in THIS venue, across all
  --     its events, regardless of the retention window. Same scrub as
  --     run_privacy_retention step 2 ('Aanvraag #n' ranked over the full event
  --     so the handle equals what the nightly job would assign). guest_requests
  --     is audited only on a status change, which this update never makes.
  if v_email is not null or v_phone_dig is not null then
    with mine as (
      select gr.id, gr.event_id
      from public.guest_requests gr
      join public.events e on e.id = gr.event_id
      where gr.venue_id = v_venue_id
        and e.venue_id = v_venue_id
        and gr.anonymized_at is null
        and (
              -- (a) the e-mail matches
              (v_email is not null
               and nullif(lower(btrim(coalesce(gr.email, ''))), '') = v_email)
              -- (b) phone as FALLBACK only: the phone matches AND the request
              --     carries no e-mail or the contact's own. A shared number
              --     (office, family) never erases someone with another address.
              --     (Decision Max, 2026-10-05.)
           or (v_phone_dig is not null
               and nullif(regexp_replace(coalesce(gr.phone, ''), '[^0-9]', '', 'g'), '') = v_phone_dig
               and (nullif(lower(btrim(coalesce(gr.email, ''))), '') is null
                    or nullif(lower(btrim(coalesce(gr.email, ''))), '') = v_email))
        )
    ),
    ranked as (
      select gr.id,
             row_number() over (partition by gr.event_id order by gr.created_at, gr.id) as volgnr
      from public.guest_requests gr
      where gr.event_id in (select m.event_id from mine m)
    ),
    upd as (
      update public.guest_requests gr
      set full_name = 'Aanvraag #' || rk.volgnr,
          email = null,
          phone = null,
          motivation = null,
          decision_reason = null,
          decision_message = null,
          status_token_hash = null,
          dedupe_key = null,
          birthdate = null,
          anonymized_at = now()
      from ranked rk
      where gr.id = rk.id
        and gr.id in (select m.id from mine m)
      returning gr.id
    )
    select coalesce(array_agg(id), '{}') into v_request_ids from upd;
  else
    v_request_ids := '{}';
  end if;
  v_requests := coalesce(array_length(v_request_ids, 1), 0);

  if v_requests > 0 then
    -- Their status-token mirrors (a deduped caller's name) go too, as in
    -- retention step 2b.
    delete from public.guest_request_status_mirrors m
    where m.request_id = any(v_request_ids);

    -- Their own approve/deny diffs lose the free-text decision fields, as in
    -- retention step 4b — scoped to exactly these requests.
    perform public.redact_anonymized_request_audit_pii(v_request_ids);

    -- One clean 'anonymize' entry per request — retention step 5's shape, but
    -- attributed to the admin who erased them (the nightly job writes null).
    insert into public.audit_log
      (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
    select
      (select auth.uid()), e.venue_id, gr.event_id, 'guest_requests', gr.id, 'anonymize',
      jsonb_build_object(
        'before', null,
        'after', jsonb_build_object(
          'anonymized_at', to_jsonb(gr.anonymized_at),
          'redacted_fields', '["full_name","email","phone","motivation","decision_reason","decision_message","status_token_hash","dedupe_key","birthdate"]'::jsonb)),
      null
    from public.guest_requests gr
    join public.events e on e.id = gr.event_id
    where gr.id = any(v_request_ids);
  end if;

  return jsonb_build_object(
    'guests_anonymized', v_guests,
    'refusals_redacted', v_refusals,
    'requests_anonymized', v_requests,
    'contact_anonymized', v_contact);
end;
$$;

comment on function public.forget_contact(uuid) is
  'AVG #29 on-request erasure: immediately anonymizes one address-book contact + all its linked guests (and their refusals) + the landing requests in the same venue that carry its e-mail (or its phone with no other e-mail), ignoring the retention window. Admin-of-venue only (self-guarded; role-only, no AAL2 step-up). Audit diffs are scrubbed structure-preserving and the action is logged. Reuses run_privacy_retention machinery scoped to one person.';

-- Least privilege, unchanged: an authenticated admin calls it (self-guarded
-- inside); never anon, and not service_role.
revoke execute on function public.forget_contact(uuid) from public, anon, service_role;
grant execute on function public.forget_contact(uuid) to authenticated;
