-- pgTAP — ATTACKER suite (security-audit 4.2): hard-delete refused / soft-delete
-- enforced (#21) + offline-outbox replay safety (#25). Run: supabase test db.
-- NEW file.
--
-- Guest data carries history, so a hard DELETE is revoked at the GRANT level for
-- every app role — even admin, even service_role (a destroyed guest/check-in/
-- refusal can never be audited). Removal is a soft delete (status='removed'); the
-- row stays. The offline outbox replays idempotent upserts, so the DB must make a
-- replay harmless: a second check-in for a guest (same row, or a second device)
-- is rejected by the unique key, and a no-op replay writes no audit noise.
-- Seed venue aa..01, event ee..01. Everything rolls back.

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

select plan(10);

-- ---------------------------------------------------------------------------
-- A. Hard delete is impossible for app roles (#21) — history is protected
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$ delete from public.guests where full_name = 'Femke Aalders' $$,
  '42501', null, 'A1 staff cannot hard-delete a guest');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select throws_ok($$ delete from public.guests where id = 'cc000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'A2 even an admin cannot hard-delete a guest');
select throws_ok($$ delete from public.check_ins $$,
  '42501', null, 'A3 even an admin cannot delete a check-in (offline-synced history)');
reset role;

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$ delete from public.refusals $$,
  '42501', null, 'A4 a doorhost cannot delete a refusal (immutable history)');
reset role;

-- ---------------------------------------------------------------------------
-- B. Soft delete keeps the row (status -> removed, never gone)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok($$ update public.guests set status = 'removed'
  where full_name = 'Femke Aalders' $$,
  'B1 staff soft-deletes their own guest (status -> removed)');
reset role;

select is(
  (select status::text from public.guests where full_name = 'Femke Aalders'),
  'removed', 'B2 the row physically remains after a soft delete (#21)');

-- ---------------------------------------------------------------------------
-- C. Outbox replay: a check-in is one row per guest, ever
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  insert into public.check_ins (id, guest_id, checked_by)
  values ('cc000000-0000-7000-8000-0000000000c7',
          'cc000000-0000-7000-8000-000000000008',
          '66666666-6666-4666-8666-666666666666')
$$, 'C1 doorhost checks a guest in');

-- Replaying the SAME outbox row (same PK) cannot create a duplicate.
select throws_ok($$
  insert into public.check_ins (id, guest_id, checked_by)
  values ('cc000000-0000-7000-8000-0000000000c7',
          'cc000000-0000-7000-8000-000000000008',
          '66666666-6666-4666-8666-666666666666')
$$, '23505', null, 'C2 replaying the same check-in row is rejected (PK)');

-- A SECOND device recording the same guest is rejected by UNIQUE(guest_id).
select throws_ok($$
  insert into public.check_ins (id, guest_id, checked_by)
  values ('cc000000-0000-7000-8000-0000000000c8',
          'cc000000-0000-7000-8000-000000000008',
          '66666666-6666-4666-8666-666666666666')
$$, '23505', null, 'C3 a second device cannot double-check-in the same guest');
reset role;

-- A no-op replay (an UPDATE that changes nothing) writes NO audit row (#25). The
-- audit diff excludes updated_at, so an idempotent replay is silent. Measured as
-- owner so the count is not RLS-scoped.
create temp table audit_before as
  select count(*)::int c from public.audit_log
   where entity_id = 'cc000000-0000-7000-8000-000000000003';

update public.guests set full_name = full_name
  where id = 'cc000000-0000-7000-8000-000000000003';

select is(
  (select count(*)::int from public.audit_log
    where entity_id = 'cc000000-0000-7000-8000-000000000003'),
  (select c from audit_before),
  'C4 a no-op replay writes no new audit row (idempotent outbox, #25)');

select * from finish();

rollback;
