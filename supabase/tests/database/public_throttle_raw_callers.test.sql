-- pgTAP — ATTACKER suite: raw-PostgREST callers vs the public throttle
-- (20261006170000; found in the independent review of PR #379).
--
-- Every anon RPC throttles on '<prefix>:' || p_ip_hash with a caller-supplied
-- p_ip_hash. Before this migration a raw caller passed NULL (key NULL =
-- unthrottled) or a fresh random string per call (fresh bucket per call).
-- Proves, through get_landing_event ('slug:', 60 per 15 min) as anon:
--   B. no trusted-caller row (local/CI/prod before rollout): a NULL key is
--      throttled; a normal caller keeps exactly its 60 budget.
--   C. a trusted-caller row present: a header-less or wrong-secret caller is
--      bucketed per surface, so rotating random keys and NULL are throttled.
--   D. a caller presenting the secret keeps its per-hash 60 budget — even
--      while the untrusted bucket is spent (an attacker cannot DoS the door).
--   E. bookkeeping: no per-key rows for untrusted callers, server-derived
--      prefixes untouched, deleting the rows is a working kill switch.
-- One transaction = one fixed window (now() is constant). Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Clean slate for the counters this file reads (a lived-in stack may carry
-- committed rows from e2e runs) and no trusted rows — rolled back at the end.
delete from public.landing_request_throttle
where ip_hash like '%~untrusted' or ip_hash like 'slug:tp-%' or ip_hash = 'pinv:tp-server';
delete from public.public_throttle_trusted_callers;

-- ---------------------------------------------------------------------------
-- A. The secret table and the helper stay owner-only
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.public_throttle_trusted_callers'::regclass),
  'A1 RLS is enabled on public_throttle_trusted_callers');

select ok(
  not has_table_privilege('anon', 'public.public_throttle_trusted_callers', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.public_throttle_trusted_callers', 'SELECT,INSERT,UPDATE,DELETE'),
  'A2 anon and authenticated hold no privilege on the trusted-caller hashes');

select ok(
  not has_function_privilege('anon', 'public.consume_public_throttle(text, integer, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_public_throttle(text, integer, integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.consume_public_throttle(text, integer, integer)', 'EXECUTE'),
  'A3 consume_public_throttle stays internal-only');

-- ---------------------------------------------------------------------------
-- B. Open mode (no trusted row)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

do $$
begin
  for i in 1..60 loop
    perform public.get_landing_event('plusone-launch-night', null);
  end loop;
end $$;

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', null)),
  0, 'B1 a NULL key is throttled (shared anon bucket) — it used to skip the throttle');

do $$
begin
  for i in 1..59 loop
    perform public.get_landing_event('plusone-launch-night', 'tp-door-open');
  end loop;
end $$;

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-door-open')),
  1, 'B2 a normal caller''s 60th call in the window still resolves');

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-door-open')),
  0, 'B3 the 61st is throttled — the budget is unchanged');

-- ---------------------------------------------------------------------------
-- C. Enforcement on: callers without the secret
-- ---------------------------------------------------------------------------

reset role;
insert into public.public_throttle_trusted_callers (secret_sha256, label)
values (extensions.digest('tp-secret', 'sha256'), 'pgtap');
delete from public.landing_request_throttle where ip_hash = 'anon:~untrusted';

set local role anon;
select set_config('request.headers', '{}', true);

-- 60 calls, each with a never-seen key: the old code gave each its own bucket.
do $$
begin
  for i in 1..60 loop
    perform public.get_landing_event('plusone-launch-night', 'tp-rot-' || i);
  end loop;
end $$;

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-rot-fresh')),
  0, 'C1 a rotating random key is throttled once the shared untrusted bucket is spent');

select set_config('request.headers', '{"x-plusone-throttle-trust": "not-the-secret"}', true);
select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-rot-other')),
  0, 'C2 a wrong secret is treated exactly like no secret');

select set_config('request.headers', '{}', true);
do $$
begin
  for i in 1..60 loop
    perform public.get_landing_event('plusone-launch-night', null);
  end loop;
end $$;
select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', null)),
  0, 'C3 a NULL key is throttled with enforcement on');

-- ---------------------------------------------------------------------------
-- D. Enforcement on: the app server (presents the secret)
-- ---------------------------------------------------------------------------

select set_config('request.headers', '{"x-plusone-throttle-trust": "tp-secret"}', true);

do $$
begin
  for i in 1..59 loop
    perform public.get_landing_event('plusone-launch-night', 'tp-door');
  end loop;
end $$;

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-door')),
  1, 'D1 a trusted caller''s 60th call resolves while the untrusted bucket is spent (door WiFi budget intact)');

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-door')),
  0, 'D2 the trusted caller''s 61st call is throttled — same 60 budget as before');

select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-door-2')),
  1, 'D3 another trusted hash keeps its own bucket');

-- ---------------------------------------------------------------------------
-- E. Bookkeeping, server-derived keys, kill switch
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select request_count from public.landing_request_throttle where ip_hash = 'slug:~untrusted'),
  62, 'E1 every untrusted slug call (60 rotating + C1 + C2) landed in ONE bucket');

select is(
  (select count(*)::int from public.landing_request_throttle where ip_hash like 'slug:tp-rot-%'),
  0, 'E2 no per-key counter rows exist for untrusted callers');

select set_config('request.headers', '{}', true);
select public.consume_public_throttle('pinv:tp-server', 60, 20);
select is(
  (select count(*)::int from public.landing_request_throttle where ip_hash = 'pinv:tp-server'),
  1, 'E3 a server-derived prefix (pinv) keeps its own key without any header');

delete from public.public_throttle_trusted_callers;
set local role anon;
select is(
  (select count(*)::int from public.get_landing_event('plusone-launch-night', 'tp-after-kill')),
  1, 'E4 deleting the trusted rows switches enforcement off (kill switch)');

reset role;

select * from finish();
rollback;
