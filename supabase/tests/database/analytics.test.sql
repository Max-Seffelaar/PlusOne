-- pgTAP — Fase 10: admin/finance analytics (decisions #15/#17/#26, spec §6).
-- Proves: the aggregation functions return correct numbers on the seed; the
-- audit_feed view enriches rows (actor/guest/tier names) for readable log lines;
-- and — the security core — staff see NOTHING, organizers see only their own
-- event, finance/admin see all (read-only), and the audit feed additionally
-- requires AAL2. Relies on the standard seed; everything rolls back.
--
-- Seed baseline (supabase/seed.sql): venue aa..01 has one event ee..01 with 30
-- guests; 28 are "registered" (status approved/checked_in/refused — pending
-- Aïcha + removed Pieter excluded), 3 checked in (Sanne/Daan/Esra), 1 refused
-- (Bram), 24 no-shows. Adders: Max 20, Tom 7, Lisa 1.

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

select plan(48);

-- ===========================================================================
-- 1. Event summary — correct headline numbers (admin, AAL2)
-- ===========================================================================

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');

select is((select registered from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  28, '1.1 registered = 28 (approved/checked_in/refused; pending+removed excluded)');
select is((select registered_headcount from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  39, '1.2 registered headcount = 39 (Σ 1 + plus_ones)');
select is((select present from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  3, '1.3 present = 3 guests with a check-in');
select is((select present_headcount from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  4, '1.4 present headcount = 4 (Σ 1 + plus_ones_arrived)');
select is((select refused from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  1, '1.5 refused = 1 (Bram)');
select is((select no_shows from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  24, '1.6 no-shows = 28 − 3 present − 1 refused');
select is((select attendance_pct from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  10.3, '1.7 attendance = 4/39 ≈ 10.3%');
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
           where tier_name = 'Regular'), 22, '3.2 Regular has 22 registered');
select is((select present from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')
           where tier_name = 'Regular'), 2, '3.3 Regular present = 2 (Daan, Esra)');
select is((select present from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')
           where tier_name = 'VIP'), 1, '3.4 VIP present = 1 (Sanne)');
select is((select registered from public.event_tier_stats('ee000000-0000-7000-8000-000000000001')
           where tier_name = 'VIP + fles op tafel'), 1, '3.5 fles tier has 1 registered (Juri)');

-- ===========================================================================
-- 4. Toevoegingen per gebruiker
-- ===========================================================================

select is((select count(*)::int from public.event_user_additions('ee000000-0000-7000-8000-000000000001')),
  3, '4.1 three adders');
select is((select added from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Max de Vries'), 20, '4.2 Max added 20');
select is((select added from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Tom Bakker'), 7, '4.3 Tom added 7');
select is((select added from public.event_user_additions('ee000000-0000-7000-8000-000000000001')
           where full_name = 'Lisa van den Berg'), 1, '4.4 Lisa added 1 (door-add Joep)');

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
  28, '6.2 venue registered = 28');
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
  10.3, '7.3 rollup attendance = 10.3%');

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
  28, '8.6 organizer sees their own event stats');
select is((select count(*)::int from public.venue_stats_summary('aa000000-0000-7000-8000-000000000001', null, null)),
  0, '8.7 organizer gets NO venue-wide stats (not admin/finance)');
reset role;

-- Finance (AAL2): read-only access to everything, audit included.
select pg_temp.login('33333333-3333-4333-8333-333333333333', 'aal2');
select is((select registered from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  28, '8.8 finance sees event stats');
select ok((select count(*) from public.audit_feed) > 0,
  '8.9 finance (AAL2) sees the audit feed');
select is((select count(*)::int from public.venue_stats_summary('aa000000-0000-7000-8000-000000000002', null, null)),
  0, '8.10 finance gets NO stats for a venue they are not a member of');
reset role;

-- Admin without AAL2: stats are role-gated (work); the audit feed is now role-only
-- too (AAL2 dropped for audit-log viewing, migration 20260624160000).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select is((select registered from public.event_stats_summary('ee000000-0000-7000-8000-000000000001')),
  28, '8.11 admin (AAL1) still sees stats — they are not AAL2-gated');
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

select * from finish();

rollback;
