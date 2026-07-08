-- pgTAP — Requests-epic F1: request_links (86ey21vjt). Run: supabase test db.
-- Proves the default-link lifecycle (backfill, create-on-event-insert, slug
-- sync, generator collision avoidance), the RLS matrix (admin/organizer write,
-- finance read, staff/doorhost/anon nothing), the integrity triggers (venue
-- scope, influencer venue guard, immutable slug/event/is_default, one default),
-- and get_landing_event (#28 no-enumeration). Seed: event ee..01 (venue aa..01,
-- slug plusone-launch-night, tiers dd..01/dd..02); Max 11..=admin (both venues),
-- finance 33.., Yusuf 44..=organizer of ee..01, Tom 55..=staff, Lisa
-- 66..=doorhost. All rolls back.

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

create function pg_temp.rowcount(p_sql text)
returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

select plan(30);

-- ---------------------------------------------------------------------------
-- A. Default link: backfill + create-on-insert + slug sync + generator
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.request_links
   where event_id = 'ee000000-0000-7000-8000-000000000001'
     and is_default and slug = 'plusone-launch-night' and active),
  1, 'A1 the seed event has exactly one backfilled default link mirroring landing_slug');

insert into public.events (id, venue_id, name, starts_at)
values ('ee000000-0000-7000-8000-00000000e001', 'aa000000-0000-7000-8000-000000000001',
        'Trigger Test Night', now() + interval '10 days');
select is(
  (select count(*)::int from public.request_links
   where event_id = 'ee000000-0000-7000-8000-00000000e001' and is_default),
  1, 'A2 creating an event creates its default link by trigger');

update public.events set landing_slug = 'renamed-for-test'
  where id = 'ee000000-0000-7000-8000-00000000e001';
select is(
  (select slug from public.request_links
   where event_id = 'ee000000-0000-7000-8000-00000000e001' and is_default),
  'renamed-for-test', 'A3 renaming landing_slug syncs the default link slug (old URL = admin field)');

-- The generator keeps the {name}-{date}-{4-char-random} format (20260625110000)
-- and its collision loop now also checks the request_links namespace.
insert into public.events (id, venue_id, name, starts_at)
values ('ee000000-0000-7000-8000-00000000e002', 'aa000000-0000-7000-8000-000000000001',
        'Collide Me', '2099-01-01T22:00:00Z');
select ok(
  (select landing_slug from public.events where id = 'ee000000-0000-7000-8000-00000000e002')
    like 'collide-me-2099-01-01-____',
  'A4 the generated slug keeps the {name}-{date}-{random} format');

-- ---------------------------------------------------------------------------
-- B. RLS matrix
-- ---------------------------------------------------------------------------

-- Fixture influencers: one per venue (as superuser; influencer RLS has its own file).
insert into public.influencers (id, venue_id, name, created_by) values
  ('1f000000-0000-7000-8000-00000000c001', 'aa000000-0000-7000-8000-000000000001',
   'Nova Promo', '11111111-1111-4111-8111-111111111111'),
  ('1f000000-0000-7000-8000-00000000c002', 'aa000000-0000-7000-8000-000000000002',
   'Verkeerde Venue', '11111111-1111-4111-8111-111111111111');

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
select is(
  pg_temp.rowcount($$ insert into public.request_links
      (event_id, influencer_id, slug, tier_id, max_headcount, created_by)
    values ('ee000000-0000-7000-8000-000000000001',
            '1f000000-0000-7000-8000-00000000c001', 'nova-link',
            'dd000000-0000-7000-8000-000000000001', 25,
            '11111111-1111-4111-8111-111111111111') $$),
  1, 'B1 admin creates an influencer link on a venue event');

reset role;
select is(
  (select venue_id from public.request_links where slug = 'nova-link'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'B2 the scope trigger stamps venue_id from the event (client value untrusted)');

select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- organizer of ee..01
select is(
  pg_temp.rowcount($$ insert into public.request_links (event_id, label, slug, created_by)
    values ('ee000000-0000-7000-8000-000000000001', 'Insta bio', 'yusuf-insta-link',
            '44444444-4444-4444-8444-444444444444') $$),
  1, 'B3 an event organizer creates a link on their own event');
select is(
  (select count(*)::int from public.request_links
   where event_id = 'ee000000-0000-7000-8000-000000000001'),
  4, 'B4 the organizer reads the event''s links (default + seed influencer + nova + own)');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select throws_ok(
  $$ insert into public.request_links (event_id, label, slug, created_by)
     values ('ee000000-0000-7000-8000-000000000001', 'Staff Link', 'staff-link',
             '55555555-5555-4555-8555-555555555555') $$,
  '42501', null, 'B5 staff cannot create request links');
select is(
  (select count(*)::int from public.request_links),
  0, 'B6 staff sees no links at all (no link management for staff)');

select pg_temp.login('66666666-6666-4666-8666-666666666666'); -- doorhost
select is(
  pg_temp.rowcount($$ update public.request_links set active = false where slug = 'nova-link' $$),
  0, 'B7 doorhost cannot pause a link (the row is not update-visible)');

select pg_temp.login('33333333-3333-4333-8333-333333333333'); -- finance
select is(
  (select count(*)::int from public.request_links
   where event_id = 'ee000000-0000-7000-8000-000000000001'),
  4, 'B8 finance reads the venue''s links');
select throws_ok(
  $$ insert into public.request_links (event_id, label, slug, created_by)
     values ('ee000000-0000-7000-8000-000000000001', 'Fin', 'fin-link',
             '33333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'B9 finance is read-only on links');

select pg_temp.login_anon();
select is(
  (select count(*)::int from public.request_links),
  0, 'B10 anon resolves links only via the DEFINER RPCs — direct select yields zero rows');
select throws_ok(
  $$ insert into public.request_links (event_id, label, slug)
     values ('ee000000-0000-7000-8000-000000000001', 'Anon', 'anon-link') $$,
  '42501', null, 'B11 anon cannot create links');
reset role;

-- ---------------------------------------------------------------------------
-- C. Integrity triggers + constraints
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.request_links (event_id, influencer_id, slug)
     values ('ee000000-0000-7000-8000-000000000001',
             '1f000000-0000-7000-8000-00000000c002', 'wrong-venue-link') $$,
  '23514', null, 'C1 an influencer from another venue is rejected');

select throws_ok(
  $$ insert into public.request_links (event_id, label, slug, auto_approve)
     values ('ee000000-0000-7000-8000-000000000001', 'No Tier', 'no-tier-auto', true) $$,
  '23514', null, 'C2 auto-approve requires a pinned tier (CHECK)');

select throws_ok(
  $$ insert into public.request_links (event_id, slug, is_default)
     values ('ee000000-0000-7000-8000-000000000001', 'second-default', true) $$,
  '23505', null, 'C3 an event cannot get a second default link');

select throws_ok(
  $$ update public.request_links set slug = 'nova-link-hijack' where slug = 'nova-link' $$,
  '23514', null, 'C4 a non-default link''s slug is immutable (shared URLs/QRs never die by edit)');

select throws_ok(
  $$ update public.request_links
     set event_id = 'ee000000-0000-7000-8000-00000000e001' where slug = 'nova-link' $$,
  '23514', null, 'C5 a link never moves to another event');

select throws_ok(
  $$ update public.request_links set is_default = false
     where event_id = 'ee000000-0000-7000-8000-000000000001' and is_default $$,
  '23514', null, 'C6 is_default never flips');

-- A tier of ANOTHER event cannot be pinned (composite FK).
insert into public.guest_tiers (id, event_id, name)
values ('dd000000-0000-7000-8000-0000000000e1',
        'ee000000-0000-7000-8000-00000000e001', 'Other Event Tier');
select throws_ok(
  $$ insert into public.request_links (event_id, label, slug, tier_id)
     values ('ee000000-0000-7000-8000-000000000001', 'X', 'cross-tier-link',
             'dd000000-0000-7000-8000-0000000000e1') $$,
  '23503', null, 'C7 a tier from another event violates the composite FK');

-- ---------------------------------------------------------------------------
-- D. get_landing_event — one namespace, no enumeration (#28)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();
select is(
  (select event_name from public.get_landing_event('plusone-launch-night', 'ip-rl')),
  'PLUSONE Launch Night', 'D1 the legacy /e slug resolves through its default link');
select is(
  (select via_label from public.get_landing_event('plusone-launch-night', 'ip-rl')),
  null, 'D2 the default link carries no via-label');
select is(
  (select via_label from public.get_landing_event('nova-link', 'ip-rl')),
  'Nova Promo', 'D3 an influencer link surfaces the influencer as via-label');
select is(
  (select via_label from public.get_landing_event('yusuf-insta-link', 'ip-rl')),
  'Insta bio', 'D4 a label-only link surfaces its label');
select is(
  (select coalesce(spots_left::text, 'null') || ':' from public.get_landing_event('yusuf-insta-link', 'ip-rl'))
    || (select spots_left::text from public.get_landing_event('nova-link', 'ip-rl')),
  'null:25',
  'D4b spots_left: uncapped disloses nothing, a capped link its remaining headcount (#43)');
select is(
  (select count(*)::int from public.get_landing_event('does-not-exist', 'ip-rl')),
  0, 'D5 an unknown slug resolves to nothing');

reset role;
update public.request_links set active = false where slug = 'nova-link';
select pg_temp.login_anon();
select is(
  (select count(*)::int from public.get_landing_event('nova-link', 'ip-rl')),
  0, 'D6 a paused link is indistinguishable from an unknown one');

reset role;
update public.request_links set active = true where slug = 'nova-link';
update public.events set landing_active = false
  where id = 'ee000000-0000-7000-8000-000000000001';
select pg_temp.login_anon();
select is(
  (select count(*)::int from public.get_landing_event('nova-link', 'ip-rl')),
  0, 'D7 the event master switch (landing_active) closes every link of the event');
reset role;
update public.events set landing_active = true
  where id = 'ee000000-0000-7000-8000-000000000001';

select * from finish();

rollback;
