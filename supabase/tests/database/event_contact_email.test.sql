-- pgTAP: a contact address per event (Gastcommunicatie F, PR 6c, z8uq9m2vpy;
-- migration 20261013180500_event_contact_email).
--
--   A. Grants: authenticated reads/writes the column, anon nothing.
--   B. The check: same strict syntax as venues.contact_email (no header syntax).
--   C. Who may set it: admin and the event's organizer (RLS on events);
--      staff, doorhost, an outsider change nothing; anon is refused.
--   D. Guest mail reads event address ?? company address: the claim payload
--      (reply-to + footer), the status page and the auto-reply lookup. With
--      neither, a mail waits in the queue.
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
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

create function pg_temp.login_service()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

create function pg_temp.as_owner()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- The event's stored address, read as owner whatever role is active.
create function pg_temp.event_contact()
returns text language sql security definer as $fn$
  select contact_email from public.events where id = 'ee000000-0000-7000-8000-000000000001';
$fn$;
grant execute on function pg_temp.event_contact() to anon, authenticated, service_role;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner)
-- ---------------------------------------------------------------------------
-- Club Vesper (aa…01), seed event ee…01: admin@ 1111 (admin), organizer@ 4444
-- (event organizer, no membership), staff@ 5555 (staff), door@ 6666
-- (doorhost+staff). Outsider 7777 has no tie to the company at all.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '77777777-7777-4777-8777-777777777777',
  'authenticated', 'authenticated', 'outsider@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "Out Sider"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);

insert into public.guests (id, event_id, tier_id, full_name, email, plus_ones, added_by, source)
values ('f2000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Lotte Jansen', 'lotte@example.test', 0,
        '11111111-1111-4111-8111-111111111111', 'app');

update public.venues set contact_email = null where id = 'aa000000-0000-7000-8000-000000000001';
update public.events set contact_email = null where id = 'ee000000-0000-7000-8000-000000000001';

create temp table claims (k text primary key, j jsonb);
grant all on claims to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A. Grants
-- ---------------------------------------------------------------------------

select ok(
  has_column_privilege('authenticated', 'public.events', 'contact_email', 'SELECT')
  and has_column_privilege('authenticated', 'public.events', 'contact_email', 'INSERT')
  and has_column_privilege('authenticated', 'public.events', 'contact_email', 'UPDATE'),
  'A1 authenticated may read, insert and update events.contact_email (RLS picks the rows)');
select ok(
  not has_column_privilege('anon', 'public.events', 'contact_email', 'SELECT')
  and not has_column_privilege('anon', 'public.events', 'contact_email', 'UPDATE'),
  'A2 anon holds nothing on events.contact_email');

-- ---------------------------------------------------------------------------
-- B. The check (as admin)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.events set contact_email = 'a@b.c>, x@y.z' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'B1 header syntax (a list, angle brackets) is refused');
select throws_ok(
  $$ update public.events set contact_email = 'no-at-sign.test' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'B2 an address without @ is refused');
select throws_ok(
  $$ update public.events set contact_email = 'a@localhost' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'B3 a domain without a dot is refused');

-- ---------------------------------------------------------------------------
-- C. Who may set it
-- ---------------------------------------------------------------------------

update public.events set contact_email = 'night@vesper.test' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_contact(), 'night@vesper.test', 'C1 the company admin sets the event address');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
update public.events set contact_email = 'promo@vesper.test' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_contact(), 'promo@vesper.test', 'C2 the event organizer sets it too');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.events set contact_email = 'staff@evil.test' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_contact(), 'promo@vesper.test', 'C3 staff changes nothing (RLS filters the row)');

select pg_temp.login('66666666-6666-4666-8666-666666666666');
update public.events set contact_email = 'door@evil.test' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_contact(), 'promo@vesper.test', 'C4 the doorhost changes nothing');

select pg_temp.login('77777777-7777-4777-8777-777777777777');
update public.events set contact_email = 'out@evil.test' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_contact(), 'promo@vesper.test', 'C5 an outsider changes nothing');

select pg_temp.login_anon();
select throws_ok(
  $$ update public.events set contact_email = 'anon@evil.test' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'C6 anon is refused outright');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select contact_email from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  'promo@vesper.test', 'C7 a member who can read the event reads its address');

-- ---------------------------------------------------------------------------
-- D. Guest mail: event address ?? company address
-- ---------------------------------------------------------------------------

-- D1–D3: neither address -> the mail waits.
select pg_temp.as_owner();
update public.events set contact_email = null where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
select isnt(public.enqueue_guest_mail('f2000000-0000-7000-8000-000000000001', 'guest_on_list'), null,
  'D1 a confirmation is queued');
select is(jsonb_array_length(public.guest_mails_claim(50) -> 'mails'), 0,
  'D2 with no event and no company address nothing is claimed');
select pg_temp.as_owner();
select is(
  (select status from public.guest_mail_queue where guest_id = 'f2000000-0000-7000-8000-000000000001'),
  'pending', 'D3 the mail waits in the queue');

-- D4: company address only (an older event) -> the company address.
update public.venues set contact_email = 'hello@vesper.test' where id = 'aa000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
insert into claims select 'company', public.guest_mails_claim(50);
select is(
  (select j -> 'mails' -> 0 -> 'company' ->> 'contact_email' from claims where k = 'company'),
  'hello@vesper.test', 'D4 an event without its own address falls back to the company address');
select pg_temp.as_owner();
select is(
  (select l.event_id from public.guest_mail_links l where l.kind = 'reply' limit 1),
  'ee000000-0000-7000-8000-000000000001'::uuid, 'D5 the mail''s links point at the event');

-- D6–D7: the event address wins over the company address.
update public.events set contact_email = 'night@vesper.test' where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
select isnt(public.enqueue_guest_mail('f2000000-0000-7000-8000-000000000001', 'guest_plus_ones'), null,
  'D6 a second mail is queued');
insert into claims select 'event', public.guest_mails_claim(50);
select is(
  (select j -> 'mails' -> 0 -> 'company' ->> 'contact_email' from claims where k = 'event'),
  'night@vesper.test', 'D7 the event address wins: reply-to and footer use it');

-- D8: the event address alone (company has none) is enough to send.
select pg_temp.as_owner();
update public.venues set contact_email = null where id = 'aa000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
select isnt(public.enqueue_event_mail('ee000000-0000-7000-8000-000000000001', 'guest_reminder'), null,
  'D8 a reminder is queued');
select is(
  (select m -> 'company' ->> 'contact_email'
     from jsonb_array_elements(public.guest_mails_claim(50) -> 'mails') m limit 1),
  'night@vesper.test', 'D9 an event address with no company address still sends, with the event address');

-- D10: the status page and the auto-reply lookup read the same address. The
-- page sends sha256(token); the hash helper is owner-only, so compute it here.
select pg_temp.as_owner();
create temp table th as select public.guest_mail_token_hash(
  (select j -> 'mails' -> 0 -> 'links' ->> 'status' from claims where k = 'event')) as h;
grant all on th to anon, authenticated, service_role;
select pg_temp.login_anon();
select is(
  public.get_guest_status((select h from th), 'ec1') -> 'company' ->> 'contact_email',
  'night@vesper.test', 'D10 the status page shows the event address');
select pg_temp.login_service();
select is(
  public.resolve_guest_mail_reply((select j -> 'mails' -> 0 -> 'links' ->> 'reply' from claims where k = 'company'))
    ->> 'contact_email',
  'night@vesper.test', 'D11 the auto-reply resolves the CURRENT event address, even for an older mail');

-- D12: back to no event address -> the company fallback again.
select pg_temp.as_owner();
update public.events set contact_email = null where id = 'ee000000-0000-7000-8000-000000000001';
update public.venues set contact_email = 'hello@vesper.test' where id = 'aa000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
select is(
  public.resolve_guest_mail_reply((select j -> 'mails' -> 0 -> 'links' ->> 'reply' from claims where k = 'company'))
    ->> 'contact_email',
  'hello@vesper.test', 'D12 without an event address the auto-reply falls back to the company');

select * from finish();
rollback;
