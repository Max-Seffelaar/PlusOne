-- Billing G (ClickUp z8uq9m2vrz, decision #32 revised 2026-10-06): monthly or
-- yearly Pro. The interval the customer picked at checkout is Stripe state, so
-- like every other Stripe field it flows in through the webhook only.
--
-- 1. subscriptions.billing_interval text, nullable, check in ('month','year').
--    null = not known yet (trial without checkout, comped, legacy rows).
--    Readable by members through the existing table-level SELECT grant
--    (subscriptions_select_member); there is still no authenticated write path.
-- 2. apply_stripe_subscription_update() gains p_billing_interval (default null
--    = leave untouched). Everything else is 20260714130000 verbatim: the
--    idempotency ledger, the customer-mismatch guard, the ordering guard (a
--    stale event moves nothing, the interval included) and the comped guard —
--    a webhook never overwrites status 'comped'.
--
--    Expand–contract: the deployed webhook calls this RPC by NAME with nine
--    arguments. The old 9-arg overload is dropped and the new 10-arg one has a
--    default for the extra parameter, so that call keeps resolving — to this
--    function — and there is exactly one overload, never an ambiguous pair.

alter table public.subscriptions
  add column billing_interval text
    constraint subscriptions_billing_interval_check
      check (billing_interval in ('month', 'year'));

comment on column public.subscriptions.billing_interval is
  'Stripe billing interval of the Pro subscription (month|year); null until a '
  'checkout/webhook reports it. Written only by apply_stripe_subscription_update.';

drop function if exists public.apply_stripe_subscription_update(
  text, text, uuid, text, text, public.subscription_status, text, timestamptz, timestamptz);

create function public.apply_stripe_subscription_update(
  p_event_id text,
  p_event_type text,
  p_venue_id uuid default null,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_status public.subscription_status default null,
  p_plan_id text default null,
  p_current_period_end timestamptz default null,
  p_event_created timestamptz default null,
  p_billing_interval text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_venue uuid;
  v_existing_customer text;
  v_last_event_at timestamptz;
  v_stale boolean;
begin
  if p_event_id is null or p_event_type is null then
    raise exception 'event id and type are required' using errcode = '22004';
  end if;
  if p_venue_id is null and p_stripe_customer_id is null then
    raise exception 'event % carries neither venue nor customer', p_event_id
      using errcode = '22004';
  end if;
  -- Validated before the ledger insert: an unknown interval is a mapping bug
  -- in our code, not a Stripe state, and must not burn the event id.
  if p_billing_interval is not null and p_billing_interval not in ('month', 'year') then
    raise exception 'unknown billing interval' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events (id, type, venue_id)
  values (p_event_id, p_event_type, p_venue_id)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false; -- replay: already processed, nothing to do
  end if;

  -- FOR UPDATE: serializes concurrent deliveries for the same subscription so
  -- the staleness check below always compares against a committed baseline.
  select s.venue_id, s.stripe_customer_id, s.last_stripe_event_at
    into v_venue, v_existing_customer, v_last_event_at
  from public.subscriptions s
  where (p_venue_id is not null and s.venue_id = p_venue_id)
     or (p_venue_id is null and s.stripe_customer_id = p_stripe_customer_id)
  for update of s;
  if v_venue is null then
    raise exception 'no subscription matches stripe event %', p_event_id
      using errcode = 'P0002';
  end if;

  -- Customer-mismatch guard (venue-id path only): a venue never silently
  -- switches Stripe customers via webhook payload.
  if p_venue_id is not null
     and v_existing_customer is not null
     and p_stripe_customer_id is not null
     and v_existing_customer <> p_stripe_customer_id then
    raise exception 'venue % already linked to another stripe customer', p_venue_id
      using errcode = '45010';
  end if;

  -- Ordering guard: an event strictly older than the last one APPLIED to this
  -- subscription is stale and moves nothing (identity ids included).
  v_stale := p_event_created is not null
    and v_last_event_at is not null
    and p_event_created < v_last_event_at;

  update public.subscriptions s set
    stripe_customer_id = case
      when v_stale then s.stripe_customer_id
      else coalesce(p_stripe_customer_id, s.stripe_customer_id)
    end,
    stripe_subscription_id = case
      when v_stale then s.stripe_subscription_id
      else coalesce(p_stripe_subscription_id, s.stripe_subscription_id)
    end,
    plan_id = case when v_stale then s.plan_id else coalesce(p_plan_id, s.plan_id) end,
    billing_interval = case
      when v_stale then s.billing_interval
      else coalesce(p_billing_interval, s.billing_interval)
    end,
    current_period_end = case
      when v_stale then s.current_period_end
      else coalesce(p_current_period_end, s.current_period_end)
    end,
    status = case
      when s.status = 'comped' then s.status -- platform-admin only, never webhook-driven
      when v_stale then s.status
      else coalesce(p_status, s.status)
    end,
    last_stripe_event_at = greatest(s.last_stripe_event_at, p_event_created),
    updated_at = now()
  where s.venue_id = v_venue;

  return true;
end;
$$;

revoke execute on function
  public.apply_stripe_subscription_update(
    text, text, uuid, text, text, public.subscription_status, text, timestamptz, timestamptz, text)
from public, anon, authenticated;

grant execute on function
  public.apply_stripe_subscription_update(
    text, text, uuid, text, text, public.subscription_status, text, timestamptz, timestamptz, text)
to service_role;
