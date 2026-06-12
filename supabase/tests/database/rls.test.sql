-- pgTAP tests for Row Level Security
-- Test both allowed and denied cases per role
-- Run with: supabase test db

-- Placeholder test suite structure:
-- - Each table (users, venues, events, guests, quotas, check_ins) needs RLS tests
-- - Test coverage: admin, user_manager, finance, organizer, staff, doorhost roles
-- - Verify mutations are rejected at the RLS boundary, not in app code
-- - Quota enforcement, soft delete, list_lock, and audit triggers need database-layer tests

begin;
select plan(0); -- Begin test count when tests are written
-- select finish();
rollback;
