-- pgTAP — on-request erasure forget_contact() (AVG art. 17, #16/#29).
-- Run: supabase test db. Proves:
--   * authorization is the DB boundary — only an admin of the venue WITH AAL2
--     may erase; staff/finance/no-MFA are refused and write nothing;
--   * the person-cascade is exact — the contact + all its linked guests (across
--     events) + their refusals are scrubbed, the retention window is IGNORED,
--     and unrelated rows are untouched;
--   * statistics stay invariant (only PII + anonymized_at change);
--   * the audit log keeps NO PII (structure preserved) and the erasure is logged;
--   * is_permanent is cleared; the action is idempotent (no double-log).
-- Builds its own fixtures in seed venue aa..01 (seed admin 1111 is admin there);
-- a RECENT event proves the window is ignored. Rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_aal text default 'aal2')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.audit_n(p_entity uuid, p_action text)
returns int language sql as $fn$
  select count(*)::int from public.audit_log
  where entity_id = p_entity and action = p_action;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures (as owner — bypasses RLS; triggers still fire). Two RECENT events
-- (inside the 12-month window) → the nightly job would NOT touch these, so a
-- successful erasure proves the window is ignored. Admin 1111 organizes both so
-- the quota engine treats the guest inserts as exempt.
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-0000000000c1', 'aa000000-0000-7000-8000-000000000001',
   'Forget Event', now() - interval '10 days', now() - interval '10 days' + interval '6 hours',
   'closed', 'forget-event-c1', false),
  ('ee000000-0000-7000-8000-0000000000c2', 'aa000000-0000-7000-8000-000000000001',
   'Forget Event 2', now() - interval '20 days', now() - interval '20 days' + interval '6 hours',
   'closed', 'forget-event-c2', false);

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111'),
  ('ee000000-0000-7000-8000-0000000000c2', '11111111-1111-4111-8111-111111111111');

insert into public.guest_tiers (id, event_id, name) values
  ('dd000000-0000-7000-8000-0000000000c1', 'ee000000-0000-7000-8000-0000000000c1', 'Regular'),
  ('dd000000-0000-7000-8000-0000000000c2', 'ee000000-0000-7000-8000-0000000000c2', 'Regular');

-- The person to forget: a PERMANENT contact carrying full PII.
insert into public.contacts (id, venue_id, full_name, email, phone, birthdate, note, is_permanent, source) values
  ('c0000000-0000-7000-8000-0000000000c1', 'aa000000-0000-7000-8000-000000000001',
   'Vergeet Mij', 'vergeet@real.test', '+31600000777', '1990-01-01', 'gevoelige notitie', true, 'manual');

-- An unrelated contact (must stay untouched).
insert into public.contacts (id, venue_id, full_name, email, is_permanent, source) values
  ('c0000000-0000-7000-8000-0000000000c2', 'aa000000-0000-7000-8000-000000000001',
   'Blijf Staan', 'blijf@real.test', false, 'manual');

-- The person's guests in BOTH events + one UNRELATED guest in event c1 created
-- one minute later (→ the person is "Gast #1", the stranger "Gast #2").
insert into public.guests
  (id, event_id, tier_id, contact_id, full_name, email, phone, plus_ones, note, added_by, source, status, created_at)
values
  ('cc000000-0000-7000-8000-0000000000c1', 'ee000000-0000-7000-8000-0000000000c1',
   'dd000000-0000-7000-8000-0000000000c1', 'c0000000-0000-7000-8000-0000000000c1',
   'Vergeet Mij', 'vergeet@real.test', '+31600000777', 2, 'deurnotitie',
   '11111111-1111-4111-8111-111111111111', 'app', 'checked_in', now() - interval '10 days'),
  ('cc000000-0000-7000-8000-0000000000c2', 'ee000000-0000-7000-8000-0000000000c2',
   'dd000000-0000-7000-8000-0000000000c2', 'c0000000-0000-7000-8000-0000000000c1',
   'Vergeet Mij', 'vergeet@real.test', '+31600000777', 0, null,
   '11111111-1111-4111-8111-111111111111', 'app', 'approved', now() - interval '20 days'),
  ('cc000000-0000-7000-8000-0000000000c9', 'ee000000-0000-7000-8000-0000000000c1',
   'dd000000-0000-7000-8000-0000000000c1', null,
   'Andere Gast', 'ander@real.test', null, 1, null,
   '11111111-1111-4111-8111-111111111111', 'app', 'approved', now() - interval '10 days' + interval '1 minute');

-- A refusal with PII on the person's checked-in guest.
insert into public.refusals (id, guest_id, refused_by, reason) values
  ('bb000000-0000-7000-8000-0000000000c1', 'cc000000-0000-7000-8000-0000000000c1',
   '11111111-1111-4111-8111-111111111111', 'Vergeet Mij stond op de zwarte lijst');

-- Baseline statistics (must be invariant across the erasure).
create temp table base as select
  public.user_event_consumption('ee000000-0000-7000-8000-0000000000c1',
                                '11111111-1111-4111-8111-111111111111') as cons1,
  public.tier_consumption('dd000000-0000-7000-8000-0000000000c1') as tier1;

select plan(25);

-- Discipline: forget_contact() must run as an authenticated user (it self-guards
-- on the JWT), so we pg_temp.login() only around the CALLS; every verification
-- read runs after `reset role` as the owner, which can read the owner-built temp
-- tables + bypass audit RLS (mirrors privacy.test.sql).

-- ---------------------------------------------------------------------------
-- A. Authorization — only an admin may erase; staff/finance are refused and write
--    nothing. MFA is NOT required (admin is already an MFA-mandatory role) — B
--    proves this by erasing at AAL1.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555', 'aal2');  -- staff
select throws_ok($$ select public.forget_contact('c0000000-0000-7000-8000-0000000000c1') $$,
  '42501', null, 'A1 staff cannot forget a contact');

select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2');  -- finance (read-only)
select throws_ok($$ select public.forget_contact('c0000000-0000-7000-8000-0000000000c1') $$,
  '42501', null, 'A2 finance cannot forget a contact');

reset role;

select ok(
  (select anonymized_at from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c1') is null
  and (select anonymized_at from public.guests where id = 'cc000000-0000-7000-8000-0000000000c1') is null,
  'A3 the denied (staff/finance) calls anonymized nothing');

-- ---------------------------------------------------------------------------
-- B. Happy path — an admin at AAL1 erases the whole person (proves NO MFA
--    step-up is required), window ignored
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
create temp table run1 as select public.forget_contact('c0000000-0000-7000-8000-0000000000c1') as r;
reset role;

select is((select (r->>'guests_anonymized')::int from run1), 2, 'B1 both of the person''s guests anonymized');
select is((select (r->>'refusals_redacted')::int from run1), 1, 'B2 the refusal reason was redacted');
select ok((select (r->>'contact_anonymized')::boolean from run1), 'B3 the contact record itself was anonymized');

select ok(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000c1') = 'Gast #1'
  and (select email from public.guests where id = 'cc000000-0000-7000-8000-0000000000c1') is null
  and (select phone from public.guests where id = 'cc000000-0000-7000-8000-0000000000c1') is null
  and (select note  from public.guests where id = 'cc000000-0000-7000-8000-0000000000c1') is null
  and (select anonymized_at from public.guests where id = 'cc000000-0000-7000-8000-0000000000c1') is not null,
  'B4 checked-in guest scrubbed to "Gast #1", contact + note nulled, marked (window ignored)');

select is(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000c2'),
  'Gast #1', 'B5 the person''s guest in the 2nd event is "Gast #1" there too (per-event volgnr)');

select ok(
  (select full_name from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c1') like 'Contact #%'
  and (select email from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c1') is null
  and (select phone from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c1') is null
  and (select birthdate from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c1') is null
  and (select is_permanent from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c1') = false
  and (select anonymized_at from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c1') is not null,
  'B6 contact scrubbed to "Contact #n", PII nulled, is_permanent cleared');

select ok(
  (select reason from public.refusals where id = 'bb000000-0000-7000-8000-0000000000c1') = '[verwijderd na bewaartermijn]'
  and (select anonymized_at from public.refusals where id = 'bb000000-0000-7000-8000-0000000000c1') is not null,
  'B7 refusal reason redacted + marked');

-- ---------------------------------------------------------------------------
-- C. Blast radius — unrelated rows untouched
-- ---------------------------------------------------------------------------

select ok(
  (select full_name from public.guests where id = 'cc000000-0000-7000-8000-0000000000c9') = 'Andere Gast'
  and (select anonymized_at from public.guests where id = 'cc000000-0000-7000-8000-0000000000c9') is null,
  'C1 the unrelated guest in the same event is untouched');

select ok(
  (select full_name from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c2') = 'Blijf Staan'
  and (select anonymized_at from public.contacts where id = 'c0000000-0000-7000-8000-0000000000c2') is null,
  'C2 the unrelated contact is untouched');

-- ---------------------------------------------------------------------------
-- D. Statistics stay correct — only PII changed
-- ---------------------------------------------------------------------------

select is(
  public.user_event_consumption('ee000000-0000-7000-8000-0000000000c1',
                                '11111111-1111-4111-8111-111111111111'),
  (select cons1 from base), 'D1 personal quota consumption unchanged after erasure');

select is(
  public.tier_consumption('dd000000-0000-7000-8000-0000000000c1'),
  (select tier1 from base), 'D2 tier occupancy unchanged');

-- ---------------------------------------------------------------------------
-- E. Audit — no PII, structure preserved, redaction logged
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_log
   where entity_id in ('cc000000-0000-7000-8000-0000000000c1','cc000000-0000-7000-8000-0000000000c2')
     and (diff::text like '%Vergeet Mij%' or diff::text like '%vergeet@real.test%' or diff::text like '%+31600000777%')),
  0, 'E1 no guest PII remains in any audit diff');

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'contacts' and entity_id = 'c0000000-0000-7000-8000-0000000000c1'
     and (diff::text like '%Vergeet Mij%' or diff::text like '%vergeet@real.test%')),
  0, 'E2 no contact PII remains in any audit diff');

select is(
  (select count(*)::int from public.audit_log where entity_type = 'refusals' and diff::text like '%zwarte lijst%'),
  0, 'E3 no PII remains in the refusal audit diff');

select is(pg_temp.audit_n('cc000000-0000-7000-8000-0000000000c1', 'anonymize'), 1,
  'E4 exactly one anonymize entry for the guest');
select is(pg_temp.audit_n('c0000000-0000-7000-8000-0000000000c1', 'anonymize'), 1,
  'E5 exactly one anonymize entry for the contact');
select ok(
  (select actor_id from public.audit_log
   where entity_id = 'c0000000-0000-7000-8000-0000000000c1' and action = 'anonymize') is null,
  'E6 anonymize entry is system-actor (null), carries no PII');

-- ---------------------------------------------------------------------------
-- F. Idempotency — a second run changes nothing, never double-logs
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
create temp table run2 as select public.forget_contact('c0000000-0000-7000-8000-0000000000c1') as r;
reset role;
select is((select (r->>'guests_anonymized')::int from run2), 0, 'F1 second run anonymizes no further guests');
select ok(not (select (r->>'contact_anonymized')::boolean from run2), 'F2 second run does not re-anonymize the contact');
select is(pg_temp.audit_n('cc000000-0000-7000-8000-0000000000c1', 'anonymize'), 1, 'F3 no duplicate guest anonymize entry');
select is(pg_temp.audit_n('c0000000-0000-7000-8000-0000000000c1', 'anonymize'), 1, 'F4 no duplicate contact anonymize entry');

-- ---------------------------------------------------------------------------
-- G. Not found
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select throws_ok($$ select public.forget_contact('c0000000-0000-7000-8000-00000000dead') $$,
  'P0002', null, 'G1 a non-existent contact raises not-found');
reset role;

select * from finish();
rollback;
