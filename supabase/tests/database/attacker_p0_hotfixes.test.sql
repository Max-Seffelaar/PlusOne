-- pgTAP — P0 security hotfixes (full-app review 2026-07-07, ClickUp 86ey6xdgh).
-- Run: supabase test db. Proves the two headline boundaries this batch hardens:
--
--   C3 — anon can no longer enumerate events across venues. events_select_landing
--        is retired and the anon SELECT grant on events is revoked, so a raw anon
--        `select … from events` (with or without a filter) fails outright — even
--        with TWO venues holding landing-active events. get_landing_event (the
--        SECURITY DEFINER RPC) stays the ONLY anon path and yields just the one
--        requested slug.
--
--   C1 — the crew-invite write effect (event_organizers insert) rejects a
--        non-admin caller. inviteExternalCrew now hoists the admin-of-venue check
--        above its service-role calls; RLS is the DB backstop that same check
--        mirrors — a non-admin is refused, an admin of the venue succeeds.
--
-- Seed: venue aa..01 (Club Vesper) event ee..01 (landing active, slug
-- plusone-launch-night); venue aa..02 (De Marktzaal, Max=admin). Users: Max 11..
-- (admin), Tom 55.. (staff), user_manager 22.. Everything rolls back.

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

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

select plan(5);

-- Fixtures (as owner): a SECOND venue's landing-active event, so the "list every
-- tenant's events" attack has more than one venue to leak. Venue-1's seed event
-- is landing-active already; assert it explicitly.
insert into public.events (id, venue_id, name, starts_at, landing_slug, landing_active, status)
values ('ee000000-0000-7000-8000-0000000000c3',
        'aa000000-0000-7000-8000-000000000002',
        'C3 Marktzaal Night', now() + interval '10 days',
        'c3-marktzaal-night', true, 'open');
update public.events set landing_active = true
  where id = 'ee000000-0000-7000-8000-000000000001';

-- ── C3: anon cannot enumerate events across venues ──────────────────────────

select pg_temp.login_anon();

select throws_ok(
  $$ select count(*) from public.events where landing_active $$,
  '42501', null,
  'C3.1 anon cannot list landing-active events (both venues) — no cross-venue enumeration');

select throws_ok(
  $$ select id, name, venue_id from public.events $$,
  '42501', null,
  'C3.2 anon has no direct read on events at all (the enumeration surface is retired)');

-- The sanctioned anon path still works and reaches exactly the requested slug.
select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'ip-c3')),
  1, 'C3.3 get_landing_event resolves precisely the one requested event');

reset role;

-- ── C1: the crew-invite write path rejects a non-admin caller ───────────────
-- inviteExternalCrew writes event_organizers through the USER-scoped client;
-- RLS (event_organizers_insert_admin) is the boundary the hoisted admin check
-- mirrors. user_manager 22.. is the crew target (a valid user_profiles id, not
-- already crew of ee..01).

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff (non-admin)
select throws_ok(
  $$ insert into public.event_organizers (event_id, user_id)
     values ('ee000000-0000-7000-8000-000000000001',
             '22222222-2222-4222-8222-222222222222') $$,
  '42501', null,
  'C1.1 a non-admin (staff) cannot add crew to an event (RLS backstop)');

reset role;
select pg_temp.login('11111111-1111-4111-8111-111111111111', 'aal2');  -- admin
select lives_ok(
  $$ insert into public.event_organizers (event_id, user_id)
     values ('ee000000-0000-7000-8000-000000000001',
             '22222222-2222-4222-8222-222222222222') $$,
  'C1.2 an admin of the venue can add crew (the sanctioned path)');

reset role;

select * from finish();

rollback;
