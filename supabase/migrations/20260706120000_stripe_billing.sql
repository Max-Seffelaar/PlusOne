-- Fase 13 — Stripe Billing (decision #32, ClickUp 86exxup46).
--
-- Scope of this migration (app code ships separately, prod-inert until the
-- Stripe env vars are set):
--   * stripe_webhook_events — idempotency ledger, one row per processed Stripe
--     event. No app-role access at all: the SECURITY DEFINER RPC below is the
--     only writer, and nothing in the app reads it (ops/debugging goes through
--     the table owner). RLS enabled with zero policies as a second belt.
--   * audit trigger on subscriptions (decision #4): status changes coming from
--     the webhook or from a manual comped-flip land in audit_log. The generic
--     audit_trigger() resolves venue scope from the row's venue_id and
--     audit_log.actor_id is nullable, so service-role/manual writes (auth.uid()
--     is null there) log with actor null = "us/system".
--   * apply_stripe_subscription_update() — the single atomic write path for
--     the webhook handler: records the event id and applies the subscription
--     update in one transaction. Replay of an already-processed event returns
--     false and mutates nothing.
--   * stamp_stripe_customer() — persists the Stripe customer id the moment the
--     checkout session is created (before any webhook arrives), so a later
--     webhook can match by customer id even if checkout metadata is lost.
--
-- Service-role exception (CLAUDE.md §Billing): both RPCs are executable by
-- service_role ONLY and are called exclusively from src/features/billing/
-- server code (webhook route + checkout action). subscriptions keeps having no
-- authenticated write path.

-- ---------------------------------------------------------------------------
-- Idempotency ledger
-- ---------------------------------------------------------------------------

create table public.stripe_webhook_events (
  id text primary key,                                   -- Stripe event id (evt_...)
  type text not null,
  venue_id uuid references public.venues (id) on delete restrict,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

-- Explicit grant matrix (repo convention): nobody but the owner touches this
-- table; the definer RPC is the only write path.
revoke all on table public.stripe_webhook_events from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit trigger on subscriptions (decision #4/#32 — comped flips are logged)
-- ---------------------------------------------------------------------------

create trigger audit_subscriptions
  after insert or update on public.subscriptions
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- apply_stripe_subscription_update(): atomic webhook apply
-- ---------------------------------------------------------------------------
-- Matches by venue_id when the event carries it (checkout metadata /
-- client_reference_id), else by stripe_customer_id. Null update params mean
-- "leave as is". A comped subscription is never overwritten by billing state
-- (comped is manual-only, decision #32). Returns false when the event id was
-- already processed (webhook replay) — the caller treats that as success.
-- An unmatched event raises, rolling back the ledger insert too, so Stripe
-- retries later (e.g. webhook raced ahead of stamp_stripe_customer).

create or replace function public.apply_stripe_subscription_update(
  p_event_id text,
  p_event_type text,
  p_venue_id uuid default null,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_status public.subscription_status default null,
  p_plan_id text default null,
  p_current_period_end timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_venue uuid;
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

  select s.venue_id into v_venue
  from public.subscriptions s
  where (p_venue_id is not null and s.venue_id = p_venue_id)
     or (p_venue_id is null and s.stripe_customer_id = p_stripe_customer_id);
  if v_venue is null then
    raise exception 'no subscription matches stripe event %', p_event_id
      using errcode = 'P0002';
  end if;

  update public.subscriptions s set
    stripe_customer_id     = coalesce(p_stripe_customer_id, s.stripe_customer_id),
    stripe_subscription_id = coalesce(p_stripe_subscription_id, s.stripe_subscription_id),
    plan_id                = coalesce(p_plan_id, s.plan_id),
    current_period_end     = coalesce(p_current_period_end, s.current_period_end),
    status = case
      when s.status = 'comped' then s.status -- manual-only, never webhook-driven
      else coalesce(p_status, s.status)
    end,
    updated_at = now()
  where s.venue_id = v_venue;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- stamp_stripe_customer(): persist the customer id at checkout-session time
-- ---------------------------------------------------------------------------
-- Idempotent: stamping the same id again is a no-op. A DIFFERENT existing id
-- raises — a venue must never silently switch Stripe customers.

create or replace function public.stamp_stripe_customer(
  p_venue_id uuid,
  p_stripe_customer_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if p_venue_id is null or p_stripe_customer_id is null then
    raise exception 'venue id and customer id are required' using errcode = '22004';
  end if;

  select s.stripe_customer_id into v_existing
  from public.subscriptions s
  where s.venue_id = p_venue_id;
  if not found then
    raise exception 'no subscription for venue %', p_venue_id using errcode = 'P0002';
  end if;
  if v_existing is not null and v_existing <> p_stripe_customer_id then
    raise exception 'venue % already linked to another stripe customer', p_venue_id
      using errcode = '45010';
  end if;

  update public.subscriptions s
  set stripe_customer_id = p_stripe_customer_id,
      updated_at = now()
  where s.venue_id = p_venue_id
    and s.stripe_customer_id is distinct from p_stripe_customer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (webhook route + checkout action)
-- ---------------------------------------------------------------------------

revoke execute on function
  public.apply_stripe_subscription_update(text, text, uuid, text, text, public.subscription_status, text, timestamptz),
  public.stamp_stripe_customer(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.apply_stripe_subscription_update(text, text, uuid, text, text, public.subscription_status, text, timestamptz),
  public.stamp_stripe_customer(uuid, text)
to service_role;
