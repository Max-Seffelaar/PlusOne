-- Billing-mails B1 (z8uq9m2z19, decision #32; copy v3, Max 2026-10-09).
--
-- Seven billing mails to the admins + finance of a company:
--   billing_trial_day0      trial start (company created)
--   billing_trial_day7      effective trial end - 7 days
--   billing_trial_day12     effective trial end - 2 days
--   billing_trial_ended     the effective trial end moment
--   billing_trial_day21     effective trial end + 7 days (the last one)
--   billing_payment_failed  every Stripe invoice.payment_failed event
--   billing_canceled        every Stripe customer.subscription.deleted event
--
-- WHEN a trial mail is due is decided by ONE pure TS function,
-- dueBillingMails() in src/features/billing/mail-schedule.ts (vitest on every
-- day, the override, a missed day, comped, paused). The database decides
-- WHO may get WHAT, and that each (company, mail, recipient) goes out once:
--
--   1. mail_log.type gains the seven types. Every existing type is kept:
--      'platform_invite' (20261013130000) and 'platform_digest' (#440,
--      20261013150000) included. The constraint is the full set; a later
--      migration that widens it must start from this list.
--   2. Billing mails stay OUT of the invitation limits: mail_venue_cap_reached
--      no longer counts them (a payment-failed mail must never eat a
--      company's 25 invites a day), and log_mail_attempt's 60-second
--      recipient window neither counts nor applies to them.
--   3. billing_mail_settings: "Pause billing mails" per company (platform
--      admin, set_billing_mails_paused). A separate table instead of a column
--      on subscriptions, because members hold a table-level SELECT on
--      subscriptions and a new column there would be readable by them.
--   4. billing_mail_events: the queue of Stripe-driven mails, one row per
--      Stripe event id. Written only by enqueue_billing_event_mail(), which
--      the Stripe webhook calls AFTER apply_stripe_subscription_update
--      accepted the event; it requires the event in stripe_webhook_events,
--      so a replay (refused by that ledger) never reaches it, and the primary
--      key makes a second call a no-op anyway.
--   5. billing_mail_deliveries: the idempotency ledger, one row per
--      (company, dedupe key, recipient). The dedupe key is the mail type for
--      trial mails (once per company per type, decision Max) and
--      'stripe:<event id>' for the two Stripe mails (once per EVENT, so every
--      failed payment gets its mail). A transiently failed attempt (quota,
--      rate limit, provider down, timeout, network: nothing left the building)
--      may be retried; a rejected one and queued/sent/delivered never again.
--   6. log_billing_mail(): the only write path to mail_log for these types.
--      Re-checks inside the database, whatever the caller says: the recipient
--      is an admin or finance member of THAT company with a usable login
--      address; the company is not comped and not paused; a trial mail needs a
--      trialing subscription; a Stripe mail needs its queued event for that
--      company and type. The recipient hash is computed here.
--   7. The job: pg_cron -> billing_mails_tick() -> kick_billing_mails() ->
--      pg_net POST with a single-use token -> the app route
--      /api/webhooks/billing-mails -> billing_mails_begin(token) consumes the
--      token before anything is read. Same pattern as the platform digest
--      (20261012160000, push-dispatch before it); see that header for why a
--      single-use token and not a static secret (pg_net's request queue is
--      readable by app roles on Supabase).
--   8. platform_billing_mail_timeline(venue) + set_billing_mails_paused():
--      SECURITY DEFINER, is_platform_admin() inside, 42501 otherwise.
--
-- CONFIG: one Vault secret, nothing hard-coded:
--   plusone_billing_mails_url   https://app.plus-one.io/api/webhooks/billing-mails
-- Unset (every local stack, CI) => the job SLEEPS: the tick is a no-op, no
-- token is minted, billing_mails_begin refuses every caller.
--
-- Schedule: hourly at :05 UTC; the tick only kicks between 08:00 and 20:59
-- Amsterdam time (no mail at night; DST needs no second migration). A trial
-- mail is due for 24 hours from its moment, so every due mail sees at least
-- twelve runs: a failed run is retried the same day, but a mail whose 24
-- hours have passed is never sent late (no catch-up mail, decision Max
-- 2026-10-09; a short trial override skips the days already gone).
--
-- PII: mail_log keeps the sha256 of the address, never the address. Login
-- addresses and first names leave the database only through the
-- service_role RPCs billing_mail_recipients/billing_mails_begin.

-- ---------------------------------------------------------------------------
-- 1. mail_log type
-- ---------------------------------------------------------------------------

alter table public.mail_log drop constraint mail_log_type_check;
alter table public.mail_log
  add constraint mail_log_type_check
  check (type in (
    'team_join', 'team_added_to_event', 'team_resend', 'auth_invite',
    'team_invite_declined', 'team_invite_declined_confirm',
    'platform_invite',
    'platform_digest',
    'billing_trial_day0', 'billing_trial_day7', 'billing_trial_day12',
    'billing_trial_ended', 'billing_trial_day21',
    'billing_payment_failed', 'billing_canceled'
  ));

-- ---------------------------------------------------------------------------
-- 2. Billing mails outside the invitation limits
-- ---------------------------------------------------------------------------
-- Bodies are the live ones (mail_venue_cap_reached from 20261011120000,
-- log_mail_attempt from 20261013150000 with its platform_digest exemption)
-- with only the billing_ predicate added; signatures, security, search_path
-- and grants unchanged.

create or replace function public.mail_venue_cap_reached(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= public.mail_venue_daily_cap()
    from public.mail_log m
   where m.venue_id = p_venue_id
     and m.status <> 'failed'
     and m.type not like 'billing\_%'
     and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

comment on function public.mail_venue_cap_reached(uuid) is
  'True when the venue sent mail_venue_daily_cap() invitation mails (failed '
  'attempts excluded since 20261011120000, billing mails excluded since '
  '20261013170000) in the current UTC day. service_role only.';

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
  -- Billing mails have their own path (log_billing_mail) and never come here.
  if p_type like 'billing\_%' then
    raise exception 'billing mails go through log_billing_mail' using errcode = '22023';
  end if;

  -- Serialise concurrent sends to one recipient so two parallel calls can't
  -- both pass the window check.
  perform pg_advisory_xact_lock(hashtextextended('mail_log:' || coalesce(p_recipient_hash, ''), 0));

  -- The decline mails are exempt from the window and do not start one. A
  -- failed attempt (nothing went out) does not start one either, and neither
  -- does the daily platform digest (20261013150000) or a billing mail.
  if p_type not in ('team_invite_declined', 'team_invite_declined_confirm')
     and exists (
       select 1 from public.mail_log m
        where m.recipient_hash = p_recipient_hash
          and m.type not in ('team_invite_declined', 'team_invite_declined_confirm', 'platform_digest')
          and m.type not like 'billing\_%'
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
  'platform_digest row does not count, 20261013150000; billing mails neither '
  'count nor pass here, 20261013170000) and a venue past '
  'mail_venue_daily_cap() for the UTC day.';

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

create table public.billing_mail_settings (
  venue_id uuid primary key references public.venues (id) on delete cascade,
  paused boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.billing_mail_settings is
  'Billing-mail switch per company (20261013170000): paused = no billing mail '
  'at all. Written only by set_billing_mails_paused (platform admin). No '
  'app-role grants.';

alter table public.billing_mail_settings enable row level security;

create table public.billing_mail_events (
  stripe_event_id text primary key
    constraint billing_mail_events_id_check check (char_length(stripe_event_id) between 1 and 200),
  venue_id uuid not null references public.venues (id) on delete cascade,
  type text not null
    constraint billing_mail_events_type_check
    check (type in ('billing_payment_failed', 'billing_canceled')),
  event_created timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.billing_mail_events is
  'Stripe-driven billing mails waiting for the job (20261013170000): one row '
  'per Stripe event id. Written only by enqueue_billing_event_mail. No '
  'app-role grants.';

create index billing_mail_events_created_idx on public.billing_mail_events (created_at desc);
create index billing_mail_events_venue_idx on public.billing_mail_events (venue_id, created_at desc);

alter table public.billing_mail_events enable row level security;

create table public.billing_mail_deliveries (
  venue_id uuid not null references public.venues (id) on delete cascade,
  -- The mail type for a trial mail; 'stripe:<event id>' for a Stripe mail.
  dedupe_key text not null
    constraint billing_mail_deliveries_key_check check (char_length(dedupe_key) between 1 and 210),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  -- The attempt that counts. A failed attempt is replaced by the retry.
  mail_log_id uuid not null references public.mail_log (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (venue_id, dedupe_key, recipient_id)
);

comment on table public.billing_mail_deliveries is
  'Idempotency ledger for billing mails (20261013170000): one row per company, '
  'dedupe key and recipient. Written only by log_billing_mail. No app-role '
  'grants.';

create index billing_mail_deliveries_mail_log_idx on public.billing_mail_deliveries (mail_log_id);

alter table public.billing_mail_deliveries enable row level security;

create table public.billing_mail_tokens (
  token_hash bytea primary key,
  created_at timestamptz not null default now()
);

comment on table public.billing_mail_tokens is
  'Single-use invocation tokens for the billing-mail job (20261013170000): '
  'sha256 only, 10-minute lifetime, consumed by billing_mails_begin. No '
  'app-role grants.';

alter table public.billing_mail_tokens enable row level security;

-- No policies on any of the four: RLS on + no grants = closed.

-- ---------------------------------------------------------------------------
-- 4. Helpers (owner-only)
-- ---------------------------------------------------------------------------

-- Is billing mail switched off for this company? Comped is never mailed,
-- paused is never mailed, a company without a subscription row neither.
create or replace function public.billing_mail_blocked(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.status = 'comped'
        or coalesce((select bs.paused from public.billing_mail_settings bs
                      where bs.venue_id = s.venue_id), false)
      from public.subscriptions s
     where s.venue_id = p_venue_id
  ), true);
$$;

-- The recipients of a company's billing mail: admin or finance members with
-- a usable login address. One definition for begin, the webhook path and
-- log_billing_mail's re-check.
create or replace function public.billing_mail_recipient_rows(p_venue_id uuid)
returns table (user_id uuid, email text, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select vm.user_id, au.email::text, p.full_name
    from public.venue_memberships vm
    join public.user_profiles p on p.id = vm.user_id
    join auth.users au on au.id = vm.user_id
   where vm.venue_id = p_venue_id
     and vm.roles && array['admin', 'finance']::public.venue_role[]
     and au.email is not null
     and au.deleted_at is null
     and (au.banned_until is null or au.banned_until <= now())
   order by vm.created_at, vm.user_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. enqueue_billing_event_mail — the Stripe webhook's call (service_role)
-- ---------------------------------------------------------------------------
-- Called after apply_stripe_subscription_update returned true for the event.
-- The type is derived from the LEDGER row (never from the caller): the event
-- must be in stripe_webhook_events as invoice.payment_failed or
-- customer.subscription.deleted. The company is the one whose subscription
-- carries p_stripe_customer_id. Returns true when queued; false (nothing
-- queued) for an unknown or other-type event, an unknown customer, a comped
-- or paused company, an event older than the newest one applied to that
-- subscription (a late payment_failed after a newer invoice.paid must not
-- tell a paying company their payment failed), an event more than 3 days old
-- (a manual resend from the Stripe dashboard), or a second call. The webhook
-- also calls it on a ledger replay: the primary key makes that a no-op once
-- queued, and it lets Stripe's redelivery recover a queue call that failed.

create or replace function public.enqueue_billing_event_mail(
  p_stripe_event_id text,
  p_stripe_customer_id text,
  p_event_created timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ledger_type text;
  v_type text;
  v_venue uuid;
  v_last_event_at timestamptz;
  v_inserted integer;
begin
  if p_stripe_event_id is null or p_stripe_customer_id is null then
    raise exception 'event id and customer are required' using errcode = '22004';
  end if;

  select e.type into v_ledger_type
    from public.stripe_webhook_events e
   where e.id = p_stripe_event_id;
  v_type := case v_ledger_type
    when 'invoice.payment_failed' then 'billing_payment_failed'
    when 'customer.subscription.deleted' then 'billing_canceled'
    else null
  end;
  if v_type is null then
    return false;
  end if;

  select s.venue_id, s.last_stripe_event_at into v_venue, v_last_event_at
    from public.subscriptions s
   where s.stripe_customer_id = p_stripe_customer_id;
  if v_venue is null or public.billing_mail_blocked(v_venue) then
    return false;
  end if;
  if p_event_created is not null and v_last_event_at is not null
     and p_event_created < v_last_event_at then
    return false;
  end if;
  -- An old event resent from the Stripe dashboard is not news to anyone.
  if p_event_created is not null and p_event_created < now() - interval '3 days' then
    return false;
  end if;

  insert into public.billing_mail_events (stripe_event_id, venue_id, type, event_created)
  values (p_stripe_event_id, v_venue, v_type, p_event_created)
  on conflict (stripe_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

comment on function public.enqueue_billing_event_mail(text, text, timestamptz) is
  'Stripe webhook (service_role): queue the billing mail for an event the '
  'stripe_webhook_events ledger accepted (payment_failed / subscription '
  'deleted). Type from the ledger, company from the customer id. Idempotent '
  'per Stripe event; false for comped, paused, stale or unknown.';

-- ---------------------------------------------------------------------------
-- 6. billing_mails_begin(token) — the job's first call (service_role)
-- ---------------------------------------------------------------------------
-- Consumes the token (single use, 10 minutes; 42501 otherwise) BEFORE reading
-- anything, then returns:
--   { now,
--     trials: [{ venue_id, created_at, trial_ends_at (effective),
--                stripe_linked }],          -- trialing, not blocked, recent
--     events: [{ stripe_event_id, venue_id, type }] }  -- last 3 days
-- Only facts; whether a trial mail is due is mail-schedule.ts's call. A
-- trial is "recent" when it started in the last 2 days or its effective end
-- lies within -9 / +8 days, which covers every mail moment's 24-hour window.

create or replace function public.billing_mails_begin(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  delete from public.billing_mail_tokens t
  where t.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and t.created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with trials as (
    select s.venue_id,
           s.created_at,
           coalesce(s.trial_ends_at, s.created_at + interval '14 days') as trial_end,
           s.stripe_subscription_id is not null as stripe_linked
      from public.subscriptions s
     where s.status = 'trialing'
       and not public.billing_mail_blocked(s.venue_id)
  )
  select jsonb_build_object(
    'now', now(),
    'trials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'venue_id', t.venue_id,
               'created_at', t.created_at,
               'trial_ends_at', t.trial_end,
               'stripe_linked', t.stripe_linked) order by t.venue_id)
        from trials t
       where t.created_at > now() - interval '2 days'
          or (t.trial_end > now() - interval '9 days' and t.trial_end < now() + interval '8 days')
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stripe_event_id', e.stripe_event_id,
               'venue_id', e.venue_id,
               'type', e.type) order by e.created_at, e.stripe_event_id)
        from public.billing_mail_events e
       where e.created_at > now() - interval '3 days'
         and not public.billing_mail_blocked(e.venue_id)
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.billing_mails_begin(text) is
  'Billing-mail job (service_role): consume a single-use invocation token '
  '(42501 otherwise), then return the trialing companies near a mail moment '
  'and the Stripe mails of the last 3 days. Facts only, no addresses.';

-- ---------------------------------------------------------------------------
-- 7. billing_mail_recipients(venue) — names + addresses (service_role)
-- ---------------------------------------------------------------------------
-- { company, recipients: [{ id, email, first_name }] }; recipients empty for
-- a blocked company. first_name = the first word of the profile name.

create or replace function public.billing_mail_recipients(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'company', (select v.name from public.venues v where v.id = p_venue_id),
    'recipients', case when public.billing_mail_blocked(p_venue_id) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.user_id,
               'email', r.email,
               'first_name', nullif(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), '')))
        from public.billing_mail_recipient_rows(p_venue_id) r
    ), '[]'::jsonb) end
  );
$$;

comment on function public.billing_mail_recipients(uuid) is
  'Billing-mail sender (service_role): company name + admin/finance '
  'recipients (id, login address, first name). Empty for a comped or paused '
  'company.';

-- ---------------------------------------------------------------------------
-- 8. log_billing_mail — the one mail_log write path for billing mails
-- ---------------------------------------------------------------------------
-- Returns the new mail_log id (= the Resend Idempotency-Key), or NULL when
-- this recipient already has a queued/sent/delivered mail under this key:
-- the caller then sends nothing. Raises:
--   42501  the recipient is not an admin/finance member of the company with
--          a usable address (the service role cannot be talked into mailing
--          an arbitrary account), or the company is comped/paused
--   22023  unknown type, or a dedupe key that does not belong to the type
--   55000  a trial mail for a company that is not trialing, or a Stripe mail
--          whose event is not queued for this company and type
-- Settled afterwards with the existing record_mail_send_result().

create or replace function public.log_billing_mail(
  p_venue_id uuid,
  p_type text,
  p_dedupe_key text,
  p_recipient_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_status text;
  v_error text;
  v_id uuid;
  v_event_id text;
begin
  if p_type in ('billing_trial_day0', 'billing_trial_day7', 'billing_trial_day12',
                'billing_trial_ended', 'billing_trial_day21') then
    if p_dedupe_key is distinct from p_type then
      raise exception 'a trial mail is keyed by its type' using errcode = '22023';
    end if;
  elsif p_type in ('billing_payment_failed', 'billing_canceled') then
    if p_dedupe_key is null or p_dedupe_key not like 'stripe:%' then
      raise exception 'a stripe mail is keyed by its event' using errcode = '22023';
    end if;
    v_event_id := substr(p_dedupe_key, 8);
  else
    raise exception 'not a billing mail type' using errcode = '22023';
  end if;

  -- Serialise two runs for the same company, key and recipient.
  perform pg_advisory_xact_lock(hashtextextended(
    'billing_mail:' || coalesce(p_venue_id::text, '') || ':' || p_dedupe_key || ':'
      || coalesce(p_recipient_id::text, ''), 0));

  if public.billing_mail_blocked(p_venue_id) then
    raise exception 'billing mail blocked for this company' using errcode = '42501';
  end if;

  select r.email into v_email
    from public.billing_mail_recipient_rows(p_venue_id) r
   where r.user_id = p_recipient_id;
  if v_email is null then
    raise exception 'not a billing recipient of this company' using errcode = '42501';
  end if;

  if v_event_id is null then
    if not exists (select 1 from public.subscriptions s
                    where s.venue_id = p_venue_id and s.status = 'trialing') then
      raise exception 'company is not trialing' using errcode = '55000';
    end if;
  elsif not exists (select 1 from public.billing_mail_events e
                     where e.stripe_event_id = v_event_id
                       and e.venue_id = p_venue_id
                       and e.type = p_type) then
    raise exception 'no queued stripe event for this mail' using errcode = '55000';
  end if;

  -- Only a TRANSIENT failure is retried (quota, rate limit, provider down,
  -- timeout, network). Resend refusing the mail (provider_rejected: a bad
  -- address, say) stays failed, so an hourly job never hammers the shared
  -- Resend account, which also carries the login OTPs.
  select m.status, m.error_code into v_status, v_error
    from public.billing_mail_deliveries d
    join public.mail_log m on m.id = d.mail_log_id
   where d.venue_id = p_venue_id
     and d.dedupe_key = p_dedupe_key
     and d.recipient_id = p_recipient_id;
  if v_status is not null
     and (v_status <> 'failed' or v_error is null or v_error not in (
       'rate_limited', 'daily_quota_exceeded', 'monthly_quota_exceeded',
       'provider_unavailable', 'timeout', 'network')) then
    return null;
  end if;

  insert into public.mail_log (type, venue_id, recipient_hash)
  values (p_type, p_venue_id, encode(extensions.digest(lower(btrim(v_email)), 'sha256'), 'hex'))
  returning id into v_id;

  insert into public.billing_mail_deliveries (venue_id, dedupe_key, recipient_id, type, mail_log_id)
  values (p_venue_id, p_dedupe_key, p_recipient_id, p_type, v_id)
  on conflict (venue_id, dedupe_key, recipient_id)
  do update set mail_log_id = excluded.mail_log_id, created_at = now();

  return v_id;
end;
$$;

comment on function public.log_billing_mail(uuid, text, text, uuid) is
  'Billing-mail sender (service_role): log one queued billing mail and return '
  'its id, or NULL when this recipient already got it under this key (trial '
  'mail: once per company and type; Stripe mail: once per event). Re-checks '
  'recipient role, comped/paused, trialing and the queued event in the DB.';

-- ---------------------------------------------------------------------------
-- 9. Platform tab: timeline + pause (authenticated, is_platform_admin inside)
-- ---------------------------------------------------------------------------
-- { paused, subscription: { status, created_at, trial_ends_at (effective,
--   trialing only), stripe_linked } | null,
--   mails: [{ type, dedupe_key, first_at, recipients, sending, delivered,
--             failed, bounced }] }   -- newest first, at most 50
-- Counts only, never an address or a name.

create or replace function public.platform_billing_mail_timeline(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'paused', coalesce((select bs.paused from public.billing_mail_settings bs
                         where bs.venue_id = p_venue_id), false),
    'subscription', (
      select jsonb_build_object(
               'status', s.status,
               'created_at', s.created_at,
               'trial_ends_at', case when s.status = 'trialing'
                 then coalesce(s.trial_ends_at, s.created_at + interval '14 days') end,
               'stripe_linked', s.stripe_subscription_id is not null)
        from public.subscriptions s
       where s.venue_id = p_venue_id),
    'mails', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.first_at desc, g.dedupe_key)
        from (
          select d.type,
                 d.dedupe_key,
                 min(m.created_at) as first_at,
                 count(*)::int as recipients,
                 count(*) filter (where m.status in ('queued', 'sent', 'delivery_delayed'))::int as sending,
                 count(*) filter (where m.status = 'delivered')::int as delivered,
                 count(*) filter (where m.status = 'failed')::int as failed,
                 count(*) filter (where m.status in ('bounced', 'complained'))::int as bounced
            from public.billing_mail_deliveries d
            join public.mail_log m on m.id = d.mail_log_id
           where d.venue_id = p_venue_id
           group by d.type, d.dedupe_key
           order by min(m.created_at) desc
           limit 50
        ) g
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.platform_billing_mail_timeline(uuid) is
  'Platform tab (is_platform_admin, 42501 otherwise): the billing mails a '
  'company got, grouped per mail (counts per delivery status), whether billing '
  'mail is paused, and the subscription facts the next-mail line needs.';

create or replace function public.set_billing_mails_paused(p_venue_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_venue_id is null or p_paused is null then
    raise exception 'venue and paused are required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'unknown company' using errcode = 'P0002';
  end if;

  insert into public.billing_mail_settings (venue_id, paused, updated_by, updated_at)
  values (p_venue_id, p_paused, auth.uid(), now())
  on conflict (venue_id)
  do update set paused = excluded.paused, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

comment on function public.set_billing_mails_paused(uuid, boolean) is
  'Platform tab (is_platform_admin, 42501 otherwise): pause or resume every '
  'billing mail to one company. Stamps who and when on the settings row.';

-- ---------------------------------------------------------------------------
-- 10. Config, kick, tick (owner-only)
-- ---------------------------------------------------------------------------

create or replace function public.billing_mails_setting(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_name is distinct from 'plusone_billing_mails_url' then
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
create or replace function public.kick_billing_mails()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := public.billing_mails_setting('plusone_billing_mails_url');
  v_token text;
begin
  if v_url is null then
    return false;
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.billing_mail_tokens (token_hash)
  values (extensions.digest(v_token, 'sha256'));
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-billing-mails-token', v_token);
  return true;
exception when others then
  raise warning 'billing mails kick failed: % (%)', sqlerrm, sqlstate;
  return false;
end;
$$;

-- The cron entry point: drop expired tokens, then kick only between 08:00
-- and 20:59 Amsterdam time.
create or replace function public.billing_mails_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.billing_mail_tokens t
  where t.created_at < now() - interval '10 minutes';

  if extract(hour from (now() at time zone 'Europe/Amsterdam')) not between 8 and 20 then
    return false;
  end if;
  return public.kick_billing_mails();
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grant matrix — revoke first, then grant
-- ---------------------------------------------------------------------------

revoke all on table public.billing_mail_settings from anon, authenticated, service_role;
revoke all on table public.billing_mail_events from anon, authenticated, service_role;
revoke all on table public.billing_mail_deliveries from anon, authenticated, service_role;
revoke all on table public.billing_mail_tokens from anon, authenticated, service_role;

revoke execute on function
  public.enqueue_billing_event_mail(text, text, timestamptz),
  public.billing_mails_begin(text),
  public.billing_mail_recipients(uuid),
  public.log_billing_mail(uuid, text, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.enqueue_billing_event_mail(text, text, timestamptz),
  public.billing_mails_begin(text),
  public.billing_mail_recipients(uuid),
  public.log_billing_mail(uuid, text, text, uuid)
to service_role;

revoke execute on function
  public.platform_billing_mail_timeline(uuid),
  public.set_billing_mails_paused(uuid, boolean)
from public, anon, service_role;

grant execute on function
  public.platform_billing_mail_timeline(uuid),
  public.set_billing_mails_paused(uuid, boolean)
to authenticated;

revoke execute on function
  public.billing_mail_blocked(uuid),
  public.billing_mail_recipient_rows(uuid),
  public.billing_mails_setting(text),
  public.kick_billing_mails(),
  public.billing_mails_tick()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. pg_cron
-- ---------------------------------------------------------------------------
-- Guarded like the other schedules, so `supabase db reset` passes where the
-- local image doesn't preload pg_cron.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-billing-mails',
        '5 * * * *',
        'select public.billing_mails_tick();');
      raise notice 'pg_cron: scheduled plusone-billing-mails (hourly, 08-20 Europe/Amsterdam).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.billing_mails_tick() by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.billing_mails_tick() by other means.';
  end if;
end;
$$;
