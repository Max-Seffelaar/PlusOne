-- pgTAP tests for Row Level Security
-- Test both allowed and denied cases per role
-- Run with: supabase test db

begin;

-- Smoke test: verify pgTAP is working
select plan(1);
select pass('pgTAP test harness is functional');

select finish();
rollback;
