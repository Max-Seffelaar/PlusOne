-- pgTAP — S2.1: auto-contact on guest add (guests_autolink_contact, BEFORE INSERT).
-- A guest added to an event gastenlijst with an e-mail or phone is deduped into
-- the venue address book and back-linked via guests.contact_id; name-only guests
-- get no contact; anonymized rows are left alone; dedup + creation are venue-scoped;
-- and the SECURITY DEFINER trigger grows the book even for a staff add that may not
-- insert contacts directly. Seed: venue aa..01 (Club Vesper), event ee..01, tier
-- dd..01, admin 1111, staff 5555. Everything rolls back.

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

select plan(11);

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin (quota-exempt)

-- ── A. Guest with an e-mail → exactly one contact, linked back ────────────────
insert into public.guests (id, event_id, tier_id, full_name, email, added_by, source, status)
values ('fa000000-0000-7000-8000-000000000001',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'Auto Mail', 'Auto.Mail@Test.Example', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select is(
  (select count(*)::int from public.contacts
     where venue_id = 'aa000000-0000-7000-8000-000000000001' and email_norm = 'auto.mail@test.example'),
  1, 'A1 a guest e-mail creates exactly one contact (normalised key)');

select is(
  (select c.email_norm from public.guests g join public.contacts c on c.id = g.contact_id
     where g.id = 'fa000000-0000-7000-8000-000000000001'),
  'auto.mail@test.example', 'A2 the guest is back-linked to that contact');

-- ── B. Re-add the SAME e-mail on the SAME event → no duplicate contact ────────
-- Dedup finds the existing contact; the (event, contact) unique index means this
-- second live guest is left unlinked rather than failing the insert.
insert into public.guests (id, event_id, tier_id, full_name, email, added_by, source, status)
values ('fa000000-0000-7000-8000-000000000002',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'Auto Mail Again', 'auto.mail@test.example', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select is(
  (select count(*)::int from public.contacts
     where venue_id = 'aa000000-0000-7000-8000-000000000001' and email_norm = 'auto.mail@test.example'),
  1, 'B1 re-adding the same e-mail does NOT create a second contact (idempotent)');

select ok(
  (select contact_id is null from public.guests where id = 'fa000000-0000-7000-8000-000000000002'),
  'B2 a same-event duplicate is left unlinked (the (event, contact) guard holds)');

-- ── C. Phone-only guest → contact deduped on the digit-stripped phone ─────────
insert into public.guests (id, event_id, tier_id, full_name, phone, added_by, source, status)
values ('fa000000-0000-7000-8000-000000000003',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'Auto Phone', '+31 6 11 22 33 44', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select is(
  (select count(*)::int from public.contacts
     where venue_id = 'aa000000-0000-7000-8000-000000000001' and phone_norm = '31611223344'),
  1, 'C1 a phone-only guest creates one contact on the normalised phone');

select is(
  (select c.phone_norm from public.guests g join public.contacts c on c.id = g.contact_id
     where g.id = 'fa000000-0000-7000-8000-000000000003'),
  '31611223344', 'C2 the phone-only guest is back-linked');

-- ── D. Name-only guest → NO contact (no dedup key → no pile-up) ───────────────
insert into public.guests (id, event_id, tier_id, full_name, added_by, source, status)
values ('fa000000-0000-7000-8000-000000000004',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'Naam Zonder Sleutel', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select ok(
  (select contact_id is null from public.guests where id = 'fa000000-0000-7000-8000-000000000004'),
  'D1 a name-only guest gets no contact (contact_id stays null)');

-- ── E. Anonymized guest → left alone (AVG, #29) ──────────────────────────────
-- Insert as superuser so anonymized_at may be set on creation.
reset role;
insert into public.guests (id, event_id, tier_id, full_name, email, added_by, source, status, anonymized_at)
values ('fa000000-0000-7000-8000-000000000005',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'Gast #X', 'auto.anon@test.example', '11111111-1111-4111-8111-111111111111', 'app', 'approved', now());

select ok(
  (select contact_id is null from public.guests where id = 'fa000000-0000-7000-8000-000000000005')
  and not exists (select 1 from public.contacts
                  where venue_id = 'aa000000-0000-7000-8000-000000000001' and email_norm = 'auto.anon@test.example'),
  'E1 an anonymized guest creates/links no contact');

-- ── F. Cross-venue isolation: the contact lives in the guest''s venue only ────
select is(
  (select count(*)::int from public.contacts
     where venue_id = 'aa000000-0000-7000-8000-000000000002' and email_norm = 'auto.mail@test.example'),
  0, 'F1 no contact leaks into another venue (dedup + creation are venue-scoped)');

-- ── G. SECURITY DEFINER: a staff add grows the book even though staff may not
--       insert contacts directly. Bump staff''s event quota so the add isn''t
--       quota-blocked, prove the direct insert is denied, then prove the add works.
insert into public.event_quotas (event_id, user_id, quota_override)
values ('ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 50)
on conflict (event_id, user_id) do update set quota_override = excluded.quota_override;

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff

select throws_ok(
  $$ insert into public.contacts (venue_id, full_name, email)
       values ('aa000000-0000-7000-8000-000000000001', 'Stiekem', 'sneaky@test.example') $$,
  '42501', null, 'G1 staff cannot insert a contact directly (RLS)');

insert into public.guests (id, event_id, tier_id, full_name, email, added_by, source, status)
values ('fa000000-0000-7000-8000-000000000006',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'Staff Toegevoegd', 'auto.staff@test.example', '55555555-5555-4555-8555-555555555555', 'app', 'approved');

-- Read the result as superuser: staff has no RLS read on contacts (G1), so the
-- count must NOT run as staff or it would see 0 even though the trigger (DEFINER)
-- created the contact.
reset role;
select is(
  (select count(*)::int from public.contacts
     where venue_id = 'aa000000-0000-7000-8000-000000000001' and email_norm = 'auto.staff@test.example'),
  1, 'G2 a staff guest-add still creates the contact (trigger DEFINER bypass)');

select * from finish();
rollback;
