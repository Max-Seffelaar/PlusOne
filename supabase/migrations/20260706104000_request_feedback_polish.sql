-- Requests-epic F1 · test-feedback polish (Max, 6 jul 2026, PR #114 round 1).
--
-- 1. audit_feed resolves the REQUESTER's name. A guest_requests approve/deny
--    audit diff carries only the changed fields (status/decided_*), so the log
--    line fell back to "… request from a request". Mirror the guest_name
--    pattern: rel_request_id → join guest_requests → request_name. SECURITY
--    INVOKER, so the join reads under the caller's RLS (same admin/finance/
--    organizer audience as the rest of the feed), and an anonymized request
--    resolves to its redacted handle ("Aanvraag #N") — no PII resurfacing.
--
-- 2. get_landing_event exposes SPOTS_LEFT for a capped link. Max's decision
--    (feedback vraag 10, deliberately narrows #28-no-enumeration for CAPPED
--    links): the public form must not let a group request more heads than the
--    link can ever approve — cap the stepper and say "full" instead of taking
--    requests that can only ever stall. NULL = uncapped (nothing disclosed).
--    The submit RPC keeps its own guards (a race past the page still falls
--    back to pending).

-- ---------------------------------------------------------------------------
-- 1. audit_feed + request_name
-- ---------------------------------------------------------------------------

create or replace view public.audit_feed
with (security_invoker = on)
as
with base as (
  select
    a.id, a.actor_id, a.venue_id, a.event_id, a.entity_type, a.entity_id,
    a.action, a.diff, a.device_id, a.created_at,
    case
      when a.entity_type = 'guests' then a.entity_id
      when a.entity_type in ('check_ins', 'refusals')
        then coalesce(a.diff -> 'after' ->> 'guest_id', a.diff -> 'before' ->> 'guest_id')::uuid
    end as rel_guest_id,
    case
      when a.entity_type in ('quotas', 'event_quotas', 'quota_requests', 'venue_memberships')
        then coalesce(a.diff -> 'after' ->> 'user_id', a.diff -> 'before' ->> 'user_id')::uuid
    end as rel_user_id,
    case
      when a.entity_type = 'guest_requests' then a.entity_id
    end as rel_request_id,
    (a.diff -> 'before' ->> 'tier_id')::uuid as old_tier_id,
    (a.diff -> 'after' ->> 'tier_id')::uuid as new_tier_id
  from public.audit_log a
)
select
  b.id, b.actor_id, b.venue_id, b.event_id, b.entity_type, b.entity_id,
  b.action, b.diff, b.device_id, b.created_at,
  b.rel_guest_id as guest_id,
  b.rel_user_id as subject_user_id,
  actor.full_name as actor_name,
  g.full_name as guest_name,
  subj.full_name as subject_name,
  ot.name as old_tier_name,
  nt.name as new_tier_name,
  ev.name as event_name,
  gr.full_name as request_name
from base b
left join public.user_profiles actor on actor.id = b.actor_id
left join public.guests g on g.id = b.rel_guest_id
left join public.user_profiles subj on subj.id = b.rel_user_id
left join public.guest_tiers ot on ot.id = b.old_tier_id
left join public.guest_tiers nt on nt.id = b.new_tier_id
left join public.events ev on ev.id = b.event_id
left join public.guest_requests gr on gr.id = b.rel_request_id;

-- ---------------------------------------------------------------------------
-- 2. get_landing_event + spots_left (return-type change → drop + recreate)
-- ---------------------------------------------------------------------------

drop function if exists public.get_landing_event(text);

create function public.get_landing_event(p_slug text)
returns table (
  event_name text,
  starts_at  timestamptz,
  via_label  text,
  -- Remaining approvable headcount on a CAPPED link (0 = full); NULL when the
  -- link has no max — then nothing about capacity is disclosed (#28/#43).
  spots_left integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.name,
    e.starts_at,
    case when rl.is_default then null
         else coalesce(i.name, rl.label) end,
    case when rl.max_headcount is null then null
         else greatest(rl.max_headcount - public.request_link_consumption(rl.id), 0) end
  from public.request_links rl
  join public.events e on e.id = rl.event_id
  left join public.influencers i on i.id = rl.influencer_id
  where rl.slug = p_slug
    and public.request_link_open(rl);
$$;

revoke execute on function public.get_landing_event(text)
from public, anon, authenticated, service_role;
grant execute on function public.get_landing_event(text)
to anon, authenticated, service_role;
