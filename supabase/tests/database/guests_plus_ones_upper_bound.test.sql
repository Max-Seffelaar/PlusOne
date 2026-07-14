-- pgTAP — guests.plus_ones upper bound (20260714130000, 86ey9e8bd).
-- Proves the DB-level ceiling that backstops the Zod cap (plusOnes.max(50)):
-- a door-add or any other direct insert cannot land a runaway plus_ones value
-- (mistyped door-add, a replayed pre-fix client, a direct API call) even if
-- every application-layer guard is skipped. 50 is allowed (the exact cap);
-- 51 is rejected; the pre-existing `plus_ones >= 0` floor is untouched.

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

select plan(3);

select pg_temp.login('11111111-1111-4111-8111-111111111111');

-- 1. plus_ones = 50 (the exact cap) is accepted.
select lives_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
  values ('cc000000-0000-7000-8000-00000000c001', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'At The Cap', 50, '11111111-1111-4111-8111-111111111111')
$$, '1 plus_ones = 50 is accepted (the exact cap)');

-- 2. plus_ones = 51 is rejected by the new CHECK constraint.
select throws_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
  values ('cc000000-0000-7000-8000-00000000c002', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Over The Cap', 51, '11111111-1111-4111-8111-111111111111')
$$, '23514', null, '2 plus_ones = 51 is rejected (check_violation)');

-- 3. A wildly out-of-range value (the door-add bypass scenario) is rejected too.
select throws_ok($$
  insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
  values ('cc000000-0000-7000-8000-00000000c003', 'ee000000-0000-7000-8000-000000000001',
          'dd000000-0000-7000-8000-000000000001', 'Anna', 9999999, '11111111-1111-4111-8111-111111111111')
$$, '23514', null, '3 a runaway plus_ones value is rejected');

reset role;

select * from finish();

rollback;
