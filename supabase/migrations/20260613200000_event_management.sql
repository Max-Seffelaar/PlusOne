-- Fase 6 — Eventbeheer: status-machine + landing-slug-generatie (spec §3,
-- beslissingen #8/#23/#26). RLS (fase 2) decides WHO may touch an event row
-- (admin venue-wide, organizer for their own event); this migration adds the
-- two invariants the role matrix could not express on its own:
--
--   1. Explicit status lifecycle. events.status moves draft→open→live→closed
--      along a fixed graph; illegal jumps (draft→live, open→closed-skipping-live
--      is allowed as a cancel, draft→closed as abandon) and nonsensical reversals
--      are rejected in the database, not just hidden in the UI. WHO may do each
--      transition is differentiated: forward steps are admin OR organizer;
--      corrective reversals (un-publish, un-live, reopen) are admin-only. This
--      protects downstream fraud logic — e.g. the quota live-rule keys off
--      events.went_live_at (fase 7), so "going live" must be a deliberate,
--      controlled step.
--
--   2. Landing-slug generation. events.landing_slug is NOT NULL UNIQUE with no
--      default; a BEFORE INSERT trigger fills a clean unique slug from the name
--      when the caller leaves it blank (the app generates a nice one in TS, the
--      trigger is the backstop for direct inserts and guarantees non-empty).
--
-- Tier-max (#8) is already enforced by the fase-7 quota engine (SQLSTATE 45002,
-- enforce_guest_quota); nothing to add here. Lock/unlock (#23) is already
-- enforced by RLS (can_write_guests) and audited (fase 3) — also nothing to add.
--
-- New SQLSTATE: 45004 = invalid/forbidden status transition. MESSAGE is Dutch UI
-- copy (surfaced by src/lib/db-errors.ts), HINT carries a machine-readable token.

-- ---------------------------------------------------------------------------
-- slugify — lowercase, non-alphanumerics to single '-', trimmed
-- ---------------------------------------------------------------------------

create or replace function public.slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Status state machine — pure, mirrored 1:1 in src/features/events/status.ts
-- ---------------------------------------------------------------------------
-- The allowed graph (everything else is rejected):
--   draft  → open      (publish)             forward
--   draft  → closed    (abandon a draft)     forward
--   open   → live      (doors open)          forward
--   open   → closed    (cancel before live)  forward
--   live   → closed    (event over)          forward
--   open   → draft     (un-publish)          admin-only
--   live   → open      (un-live, correction) admin-only
--   closed → open      (reopen)              admin-only
-- A no-op (status unchanged) is not a transition and never reaches here.

create or replace function public.is_valid_event_status_transition(
  p_from public.event_status, p_to public.event_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('draft', 'open'), ('draft', 'closed'),
    ('open', 'live'), ('open', 'closed'), ('open', 'draft'),
    ('live', 'closed'), ('live', 'open'),
    ('closed', 'open')
  );
$$;

-- Corrective reversals are admin-only; forward progression is admin OR organizer.
create or replace function public.event_transition_requires_admin(
  p_from public.event_status, p_to public.event_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('open', 'draft'), ('live', 'open'), ('closed', 'open')
  );
$$;

-- ---------------------------------------------------------------------------
-- Enforcement trigger (BEFORE UPDATE): validate the status transition
-- ---------------------------------------------------------------------------
-- Runs only when status actually changes. The graph invariant applies to every
-- writer (incl. service_role); the WHO rule applies to RLS-scoped callers
-- (auth.uid() present) — seed/migrations/jobs run as the table owner with a NULL
-- actor and are trusted, so they may set up any state but still cannot make an
-- illegal jump. has_venue_role is the same fase-2 helper RLS uses.

create or replace function public.events_validate_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if not public.is_valid_event_status_transition(old.status, new.status) then
    raise exception using
      errcode = '45004',
      message = format('Ongeldige statusovergang: van %s naar %s kan niet.',
                       old.status, new.status),
      hint = format('invalid_transition;from=%s;to=%s', old.status, new.status);
  end if;

  -- Corrective reversals are admin-only. Skip the role check for trusted,
  -- non-RLS contexts (seed/migrations/jobs have no auth.uid()).
  if v_actor is not null
     and public.event_transition_requires_admin(old.status, new.status)
     and not public.has_venue_role(new.venue_id, '{admin}'::public.venue_role[]) then
    raise exception using
      errcode = '45004',
      message = format('Alleen een admin mag een event van %s terugzetten naar %s.',
                       old.status, new.status),
      hint = format('transition_needs_admin;from=%s;to=%s', old.status, new.status);
  end if;

  return new;
end;
$$;

create trigger events_validate_status_transition
  before update on public.events
  for each row execute function public.events_validate_status_transition();

-- ---------------------------------------------------------------------------
-- Landing-slug generation (BEFORE INSERT): fill a unique slug when blank
-- ---------------------------------------------------------------------------
-- An explicit slug is respected as-is (uniqueness then enforced by the unique
-- index → 23505). A blank slug is generated from the name and de-collided with
-- a short random suffix. new.id is already populated (column default runs before
-- BEFORE triggers), and NOT NULL is checked after this trigger, so a blank input
-- is legal here.

create or replace function public.events_set_landing_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_try int := 0;
begin
  if new.landing_slug is not null and btrim(new.landing_slug) <> '' then
    return new;
  end if;

  v_base := public.slugify(new.name);
  if v_base = '' then
    v_base := 'event';
  end if;

  v_candidate := v_base;
  loop
    exit when not exists (
      select 1 from public.events e where e.landing_slug = v_candidate
    );
    v_try := v_try + 1;
    v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    -- Practically unreachable; guarantees termination.
    exit when v_try > 25;
  end loop;

  new.landing_slug := v_candidate;
  return new;
end;
$$;

create trigger events_set_landing_slug
  before insert on public.events
  for each row execute function public.events_set_landing_slug();

-- ---------------------------------------------------------------------------
-- Privileges — internal helpers stay internal
-- ---------------------------------------------------------------------------
-- The trigger functions run as their owner; the pure helpers are mirrored in TS,
-- so no app role needs EXECUTE on any of them.

revoke execute on function
  public.slugify(text),
  public.is_valid_event_status_transition(public.event_status, public.event_status),
  public.event_transition_requires_admin(public.event_status, public.event_status),
  public.events_validate_status_transition(),
  public.events_set_landing_slug()
from public, anon, authenticated, service_role;
