-- pgTAP — Sessie C: guest-request → adresboek-capture (#8).
-- An anon submission captures the requester into the venue address book
-- (source=guest_request) and stores a birthdate; approval links the guest back
-- to that contact. Seed: event ee..01 (venue aa..01), slug 'plusone-launch-night',
-- landing_active. Everything rolls back.

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

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

select plan(10);

-- 1. Anon submits with an e-mail + birthdate → captured into the address book.
select pg_temp.login_anon();
select is(
  (select public.submit_guest_request(
    'plusone-launch-night', 'Test Aanvrager', 'test-capture@example.test', '',
    0, '', null, false, '1995-05-05'::date) ->> 'status'),
  'ok', 'A1 submission accepted');
reset role;  -- query contacts/requests as superuser (anon may not read them)
select is(
  (select count(*)::int from public.contacts
   where venue_id = 'aa000000-0000-7000-8000-000000000001'
     and email_norm = 'test-capture@example.test' and source = 'guest_request'),
  1, 'A2 the requester is captured as a guest_request contact');
select is(
  (select birthdate from public.guest_requests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and email = 'test-capture@example.test'),
  '1995-05-05'::date, 'A3 the birthdate is stored on the request');

-- 2. A duplicate submission (same e-mail) does NOT create a second contact.
select pg_temp.login_anon();
select is(
  (select public.submit_guest_request(
    'plusone-launch-night', 'Test Aanvrager Twee', 'test-capture@example.test', '',
    0, '', null, false, null) ->> 'status'),
  'ok', 'B1 duplicate submission still reports ok (silent dedup)');
reset role;
select is(
  (select count(*)::int from public.contacts
   where venue_id = 'aa000000-0000-7000-8000-000000000001'
     and email_norm = 'test-capture@example.test'),
  1, 'B2 the address book still holds exactly one contact for that e-mail');

-- 3. A name-only submission (no e-mail/phone) is NOT captured.
select pg_temp.login_anon();
select is(
  (select public.submit_guest_request(
    'plusone-launch-night', 'Naam Only Aanvrager', '', '', 0, '', null, false, null) ->> 'status'),
  'ok', 'C1 name-only submission accepted');
reset role;
select is(
  (select count(*)::int from public.contacts
   where venue_id = 'aa000000-0000-7000-8000-000000000001'
     and full_name = 'Naam Only Aanvrager'),
  0, 'C2 a name-only request is not captured (no dedup key)');

-- 4. Approval links the created guest back to the captured contact.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select isnt(
  (select public.approve_guest_request(
    (select id from public.guest_requests
      where event_id = 'ee000000-0000-7000-8000-000000000001'
        and email = 'test-capture@example.test' and status = 'pending' limit 1),
    'dd000000-0000-7000-8000-000000000001')),
  null, 'D1 approval creates a guest');
select is(
  (select g.contact_id from public.guests g
    where g.event_id = 'ee000000-0000-7000-8000-000000000001'
      and g.source = 'landing' and g.full_name = 'Test Aanvrager' limit 1),
  (select id from public.contacts
    where venue_id = 'aa000000-0000-7000-8000-000000000001'
      and email_norm = 'test-capture@example.test' and anonymized_at is null limit 1),
  'D2 the approved guest links the captured contact');

-- 5. Anon still has zero direct read on contacts.
select pg_temp.login_anon();
select throws_ok(
  $$ select count(*) from public.contacts $$,
  '42501', null, 'E1 anon cannot read the address book');

reset role;

select * from finish();
rollback;
