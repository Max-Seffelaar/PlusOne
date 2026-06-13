-- pgTAP — Fase 3: audit-triggers (run: supabase test db)
-- Proves per mutation type: exactly one audit entry, correct derived action,
-- correct actor/venue/event scope, minimal JSONB diff (changed fields only),
-- device-id resolution (header > JWT claim > row), and that the log is
-- append-only for every app role. Relies on the standard seed; rolls back.

begin;

create extension if not exists pgtap with schema extensions;

-- Identity helpers: PostgREST-style JWT claims + role switch (as rls.test.sql).
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- Audit inspection helpers — call after `reset role` (owner bypasses RLS).
create function pg_temp.audit_n(p_entity uuid, p_action text)
returns int language sql as $fn$
  select count(*)::int from public.audit_log
  where entity_id = p_entity and action = p_action;
$fn$;

create function pg_temp.audit_row(p_entity uuid, p_action text)
returns public.audit_log language sql as $fn$
  select a from public.audit_log a
  where a.entity_id = p_entity and a.action = p_action
  order by a.id desc limit 1;
$fn$;

select plan(55);

-- ---------------------------------------------------------------------------
-- A. seed coverage — triggers fired during seeding, actor NULL = system
-- ---------------------------------------------------------------------------

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000001', 'create'), 1,
  'A1 seeded guest has exactly one create entry');

select ok(
  (pg_temp.audit_row('cc000000-0000-7000-8000-000000000001', 'create')).actor_id is null
  and (pg_temp.audit_row('cc000000-0000-7000-8000-000000000001', 'create')).venue_id
      = 'aa000000-0000-7000-8000-000000000001'
  and (pg_temp.audit_row('cc000000-0000-7000-8000-000000000001', 'create')).event_id
      = 'ee000000-0000-7000-8000-000000000001',
  'A2 seed entry: system actor (null) with venue + event scope resolved');

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'check_ins' and action = 'check_in'), 3,
  'A3 every seeded check-in produced a check_in entry');

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'refusals' and action = 'refuse'), 1,
  'A4 the seeded refusal produced a refuse entry');

-- ---------------------------------------------------------------------------
-- B. guests INSERT — create entry with actor + scope + after-snapshot
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
insert into public.guests (id, event_id, tier_id, full_name, added_by)
values ('cc000000-0000-7000-8000-000000000101',
        'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001',
        'Audit Gast', '55555555-5555-4555-8555-555555555555');
reset role;

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000101', 'create'), 1,
  'B1 guest insert writes exactly one create entry');

select is(
  (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'create')).actor_id,
  '55555555-5555-4555-8555-555555555555'::uuid,
  'B2 actor is the authenticated user (auth.uid())');

select ok(
  (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'create')).entity_type = 'guests'
  and (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'create')).venue_id
      = 'aa000000-0000-7000-8000-000000000001'
  and (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'create')).event_id
      = 'ee000000-0000-7000-8000-000000000001',
  'B3 entry carries entity_type guests + venue/event of the row');

select ok(
  (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'create')).diff -> 'before' = 'null'::jsonb
  and (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'create')).diff -> 'after' ->> 'full_name'
      = 'Audit Gast',
  'B4 create diff: before null, after holds the full row snapshot');

-- ---------------------------------------------------------------------------
-- C. guests UPDATE — minimal diff; a no-op replay logs nothing (#25)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.guests set plus_ones = 2
where id = 'cc000000-0000-7000-8000-000000000101';
reset role;

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000101', 'update'), 1,
  'C1 guest update writes exactly one update entry');

select is(
  (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'update')).diff,
  '{"before": {"plus_ones": 0}, "after": {"plus_ones": 2}}'::jsonb,
  'C2 diff contains ONLY the changed field (updated_at excluded)');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.guests set plus_ones = 2
where id = 'cc000000-0000-7000-8000-000000000101';
reset role;

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000101', 'update'), 1,
  'C3 idempotent replay (no actual change) writes NO entry');

-- ---------------------------------------------------------------------------
-- D. guests — derived actions: check_in / refuse / delete (soft) / tier_change
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.guests set status = 'checked_in'
where id = 'cc000000-0000-7000-8000-000000000101';
reset role;

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000101', 'check_in'), 1,
  'D1 status -> checked_in derives action check_in');

select is(
  (pg_temp.audit_row('cc000000-0000-7000-8000-000000000101', 'check_in')).diff,
  '{"before": {"status": "approved"}, "after": {"status": "checked_in"}}'::jsonb,
  'D2 check_in diff shows exactly the status transition');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.guests set status = 'refused'
where id = 'cc000000-0000-7000-8000-000000000101';
reset role;

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000101', 'refuse'), 1,
  'D3 status -> refused derives action refuse');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.guests set status = 'removed'
where id = 'cc000000-0000-7000-8000-000000000101';
reset role;

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000101', 'delete'), 1,
  'D4 soft delete (status -> removed, #21) derives action delete');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.guests (id, event_id, tier_id, full_name, added_by)
values ('cc000000-0000-7000-8000-000000000102',
        'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001',
        'Tier Wissel Gast', '11111111-1111-4111-8111-111111111111');
update public.guests set tier_id = 'dd000000-0000-7000-8000-000000000002'
where id = 'cc000000-0000-7000-8000-000000000102';
reset role;

select is(
  pg_temp.audit_n('cc000000-0000-7000-8000-000000000102', 'tier_change'), 1,
  'D5 tier move derives action tier_change');

select is(
  (pg_temp.audit_row('cc000000-0000-7000-8000-000000000102', 'tier_change')).diff,
  '{"before": {"tier_id": "dd000000-0000-7000-8000-000000000001"}, "after": {"tier_id": "dd000000-0000-7000-8000-000000000002"}}'::jsonb,
  'D6 tier_change diff shows exactly the tier transition');

-- ---------------------------------------------------------------------------
-- E. check_ins INSERT — check_in entry, scope via guest, row device fallback
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
insert into public.check_ins (id, guest_id, checked_by, device_id, plus_ones_arrived)
values ('bb000000-0000-7000-8000-000000000201',
        'cc000000-0000-7000-8000-000000000001',
        '66666666-6666-4666-8666-666666666666', 'door-ipad-07', 1);
reset role;

select is(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000201', 'check_in'), 1,
  'E1 check-in insert writes exactly one check_in entry');

select ok(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000201', 'check_in')).entity_type = 'check_ins'
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000201', 'check_in')).actor_id
      = '66666666-6666-4666-8666-666666666666',
  'E2 check_in entry: entity_type check_ins, actor = doorhost');

select ok(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000201', 'check_in')).event_id
      = 'ee000000-0000-7000-8000-000000000001'
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000201', 'check_in')).venue_id
      = 'aa000000-0000-7000-8000-000000000001',
  'E3 venue/event resolved via the guest row');

select is(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000201', 'check_in')).device_id,
  'door-ipad-07',
  'E4 without request context the row device_id is used');

-- ---------------------------------------------------------------------------
-- F. refusals INSERT — refuse entry; device from header, then JWT claim
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select set_config('request.headers', '{"x-device-id": "door-ipad-99"}', true);
insert into public.refusals (id, guest_id, refused_by, reason)
values ('bb000000-0000-7000-8000-000000000301',
        'cc000000-0000-7000-8000-000000000008',
        '66666666-6666-4666-8666-666666666666', 'Geen geldig ID');
reset role;

select is(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000301', 'refuse'), 1,
  'F1 refusal insert writes exactly one refuse entry');

select is(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000301', 'refuse')).device_id,
  'door-ipad-99',
  'F2 device_id comes from the x-device-id request header');

select ok(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000301', 'refuse')).actor_id
      = '66666666-6666-4666-8666-666666666666'
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000301', 'refuse')).event_id
      = 'ee000000-0000-7000-8000-000000000001',
  'F3 refuse entry carries actor and event scope');

-- Clear the header; offer a device_id JWT claim instead.
select set_config('request.headers', '', true);
select set_config('request.jwt.claims', json_build_object(
  'sub', '66666666-6666-4666-8666-666666666666', 'role', 'authenticated',
  'aal', 'aal1', 'device_id', 'claim-device-12')::text, true);
select set_config('role', 'authenticated', true);
insert into public.refusals (id, guest_id, refused_by, reason)
values ('bb000000-0000-7000-8000-000000000302',
        'cc000000-0000-7000-8000-000000000008',
        '66666666-6666-4666-8666-666666666666', 'Tweede weigering');
reset role;

select ok(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000302', 'refuse') = 1
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000302', 'refuse')).device_id
      = 'claim-device-12',
  'F4 without header the device_id JWT claim is used');

-- ---------------------------------------------------------------------------
-- G. quotas — raise = quota_grant, lower = update, new row = quota_grant
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.quotas set default_count = 15
where venue_id = 'aa000000-0000-7000-8000-000000000001'
  and user_id = '55555555-5555-4555-8555-555555555555';
reset role;

-- The seeded INSERT of this row already logged its own quota_grant (system
-- actor), so the raise is pinned on the acting admin.
select is(
  (select count(*)::int from public.audit_log
   where entity_id = (select id from public.quotas
                      where venue_id = 'aa000000-0000-7000-8000-000000000001'
                        and user_id = '55555555-5555-4555-8555-555555555555')
     and action = 'quota_grant'
     and actor_id = '11111111-1111-4111-8111-111111111111'), 1,
  'G1 raising a quota derives action quota_grant');

select is(
  (pg_temp.audit_row(
    (select id from public.quotas
     where venue_id = 'aa000000-0000-7000-8000-000000000001'
       and user_id = '55555555-5555-4555-8555-555555555555'),
    'quota_grant')).diff,
  '{"before": {"default_count": 10}, "after": {"default_count": 15}}'::jsonb,
  'G2 quota_grant diff shows exactly the raise');

select ok(
  (pg_temp.audit_row(
    (select id from public.quotas
     where venue_id = 'aa000000-0000-7000-8000-000000000001'
       and user_id = '55555555-5555-4555-8555-555555555555'),
    'quota_grant')).venue_id = 'aa000000-0000-7000-8000-000000000001'
  and (pg_temp.audit_row(
    (select id from public.quotas
     where venue_id = 'aa000000-0000-7000-8000-000000000001'
       and user_id = '55555555-5555-4555-8555-555555555555'),
    'quota_grant')).event_id is null,
  'G3 venue quota entry is venue-scoped, no event');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.quotas set default_count = 13
where venue_id = 'aa000000-0000-7000-8000-000000000001'
  and user_id = '55555555-5555-4555-8555-555555555555';
reset role;

select is(
  pg_temp.audit_n(
    (select id from public.quotas
     where venue_id = 'aa000000-0000-7000-8000-000000000001'
       and user_id = '55555555-5555-4555-8555-555555555555'),
    'update'), 1,
  'G4 lowering a quota is a plain update, not quota_grant');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
insert into public.quotas (id, venue_id, user_id, default_count)
values ('bb000000-0000-7000-8000-000000000601',
        'aa000000-0000-7000-8000-000000000001',
        '22222222-2222-4222-8222-222222222222', 5);
reset role;

select is(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000601', 'quota_grant'), 1,
  'G5 granting a first quota (INSERT) derives quota_grant');

-- ---------------------------------------------------------------------------
-- H. event_quotas — override raise = quota_grant
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.event_quotas set quota_override = 14
where event_id = 'ee000000-0000-7000-8000-000000000001'
  and user_id = '55555555-5555-4555-8555-555555555555';
reset role;

-- As in G1: the seeded INSERT logged a quota_grant of its own.
select is(
  (select count(*)::int from public.audit_log
   where entity_id = (select id from public.event_quotas
                      where event_id = 'ee000000-0000-7000-8000-000000000001'
                        and user_id = '55555555-5555-4555-8555-555555555555')
     and action = 'quota_grant'
     and actor_id = '11111111-1111-4111-8111-111111111111'), 1,
  'H1 raising an event override derives quota_grant');

select is(
  (pg_temp.audit_row(
    (select id from public.event_quotas
     where event_id = 'ee000000-0000-7000-8000-000000000001'
       and user_id = '55555555-5555-4555-8555-555555555555'),
    'quota_grant')).diff,
  '{"before": {"quota_override": 12}, "after": {"quota_override": 14}}'::jsonb,
  'H2 event quota_grant diff shows exactly the raise');

-- ---------------------------------------------------------------------------
-- I. quota_requests — create by staff; decision = approve / deny (#5)
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');
insert into public.quota_requests (id, event_id, user_id, requested_extra)
values ('bb000000-0000-7000-8000-000000000401',
        'ee000000-0000-7000-8000-000000000001',
        '55555555-5555-4555-8555-555555555555', 2);
reset role;

select ok(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000401', 'create') = 1
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000401', 'create')).actor_id
      = '55555555-5555-4555-8555-555555555555',
  'I1 quota request gets its own create entry with the requester as actor');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.quota_requests
set status = 'approved',
    decided_by = '11111111-1111-4111-8111-111111111111',
    decided_at = now()
where id = 'bb000000-0000-7000-8000-000000000401';
reset role;

select is(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000401', 'approve'), 1,
  'I2 approving a quota request derives action approve');

select ok(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000401', 'approve')).actor_id
      = '11111111-1111-4111-8111-111111111111'
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000401', 'approve')).diff -> 'before' ->> 'status'
      = 'pending'
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000401', 'approve')).diff -> 'after' ->> 'status'
      = 'approved',
  'I3 approve entry: deciding admin as actor, status transition in diff');

select pg_temp.login('55555555-5555-4555-8555-555555555555');
insert into public.quota_requests (id, event_id, user_id, requested_extra)
values ('bb000000-0000-7000-8000-000000000402',
        'ee000000-0000-7000-8000-000000000001',
        '55555555-5555-4555-8555-555555555555', 1);
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');
update public.quota_requests
set status = 'denied',
    decided_by = '11111111-1111-4111-8111-111111111111',
    decided_at = now(),
    decision_reason = 'Vol'
where id = 'bb000000-0000-7000-8000-000000000402';
reset role;

select is(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000402', 'deny'), 1,
  'I4 denying a quota request derives action deny');

select ok(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000402', 'deny')).diff -> 'after' ->> 'status'
      = 'denied'
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000402', 'deny')).diff -> 'after' ->> 'decision_reason'
      = 'Vol',
  'I5 deny diff carries the decision and its reason');

-- ---------------------------------------------------------------------------
-- J. venue_memberships — create / role update / delete, full lifecycle
-- ---------------------------------------------------------------------------

select pg_temp.login('22222222-2222-4222-8222-222222222222', 'aal2');
insert into public.venue_memberships (id, venue_id, user_id, roles)
values ('bb000000-0000-7000-8000-000000000501',
        'aa000000-0000-7000-8000-000000000001',
        '44444444-4444-4444-8444-444444444444', '{staff}');
reset role;

select ok(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000501', 'create') = 1
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000501', 'create')).actor_id
      = '22222222-2222-4222-8222-222222222222'
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000501', 'create')).venue_id
      = 'aa000000-0000-7000-8000-000000000001',
  'J1 membership grant logged with the user_manager as actor');

select pg_temp.login('22222222-2222-4222-8222-222222222222', 'aal2');
update public.venue_memberships set roles = '{staff,doorhost}'
where id = 'bb000000-0000-7000-8000-000000000501';
reset role;

select is(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000501', 'update'), 1,
  'J2 role change writes exactly one update entry');

select is(
  (pg_temp.audit_row('bb000000-0000-7000-8000-000000000501', 'update')).diff,
  '{"before": {"roles": ["staff"]}, "after": {"roles": ["staff", "doorhost"]}}'::jsonb,
  'J3 role diff shows exactly the roles transition');

select pg_temp.login('22222222-2222-4222-8222-222222222222', 'aal2');
delete from public.venue_memberships
where id = 'bb000000-0000-7000-8000-000000000501';
reset role;

select ok(
  pg_temp.audit_n('bb000000-0000-7000-8000-000000000501', 'delete') = 1
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000501', 'delete')).diff -> 'after'
      = 'null'::jsonb
  and (pg_temp.audit_row('bb000000-0000-7000-8000-000000000501', 'delete')).diff -> 'before' ->> 'user_id'
      = '44444444-4444-4444-8444-444444444444',
  'J4 membership removal keeps the before-snapshot in the log');

-- ---------------------------------------------------------------------------
-- K. events — lock/unlock are audited (#23); other event edits are not
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events
set list_locked = true,
    locked_by = '11111111-1111-4111-8111-111111111111',
    locked_at = now()
where id = 'ee000000-0000-7000-8000-000000000001';
reset role;

select is(
  pg_temp.audit_n('ee000000-0000-7000-8000-000000000001', 'lock'), 1,
  'K1 locking the list writes exactly one lock entry');

select ok(
  (pg_temp.audit_row('ee000000-0000-7000-8000-000000000001', 'lock')).entity_type = 'events'
  and (pg_temp.audit_row('ee000000-0000-7000-8000-000000000001', 'lock')).actor_id
      = '11111111-1111-4111-8111-111111111111'
  and (pg_temp.audit_row('ee000000-0000-7000-8000-000000000001', 'lock')).diff -> 'after' ->> 'list_locked'
      = 'true',
  'K2 lock entry: events entity, locking admin as actor, flag in diff');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events
set list_locked = false, locked_by = null, locked_at = null
where id = 'ee000000-0000-7000-8000-000000000001';
reset role;

select is(
  pg_temp.audit_n('ee000000-0000-7000-8000-000000000001', 'unlock'), 1,
  'K3 unlocking writes exactly one unlock entry');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events set name = 'PLUSONE Launch Night XL'
where id = 'ee000000-0000-7000-8000-000000000001';
reset role;

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'events'
     and entity_id = 'ee000000-0000-7000-8000-000000000001'), 2,
  'K4 other event edits are NOT audited — only lock/unlock');

-- ---------------------------------------------------------------------------
-- L. append-only — no app role can insert, rewrite or erase history (#4)
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
  and not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
  and not has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE'),
  'L1 authenticated: read-only on audit_log');

select ok(
  not has_table_privilege('service_role', 'public.audit_log', 'INSERT')
  and not has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
  and not has_table_privilege('service_role', 'public.audit_log', 'DELETE')
  and not has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE'),
  'L2 service_role: triggers are the only writers, no DML at all');

select ok(
  not has_table_privilege('anon', 'public.audit_log', 'SELECT')
  and not has_table_privilege('anon', 'public.audit_log', 'INSERT')
  and not has_table_privilege('anon', 'public.audit_log', 'UPDATE')
  and not has_table_privilege('anon', 'public.audit_log', 'DELETE'),
  'L3 anon: no access to the audit log whatsoever');

select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');

select throws_ok(
  $$ update public.audit_log set action = 'gewist' $$,
  '42501', null, 'L4 even admin (AAL2) cannot rewrite log entries');

select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null, 'L5 even admin (AAL2) cannot erase log entries');

select throws_ok($$
  insert into public.audit_log (actor_id, venue_id, entity_type, entity_id, action)
  values ('11111111-1111-4111-8111-111111111111',
          'aa000000-0000-7000-8000-000000000001',
          'guests', 'cc000000-0000-7000-8000-000000000001', 'create')
$$, '42501', null, 'L6 entries cannot be forged from the app');

select set_config('role', 'service_role', true);

select throws_ok(
  $$ update public.audit_log set action = 'gewist' $$,
  '42501', null, 'L7 service_role cannot rewrite log entries');

select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null, 'L8 service_role cannot erase log entries');

reset role;

-- ---------------------------------------------------------------------------
-- M. trigger wiring — every audited table carries its trigger
-- ---------------------------------------------------------------------------

select is_empty($$
  select x.t
  from unnest(array['guests', 'guest_tiers', 'quotas', 'event_quotas',
    'quota_requests', 'check_ins', 'refusals', 'venue_memberships']) as x (t)
  where not exists (
    select 1
    from pg_trigger tr
    join pg_class c on c.oid = tr.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = x.t and tr.tgname = 'audit_' || x.t)
$$, 'M1 all eight audited tables have their audit trigger');

select has_trigger('public', 'events', 'audit_events_lock',
  'M2 events carries the lock/unlock audit trigger');

select * from finish();

rollback;
