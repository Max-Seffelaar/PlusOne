-- pgTAP — guest mail (Gastcommunicatie F, z8uq9m2vpy, PR 6a):
-- 20261013180000_guest_mail_types, 20261013180100_company_contact_channels,
-- 20261013180200_guest_mail_optout.
--
-- Threat model (CLAUDE.md #1): the anon/auth key ships to the browser, so every
-- claim has to hold against raw PostgREST calls. Footholds:
--   * anon with a guessed, expired or replayed status / unsubscribe token;
--   * a staff member (or a member of another company) who wants to queue mail
--     to someone, read the queue, opt somebody out, or change the contact
--     address the company's guests reply to;
--   * a signed-in user with no tie to the company at all (outsider@);
--   * the cron route, replaying a token; a webhook delivery replayed by Svix.
--
-- This file proves:
--   A. grants: anon and authenticated hold nothing on the four tables; the
--      enqueue/job/inbound RPCs are service_role only; the two public RPCs are
--      anon + authenticated; the status read is authenticated only;
--   B. enqueue_guest_mail: eligibility from the DB, debounce, ordering rules,
--      the mandatory removal note, the request-id rule;
--   C. enqueue_event_mail: fan-out to guests with a spot and an address,
--      cancel drops what is pending;
--   D. guest_mails_claim: waits without a contact address; writes mail_log +
--      three links; re-checks spot, opt-out and cancel at send time;
--   E. guest_mails_settle: sent / transient retry / final failure, notes
--      dropped, a second settle is a no-op;
--   F. the cron token: single use;
--   G. get_guest_status: allowed for a live token, the neutral answer otherwise;
--   H. unsubscribe_guest_mail: opt-out for a valid token, the same answer and
--      no row for an invalid one, idempotent; the opted-out address is
--      skipped at send time and the guest stays on the list;
--   I. event_guest_mail_status: members yes, outsiders 42501;
--   J. company contact: admin writes, staff cannot, the checks hold;
--   K. limits: log_mail_attempt refuses guest types, the company invitation
--      cap ignores guest rows; a webhook replay mutates nothing;
--   L. the inbound helpers: reply key lookup, one auto-reply per sender.
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

select plan(90);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner)
-- ---------------------------------------------------------------------------
-- Club Vesper (aa…01) has the seed event ee…01 (upcoming). admin@ (1111…) is
-- its admin, staff@ (5555…) staff; organizer@ (4444…) has no membership there.
-- Three guests of our own with an address on the Regular tier (dd…01).

insert into public.guests (id, event_id, tier_id, full_name, email, plus_ones, added_by, source)
values
  ('f1000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Lotte Jansen', 'lotte@example.test', 1,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f1000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Daan de Vries', 'daan@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f1000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Robin Noemail', null, 2,
   '11111111-1111-4111-8111-111111111111', 'app');

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
insert into public.user_profiles (id, full_name, email)
values ('77777777-7777-4777-8777-777777777777', 'Out Sider', 'outsider@plusone.test')
on conflict (id) do nothing;

create temp table ids (k text primary key, id uuid);
grant all on ids to anon, authenticated, service_role;
create temp table toks (k text primary key, v text);
grant all on toks to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A. Grants
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public'
       and table_name in ('guest_mail_queue', 'guest_mail_optouts', 'guest_mail_links', 'guest_mail_tokens')
       and grantee in ('anon', 'authenticated', 'service_role')),
  'A1 no app role holds any privilege on the four guest-mail tables');

select ok(
  not has_function_privilege('authenticated', 'public.enqueue_guest_mail(uuid, text, text, uuid, integer, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enqueue_guest_mail(uuid, text, text, uuid, integer, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.enqueue_guest_mail(uuid, text, text, uuid, integer, uuid)', 'EXECUTE'),
  'A2 enqueue_guest_mail is service_role only');

select ok(
  not has_function_privilege('authenticated', 'public.enqueue_event_mail(uuid, text, text, uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enqueue_request_declined_mail(uuid, text, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.enqueue_event_mail(uuid, text, text, uuid, integer)', 'EXECUTE'),
  'A3 the event and decline enqueues are service_role only');

select ok(
  not has_function_privilege('authenticated', 'public.guest_mails_claim(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.guest_mails_begin(text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guest_mails_settle(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.guest_mails_claim(integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.guest_mails_settle(jsonb)', 'EXECUTE'),
  'A4 claim / begin / settle are service_role only');

select ok(
  not has_function_privilege('anon', 'public.resolve_guest_mail_reply(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_guest_mail_autoreply(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.resolve_guest_mail_reply(text)', 'EXECUTE'),
  'A5 the inbound helpers are service_role only');

select ok(
  has_function_privilege('anon', 'public.get_guest_status(text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.unsubscribe_guest_mail(text, text)', 'EXECUTE'),
  'A6 the status page and opt-out RPCs are callable without a session');

select ok(
  has_function_privilege('authenticated', 'public.event_guest_mail_status(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.event_guest_mail_status(uuid)', 'EXECUTE'),
  'A7 event_guest_mail_status: authenticated, never anon');

select ok(
  not has_function_privilege('service_role', 'public.guest_mails_tick()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.kick_guest_mails()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.guest_mail_new_token()', 'EXECUTE'),
  'A8 tick / kick / helpers are owner-only');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select count(*) from public.guest_mail_queue $$,
  '42501', null, 'A9 staff cannot read the queue');
select throws_ok(
  $$ insert into public.guest_mail_optouts (venue_id, email_hash)
     values ('aa000000-0000-7000-8000-000000000001', repeat('a', 64)) $$,
  '42501', null, 'A10 staff cannot opt anyone out directly');
select throws_ok(
  $$ select public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_on_list') $$,
  '42501', null, 'A11 staff cannot queue a mail through the RPC');
select pg_temp.login_anon();
select throws_ok(
  $$ select * from public.guest_mail_links $$,
  '42501', null, 'A12 anon cannot read the links');

-- ---------------------------------------------------------------------------
-- B. enqueue_guest_mail
-- ---------------------------------------------------------------------------

select pg_temp.login_service();

select is(
  public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000003', 'guest_on_list'),
  null, 'B1 a guest without an address queues nothing');

insert into ids select 'lotte_on', public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_on_list', null, '11111111-1111-4111-8111-111111111111');
select isnt((select id from ids where k = 'lotte_on'), null, 'B2 a guest with an address is queued');

select is(
  public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_on_list', null, null, 30),
  (select id from ids where k = 'lotte_on'),
  'B3 queueing the same mail again moves the pending row (one mail)');
select pg_temp.as_owner();
select ok(
  (select send_after > now() + interval '20 seconds' from public.guest_mail_queue
    where id = (select id from ids where k = 'lotte_on')),
  'B4 the debounce moved send_after');
select pg_temp.login_service();

select is(
  public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_plus_ones'),
  (select id from ids where k = 'lotte_on'),
  'B5 +N while the confirmation is pending: no second mail, the confirmation carries the new count');

select throws_ok(
  $$ select public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_removed') $$,
  '22023', null, 'B6 a removal mail without a note is refused');
select throws_ok(
  $$ select public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_event_changed') $$,
  '22023', null, 'B7 an event-wide type is refused per guest');
select throws_ok(
  $$ select public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_request_approved') $$,
  '22023', null, 'B8 an approval mail must name its request');
select throws_ok(
  $$ select public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_on_list', repeat('x', 501)) $$,
  '22023', null, 'B9 a note over 500 characters is refused');

-- Removed before the confirmation went: the pending mail is canceled and no
-- removal mail goes out (they never heard they were on).
select pg_temp.as_owner();
update public.guests set status = 'removed' where id = 'f1000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
select is(
  public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_removed', 'The list is full.'),
  null, 'B10 removed before the confirmation went: no removal mail');
select pg_temp.as_owner();
select is(
  (select status || ':' || reason from public.guest_mail_queue where id = (select id from ids where k = 'lotte_on')),
  'canceled:removed_before_send', 'B11 the pending confirmation is canceled');
select pg_temp.login_service();
select is(
  public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000001', 'guest_on_list'),
  null, 'B12 a removed guest gets no confirmation');

-- ---------------------------------------------------------------------------
-- D (part 1). Claim waits for a contact address
-- ---------------------------------------------------------------------------

insert into ids select 'daan_on', public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000002', 'guest_on_list');
select is(
  jsonb_array_length(public.guest_mails_claim(50) -> 'mails'), 0,
  'D1 a company without a contact address: nothing is claimed');
select pg_temp.as_owner();
select is(
  (select status from public.guest_mail_queue where id = (select id from ids where k = 'daan_on')),
  'pending', 'D2 the mail waits, it is not dropped');
select pg_temp.login_service();

-- ---------------------------------------------------------------------------
-- J. Company contact (RLS)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.venues set contact_email = 'evil@example.test' where id = 'aa000000-0000-7000-8000-000000000001';
select pg_temp.as_owner();
select is(
  (select contact_email from public.venues where id = 'aa000000-0000-7000-8000-000000000001'),
  null, 'J1 staff cannot set the contact address guests reply to');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ update public.venues set contact_email = 'hi@vesper.test',
       contact_channels = '{"instagram": "@vesper"}'::jsonb
     where id = 'aa000000-0000-7000-8000-000000000001' $$,
  'J2 an admin sets the contact address and a channel');
select throws_ok(
  $$ update public.venues set contact_email = 'not an address'
     where id = 'aa000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'J3 a malformed contact address is refused');
select throws_ok(
  $$ update public.venues set contact_email = 'a@b.c>, x@y.z'
     where id = 'aa000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'J4 header syntax in the contact address is refused');
select throws_ok(
  $$ update public.venues set contact_channels = '{"email": "x@y.z"}'::jsonb
     where id = 'aa000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'J5 an unknown channel key is refused');
select throws_ok(
  $$ update public.venues set contact_channels = '{"phone": 12}'::jsonb
     where id = 'aa000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'J6 a channel value must be a string');
select throws_ok(
  $$ update public.events set house_rules = repeat('x', 501)
     where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'J7 house rules are capped at 500 characters');

-- ---------------------------------------------------------------------------
-- D (part 2). Claim with a contact address
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
create temp table claim1 as select public.guest_mails_claim(50) as j;
grant all on claim1 to service_role;

select is(jsonb_array_length((select j -> 'mails' from claim1)), 1, 'D3 the waiting mail is claimed now');
select is(
  (select j -> 'mails' -> 0 ->> 'to' from claim1), 'daan@example.test',
  'D4 the address comes from the guest row, read at send time');
select is(
  (select j -> 'mails' -> 0 -> 'company' ->> 'contact_email' from claim1), 'hi@vesper.test',
  'D5 the payload carries the company contact (reply-to + footer)');
select is(
  (select j -> 'mails' -> 0 -> 'spot' ->> 'tier_name' from claim1), 'Regular',
  'D6 the payload carries the spot');
select pg_temp.as_owner();
select is(
  (select status from public.guest_mail_queue where id = (select id from ids where k = 'daan_on')),
  'sending', 'D7 the claimed row is sending');
select pg_temp.login_service();

select pg_temp.as_owner();
select is(
  (select count(*)::int from public.guest_mail_links l
     join public.guest_mail_queue q on q.mail_log_id = l.mail_log_id
    where q.id = (select id from ids where k = 'daan_on')),
  3, 'D8 three links minted: status, unsubscribe, reply');
select ok(
  not exists (
    select 1 from public.guest_mail_links l, claim1 c
     where l.token_hash = (c.j -> 'mails' -> 0 -> 'links' ->> 'status')
        or l.token_hash = (c.j -> 'mails' -> 0 -> 'links' ->> 'unsubscribe')),
  'D9 only hashes are stored, never a raw token');
select is(
  (select m.type || ':' || m.status from public.mail_log m
     join public.guest_mail_queue q on q.mail_log_id = m.id
    where q.id = (select id from ids where k = 'daan_on')),
  'guest_on_list:queued', 'D10 one mail_log row, no content');
insert into toks select 'status', j -> 'mails' -> 0 -> 'links' ->> 'status' from claim1;
insert into toks select 'unsub', j -> 'mails' -> 0 -> 'links' ->> 'unsubscribe' from claim1;
insert into toks select 'reply', j -> 'mails' -> 0 -> 'links' ->> 'reply' from claim1;

select pg_temp.login_service();
select is(
  jsonb_array_length(public.guest_mails_claim(50) -> 'mails'), 0,
  'D11 a second run claims nothing (no double mail)');

-- ---------------------------------------------------------------------------
-- E. Settle
-- ---------------------------------------------------------------------------

select is(
  public.guest_mails_settle(jsonb_build_array(jsonb_build_object(
    'queue_id', (select id from ids where k = 'daan_on'), 'ok', true, 'provider_message_id', 're_daan'))),
  1, 'E1 settle moves one row');
select pg_temp.as_owner();
select is(
  (select q.status || ':' || m.status || ':' || coalesce(m.provider_message_id, '') from public.guest_mail_queue q
     join public.mail_log m on m.id = q.mail_log_id
    where q.id = (select id from ids where k = 'daan_on')),
  'sent:sent:re_daan', 'E2 queue and mail_log say sent, with the provider id');
select pg_temp.login_service();
select is(
  public.guest_mails_settle(jsonb_build_array(jsonb_build_object(
    'queue_id', (select id from ids where k = 'daan_on'), 'ok', false, 'error_code', 'timeout'))),
  0, 'E3 a second settle of the same row is a no-op');

-- +N after the confirmation went: its own mail, with the team's note.
insert into ids select 'daan_plus', public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000002', 'guest_plus_ones', 'Bring ID.');
select isnt((select id from ids where k = 'daan_plus'), null, 'E4 +N after the confirmation went: a plus-ones mail');
select is(
  jsonb_array_length(public.guest_mails_claim(50) -> 'mails'), 1, 'E5 the plus-ones mail is claimed');
select is(
  public.guest_mails_settle(jsonb_build_array(jsonb_build_object(
    'queue_id', (select id from ids where k = 'daan_plus'), 'ok', false, 'error_code', 'daily_quota_exceeded'))),
  1, 'E6 a quota failure settles');
select pg_temp.as_owner();
select is(
  (select status || ':' || reason || ':' || coalesce(remark, '-') from public.guest_mail_queue
    where id = (select id from ids where k = 'daan_plus')),
  'pending:daily_quota_exceeded:Bring ID.', 'E7 a transient failure goes back to pending, note kept for the retry');
select pg_temp.login_service();
select pg_temp.as_owner();
update public.guest_mail_queue set send_after = now() - interval '1 second'
 where id = (select id from ids where k = 'daan_plus');
select pg_temp.login_service();
select is(jsonb_array_length(public.guest_mails_claim(50) -> 'mails'), 1, 'E8 the retry is claimed');
select public.guest_mails_settle(jsonb_build_array(jsonb_build_object(
  'queue_id', (select id from ids where k = 'daan_plus'), 'ok', false, 'error_code', 'timeout')));
select pg_temp.as_owner();
select is(
  (select status || ':' || reason || ':' || coalesce(remark, '-') from public.guest_mail_queue
    where id = (select id from ids where k = 'daan_plus')),
  'failed:timeout:-',
  'E9 a timeout is final on an early attempt (the batch may have gone out; a retry would carry a new idempotency key), note dropped');
select pg_temp.login_service();

-- A refusal the provider answered still retries, but only up to three attempts.
insert into ids select 'daan_plus2', public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000002', 'guest_plus_ones', 'Bring ID.');
select pg_temp.as_owner();
update public.guest_mail_queue set send_after = now() - interval '1 second', attempts = 3
 where id = (select id from ids where k = 'daan_plus2');
select pg_temp.login_service();
select is(jsonb_array_length(public.guest_mails_claim(50) -> 'mails'), 1, 'E10 a third-attempt row is claimed');
select public.guest_mails_settle(jsonb_build_array(jsonb_build_object(
  'queue_id', (select id from ids where k = 'daan_plus2'), 'ok', false, 'error_code', 'provider_unavailable')));
select pg_temp.as_owner();
select is(
  (select status || ':' || reason || ':' || coalesce(remark, '-') from public.guest_mail_queue
    where id = (select id from ids where k = 'daan_plus2')),
  'failed:provider_unavailable:-', 'E11 past three attempts even a provider refusal is final, note dropped');
select pg_temp.login_service();

-- ---------------------------------------------------------------------------
-- G. get_guest_status (anon)
-- ---------------------------------------------------------------------------

select pg_temp.as_owner();
-- The page sends sha256(token); guest_mail_token_hash is owner-only, so the
-- hashes are computed here, as the page would.
create temp table th as select public.guest_mail_token_hash((select v from toks where k = 'status')) as status_hash,
  public.guest_mail_token_hash((select v from toks where k = 'unsub')) as unsub_hash;
grant all on th to anon, authenticated, service_role;
select pg_temp.login_anon();
select is(
  public.get_guest_status((select status_hash from th), 'g1') ->> 'state',
  'on_list', 'G1 a live status token shows the spot');
select is(
  public.get_guest_status((select status_hash from th), 'g2') -> 'company' ->> 'contact_email',
  'hi@vesper.test', 'G2 it names the company contact');
select ok(
  not (public.get_guest_status((select status_hash from th), 'g3') ? 'email'),
  'G3 it never carries the guest''s own address');
select is(
  public.get_guest_status(repeat('0', 64), 'g4'), '{"found": false}'::jsonb,
  'G4 an unknown token is the neutral not-found');
select is(
  public.get_guest_status((select unsub_hash from th), 'g5'), '{"found": false}'::jsonb,
  'G5 an unsubscribe token is not a status token');
select pg_temp.as_owner();
update public.guest_mail_links set expires_at = now() - interval '1 minute'
 where token_hash = (select status_hash from th);
select pg_temp.login_anon();
select is(
  public.get_guest_status((select status_hash from th), 'g6'), '{"found": false}'::jsonb,
  'G6 an expired token is the same not-found');

-- ---------------------------------------------------------------------------
-- H. unsubscribe_guest_mail (anon)
-- ---------------------------------------------------------------------------

select is(
  public.unsubscribe_guest_mail(repeat('1', 64), 'u1'), '{"ok": true}'::jsonb,
  'H1 an invalid token answers exactly like a valid one');
select pg_temp.as_owner();
select is((select count(*)::int from public.guest_mail_optouts), 0, 'H2 and records nothing');
select pg_temp.login_anon();
select is(
  public.unsubscribe_guest_mail((select unsub_hash from th), 'u2'), '{"ok": true}'::jsonb,
  'H3 a valid token opts out');
select is(
  public.unsubscribe_guest_mail((select unsub_hash from th), 'u3'), '{"ok": true}'::jsonb,
  'H4 again: idempotent');
select pg_temp.as_owner();
select is(
  (select count(*)::int from public.guest_mail_optouts
    where venue_id = 'aa000000-0000-7000-8000-000000000001'
      and email_hash = encode(extensions.digest('daan@example.test', 'sha256'), 'hex')),
  1, 'H5 one opt-out row: this company, this address hash');

-- S3: hits never spend the 'st' budget (one-click POSTs share Gmail's IPs).
-- Burn the budget with misses, then: a miss is throttled, a hit still lands.
select pg_temp.login_anon();
select count(*) from generate_series(1, 40) g, lateral public.unsubscribe_guest_mail(md5(g::text) || md5(g::text), 'u4') r;
select is(
  public.unsubscribe_guest_mail(repeat('2', 64), 'u4'), '{"ok": false}'::jsonb,
  'H5a past the budget a miss is throttled');
select pg_temp.as_owner();
-- No hard delete (CLAUDE.md): move the row aside, so a fresh insert shows.
update public.guest_mail_optouts set email_hash = repeat('0', 64);
select pg_temp.login_anon();
select is(
  public.unsubscribe_guest_mail((select unsub_hash from th), 'u4'), '{"ok": true}'::jsonb,
  'H5b past the budget a live token still answers ok (hits never throttled)');
select pg_temp.as_owner();
select is(
  (select count(*)::int from public.guest_mail_optouts
    where email_hash = encode(extensions.digest('daan@example.test', 'sha256'), 'hex')),
  1, 'H5c and the opt-out is recorded again');

-- The opted-out guest gets nothing more from this company; still on the list.
select pg_temp.login_service();
select ok(public.enqueue_event_mail('ee000000-0000-7000-8000-000000000001', 'guest_reminder') >= 1,
  'H6 a reminder still queues for the guests with a spot');
select ok(
  not exists (
    select 1 from jsonb_array_elements(public.guest_mails_claim(50) -> 'mails') m
     where m ->> 'to' = 'daan@example.test'),
  'H7 the opted-out address is skipped at send time');
select pg_temp.as_owner();
select is(
  (select reason from public.guest_mail_queue
    where guest_id = 'f1000000-0000-7000-8000-000000000002' and type = 'guest_reminder'),
  'opted_out', 'H8 recorded as skipped: opted_out');
select pg_temp.login_service();
select pg_temp.as_owner();
select is(
  (select status::text from public.guests where id = 'f1000000-0000-7000-8000-000000000002'),
  'approved', 'H9 the guest stays on the list');

-- ---------------------------------------------------------------------------
-- C. enqueue_event_mail: cancel
-- ---------------------------------------------------------------------------

insert into public.guests (id, event_id, tier_id, full_name, email, plus_ones, added_by, source)
values ('f1000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Sam Sent', 'sam@example.test', 0,
        '11111111-1111-4111-8111-111111111111', 'app');
select pg_temp.login_service();
insert into ids select 'sam_on', public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000004', 'guest_on_list');
select is(
  public.enqueue_event_mail('ee000000-0000-7000-8000-000000000001', 'guest_event_canceled'),
  0, 'C1 cancel mail for an event that is not canceled: nothing');
select pg_temp.as_owner();
update public.events set cancelled_at = now() where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
select ok(
  public.enqueue_event_mail('ee000000-0000-7000-8000-000000000001', 'guest_event_canceled', 'Power cut.') >= 2,
  'C2 a canceled event queues the cancel mail for every guest with a spot and an address');
select pg_temp.as_owner();
select is(
  (select status from public.guest_mail_queue where id = (select id from ids where k = 'sam_on')),
  'canceled', 'C3 what was pending for the event is dropped');
select pg_temp.login_service();
select is(
  public.enqueue_guest_mail('f1000000-0000-7000-8000-000000000004', 'guest_on_list'),
  null, 'C4 nothing new queues for a canceled event');
select is(
  public.enqueue_event_mail('ee000000-0000-7000-8000-000000000001', 'guest_event_changed'),
  0, 'C5 no "new details" for a canceled event');

-- ---------------------------------------------------------------------------
-- I. event_guest_mail_status
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select ok(
  (select count(*) from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001')) >= 1,
  'I1 a member of the company sees the per-guest status');
select pg_temp.login('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.event_guest_mail_status('ee000000-0000-7000-8000-000000000001') $$,
  '42501', null, 'I2 an outsider gets 42501');

-- ---------------------------------------------------------------------------
-- F. The cron token
-- ---------------------------------------------------------------------------

select pg_temp.as_owner();
insert into public.guest_mail_tokens (token_hash) values (extensions.digest('tok-1', 'sha256'));
select pg_temp.login_service();
select lives_ok($$ select public.guest_mails_begin('tok-1', 0) $$, 'F1 a fresh token is accepted');
select throws_ok($$ select public.guest_mails_begin('tok-1', 0) $$, '42501', null, 'F2 the same token twice: refused');
select throws_ok($$ select public.guest_mails_begin('never-minted', 0) $$, '42501', null, 'F3 an unknown token: refused');

-- ---------------------------------------------------------------------------
-- K. Limits + webhook replay
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.log_mail_attempt('guest_on_list', 'aa000000-0000-7000-8000-000000000001', repeat('c', 64)) $$,
  '22023', null, 'K1 guest mail never goes through the invitation path');
select is(
  public.mail_venue_cap_reached('aa000000-0000-7000-8000-000000000001'),
  false, 'K2 guest mail does not count toward the company invitation cap');

select is(
  public.apply_resend_webhook_event('msg_in_1', 'email.received', 'in_1'), true,
  'K3 an inbound event is ledgered');
select pg_temp.as_owner();
create temp table snap as select id, status, updated_at from public.mail_log;
select pg_temp.login_service();
select is(
  public.apply_resend_webhook_event('msg_in_1', 'email.received', 'in_1'), false,
  'K4 its replay returns false');
select pg_temp.as_owner();
select ok(
  not exists (
    select 1 from public.mail_log m join snap s on s.id = m.id
     where m.status is distinct from s.status or m.updated_at is distinct from s.updated_at),
  'K5 and mutates nothing');

-- ---------------------------------------------------------------------------
-- L. Inbound helpers
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select is(
  public.resolve_guest_mail_reply((select v from toks where k = 'reply')) ->> 'contact_email',
  'hi@vesper.test', 'L1 a live reply key resolves to the company contact');
select is(
  public.resolve_guest_mail_reply(repeat('a', 40)), '{"found": false}'::jsonb,
  'L2 an unknown key does not');
select is(
  public.consume_guest_mail_autoreply('Someone@Example.test'), true, 'L3 the first auto-reply to a sender is allowed');
select is(
  public.consume_guest_mail_autoreply('someone@example.test '), false, 'L4 a second one within 24 hours is not (same address, any case)');

select * from finish();
rollback;
