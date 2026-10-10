-- Platform R follow-up (z8uq9m2ybj, decision #49) — Overview tile "Trial,
-- payment set up": platform_subscription_counts() splits its trialing bucket
-- into trials without and with a payment set up.
--
-- What changes:
--   platform_subscription_counts() gains one column, `trialing_payment_set_up`:
--   trialing companies that have a Stripe subscription
--   (stripe_subscription_id is not null), i.e. a payment method was set up in
--   Checkout during the trial. It is a SUBSET of `trialing`, never a separate
--   bucket: every company with a Stripe subscription in status trialing is
--   already in `trialing` (Stripe's clock decides when it ends), so
--   trialing_payment_set_up <= trialing always holds. Trials without a payment
--   = trialing - trialing_payment_set_up (computed by the app adapter).
--
-- Expand-only (CLAUDE.md expand–contract): every existing column keeps its
-- name, type, position and meaning — the deployed app reads `trialing` and
-- the other buckets exactly as before and ignores the extra column. Postgres
-- cannot change a function's result type in place (OUT parameters), so the
-- function is dropped and re-created inside this migration's transaction:
-- there is no moment in which a caller sees it missing. Body otherwise
-- identical to 20261012130000; grants identical (EXECUTE for authenticated
-- only, revoked from public, anon, service_role).
--
-- Security shape unchanged (CLAUDE.md #1, #49): SECURITY DEFINER,
-- `set search_path = ''`, raises 42501 for anyone who is not
-- is_platform_admin() BEFORE touching a table. Aggregates only.

drop function public.platform_subscription_counts();

create function public.platform_subscription_counts()
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
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
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
end;
$$;

comment on function public.platform_subscription_counts() is
  'Platform admins only (42501 otherwise): one row, companies per billing '
  'bucket (each company in exactly one of the first ten columns). '
  'trialing_payment_set_up is a subset of trialing (trialing with a Stripe '
  'subscription), not an extra bucket. MRR is computed by the app from '
  'paid_monthly/paid_yearly × the Stripe prices — never stored here.';

revoke execute on function public.platform_subscription_counts()
  from public, anon, service_role;
grant execute on function public.platform_subscription_counts() to authenticated;
