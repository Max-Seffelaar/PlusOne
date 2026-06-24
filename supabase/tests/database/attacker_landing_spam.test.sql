-- pgTAP — ATTACKER suite (security-audit 4.2): landing-page abuse (#12/#28).
-- Run: supabase test db. NEW file.
--
-- The landing form is the ONLY anon write surface. It must resist bot spam and
-- never leak whether an event/guest exists. submit_guest_request() (SECURITY
-- DEFINER) is the hardened path: a per-IP fixed-window rate limit, and a coarse
-- status that maps unknown and deactivated slugs to the SAME 'closed' (no
-- enumeration). The raw RLS underneath also holds: anon may only file a PENDING
-- request to an ACTIVE event, and may not read anyone's requests back.
-- Calls use NAMED arguments (like the app) so they survive signature growth
-- (p_marketing_opt_in / p_birthdate were added later). Seed event ee..01
-- (landing active, slug plusone-launch-night). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

select plan(7);

-- ---------------------------------------------------------------------------
-- A. Rate limit: 10 per window per IP, the 11th is throttled (one tx = one window)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();

-- Warm the window up to 9. A DO block (PERFORM) returns NO rows, so it does not
-- pollute the TAP stream — a bare SELECT returning 'ok' would be mis-read as a
-- TAP "ok" line by pg_prove.
do $$
begin
  for i in 1..9 loop
    perform public.submit_guest_request(
      p_slug => 'plusone-launch-night', p_full_name => 'Spam Bot',
      p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
      p_ip_hash => 'ip-spam-A', p_marketing_opt_in => false);
  end loop;
end $$;

select is(
  public.submit_guest_request(
    p_slug => 'plusone-launch-night', p_full_name => 'Spam Bot',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-spam-A', p_marketing_opt_in => false),
  'ok', '1 the 10th request from an IP is still accepted');
select is(
  public.submit_guest_request(
    p_slug => 'plusone-launch-night', p_full_name => 'Spam Bot',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-spam-A', p_marketing_opt_in => false),
  'rate_limited', '2 the 11th request from the same IP is rate-limited');

-- ---------------------------------------------------------------------------
-- B. No enumeration: unknown and deactivated slugs are indistinguishable
-- ---------------------------------------------------------------------------

select is(
  public.submit_guest_request(
    p_slug => 'this-slug-does-not-exist', p_full_name => 'Probe',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-probe-B', p_marketing_opt_in => false),
  'closed', '3 an unknown slug returns closed (no slug enumeration)');

reset role;
update public.events set landing_active = false
  where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();
select is(
  public.submit_guest_request(
    p_slug => 'plusone-launch-night', p_full_name => 'Probe',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-probe-C', p_marketing_opt_in => false),
  'closed', '4 a deactivated event returns the SAME closed (no existence leak, #28)');

-- The raw RLS agrees: anon cannot file a request to a deactivated event.
select throws_ok($$
  insert into public.guest_requests (event_id, full_name)
  values ('ee000000-0000-7000-8000-000000000001', 'Direct Insert Inactief')
$$, '42501', null, '5 anon cannot file a request to a deactivated event (RLS)');

reset role;
update public.events set landing_active = true
  where id = 'ee000000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- C. Anon cannot self-approve, and cannot read requests back
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();

-- Forge an approved request directly: the public policy pins status='pending'.
select throws_ok($$
  insert into public.guest_requests (event_id, full_name, status, decided_by, decided_at)
  values ('ee000000-0000-7000-8000-000000000001', 'Self Approve',
          'approved', '11111111-1111-4111-8111-111111111111', now())
$$, '42501', null, '6 anon cannot file a pre-approved request (status pinned to pending)');

-- Read other people's requests (who applied?) — anon has no SELECT grant at all.
select throws_ok($$ select count(*) from public.guest_requests $$,
  '42501', null, '7 anon cannot read guest_requests back (no enumeration of applicants)');

reset role;

select * from finish();

rollback;
