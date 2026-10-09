-- Promotion funnel: one unit after "views" — people (1 + plus-ones).
--
-- Bug: the Promotion overview read "31 requests → 46 approved (148% approved)".
-- Every funnel RPC returned `requests` as count(*) of guest_requests ROWS but
-- `approved_heads` / `checked_in_heads` as HEADCOUNTS (1 + plus_ones per guest,
-- link_headcount_contribution), and the UI divided one by the other. Any request
-- with a plus-one pushed "approved" past "requests".
--
-- Fix: every step after views counts people. This adds `requested_heads` =
-- Σ(1 + guest_requests.plus_ones) over every request attributed to the link
-- (any status — pending, approved, denied, …: what was ASKED for). Approval can
-- only keep or reduce a request's plus-ones (approve_guest_request /
-- approved_plus_ones, 20260919090000), so for normal data
--   requested_heads ≥ approved_heads ≥ checked_in_heads
-- and every step-to-step percentage stays ≤ 100%.
--
-- Expand–contract: `requests` (row count) stays — the deployed app still reads
-- it, and the new app keeps using it for the views → requested rate (request
-- submissions per landing view) and as the Requested floor while this column is
-- absent. The new column is additive; an older client simply ignores it.
--
-- Each per-link guest_requests aggregate (count + Σ heads) is computed in ONE
-- pass (a LATERAL subquery), not two correlated scans per link — the
-- venue-wide leaderboard runs over every link a venue ever made.
--
-- Rewritten (bodies otherwise identical to 20260811162000):
--   * event_link_funnel, venue_influencer_leaderboard, venue_label_link_funnel
--     — SECURITY INVOKER, `returns table` gains a column, which Postgres refuses
--     under `create or replace`, so drop + create and re-declare the grant
--     matrix from 20260707100000 / 20260810190000 explicitly (a bare `create`
--     after `drop` keeps none).
--   * get_influencer_stats (public /i/[token], SECURITY DEFINER) — returns
--     jsonb, so `create or replace` keeps its grants; only adds the
--     `requested_heads` key per event and in the totals. Throttle, token-hash
--     lookup and aggregate-only payload are unchanged.

-- ---------------------------------------------------------------------------
-- 1. event_link_funnel
-- ---------------------------------------------------------------------------

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
  requested_heads   bigint,
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
    coalesce(rq.requested_heads, 0),
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
      sum(1 + gr.plus_ones)::bigint as requested_heads,
      count(*) filter (where gr.status = 'approved')::bigint as approved
    from public.guest_requests gr
    where gr.request_link_id = rl.id
  ) rq on true
  left join lateral (
    select
      -- Delegate to the function the 45006 trigger itself sums via
      -- request_link_consumption, so this bar cannot re-type the cap rule.
      sum(public.link_headcount_contribution(gu, ci.id is not null))::bigint as approved_heads,
      sum(case when ci.id is not null then 1 + ci.plus_ones_arrived else 0 end)::bigint as checked_in_heads
    from public.guests gu
    left join public.check_ins ci on ci.guest_id = gu.id and ci.voided_at is null
    where gu.request_link_id = rl.id
  ) g on true
  where rl.event_id = p_event_id
    and rl.archived_at is null
  order by rl.is_default desc, rl.created_at;
$$;

-- ---------------------------------------------------------------------------
-- 2. venue_influencer_leaderboard
-- ---------------------------------------------------------------------------

drop function if exists public.venue_influencer_leaderboard(uuid, timestamptz, timestamptz);

create function public.venue_influencer_leaderboard(
  p_venue_id uuid,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  influencer_id     uuid,
  influencer_name   text,
  handle            text,
  links_count       bigint,
  events_count      bigint,
  views             bigint,
  requests          bigint,
  requested_heads   bigint,
  approved_heads    bigint,
  checked_in_heads  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped_links as (
    select rl.id, rl.influencer_id, rl.event_id
    from public.request_links rl
    join public.events e on e.id = rl.event_id
    where rl.venue_id = p_venue_id
      and rl.archived_at is null
      and (p_from is null or e.starts_at >= p_from)
      and (p_to   is null or e.starts_at <  p_to)
  ),
  per_link as (
    select
      sl.id,
      sl.influencer_id,
      sl.event_id,
      coalesce((select sum(p.views) from public.request_link_pageviews_daily p
                where p.request_link_id = sl.id), 0)::bigint as views,
      rq.requests,
      rq.requested_heads,
      coalesce((select sum(public.link_headcount_contribution(gu, exists (
                                  select 1 from public.check_ins ci
                                  where ci.guest_id = gu.id and ci.voided_at is null)))
                from public.guests gu where gu.request_link_id = sl.id), 0)::bigint as approved_heads,
      coalesce((select sum(1 + ci.plus_ones_arrived)
                from public.guests gu
                join public.check_ins ci on ci.guest_id = gu.id and ci.voided_at is null
                where gu.request_link_id = sl.id), 0)::bigint as checked_in_heads
    from scoped_links sl
    cross join lateral (
      select count(*)::bigint as requests,
             coalesce(sum(1 + gr.plus_ones), 0)::bigint as requested_heads
      from public.guest_requests gr
      where gr.request_link_id = sl.id
    ) rq
  )
  select
    pl.influencer_id,
    i.name,
    i.handle,
    count(*)::bigint as links_count,
    count(distinct pl.event_id)::bigint as events_count,
    sum(pl.views)::bigint,
    sum(pl.requests)::bigint,
    sum(pl.requested_heads)::bigint,
    sum(pl.approved_heads)::bigint,
    sum(pl.checked_in_heads)::bigint
  from per_link pl
  left join public.influencers i on i.id = pl.influencer_id
  group by pl.influencer_id, i.name, i.handle
  order by sum(pl.checked_in_heads) desc, sum(pl.approved_heads) desc;
$$;

-- ---------------------------------------------------------------------------
-- 3. venue_label_link_funnel
-- ---------------------------------------------------------------------------

drop function if exists public.venue_label_link_funnel(uuid, timestamptz, timestamptz);

create function public.venue_label_link_funnel(
  p_venue_id uuid,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  link_id           uuid,
  label             text,
  is_default        boolean,
  event_id          uuid,
  event_name        text,
  views             bigint,
  requests          bigint,
  requested_heads   bigint,
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
    rl.label,
    rl.is_default,
    e.id,
    e.name,
    coalesce((select sum(p.views) from public.request_link_pageviews_daily p
              where p.request_link_id = rl.id), 0)::bigint,
    rq.requests,
    rq.requested_heads,
    coalesce((select sum(public.link_headcount_contribution(gu, exists (
                                  select 1 from public.check_ins ci
                                  where ci.guest_id = gu.id and ci.voided_at is null)))
              from public.guests gu where gu.request_link_id = rl.id), 0)::bigint,
    coalesce((select sum(1 + ci.plus_ones_arrived)
              from public.guests gu
              join public.check_ins ci on ci.guest_id = gu.id and ci.voided_at is null
              where gu.request_link_id = rl.id), 0)::bigint
  from public.request_links rl
  join public.events e on e.id = rl.event_id
  cross join lateral (
    select count(*)::bigint as requests,
           coalesce(sum(1 + gr.plus_ones), 0)::bigint as requested_heads
    from public.guest_requests gr
    where gr.request_link_id = rl.id
  ) rq
  where rl.venue_id = p_venue_id
    and rl.influencer_id is null
    and rl.archived_at is null
    and (p_from is null or e.starts_at >= p_from)
    and (p_to   is null or e.starts_at <  p_to)
  -- checked_in_heads desc, approved_heads desc (positions shifted by one with
  -- requested_heads at 8).
  order by 10 desc, 9 desc;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_influencer_stats (public /i/[token]) — adds requested_heads only
-- ---------------------------------------------------------------------------

create or replace function public.get_influencer_stats(p_token_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inf    public.influencers;
  v_venue  text;
  v_events jsonb;
  v_totals jsonb;
begin
  if p_token_hash is null
     or not public.consume_public_throttle('if:' || p_ip_hash, 15, 30) then
    return jsonb_build_object('found', false);
  end if;

  select i.* into v_inf
  from public.influencers i
  where i.stats_token_hash = p_token_hash
    and i.archived_at is null;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select v.name into v_venue from public.venues v where v.id = v_inf.venue_id;

  -- Per event (their links only), newest first. Aggregates by construction —
  -- plus THEIR most recent link slug so the page can offer copy/QR of their own
  -- share URL (S16 design; the slug is the token-holder's own link, safe).
  with per_event as (
    select
      e.id,
      e.name,
      e.starts_at,
      e.ends_at,
      (select rl2.slug from public.request_links rl2
        where rl2.influencer_id = v_inf.id and rl2.event_id = e.id
          and rl2.archived_at is null
        order by rl2.created_at desc limit 1) as slug,
      coalesce(sum((select sum(p.views) from public.request_link_pageviews_daily p
                    where p.request_link_id = rl.id)), 0)::bigint as views,
      coalesce(sum(rq.requests), 0)::bigint as requests,
      coalesce(sum(rq.requested_heads), 0)::bigint as requested_heads,
      coalesce(sum((select sum(public.link_headcount_contribution(gu, exists (
                                  select 1 from public.check_ins ci
                                  where ci.guest_id = gu.id and ci.voided_at is null)))
                    from public.guests gu where gu.request_link_id = rl.id)), 0)::bigint as approved_heads,
      coalesce(sum((select sum(1 + ci.plus_ones_arrived)
                    from public.guests gu
                    join public.check_ins ci on ci.guest_id = gu.id and ci.voided_at is null
                    where gu.request_link_id = rl.id)), 0)::bigint as checked_in_heads
    from public.request_links rl
    join public.events e on e.id = rl.event_id
    -- One row per link (an aggregate without GROUP BY), so the join never
    -- multiplies the per-event sums.
    cross join lateral (
      select count(*)::bigint as requests,
             coalesce(sum(1 + gr.plus_ones), 0)::bigint as requested_heads
      from public.guest_requests gr
      where gr.request_link_id = rl.id
    ) rq
    where rl.influencer_id = v_inf.id
      and rl.archived_at is null
    group by e.id, e.name, e.starts_at, e.ends_at
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'event_name', pe.name,
      'starts_at', pe.starts_at,
      'ends_at', pe.ends_at,
      'slug', pe.slug,
      'views', pe.views,
      'requests', pe.requests,
      'requested_heads', pe.requested_heads,
      'approved_heads', pe.approved_heads,
      'checked_in_heads', pe.checked_in_heads
    ) order by pe.starts_at desc), '[]'::jsonb),
    jsonb_build_object(
      'views', coalesce(sum(pe.views), 0),
      'requests', coalesce(sum(pe.requests), 0),
      'requested_heads', coalesce(sum(pe.requested_heads), 0),
      'approved_heads', coalesce(sum(pe.approved_heads), 0),
      'checked_in_heads', coalesce(sum(pe.checked_in_heads), 0)
    )
  into v_events, v_totals
  from per_event pe;

  return jsonb_build_object(
    'found', true,
    'name', v_inf.name,
    'handle', v_inf.handle,
    'venue_name', v_venue,
    'totals', v_totals,
    'events', v_events
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges — re-declare the matrix the drop wiped (20260707100000).
-- ---------------------------------------------------------------------------
-- The INVOKER dashboards lean on RLS (admin/finance venue-wide, organizer own
-- event; staff/door resolve zero rows). get_influencer_stats keeps its grants
-- through `create or replace`.

revoke execute on function
  public.event_link_funnel(uuid),
  public.venue_influencer_leaderboard(uuid, timestamptz, timestamptz),
  public.venue_label_link_funnel(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  public.event_link_funnel(uuid),
  public.venue_influencer_leaderboard(uuid, timestamptz, timestamptz),
  public.venue_label_link_funnel(uuid, timestamptz, timestamptz)
to authenticated, service_role;
