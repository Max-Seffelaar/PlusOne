-- pgTAP — decision 17 (2026-10-06, z8uq9m2vg6): at the door a doorhost may
-- raise a guest's plus_ones, within the quota of whoever ADDED the guest.
-- No new code: enforce_guest_quota already charges guests.added_by. This file
-- pins that behaviour so a later quota or RLS change cannot quietly move the
-- charge onto the doorhost or let the raise past the adder's limit.
-- Seed: staff Tom (55..5) has a 12-slot override for event ee..01; doorhost
-- Lisa (66..6) has 5; Club Vesper aa..01, tier dd..01.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- Slots a user has consumed on the event — the quota engine's own count.
create function pg_temp.used(p_user uuid)
returns bigint language sql as $fn$
  select public.user_event_consumption('ee000000-0000-7000-8000-000000000001', p_user)::bigint;
$fn$;

select plan(6);

-- Tom adds a solo guest himself (his own quota pays for it).
select pg_temp.login('55555555-5555-4555-8555-555555555555');
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by)
values ('cc000000-0000-7000-8000-0000000ad001', 'ee000000-0000-7000-8000-000000000001',
        'dd000000-0000-7000-8000-000000000001', 'Door PlusOnes Gast', 0,
        '55555555-5555-4555-8555-555555555555');
reset role;

create temp table _before as
  select pg_temp.used('55555555-5555-4555-8555-555555555555') as tom,
         pg_temp.used('66666666-6666-4666-8666-666666666666') as lisa;
create temp table _room as
  select public.user_event_quota('ee000000-0000-7000-8000-000000000001',
           '55555555-5555-4555-8555-555555555555') - tom as room from _before;
grant select on _room to authenticated;

-- 1. Within Tom's remaining slots: the doorhost may raise +N.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$update public.guests set plus_ones = 1
                   where id = 'cc000000-0000-7000-8000-0000000ad001'$$,
  '1 a doorhost raises plus_ones within the adder''s quota');
reset role;

select is((select plus_ones from public.guests where id = 'cc000000-0000-7000-8000-0000000ad001'), 1,
  '2 the raise landed');
select is(pg_temp.used('55555555-5555-4555-8555-555555555555') - (select tom from _before), 1::bigint,
  '3 it is charged to the adder (Tom), one extra slot');
select is(pg_temp.used('66666666-6666-4666-8666-666666666666'), (select lisa from _before),
  '4 the doorhost''s own meter does not move');

-- 5. Past Tom's remaining slots: the quota engine refuses (45001).
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok(
  format($$update public.guests set plus_ones = %s
            where id = 'cc000000-0000-7000-8000-0000000ad001'$$, (select room from _room) + 1),
  '45001', null, '5 a raise past the adder''s quota is refused');
reset role;
select is((select added_by from public.guests where id = 'cc000000-0000-7000-8000-0000000ad001'),
  '55555555-5555-4555-8555-555555555555'::uuid, '6 the guest stays Tom''s (added_by untouched)');

select * from finish();
rollback;
