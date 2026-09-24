-- P-06 — seed platform admins: Max and Joeri (z8uq9m0tny, decision #49).
--
-- Flips user_profiles.is_platform_admin to true for exactly the two PlusOne
-- operators, matched by e-mail on auth.users (not user_profiles.email, which
-- a user could in principle drift from their auth address). No other account
-- is touched.
--
-- This repo is PUBLIC — the two login e-mail addresses are deliberately NOT
-- written anywhere in it. Each is matched by the sha256 of its lower-cased
-- form instead (computed once, outside the repo, e.g.
-- `printf '%s' 'the-address' | sha256sum`); only the resulting hex hashes
-- appear below. pgcrypto's `digest()` lives in schema `extensions` on the
-- Supabase Postgres image; `create extension if not exists` is a defensive
-- no-op if it is somehow missing.
--
-- Bootstrap chicken-and-egg: public.set_platform_admin() (20260923120000)
-- requires an EXISTING platform admin caller (it re-checks is_platform_admin()
-- itself), so it cannot be used to create the first one(s). This migration
-- follows the exact path that file's header documents instead — the
-- transaction-local GUC plusone.platform_admin_write = 'on' set immediately
-- before the UPDATE, cleared immediately after, or guard_platform_admin_flag()
-- rejects the write with 42501 regardless of caller (the guard applies to
-- every role, including the migration runner).
--
-- The actual match/write/audit logic is factored into
-- public.seed_platform_admin_by_email_hash(p_hash text) — SECURITY DEFINER,
-- search_path = '', EXECUTE revoked from public/anon/authenticated/
-- service_role, so only the owner (migrations, and the pgTAP suite, which
-- runs as the same owner) can call it. Factored out purely so pgTAP can prove
-- the logic against a local fixture hash without a real address anywhere in
-- the test file either.
--
-- Audit: same shape of audit_log row set_platform_admin() writes
-- (entity_type/action/diff). actor_id is null — a migration has no calling
-- session/auth.uid(), same convention already used for other system actions
-- (the anonymization job, #29). venue_id/event_id null, so — like every
-- set_platform_admin() row — only a platform admin can read it back
-- (has_venue_role() cannot match a null venue).
--
-- Idempotent and safe everywhere:
--   * a hash matching no auth.users row (every local/CI database — these are
--     prod-only addresses) is silently skipped, no error;
--   * an address already flagged (a second run of this migration, or a
--     `supabase db reset` re-applying it) is silently skipped too — no
--     redundant write, no duplicate audit row.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helper — the one place that knows how to turn a hash into a grant
-- ---------------------------------------------------------------------------

create or replace function public.seed_platform_admin_by_email_hash(p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_was_platform_admin boolean;
begin
  if p_hash is null then
    raise exception 'seed_platform_admin_by_email_hash requires a hash'
      using errcode = '22023';
  end if;

  select p.id, p.is_platform_admin
    into v_user_id, v_was_platform_admin
  from public.user_profiles p
  where p.id = (
    select au.id
    from auth.users au
    where encode(extensions.digest(lower(au.email), 'sha256'), 'hex') = lower(p_hash)
      and au.deleted_at is null
    order by au.created_at
    limit 1
  );

  if v_user_id is null then
    return; -- no matching account on this database — no-op, no error
  end if;

  if v_was_platform_admin then
    return; -- already set — idempotent, nothing to write or audit
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
end;
$$;

comment on function public.seed_platform_admin_by_email_hash(text) is
  'Bootstrap helper for the P-06 seed migration: flips is_platform_admin for '
  'the auth.users row whose lower(email) sha256-hashes (hex) to p_hash. Not '
  'granted to any app role — callable only as the owner (migrations, pgTAP), '
  'same reasoning as the bootstrap SQL it replaces. Idempotent: a hash that '
  'matches nothing, or whose account is already flagged, is a silent no-op.';

revoke execute on function public.seed_platform_admin_by_email_hash(text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The seed itself — sha256 of the lower-cased login e-mail; the addresses
-- themselves are deliberately not in the repo (public).
-- ---------------------------------------------------------------------------

select public.seed_platform_admin_by_email_hash(
  'ff8fb88cc52d3771376d3a6e6039fa198fb06c2a24e08a11f203489225a338d0'); -- Max

select public.seed_platform_admin_by_email_hash(
  '4c7011e1d1b29a13512b9023118189649848539c4e6d21657bf34c6582c5e4c2'); -- Joeri
