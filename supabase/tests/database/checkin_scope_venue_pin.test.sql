-- pgTAP — 86ey9ekc3: check_ins/refusals cross-tenant venue_id integrity, the
-- same S1 exploit class as 86ey9e84m, on the sister tables the adversarial
-- review of that PR did not cover. Proves migration
-- 20260713170000_checkin_scope_venue_pin closes it.
-- Relies on the same seed as rls.test.sql (venue1=aa..01 Club Vesper,
-- venue2=aa..02 De Marktzaal, event ee..01 in venue1, admin=1111,
-- staff=5555, doorhost=6666666...). Everything rolls back.

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

select plan(5);

-- ---------------------------------------------------------------------------
-- S1b-equiv-a. Regression: the everyday path (no event_id/venue_id sent)
-- still fills correctly from the guest.
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
values ('cc000000-0000-7000-8000-000000000001',
        '66666666-6666-4666-8666-666666666666', 0);
select is(
  (select venue_id from public.check_ins where guest_id = 'cc000000-0000-7000-8000-000000000001'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1b-equiv-a check_ins venue_id auto-fills from the guest when omitted (regression)');
reset role;

-- ---------------------------------------------------------------------------
-- S1b-equiv-b. Injection: doorhost forges venue_id to the OTHER venue on a
-- check_ins INSERT (event_id still a real venue-1 event) — must be silently
-- corrected back to the guest's real venue.
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
insert into public.check_ins
  (guest_id, checked_by, plus_ones_arrived, event_id, venue_id)
values ('cc000000-0000-7000-8000-000000000006',
        '66666666-6666-4666-8666-666666666666', 0,
        'ee000000-0000-7000-8000-000000000001',
        'aa000000-0000-7000-8000-000000000002');
select is(
  (select venue_id from public.check_ins where guest_id = 'cc000000-0000-7000-8000-000000000006'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1b-equiv-b forged venue_id on check_ins INSERT is ignored, pinned to the guest''s real venue');
reset role;

-- ---------------------------------------------------------------------------
-- S1c-equiv. Same exploit via UPDATE of an existing check_ins row (admin,
-- guest_id unchanged) — forging venue_id post-insert must also be corrected.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.check_ins
   set venue_id = 'aa000000-0000-7000-8000-000000000002'
 where guest_id = 'cc000000-0000-7000-8000-000000000006';
select is(
  (select venue_id from public.check_ins where guest_id = 'cc000000-0000-7000-8000-000000000006'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1c-equiv forged venue_id on check_ins UPDATE is ignored too');
reset role;

-- ---------------------------------------------------------------------------
-- S1d-equiv. Regression: refusals venue_id auto-fills correctly when omitted.
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
insert into public.refusals (guest_id, refused_by, reason)
values ('cc000000-0000-7000-8000-000000000004',
        '66666666-6666-4666-8666-666666666666', 'Geen geldig ID');
select is(
  (select venue_id from public.refusals where guest_id = 'cc000000-0000-7000-8000-000000000004'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1d-equiv refusals venue_id auto-fills from the guest when omitted (regression)');
reset role;

-- ---------------------------------------------------------------------------
-- S1e-equiv. Injection: doorhost forges venue_id to the OTHER venue on a
-- refusals INSERT — must be silently corrected.
-- ---------------------------------------------------------------------------

select pg_temp.login('66666666-6666-4666-8666-666666666666');
insert into public.refusals
  (guest_id, refused_by, reason, event_id, venue_id)
values ('cc000000-0000-7000-8000-000000000007',
        '66666666-6666-4666-8666-666666666666', 'Geen geldig ID',
        'ee000000-0000-7000-8000-000000000001',
        'aa000000-0000-7000-8000-000000000002');
select is(
  (select venue_id from public.refusals where guest_id = 'cc000000-0000-7000-8000-000000000007'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'S1e-equiv forged venue_id on refusals INSERT is ignored, pinned to the guest''s real venue');
reset role;

select * from finish();

rollback;
