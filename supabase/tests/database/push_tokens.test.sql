-- pgTAP — push_tokens (Fase 17 N2, 86ey6bfbe; migrations 20260925120000 +
-- 20260925120200). Run: pnpm db:test.
--
-- Proves: the grant layer (anon nothing, authenticated the four verbs); owner-
-- only RLS on every verb, allowed AND denied per role, incl. a venue admin and
-- a cross-venue admin; the server-side session_id stamp (a client cannot bind
-- a token to someone else's session, nor to none, nor has to send one); the
-- device-handover rule — possession of the device token wins (spec #50): the
-- new user takes over the previous owner's row for that exact token, dead or
-- live session, and nothing else of theirs; and that
-- revoke_own_session / admin_revoke_session delete exactly the revoked
-- session's tokens with their authorization checks unchanged; and (N5 review,
-- 20260925160000) that last_seen_at is server-stamped on INSERT and UPDATE —
-- a client-sent past or future value never sticks — while owner/fixture
-- writes still pass through as given.
--
-- Seed: venue1 aa..01 — Max 11.. admin (also admin of venue2 aa..02), Noor
-- 22.. user_manager, Tom 55.. staff, Lisa 66.. doorhost+staff. Rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_session uuid default null)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1',
    'session_id', p_session)::text, true);
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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(52);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner): live sessions for Tom (x2) and Lisa, two Lisa tokens on
-- her live session, a Lisa token on a session that no longer exists.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', true);

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('5e550000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', now(), now(), 'aal1'),
  ('5e550000-0000-4000-8000-000000000002', '55555555-5555-4555-8555-555555555555', now(), now(), 'aal1'),
  ('5e550000-0000-4000-8000-000000000006', '66666666-6666-4666-8666-666666666666', now(), now(), 'aal1');

insert into public.push_tokens (id, user_id, session_id, transport, token) values
  ('70000000-0000-4000-8000-000000000061', '66666666-6666-4666-8666-666666666666',
   '5e550000-0000-4000-8000-000000000006', 'fcm', 'lisa-live-device'),
  ('70000000-0000-4000-8000-000000000063', '66666666-6666-4666-8666-666666666666',
   '5e550000-0000-4000-8000-000000000006', 'fcm', 'lisa-tablet'),
  ('70000000-0000-4000-8000-000000000062', '66666666-6666-4666-8666-666666666666',
   '5e550000-0000-4000-8000-0000000000de', 'fcm', 'handed-over-device');

-- ---------------------------------------------------------------------------
-- A. Grants + RLS switched on
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.push_tokens'::regclass),
  'A1 RLS is enabled on push_tokens');

select ok(
  has_table_privilege('authenticated', 'public.push_tokens', 'SELECT')
  and has_table_privilege('authenticated', 'public.push_tokens', 'INSERT')
  and has_table_privilege('authenticated', 'public.push_tokens', 'UPDATE')
  and has_table_privilege('authenticated', 'public.push_tokens', 'DELETE'),
  'A2 authenticated holds select/insert/update/delete');

select ok(
  not has_table_privilege('anon', 'public.push_tokens', 'SELECT')
  and not has_table_privilege('anon', 'public.push_tokens', 'INSERT')
  and not has_table_privilege('anon', 'public.push_tokens', 'UPDATE')
  and not has_table_privilege('anon', 'public.push_tokens', 'DELETE'),
  'A3 anon holds nothing on push_tokens');

select is_empty($$
  select policyname from pg_policies
  where schemaname = 'public' and tablename = 'push_tokens'
    and (coalesce(qual, '') ilike '%platform_admin%' or coalesce(with_check, '') ilike '%platform_admin%')
$$, 'A4 no push_tokens policy carries the platform-admin bypass (tokens are personal)');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'push_tokens' and roles = '{authenticated}'),
  4, 'A5 one owner policy per verb, all scoped to authenticated');

-- ---------------------------------------------------------------------------
-- B. Owner insert + session stamp
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555', '5e550000-0000-4000-8000-000000000001');

select lives_ok($$
  insert into public.push_tokens (id, transport, token, device_label)
  values ('70000000-0000-4000-8000-000000000051', 'fcm', 'tom-phone', 'Tom iPhone')
$$, 'B1 staff registers a token for themself (user_id defaults to auth.uid())');

select is(
  (select session_id from public.push_tokens where id = '70000000-0000-4000-8000-000000000051'),
  '5e550000-0000-4000-8000-000000000001'::uuid,
  'B1b …without sending a session_id: it comes from the JWT');

select lives_ok($$
  insert into public.push_tokens (id, transport, token, session_id)
  values ('70000000-0000-4000-8000-000000000052', 'fcm', 'tom-forged-session',
          '5e550000-0000-4000-8000-000000000006')
$$, 'B2 an insert naming someone else''s session_id is accepted…');

select is(
  (select session_id from public.push_tokens where id = '70000000-0000-4000-8000-000000000052'),
  '5e550000-0000-4000-8000-000000000001'::uuid,
  'B3 …but the row is bound to the caller''s own JWT session, not the forged one');

select throws_ok($$
  insert into public.push_tokens (transport, token, user_id)
  values ('fcm', 'tom-as-lisa', '66666666-6666-4666-8666-666666666666')
$$, '42501', null, 'B4 a token cannot be registered for another user');

select pg_temp.login('55555555-5555-4555-8555-555555555555', null);
select throws_ok($$
  insert into public.push_tokens (transport, token) values ('fcm', 'tom-no-session')
$$, '42501', 'push token requires a session', 'B5 a JWT without a session_id claim cannot register');

select pg_temp.login('55555555-5555-4555-8555-555555555555', '5e550000-0000-4000-8000-000000000001');
select throws_ok($$
  insert into public.push_tokens (transport, token) values ('carrier-pigeon', 'x')
$$, '23514', null, 'B6 transport is constrained to web-push/fcm/apns');

-- ---------------------------------------------------------------------------
-- C. Owner-only read/update/delete, denied for every other role
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.push_tokens), 2,
  'C1 staff sees exactly their own two rows');

select is(
  pg_temp.rowcount($$update public.push_tokens set device_label = 'pwned'
                     where id = '70000000-0000-4000-8000-000000000061'$$),
  0, 'C2 staff cannot update another user''s token');

select is(
  pg_temp.rowcount($$delete from public.push_tokens where id = '70000000-0000-4000-8000-000000000061'$$),
  0, 'C3 staff cannot delete another user''s token');

select lives_ok($$
  update public.push_tokens
     set session_id = '5e550000-0000-4000-8000-000000000006', last_seen_at = now()
   where id = '70000000-0000-4000-8000-000000000051'
$$, 'C4 owner may touch their own row (last_seen_at refresh)…');

select is(
  (select session_id from public.push_tokens where id = '70000000-0000-4000-8000-000000000051'),
  '5e550000-0000-4000-8000-000000000001'::uuid,
  'C5 …and an UPDATE cannot rebind it to another session either');

select throws_ok($$
  update public.push_tokens set user_id = '66666666-6666-4666-8666-666666666666'
   where id = '70000000-0000-4000-8000-000000000051'
$$, '42501', null, 'C6 owner cannot hand their row to another user');

select lives_ok($$
  insert into public.push_tokens (transport, token) values ('fcm', 'tom-phone')
  on conflict (transport, token) do update set last_seen_at = now()
$$, 'C7 token refresh as an upsert on (transport, token) works for the owner');

-- Venue admin of the same venue: no special reach into a member's devices.
select pg_temp.login('11111111-1111-4111-8111-111111111111', '5e550000-0000-4000-8000-0000000000aa');
select is((select count(*)::int from public.push_tokens), 0,
  'C8 a venue admin sees no member''s tokens (admin of venue1 and venue2)');
select is(
  pg_temp.rowcount($$delete from public.push_tokens$$),
  0, 'C9 a venue admin cannot delete a member''s tokens');

select pg_temp.login('22222222-2222-4222-8222-222222222222', '5e550000-0000-4000-8000-0000000000bb');
select is(
  pg_temp.rowcount($$update public.push_tokens set last_seen_at = now()$$),
  0, 'C10 user_manager cannot touch anyone''s tokens');

select pg_temp.login_anon();
select throws_ok($$select count(*) from public.push_tokens$$, '42501', null,
  'C11 anon cannot read push_tokens');
select throws_ok($$insert into public.push_tokens (user_id, session_id, transport, token)
                   values ('55555555-5555-4555-8555-555555555555',
                           '5e550000-0000-4000-8000-000000000001', 'fcm', 'anon-plant')$$,
  '42501', null, 'C12 anon cannot write push_tokens');

-- ---------------------------------------------------------------------------
-- D. Device handover — possession of the device token wins (spec #50)
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555', '5e550000-0000-4000-8000-000000000002');

select lives_ok($$
  insert into public.push_tokens (transport, token) values ('fcm', 'handed-over-device')
$$, 'D1 a token last held by a DEAD session of another user is taken over');

select lives_ok($$
  insert into public.push_tokens (transport, token) values ('fcm', 'lisa-tablet')
  on conflict (transport, token) do update set last_seen_at = now()
$$, 'D2 a token held by a LIVE session of another user is taken over too (shared tablet)');

select lives_ok($$
  insert into public.push_tokens (transport, token) values ('apns', 'lisa-live-device')
$$, 'D3 the same string under another transport is a different device: no takeover');

select throws_ok($$
  insert into public.push_tokens (transport, token, user_id)
  values ('fcm', 'lisa-live-device', '22222222-2222-4222-8222-222222222222')
$$, '42501', 'push token owner must be the caller',
  'D4 a forged owner is refused before any handover delete runs');

reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  (select user_id from public.push_tokens where transport = 'fcm' and token = 'handed-over-device'),
  '55555555-5555-4555-8555-555555555555'::uuid,
  'D5 the dead-session device now belongs to the new user');
select is(
  (select user_id::text || '/' || session_id::text from public.push_tokens
   where transport = 'fcm' and token = 'lisa-tablet'),
  '55555555-5555-4555-8555-555555555555/5e550000-0000-4000-8000-000000000002',
  'D6 the live-session device now belongs to the new user, bound to their session');
select is(
  (select user_id from public.push_tokens where id = '70000000-0000-4000-8000-000000000061'),
  '66666666-6666-4666-8666-666666666666'::uuid,
  'D7 the previous owner''s OTHER device row is untouched (by D3 and by the refused D4)');

-- ---------------------------------------------------------------------------
-- E. Remote logout invalidates push (20260925120200)
-- ---------------------------------------------------------------------------
-- Tom now: tom-phone + tom-forged-session on session …01; handed-over-device,
-- lisa-tablet and the apns row on …02.
select pg_temp.login('55555555-5555-4555-8555-555555555555', '5e550000-0000-4000-8000-000000000002');

select is(public.revoke_own_session('5e550000-0000-4000-8000-000000000006'), false,
  'E1 revoke_own_session on someone else''s session is still refused (false)');
select is(public.revoke_own_session('5e550000-0000-4000-8000-000000000001'), true,
  'E2 revoke_own_session ends the caller''s own session');

reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  (select count(*)::int from public.push_tokens where session_id = '5e550000-0000-4000-8000-000000000001'),
  0, 'E3 the revoked session''s tokens are gone');
select is(
  (select count(*)::int from public.push_tokens where session_id = '5e550000-0000-4000-8000-000000000002'),
  3, 'E4 the same user''s other session keeps its tokens');
select is(
  (select count(*)::int from public.push_tokens where id = '70000000-0000-4000-8000-000000000061'),
  1, 'E5 the refused own-revoke left Lisa''s token alone');

-- user_manager is not admin: admin_revoke_session keeps refusing, tokens stay.
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok($$select public.admin_revoke_session('5e550000-0000-4000-8000-000000000006')$$,
  '42501', null, 'E6 admin_revoke_session still refuses a non-admin');

-- Admin at the shared venue: the session and its tokens go.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(public.admin_revoke_session('5e550000-0000-4000-8000-000000000006'), true,
  'E7 a shared-venue admin remotely ends Lisa''s session');

reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  (select count(*)::int from public.push_tokens where user_id = '66666666-6666-4666-8666-666666666666'),
  0, 'E8 remote logout removed that session''s push token');
select is(
  (select count(*)::int from auth.sessions where id = '5e550000-0000-4000-8000-000000000006'),
  0, 'E9 …and the auth session itself, as before');

-- ---------------------------------------------------------------------------
-- F. last_seen_at is the server's clock, never the client's (20260925160000)
-- ---------------------------------------------------------------------------
-- now() is the transaction start, so "stamped" is an exact equality here.
-- Fixture (as owner): a Tom row on his live session …02 last seen 100 days ago.
insert into public.push_tokens (id, user_id, session_id, transport, token, last_seen_at, created_at) values
  ('70000000-0000-4000-8000-0000000000f1', '55555555-5555-4555-8555-555555555555',
   '5e550000-0000-4000-8000-000000000002', 'fcm', 'tom-old-stamp',
   now() - interval '100 days', now() - interval '100 days');

select is(
  (select last_seen_at from public.push_tokens where id = '70000000-0000-4000-8000-0000000000f1'),
  now() - interval '100 days',
  'F1 an owner/fixture write keeps the last_seen_at it was given (TTL tests rely on it)');

select pg_temp.login('55555555-5555-4555-8555-555555555555', '5e550000-0000-4000-8000-000000000002');

select lives_ok($$
  insert into public.push_tokens (id, transport, token, last_seen_at)
  values ('70000000-0000-4000-8000-0000000000f2', 'fcm', 'tom-past-insert', now() - interval '200 days')
$$, 'F2 a client INSERT naming a past last_seen_at is accepted…');
select is(
  (select last_seen_at from public.push_tokens where id = '70000000-0000-4000-8000-0000000000f2'),
  now(), 'F3 …but stamped now(): the past value is overwritten');

select lives_ok($$
  insert into public.push_tokens (id, transport, token, last_seen_at)
  values ('70000000-0000-4000-8000-0000000000f3', 'fcm', 'tom-future-insert', now() + interval '10 years')
$$, 'F4 a client INSERT naming a future last_seen_at is accepted…');
select is(
  (select last_seen_at from public.push_tokens where id = '70000000-0000-4000-8000-0000000000f3'),
  now(), 'F5 …but stamped now(): a device cannot pin itself out of the TTL sweep');

select is(
  pg_temp.rowcount($$update public.push_tokens set last_seen_at = now() - interval '300 days'
                     where id = '70000000-0000-4000-8000-0000000000f2'$$),
  1, 'F6 a client UPDATE setting a past last_seen_at goes through as a write…');
select is(
  (select last_seen_at from public.push_tokens where id = '70000000-0000-4000-8000-0000000000f2'),
  now(), 'F7 …but the column reads now(): a client cannot age its row into the sweep either');

select lives_ok($$
  update public.push_tokens set last_seen_at = now() + interval '10 years'
   where id = '70000000-0000-4000-8000-0000000000f3'
$$, 'F8 a client UPDATE setting a future last_seen_at is accepted…');
select is(
  (select last_seen_at from public.push_tokens where id = '70000000-0000-4000-8000-0000000000f3'),
  now(), 'F9 …and overwritten with now()');

-- The re-registration the N5 client sends: an upsert WITHOUT last_seen_at.
-- The conflict path is an UPDATE; that alone must refresh the stamp.
select lives_ok($$
  insert into public.push_tokens (transport, token, device_label) values ('fcm', 'tom-old-stamp', 'android')
  on conflict (transport, token) do update set device_label = excluded.device_label
$$, 'F10 a re-registration upsert that does not mention last_seen_at works…');
select is(
  (select last_seen_at::text || '|' || created_at::text || '|' || id::text
   from public.push_tokens where token = 'tom-old-stamp'),
  now()::text || '|' || (now() - interval '100 days')::text || '|70000000-0000-4000-8000-0000000000f1',
  'F11 …and refreshes last_seen_at to now() while id and created_at stay pinned');

select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.push_tokens_stamp()'::regprocedure),
  'F12 push_tokens_stamp is still SECURITY DEFINER with search_path pinned to empty');

select * from finish();
rollback;
