-- Billing G (ClickUp z8uq9m2vrz, decision #32(d) revised 2026-10-06): a
-- platform admin manages a company's trial from the Platform tab instead of
-- the service-role SQL runbook — "Trial until <date>" and "Always free".
--
-- 1. subscriptions.trial_ends_at timestamptz, nullable. null = the default
--    trial, created_at + 14 days. The effective trial end is everywhere
--    coalesce(trial_ends_at, created_at + 14 days): the server gate
--    (billingBlockReason via gate.ts), the Billing screen (toPoSubscription)
--    and the checkout's Stripe trial_end all read it through the one TS helper
--    effectiveTrialEndsAt() in src/features/billing/plans.ts, so server and UI
--    cannot drift. Readable by members via the existing table-level SELECT
--    grant; no authenticated write path (the two RPCs below are the only one).
--
-- 2. set_venue_trial_end(p_venue_id, p_trial_ends_at) — status becomes
--    'trialing' with that end date (also the way out of 'comped' with a date).
-- 3. set_venue_comped(p_venue_id, p_comped) — true: status 'comped' (never
--    blocks, never overwritten by a webhook); false on a comped company:
--    'trialing' with trial_ends_at = now() + 14 days. false on anything else is
--    a no-op.
--
-- Both RPCs:
--   * SECURITY DEFINER (subscriptions has no authenticated UPDATE path), with
--     `set search_path = ''` and the authority check INSIDE the function:
--     is_platform_admin() or 42501. A venue admin, finance or manager of that
--     very venue gets 42501 too — trial and comped are ours, not the venue's.
--   * Refuse (55000) a subscription that has a Stripe subscription id: a paying
--     or once-paying customer's clock is Stripe's, and comping it would leave
--     Stripe charging a company the app calls free. Nobody on prod has one yet.
--   * Lock the row (FOR UPDATE) so a concurrent webhook or second admin click
--     serialises against it.
--   * Audit through the existing audit_subscriptions trigger (20260706120000,
--     decision #4): the row update lands in audit_log with actor_id =
--     auth.uid(), i.e. the platform admin on name. No app-code audit write.
--   * A company without a subscription row (should not exist; created_at of
--     the venue predates billing) gets one inserted as Pro.
--
-- Grants: new functions start closed (20260917100000 default ACL); revoke from
-- public/anon/service_role first, then grant to authenticated only — the
-- platform-admin check inside is the boundary, as with set_platform_admin().

alter table public.subscriptions
  add column trial_ends_at timestamptz;

comment on column public.subscriptions.trial_ends_at is
  'Platform-admin trial override (set_venue_trial_end). null = created_at + 14 '
  'days. Effective trial end = coalesce(trial_ends_at, created_at + 14 days).';

-- ---------------------------------------------------------------------------
-- set_venue_trial_end()
-- ---------------------------------------------------------------------------

create function public.set_venue_trial_end(
  p_venue_id uuid,
  p_trial_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_venue_id is null or p_trial_ends_at is null then
    raise exception 'venue and trial end are required' using errcode = '22004';
  end if;
  -- A trial end in the past would block the company on the spot. The upper
  -- bound is 730 days, Stripe's maximum for subscription trial_end (a checkout
  -- carries this date over), and fixed in days so a leap year can't stretch
  -- it to 731. "Always free" is set_venue_comped.
  if p_trial_ends_at <= now() or p_trial_ends_at > now() + interval '730 days' then
    raise exception 'trial end out of range' using errcode = '22023';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue not found' using errcode = 'P0002';
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.venue_id = p_venue_id
  for update;

  if not found then
    insert into public.subscriptions (venue_id, status, plan_id, trial_ends_at)
    values (p_venue_id, 'trialing', 'pro', p_trial_ends_at);
    return;
  end if;

  if v_sub.stripe_subscription_id is not null then
    raise exception 'subscription is managed by Stripe' using errcode = '55000';
  end if;

  update public.subscriptions s
  set status = 'trialing',
      trial_ends_at = p_trial_ends_at,
      updated_at = now()
  where s.venue_id = p_venue_id;
end;
$$;

comment on function public.set_venue_trial_end(uuid, timestamptz) is
  'Platform admin only (42501 otherwise): put a company on a trial ending at '
  'p_trial_ends_at (future, max 730 days — Stripe''s trial_end cap). Refuses a Stripe-linked subscription '
  '(55000). Audited by audit_subscriptions under auth.uid().';

revoke execute on function public.set_venue_trial_end(uuid, timestamptz)
  from public, anon, service_role;
grant execute on function public.set_venue_trial_end(uuid, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- set_venue_comped()
-- ---------------------------------------------------------------------------

create function public.set_venue_comped(
  p_venue_id uuid,
  p_comped boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_venue_id is null or p_comped is null then
    raise exception 'venue and comped flag are required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue not found' using errcode = 'P0002';
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.venue_id = p_venue_id
  for update;

  if not found then
    insert into public.subscriptions (venue_id, status, plan_id, trial_ends_at)
    values (
      p_venue_id,
      case when p_comped then 'comped' else 'trialing' end::public.subscription_status,
      'pro',
      case when p_comped then null else now() + interval '14 days' end
    );
    return;
  end if;

  if v_sub.stripe_subscription_id is not null then
    raise exception 'subscription is managed by Stripe' using errcode = '55000';
  end if;

  if p_comped then
    if v_sub.status = 'comped' then
      return; -- idempotent: no write, no audit row
    end if;
    update public.subscriptions s
    set status = 'comped',
        trial_ends_at = null,
        updated_at = now()
    where s.venue_id = p_venue_id;
  elsif v_sub.status = 'comped' then
    -- "Always free" off = a fresh 14-day trial from today (decision 2026-10-06).
    update public.subscriptions s
    set status = 'trialing',
        trial_ends_at = now() + interval '14 days',
        updated_at = now()
    where s.venue_id = p_venue_id;
  end if;
end;
$$;

comment on function public.set_venue_comped(uuid, boolean) is
  'Platform admin only (42501 otherwise): true = always free (comped); false on '
  'a comped company = trialing until now() + 14 days; false otherwise = no-op. '
  'Refuses a Stripe-linked subscription (55000). Audited by audit_subscriptions '
  'under auth.uid().';

revoke execute on function public.set_venue_comped(uuid, boolean)
  from public, anon, service_role;
grant execute on function public.set_venue_comped(uuid, boolean)
  to authenticated;
