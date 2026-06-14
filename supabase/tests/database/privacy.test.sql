-- pgTAP — Fase 5 (AVG-laag): retentie-anonimisering + audit-redactie
-- (decisions #16/#29, run: supabase test db). Proves:
--   * the job touches EXACTLY the right rows — guests/requests/refusals whose
--     event is past the venue retention window, and nothing newer (or seeded);
--   * statistics stay correct — personal consumption and tier occupancy are
--     invariant across anonymization (only PII + anonymized_at change);
--   * the audit log carries NO PII for anonymized guests, while the diff
--     STRUCTURE is preserved (keys stay, values redacted) and the redaction is
--     itself logged ('anonymize' entries);
--   * append-only still holds and the job is idempotent.
-- Builds its own old/recent fixtures on top of the standard seed; rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- Audit inspection helpers (as in audit.test.sql) — owner bypasses RLS.
create function pg_temp.audit_n(p_entity uuid, p_action text)
returns int language sql as $fn$
  select count(*)::int from public.audit_log
  where entity_id = p_entity and action = p_action;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures: a venue with a 1-month retention, one OLD event (3 months ago,
-- eligible) and one RECENT event (10 days ago, NOT eligible). Guests are added
-- by seeded admin Max, made quota-exempt per event via an organizer scope so
-- the fase-7 quota trigger does not block the inserts.
-- ---------------------------------------------------------------------------

insert into public.venues (id, name, slug, retention_months) values
  ('aa000000-0000-7000-8000-0000000000f0', 'Retentie Testzaal', 'retentie-test', 1);

insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-0000000000f1', 'aa000000-0000-7000-8000-0000000000f0',
   'Oud Event', now() - interval '3 months', now() - interval '3 months' + interval '6 hours',
   'closed', 'oud-event', false),
  ('ee000000-0000-7000-8000-0000000000f2', 'aa000000-0000-7000-8000-0000000000f0',
   'Recent Event', now() - interval '10 days', now() - interval '10 days' + interval '6 hours',
   'closed', 'recent-event', false);

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111'),
  ('ee000000-0000-7000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111');

insert into public.guest_tiers (id, event_id, name) values
  ('dd000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-0000000000f1', 'VIP'),
  ('dd000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-0000000000f1', 'Regular'),
  ('dd000000-0000-7000-8000-0000000000f3', 'ee000000-0000-7000-8000-0000000000f2', 'Regular');

-- OLD-event guests, created_at strictly increasing → deterministic volgnr 1..4.
insert into public.guests
  (id, event_id, tier_id, full_name, email, phone, plus_ones, note, added_by, source, status, created_at)
values
  ('cc000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-0000000000f1',
   'dd000000-0000-7000-8000-0000000000f1', 'Echte Naam Een', 'een@real.test', '+31600000001', 2,
   'Gevoelige notitie over de gast', '11111111-1111-4111-8111-111111111111', 'app', 'approved',
   now() - interval '3 months'),
  ('cc000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-0000000000f1',
   'dd000000-0000-7000-8000-0000000000f2', 'Echte Naam Twee', 'twee@real.test', '+31600000002', 0,
   null, '11111111-1111-4111-8111-111111111111', 'app', 'checked_in',
   now() - interval '3 months' + interval '1 minute'),
  ('cc000000-0000-7000-8000-0000000000f3', 'ee000000-0000-7000-8000-0000000000f1',
   'dd000000-0000-7000-8000-0000000000f2', 'Echte Naam Drie', null, '+31600000003', 1,
   null, '11111111-1111-4111-8111-111111111111', 'app', 'refused',
   now() - interval '3 months' + interval '2 minutes'),
  ('cc000000-0000-7000-8000-0000000000f4', 'ee000000-0000-7000-8000-0000000000f1',
   'dd000000-0000-7000-8000-0000000000f2', 'Echte Naam Vier', 'vier@real.test', null, 2,
   null, '11111111-1111-4111-8111-111111111111', 'app', 'removed',
   now() - interval '3 months' + interval '3 minutes');

-- RECENT-event guest — inside the window, must be left alone.
insert into public.guests
  (id, event_id, tier_id, full_name, email, phone, added_by, source, status)
values
  ('cc000000-0000-7000-8000-0000000000f9', 'ee000000-0000-7000-8000-0000000000f2',
   'dd000000-0000-7000-8000-0000000000f3', 'Recent Persoon', 'recent@real.test', '+31600000099',
   '11111111-1111-4111-8111-111111111111', 'app', 'approved');

-- A refusal with PII in the free-text reason (linked to OLD-event guest #3).
insert into public.refusals (id, guest_id, refused_by, reason) values
  ('bb000000-0000-7000-8000-0000000000f1', 'cc000000-0000-7000-8000-0000000000f3',
   '11111111-1111-4111-8111-111111111111', 'Echte Naam Drie was agressief bij de deur');

-- Landing requests: one OLD (eligible), one RECENT (not).
insert into public.guest_requests (id, event_id, full_name, email, phone, motivation) values
  ('ba000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-0000000000f1',
   'Aanvrager Oud', 'oud@req.test', '+31600000010', 'Vrienden van de DJ'),
  ('ba000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-0000000000f2',
   'Aanvrager Recent', 'recent@req.test', null, 'Wil graag komen');

-- Baseline statistics BEFORE the run (must be invariant afterwards).
create temp table base as
  select
    public.user_event_consumption('ee000000-0000-7000-8000-0000000000f1',
                                  '11111111-1111-4111-8111-111111111111') as cons,
    public.tier_consumption('dd000000-0000-7000-8000-0000000000f1') as vip,
    public.tier_consumption('dd000000-0000-7000-8000-0000000000f2') as reg;

select plan(29);

-- Run the retention job and capture its summary.
create temp table run1 as select * from public.run_privacy_retention();

-- ---------------------------------------------------------------------------
-- A. job summary — exactly the eligible rows
-- ---------------------------------------------------------------------------

select is((select guests_anonymized from run1), 4, 'A1 four OLD-event guests anonymized');
select is((select requests_anonymized from run1), 1, 'A2 one OLD-event landing request anonymized');
select is((select refusals_redacted from run1), 1, 'A3 one refusal reason redacted');
select ok((select audit_rows_redacted from run1) > 0, 'A4 audit diffs were redacted');

-- ---------------------------------------------------------------------------
-- B. guests — exact rows scrubbed, stable per-event volgnr, others untouched
-- ---------------------------------------------------------------------------

select ok(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000f1') = 'Gast #1'
  and (select email from public.guests where id = 'cc000000-0000-7000-8000-0000000000f1') is null
  and (select phone from public.guests where id = 'cc000000-0000-7000-8000-0000000000f1') is null
  and (select note  from public.guests where id = 'cc000000-0000-7000-8000-0000000000f1') is null
  and (select anonymized_at from public.guests where id = 'cc000000-0000-7000-8000-0000000000f1') is not null,
  'B1 guest #1: name -> "Gast #1", contact + note nulled, anonymized_at set');

select is(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000f2'),
  'Gast #2', 'B2 volgnr follows created_at order (guest #2 -> "Gast #2")');

select is(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000f4'),
  'Gast #4', 'B3 a removed guest is anonymized too (soft delete is not exemption)');

select ok(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000f9') = 'Recent Persoon'
  and (select email from public.guests where id = 'cc000000-0000-7000-8000-0000000000f9') = 'recent@real.test'
  and (select anonymized_at from public.guests where id = 'cc000000-0000-7000-8000-0000000000f9') is null,
  'B4 RECENT-event guest is left completely untouched');

select ok(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-000000000001') = 'Juri Braakman'
  and (select anonymized_at from public.guests where id = 'cc000000-0000-7000-8000-000000000001') is null,
  'B5 seeded future-event guest is not over-reached by the job');

-- ---------------------------------------------------------------------------
-- C. guest_requests + refusals
-- ---------------------------------------------------------------------------

select ok(
  (select full_name from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f1') = 'Aanvraag #1'
  and (select email from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f1') is null
  and (select phone from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f1') is null
  and (select motivation from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f1') is null
  and (select anonymized_at from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f1') is not null,
  'C1 OLD landing request anonymized (name placeholder, PII nulled)');

select ok(
  (select full_name from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f2') = 'Aanvrager Recent'
  and (select email from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f2') = 'recent@req.test'
  and (select anonymized_at from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000f2') is null,
  'C2 RECENT landing request untouched');

select ok(
  (select reason from public.refusals where id = 'bb000000-0000-7000-8000-0000000000f1') = '[verwijderd na bewaartermijn]'
  and (select anonymized_at from public.refusals where id = 'bb000000-0000-7000-8000-0000000000f1') is not null,
  'C3 refusal reason redacted + marked, even though it is NOT NULL');

-- ---------------------------------------------------------------------------
-- D. statistics stay correct — anonymization only nulled PII
-- ---------------------------------------------------------------------------

select ok((select cons from base) > 0, 'D1 baseline consumption is non-trivial (test is meaningful)');

select is(
  public.user_event_consumption('ee000000-0000-7000-8000-0000000000f1',
                                '11111111-1111-4111-8111-111111111111'),
  (select cons from base), 'D2 personal quota consumption unchanged after anonymization');

select is(
  public.tier_consumption('dd000000-0000-7000-8000-0000000000f1'),
  (select vip from base), 'D3 VIP tier occupancy unchanged');

select is(
  public.tier_consumption('dd000000-0000-7000-8000-0000000000f2'),
  (select reg from base), 'D4 Regular tier occupancy unchanged');

-- ---------------------------------------------------------------------------
-- E. audit log — no PII, structure preserved, redaction logged
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'guests'
     and entity_id in ('cc000000-0000-7000-8000-0000000000f1','cc000000-0000-7000-8000-0000000000f2',
                       'cc000000-0000-7000-8000-0000000000f3','cc000000-0000-7000-8000-0000000000f4')
     and (diff::text like '%Echte Naam%' or diff::text like '%@real.test%'
          or diff::text like '%+316000000%')),
  0, 'E1 no name/email/phone PII remains in any guest audit diff');

select ok(
  (select diff -> 'after' ? 'email' from public.audit_log
   where entity_type = 'guests' and entity_id = 'cc000000-0000-7000-8000-0000000000f1' and action = 'create')
  and (select diff -> 'after' ->> 'email' from public.audit_log
   where entity_type = 'guests' and entity_id = 'cc000000-0000-7000-8000-0000000000f1' and action = 'create') is null
  and (select diff -> 'after' ->> 'full_name' from public.audit_log
   where entity_type = 'guests' and entity_id = 'cc000000-0000-7000-8000-0000000000f1' and action = 'create') = 'Gast #1',
  'E2 create-diff structure preserved: email key kept (null), full_name redacted to handle');

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'refusals' and diff::text like '%agressief%'),
  0, 'E3 no PII remains in any refusal audit diff');

select is(
  (select diff -> 'after' ->> 'reason' from public.audit_log
   where entity_type = 'refusals' and entity_id = 'bb000000-0000-7000-8000-0000000000f1' and action = 'refuse'),
  '[verwijderd na bewaartermijn]', 'E4 refusal create-diff reason redacted to the marker');

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-0000000000f1', 'anonymize'), 1,
  'E5 redaction is logged: exactly one anonymize entry per guest');

select ok(
  (select actor_id from public.audit_log
   where entity_id = 'cc000000-0000-7000-8000-0000000000f1' and action = 'anonymize') is null
  and (select diff -> 'after' ->> 'anonymized_at' from public.audit_log
   where entity_id = 'cc000000-0000-7000-8000-0000000000f1' and action = 'anonymize') is not null,
  'E6 anonymize entry: system actor (null), records the moment, carries no PII');

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'guest_requests' and entity_id = 'ba000000-0000-7000-8000-0000000000f1'
     and action = 'anonymize'),
  1, 'E7 landing-request anonymization is logged as well');

-- ---------------------------------------------------------------------------
-- F. append-only + least privilege still hold
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
  and not has_table_privilege('service_role', 'public.audit_log', 'DELETE'),
  'F1 service_role still cannot rewrite or erase the audit log');

select ok(
  not has_function_privilege('authenticated', 'public.run_privacy_retention()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.run_privacy_retention()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.redact_anonymized_audit_pii(uuid[])', 'EXECUTE'),
  'F2 privacy job + redaction routine are owner-only (no app-role EXECUTE)');

-- ---------------------------------------------------------------------------
-- G. idempotency — a second run changes nothing, never double-logs
-- ---------------------------------------------------------------------------

create temp table run2 as select * from public.run_privacy_retention();

select is((select guests_anonymized from run2), 0, 'G1 second run anonymizes no further guests');
select is((select requests_anonymized from run2), 0, 'G2 second run anonymizes no further requests');
select is(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000f1'),
  'Gast #1', 'G3 handle is stable across runs');
select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-0000000000f1', 'anonymize'), 1,
  'G4 no duplicate anonymize entry on re-run');

select * from finish();

rollback;
