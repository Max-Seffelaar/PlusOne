-- Fase 13 follow-up — event-ordering guard on apply_stripe_subscription_update
-- (ClickUp 86ey9e89j, gap-sweep SW1, decision #32).
--
-- Problem: the RPC applied p_status/p_plan_id/p_current_period_end via plain
-- coalesce(), with no comparison against the Stripe event's own timestamp or
-- the subscription's current state. Stripe redelivers webhooks out of order
-- (retries, at-least-once delivery). Scenario: customer.subscription.deleted
-- sets status='canceled'; a LATE/redelivered invoice.paid for the prior
-- period then arrives and reactivates the venue with status='active',
-- unblocking admin features that should stay gated. The stripe_webhook_events
-- ledger only guards against *duplicate* delivery of the same event id, never
-- against *reordered* delivery of different events.
--
-- Fix: track the Stripe-side created timestamp of the last event actually
-- applied to each subscription (subscriptions.last_stripe_event_at). The
-- caller now passes p_event_created (Stripe event.created, seconds → passed
-- as timestamptz). When an incoming event is OLDER than the last applied
-- event for that subscription, the status/plan_id/current_period_end/
-- stripe_customer_id/stripe_subscription_id fields are left untouched (the
-- event is still recorded in the idempotency ledger — Stripe must not
-- redeliver it again). Backward compatible: p_event_created defaults to
-- null, and the guard only activates once a subscription has a recorded
-- last_stripe_event_at, so a first-ever event (or a caller that omits the
-- timestamp) always applies exactly as before.
--
-- Concurrency (fresh-session /code-review follow-up, ClickUp 86ey9e89j):
-- Stripe delivers at-least-once, so two deliveries for the same subscription
-- can race. The subscription row is locked with FOR UPDATE before staleness
-- is decided, so a second concurrent call blocks until the first commits and
-- then re-reads the now-current last_stripe_event_at — without the lock, both
-- transactions could read the same pre-update baseline under READ COMMITTED
-- and let an older event win, regressing last_stripe_event_at backward.

alter table public.subscriptions
  add column last_stripe_event_at timestamptz;

create or replace function public.apply_stripe_subscription_update(
  p_event_id text,
  p_event_type text,
  p_venue_id uuid default null,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_status public.subscription_status default null,
  p_plan_id text default null,
  p_current_period_end timestamptz default null,
  p_event_created timestamptz default null
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

  insert into public.stripe_webhook_events (id, type, venue_id)
  values (p_event_id, p_event_type, p_venue_id)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false; -- replay: already processed, nothing to do
  end if;

  -- FOR UPDATE: serializes concurrent deliveries for the same subscription so
  -- the staleness check below always compares against a committed baseline,
  -- never a value another in-flight transaction is about to overwrite.
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

  -- Customer-mismatch guard (venue-id path only; the customer-id path matched
  -- BY the stored id, so it can never differ): a venue never silently switches
  -- Stripe customers via webhook payload.
  if p_venue_id is not null
     and v_existing_customer is not null
     and p_stripe_customer_id is not null
     and v_existing_customer <> p_stripe_customer_id then
    raise exception 'venue % already linked to another stripe customer', p_venue_id
      using errcode = '45010';
  end if;

  -- Ordering guard: an event strictly older than the last one APPLIED to this
  -- subscription is stale (out-of-order/late redelivery) and must not move
  -- status/plan/period backwards, even though it is still recorded above.
  v_stale := p_event_created is not null
    and v_last_event_at is not null
    and p_event_created < v_last_event_at;

  -- A stale event is fully inert on this row (identity ids included): after a
  -- cancel + resubscribe, Stripe mints a new subscription object, and a late
  -- event for the OLD object must not repoint stripe_subscription_id back to
  -- a dead subscription just because status/plan/period are what it's gating.
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
    current_period_end = case
      when v_stale then s.current_period_end
      else coalesce(p_current_period_end, s.current_period_end)
    end,
    status = case
      when s.status = 'comped' then s.status -- manual-only, never webhook-driven
      when v_stale then s.status
      else coalesce(p_status, s.status)
    end,
    -- greatest() ignores nulls, so this is a plain high-water mark once
    -- expanded — referencing the locked row's own column, not the pre-update
    -- local variable, keeps it correct even though FOR UPDATE already makes
    -- v_last_event_at safe to use here too.
    last_stripe_event_at = greatest(s.last_stripe_event_at, p_event_created),
    updated_at = now()
  where s.venue_id = v_venue;

  return true;
end;
$$;

-- Grants are attached to the function identity and survive create-or-replace;
-- re-assert them anyway so this migration stands alone. The old 8-arg
-- signature is dropped since create-or-replace above only replaces on an
-- exact signature match (the new p_event_created param makes this a distinct
-- overload) — leaving the stale 8-arg function around would let old cached
-- PostgREST/pg clients keep calling the unguarded path.
drop function if exists public.apply_stripe_subscription_update(
  text, text, uuid, text, text, public.subscription_status, text, timestamptz);

revoke execute on function
  public.apply_stripe_subscription_update(
    text, text, uuid, text, text, public.subscription_status, text, timestamptz, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.apply_stripe_subscription_update(
    text, text, uuid, text, text, public.subscription_status, text, timestamptz, timestamptz)
to service_role;
