-- EXPLAIN (ANALYZE, BUFFERS) of the guests_select path as staff Tom (55..5),
-- the same query before and after 20261017120000_rls_set_based_helpers.sql.
-- Needs scripts/perf/rls-set-based-seed.sql first. LOCAL STACK ONLY.
--
--   docker exec -i supabase_db_PlusOne_Guestlist psql -U postgres \
--     < scripts/perf/rls-set-based-explain.sql
--
-- The query is what the guest list sends through PostgREST
-- (`guests?event_id=eq.<id>&select=*`), run as the `authenticated` role with
-- Tom's JWT claims, so RLS applies exactly as in the app. Each event is run
-- three times; read the last run (warm cache).

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555',
                    'role', 'authenticated')::text, true);
set local role authenticated;

\echo '=== 150 guests ==='
select count(*) as visible_to_staff from public.guests
 where event_id = 'ef000000-0000-7000-8000-000000000150';
explain (analyze, buffers, costs off) select * from public.guests where event_id = 'ef000000-0000-7000-8000-000000000150';
explain (analyze, buffers, costs off) select * from public.guests where event_id = 'ef000000-0000-7000-8000-000000000150';
explain (analyze, buffers, costs off) select * from public.guests where event_id = 'ef000000-0000-7000-8000-000000000150';

\echo '=== 25 000 guests ==='
select count(*) as visible_to_staff from public.guests
 where event_id = 'ef000000-0000-7000-8000-000000025000';
explain (analyze, buffers, costs off) select * from public.guests where event_id = 'ef000000-0000-7000-8000-000000025000';
explain (analyze, buffers, costs off) select * from public.guests where event_id = 'ef000000-0000-7000-8000-000000025000';
explain (analyze, buffers, costs off) select * from public.guests where event_id = 'ef000000-0000-7000-8000-000000025000';

rollback;
