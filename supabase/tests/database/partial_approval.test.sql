-- pgTAP — partial approval + the venue message on /r/[token] (z8uq9m0hw6).
-- Run: pnpm db:test.
--
-- Proves, per role, that approve_guest_request:
--   * approves for FEWER plus-ones, never more, never negative (23514), and a
--     rejected attempt leaves no guest behind;
--   * still resolves the deployed app's 2-arg call, with exactly ONE function
--     of that name (no overload → no PostgREST PGRST203 ambiguity);
--   * charges event capacity (45005) and link-max (45006) with the APPROVED
--     head count, not the requested one (tier-max stays an ENTRY count: one
--     slot per party, reduced or not);
--   * caps the message (280), stores whitespace-only (incl. \f / \x0B) as no
--     message, and settles every CHECK rule before the guest insert;
--   * checks the role before it locks the row or reveals the status;
--   * refuses an anonymized request (P0002);
-- that clients cannot write the counts or the message around the RPC; that
-- get_request_status hands the new fields to a valid token only, per state,
-- and never the count, message or address to a mirror; and that retention
-- (#29) wipes the message and the deny reason from every anonymized request
-- and its audit diffs, backfilling earlier runs, idempotently.
--
-- Seed: venue aa..01 Club Vesper (Wibautstraat 150, 1091 GR Amsterdam) with
-- admin 11.., user_manager 22.., finance 33.., staff 55.., doorhost 66..;
-- organizer 44.. organizes event ee..01 (slug plusone-launch-night, tier dd..01
-- Regular). Venue aa..02 is the "other venue". All rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
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

-- Sorted key list of a jsonb object — "same payload shape" comparisons.
create function pg_temp.keys(p jsonb)
returns text language sql as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k;
$fn$;

select plan(74);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner, RLS bypassed — like the seed)
-- ---------------------------------------------------------------------------

-- A cross-venue admin: user_manager 22.. becomes ADMIN of venue 2 only. At
-- venue 1 she holds user_manager, which cannot approve either.
insert into public.venue_memberships (venue_id, user_id, roles)
values ('aa000000-0000-7000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '{admin}')
on conflict (venue_id, user_id) do update set roles = '{admin}';

-- Requests on the seed event (the organizer's event), each with its own token.
insert into public.guest_requests (id, event_id, full_name, email, phone, plus_ones, status_token_hash) values
  ('9a000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
   'Validation Vera', 'vera@pa.test', '+31611700001', 2, 'tok-pa-vera'),
  ('9a000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
   'Partial Pia', 'pia@pa.test', '+31611700002', 4, 'tok-pa-pia'),
  ('9a000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
   'Legacy Lars', 'lars@pa.test', '+31611700003', 2, 'tok-pa-lars'),
  ('9a000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-000000000001',
   'Guard Gijs', 'gijs@pa.test', '+31611700004', 3, 'tok-pa-gijs'),
  ('9a000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-000000000001',
   'Denied Dirk', 'dirk@pa.test', '+31611700005', 1, 'tok-pa-dirk'),
  ('9a000000-0000-7000-8000-000000000006', 'ee000000-0000-7000-8000-000000000001',
   'Blank Bo', 'bo@pa.test', '+31611700006', 1, 'tok-pa-bo'),
  ('9a000000-0000-7000-8000-000000000031', 'ee000000-0000-7000-8000-000000000001',
   'Feed Fien', 'fien@pa.test', '+31611700041', 0, 'tok-pa-fien'),
  ('9a000000-0000-7000-8000-000000000032', 'ee000000-0000-7000-8000-000000000001',
   'Trim Tom', 'trim@pa.test', '+31611700042', 0, 'tok-pa-trim');

-- Accounting fixtures: an event with a max-3 tier and a 3-head link, and an
-- event with a total capacity of 3. Each request asks for 1 + 4 = 5 people.
insert into public.events (id, venue_id, name, starts_at, ends_at, landing_slug, capacity) values
  ('9e000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
   'PA Caps Night', now() + interval '9 days', now() + interval '9 days 6 hours', 'pa-caps-night', null),
  ('9e000000-0000-7000-8000-000000000002', 'aa000000-0000-7000-8000-000000000001',
   'PA Capacity Night', now() + interval '10 days', now() + interval '10 days 6 hours', 'pa-capacity-night', 3);
insert into public.guest_tiers (id, event_id, name, max_guests) values
  ('9d000000-0000-7000-8000-000000000001', '9e000000-0000-7000-8000-000000000001', 'Small', 3),
  ('9d000000-0000-7000-8000-000000000002', '9e000000-0000-7000-8000-000000000001', 'Open', null),
  ('9d000000-0000-7000-8000-000000000003', '9e000000-0000-7000-8000-000000000002', 'Open', null);
insert into public.request_links (id, event_id, venue_id, label, slug, max_headcount) values
  ('9c000000-0000-7000-8000-000000000001', '9e000000-0000-7000-8000-000000000001',
   'aa000000-0000-7000-8000-000000000001', 'PA capped link', 'pa-capped-link', 3);
insert into public.guest_requests (id, event_id, full_name, email, phone, plus_ones, request_link_id) values
  ('9a000000-0000-7000-8000-000000000011', '9e000000-0000-7000-8000-000000000001',
   'Tier Tess', 'tess@pa.test', '+31611700011', 4, null),
  ('9a000000-0000-7000-8000-000000000012', '9e000000-0000-7000-8000-000000000001',
   'Link Lotte', 'lotte@pa.test', '+31611700012', 4, '9c000000-0000-7000-8000-000000000001'),
  ('9a000000-0000-7000-8000-000000000013', '9e000000-0000-7000-8000-000000000002',
   'Cap Cas', 'cas@pa.test', '+31611700013', 4, null);

-- ---------------------------------------------------------------------------
-- A. One function, the deployed 2-arg call still resolves (expand–contract)
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc
    where proname = 'approve_guest_request' and pronamespace = 'public'::regnamespace),
  1, 'A1 exactly one approve_guest_request exists — no overload for PostgREST to trip over (PGRST203)');
select is(
  (select pg_get_function_identity_arguments(p.oid) || ' / defaults=' || p.pronargdefaults
     from pg_proc p
    where p.proname = 'approve_guest_request' and p.pronamespace = 'public'::regnamespace),
  'p_request_id uuid, p_tier_id uuid, p_plus_ones integer, p_message text / defaults=2',
  'A2 the two new params are trailing and DEFAULTed');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p
    where p.proname = 'approve_guest_request' and p.pronamespace = 'public'::regnamespace),
  'A3 still SECURITY DEFINER with an empty search_path');
select ok(
  has_function_privilege('authenticated', 'public.approve_guest_request(uuid,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.approve_guest_request(uuid,uuid,integer,text)', 'EXECUTE'),
  'A4 the recreated function keeps the grant matrix: authenticated yes, anon no');

select pg_temp.login('11111111-1111-4111-8111-111111111111');   -- admin
select isnt(
  public.approve_guest_request(p_request_id => '9a000000-0000-7000-8000-000000000003',
                               p_tier_id    => 'dd000000-0000-7000-8000-000000000001'),
  null, 'A5 the deployed app''s call (only p_request_id + p_tier_id, by name as PostgREST sends them) still approves');
reset role;
select is(
  (select g.plus_ones::text || '|' || gr.plus_ones::text || '|' || gr.approved_plus_ones::text
          || '|' || coalesce(gr.decision_message, '<null>')
     from public.guest_requests gr
     join public.guests g on g.event_id = gr.event_id and g.email = gr.email
    where gr.id = '9a000000-0000-7000-8000-000000000003'),
  '2|2|2|<null>', 'A6 ...as requested: guest +2, request +2, approved +2 recorded, no message');

-- ---------------------------------------------------------------------------
-- B. Validation — never above the request, never negative, message capped
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000001',
       'dd000000-0000-7000-8000-000000000001', 3, null) $$,
  '23514', null, 'B1 approving MORE plus-ones than requested (+3 of +2) is rejected');
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000001',
       'dd000000-0000-7000-8000-000000000001', -1, null) $$,
  '23514', null, 'B2 a negative plus-ones count is rejected');
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000001',
       'dd000000-0000-7000-8000-000000000001', 1, repeat('x', 281)) $$,
  '23514', null, 'B3 a 281-character message is rejected (cap 280)');
reset role;
select is(
  (select status::text || '|' || (select count(*) from public.guests where email = 'vera@pa.test')::text
     from public.guest_requests where id = '9a000000-0000-7000-8000-000000000001'),
  'pending|0', 'B4 the rejected attempts left the request pending and created no guest');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000001',
       'dd000000-0000-7000-8000-000000000001', 0, repeat('y', 280)) $$,
  'B5 +0 of +2 with a message of exactly 280 characters is accepted (both bounds inclusive)');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000006',
       'dd000000-0000-7000-8000-000000000001', null, E'  \n\t ') $$,
  'B6 a whitespace-only message is accepted...');
reset role;
select is(
  (select coalesce(decision_message, '<null>') from public.guest_requests
    where id = '9a000000-0000-7000-8000-000000000006'),
  '<null>', 'B7 ...and stored as no message at all');
-- Review L3: the RPC must settle every CHECK rule BEFORE the guest insert. A
-- form feed / vertical tab used to survive the trim, pass the RPC and then
-- fail the CHECK mid-approval (a 23514 whose DETAIL echoes the row).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000031',
       'dd000000-0000-7000-8000-000000000001', null, E'\f\x0B \f') $$,
  'B7a a message of only form feeds / vertical tabs approves cleanly (no CHECK violation)...');
reset role;
select is(
  (select coalesce(decision_message, '<null>') || '|' || status::text from public.guest_requests
    where id = '9a000000-0000-7000-8000-000000000031'),
  '<null>|approved', 'B7b ...and is stored as no message');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000032',
       'dd000000-0000-7000-8000-000000000001', null, E'\f  See you at 23:00. \x0B') $$,
  'B7c a real message wrapped in form feeds approves...');
reset role;
select is(
  (select decision_message from public.guest_requests where id = '9a000000-0000-7000-8000-000000000032'),
  'See you at 23:00.', 'B7d ...trimmed with the same whitespace set as submit_guest_request');
select is(
  (select plus_ones from public.guests where email = 'vera@pa.test'),
  0, 'B8 the +0 approval put a party of one on the list');

-- ---------------------------------------------------------------------------
-- C. Permissions — who may approve a reduced request, per role
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 2, 'hi') $$,
  '42501', null, 'C1 anon cannot call the RPC at all (no EXECUTE grant)');
select pg_temp.login('55555555-5555-4555-8555-555555555555');   -- staff
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 2, 'hi') $$,
  '42501', null, 'C2 staff cannot approve');
select pg_temp.login('66666666-6666-4666-8666-666666666666');   -- doorhost (+staff)
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 2, 'hi') $$,
  '42501', null, 'C3 a doorhost cannot approve');
select pg_temp.login('22222222-2222-4222-8222-222222222222');   -- admin of venue 2 only
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 2, 'hi') $$,
  '42501', null, 'C4 an admin of ANOTHER venue cannot approve here');
select pg_temp.login('55555555-5555-4555-8555-555555555555');   -- staff, probing the bounds
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 99, null) $$,
  '42501', null, 'C5 an outsider gets the role error, not the bounds error — the requested count does not leak');
reset role;
select is(
  (select status::text from public.guest_requests where id = '9a000000-0000-7000-8000-000000000002'),
  'pending', 'C6 none of the refused callers changed the request');

select pg_temp.login('44444444-4444-4444-8444-444444444444');   -- organizer of this event
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 2, '  We could fit three of you. See you at 23:00.  ') $$,
  'C7 the event organizer approves +2 of +4 with a message');
reset role;
select is(
  (select g.plus_ones::text || '|' || g.source::text from public.guests g where g.email = 'pia@pa.test'),
  '2|landing', 'C8 the guest row carries the APPROVED +2 (source landing, #31)');
select is(
  (select plus_ones::text || '|' || approved_plus_ones::text || '|' || decision_message
     from public.guest_requests where id = '9a000000-0000-7000-8000-000000000002'),
  '4|2|We could fit three of you. See you at 23:00.',
  'C9 the request keeps the REQUESTED +4, records the approved +2 and the trimmed message');
select ok(
  (select (diff -> 'after' ->> 'approved_plus_ones') = '2'
          and (diff -> 'after' ->> 'decision_message') = 'We could fit three of you. See you at 23:00.'
          and actor_id = '44444444-4444-4444-8444-444444444444'
     from public.audit_log
    where entity_type = 'guest_requests' and entity_id = '9a000000-0000-7000-8000-000000000002'
      and action = 'approve'),
  'C10 the approve audit diff (trigger-written) carries the approved count, the message and the organizer');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 1, null) $$,
  '45003', null, 'C11 an approved request cannot be approved again (e.g. to move the count)');
-- Review L4: the role check runs before the row lock and the status check, so
-- an outsider neither locks somebody else's request nor learns it is decided.
select pg_temp.login('55555555-5555-4555-8555-555555555555');   -- staff
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000002',
       'dd000000-0000-7000-8000-000000000001', 1, null) $$,
  '42501', null, 'C12 an outsider on an ALREADY-approved request gets the role error, not 45003');
reset role;

-- ---------------------------------------------------------------------------
-- D. Accounting charges the APPROVED count
-- ---------------------------------------------------------------------------

-- Tier-max is an ENTRY count (guest_tier_contribution = 1 per live guest row),
-- not a head count: a party takes one tier slot whatever its plus-ones. So a
-- partial approval neither helps nor hurts the tier — pinned here so nobody
-- "fixes" the approval to charge the tier per head.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000011',
       '9d000000-0000-7000-8000-000000000001', 2) $$,
  'D1 +2 of +4 into a tier with max 3');
select is(
  (select used::int from public.event_tier_occupancy('9e000000-0000-7000-8000-000000000001')
    where tier_id = '9d000000-0000-7000-8000-000000000001'),
  1, 'D2 tier-max counts entries: the party takes ONE tier slot, reduced or not');

select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000012',
       '9d000000-0000-7000-8000-000000000002') $$,
  '45006', null, 'D3 link-max: 5 people through a 3-head link is refused');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000012',
       '9d000000-0000-7000-8000-000000000002', 2) $$,
  'D4 ...the same request approved for 3 people fits');
reset role;
select is(
  public.request_link_consumption('9c000000-0000-7000-8000-000000000001'),
  3, 'D5 the link is charged 3 heads');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000013',
       '9d000000-0000-7000-8000-000000000003') $$,
  '45005', null, 'D6 capacity: 5 people into a 3-capacity event is refused');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000013',
       '9d000000-0000-7000-8000-000000000003', 2) $$,
  'D7 ...the same request approved for 3 people fits exactly');
reset role;
select is(
  public.event_capacity_consumption('9e000000-0000-7000-8000-000000000002'),
  3, 'D8 the event capacity is charged 3 heads');

-- ---------------------------------------------------------------------------
-- E. Clients cannot write the counts or the message around the RPC
-- ---------------------------------------------------------------------------

-- E1 is the realistic bypass: the deny write passes guest_requests_decide and
-- the status CHECK, and "Approve anyway" then works on a denied request — so
-- without the guard an admin could deny with plus_ones = 20 and approve +20.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.guest_requests
        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
            decided_at = now(), decision_reason = 'x', plus_ones = 20
      where id = '9a000000-0000-7000-8000-000000000004' $$,
  '42501', null, 'E1 an admin cannot rewrite the REQUESTED count (e.g. deny with +20, then "approve anyway" within it)');
select throws_ok(
  $$ update public.guest_requests
        set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now(),
            decision_message = 'hand-written', approved_plus_ones = 1
      where id = '9a000000-0000-7000-8000-000000000004' $$,
  '42501', null, 'E2 an admin cannot PATCH a message or approved count onto a request directly');
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Vol'
                      where id = '9a000000-0000-7000-8000-000000000005' and status = 'pending' $$),
  1, 'E3 the deny path (status/decided_by/decided_at/decision_reason) is untouched by the guard');
reset role;

-- The CHECKs hold even for the owner (a future SECURITY DEFINER path).
select throws_ok(
  $$ update public.guest_requests set approved_plus_ones = 5
      where id = '9a000000-0000-7000-8000-000000000002' $$,
  '23514', null, 'E4 CHECK: the approved count can never exceed the requested count');
select throws_ok(
  $$ update public.guest_requests set decision_message = 'nope'
      where id = '9a000000-0000-7000-8000-000000000004' $$,
  '23514', null, 'E5 CHECK: a pending request cannot carry a venue message');
select throws_ok(
  $$ update public.guest_requests set decision_message = repeat('z', 281)
      where id = '9a000000-0000-7000-8000-000000000002' $$,
  '23514', null, 'E6 CHECK: the message cap holds in the table too');

-- ---------------------------------------------------------------------------
-- F. get_request_status — the new fields go to a valid token only, per state
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  public.get_request_status('tok-pa-does-not-exist', 'ip-pa-f1'),
  '{"found": false}'::jsonb, 'F1 an unknown token still gets exactly {"found": false}: no event, no venue, no time');

select ok(
  (select r ->> 'status' = 'approved'
          and r ->> 'plus_ones' = '4'
          and r ->> 'approved_plus_ones' = '2'
          and r ->> 'decision_message' = 'We could fit three of you. See you at 23:00.'
          and r ->> 'venue_address_line' = 'Wibautstraat 150'
          and r ->> 'venue_postal_code' = '1091 GR'
          and r ->> 'venue_city' = 'Amsterdam'
          and r ->> 'ends_at' is not null
     from public.get_request_status('tok-pa-pia', 'ip-pa-f2') r),
  'F2 reduced approval: requested +4, approved +2, the message, the venue address and the end time');
select ok(
  (select r ->> 'approved_plus_ones' = '2' and r ->> 'plus_ones' = '2' and r ->> 'decision_message' is null
          and r ->> 'venue_address_line' = 'Wibautstraat 150'
     from public.get_request_status('tok-pa-lars', 'ip-pa-f3') r),
  'F3 approval as requested: the confirmed count equals the request, no message, the address');
select ok(
  (select r ->> 'status' = 'pending'
          and r ->> 'approved_plus_ones' is null and r ->> 'decision_message' is null
          and r ->> 'venue_address_line' is null and r ->> 'venue_postal_code' is null
          and r ->> 'venue_city' is null and r ->> 'ends_at' is not null
     from public.get_request_status('tok-pa-gijs', 'ip-pa-f4') r),
  'F4 pending: the times, but no address, no count, no message');
select ok(
  (select r ->> 'status' = 'denied'
          and r ->> 'venue_address_line' is null and r ->> 'decision_message' is null
          and not (r ? 'decision_reason')
     from public.get_request_status('tok-pa-dirk', 'ip-pa-f5') r),
  'F5 denied: no address, no message, and the deny reason stays internal');
select is(
  pg_temp.keys(public.get_request_status('tok-pa-gijs', 'ip-pa-f6')),
  pg_temp.keys(public.get_request_status('tok-pa-pia', 'ip-pa-f6')),
  'F6 every found payload has the SAME key set (absent = null), so a key''s presence says nothing');
select ok(
  not (public.get_request_status('tok-pa-pia', 'ip-pa-f7')
       ?| array['email', 'phone', 'motivation', 'decision_reason', 'venue_name', 'dedupe_key']),
  'F7 still no contact data, motivation or deny reason in the payload');
reset role;

-- Mirror: a second, silently deduped submission on the same e-mail.
select pg_temp.login_anon();
select is(
  public.submit_guest_request('plusone-launch-night', 'Mirror Maud', 'maud@pa.test',
    '+31611700021', 3, null, 'ip-pa-m1', false, null, 'tok-pa-maud') ->> 'status',
  'ok', 'F8 the original submission');
select is(
  public.submit_guest_request('plusone-launch-night', 'Stranger Sid', 'maud@pa.test',
    '+31611700022', 1, null, 'ip-pa-m2', false, null, 'tok-pa-sid') ->> 'status',
  'ok', 'F9 a second submission on the same e-mail is silently deduped (a mirror)');
select is(
  public.get_request_status('tok-pa-sid', 'ip-pa-m3') - 'full_name' - 'plus_ones',
  public.get_request_status('tok-pa-maud', 'ip-pa-m3') - 'full_name' - 'plus_ones',
  'F10 before a decision, fresh and mirrored payloads are identical apart from each caller''s own name and count');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request(
       (select id from public.guest_requests where email = 'maud@pa.test'),
       'dd000000-0000-7000-8000-000000000001', 1, 'For Maud only: ask for Joeri.') $$,
  'F11 the admin approves Maud for +1 of +3 with a personal message');
select pg_temp.login_anon();
select ok(
  (select r ->> 'decision_message' = 'For Maud only: ask for Joeri.' and r ->> 'approved_plus_ones' = '1'
     from public.get_request_status('tok-pa-maud', 'ip-pa-m4') r),
  'F12 Maud''s own token shows her message and approved count');
select ok(
  (select r ->> 'status' = 'approved'
          and r ->> 'full_name' = 'Stranger Sid'
          and r ->> 'decision_message' is null
          and r ->> 'approved_plus_ones' is null
          and r ->> 'venue_address_line' is null
          and r ->> 'venue_postal_code' is null
          and r ->> 'venue_city' is null
     from public.get_request_status('tok-pa-sid', 'ip-pa-m4') r),
  'F13 the mirror token NEVER gets the message, the confirmed count or the venue address (review L1)');
select is(
  pg_temp.keys(public.get_request_status('tok-pa-sid', 'ip-pa-m5')),
  pg_temp.keys(public.get_request_status('tok-pa-maud', 'ip-pa-m5')),
  'F14 ...and still carries the same key set as a fresh token');

-- The throttle is untouched: a burnt window turns a valid token into not-found.
do $$
begin
  for i in 1..30 loop
    perform public.get_request_status('pa-probe-' || i, 'ip-pa-rl');
  end loop;
end $$;
select is(
  public.get_request_status('tok-pa-pia', 'ip-pa-rl'),
  '{"found": false}'::jsonb, 'F15 past the throttle window a VALID approved token gets {"found": false} too');
reset role;

-- ---------------------------------------------------------------------------
-- G. Retention: the message is free text and expires with the request (#29)
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, ends_at, landing_slug) values
  ('9e000000-0000-7000-8000-000000000009', 'aa000000-0000-7000-8000-000000000001',
   'PA Old Night', now() - interval '14 months', now() - interval '14 months' + interval '6 hours',
   'pa-old-night');
insert into public.guest_tiers (id, event_id, name) values
  ('9d000000-0000-7000-8000-000000000009', '9e000000-0000-7000-8000-000000000009', 'Old');
insert into public.guest_requests (id, event_id, full_name, email, phone, plus_ones, status_token_hash) values
  ('9a000000-0000-7000-8000-000000000009', '9e000000-0000-7000-8000-000000000009',
   'Old Olga', 'olga@pa.test', '+31611700009', 2, 'tok-pa-olga');

-- Dana and Lou: live requests on the old event, anonymized by THIS run.
insert into public.guest_requests (id, event_id, full_name, email, phone, plus_ones) values
  ('9a000000-0000-7000-8000-000000000021', '9e000000-0000-7000-8000-000000000009',
   'Deny Dana', 'dana@pa.test', '+31611700031', 1),
  ('9a000000-0000-7000-8000-000000000022', '9e000000-0000-7000-8000-000000000009',
   'Late Lou', 'lou@pa.test', '+31611700032', 1);

-- Pete and Mia: anonymized by an EARLIER run (the pre-migration job), still
-- carrying free text it never reached — Pete a deny reason (a deny written
-- after anonymization, or the old job's audit diff), Mia a message written
-- after anonymization (the gap approve_guest_request now closes). The audit
-- rows are the shape audit_guest_requests writes.
insert into public.guest_requests
  (id, event_id, full_name, plus_ones, status, decided_by, decided_at,
   decision_reason, approved_plus_ones, decision_message, anonymized_at) values
  ('9a000000-0000-7000-8000-000000000023', '9e000000-0000-7000-8000-000000000009',
   'Aanvraag #7', 1, 'denied', '11111111-1111-4111-8111-111111111111', now(),
   'Pete old reason', null, null, now() - interval '30 days'),
  ('9a000000-0000-7000-8000-000000000024', '9e000000-0000-7000-8000-000000000009',
   'Aanvraag #8', 1, 'approved', '11111111-1111-4111-8111-111111111111', now(),
   null, 0, 'Mia late note', now() - interval '30 days');
insert into public.audit_log (actor_id, venue_id, event_id, entity_type, entity_id, action, diff) values
  ('11111111-1111-4111-8111-111111111111', 'aa000000-0000-7000-8000-000000000001',
   '9e000000-0000-7000-8000-000000000009', 'guest_requests', '9a000000-0000-7000-8000-000000000023', 'deny',
   '{"before": {"status": "pending", "decision_reason": null}, "after": {"status": "denied", "decision_reason": "Pete old reason"}}'),
  ('11111111-1111-4111-8111-111111111111', 'aa000000-0000-7000-8000-000000000001',
   '9e000000-0000-7000-8000-000000000009', 'guest_requests', '9a000000-0000-7000-8000-000000000024', 'approve',
   '{"before": {"status": "pending", "decision_message": null}, "after": {"status": "approved", "decision_message": "Mia late note"}}');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000009',
       '9d000000-0000-7000-8000-000000000009', 1, 'Olga, bring your ID.') $$,
  'G1 an old request is approved with a message');
-- The live deny path (denyGuestRequest under RLS): the reason lands in the diff.
select is(
  pg_temp.rowcount($$ update public.guest_requests
                        set status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111',
                            decided_at = now(), decision_reason = 'Dana was rude at the door'
                      where id = '9a000000-0000-7000-8000-000000000021' and status = 'pending' $$),
  1, 'G2 an old request is denied with a reason');
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000024',
       '9d000000-0000-7000-8000-000000000009', 0, 'another late note') $$,
  'P0002', null, 'G3 an ANONYMIZED request cannot be decided at all (not found), so no message lands after anonymization');
reset role;

create temp table pa_run1 as select * from public.run_privacy_retention();
select ok((select requests_anonymized from pa_run1) >= 3, 'G4 the retention job runs and anonymizes the old requests');
select is(
  (select coalesce(decision_message, '<null>') || '|' || approved_plus_ones::text
     from public.guest_requests where id = '9a000000-0000-7000-8000-000000000009'),
  '<null>|1', 'G5 retention nulls the message (the approved count is not PII and stays)');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'guest_requests' and entity_id = '9a000000-0000-7000-8000-000000000009'
      and diff::text like '%bring your ID%'),
  0, 'G6 ...and scrubs it from the request''s approve diff in the audit log');
select ok(
  (select diff -> 'after' -> 'redacted_fields' ? 'decision_message'
     from public.audit_log
    where entity_type = 'guest_requests' and entity_id = '9a000000-0000-7000-8000-000000000009'
      and action = 'anonymize'),
  'G7 the anonymize entry lists decision_message among the redacted fields');
select ok(
  (select decision_reason is null from public.guest_requests where id = '9a000000-0000-7000-8000-000000000021')
  and not exists (select 1 from public.audit_log
                   where entity_id = '9a000000-0000-7000-8000-000000000021'
                     and diff::text like '%rude at the door%'),
  'G8 the deny reason is gone from the anonymized row AND from its deny diff (the anonymize entry''s claim is now true)');
select ok(
  (select decision_reason is null from public.guest_requests where id = '9a000000-0000-7000-8000-000000000023')
  and not exists (select 1 from public.audit_log
                   where entity_id = '9a000000-0000-7000-8000-000000000023'
                     and diff::text like '%Pete old reason%'),
  'G9 backfill: a request anonymized by an EARLIER run loses the deny reason it kept, on the row and in the diff');
select ok(
  (select decision_message is null from public.guest_requests where id = '9a000000-0000-7000-8000-000000000024')
  and not exists (select 1 from public.audit_log
                   where entity_id = '9a000000-0000-7000-8000-000000000024'
                     and diff::text like '%Mia late note%'),
  'G10 backfill: a message on an earlier-anonymized request is gone from the row and the diff');
select ok(
  (select (diff -> 'after') ? 'decision_reason' and (diff -> 'after' ->> 'decision_reason') is null
          and diff -> 'after' ->> 'status' = 'denied'
     from public.audit_log
    where entity_id = '9a000000-0000-7000-8000-000000000023' and action = 'deny'),
  'G11 the diff keeps its structure: the key stays, only the value is redacted');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_guest_request('9a000000-0000-7000-8000-000000000022',
       '9d000000-0000-7000-8000-000000000009', 0, 'too late') $$,
  'P0002', null, 'G12 a request anonymized by this run cannot be approved afterwards');
reset role;

create temp table pa_run2 as select * from public.run_privacy_retention();
select is(
  (select requests_anonymized::text || '|' || audit_rows_redacted::text from pa_run2),
  '0|0', 'G13 a second run changes nothing: no request, no audit row (idempotent)');
select is(
  (select count(*)::int from public.guest_requests
    where anonymized_at is not null and (decision_message is not null or decision_reason is not null)),
  0, 'G14 no anonymized request anywhere still carries free decision text');
select ok(
  not has_function_privilege('authenticated', 'public.redact_anonymized_request_audit_pii()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.redact_anonymized_request_audit_pii()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.redact_anonymized_request_audit_pii()', 'EXECUTE'),
  'G15 the new audit scrub is owner-only, like its two siblings');

select * from finish();

rollback;
