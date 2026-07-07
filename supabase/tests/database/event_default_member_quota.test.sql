-- pgTAP — Per-event default member quota (Feedback 1/7 — T10, 86ey4j1p5).
-- Proves the two-level quota model:
--   * events.default_member_quota is trigger-seeded from the venue default at
--     INSERT when the app omits it (the normal create path), and left alone when
--     the app supplies one;
--   * the non-negative CHECK holds;
--   * writes follow the existing events RLS — admin AND event organizer can change
--     an event's default, a plain staff member cannot ("quota = admin/organizer").
-- Seed baseline (supabase/seed.sql): venue 1 (aa…01) default_personal_quota = 5,
-- venue 2 (aa…02) = 4; event ee…01 is in venue 1; user 44…44 is an event organizer
-- of ee…01 (no membership), 55…55 is a plain {staff} member of venue 1. Rolls back.

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

select plan(7);

-- ── 1: the seed event (venue 1, default 5) got its per-event default from the
--      trigger at insert time ─────────────────────────────────────────────────
select is(
  (select default_member_quota from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  5::smallint,
  '1 seed event inherits the venue default (5) via the insert trigger');

-- ── 2: a new event in venue 2 (default 4), no quota supplied → seeded to 4 ─────
insert into public.events (id, venue_id, name, starts_at, landing_slug)
values ('ee000000-0000-7000-8000-0000000000a1', 'aa000000-0000-7000-8000-000000000002',
        'Quota Seed V2', now() + interval '10 days', 't10-seed-v2');
select is(
  (select default_member_quota from public.events where id = 'ee000000-0000-7000-8000-0000000000a1'),
  4::smallint,
  '2 a new event seeds default_member_quota from its own venue default (4)');

-- ── 3: an explicit value is NOT overwritten by the trigger ────────────────────
insert into public.events (id, venue_id, name, starts_at, landing_slug, default_member_quota)
values ('ee000000-0000-7000-8000-0000000000a2', 'aa000000-0000-7000-8000-000000000001',
        'Quota Explicit', now() + interval '10 days', 't10-explicit', 9);
select is(
  (select default_member_quota from public.events where id = 'ee000000-0000-7000-8000-0000000000a2'),
  9::smallint,
  '3 an app-supplied default_member_quota is kept, not reseeded');

-- ── 4: the non-negative CHECK rejects a negative value ────────────────────────
select throws_ok($$
  insert into public.events (id, venue_id, name, starts_at, landing_slug, default_member_quota)
  values ('ee000000-0000-7000-8000-0000000000a3', 'aa000000-0000-7000-8000-000000000001',
          'Quota Neg', now() + interval '10 days', 't10-neg', -1)
$$, '23514', null, '4 a negative default_member_quota is rejected by the CHECK');

-- ── 5/6/7: RLS — admin + organizer can change the per-event default, staff can't.
-- An UPDATE the policy forbids silently affects 0 rows, so we assert the value.
select pg_temp.login('11111111-1111-4111-8111-111111111111');   -- admin of venue 1
update public.events set default_member_quota = 7
  where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select is(
  (select default_member_quota from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  7::smallint,
  '5 an admin can change an event''s default_member_quota');

select pg_temp.login('55555555-5555-4555-8555-555555555555');   -- {staff} member
update public.events set default_member_quota = 99
  where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select is(
  (select default_member_quota from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  7::smallint,
  '6 a staff member CANNOT change it (RLS leaves the value at 7)');

select pg_temp.login('44444444-4444-4444-8444-444444444444');   -- event organizer of ee…01
update public.events set default_member_quota = 8
  where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select is(
  (select default_member_quota from public.events where id = 'ee000000-0000-7000-8000-000000000001'),
  8::smallint,
  '7 an event organizer can change it (quota = admin/organizer)');

select * from finish();
rollback;
