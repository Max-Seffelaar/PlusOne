-- Scale: two GROUP BY aggregates replacing client-side downloads (86ey9e9wv,
-- #47/#49 of the scale audit). CLAUDE.md: "Aggregate on the database, not the
-- client" — never "download every row and sum in JS".
--
-- 1. event_tier_occupancy: fetchTiersWithUsage (src/features/po/queries.ts)
--    downloaded every guest row of the event (tier_id, status) and summed
--    per-tier in JS, invalidated on every check-in. The ticket suggested
--    reusing event_tier_stats — re-verified and REJECTED: event_tier_stats'
--    "registered" counts only status in ('approved','checked_in'), but the
--    tier-max occupancy bar must match guest_tier_contribution/
--    tier_consumption (20260613180000_quota_engine.sql), which excludes only
--    ('removed','denied') — pending and refused guests still hold a tier
--    slot there, and the capacity trigger (tier_max_guests check) enforces
--    exactly that. Reusing event_tier_stats would have silently dropped
--    pending/refused from the displayed "used" count while the DB trigger
--    kept blocking adds on their account — a correctness regression, not
--    just a perf fix. This RPC instead mirrors guest_tier_contribution's own
--    exclusion set.
--
-- 2. event_request_link_funnel: fetchRequestLinks read ALL of an event's
--    guest_requests with no `.range()` — a viral event's request volume can
--    exceed PostgREST's 1000-row cap and silently undercount the funnel.
--    Aggregated here instead of windowed-and-summed client-side, since the
--    caller only ever needs the per-link totals.
--
-- Both SECURITY INVOKER (no explicit keyword needed, matches
-- venue_event_headcounts) — RLS on guests/guest_requests already scopes the
-- result to what the caller can read (staff: only their own added guests;
-- guest_requests: admin/finance/organizer only, staff/door see nothing).

create or replace function public.event_tier_occupancy(p_event_id uuid)
returns table (tier_id uuid, used integer)
language sql
stable
set search_path = ''
as $$
  select g.tier_id, count(*)::int as used
  from public.guests g
  where g.event_id = p_event_id
    and g.status not in ('removed', 'denied')
  group by g.tier_id;
$$;

create or replace function public.event_request_link_funnel(p_event_id uuid)
returns table (request_link_id uuid, requests integer, approved integer)
language sql
stable
set search_path = ''
as $$
  select
    gr.request_link_id,
    count(*)::int as requests,
    count(*) filter (where gr.status = 'approved')::int as approved
  from public.guest_requests gr
  where gr.event_id = p_event_id
    and gr.request_link_id is not null
  group by gr.request_link_id;
$$;
