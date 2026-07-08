-- P2 audit/quota/stats integrity (full-app review 2026-07-07, ClickUp 86ey6xdjp).
--
-- C6: event_user_additions (20260707120000_event_member_stats.sql) dropped the
--     `where c.voided_at is null` filter its own predecessor
--     (20260617020000_check_in_void.sql) carried in the earliest-check-in CTE.
--     A voided check-in (soft void, #3) therefore counted as "present" in the
--     per-member "Added by" breakdown, disagreeing with event_stats_summary
--     (which does exclude voided rows) for the exact same event. Restore the
--     filter — no signature change, so create-or-replace is enough.
--
-- C7: changing events.default_member_quota writes NO audit row. The only two
--     events audit triggers (audit_events_lock, audit_events_allow_uncheck —
--     20260613150000 / 20260622000000) are WHEN-gated to their own column, so a
--     default_member_quota UPDATE never fires either one; audit_trigger() itself
--     is never invoked for that column, gated or not. The comment in
--     20260707140000_event_default_member_quota.sql claiming "the generic events
--     audit trigger already diffs every column, so changes are audited with no
--     extra work" is simply wrong (fraud-resistance requires everything audited,
--     CLAUDE.md). Fix: add a third WHEN-gated trigger, mirroring
--     audit_events_allow_uncheck exactly (same audit_trigger() body already
--     labels any non-lock/unlock events UPDATE as a plain 'update' carrying the
--     JSONB diff — no function change needed). Also correct the misleading
--     column comment (comment-only, not an edit of the applied migration file).

-- ---------------------------------------------------------------------------
-- C6 — restore the voided-check-in exclusion in event_user_additions
-- ---------------------------------------------------------------------------

create or replace function public.event_user_additions(p_event_id uuid)
returns table (
  user_id uuid,
  full_name text,
  added integer,
  added_headcount integer,
  removed_headcount integer,
  present integer,
  present_headcount integer,
  added_free_headcount integer,
  present_free_headcount integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_event_stats(p_event_id) then return; end if;

  return query
  with reg as (
    select g.id, g.added_by, g.plus_ones, g.status,
           coalesce(gt.door_price_cents, 0) = 0 as is_free
    from public.guests g
    left join public.guest_tiers gt on gt.id = g.tier_id
    where g.event_id = p_event_id
      and g.added_by is not null
      -- gross list membership: everything that reached the list, removed included.
      and g.status in ('approved', 'checked_in', 'refused', 'removed')
  ),
  ci as (
    -- earliest NON-VOIDED check-in per guest → the heads that actually arrived
    -- (C6 fix: a soft-voided check-in, #3, must not count as present — matches
    -- event_stats_summary's `where c.voided_at is null`).
    select distinct on (c.guest_id) c.guest_id, c.plus_ones_arrived
    from public.check_ins c
    join reg on reg.id = c.guest_id
    where c.voided_at is null
    order by c.guest_id, c.checked_at
  )
  select
    reg.added_by,
    p.full_name,
    count(*)::int,
    coalesce(sum(1 + reg.plus_ones), 0)::int,
    coalesce(sum(1 + reg.plus_ones) filter (where reg.status = 'removed'), 0)::int,
    count(ci.guest_id)::int,
    coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null), 0)::int,
    coalesce(sum(1 + reg.plus_ones) filter (where reg.is_free), 0)::int,
    coalesce(sum(1 + ci.plus_ones_arrived) filter (where ci.guest_id is not null and reg.is_free), 0)::int
  from reg
  join public.user_profiles p on p.id = reg.added_by
  left join ci on ci.guest_id = reg.id
  group by reg.added_by, p.full_name
  order by coalesce(sum(1 + reg.plus_ones), 0)::int desc, p.full_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- C7 — audit events.default_member_quota changes
-- ---------------------------------------------------------------------------

create trigger audit_events_default_member_quota
  after update on public.events
  for each row
  when (old.default_member_quota is distinct from new.default_member_quota)
  execute function public.audit_trigger();

comment on column public.events.default_member_quota is
  'Per-event default guest quota for a newly added crew member (seeds event_quotas.quota_override in the add-crew flow). Seeded from venues.default_personal_quota at event creation, then editable per event (T10, 86ey4j1p5). Audited via the dedicated audit_events_default_member_quota trigger (C7, 20260708100000) — the generic events audit trigger is WHEN-gated per column and does NOT diff every column by default.';
