-- pgTAP — Sessie C: permanent-guest sync, tier mapping, quota & "respect the
-- removal" (run: supabase test db).
-- Seed: event ee..01 (venue aa..01, open) with tiers Regular dd..01, VIP dd..02
-- (alias 'vip'), VIP+fles dd..03 (max 10). Permanent contacts c0..01 Sanne
-- (preferred vip) and c0..02 Anouk (preferred all_access). Everything rolls back.

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

select plan(17);

-- ---------------------------------------------------------------------------
-- A. sync — idempotent house-guest auto-add with tier mapping
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin

select is(
  (select public.sync_permanent_guests_into_event('ee000000-0000-7000-8000-000000000001')),
  2, 'A1 first sync adds both permanent contacts');

select is(
  (select source::text from public.guests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and contact_id = 'c0000000-0000-7000-8000-000000000001' and status <> 'removed'),
  'permanent', 'A2 synced guest carries source=permanent');

select is(
  (select tier_id from public.guests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and contact_id = 'c0000000-0000-7000-8000-000000000001' and status <> 'removed'),
  'dd000000-0000-7000-8000-000000000002'::uuid, 'A3 preferred role vip maps to the VIP tier');

select is(
  (select tier_id from public.guests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and contact_id = 'c0000000-0000-7000-8000-000000000002' and status <> 'removed'),
  'dd000000-0000-7000-8000-000000000001'::uuid, 'A4 unmatched role falls back to the default (Regular) tier');

select is(
  (select public.sync_permanent_guests_into_event('ee000000-0000-7000-8000-000000000001')),
  0, 'A5 re-sync is idempotent — adds nothing');

-- ---------------------------------------------------------------------------
-- B. quota — permanent is personally exempt, but still counts tier-max
-- ---------------------------------------------------------------------------
-- Tom (staff) has consumed 10 of 12 in the seed; a +50 add would breach quota.

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff Tom

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
          'Over Quota App', 50, '55555555-5555-4555-8555-555555555555', 'app')
$$, '45001', null, 'B1 a +50 app add breaches personal quota');

select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
          'Over Quota Permanent', 50, '55555555-5555-4555-8555-555555555555', 'permanent')
$$, 'B2 the same +50 add as permanent is quota-exempt');

reset role;

-- Tier-max still counts permanent: a capped tier filled by a permanent guest
-- rejects the next add of any source.
select pg_temp.login('11111111-1111-4111-8111-111111111111');

insert into public.guest_tiers (id, event_id, name, max_guests)
values ('dd000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-000000000001', 'Capped', 1);

select lives_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-0000000000f1',
          'Capped Permanent', '11111111-1111-4111-8111-111111111111', 'permanent')
$$, 'B3 a permanent guest fills the single capped slot');

select throws_ok($$
  insert into public.guests (event_id, tier_id, full_name, added_by, source)
  values ('ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-0000000000f1',
          'Capped App', '11111111-1111-4111-8111-111111111111', 'app')
$$, '45002', null, 'B4 the permanent occupant counts toward tier-max — next add blocked');

-- ---------------------------------------------------------------------------
-- C. respect the removal — manual removal sticks across re-sync
-- ---------------------------------------------------------------------------

-- Admin manually removes the auto-added Anouk; the trigger records an exclusion.
update public.guests set status = 'removed'
where event_id = 'ee000000-0000-7000-8000-000000000001'
  and contact_id = 'c0000000-0000-7000-8000-000000000002' and status <> 'removed';

select is(
  (select public.sync_permanent_guests_into_event('ee000000-0000-7000-8000-000000000001')),
  0, 'C1 re-sync does NOT re-add a manually removed permanent guest');

select is(
  (select count(*)::int from public.guests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and contact_id = 'c0000000-0000-7000-8000-000000000002' and status <> 'removed'),
  0, 'C2 the removed permanent guest stays off the list');

select is(
  (select count(*)::int from public.contact_event_exclusions
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and contact_id = 'c0000000-0000-7000-8000-000000000002'),
  1, 'C3 the removal recorded an exclusion');

-- ---------------------------------------------------------------------------
-- D. manual re-add clears the exclusion
-- ---------------------------------------------------------------------------

select isnt(
  (select public.add_contact_to_event(
     'c0000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001')),
  null, 'D1 a deliberate manual add returns a guest id');

select is(
  (select source::text from public.guests
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and contact_id = 'c0000000-0000-7000-8000-000000000002' and status <> 'removed'),
  'app', 'D2 the manually re-added guest is a normal source=app guest');

select is(
  (select count(*)::int from public.contact_event_exclusions
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and contact_id = 'c0000000-0000-7000-8000-000000000002'),
  0, 'D3 the manual re-add cleared the exclusion');

reset role;

-- ---------------------------------------------------------------------------
-- E. authorization + no-tiers no-op
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff
select throws_ok(
  $$ select public.sync_permanent_guests_into_event('ee000000-0000-7000-8000-000000000001') $$,
  '42501', null, 'E1 staff may not sync permanent guests');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000ff', 'aa000000-0000-7000-8000-000000000001',
        'Geen Tiers Event', '2026-07-01 22:00:00+02', 'geen-tiers-event');
select is(
  (select public.sync_permanent_guests_into_event('ee000000-0000-7000-8000-0000000000ff')),
  0, 'E2 syncing an event without tiers is a safe no-op');
reset role;

select * from finish();
rollback;
