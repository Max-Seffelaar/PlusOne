-- pgTAP — ATTACKER suite (security-audit 4.2): landing-page abuse (#12/#28).
-- Run: supabase test db. Updated for 20260625100000_harden_request_rate_limit.
--
-- The landing form is the ONLY anon write surface. It must resist bot spam and
-- never leak whether an event/guest exists. submit_guest_request() (SECURITY
-- DEFINER) is the hardened path:
--   * Per-IP fixed-window rate limit (5 per 15 min, tightened from 10/10).
--   * Rate limit fires BEFORE slug resolution so non-existent slug probes also
--     consume the budget (a bot can no longer enumerate slugs for free).
--   * Coarse status: unknown and deactivated slugs map to the same 'closed' →
--     no enumeration (#28).
-- Calls use NAMED arguments so they survive future signature growth.
-- Seed event ee..01 (landing active, slug plusone-launch-night).
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login_anon()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$fn$;

select plan(9);

-- ---------------------------------------------------------------------------
-- A. Rate limit: 5 per window per IP, the 6th is throttled (one tx = one window)
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();

-- Warm the window up to 4.
do $$
begin
  for i in 1..4 loop
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
  'ok', '1 the 5th request from an IP is still accepted');

select is(
  public.submit_guest_request(
    p_slug => 'plusone-launch-night', p_full_name => 'Spam Bot',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-spam-A', p_marketing_opt_in => false),
  'rate_limited', '2 the 6th request from the same IP is rate-limited');

-- ---------------------------------------------------------------------------
-- B. Slug-probe fix: non-existent slug probes burn the rate-limit budget
--    (rate limit now fires BEFORE slug resolution — fix in 20260625100000).
-- ---------------------------------------------------------------------------

-- Warm to 4 on a fresh IP using a non-existent slug. Each returns 'closed' but
-- still increments the counter. The 5th (to the real slug) should be 'ok',
-- not 'rate_limited', confirming we haven't exceeded the budget yet.
do $$
begin
  for i in 1..4 loop
    perform public.submit_guest_request(
      p_slug => 'does-not-exist-at-all', p_full_name => 'Slug Prober',
      p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
      p_ip_hash => 'ip-probe-burn', p_marketing_opt_in => false);
  end loop;
end $$;

select is(
  public.submit_guest_request(
    p_slug => 'plusone-launch-night', p_full_name => 'Slug Prober',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-probe-burn', p_marketing_opt_in => false),
  'ok', '3 5th attempt from slug-prober (after 4 closed probes) still accepted — budget shared');

select is(
  public.submit_guest_request(
    p_slug => 'plusone-launch-night', p_full_name => 'Slug Prober',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-probe-burn', p_marketing_opt_in => false),
  'rate_limited', '4 6th attempt from slug-prober is rate-limited — closed probes burned quota');

-- ---------------------------------------------------------------------------
-- C. No enumeration: unknown and deactivated slugs are indistinguishable
-- ---------------------------------------------------------------------------

select is(
  public.submit_guest_request(
    p_slug => 'this-slug-does-not-exist', p_full_name => 'Probe',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-probe-C', p_marketing_opt_in => false),
  'closed', '5 an unknown slug returns closed (no slug enumeration)');

reset role;
update public.events set landing_active = false
  where id = 'ee000000-0000-7000-8000-000000000001';

select pg_temp.login_anon();
select is(
  public.submit_guest_request(
    p_slug => 'plusone-launch-night', p_full_name => 'Probe',
    p_email => null, p_phone => null, p_plus_ones => 0, p_motivation => null,
    p_ip_hash => 'ip-probe-D', p_marketing_opt_in => false),
  'closed', '6 a deactivated event returns the SAME closed (no existence leak, #28)');

-- The raw RLS agrees: anon cannot file a request to a deactivated event.
select throws_ok($$
  insert into public.guest_requests (event_id, full_name)
  values ('ee000000-0000-7000-8000-000000000001', 'Direct Insert Inactive')
$$, '42501', null, '7 anon cannot file a request to a deactivated event (RLS)');

reset role;
update public.events set landing_active = true
  where id = 'ee000000-0000-7000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- D. Anon cannot self-approve, and cannot read requests back
-- ---------------------------------------------------------------------------

select pg_temp.login_anon();

select throws_ok($$
  insert into public.guest_requests (event_id, full_name, status, decided_by, decided_at)
  values ('ee000000-0000-7000-8000-000000000001', 'Self Approve',
          'approved', '11111111-1111-4111-8111-111111111111', now())
$$, '42501', null, '8 anon cannot file a pre-approved request (status pinned to pending)');

select throws_ok($$ select count(*) from public.guest_requests $$,
  '42501', null, '9 anon cannot read guest_requests back (no enumeration of applicants)');

reset role;

select * from finish();

rollback;
