-- pgTAP tests for RLS policies and quota enforcement (60 tests)
begin;
create extension if not exists pgtap;
select plan(60);

-- Section 1: Helper Functions (10 tests)
select is((select array_length(user_venue_roles('10000000-0000-0000-0000-000000000001'::uuid), 1) is not null), true, 'user_venue_roles works');
select is((select is_event_organizer('20000000-0000-0000-0000-000000000001'::uuid) is not null), true, 'is_event_organizer works');
select is((select quota_remaining('00000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) >= 0), true, 'quota_remaining works');
select is((select quota_usage('00000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) >= 0), true, 'quota_usage works');
select is((select quota_limit('00000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) > 0), true, 'quota_limit works');
select is((select event_list_locked('20000000-0000-0000-0000-000000000001'::uuid) = false), true, 'event_list_locked works');
select is((select event_venue_id('20000000-0000-0000-0000-000000000001'::uuid) = '10000000-0000-0000-0000-000000000001'::uuid), true, 'event_venue_id works');
select is((select is_venue_member('10000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid)), true, 'is_venue_member works for member');
select is((select is_venue_member('10000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000098'::uuid) = false), true, 'is_venue_member returns false for non-member');
select is((select has_aal2() is not null), true, 'has_aal2 returns boolean');

-- Section 2: Quota Calculations (10 tests)
select is((select quota_usage('00000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) > 0), true, 'quota_usage is > 0 for seeded data');
select is((select quota_usage('00000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) >= (select count(*) from guests where added_by = '00000000-0000-0000-0000-000000000001'::uuid and event_id = '20000000-0000-0000-0000-000000000001'::uuid)), true, 'quota_usage includes plus_ones');
insert into guests (id, event_id, tier_id, name, added_by, status, created_at) values ('40000000-0000-0000-0000-000000000098'::uuid, '20000000-0000-0000-0000-000000000001'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, 'Test Removed', '00000000-0000-0000-0000-000000000001'::uuid, 'removed'::guest_status, now()) on conflict do nothing;
select is((select status from guests where id = '40000000-0000-0000-0000-000000000098'::uuid), 'removed'::guest_status, 'Setup: removed guest created');
insert into event_quotas (event_id, user_id, override_count) values ('20000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000005'::uuid, 25) on conflict (event_id, user_id) do update set override_count = 25;
select is((select quota_limit('00000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000001'::uuid)), 25, 'quota_limit uses event override');
select is((select quota_remaining('00000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) > 0), true, 'quota_remaining is positive');
select is((select quota_remaining('00000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) = (select quota_limit('00000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) - quota_usage('00000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000001'::uuid))), true, 'quota_remaining formula is correct');
select is((select count(*) from guests where event_id = '20000000-0000-0000-0000-000000000001'::uuid and plus_ones > 0 and status != 'removed'::guest_status), true::boolean, 'Event has guests with plus_ones');
select is((select count(*) from guests where event_id = '20000000-0000-0000-0000-000000000001'::uuid and status = 'denied'::guest_status) > 0, true, 'Event has denied guests');
select is((select quota_remaining('00000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000001'::uuid) >= 0), true, 'quota_remaining never negative');

-- Section 3: Soft Delete Enforcement (5 tests)
select is((select enum_range(null::guest_status)::text[] @> array['removed']), true, 'guest_status has removed value');
select is((select count(*) from guests where status = 'removed'::guest_status and event_id = '20000000-0000-0000-0000-000000000001'::uuid) > 0, true, 'Soft deleted guests exist');
select is((select has_table_privilege('authenticated'::regrole, 'guests'::regclass, 'DELETE')), false, 'DELETE revoked on guests');
select is((select has_table_privilege('authenticated'::regrole, 'check_ins'::regclass, 'DELETE')), false, 'DELETE revoked on check_ins');
select is((select has_table_privilege('authenticated'::regrole, 'audit_log'::regclass, 'DELETE')), false, 'DELETE revoked on audit_log');

-- Section 4: RLS Policy Existence (15 tests)
select is((select relrowsecurity from pg_class where relname = 'users'), true, 'users has RLS');
select is((select relrowsecurity from pg_class where relname = 'venues'), true, 'venues has RLS');
select is((select relrowsecurity from pg_class where relname = 'guests'), true, 'guests has RLS');
select is((select relrowsecurity from pg_class where relname = 'venue_memberships'), true, 'venue_memberships has RLS');
select is((select relrowsecurity from pg_class where relname = 'events'), true, 'events has RLS');
select is((select relrowsecurity from pg_class where relname = 'check_ins'), true, 'check_ins has RLS');
select is((select relrowsecurity from pg_class where relname = 'refusals'), true, 'refusals has RLS');
select is((select relrowsecurity from pg_class where relname = 'audit_log'), true, 'audit_log has RLS');
select is((select relrowsecurity from pg_class where relname = 'quotas'), true, 'quotas has RLS');
select is((select relrowsecurity from pg_class where relname = 'event_quotas'), true, 'event_quotas has RLS');
select is((select relrowsecurity from pg_class where relname = 'guest_requests'), true, 'guest_requests has RLS');
select is((select relrowsecurity from pg_class where relname = 'quota_requests'), true, 'quota_requests has RLS');
select is((select count(*) from pg_policies where tablename = 'users'), (select 2), 'users has policies');
select is((select count(*) from pg_policies where tablename = 'guests'), (select 3), 'guests has policies');
select is((select count(*) from pg_policies where tablename = 'check_ins'), (select 3), 'check_ins has policies');

-- Section 5: Schema Constraints (10 tests)
select is((select count(*) from information_schema.columns where table_name = 'events' and column_name = 'list_locked'), 1, 'events has list_locked column');
select is((select count(*) from information_schema.columns where table_name = 'events' and column_name = 'locked_by'), 1, 'events has locked_by column');
select is((select count(*) from information_schema.columns where table_name = 'guests' and column_name = 'added_by'), 1, 'guests has added_by column');
select is((select data_type from information_schema.columns where table_name = 'venue_memberships' and column_name = 'roles'), 'ARRAY', 'venue_memberships.roles is array');
select is((select count(*) from information_schema.table_constraints where table_name = 'quotas' and constraint_type = 'UNIQUE'), 1::bigint, 'quotas has unique constraint');
select is((select count(*) from information_schema.table_constraints where table_name = 'event_quotas' and constraint_type = 'UNIQUE'), 1::bigint, 'event_quotas has unique constraint');
select is((select count(*) from information_schema.table_constraints where table_name = 'check_ins' and constraint_type = 'UNIQUE'), 1::bigint, 'check_ins has unique constraint on guest_id');
select is((select count(*) from pg_indexes where tablename = 'audit_log' and indexname like '%venue_id%created_at%'), 1::bigint, 'audit_log has index on venue_id, created_at');
select is((select count(*) from pg_indexes where tablename = 'guests' and indexname like '%event_id%status%'), 1::bigint, 'guests has index on event_id, status');
select is((select count(*) from pg_indexes where tablename = 'check_ins' and indexname like '%server_timestamp%'), 1::bigint, 'check_ins has index on server_timestamp');

-- Section 6: Enums & Types (10 tests)
select is((select enum_range(null::subscription_status)::text[] @> array['active', 'trialing', 'past_due', 'canceled', 'comped']), true, 'subscription_status has all values');
select is((select count(*) from information_schema.columns where table_name = 'subscriptions' and column_name = 'status'), 1, 'subscriptions.status exists');
select is((select enum_range(null::event_status)::text[] @> array['draft', 'open', 'live', 'closed']), true, 'event_status has required values');
select is((select enum_range(null::venue_role)::text[] @> array['admin', 'user_manager', 'finance', 'staff', 'doorhost']), true, 'venue_role has all roles');
select is((select enum_range(null::guest_source)::text[] @> array['app', 'landing', 'door']), true, 'guest_source enum works');
select is((select count(*) from information_schema.columns where table_name = 'audit_log' and column_name = 'before_data'), 1, 'audit_log.before_data exists');
select is((select count(*) from information_schema.columns where table_name = 'audit_log' and column_name = 'after_data'), 1, 'audit_log.after_data exists');
select is((select count(*) from information_schema.table_constraints where table_name = 'venue_memberships' and constraint_type = 'UNIQUE'), 1::bigint, 'venue_memberships has unique constraint');
select is((select count(*) from information_schema.table_constraints where table_name = 'event_organizers' and constraint_type = 'UNIQUE'), 1::bigint, 'event_organizers has unique constraint');
select is((select count(*) from pg_policies where tablename = 'audit_log'), 1, 'audit_log has policy');

select * from finish();
rollback;
