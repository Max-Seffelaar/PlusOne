-- Platform R (z8uq9m2ybj, decision #49) — per-company detail for the Invites
-- and Venues lists, plus the Platform > Overview numbers.
--
-- What this adds:
--   1. platform_invite_overview() gains one column, `company_ids uuid[]`: the
--      companies the invitee belongs to (same membership definition as the
--      existing venue_count/stage, so the chips and the stage never disagree).
--      Expand-only: the deployed app ignores the extra column. Postgres cannot
--      change a function's result type in place, so it is dropped and
--      re-created inside this migration's transaction with the same grants.
--      Its non-admin behaviour is unchanged (zero rows) — it is not new.
--   2. platform_company_details(uuid[]) — the ONE per-company read both lists
--      render (one view-model, one adapter): subscription status, interval,
--      effective trial end, owner's last sign-in, last check-in, event count,
--      latest event name + start. Names and aggregates only — no guest row,
--      no guest name, no contact detail leaves this function.
--   3. platform_subscription_counts(), platform_trial_funnel(),
--      platform_usage_30d() — single-row aggregates for Overview.
--
-- Security shape (CLAUDE.md #1, #49):
--   * Every NEW function is SECURITY DEFINER (it reads auth.users and every
--     venue), `set search_path = ''`, and raises 42501 for anyone who is not
--     is_platform_admin() BEFORE touching a table — no empty result set, no
--     count of zero, no row-shaped error that would tell a non-admin anything.
--   * EXECUTE: authenticated only (revoked from public, anon, service_role).
--   * The effective trial end is coalesce(trial_ends_at, created_at + 14 days)
--     everywhere — the same rule as effectiveTrialEndsAt() in the app.
--
-- Scale (CLAUDE.md "Scale"): platform_company_details takes at most 200 ids
-- (one UI page); the aggregates are GROUP BY/count in SQL. check_ins gains a
-- (venue_id, checked_at desc) index so "last check-in per company" is an index
-- probe, not a scan of every check-in of the company.

-- ---------------------------------------------------------------------------
-- 0. Index for last-check-in-per-company
-- ---------------------------------------------------------------------------

create index if not exists check_ins_venue_checked_at_idx
  on public.check_ins (venue_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- 1. platform_invite_overview(): + company_ids
-- ---------------------------------------------------------------------------

drop function public.platform_invite_overview(integer, integer);

create function public.platform_invite_overview(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  note text,
  invited_by uuid,
  invited_by_name text,
  created_at timestamptz,
  last_sent_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  user_id uuid,
  confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  venue_count integer,
  event_count integer,
  stage text,
  company_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pi.id, pi.email, pi.note, pi.invited_by,
    p.full_name,
    pi.created_at, pi.last_sent_at, pi.revoked_at, pi.revoked_by,
    s.user_id, s.confirmed_at, s.last_sign_in_at,
    s.venue_count, s.event_count, s.stage,
    coalesce(
      (select array_agg(vm.venue_id order by vm.created_at, vm.venue_id)
         from public.venue_memberships vm
        where vm.user_id = s.user_id),
      '{}'::uuid[])
  from public.platform_invite_stage_rows() s
  join public.platform_invites pi on pi.id = s.invite_id
  left join public.user_profiles p on p.id = pi.invited_by
  order by pi.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.platform_invite_overview(integer, integer) is
  'Windowed per-invite open-beta funnel state for platform admins (default 100 '
  'rows, hard cap 500, newest first), plus company_ids: the companies the '
  'invitee is a member of (detail via platform_company_details). SECURITY '
  'DEFINER because it reads auth.users.confirmed_at; returns zero rows for '
  'anyone who is not a platform admin. Every column sourced from the '
  'auth.users LATERAL or from a nullable invite column is nullable at runtime, '
  'whatever the generated types say.';

revoke execute on function public.platform_invite_overview(integer, integer)
  from public, anon, service_role;
grant execute on function public.platform_invite_overview(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. platform_company_details(uuid[])
-- ---------------------------------------------------------------------------

create or replace function public.platform_company_details(p_venue_ids uuid[])
returns table (
  venue_id uuid,
  name text,
  subscription_status text,
  billing_interval text,
  stripe_linked boolean,
  trial_ends_at timestamptz,
  owner_last_sign_in_at timestamptz,
  last_check_in_at timestamptz,
  event_count integer,
  last_event_name text,
  last_event_starts_at timestamptz
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
  if p_venue_ids is null or cardinality(p_venue_ids) = 0 then
    return;
  end if;
  if cardinality(p_venue_ids) > 200 then
    raise exception 'at most 200 companies per call' using errcode = '22023';
  end if;

  return query
  select
    v.id,
    v.name,
    s.status::text,
    s.billing_interval,
    s.stripe_subscription_id is not null,
    case when s.status = 'trialing'
         then coalesce(s.trial_ends_at, s.created_at + interval '14 days') end,
    own.last_sign_in_at,
    ci.last_check_in_at,
    coalesce(ec.event_count, 0)::int,
    le.name,
    le.starts_at
  from public.venues v
  left join public.subscriptions s on s.venue_id = v.id
  -- The owner: the earliest admin membership of the company.
  left join lateral (
    select au.last_sign_in_at
    from public.venue_memberships vm
    join auth.users au on au.id = vm.user_id
    where vm.venue_id = v.id
      and 'admin' = any (vm.roles)
    order by vm.created_at, vm.id
    limit 1
  ) own on true
  left join lateral (
    select c.checked_at as last_check_in_at
    from public.check_ins c
    where c.venue_id = v.id
      and c.voided_at is null
    order by c.checked_at desc
    limit 1
  ) ci on true
  left join lateral (
    select count(*)::int as event_count
    from public.events e
    where e.venue_id = v.id
  ) ec on true
  left join lateral (
    select e.name, e.starts_at
    from public.events e
    where e.venue_id = v.id
      and e.cancelled_at is null
    order by e.starts_at desc, e.id desc
    limit 1
  ) le on true
  where v.id = any (p_venue_ids)
  order by v.name asc, v.id asc;
end;
$$;

comment on function public.platform_company_details(uuid[]) is
  'Platform admins only (42501 otherwise): per-company billing state, owner '
  'last sign-in, last check-in, event count and latest event for at most 200 '
  'companies (22023 above). Names and aggregates only — never a guest row. '
  'trial_ends_at is the effective end (override or created_at + 14 d) while '
  'trialing, null otherwise.';

revoke execute on function public.platform_company_details(uuid[])
  from public, anon, service_role;
grant execute on function public.platform_company_details(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. platform_subscription_counts()
-- ---------------------------------------------------------------------------
-- One row. Every company lands in exactly one bucket, so the buckets sum to
-- total_companies:
--   trialing        trialing, effective trial end still ahead (or Stripe's clock)
--   trial_lapsed    trialing, no Stripe subscription, effective end passed
--   paid_monthly    active, interval month
--   paid_yearly     active, interval year
--   paid_unknown    active without a recorded interval (pre-Billing G rows)
--   past_due / canceled / comped
--   no_subscription a company without a subscriptions row

create or replace function public.platform_subscription_counts()
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
  no_subscription integer
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
    count(*) filter (where s.venue_id is null)::int
  from public.venues v
  left join public.subscriptions s on s.venue_id = v.id;
end;
$$;

comment on function public.platform_subscription_counts() is
  'Platform admins only (42501 otherwise): one row, companies per billing '
  'bucket (each company in exactly one). MRR is computed by the app from '
  'paid_monthly/paid_yearly × the Stripe prices — never stored here.';

revoke execute on function public.platform_subscription_counts()
  from public, anon, service_role;
grant execute on function public.platform_subscription_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. platform_trial_funnel()
-- ---------------------------------------------------------------------------
--   ending_7d          trialing companies whose effective end falls in the
--                      next 7 days (override included)
--   ended_30d/_90d     non-comped companies whose effective trial end fell in
--                      the last 30/90 days (the cohort)
--   converted_30d/_90d of that cohort, now paying (active or past_due)
--   canceled_30d       companies whose subscription turned canceled in the
--                      last 30 days (from the subscriptions audit trail)

create or replace function public.platform_trial_funnel()
returns table (
  ending_7d integer,
  ended_30d integer,
  converted_30d integer,
  ended_90d integer,
  converted_90d integer,
  canceled_30d integer
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
end;
$$;

comment on function public.platform_trial_funnel() is
  'Platform admins only (42501 otherwise): one row — trials ending in 7 days, '
  'trial-end cohorts of the last 30/90 days with how many now pay, and '
  'cancellations in the last 30 days. Effective trial end = '
  'coalesce(trial_ends_at, created_at + 14 days).';

revoke execute on function public.platform_trial_funnel()
  from public, anon, service_role;
grant execute on function public.platform_trial_funnel() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. platform_usage_30d()
-- ---------------------------------------------------------------------------
-- Event-scoped (#26): an event counts when it STARTED in the last 30 days and
-- was not cancelled; its check-ins count whenever they happened. Dormant = no
-- member signed in for 30 days AND no event that started in the last 30 days
-- or is still ahead.

create or replace function public.platform_usage_30d()
returns table (
  active_companies integer,
  events integer,
  check_ins integer,
  dormant_companies integer
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
end;
$$;

comment on function public.platform_usage_30d() is
  'Platform admins only (42501 otherwise): one row — companies with an event '
  'in the last 30 days, those events, their check-ins, and dormant companies '
  '(no member sign-in and no recent or upcoming event in 30 days).';

revoke execute on function public.platform_usage_30d()
  from public, anon, service_role;
grant execute on function public.platform_usage_30d() to authenticated;
