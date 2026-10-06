-- pgTAP — z8uq9m2x43: a forgotten (anonymized) contact is read-only and never
-- goes onto an event again (migration 20261007100000).
--
-- Fixtures (as owner, rolled back): in venue aa..01, contact F ("Forget Me")
-- is forgotten through the real forget_contact() as the seed admin; contact L
-- ("Live One") stays live. Seed event ee..01 (venue aa..01) with tier dd..01.
-- Roles: 111 admin (both venues), 222 user_manager, 444 organizer of ee..01,
-- 555 staff. Each role gets an allowed and a denied case.

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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(33);

insert into public.contacts (id, venue_id, full_name, email, phone, note, source) values
  ('c0000000-0000-7000-8000-00000000f001', 'aa000000-0000-7000-8000-000000000001',
   'Forget Me', 'forget.me@example.test', '+31600000901', 'likes gin', 'manual'),
  ('c0000000-0000-7000-8000-00000000f002', 'aa000000-0000-7000-8000-000000000001',
   'Live One', 'live.one@example.test', '+31600000902', null, 'manual');

-- Forget F the real way: admin of the venue calls forget_contact().
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select public.forget_contact('c0000000-0000-7000-8000-00000000f001');
reset role;

select ok(
  (select anonymized_at is not null and email is null and full_name like 'Contact #%'
     from public.contacts where id = 'c0000000-0000-7000-8000-00000000f001'),
  '0 fixture: F is forgotten (anonymized, PII nulled)');
select set_config('test.f_name',
  (select full_name from public.contacts where id = 'c0000000-0000-7000-8000-00000000f001'), true);

-- ---------------------------------------------------------------------------
-- A. admin
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');

select is(pg_temp.rowcount($$
  update public.contacts set note = 'still here?'
   where id = 'c0000000-0000-7000-8000-00000000f002'
$$), 1, 'A1 admin can still edit a LIVE contact');

select is(pg_temp.rowcount($$
  update public.contacts set full_name = 'Back from the dead', email = 'x@example.test'
   where id = 'c0000000-0000-7000-8000-00000000f001'
$$), 0, 'A2 admin raw PATCH on a forgotten contact matches zero rows');

select throws_ok($$
  select public.add_contact_to_event('c0000000-0000-7000-8000-00000000f001',
    'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001', 0)
$$, 'P0002', null, 'A3 admin single add of a forgotten contact is refused (generic not-found)');

select is(
  public.add_contacts_to_event('ee000000-0000-7000-8000-000000000001',
    array['c0000000-0000-7000-8000-00000000f001', 'c0000000-0000-7000-8000-00000000f002']::uuid[],
    'dd000000-0000-7000-8000-000000000001'),
  '{"added": 1, "already": 0, "skipped": 1}'::jsonb,
  'A4 admin bulk add skips the forgotten contact, adds the live one');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source, contact_id)
  values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
          'Sneaky', '11111111-1111-4111-8111-111111111111', 'app',
          'c0000000-0000-7000-8000-00000000f001')
$$, '23514', null, 'A5 admin raw guest INSERT linked to a forgotten contact is refused');

select throws_ok($$
  insert into public.contacts (venue_id, full_name, email, source, anonymized_at)
  values ('aa000000-0000-7000-8000-000000000001', 'Born Forgotten',
          'born@example.test', 'manual', now())
$$, '42501', null, 'A6 admin cannot insert a contact that is born anonymized');

select throws_ok($$
  update public.contacts set anonymized_at = now(), email = null, phone = null
   where id = 'c0000000-0000-7000-8000-00000000f002'
$$, '42501', null, 'A7 admin cannot self-anonymize a live contact by PATCH');

select is(
  (public.forget_contact('c0000000-0000-7000-8000-00000000f001') ->> 'contact_anonymized')::boolean,
  false, 'A8 forget_contact on an already-forgotten contact is a clean no-op');

-- ---------------------------------------------------------------------------
-- B. organizer of ee..01
-- ---------------------------------------------------------------------------
select pg_temp.login('44444444-4444-4444-8444-444444444444');

select is(pg_temp.rowcount($$
  update public.contacts set note = 'organizer note'
   where id = 'c0000000-0000-7000-8000-00000000f002'
$$), 1, 'B1 organizer can still edit a LIVE contact');

select is(pg_temp.rowcount($$
  update public.contacts set note = 'organizer note'
   where id = 'c0000000-0000-7000-8000-00000000f001'
$$), 0, 'B2 organizer raw PATCH on a forgotten contact matches zero rows');

select throws_ok($$
  select public.add_contact_to_event('c0000000-0000-7000-8000-00000000f001',
    'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001', 0)
$$, 'P0002', null, 'B3 organizer single add of a forgotten contact is refused');

select is(
  public.add_contacts_to_event('ee000000-0000-7000-8000-000000000001',
    array['c0000000-0000-7000-8000-00000000f001']::uuid[],
    'dd000000-0000-7000-8000-000000000001') ->> 'skipped',
  '1', 'B4 organizer bulk add skips the forgotten contact');

-- ---------------------------------------------------------------------------
-- C. staff — no contacts access at all; the guest-side backstop holds
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555');

select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
          'Staff Plain Add', '55555555-5555-4555-8555-555555555555', 'app')
$$, 'C1 staff can still add an unlinked guest');

select is(pg_temp.rowcount($$
  update public.contacts set note = 'staff'
   where id = 'c0000000-0000-7000-8000-00000000f001'
$$), 0, 'C2 staff raw PATCH on a forgotten contact matches zero rows');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source, contact_id)
  values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
          'Staff Sneaky', '55555555-5555-4555-8555-555555555555', 'app',
          'c0000000-0000-7000-8000-00000000f001')
$$, '23514', null, 'C3 staff raw guest INSERT linked to a forgotten contact is refused');

select throws_ok($$
  select public.add_contact_to_event('c0000000-0000-7000-8000-00000000f001',
    'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001', 0)
$$, 'P0002', null, 'C4 staff single add of a forgotten contact is refused');

select throws_ok($$
  select public.add_contacts_to_event('ee000000-0000-7000-8000-000000000001',
    array['c0000000-0000-7000-8000-00000000f001']::uuid[], null)
$$, '42501', null, 'C5 staff cannot bulk add at all');

-- ---------------------------------------------------------------------------
-- D. user_manager — no contacts access
-- ---------------------------------------------------------------------------
select pg_temp.login('22222222-2222-4222-8222-222222222222');

select is(pg_temp.rowcount($$
  update public.contacts set note = 'um'
   where id = 'c0000000-0000-7000-8000-00000000f001'
$$), 0, 'D1 user_manager raw PATCH on a forgotten contact matches zero rows');

select throws_ok($$
  insert into public.contacts (venue_id, full_name, source, anonymized_at)
  values ('aa000000-0000-7000-8000-000000000001', 'UM Forgotten', 'manual', now())
$$, '42501', null, 'D2 user_manager cannot insert an anonymized contact');

-- ---------------------------------------------------------------------------
-- E. The table guard holds where RLS does not: owner / SECURITY DEFINER bodies
--    and service_role (both bypass RLS).
-- ---------------------------------------------------------------------------
reset role;

select throws_ok($$
  update public.contacts set note = 'owner write'
   where id = 'c0000000-0000-7000-8000-00000000f001'
$$, '42501', null, 'E1 even the owner cannot change a forgotten contact');

select throws_ok($$
  update public.contacts set is_permanent = true
   where id = 'c0000000-0000-7000-8000-00000000f001'
$$, '42501', null, 'E2 a forgotten contact cannot be made Regular (permanent sync) again');

select throws_ok($$
  update public.contacts set anonymized_at = now()
   where id = 'c0000000-0000-7000-8000-00000000f002'
$$, '42501', null, 'E3 the anonymize transition must null the PII');

select lives_ok($$ select public.run_privacy_retention() $$,
  'E4 the retention sweep still runs over a venue holding a forgotten contact');

set local role service_role;
select throws_ok($$
  update public.contacts set full_name = 'svc'
   where id = 'c0000000-0000-7000-8000-00000000f001'
$$, '42501', null, 'E5 service_role cannot change a forgotten contact');
select throws_ok($$
  insert into public.contacts (venue_id, full_name, source, anonymized_at)
  values ('aa000000-0000-7000-8000-000000000001', 'Svc Forgotten', 'manual', now())
$$, '42501', null, 'E6 service_role cannot insert an anonymized contact');
select throws_ok($$
  update public.contacts set anonymized_at = now(), email = null, phone = null,
         birthdate = null, note = null
   where id = 'c0000000-0000-7000-8000-00000000f002'
$$, '42501', null, 'E7 service_role cannot anonymize a contact either');
reset role;

-- E8: the legitimate anonymize transition (owner, PII nulled) still works —
-- what forget_contact / run_privacy_retention do.
select lives_ok($$
  update public.contacts set full_name = 'Contact #999', email = null, phone = null,
         birthdate = null, note = null, is_permanent = false, anonymized_at = now()
   where id = 'c0000000-0000-7000-8000-00000000f002'
$$, 'E8 the owner-run anonymize transition (PII nulled) is admitted');

-- ---------------------------------------------------------------------------
-- F. State: nothing above changed the forgotten row or linked it anywhere new.
-- ---------------------------------------------------------------------------
select is(
  (select full_name from public.contacts where id = 'c0000000-0000-7000-8000-00000000f001'),
  current_setting('test.f_name'), 'F1 the forgotten contact still carries its handle');
select ok(
  (select email is null and phone is null and note is null and not is_permanent
     from public.contacts where id = 'c0000000-0000-7000-8000-00000000f001'),
  'F2 the forgotten contact still has no PII and is not Regular');
select is(
  (select count(*)::int from public.guests where contact_id = 'c0000000-0000-7000-8000-00000000f001'),
  0, 'F3 the forgotten contact is on no guest list');
select is(
  (select count(*)::int from public.guests
    where contact_id = 'c0000000-0000-7000-8000-00000000f002'
      and event_id = 'ee000000-0000-7000-8000-000000000001'),
  1, 'F4 the live contact WAS added by the bulk add (A4)');

-- Not a callable RPC.
select ok(
  not has_function_privilege('authenticated', 'public.guard_contact_anonymized()', 'execute'),
  'F5 authenticated cannot execute the guard function directly');

select * from finish();
rollback;
