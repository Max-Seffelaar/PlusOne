-- pgTAP — "Uitchecken toestaan" company-default + per-event override
-- (20260622000000_allow_uncheck_setting.sql). Proves:
--   * the COALESCE resolver event_allows_uncheck (event override -> venue
--     default -> true), both override directions;
--   * the RESTRICTIVE check_ins policy rejects a VOID when uncheck is off,
--     while a revive (re-checkin) and a partial top-up stay allowed;
--   * the toggles are audited — events widened beyond lock/unlock, venues newly
--     audited — and list_locked is still labelled 'lock'.
-- Seed: admin Max (11..1), doorhost Lisa (66..6) on Club Vesper, open event
-- ee..01, tier dd..01.

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

select plan(13);

-- Fixture (owner context, bypasses RLS): a +3 guest checked in with 2 present.
reset role;

insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-00000000c001', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Uncheck Gast', 3,
        '11111111-1111-4111-8111-111111111111');
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-00000000c001', '11111111-1111-4111-8111-111111111111', 2);

-- 1. Default (venue true, event null) -> resolver true.
select is(public.event_allows_uncheck('ee000000-0000-7000-8000-000000000001'), true,
  '1 default (venue true, no override) -> uncheck allowed');

-- 2. Doorhost CAN void when allowed.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
    where guest_id = 'cc000000-0000-7000-8000-00000000c001' and voided_at is null$$),
  1, '2 doorhost voids a check-in when uncheck is allowed');
reset role;
update public.check_ins set voided_at = null, voided_by = null
  where guest_id = 'cc000000-0000-7000-8000-00000000c001';

-- 3. Venue default false (event null) -> resolver false.
update public.venues set allow_uncheck = false where id = (select venue_id from public.events where id = 'ee000000-0000-7000-8000-000000000001');
select is(public.event_allows_uncheck('ee000000-0000-7000-8000-000000000001'), false,
  '3 venue default false -> uncheck blocked');

-- 4. Doorhost CANNOT void when disabled — the RESTRICTIVE WITH CHECK rejects the
--    voided row with a policy violation (42501), not a silent 0-row.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$update public.check_ins
    set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
    where guest_id = 'cc000000-0000-7000-8000-00000000c001' and voided_at is null$$,
  '42501', NULL, '4 doorhost cannot void when uncheck is off (RLS)');
reset role;

-- 5/6. Event override TRUE beats venue false -> resolver true; doorhost may void.
update public.events set allow_uncheck = true where id = 'ee000000-0000-7000-8000-000000000001';
select is(public.event_allows_uncheck('ee000000-0000-7000-8000-000000000001'), true,
  '5 event override true beats venue default false');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
    where guest_id = 'cc000000-0000-7000-8000-00000000c001' and voided_at is null$$),
  1, '6 doorhost voids when an event override re-enables uncheck');
reset role;
update public.check_ins set voided_at = null, voided_by = null
  where guest_id = 'cc000000-0000-7000-8000-00000000c001';

-- 7/8. Event override FALSE beats venue true -> resolver false; doorhost blocked.
update public.venues set allow_uncheck = true where id = (select venue_id from public.events where id = 'ee000000-0000-7000-8000-000000000001');
update public.events set allow_uncheck = false where id = 'ee000000-0000-7000-8000-000000000001';
select is(public.event_allows_uncheck('ee000000-0000-7000-8000-000000000001'), false,
  '7 event override false beats venue default true');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$update public.check_ins
    set voided_at = now(), voided_by = '66666666-6666-4666-8666-666666666666'
    where guest_id = 'cc000000-0000-7000-8000-00000000c001' and voided_at is null$$,
  '42501', NULL, '8 doorhost cannot void when an event override disables uncheck');
reset role;

-- 9. Even with uncheck OFF: a revive (re-checkin) is still allowed. Owner voids
--    the row first (setup), then the doorhost clears the void.
update public.check_ins set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
  where guest_id = 'cc000000-0000-7000-8000-00000000c001';
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(pg_temp.rowcount($$update public.check_ins
    set voided_at = null, voided_by = null, plus_ones_arrived = 0
    where guest_id = 'cc000000-0000-7000-8000-00000000c001'$$),
  1, '9 revive (re-checkin) allowed even when uncheck is off');
reset role;

-- 10. Even with uncheck OFF: a partial top-up (raise arrivals) is still allowed.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(pg_temp.rowcount($$update public.check_ins set plus_ones_arrived = 2
    where guest_id = 'cc000000-0000-7000-8000-00000000c001'$$),
  1, '10 partial top-up allowed even when uncheck is off');
reset role;

-- ── Audit coverage ─────────────────────────────────────────────────────────
-- 11. Toggling venues.allow_uncheck is audited (admin, user-scoped -> real actor).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.venues set allow_uncheck = false where id = (select venue_id from public.events where id = 'ee000000-0000-7000-8000-000000000001');
select is((select count(*) from public.audit_log
    where entity_type = 'venues' and actor_id = '11111111-1111-4111-8111-111111111111'
      and action = 'update' and diff -> 'after' ->> 'allow_uncheck' = 'false'),
  1::bigint, '11 venue allow_uncheck change is audited');
reset role;

-- 12. Toggling events.allow_uncheck is audited as a plain 'update' (not lock/unlock).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.events set allow_uncheck = null where id = 'ee000000-0000-7000-8000-000000000001';
select is((select count(*) from public.audit_log
    where entity_type = 'events' and actor_id = '11111111-1111-4111-8111-111111111111'
      and action = 'update' and diff -> 'after' ? 'allow_uncheck'),
  1::bigint, '12 event allow_uncheck change is audited as update');
reset role;

-- 13. list_locked still logs as 'lock' (regression on the widened events trigger).
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.events set list_locked = true, locked_by = '11111111-1111-4111-8111-111111111111',
  locked_at = now() where id = 'ee000000-0000-7000-8000-000000000001';
select is((select count(*) from public.audit_log
    where entity_type = 'events' and actor_id = '11111111-1111-4111-8111-111111111111'
      and action = 'lock'),
  1::bigint, '13 list_locked still audited as lock');
reset role;

select * from finish();

rollback;
