-- pgTAP — failed mail attempts do not count (z8uq9m2yvp, review of PR #430),
-- 20261011120000_mail_failed_rows_free.sql.
--
-- Foothold: an admin whose invite mail failed at the provider (nothing went
-- out) retries within a minute; and a provider outage that would otherwise
-- spend a company's daily invitation budget. Proves, through the service_role
-- RPCs the app calls:
--   W. recipient window: a failed row does not block a new send (allowed);
--      a queued or sent row still does (denied); a failed row of a decline
--      type changes nothing either way;
--   C. company cap: failed rows do not count; queued and sent rows do;
--   G. the ACL survived create or replace (service_role only).
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login_service()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

select plan(10);

insert into public.venues (id, name, slug) values
  ('ac000000-0000-7000-8000-0000000000f1', 'Failed Rows Club', 'failed-rows-club');

-- ---------------------------------------------------------------------------
-- W. Recipient window
-- ---------------------------------------------------------------------------

-- A failed attempt to recipient 'd1' a few seconds ago.
insert into public.mail_log (type, venue_id, recipient_hash, status, error_code)
values ('team_join', 'ac000000-0000-7000-8000-0000000000f1', repeat('d1', 32), 'failed', 'provider_unavailable');

select pg_temp.login_service();
select lives_ok(
  $$ select public.log_mail_attempt('team_join', 'ac000000-0000-7000-8000-0000000000f1', repeat('d1', 32)) $$,
  'W1 a failed attempt within 60 s does not block a retry to the same recipient');
reset role;
select is(
  (select count(*)::int from public.mail_log where recipient_hash = repeat('d1', 32) and status = 'queued'), 1,
  'W2 ...and the retry is logged as a new queued row');

-- That new row is queued (a send in flight): it still blocks.
select pg_temp.login_service();
select throws_ok(
  $$ select public.log_mail_attempt('team_join', 'ac000000-0000-7000-8000-0000000000f1', repeat('d1', 32)) $$,
  'PM429', null, 'W3 a queued attempt within 60 s still blocks the recipient');
reset role;

-- A sent row still blocks.
insert into public.mail_log (type, venue_id, recipient_hash, status)
values ('team_join', 'ac000000-0000-7000-8000-0000000000f1', repeat('d2', 32), 'sent');
select pg_temp.login_service();
select throws_ok(
  $$ select public.log_mail_attempt('team_resend', 'ac000000-0000-7000-8000-0000000000f1', repeat('d2', 32)) $$,
  'PM429', null, 'W4 a sent mail within 60 s still blocks the recipient');
reset role;

-- A bounced (delivered-side) row still blocks: only 'failed' is free.
insert into public.mail_log (type, venue_id, recipient_hash, status)
values ('team_join', 'ac000000-0000-7000-8000-0000000000f1', repeat('d3', 32), 'bounced');
select pg_temp.login_service();
select throws_ok(
  $$ select public.log_mail_attempt('team_resend', 'ac000000-0000-7000-8000-0000000000f1', repeat('d3', 32)) $$,
  'PM429', null, 'W5 a bounced mail within 60 s still blocks (only failed is free)');
reset role;

-- ---------------------------------------------------------------------------
-- C. Company cap (fresh venue: cap - 1 failed + cap - 1 sent rows today)
-- ---------------------------------------------------------------------------

insert into public.venues (id, name, slug) values
  ('ac000000-0000-7000-8000-0000000000f2', 'Outage Club', 'outage-club');
insert into public.mail_log (type, venue_id, recipient_hash, status, error_code)
select 'team_join', 'ac000000-0000-7000-8000-0000000000f2', encode(extensions.digest('f2-failed-' || i, 'sha256'), 'hex'),
       'failed', 'provider_unavailable'
  from generate_series(1, public.mail_venue_daily_cap()) as i;

select pg_temp.login_service();
select is(public.mail_venue_cap_reached('ac000000-0000-7000-8000-0000000000f2'), false,
  'C1 a full day of failed attempts does not reach the cap');
select lives_ok(
  $$ select public.log_mail_attempt('team_join', 'ac000000-0000-7000-8000-0000000000f2', repeat('e1', 32)) $$,
  'C2 ...so the company can still send');
reset role;

-- Queued (the C2 row) + sent rows up to the cap do count.
insert into public.mail_log (type, venue_id, recipient_hash, status)
select 'team_join', 'ac000000-0000-7000-8000-0000000000f2', encode(extensions.digest('f2-sent-' || i, 'sha256'), 'hex'), 'sent'
  from generate_series(1, public.mail_venue_daily_cap() - 1) as i;
select pg_temp.login_service();
select is(public.mail_venue_cap_reached('ac000000-0000-7000-8000-0000000000f2'), true,
  'C3 queued and sent rows still count: the cap is reached');
select throws_ok(
  $$ select public.log_mail_attempt('team_join', 'ac000000-0000-7000-8000-0000000000f2', repeat('e2', 32)) $$,
  'PM429', null, 'C4 ...and the backstop refuses past it');
reset role;

-- ---------------------------------------------------------------------------
-- G. ACL unchanged by create or replace
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.log_mail_attempt(text, uuid, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mail_venue_cap_reached(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.log_mail_attempt(text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mail_venue_cap_reached(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.log_mail_attempt(text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mail_venue_cap_reached(uuid)', 'EXECUTE'),
  'G1 both functions stay service_role-only');

select * from finish();
rollback;
