-- M4 follow-up (ClickUp 86ey9c5fp) — the request-link "heads used" figures stop
-- re-typing the cap rule and delegate to the function that enforces it.
--
-- The 45006 cap is enforced by `enforce_request_link_max` via
-- `request_link_consumption`, which sums
-- `link_headcount_contribution(g, <has a non-voided check-in>)`
-- (20260706101000_request_link_attribution). Four read paths independently
-- re-implemented that rule as a literal
-- `sum(case when gu.status in ('pending','approved','checked_in') then 1 + gu.plus_ones else 0 end)`,
-- which drops the helper's second branch: a guest who is physically inside (a
-- live check-in) keeps consuming the cap after being removed or refused, but the
-- literal scores them 0. So the Promotion screen's "x / max" bar and the public
-- influencer page could show room the database will refuse to fill — the read
-- and the write disagreeing about the same cap.
--
-- This is the same fix `event_tier_occupancy` already made for the tier cap in
-- 20260810190000 ("delegates to guest_tier_contribution — the exact function
-- tier_consumption already sums — so the exclusion set can never drift from the
-- trigger"). Applying it here removes the last copies of the link rule.
--
-- Rewritten: `event_link_funnel` (Promotion screen, latest definition in
-- 20260810190000), `venue_influencer_leaderboard`, `venue_label_link_funnel`
-- and `get_influencer_stats` (the public /i/[token] page) — all from
-- 20260707100000_promotion_dashboard_rpcs. Bodies are otherwise unchanged; only
-- the approved_heads expression moves to the helper. `create or replace` keeps
-- the existing grants (no signature or return-type change).
--
-- The three SECURITY INVOKER functions run the helper under the caller's own
-- rights, so `authenticated` needs EXECUTE on it — the same explicit grant
-- 20260810190000 added for `guest_tier_contribution`. `get_influencer_stats` is
-- SECURITY DEFINER and does not depend on that grant.

grant execute on function public.link_headcount_contribution(public.guests, boolean) to authenticated;

create or replace function public.event_link_funnel(p_event_id uuid)
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


create or replace function public.venue_influencer_leaderboard(
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
      coalesce((select count(*) from public.guest_requests gr
                where gr.request_link_id = sl.id), 0)::bigint as requests,
      coalesce((select sum(public.link_headcount_contribution(gu, exists (
                                  select 1 from public.check_ins ci
                                  where ci.guest_id = gu.id and ci.voided_at is null)))
                from public.guests gu where gu.request_link_id = sl.id), 0)::bigint as approved_heads,
      coalesce((select sum(1 + ci.plus_ones_arrived)
                from public.guests gu
                join public.check_ins ci on ci.guest_id = gu.id and ci.voided_at is null
                where gu.request_link_id = sl.id), 0)::bigint as checked_in_heads
    from scoped_links sl
  )
  select
    pl.influencer_id,
    i.name,
    i.handle,
    count(*)::bigint as links_count,
    count(distinct pl.event_id)::bigint as events_count,
    sum(pl.views)::bigint,
    sum(pl.requests)::bigint,
    sum(pl.approved_heads)::bigint,
    sum(pl.checked_in_heads)::bigint
  from per_link pl
  left join public.influencers i on i.id = pl.influencer_id
  group by pl.influencer_id, i.name, i.handle
  order by sum(pl.checked_in_heads) desc, sum(pl.approved_heads) desc;
$$;


create or replace function public.venue_label_link_funnel(
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
    coalesce((select count(*) from public.guest_requests gr
              where gr.request_link_id = rl.id), 0)::bigint,
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
  where rl.venue_id = p_venue_id
    and rl.influencer_id is null
    and rl.archived_at is null
    and (p_from is null or e.starts_at >= p_from)
    and (p_to   is null or e.starts_at <  p_to)
  order by 9 desc, 8 desc;
$$;


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
      coalesce(sum((select count(*) from public.guest_requests gr
                    where gr.request_link_id = rl.id)), 0)::bigint as requests,
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
      'approved_heads', pe.approved_heads,
      'checked_in_heads', pe.checked_in_heads
    ) order by pe.starts_at desc), '[]'::jsonb),
    jsonb_build_object(
      'views', coalesce(sum(pe.views), 0),
      'requests', coalesce(sum(pe.requests), 0),
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
