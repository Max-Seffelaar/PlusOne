-- pgTAP — Requests E (z8uq9m2vga, migration 20261015120000): one atomic
-- decision per landing request — trim, split over tiers, decline (part of) it
-- with a mandatory note. Run: pnpm db:test.
--
-- Proves:
--   A. the grant matrix (authenticated only; anon/service_role none) and the
--      guests.guest_request_id guard (client roles can't set or change it);
--   B. a split: +3 → 1 VIP, 1 Regular +1 (= 3 people), 1 declined with a note
--      makes exactly two guests with the right tiers and +N, the request is
--      approved with approved_plus_ones = 2 and the note; audit rows per guest
--      and one 'approve' row on the request carrying the count and the note;
--   C. the note is mandatory on any decline (part or whole), counts must add up,
--      no negative plus-ones, no tier of another event, each tier once;
--   D. a cap breach (event capacity 45005, tier-max 45002) rolls the whole
--      decision back: no guest of the decision survives, the request stays
--      pending;
--   E. roles: admin and organizer may decide; user_manager, finance, staff,
--      doorhost, an admin of another company and anon may not (42501, nothing
--      changed);
--   F. idempotency: the same decision again is a replay (same ids, nothing
--      new); another decision on a decided request is 45003; a declined
--      request can still be approved after all (#12);
--   G. a whole decline: denied, note stored, the decline mail can be queued,
--      the status page shows the note (own token);
--   H. stats: request_decision_counts counts the declined part of a partly
--      approved request as declined, and is RLS-scoped (staff sees zeros);
--   I. the decision mail: exactly one queue row per decision (approved/partly
--      on the first part, declined on the request), never "You're on the
--      list"; the auto-approve link path now queues the approval mail itself.
--   J. the claim: one payload per decision with every part in `tiers`;
--   K. the note is mandatory in the database on every path (review S1/S2):
--      invisible-only text is no note (RPC + CHECK), approve_guest_request
--      cannot trim without a note, a legacy decline without a note stays valid;
--   L. a later reminder to a split guest lists every part (review S3).
--
-- Seed: event ee..01 (Club Vesper aa..01) with tiers dd..01 Regular, dd..02
-- VIP, dd..03 (max 10). Max 11.. admin, Noor 22.. user_manager, Femke 33..
-- finance, Yusuf 44.. organizer of ee..01, Tom 55.. staff, Lisa 66.. doorhost.
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

-- "status|approved_plus_ones|note|guests of this request" as the owner.
create function pg_temp.req_state(p_id uuid)
returns text language sql as $fn$
  select r.status::text || '|' || coalesce(r.approved_plus_ones::text, '-') || '|'
         || coalesce(r.decision_message, '-') || '|'
         || (select count(*) from public.guests g where g.guest_request_id = r.id)::text
  from public.guest_requests r where r.id = p_id;
$fn$;

create function pg_temp.new_request(p_id uuid, p_name text, p_plus int, p_email text default null)
returns void language sql as $fn$
  insert into public.guest_requests (id, event_id, full_name, email, phone, plus_ones)
  values (p_id, 'ee000000-0000-7000-8000-000000000001', p_name, p_email, '+31600000000', p_plus);
$fn$;

select plan(82);

-- Fixtures (as the owner).
select pg_temp.new_request('bb700000-0000-7000-8000-000000000001', 'Lotte Jansen', 3, 'lotte@example.test');
select pg_temp.new_request('bb700000-0000-7000-8000-000000000002', 'Daan Smit', 1, 'daan@example.test');
select pg_temp.new_request('bb700000-0000-7000-8000-000000000003', 'Robin Kok', 2, 'robin@example.test');
select pg_temp.new_request('bb700000-0000-7000-8000-000000000004', 'Esra Bos', 1, 'esra@example.test');
select pg_temp.new_request('bb700000-0000-7000-8000-000000000005', 'Pim Dekker', 0, 'pim@example.test');
select pg_temp.new_request('bb700000-0000-7000-8000-000000000006', 'Sem Visser', 2, null);
-- Another company's event + tier (venue aa..02, where Max is admin too).
insert into public.events (id, venue_id, name, starts_at, ends_at, status)
values ('ee700000-0000-7000-8000-000000000002', 'aa000000-0000-7000-8000-000000000002',
        'Elsewhere', now() + interval '6 days', now() + interval '6 days 6 hours', 'open');
insert into public.guest_tiers (id, event_id, name)
values ('dd700000-0000-7000-8000-000000000009', 'ee700000-0000-7000-8000-000000000002', 'Foreign');
-- A one-entry tier on the seed event, already full.
insert into public.guest_tiers (id, event_id, name, max_guests)
values ('dd700000-0000-7000-8000-000000000008', 'ee000000-0000-7000-8000-000000000001', 'Booth', 1);
insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('ee000000-0000-7000-8000-000000000001', 'dd700000-0000-7000-8000-000000000008',
        'Booth Taker', 0, '11111111-1111-4111-8111-111111111111', 'landing', 'approved');

-- ---------------------------------------------------------------------------
-- A. Grants + the guest_request_id guard
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.decide_guest_request(uuid, jsonb)', 'EXECUTE'),
  'A1 authenticated may call decide_guest_request');
select ok(not has_function_privilege('anon', 'public.decide_guest_request(uuid, jsonb)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public.decide_guest_request(uuid, jsonb)', 'EXECUTE'),
  'A2 anon and service_role may not');
select ok(has_function_privilege('authenticated', 'public.request_decision_counts(uuid, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.request_decision_counts(uuid, uuid)', 'EXECUTE'),
  'A3 request_decision_counts: authenticated only');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source, status, guest_request_id)
     values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001', 'Forged',
             0, '11111111-1111-4111-8111-111111111111', 'app', 'approved',
             'bb700000-0000-7000-8000-000000000001') $$,
  '42501', null, 'A4 a client insert cannot link a guest to a request');
select throws_ok(
  $$ update public.guests set guest_request_id = 'bb700000-0000-7000-8000-000000000001'
      where full_name = 'Booth Taker' $$,
  '42501', null, 'A5 a client update cannot link an existing guest to a request');
reset role;

-- ---------------------------------------------------------------------------
-- B. The split: Lotte +3 → VIP 1, Regular +1, 1 declined with a note
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (public.decide_guest_request('bb700000-0000-7000-8000-000000000001', jsonb_build_object(
     'approved', jsonb_build_array(
        jsonb_build_object('tier_id', 'dd000000-0000-7000-8000-000000000002', 'plus_ones', 0),
        jsonb_build_object('tier_id', 'dd000000-0000-7000-8000-000000000001', 'plus_ones', 1)),
     'declined', 1,
     'note', '  One spot less, sorry!  ')) -> 'outcome') #>> '{}',
  'partly', 'B1 admin splits +3 over two tiers with one declined: outcome partly');
reset role;

select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000001'), 'approved|2|One spot less, sorry!|2',
  'B2 request approved, approved_plus_ones 2 (3 people), the trimmed note, two guests');
select is(
  (select string_agg(t.name || ':' || g.plus_ones || ':' || coalesce(g.email, '-'), ',' order by (g.email is null), g.id)
     from public.guests g join public.guest_tiers t on t.id = g.tier_id
    where g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'),
  'VIP:0:lotte@example.test,Regular:1:-',
  'B3 one guest per part with the right tier and +N; the first part carries the contact, the second does not');
select ok(
  (select bool_and(g.full_name = 'Lotte Jansen' and g.source = 'landing' and g.status = 'approved'
                   and g.added_by = '11111111-1111-4111-8111-111111111111')
     from public.guests g where g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'),
  'B4 every part is the requester, source landing, approved, added by the approver');
select is(
  (select count(*)::int from public.audit_log a
     join public.guests g on g.id = a.entity_id
    where a.entity_type = 'guests' and a.action = 'create'
      and g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'
      and a.actor_id = '11111111-1111-4111-8111-111111111111'),
  2, 'B5 audit: one create row per guest, on the approver');
select is(
  (select count(*)::int from public.audit_log a
    where a.entity_type = 'guest_requests' and a.action = 'approve'
      and a.entity_id = 'bb700000-0000-7000-8000-000000000001'
      and a.actor_id = '11111111-1111-4111-8111-111111111111'
      and (a.diff -> 'after' ->> 'approved_plus_ones') = '2'
      and (a.diff -> 'after' ->> 'decision_message') = 'One spot less, sorry!'),
  1, 'B6 audit: one approve row on the request with the approved count and the note');
select is(
  (select count(*)::int from public.audit_log a
     join public.guests g on g.id = a.entity_id
    where a.entity_type = 'guests' and a.action = 'create'
      and g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'
      and (a.diff -> 'after' ->> 'guest_request_id') = 'bb700000-0000-7000-8000-000000000001'),
  2, 'B7 each guest audit row names the request it came from');

-- Trim only (one tier): Daan +1 → Regular +0, 1 declined.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (public.decide_guest_request('bb700000-0000-7000-8000-000000000002',
     '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":0}],"declined":1,"note":"Just you this time."}'::jsonb)
   ->> 'outcome'),
  'partly', 'B8 trimming +1 → +0 is a partly approval');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000002'), 'approved|0|Just you this time.|1',
  'B9 trimmed: approved_plus_ones 0, one guest');

-- ---------------------------------------------------------------------------
-- C. Validation (on Robin +2, still pending after each refusal)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":1}],"declined":1}'::jsonb) $$,
  '23514', 'Add a note when you decline (part of) a request.', 'C1 a partial decline without a note is refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":1}],"declined":1,"note":"   "}'::jsonb) $$,
  '23514', 'Add a note when you decline (part of) a request.', 'C2 a whitespace note is no note');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[],"declined":3}'::jsonb) $$,
  '23514', 'Add a note when you decline (part of) a request.', 'C3 a whole decline without a note is refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":5}],"declined":0}'::jsonb) $$,
  '23514', 'The approved and declined people must add up to the request.', 'C4 more people than asked for is refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":0}],"declined":0}'::jsonb) $$,
  '23514', 'The approved and declined people must add up to the request.', 'C5 people left undecided is refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":-1},{"tier_id":"dd000000-0000-7000-8000-000000000002","plus_ones":2}],"declined":0}'::jsonb) $$,
  '22023', null, 'C6 a negative plus_ones is refused (no quota games with sums)');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":3}],"declined":-1,"note":"x"}'::jsonb) $$,
  '22023', null, 'C7 a negative declined count is refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd700000-0000-7000-8000-000000000009","plus_ones":2}],"declined":0}'::jsonb) $$,
  '23514', 'Pick a valid tier for this event.', 'C8 a tier of another company''s event is refused (admin of both)');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":0},{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":1}],"declined":0}'::jsonb) $$,
  '23514', 'Use each tier once.', 'C9 the same tier twice is refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":1.5}],"declined":0.5,"note":"x"}'::jsonb) $$,
  '22023', null, 'C10 fractions are refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       jsonb_build_object('approved', jsonb_build_array(jsonb_build_object('tier_id', 'dd000000-0000-7000-8000-000000000001', 'plus_ones', 0)),
                          'declined', 2, 'note', repeat('a', 281))) $$,
  '23514', 'Keep the note to 280 characters.', 'C11 a note over 280 characters is refused');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003', '"approve"'::jsonb) $$,
  '22023', null, 'C12 a decision that is not an object is refused');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000003'), 'pending|-|-|0',
  'C13 after every refusal Robin is still pending, with no guest');

-- ---------------------------------------------------------------------------
-- D. A cap breach rolls back the whole decision
-- ---------------------------------------------------------------------------

-- Event capacity: room for exactly what is on the list now + 2 people.
update public.events
   set capacity = public.event_capacity_consumption('ee000000-0000-7000-8000-000000000001') + 2
 where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000002","plus_ones":1},{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":0}],"declined":0}'::jsonb) $$,
  '45005', null, 'D1 the second part breaks event capacity: 45005');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000003'), 'pending|-|-|0',
  'D2 ...and the first part (which fitted) is rolled back too: no guest, still pending');
update public.events set capacity = null where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":1},{"tier_id":"dd700000-0000-7000-8000-000000000008","plus_ones":0}],"declined":0}'::jsonb) $$,
  '45002', null, 'D3 a full tier (tier-max) on the second part: 45002');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000003'), 'pending|-|-|0',
  'D4 ...and nothing of the decision survives');

-- ---------------------------------------------------------------------------
-- E. Roles (allowed and denied)
-- ---------------------------------------------------------------------------

select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":2}],"declined":0}'::jsonb) $$,
  '42501', null, 'E1 user_manager cannot decide');
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":2}],"declined":0}'::jsonb) $$,
  '42501', null, 'E2 finance cannot decide');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":2}],"declined":0}'::jsonb) $$,
  '42501', null, 'E3 staff cannot decide');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":2}],"declined":0}'::jsonb) $$,
  '42501', null, 'E4 doorhost cannot decide');
-- A stranger with no membership anywhere (the second venue's only admin is
-- Max, so use a fresh user that admins a company of its own).
reset role;
insert into auth.users (id, email, aud, role)
values ('77777777-7777-4777-8777-777777777777', 'other-admin@example.test', 'authenticated', 'authenticated');
insert into public.user_profiles (id, full_name, email)
values ('77777777-7777-4777-8777-777777777777', 'Other Admin', 'other-admin@example.test')
on conflict (id) do nothing;
insert into public.venues (id, name, slug) values ('aa700000-0000-7000-8000-000000000003', 'Other Club', 'other-club-z8uq');
insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa700000-0000-7000-8000-000000000003', '77777777-7777-4777-8777-777777777777', '{admin}');
select pg_temp.login('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":2}],"declined":0}'::jsonb) $$,
  '42501', null, 'E5 an admin of another company cannot decide');
select pg_temp.login_anon();
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":2}],"declined":0}'::jsonb) $$,
  '42501', null, 'E6 anon cannot call it at all');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000003'), 'pending|-|-|0',
  'E7 none of the refused roles changed anything');

-- The organizer of the event may decide (allowed).
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  (public.decide_guest_request('bb700000-0000-7000-8000-000000000003',
     '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000002","plus_ones":1},{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":0}],"declined":0}'::jsonb)
   ->> 'outcome'),
  'approved', 'E8 the organizer splits Robin +2 over two tiers with nobody declined: approved (no note needed)');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000003'), 'approved|2|-|2',
  'E9 approved for all 3 people over two guests, no note');

-- ---------------------------------------------------------------------------
-- F. Idempotency
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  public.decide_guest_request('bb700000-0000-7000-8000-000000000001', jsonb_build_object(
     'approved', jsonb_build_array(
        jsonb_build_object('tier_id', 'dd000000-0000-7000-8000-000000000002', 'plus_ones', 0),
        jsonb_build_object('tier_id', 'dd000000-0000-7000-8000-000000000001', 'plus_ones', 1)),
     'declined', 1, 'note', 'One spot less, sorry!')) ->> 'replay',
  'true', 'F1 the same split again is a replay');
-- Parts in another order are the same decision.
select is(
  public.decide_guest_request('bb700000-0000-7000-8000-000000000001', jsonb_build_object(
     'approved', jsonb_build_array(
        jsonb_build_object('tier_id', 'dd000000-0000-7000-8000-000000000001', 'plus_ones', 1),
        jsonb_build_object('tier_id', 'dd000000-0000-7000-8000-000000000002', 'plus_ones', 0)),
     'declined', 1, 'note', 'One spot less, sorry!')) -> 'guest_ids',
  (select jsonb_agg(g.id order by (g.email is null), g.id) from public.guests g
    where g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'),
  'F2 a replay returns the guests of the first call');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000001'), 'approved|2|One spot less, sorry!|2',
  'F3 the replays created nothing and changed nothing');
select is(
  (select count(*)::int from public.audit_log a
    where a.entity_type = 'guest_requests' and a.entity_id = 'bb700000-0000-7000-8000-000000000001'),
  1, 'F4 still exactly one decision audit row on the request');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000001',
       '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":3}],"declined":0}'::jsonb) $$,
  '45003', null, 'F5 a different decision on an approved request is 45003');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000001',
       '{"approved":[],"declined":4,"note":"Changed my mind"}'::jsonb) $$,
  '45003', null, 'F6 declining an approved request is 45003 (removal is the guest list''s job)');
reset role;

-- ---------------------------------------------------------------------------
-- G. A whole decline
-- ---------------------------------------------------------------------------

update public.guest_requests set status_token_hash = repeat('e', 64)
 where id = 'bb700000-0000-7000-8000-000000000004';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  public.decide_guest_request('bb700000-0000-7000-8000-000000000004',
    '{"approved":[],"declined":2,"note":"Full tonight, try next week."}'::jsonb),
  '{"outcome":"declined","guest_ids":[],"replay":false}'::jsonb,
  'G1 declining everyone: outcome declined, no guests');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000004'), 'denied|-|Full tonight, try next week.|0',
  'G2 denied, note stored as the guest-facing message, no guest');
select is(
  (select count(*)::int from public.audit_log a
    where a.entity_type = 'guest_requests' and a.action = 'deny'
      and a.entity_id = 'bb700000-0000-7000-8000-000000000004'
      and (a.diff -> 'after' ->> 'decision_message') = 'Full tonight, try next week.'),
  1, 'G3 audit: one deny row with the note');
select is(
  public.get_request_status(repeat('e', 64), 'g-test') ->> 'decision_message',
  'Full tonight, try next week.', 'G4 the status page shows the note on a declined request (own token)');
select ok(
  (public.get_request_status(repeat('e', 64), 'g-test') -> 'approved_plus_ones') = 'null'::jsonb,
  'G5 ...but no confirmed count');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  public.decide_guest_request('bb700000-0000-7000-8000-000000000004',
    '{"approved":[],"declined":2,"note":"Full tonight, try next week."}'::jsonb) ->> 'replay',
  'true', 'G6 the same decline again is a replay');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000004',
       '{"approved":[],"declined":2,"note":"Another reason"}'::jsonb) $$,
  '45003', null, 'G7 a decline with another note is 45003');
-- #12: a declined request can still be added after all.
select is(
  public.decide_guest_request('bb700000-0000-7000-8000-000000000004',
    '{"approved":[{"tier_id":"dd000000-0000-7000-8000-000000000001","plus_ones":1}],"declined":0}'::jsonb) ->> 'outcome',
  'approved', 'G8 a declined request can be approved after all (#12)');
reset role;
select is(pg_temp.req_state('bb700000-0000-7000-8000-000000000004'), 'approved|1|-|1',
  'G9 re-approved: approved, one guest, the decline note cleared');

-- ---------------------------------------------------------------------------
-- H. Stats: the declined part counts as declined
-- ---------------------------------------------------------------------------
-- Our six requests only (the seed has three more on the same event): Lotte
-- 4 asked → 3 approved + 1 declined; Daan 2 → 1 + 1; Robin 3 → 3; Esra 2 → 2
-- (re-approved); Pim 1 waiting; Sem 3 waiting.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select requested_heads || '|' || approved_heads || '|' || declined_heads || '|' || waiting_heads
     from public.request_decision_counts('aa000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001'))
  ,
  (select (sum(1 + plus_ones))::text || '|'
          || (sum(case when status = 'approved' then 1 + coalesce(approved_plus_ones, plus_ones) else 0 end))::text || '|'
          || (sum(case when status = 'approved' then plus_ones - coalesce(approved_plus_ones, plus_ones)
                       when status = 'denied' then 1 + plus_ones else 0 end))::text || '|'
          || (sum(case when status = 'pending' then 1 + plus_ones else 0 end))::text
     from public.guest_requests where event_id = 'ee000000-0000-7000-8000-000000000001'),
  'H1 the admin''s counts equal the per-request rule over every request of the event');
reset role;
select is(
  (select sum(plus_ones - approved_plus_ones)::int from public.guest_requests
    where id in ('bb700000-0000-7000-8000-000000000001', 'bb700000-0000-7000-8000-000000000002')),
  2, 'H2 the two partly approved requests carry exactly their 2 declined people');
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select requested_heads + approved_heads + declined_heads + waiting_heads
     from public.request_decision_counts('aa000000-0000-7000-8000-000000000001')),
  0::bigint, 'H3 staff (no request access under RLS) sees zeros');
reset role;

-- ---------------------------------------------------------------------------
-- I. The decision mail: one queue row per decision, never "You're on the list"
-- ---------------------------------------------------------------------------
-- The action queues after the RPC: partly/approved on the FIRST guest
-- (guest_ids[0], the one with the address), declined on the request. Done
-- here as the action's service client does it.
select pg_temp.login_service();
select isnt(
  public.enqueue_guest_mail(
    (select g.id from public.guests g where g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'
      order by (g.email is null), g.id limit 1),
    'guest_request_partly', 'One spot less, sorry!', '11111111-1111-4111-8111-111111111111', 0,
    'bb700000-0000-7000-8000-000000000001'),
  null, 'I1 the partly mail queues on the first part of the split');
select is(
  public.enqueue_guest_mail(
    (select g.id from public.guests g where g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'
      order by (g.email is null), g.id offset 1 limit 1),
    'guest_request_partly', 'One spot less, sorry!', '11111111-1111-4111-8111-111111111111', 0,
    'bb700000-0000-7000-8000-000000000001'),
  null, 'I2 the second part has no address, so it can never get a second mail');
reset role;
select is(
  (select string_agg(q.type, ',') from public.guest_mail_queue q
     join public.guests g on g.id = q.guest_id
    where g.guest_request_id = 'bb700000-0000-7000-8000-000000000001'),
  'guest_request_partly', 'I3 exactly one mail row for the split, and it is not guest_on_list');

-- Whole decline of Sem (no address) and Pim (address): the declined mail.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  public.decide_guest_request('bb700000-0000-7000-8000-000000000005',
    '{"approved":[],"declined":1,"note":"Sorry, we are full."}'::jsonb) ->> 'outcome',
  'declined', 'I4 Pim declined');
reset role;
select pg_temp.login_service();
select isnt(
  public.enqueue_request_declined_mail('bb700000-0000-7000-8000-000000000005', 'Sorry, we are full.',
    '11111111-1111-4111-8111-111111111111'),
  null, 'I5 the decline mail queues for a request the RPC declined');
reset role;
select is(
  (select count(*)::int from public.guest_mail_queue q
    where q.guest_request_id = 'bb700000-0000-7000-8000-000000000005'),
  1, 'I6 one decline mail row');

-- Auto-approve link: the submission queues the approval mail itself.
update public.request_links set max_headcount = null where id = '2c000000-0000-7000-8000-000000000001';
select pg_temp.login_anon();
select is(
  public.submit_guest_request('launch-night-jayden', 'Noa Auto', 'noa.auto@example.test', '+31611111111',
    1, '', 'i-test-ip', false) ->> 'auto_approved',
  'true', 'I7 an auto-approve link puts Noa on the list');
reset role;
select is(
  (select g.guest_request_id is not null and g.guest_request_id = r.id
     from public.guests g join public.guest_requests r on r.event_id = g.event_id and r.email = g.email
    where g.email = 'noa.auto@example.test'),
  true, 'I8 the auto-approved guest is linked to its request');
select is(
  (select string_agg(q.type || ':' || (q.source_request_id is not null)::text, ',')
     from public.guest_mail_queue q join public.guests g on g.id = q.guest_id
    where g.email = 'noa.auto@example.test'),
  'guest_request_approved:true', 'I9 exactly one approval mail queued, naming its request (no "You''re on the list")');


-- ---------------------------------------------------------------------------
-- J. The claim: one payload per decision, naming every part (option a)
-- ---------------------------------------------------------------------------
-- Guest mail waits for a company contact address; give Club Vesper one, then
-- claim as the job does (service_role) and read our rows' payloads.
update public.venues set contact_email = 'guests@clubvesper.test'
 where id = 'aa000000-0000-7000-8000-000000000001';
create temp table j_claim as
  select m as mail from jsonb_array_elements(
    (select public.guest_mails_claim(500)) -> 'mails') as m;
select is(
  (select count(*)::int from j_claim c
    where c.mail ->> 'to' = 'lotte@example.test'),
  1, 'J1 the split decision gives exactly one claimed mail');
select is(
  (select c.mail -> 'tiers' from j_claim c where c.mail ->> 'to' = 'lotte@example.test'),
  '[{"tier_name":"VIP","people":1,"price_cents":null},{"tier_name":"Regular","people":2,"price_cents":null}]'::jsonb,
  'J2 ...whose tiers list both parts: VIP 1 person (the part with the address first), Regular 2 people');
select is(
  (select (c.mail ->> 'asked_people')::int from j_claim c where c.mail ->> 'to' = 'lotte@example.test'),
  4, 'J3 ...and the asked-for 4 people, so the partly mail reads "3 of 4"');
select is(
  (select jsonb_array_length(c.mail -> 'tiers') from j_claim c where c.mail ->> 'to' = 'noa.auto@example.test'),
  1, 'J4 a decision that was not split (the auto-approval) has tiers of length 1');

-- ---------------------------------------------------------------------------
-- K. The note is mandatory in the database, on every path (review S1/S2)
-- ---------------------------------------------------------------------------
select ok(
  public.request_note_is_blank(null) and public.request_note_is_blank(E'​')
  and public.request_note_is_blank(chr(1) || chr(127)) and public.request_note_is_blank(E'‮⁦  \t')
  and public.request_note_is_blank(E'﻿') and not public.request_note_is_blank(E'Hi​'),
  'K1 request_note_is_blank: zero-width, control, bidi, NBSP and BOM only are blank; real text is not');

select pg_temp.new_request('bb700000-0000-7000-8000-000000000007', 'Zero Width', 1, 'zw@example.test');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000007',
       jsonb_build_object('approved', jsonb_build_array(jsonb_build_object(
         'tier_id', 'dd000000-0000-7000-8000-000000000001', 'plus_ones', 0)), 'declined', 1,
         'note', E'​‌')) $$,
  '23514', 'Add a note when you decline (part of) a request.', 'K2 a zero-width-only note is no note (partial decline)');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000007',
       jsonb_build_object('approved', '[]'::jsonb, 'declined', 2, 'note', chr(1) || chr(127))) $$,
  '23514', 'Add a note when you decline (part of) a request.', 'K3 a control-character-only note is no note (whole decline)');
select throws_ok(
  $$ select public.decide_guest_request('bb700000-0000-7000-8000-000000000007',
       jsonb_build_object('approved', '[]'::jsonb, 'declined', 2, 'note', E'‮⁦ ')) $$,
  '23514', 'Add a note when you decline (part of) a request.', 'K4 a bidi/NBSP-only note is no note');
-- approve_guest_request (the other SECURITY DEFINER path): a trim without a
-- message is a partial decline, so it needs a note too.
select throws_ok(
  $$ select public.approve_guest_request('bb700000-0000-7000-8000-000000000007',
       'dd000000-0000-7000-8000-000000000001', 0) $$,
  '23514', 'Add a note when you decline (part of) a request.', 'K5 approve_guest_request: a trim without a message is refused');
select lives_ok(
  $$ select public.approve_guest_request('bb700000-0000-7000-8000-000000000007',
       'dd000000-0000-7000-8000-000000000001') $$,
  'K6 approve_guest_request: a plain approval as requested still needs no note (the cockpit path)');
reset role;
-- The CHECK: even the owner cannot store an invisible note.
select throws_ok(
  $$ update public.guest_requests set decision_message = E'​'
      where id = 'bb700000-0000-7000-8000-000000000007' $$,
  '23514', null, 'K7 CHECK: an invisible note cannot be stored, even by the owner');
-- Expand–contract: a decline from before the rule (no note) stays valid and
-- can still be touched by anything that does not re-decide it.
insert into public.guest_requests (id, event_id, full_name, plus_ones, status, decided_by, decided_at, decision_reason)
values ('bb700000-0000-7000-8000-000000000008', 'ee000000-0000-7000-8000-000000000001',
        'Legacy Decline', 0, 'denied', '11111111-1111-4111-8111-111111111111', now(), 'internal');
select lives_ok(
  $$ update public.guest_requests set decision_reason = null, full_name = 'Aanvraag #9'
      where id = 'bb700000-0000-7000-8000-000000000008' $$,
  'K8 a legacy decline without a note stays valid (retention-style update passes)');

-- ---------------------------------------------------------------------------
-- L. Later mails to a split guest name every part too (review S3)
-- ---------------------------------------------------------------------------
select pg_temp.login_service();
select ok(
  public.enqueue_event_mail('ee000000-0000-7000-8000-000000000001', 'guest_reminder', null,
    '11111111-1111-4111-8111-111111111111', 0) > 0,
  'L1 a reminder is queued for the event');
reset role;
create temp table l_claim as
  select m as mail from jsonb_array_elements(
    (select public.guest_mails_claim(500)) -> 'mails') as m;
select is(
  (select c.mail -> 'tiers' from l_claim c
    where c.mail ->> 'to' = 'lotte@example.test' and c.mail ->> 'type' = 'guest_reminder'),
  '[{"tier_name":"VIP","people":1,"price_cents":null},{"tier_name":"Regular","people":2,"price_cents":null}]'::jsonb,
  'L2 the reminder to the split guest lists both parts (S3)');
select is(
  (select jsonb_array_length(c.mail -> 'tiers') from l_claim c
    where c.mail ->> 'to' = 'noa.auto@example.test' and c.mail ->> 'type' = 'guest_reminder'),
  1, 'L3 the reminder to a guest whose request was not split: tiers of length 1');

select * from finish();
rollback;
