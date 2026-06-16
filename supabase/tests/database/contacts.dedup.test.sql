-- pgTAP — Sessie C: address-book import dedupe (upsert_contacts, #10).
-- Seed venue aa..01 contacts: c0..01 Sanne (email sanne@example.test, phone
-- +31687654321), c0..02 Anouk (email anouk@example.test, no phone), c0..03 Pim
-- (phone +31622222222, no email). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(12);

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin

-- A. An existing e-mail is matched (case-insensitive), not inserted.
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Sanne M","email":"SANNE@example.test"}]'::jsonb) ->> 'inserted')::int,
  0, 'A1 existing e-mail (any case) is matched, not inserted');

-- B. Phone is normalised to digits and matches the existing contact.
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Pim","phone":"+31 6 22-22 22 22"}]'::jsonb) ->> 'inserted')::int,
  0, 'B1 phone normalises ([^0-9]) and matches existing');

-- C. A genuinely new contact is inserted.
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Nieuwe Naam","email":"nieuw@example.test"}]'::jsonb) ->> 'inserted')::int,
  1, 'C1 a new contact is inserted');

-- D. Merge fills a blank (Anouk has an e-mail, no phone).
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Anouk","email":"anouk@example.test","phone":"+31611111111"}]'::jsonb) ->> 'updated')::int,
  1, 'D1 merge fills the blank phone');
select is(
  (select phone_norm from public.contacts where id = 'c0000000-0000-7000-8000-000000000002'),
  '31611111111', 'D2 the filled phone is stored + normalised');

-- E. Merge NEVER overwrites existing data.
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Anouk","email":"anouk@example.test","phone":"+31699999999"}]'::jsonb) ->> 'skipped')::int,
  1, 'E1 a second import with a different phone changes nothing');
select is(
  (select phone_norm from public.contacts where id = 'c0000000-0000-7000-8000-000000000002'),
  '31611111111', 'E2 the existing phone is preserved (never overwritten)');

-- F. Name-only rows have no key → never collide.
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Naam Een"},{"full_name":"Naam Twee"}]'::jsonb) ->> 'inserted')::int,
  2, 'F1 two name-only rows both insert');

-- G. Intra-batch duplicates collapse to one insert.
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Dup A","email":"dup@x.test"},{"full_name":"Dup B","email":"dup@x.test"}]'::jsonb) ->> 'inserted')::int,
  1, 'G1 in-batch duplicate e-mail → a single insert');
select is(
  (select count(*)::int from public.contacts
   where venue_id = 'aa000000-0000-7000-8000-000000000001' and email_norm = 'dup@x.test'),
  1, 'G2 exactly one contact exists for the duplicated e-mail');

-- H. Self-guard: a staff member may not import.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
       '[{"full_name":"Stiekem"}]'::jsonb) $$,
  '42501', null, 'H1 staff cannot bulk-import contacts');

-- I. An anonymized contact frees its e-mail slot for a fresh insert.
reset role;  -- superuser: only the owner/job may set anonymized_at
update public.contacts set anonymized_at = now()
  where id = 'c0000000-0000-7000-8000-000000000001';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (public.upsert_contacts('aa000000-0000-7000-8000-000000000001',
    '[{"full_name":"Sanne Opnieuw","email":"sanne@example.test"}]'::jsonb) ->> 'inserted')::int,
  1, 'I1 an anonymized contact no longer blocks its e-mail');

reset role;

select * from finish();
rollback;
