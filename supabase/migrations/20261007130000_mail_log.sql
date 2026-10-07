-- Mail-infra F0 (z8uq9m2yvt, onboarding programme task 0e).
--
-- App-sent mail (team invites today; billing mails in 2c and guest mail in
-- task 6 later) goes out through Resend's API from the server. This migration
-- adds the two tables that make that auditable without storing mail content:
--
--   * mail_log — one row per send attempt: type, venue, a sha256 of the
--     recipient address, status, Resend's message id. NO subject, body, name
--     or plaintext address. The row id doubles as Resend's Idempotency-Key, so
--     a retried send of the same row never mails twice.
--   * resend_webhook_events — idempotency ledger for POST /api/webhooks/resend
--     (one row per Svix message id), the Stripe-ledger pattern from
--     20260706120000_stripe_billing.sql.
--
-- Who touches what (grant matrix in section 4):
--   * Writes: nobody directly. Three SECURITY DEFINER RPCs, executable by
--     service_role only, are the whole write path: log_mail_attempt (sender,
--     before the provider call), record_mail_send_result (sender, after it),
--     apply_resend_webhook_event (webhook route, after the Svix signature).
--   * Reads: platform admins only (RLS). Deliberately NOT venue admins: no
--     screen reads this yet, a delivery status per invitee is support data,
--     and the minimum is the safe default; task 2c adds its own read path
--     (platform billing-mail timeline) when it needs one.
--
-- Retention: rows go with the venue (on delete cascade), like
-- platform_access_log. The recipient hash is not reversible on its own, but it
-- is an unsalted sha256 of the lowercased address so support can answer "did
-- the mail to X arrive" with X in hand; readers are platform admins, who can
-- read user_profiles.email anyway.

-- ---------------------------------------------------------------------------
-- 0. Send limits (review of PR #413: the existing-account path used to ride on
--    GoTrue's per-address throttle; app mail must carry its own)
-- ---------------------------------------------------------------------------
-- The Resend account is SHARED with Supabase Auth SMTP: on the Free plan that
-- is 100 mails per UTC day for app mail AND every login OTP together. One
-- venue looping invite/resend must never drain it and take every venue's
-- login down with it. log_mail_attempt enforces, before it logs anything:
--   * one mail per recipient per MAIL_RECIPIENT_WINDOW (60 s, GoTrue's own
--     per-address spacing for OTP mail);
--   * at most MAIL_VENUE_DAILY_CAP (50) app mails per venue per UTC day,
--     i.e. at most half the Free daily quota for any single venue.
-- Raise the cap together with the Resend plan. A refusal raises SQLSTATE
-- 'PM429'; the sender treats it as a failed send (an initial invite still
-- succeeds, a resend shows its usual error).

create or replace function public.mail_venue_daily_cap()
returns integer language sql immutable set search_path = '' as $$ select 50 $$;

create or replace function public.mail_recipient_window()
returns interval language sql immutable set search_path = '' as $$ select interval '60 seconds' $$;

revoke execute on function public.mail_venue_daily_cap(), public.mail_recipient_window()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.mail_log (
  id uuid primary key default public.uuid_generate_v7(),
  -- Named constraint so a later migration (2c, task 6) can widen the set.
  type text not null
    constraint mail_log_type_check
    check (type in ('team_join', 'team_added_to_event', 'team_resend')),
  venue_id uuid references public.venues (id) on delete cascade,
  recipient_hash text not null
    constraint mail_log_recipient_hash_check check (recipient_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued'
    constraint mail_log_status_check check (status in (
      'queued', 'sent', 'failed',
      'delivery_delayed', 'delivered', 'bounced', 'complained'
    )),
  provider_message_id text unique
    constraint mail_log_provider_message_id_check
    check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  -- Short machine code on failure ('rate_limited', 'timeout', …). Never a
  -- provider message (those can echo the address back).
  error_code text
    constraint mail_log_error_code_check
    check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mail_log is
  'One row per app-sent mail (Resend API): type, venue, sha256 of the '
  'recipient, status. No content, subject or names. Platform admins read; '
  'service_role RPCs write (20261007130000).';

create index mail_log_venue_created_idx on public.mail_log (venue_id, created_at desc);
create index mail_log_created_idx on public.mail_log (created_at desc);
-- The per-recipient throttle in log_mail_attempt (the per-venue cap uses
-- mail_log_venue_created_idx above).
create index mail_log_recipient_created_idx on public.mail_log (recipient_hash, created_at desc);

alter table public.mail_log enable row level security;

create table public.resend_webhook_events (
  id text primary key
    constraint resend_webhook_events_id_check check (char_length(id) between 1 and 200),
  type text not null
    constraint resend_webhook_events_type_check check (char_length(type) between 1 and 100),
  provider_message_id text,
  processed_at timestamptz not null default now()
);

comment on table public.resend_webhook_events is
  'Idempotency ledger for the Resend webhook: one row per Svix message id. '
  'Only apply_resend_webhook_event writes it (20261007130000).';

alter table public.resend_webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS — platform admins read mail_log; the ledger has no policies at all
-- ---------------------------------------------------------------------------

create policy mail_log_select_platform_admin on public.mail_log
  for select to authenticated
  using (public.is_platform_admin());

-- No INSERT / UPDATE / DELETE policy on mail_log, and none on the ledger.

-- ---------------------------------------------------------------------------
-- 3. Write path — SECURITY DEFINER, service_role only
-- ---------------------------------------------------------------------------

-- Sender, before the provider call. Returns the row id the sender passes to
-- Resend as Idempotency-Key.
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

  if exists (
    select 1 from public.mail_log m
     where m.recipient_hash = p_recipient_hash
       and m.created_at > now() - public.mail_recipient_window()
  ) then
    raise exception 'mail throttled: recipient' using errcode = 'PM429';
  end if;

  if p_venue_id is not null and (
    select count(*) from public.mail_log m
     where m.venue_id = p_venue_id
       and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
  ) >= public.mail_venue_daily_cap() then
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
  'recipient within mail_recipient_window() and a venue past '
  'mail_venue_daily_cap() for the UTC day. Check constraints validate the input.';

-- Sender, after the provider call. Only moves a row out of 'queued', so a
-- second settle of the same row is a no-op. Accepted gap: a webhook can only
-- match a row once this call stamped provider_message_id, so a delivery event
-- that beats the API response (seconds, in practice never) leaves the row at
-- 'sent'.
create or replace function public.record_mail_send_result(
  p_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'send result must be sent or failed' using errcode = '22023';
  end if;

  update public.mail_log
     set status = p_status,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         error_code = case when p_status = 'failed' then p_error_code else null end,
         updated_at = now()
   where id = p_id
     and status = 'queued';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.record_mail_send_result(uuid, text, text, text) is
  'Mail sender (service_role): settle a queued mail_log row as sent/failed. '
  'No-op (false) once the row left queued.';

-- Webhook route, after the Svix signature verified. Returns false on replay
-- (ledger already holds the Svix id): nothing mutates. Status only moves
-- FORWARD along sent < delivery_delayed < delivered < bounced < complained, so
-- an out-of-order or late delivery_delayed never masks a bounce. An event for
-- a message id we never logged (auth mail via SMTP shares the Resend account)
-- is recorded in the ledger and otherwise ignored.
create or replace function public.apply_resend_webhook_event(
  p_event_id text,
  p_event_type text,
  p_provider_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_status text;
begin
  if p_event_id is null or p_event_type is null then
    raise exception 'event id and type are required' using errcode = '22004';
  end if;

  insert into public.resend_webhook_events (id, type, provider_message_id)
  values (p_event_id, p_event_type, p_provider_message_id)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  v_status := case p_event_type
    when 'email.delivery_delayed' then 'delivery_delayed'
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    else null
  end;

  if v_status is not null and p_provider_message_id is not null then
    update public.mail_log m
       set status = v_status,
           updated_at = now()
     where m.provider_message_id = p_provider_message_id
       and array_position(
             array['queued', 'sent', 'delivery_delayed', 'delivered', 'bounced', 'complained'],
             v_status)
         > coalesce(array_position(
             array['queued', 'sent', 'delivery_delayed', 'delivered', 'bounced', 'complained'],
             m.status), 0);
  end if;

  return true;
end;
$$;

comment on function public.apply_resend_webhook_event(text, text, text) is
  'Resend webhook (service_role): ledger the Svix id, then move mail_log '
  'status forward. Replay returns false and mutates nothing.';

-- ---------------------------------------------------------------------------
-- 4. Grant matrix — explicit, revoke first (never `on all tables in schema`)
-- ---------------------------------------------------------------------------

-- Tables: service_role too loses its defaults here — the definer RPCs above are
-- the only write path (same stance as stripe_webhook_events).
revoke all on table public.mail_log from anon, authenticated, service_role;
grant select on table public.mail_log to authenticated;

revoke all on table public.resend_webhook_events from anon, authenticated, service_role;

revoke execute on function
  public.log_mail_attempt(text, uuid, text),
  public.record_mail_send_result(uuid, text, text, text),
  public.apply_resend_webhook_event(text, text, text)
from public, anon, authenticated;

grant execute on function
  public.log_mail_attempt(text, uuid, text),
  public.record_mail_send_result(uuid, text, text, text),
  public.apply_resend_webhook_event(text, text, text)
to service_role;
