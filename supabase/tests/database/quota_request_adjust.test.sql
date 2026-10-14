-- pgTAP — Quota approval with adjustments (z8uq9m5kux, migration
-- 20261018130000; run: pnpm db:test). An admin adjusts a quota request before
-- approving it: another tier of the same event, fewer plus-ones, fewer extra
-- spots. Only down, checked in the database, atomic, audited.
--
-- Proves:
--   A. tier + plus-ones + extra adjusted at once: the guest gets the chosen
--      tier and the lower +N, the override rises by the trimmed extra, the
--      quota math (1 + N) holds, approved_* record the decision, one audited
--      'approve' carries them in its diff.
--   B. a tier of another event of the same company, or of another company:
--      refused (22023), nothing written.
--   C. plus-ones above 50 or negative, extra 0 or above 100: refused (22023);
--      a tier/+N on a request without a guest: refused (22023).
--   D. trim only (no guest): the override rises by the trimmed number;
--      approved_extra set, guest columns null.
--   E. a trimmed quota the guest no longer fits in rolls back (45001); the
--      same request with fewer plus-ones fits; a staff requester on a locked
--      list rolls back an adjusted approval too (45007).
--   F. the 1-argument call is unchanged: payload tier and +N, the full extra.
--   G. role matrix: only the admin decides; staff, doorhost, user_manager,
--      finance, crew and an outsider get 42501, even with bad adjustments
--      (an outsider learns nothing about the request).
--   H. clients cannot write approved_*: not on insert, not on update; the
--      CHECKs refuse approved_* on a non-approved row and +N out of range.
--   R. raising (Max 2026-10-14, "could be both"): more spots and more
--      plus-ones than asked are granted, and the quota math holds.
--   T. the 2026-10-14 bug: a request that names a guest asks for what the
--      guest needs from database truth (a stale "+1" for a +4 guest with 0
--      left is stored as 5); a request without a guest is left alone; "as
--      asked" at approval fits the guest even after the requester's room
--      shrank since filing; the decision mail carries the guest.
--   I. one approve_quota_request overload; SECURITY DEFINER, search_path '',
--      ACL (authenticated + service_role, not anon, not PUBLIC); the row is
--      read FOR UPDATE; the decision mail reads approved_extra.
--
-- Seed (supabase/seed.sql): venue A aa..01 (Max 11.. admin, Noor 22..
-- user_manager, Femke 33.. finance, Tom 55.. staff, Lisa 66.. doorhost+staff),
-- organizer Yusuf 44.. (crew on ee..01), venue B aa..02. Tom has a default
-- quota of 10 at venue A. Everything rolls back.

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

create function pg_temp.owner()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- ── Fixtures (as the owner) ─────────────────────────────────────────────────
-- E: open event in venue A. E2: another venue A event. Q: venue A event where
-- Tom's quota is 0. L: locked venue A event. X: venue B event.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '0b000000-0000-4000-8000-0000000000ab', 'authenticated',
  'authenticated', 'outsider-adjust@q.test', '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', '', '');
insert into public.user_profiles (id, full_name, email)
values ('0b000000-0000-4000-8000-0000000000ab', 'Outsider', 'outsider-adjust@q.test')
on conflict (id) do nothing;

insert into public.events (id, venue_id, name, starts_at, ends_at, status, list_locked, locked_by, locked_at) values
  ('ee000000-0000-7000-8000-0000000b0001', 'aa000000-0000-7000-8000-000000000001', 'Adjust Night',
   now() + interval '3 days', now() + interval '3 days 6 hours', 'open', false, null, null),
  ('ee000000-0000-7000-8000-0000000b0002', 'aa000000-0000-7000-8000-000000000001', 'Other Night',
   now() + interval '4 days', now() + interval '4 days 6 hours', 'open', false, null, null),
  ('ee000000-0000-7000-8000-0000000b0003', 'aa000000-0000-7000-8000-000000000001', 'Tight Night',
   now() + interval '5 days', now() + interval '5 days 6 hours', 'open', false, null, null),
  ('ee000000-0000-7000-8000-0000000b0004', 'aa000000-0000-7000-8000-000000000001', 'Locked Night',
   now() + interval '6 days', now() + interval '6 days 6 hours', 'open', true,
   '11111111-1111-4111-8111-111111111111', now()),
  ('ee000000-0000-7000-8000-0000000b0005', 'aa000000-0000-7000-8000-000000000002', 'Other Company Night',
   now() + interval '7 days', now() + interval '7 days 6 hours', 'open', false, null, null);

insert into public.guest_tiers (id, event_id, name, color) values
  ('dd000000-0000-7000-8000-0000000b1001', 'ee000000-0000-7000-8000-0000000b0001', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-0000000b1002', 'ee000000-0000-7000-8000-0000000b0001', 'Backstage', '#B5A6FF'),
  ('dd000000-0000-7000-8000-0000000b1003', 'ee000000-0000-7000-8000-0000000b0002', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-0000000b1004', 'ee000000-0000-7000-8000-0000000b0003', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-0000000b1005', 'ee000000-0000-7000-8000-0000000b0004', 'Regular', '#8A8A93'),
  ('dd000000-0000-7000-8000-0000000b1006', 'ee000000-0000-7000-8000-0000000b0005', 'Regular', '#8A8A93');

-- Tom has no spots of his own on Tight Night.
insert into public.event_quotas (event_id, user_id, quota_override)
values ('ee000000-0000-7000-8000-0000000b0003', '55555555-5555-4555-8555-555555555555', 0);

insert into public.quota_requests (id, event_id, user_id, requested_extra, motivation, guest_payload) values
  -- a1: tier + plus-ones + extra adjusted together
  ('9f000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-0000000b0001',
   '55555555-5555-4555-8555-555555555555', 4, 'Birthday',
   '{"name": "Ada", "plus_ones": 3, "tier_id": "dd000000-0000-7000-8000-0000000b1001"}'),
  -- a2: bad tier / plus-ones / extra attempts, stays pending
  ('9f000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-0000000b0001',
   '55555555-5555-4555-8555-555555555555', 3, 'Friends',
   '{"name": "Bo", "plus_ones": 2, "tier_id": "dd000000-0000-7000-8000-0000000b1001"}'),
  -- a3: no guest, trimmed
  ('9f000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-0000000b0001',
   '55555555-5555-4555-8555-555555555555', 5, 'Crew', null),
  -- a4: no guest, a tier/+N is refused
  ('9f000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-0000000b0001',
   '55555555-5555-4555-8555-555555555555', 2, 'Crew', null),
  -- a5: Tight Night, guest +2 (3 heads), Tom's own quota 0
  ('9f000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-0000000b0003',
   '55555555-5555-4555-8555-555555555555', 3, 'Group',
   '{"name": "Cas", "plus_ones": 2, "tier_id": "dd000000-0000-7000-8000-0000000b1004"}'),
  -- a6: staff requester on the locked list
  ('9f000000-0000-7000-8000-000000000006', 'ee000000-0000-7000-8000-0000000b0004',
   '55555555-5555-4555-8555-555555555555', 2, 'Friend',
   '{"name": "Dee", "plus_ones": 1, "tier_id": "dd000000-0000-7000-8000-0000000b1005"}'),
  -- a7: the 1-argument call
  ('9f000000-0000-7000-8000-000000000007', 'ee000000-0000-7000-8000-0000000b0001',
   '55555555-5555-4555-8555-555555555555', 2, 'Friend',
   '{"name": "Eli", "plus_ones": 1, "tier_id": "dd000000-0000-7000-8000-0000000b1002"}'),
  -- a8: raised (guest +1 asked, +3 granted, 2 spots asked, 4 granted)
  ('9f000000-0000-7000-8000-000000000008', 'ee000000-0000-7000-8000-0000000b0001',
   '55555555-5555-4555-8555-555555555555', 2, 'Friends',
   '{"name": "Fay", "plus_ones": 1, "tier_id": "dd000000-0000-7000-8000-0000000b1001"}'),
  -- a9: raised, no guest (1 asked, 3 granted)
  ('9f000000-0000-7000-8000-000000000009', 'ee000000-0000-7000-8000-0000000b0001',
   '55555555-5555-4555-8555-555555555555', 1, 'Crew', null);

select plan(69);

-- ---------------------------------------------------------------------------
-- A. Tier, plus-ones and extra adjusted at once
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000001',
       p_extra => 2, p_tier_id => 'dd000000-0000-7000-8000-0000000b1002', p_plus_ones => 1) $$,
  'A1 the admin approves with another tier, fewer plus-ones and fewer spots');
select pg_temp.owner();

select is(
  (select row(g.full_name, g.tier_id, g.plus_ones, g.added_by, g.status::text)::text
     from public.guests g where g.event_id = 'ee000000-0000-7000-8000-0000000b0001' and g.full_name = 'Ada'),
  row('Ada', 'dd000000-0000-7000-8000-0000000b1002'::uuid, 1,
      '55555555-5555-4555-8555-555555555555'::uuid, 'approved')::text,
  'A2 the guest is on the chosen tier with the lower +N, on the requester''s name');
select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000b0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  12, 'A3 the override is the old quota (10) + the trimmed 2, not + 4');
select is(
  public.user_event_consumption('ee000000-0000-7000-8000-0000000b0001', '55555555-5555-4555-8555-555555555555'),
  2, 'A4 the guest consumes 1 + the adjusted N');
select is(
  (select row(q.status::text, q.approved_extra, q.approved_tier_id, q.approved_plus_ones, q.requested_extra)::text
     from public.quota_requests q where q.id = '9f000000-0000-7000-8000-000000000001'),
  row('approved', 2, 'dd000000-0000-7000-8000-0000000b1002'::uuid, 1, 4)::text,
  'A5 approved_* record what was granted; requested_extra keeps what was asked');
select is(
  (select q.guest_payload ->> 'plus_ones' from public.quota_requests q where q.id = '9f000000-0000-7000-8000-000000000001'),
  '3', 'A6 the payload keeps what was asked');
select is(
  (select count(*)::int from public.audit_log a
    where a.entity_type = 'quota_requests' and a.action = 'approve'
      and a.entity_id = '9f000000-0000-7000-8000-000000000001'
      and a.actor_id = '11111111-1111-4111-8111-111111111111'
      and (a.diff -> 'after' ->> 'approved_extra')::int = 2
      and (a.diff -> 'after' ->> 'approved_plus_ones')::int = 1
      and a.diff -> 'after' ->> 'approved_tier_id' = 'dd000000-0000-7000-8000-0000000b1002'),
  1, 'A7 one audited approve row carries the adjustments');
select is(
  (select count(*)::int from public.audit_log a
    where a.entity_type = 'guests' and a.action = 'create'
      and a.entity_id = (select id from public.guests where full_name = 'Ada'
                           and event_id = 'ee000000-0000-7000-8000-0000000b0001')),
  1, 'A8 the guest insert is audited');

-- ---------------------------------------------------------------------------
-- B. A tier from elsewhere
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002',
       p_tier_id => 'dd000000-0000-7000-8000-0000000b1003') $$,
  '22023', 'Pick a tier of this event.', 'B1 a tier of another event of the same company: refused');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002',
       p_tier_id => 'dd000000-0000-7000-8000-0000000b1006') $$,
  '22023', 'Pick a tier of this event.', 'B2 a tier of another company: refused');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002',
       p_tier_id => '00000000-0000-7000-8000-000000000000') $$,
  '22023', 'Pick a tier of this event.', 'B3 a tier that does not exist: refused');
select pg_temp.owner();
select is(
  (select row(status::text, guest_id, approved_extra)::text from public.quota_requests
    where id = '9f000000-0000-7000-8000-000000000002'),
  row('pending', null::uuid, null::int)::text, 'B4 ...the request is still pending, untouched');
select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000b0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  12, 'B5 ...and the override did not move');
select is(
  (select count(*)::int from public.guests where full_name = 'Bo'),
  0, 'B6 ...and no guest exists');

-- ---------------------------------------------------------------------------
-- C. Sane bounds (up or down, Max 2026-10-14), and only what exists
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 51) $$,
  '22023', 'Plus-ones go from 0 to 50.', 'C1 more than 50 plus-ones: refused');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => -1) $$,
  '22023', 'Plus-ones go from 0 to 50.', 'C2 negative plus-ones: refused');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_extra => 101) $$,
  '22023', 'Approve between 1 and 100 spots.', 'C3 more than 100 spots: refused');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_extra => 0) $$,
  '22023', 'Approve between 1 and 100 spots.', 'C4 zero spots: refused');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000004',
       p_tier_id => 'dd000000-0000-7000-8000-0000000b1001') $$,
  '22023', 'This request names no guest to adjust.', 'C5 a tier on a request without a guest: refused');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000004', p_plus_ones => 0) $$,
  '22023', 'This request names no guest to adjust.', 'C6 plus-ones on a request without a guest: refused');
select pg_temp.owner();
select is(
  (select count(*)::int from public.quota_requests
    where id in ('9f000000-0000-7000-8000-000000000002', '9f000000-0000-7000-8000-000000000004')
      and status = 'pending'),
  2, 'C7 ...both requests are still pending');

-- ---------------------------------------------------------------------------
-- D. Trim only
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000003', p_extra => 2) $$,
  'D1 the admin approves 2 of the 5 spots asked');
select pg_temp.owner();
select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000b0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  14, 'D2 the override went up by 2 (12 → 14)');
select is(
  (select row(status::text, approved_extra, approved_tier_id, approved_plus_ones, guest_id)::text
     from public.quota_requests where id = '9f000000-0000-7000-8000-000000000003'),
  row('approved', 2, null::uuid, null::int, null::uuid)::text,
  'D3 approved_extra = 2; no guest columns');

-- ---------------------------------------------------------------------------
-- E. Quota math and the list lock still decide
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000005', p_extra => 1) $$,
  '45001', null, 'E1 1 spot for a guest who brings 2: the guest does not fit (45001)');
select pg_temp.owner();
select is(
  (select row(q.status::text, (select quota_override from public.event_quotas
                                 where event_id = 'ee000000-0000-7000-8000-0000000b0003'
                                   and user_id = '55555555-5555-4555-8555-555555555555'))::text
     from public.quota_requests q where q.id = '9f000000-0000-7000-8000-000000000005'),
  row('pending', 0)::text, 'E2 ...rolled back: still pending, override still 0');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000005', p_extra => 1, p_plus_ones => 0) $$,
  'E3 1 spot and no plus-ones: the guest fits');
select pg_temp.owner();
select is(
  (select row(g.plus_ones, (select quota_override from public.event_quotas
                              where event_id = 'ee000000-0000-7000-8000-0000000b0003'
                                and user_id = '55555555-5555-4555-8555-555555555555'))::text
     from public.guests g where g.full_name = 'Cas'),
  row(0, 1)::text, 'E4 ...guest +0, override 1');
select is(
  public.user_event_consumption('ee000000-0000-7000-8000-0000000b0003', '55555555-5555-4555-8555-555555555555'),
  1, 'E5 ...and the guest uses exactly the one granted spot');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000006', p_extra => 1, p_plus_ones => 0) $$,
  '45007', null, 'E6 an adjusted approval for a staff requester on a locked list: refused (45007)');
select pg_temp.owner();
select is(
  (select count(*)::int from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000b0004' and user_id = '55555555-5555-4555-8555-555555555555'),
  0, 'E7 ...no override was written');
select is(
  (select row(status::text, approved_extra)::text from public.quota_requests
    where id = '9f000000-0000-7000-8000-000000000006'),
  row('pending', null::int)::text, 'E8 ...and the request is still pending');

-- ---------------------------------------------------------------------------
-- F. The 1-argument call is unchanged
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000007') $$,
  'F1 the 1-argument call still approves');
select pg_temp.owner();
select is(
  (select row(g.tier_id, g.plus_ones)::text from public.guests g where g.full_name = 'Eli'),
  row('dd000000-0000-7000-8000-0000000b1002'::uuid, 1)::text,
  'F2 ...the guest has the payload''s tier and +N');
select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000b0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  16, 'F3 ...the override went up by the full 2 (14 → 16)');
select is(
  (select row(approved_extra, approved_tier_id, approved_plus_ones)::text
     from public.quota_requests where id = '9f000000-0000-7000-8000-000000000007'),
  row(2, 'dd000000-0000-7000-8000-0000000b1002'::uuid, 1)::text,
  'F4 ...approved_* say "as asked"');

-- ---------------------------------------------------------------------------
-- R. Raising (Max 2026-10-14: "could be both")
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000008', p_extra => 4, p_plus_ones => 3) $$,
  'R1 the admin approves more spots and more plus-ones than asked');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000009', p_extra => 3) $$,
  'R2 ...and more spots on a request without a guest');
select pg_temp.owner();
select is(
  (select g.plus_ones from public.guests g where g.full_name = 'Fay'),
  3, 'R3 the guest is on the list with the raised +3');
select is(
  (select quota_override from public.event_quotas
    where event_id = 'ee000000-0000-7000-8000-0000000b0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  23, 'R4 the override rose by 4 + 3 (16 → 23)');
select is(
  (select string_agg(row(approved_extra, approved_plus_ones)::text, ',' order by id) from public.quota_requests
    where id in ('9f000000-0000-7000-8000-000000000008', '9f000000-0000-7000-8000-000000000009')),
  '(4,3),(3,)', 'R5 approved_* record the raised numbers');
select ok(
  public.user_event_consumption('ee000000-0000-7000-8000-0000000b0001', '55555555-5555-4555-8555-555555555555')
    <= (select quota_override from public.event_quotas
         where event_id = 'ee000000-0000-7000-8000-0000000b0001' and user_id = '55555555-5555-4555-8555-555555555555'),
  'R6 the quota math holds: consumption never exceeds the quota');

-- ---------------------------------------------------------------------------
-- T. The 2026-10-14 bug: the request asks for what the guest needs
-- ---------------------------------------------------------------------------
-- Tight Night after E3: Tom's override 1, consumption 1 → 0 left.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ insert into public.quota_requests (id, event_id, user_id, requested_extra, motivation, guest_payload)
     values ('9f000000-0000-7000-8000-000000000010', 'ee000000-0000-7000-8000-0000000b0003',
             '55555555-5555-4555-8555-555555555555', 1, 'Stale cache',
             '{"name": "Max Seffelaar", "plus_ones": 4, "tier_id": "dd000000-0000-7000-8000-0000000b1004"}') $$,
  'T1 staff files "+1" for a +4 guest with 0 spots left (the stale-cache request)');
select lives_ok(
  $$ insert into public.quota_requests (id, event_id, user_id, requested_extra, motivation)
     values ('9f000000-0000-7000-8000-000000000011', 'ee000000-0000-7000-8000-0000000b0003',
             '55555555-5555-4555-8555-555555555555', 1, 'Just spots') $$,
  'T2 ...and a request without a guest');
select pg_temp.owner();
select is(
  (select string_agg(requested_extra::text, ',' order by id) from public.quota_requests
    where id in ('9f000000-0000-7000-8000-000000000010', '9f000000-0000-7000-8000-000000000011')),
  '5,1', 'T3 the guest request is stored as 5 (1 + 4 − 0 left); the plain one stays 1');

-- The requester's room shrinks after filing (here: their override is lowered).
update public.event_quotas set quota_override = 0
 where event_id = 'ee000000-0000-7000-8000-0000000b0003' and user_id = '55555555-5555-4555-8555-555555555555';
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000010') $$,
  'T4 "as asked" still approves cleanly: no 45001');
select pg_temp.owner();
select is(
  (select row(q.approved_extra, g.plus_ones,
              (select quota_override from public.event_quotas
                where event_id = 'ee000000-0000-7000-8000-0000000b0003'
                  and user_id = '55555555-5555-4555-8555-555555555555'))::text
     from public.quota_requests q join public.guests g on g.id = q.guest_id
    where q.id = '9f000000-0000-7000-8000-000000000010'),
  row(6, 4, 6)::text, 'T5 6 spots granted (1 already used + 5 for the guest), guest +4, override 6');
select is(
  public.user_event_consumption('ee000000-0000-7000-8000-0000000b0003', '55555555-5555-4555-8555-555555555555'),
  6, 'T6 ...and the requester is exactly at their quota, not over it');

-- The decision mail for that approval names the guest (first name, +N, tier).
select is(
  (select jsonb_build_object('decision', jsonb_build_object(
            'status', q.status, 'extra', coalesce(q.approved_extra, q.requested_extra))
          || case when g.id is not null then jsonb_build_object('guest', jsonb_build_object(
               'first_name', nullif(split_part(btrim(g.full_name), ' ', 1), ''),
               'plus_ones', g.plus_ones, 'tier', t.name)) else '{}'::jsonb end)
     from public.quota_requests q
     left join public.guests g on g.id = q.guest_id
     left join public.guest_tiers t on t.id = g.tier_id
    where q.id = '9f000000-0000-7000-8000-000000000010'),
  '{"decision": {"status": "approved", "extra": 6, "guest": {"first_name": "Max", "plus_ones": 4, "tier": "Regular"}}}'::jsonb,
  'T7 the shape the decision mail reads: status, granted spots, the guest');
select ok(
  (select p.prosrc ~ $re$'guest', jsonb_build_object\($re$ and p.prosrc ~ 'q\.guest_id'
     from pg_proc p where p.oid = 'public.team_mails_claim(integer)'::regprocedure),
  'T8 team_mails_claim builds that guest object from the guest the approval created');

-- ---------------------------------------------------------------------------
-- G. Role matrix — only the admin decides; nobody else learns anything
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 1) $$,
  '42501', null, 'G1 staff (the requester himself) cannot approve an adjusted request');
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 1) $$,
  '42501', null, 'G2 doorhost cannot');
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 1) $$,
  '42501', null, 'G3 user_manager cannot');
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 1) $$,
  '42501', null, 'G4 finance cannot');
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 1) $$,
  '42501', null, 'G5 crew (organizer) cannot');
select pg_temp.login('0b000000-0000-4000-8000-0000000000ab');
select throws_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 99) $$,
  '42501', null, 'G6 an outsider gets 42501, not the adjustment error (learns nothing)');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.approve_quota_request('9f000000-0000-7000-8000-000000000002', p_plus_ones => 0) $$,
  'G7 the admin can');
select pg_temp.owner();
select is(
  (select row(g.plus_ones, g.tier_id)::text from public.guests g where g.full_name = 'Bo'),
  row(0, 'dd000000-0000-7000-8000-0000000b1001'::uuid)::text,
  'G8 ...guest +0 on the payload''s own tier');

-- ---------------------------------------------------------------------------
-- H. Clients cannot write approved_*; the CHECKs hold
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, approved_extra)
     values ('ee000000-0000-7000-8000-0000000b0001', '55555555-5555-4555-8555-555555555555', 3, 'x', 3) $$,
  '42501', null, 'H1 a client cannot file a request with approved_extra');
select throws_ok(
  $$ insert into public.quota_requests (event_id, user_id, requested_extra, motivation, approved_tier_id, approved_plus_ones)
     values ('ee000000-0000-7000-8000-0000000b0001', '55555555-5555-4555-8555-555555555555', 3, 'x',
             'dd000000-0000-7000-8000-0000000b1002', 0) $$,
  '42501', null, 'H2 ...nor with approved_tier_id / approved_plus_ones');
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ update public.quota_requests set approved_extra = 1
      where id = '9f000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'H3 an admin cannot rewrite what was approved');
select pg_temp.owner();
select throws_ok(
  $$ update public.quota_requests set approved_extra = 1
      where id = '9f000000-0000-7000-8000-000000000006' $$,
  '23514', null, 'H4 approved_* on a pending row: CHECK refuses (even as the owner)');
select throws_ok(
  $$ update public.quota_requests set approved_extra = 101
      where id = '9f000000-0000-7000-8000-000000000003' $$,
  '23514', null, 'H5 approved_extra above 100: CHECK refuses');
select throws_ok(
  $$ update public.quota_requests set approved_plus_ones = null
      where id = '9f000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'H6 a guest tier without plus-ones: CHECK refuses');

-- ---------------------------------------------------------------------------
-- I. Shape of the function
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'approve_quota_request'),
  1, 'I1 exactly one approve_quota_request (no PGRST203 overloads)');
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p where p.oid = 'public.approve_quota_request(uuid, integer, uuid, integer)'::regprocedure),
  'I2 SECURITY DEFINER with search_path pinned to empty');
select ok(
  has_function_privilege('authenticated', 'public.approve_quota_request(uuid, integer, uuid, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.approve_quota_request(uuid, integer, uuid, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.approve_quota_request(uuid, integer, uuid, integer)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.approve_quota_request(uuid, integer, uuid, integer)'::regprocedure
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'I3 ACL: EXECUTE for authenticated + service_role, not anon, not PUBLIC');
select ok(
  (select p.prosrc ~* 'where\s+id\s*=\s*p_request_id\s+for\s+update'
      and p.prosrc ~* 'and\s+status\s*=\s*''pending'''
     from pg_proc p where p.oid = 'public.approve_quota_request(uuid, integer, uuid, integer)'::regprocedure),
  'I4 the request row is read FOR UPDATE and only a still-pending row is flipped');
select ok(
  (select p.prosrc ~* 'coalesce\(q\.approved_extra,\s*q\.requested_extra\)'
     from pg_proc p where p.oid = 'public.team_mails_claim(integer)'::regprocedure),
  'I5 the decision mail reports the spots granted');

select * from finish();
rollback;
