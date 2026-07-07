-- pgTAP — T8 (86ey4j1mu): resend a pending invite = UPDATE invites.expires_at.
-- Proves 20260707113000_invite_resend.sql: who may extend a pending invite's
-- expiry, the column lockdown (only expires_at), the pending-only rule, the
-- escalation guard and the 30-day cap. Allowed AND denied paths per role.
--
-- Seed identities (venue aa..01 = Club Vesper): Max=admin (also admin @ aa..02),
-- Noor=user_manager, Femke=finance, Tom=staff. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text default null)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1',
    'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(11);

-- Fixtures inserted as superuser (RLS bypassed): a pending staff invite, a
-- pending ADMIN invite (escalation subject), an accepted invite, all venue 1;
-- plus a pending invite at venue 2 (cross-venue subject).
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at) values
  ('ab000000-0000-7000-8000-0000000000d1', 'aa000000-0000-7000-8000-000000000001',
   'resend-pending@plusone.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('ab000000-0000-7000-8000-0000000000d2', 'aa000000-0000-7000-8000-000000000001',
   'resend-admin@plusone.test', '{admin}',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('ab000000-0000-7000-8000-0000000000d4', 'aa000000-0000-7000-8000-000000000002',
   'resend-xvenue@plusone.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day');
insert into public.invites (id, venue_id, email, roles, invited_by, expires_at, accepted_at, accepted_by) values
  ('ab000000-0000-7000-8000-0000000000d3', 'aa000000-0000-7000-8000-000000000001',
   'resend-accepted@plusone.test', '{staff}',
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day',
   now(), '55555555-5555-4555-8555-555555555555');

-- 1: admin extends a pending invite's expiry (the resend path).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d1'$$),
          1, '1 admin extends a pending invite (resend)');

-- 2: user_manager may resend a non-admin invite.
select pg_temp.login('22222222-2222-4222-8222-222222222222', 'manager@plusone.test');
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d1'$$),
          1, '2 user_manager resends a staff invite');

-- 3: user_manager cannot touch an invite that grants admin (escalation guard;
-- RLS filters the row → 0 affected).
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d2'$$),
          0, '3 user_manager cannot resend an admin invite (escalation)');

-- 4: admin CAN resend the admin invite.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d2'$$),
          1, '4 admin resends an admin invite');

-- 5: staff cannot resend at all.
select pg_temp.login('55555555-5555-4555-8555-555555555555', 'staff@plusone.test');
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d1'$$),
          0, '5 staff cannot resend an invite');

-- 6: finance reads invites but cannot resend (view-only role).
select pg_temp.login('33333333-3333-4333-8333-333333333333', 'finance@plusone.test');
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d1'$$),
          0, '6 finance cannot resend an invite');

-- 7: an accepted invite is immutable — even admin cannot extend it.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d3'$$),
          0, '7 accepted invites cannot be extended');

-- 8: a manager of venue 1 only cannot resend a venue-2 invite. Noor holds
-- user_manager at venue 1 and nothing at venue 2.
select pg_temp.login('22222222-2222-4222-8222-222222222222', 'manager@plusone.test');
select is(pg_temp.rowcount($$update public.invites
                            set expires_at = now() + interval '7 days'
                            where id = 'ab000000-0000-7000-8000-0000000000d4'$$),
          0, '8 manager cannot resend into a venue they do not manage');

-- 9: the new expiry may not exceed the 30-day cap (WITH CHECK violation).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'admin@plusone.test');
select throws_ok($$update public.invites
                   set expires_at = now() + interval '90 days'
                   where id = 'ab000000-0000-7000-8000-0000000000d1'$$,
                 '42501', null, '9 expiry beyond 30 days is refused');

-- 10: the new expiry must be in the future (WITH CHECK violation).
select throws_ok($$update public.invites
                   set expires_at = now() - interval '1 day'
                   where id = 'ab000000-0000-7000-8000-0000000000d1'$$,
                 '42501', null, '10 expiry in the past is refused');

-- 11: only expires_at is updatable — any other column fails on the column
-- grant (42501 permission denied), the client can never rewrite an invite.
select throws_ok($$update public.invites
                   set email = 'hijack@plusone.test'
                   where id = 'ab000000-0000-7000-8000-0000000000d1'$$,
                 '42501', null, '11 columns other than expires_at are not updatable');

reset role;

select * from finish();

rollback;
