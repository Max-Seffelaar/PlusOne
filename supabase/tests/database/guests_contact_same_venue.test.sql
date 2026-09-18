-- pgTAP — K5 (ADE UX round, z8uq9m0g0j): guests.contact_id must belong to the
-- guest's own venue and must not be anonymized
-- (20260918110000_guests_contact_same_venue.sql).
--
-- Proves, in this order:
--   A. the permanent-sync path still places its contacts with the guard active;
--   B. add_contact_to_event still links a same-venue contact;
--   C. a direct same-venue link is allowed; a contact from ANOTHER venue is
--      refused on INSERT, on INSERT WITH A FORGED venue_id (the trigger-ordering
--      bypass), and on UPDATE — and the failed UPDATE leaves the row untouched;
--   D. an anonymized contact and a non-existent contact id are refused the same
--      generic way (no existence oracle, and the trigger beats the FK to it);
--   E. expand–contract: a guest already linked to a contact that the AVG sweep
--      anonymizes LATER stays writable (a check-in must never fail because the
--      person was forgotten);
--   F. guests_autolink_contact still links on INSERT and on the email-UPDATE
--      promote path, and a name-only guest still gets no contact;
--   G. promote_guest_to_contact still links;
--   H. a STAFF insert carrying an explicit contact_id succeeds even though staff
--      cannot SELECT contacts under RLS (the guard is SECURITY DEFINER — an
--      INVOKER guard would have rejected the feature it protects), while the
--      same staff member is still refused a contact from another venue;
--   I. the event_id-move path (fresh-session /security-review finding, fixed
--      before merge): re-pointing a guest at ANOTHER venue's event while
--      leaving contact_id untouched is refused, and the same move within the
--      guest's OWN venue is unaffected.
--
-- Seed: venue1 = aa..01 Club Vesper, venue2 = aa..02 De Marktzaal, event ee..01
-- in venue1 (open, unlocked), tier dd..01 'Regular', contacts c0..01 Sanne +
-- c0..02 Anouk (both is_permanent at venue1), c0..04 Marit (venue2),
-- admin 1111, staff 5555 (event quota 12, 10 consumed). Everything rolls back.

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

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Name-only contacts: no e-mail/phone, so they never
-- collide on the contacts dedup indexes and never get picked up by autolink.
-- All NON-permanent, so section A's sync count stays exactly the seed's two.
-- ---------------------------------------------------------------------------

insert into public.contacts (id, venue_id, full_name, source, anonymized_at) values
  ('c0000000-0000-7000-8000-0000000000f1', 'aa000000-0000-7000-8000-000000000001',
   'K5 Reuse Target', 'manual', null),
  ('c0000000-0000-7000-8000-0000000000f2', 'aa000000-0000-7000-8000-000000000001',
   'K5 Direct Link', 'manual', null),
  ('c0000000-0000-7000-8000-0000000000f3', 'aa000000-0000-7000-8000-000000000001',
   'Contact #99', 'manual', now()),
  ('c0000000-0000-7000-8000-0000000000f4', 'aa000000-0000-7000-8000-000000000001',
   'K5 Staff Link', 'manual', null),
  ('c0000000-0000-7000-8000-0000000000f5', 'aa000000-0000-7000-8000-000000000001',
   'K5 Event Move Target', 'manual', null);

-- A second venue1 event + a venue2 event, for section I's event_id-move cases
-- (the composite FK `(tier_id, event_id) references guest_tiers(id, event_id)`
-- means moving a guest's event also means moving its tier in the same UPDATE).
insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-000000000005', 'aa000000-0000-7000-8000-000000000001',
   'K5 Second Venue1 Event', now() + interval '10 days', now() + interval '10 days' + interval '2 hours',
   'open', 'k5-second-venue1-event', false),
  ('ee000000-0000-7000-8000-000000000006', 'aa000000-0000-7000-8000-000000000002',
   'K5 Venue2 Event', now() + interval '10 days', now() + interval '10 days' + interval '2 hours',
   'open', 'k5-venue2-event', false);

insert into public.guest_tiers (id, event_id, name, color) values
  ('dd000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-000000000005', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-000000000006', 'ee000000-0000-7000-8000-000000000006', 'Regular', '#8A8A93');

select plan(22);

-- ---------------------------------------------------------------------------
-- A. Permanent sync — the RPC places the venue's permanent contacts unchanged.
--    Runs first: after this Sanne/Anouk are live guests on ee..01 and the
--    (event, contact) partial-unique index owns them.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin (quota-exempt)

select is(
  (select public.sync_permanent_guests_into_event('ee000000-0000-7000-8000-000000000001')),
  2, 'A1 permanent sync still adds both permanent contacts with the guard active');

select is(
  (select count(*)::int from public.guests
    where event_id = 'ee000000-0000-7000-8000-000000000001'
      and contact_id = 'c0000000-0000-7000-8000-000000000001'
      and status <> 'removed'),
  1, 'A2 the synced guest keeps its same-venue contact link');

-- ---------------------------------------------------------------------------
-- B. add_contact_to_event — the address-book "+" still links.
-- ---------------------------------------------------------------------------

select public.add_contact_to_event(
  'c0000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-000000000001');

select is(
  (select count(*)::int from public.guests
    where event_id = 'ee000000-0000-7000-8000-000000000001'
      and contact_id = 'c0000000-0000-7000-8000-0000000000f1'
      and status <> 'removed'),
  1, 'B1 add_contact_to_event still links a same-venue contact');

-- ---------------------------------------------------------------------------
-- C. Direct writes: allowed same-venue, refused cross-venue (insert / forged
--    venue_id / update).
-- ---------------------------------------------------------------------------

insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000f2',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'K5 Direct Link', 'c0000000-0000-7000-8000-0000000000f2',
        '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select is(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000f2'),
  'c0000000-0000-7000-8000-0000000000f2'::uuid,
  'C1 a contact of the guest''s own venue links fine');

select throws_ok(
  $$ insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source, status)
     values ('cc000000-0000-7000-8000-0000000000f3',
             'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
             'K5 Cross Venue', 'c0000000-0000-7000-8000-000000000004',
             '11111111-1111-4111-8111-111111111111', 'app', 'approved') $$,
  '23514', null,
  'C2 a contact from ANOTHER venue is refused on INSERT');

-- The bypass this guard is shaped against: forge venue_id to match the foreign
-- contact so a new.venue_id-based check would pass, then let set_event_scope
-- rewrite it back. Resolving the venue from the event closes it.
select throws_ok(
  $$ insert into public.guests (id, event_id, tier_id, full_name, contact_id, venue_id, added_by, source, status)
     values ('cc000000-0000-7000-8000-0000000000f4',
             'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
             'K5 Forged Scope', 'c0000000-0000-7000-8000-000000000004',
             'aa000000-0000-7000-8000-000000000002',
             '11111111-1111-4111-8111-111111111111', 'app', 'approved') $$,
  '23514', null,
  'C3 forging venue_id to match the foreign contact does not help (venue comes from the event)');

select throws_ok(
  $$ update public.guests set contact_id = 'c0000000-0000-7000-8000-000000000004'
      where id = 'cc000000-0000-7000-8000-0000000000f2' $$,
  '23514', null,
  'C4 re-pointing an existing guest at another venue''s contact is refused on UPDATE');

select is(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000f2'),
  'c0000000-0000-7000-8000-0000000000f2'::uuid,
  'C5 the refused UPDATE left the original link in place');

-- ---------------------------------------------------------------------------
-- D. Anonymized and non-existent contacts fail identically (no existence
--    oracle), and the trigger fires before the FK ever reports anything.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source, status)
     values ('cc000000-0000-7000-8000-0000000000f5',
             'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
             'K5 Anonymized Link', 'c0000000-0000-7000-8000-0000000000f3',
             '11111111-1111-4111-8111-111111111111', 'app', 'approved') $$,
  '23514', null,
  'D1 an anonymized contact cannot be linked (AVG #29)');

select throws_ok(
  $$ insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source, status)
     values ('cc000000-0000-7000-8000-0000000000f6',
             'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
             'K5 Ghost Link', 'c0000000-0000-7000-8000-0000000000ff',
             '11111111-1111-4111-8111-111111111111', 'app', 'approved') $$,
  '23514', null,
  'D2 an unknown contact id fails the same generic way (23514, not the FK)');

-- ---------------------------------------------------------------------------
-- E. Expand–contract: the AVG sweep anonymizes contacts and KEEPS the guest
--    links (run_privacy_retention step 6 / forget_contact step 5). Those guests
--    must stay writable — only a CHANGE of contact_id is validated.
-- ---------------------------------------------------------------------------

reset role;
update public.contacts set anonymized_at = now()
 where id = 'c0000000-0000-7000-8000-0000000000f2';

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin

update public.guests set plus_ones = 2
 where id = 'cc000000-0000-7000-8000-0000000000f2';

select is(
  (select plus_ones from public.guests where id = 'cc000000-0000-7000-8000-0000000000f2'),
  2, 'E1 a guest whose contact was anonymized later is still writable');

select is(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000f2'),
  'c0000000-0000-7000-8000-0000000000f2'::uuid,
  'E2 and keeps its historical link');

-- ---------------------------------------------------------------------------
-- F. guests_autolink_contact regressions (insert, name-only, email-promote).
-- ---------------------------------------------------------------------------

insert into public.guests (id, event_id, tier_id, full_name, email, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000f7',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'K5 Autolink', 'k5.autolink@test.example',
        '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select ok(
  (select contact_id is not null from public.guests
    where id = 'cc000000-0000-7000-8000-0000000000f7'),
  'F1 autolink still creates + links a contact on INSERT');

select is(
  (select c.venue_id from public.guests g
     join public.contacts c on c.id = g.contact_id
    where g.id = 'cc000000-0000-7000-8000-0000000000f7'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'F2 that auto-created contact lives in the guest''s own venue');

insert into public.guests (id, event_id, tier_id, full_name, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000f8',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'K5 Name Only', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select is(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000f8'),
  null, 'F3 a name-only guest still gets no contact (null contact_id is a no-op)');

update public.guests set email = 'k5.promote@test.example'
 where id = 'cc000000-0000-7000-8000-0000000000f8';

select ok(
  (select contact_id is not null from public.guests
    where id = 'cc000000-0000-7000-8000-0000000000f8'),
  -- The statement names only `email`, so this also proves the guard sees what
  -- autolink assigned — an `update of contact_id` trigger would not have fired.
  'F4 adding an e-mail still promotes + links on UPDATE');

-- ---------------------------------------------------------------------------
-- G. promote_guest_to_contact still links.
-- ---------------------------------------------------------------------------

insert into public.guests (id, event_id, tier_id, full_name, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000f9',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'K5 Promote Me', '11111111-1111-4111-8111-111111111111', 'app', 'approved');

select public.promote_guest_to_contact('cc000000-0000-7000-8000-0000000000f9');

select is(
  (select c.venue_id from public.guests g
     join public.contacts c on c.id = g.contact_id
    where g.id = 'cc000000-0000-7000-8000-0000000000f9'),
  'aa000000-0000-7000-8000-000000000001'::uuid,
  'G1 promote_guest_to_contact still links, inside the venue');

-- ---------------------------------------------------------------------------
-- H. Staff — the K4 feature (quick-add carrying a contact_id) must work for a
--    role that cannot read contacts at all, and must still be tenant-bounded.
-- ---------------------------------------------------------------------------

select pg_temp.login('55555555-5555-4555-8555-555555555555');  -- staff Tom (10/12 used)

insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000fa',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'K5 Staff Link', 'c0000000-0000-7000-8000-0000000000f4',
        '55555555-5555-4555-8555-555555555555', 'app', 'approved');

select throws_ok(
  $$ insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source, status)
     values ('cc000000-0000-7000-8000-0000000000fb',
             'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
             'K5 Staff Cross Venue', 'c0000000-0000-7000-8000-000000000004',
             '55555555-5555-4555-8555-555555555555', 'app', 'approved') $$,
  '23514', null,
  'H1 staff still cannot reach another venue''s contact');

-- Read back as owner: staff has no contacts SELECT and only sees their own
-- guests, so the assertion must not run under their RLS.
reset role;
select is(
  (select contact_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000fa'),
  'c0000000-0000-7000-8000-0000000000f4'::uuid,
  'H2 a staff add carrying a same-venue contact_id succeeds (guard is DEFINER)');

-- ---------------------------------------------------------------------------
-- I. The event_id-move path (fresh-session /security-review finding, fixed
--    before merge): a guest's contact_id stays valid for its venue only as
--    long as the guest itself doesn't move venues out from under it.
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');  -- admin

-- A dedicated contact (c0..f5), not one of the earlier fixtures: every venue1
-- contact fixture above is already linked to ee..01 by an earlier section, and
-- (event_id, contact_id) is partial-unique (20260713150000) — reusing one here
-- would fail on the INSERT itself, before this section's own assertions run.
insert into public.guests (id, event_id, tier_id, full_name, contact_id, added_by, source, status)
values ('cc000000-0000-7000-8000-0000000000fc',
        'ee000000-0000-7000-8000-000000000001', 'dd000000-0000-7000-8000-000000000001',
        'K5 Event Move Target', 'c0000000-0000-7000-8000-0000000000f5',
        '11111111-1111-4111-8111-111111111111', 'app', 'approved');

-- The attack this closes: move the guest (and its tier, to satisfy the
-- composite FK) to an event in ANOTHER venue while contact_id — still a
-- venue1 contact — is left untouched. Before the fix, a contact_id-only
-- `when` clause never re-ran the guard for this statement.
select throws_ok(
  $$ update public.guests
       set event_id = 'ee000000-0000-7000-8000-000000000006',
           tier_id = 'dd000000-0000-7000-8000-000000000006'
      where id = 'cc000000-0000-7000-8000-0000000000fc' $$,
  '23514', null,
  'I1 moving a guest to ANOTHER venue''s event is refused while its contact stays venue1''s');

select is(
  (select event_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000fc'),
  'ee000000-0000-7000-8000-000000000001'::uuid,
  'I2 the refused move left the guest on its original event');

-- Moving the SAME guest to a different event WITHIN its own venue (contact_id
-- unchanged) must still work — the fix must not overreach into blocking a
-- legitimate same-venue reassignment.
update public.guests
   set event_id = 'ee000000-0000-7000-8000-000000000005',
       tier_id = 'dd000000-0000-7000-8000-000000000005'
 where id = 'cc000000-0000-7000-8000-0000000000fc';

select is(
  (select event_id from public.guests where id = 'cc000000-0000-7000-8000-0000000000fc'),
  'ee000000-0000-7000-8000-000000000005'::uuid,
  'I3 a same-venue event move is unaffected by the widened guard');

select * from finish();

rollback;
