-- Requests-epic F2 · part 1 — Promotion dashboard reads + influencer stats page
-- (ClickUp 86ey6b3fe; builds on the F1 schema 20260706100000–104000).
--
-- Three read surfaces, one funnel vocabulary (views → requests → approved →
-- through the door):
--   * event_link_funnel(event)            — per request link of one event, for
--     the internal Promotion screen. SECURITY INVOKER: RLS is the boundary
--     (admin/finance venue-wide, organizer own event; staff/door resolve zero
--     rows because request_links is invisible to them).
--   * venue_influencer_leaderboard(venue) — per influencer across the venue's
--     events (label-only links grouped under influencer_id NULL), optional
--     starts_at window. SECURITY INVOKER, same boundary.
--   * get_influencer_stats(token, ip)     — the PUBLIC secret stats page
--     (/i/[token]): SECURITY DEFINER keyed on influencers.stats_token_hash,
--     throttled ('if:' prefix), AGGREGATES ONLY — influencer display name +
--     per-event numbers; no guest names, no contact data, no other
--     influencers, no venue internals (#28/#43 discipline).
--
-- Counting rules (shared): views = pageview day-buckets summed; requests =
-- guest_requests rows attributed to the link; approved heads = Σ(1+plus_ones)
-- over attributed guests still on the list (status pending/approved/checked_in);
-- through-the-door heads = Σ(1+plus_ones_arrived) over non-voided check-ins of
-- attributed guests.

-- ---------------------------------------------------------------------------
-- 1. Internal: per-link funnel for one event
-- ---------------------------------------------------------------------------

create function public.event_link_funnel(p_event_id uuid)
returns table (
  link_id           uuid,
  slug              text,
  is_default        boolean,
  label             text,
  influencer_id     uuid,
  influencer_name   text,
  active            boolean,
  auto_approve      boolean,
  max_headcount     integer,
  expires_at        timestamptz,
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
    rl.slug,
    rl.is_default,
    rl.label,
    rl.influencer_id,
    i.name,
    rl.active,
    rl.auto_approve,
    rl.max_headcount,
    rl.expires_at,
    coalesce(pv.views, 0),
    coalesce(rq.requests, 0),
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
    select count(*)::bigint as requests
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

-- ---------------------------------------------------------------------------
-- 2. Internal: venue-wide influencer leaderboard
-- ---------------------------------------------------------------------------
-- One row per influencer with ≥1 link on an event in the window, plus a single
-- influencer_id-NULL row bundling the label-only links ("Zonder influencer").
-- The window filters on the EVENT's starts_at (an influencer's old wins fall
-- out when the range narrows). Ordered by through-the-door heads — the honest
-- metric (decision: leaderboard ranks "binnen").

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
      coalesce((select sum(case when gu.status in ('pending', 'approved', 'checked_in')
                                then 1 + gu.plus_ones else 0 end)
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

-- ---------------------------------------------------------------------------
-- 3. Public: the influencer's secret stats page (/i/[token])
-- ---------------------------------------------------------------------------
-- Bearer-token read, same discipline as get_request_status: throttle FIRST
-- (token probing burns budget), unknown/revoked/archived tokens return the
-- identical {found:false}, and the payload is aggregate-only.

create function public.get_influencer_stats(p_token_hash text, p_ip_hash text)
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

  -- Per event (their links only), newest first. Aggregates by construction.
  with per_event as (
    select
      e.id,
      e.name,
      e.starts_at,
      coalesce(sum((select sum(p.views) from public.request_link_pageviews_daily p
                    where p.request_link_id = rl.id)), 0)::bigint as views,
      coalesce(sum((select count(*) from public.guest_requests gr
                    where gr.request_link_id = rl.id)), 0)::bigint as requests,
      coalesce(sum((select sum(case when gu.status in ('pending', 'approved', 'checked_in')
                                    then 1 + gu.plus_ones else 0 end)
                    from public.guests gu where gu.request_link_id = rl.id)), 0)::bigint as approved_heads,
      coalesce(sum((select sum(1 + ci.plus_ones_arrived)
                    from public.guests gu
                    join public.check_ins ci on ci.guest_id = gu.id and ci.voided_at is null
                    where gu.request_link_id = rl.id)), 0)::bigint as checked_in_heads
    from public.request_links rl
    join public.events e on e.id = rl.event_id
    where rl.influencer_id = v_inf.id
      and rl.archived_at is null
    group by e.id, e.name, e.starts_at
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'event_name', pe.name,
      'starts_at', pe.starts_at,
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

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
-- The two INVOKER dashboards lean on RLS; the DEFINER stats page is anon-safe
-- by construction (throttle + hash + aggregates only).

revoke execute on function
  public.event_link_funnel(uuid),
  public.venue_influencer_leaderboard(uuid, timestamptz, timestamptz),
  public.get_influencer_stats(text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.event_link_funnel(uuid),
  public.venue_influencer_leaderboard(uuid, timestamptz, timestamptz)
to authenticated, service_role;

grant execute on function public.get_influencer_stats(text, text)
to anon, authenticated, service_role;
