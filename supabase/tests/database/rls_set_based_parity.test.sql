-- pgTAP — set-based RLS keeps the exact allowed/denied matrix (z8uq9m2xz2 9-DB,
-- 20261017120000_rls_set_based_helpers.sql + 20261017120100_check_ins_update_policy_merge.sql).
--
-- A diff test. One probe matrix — 9 personas × guests / check_ins / refusals /
-- guest_requests / events × SELECT (which rows) / UPDATE (per row, several
-- column shapes) / INSERT (per event, several shapes) — runs twice in this one
-- transaction:
--   phase 'new'  under the migrated set-based policies;
--   phase 'old'  after this file restores the pre-20261017 policy text
--                (helper-per-row, two permissive check_ins UPDATE policies).
-- The two outcome sets must be identical, probe for probe (test 3). Every write
-- probe runs in its own subtransaction that a sentinel exception rolls back, so
-- no probe sees another's effect and both phases start from the same rows.
-- Tests 4+ pin the NEW matrix to hand-checked absolute numbers per persona,
-- table and operation, so the diff cannot pass vacuously (e.g. both phases
-- denying everything) — that table is the matrix in the PR body.
--
-- Personas (seed + this file):
--   admin     11..1  admin at Club Vesper (aa..01) AND De Marktzaal (aa..02)
--   manager   22..2  user_manager at aa..01
--   finance   33..3  finance at aa..01
--   crew      44..4  organizer of ee..01 (aa..01) and of E3 (aa..02), no membership
--   staff     55..5  staff at aa..01
--   doorhost  66..6  doorhost+staff at aa..01
--   otheradm  77..7  admin+doorhost+finance at aa..02 only
--   outsider  88..8  no membership, no crew
--   platform  99..9  is_platform_admin, no membership (spec #49)
-- Events: ee..01 (seed, aa..01, open), E2 (aa..01, list_locked), E3 (aa..02).

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

-- ── Fixture (owner) ─────────────────────────────────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('77777777-7777-4777-8777-777777777777'::uuid, 'otheradm@plusone.test', 'Other Admin'),
  ('88888888-8888-4888-8888-888888888888'::uuid, 'outsider@plusone.test', 'Out Sider'),
  ('99999999-9999-4999-8999-999999999999'::uuid, 'platform@plusone.test', 'Plat Form')
) as u (id, email, full_name);

insert into public.user_profiles (id, full_name, email) values
  ('77777777-7777-4777-8777-777777777777', 'Other Admin', 'otheradm@plusone.test'),
  ('88888888-8888-4888-8888-888888888888', 'Out Sider', 'outsider@plusone.test'),
  ('99999999-9999-4999-8999-999999999999', 'Plat Form', 'platform@plusone.test')
on conflict (id) do nothing;

select set_config('plusone.platform_admin_write', 'on', true);
update public.user_profiles set is_platform_admin = true
 where id = '99999999-9999-4999-8999-999999999999';
select set_config('plusone.platform_admin_write', 'off', true);

insert into public.venue_memberships (venue_id, user_id, roles) values
  ('aa000000-0000-7000-8000-000000000002', '77777777-7777-4777-8777-777777777777',
   '{admin,doorhost,finance}');

insert into public.events (id, venue_id, name, starts_at, ends_at, status, list_locked) values
  ('ee000000-0000-7000-8000-0000000000e2', 'aa000000-0000-7000-8000-000000000001',
   'Parity locked', now() + interval '3 days', now() + interval '3 days 6 hours', 'open', false),
  ('ee000000-0000-7000-8000-0000000000e3', 'aa000000-0000-7000-8000-000000000002',
   'Parity other venue', now() + interval '4 days', now() + interval '4 days 6 hours', 'open', false);

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-0000000000e3', '44444444-4444-4444-8444-444444444444');

insert into public.guest_tiers (id, event_id, name, color, aliases) values
  ('dd000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000e2', 'Regular', '#8A8A93', '{}'),
  ('dd000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e3', 'Regular', '#8A8A93', '{}');

-- Generous quota for every persona on every event: a quota error (45001) fires
-- in a BEFORE trigger, i.e. before RLS WITH CHECK, and would hide the policy.
insert into public.event_quotas (event_id, user_id, quota_override)
select e.id, u.id, 100
  from public.events e
 cross join (values ('11111111-1111-4111-8111-111111111111'::uuid),
                    ('22222222-2222-4222-8222-222222222222'::uuid),
                    ('33333333-3333-4333-8333-333333333333'::uuid),
                    ('44444444-4444-4444-8444-444444444444'::uuid),
                    ('55555555-5555-4555-8555-555555555555'::uuid),
                    ('66666666-6666-4666-8666-666666666666'::uuid),
                    ('77777777-7777-4777-8777-777777777777'::uuid),
                    ('88888888-8888-4888-8888-888888888888'::uuid),
                    ('99999999-9999-4999-8999-999999999999'::uuid)) as u (id)
 where e.id in ('ee000000-0000-7000-8000-000000000001',
                'ee000000-0000-7000-8000-0000000000e2',
                'ee000000-0000-7000-8000-0000000000e3')
on conflict (event_id, user_id) do update set quota_override = 100;

insert into public.guests (id, event_id, tier_id, full_name, plus_ones, added_by) values
  ('cc000000-0000-7000-8000-0000000e2001', 'ee000000-0000-7000-8000-0000000000e2',
   'dd000000-0000-7000-8000-0000000000e2', 'Locked Staff Guest', 1, '55555555-5555-4555-8555-555555555555'),
  ('cc000000-0000-7000-8000-0000000e2002', 'ee000000-0000-7000-8000-0000000000e2',
   'dd000000-0000-7000-8000-0000000000e2', 'Locked Admin Guest', 0, '11111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-7000-8000-0000000e3001', 'ee000000-0000-7000-8000-0000000000e3',
   'dd000000-0000-7000-8000-0000000000e3', 'Other Venue Guest', 2, '77777777-7777-4777-8777-777777777777'),
  ('cc000000-0000-7000-8000-0000000e3002', 'ee000000-0000-7000-8000-0000000000e3',
   'dd000000-0000-7000-8000-0000000000e3', 'Other Venue Refused', 0, '77777777-7777-4777-8777-777777777777'),
  ('cc000000-0000-7000-8000-0000000e3003', 'ee000000-0000-7000-8000-0000000000e3',
   'dd000000-0000-7000-8000-0000000000e3', 'Other Venue Waiting', 0, '11111111-1111-4111-8111-111111111111');

update public.events
   set list_locked = true, locked_by = '11111111-1111-4111-8111-111111111111', locked_at = now()
 where id = 'ee000000-0000-7000-8000-0000000000e2';

insert into public.check_ins (id, guest_id, event_id, checked_by, plus_ones_arrived) values
  ('ca000000-0000-7000-8000-0000000e3001', 'cc000000-0000-7000-8000-0000000e3001',
   'ee000000-0000-7000-8000-0000000000e3', '77777777-7777-4777-8777-777777777777', 1);

insert into public.refusals (id, guest_id, event_id, refused_by, reason) values
  ('ce000000-0000-7000-8000-0000000e3002', 'cc000000-0000-7000-8000-0000000e3002',
   'ee000000-0000-7000-8000-0000000000e3', '77777777-7777-4777-8777-777777777777', 'parity');

insert into public.guest_requests (id, event_id, full_name, status) values
  ('bb000000-0000-7000-8000-0000000e3001', 'ee000000-0000-7000-8000-0000000000e3', 'Other Venue Request', 'pending');

-- ── Probe machinery ─────────────────────────────────────────────────────────
-- A SELECT probe returns "<rows>:<md5 of the sorted ids>". A write probe runs
-- the statement, then raises a sentinel to roll its subtransaction back:
-- "ok:<row_count>" (0 = filtered out by USING) or "err:<sqlstate>".
create function pg_temp.probe(p_kind text, p_sql text)
returns text language plpgsql as $fn$
declare
  v text;
  n int;
begin
  if p_kind = 'select' then
    execute p_sql into v;
    return v;
  end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
    raise exception using errcode = 'PRB01', message = n::text;
  exception
    when sqlstate 'PRB01' then return 'ok:' || sqlerrm;
    when others then return 'err:' || sqlstate;
  end;
end;
$fn$;

create temp table personas (name text primary key, id uuid not null);
insert into personas values
  ('admin',    '11111111-1111-4111-8111-111111111111'),
  ('manager',  '22222222-2222-4222-8222-222222222222'),
  ('finance',  '33333333-3333-4333-8333-333333333333'),
  ('crew',     '44444444-4444-4444-8444-444444444444'),
  ('staff',    '55555555-5555-4555-8555-555555555555'),
  ('doorhost', '66666666-6666-4666-8666-666666666666'),
  ('otheradm', '77777777-7777-4777-8777-777777777777'),
  ('outsider', '88888888-8888-4888-8888-888888888888'),
  ('platform', '99999999-9999-4999-8999-999999999999');

-- probe = '<table>.<op>.<shape>.<row>'; op in select/update/insert.
create temp table probes (probe text primary key, tbl text not null, op text not null, sql text not null);

insert into probes
select t || '.select', t, 'select',
       format($q$select count(*) || ':' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.%I$q$, t)
  from unnest(array['guests', 'check_ins', 'refusals', 'guest_requests', 'events']) t;

-- UPDATE: one probe per existing row and column shape. auth.uid() is the persona.
insert into probes
select format('guests.update.%s.%s', s.shape, g.id), 'guests', 'update',
       format('update public.guests set %s where id = %L', s.set_clause, g.id)
  from public.guests g
 cross join (values
   ('note',    $s$note = 'parity'$s$),
   ('plus',    'plus_ones = plus_ones'),
   ('deny',    $s$status = 'denied'$s$),
   ('remove',  $s$status = 'removed', removed_at = now()$s$),
   ('readd',   'added_by = (select auth.uid())')
 ) as s (shape, set_clause);

insert into probes
select format('check_ins.update.%s.%s', s.shape, c.id), 'check_ins', 'update',
       format('update public.check_ins set %s where id = %L', s.set_clause, c.id)
  from public.check_ins c
 cross join (values
   ('same',     'plus_ones_arrived = plus_ones_arrived'),
   ('void',     'voided_at = now(), voided_by = (select auth.uid())'),
   ('syncself', 'synced_by = (select auth.uid())'),
   ('syncother', $s$synced_by = '55555555-5555-4555-8555-555555555555'$s$),
   ('mine',     'checked_by = (select auth.uid())'),
   ('away',     $s$checked_by = '66666666-6666-4666-8666-666666666666'$s$)
 ) as s (shape, set_clause);

insert into probes
select format('refusals.update.reason.%s', r.id), 'refusals', 'update',
       format($q$update public.refusals set reason = 'parity2' where id = %L$q$, r.id)
  from public.refusals r;

insert into probes
select format('guest_requests.update.%s.%s', s.shape, r.id), 'guest_requests', 'update',
       format('update public.guest_requests set %s where id = %L', s.set_clause, r.id)
  from public.guest_requests r
 cross join (values
   ('deny',    $s$status = 'denied', decided_by = (select auth.uid()), decided_at = now(), decision_reason = 'parity'$s$),
   ('denyother', $s$status = 'denied', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now(), decision_reason = 'parity'$s$),
   ('rename',  $s$full_name = 'Parity'$s$)
 ) as s (shape, set_clause);

insert into probes
select format('events.update.%s.%s', s.shape, e.id), 'events', 'update',
       format('update public.events set %s where id = %L', s.set_clause, e.id)
  from public.events e
 cross join (values
   ('name', $s$name = name || ''$s$),
   ('lock', 'list_locked = not list_locked, locked_by = (select auth.uid()), locked_at = now()')
 ) as s (shape, set_clause);

-- INSERT: per event (with its first tier) and shape.
insert into probes
select format('guests.insert.%s.%s', s.shape, e.id), 'guests', 'insert',
       format('insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source, status) '
              'values (%L, %L, %L, 0, %s, %L, %L)',
              e.id, t.id, 'Parity ' || s.shape, s.added_by, s.source, s.status)
  from public.events e
  join lateral (select gt.id from public.guest_tiers gt where gt.event_id = e.id order by gt.id limit 1) t on true
 cross join (values
   ('app',       '(select auth.uid())', 'app',       'approved'),
   ('door',      $s$'66666666-6666-4666-8666-666666666666'$s$, 'door', 'approved'),
   ('doorself',  '(select auth.uid())', 'door',      'approved'),
   ('permanent', '(select auth.uid())', 'permanent', 'approved'),
   ('pending',   '(select auth.uid())', 'app',       'pending'),
   ('foreign',   $s$'55555555-5555-4555-8555-555555555555'$s$, 'app', 'approved')
 ) as s (shape, added_by, source, status)
 where e.id in ('ee000000-0000-7000-8000-000000000001',
                'ee000000-0000-7000-8000-0000000000e2',
                'ee000000-0000-7000-8000-0000000000e3');

-- check_ins/refusals INSERT target a guest of that event with no check-in and
-- no refusal yet.
create temp table free_guests as
select distinct on (g.event_id) g.event_id, g.id
  from public.guests g
 where g.status = 'approved'
   and not exists (select 1 from public.check_ins c where c.guest_id = g.id)
   and not exists (select 1 from public.refusals r where r.guest_id = g.id)
   and g.event_id in ('ee000000-0000-7000-8000-000000000001',
                      'ee000000-0000-7000-8000-0000000000e2',
                      'ee000000-0000-7000-8000-0000000000e3')
 order by g.event_id, g.id;

insert into probes
select format('check_ins.insert.%s.%s', s.shape, f.event_id), 'check_ins', 'insert',
       format('insert into public.check_ins (guest_id, event_id, checked_by, plus_ones_arrived, synced_by) '
              'values (%L, %L, %s, 0, %s)', f.id, f.event_id, s.checked_by, s.synced_by)
  from free_guests f
 cross join (values
   ('self',      '(select auth.uid())', 'null'),
   ('forlisa',   $s$'66666666-6666-4666-8666-666666666666'$s$, '(select auth.uid())'),
   ('forstaff',  $s$'55555555-5555-4555-8555-555555555555'$s$, 'null'),
   ('syncother', '(select auth.uid())', $s$'55555555-5555-4555-8555-555555555555'$s$)
 ) as s (shape, checked_by, synced_by);

insert into probes
select format('refusals.insert.%s.%s', s.shape, f.event_id), 'refusals', 'insert',
       format('insert into public.refusals (guest_id, event_id, refused_by, reason, synced_by) '
              'values (%L, %L, %s, %L, %s)', f.id, f.event_id, s.refused_by, 'parity', s.synced_by)
  from free_guests f
 cross join (values
   ('self',      '(select auth.uid())', 'null'),
   ('forlisa',   $s$'66666666-6666-4666-8666-666666666666'$s$, '(select auth.uid())'),
   ('syncother', '(select auth.uid())', $s$'55555555-5555-4555-8555-555555555555'$s$)
 ) as s (shape, refused_by, synced_by);

insert into probes
select format('guest_requests.insert.%s', e.id), 'guest_requests', 'insert',
       format($q$insert into public.guest_requests (event_id, full_name) values (%L, 'Parity')$q$, e.id)
  from public.events e
 where e.id in ('ee000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-0000000000e3');

insert into probes
select format('events.insert.%s', v.id), 'events', 'insert',
       format($q$insert into public.events (venue_id, name, starts_at, ends_at, status) values (%L, 'Parity new', now() + interval '9 days', now() + interval '9 days 6 hours', 'open')$q$, v.id)
  from public.venues v
 where v.id in ('aa000000-0000-7000-8000-000000000001', 'aa000000-0000-7000-8000-000000000002');

create temp table outcomes (phase text, persona text, probe text, tbl text, op text, outcome text,
                            primary key (phase, persona, probe));

-- Runs every probe as every persona. Probes are loaded into arrays BEFORE the
-- role switch: `authenticated` cannot read the owner's temp tables.
create function pg_temp.run_phase(p_phase text)
returns void language plpgsql as $fn$
declare
  p record;
  v_probe text[];
  v_kind text[];
  v_sql text[];
  v_out text[];
  i int;
begin
  select array_agg(probe order by probe), array_agg(op order by probe), array_agg(sql order by probe)
    into v_probe, v_kind, v_sql
    from probes;

  for p in select * from personas order by name loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', p.id::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    perform set_config('role', 'authenticated', true);
    v_out := '{}';
    for i in 1 .. array_length(v_probe, 1) loop
      v_out := v_out || pg_temp.probe(v_kind[i], v_sql[i]);
    end loop;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    insert into outcomes (phase, persona, probe, tbl, op, outcome)
    select p_phase, p.name, v_probe[k], split_part(v_probe[k], '.', 1), v_kind[k], v_out[k]
      from generate_series(1, array_length(v_probe, 1)) k;
  end loop;
end;
$fn$;

-- ── Phase 'new': the migrated policies ──────────────────────────────────────
select pg_temp.run_phase('new');

-- ── Restore the pre-20261017 policies (text from pg_policies on main) ───────
alter policy guests_select on public.guests
  using (public.has_venue_role(venue_id, '{admin,finance,doorhost}'::public.venue_role[])
         or public.is_event_organizer(event_id)
         or (public.has_venue_role(venue_id, '{staff}'::public.venue_role[]) and added_by = (select auth.uid())));
alter policy guests_insert on public.guests
  with check (public.can_write_guests(event_id)
              and (added_by = (select auth.uid())
                   or (source = 'door'::public.guest_source and public.can_record_check_in_for(event_id, added_by)))
              and status = 'approved'::public.guest_status
              and (source = any (array['app'::public.guest_source, 'door'::public.guest_source])
                   or public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
                   or public.is_event_organizer(event_id)));
alter policy guests_update on public.guests
  using (anonymized_at is null and public.can_write_guests(event_id)
         and (added_by = (select auth.uid())
              or public.has_venue_role(public.event_venue(event_id), '{admin,doorhost}'::public.venue_role[])
              or public.is_event_organizer(event_id)))
  with check (anonymized_at is null and public.can_write_guests(event_id)
              and (added_by = (select auth.uid())
                   or public.has_venue_role(public.event_venue(event_id), '{admin,doorhost}'::public.venue_role[])
                   or public.is_event_organizer(event_id))
              and status <> all (array['pending'::public.guest_status, 'denied'::public.guest_status]));
alter policy check_ins_select on public.check_ins
  using (public.has_venue_role(venue_id, '{admin,finance,doorhost}'::public.venue_role[])
         or public.is_event_organizer(event_id));
alter policy refusals_select on public.refusals
  using (public.has_venue_role(venue_id, '{admin,finance,doorhost}'::public.venue_role[])
         or public.is_event_organizer(event_id));
alter policy guest_requests_select on public.guest_requests
  using (public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
         or public.is_event_organizer(event_id));
alter policy guest_requests_decide on public.guest_requests
  using (status = 'pending'::public.request_status and anonymized_at is null
         and (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
              or public.is_event_organizer(event_id)))
  with check (status = 'denied'::public.request_status and decided_by = (select auth.uid())
              and (public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
                   or public.is_event_organizer(event_id)));
alter policy events_select_member on public.events
  using (public.is_venue_member(venue_id) or public.is_event_organizer(id));
alter policy events_insert_admin on public.events
  with check (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]));
alter policy events_update_admin_organizer on public.events
  using (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]) or public.is_event_organizer(id))
  with check (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]) or public.is_event_organizer(id));

drop policy check_ins_update on public.check_ins;
create policy check_ins_update_door on public.check_ins
  as permissive for update to authenticated
  using (public.can_check_in(public.guest_event(guest_id)))
  with check (public.can_check_in(public.guest_event(guest_id))
              and (synced_by is null or synced_by = (select auth.uid())));
create policy check_ins_update_own_device on public.check_ins
  as permissive for update to authenticated
  using (checked_by = (select auth.uid()))
  with check (checked_by = (select auth.uid()));

-- ── Phase 'old' ─────────────────────────────────────────────────────────────
select pg_temp.run_phase('old');

-- ── The diff ────────────────────────────────────────────────────────────────
select cmp_ok((select count(*) from outcomes where phase = 'new'), '>=', 9 * 250::bigint,
  '1 the probe matrix is large (≥ 250 probes per persona)');
select is((select count(*) from outcomes where phase = 'old'),
          (select count(*) from outcomes where phase = 'new'),
  '2 both phases ran the same probes');
select is_empty($$
  (select persona, probe, outcome from outcomes where phase = 'new'
   except
   select persona, probe, outcome from outcomes where phase = 'old')
  union all
  (select persona, probe, outcome from outcomes where phase = 'old'
   except
   select persona, probe, outcome from outcomes where phase = 'new')
$$, '3 set-based policies give exactly the old allowed/denied outcome for every persona × probe');

-- ── The NEW matrix, absolute (hand-checked; PR body) ────────────────────────
-- Per persona × table × op: SELECT = visible rows; UPDATE/INSERT = probes that
-- succeeded with ≥ 1 row ("ok:1").
create temp view matrix as
select persona, tbl, op,
       case when op = 'select' then split_part(min(outcome), ':', 1)::int
            else count(*) filter (where outcome = 'ok:1')::int end as allowed
  from outcomes
 where phase = 'new'
 group by persona, tbl, op;

select results_eq(
  $$select tbl, op, allowed from matrix where persona = 'outsider' order by tbl, op$$,
  $$values ('check_ins', 'insert', 0), ('check_ins', 'select', 0), ('check_ins', 'update', 0),
           ('events', 'insert', 0), ('events', 'select', 0), ('events', 'update', 0),
           ('guest_requests', 'insert', 0), ('guest_requests', 'select', 0), ('guest_requests', 'update', 0),
           ('guests', 'insert', 0), ('guests', 'select', 0), ('guests', 'update', 0),
           ('refusals', 'insert', 0), ('refusals', 'select', 0), ('refusals', 'update', 0)$$,
  '4 outsider: nothing allowed on any table');

select is((select allowed from matrix where persona = 'platform' and tbl = 'guests' and op = 'select'),
          (select count(*)::int from public.guests),
  '5 platform admin sees every guest (#49)');
select is((select allowed from matrix where persona = 'platform' and tbl = 'check_ins' and op = 'select'),
          (select count(*)::int from public.check_ins),
  '6 platform admin sees every check-in');
select is((select allowed from matrix where persona = 'platform' and tbl = 'events' and op = 'select'),
          (select count(*)::int from public.events),
  '7 platform admin sees every event');
select is((select allowed from matrix where persona = 'admin' and tbl = 'guests' and op = 'select'),
          (select count(*)::int from public.guests),
  '8 admin of both companies sees every guest');
select is((select allowed from matrix where persona = 'otheradm' and tbl = 'guests' and op = 'select'),
          (select count(*)::int from public.guests where event_id = 'ee000000-0000-7000-8000-0000000000e3'),
  '9 admin of company 2 sees only company 2 guests');
select is((select allowed from matrix where persona = 'staff' and tbl = 'guests' and op = 'select'),
          (select count(*)::int from public.guests where added_by = '55555555-5555-4555-8555-555555555555'),
  '10 staff sees only the guests they added');
select is((select allowed from matrix where persona = 'crew' and tbl = 'guests' and op = 'select'),
          (select count(*)::int from public.guests
            where event_id in ('ee000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-0000000000e3')),
  '11 crew sees the guests of the events they organize, across companies, not the locked E2');
select is((select allowed from matrix where persona = 'finance' and tbl = 'guests' and op = 'select'),
          (select count(*)::int from public.guests g join public.events e on e.id = g.event_id
            where e.venue_id = 'aa000000-0000-7000-8000-000000000001'),
  '12 finance sees every company-1 guest');
select is((select allowed from matrix where persona = 'manager' and tbl = 'guests' and op = 'select'), 0,
  '13 user_manager sees no guests');
select is((select allowed from matrix where persona = 'doorhost' and tbl = 'check_ins' and op = 'select'),
          (select count(*)::int from public.check_ins where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  '14 doorhost sees company-1 check-ins');
select is((select allowed from matrix where persona = 'staff' and tbl = 'check_ins' and op = 'select'), 0,
  '15 staff sees no check-ins');
select is((select allowed from matrix where persona = 'finance' and tbl = 'guest_requests' and op = 'select'),
          (select count(*)::int from public.guest_requests where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  '16 finance sees company-1 guest requests');
select is((select allowed from matrix where persona = 'doorhost' and tbl = 'guest_requests' and op = 'select'), 0,
  '17 doorhost sees no guest requests');
select is((select allowed from matrix where persona = 'manager' and tbl = 'events' and op = 'select'),
          (select count(*)::int from public.events where venue_id = 'aa000000-0000-7000-8000-000000000001'),
  '18 any member (user_manager) sees the company''s events');
select is((select allowed from matrix where persona = 'crew' and tbl = 'events' and op = 'select'), 2,
  '19 crew sees exactly the two events they organize');

-- Writes, per shape (outcome of a named probe, phase new).
create function pg_temp.o(p_persona text, p_probe text)
returns text language sql as $fn$
  select outcome from outcomes where phase = 'new' and persona = p_persona and probe = p_probe;
$fn$;

select is(pg_temp.o('staff', 'guests.update.note.cc000000-0000-7000-8000-0000000e2001'), 'ok:0',
  '20 staff cannot edit their own guest on a locked list (#23)');
select is(pg_temp.o('doorhost', 'guests.update.note.cc000000-0000-7000-8000-0000000e2002'), 'ok:1',
  '21 doorhost keeps write access on a locked list');
select is(pg_temp.o('otheradm', 'guests.update.note.cc000000-0000-7000-8000-0000000e2002'), 'ok:0',
  '22 admin of company 2 cannot edit a company-1 guest');
select is(pg_temp.o('platform', 'guests.update.note.cc000000-0000-7000-8000-0000000e3001'), 'ok:1',
  '23 platform admin can edit any guest');
select is(pg_temp.o('admin', 'guests.update.deny.cc000000-0000-7000-8000-0000000e3001'), 'err:42501',
  '24 nobody may set a guest to denied through UPDATE (WITH CHECK)');
select is(pg_temp.o('crew', 'guests.insert.permanent.ee000000-0000-7000-8000-0000000000e3'), 'ok:1',
  '25 crew may add a non-app source on an event they organize');
select is(pg_temp.o('staff', 'guests.insert.permanent.ee000000-0000-7000-8000-000000000001'), 'err:42501',
  '26 staff may not add a non-app/door source');
select is(pg_temp.o('platform', 'guests.insert.permanent.ee000000-0000-7000-8000-000000000001'), 'ok:1',
  '27 platform admin may add a non-app source anywhere');
select is(pg_temp.o('platform', 'guest_requests.update.deny.bb000000-0000-7000-8000-000000000003'), 'ok:0',
  '28 platform admin still cannot re-decide a non-pending request (P stays inside the AND)');
-- The decline-note guard is an AFTER trigger: a probe that passes USING and
-- WITH CHECK ends in its 23514 ("add a note"), a WITH CHECK failure is 42501,
-- a USING miss is ok:0. decision_message has no UPDATE grant (decide RPC only).
select is(pg_temp.o('platform', 'guest_requests.update.deny.bb000000-0000-7000-8000-0000000e3001'), 'err:23514',
  '29 platform admin passes USING and WITH CHECK on a pending request (stops at the note guard)');
select is(pg_temp.o('admin', 'guest_requests.update.denyother.bb000000-0000-7000-8000-000000000001'), 'err:23514',
  '30 decided_by must be the caller — admin is the caller here, so the policy passes');
select is(pg_temp.o('crew', 'guest_requests.update.denyother.bb000000-0000-7000-8000-000000000001'), 'err:42501',
  '31 crew cannot stamp someone else as decided_by');
select is(pg_temp.o('staff', 'events.insert.aa000000-0000-7000-8000-000000000001'), 'err:42501',
  '32 staff cannot create an event');
select is(pg_temp.o('otheradm', 'events.insert.aa000000-0000-7000-8000-000000000002'), 'ok:1',
  '33 admin creates an event in their own company');

-- check_ins: the merged UPDATE policy (20261017120100).
select is(pg_temp.o('admin', 'check_ins.update.same.ca000000-0000-7000-8000-0000000e3001'), 'ok:1',
  '34 door path: an admin of company 2 (not the checker) can update its check-in');
select is(pg_temp.o('doorhost', 'check_ins.update.same.ca000000-0000-7000-8000-0000000e3001'), 'ok:0',
  '35 doorhost of company 1 cannot touch a company-2 check-in');
select is(pg_temp.o('crew', 'check_ins.update.same.ca000000-0000-7000-8000-0000000e3001'), 'ok:1',
  '36 door path via crew: the organizer of E3 can update its check-in without any membership');
select is(pg_temp.o('platform', 'check_ins.update.void.ca000000-0000-7000-8000-0000000e3001'), 'ok:1',
  '37 platform admin passes the door policy and the RESTRICTIVE uncheck policy (allow_uncheck off, admin-equivalent)');

select ok((select allowed from matrix where persona = 'finance' and tbl = 'check_ins' and op = 'select') > 0
          and (select allowed from matrix where persona = 'finance' and tbl = 'check_ins' and op = 'update') = 0,
  '38 finance reads company-1 check-ins but updates none (no door right, not the checker)');

select * from finish();
rollback;
