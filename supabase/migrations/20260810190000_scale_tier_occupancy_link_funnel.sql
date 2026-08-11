-- Scale: DB-side aggregation replacing two client-side downloads (ClickUp
-- 86ey9e9wv). CLAUDE.md: "Aggregate on the database, not the client" — never
-- "download every row and sum in JS". Fresh-session
-- /code-review on the first version of this migration found two design gaps,
-- both resolved by delegating to code that already carries the authoritative
-- rule instead of re-typing it here:
--
-- 1. event_tier_occupancy (fetchTiersWithUsage): re-verified and REJECTED
--    reusing event_tier_stats — its "registered" is status in
--    ('approved','checked_in') only (20260713140000_headcount_canonical_rules.sql),
--    which would have silently dropped pending/refused guests from the
--    displayed "used" count while the tier-max capacity trigger
--    (enforce_guest_quota, 20260613180000_quota_engine.sql) kept blocking
--    adds on their account. The first version of this function re-typed the
--    trigger's exclusion rule as a literal (`status not in ('removed',
--    'denied')`); that duplicate copy could silently drift from the trigger
--    if a 7th guest_status value is ever added. Now delegates to
--    guest_tier_contribution(g) — the exact function tier_consumption (the
--    trigger's own occupancy count) already sums — so the two can never
--    disagree. guest_tier_contribution was execute-revoked from authenticated
--    (quota_engine.sql:382-386, "internal math stays internal"); this RPC is
--    the first authenticated-facing caller, so it needs an explicit grant.
--    NOTE: this RPC is SECURITY INVOKER and therefore RLS-scoped (guests_select:
--    staff see only their own added guests) — tier_consumption itself is
--    SECURITY DEFINER and counts every row venue-wide. The exclusion SET
--    matches exactly; the VISIBILITY scope deliberately does not (same as the
--    per-guest reads this replaces) — a staff member's occupancy bar reflects
--    only what they can see, same behaviour as before this migration.
--
-- 2. fetchRequestLinks' funnel counting read ALL of an event's guest_requests
--    with no `.range()` (silently undercounts past PostgREST's 1000-row cap)
--    and separately hand-rolled approvedHeads/checkedInHeads in JS with two
--    bugs: counted denied/refused guests as full headcount (the actual cap
--    this bar represents, link_headcount_contribution in
--    20260706101000_request_link_attribution.sql, does not), and used
--    registered plus_ones instead of plus_ones_arrived for checkedInHeads
--    (the exact overcount spec #44 already fixed elsewhere, 20260713140000).
--    Rather than add a THIRD place computing "heads through this link" with
--    its own scoping, this widens the existing event_link_funnel RPC
--    (20260707100000_promotion_dashboard_rpcs.sql) — already used by the
--    Promotion screen and already correct on both counts — with the three
--    columns (approved, tier_id, created_at) fetchRequestLinks needs, and
--    fetchRequestLinks now calls it directly instead of four batched reads.
--    Widening a `returns table` needs drop+recreate (Postgres rejects
--    `create or replace` across a return-type change), so grants are
--    re-declared explicitly below — `create or replace` would have kept them,
--    a bare `create` after `drop` does not.

drop function if exists public.event_link_funnel(uuid);

create function public.event_link_funnel(p_event_id uuid)
returns table (
  link_id           uuid,
  slug              text,
  is_default        boolean,
  label             text,
  tier_id           uuid,
  influencer_id     uuid,
  influencer_name   text,
  active            boolean,
  auto_approve      boolean,
  max_headcount     integer,
  expires_at        timestamptz,
  created_at        timestamptz,
  views             bigint,
  requests          bigint,
  approved          bigint,
  approved_heads    bigint,
  checked_in_heads  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    rl.id,
    rl.slug,
    rl.is_default,
    rl.label,
    rl.tier_id,
    rl.influencer_id,
    i.name,
    rl.active,
    rl.auto_approve,
    rl.max_headcount,
    rl.expires_at,
    rl.created_at,
    coalesce(pv.views, 0),
    coalesce(rq.requests, 0),
    coalesce(rq.approved, 0),
    coalesce(g.approved_heads, 0),
    coalesce(g.checked_in_heads, 0)
  from public.request_links rl
  left join public.influencers i on i.id = rl.influencer_id
  left join lateral (
    select sum(p.views)::bigint as views
    from public.request_link_pageviews_daily p
    where p.request_link_id = rl.id
  ) pv on true
  left join lateral (
    select
      count(*)::bigint as requests,
      count(*) filter (where gr.status = 'approved')::bigint as approved
    from public.guest_requests gr
    where gr.request_link_id = rl.id
  ) rq on true
  left join lateral (
    select
      sum(case when gu.status in ('pending', 'approved', 'checked_in')
               then 1 + gu.plus_ones else 0 end)::bigint as approved_heads,
      sum(case when ci.id is not null then 1 + ci.plus_ones_arrived else 0 end)::bigint as checked_in_heads
    from public.guests gu
    left join public.check_ins ci on ci.guest_id = gu.id and ci.voided_at is null
    where gu.request_link_id = rl.id
  ) g on true
  where rl.event_id = p_event_id
    and rl.archived_at is null
  order by rl.is_default desc, rl.created_at;
$$;

revoke execute on function public.event_link_funnel(uuid) from public, anon, authenticated, service_role;
grant execute on function public.event_link_funnel(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------

create or replace function public.event_tier_occupancy(p_event_id uuid)
returns table (tier_id uuid, used integer)
language sql
stable
set search_path = ''
as $$
  select g.tier_id, sum(public.guest_tier_contribution(g))::int as used
  from public.guests g
  where g.event_id = p_event_id
  group by g.tier_id
  having sum(public.guest_tier_contribution(g)) > 0;
$$;

grant execute on function public.guest_tier_contribution(public.guests) to authenticated;

revoke execute on function public.event_tier_occupancy(uuid) from public, anon;
grant execute on function public.event_tier_occupancy(uuid) to authenticated, service_role;
