-- pgTAP — Requests-epic F2: promotion dashboard RPCs + influencer stats page
-- (86ey6b3fe). Run: supabase test db.
-- Proves the funnel vocabulary end-to-end (views → requests → approved heads →
-- through-the-door heads), the RLS boundary on the INVOKER dashboards (staff
-- resolves zero rows), the leaderboard window + label-only bucket, and the
-- /i/[token] discipline (aggregates only, revocation, throttle, no
-- enumeration). Seed: influencer Jayden (1f..01) with link launch-night-jayden
-- (2c..01) on event ee..01; requests bb..01 (Robin, +1) and bb..02 attributed
-- to that link; pageviews 63 (default) / 63 (jayden) + live increments. All
-- rolls back.

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

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

select plan(16);

-- Fixture: approve Robin (+1) through Jayden's link and check him in with his
-- plus-one → approved_heads 2, checked_in_heads 2 on that link.
select pg_temp.login('44444444-4444-4444-8444-444444444444'); -- organizer
select isnt(
  public.approve_guest_request(
    'bb000000-0000-7000-8000-000000000001',
    'dd000000-0000-7000-8000-000000000001'),
  null, 'F0 fixture: Robin (+1) approved through Jayden''s link');
reset role;
insert into public.check_ins (guest_id, checked_by, plus_ones_arrived)
select g.id, '66666666-6666-4666-8666-666666666666', 1
from public.guests g where g.full_name = 'Robin Castelijns';

-- ---------------------------------------------------------------------------
-- A. event_link_funnel (INVOKER: RLS is the boundary)
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111'); -- admin
select is(
  (select count(*)::int from public.event_link_funnel('ee000000-0000-7000-8000-000000000001')),
  2, 'A1 admin sees both links of the event (default + influencer)');
select is(
  (select approved_heads::int || ':' || checked_in_heads::int
   from public.event_link_funnel('ee000000-0000-7000-8000-000000000001')
   where slug = 'launch-night-jayden'),
  '2:2', 'A2 the influencer link counts approved heads and through-the-door heads (1+N)');
select ok(
  (select views > 0 and requests = 2
   from public.event_link_funnel('ee000000-0000-7000-8000-000000000001')
   where slug = 'launch-night-jayden'),
  'A3 …and carries its pageviews + request count');

select pg_temp.login('55555555-5555-4555-8555-555555555555'); -- staff
select is(
  (select count(*)::int from public.event_link_funnel('ee000000-0000-7000-8000-000000000001')),
  0, 'A4 staff resolves zero funnel rows (request_links is invisible to staff)');
reset role;

-- ---------------------------------------------------------------------------
-- B. venue_influencer_leaderboard
-- ---------------------------------------------------------------------------

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select is(
  (select checked_in_heads::int from public.venue_influencer_leaderboard(
     'aa000000-0000-7000-8000-000000000001')
   where influencer_name = 'Jayden Promo'),
  2, 'B1 the leaderboard aggregates Jayden''s through-the-door heads venue-wide');
select is(
  (select count(*)::int from public.venue_influencer_leaderboard(
     'aa000000-0000-7000-8000-000000000001')
   where influencer_id is null),
  1, 'B2 label-only/default links bundle into one "no influencer" bucket');
select is(
  (select count(*)::int from public.venue_influencer_leaderboard(
     'aa000000-0000-7000-8000-000000000001', now() + interval '30 days')),
  0, 'B3 the starts_at window filters events out of range');
select is(
  (select is_default from public.venue_label_link_funnel(
     'aa000000-0000-7000-8000-000000000001')
   where event_name = 'PLUSONE Launch Night' limit 1),
  true, 'B4 label-only links list INDIVIDUALLY (S15 "No influencer"), incl. the default link');
reset role;

-- ---------------------------------------------------------------------------
-- C. get_influencer_stats — the public secret page (/i/[token])
-- ---------------------------------------------------------------------------

update public.influencers
  set stats_token_hash = encode(extensions.digest('tok-if-test', 'sha256'), 'hex')
  where id = '1f000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();
select is(
  (select r ->> 'found' || ':' || (r ->> 'name') || ':' || (r -> 'totals' ->> 'checked_in_heads')
   from public.get_influencer_stats(encode(extensions.digest('tok-if-test', 'sha256'), 'hex'), 'ip-if-a') r),
  'true:Jayden Promo:2', 'C1 the token resolves to the influencer''s own aggregates');
select is(
  (select jsonb_array_length(public.get_influencer_stats(
     encode(extensions.digest('tok-if-test', 'sha256'), 'hex'), 'ip-if-a') -> 'events')),
  1, 'C2 one per-event block for the one event with their links');
select is(
  (select public.get_influencer_stats(
     encode(extensions.digest('tok-if-test', 'sha256'), 'hex'), 'ip-if-a') -> 'events' -> 0 ->> 'slug'),
  'launch-night-jayden',
  'C2b each event block carries THEIR link slug (S16 copy/QR of their own URL)');
select ok(
  not (public.get_influencer_stats(encode(extensions.digest('tok-if-test', 'sha256'), 'hex'), 'ip-if-a')
       ?| array['full_name', 'email', 'phone', 'guests']),
  'C3 the payload is aggregate-only — no guest PII keys anywhere at the top level');
select is(
  public.get_influencer_stats('bogus-hash', 'ip-if-b') ->> 'found',
  'false', 'C4 an unknown token is a generic not-found (no enumeration)');
reset role;

-- Revocation: nulling the hash kills the URL.
update public.influencers set stats_token_hash = null
  where id = '1f000000-0000-7000-8000-000000000001';
select pg_temp.login_anon();
select is(
  public.get_influencer_stats(encode(extensions.digest('tok-if-test', 'sha256'), 'hex'), 'ip-if-c') ->> 'found',
  'false', 'C5 a revoked token reads identically not-found');

-- Throttle: probing burns budget ('if:' prefix, 30 per window).
do $$
begin
  for i in 1..30 loop
    perform public.get_influencer_stats('probe-' || i, 'ip-if-rl');
  end loop;
end $$;
reset role;
update public.influencers
  set stats_token_hash = encode(extensions.digest('tok-if-test', 'sha256'), 'hex')
  where id = '1f000000-0000-7000-8000-000000000001';
select pg_temp.login_anon();
select is(
  public.get_influencer_stats(encode(extensions.digest('tok-if-test', 'sha256'), 'hex'), 'ip-if-rl') ->> 'found',
  'false', 'C6 past the window even a valid token reads not-found (probing costs budget)');
reset role;

select * from finish();

rollback;
