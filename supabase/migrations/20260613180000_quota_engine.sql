-- Fase 7 — Quota-engine: database-enforced slot limits (decisions #22/#31, spec §3).
--
-- The fraud-critical heart of the product. RLS (fase 2) already decides WHO may
-- touch a guest row; this migration decides HOW MANY a person may put on the
-- list. Enforced in the database via triggers, never only in the UI.
--
-- Model (spec §3 "Quota-handhaving" + decisions #22/#31, role matrix §2):
--   * Consumption per (event, adder) = Σ(1 + plus_ones) over that user's guests,
--     EXCLUDING:
--       - source = 'landing'  → landing guests never touch personal quota (#31);
--       - status = 'denied'   → never consumed a slot;
--       - status = 'removed'  → frees the slot, BUT ONLY if removed before the
--         event went live (#22). A guest removed at/after go-live keeps counting,
--         so add→admit→remove→re-add can never reclaim a slot.
--   * Quota = event_quotas.quota_override ?? quotas.default_count (venue) ?? 0.
--   * Enforcement applies to STAFF and DOORHOST adds only. Admin (venue) and
--     organizer (event) add without a personal limit — the role matrix grants
--     them guest writes with no "binnen quotum" qualifier (§2). They are
--     "quota-exempt"; their guests are not even summed.
--   * Tier max (guest_tiers.max_guests, optional): caps the number of guest
--     ENTRIES in a tier (removed/denied excluded). Counts rows, not slots — the
--     column is max_guests and tiers behave like ticket types (#8). Landing
--     guests DO count toward tier-max (#31: "wel binnen tier-max"). The live
--     rule is intentionally NOT applied here: tier-max is a list-capacity guard,
--     while the personal-quota live rule is the anti-reuse fraud guard.
--
-- Two new columns make the live rule deterministic and replay-safe:
--   * events.went_live_at — stamped once, the first time status becomes 'live';
--     never cleared (a permanent marker).
--   * guests.removed_at   — stamped when status becomes 'removed'; frozen while
--     it stays removed; cleared if the guest is un-removed.
--
-- Errors use custom SQLSTATEs so the app (and pgTAP) can distinguish them:
--   45001 = personal quota exceeded, 45002 = tier full. HINT carries a
--   machine-readable token; MESSAGE is Dutch UI copy.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

alter table public.events
  add column went_live_at timestamptz;

alter table public.guests
  add column removed_at timestamptz;

-- Staff motivation on a quota request (#5: "meer plekken aanvragen met
-- motivatie"). Optional at the DB level (the seed files requests without one);
-- the app's Zod schema requires it.
alter table public.quota_requests
  add column motivation text;

-- FK referencing column + tier-max count path.
create index guests_tier_id_idx on public.guests (tier_id);

comment on column public.events.went_live_at is
  'First moment status became live; permanent marker for the #22 quota live-rule. Never cleared.';
comment on column public.guests.removed_at is
  'When the guest was soft-deleted (status=removed). Drives the #22 live-rule; frozen while removed, cleared on un-remove.';

-- ---------------------------------------------------------------------------
-- Maintenance triggers (BEFORE): keep the two timestamps truthful
-- ---------------------------------------------------------------------------

create or replace function public.events_set_went_live_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Stamp the first transition into 'live' and keep it forever after.
  -- clock_timestamp() (real wall-clock), NOT now() (frozen at txn start): the
  -- live-rule compares removed_at to went_live_at, so both must reflect the
  -- actual instant of each action even when several happen in one transaction.
  if new.status = 'live' and new.went_live_at is null then
    new.went_live_at = clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger events_set_went_live_at
  before insert or update on public.events
  for each row execute function public.events_set_went_live_at();

create or replace function public.guests_set_removed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- clock_timestamp() (see events_set_went_live_at): removed_at must capture the
  -- real instant of removal so the #22 live-rule orders it against went_live_at.
  if new.status = 'removed' then
    if tg_op = 'INSERT' then
      new.removed_at = coalesce(new.removed_at, clock_timestamp());
    elsif old.status is distinct from 'removed' then
      new.removed_at = clock_timestamp();    -- just removed
    else
      new.removed_at = old.removed_at;       -- already removed: freeze original stamp
    end if;
  else
    new.removed_at = null;                   -- active (incl. un-remove)
  end if;
  return new;
end;
$$;

create trigger guests_set_removed_at
  before insert or update on public.guests
  for each row execute function public.guests_set_removed_at();

-- ---------------------------------------------------------------------------
-- Quota math — SECURITY DEFINER so the trigger and the UI helper see the full
-- picture regardless of the caller's RLS scope. All pin search_path and are
-- not executable by app roles (only event_quota_status is granted, below).
-- ---------------------------------------------------------------------------

-- Per-row contribution to PERSONAL quota consumption. Single source of truth
-- for the #22/#31 rules; user_event_consumption sums exactly this.
create or replace function public.guest_personal_contribution(g public.guests, p_went_live_at timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when g.source = 'landing' then 0          -- #31: outside personal quota
    when g.status = 'denied' then 0           -- never consumed
    when g.status <> 'removed' then 1 + g.plus_ones
    -- removed: only counts if removed at/after go-live (#22)
    when p_went_live_at is not null and g.removed_at >= p_went_live_at then 1 + g.plus_ones
    else 0
  end;
$$;

-- Per-row contribution to TIER occupancy (entry count, removed/denied excluded).
create or replace function public.guest_tier_contribution(g public.guests)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when g.status in ('removed', 'denied') then 0 else 1 end;
$$;

-- Total personal consumption for one (event, adder).
create or replace function public.user_event_consumption(p_event_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(public.guest_personal_contribution(g, e.went_live_at)), 0)::int
  from public.guests g
  join public.events e on e.id = g.event_id
  where g.event_id = p_event_id
    and g.added_by = p_user_id;
$$;

-- Resolved quota: per-event override beats venue default beats 0.
create or replace function public.user_event_quota(p_event_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select eq.quota_override
       from public.event_quotas eq
      where eq.event_id = p_event_id and eq.user_id = p_user_id),
    (select q.default_count
       from public.quotas q
       join public.events e on e.id = p_event_id
      where q.venue_id = e.venue_id and q.user_id = p_user_id),
    0
  );
$$;

-- Admin (venue) or organizer (event) add without a personal limit (§2).
create or replace function public.user_is_quota_exempt(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.events e
      join public.venue_memberships m on m.venue_id = e.venue_id
      where e.id = p_event_id
        and m.user_id = p_user_id
        and m.roles && '{admin}'::public.venue_role[]
    )
    or exists (
      select 1 from public.event_organizers eo
      where eo.event_id = p_event_id and eo.user_id = p_user_id
    );
$$;

-- Current occupancy of a tier (entries, removed/denied excluded).
create or replace function public.tier_consumption(p_tier_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(public.guest_tier_contribution(g)), 0)::int
  from public.guests g
  where g.tier_id = p_tier_id;
$$;

-- UI quota counter ("8 van 10 over", #17). Caller-scoped: only ever computes
-- for auth.uid(), so it leaks nothing about other users. exempt=true means the
-- caller (admin/organizer) has no personal limit on this event.
create or replace function public.event_quota_status(p_event_id uuid)
returns table (quota integer, consumed integer, remaining integer, exempt boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.user_event_quota(p_event_id, (select auth.uid())),
    public.user_event_consumption(p_event_id, (select auth.uid())),
    greatest(
      public.user_event_quota(p_event_id, (select auth.uid()))
        - public.user_event_consumption(p_event_id, (select auth.uid())),
      0),
    public.user_is_quota_exempt(p_event_id, (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Quota-request approval (#4/#5): atomically grant the override AND mark the
-- request approved, in one transaction. SECURITY DEFINER because it writes
-- event_quotas + quota_requests; it therefore re-checks admin + AAL2 itself
-- (mirroring the RLS the bypass would otherwise skip). Denials need no special
-- path — admins update the request row directly under RLS.
-- ---------------------------------------------------------------------------

create or replace function public.approve_quota_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quota_requests;
  v_venue uuid;
  v_current int;
begin
  select * into v_req from public.quota_requests where id = p_request_id;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Quota-verzoek niet gevonden.';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not (public.has_venue_role(v_venue, '{admin}'::public.venue_role[]) and public.is_aal2()) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin met MFA (AAL2) mag quota-verzoeken goedkeuren.';
  end if;

  -- New override = the requester's current effective quota + the granted extra.
  v_current := public.user_event_quota(v_req.event_id, v_req.user_id);
  insert into public.event_quotas (event_id, user_id, quota_override)
  values (v_req.event_id, v_req.user_id, v_current + v_req.requested_extra)
  on conflict (event_id, user_id)
  do update set quota_override = excluded.quota_override;

  update public.quota_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enforcement trigger (AFTER ROW): block changes that push a non-exempt user
-- over quota, or a guest into a full tier. Only raises on an INCREASE, so
-- lowering plus_ones / removing / moving out of a tier is always allowed even
-- when the user is already at or over the limit.
-- ---------------------------------------------------------------------------
-- AFTER (not BEFORE) so NEW is already in the table and the recompute is a
-- single SELECT over the real state — correct for multi-row bulk inserts too:
-- consumption only grows, so an over-quota batch is caught and the whole
-- statement rolls back ("Quotum-overschrijding blokkeert de batch", #33).
-- Fires after audit_guests (alphabetical), so a rejected change leaves no audit
-- row — nothing actually happened.

create or replace function public.enforce_guest_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_went_live_at timestamptz;
  v_old_personal int := 0;
  v_new_personal int := 0;
  v_quota int;
  v_consumed int;
  v_tier_max int;
  v_old_tier int := 0;
  v_new_tier int := 0;
  v_tier_count int;
begin
  select e.went_live_at into v_went_live_at
  from public.events e where e.id = new.event_id;

  -- ---- personal quota (non-exempt adders only; landing never counts) ----
  if new.source <> 'landing'
     and not public.user_is_quota_exempt(new.event_id, new.added_by) then

    v_new_personal := public.guest_personal_contribution(new, v_went_live_at);
    if tg_op = 'UPDATE'
       and old.added_by = new.added_by
       and old.event_id = new.event_id then
      v_old_personal := public.guest_personal_contribution(old, v_went_live_at);
    end if;

    -- Only a net increase can breach the limit.
    if v_new_personal > v_old_personal then
      v_quota := public.user_event_quota(new.event_id, new.added_by);
      v_consumed := public.user_event_consumption(new.event_id, new.added_by);
      if v_consumed > v_quota then
        raise exception using
          errcode = '45001',
          message = format(
            'Quotum overschreden: dit zou %s van %s plekken gebruiken voor dit event.',
            v_consumed, v_quota),
          hint = format('quota_exceeded;consumed=%s;quota=%s', v_consumed, v_quota);
      end if;
    end if;
  end if;

  -- ---- tier max (entry count; landing included, removed/denied excluded) ----
  select gt.max_guests into v_tier_max
  from public.guest_tiers gt where gt.id = new.tier_id;

  if v_tier_max is not null then
    v_new_tier := public.guest_tier_contribution(new);
    -- old only contributed to THIS tier if the tier was unchanged.
    if tg_op = 'UPDATE' and old.tier_id = new.tier_id then
      v_old_tier := public.guest_tier_contribution(old);
    end if;

    if v_new_tier > v_old_tier then
      v_tier_count := public.tier_consumption(new.tier_id);
      if v_tier_count > v_tier_max then
        raise exception using
          errcode = '45002',
          message = format('Tier zit vol: %s van %s plekken bezet.', v_tier_count, v_tier_max),
          hint = format('tier_full;occupied=%s;max=%s', v_tier_count, v_tier_max);
      end if;
    end if;
  end if;

  return null;
end;
$$;

create trigger enforce_guest_quota
  after insert or update on public.guests
  for each row execute function public.enforce_guest_quota();

-- ---------------------------------------------------------------------------
-- Privileges — internal math stays internal; only the UI counter is callable.
-- ---------------------------------------------------------------------------
-- The trigger/maintenance functions run as their owner (SECURITY DEFINER or
-- trigger context), so app roles need no EXECUTE. event_quota_status is the one
-- intentional surface for authenticated callers.

revoke execute on function
  public.events_set_went_live_at(),
  public.guests_set_removed_at(),
  public.guest_personal_contribution(public.guests, timestamptz),
  public.guest_tier_contribution(public.guests),
  public.user_event_consumption(uuid, uuid),
  public.user_event_quota(uuid, uuid),
  public.user_is_quota_exempt(uuid, uuid),
  public.tier_consumption(uuid),
  public.enforce_guest_quota(),
  public.event_quota_status(uuid),
  public.approve_quota_request(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.event_quota_status(uuid) to authenticated, service_role;
-- Self-guarded (admin + AAL2 checked inside); safe to expose to authenticated.
grant execute on function public.approve_quota_request(uuid) to authenticated, service_role;
