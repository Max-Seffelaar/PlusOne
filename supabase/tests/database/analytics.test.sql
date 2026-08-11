-- pgTAP — Fase 10: admin/finance analytics (decisions #15/#17/#26, spec §6).
-- Proves: the aggregation functions return correct numbers on the seed; the
-- audit_feed view enriches rows (actor/guest/tier names) for readable log lines;
-- and — the security core — staff see NOTHING, organizers see only their own
-- event, finance/admin see all (read-only), and the audit feed additionally
-- requires AAL2. Relies on the standard seed; everything rolls back.
--
-- Seed baseline (supabase/seed.sql): venue aa..01 has one event ee..01 with 30
-- guests; 27 are "registered"/on-list (status approved/checked_in — pending
-- Aïcha, removed Pieter AND refused Bram excluded, M4/#44), 3 checked in
-- (Sanne/Daan/Esra), 1 refused (Bram, tracked separately), 24 no-shows.
-- Adders: Max 20, Tom 8 (incl. removed Pieter, see 4.6), Lisa 1.

begin;

create extension if not exists pgtap with schema extensions;

-- Identity helper: PostgREST-style JWT claims + role switch (as rls.test.sql).
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(76);

-- ===========================================================================
-- 1. Event summary — correct headline numbers (admin, AAL2)
-- ===========================================================================

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');

select is((select registered from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  27, '1.1 registered = 27 (approved/checked_in; pending+removed+refused excluded, M4/#44)');
select is((select registered_headcount from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  37, '1.2 registered headcount = 37 (Σ 1 + plus_ones, excl. Bram''s 2 refused heads)');
select is((select present from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  3, '1.3 present = 3 guests with a check-in');
select is((select present_headcount from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  4, '1.4 present headcount = 4 (Σ 1 + plus_ones_arrived)');
select is((select refused from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  1, '1.5 refused = 1 (Bram, tracked separately — never in registered)');
select is((select no_shows from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  24, '1.6 no-shows = 27 registered − 3 present');
select is((select attendance_pct from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  10.8, '1.7 attendance = 4/37 ≈ 10.8%');
select is((select peak_count from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  1, '1.8 peak bucket holds 1 check-in (spread across three quarters)');

-- ===========================================================================
-- 2. Instroom per kwartier (#26)
-- ===========================================================================

select is((select count(*)::int from public.event_checkins_per_quarter('ee000000-0000-7000-8000-000000000001')),
  3, '2.1 three 15-min buckets (23:41 / 23:57 / 00:12 local)');
select is((select coalesce(sum(checkins),0)::int from public.event_checkins_per_quarter('ee000000-0000-7000-8000-000000000001')),
  3, '2.2 total check-ins across buckets = 3');

-- ===========================================================================
-- 3. Per tier — aanwezig vs. aangemeld
-- ===========================================================================

select is((select count(*)::int from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')),
  3, '3.1 three tiers');
select is((select registered from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')
           where tier_name = 'Regular'), 21, '3.2 Regular has 21 registered (refused Bram excluded, M4/#44)');
select is((select present from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')
           where tier_name = 'Regular'), 2, '3.3 Regular present = 2 (Daan, Esra)');
select is((select present from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')
           where tier_name = 'VIP'), 1, '3.4 VIP present = 1 (Sanne)');
select is((select registered from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')
           where tier_name = 'VIP + fles op tafel'), 1, '3.5 fles tier has 1 registered (Juri)');

-- ===========================================================================
-- 4. Per-member stats (T9) — HEADS, gross incl. removed, attributed to added_by
-- ===========================================================================

select is((select count(*)::int from public.event_user_additions('ee000000-0000-7000-8000-000000000001')),
  3, '4.1 three adders (Yusuf''s only guest is pending → not an adder)');

-- Max: 20 rows / 27 heads (Juri +2, Sanne +1, Daan, Esra, + 16 bulk); none
-- removed; 3 checked in = 4 heads arrived (Sanne arrived +1).
select is((select added from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 20, '4.2 Max added = 20 rows');
select is((select added_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 27, '4.3 Max added = 27 heads (Σ 1 + plus_ones)');
select is((select removed_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 0, '4.4 Max removed = 0 heads');
select is((select present_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 4, '4.5 Max checked-in = 4 heads (Sanne +1, Daan, Esra)');

-- Tom now gains the removed Pieter (+2): 8 rows / 13 heads, of which 3 removed.
select is((select added from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Tom Bakker'), 8, '4.6 Tom added = 8 rows (incl. removed Pieter)');
select is((select added_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Tom Bakker'), 13, '4.7 Tom added = 13 heads (gross, incl. removed)');
select is((select removed_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Tom Bakker'), 3, '4.8 Tom removed = 3 heads (Pieter 1 + 2)');
select is((select present_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Tom Bakker'), 0, '4.9 Tom checked-in = 0 (Bram refused, Pieter removed)');

-- Lisa: her door-add Joep (+1) → 2 heads.
select is((select added_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Lisa van den Berg'), 2, '4.10 Lisa added = 2 heads (door-add Joep +1)');

-- Free/paid split. The seed tiers carry no price → everything is free.
select is((select added_free_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 27, '4.11 all seed tiers free → Max added-free = 27');
select is((select present_free_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 4, '4.12 all seed tiers free → Max present-free = 4');

-- Make VIP a paid tier: Max's VIP heads (Sanne 2 + bulk VIP #10/#15/#20 = 3) = 5.
update public.guest_tiers set door_price_cents = 1500
where id = 'dd000000-0000-7000-8000-000000000002';
select is((select added_free_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 22, '4.13 VIP paid → Max added-free = 22 (27 − 5 VIP heads)');
select is((select present_free_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 2, '4.14 VIP paid → Max present-free = 2 (Daan + Esra; Sanne now paid)');

-- ===========================================================================
-- 5. Weigeringen met reden
-- ===========================================================================

select is((select count(*)::int from public.event_refusal_reasons('ee000000-0000-7000-8000-000000000001')),
  1, '5.1 one distinct refusal reason');
select is((select reason || ':' || n from public.event_refusal_reasons('ee000000-0000-7000-8000-000000000001')),
  'Agressief gedrag bij de deur:1', '5.2 the reason and its count');

-- ===========================================================================
-- 6. Venue summary over the (open-ended) period
-- ===========================================================================

select is((select events from public.venue_stats_summary('aa000000-0000-7000-8000-000000000001', null, null)),
  1, '6.1 venue has 1 event in range');
select is((select registered from public.venue_stats_summary('aa000000-0000-7000-8000-000000000001', null, null)),
  27, '6.2 venue registered = 27 (refused Bram excluded, M4/#44)');
select is((select present from public.venue_stats_summary('aa000000-0000-7000-8000-000000000001', null, null)),
  3, '6.3 venue present = 3');
select is((select present_headcount from public.venue_stats_summary('aa000000-0000-7000-8000-000000000001', null, null)),
  4, '6.4 venue present headcount = 4');

-- ===========================================================================
-- 7. Per-event rollup
-- ===========================================================================

select is((select count(*)::int from public.venue_event_rollup('aa000000-0000-7000-8000-000000000001', null, null)),
  1, '7.1 one event in the rollup');
select is((select present_headcount from public.venue_event_rollup('aa000000-0000-7000-8000-000000000001', null, null)),
  4, '7.2 rollup present headcount = 4');
select is((select attendance_pct from public.venue_event_rollup('aa000000-0000-7000-8000-000000000001', null, null)),
  10.8, '7.3 rollup attendance = 4/37 ≈ 10.8%');

reset role;

-- ===========================================================================
-- 8. AUTHORIZATION — the #17 core: staff see nothing, organizers only their
--    own event, admin/finance everything (read-only). Audit viewing is role-only
--    (AAL2 dropped, migration 20260624160000).
-- ===========================================================================

-- Staff (Tom): no stats, no audit, no venue rollup — only his own quota counter.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  0, '8.1 staff gets NO event stats (#17)');
select is((select count(*)::int from public.event_checkins_per_quarter('ee000000-0000-7000-8000-000000000001')),
  0, '8.2 staff gets NO instroom data');
select is((select count(*)::int from public.audit_feed), 0,
  '8.3 staff sees NOTHING in the audit feed');
select is((select count(*)::int from public.venue_stats_summary('aa000000-0000-7000-8000-000000000001', null, null)),
  0, '8.4 staff gets NO venue stats');
reset role;

-- Doorhost (Lisa): not admin/finance/organizer → no stats.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is((select count(*)::int from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  0, '8.5 doorhost gets NO event stats');
reset role;

-- Organizer (Yusuf): own event stats yes (#6/§2), venue-wide no.
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select registered from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  27, '8.6 organizer sees their own event stats');
select is((select count(*)::int from public.venue_stats_summary('aa000000-0000-7000-8000-000000000001', null, null)),
  0, '8.7 organizer gets NO venue-wide stats (not admin/finance)');
reset role;

-- Finance (AAL2): read-only access to everything, audit included.
select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2');
select is((select registered from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  27, '8.8 finance sees event stats');
select ok((select count(*) from public.audit_feed) > 0,
  '8.9 finance (AAL2) sees the audit feed');
select is((select count(*)::int from public.venue_stats_summary('aa000000-0000-7000-8000-000000000002', null, null)),
  0, '8.10 finance gets NO stats for a venue they are not a member of');
reset role;

-- Admin without AAL2: stats are role-gated (work); the audit feed is now role-only
-- too (AAL2 dropped for audit-log viewing, migration 20260624160000).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select is((select registered from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  27, '8.11 admin (AAL1) still sees stats — they are not AAL2-gated');
select ok((select count(*) from public.audit_feed) > 0,
  '8.12 admin (AAL1) now sees the audit feed — role-only, MFA no longer required (#Auth)');
reset role;

-- ===========================================================================
-- 9. audit_feed enrichment — names resolved for readable Dutch sentences (#15)
-- ===========================================================================

-- Admin (AAL2) moves Daan from Regular to VIP → a tier_change with both names.
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.guests set tier_id = 'dd000000-0000-7000-8000-000000000002'
where id = 'cc000000-0000-7000-8000-000000000003';

select ok(
  (select actor_name = 'Max de Vries'
       and guest_name = 'Daan Visser'
       and old_tier_name = 'Regular'
       and new_tier_name = 'VIP'
   from public.audit_feed
   where entity_type = 'guests' and entity_id = 'cc000000-0000-7000-8000-000000000003'
     and action = 'tier_change'
   order by created_at desc limit 1),
  '9.1 tier_change row resolves actor + guest + old/new tier names');

select ok(
  (select bool_and(guest_id is not null) from public.audit_feed where entity_type = 'check_ins'),
  '9.2 check-in entries resolve guest_id (drives the per-guest geschiedenis)');
reset role;

-- ===========================================================================
-- 10. Privileges — read-only surface, no anon access
-- ===========================================================================

select ok(not has_table_privilege('anon', 'public.audit_feed', 'SELECT'),
  '10.1 anon cannot read the audit feed');
select ok(has_table_privilege('authenticated', 'public.audit_feed', 'SELECT'),
  '10.2 authenticated can read the audit feed (RLS-scoped)');
select ok(not has_table_privilege('authenticated', 'public.audit_feed', 'INSERT'),
  '10.3 the audit feed is not writable');
select ok(not has_function_privilege('anon', 'public.event_stats_summary(uuid)', 'EXECUTE'),
  '10.4 anon cannot execute event stats');
select ok(has_function_privilege('authenticated', 'public.event_stats_summary(uuid)', 'EXECUTE'),
  '10.5 authenticated can execute event stats');
select ok(not has_function_privilege('anon', 'public.venue_stats_summary(uuid, timestamptz, timestamptz)', 'EXECUTE'),
  '10.6 anon cannot execute venue stats');

-- ===========================================================================
-- 11. C6 (review 2026-07-07) — a voided check-in must count as present
--     NOWHERE, including the per-member breakdown (event_user_additions had
--     dropped the `where c.voided_at is null` filter its predecessor carried).
-- ===========================================================================

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');

create temp table _c6(hc0 int, hc1 int, hc2 int, pr0 int, pr1 int, pr2 int);
insert into _c6(hc0, pr0)
  select present_headcount, present from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
  where full_name = 'Max de Vries';

insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-00000000c601', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'C6 Void Gast', 1, '11111111-1111-4111-8111-111111111111');
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-00000000c601', '11111111-1111-4111-8111-111111111111', 1);

update _c6 set hc1 = (select present_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
                       where full_name = 'Max de Vries'),
               pr1 = (select present from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
                      where full_name = 'Max de Vries');

select is((select hc1 - hc0 from _c6), 2,
  '11.1 the new (non-voided) check-in adds 2 heads (1 + 1 plus_one) to Max''s present_headcount');
select is((select pr1 - pr0 from _c6), 1,
  '11.2 the new (non-voided) check-in adds 1 to Max''s present count');

update public.check_ins set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
  where guest_id = 'cc000000-0000-7000-8000-00000000c601';

update _c6 set hc2 = (select present_headcount from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
                       where full_name = 'Max de Vries'),
               pr2 = (select present from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
                      where full_name = 'Max de Vries');

select is((select hc2 from _c6), (select hc0 from _c6),
  '11.3 voiding the check-in drops present_headcount back to baseline (C6 fix)');
select is((select pr2 from _c6), (select pr0 from _c6),
  '11.4 voiding the check-in drops present back to baseline (C6 fix)');

reset role;

-- ===========================================================================
-- 12. event_tier_occupancy / event_request_link_funnel (86ey9e9wv/#47,#49) —
--     DB-side aggregates that replace fetchTiersWithUsage/fetchRequestLinks's
--     client-side per-row sums (never truncates past PostgREST's 1000-row cap
--     the way an unwindowed guest_requests select did). Both are plain
--     SECURITY INVOKER SQL functions, so RLS on guests/guest_requests governs
--     visibility exactly as it did for the row-by-row reads they replace.
--
--     Uses its OWN isolated event/tiers/links (e2../d2../c2../l2../b2..) rather
--     than the shared ee..01 seed event — the exact counts below must not
--     depend on §9's tier-change mutation, nor (this local stack is shared
--     across many worktree sessions against the SAME fixed seed ids) on
--     another session's concurrent writes to ee..01.
-- ===========================================================================

insert into public.events (id, venue_id, name, starts_at, status, landing_slug, landing_active)
values ('e2000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
        'Occupancy/Funnel Fixture', now() + interval '9 days', 'open', 'occupancy-funnel-fixture', false);

insert into public.event_organizers (event_id, user_id) values
  ('e2000000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444');

insert into public.guest_tiers (id, event_id, name) values
  ('d2000000-0000-7000-8000-000000000001', 'e2000000-0000-7000-8000-000000000001', 'Fixture Regular'),
  ('d2000000-0000-7000-8000-000000000002', 'e2000000-0000-7000-8000-000000000001', 'Fixture VIP'),
  ('d2000000-0000-7000-8000-000000000003', 'e2000000-0000-7000-8000-000000000001', 'Fixture Empty');

-- Tier 1: every status once — proves "used" excludes ONLY removed/denied
-- (matches guest_tier_contribution, NOT event_tier_stats' approved/checked_in-
-- only "registered"). Split across two adders to prove staff RLS-scoping too.
insert into public.guests (id, event_id, tier_id, full_name, added_by, status) values
  ('c2000000-0000-7000-8000-000000000001', 'e2000000-0000-7000-8000-000000000001',
   'd2000000-0000-7000-8000-000000000001', 'Fixture Approved (Max)',
   '11111111-1111-4111-8111-111111111111', 'approved'),
  ('c2000000-0000-7000-8000-000000000002', 'e2000000-0000-7000-8000-000000000001',
   'd2000000-0000-7000-8000-000000000001', 'Fixture CheckedIn (Max)',
   '11111111-1111-4111-8111-111111111111', 'checked_in'),
  ('c2000000-0000-7000-8000-000000000003', 'e2000000-0000-7000-8000-000000000001',
   'd2000000-0000-7000-8000-000000000001', 'Fixture Pending (Tom)',
   '55555555-5555-4555-8555-555555555555', 'pending'),
  ('c2000000-0000-7000-8000-000000000004', 'e2000000-0000-7000-8000-000000000001',
   'd2000000-0000-7000-8000-000000000001', 'Fixture Refused (Tom)',
   '55555555-5555-4555-8555-555555555555', 'refused'),
  ('c2000000-0000-7000-8000-000000000005', 'e2000000-0000-7000-8000-000000000001',
   'd2000000-0000-7000-8000-000000000001', 'Fixture Removed (Max)',
   '11111111-1111-4111-8111-111111111111', 'removed'),
  ('c2000000-0000-7000-8000-000000000006', 'e2000000-0000-7000-8000-000000000001',
   'd2000000-0000-7000-8000-000000000001', 'Fixture Denied (Max)',
   '11111111-1111-4111-8111-111111111111', 'denied'),
  ('c2000000-0000-7000-8000-000000000007', 'e2000000-0000-7000-8000-000000000001',
   'd2000000-0000-7000-8000-000000000002', 'Fixture VIP Approved (Max)',
   '11111111-1111-4111-8111-111111111111', 'approved');

insert into public.request_links (id, event_id, label, slug) values
  ('f2000000-0000-7000-8000-000000000001', 'e2000000-0000-7000-8000-000000000001',
   'Fixture Extra Link', 'occupancy-funnel-fixture-extra');

-- guest_requests_check (20260706101000): a decided (non-pending) request needs
-- decided_at + (decided_by or decided_via='auto') — stamp both on denied/approved.
insert into public.guest_requests (id, event_id, full_name, status, request_link_id, decided_by, decided_at) values
  ('b2000000-0000-7000-8000-000000000001', 'e2000000-0000-7000-8000-000000000001',
   'Req Default 1', 'pending',
   (select id from public.request_links where event_id = 'e2000000-0000-7000-8000-000000000001' and is_default),
   null, null),
  ('b2000000-0000-7000-8000-000000000002', 'e2000000-0000-7000-8000-000000000001',
   'Req Default 2', 'pending',
   (select id from public.request_links where event_id = 'e2000000-0000-7000-8000-000000000001' and is_default),
   null, null),
  ('b2000000-0000-7000-8000-000000000003', 'e2000000-0000-7000-8000-000000000001',
   'Req Default 3', 'denied',
   (select id from public.request_links where event_id = 'e2000000-0000-7000-8000-000000000001' and is_default),
   '11111111-1111-4111-8111-111111111111', now()),
  ('b2000000-0000-7000-8000-000000000004', 'e2000000-0000-7000-8000-000000000001',
   'Req Extra 1', 'approved', 'f2000000-0000-7000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', now()),
  ('b2000000-0000-7000-8000-000000000005', 'e2000000-0000-7000-8000-000000000001',
   'Req Extra 2', 'denied', 'f2000000-0000-7000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', now());

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');

select is((select count(*)::int from public.event_tier_occupancy('e2000000-0000-7000-8000-000000000001')),
  2, '12.1 admin: only tiers WITH occupancy appear (the empty tier is absent)');
select is((select used from public.event_tier_occupancy('e2000000-0000-7000-8000-000000000001')
           where tier_id = 'd2000000-0000-7000-8000-000000000001'),
  4, '12.2 tier 1 used = 4 (approved + checked_in + pending + refused; removed + denied excluded — NOT event_tier_stats semantics)');
select is((select used from public.event_tier_occupancy('e2000000-0000-7000-8000-000000000001')
           where tier_id = 'd2000000-0000-7000-8000-000000000002'),
  1, '12.3 tier 2 used = 1');

select is((select count(*)::int from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')),
  2, '12.4 admin: two links have requests (default + extra)');
select is((select requests from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')
           where request_link_id = (select id from public.request_links
                                     where event_id = 'e2000000-0000-7000-8000-000000000001' and is_default)),
  3, '12.5 default link: 3 requests (2 pending + 1 denied)');
select is((select approved from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')
           where request_link_id = (select id from public.request_links
                                     where event_id = 'e2000000-0000-7000-8000-000000000001' and is_default)),
  0, '12.6 default link: 0 approved');
select is((select requests from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')
           where request_link_id = 'f2000000-0000-7000-8000-000000000001'),
  2, '12.7 extra link: 2 requests');
select is((select approved from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')
           where request_link_id = 'f2000000-0000-7000-8000-000000000001'),
  1, '12.8 extra link: 1 approved');
reset role;

-- Staff (Tom): guests RLS scopes to added_by = self — occupancy reflects only
-- his own additions (Fixture Pending + Fixture Refused; none in tier 2, so
-- tier 2 doesn't appear for him at all). guest_requests grants staff nothing.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.event_tier_occupancy('e2000000-0000-7000-8000-000000000001')),
  1, '12.9 staff sees occupancy only for tiers among his own guests');
select is((select used from public.event_tier_occupancy('e2000000-0000-7000-8000-000000000001')
           where tier_id = 'd2000000-0000-7000-8000-000000000001'),
  2, '12.10 staff tier 1 used = 2 (his own pending + refused; the other 4 rows added by Max stay invisible)');
select is((select count(*)::int from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')),
  0, '12.11 staff gets NO request-link funnel data (#17)');
reset role;

-- Organizer (Yusuf, made organizer of THIS fixture event above): guest_requests
-- RLS is is_event_organizer(event_id), not per-row — sees the FULL funnel,
-- unlike staff's per-row-scoped tier occupancy above.
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')),
  2, '12.12 organizer sees the full request-link funnel for their own event');
reset role;

-- Doorhost (Lisa): guests_select grants admin/finance/doorhost full read, but
-- guest_requests_select excludes doorhost — occupancy is full, funnel is empty.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is((select count(*)::int from public.event_tier_occupancy('e2000000-0000-7000-8000-000000000001')),
  2, '12.13 doorhost sees full tier occupancy (guests_select grants doorhost)');
select is((select count(*)::int from public.event_request_link_funnel('e2000000-0000-7000-8000-000000000001')),
  0, '12.14 doorhost gets NO request-link funnel data (not admin/finance/organizer)');
reset role;

select * from finish();

rollback;
