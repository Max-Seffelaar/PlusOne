-- pgTAP: info for guests per event (z8uq9m4a5n; migration
-- 20261015160000_event_guest_info).
--
--   A. Grants: authenticated reads/inserts/updates the column, anon nothing.
--   B. The check: 1..1000 characters, newlines allowed, other control
--      characters refused.
--   C. Who may set it: admin and the event's organizer (RLS on events); staff,
--      an outsider change nothing; anon is refused.
--   D. Audit: a guest_info change writes one audit_log row on the actor's uid
--      with the new value in the diff; a refused write writes none.
--   E. Readers: the claim payload carries it; get_guest_status returns it for
--      its own token while the spot holds, never another event's text, and
--      nothing for a guest off the list.
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

-- The event's stored text, read as owner whatever role is active.
create function pg_temp.event_info()
returns text language sql security definer as $fn$
  select guest_info from public.events where id = 'ee000000-0000-7000-8000-000000000001';
$fn$;
grant execute on function pg_temp.event_info() to anon, authenticated, service_role;

create function pg_temp.audit_n()
returns int language sql security definer as $fn$
  select count(*)::int from public.audit_log
   where entity_id = 'ee000000-0000-7000-8000-000000000001' and action = 'update'
     and diff -> 'after' ? 'guest_info';
$fn$;
grant execute on function pg_temp.audit_n() to anon, authenticated, service_role;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner)
-- ---------------------------------------------------------------------------
-- Club Vesper (aa…01), seed event ee…01: admin@ 1111 (admin), organizer@ 4444
-- (event organizer), staff@ 5555 (staff). Outsider 7777 has no tie at all.
-- A second event ee…f2 in the same company, with its own tier and guest, is
-- the "foreign token" side of E.

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

insert into public.events (id, venue_id, name, starts_at, landing_slug, contact_email)
values ('ee000000-0000-7000-8000-0000000000f2', 'aa000000-0000-7000-8000-000000000001',
        'Other night', now() + interval '3 days', 'other-night-gi', 'other@vesper.test');
insert into public.guest_tiers (id, event_id, venue_id, name)
values ('dd000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-0000000000f2',
        'aa000000-0000-7000-8000-000000000001', 'Guest');

insert into public.guests (id, event_id, tier_id, full_name, email, plus_ones, added_by, source)
values
  ('f2000000-0000-7000-8000-0000000000a1', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Lotte Jansen', 'lotte@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app'),
  ('f2000000-0000-7000-8000-0000000000a2', 'ee000000-0000-7000-8000-0000000000f2',
   'dd000000-0000-7000-8000-0000000000f2', 'Daan Visser', 'daan@example.test', 0,
   '11111111-1111-4111-8111-111111111111', 'app');

update public.events set contact_email = 'night@vesper.test' where id = 'ee000000-0000-7000-8000-000000000001';

create temp table claims (k text primary key, j jsonb);
grant all on claims to anon, authenticated, service_role;
create temp table th (k text primary key, h text);
grant all on th to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A. Grants
-- ---------------------------------------------------------------------------

select ok(
  has_column_privilege('authenticated', 'public.events', 'guest_info', 'SELECT')
  and has_column_privilege('authenticated', 'public.events', 'guest_info', 'INSERT')
  and has_column_privilege('authenticated', 'public.events', 'guest_info', 'UPDATE'),
  'A1 authenticated may read, insert and update events.guest_info (RLS picks the rows)');
select ok(
  not has_column_privilege('anon', 'public.events', 'guest_info', 'SELECT')
  and not has_column_privilege('anon', 'public.events', 'guest_info', 'INSERT')
  and not has_column_privilege('anon', 'public.events', 'guest_info', 'UPDATE'),
  'A2 anon holds nothing on events.guest_info');

-- ---------------------------------------------------------------------------
-- B. The check (as admin)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.events set guest_info = '' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'B1 an empty string is refused (null means none)');
select throws_ok(
  $$ update public.events set guest_info = repeat('x', 1001) where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'B2 more than 1000 characters is refused');
select throws_ok(
  $$ update public.events set guest_info = E'Park\u0007 here' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'B3 a control character (BEL) is refused');
select throws_ok(
  $$ update public.events set guest_info = E'Park\u001B[31m here' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'B4 an escape sequence is refused');
select lives_ok(
  $$ update public.events set guest_info = repeat('x', 1000) where id = 'ee000000-0000-7000-8000-000000000001' $$,
  'B5 exactly 1000 characters is accepted');

-- ---------------------------------------------------------------------------
-- C. Who may set it
-- ---------------------------------------------------------------------------

update public.events set guest_info = E'Park at P2.\r\nEntrance on the side street.\n\tDress code: black.'
 where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_info(), E'Park at P2.\r\nEntrance on the side street.\n\tDress code: black.',
  'C1 the company admin sets it; newlines and tabs are kept');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
update public.events set guest_info = E'Park at P2.\nEntrance on the side street.'
 where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_info(), E'Park at P2.\nEntrance on the side street.',
  'C2 the event organizer sets it too');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.events set guest_info = 'staff was here' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_info(), E'Park at P2.\nEntrance on the side street.',
  'C3 staff changes nothing (RLS filters the row)');

select pg_temp.login('77777777-7777-4777-8777-777777777777');
update public.events set guest_info = 'outsider' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.event_info(), E'Park at P2.\nEntrance on the side street.',
  'C4 an outsider changes nothing');

select pg_temp.login_anon();
select throws_ok(
  $$ update public.events set guest_info = 'anon' where id = 'ee000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'C5 anon is refused outright');

-- ---------------------------------------------------------------------------
-- D. Audit
-- ---------------------------------------------------------------------------

select pg_temp.as_owner();
delete from public.audit_log where entity_id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events set guest_info = 'Dress code: all black.' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.audit_n(), 1, 'D1 a guest_info change writes exactly one audit row');
select pg_temp.as_owner();
select is(
  (select diff -> 'after' ->> 'guest_info' from public.audit_log
    where entity_id = 'ee000000-0000-7000-8000-000000000001' and action = 'update'
    order by created_at desc limit 1),
  'Dress code: all black.', 'D2 the diff carries the new text');
select is(
  (select actor_id from public.audit_log
    where entity_id = 'ee000000-0000-7000-8000-000000000001' and action = 'update'
    order by created_at desc limit 1),
  '11111111-1111-4111-8111-111111111111'::uuid, 'D3 the actor is the admin who changed it');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.events set guest_info = 'staff again' where id = 'ee000000-0000-7000-8000-000000000001';
select is(pg_temp.audit_n(), 1, 'D4 a write RLS refuses writes no audit row');

-- ---------------------------------------------------------------------------
-- E. Readers
-- ---------------------------------------------------------------------------

select pg_temp.as_owner();
update public.events set guest_info = E'Park at P2.\nEntrance on the side street.'
 where id = 'ee000000-0000-7000-8000-000000000001';
update public.events set guest_info = 'SECRET of the other night'
 where id = 'ee000000-0000-7000-8000-0000000000f2';

select pg_temp.login_service();
select isnt(public.enqueue_guest_mail('f2000000-0000-7000-8000-0000000000a1', 'guest_on_list'), null,
  'E1 a confirmation is queued for the first event''s guest');
select isnt(public.enqueue_guest_mail('f2000000-0000-7000-8000-0000000000a2', 'guest_on_list'), null,
  'E2 and one for the other event''s guest');
insert into claims
  select m -> 'event' ->> 'id', m
    from jsonb_array_elements(public.guest_mails_claim(50) -> 'mails') m;
select is(
  (select j -> 'event' ->> 'guest_info' from claims where k = 'ee000000-0000-7000-8000-000000000001'),
  E'Park at P2.\nEntrance on the side street.', 'E3 the claim payload carries the event''s guest_info');
select is(
  (select j -> 'event' ->> 'guest_info' from claims where k = 'ee000000-0000-7000-8000-0000000000f2'),
  'SECRET of the other night', 'E4 each mail carries its own event''s text');

-- The page sends sha256(token); the hash helper is owner-only, so compute it here.
select pg_temp.as_owner();
insert into th
  select k, public.guest_mail_token_hash(j -> 'links' ->> 'status') from claims;

select pg_temp.login_anon();
select is(
  public.get_guest_status((select h from th where k = 'ee000000-0000-7000-8000-000000000001'), 'gi1')
    -> 'event' ->> 'guest_info',
  E'Park at P2.\nEntrance on the side street.', 'E5 the status page returns its own event''s text');
select ok(
  position('SECRET' in public.get_guest_status(
    (select h from th where k = 'ee000000-0000-7000-8000-000000000001'), 'gi1')::text) = 0,
  'E6 a token for one event never carries another event''s text');
select is(
  public.get_guest_status(encode(extensions.digest('not-a-token', 'sha256'), 'hex'), 'gi1'),
  '{"found": false}'::jsonb, 'E7 an unknown token gets the neutral not-found');

-- Off the list: the text goes, like the house rules.
select pg_temp.as_owner();
update public.guests set status = 'removed' where id = 'f2000000-0000-7000-8000-0000000000a1';
select pg_temp.login_anon();
select is(
  public.get_guest_status((select h from th where k = 'ee000000-0000-7000-8000-000000000001'), 'gi1')
    -> 'event' -> 'guest_info',
  'null'::jsonb, 'E8 a guest off the list no longer gets the text');

select * from finish();
rollback;
