-- pgTAP — ATTACKER suite (security-audit 4.2): cross-tenant token + IDOR.
-- Run: supabase test db. NEW file (does not touch the existing happy-path tests).
--
-- Threat model (CLAUDE.md #1): the anon/auth API key ships to the browser, so an
-- attacker can craft raw PostgREST calls. They must never read or write outside
-- their memberships. This file proves the boundary holds for:
--   * the raw ANON key (the public key) against every non-landing table;
--   * a legitimate venue-1 token reaching into venue 2 (cross-tenant);
--   * IDOR — guessing a guest UUID that belongs to another adder / another venue;
--   * a cross-tenant door check-in by guest_id.
-- Permission-denied (no table grant) surfaces as 42501; RLS-filtered rows simply
-- vanish (0 rows, no error). Both are asserted. Everything rolls back.

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

select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner, RLS bypassed — like the seed): a SECOND venue's event +
-- tier + guest. Max (admin) is the only member of venue 2; venue-1 staff/door
-- have no scope there, so these are clean cross-tenant targets.
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, landing_slug, status)
values ('ee000000-0000-7000-8000-000000000002',
        'aa000000-0000-7000-8000-000000000002',
        'Marktzaal Night', '2026-07-01 22:00:00+02', 'attacker-marktzaal-night', 'open');

insert into public.guest_tiers (id, event_id, name)
values ('dd000000-0000-7000-8000-000000000012',
        'ee000000-0000-7000-8000-000000000002', 'Regular');

insert into public.guests (id, event_id, tier_id, full_name, added_by, source, status)
values ('cc000000-0000-7000-8000-000000000099',
        'ee000000-0000-7000-8000-000000000002',
        'dd000000-0000-7000-8000-000000000012',
        'Venue2 Geheime Gast', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

-- ---------------------------------------------------------------------------
-- A. Raw ANON key: only the landing surface, nothing else (decision #12/#28)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();

select throws_ok($$ select count(*) from public.guests $$,
  '42501', null, 'A1 anon cannot read guests (no table grant)');
select throws_ok($$ select count(*) from public.venues $$,
  '42501', null, 'A2 anon cannot read venues');
select throws_ok($$ select count(*) from public.venue_memberships $$,
  '42501', null, 'A3 anon cannot read memberships');
select throws_ok($$ select count(*) from public.check_ins $$,
  '42501', null, 'A4 anon cannot read check-ins');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Anon Insert',
          '11111111-1111-4111-8111-111111111111')
$$, '42501', null, 'A5 anon cannot insert guests');
-- The single allowed anon read: an event whose landing link is active.
select is(
  (select count(id)::int from public.events
   where landing_slug = 'plusone-launch-night'),
  1, 'A6 anon sees ONLY an active landing event (the one anon surface)');

reset role;

-- ---------------------------------------------------------------------------
-- B. Cross-tenant: venue-1 staff (Tom) reaching into venue 2
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');

select is(
  (select count(*)::int from public.events
   where id = 'ee000000-0000-7000-8000-000000000002'),
  0, 'B1 venue-1 staff cannot see the venue-2 event');
select is(
  (select count(*)::int from public.guests
   where id = 'cc000000-0000-7000-8000-000000000099'),
  0, 'B2 venue-1 staff cannot read the venue-2 guest by id (cross-tenant IDOR read)');
select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by)
  values ('ee000000-0000-7000-8000-000000000002',
          'dd000000-0000-7000-8000-000000000012', 'Cross-tenant Insert',
          '55555555-5555-4555-8555-555555555555')
$$, '42501', null, 'B3 venue-1 staff cannot write into the venue-2 event');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 9
              where id = 'cc000000-0000-7000-8000-000000000099'$$),
  0, 'B4 venue-1 staff cannot mutate the venue-2 guest by id');

reset role;

-- ---------------------------------------------------------------------------
-- C. IDOR within venue 1: staff guessing another adder's guest id (#27/§2)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
-- cc..01 (Juri) was added by the admin, not by Tom.
select is(
  (select count(*)::int from public.guests
   where id = 'cc000000-0000-7000-8000-000000000001'),
  0, 'C1 staff cannot read a guest added by someone else (IDOR read)');
select is(
  pg_temp.rowcount($$update public.guests set plus_ones = 0
              where id = 'cc000000-0000-7000-8000-000000000001'$$),
  0, 'C2 staff cannot mutate a guest added by someone else (IDOR write)');
reset role;

-- ---------------------------------------------------------------------------
-- D. Cross-tenant door check-in: venue-1 doorhost on a venue-2 guest_id
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$
  insert into public.check_ins (guest_id, checked_by)
  values ('cc000000-0000-7000-8000-000000000099',
          '66666666-6666-4666-8666-666666666666')
$$, '42501', null, 'D1 venue-1 doorhost cannot check in a venue-2 guest (cross-tenant)');
reset role;

select * from finish();

rollback;
