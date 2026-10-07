-- pgTAP — invite decline hardening (z8uq9m2yvp, 20261007150100_invite_decline_hardening.sql).
--
-- Review round 4 of the explicit-accept PR. Proves:
--   A. accepted_by / declined_by are unreadable for app roles (admin of the
--      company and the invitee alike), `select *` too, while the columns the app
--      reads still work. A declined invite stores a non-member's user id; the
--      company's admins may read the row, so the id must not be in reach.
--   B. invites_insert refuses a row that is already accepted or declined, with
--      the SAME error for a real and a made-up uuid (no foreign-key oracle on
--      "is this uuid a profile").
--   C. the two decline mail types fall outside the 60 s per-recipient window and
--      do not start one; every other type keeps the window.
--   D. retention: only venue-less mail_log rows older than the term go; the job
--      is scheduled; nobody but the owner may run it.
--
-- Seed: Max (1111) admin @ v1, Noor (2222) user_manager @ v1, Lisa (6666) with a
-- profile and no say at v2. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.login_service() returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

select plan(22);

-- A declined invite for Lisa at v1, written as the owner (what decline_invite
-- would have left): declined_by = Lisa, who is NOT a member of v1.
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at, declined_at, declined_by) values
  ('d1000000-0000-7000-8000-0000000000b1', 'aa000000-0000-7000-8000-000000000001', 'door@plusone.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '7 days', now(),
   '66666666-6666-4666-8666-666666666666');
delete from public.venue_memberships
 where user_id = '66666666-6666-4666-8666-666666666666' and venue_id = 'aa000000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- A. accepted_by / declined_by are unreadable
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select throws_ok($$ select declined_by from public.invites $$, '42501', null,
                 'A1 the company admin cannot read declined_by');
select throws_ok($$ select accepted_by from public.invites $$, '42501', null,
                 'A2 ... nor accepted_by');
select throws_ok($$ select * from public.invites $$, '42501', null,
                 'A3 ... and select * is refused too');
select is((select count(*)::int from public.invites
            where id = 'd1000000-0000-7000-8000-0000000000b1' and declined_at is not null),
          1, 'A4 the columns the app reads still work: the admin sees the declined invite and its declined_at');
select throws_ok($$ select declined_by from public.invites where id = 'd1000000-0000-7000-8000-0000000000b1' $$,
                 '42501', null, 'A5 a filter does not get round it: no uuid for the declined invite');

select pg_temp.login('66666666-6666-4666-8666-666666666666', 'door@plusone.test');
select throws_ok($$ select declined_by from public.invites $$, '42501', null,
                 'A6 the invitee cannot read declined_by either (they have the row, not the column)');
select is((select count(*)::int from public.invites where lower(email) = 'door@plusone.test'),
          1, 'A7 the invitee still reads their own invite (explicit columns)');

-- ---------------------------------------------------------------------------
-- B. A pre-closed row cannot be inserted; no foreign-key oracle
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at, declined_at, declined_by)
  values ('aa000000-0000-7000-8000-000000000001', 'probe1@crew.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days', now(),
          '66666666-6666-4666-8666-666666666666')
$$, '42501', null, 'B1 an insert with declined_at and a REAL profile id as declined_by is refused (RLS)');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at, declined_at, declined_by)
  values ('aa000000-0000-7000-8000-000000000001', 'probe2@crew.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days', now(),
          'dead0000-0000-4000-8000-000000000000')
$$, '42501', null, 'B2 ... and with a MADE-UP uuid it is refused with the same error (no 23503 oracle)');
select throws_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at, declined_at)
  values ('aa000000-0000-7000-8000-000000000001', 'probe3@crew.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days', now())
$$, '42501', null, 'B3 an insert that is already declined (declined_at only) is refused');
select lives_ok($$
  insert into public.invites (venue_id, email, roles, invited_by, expires_at)
  values ('aa000000-0000-7000-8000-000000000001', 'normal@crew.test', '{staff}',
          '11111111-1111-4111-8111-111111111111', now() + interval '7 days')
$$, 'B4 a normal invite insert still works');
reset role;

-- ---------------------------------------------------------------------------
-- C. Decline mails and the 60 s recipient window
-- ---------------------------------------------------------------------------
select pg_temp.login_service();
select lives_ok($$ select public.log_mail_attempt('team_invite_declined', null, repeat('a', 64)) $$,
                'C1 a decline mail is logged');
select lives_ok($$ select public.log_mail_attempt('team_invite_declined', null, repeat('a', 64)) $$,
                'C2 a second decline mail to the same address within 60 s is logged too');
select lives_ok($$ select public.log_mail_attempt('team_invite_declined_confirm', null, repeat('a', 64)) $$,
                'C3 and so is the confirmation type');
select lives_ok($$ select public.log_mail_attempt('team_join', 'aa000000-0000-7000-8000-000000000001', repeat('a', 64)) $$,
                'C4 decline mails do not start a window for other mail to that address');
select throws_ok($$ select public.log_mail_attempt('team_resend', 'aa000000-0000-7000-8000-000000000001', repeat('a', 64)) $$,
                 'PM429', null, 'C5 every other type keeps the window (a team mail just went to that address)');
select lives_ok($$ select public.log_mail_attempt('team_invite_declined', null, repeat('a', 64)) $$,
                'C6 a decline mail is not blocked by a team mail either');
reset role;

-- ---------------------------------------------------------------------------
-- D. Retention of venue-less mail_log rows
-- ---------------------------------------------------------------------------
delete from public.mail_log;
insert into public.mail_log (type, venue_id, recipient_hash, status, created_at) values
  ('team_invite_declined',         null,                                   repeat('b', 64), 'sent', now() - interval '100 days'),
  ('team_invite_declined_confirm', null,                                   repeat('c', 64), 'sent', now() - interval '10 days'),
  ('team_join', 'aa000000-0000-7000-8000-000000000001',                    repeat('d', 64), 'sent', now() - interval '100 days');
select is(public.cleanup_venueless_mail_log(), 1, 'D1 the cleanup deletes exactly the one venue-less row older than 90 days');
select is((select count(*)::int from public.mail_log where recipient_hash = repeat('c', 64)),
          1, 'D2 a recent venue-less row stays');
select is((select count(*)::int from public.mail_log where recipient_hash = repeat('d', 64)),
          1, 'D3 a venue row stays however old (it goes with its venue)');
select ok(not has_function_privilege('anon', 'public.cleanup_venueless_mail_log(interval)', 'execute')
          and not has_function_privilege('authenticated', 'public.cleanup_venueless_mail_log(interval)', 'execute')
          and not has_function_privilege('service_role', 'public.cleanup_venueless_mail_log(interval)', 'execute'),
          'D4 no app role may run the cleanup');
select is((select count(*)::int from cron.job where jobname = 'plusone-mail-log-venueless-retention'),
          1, 'D5 the daily job is scheduled');

select * from finish();

rollback;
