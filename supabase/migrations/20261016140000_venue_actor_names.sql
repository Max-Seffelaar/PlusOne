-- One label, one rule for who-did-what (spec #61(a), decision Max 2026-10-11).
--
-- Every company-facing surface that names an actor (audit feed, data export,
-- door "checked in by", guest list "added by", quota-request requester, recap)
-- resolved names under RLS through user_profiles / can_view_profile. That hides
-- two kinds of people:
--   * former members and former crew — their membership is gone, so
--     can_view_profile is false and the audit trail said "System" or nothing,
--     while the fraud-resistance promise is that it keeps saying who did what
--     after someone leaves (#24: removing a membership never removes the user);
--   * PlusOne platform admins doing support in a company they are no member of.
--
-- The rule now, on every surface:
--   1. a current OR former member/crew is named (full_name, nothing else);
--   2. a platform admin who acted without a real membership/crew tie to the
--      company is "PlusOne support" — never named;
--   3. no actor (NULL id: a DB/system action) is "System".
-- Rule 3 is the app's (it never calls this for a null). Rules 1 and 2 need the
-- owner's view of user_profiles, hence this one narrow SECURITY DEFINER read.
--
-- venue_actor_names(p_venue_id, p_ids) -> (user_id, display_name, is_support)
--
-- Gate (zero rows otherwise, like the stats RPCs):
--   * a member of the venue (is_venue_member, which includes a platform admin)
--     gets the venue-wide footprint;
--   * crew (event_organizers on one of the venue's events, no membership) gets
--     the footprint of THEIR events only, plus current members of the venue
--     (can_view_profile already shows crew those). Crew sees the door and the
--     guest list of their own events, nothing else of the company.
--
-- Footprint rule (anti-enumeration): a row comes back only for an id that has a
-- footprint in THAT venue, so the function is never a global name directory and
-- an arbitrary uuid returns nothing:
--   * a current membership of the venue;
--   * a crew tie: event_organizers on one of its events (crew: their events);
--   * an audited action there: audit_log.actor_id with that venue_id. Every
--     write that shows an actor (guests, check_ins incl. voids, refusals,
--     guest_requests and quota_requests decisions, memberships, quotas) is
--     audited by trigger with actor = auth.uid() (rule #4), so this covers
--     checked_by / voided_by / refused_by / decided_by without scanning those
--     tables (crew: actions on their events);
--   * a past membership or quota there: the subject of a venue_memberships /
--     quotas / event_quotas audit row (members only — not crew);
--   * guests.added_by on one of its events (crew: their events) — also covers
--     rows written without a session (seed, owner-run SQL), where the audit
--     actor is null.
--
-- is_support = the id is a platform admin (user_profiles.is_platform_admin)
-- with no current membership at the venue and no crew tie to its events; then
-- display_name is null. It is venue-relative, not caller-relative. Never any
-- column besides full_name (no e-mail, phone, flags).
--
-- p_ids is capped at 500 (22023 above it); callers chunk to <= 120 anyway.
--
-- Two partial indexes keep the footprint lookups index-only per id, so a
-- request full of random or foreign ids costs index probes, not venue scans.
-- audit_log is append-only and still small (pilots); a plain CREATE INDEX holds
-- its write lock for milliseconds at this size.

create index if not exists audit_log_actor_venue_idx
  on public.audit_log (actor_id, venue_id, event_id)
  where actor_id is not null;

create index if not exists audit_log_member_subject_idx
  on public.audit_log (venue_id, (coalesce(diff -> 'after' ->> 'user_id', diff -> 'before' ->> 'user_id')))
  where entity_type in ('venue_memberships', 'quotas', 'event_quotas');

create or replace function public.venue_actor_names(p_venue_id uuid, p_ids uuid[])
returns table (user_id uuid, display_name text, is_support boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_full boolean;
  v_events uuid[];
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'venue_actor_names: at most 500 ids per call' using errcode = '22023';
  end if;

  -- Member (or platform admin): the whole venue. Crew only: their own events.
  v_full := public.is_venue_member(p_venue_id);
  if not v_full then
    select coalesce(array_agg(eo.event_id), '{}'::uuid[])
      into v_events
      from public.event_organizers eo
      join public.events e on e.id = eo.event_id
     where eo.user_id = (select auth.uid())
       and e.venue_id = p_venue_id;
    if cardinality(v_events) = 0 then
      return; -- not authorised: no rows, nothing learned
    end if;
  end if;

  return query
  with ids as (
    select distinct x.id
      from unnest(p_ids) as x(id)
     where x.id is not null
  )
  select
    p.id,
    case when s.support then null else p.full_name end,
    s.support
  from ids
  join public.user_profiles p on p.id = ids.id
  cross join lateral (
    select p.is_platform_admin
       and not exists (
         select 1 from public.venue_memberships m
          where m.venue_id = p_venue_id and m.user_id = p.id)
       and not exists (
         select 1 from public.event_organizers eo
           join public.events e on e.id = eo.event_id
          where eo.user_id = p.id and e.venue_id = p_venue_id) as support
  ) s
  where
    -- current member (every authorised caller may already see these)
    exists (
      select 1 from public.venue_memberships m
       where m.venue_id = p_venue_id and m.user_id = p.id)
    -- crew tie
    or exists (
      select 1 from public.event_organizers eo
        join public.events e on e.id = eo.event_id
       where eo.user_id = p.id
         and e.venue_id = p_venue_id
         and (v_full or eo.event_id = any (v_events)))
    -- an audited action in the venue
    or exists (
      select 1 from public.audit_log a
       where a.actor_id = p.id
         and a.venue_id = p_venue_id
         and (v_full or a.event_id = any (v_events)))
    -- a past membership / quota in the venue (members only)
    or (v_full and exists (
      select 1 from public.audit_log a
       where a.venue_id = p_venue_id
         and a.entity_type in ('venue_memberships', 'quotas', 'event_quotas')
         and coalesce(a.diff -> 'after' ->> 'user_id', a.diff -> 'before' ->> 'user_id') = p.id::text))
    -- added a guest to one of its events
    or exists (
      select 1 from public.events e
        join public.guests g on g.event_id = e.id and g.added_by = p.id
       where e.venue_id = p_venue_id
         and (v_full or e.id = any (v_events)));
end;
$$;

comment on function public.venue_actor_names(uuid, uuid[]) is
  'Who-did-what labels for one venue (spec #61a): full_name for current and '
  'former members/crew, is_support (null name) for a platform admin without a '
  'membership/crew tie there. Only ids with a footprint in that venue come back; '
  'members see the venue, crew their own events, anyone else nothing. Max 500 ids.';

-- Grant matrix: authenticated only. Every caller (door snapshot, guest lists,
-- audit feed, export) uses the user-scoped client; service_role needs nothing.
revoke execute on function public.venue_actor_names(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.venue_actor_names(uuid, uuid[]) to authenticated;
