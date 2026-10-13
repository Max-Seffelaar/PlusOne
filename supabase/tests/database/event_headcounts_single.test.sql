-- pgTAP — venue_event_headcounts p_event_id (Snelheid P2, 20261017120300).
-- The single-event filter must return exactly that event's row of the
-- venue-wide aggregate, per role (SECURITY INVOKER: staff still count only
-- their own guests), nothing for another venue's event, and leave the
-- existing call shapes ({p_venue_id}, {p_venue_id, p_since}) unchanged.
-- Everything rolls back.

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

select plan(13);

-- ── Shape ────────────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'venue_event_headcounts'),
  1, '1 exactly one venue_event_headcounts overload (no PGRST203)');
select is((select prosecdef from pg_proc where oid = 'public.venue_event_headcounts(uuid, timestamptz, uuid)'::regprocedure),
  false, '2 venue_event_headcounts stays SECURITY INVOKER');
select ok(not has_function_privilege('anon', 'public.venue_event_headcounts(uuid, timestamptz, uuid)', 'execute'),
  '3 anon cannot execute venue_event_headcounts');

-- A second Club Vesper event with an admin guest, so the venue has two rows.
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active)
  values ('ee000000-0000-7000-8000-0000000c1e02', 'aa000000-0000-7000-8000-000000000001',
          'Headcount Two', now() + interval '8 days', now() + interval '8 days 5 hours',
          'open', 'headcount-two', false);
insert into public.guest_tiers (id, event_id, name, color, aliases)
  values ('dd000000-0000-7000-8000-0000000c1d02', 'ee000000-0000-7000-8000-0000000c1e02', 'Regular', '#8A8A93', '{}');
insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('ee000000-0000-7000-8000-0000000c1e02', 'dd000000-0000-7000-8000-0000000c1d02',
          'Headcount Gast', 2, '11111111-1111-4111-8111-111111111111', 'app');

-- A partial arrival on the second event: +3 with 1 companion through the door.
insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by, source)
  values ('cc000000-0000-7000-8000-0000000c1c03', 'ee000000-0000-7000-8000-0000000c1e02',
          'dd000000-0000-7000-8000-0000000c1d02', 'Partial Gast', 3, '11111111-1111-4111-8111-111111111111', 'app');
insert into public.check_ins (guest_id, event_id, checked_by, plus_ones_arrived)
  values ('cc000000-0000-7000-8000-0000000c1c03', 'ee000000-0000-7000-8000-0000000c1e02',
          '11111111-1111-4111-8111-111111111111', 1);

-- ── Admin ────────────────────────────────────────────────────────────────────
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001')),
  2, '4 admin: the venue-wide call (no new argument) still returns every event');
select is((select count(*)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            p_event_id => 'ee000000-0000-7000-8000-0000000c1e02')),
  1, '5 admin: p_event_id returns one row');
select is((select row(registered, present)::text from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            p_event_id => 'ee000000-0000-7000-8000-000000000001')),
  (select row(registered, present)::text from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001')
    where event_id = 'ee000000-0000-7000-8000-000000000001'),
  '6 admin: the single-event row equals that event''s row of the venue-wide aggregate');
select is((select registered from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            p_event_id => 'ee000000-0000-7000-8000-0000000c1e02')),
  7, '7 admin: 1 + plus_ones on the second event (+2 and +3)');
select is((select present from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            p_event_id => 'ee000000-0000-7000-8000-0000000c1e02')),
  2, '7b admin: present counts arrived heads on the single-event path (1 + 1 of a +3)');
select is((select count(*)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            now() + interval '6 days', 'ee000000-0000-7000-8000-000000000001')),
  0, '8 p_since and p_event_id combine (event 1 starts before the cutoff)');
select is((select count(*)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000002',
            p_event_id => 'ee000000-0000-7000-8000-000000000001')),
  0, '9 an event of another venue yields nothing (venue filter still applies)');

-- ── Organizer of event 1 asking for event 2 (not theirs) ────────────────────
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            p_event_id => 'ee000000-0000-7000-8000-0000000c1e02')),
  0, '9b organizer: an event they do not organize has no row (p_event_id never widens RLS)');

-- ── Staff: own guests only ──────────────────────────────────────────────────
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is((select registered from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            p_event_id => 'ee000000-0000-7000-8000-000000000001')),
  (select coalesce(sum(1 + plus_ones) filter (where status in ('approved', 'checked_in')), 0)::int
     from public.guests where event_id = 'ee000000-0000-7000-8000-000000000001'
      and added_by = '55555555-5555-4555-8555-555555555555'),
  '10 staff: the single-event count stays own-guests-only');
select is((select count(*)::int from public.venue_event_headcounts('aa000000-0000-7000-8000-000000000001',
            p_event_id => 'ee000000-0000-7000-8000-0000000c1e02')),
  0, '11 staff: an event with none of their guests has no row');

reset role;
select * from finish();
rollback;
