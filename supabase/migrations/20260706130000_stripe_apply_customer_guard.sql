-- Fase 13 PR 3 — security-review follow-up on 20260706120000 (decision #32).
--
-- apply_stripe_subscription_update() matched checkout.session.completed by
-- venue id (client_reference_id) and OVERWROTE the stored stripe_customer_id.
-- With server-created checkout sessions that is harmless, but if a Stripe
-- Payment Link ever existed, an outsider could append
-- ?client_reference_id=<victim-venue-uuid>, complete a checkout with their own
-- customer and hijack the victim venue's billing linkage. Guard: on the
-- venue-id match path a DIFFERENT already-linked customer raises 45010 (same
-- contract as stamp_stripe_customer) — the transaction rolls back including
-- the ledger insert, so a legitimate retry stays possible and the forged event
-- keeps erroring. Everything else is unchanged from 20260706120000.

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
  v_existing_customer text;
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

  select s.venue_id, s.stripe_customer_id
    into v_venue, v_existing_customer
  from public.subscriptions s
  where (p_venue_id is not null and s.venue_id = p_venue_id)
     or (p_venue_id is null and s.stripe_customer_id = p_stripe_customer_id);
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

-- Grants are attached to the function identity and survive create-or-replace;
-- re-assert them anyway so this migration stands alone.
revoke execute on function
  public.apply_stripe_subscription_update(text, text, uuid, text, text, public.subscription_status, text, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.apply_stripe_subscription_update(text, text, uuid, text, text, public.subscription_status, text, timestamptz)
to service_role;
