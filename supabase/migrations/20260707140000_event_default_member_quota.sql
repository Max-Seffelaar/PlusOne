-- Per-event default member quota (Feedback 1/7 — T10, 86ey4j1p5).
--
-- Until now the "default guest quota per member" lived ONLY at venue level
-- (venues.default_personal_quota) and was used everywhere as the seed for a new
-- crew member's per-event quota override. The product model (1/7 review, V10) is
-- two levels instead of one:
--
--   * venue-level default  -> the SEED for new events (unchanged column, renamed
--                             in the UI to "default for new events");
--   * per-event override    -> events.default_member_quota (NEW here), filled from
--                             the venue default when the event is created, then
--                             editable per event. The Crew add-flow prefills from
--                             THIS value, so two events can carry different
--                             defaults and changing one never touches the other.
--
-- No new RLS: default_member_quota lives on events, so the existing row policies
-- apply — reads follow events_select (venue members), writes follow
-- events_update_admin_organizer (admin OR event organizer), matching "quota =
-- admin/organizer". The generic events audit trigger already diffs every column,
-- so changes are audited with no extra work.

-- 1) Column, nullable for the backfill, with a non-negative CHECK. smallint is
--    ample for a per-person guest allowance.
alter table public.events
  add column default_member_quota smallint
  check (default_member_quota is null or default_member_quota >= 0);

-- 2) Backfill every existing event from its venue's current default (Max: seed
--    existing events from the venue default). A venue with no default -> 0.
update public.events e
set default_member_quota = coalesce(v.default_personal_quota, 0)
from public.venues v
where v.id = e.venue_id
  and e.default_member_quota is null;

-- Any event whose venue somehow has no row (impossible via FK, but keep the
-- NOT NULL set below safe) falls back to 0.
update public.events
set default_member_quota = 0
where default_member_quota is null;

-- 3) BEFORE INSERT trigger: when the app doesn't supply a value (the normal
--    path — createEvent and create_event_from_template both omit it), seed from
--    the event's venue default. Mirrors the slug trigger's "fill when absent"
--    shape. Not SECURITY DEFINER: the inserting admin can already read their own
--    venue (RLS), and the definer RPC / seed run as an elevated role anyway.
create or replace function public.events_set_default_member_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.default_member_quota is null then
    new.default_member_quota := coalesce(
      (select v.default_personal_quota from public.venues v where v.id = new.venue_id),
      0
    );
  end if;
  return new;
end;
$$;

create trigger events_set_default_member_quota
  before insert on public.events
  for each row
  execute function public.events_set_default_member_quota();

-- 4) Now that every row has a value and inserts self-seed, enforce NOT NULL.
alter table public.events
  alter column default_member_quota set not null;

comment on column public.events.default_member_quota is
  'Per-event default guest quota for a newly added crew member (seeds event_quotas.quota_override in the add-crew flow). Seeded from venues.default_personal_quota at event creation, then editable per event (T10, 86ey4j1p5).';
