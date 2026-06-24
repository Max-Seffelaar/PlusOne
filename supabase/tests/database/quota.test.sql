-- pgTAP — Fase 7: quota-engine (run: supabase test db)
-- Proves decisions #22/#31 and the §3 quota paragraph: +N math, override vs
-- default, admin/organizer exemption, landing exclusion, tier-max, and the
-- fraud-critical live-rule (removal frees a slot only before go-live).
--
-- Seed baseline (supabase/seed.sql): event ee..01 is 'open'. Tom (staff, 55..)
-- consumes 10 of an event-override 12; Lisa (doorhost, 66..) consumes 2 of a
-- venue-default 5; Max (admin, 11..) and Yusuf (organizer, 44..) are exempt.
-- Tier dd..03 ("VIP + fles op tafel") has max_guests = 10, occupied by 1 (Juri).
--
-- Most enforcement tests set the quota knob RELATIVE to live consumption
-- (override = consumption + headroom) so they hold regardless of what earlier
-- sections added. The live-rule section runs LAST because went_live_at is a
-- permanent marker once stamped. UUIDs are inlined (project convention — see
-- rls.test.sql). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- Identity helpers (PostgREST-style claims + role switch), as in rls.test.sql.
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(42);

-- ===========================================================================
-- 1. Quota math helpers (read-only, as the owner/superuser)
-- ===========================================================================

select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'), 10,
  '1.1 Tom consumes 10 (Bram refused 2 + 6 bulk; removed Pieter freed, event open)');
select is(public.user_event_quota(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'), 12,
  '1.2 event override (12) beats the venue default (10)');
select is(public.user_event_quota(
  'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666'), 5,
  '1.3 no override -> venue default (Lisa 5)');
select is(public.user_event_consumption(
  'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666'), 2,
  '1.4 Lisa consumes 2 (door-add Joep +1)');
select is(public.user_event_quota(
  'ee000000-0000-7000-8000-000000000001', '22222222-2222-4222-8222-222222222222'), 5,
  '1.5 no per-user quota row -> venue default_personal_quota (Club Vesper 5, #22)');
select is(public.user_is_quota_exempt(
  'ee000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111'), true,
  '1.6 admin is quota-exempt');
select is(public.user_is_quota_exempt(
  'ee000000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444'), true,
  '1.7 event organizer is quota-exempt');
select is(public.user_is_quota_exempt(
  'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'), false,
  '1.8 staff is NOT exempt');
select is(public.user_is_quota_exempt(
  'ee000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666'), false,
  '1.9 doorhost is NOT exempt');
select is(public.tier_consumption('dd000000-0000-7000-8000-000000000003'), 1,
  '1.10 VIP-fles tier starts at 1 occupied (Juri)');

-- ===========================================================================
-- 2. +N enforcement on INSERT — "Jan +2" = 3 slots (#22). Knob: 2 free.
-- ===========================================================================

update public.event_quotas
  set quota_override = public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555') + 2
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';

select pg_temp.login('55555555-5555-4555-8555-555555555555');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Plus Twee', 2,
          '55555555-5555-4555-8555-555555555555')
$$, '45001', null, '2.1 +2 (3 slots) over the 2 free slots is blocked');

select lives_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
  values ('cc000000-0000-7000-8000-0000000000b1',
          'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Plus Een', 1,
          '55555555-5555-4555-8555-555555555555')
$$, '2.2 +1 (2 slots) exactly fills the 2 free slots');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Eentje Teveel', 0,
          '55555555-5555-4555-8555-555555555555')
$$, '45001', null, '2.3 one more (+0) now exceeds — blocks the batch (#33)');

reset role;

-- ===========================================================================
-- 3. Landing guests fall outside personal quota (#31). Knob: 0 free.
--    NB (security-audit 4.2): a STAFF member may no longer self-attribute a guest
--    as source='landing' — that quota-bypass forge is now rejected by the
--    guests_insert WITH CHECK (migration 20260623140200; see
--    attacker_quota_bypass.test.sql). Real landing guests are created only by the
--    SECURITY DEFINER approve_guest_request RPC (added_by = the exempt approver),
--    so #31 is proven here at the function level + via an owner-side insert
--    (past RLS), not via a staff forge.
-- ===========================================================================

update public.event_quotas
  set quota_override = public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555')
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';

-- 3.1 the #31 rule itself: a landing-source row consumes 0 personal slots (seed
-- guest cc..07 is the organizer-staged landing request).
select is(
  public.guest_personal_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-000000000007'),
    null),
  0, '3.1 a landing-source guest contributes 0 personal slots (#31)');

-- 3.2 adding a landing guest for the staffer (inserted as owner — the RPC path)
-- does not raise their personal consumption, even with 0 free slots.
insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source, status)
values ('ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Landing Gast', 5,
        '55555555-5555-4555-8555-555555555555', 'landing', 'approved');
select is(
  public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  public.user_event_quota(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  '3.2 the landing add did not raise the staffer''s personal consumption (#31)');

-- ===========================================================================
-- 4. Admin & organizer add without a personal limit (role matrix §2).
-- ===========================================================================

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
  values ('cc000000-0000-7000-8000-0000000000a1',
          'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Admin Bulk', 50,
          '11111111-1111-4111-8111-111111111111')
$$, '4.1 admin adds +50 — no personal limit');
reset role;

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Organizer Bulk', 50,
          '44444444-4444-4444-8444-444444444444')
$$, '4.2 organizer adds +50 — no personal limit');
reset role;

-- ===========================================================================
-- 5. Tier max (#8): caps entries in dd..03 (max 10); removed/denied excluded.
-- ===========================================================================

-- Fill the tier to exactly its max with exempt (admin) adds, so ONLY tier-max
-- can block here, never personal quota.
insert into public.guests (event_id, tier_id, full_name, added_by, source, status)
select 'ee000000-0000-7000-8000-000000000001',
       'dd000000-0000-7000-8000-000000000003',
       'Tier Fill ' || g, '11111111-1111-4111-8111-111111111111', 'app', 'approved'
from generate_series(
  1, 10 - public.tier_consumption('dd000000-0000-7000-8000-000000000003')) as g;

select is(public.tier_consumption('dd000000-0000-7000-8000-000000000003'), 10,
  '5.1 tier filled to its max of 10');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000003', 'Elfde Fles',
          '11111111-1111-4111-8111-111111111111')
$$, '45002', null, '5.2 11th entry in a full tier is blocked (even for admin)');

select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Regular Zonder Max',
          '11111111-1111-4111-8111-111111111111')
$$, '5.3 a tier without max never blocks');
reset role;

-- Removing an entry frees a tier slot.
update public.guests set status = 'removed'
  where id = (select id from public.guests
              where tier_id = 'dd000000-0000-7000-8000-000000000003'
                and full_name like 'Tier Fill %'
              order by full_name limit 1);
select is(public.tier_consumption('dd000000-0000-7000-8000-000000000003'), 9,
  '5.4 removing a guest frees a tier slot');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000003', 'Terug Tot Tien',
          '11111111-1111-4111-8111-111111111111')
$$, '5.5 the freed tier slot can be reused');

-- A tier-change INTO a full tier is blocked (counts as a new entry there).
select throws_ok($$
  update public.guests set tier_id = 'dd000000-0000-7000-8000-000000000003'
  where id = 'cc000000-0000-7000-8000-0000000000a1'
$$, '45002', null, '5.6 moving a guest into a full tier is blocked');
reset role;

-- ===========================================================================
-- 6. UPDATE paths: a decrease is always allowed (even when already over);
--    only a net increase is checked.
-- ===========================================================================

-- Force Tom 1 over his limit.
update public.event_quotas
  set quota_override = public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555') - 1
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok($$
  update public.guests set plus_ones = 0
  where id = 'cc000000-0000-7000-8000-0000000000b1'
$$, '6.1 lowering plus_ones is allowed even while over quota');

select throws_ok($$
  update public.guests set plus_ones = 5
  where id = 'cc000000-0000-7000-8000-0000000000b1'
$$, '45001', null, '6.2 raising plus_ones over the limit is blocked');

select lives_ok($$
  update public.guests set full_name = full_name
  where id = 'cc000000-0000-7000-8000-0000000000b1'
$$, '6.3 a no-op update never trips the quota guard (idempotent replay #25)');
reset role;

-- Un-remove (status removed -> approved) re-consumes its slots.
update public.event_quotas
  set quota_override = public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555')
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  update public.guests set status = 'approved'
  where id = 'cc000000-0000-7000-8000-000000000006'
$$, '45001', null, '6.4 un-removing Pieter (+2 = 3 slots) over the limit is blocked');
reset role;

update public.event_quotas
  set quota_override = public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555') + 3
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok($$
  update public.guests set status = 'approved'
  where id = 'cc000000-0000-7000-8000-000000000006'
$$, '6.5 un-removing within quota is allowed');
reset role;

-- ===========================================================================
-- 7. event_quota_status RPC — the "8 van 10 over" counter (#17), caller-scoped.
-- ===========================================================================

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select exempt from public.event_quota_status(
  'ee000000-0000-7000-8000-000000000001')), false,
  '7.1 staff sees exempt = false');
select is(
  (select remaining from public.event_quota_status('ee000000-0000-7000-8000-000000000001')),
  (select greatest(quota - consumed, 0) from public.event_quota_status(
    'ee000000-0000-7000-8000-000000000001')),
  '7.2 remaining = max(quota - consumed, 0)');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select exempt from public.event_quota_status(
  'ee000000-0000-7000-8000-000000000001')), true,
  '7.3 admin sees exempt = true');
reset role;

-- ===========================================================================
-- 8. LIVE-RULE (#22) — runs LAST (went_live_at is permanent once stamped).
--    Removal frees a slot before go-live, never after.
-- ===========================================================================

-- Plenty of headroom so only the live-rule (not the limit) is under test.
update public.event_quotas set quota_override = 100000
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';

insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source, status)
values
  ('cc000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Live Gast A', 0,
   '55555555-5555-4555-8555-555555555555', 'app', 'approved'),
  ('cc000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Live Gast B', 0,
   '55555555-5555-4555-8555-555555555555', 'app', 'approved');

-- Remove A before go-live -> slot is freed, removed_at stamped.
update public.guests set status = 'removed'
  where id = 'cc000000-0000-7000-8000-0000000000e1';
select is(
  (select count(*)::int from public.guests
   where id = 'cc000000-0000-7000-8000-0000000000e1' and removed_at is not null), 1,
  '8.1 removed_at stamped on soft-delete');

-- Take the event live, then remove B.
update public.events set status = 'live'
  where id = 'ee000000-0000-7000-8000-000000000001';
select isnt((select went_live_at from public.events
             where id = 'ee000000-0000-7000-8000-000000000001'), null,
  '8.2 went_live_at is stamped when the event goes live');

update public.guests set status = 'removed'
  where id = 'cc000000-0000-7000-8000-0000000000e2';
select is(
  public.guest_personal_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000e2'),
    (select went_live_at from public.events
     where id = 'ee000000-0000-7000-8000-000000000001')), 1,
  '8.3 a guest removed after go-live still consumes its slot (#22)');

select is(
  public.guest_personal_contribution(
    (select g from public.guests g where g.id = 'cc000000-0000-7000-8000-0000000000e1'),
    (select went_live_at from public.events
     where id = 'ee000000-0000-7000-8000-000000000001')), 0,
  '8.4 a guest removed before go-live stays freed (#22)');

-- Anti-reuse: B's slot cannot be reclaimed by a fresh add once at the limit.
update public.event_quotas
  set quota_override = public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555')
  where event_id = 'ee000000-0000-7000-8000-000000000001'
    and user_id = '55555555-5555-4555-8555-555555555555';
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Hergebruik Poging', 0,
          '55555555-5555-4555-8555-555555555555', 'door')
$$, '45001', null, '8.5 cannot reclaim a live-removed slot with a new add');
reset role;

-- ===========================================================================
-- 9. Quota-request approval (#4/#5): atomic, AAL2-gated, writes the override.
--    Uses the seed's open request (Tom, +3).
-- ===========================================================================

create temp table quota_before as
  select public.user_event_quota(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555') as q;

-- Staff cannot approve their own request.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  select public.approve_quota_request(
    (select id from public.quota_requests
     where user_id = '55555555-5555-4555-8555-555555555555'
       and status = 'pending' and requested_extra = 3 limit 1))
$$, '42501', null, '9.1 staff cannot approve a quota request');
reset role;

-- Admin without AAL2 cannot approve (sensitive op, CLAUDE.md §Auth).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select throws_ok($$
  select public.approve_quota_request(
    (select id from public.quota_requests
     where user_id = '55555555-5555-4555-8555-555555555555'
       and status = 'pending' and requested_extra = 3 limit 1))
$$, '42501', null, '9.2 admin without AAL2 cannot approve');
reset role;

-- Admin with AAL2 approves.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select lives_ok($$
  select public.approve_quota_request(
    (select id from public.quota_requests
     where user_id = '55555555-5555-4555-8555-555555555555'
       and status = 'pending' and requested_extra = 3 limit 1))
$$, '9.3 admin (AAL2) approves the request');
reset role;

select is(
  (select status::text from public.quota_requests
   where user_id = '55555555-5555-4555-8555-555555555555' and requested_extra = 3 limit 1),
  'approved', '9.4 request is marked approved');

select is(
  public.user_event_quota(
    'ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555'),
  (select q from quota_before) + 3,
  '9.5 the override is raised by exactly the granted extra (#4)');

-- A decided request cannot be approved a second time (double-grant guard).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select throws_ok($$
  select public.approve_quota_request(
    (select id from public.quota_requests
     where user_id = '55555555-5555-4555-8555-555555555555' and requested_extra = 3 limit 1))
$$, '45003', null, '9.6 a decided request cannot be approved again');
reset role;

select * from finish();

rollback;
