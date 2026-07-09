-- pgTAP — bulk tier change (changeGuestsTierBulk): DB-state coverage.
--
-- Test-quality audit (Prod-ready 9/7 — 13): the app action `changeGuestsTierBulk`
-- does `.update().in('id', ids)` through the RLS-scoped client. A bulk update that
-- RLS filters to ZERO rows returns no Postgrest error — so before the C15 guard was
-- extended to this path, the action returned ok:true on a silent total failure.
-- These assertions prove the DB truth the JS `count` guard relies on: the write
-- lands for an allowed role (SELECT-back), and matches ZERO rows for staff moving
-- guests they don't own or on a locked list (#23). Everything rolls back.
--
-- No savepoint/rollback per section: rolling back to a savepoint also rolls back
-- pgTAP's own result recording ("No tests run!" at finish). Instead each section
-- resets the tier via a plain admin-role UPDATE (admin has RLS write on the venue).

begin;

create extension if not exists pgtap with schema extensions;

-- Identity helper: PostgREST-style JWT claims + role switch (mirrors rls.test.sql).
create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- Executes a DML statement under the CURRENT role (RLS applies) and returns the
-- number of affected rows — the exact signal the app guard checks as `count`.
create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixture (superuser; RLS bypassed): an open event at Club Vesper (aa..01) with
-- a Regular + VIP tier, two guests owned by staff Tom, two owned by admin Max.
-- ---------------------------------------------------------------------------
insert into public.events (id, venue_id, name, starts_at, status, landing_slug, landing_active)
values ('ee000000-0000-7000-8000-0000000000c1',
        'aa000000-0000-7000-8000-000000000001',
        'Bulk Tier Test', now() + interval '7 days', 'open', 'bulk-tier-test', false);

insert into public.guest_tiers (id, event_id, name, max_guests) values
  ('dd000000-0000-7000-8000-0000000000c1', 'ee000000-0000-7000-8000-0000000000c1', 'Regular', null),
  ('dd000000-0000-7000-8000-0000000000c2', 'ee000000-0000-7000-8000-0000000000c1', 'VIP',     null);

insert into public.guests (id, event_id, tier_id, full_name, added_by, source, status) values
  ('cc000000-0000-7000-8000-0000000000c1', 'ee000000-0000-7000-8000-0000000000c1',
   'dd000000-0000-7000-8000-0000000000c1', 'Tom Guest 1', '55555555-5555-4555-8555-555555555555', 'app', 'approved'),
  ('cc000000-0000-7000-8000-0000000000c2', 'ee000000-0000-7000-8000-0000000000c1',
   'dd000000-0000-7000-8000-0000000000c1', 'Tom Guest 2', '55555555-5555-4555-8555-555555555555', 'app', 'approved'),
  ('cc000000-0000-7000-8000-0000000000c3', 'ee000000-0000-7000-8000-0000000000c1',
   'dd000000-0000-7000-8000-0000000000c1', 'Max Guest 1', '11111111-1111-4111-8111-111111111111', 'app', 'approved'),
  ('cc000000-0000-7000-8000-0000000000c4', 'ee000000-0000-7000-8000-0000000000c1',
   'dd000000-0000-7000-8000-0000000000c1', 'Max Guest 2', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select plan(7);

-- ---------------------------------------------------------------------------
-- A. Allowed: admin bulk-moves two guests Regular -> VIP. The write must land
--    in the DB (SELECT-back), not merely return "no error".
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  pg_temp.rowcount($$update public.guests set tier_id = 'dd000000-0000-7000-8000-0000000000c2'
    where id in ('cc000000-0000-7000-8000-0000000000c3','cc000000-0000-7000-8000-0000000000c4')$$),
  2, 'A1 admin bulk tier change updates both rows');
select is(
  (select count(*)::int from public.guests
   where id in ('cc000000-0000-7000-8000-0000000000c3','cc000000-0000-7000-8000-0000000000c4')
     and tier_id = 'dd000000-0000-7000-8000-0000000000c2'),
  2, 'A2 both guests actually carry the new tier (DB-state, not ok:true)');

-- reset c3,c4 back to Regular for section B (admin RLS write).
update public.guests set tier_id = 'dd000000-0000-7000-8000-0000000000c1'
  where id in ('cc000000-0000-7000-8000-0000000000c3','cc000000-0000-7000-8000-0000000000c4');

-- ---------------------------------------------------------------------------
-- B. C15 silent drop: staff Tom bulk-moves guests he does NOT own. RLS filters
--    every row -> ZERO affected -> no error. This is exactly the false success
--    the app-code `if (!count) return notFound()` guard must catch.
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.guests set tier_id = 'dd000000-0000-7000-8000-0000000000c2'
    where id in ('cc000000-0000-7000-8000-0000000000c3','cc000000-0000-7000-8000-0000000000c4')$$),
  0, 'B1 staff bulk-move of others'' guests changes ZERO rows (RLS silent filter — the C15 drop)');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.guests
   where id in ('cc000000-0000-7000-8000-0000000000c3','cc000000-0000-7000-8000-0000000000c4')
     and tier_id = 'dd000000-0000-7000-8000-0000000000c1'),
  2, 'B2 the denied staff write left both rows on their original tier');

-- ---------------------------------------------------------------------------
-- C. Control: staff Tom bulk-moves his OWN guests on an open list -> both land.
--    Proves count>0 (a real success) is correctly allowed through.
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.guests set tier_id = 'dd000000-0000-7000-8000-0000000000c2'
    where id in ('cc000000-0000-7000-8000-0000000000c1','cc000000-0000-7000-8000-0000000000c2')$$),
  2, 'C1 staff bulk-move of OWN guests updates both rows');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.guests
   where id in ('cc000000-0000-7000-8000-0000000000c1','cc000000-0000-7000-8000-0000000000c2')
     and tier_id = 'dd000000-0000-7000-8000-0000000000c2'),
  2, 'C2 both own guests actually carry the new tier');

-- reset c1,c2 back to Regular, then lock the list for section D (admin RLS write).
update public.guests set tier_id = 'dd000000-0000-7000-8000-0000000000c1'
  where id in ('cc000000-0000-7000-8000-0000000000c1','cc000000-0000-7000-8000-0000000000c2');
update public.events
  set list_locked = true, locked_by = '11111111-1111-4111-8111-111111111111', locked_at = now()
  where id = 'ee000000-0000-7000-8000-0000000000c1';

-- ---------------------------------------------------------------------------
-- D. List lock (#23): with events.list_locked = true, even staff's own-guest
--    bulk move is filtered to ZERO rows — the lock covers the bulk path too.
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  pg_temp.rowcount($$update public.guests set tier_id = 'dd000000-0000-7000-8000-0000000000c2'
    where id in ('cc000000-0000-7000-8000-0000000000c1','cc000000-0000-7000-8000-0000000000c2')$$),
  0, 'D1 list-locked staff bulk-move changes ZERO rows (lock applies to the bulk path)');

select * from finish();
rollback;
