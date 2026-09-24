-- P-06 — seed platform admins: Max and Joeri (z8uq9m0tny, decision #49).
--
-- Flips user_profiles.is_platform_admin to true for exactly the two PlusOne
-- operators, matched by e-mail on auth.users (not user_profiles.email, which
-- a user could in principle drift from their auth address). No other account
-- is touched.
--
-- This repo is PUBLIC. The two hex values below are sha256(lower(address))
-- for each operator's login e-mail (computed once, outside the repo, e.g.
-- `printf '%s' 'the-address' | sha256sum`) — this is SCRAPER-RESISTANCE, NOT
-- CONFIDENTIALITY: an unsalted sha256 of a plausible address is crackable in
-- seconds by hashing a candidate list and comparing, so treat these hashes as
-- "harder to casually read off the page", not as a secret. They buy exactly
-- one thing — nobody skimming this file sees a real address — which is
-- enough to satisfy "no e-mail address anywhere in this public repo" without
-- claiming more. pgcrypto's `digest()` is assumed already present in schema
-- `extensions` (bundled on the Supabase Postgres image, confirmed locally);
-- this migration does not (re-)install it — `create extension if not exists
-- ... with schema extensions` is a no-op, not a safety net, when the
-- extension already exists in a different schema, so it would not actually
-- fix a missing/misplaced install and is deliberately not included.
--
-- Bootstrap chicken-and-egg: public.set_platform_admin() (20260923120000)
-- requires an EXISTING platform admin caller (it re-checks is_platform_admin()
-- itself), so it cannot be used to create the first one(s). This migration
-- follows the exact path that file's header documents instead — the
-- transaction-local GUC plusone.platform_admin_write = 'on' set immediately
-- before the UPDATE, cleared immediately after, or guard_platform_admin_flag()
-- rejects the write with 42501 regardless of caller (the guard applies to
-- every role, including the migration runner). If anything between the two
-- set_config() calls raises, the GUC needs no explicit cleanup: it is
-- transaction-local (set_config(..., is_local => true)), and Postgres
-- discards all transaction-local GUC state when the aborting (sub)transaction
-- rolls back — there is no window left open for a later statement to inherit.
--
-- The actual match/write/audit logic is factored into
-- public.seed_platform_admin_by_email_hash(p_hash text) — SECURITY DEFINER,
-- search_path = '', EXECUTE revoked from public/anon/authenticated/
-- service_role, so only the owner (migrations, and the pgTAP suite, which
-- runs as the same owner) can call it. Factored out purely so pgTAP can prove
-- the logic against a local fixture hash without a real address anywhere in
-- the test file either. It returns a status ('matched' | 'already' |
-- 'missing') instead of silently swallowing a non-match, because a wrong
-- hash (typo, trailing newline, wrong address) must not apply cleanly and
-- grant nobody with only a manual SELECT as evidence — the migration body
-- below raises a WARNING (not an exception — this must stay a no-op on every
-- local/CI database, where neither address exists) for any hash that comes
-- back 'missing', so `supabase db push`'s own output surfaces it.
--
-- Left permanently in place after this migration runs: the helper is not a
-- one-shot script, it is a normal function that will keep working for as
-- long as it exists in the schema. It deliberately bypasses
-- set_platform_admin()'s own is_platform_admin() check and writes actor_id =
-- null instead of a caller id — exactly what a hash-driven bootstrap needs,
-- but also means anyone who becomes the DB owner (never an app role — EXECUTE
-- is revoked from all of them below) could grant platform-admin status by
-- hash outside the normal audited RPC path. Accepted: the owner already has
-- unrestricted access to everything this function touches.
--
-- Idempotent and safe everywhere:
--   * a hash matching no auth.users row (every local/CI environment — these
--     are prod-only addresses) is a no-op, surfaced as a WARNING, never an
--     error;
--   * an auth.users row with NO user_profiles row is a genuine data anomaly
--     (every account should have one), not a normal "account doesn't exist
--     here" case — the helper raises an EXCEPTION for that, not a warning;
--   * an address already flagged (a second run of this migration, or a
--     `supabase db reset` re-applying it) is silently skipped too — no
--     redundant write, no duplicate audit row.

-- ---------------------------------------------------------------------------
-- Helper — the one place that knows how to turn a hash into a grant
-- ---------------------------------------------------------------------------

create or replace function public.seed_platform_admin_by_email_hash(p_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_id uuid;
  v_user_id uuid;
  v_was_platform_admin boolean;
begin
  if p_hash is null then
    raise exception 'seed_platform_admin_by_email_hash requires a hash'
      using errcode = '22023';
  end if;

  select au.id into v_auth_id
  from auth.users au
  where encode(extensions.digest(lower(au.email), 'sha256'), 'hex') = lower(p_hash)
    and au.deleted_at is null
  order by au.created_at, au.id
  limit 1;

  if v_auth_id is null then
    return 'missing'; -- no matching auth.users row on this database
  end if;

  select p.id, p.is_platform_admin
    into v_user_id, v_was_platform_admin
  from public.user_profiles p
  where p.id = v_auth_id;

  if v_user_id is null then
    -- auth.users matched but user_profiles did not: a data anomaly, not the
    -- normal "this account doesn't exist on this database" case above.
    raise exception
      'seed_platform_admin_by_email_hash: auth.users % has no user_profiles row',
      v_auth_id;
  end if;

  if v_was_platform_admin then
    return 'already'; -- idempotent; nothing to write or audit
  end if;

  perform set_config('plusone.platform_admin_write', 'on', true);
  update public.user_profiles
     set is_platform_admin = true
   where id = v_user_id;
  perform set_config('plusone.platform_admin_write', 'off', true);

  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  values
    (null, null, null, 'user_profiles', v_user_id, 'platform_admin_grant',
     jsonb_build_object(
       'before', jsonb_build_object('is_platform_admin', false),
       'after',  jsonb_build_object('is_platform_admin', true)),
     null);

  return 'matched';
end;
$$;

comment on function public.seed_platform_admin_by_email_hash(text) is
  'Bootstrap helper for the P-06 seed migration: flips is_platform_admin for '
  'the auth.users row whose lower(email) sha256-hashes (hex) to p_hash. Not '
  'granted to any app role — callable only as the owner (migrations, pgTAP), '
  'same reasoning as the bootstrap SQL it replaces. Returns ''matched'' | '
  '''already'' | ''missing''; raises only when a matched auth.users row has '
  'no user_profiles row (a data anomaly, not a normal no-op).';

revoke execute on function public.seed_platform_admin_by_email_hash(text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The seed itself — sha256 of the lower-cased login e-mail (scraper-
-- resistant, not confidential — see the header). A 'missing' status is
-- expected on every local/CI database and gets a WARNING, not a failure.
-- ---------------------------------------------------------------------------

do $$
declare
  v_status text;
begin
  v_status := public.seed_platform_admin_by_email_hash(
    'ff8fb88cc52d3771376d3a6e6039fa198fb06c2a24e08a11f203489225a338d0'); -- Max
  if v_status = 'missing' then
    raise warning 'seed_platform_admins: hash % matched no account',
      'ff8fb88cc52d3771376d3a6e6039fa198fb06c2a24e08a11f203489225a338d0';
  end if;

  v_status := public.seed_platform_admin_by_email_hash(
    '4c7011e1d1b29a13512b9023118189649848539c4e6d21657bf34c6582c5e4c2'); -- Joeri
  if v_status = 'missing' then
    raise warning 'seed_platform_admins: hash % matched no account',
      '4c7011e1d1b29a13512b9023118189649848539c4e6d21657bf34c6582c5e4c2';
  end if;
end;
$$;
