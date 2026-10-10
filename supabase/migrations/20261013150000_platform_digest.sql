-- Platform R vervolg (z8uq9m2ybj, decision §9 item 19): the daily platform
-- digest to the platform admins. Design: PR #436, "Digest — voorstel".
--
-- What this adds:
--   1. mail_log.type gains 'platform_digest' (venue-less, like the decline
--      mails: no company cap, pruned after 90 days by
--      cleanup_venueless_mail_log from 20261007150100).
--   2. platform_digest_tokens: single-use invocation tokens for the
--      platform-digest Edge Function (sha256 only, 10-minute lifetime), the
--      push-dispatch pattern of 20260925120100.
--   3. platform_digest_deliveries: the per-day, per-recipient ledger that makes
--      the send idempotent. A repeated cron run (or a replayed kick) finds the
--      row and mails nothing; only a day whose attempt FAILED (nothing left the
--      building, 20261011120000's stance) may be tried again.
--   4. Service-role-only aggregate wrappers that return the SAME numbers as the
--      Platform > Overview RPCs (20261012130000, and 20261013140000 for
--      platform_subscription_counts, which added trialing_payment_set_up):
--        platform_digest_subscription_counts()  = platform_subscription_counts()
--        platform_digest_trial_funnel()         = platform_trial_funnel()
--        platform_digest_usage_30d()            = platform_usage_30d()
--      The Overview RPCs stay as they are (platform-admin-only via auth.uid();
--      a cron run has no uid, so it cannot call them). The bodies are copies,
--      deliberately: sharing one internal body would mean a third drop and
--      re-create of platform_subscription_counts() here (its result type is
--      OUT parameters), on the function 20261013140000 just rebuilt. pgTAP
--      (platform_digest.test.sql, section D) compares each wrapper with its
--      Overview twin column for column, so a later change to one side that
--      forgets the other fails CI instead of drifting silently.
--   5. platform_digest_begin(token): consumes the token (42501 otherwise) and
--      returns the digest date, the aggregates and the recipients: platform
--      admins resolved at send time, never hard-coded.
--   6. log_platform_digest_mail(recipient): the venue-less mail_log write path.
--      No company cap and no 60-second recipient window of its own (one mail
--      per recipient per Amsterdam day is the limit), idempotent through the
--      ledger. log_mail_attempt is re-created (section 6b) so a digest row
--      does not START that window either: a team invite to a platform admin
--      right after 07:45 is not refused because of the digest.
--   7. kick_platform_digest() + platform_digest_tick() and the pg_cron job.
--
-- CONFIG: one Vault secret, nothing hard-coded:
--
--   plusone_platform_digest_url   https://<project-ref>.supabase.co/functions/v1/platform-digest
--
-- Unset (every local stack, CI) => the digest SLEEPS: the tick is a no-op, no
-- token is ever minted, platform_digest_begin refuses every caller.
--
-- Why a single-use token and not a static cron secret: pg_net keeps each
-- request, headers included, in net.http_request_queue until its worker sends
-- it, and on Supabase anon/authenticated hold USAGE on schema net (a platform
-- grant postgres cannot revoke; 20260925120100's header). A static secret
-- would be readable there by any logged-in user. A token read from the queue
-- is worth at most one early run of a digest that the ledger already caps at
-- one mail per recipient per day, sent only to platform admins, holding only
-- aggregates.
--
-- Schedule: pg_cron runs in UTC; 07:45 Europe/Amsterdam is 05:45 UTC in summer
-- and 06:45 UTC in winter. The job fires at both and platform_digest_tick()
-- kicks only when it is 07:xx in Amsterdam, so DST needs no second migration.
--
-- Content: aggregates only. No company name, no guest, no contact detail is
-- read by anything here except the recipients' own login addresses, which
-- only the service-role begin RPC returns.
--
-- Grant matrix (section 8): tables closed to every app role (service_role
-- included; the definer RPCs are the only path); the Edge Function RPCs
-- executable by service_role only; config/kick/tick owner-only.

-- ---------------------------------------------------------------------------
-- 1. mail_log type
-- ---------------------------------------------------------------------------
-- Last defined in 20261013130000 (+ platform_invite). Every existing type kept.

alter table public.mail_log drop constraint mail_log_type_check;
alter table public.mail_log
  add constraint mail_log_type_check
  check (type in (
    'team_join', 'team_added_to_event', 'team_resend', 'auth_invite',
    'team_invite_declined', 'team_invite_declined_confirm',
    'platform_invite',
    'platform_digest'
  ));

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table public.platform_digest_tokens (
  token_hash bytea primary key,
  created_at timestamptz not null default now()
);

comment on table public.platform_digest_tokens is
  'Single-use invocation tokens for the platform-digest Edge Function '
  '(20261013150000): sha256 only, 10-minute lifetime, consumed by '
  'platform_digest_begin. No app-role grants.';

alter table public.platform_digest_tokens enable row level security;

create table public.platform_digest_deliveries (
  digest_date date not null,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  -- The attempt that counts for this day. A failed attempt is replaced by the
  -- retry; the mail_log row's 90-day retention takes the ledger row with it.
  mail_log_id uuid not null references public.mail_log (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (digest_date, recipient_id)
);

comment on table public.platform_digest_deliveries is
  'One row per platform admin per Amsterdam day the digest was attempted '
  '(20261013150000). Makes a repeated cron run mail nothing. Written only by '
  'log_platform_digest_mail. No app-role grants.';

create index platform_digest_deliveries_mail_log_idx
  on public.platform_digest_deliveries (mail_log_id);

alter table public.platform_digest_deliveries enable row level security;

-- No policies on either table: RLS on + no grants = closed.

-- ---------------------------------------------------------------------------
-- 3. Aggregate wrappers (service_role only) — same numbers as Overview
-- ---------------------------------------------------------------------------
-- Copies of the bodies in 20261012130000 (counts: 20261013140000) minus the is_platform_admin() guard
-- (the caller is the service role, which has no uid). EXECUTE is revoked from
-- every role but service_role in section 8; that grant IS the guard.

create or replace function public.platform_digest_subscription_counts()
returns table (
  total_companies integer,
  trialing integer,
  trial_lapsed integer,
  paid_monthly integer,
  paid_yearly integer,
  paid_unknown integer,
  past_due integer,
  canceled integer,
  comped integer,
  no_subscription integer,
  trialing_payment_set_up integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::int,
    count(*) filter (
      where s.status = 'trialing'
        and (s.stripe_subscription_id is not null
             or coalesce(s.trial_ends_at, s.created_at + interval '14 days') >= now()))::int,
    count(*) filter (
      where s.status = 'trialing'
        and s.stripe_subscription_id is null
        and coalesce(s.trial_ends_at, s.created_at + interval '14 days') < now())::int,
    count(*) filter (where s.status = 'active' and s.billing_interval = 'month')::int,
    count(*) filter (where s.status = 'active' and s.billing_interval = 'year')::int,
    count(*) filter (where s.status = 'active' and s.billing_interval is null)::int,
    count(*) filter (where s.status = 'past_due')::int,
    count(*) filter (where s.status = 'canceled')::int,
    count(*) filter (where s.status = 'comped')::int,
    count(*) filter (where s.venue_id is null)::int,
    count(*) filter (
      where s.status = 'trialing'
        and s.stripe_subscription_id is not null)::int
  from public.venues v
  left join public.subscriptions s on s.venue_id = v.id;
$$;

comment on function public.platform_digest_subscription_counts() is
  'Platform digest (service_role only): the same row as '
  'platform_subscription_counts(), for a caller with no uid. Parity is '
  'asserted in platform_digest.test.sql.';

create or replace function public.platform_digest_trial_funnel()
returns table (
  ending_7d integer,
  ended_30d integer,
  converted_30d integer,
  ended_90d integer,
  converted_90d integer,
  canceled_30d integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select
      s.id,
      s.status,
      coalesce(s.trial_ends_at, s.created_at + interval '14 days') as trial_end
    from public.subscriptions s
  )
  select
    count(*) filter (
      where t.status = 'trialing'
        and t.trial_end >= now() and t.trial_end < now() + interval '7 days')::int,
    count(*) filter (
      where t.status <> 'comped'
        and t.trial_end >= now() - interval '30 days' and t.trial_end < now())::int,
    count(*) filter (
      where t.status in ('active', 'past_due')
        and t.trial_end >= now() - interval '30 days' and t.trial_end < now())::int,
    count(*) filter (
      where t.status <> 'comped'
        and t.trial_end >= now() - interval '90 days' and t.trial_end < now())::int,
    count(*) filter (
      where t.status in ('active', 'past_due')
        and t.trial_end >= now() - interval '90 days' and t.trial_end < now())::int,
    count(*) filter (
      where t.status = 'canceled'
        and exists (
          select 1
          from public.audit_log a
          where a.entity_type = 'subscriptions'
            and a.entity_id = t.id
            and a.created_at >= now() - interval '30 days'
            and a.diff -> 'after' ->> 'status' = 'canceled'
        ))::int
  from t;
$$;

comment on function public.platform_digest_trial_funnel() is
  'Platform digest (service_role only): the same row as '
  'platform_trial_funnel(), for a caller with no uid. Parity is asserted in '
  'platform_digest.test.sql.';

create or replace function public.platform_digest_usage_30d()
returns table (
  active_companies integer,
  events integer,
  check_ins integer,
  dormant_companies integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with recent as (
    select e.id, e.venue_id
    from public.events e
    where e.cancelled_at is null
      and e.starts_at >= now() - interval '30 days'
      and e.starts_at <= now()
  )
  select
    (select count(distinct r.venue_id)::int from recent r),
    (select count(*)::int from recent),
    (select count(*)::int
       from recent r
       join public.check_ins c on c.event_id = r.id
      where c.voided_at is null),
    (select count(*)::int
       from public.venues v
      where not exists (
              select 1 from public.events e
               where e.venue_id = v.id
                 and e.cancelled_at is null
                 and e.starts_at >= now() - interval '30 days')
        and not exists (
              select 1
                from public.venue_memberships vm
                join auth.users au on au.id = vm.user_id
               where vm.venue_id = v.id
                 and au.last_sign_in_at >= now() - interval '30 days'));
$$;

comment on function public.platform_digest_usage_30d() is
  'Platform digest (service_role only): the same row as platform_usage_30d(), '
  'for a caller with no uid. Parity is asserted in platform_digest.test.sql.';

-- ---------------------------------------------------------------------------
-- 4. The digest day
-- ---------------------------------------------------------------------------
-- One definition of "today" for the ledger and the mail: the Amsterdam
-- calendar date. Stable (now() is fixed per transaction).

create or replace function public.platform_digest_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Amsterdam')::date;
$$;

-- ---------------------------------------------------------------------------
-- 5. platform_digest_begin(token) — the Edge Function's first call
-- ---------------------------------------------------------------------------
-- Consumes the token (single use, 10 minutes; 42501 for unknown, expired or
-- reused) BEFORE reading anything, then returns one jsonb document:
--   { digest_date, subscriptions{...}, funnel{...}, usage{...},
--     recipients[{id, email}] }
-- Recipients: platform admins with a usable login address (not deleted, not
-- banned), at the moment of the call.

create or replace function public.platform_digest_begin(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  delete from public.platform_digest_tokens t
  where t.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and t.created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'digest_date', public.platform_digest_today(),
    'subscriptions', (select to_jsonb(s) from public.platform_digest_subscription_counts() s),
    'funnel', (select to_jsonb(f) from public.platform_digest_trial_funnel() f),
    'usage', (select to_jsonb(u) from public.platform_digest_usage_30d() u),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'email', au.email) order by p.created_at, p.id)
        from public.user_profiles p
        join auth.users au on au.id = p.id
       where p.is_platform_admin
         and au.email is not null
         and au.deleted_at is null
         and (au.banned_until is null or au.banned_until <= now())
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.platform_digest_begin(text) is
  'Platform digest (service_role only): consume a single-use invocation token '
  '(42501 otherwise), then return the digest date, the Overview aggregates and '
  'the current platform admins (id + login address). Aggregates only.';

-- ---------------------------------------------------------------------------
-- 6. log_platform_digest_mail(recipient) — the venue-less mail_log path
-- ---------------------------------------------------------------------------
-- Returns the new mail_log id (= the Resend Idempotency-Key), or NULL when this
-- recipient already has a queued/sent/delivered digest for today: the caller
-- then sends nothing. Refuses (42501) anyone who is not a platform admin with
-- a usable address right now, so the service role cannot be talked into
-- mailing the digest to an arbitrary account. The recipient hash is computed
-- here from the login address, the same rule as recipientHash() in
-- src/features/mail/send.ts (trimmed, lowercased, sha256 hex).
--
-- Settled afterwards with the existing record_mail_send_result().

create or replace function public.log_platform_digest_mail(p_recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := public.platform_digest_today();
  v_email text;
  v_status text;
  v_id uuid;
begin
  -- Serialise two runs for the same recipient and day.
  perform pg_advisory_xact_lock(
    hashtextextended('platform_digest:' || coalesce(p_recipient_id::text, '') || ':' || v_date::text, 0));

  select au.email into v_email
    from public.user_profiles p
    join auth.users au on au.id = p.id
   where p.id = p_recipient_id
     and p.is_platform_admin
     and au.email is not null
     and au.deleted_at is null
     and (au.banned_until is null or au.banned_until <= now());
  if v_email is null then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;

  select m.status into v_status
    from public.platform_digest_deliveries d
    join public.mail_log m on m.id = d.mail_log_id
   where d.digest_date = v_date
     and d.recipient_id = p_recipient_id;
  if v_status is not null and v_status <> 'failed' then
    return null;
  end if;

  insert into public.mail_log (type, venue_id, recipient_hash)
  values ('platform_digest', null, encode(extensions.digest(lower(btrim(v_email)), 'sha256'), 'hex'))
  returning id into v_id;

  insert into public.platform_digest_deliveries (digest_date, recipient_id, mail_log_id)
  values (v_date, p_recipient_id, v_id)
  on conflict (digest_date, recipient_id)
  do update set mail_log_id = excluded.mail_log_id, created_at = now();

  return v_id;
end;
$$;

comment on function public.log_platform_digest_mail(uuid) is
  'Platform digest (service_role only): log one queued platform_digest mail '
  'for a current platform admin and return its id, or NULL when today''s '
  'digest to them is already queued/sent (one per Amsterdam day; a failed '
  'attempt may be retried). 42501 for anyone who is not a platform admin.';

-- ---------------------------------------------------------------------------
-- 6b. log_mail_attempt: platform_digest rows do not start the recipient window
-- ---------------------------------------------------------------------------
-- Body is the live one from 20261011120000 with only 'platform_digest' added
-- to the types the window ignores. The digest never goes through this
-- function (it has its own per-day limit above), so only the "does not start
-- one" half matters. Signature, security, search_path and grants unchanged
-- (create or replace keeps the ACL).

create or replace function public.log_mail_attempt(
  p_type text,
  p_venue_id uuid,
  p_recipient_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Serialise concurrent sends to one recipient so two parallel calls can't
  -- both pass the window check.
  perform pg_advisory_xact_lock(hashtextextended('mail_log:' || coalesce(p_recipient_hash, ''), 0));

  -- The decline mails are exempt from the window and do not start one. A
  -- failed attempt (nothing went out) does not start one either, and neither
  -- does the daily platform digest (20261013150000).
  if p_type not in ('team_invite_declined', 'team_invite_declined_confirm')
     and exists (
       select 1 from public.mail_log m
        where m.recipient_hash = p_recipient_hash
          and m.type not in ('team_invite_declined', 'team_invite_declined_confirm', 'platform_digest')
          and m.status <> 'failed'
          and m.created_at > now() - public.mail_recipient_window()
     ) then
    raise exception 'mail throttled: recipient' using errcode = 'PM429';
  end if;

  if p_venue_id is not null and public.mail_venue_cap_reached(p_venue_id) then
    raise exception 'mail throttled: venue daily cap' using errcode = 'PM429';
  end if;

  insert into public.mail_log (type, venue_id, recipient_hash)
  values (p_type, p_venue_id, p_recipient_hash)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_mail_attempt(text, uuid, text) is
  'Mail sender (service_role): record a queued send and return its id '
  '(= the Resend Idempotency-Key). Refuses (PM429) a second mail to the same '
  'recipient within mail_recipient_window() (the two decline mail types are '
  'exempt, 20261007150100; failed attempts do not count, 20261011120000; a '
  'platform_digest row does not count, 20261013150000) and a venue past '
  'mail_venue_daily_cap() for the UTC day. Check constraints validate the input.';

-- ---------------------------------------------------------------------------
-- 7. Config, kick, tick (owner-only)
-- ---------------------------------------------------------------------------

create or replace function public.platform_digest_setting(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_name is distinct from 'plusone_platform_digest_url' then
    return null;
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into v using p_name;
  exception when others then
    return null;
  end;
  return nullif(v, '');
end;
$$;

-- Fire-and-forget: pg_net queues the request in this transaction and sends it
-- after commit. Never raises.
create or replace function public.kick_platform_digest()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := public.platform_digest_setting('plusone_platform_digest_url');
  v_token text;
begin
  if v_url is null then
    return false;
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.platform_digest_tokens (token_hash)
  values (extensions.digest(v_token, 'sha256'));
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-platform-digest-token', v_token);
  return true;
exception when others then
  raise warning 'platform digest kick failed: % (%)', sqlerrm, sqlstate;
  return false;
end;
$$;

-- The cron entry point: drop expired tokens, then kick only at 07:xx
-- Amsterdam time (the job fires at 05:45 and 06:45 UTC, see the header).
create or replace function public.platform_digest_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.platform_digest_tokens t
  where t.created_at < now() - interval '10 minutes';

  if extract(hour from (now() at time zone 'Europe/Amsterdam')) <> 7 then
    return false;
  end if;
  return public.kick_platform_digest();
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grant matrix — revoke first, then grant
-- ---------------------------------------------------------------------------

revoke all on table public.platform_digest_tokens from anon, authenticated, service_role;
revoke all on table public.platform_digest_deliveries from anon, authenticated, service_role;

revoke execute on function
  public.platform_digest_subscription_counts(),
  public.platform_digest_trial_funnel(),
  public.platform_digest_usage_30d(),
  public.platform_digest_begin(text),
  public.log_platform_digest_mail(uuid)
from public, anon, authenticated;

grant execute on function
  public.platform_digest_subscription_counts(),
  public.platform_digest_trial_funnel(),
  public.platform_digest_usage_30d(),
  public.platform_digest_begin(text),
  public.log_platform_digest_mail(uuid)
to service_role;

revoke execute on function
  public.platform_digest_today(),
  public.platform_digest_setting(text),
  public.kick_platform_digest(),
  public.platform_digest_tick()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. pg_cron
-- ---------------------------------------------------------------------------
-- Guarded like the other schedules, so `supabase db reset` passes where the
-- local image doesn't preload pg_cron.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-platform-digest',
        '45 5,6 * * *',
        'select public.platform_digest_tick();');
      raise notice 'pg_cron: scheduled plusone-platform-digest (07:45 Europe/Amsterdam).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.platform_digest_tick() by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.platform_digest_tick() by other means.';
  end if;
end;
$$;
