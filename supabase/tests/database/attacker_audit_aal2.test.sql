-- pgTAP — ATTACKER suite (security-audit 4.2): audit-tamper + AAL2 step-down.
-- Run: supabase test db. NEW file.
--
-- Two fraud guards under attack:
--   * Audit immutability (#4): audit_log is written ONLY by triggers. App roles
--     hold SELECT and nothing else — so even an admin with AAL2 (who may READ it)
--     cannot insert a forged row, alter a diff, or delete history. 42501 each.
--   * MFA optionality (CLAUDE.md §Auth): post-migration 20260702120000 the
--     second factor is FULLY OPTIONAL — no action requires AAL2 anymore. The
--     venue-role checks are the boundary: quota grants, event-organizer
--     assignment, audit-log reads AND membership role changes all succeed at
--     AAL1 for the right role, and keep failing for the wrong role.
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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(10);

-- ---------------------------------------------------------------------------
-- A. Audit log is append-only via triggers — no app role can tamper with it
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');

select throws_ok($$
  insert into public.audit_log (actor_id, venue_id, entity_type, entity_id, action)
  values ('11111111-1111-4111-8111-111111111111',
          'aa000000-0000-7000-8000-000000000001',
          'guests', 'cc000000-0000-7000-8000-000000000001', 'forged_entry')
$$, '42501', null, 'A1 admin+AAL2 cannot INSERT a forged audit row (triggers are the only writer)');

select throws_ok($$
  update public.audit_log set action = 'tampered'
$$, '42501', null, 'A2 admin+AAL2 cannot UPDATE an audit row (alter a diff)');

select throws_ok($$
  delete from public.audit_log
$$, '42501', null, 'A3 admin+AAL2 cannot DELETE audit history');

reset role;

-- ---------------------------------------------------------------------------
-- B. Who may READ the audit log: admin/finance, role-only (AAL2 dropped, #4 /
--    migration 20260624160000). Wrong-role still sees nothing.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select count(*)::int from public.audit_log), 0,
  'B1 staff sees no audit rows (not admin/finance)');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');
select ok((select count(*)::int from public.audit_log) > 0,
  'B2 admin on an AAL1 session now reads the audit trail (role-only, no step-up)');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select ok((select count(*)::int from public.audit_log) > 0,
  'B3 admin WITH AAL2 still reads the audit trail');
reset role;

-- ---------------------------------------------------------------------------
-- C. After migration 20260702120000 MFA is fully optional: quota grants,
--    MEMBERSHIP role grants and event-organizer assignment are all role-only
--    and succeed at AAL1. (Deliberate rewrite of the old AAL2-denial cases —
--    the wrong-ROLE denials live in rls.test.sql.)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal1');

-- Quota grant: role-only now → the AAL1 admin's update lands on its row.
select is(
  pg_temp.rowcount($$update public.quotas set default_count = 99
              where venue_id = 'aa000000-0000-7000-8000-000000000001'
                and user_id = '55555555-5555-4555-8555-555555555555'$$),
  1, 'C1 AAL1 admin may grant quota (role-only, MFA no longer required)');

-- Role grant: role-only since 20260702120000 → the AAL1 admin may grant.
-- (Was an AAL2-denial test; deliberately flipped with the optional-MFA decision.)
select lives_ok($$
  insert into public.venue_memberships (venue_id, user_id, roles)
  values ('aa000000-0000-7000-8000-000000000001',
          '44444444-4444-4444-8444-444444444444', '{staff}')
$$, 'C2 AAL1 admin may grant a membership (role-only, MFA optional)');

-- Organizer assignment is now role-only — an AAL1 admin may assign.
select lives_ok($$
  insert into public.event_organizers (event_id, user_id)
  values ('ee000000-0000-7000-8000-000000000001',
          '55555555-5555-4555-8555-555555555555')
$$, 'C3 AAL1 admin may assign an event organizer (role-only)');

reset role;

-- Anchor: the same quota grant still succeeds at AAL2 (role check holds either way).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
select is(
  pg_temp.rowcount($$update public.quotas set default_count = 11
              where venue_id = 'aa000000-0000-7000-8000-000000000001'
                and user_id = '55555555-5555-4555-8555-555555555555'$$),
  1, 'C4 admin WITH AAL2 may still grant quota');
reset role;

select * from finish();

rollback;
