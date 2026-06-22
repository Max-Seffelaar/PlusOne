-- pgTAP — Sessie C: contacts (address book) RLS + reuse-search (run: supabase test db)
-- Access decision "staff reuse, PII for managers":
--   * admin/organizer manage, finance reads the venue address book directly;
--   * staff/doorhost get NO direct table access, only the PII-free reuse RPC.
-- Relies on the seed: venue aa..01 has contacts c0..01 Sanne (permanent),
-- c0..02 Anouk (permanent), c0..03 Pim (ordinary, linked to guest cc..02);
-- venue aa..02 has c0..04 Marit. Everything rolls back.
--
-- NB: the reuse-search section runs FIRST, before the INSERT tests, so it reads
-- the clean 3-contact seed (inserts later in this same transaction would
-- otherwise be visible to it).

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

select plan(22);

-- Auto-contact (S2.1): seeded guests with an e-mail/phone now grow the address
-- book, so the contact count is no longer a fixed 3/4. Capture the full
-- (superuser-visible) baseline up front and assert RLS visibility RELATIVE to it,
-- so the test stays correct as the seed evolves.
select set_config('test.contacts_all', (select count(*)::text from public.contacts), true);
select set_config('test.contacts_v1', (select count(*)::text from public.contacts
  where venue_id = 'aa000000-0000-7000-8000-000000000001'), true);

-- ---------------------------------------------------------------------------
-- A. SELECT visibility — managers + finance + organizer read; others nothing
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin at BOTH venues
select is((select count(*)::int from public.contacts), current_setting('test.contacts_all')::int,
  'A1 admin sees every contact across both venues');

select pg_temp.login('33333333-3333-4333-8333-333333333333');  -- finance, venue 1 only
select is((select count(*)::int from public.contacts), current_setting('test.contacts_v1')::int,
  'A2 finance sees venue 1 contacts only');
select is(
  (select count(*)::int from public.contacts where venue_id = 'aa000000-0000-7000-8000-000000000002'),
  0, 'A3 finance cannot see venue 2 contacts (cross-venue isolation)');

select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer (event scope at venue 1)
select is((select count(*)::int from public.contacts), current_setting('test.contacts_v1')::int,
  'A4 organizer sees the venue address book of his event');

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff
select is((select count(*)::int from public.contacts), 0, 'A5 staff has NO direct address-book read');

select pg_temp.login('66666666-6666-4666-8666-666666666666');  -- doorhost+staff
select is((select count(*)::int from public.contacts), 0, 'A6 doorhost has NO direct address-book read');

select pg_temp.login('22222222-2222-4222-8222-222222222222');  -- user_manager
select is((select count(*)::int from public.contacts), 0, 'A7 user_manager has no address-book read');

select pg_temp.login_anon();
select throws_ok(
  $$ select count(*) from public.contacts $$,
  '42501', null, 'A8 anon has zero access to contacts');

reset role;

-- ---------------------------------------------------------------------------
-- B. search_contacts_for_reuse — PII-free reuse for any venue member (clean seed)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff
select is(
  (select count(*)::int from public.search_contacts_for_reuse('aa000000-0000-7000-8000-000000000001')),
  least(current_setting('test.contacts_v1')::int, 50), 'B1 staff reuses the venue address book by name');
select is(
  (select event_count from public.search_contacts_for_reuse('aa000000-0000-7000-8000-000000000001')
   where full_name = 'Pim Scholten'),
  1, 'B2 reuse-search reports the "X× op een lijst" stat');
select is(
  (select count(*)::int from public.search_contacts_for_reuse('aa000000-0000-7000-8000-000000000002')),
  0, 'B3 staff reuse-search returns nothing for a venue they do not belong to');

select pg_temp.login('66666666-6666-4666-8666-666666666666');  -- doorhost
select is(
  (select count(*)::int from public.search_contacts_for_reuse('aa000000-0000-7000-8000-000000000001')),
  least(current_setting('test.contacts_v1')::int, 50), 'B4 doorhost can reuse the address book');

select pg_temp.login('44444444-4444-4444-8444-444444444444');  -- organizer
select is(
  (select count(*)::int from public.search_contacts_for_reuse('aa000000-0000-7000-8000-000000000001')),
  least(current_setting('test.contacts_v1')::int, 50), 'B5 organizer can reuse the address book');

select pg_temp.login_anon();
select throws_ok(
  $$ select * from public.search_contacts_for_reuse('aa000000-0000-7000-8000-000000000001') $$,
  '42501', null, 'B6 anon cannot call the reuse-search RPC');

reset role;

-- ---------------------------------------------------------------------------
-- C. INSERT — admin + organizer only
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$
  insert into public.contacts (venue_id, full_name, email)
  values ('aa000000-0000-7000-8000-000000000001', 'Nieuw Contact Admin', 'nieuw-admin@example.test')
$$, 'C1 admin inserts a venue contact');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  insert into public.contacts (venue_id, full_name)
  values ('aa000000-0000-7000-8000-000000000001', 'Nieuw Contact Organisator')
$$, 'C2 organizer inserts a venue contact');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  insert into public.contacts (venue_id, full_name)
  values ('aa000000-0000-7000-8000-000000000001', 'Stiekem Staff Contact')
$$, '42501', null, 'C3 staff cannot insert into the address book');

select pg_temp.login('33333333-3333-4333-8333-333333333333');
select throws_ok($$
  insert into public.contacts (venue_id, full_name)
  values ('aa000000-0000-7000-8000-000000000001', 'Finance Contact')
$$, '42501', null, 'C4 finance is read-only — cannot insert');

reset role;

-- ---------------------------------------------------------------------------
-- D. UPDATE (toggle is_permanent) — admin + organizer; staff cannot
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(pg_temp.rowcount($$
  update public.contacts set is_permanent = false
  where id = 'c0000000-0000-7000-8000-000000000001'
$$), 1, 'D1 admin toggles is_permanent');

select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(pg_temp.rowcount($$
  update public.contacts set is_permanent = true
  where id = 'c0000000-0000-7000-8000-000000000003'
$$), 1, 'D2 organizer toggles is_permanent');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(pg_temp.rowcount($$
  update public.contacts set is_permanent = true
  where id = 'c0000000-0000-7000-8000-000000000001'
$$), 0, 'D3 staff update matches zero rows (RLS denies)');

reset role;

-- ---------------------------------------------------------------------------
-- E. DELETE — nobody (soft-delete/anonymise only, #21/#29)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$
  delete from public.contacts where id = 'c0000000-0000-7000-8000-000000000001'
$$, '42501', null, 'E1 even admin cannot hard-delete a contact');

reset role;

select * from finish();
rollback;
