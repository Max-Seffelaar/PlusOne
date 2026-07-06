-- Requests-epic F1 · part 1/4 — Influencers + per-event request links
-- (ClickUp 86ey21vjt; extends fase 8 / decisions #12/#28/#31).
--
-- Until now an event had exactly ONE public request link (events.landing_slug +
-- the landing_active master switch). This migration introduces:
--
--   * influencers    — a venue-scoped promotion relation ("deze gast kwam via X"):
--                      a name, optionally linked to a user account, or fully
--                      external. NOT guest PII: influencers are a business
--                      relation like venue_memberships and fall OUTSIDE the
--                      run_privacy_retention() job (GDPR erasure on request =
--                      archive + manual scrub, same stance as team members).
--   * request_links  — N public links per event. Each link may pin a tier, cap
--                      approved headcount (max_headcount, enforced in part 2/4),
--                      auto-approve (part 4/4), pause (active) or expire
--                      (expires_at). The event's legacy landing_slug becomes the
--                      event's DEFAULT link (is_default), created by trigger and
--                      backfilled below — existing /e/{slug} URLs keep working
--                      unchanged, and events.landing_active stays the event-level
--                      master switch on top of the per-link switches.
--   * request_link_pageviews_daily — cookie-less daily view counters per link
--                      (funnel step 1). No IP/UA/PII → nothing to anonymize;
--                      "views" = page loads, not unique visitors. Written only by
--                      the record_link_pageview() RPC (part 4/4).
--
-- Fraud/audit posture (#4/#15): link config changes (auto_approve, max, pause,
-- archive) are fraud-relevant → request_links and influencers get audit triggers.
-- Pageview counters are high-volume, actor-less statistics → not audited.

-- ---------------------------------------------------------------------------
-- 1. influencers
-- ---------------------------------------------------------------------------

create table public.influencers (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  -- Optional display handle ("@jayden.010"); free text, not verified.
  handle text check (handle is null or char_length(btrim(handle)) between 1 and 80),
  -- Optional link to an account (venue member / external crew). SET NULL: the
  -- influencer record and its attribution history outlive the account (#24).
  user_id uuid references public.user_profiles (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 1000),
  -- sha256 of the secret stats-URL token (F2). The token itself never touches
  -- the DB (same philosophy as the salted ip_hash). NULL = no active stats link.
  stats_token_hash text,
  created_by uuid not null references public.user_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz -- soft delete only (#21)
);

comment on table public.influencers is
  'Venue-scoped promotors/influencers for request-link attribution (ClickUp 86ey21vjt). Business relation, NOT event-anchored guest PII: outside run_privacy_retention(); erasure on request = archive + manual scrub.';
comment on column public.influencers.stats_token_hash is
  'sha256 of the secret /i/[token] stats-URL token (F2). Token generated app-side, shown once; rotate = overwrite, revoke = null.';

create unique index influencers_stats_token_idx
  on public.influencers (stats_token_hash) where stats_token_hash is not null;
create index influencers_venue_idx
  on public.influencers (venue_id) where archived_at is null;

create trigger set_updated_at before update on public.influencers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Helper — organizer of ANY event of the venue (mirrors is_event_organizer)
-- ---------------------------------------------------------------------------
-- Needed so an event organizer can pick an influencer when creating a link on
-- their event, without being a venue member. SECURITY DEFINER like its sibling
-- helpers: called from RLS, must see event_organizers/events past the caller's
-- row visibility.

create or replace function public.is_venue_organizer(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_organizers eo
    join public.events e on e.id = eo.event_id
    where e.venue_id = p_venue_id
      and eo.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_venue_organizer(uuid) from public, anon;
grant execute on function public.is_venue_organizer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. request_links
-- ---------------------------------------------------------------------------

create table public.request_links (
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null references public.events (id) on delete restrict,
  -- Denormalized for the venue-wide leaderboard + cheap RLS; ALWAYS overwritten
  -- by the BEFORE trigger below (pattern: set_checkin_scope, 20260622140000).
  venue_id uuid not null references public.venues (id) on delete restrict,
  influencer_id uuid references public.influencers (id) on delete restrict,
  -- Label-only links ("Instagram bio") have no influencer.
  label text check (label is null or char_length(btrim(label)) between 1 and 80),
  slug text not null unique,
  -- Pinned tier (optional). Composite FK: the tier must belong to THIS event.
  tier_id uuid,
  -- Cap on APPROVED HEADCOUNT sum(1 + plus_ones) attributed to this link —
  -- "deze influencer mag max 25 meenemen". Enforced by trigger in part 2/4
  -- (SQLSTATE 45006). NULL = no cap.
  max_headcount integer check (max_headcount is null or max_headcount > 0),
  auto_approve boolean not null default false,
  -- Pause switch per link; events.landing_active remains the event-level master.
  active boolean not null default true,
  expires_at timestamptz,
  -- The migrated legacy landing link (slug mirrors events.landing_slug).
  is_default boolean not null default false,
  -- Nullable: the trigger-created default link has no human creator.
  created_by uuid references public.user_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- Every link is identifiable: an influencer link, a labelled link, or the default.
  check (influencer_id is not null or label is not null or is_default),
  -- Auto-approve needs a pinned tier (there is no approver to pick one).
  check (not auto_approve or tier_id is not null),
  foreign key (tier_id, event_id) references public.guest_tiers (id, event_id) on delete restrict
);

comment on table public.request_links is
  'Public request links per event (N per event; ClickUp 86ey21vjt). The event''s legacy landing_slug lives on as the is_default link. Openness = request_link_open(): not archived, active, not expired, AND events.landing_active + not cancelled.';
comment on column public.request_links.max_headcount is
  'Cap on approved headcount sum(1+plus_ones) of non-removed guests attributed to this link (SQLSTATE 45006, part 2/4). NULL = no cap. Pending requests cost nothing.';

create unique index request_links_one_default_idx
  on public.request_links (event_id) where is_default;
create index request_links_event_idx on public.request_links (event_id);
create index request_links_influencer_idx
  on public.request_links (influencer_id) where influencer_id is not null;
-- Leaderboard path: all links of a venue.
create index request_links_venue_idx on public.request_links (venue_id);

create trigger set_updated_at before update on public.request_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Scope + integrity triggers
-- ---------------------------------------------------------------------------

-- BEFORE INSERT: stamp venue_id from the event (always overwrite — the client
-- value is untrusted) and reject an influencer from another venue. The composite
-- tier FK already pins tier_id to the event; influencer_id needs this trigger
-- because influencers are venue-scoped while events are the link's parent.
create or replace function public.set_request_link_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.venue_id := public.event_venue(new.event_id);
  if new.venue_id is null then
    raise exception using errcode = '23503', message = 'Event niet gevonden.';
  end if;
  if new.influencer_id is not null and not exists (
    select 1 from public.influencers i
    where i.id = new.influencer_id
      and i.venue_id = new.venue_id
      and i.archived_at is null
  ) then
    raise exception using errcode = '23514',
      message = 'Kies een influencer van deze venue.';
  end if;
  return new;
end;
$$;

create trigger set_request_link_scope
  before insert on public.request_links
  for each row execute function public.set_request_link_scope();

-- BEFORE UPDATE: keep the identity of a link stable. Slugs are immutable (shared
-- URLs and QR codes must never die by edit; the default link's slug is synced
-- from events.landing_slug by trigger below, which is the one allowed writer),
-- links never move between events, is_default never flips, and the influencer
-- guard is re-applied on change.
create or replace function public.guard_request_link_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_id is distinct from old.event_id then
    raise exception using errcode = '23514', message = 'Een link kan niet naar een ander event.';
  end if;
  new.venue_id := old.venue_id;
  if new.is_default is distinct from old.is_default then
    raise exception using errcode = '23514', message = 'De standaardlink kan niet wisselen.';
  end if;
  -- Only the landing_slug sync trigger (pg_trigger_depth > 1... not reliable);
  -- instead: allow slug change ONLY on the default link (driven by the events
  -- sync below, which runs as owner like any direct update). Non-default slugs
  -- are immutable.
  if new.slug is distinct from old.slug and not old.is_default then
    raise exception using errcode = '23514', message = 'De link-URL is vast; maak een nieuwe link.';
  end if;
  if new.influencer_id is distinct from old.influencer_id
     and new.influencer_id is not null
     and not exists (
       select 1 from public.influencers i
       where i.id = new.influencer_id
         and i.venue_id = old.venue_id
         and i.archived_at is null
     ) then
    raise exception using errcode = '23514', message = 'Kies een influencer van deze venue.';
  end if;
  return new;
end;
$$;

create trigger guard_request_link_update
  before update on public.request_links
  for each row execute function public.guard_request_link_update();

-- ---------------------------------------------------------------------------
-- 5. Default link: create on event insert, sync on landing_slug rename, backfill
-- ---------------------------------------------------------------------------

-- AFTER INSERT on events: every event gets its default link (slug = the
-- landing_slug the events_set_landing_slug BEFORE trigger just generated). Also
-- covers template-created events. SECURITY DEFINER: the inserting user's RLS
-- does not matter here; the row is derived state.
create or replace function public.events_create_default_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.landing_slug is not null then
    insert into public.request_links (event_id, venue_id, slug, is_default)
    values (new.id, new.venue_id, new.landing_slug, true);
  end if;
  return null;
end;
$$;

create trigger events_create_default_link
  after insert on public.events
  for each row execute function public.events_create_default_link();

-- AFTER UPDATE on events: an admin-edited landing_slug mirrors onto the default
-- link so the public URL and the admin field stay one thing. (The unique index
-- on request_links.slug turns a collision with another link into a 23505 for the
-- editor — correct, the URL is taken.)
create or replace function public.events_sync_default_link_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A nulled landing_slug never propagates (the default link's slug is NOT NULL;
  -- the old public URL simply keeps working until a new slug is set).
  if new.landing_slug is null then
    return null;
  end if;
  update public.request_links
  set slug = new.landing_slug
  where event_id = new.id and is_default and slug is distinct from new.landing_slug;
  -- An event that somehow had no default link yet (pre-backfill edge) gets one.
  if not found then
    insert into public.request_links (event_id, venue_id, slug, is_default)
    values (new.id, new.venue_id, new.landing_slug, true)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger events_sync_default_link_slug
  after update on public.events
  for each row
  when (old.landing_slug is distinct from new.landing_slug)
  execute function public.events_sync_default_link_slug();

-- The slug generator must now avoid BOTH namespaces: a new event's generated
-- landing_slug may not collide with any request_links.slug (the default-link
-- insert above would 23505 and abort the event creation). Body identical to
-- 20260625110000_slug_date_component ({name}-{date}-{4-char-random}) + the
-- request_links check in the collision loop.
create or replace function public.events_set_landing_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base      text;
  v_date      text;
  v_candidate text;
  v_try       int := 0;
begin
  -- If the app already provided a slug (the normal path), use it as-is.
  if new.landing_slug is not null and btrim(new.landing_slug) <> '' then
    return new;
  end if;

  v_base := public.slugify(new.name);
  if v_base = '' then
    v_base := 'event';
  end if;

  v_date := to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD');

  -- Always include the random suffix — the primary defence against slug
  -- enumeration (20260625110000). Candidates must be free in BOTH namespaces.
  loop
    v_candidate := v_base
      || '-' || v_date
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    exit when not exists (
      select 1 from public.events e where e.landing_slug = v_candidate
    ) and not exists (
      select 1 from public.request_links rl where rl.slug = v_candidate
    );
    v_try := v_try + 1;
    exit when v_try > 25; -- practically unreachable; guarantees termination
  end loop;

  new.landing_slug := v_candidate;
  return new;
end;
$$;

-- Backfill: one default link per existing event. Runs before any UI can create
-- other links, so slugs cannot collide (events.landing_slug is already unique).
insert into public.request_links (event_id, venue_id, slug, is_default)
select e.id, e.venue_id, e.landing_slug, true
from public.events e
where e.landing_slug is not null;

-- ---------------------------------------------------------------------------
-- 6. Pageview counters (funnel step 1)
-- ---------------------------------------------------------------------------

create table public.request_link_pageviews_daily (
  request_link_id uuid not null references public.request_links (id) on delete restrict,
  day date not null,
  views integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (request_link_id, day)
);

comment on table public.request_link_pageviews_daily is
  'Cookie-less daily page-load counters per request link (funnel step 1). No IP/UA/PII — statistics, not personal data; kept indefinitely. Written only by record_link_pageview() (SECURITY DEFINER).';

-- ---------------------------------------------------------------------------
-- 7. Openness predicate — ONE definition of "this link takes requests"
-- ---------------------------------------------------------------------------
-- Used by submit_guest_request / record_link_pageview / get_landing_event
-- (part 4/4). Layering: per-link state AND the event-level master switch
-- (landing_active) AND not cancelled — the same event gate the legacy flow used
-- (#28; incl. the cancelled_at rule from 20260624200000 that the 20260625100000
-- rewrite had accidentally dropped).

create or replace function public.request_link_open(l public.request_links)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select l.archived_at is null
    and l.active
    and (l.expires_at is null or l.expires_at > now())
    and exists (
      select 1 from public.events e
      where e.id = l.event_id
        and e.landing_active
        and e.cancelled_at is null
    );
$$;

-- Internal only (called from SECURITY DEFINER RPCs).
revoke execute on function public.request_link_open(public.request_links)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RLS + grants
-- ---------------------------------------------------------------------------

alter table public.influencers enable row level security;
alter table public.request_links enable row level security;
alter table public.request_link_pageviews_daily enable row level security;

-- influencers: admin manages; finance reads; an organizer may read (to pick one
-- for a link on their event). Staff/doorhost/anon: nothing.
create policy influencers_select on public.influencers
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
    or public.is_venue_organizer(venue_id)
  );

create policy influencers_insert_admin on public.influencers
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    and created_by = (select auth.uid())
  );

create policy influencers_update_admin on public.influencers
  for update to authenticated
  using (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]))
  with check (public.has_venue_role(venue_id, '{admin}'::public.venue_role[]));

-- request_links: admin (venue) or organizer (own event) manage; finance reads.
-- Anon resolves links exclusively through the SECURITY DEFINER RPCs (part 4/4) —
-- no anon SELECT, so link configs (max, auto_approve) never leak publicly.
create policy request_links_select on public.request_links
  for select to authenticated
  using (
    public.has_venue_role(venue_id, '{admin,finance}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

create policy request_links_insert on public.request_links
  for insert to authenticated
  with check (
    (
      public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
    -- The default link is machine-made (event triggers run as owner past RLS).
    and not is_default
    and created_by = (select auth.uid())
  );

create policy request_links_update on public.request_links
  for update to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  )
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

-- pageview counters: same read surface as the links; no app-role writes at all
-- (record_link_pageview runs as owner).
create policy request_link_pageviews_select on public.request_link_pageviews_daily
  for select to authenticated
  using (
    exists (
      select 1 from public.request_links rl
      where rl.id = request_link_id
        and (
          public.has_venue_role(rl.venue_id, '{admin,finance}'::public.venue_role[])
          or public.is_event_organizer(rl.event_id)
        )
    )
  );

-- Table privileges (explicit grant matrix; RLS is the row boundary on top).
grant select, insert, update on table public.influencers to authenticated, service_role;
grant select, insert, update on table public.request_links to authenticated, service_role;
grant select on table public.request_link_pageviews_daily to authenticated;
grant select, insert, update, delete on table public.request_link_pageviews_daily to service_role;
-- No DELETE for app roles anywhere (soft delete only, #21).

-- ---------------------------------------------------------------------------
-- 9. Audit (#4/#15) — link/influencer config changes are fraud-relevant
-- ---------------------------------------------------------------------------
-- Extend the generic audit_trigger(): request_links joins the event-scoped
-- branch; influencers lands in the venue-scoped `else` branch via its venue_id
-- column (no change needed). Body = 20260622000000 + 'request_links' in the
-- first when-list. Additive CREATE OR REPLACE, same as every prior extension.

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_entity_id uuid := (v_row ->> 'id')::uuid;
  v_event_id uuid;
  v_venue_id uuid;
  v_action text;
  v_diff jsonb;
begin
  -- Venue/event scope of the audited row.
  case tg_table_name
    when 'guests', 'guest_tiers', 'event_quotas', 'quota_requests', 'guest_requests', 'request_links' then
      v_event_id := (v_row ->> 'event_id')::uuid;
    when 'check_ins', 'refusals' then
      select g.event_id into v_event_id
      from public.guests g
      where g.id = (v_row ->> 'guest_id')::uuid;
    when 'events' then
      v_event_id := v_entity_id;
      v_venue_id := (v_row ->> 'venue_id')::uuid;
    when 'venues' then
      -- A venues row's own id is the venue id (no venue_id column).
      v_venue_id := v_entity_id;
    else -- quotas, venue_memberships, influencers: venue-scoped rows
      v_venue_id := (v_row ->> 'venue_id')::uuid;
  end case;

  if v_venue_id is null and v_event_id is not null then
    select e.venue_id into v_venue_id from public.events e where e.id = v_event_id;
  end if;

  -- Action name (see vocabulary in the fase-3 migration header).
  if tg_table_name = 'events' then
    -- Lock/unlock only when list_locked actually flipped; other event audits
    -- (e.g. allow_uncheck) are a plain 'update' carrying the JSONB diff.
    if (v_old ->> 'list_locked') is distinct from (v_new ->> 'list_locked') then
      v_action := case when (v_new ->> 'list_locked')::boolean then 'lock' else 'unlock' end;
    else
      v_action := 'update';
    end if;
  elsif tg_op = 'INSERT' then
    v_action := case tg_table_name
      when 'check_ins' then 'check_in'
      when 'refusals' then 'refuse'
      when 'quotas' then 'quota_grant'
      when 'event_quotas' then 'quota_grant'
      else 'create'
    end;
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
  else
    v_action := 'update';
    if tg_table_name = 'guests' then
      if (v_old ->> 'status') is distinct from (v_new ->> 'status') then
        v_action := case v_new ->> 'status'
          when 'checked_in' then 'check_in'
          when 'refused' then 'refuse'
          when 'removed' then 'delete' -- soft delete (#21)
          else 'update'
        end;
      elsif (v_old ->> 'tier_id') is distinct from (v_new ->> 'tier_id') then
        v_action := 'tier_change';
      end if;
    elsif tg_table_name = 'quotas'
      and (v_new ->> 'default_count')::int > (v_old ->> 'default_count')::int then
      v_action := 'quota_grant';
    elsif tg_table_name = 'event_quotas'
      and (v_new ->> 'quota_override')::int > (v_old ->> 'quota_override')::int then
      v_action := 'quota_grant';
    elsif tg_table_name in ('quota_requests', 'guest_requests')
      and (v_old ->> 'status') is distinct from (v_new ->> 'status') then
      v_action := case v_new ->> 'status'
        when 'approved' then 'approve'
        when 'denied' then 'deny'
        else 'update'
      end;
    end if;
  end if;

  -- Diff. Full snapshot on create/delete; changed fields only on update.
  if tg_op = 'UPDATE' then
    v_diff := public.audit_changed(v_old, v_new);
    if v_diff is null then
      return null; -- nothing changed (idempotent outbox replay, #25)
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := jsonb_build_object('before', null, 'after', v_new);
  else
    v_diff := jsonb_build_object('before', v_old, 'after', null);
  end if;

  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  values
    (auth.uid(), v_venue_id, v_event_id, tg_table_name, v_entity_id, v_action, v_diff,
     -- Request context wins; door rows carry their own device as fallback.
     coalesce(public.request_device_id(), v_row ->> 'device_id'));

  return null;
end;
$$;

create trigger audit_request_links
  after insert or update on public.request_links
  for each row execute function public.audit_trigger();

create trigger audit_influencers
  after insert or update on public.influencers
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Privileges on the new trigger functions — internal only.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.set_request_link_scope(),
  public.guard_request_link_update(),
  public.events_create_default_link(),
  public.events_sync_default_link_slug()
from public, anon, authenticated, service_role;
