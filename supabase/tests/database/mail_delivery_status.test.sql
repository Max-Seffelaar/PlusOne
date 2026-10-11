-- pgTAP: guest mail delivery status, resend, the bounce rule, the platform
-- mail log and test mails (ClickUp z8uq9m49k1; migration
-- 20261015130000_mail_delivery_status).
--
--   A. Grants: who may call what.
--   B. The confirmation state per guest and the resend rule (not sent,
--      queued, delivered, bounced, address changed, opted out, failed).
--   C. event_guest_mail_status: members of the company yes, outsiders 42501.
--   D. can_edit_guest: RLS decides, and the probe writes nothing.
--   E. Platform mail log: platform admins only, addresses masked, a reveal
--      needs a ticket and writes platform_access_log.
--   F. Test mails: platform admins only, their own limit, outside every
--      budget and the invite recipient window.
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

-- The confirmation state of one guest, read as owner.
create function pg_temp.st(p_guest uuid)
returns text language sql security definer as $fn$
  select s.state || '|' || s.can_resend || '|' || s.needs_new_address
    from public.guest_confirmation_state(p_guest) s;
$fn$;
grant execute on function pg_temp.st(uuid) to anon, authenticated, service_role;

select plan(61);

-- Seed: Club Vesper (aa…01), event ee…01: Max 1111 admin, Noor 2222
-- user_manager, Tom 5555 staff, Lisa 6666 doorhost+staff.
-- Fixtures: three guests with an address, added by Max.
insert into public.guests (id, event_id, tier_id, full_name, email, plus_ones, added_by, source)
values
  ('f9000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Lotte Jansen', 'lotte@example.test', 1,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f9000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Daan de Vries', 'daan@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f9000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Robin Bakker', 'robin@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f9000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Sam Visser', 'sam@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f9000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Cas Mulder', 'cas@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f9000000-0000-7000-8000-000000000006', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Ilse de Boer', 'ilse@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app'),
  -- Added by staff@ Tom: his own guest (D).
  ('f9000000-0000-7000-8000-000000000007', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Tom''s Friend', 'friend@example.test', 0,
   '55555555-5555-4555-8555-555555555555', 'app');

-- An outsider with no tie to Club Vesper.
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

create temp table ids (k text primary key, id uuid);
grant all on ids to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A. Grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.event_guest_mail_status(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.can_edit_guest(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.platform_mail_log(integer, integer, uuid, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.platform_reveal_mail_recipient(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.log_platform_test_mail(text, text)', 'EXECUTE'),
  'A1 the read, probe, log, reveal and test-mail RPCs are open to authenticated (each checks inside)');
select ok(
  not has_function_privilege('anon', 'public.event_guest_mail_status(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.platform_mail_log(integer, integer, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.platform_reveal_mail_recipient(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.can_edit_guest(uuid)', 'EXECUTE'),
  'A2 anon holds none of them');
select ok(
  has_function_privilege('service_role', 'public.resend_guest_confirmation(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.resend_guest_confirmation(uuid, uuid)', 'EXECUTE'),
  'A3 resend is service_role only (the action proves edit rights first)');
select ok(
  not has_function_privilege('authenticated', 'public.guest_confirmation_state(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mail_log_recipient(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.mail_log_recipient(uuid)', 'EXECUTE'),
  'A4 the helpers (state, recipient lookup) are owner-only');

-- ---------------------------------------------------------------------------
-- B. Confirmation state and resend
-- ---------------------------------------------------------------------------

select is(pg_temp.st('f9000000-0000-7000-8000-000000000001'), 'not_sent|true|false',
  'B1 an address and no confirmation yet: not sent, resend allowed');

select pg_temp.login_service();
insert into ids select 'q1', public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111');
select ok((select id from ids where k = 'q1') is not null, 'B2 resend queues a confirmation');
select is(pg_temp.st('f9000000-0000-7000-8000-000000000001'), 'queued|false|false', 'B3 now queued');
select is(
  public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  (select id from ids where k = 'q1'), 'B4 a second click while queued returns the same row (idempotent)');

-- The job sent it and Resend reported delivery.
select pg_temp.as_owner();
insert into public.mail_log (type, venue_id, recipient_hash, status)
values ('guest_on_list', 'aa000000-0000-7000-8000-000000000001',
        public.guest_mail_email_hash('lotte@example.test'), 'delivered')
returning id as l1 \gset
update public.guest_mail_queue set status = 'sent', mail_log_id = :'l1'
 where id = (select id from ids where k = 'q1');
select is(pg_temp.st('f9000000-0000-7000-8000-000000000001'), 'delivered|false|false',
  'B5 delivered: shown as delivered, no resend');
select pg_temp.login_service();
select throws_ok(
  $$ select public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111') $$,
  '22023', null, 'B6 a delivered confirmation is not resent');

-- It bounced.
select pg_temp.as_owner();
update public.mail_log set status = 'bounced' where id = :'l1';
select is(pg_temp.st('f9000000-0000-7000-8000-000000000001'), 'bounced|false|true',
  'B7 bounced to the address the guest still has: needs a new address, no resend');
select pg_temp.login_service();
select throws_ok(
  $$ select public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111') $$,
  'PMB01', null, 'B8 the database refuses a resend to the bounced address (decision 3)');

-- The address is corrected (same address, other case: still the same one).
select pg_temp.as_owner();
update public.guests set email = 'LOTTE@example.test ' where id = 'f9000000-0000-7000-8000-000000000001';
select is(pg_temp.st('f9000000-0000-7000-8000-000000000001'), 'bounced|false|true',
  'B9 only a case or spacing change is not a new address');
update public.guests set email = 'lotte.jansen@example.test' where id = 'f9000000-0000-7000-8000-000000000001';
select is(pg_temp.st('f9000000-0000-7000-8000-000000000001'), 'bounced|true|false',
  'B10 a changed address: resend allowed');
select pg_temp.login_service();
select ok(
  public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111')
    is distinct from (select id from ids where k = 'q1'),
  'B11 resend after the change queues a new confirmation');

-- Complained counts as bounced.
select pg_temp.as_owner();
with m as (
  insert into public.mail_log (type, venue_id, recipient_hash, status)
  values ('guest_on_list', 'aa000000-0000-7000-8000-000000000001',
          public.guest_mail_email_hash('daan@example.test'), 'complained')
  returning id
)
insert into public.guest_mail_queue (venue_id, event_id, guest_id, type, status, mail_log_id)
select 'aa000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
       'f9000000-0000-7000-8000-000000000002', 'guest_on_list', 'sent', m.id
  from m;
select is(pg_temp.st('f9000000-0000-7000-8000-000000000002'), 'complained|false|true',
  'B12 marked as spam: no resend to that address either');

-- A failed send may be resent.
insert into public.guest_mail_queue (venue_id, event_id, guest_id, type, status, reason)
values ('aa000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        'f9000000-0000-7000-8000-000000000003', 'guest_on_list', 'failed', 'rate_limited');
select is(pg_temp.st('f9000000-0000-7000-8000-000000000003'), 'failed|true|false', 'B13 failed: resend allowed');

-- Opted out of this company's mail: never resent.
insert into public.guest_mail_optouts (venue_id, email_hash)
values ('aa000000-0000-7000-8000-000000000001', public.guest_mail_email_hash('robin@example.test'));
select is(pg_temp.st('f9000000-0000-7000-8000-000000000003'), 'opted_out|false|false', 'B14 opted out: no resend');
select pg_temp.login_service();
select throws_ok(
  $$ select public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000003', '11111111-1111-4111-8111-111111111111') $$,
  '22023', null, 'B15 the database refuses a resend to someone who opted out');

-- B16-B17 (review #463): bounce at sam@, change to a bad address whose
-- resend fails, change back (other case): the bounce at sam@ still holds.
select pg_temp.as_owner();
with m as (
  insert into public.mail_log (type, venue_id, recipient_hash, status)
  values ('guest_on_list', 'aa000000-0000-7000-8000-000000000001',
          public.guest_mail_email_hash('sam@example.test'), 'bounced') returning id
)
insert into public.guest_mail_queue (venue_id, event_id, guest_id, type, status, mail_log_id, created_at)
select 'aa000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
       'f9000000-0000-7000-8000-000000000004', 'guest_on_list', 'sent', m.id, now() - interval '2 hours'
  from m;
update public.guests set email = 'nobody@nowhere.invalid' where id = 'f9000000-0000-7000-8000-000000000004';
with m as (
  insert into public.mail_log (type, venue_id, recipient_hash, status)
  values ('guest_on_list', 'aa000000-0000-7000-8000-000000000001',
          public.guest_mail_email_hash('nobody@nowhere.invalid'), 'failed') returning id
)
insert into public.guest_mail_queue (venue_id, event_id, guest_id, type, status, mail_log_id, created_at)
select 'aa000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
       'f9000000-0000-7000-8000-000000000004', 'guest_on_list', 'sent', m.id, now() - interval '1 hour'
  from m;
update public.guests set email = 'SAM@example.test ' where id = 'f9000000-0000-7000-8000-000000000004';
select is(pg_temp.st('f9000000-0000-7000-8000-000000000004'), 'failed|false|true',
  'B16 back at the bounced address after a failed detour: still needs a new address');
select pg_temp.login_service();
select throws_ok(
  $$ select public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000004', '11111111-1111-4111-8111-111111111111') $$,
  'PMB01', null, 'B17 and the database still refuses the resend');

-- B18-B19 (review #463): at most 3 resends per guest per day. Each resend's
-- row is settled as failed, so the next one is allowed until the cap.
select pg_temp.as_owner();
create function pg_temp.resend_and_fail(p_guest uuid)
returns void language plpgsql security definer as $fn$
declare
  v_id uuid := public.resend_guest_confirmation(p_guest, '11111111-1111-4111-8111-111111111111');
begin
  update public.guest_mail_queue set status = 'failed', reason = 'rate_limited' where id = v_id;
end;
$fn$;
grant execute on function pg_temp.resend_and_fail(uuid) to service_role;
select pg_temp.login_service();
select pg_temp.resend_and_fail('f9000000-0000-7000-8000-000000000005') from generate_series(1, 3);
select is(pg_temp.st('f9000000-0000-7000-8000-000000000005'), 'failed|false|false',
  'B18 after three resends today: no resend offered');
select throws_ok(
  $$ select public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000005', '11111111-1111-4111-8111-111111111111') $$,
  'PM429', null, 'B19 the fourth is refused by the database');

-- B20 (review #463): a resend queues the ORIGINAL type: an approval keeps its request.
select pg_temp.as_owner();
insert into public.guest_requests (id, event_id, venue_id, full_name, email, status, decided_by, decided_at)
values ('9e000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-000000000001',
        'aa000000-0000-7000-8000-000000000001', 'Ilse de Boer', 'ilse@example.test', 'approved',
        '11111111-1111-4111-8111-111111111111', now());
insert into public.guest_mail_queue (venue_id, event_id, guest_id, source_request_id, type, status, reason)
values ('aa000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        'f9000000-0000-7000-8000-000000000006', '9e000000-0000-7000-8000-0000000000e1',
        'guest_request_approved', 'failed', 'rate_limited');
select pg_temp.login_service();
insert into ids select 'q20', public.resend_guest_confirmation('f9000000-0000-7000-8000-000000000006', '11111111-1111-4111-8111-111111111111');
select pg_temp.as_owner();
select is(
  (select type || '|' || source_request_id::text from public.guest_mail_queue where id = (select id from ids where k = 'q20')),
  'guest_request_approved|9e000000-0000-7000-8000-0000000000e1',
  'B20 the resend is the approval mail again, for the same request');

-- ---------------------------------------------------------------------------
-- C. The guest list read
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select set_eq(
  $$ select guest_id from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  $$ select g.id from public.guests g
      where g.event_id = 'ee000000-0000-7000-8000-000000000001'
        and g.status in ('approved', 'checked_in') and g.anonymized_at is null
        and nullif(btrim(coalesce(g.email, '')), '') is not null $$,
  'C-admin: the RPC lists exactly the guests RLS shows an admin (review #463)');
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select set_eq(
  $$ select guest_id from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  $$ select g.id from public.guests g
      where g.event_id = 'ee000000-0000-7000-8000-000000000001'
        and g.status in ('approved', 'checked_in') and g.anonymized_at is null
        and nullif(btrim(coalesce(g.email, '')), '') is not null $$,
  'C-finance: the RPC lists exactly the guests RLS shows a finance (review #463)');
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select set_eq(
  $$ select guest_id from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  $$ select g.id from public.guests g
      where g.event_id = 'ee000000-0000-7000-8000-000000000001'
        and g.status in ('approved', 'checked_in') and g.anonymized_at is null
        and nullif(btrim(coalesce(g.email, '')), '') is not null $$,
  'C-organizer: the RPC lists exactly the guests RLS shows an organizer (review #463)');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select set_eq(
  $$ select guest_id from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  $$ select g.id from public.guests g
      where g.event_id = 'ee000000-0000-7000-8000-000000000001'
        and g.status in ('approved', 'checked_in') and g.anonymized_at is null
        and nullif(btrim(coalesce(g.email, '')), '') is not null $$,
  'C-staff: the RPC lists exactly the guests RLS shows a staff (review #463)');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select set_eq(
  $$ select guest_id from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  $$ select g.id from public.guests g
      where g.event_id = 'ee000000-0000-7000-8000-000000000001'
        and g.status in ('approved', 'checked_in') and g.anonymized_at is null
        and nullif(btrim(coalesce(g.email, '')), '') is not null $$,
  'C-doorhost: the RPC lists exactly the guests RLS shows a doorhost (review #463)');
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select set_eq(
  $$ select guest_id from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  $$ select g.id from public.guests g
      where g.event_id = 'ee000000-0000-7000-8000-000000000001'
        and g.status in ('approved', 'checked_in') and g.anonymized_at is null
        and nullif(btrim(coalesce(g.email, '')), '') is not null $$,
  'C-user manager: the RPC lists exactly the guests RLS shows an user manager (review #463)');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select ok(
  not exists (select 1 from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001')
               where guest_id = 'f9000000-0000-7000-8000-000000000003'),
  'C7 staff never see the state of a guest a colleague added');
select pg_temp.login('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  '42501', null, 'C3 an outsider is refused');

-- ---------------------------------------------------------------------------
-- D. can_edit_guest: RLS decides, nothing is written
-- ---------------------------------------------------------------------------

select pg_temp.as_owner();
create temp table before_probe as
  select (select count(*) from public.audit_log) as audits,
         (select updated_at from public.guests where id = 'f9000000-0000-7000-8000-000000000002') as touched;
grant all on before_probe to authenticated;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select ok(public.can_edit_guest('f9000000-0000-7000-8000-000000000002'), 'D1 the admin may edit the guest');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select ok(public.can_edit_guest('f9000000-0000-7000-8000-000000000002'), 'D2 a doorhost may too');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select ok(not public.can_edit_guest('f9000000-0000-7000-8000-000000000002'),
  'D3 staff may not edit a guest someone else added');
select pg_temp.login('77777777-7777-4777-8777-777777777777');
select ok(not public.can_edit_guest('f9000000-0000-7000-8000-000000000002'), 'D4 an outsider may not');
select pg_temp.as_owner();
select ok(
  (select count(*) from public.audit_log) = (select audits from before_probe)
  and (select updated_at from public.guests where id = 'f9000000-0000-7000-8000-000000000002')
      = (select touched from before_probe),
  'D5 the probe wrote nothing: no audit row, updated_at unchanged');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select ok(public.can_edit_guest('f9000000-0000-7000-8000-000000000002'), 'D6 the event organizer may edit the guest');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select ok(public.can_edit_guest('f9000000-0000-7000-8000-000000000007'), 'D7 staff may edit their own guest');

-- The list is locked (#23): staff lose write access; admin, organizer and
-- doorhost keep it.
select pg_temp.as_owner();
update public.events set list_locked = true, locked_by = '11111111-1111-4111-8111-111111111111', locked_at = now()
 where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select ok(not public.can_edit_guest('f9000000-0000-7000-8000-000000000007'), 'D8 locked list: staff may not, even their own guest');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select ok(public.can_edit_guest('f9000000-0000-7000-8000-000000000007'), 'D9 locked list: the admin may');
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select ok(public.can_edit_guest('f9000000-0000-7000-8000-000000000007'), 'D10 locked list: the organizer may');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select ok(public.can_edit_guest('f9000000-0000-7000-8000-000000000007'), 'D11 locked list: the doorhost may');
select pg_temp.as_owner();
update public.events set list_locked = false, locked_by = null, locked_at = null
 where id = 'ee000000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- E. Platform mail log
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.platform_mail_log() $$, '42501', null,
  'E1 a company admin who is no platform admin is refused');
select throws_ok(
  $$ select public.platform_reveal_mail_recipient(gen_random_uuid(), 'ticket 1') $$, '42501', null,
  'E2 and may not reveal an address');

select pg_temp.as_owner();
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true where id = '22222222-2222-4222-8222-222222222222';
-- A delivered confirmation to Daan's current address, for the reveal.
insert into public.mail_log (type, venue_id, recipient_hash, status)
values ('guest_on_list', 'aa000000-0000-7000-8000-000000000001',
        public.guest_mail_email_hash('daan@example.test'), 'delivered')
returning id as l2 \gset
insert into public.guest_mail_queue (venue_id, event_id, guest_id, type, status, mail_log_id)
values ('aa000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        'f9000000-0000-7000-8000-000000000002', 'guest_on_list', 'sent', :'l2');
insert into ids values ('l2', :'l2');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
create temp table plog as select public.platform_mail_log(100, 0, 'aa000000-0000-7000-8000-000000000001', null, null) as j;
select is(
  (select r ->> 'recipient' || '|' || (r ->> 'event_name') || '|' || (r ->> 'venue_name') || '|' || (r ->> 'status')
     from plog, jsonb_array_elements(j -> 'rows') r where (r ->> 'id')::uuid = (select id from ids where k = 'l2')),
  'd***@e***.test|PLUSONE Launch Night|Club Vesper|delivered',
  'E3 a platform admin sees type, company, event and status, the address masked');
select ok(
  (select j::text from plog) !~ 'daan@example\.test',
  'E4 no full address anywhere in the log');
select is(
  (select r ->> 'recipient' from plog, jsonb_array_elements(j -> 'rows') r where (r ->> 'id')::uuid = :'l1'::uuid),
  null, 'E5 a mail whose address changed since shows no address (not the new one)');

select throws_ok(
  format($$ select public.platform_reveal_mail_recipient(%L, '') $$, (select id from ids where k = 'l2')),
  '22023', null, 'E6 a reveal needs a ticket reference');
select is(
  public.platform_reveal_mail_recipient((select id from ids where k = 'l2'), 'ClickUp 86abc123'),
  'daan@example.test', 'E7 with a ticket: the full address');
select pg_temp.as_owner();
select is(
  (select admin_id::text || '|' || venue_id::text || '|' || reason from public.platform_access_log
    where reason like 'mail_recipient %' order by created_at desc limit 1),
  '22222222-2222-4222-8222-222222222222|aa000000-0000-7000-8000-000000000001|mail_recipient '
    || (select id from ids where k = 'l2') || ': ClickUp 86abc123',
  'E8 and the reveal is in platform_access_log, naming the mail and the ticket');

-- ---------------------------------------------------------------------------
-- F. Test mails
-- ---------------------------------------------------------------------------
-- Noor (2222) is the only platform admin here (E); manager@plusone.test is
-- her sign-in address.

select pg_temp.as_owner();
create temp table hashes as
  select e, public.guest_mail_email_hash(e) as h
    from (values ('manager@plusone.test'), ('outsider@example.com'), ('admin@plusone.test')) v(e);
grant all on hashes to authenticated, service_role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.log_platform_test_mail('guest_on_list', (select h from hashes where e = 'manager@plusone.test')) $$, '42501', null,
  'F1 only a platform admin may send a test mail');
select throws_ok($$ select * from public.platform_test_mail_recipients() $$, '42501', null,
  'F2 and only a platform admin may list who a test may go to');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select set_eq(
  $$ select email from public.platform_test_mail_recipients() $$,
  $$ values ('manager@plusone.test') $$,
  'F3 a test mail may go to the current platform admins'' sign-in addresses only');
select throws_ok(
  $$ select public.log_platform_test_mail('guest_on_list', (select h from hashes where e = 'outsider@example.com')) $$,
  '22023', null, 'F4 any other address is refused by the database (review #463)');
select throws_ok(
  $$ select public.log_platform_test_mail('guest_on_list', (select h from hashes where e = 'admin@plusone.test')) $$,
  '22023', null, 'F5 a company admin who is no platform admin is no test recipient either');

select pg_temp.as_owner();
create temp table budget as select public.guest_mail_sent_today(null) as guest_today;
grant all on budget to authenticated, service_role;
select pg_temp.login('22222222-2222-4222-8222-222222222222');
insert into ids select 't1', public.log_platform_test_mail('guest_on_list', (select h from hashes where e = 'manager@plusone.test'));
select pg_temp.as_owner();
select is(
  (select is_test::text || '|' || test_by::text || '|' || coalesce(venue_id::text, 'no company')
     from public.mail_log where id = (select id from ids where k = 't1')),
  'true|22222222-2222-4222-8222-222222222222|no company', 'F6 logged as a test by that admin, no company');
select is(public.guest_mail_sent_today(null), (select guest_today from budget),
  'F7 a test mail never counts toward the guest mail budget');

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select public.log_platform_test_mail('team_join', (select h from hashes where e = 'manager@plusone.test')) from generate_series(1, 8);
select pg_temp.login_service();
select lives_ok(
  $$ select public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001', (select h from hashes where e = 'manager@plusone.test')) $$,
  'F8 a test mail does not start the invite recipient window');
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select lives_ok($$ select public.log_platform_test_mail('billing_trial_day0', (select h from hashes where e = 'manager@plusone.test')) $$,
  'F9 the tenth test mail of the day is allowed');
select throws_ok($$ select public.log_platform_test_mail('guest_reminder', (select h from hashes where e = 'manager@plusone.test')) $$, 'PM429', null,
  'F10 the eleventh is refused (10 per admin per day)');

select * from finish();
rollback;
