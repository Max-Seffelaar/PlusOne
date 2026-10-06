-- pgTAP — push bundling (Notificaties N1, z8uq9m2yvk; migration
-- 20261007110000). Run: pnpm db:test.
--
-- Proves: notification_throttle and the bundling helper are closed to every
-- app role; per company and per kind, the first 10 requests in 60 minutes are
-- pushed directly and request 11+ are bundled into one hourly slot per
-- approver (30 requests on the seed event ⇒ 10 direct + 20 sharing one
-- collapse_key, per recipient); the 60-minute window, the 24-hour end and
-- the dedupe (a request counts once, whatever its recipient count or a
-- replay); quota_request_decided is never bundled; the claim hands a due
-- slot out once per recipient with its count, and completing it settles the
-- whole slot.
--
-- Seed: venue1 aa..01 — Max 11.. admin (also admin of venue2 aa..02), Yusuf
-- 44.. organizer of ee..01, Lisa 66.. staff. venue2 event ee..b2. Rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.as_service()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$fn$;

-- n guest requests on one event, ids 9c<tag>…<i>.
create function pg_temp.guest_requests(p_event uuid, p_tag text, p_from int, p_to int)
returns void language sql as $fn$
  insert into public.guest_requests (id, event_id, full_name)
  select ('9c' || p_tag || '0000-0000-7000-8000-' || lpad(i::text, 12, '0'))::uuid,
         p_event, 'Burst ' || i
  from generate_series(p_from, p_to) i;
$fn$;

create function pg_temp.rows(p_tag text, p_recipient uuid, p_bundled boolean)
returns int language sql as $fn$
  select count(*)::int from public.notification_outbox
  where kind = 'guest_request_created'
    and source_id::text like '9c' || p_tag || '%'
    and recipient_user_id = p_recipient
    and (collapse_key is not null) = p_bundled;
$fn$;

select plan(32);

select set_config('request.jwt.claims', '{}', true);

-- A clean slate: whatever the seed queued is older than the window and
-- already delivered, and no (venue, kind) is bundling.
update public.notification_outbox
set status = 'sent', created_at = now() - interval '3 hours';
update public.notification_throttle set throttled_at = null, throttled_until = null;

-- Fixture: a venue2 event (Max is venue2's only admin in the seed).
insert into public.events (id, venue_id, name, starts_at, landing_slug, status)
values ('ee000000-0000-7000-8000-0000000000b2', 'aa000000-0000-7000-8000-000000000002',
        'N1 Night Venue2', now() + interval '10 days', 'n1-night-venue2', 'open');

-- ---------------------------------------------------------------------------
-- A. Closed to app roles
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.notification_throttle'::regclass),
  'A1 RLS is enabled on notification_throttle');

select is_empty($$
  select r || ':' || p
  from unnest(array['anon','authenticated']) r
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r, 'public.notification_throttle', p)
$$, 'A2 no app role holds any privilege on notification_throttle');

select is_empty($$
  select r
  from unnest(array['anon', 'authenticated', 'service_role']) r
  where has_function_privilege(r, 'public.notification_bundle_slot(uuid, text, uuid)', 'EXECUTE')
$$, 'A3 the bundling helper is owner-only (called by the enqueue triggers alone)');

-- ---------------------------------------------------------------------------
-- B. Threshold: 30 requests in a burst on the seed event
-- ---------------------------------------------------------------------------
select pg_temp.guest_requests('ee000000-0000-7000-8000-000000000001', '01', 1, 10);

select is(pg_temp.rows('01', '11111111-1111-4111-8111-111111111111', false), 10,
  'B1 10 requests (20 outbox rows over two approvers) stay direct: the threshold counts requests, not rows');
select is((select count(*)::int from public.notification_outbox
           where source_id::text like '9c01%' and collapse_key is not null), 0,
  'B2 …nothing bundled yet');
select is((select throttled_until from public.notification_throttle
           where venue_id = 'aa000000-0000-7000-8000-000000000001' and kind = 'guest_request_created'),
  null, 'B3 …and the venue is not bundling');

select pg_temp.guest_requests('ee000000-0000-7000-8000-000000000001', '01', 11, 30);

select is(pg_temp.rows('01', '11111111-1111-4111-8111-111111111111', false), 10,
  'B4 admin: 10 direct rows');
select is(pg_temp.rows('01', '11111111-1111-4111-8111-111111111111', true), 20,
  'B5 admin: 20 bundled rows');
select is(pg_temp.rows('01', '44444444-4444-4444-8444-444444444444', false)
          || '/' || pg_temp.rows('01', '44444444-4444-4444-8444-444444444444', true),
  '10/20', 'B6 organizer: the same 10 direct + 20 bundled');
select is((select count(distinct collapse_key)::int from public.notification_outbox
           where source_id::text like '9c01%' and collapse_key is not null), 1,
  'B7 all 20 share one collapse_key');

select ok((select throttled_at = now() and throttled_until = now() + interval '24 hours'
           from public.notification_throttle
           where venue_id = 'aa000000-0000-7000-8000-000000000001' and kind = 'guest_request_created'),
  'B8 the 11th request switched venue1/guest requests to bundling for 24 hours');
select ok((select bool_and(deliver_after = now() + interval '1 hour' and next_attempt_at = deliver_after
                           and status = 'pending')
           from public.notification_outbox
           where source_id::text like '9c01%' and collapse_key is not null),
  'B9 bundled rows wait for the end of their hourly slot (next_attempt_at = deliver_after = start + 1 h)');
select ok((select bool_and(next_attempt_at <= now() and deliver_after is null)
           from public.notification_outbox
           where source_id::text like '9c01%' and collapse_key is null),
  'B10 direct rows are due immediately');
select is((select count(*)::int from public.notification_outbox
           where source_id::text like '9c01%' and payload::text ~* 'burst'),
  0, 'B11 no payload carries the applicant''s name');

-- ---------------------------------------------------------------------------
-- C. Per company, per kind, and never the decision
-- ---------------------------------------------------------------------------
select pg_temp.guest_requests('ee000000-0000-7000-8000-0000000000b2', '02', 1, 1);
select is((select count(*)::int from public.notification_outbox
           where source_id::text like '9c02%' and collapse_key is not null), 0,
  'C1 venue2 is unaffected by venue1''s burst (per company)');

insert into public.quota_requests (id, event_id, user_id, requested_extra)
values ('9a100000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
        '66666666-6666-4666-8666-666666666666', 2);
select is((select count(*)::int from public.notification_outbox
           where source_id = '9a100000-0000-7000-8000-000000000001' and collapse_key is null), 1,
  'C2 a quota request in venue1 is pushed directly (per kind)');

-- Even with quota requests bundling, the requester's answer is direct.
update public.notification_throttle
set throttled_at = now(), throttled_until = now() + interval '24 hours'
where venue_id = 'aa000000-0000-7000-8000-000000000001' and kind = 'quota_request_created';
select is((select count(*)::int from public.notification_throttle
           where venue_id = 'aa000000-0000-7000-8000-000000000001' and kind = 'quota_request_created'), 1,
  'C3 fixture: venue1 quota requests are bundling');
update public.quota_requests
set status = 'approved', decided_by = '11111111-1111-4111-8111-111111111111', decided_at = now()
where id = '9a100000-0000-7000-8000-000000000001';
select ok((select collapse_key is null and deliver_after is null and next_attempt_at <= now()
           from public.notification_outbox
           where source_id = '9a100000-0000-7000-8000-000000000001' and kind = 'quota_request_decided'),
  'C4 quota_request_decided is never bundled');

-- ---------------------------------------------------------------------------
-- D. Window and dedupe (venue2 guest requests: Max is the only approver)
-- ---------------------------------------------------------------------------
-- 9 more in venue2 → 10 inside the window; then age them all out.
select pg_temp.guest_requests('ee000000-0000-7000-8000-0000000000b2', '02', 2, 10);
update public.notification_outbox set created_at = now() - interval '61 minutes'
where source_id::text like '9c02%';
select pg_temp.guest_requests('ee000000-0000-7000-8000-0000000000b2', '02', 11, 11);
select is((select collapse_key from public.notification_outbox
           where source_id = '9c020000-0000-7000-8000-000000000011'), null,
  'D1 requests older than 60 minutes do not count: the 11th overall is direct');

-- Bring them back inside the window: 11 in the last hour now.
update public.notification_outbox set created_at = now() - interval '59 minutes'
where source_id::text like '9c02%';
select ok((select s.collapse_key is not null
           from public.notification_bundle_slot('aa000000-0000-7000-8000-000000000002',
                                                'guest_request_created', gen_random_uuid()) s),
  'D2 a new request after 11 inside the window bundles');
update public.notification_throttle set throttled_at = null, throttled_until = null
where venue_id = 'aa000000-0000-7000-8000-000000000002';

-- Dedupe: a request already queued does not count itself again.
update public.notification_outbox set created_at = now() - interval '61 minutes'
where source_id::text like '9c02%' and source_id <> '9c020000-0000-7000-8000-000000000011';
update public.notification_outbox set created_at = now()
where source_id::text like '9c02%' and source_id::text <= '9c020000-0000-7000-8000-000000000010'
  and source_id::text >= '9c020000-0000-7000-8000-000000000002';
-- 10 in the window now (…02 to …11); a replay of …11 is still number 10.
select ok((select s.collapse_key is null
           from public.notification_bundle_slot('aa000000-0000-7000-8000-000000000002',
                                                'guest_request_created',
                                                '9c020000-0000-7000-8000-000000000011') s),
  'D3 a replayed request is not counted twice (still 10 ⇒ direct)');
select ok((select s.collapse_key is not null
           from public.notification_bundle_slot('aa000000-0000-7000-8000-000000000002',
                                                'guest_request_created', gen_random_uuid()) s),
  'D4 …while a genuinely new one is the 11th and bundles');
select is((select count(*)::int from public.notification_outbox
           where source_id = '9c010000-0000-7000-8000-000000000030'), 2,
  'D5 one outbox row per (request, recipient): the dedupe key holds under bundling');

-- ---------------------------------------------------------------------------
-- E. The 24-hour end (venue1 guest requests)
-- ---------------------------------------------------------------------------
-- Inside the 24 hours a quiet venue still bundles.
update public.notification_outbox set created_at = now() - interval '2 hours'
where venue_id = 'aa000000-0000-7000-8000-000000000001' and kind = 'guest_request_created';
select pg_temp.guest_requests('ee000000-0000-7000-8000-000000000001', '03', 1, 1);
select is(pg_temp.rows('03', '11111111-1111-4111-8111-111111111111', true), 1,
  'E1 within the 24 hours one request bundles even when the hour is quiet');

update public.notification_throttle
set throttled_at = now() - interval '24 hours 1 second', throttled_until = now() - interval '1 second'
where venue_id = 'aa000000-0000-7000-8000-000000000001' and kind = 'guest_request_created';
update public.notification_outbox set created_at = now() - interval '2 hours'
where source_id::text like '9c03%';
select pg_temp.guest_requests('ee000000-0000-7000-8000-000000000001', '04', 1, 1);
select is(pg_temp.rows('04', '11111111-1111-4111-8111-111111111111', false), 1,
  'E2 after the 24 hours a quiet venue is back to direct pushes');

-- ---------------------------------------------------------------------------
-- F. The kick: one push per recipient per slot, with the count
-- ---------------------------------------------------------------------------
-- Direct rows delivered; the 20-slot comes due (the hour has passed).
update public.notification_outbox set status = 'sent'
where status = 'pending' and collapse_key is null;
update public.notification_outbox set status = 'sent'
where source_id::text like '9c03%';
update public.notification_outbox set next_attempt_at = now() - interval '1 second'
where source_id::text like '9c01%' and collapse_key is not null;

insert into public.push_dispatch_tokens (token_hash)
select extensions.digest(t, 'sha256')
from (values ('n1-token-1'), ('n1-token-2'), ('n1-token-3')) v (t);

select pg_temp.as_service();
create temp table n1_claim_1 as
  select * from public.claim_push_outbox('n1-token-1', 1);
create temp table n1_claim_2 as
  select * from public.claim_push_outbox('n1-token-2', 200);

select is((select count(*)::int || '/' || max(payload ->> 'count') from n1_claim_1), '1/20',
  'F1 p_limit 1 still claims a whole slot: one row carrying count 20 (a slot is never split)');
select is((select count(*)::int || '/' || max(payload ->> 'count') from n1_claim_2), '1/20',
  'F2 the next claim hands out the other approver''s slot: again one row, count 20');
select is((select array_agg(distinct kind) from (
             select kind from n1_claim_1 union all select kind from n1_claim_2) k),
  array['guest_request_created'],
  'F3 …under the original kind, so the tap route is unchanged');

create temp table n1_rep as
  select c.id, o.recipient_user_id
  from (select id from n1_claim_1 union all select id from n1_claim_2) c
  join public.notification_outbox o using (id);

select is(public.complete_push_outbox(
            (select id from n1_rep where recipient_user_id = '11111111-1111-4111-8111-111111111111'),
            'sent', null),
  'sent', 'F4 completing the representative reports sent');
reset role;
select set_config('request.jwt.claims', '{}', true);
select is((select string_agg(status || ':' || n, ',' order by status) from (
             select status, count(*) n from public.notification_outbox
             where source_id::text like '9c01%' and collapse_key is not null
               and recipient_user_id = '11111111-1111-4111-8111-111111111111'
             group by status) s),
  'sent:20', 'F5 …and settles all 20 members of that approver''s slot');

select pg_temp.as_service();
select is(public.complete_push_outbox(
            (select id from n1_rep where recipient_user_id = '44444444-4444-4444-8444-444444444444'),
            'retry', 'fcm:UNAVAILABLE'),
  'pending', 'F6 a retried slot goes back to pending');
reset role;
select set_config('request.jwt.claims', '{}', true);
update public.notification_outbox set next_attempt_at = now() - interval '1 second'
where source_id::text like '9c01%' and status = 'pending';
select pg_temp.as_service();
select is((select (count(*) || '/' || max(payload ->> 'count'))
           from public.claim_push_outbox('n1-token-3', 200)),
  '1/20', 'F7 …and is claimed again as one push with the same count');

reset role;
select set_config('request.jwt.claims', '{}', true);

select * from finish();
rollback;
