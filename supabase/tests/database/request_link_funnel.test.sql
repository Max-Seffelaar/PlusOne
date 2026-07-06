-- pgTAP — Requests-epic F1: pageview counters (funnel step 1, 86ey21vjt).
-- Run: supabase test db.
-- Proves record_link_pageview: cookie-less daily aggregation, silent no-ops on
-- unknown/paused slugs (#28), the per-IP throttle, and the read matrix
-- (admin/finance/organizer read, staff nothing, anon no grant). All rolls back.

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

select plan(9);

-- Fixture links (superuser; RLS proven in request_links.test.sql).
insert into public.request_links (id, event_id, label, slug, active) values
  ('2c000000-0000-7000-8000-00000000f001', 'ee000000-0000-7000-8000-000000000001',
   'PV Link', 'pv-x', true),
  ('2c000000-0000-7000-8000-00000000f002', 'ee000000-0000-7000-8000-000000000001',
   'PV Paused', 'pv-paused', false);

-- ---------------------------------------------------------------------------
-- A. Counting
-- ---------------------------------------------------------------------------

-- Recording happens as anon (the public page); assertions read as superuser
-- (anon has no grant on the counters — proven in D3).
select pg_temp.login_anon();
select public.record_link_pageview('pv-x', 'ip-pv-1');
reset role;
select is(
  (select views from public.request_link_pageviews_daily
   where request_link_id = '2c000000-0000-7000-8000-00000000f001'),
  1, 'A1 a page load increments the daily counter');

select pg_temp.login_anon();
select public.record_link_pageview('pv-x', 'ip-pv-2');
reset role;
select is(
  (select views from public.request_link_pageviews_daily
   where request_link_id = '2c000000-0000-7000-8000-00000000f001'),
  2, 'A2 a second load (other IP) lands in the SAME daily row');
select is(
  (select count(*)::int from public.request_link_pageviews_daily
   where request_link_id = '2c000000-0000-7000-8000-00000000f001'),
  1, 'A3 one link × one day = one row (aggregate, no per-visit records)');

-- ---------------------------------------------------------------------------
-- B. Silent no-ops (#28)
-- ---------------------------------------------------------------------------

-- Snapshot the total (seed carries its own pageview rows) — the two no-ops
-- below must not add anything anywhere.
create temp table pv0 as
  select count(*)::int as n from public.request_link_pageviews_daily;

select pg_temp.login_anon();
select public.record_link_pageview('does-not-exist', 'ip-pv-3');
reset role;
select is(
  (select count(*)::int from public.request_link_pageviews_daily),
  (select n from pv0), 'B1 an unknown slug records nothing (and returns no signal)');

select pg_temp.login_anon();
select public.record_link_pageview('pv-paused', 'ip-pv-4');
reset role;
select is(
  (select count(*)::int from public.request_link_pageviews_daily),
  (select n from pv0), 'B2 a paused link records nothing — closed shapes are silent');

-- ---------------------------------------------------------------------------
-- C. Throttle: 60 per window per IP
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
do $$
begin
  for i in 1..61 loop
    perform public.record_link_pageview('pv-x', 'ip-pv-throttle');
  end loop;
end $$;
reset role;
select is(
  (select views from public.request_link_pageviews_daily
   where request_link_id = '2c000000-0000-7000-8000-00000000f001'),
  62, 'C1 the 61st load from one IP in a window is dropped (2 + 60, not 63)');

-- ---------------------------------------------------------------------------
-- D. Read matrix
-- ---------------------------------------------------------------------------

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- finance
select is(
  (select count(*)::int from public.request_link_pageviews_daily
   where request_link_id = '2c000000-0000-7000-8000-00000000f001'),
  1, 'D1 finance reads the venue''s counters');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select is(
  (select count(*)::int from public.request_link_pageviews_daily),
  0, 'D2 staff sees no counters');

select pg_temp.login_anon();
select throws_ok(
  $$ select count(*) from public.request_link_pageviews_daily $$,
  '42501', null, 'D3 anon has no grant on the counters at all');
reset role;

select * from finish();

rollback;
