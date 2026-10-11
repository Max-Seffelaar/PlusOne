-- pgTAP: team mail + notification preferences (Gastcommunicatie F, PR 6b,
-- z8uq9m2vpy; migration 20261013180600_notification_prefs).
--
--   A. Grants: the four tables closed (preferences included), the RPCs to
--      exactly their caller.
--   B. Preferences: defaults, own row only, the shape check.
--   C. Fan-out: one outbox row per recipient per channel the recipient wants.
--   D. The email claim: a team_request mail per approver, re-checks at send
--      time (decided, preference off), settle; the push claim never takes
--      email rows.
--   E. Quota: the request to the admins, the decision back to the requester.
--   F. The daily summary: who is due, what it says, nothing on an empty set,
--      once per day.
--   G. Unsubscribe by token (anon): turns that kind off, same answer for any
--      token.
--   H. mail_log: the four types exist, log_mail_attempt refuses them, the
--      invitation cap ignores them.
--   I. Review #458: access re-checked per member at send time (admin role
--      lost, membership removed, a platform admin without a membership), a
--      bundle over two events names none, the daily budget, email: null.
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

-- "channel/recipient" pairs the outbox holds for one request, read as owner.
create function pg_temp.fanout(p_source uuid)
returns text[] language sql security definer as $fn$
  select coalesce(array_agg(o.channel || '/' || o.recipient_user_id order by o.channel, o.recipient_user_id), '{}')
    from public.notification_outbox o where o.source_id = p_source;
$fn$;
grant execute on function pg_temp.fanout(uuid) to anon, authenticated, service_role;

create function pg_temp.prefs(p_user uuid)
returns jsonb language sql security definer as $fn$
  select public.notification_prefs_effective(coalesce(
    (select notification_prefs from public.user_notification_prefs where user_id = p_user), '{}'::jsonb));
$fn$;
grant execute on function pg_temp.prefs(uuid) to anon, authenticated, service_role;

select plan(56);

-- Seed: Club Vesper (aa…01): Max 1111 admin, Noor 2222 user_manager, Femke
-- 3333 finance, Tom 5555 staff, Lisa 6666 doorhost+staff; Yusuf 4444
-- organizes event ee…01. Venue2 (aa…02): Max admin.

-- Start clean: email rows the seed's own requests queued are set aside (no
-- delete, CLAUDE.md), so this file counts only its own.
update public.notification_outbox set status = 'skipped', last_error = 'pgtap_fixture'
 where channel = 'email' and status = 'pending';

create temp table claims (k text primary key, j jsonb);
grant all on claims to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A. Grants
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public'
       and table_name in ('team_mail_tokens', 'team_mail_links', 'team_digest_deliveries')
       and grantee in ('anon', 'authenticated', 'service_role')),
  'A1 no app role holds any privilege on the three team mail tables');
select ok(
  not exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'user_notification_prefs'
       and grantee in ('anon', 'authenticated', 'service_role')),
  'A2 preferences: no app role holds any privilege (other members can''t read them)');
select ok(
  has_function_privilege('service_role', 'public.team_mails_claim(integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.team_mails_settle(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.team_mails_claim(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.team_mails_begin(text, integer)', 'EXECUTE'),
  'A3 the job RPCs are service_role only');
select ok(
  has_function_privilege('authenticated', 'public.set_my_notification_prefs(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_my_notification_prefs(jsonb)', 'EXECUTE')
  and has_function_privilege('anon', 'public.unsubscribe_team_mail(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.team_digest_items(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.kick_team_mails()', 'EXECUTE'),
  'A4 prefs RPCs to authenticated, unsubscribe to anon, helpers to nobody');

-- ---------------------------------------------------------------------------
-- B. Preferences
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  public.my_notification_prefs(),
  '{"requests": {"push": true, "email": "immediate"}, "quota": {"push": true, "email": "immediate"}, "decisions": {"push": true, "email": true}, "digest": true}'::jsonb,
  'B1 defaults: push on, email immediate, decision mail on, daily summary on');
select is(
  public.set_my_notification_prefs('{"requests": {"email": "daily"}, "digest": false}') -> 'requests' ->> 'email',
  'daily', 'B2 a user sets their own preferences (missing keys keep the defaults)');
select is(pg_temp.prefs('55555555-5555-4555-8555-555555555555') ->> 'digest', 'false',
  'B3 stored on their own row');
select is(pg_temp.prefs('11111111-1111-4111-8111-111111111111') ->> 'digest', 'true',
  'B4 nobody else''s row changed (the RPC takes no user)');
select throws_ok($$ select public.set_my_notification_prefs('{"requests": {"email": "hourly"}}') $$,
  '23514', null, 'B5 an unknown email mode is refused');
select ok(not (public.set_my_notification_prefs('{"admin": true}') ? 'admin'),
  'B6 an unknown key is dropped, never stored');
select throws_ok(
  $$ select * from public.user_notification_prefs $$,
  '42501', null, 'B7 the table can''t be read directly, not even your own row');
select pg_temp.login_anon();
select throws_ok($$ select public.my_notification_prefs() $$, '42501', null, 'B8 anon can''t read any');
select throws_ok($$ select public.set_my_notification_prefs('{}') $$, '42501', null,
  'B9 anon can''t set any');

-- ---------------------------------------------------------------------------
-- C. Fan-out per preference
-- ---------------------------------------------------------------------------
-- Max: defaults (push + email). Yusuf: email off for requests (push only).

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select public.set_my_notification_prefs('{"requests": {"email": "off"}}');
select pg_temp.as_owner();
insert into public.guest_requests (id, event_id, full_name, email, plus_ones)
values ('9e000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        'Lotte Jansen', 'lotte@example.test', 1);
select is(
  pg_temp.fanout('9e000000-0000-7000-8000-000000000001'),
  array['email/11111111-1111-4111-8111-111111111111',
        'push/11111111-1111-4111-8111-111111111111',
        'push/44444444-4444-4444-8444-444444444444'],
  'C1 a guest request: the admin gets push + mail, the organizer with mail off only push');

-- Max wants requests only in the daily summary, and no push.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select public.set_my_notification_prefs('{"requests": {"push": false, "email": "daily"}}');
select pg_temp.as_owner();
insert into public.guest_requests (id, event_id, full_name, email)
values ('9e000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
        'Daan de Vries', 'daan@example.test');
select is(
  pg_temp.fanout('9e000000-0000-7000-8000-000000000002'),
  array['push/44444444-4444-4444-8444-444444444444'],
  'C2 push off and email daily: no row for Max at all, the organizer''s push stays');
-- Back to defaults for the rest.
update public.user_notification_prefs set notification_prefs = '{}' where user_id = '11111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- D. The email claim
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
insert into claims select 'd1', public.team_mails_claim(50);
select is(jsonb_array_length((select j -> 'mails' from claims where k = 'd1')), 1,
  'D1 one email row due: one mail');
select is(
  (select m ->> 'type' || '|' || (m ->> 'to') || '|' || (m -> 'link' ->> 'pref') || '|' || (m ->> 'count')
     from claims, jsonb_array_elements(j -> 'mails') m where k = 'd1'),
  'team_request|admin@plusone.test|requests|1',
  'D2 a team_request to the admin, its unsubscribe link for requests, one request');
select is(
  (select m -> 'request' ->> 'first_name' || ' +' || (m -> 'request' ->> 'plus_ones') || ' / ' || (m -> 'event' ->> 'name')
     from claims, jsonb_array_elements(j -> 'mails') m where k = 'd1'),
  'Lotte +1 / PLUSONE Launch Night', 'D3 the mail carries the first name, +N and the event, nothing more of the guest');
select ok(
  (select m -> 'request' ? 'email' or m -> 'request' ? 'full_name' from claims, jsonb_array_elements(j -> 'mails') m where k = 'd1') is false,
  'D4 no guest address or full name in the payload');
select is(jsonb_array_length(public.team_mails_claim(50) -> 'mails'), 0, 'D5 a second claim takes nothing');

select is(
  public.team_mails_settle((select jsonb_agg(jsonb_build_object(
    'mail_log_id', m ->> 'mail_log_id', 'queue_ids', m -> 'queue_ids', 'ok', true, 'provider_message_id', 're_t1'))
    from claims, jsonb_array_elements(j -> 'mails') m where k = 'd1')),
  1, 'D6 settle takes the result');
select pg_temp.as_owner();
select is(
  (select o.status || '/' || m.status || '/' || m.type
     from public.notification_outbox o
     join public.mail_log m on m.id = ((select j -> 'mails' -> 0 ->> 'mail_log_id' from claims where k = 'd1'))::uuid
    where o.source_id = '9e000000-0000-7000-8000-000000000001' and o.channel = 'email'),
  'sent/sent/team_request', 'D7 the outbox row and mail_log say sent');

-- A request decided before its mail goes: skipped, no mail.
insert into public.guest_requests (id, event_id, full_name)
values ('9e000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001', 'Robin');
update public.guest_requests set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
 where id = '9e000000-0000-7000-8000-000000000003';
select pg_temp.login_service();
select is(jsonb_array_length(public.team_mails_claim(50) -> 'mails'), 0, 'D8 a request decided in the meantime: no mail');
select pg_temp.as_owner();
select is(
  (select status || ':' || last_error from public.notification_outbox
    where source_id = '9e000000-0000-7000-8000-000000000003' and channel = 'email'),
  'skipped:already_decided', 'D9 settled skipped, with the reason');

-- The admin turns request mail off after the row was queued: skipped at send time.
insert into public.guest_requests (id, event_id, full_name)
values ('9e000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-000000000001', 'Sam');
update public.user_notification_prefs set notification_prefs = '{"requests": {"email": "off"}}'
 where user_id = '11111111-1111-4111-8111-111111111111';
select pg_temp.login_service();
select is(jsonb_array_length(public.team_mails_claim(50) -> 'mails'), 0, 'D10 preference turned off before sending: no mail');
select pg_temp.as_owner();
select is(
  (select last_error from public.notification_outbox
    where source_id = '9e000000-0000-7000-8000-000000000004' and channel = 'email'),
  'pref_off', 'D11 skipped as pref_off');
update public.user_notification_prefs set notification_prefs = '{}' where user_id = '11111111-1111-4111-8111-111111111111';

-- The push dispatcher never claims an email row.
insert into public.guest_requests (id, event_id, full_name)
values ('9e000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-000000000001', 'Kim');
insert into public.push_dispatch_tokens (token_hash) values (extensions.digest('pgtap-push-token', 'sha256'));
select pg_temp.login_service();
select ok(
  not exists (select 1 from public.claim_push_outbox('pgtap-push-token', 200) c
               join public.notification_outbox o on o.id = c.id
              where o.channel = 'email'),
  'D12 claim_push_outbox returns no email rows');
select pg_temp.as_owner();
select is(
  (select status from public.notification_outbox
    where source_id = '9e000000-0000-7000-8000-000000000005' and channel = 'email'),
  'pending', 'D13 the email row is still pending for the team mail job');

-- ---------------------------------------------------------------------------
-- E. Quota: to the admins, the decision back to the requester
-- ---------------------------------------------------------------------------

select pg_temp.login_service();
select public.team_mails_claim(50); -- clear D13's request mail
select pg_temp.as_owner();
insert into public.quota_requests (id, event_id, user_id, requested_extra, venue_id)
values ('9f000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        '55555555-5555-4555-8555-555555555555', 3, 'aa000000-0000-7000-8000-000000000001');
select is(
  pg_temp.fanout('9f000000-0000-7000-8000-000000000001'),
  array['email/11111111-1111-4111-8111-111111111111', 'push/11111111-1111-4111-8111-111111111111'],
  'E1 a quota request: the admin only (not the requester, not finance or user managers)');
select pg_temp.login_service();
insert into claims select 'e1', public.team_mails_claim(50);
select is(
  (select m ->> 'type' || '|' || (m -> 'quota' ->> 'requester') || '|' || (m -> 'quota' ->> 'extra')
     from claims, jsonb_array_elements(j -> 'mails') m where k = 'e1'),
  'team_quota|Tom Bakker|3', 'E2 team_quota names the team member and the extra slots');

select pg_temp.as_owner();
update public.quota_requests
   set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
 where id = '9f000000-0000-7000-8000-000000000001';
select pg_temp.login_service();
insert into claims select 'e2', public.team_mails_claim(50);
select is(
  (select m ->> 'type' || '|' || (m ->> 'to') || '|' || (m -> 'decision' ->> 'status')
     from claims, jsonb_array_elements(j -> 'mails') m where k = 'e2'),
  'team_decision|staff@plusone.test|approved', 'E3 the decision goes back to the requester');

-- ---------------------------------------------------------------------------
-- I. Access at send time, bundles, budget (review #458)
-- ---------------------------------------------------------------------------

-- I1/I2 (S2): Noor is made admin, a request queues mail for her and Max,
-- then she loses the admin role before the job runs.
select pg_temp.as_owner();
update public.venue_memberships set roles = roles || '{admin}'::public.venue_role[]
 where venue_id = 'aa000000-0000-7000-8000-000000000001' and user_id = '22222222-2222-4222-8222-222222222222';
insert into public.guest_requests (id, event_id, full_name)
values ('9e000000-0000-7000-8000-000000000011', 'ee000000-0000-7000-8000-000000000001', 'Iris');
update public.venue_memberships set roles = array_remove(roles, 'admin'::public.venue_role)
 where venue_id = 'aa000000-0000-7000-8000-000000000001' and user_id = '22222222-2222-4222-8222-222222222222';
select pg_temp.login_service();
insert into claims select 'i1', public.team_mails_claim(50);
select is(
  (select array_agg(m ->> 'to' order by m ->> 'to') from claims, jsonb_array_elements(j -> 'mails') m where k = 'i1'),
  array['admin@plusone.test'], 'I1 only the admin who still is one gets the request mail');
select pg_temp.as_owner();
select is(
  (select status || ':' || last_error from public.notification_outbox
    where source_id = '9e000000-0000-7000-8000-000000000011' and channel = 'email'
      and recipient_user_id = '22222222-2222-4222-8222-222222222222'),
  'skipped:no_access', 'I2 the ex-admin''s row is skipped as no_access');

-- I3/I4 (B1): Tom files two quota requests; one is decided while he is
-- still in the team, then his membership is removed, then the other one.
insert into public.quota_requests (id, event_id, user_id, requested_extra, venue_id)
values ('9f000000-0000-7000-8000-000000000011', 'ee000000-0000-7000-8000-000000000001',
        '55555555-5555-4555-8555-555555555555', 2, 'aa000000-0000-7000-8000-000000000001'),
       ('9f000000-0000-7000-8000-000000000012', 'ee000000-0000-7000-8000-000000000001',
        '55555555-5555-4555-8555-555555555555', 4, 'aa000000-0000-7000-8000-000000000001');
update public.user_notification_prefs set notification_prefs = '{}'
 where user_id = '55555555-5555-4555-8555-555555555555';
update public.quota_requests
   set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
 where id = '9f000000-0000-7000-8000-000000000011';
delete from public.venue_memberships
 where venue_id = 'aa000000-0000-7000-8000-000000000001' and user_id = '55555555-5555-4555-8555-555555555555';
update public.quota_requests
   set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
 where id = '9f000000-0000-7000-8000-000000000012';
select ok(
  not exists (select 1 from public.notification_outbox
               where source_id = '9f000000-0000-7000-8000-000000000012' and kind = 'quota_request_decided'),
  'I3 a decision after the requester left the company queues no push and no mail');
select pg_temp.login_service();
insert into claims select 'i3', public.team_mails_claim(50);
select ok(
  not exists (select 1 from claims, jsonb_array_elements(j -> 'mails') m
               where k = 'i3' and m ->> 'to' = 'staff@plusone.test'),
  'I4 a decision queued before they left is not mailed either');
select pg_temp.as_owner();
select is(
  (select status || ':' || last_error from public.notification_outbox
    where source_id = '9f000000-0000-7000-8000-000000000011' and kind = 'quota_request_decided' and channel = 'email'),
  'skipped:no_access', 'I5 skipped as no_access');

-- I6 (#49): a platform admin without a membership gets no team mail row.
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true where id = '44444444-4444-4444-8444-444444444444';
insert into public.quota_requests (id, event_id, user_id, requested_extra, venue_id)
values ('9f000000-0000-7000-8000-000000000013', 'ee000000-0000-7000-8000-000000000001',
        '66666666-6666-4666-8666-666666666666', 1, 'aa000000-0000-7000-8000-000000000001');
select ok(
  not exists (select 1 from public.notification_outbox
               where source_id = '9f000000-0000-7000-8000-000000000013'
                 and recipient_user_id = '44444444-4444-4444-8444-444444444444'),
  'I6 a platform admin without a membership gets no row (#49)');
update public.user_profiles set is_platform_admin = false where id = '44444444-4444-4444-8444-444444444444';

-- I7 (S3): one bundle slot over two events names no event.
select pg_temp.login_service();
select public.team_mails_claim(50); -- clear I6's quota mail
select pg_temp.as_owner();
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000001',
        'Second Night', now() + interval '10 days', 'pgtap-second-night');
insert into public.guest_requests (id, event_id, full_name)
values ('9e000000-0000-7000-8000-000000000021', 'ee000000-0000-7000-8000-000000000001', 'Ada'),
       ('9e000000-0000-7000-8000-000000000022', 'ee000000-0000-7000-8000-0000000000b2', 'Bo');
update public.notification_outbox set collapse_key = 'pgtap-slot', deliver_after = now()
 where source_id in ('9e000000-0000-7000-8000-000000000021', '9e000000-0000-7000-8000-000000000022')
   and channel = 'email';
select pg_temp.login_service();
insert into claims select 'i7', public.team_mails_claim(50);
select is(
  (select (m ->> 'count') || '|' || coalesce(m -> 'event' ->> 'name', 'no event') || '|' || (m -> 'company' ->> 'name')
     from claims, jsonb_array_elements(j -> 'mails') m
    where k = 'i7' and m ->> 'to' = 'admin@plusone.test'),
  '2|no event|Club Vesper', 'I7 two events in one bundle: the count and the company, no event');

-- I8/I9 (S1): over the company's daily budget, rows wait.
select pg_temp.as_owner();
insert into public.mail_log (type, venue_id, recipient_hash)
select 'team_request', 'aa000000-0000-7000-8000-000000000001', repeat('c', 64)
  from generate_series(1, public.team_mail_venue_daily_cap());
insert into public.guest_requests (id, event_id, full_name)
values ('9e000000-0000-7000-8000-000000000031', 'ee000000-0000-7000-8000-000000000001', 'Cas');
select pg_temp.login_service();
select is(jsonb_array_length(public.team_mails_claim(50) -> 'mails'), 0,
  'I8 the company spent its daily team mail budget: no mail');
select pg_temp.as_owner();
select is(
  (select status from public.notification_outbox
    where source_id = '9e000000-0000-7000-8000-000000000031' and channel = 'email'),
  'pending', 'I9 the row waits (pending), it is not dropped');

-- I11-I13 (S4 + nits a/b): Club Vesper is over its budget with a row
-- waiting; venue 2 has one due row. A claim with room for one mail still
-- reaches venue 2, and Vesper's waiting row is no reason to kick.
select pg_temp.as_owner();
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000c2', 'aa000000-0000-7000-8000-000000000002',
        'Venue Two Night', now() + interval '12 days', 'pgtap-venue-two-night');
insert into public.guest_requests (id, event_id, full_name)
values ('9e000000-0000-7000-8000-000000000041', 'ee000000-0000-7000-8000-0000000000c2', 'Dirk');
update public.notification_outbox set next_attempt_at = now() - interval '1 minute'
 where source_id = '9e000000-0000-7000-8000-000000000041' and channel = 'email';
update public.notification_outbox set next_attempt_at = now() - interval '1 hour'
 where source_id = '9e000000-0000-7000-8000-000000000031' and channel = 'email';
select pg_temp.login_service();
insert into claims select 'i11', public.team_mails_claim(1);
select is(
  (select array_agg((m -> 'company' ->> 'name') order by m ->> 'mail_log_id') from claims, jsonb_array_elements(j -> 'mails') m where k = 'i11'),
  (select array[v.name] from public.venues v where v.id = 'aa000000-0000-7000-8000-000000000002'),
  'I11 a company over budget never crowds out another: the one-mail window reaches venue 2');
select pg_temp.as_owner();
select ok(
  'aa000000-0000-7000-8000-000000000001'::uuid = any (public.team_mail_full_venues())
  and not ('aa000000-0000-7000-8000-000000000002'::uuid = any (public.team_mail_full_venues())),
  'I12 only the company over budget counts as full (its waiting rows trigger no kick)');
insert into public.mail_log (type, venue_id, recipient_hash)
select 'team_join', 'aa000000-0000-7000-8000-000000000002', repeat('d', 64) from generate_series(1, 5);
select is(public.team_mail_sent_today('aa000000-0000-7000-8000-000000000002'), 1,
  'I13 team invites do not count toward the notification budget (only the four team_* notification types)');

-- I10 (N1): an email mode that is not a string is refused.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.set_my_notification_prefs('{"requests": {"email": null}}') $$,
  '23514', null, 'I10 "email": null is refused, never stored as a silent "off"');

-- ---------------------------------------------------------------------------
-- F. The daily summary
-- ---------------------------------------------------------------------------

select pg_temp.as_owner();
select ok(
  exists (select 1 from public.team_digest_due(current_date, 100) d where d.user_id = '11111111-1111-4111-8111-111111111111'),
  'F1 the admin with open requests is due a summary');
select ok(
  not exists (select 1 from public.team_digest_due(current_date, 100) d where d.user_id = '55555555-5555-4555-8555-555555555555'),
  'F2 staff (decides on nothing) is not due one');
select is(
  (select (c -> 'events' -> 0 ->> 'requests')::int > 0 and c ->> 'name' = 'Club Vesper'
     from jsonb_array_elements(public.team_digest_items('11111111-1111-4111-8111-111111111111')) c
    where c ->> 'name' = 'Club Vesper'),
  true, 'F3 the summary counts the open requests per event, per company');
select ok(
  public.team_digest_items('11111111-1111-4111-8111-111111111111')::text !~ '(Lotte|Daan|example\.test)',
  'F4 no guest names or addresses in the summary');
insert into public.team_digest_deliveries (user_id, local_date)
values ('11111111-1111-4111-8111-111111111111', current_date);
select ok(
  not exists (select 1 from public.team_digest_due(current_date, 100) d where d.user_id = '11111111-1111-4111-8111-111111111111'),
  'F5 once a day: after a delivery the admin is no longer due');
update public.guest_requests set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
 where status = 'pending';
update public.quota_requests set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
 where status = 'pending';
select is(
  (select count(*)::int from public.team_digest_due(current_date + 1, 100)), 0,
  'F6 nothing open anywhere: nobody is due a summary (no empty mail)');

-- ---------------------------------------------------------------------------
-- G. Unsubscribe by token
-- ---------------------------------------------------------------------------

create temp table th as
  select public.guest_mail_token_hash((select j -> 'mails' -> 0 -> 'link' ->> 'token' from claims where k = 'e2')) as h;
grant all on th to anon, authenticated, service_role;
select pg_temp.login_anon();
select is(public.unsubscribe_team_mail(repeat('1', 64), 'n1'), '{"ok": true}'::jsonb,
  'G1 an unknown token answers like a valid one');
select is(public.unsubscribe_team_mail((select h from th), 'n2'), '{"ok": true}'::jsonb,
  'G2 the decision mail''s link answers ok');
select is(pg_temp.prefs('55555555-5555-4555-8555-555555555555') -> 'decisions' ->> 'email', 'false',
  'G3 and turns decision mail off for that user, nothing else');

-- ---------------------------------------------------------------------------
-- H. mail_log
-- ---------------------------------------------------------------------------

select pg_temp.as_owner();
select ok(
  pg_get_constraintdef((select oid from pg_constraint where conname = 'mail_log_type_check'))
    ~ 'team_request' and
  pg_get_constraintdef((select oid from pg_constraint where conname = 'mail_log_type_check'))
    ~ 'team_digest' and
  pg_get_constraintdef((select oid from pg_constraint where conname = 'mail_log_type_check'))
    ~ 'guest_on_list',
  'H1 the type list gained the team types and kept the others');
select pg_temp.login_service();
select throws_ok(
  $$ select public.log_mail_attempt('team_request', 'aa000000-0000-7000-8000-000000000001', repeat('a', 64)) $$,
  '22023', null, 'H2 log_mail_attempt refuses team notification types');
select pg_temp.as_owner();
insert into public.mail_log (type, venue_id, recipient_hash)
select 'team_request', 'aa000000-0000-7000-8000-000000000002', repeat('b', 64) from generate_series(1, 30);
select ok(not public.mail_venue_cap_reached('aa000000-0000-7000-8000-000000000002'),
  'H3 thirty team mails never reach the company''s invitation cap');

select * from finish();
rollback;
