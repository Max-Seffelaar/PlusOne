-- pgTAP — Requests-epic F1: influencers (86ey21vjt). Run: supabase test db.
-- Proves the RLS matrix (admin manages, finance reads, organizer reads to pick
-- one for a link, staff/user_manager see nothing, anon has no grant), the name
-- guard, archiving (soft delete, #21: an archived influencer takes no new
-- links), and the venue-scoped audit trail. Seed users as in request_links
-- test. All rolls back.

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
-- A. Admin manages
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
select is(
  pg_temp.rowcount($$ insert into public.influencers (id, venue_id, name, handle, created_by)
    values ('1f000000-0000-7000-8000-00000000a001', 'aa000000-0000-7000-8000-000000000001',
            'Jayden Promo', '@jayden.010', '11111111-1111-4111-8111-111111111111') $$),
  1, 'A1 admin creates an influencer');
select is(
  pg_temp.rowcount($$ update public.influencers set notes = 'Brengt veel volk mee'
    where id = '1f000000-0000-7000-8000-00000000a001' $$),
  1, 'A2 admin updates an influencer');
select throws_ok(
  $$ insert into public.influencers (venue_id, name, created_by)
     values ('aa000000-0000-7000-8000-000000000001', 'X',
             '11111111-1111-4111-8111-111111111111') $$,
  '23514', null, 'A3 a one-letter name is rejected (CHECK)');

-- ---------------------------------------------------------------------------
-- B. Read surface per role
-- ---------------------------------------------------------------------------

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- finance
select is(
  (select count(*)::int from public.influencers
   where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  2, 'B1 finance reads the venue''s influencers (seed Jayden + the fixture)');
select throws_ok(
  $$ insert into public.influencers (venue_id, name, created_by)
     values ('aa000000-0000-7000-8000-000000000001', 'Fin Influencer',
             '33333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'B2 finance cannot create influencers');

select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- organizer of ee..01
select is(
  (select count(*)::int from public.influencers
   where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  2, 'B3 an event organizer reads the venue''s influencers (to pick one for a link)');
select throws_ok(
  $$ insert into public.influencers (venue_id, name, created_by)
     values ('aa000000-0000-7000-8000-000000000001', 'Org Influencer',
             '44444444-4444-4444-8444-444444444444') $$,
  '42501', null, 'B4 an organizer cannot create influencers (admin-only)');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select is(
  (select count(*)::int from public.influencers),
  0, 'B5 staff sees no influencers');

select pg_temp.login('22222222-2222-4222-8222-222222222222'); -- user_manager
select is(
  (select count(*)::int from public.influencers),
  0, 'B6 user_manager sees no influencers');

select pg_temp.login_anon();
select throws_ok(
  $$ select count(*) from public.influencers $$,
  '42501', null, 'B7 anon has no grant on influencers at all');
reset role;

-- ---------------------------------------------------------------------------
-- C. Archive (soft delete, #21) + audit (#4/#15)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$ update public.influencers set archived_at = now()
    where id = '1f000000-0000-7000-8000-00000000a001' $$),
  1, 'C1 admin archives an influencer (soft delete)');
select throws_ok(
  $$ insert into public.request_links (event_id, influencer_id, slug, created_by)
     values ('ee000000-0000-7000-8000-000000000001',
             '1f000000-0000-7000-8000-00000000a001', 'archived-influencer-link',
             '11111111-1111-4111-8111-111111111111') $$,
  '23514', null, 'C2 an archived influencer takes no new links');

reset role;
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'influencers'
     and entity_id = '1f000000-0000-7000-8000-00000000a001'
     and venue_id = 'aa000000-0000-7000-8000-000000000001'
     and actor_id = '11111111-1111-4111-8111-111111111111'
     and action in ('create', 'update')),
  3, 'C3 create + update + archive all land venue-scoped in the audit log');

select * from finish();

rollback;
