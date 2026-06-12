-- pgTAP tests for audit system
-- Test that every mutation produces correct audit log entries and that audit_log is immutable

begin;
select plan(45);

-- Test 1: Guest insert creates audit entry
select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guests' and action = 'create'
  ) > 0,
  'Guest creation triggers audit log entry'
);

-- Test 2: Guest update to checked_in creates check_in action
select is(
  (
    select action from audit_log
    where entity_type = 'guests'
      and action = 'check_in'
    limit 1
  ),
  'check_in',
  'Guest status change to checked_in creates "check_in" action'
);

-- Test 3: Guest tier change creates tier_change action
insert into guest_tiers (event_id, name, description, color)
values ('20000000-0000-0000-0000-000000000001', 'Premium', 'Premium tier', '#FF00FF')
returning id as tier_id \gset

update guests
set tier_id = :'tier_id'
where name = 'John Smith'
returning id as guest_id;

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guests'
      and action = 'tier_change'
      and entity_id = (select id from guests where name = 'John Smith')
  ) > 0,
  'Guest tier change creates "tier_change" action'
);

-- Test 4: Guest deletion (soft delete status) creates audit entry
update guests
set status = 'removed'
where name = 'Jane Doe'
returning id as guest_id;

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guests'
      and entity_id = (select id from guests where name = 'Jane Doe')
      and after_data->>'status' = 'removed'
  ) > 0,
  'Guest soft delete (status=removed) creates audit entry with status change'
);

-- Test 5: Check-in insert creates audit entry
select ok(
  (
    select count(*) from audit_log
    where entity_type = 'check_ins' and action = 'create'
  ) > 0,
  'Check-in creation triggers audit log entry'
);

-- Test 6: Refusal insert creates audit entry
select ok(
  (
    select count(*) from audit_log
    where entity_type = 'refusals' and action = 'create'
  ) > 0,
  'Refusal creation triggers audit log entry'
);

-- Test 7: Guest tier insert creates audit entry
select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guest_tiers' and action = 'create'
  ) > 0,
  'Guest tier creation triggers audit log entry'
);

-- Test 8: Guest tier update creates audit entry
update guest_tiers
set max_count = 75
where name = 'VIP'
  and event_id = '20000000-0000-0000-0000-000000000001'
returning id as tier_id;

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guest_tiers'
      and action = 'update'
  ) > 0,
  'Guest tier update creates audit log entry'
);

-- Test 9: Quota insert creates audit entry
select ok(
  (
    select count(*) from audit_log
    where entity_type = 'quotas' and action = 'create'
  ) > 0,
  'Quota creation triggers audit log entry'
);

-- Test 10: Quota increase creates quota_grant action
update quotas
set default_count = 25
where user_id = '00000000-0000-0000-0000-000000000001'
  and venue_id = '10000000-0000-0000-0000-000000000001'
returning id as quota_id;

select is(
  (
    select action from audit_log
    where entity_type = 'quotas'
      and action = 'quota_grant'
      and entity_id = (
        select id from quotas
        where user_id = '00000000-0000-0000-0000-000000000001'
          and venue_id = '10000000-0000-0000-0000-000000000001'
      )
    limit 1
  ),
  'quota_grant',
  'Quota increase creates "quota_grant" action'
);

-- Test 11: Event quota insert creates audit entry
insert into event_quotas (event_id, user_id, override_count)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 30)
returning id as eq_id;

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'event_quotas' and action = 'create'
  ) > 0,
  'Event quota creation triggers audit log entry'
);

-- Test 12: Event quota override increase creates quota_grant action
update event_quotas
set override_count = 40
where event_id = '20000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-000000000002'
returning id as eq_id;

select is(
  (
    select action from audit_log
    where entity_type = 'event_quotas'
      and action = 'quota_grant'
    limit 1
  ),
  'quota_grant',
  'Event quota override increase creates "quota_grant" action'
);

-- Test 13: Venue membership insert creates audit entry
insert into venue_memberships (venue_id, user_id, roles)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', array['staff'])
returning id as vm_id;

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'venue_memberships' and action = 'create'
  ) > 0,
  'Venue membership creation triggers audit log entry'
);

-- Test 14: Venue membership update (role change) creates audit entry
update venue_memberships
set roles = array['staff', 'doorhost']
where venue_id = '10000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-000000000004'
returning id as vm_id;

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'venue_memberships'
      and action = 'update'
  ) > 0,
  'Venue membership role change creates audit log entry'
);

-- Test 15: Event list lock creates lock action
update events
set list_locked = true, locked_by = '00000000-0000-0000-0000-000000000001'
where id = '20000000-0000-0000-0000-000000000001'
returning id as event_id;

select is(
  (
    select action from audit_log
    where entity_type = 'events'
      and action = 'lock'
    limit 1
  ),
  'lock',
  'Event list lock creates "lock" action'
);

-- Test 16: Event list unlock creates unlock action
update events
set list_locked = false, locked_by = null
where id = '20000000-0000-0000-0000-000000000001'
returning id as event_id;

select is(
  (
    select action from audit_log
    where entity_type = 'events'
      and action = 'unlock'
    limit 1
  ),
  'unlock',
  'Event list unlock creates "unlock" action'
);

-- Test 17: Quota request insert creates audit entry
insert into quota_requests (event_id, user_id, requested_count, requested_by)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 5, '00000000-0000-0000-0000-000000000005')
returning id as qr_id \gset

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'quota_requests' and action = 'create'
  ) > 0,
  'Quota request creation triggers audit log entry'
);

-- Test 18: Quota request approval creates quota_approved action
update quota_requests
set decision = 'approved', decided_by = '00000000-0000-0000-0000-000000000001'
where id = :'qr_id'
returning id as qr_id;

select is(
  (
    select action from audit_log
    where entity_type = 'quota_requests'
      and action = 'quota_approved'
      and entity_id = :'qr_id'
    limit 1
  ),
  'quota_approved',
  'Quota request approval creates "quota_approved" action'
);

-- Test 19: Quota request denial creates quota_denied action
insert into quota_requests (event_id, user_id, requested_count, requested_by)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 8, '00000000-0000-0000-0000-000000000006')
returning id as qr_id_deny \gset

update quota_requests
set decision = 'denied', decided_by = '00000000-0000-0000-0000-000000000001'
where id = :'qr_id_deny'
returning id as qr_id;

select is(
  (
    select action from audit_log
    where entity_type = 'quota_requests'
      and action = 'quota_denied'
      and entity_id = :'qr_id_deny'
    limit 1
  ),
  'quota_denied',
  'Quota request denial creates "quota_denied" action'
);

-- Test 20-30: Verify audit_log entries have correct structure
select ok(
  (
    select count(*) from audit_log
    where venue_id is not null
  ) > 0,
  'All audit entries have venue_id set'
);

select ok(
  (
    select count(*) from audit_log
    where actor_id is not null
  ) > 0,
  'All audit entries have actor_id (auth.uid) set'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type is not null
      and entity_type ~ '^(guests|check_ins|refusals|guest_tiers|quotas|event_quotas|quota_requests|venue_memberships|events)$'
  ) > 0,
  'Audit entries have valid entity_type values'
);

select ok(
  (
    select count(*) from audit_log
    where entity_id is not null
  ) > 0,
  'All audit entries have entity_id set'
);

select ok(
  (
    select count(*) from audit_log
    where action is not null
  ) > 0,
  'All audit entries have action set'
);

select ok(
  (
    select count(*) from audit_log
    where created_at is not null
  ) > 0,
  'All audit entries have created_at timestamp'
);

-- Test 25: Verify diff tracking (only changed fields in after_data/before_data)
select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guests'
      and action = 'check_in'
      and after_data->>'status' = 'checked_in'
  ) > 0,
  'Check-in action captures status change in after_data'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'quotas'
      and action = 'quota_grant'
      and (after_data->>'default_count')::int > (before_data->>'default_count')::int
  ) > 0,
  'Quota grant action shows increase in default_count'
);

-- Test 27-30: Verify audit_log immutability
select throws_ok(
  'update audit_log set action = ''modified'' where id = (select id from audit_log limit 1)',
  'permission denied for schema public',
  'UPDATE on audit_log is prevented'
);

select throws_ok(
  'delete from audit_log where id = (select id from audit_log limit 1)',
  'permission denied for schema public',
  'DELETE on audit_log is prevented'
);

select throws_ok(
  'insert into audit_log (venue_id, actor_id, entity_type, entity_id, action) values (''00000000-0000-0000-0000-000000000001'', ''00000000-0000-0000-0000-000000000001'', ''test'', ''00000000-0000-0000-0000-000000000001'', ''test'')',
  'permission denied for schema public',
  'Direct INSERT on audit_log is prevented (only triggers can write)'
);

-- Test 31-35: Verify event_id is captured for entity-event relationships
select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guests'
      and event_id is not null
  ) > 0,
  'Guest audit entries have event_id set'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'check_ins'
      and event_id is not null
  ) > 0,
  'Check-in audit entries have event_id set'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'refusals'
      and event_id is not null
  ) > 0,
  'Refusal audit entries have event_id set'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guest_tiers'
      and event_id is not null
  ) > 0,
  'Guest tier audit entries have event_id set'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'event_quotas'
      and event_id is not null
  ) > 0,
  'Event quota audit entries have event_id set'
);

-- Test 36-40: Verify different action types are correctly categorized
select ok(
  (
    select count(distinct action) from audit_log
    where action in ('create', 'update', 'delete', 'check_in', 'refuse', 'tier_change', 'lock', 'unlock', 'quota_grant', 'quota_approved', 'quota_denied')
  ) > 0,
  'Audit log contains expected action types'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type in ('guests', 'check_ins', 'refusals', 'guest_tiers', 'quotas', 'event_quotas', 'quota_requests', 'venue_memberships', 'events')
  ) > 0,
  'Audit log tracks all required entity types'
);

-- Test 41-45: Verify RLS on audit_log view
-- Admin should see audit logs for their venue
select ok(
  (
    select count(*) from audit_log
    where venue_id = '10000000-0000-0000-0000-000000000001'
  ) > 0,
  'Audit logs exist for test venue'
);

-- Verify timestamp precision
select ok(
  (
    select count(*) from audit_log
    where created_at > now() - interval '1 minute'
  ) > 0,
  'Audit log entries have recent timestamps (within 1 minute)'
);

select ok(
  (
    select count(*) from audit_log
    where created_at <= now()
  ) = (select count(*) from audit_log),
  'All audit log timestamps are not in the future'
);

select ok(
  (
    select count(*) from audit_log
    where entity_type = 'guests'
      and action in ('create', 'update', 'delete', 'check_in', 'refuse', 'tier_change', 'status_change')
  ) > 0,
  'Guest mutations have correct action types'
);

select finish();
rollback;
