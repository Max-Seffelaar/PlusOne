-- pgTAP — SCALE-5/K8/FE-3: venue_id denormalization on guests, guest_requests,
-- quota_requests, guest_tiers (migration 20260708120000). Run: supabase test db.
--
-- Proves: (1) the columns exist and are NOT NULL, (2) the backfill left every
-- existing row correctly scoped, (3) the BEFORE trigger auto-fills venue_id on a
-- fresh write, (4) the rewritten SELECT policies preserve the §2 role matrix
-- (allowed + denied per role), (5) cross-venue isolation still holds (venue_id
-- gates, it doesn't leak), and (6) the new venue_event_headcounts RPC aggregates
-- correctly AND stays RLS-scoped per caller (SECURITY INVOKER, not a bypass — a
-- staff member's headcount must stay limited to their own added guests, same as
-- the row-by-row read it replaces). Mirrors checkin_scope.test.sql's structure.
-- Relies on the same seed as rls.test.sql. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- PostgREST-style JWT claims + role switch (mirrors checkin_scope.test.sql).
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(34);

-- IDs from the seed: admin=1111 UM=2222 finance=3333 organizer=4444 staff=5555
-- doorhost=6666 · venue1=aa..01 · venue2=aa..02 (admin-only member) ·
-- event(open, venue1)=ee..01 · tier=dd..01.

-- 0. Schema shape -------------------------------------------------------------
select has_column('public', 'guests', 'venue_id', '0a guests has venue_id');
select has_column('public', 'guest_requests', 'venue_id', '0b guest_requests has venue_id');
select has_column('public', 'quota_requests', 'venue_id', '0c quota_requests has venue_id');
select has_column('public', 'guest_tiers', 'venue_id', '0d guest_tiers has venue_id');
select col_not_null('public', 'guests', 'venue_id', '0e guests.venue_id is NOT NULL');
select col_not_null('public', 'guest_requests', 'venue_id', '0f guest_requests.venue_id is NOT NULL');
select col_not_null('public', 'quota_requests', 'venue_id', '0g quota_requests.venue_id is NOT NULL');
select col_not_null('public', 'guest_tiers', 'venue_id', '0h guest_tiers.venue_id is NOT NULL');

-- 1. Backfill correctness: no seed row is mis-scoped --------------------------
select is(
  (select count(*)::int from public.guests g join public.events e on e.id = g.event_id
    where g.venue_id <> e.venue_id),
  0, '1a every guests.venue_id matches its event''s venue (backfill)');
select is(
  (select count(*)::int from public.guest_requests r join public.events e on e.id = r.event_id
    where r.venue_id <> e.venue_id),
  0, '1b every guest_requests.venue_id matches its event''s venue (backfill)');
select is(
  (select count(*)::int from public.quota_requests q join public.events e on e.id = q.event_id
    where q.venue_id <> e.venue_id),
  0, '1c every quota_requests.venue_id matches its event''s venue (backfill)');
select is(
  (select count(*)::int from public.guest_tiers t join public.events e on e.id = t.event_id
    where t.venue_id <> e.venue_id),
  0, '1d every guest_tiers.venue_id matches its event''s venue (backfill)');

-- 2. The BEFORE trigger fills the scope on a fresh write, per table ----------
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
insert into public.guest_tiers (id, event_id, name, color, aliases)
  values ('dd000000-0000-7000-8000-00000000a001', 'ee000000-0000-7000-8000-000000000001',
          'Scope Test Tier', '#000000', '{}');
select is(
  (select venue_id from public.guest_tiers where id = 'dd000000-0000-7000-8000-00000000a001'),
  'aa000000-0000-7000-8000-000000000001'::uuid, '2a guest_tiers.venue_id auto-filled from the event');

select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- doorhost
insert into public.guests (id, event_id, tier_id, full_name, added_by, source)
  values ('cc000000-0000-7000-8000-0000000000b1', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Venue Scope Test Gast',
          '66666666-6666-4666-8666-666666666666', 'door');
select is(
  (select venue_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000b1'),
  'aa000000-0000-7000-8000-000000000001'::uuid, '2b guests.venue_id auto-filled from the event');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff (own quota request)
insert into public.quota_requests (event_id, user_id, requested_extra)
  values ('ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 1);
select is(
  (select venue_id from public.quota_requests
    where event_id = 'ee000000-0000-7000-8000-000000000001'
      and user_id = '55555555-5555-4555-8555-555555555555'
      and requested_extra = 1),
  'aa000000-0000-7000-8000-000000000001'::uuid, '2c quota_requests.venue_id auto-filled from the event');

insert into public.guest_requests (event_id, full_name, phone, plus_ones, motivation, status)
  values ('ee000000-0000-7000-8000-000000000001', 'Scope Test Verzoek', '+31600000000', 0, 'test', 'pending');
-- guest_requests_select has no "own submission" clause (unlike quota_requests) —
-- the submitter (staff) can INSERT but can't read it back; switch to admin to assert.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select venue_id from public.guest_requests where full_name = 'Scope Test Verzoek'),
  'aa000000-0000-7000-8000-000000000001'::uuid, '2d guest_requests.venue_id auto-filled from the event');

-- 3. Rewritten SELECT policies preserve the §2 role matrix -------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
select ok((select count(*)::int from public.guests) > 0, '3a admin reads guests venue-wide');
select ok((select count(*)::int from public.guest_requests) > 0, '3b admin reads guest_requests');
select ok((select count(*)::int from public.guest_tiers) > 0, '3c admin reads guest_tiers');

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- finance
select ok((select count(*)::int from public.guests) > 0, '3d finance reads guests venue-wide');
select ok((select count(*)::int from public.guest_requests) > 0, '3e finance reads guest_requests');

select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- user_manager
select is((select count(*)::int from public.guests), 0, '3f user_manager may NOT read guests');
select is((select count(*)::int from public.guest_requests), 0, '3g user_manager may NOT read guest_requests');
select ok((select count(*)::int from public.guest_tiers) > 0, '3h user_manager (venue member) still reads guest_tiers');

select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- organizer, own event only
select ok((select count(*)::int from public.guests) > 0, '3i organizer reads own-event guests');
select is((select count(*)::int from public.quota_requests), 0, '3j organizer may NOT read quota_requests (not own, not admin/finance)');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff, own guests only
select is(
  (select count(*)::int from public.guests where added_by <> '55555555-5555-4555-8555-555555555555'),
  0, '3k staff never sees another actor''s guest row');
select ok(
  (select count(*)::int from public.quota_requests where user_id = '55555555-5555-4555-8555-555555555555') > 0,
  '3l staff reads their own quota_requests');

-- 4. Cross-venue isolation: venue_id must gate, never leak -------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin of BOTH venues
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active)
  values ('ee000000-0000-7000-8000-0000000000a2', 'aa000000-0000-7000-8000-000000000002',
          'Venue2 Scope Test', now(), now() + interval '1 hour', 'open', 'venue2-scope-test', false);
insert into public.guest_tiers (id, event_id, name, color, aliases)
  values ('dd000000-0000-7000-8000-00000000a002', 'ee000000-0000-7000-8000-0000000000a2', 'V2 Tier', '#000000', '{}');
select is(
  (select venue_id from public.guest_tiers where id = 'dd000000-0000-7000-8000-00000000a002'),
  'aa000000-0000-7000-8000-000000000002'::uuid, '4a venue2 tier auto-scopes to venue2, not venue1');

select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- doorhost, venue1-only
select is(
  (select count(*)::int from public.guest_tiers where id = 'dd000000-0000-7000-8000-00000000a002'),
  0, '4b venue1 doorhost cannot read venue2''s tier (cross-venue isolation)');

-- 5. venue_event_headcounts RPC: aggregate + RLS-scoped (K8) -----------------
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin, venue-wide
select ok(
  (select count(*)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001')) > 0,
  '5a admin: venue_event_headcounts returns a row per event at the venue');
select is(
  (select coalesce(sum(registered), 0)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001')),
  (select coalesce(sum(1 + plus_ones) filter (where status in ('approved', 'checked_in')), 0)::int
     from public.guests where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  '5b admin: RPC headcount matches the full venue aggregate');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff, own guests only
select is(
  (select coalesce(sum(registered), 0)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001')),
  (select coalesce(sum(1 + plus_ones) filter (where status in ('approved', 'checked_in')), 0)::int
     from public.guests
    where venue_id = 'aa000000-0000-7000-8000-000000000001'
      and added_by = '55555555-5555-4555-8555-555555555555'),
  '5c staff: RPC headcount stays own-guests-only (SECURITY INVOKER honors RLS, not a bypass)');

-- 5d. M4/#44 fix: `present` counts ARRIVED heads, not the full registered
-- party, on a partial check-in (was summing plus_ones regardless of arrival).
select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin, venue-wide

create temp table _partial(before_present int, after_present int);
insert into _partial(before_present)
  select present from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001')
   where event_id = 'ee000000-0000-7000-8000-000000000001';

insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-00000000d401', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Partial Party Gast', 3,
        '11111111-1111-4111-8111-111111111111');
-- check_ins_sync_guest_status (20260619120000) flips guests.status to
-- checked_in on this insert.
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-00000000d401', '11111111-1111-4111-8111-111111111111', 1);

update _partial set after_present = (
  select present from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001')
   where event_id = 'ee000000-0000-7000-8000-000000000001');

select is((select after_present - before_present from _partial), 2,
  '5d a +3 party with only 1 companion arrived adds 2 heads to present, not 4 (M4/#44)');

reset role;
select * from finish();
rollback;
