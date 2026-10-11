-- pgTAP — venue_user_additions.present follows the on-list rule (#44)
-- (20261015130000, the venue half of 20260811161000 / 86ey9c5fp).
--
-- `sync_guest_status_from_refusal` flips a checked-in guest to `refused`
-- without voiding the check-in, so the check_ins row survives the refusal.
-- event_user_additions stopped counting that guest as present in
-- 20260811161000; the venue variant kept counting them, so the venue column
-- read higher than the sum of its events. Claims:
--   * a guest refused after checking in is not present at venue level, while
--     the gross ledger (added / added_headcount) still counts them;
--   * venue-level present equals the sum of event-level present over the
--     venue's events — for the fixture window AND for every adder venue-wide;
--   * a normal check-in still counts; a voided check-in still does not;
--   * the platform-admin name rule (20261014130000) is unchanged: a hidden
--     operator's row has counts but no name; the operator sees their own name;
--   * the gate and grants are unchanged.
--
-- Own fixture events far in the future (2099), read through a date window, so
-- the counts do not depend on the shared dev DB's other rows. Everything rolls
-- back.

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

select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Seed: venue aa..01 = Club Vesper, Max admin, Tom staff.
-- ---------------------------------------------------------------------------

-- `pnpm dev:mfa` flags admin@ (Max) as a platform admin on a shared dev DB,
-- which makes can_view_profile true for everyone. Pin the seed state.
select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = false
 where id = '11111111-1111-4111-8111-111111111111';
select set_config('plusone.platform_admin_write', 'off', true);

-- A PlusOne operator, member of nothing, who adds one guest as support.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000', 'a9000000-0000-4000-8000-0000000000b1',
  'authenticated', 'authenticated', 'vua-operator@plusone.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{"full_name": "Hidden Operator"}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', ''
);
insert into public.user_profiles (id, full_name, email)
values ('a9000000-0000-4000-8000-0000000000b1', 'Hidden Operator', 'vua-operator@plusone.test')
on conflict (id) do update set full_name = excluded.full_name;

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = 'a9000000-0000-4000-8000-0000000000b1';
select set_config('plusone.platform_admin_write', 'off', true);

insert into public.events (id, venue_id, name, starts_at, landing_slug, landing_active) values
  ('e5000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000001',
   'Venue Present Fixture A', '2099-06-01 20:00+00', 'venue-present-fixture-a', false),
  ('e5000000-0000-7000-8000-000000000002', 'aa000000-0000-7000-8000-000000000001',
   'Venue Present Fixture B', '2099-06-02 20:00+00', 'venue-present-fixture-b', false);

insert into public.guest_tiers (id, event_id, name) values
  ('d5000000-0000-7000-8000-000000000001', 'e5000000-0000-7000-8000-000000000001', 'Fixture Tier A'),
  ('d5000000-0000-7000-8000-000000000002', 'e5000000-0000-7000-8000-000000000002', 'Fixture Tier B');

-- Tom adds four guests: A1 stays, A2 (+1) is refused later, A3 is voided, B1 stays.
-- The operator adds one guest at event A who checks in normally.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, status) values
  ('c5000000-0000-7000-8000-000000000001', 'e5000000-0000-7000-8000-000000000001',
   'd5000000-0000-7000-8000-000000000001', 'Fixture A1 Stays', 0,
   '55555555-5555-4555-8555-555555555555', 'approved'),
  ('c5000000-0000-7000-8000-000000000002', 'e5000000-0000-7000-8000-000000000001',
   'd5000000-0000-7000-8000-000000000001', 'Fixture A2 Refused Later', 1,
   '55555555-5555-4555-8555-555555555555', 'approved'),
  ('c5000000-0000-7000-8000-000000000003', 'e5000000-0000-7000-8000-000000000001',
   'd5000000-0000-7000-8000-000000000001', 'Fixture A3 Voided', 0,
   '55555555-5555-4555-8555-555555555555', 'approved'),
  ('c5000000-0000-7000-8000-000000000004', 'e5000000-0000-7000-8000-000000000002',
   'd5000000-0000-7000-8000-000000000002', 'Fixture B1 Stays', 0,
   '55555555-5555-4555-8555-555555555555', 'approved'),
  ('c5000000-0000-7000-8000-000000000005', 'e5000000-0000-7000-8000-000000000001',
   'd5000000-0000-7000-8000-000000000001', 'Fixture Support Guest', 0,
   'a9000000-0000-4000-8000-0000000000b1', 'approved');

insert into public.check_ins (guest_id, checked_by, plus_ones_arrived) values
  ('c5000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 0),
  ('c5000000-0000-7000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 1),
  ('c5000000-0000-7000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 0),
  ('c5000000-0000-7000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 0),
  ('c5000000-0000-7000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 0);

-- A mistaken check-in, undone at the door (soft void).
update public.check_ins
   set voided_at = now(), voided_by = '11111111-1111-4111-8111-111111111111'
 where guest_id = 'c5000000-0000-7000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- A. Baseline: normal check-ins count, a voided one does not
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- Max, venue admin

select is(
  (select row(added, added_headcount, present)::text
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001',
                                      '2099-01-01'::timestamptz, '2100-01-01'::timestamptz)
    where user_id = '55555555-5555-4555-8555-555555555555'),
  row(4, 5, 3)::text,
  'A1 baseline: Tom added 4 (5 heads), present 3 — A1, A2, B1 count; voided A3 does not');
reset role;

-- ---------------------------------------------------------------------------
-- B. Refused after check-in
-- ---------------------------------------------------------------------------

insert into public.refusals (guest_id, refused_by, reason)
values ('c5000000-0000-7000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
        'Alsnog geweigerd na binnenkomst');

select is((select status::text from public.guests
            where id = 'c5000000-0000-7000-8000-000000000002'),
  'refused', 'B1 precondition: the refusal flipped the checked-in guest to refused');
select ok(exists (select 1 from public.check_ins
                   where guest_id = 'c5000000-0000-7000-8000-000000000002'
                     and voided_at is null),
  'B2 precondition: her check-in survives the refusal, not voided');

select pg_temp.login('11111111-1111-4111-8111-111111111111');

select is(
  (select present
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001',
                                      '2099-01-01'::timestamptz, '2100-01-01'::timestamptz)
    where user_id = '55555555-5555-4555-8555-555555555555'),
  2,
  'B3 venue present drops the guest refused after check-in (3 -> 2)');
select is(
  (select row(added, added_headcount)::text
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001',
                                      '2099-01-01'::timestamptz, '2100-01-01'::timestamptz)
    where user_id = '55555555-5555-4555-8555-555555555555'),
  row(4, 5)::text,
  'B4 the gross ledger still counts her: added 4, added_headcount 5');
select is(
  (select present from public.event_user_additions('e5000000-0000-7000-8000-000000000001')
    where user_id = '55555555-5555-4555-8555-555555555555'),
  1,
  'B5 event A present for Tom = 1 (only A1; unchanged event-level rule)');
select is(
  (select present from public.event_user_additions('e5000000-0000-7000-8000-000000000002')
    where user_id = '55555555-5555-4555-8555-555555555555'),
  1,
  'B6 event B present for Tom = 1 (B1)');
select is(
  (select present
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001',
                                      '2099-01-01'::timestamptz, '2100-01-01'::timestamptz)
    where user_id = '55555555-5555-4555-8555-555555555555'),
  (select sum(eua.present)::int
     from public.events e
     cross join lateral public.event_user_additions(e.id) eua
    where e.venue_id = 'aa000000-0000-7000-8000-000000000001'
      and e.starts_at >= '2099-01-01' and e.starts_at < '2100-01-01'
      and eua.user_id = '55555555-5555-4555-8555-555555555555'),
  'B7 venue present = sum of event present over the window''s events');

-- Venue-wide, every adder: venue present = sum of event present over all the
-- venue's events. Event rows also cover removed-only adders (present 0), hence
-- the full join + coalesce.
select is(
  (select count(*)::int
     from (select user_id, present
             from public.venue_user_additions('aa000000-0000-7000-8000-000000000001', null, null)) v
     full join (select eua.user_id, sum(eua.present)::int as present
                  from public.events e
                  cross join lateral public.event_user_additions(e.id) eua
                 where e.venue_id = 'aa000000-0000-7000-8000-000000000001'
                 group by eua.user_id) ev using (user_id)
    where coalesce(v.present, 0) <> coalesce(ev.present, 0)),
  0,
  'B8 venue-wide: no adder whose venue present differs from the sum of their event present');

-- ---------------------------------------------------------------------------
-- C. Platform-admin name rule (20261014130000) unchanged
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.user_profiles
            where id = 'a9000000-0000-4000-8000-0000000000b1'), 0,
  'C1 precondition: the venue admin cannot see the operator''s profile');
select is(
  (select row(full_name, added, added_headcount, present)::text
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001',
                                      '2099-01-01'::timestamptz, '2100-01-01'::timestamptz)
    where user_id = 'a9000000-0000-4000-8000-0000000000b1'),
  row(null::text, 1, 1, 1)::text,
  'C2 the operator''s row keeps its counts (normal check-in present) but carries no name');
select ok(not exists (
    select 1 from public.venue_user_additions('aa000000-0000-7000-8000-000000000001', null, null)
     where full_name = 'Hidden Operator'),
  'C3 the operator''s name appears nowhere in the venue-wide result');
select is(
  (select full_name
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001',
                                      '2099-01-01'::timestamptz, '2100-01-01'::timestamptz)
    where user_id = '55555555-5555-4555-8555-555555555555'),
  'Tom Bakker',
  'C4 a venue member keeps their name');
reset role;

select pg_temp.login('a9000000-0000-4000-8000-0000000000b1'); -- the operator
select is(
  (select full_name
     from public.venue_user_additions('aa000000-0000-7000-8000-000000000001',
                                      '2099-01-01'::timestamptz, '2100-01-01'::timestamptz)
    where user_id = 'a9000000-0000-4000-8000-0000000000b1'),
  'Hidden Operator',
  'C5 the operator reading the stats sees their own name');
reset role;

-- ---------------------------------------------------------------------------
-- D. Gate and grants unchanged
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- Tom, staff
select is((select count(*)::int
             from public.venue_user_additions('aa000000-0000-7000-8000-000000000001', null, null)), 0,
  'D1 staff still gets no rows (can_read_venue_stats unchanged)');
reset role;

select ok(not has_function_privilege('anon', 'public.venue_user_additions(uuid, timestamptz, timestamptz)', 'EXECUTE'),
  'D2 anon cannot execute venue_user_additions');
select ok(has_function_privilege('authenticated', 'public.venue_user_additions(uuid, timestamptz, timestamptz)', 'EXECUTE'),
  'D3 authenticated keeps EXECUTE');

select * from finish();

rollback;
