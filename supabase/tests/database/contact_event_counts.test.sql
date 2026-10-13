-- pgTAP — contact_event_counts (Snelheid P2 finding 6, 20261017120200).
-- The RPC replaces a client loop of guests.in('contact_id', …) reads, so its
-- contract is: per role it returns EXACTLY what a direct GROUP BY over the
-- guests that role can already read returns (SECURITY INVOKER, role-relative),
-- never more (admin, organizer, staff, doorhost, user_manager, no membership);
-- removed guests and other venues never count. Everything rolls back.

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

select plan(16);

-- Fixture (superuser): a second Club Vesper event WITHOUT the organizer, Sanne
-- (permanent) on both events plus a removed duplicate on event 1 (distinct
-- events, not rows), Pim (ordinary) on event 2 as a REMOVED guest (must not count).
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active)
  values ('ee000000-0000-7000-8000-0000000c0e02', 'aa000000-0000-7000-8000-000000000001',
          'Counts Test Two', now() + interval '9 days', now() + interval '9 days 4 hours',
          'open', 'counts-test-two', false);
insert into public.guest_tiers (id, event_id, name, color, aliases)
  values ('dd000000-0000-7000-8000-0000000c0d02', 'ee000000-0000-7000-8000-0000000c0e02',
          'Regular', '#8A8A93', '{}');
-- One live row per (event, contact) is a unique index, so the extra Sanne row
-- on event 1 is a removed one (removed first, then her live row).
insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source) values
  ('cc000000-0000-7000-8000-0000000c0c02', 'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001', 'Sanne Mulder', 'c0000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'app');
update public.guests set status = 'removed' where id = 'cc000000-0000-7000-8000-0000000c0c02';
insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source) values
  ('cc000000-0000-7000-8000-0000000c0c01', 'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001', 'Sanne Mulder', 'c0000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'app');
insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source) values
  ('cc000000-0000-7000-8000-0000000c0c03', 'ee000000-0000-7000-8000-0000000c0e02', 'dd000000-0000-7000-8000-0000000c0d02', 'Sanne Mulder', 'c0000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'app');
insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source) values
  ('cc000000-0000-7000-8000-0000000c0c04', 'ee000000-0000-7000-8000-0000000c0e02', 'dd000000-0000-7000-8000-0000000c0d02', 'Pim Scholten', 'c0000000-0000-7000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'app');
update public.guests set status = 'removed' where id = 'cc000000-0000-7000-8000-0000000c0c04';

-- The superuser truth for venue 1, as text so it survives the role switch.
select set_config('test.truth_v1', coalesce((
  select string_agg(contact_id::text || ':' || n, ',' order by contact_id)
    from (select g.contact_id, count(distinct g.event_id) as n
            from public.guests g
           where g.venue_id = 'aa000000-0000-7000-8000-000000000001'
             and g.contact_id is not null and g.status <> 'removed'
           group by g.contact_id) t), ''), true);

-- ── Shape ────────────────────────────────────────────────────────────────────
select is((select prosecdef from pg_proc where oid = 'public.contact_event_counts(uuid)'::regprocedure),
  false, '1 contact_event_counts is SECURITY INVOKER (role-relative through RLS)');
select ok(not has_function_privilege('anon', 'public.contact_event_counts(uuid)', 'execute'),
  '2 anon cannot execute contact_event_counts');
select ok(has_function_privilege('authenticated', 'public.contact_event_counts(uuid)', 'execute'),
  '3 authenticated can execute contact_event_counts');

-- ── Admin: the full truth ────────────────────────────────────────────────────
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select coalesce(string_agg(contact_id::text || ':' || event_count, ',' order by contact_id), '')
     from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')),
  current_setting('test.truth_v1'),
  '4 admin: RPC equals the superuser GROUP BY for the venue');
select is(
  (select event_count from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')
    where contact_id = 'c0000000-0000-7000-8000-000000000001'),
  2, '5 Sanne on two events (plus a removed duplicate) = 2 distinct events');
select is(
  (select event_count from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')
    where contact_id = 'c0000000-0000-7000-8000-000000000003'),
  1, '6 a removed guest row never counts (Pim: seeded on event 1, removed on event 2)');
-- ── Doorhost and user_manager: their own RLS read, never more ─────────────
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select is(
  (select coalesce(string_agg(contact_id::text || ':' || event_count, ',' order by contact_id), '')
     from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')),
  (select coalesce(string_agg(contact_id::text || ':' || n, ',' order by contact_id), '')
     from (select g.contact_id, count(distinct g.event_id) as n from public.guests g
            where g.venue_id = 'aa000000-0000-7000-8000-000000000001'
              and g.contact_id is not null and g.status <> 'removed'
            group by g.contact_id) t),
  '7 doorhost: RPC equals a direct GROUP BY over what RLS shows them');
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select is(
  (select coalesce(string_agg(contact_id::text || ':' || event_count, ',' order by contact_id), '')
     from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')),
  (select coalesce(string_agg(contact_id::text || ':' || n, ',' order by contact_id), '')
     from (select g.contact_id, count(distinct g.event_id) as n from public.guests g
            where g.venue_id = 'aa000000-0000-7000-8000-000000000001'
              and g.contact_id is not null and g.status <> 'removed'
            group by g.contact_id) t),
  '8 user_manager: RPC equals a direct GROUP BY over what RLS shows them');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.contact_event_counts('aa000000-0000-7000-8000-000000000001') r
     join public.guests g on g.contact_id = r.contact_id
    where g.venue_id <> 'aa000000-0000-7000-8000-000000000001'
      and not exists (select 1 from public.guests g2
                       where g2.contact_id = r.contact_id
                         and g2.venue_id = 'aa000000-0000-7000-8000-000000000001')),
  0, '9 venue 2 appearances never leak into venue 1 counts');

-- ── Organizer: event scope only ─────────────────────────────────────────────
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  (select coalesce(string_agg(contact_id::text || ':' || event_count, ',' order by contact_id), '')
     from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')),
  (select coalesce(string_agg(contact_id::text || ':' || n, ',' order by contact_id), '')
     from (select g.contact_id, count(distinct g.event_id) as n from public.guests g
            where g.venue_id = 'aa000000-0000-7000-8000-000000000001'
              and g.contact_id is not null and g.status <> 'removed'
            group by g.contact_id) t),
  '10 organizer: RPC equals a direct GROUP BY over what RLS shows them');
select is(
  coalesce((select event_count from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')
             where contact_id = 'c0000000-0000-7000-8000-000000000001'), 0),
  1, '11 organizer does not count the event they do not organize');

-- ── Staff: no address-book read ─────────────────────────────────────────────
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select count(*)::int from public.contact_event_counts('aa000000-0000-7000-8000-000000000001') r
    where not exists (select 1 from public.guests g where g.contact_id = r.contact_id)),
  0, '12 staff: every counted contact is on a guest row staff can read');
select is(
  (select coalesce(string_agg(contact_id::text || ':' || event_count, ',' order by contact_id), '')
     from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')),
  (select coalesce(string_agg(contact_id::text || ':' || n, ',' order by contact_id), '')
     from (select g.contact_id, count(distinct g.event_id) as n from public.guests g
            where g.venue_id = 'aa000000-0000-7000-8000-000000000001'
              and g.contact_id is not null and g.status <> 'removed'
            group by g.contact_id) t),
  '13 staff: never more than a direct guests read already gives');

-- ── Finance of venue 1 asking for venue 2 ───────────────────────────────────
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::int from public.contact_event_counts('aa000000-0000-7000-8000-000000000002')),
  0, '14 finance of venue 1 gets nothing for venue 2 (cross-venue isolation)');

-- ── A signed-in user with no membership anywhere ─────────────────────────────
select pg_temp.login('99999999-9999-4999-8999-999999999999');
select is(
  (select count(*)::int from public.contact_event_counts('aa000000-0000-7000-8000-000000000001')),
  0, '15 a user with no membership gets nothing');

-- ── anon ────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$ select * from public.contact_event_counts('aa000000-0000-7000-8000-000000000001') $$,
  '42501', null, '16 anon is refused');

reset role;
select * from finish();
rollback;
