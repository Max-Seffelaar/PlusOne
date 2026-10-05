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

select plan(15);

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

-- ---------------------------------------------------------------------------
-- E. (c) z8uq9m2hm3 — forget_contact takes the person's landing requests along,
--    in every event of the contact's venue, and NEVER another venue's
-- ---------------------------------------------------------------------------
-- Admin 1111 is admin at BOTH seed venues, so the venue boundary below is the
-- function's own scoping (derived from the contact), not the caller's rights.

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

insert into public.contacts (id, venue_id, full_name, email, phone, source)
values ('c0000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001',
        'Wis Mij', 'wis.mij@real.test', '+31 6 1111 2222', 'manual');

insert into public.events (id, venue_id, name, starts_at, ends_at) values
  ('ee000000-0000-7000-8000-0000000000e1', 'aa000000-0000-7000-8000-000000000001',
   'Forget Requests V1', now() + interval '20 days', now() + interval '20 days' + interval '6 hours'),
  ('ee000000-0000-7000-8000-0000000000e2', 'aa000000-0000-7000-8000-000000000002',
   'Forget Requests V2', now() + interval '20 days', now() + interval '20 days' + interval '6 hours');

insert into public.guest_requests
  (id, event_id, full_name, email, phone, motivation, dedupe_key, birthdate, status_token_hash) values
  -- e1: venue 1, seed event, e-mail match (case-insensitive)
  ('ba000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-000000000001',
   'Wis Mij', 'Wis.Mij@Real.test', null, 'ken de DJ', 'wis.mij@real.test', '1995-03-03', 'tok-c-e1'),
  -- e2: venue 1, OTHER event, phone-digits match only
  ('ba000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000e1',
   'W. Mij', null, '+31611112222', null, '31611112222', null, 'tok-c-e2'),
  -- e3: venue 2, SAME e-mail — another controller's record
  ('ba000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e2',
   'Wis Mij', 'wis.mij@real.test', '+31611112222', 'andere zaal', 'wis.mij@real.test', '1995-03-03', 'tok-c-e3'),
  -- e4: venue 1, a stranger on the same event as e1
  ('ba000000-0000-7000-8000-0000000000e4', 'ee000000-0000-7000-8000-000000000001',
   'Ander Persoon', 'ander@real.test', null, null, 'ander@real.test', null, 'tok-c-e4');

-- A status-token mirror (a deduped caller's name) hanging off e1.
insert into public.guest_request_status_mirrors (request_id, token_hash, full_name, plus_ones)
values ('ba000000-0000-7000-8000-0000000000e1', 'tok-c-e1-mirror', 'Dubbele Wis Mij', 1);

select pg_temp.login('11111111-1111-4111-8111-111111111111');
create temp table forget_req as
  select public.forget_contact('c0000000-0000-7000-8000-0000000000e1') as r;
reset role;

select is((select (r ->> 'requests_anonymized')::int from forget_req), 2,
  'E1 forget_contact anonymized the person''s two requests in this venue');

select is(
  (select string_agg(
            (full_name like 'Aanvraag #%')::text || ':' || coalesce(email, '-') || ':'
            || coalesce(phone, '-') || ':' || coalesce(motivation, '-') || ':'
            || coalesce(dedupe_key, '-') || ':' || coalesce(birthdate::text, '-') || ':'
            || coalesce(status_token_hash, '-') || ':' || (anonymized_at is not null)::text,
            ',' order by id)
     from public.guest_requests
    where id in ('ba000000-0000-7000-8000-0000000000e1', 'ba000000-0000-7000-8000-0000000000e2')),
  'true:-:-:-:-:-:-:true,true:-:-:-:-:-:-:true',
  'E2 both (e-mail match on one event, phone-digit match on another) carry the full retention scrub');

select is(
  (select full_name || '|' || email || '|' || dedupe_key || '|' || birthdate::text || '|'
          || status_token_hash || '|' || (anonymized_at is null)::text
     from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000e3'),
  'Wis Mij|wis.mij@real.test|wis.mij@real.test|1995-03-03|tok-c-e3|true',
  'E3 the SAME e-mail at ANOTHER venue is untouched — even though the caller is admin there too');

select is(
  (select full_name || '|' || email || '|' || (anonymized_at is null)::text
     from public.guest_requests where id = 'ba000000-0000-7000-8000-0000000000e4'),
  'Ander Persoon|ander@real.test|true',
  'E4 a stranger''s request on the same event is untouched');

select is(
  (select count(*)::int from public.guest_request_status_mirrors
    where request_id = 'ba000000-0000-7000-8000-0000000000e1'),
  0, 'E5 the status-token mirror on the forgotten request is deleted');

select is(
  (select string_agg(entity_id::text || '=' || n::text, ',' order by entity_id)
     from (select entity_id, count(*) as n from public.audit_log
            where entity_type = 'guest_requests' and action = 'anonymize'
              and entity_id in ('ba000000-0000-7000-8000-0000000000e1',
                                'ba000000-0000-7000-8000-0000000000e2',
                                'ba000000-0000-7000-8000-0000000000e3')
            group by entity_id) t),
  'ba000000-0000-7000-8000-0000000000e1=1,ba000000-0000-7000-8000-0000000000e2=1',
  'E6 exactly one anonymize audit row per forgotten request, none for the other venue''s');

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'guest_requests' and action = 'anonymize'
      and entity_id in ('ba000000-0000-7000-8000-0000000000e1', 'ba000000-0000-7000-8000-0000000000e2')
      and actor_id = '11111111-1111-4111-8111-111111111111'),
  2, 'E7 the forget-path anonymize rows name the admin who erased them (the nightly job writes null)');

select * from finish();
rollback;
