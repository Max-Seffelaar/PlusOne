-- pgTAP — audit trail on location changes (z8uq9m49k2, migration 20261015140000).
-- Run: pnpm db:test.
--
-- Proves that every write to company_locations and every change to an event's
-- location_name / location_address lands in audit_log through the trigger
-- (CLAUDE.md rule 4), with the right actor, entity, action, venue/event scope
-- and a before/after diff; that a non-location event edit still writes nothing
-- (the trigger stays WHEN-gated); and that the audit rows are readable by the
-- venue's admin under RLS, and NOT by staff or the event's organizer (in
-- audit_log and in the audit_feed view). The get_request_status contract (no venue_* keys)
-- is asserted in event_locations.test.sql (C5/C7).
--
-- Seed: venue aa..01 (admin 11.., staff 55..); organizer 44.. organizes event
-- ee..01 without a membership. All rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- audit_log.created_at is now() (constant inside this one transaction) and a
-- UUIDv7 is not ordered within a millisecond, so "the newest row" is not a
-- thing a test can ask for. Instead: the ONE row for this entity not seen
-- before; it is marked seen on read. (Owner, RLS bypassed.)
create temp table seen (id uuid primary key);
create function pg_temp.last_audit(p_entity uuid)
returns public.audit_log language plpgsql as $fn$
declare
  v public.audit_log;
  n int;
begin
  select count(*) into n from public.audit_log a
   where a.entity_id = p_entity and not exists (select 1 from seen s where s.id = a.id);
  if n <> 1 then
    raise exception 'expected exactly one new audit row for %, found %', p_entity, n;
  end if;
  select a.* into v from public.audit_log a
   where a.entity_id = p_entity and not exists (select 1 from seen s where s.id = a.id);
  insert into seen values (v.id);
  return v;
end;
$fn$;
-- Rows that existed before this test (seed history) are already seen.
insert into seen select id from public.audit_log;

create function pg_temp.audit_count(p_entity uuid)
returns int language sql as $fn$
  select count(*)::int from public.audit_log where entity_id = p_entity;
$fn$;

-- ---------------------------------------------------------------------------
-- A. Triggers in place
-- ---------------------------------------------------------------------------

select ok(
  exists (select 1 from pg_trigger t
           where t.tgrelid = 'public.company_locations'::regclass
             and t.tgname = 'audit_company_locations'
             and not t.tgisinternal
             and t.tgfoid = 'public.audit_trigger()'::regprocedure
             -- AFTER (no BEFORE bit), ROW, INSERT|DELETE|UPDATE bits set
             and (t.tgtype & 2) = 0 and (t.tgtype & 1) = 1
             and (t.tgtype & 4) = 4 and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16),
  'A1 company_locations has an AFTER INSERT/UPDATE/DELETE row trigger on audit_trigger()');
select ok(
  (select pg_get_triggerdef(t.oid) ~ 'location_name' and pg_get_triggerdef(t.oid) ~ 'location_address'
          and pg_get_triggerdef(t.oid) ~ 'list_locked'
     from pg_trigger t
    where t.tgrelid = 'public.events'::regclass and t.tgname = 'audit_events'),
  'A2 the one events audit trigger now also fires on location_name / location_address (and still on list_locked)');
select is(
  (select count(*)::int from pg_trigger t
    where t.tgrelid = 'public.events'::regclass and not t.tgisinternal
      and t.tgfoid = 'public.audit_trigger()'::regprocedure),
  1, 'A3 still exactly ONE audit trigger on events (no duplicate rows per edit)');

-- ---------------------------------------------------------------------------
-- B. company_locations: create, update, archive — by the admin
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.company_locations (venue_id, name, address_line, postal_code, city, country)
values ('aa000000-0000-7000-8000-000000000001', 'Paradiso', 'Weteringschans 6', '1017 SG', 'Amsterdam', 'NL');
reset role;

create temp table loc as
  select id from public.company_locations
   where venue_id = 'aa000000-0000-7000-8000-000000000001' and name = 'Paradiso';
grant select on loc to authenticated;

select ok(
  (select a.entity_type = 'company_locations' and a.action = 'create'
          and a.actor_id = '11111111-1111-4111-8111-111111111111'
          and a.venue_id = 'aa000000-0000-7000-8000-000000000001' and a.event_id is null
          and a.diff -> 'before' = 'null'::jsonb
          and a.diff -> 'after' ->> 'name' = 'Paradiso'
          and a.diff -> 'after' ->> 'address_line' = 'Weteringschans 6'
     from pg_temp.last_audit((select id from loc)) a),
  'B1 adding a saved location writes a create row: admin as actor, venue scope, full snapshot after');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.company_locations set name = 'Paradiso Noord' where id = (select id from loc);
reset role;
select ok(
  (select a.action = 'update' and a.actor_id = '11111111-1111-4111-8111-111111111111'
          and a.diff -> 'before' = '{"name": "Paradiso"}'::jsonb
          and a.diff -> 'after' = '{"name": "Paradiso Noord"}'::jsonb
     from pg_temp.last_audit((select id from loc)) a),
  'B2 renaming writes an update row with only the changed column (before/after)');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.company_locations set archived_at = now() where id = (select id from loc);
reset role;
select ok(
  (select a.action = 'update' and a.actor_id = '11111111-1111-4111-8111-111111111111'
          and a.diff -> 'before' ->> 'archived_at' is null
          and a.diff -> 'after' ->> 'archived_at' is not null
     from pg_temp.last_audit((select id from loc)) a),
  'B3 archiving writes an update row with archived_at null → set');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.company_locations set archived_at = null where id = (select id from loc);
reset role;
select ok(
  (select a.diff -> 'before' ->> 'archived_at' is not null and a.diff -> 'after' ->> 'archived_at' is null
     from pg_temp.last_audit((select id from loc)) a),
  'B4 un-archiving is audited too');
select is(pg_temp.audit_count((select id from loc)), 4, 'B5 four writes, four audit rows');

-- A no-op update (same value) writes nothing (audit_changed returns null).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.company_locations set name = 'Paradiso Noord' where id = (select id from loc);
reset role;
select is(pg_temp.audit_count((select id from loc)), 4, 'B6 a no-op update writes no audit row');

-- A delete (owner only: no app role holds DELETE) is still audited, actor NULL.
select set_config('request.jwt.claims', '', true);  -- no caller: auth.uid() is null
delete from public.company_locations where id = (select id from loc);
select ok(
  (select a.action = 'delete' and a.actor_id is null
          and a.diff -> 'after' = 'null'::jsonb and a.diff -> 'before' ->> 'name' = 'Paradiso Noord'
     from pg_temp.last_audit((select id from loc)) a),
  'B7 even an owner-level delete is audited (full snapshot before, actor NULL)');

-- ---------------------------------------------------------------------------
-- C. events: a location change is audited; other edits stay WHEN-gated
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events
   set location_name = 'Melkweg', location_address = 'Lijnbaansgracht 234A, 1017 PH Amsterdam'
 where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select ok(
  (select a.entity_type = 'events' and a.action = 'update'
          and a.actor_id = '11111111-1111-4111-8111-111111111111'
          and a.event_id = 'ee000000-0000-7000-8000-000000000001'
          and a.venue_id = 'aa000000-0000-7000-8000-000000000001'
          and a.diff -> 'before' ->> 'location_name' is null
          and a.diff -> 'after' ->> 'location_name' = 'Melkweg'
          and a.diff -> 'after' ->> 'location_address' = 'Lijnbaansgracht 234A, 1017 PH Amsterdam'
     from pg_temp.last_audit('ee000000-0000-7000-8000-000000000001') a),
  'C1 setting an event location writes an update row: admin, event + venue scope, before/after');

create temp table n0 as select pg_temp.audit_count('ee000000-0000-7000-8000-000000000001') as n;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events set name = 'PLUSONE Launch Night (renamed)'
 where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select is(pg_temp.audit_count('ee000000-0000-7000-8000-000000000001'), (select n from n0),
  'C2 a name-only edit still writes no audit row (the trigger stays gated on audited columns)');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events set location_address = 'Lijnbaansgracht 234A, Amsterdam', name = 'PLUSONE Launch Night'
 where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select is(pg_temp.audit_count('ee000000-0000-7000-8000-000000000001'), (select n from n0) + 1,
  'C3 an edit that also changes the address writes exactly one row');
select ok(
  (select a.diff -> 'after' ? 'location_address' and a.diff -> 'after' ? 'name'
          and not (a.diff -> 'after' ? 'location_name')
     from pg_temp.last_audit('ee000000-0000-7000-8000-000000000001') a),
  'C4 ...whose diff carries every changed column of that edit, and nothing unchanged');

-- The event's organizer (no membership) edits the location: audited on them.
select pg_temp.login('44444444-4444-4444-8444-444444444444');
update public.events set location_name = 'Melkweg Max'
 where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select is(
  (select a.actor_id from pg_temp.last_audit('ee000000-0000-7000-8000-000000000001') a),
  '44444444-4444-4444-8444-444444444444'::uuid,
  'C5 an organizer''s location edit is audited on the organizer');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
update public.events set location_name = null, location_address = null
 where id = 'ee000000-0000-7000-8000-000000000001';
reset role;
select ok(
  (select a.diff -> 'before' ->> 'location_name' = 'Melkweg Max'
          and a.diff -> 'after' -> 'location_name' = 'null'::jsonb
          and a.diff -> 'after' -> 'location_address' = 'null'::jsonb
     from pg_temp.last_audit('ee000000-0000-7000-8000-000000000001') a),
  'C6 clearing the location is audited (after = null)');

-- ---------------------------------------------------------------------------
-- D. Visibility under RLS
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select ok(
  (select count(*) from public.audit_log where entity_id = (select id from loc)) >= 4,
  'D1 the venue admin reads the company_locations audit rows of their venue');
select ok(
  (select count(*) from public.audit_log
    where entity_id = 'ee000000-0000-7000-8000-000000000001' and entity_type = 'events'
      and diff -> 'after' ? 'location_name') >= 1,
  'D2 ...and the event location rows');
reset role;

-- Denied (DoD #3): staff of the venue and the event's organizer read none of
-- these rows, neither in audit_log nor through the audit_feed view.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'company_locations'
       or (entity_id = 'ee000000-0000-7000-8000-000000000001' and diff -> 'after' ? 'location_name')),
  0, 'D3 staff reads no location audit rows in audit_log');
select is(
  (select count(*)::int from public.audit_feed
    where entity_type = 'company_locations'
       or (entity_id = 'ee000000-0000-7000-8000-000000000001' and diff -> 'after' ? 'location_name')),
  0, 'D4 ...nor through audit_feed');
reset role;
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'company_locations'
       or (entity_id = 'ee000000-0000-7000-8000-000000000001' and diff -> 'after' ? 'location_name')),
  0, 'D5 the event''s organizer (no membership) reads no location audit rows in audit_log, not even their own edit');
select is(
  (select count(*)::int from public.audit_feed
    where entity_type = 'company_locations'
       or (entity_id = 'ee000000-0000-7000-8000-000000000001' and diff -> 'after' ? 'location_name')),
  0, 'D6 ...nor through audit_feed');
reset role;

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ insert into public.audit_log (actor_id, venue_id, entity_type, entity_id, action, diff)
     values ('11111111-1111-4111-8111-111111111111', 'aa000000-0000-7000-8000-000000000001',
             'company_locations', gen_random_uuid(), 'create', '{}'::jsonb) $$,
  '42501', null, 'D7 no app role can forge a location audit row directly');
reset role;

select * from finish();
rollback;
