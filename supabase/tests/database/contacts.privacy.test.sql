-- pgTAP — Sessie C: address-book retention/anonymisering (#8/#10/#11, AVG #16/#29).
-- A contact is anonymized once it is inactive past the venue window AND no longer
-- linked to a guest on a still-retained event. Reuse is the point of the address
-- book, so an in-use contact lingers. Runs entirely as the owner (the job role);
-- everything rolls back.
--
-- Aged fixtures are INSERTED with an old updated_at — set_updated_at fires on
-- UPDATE only, so an inserted timestamp sticks (the trustworthy way to test this).

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Aged + unlinked → eligible. Its INSERT trips audit_contacts, leaving a PII diff.
insert into public.contacts (id, venue_id, full_name, email, source, created_at, updated_at)
values ('c0000000-0000-7000-8000-0000000000a1', 'aa000000-0000-7000-8000-000000000001',
        'Oud Contact', 'oud@example.test', 'manual',
        now() - interval '14 months', now() - interval '13 months');

-- Aged but linked to the (still-retained) seed event → must be KEPT.
insert into public.contacts (id, venue_id, full_name, email, source, created_at, updated_at)
values ('c0000000-0000-7000-8000-0000000000a2', 'aa000000-0000-7000-8000-000000000001',
        'Oud Maar Actief', 'oud2@example.test', 'manual',
        now() - interval '14 months', now() - interval '13 months');
insert into public.guests (event_id, tier_id, full_name, added_by, source, contact_id)
values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'Gekoppelde Gast', '11111111-1111-4111-8111-111111111111', 'app',
        'c0000000-0000-7000-8000-0000000000a2');

select public.run_privacy_retention();

select isnt(
  (select anonymized_at from public.contacts where id = 'c0000000-0000-7000-8000-0000000000a1'),
  null, 'A1 the aged, unlinked contact is anonymized');
select ok(
  (select full_name from public.contacts where id = 'c0000000-0000-7000-8000-0000000000a1')
    like 'Contact #%',
  'A2 its name becomes a stable handle');
select is(
  (select email from public.contacts where id = 'c0000000-0000-7000-8000-0000000000a1'),
  null, 'A3 its PII is nulled');

select is(
  (select anonymized_at from public.contacts where id = 'c0000000-0000-7000-8000-0000000000a2'),
  null, 'B1 a contact still linked to a retained event is KEPT');

select is(
  (select anonymized_at from public.contacts where id = 'c0000000-0000-7000-8000-000000000001'),
  null, 'B2 a recently-active contact is KEPT');

-- Audit redaction: PII scrubbed from existing diffs, structure preserved.
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'contacts' and entity_id = 'c0000000-0000-7000-8000-0000000000a1'
     and diff::text like '%oud@example.test%'),
  0, 'C1 PII is redacted from the audit diffs');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'contacts' and entity_id = 'c0000000-0000-7000-8000-0000000000a1'
     and action = 'anonymize'),
  1, 'C2 one clean anonymize entry is appended');

-- Idempotent: a second run does not re-process or double-log.
select public.run_privacy_retention();
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'contacts' and entity_id = 'c0000000-0000-7000-8000-0000000000a1'
     and action = 'anonymize'),
  1, 'D1 re-running the job is a no-op for already-anonymized contacts');

select * from finish();
rollback;
