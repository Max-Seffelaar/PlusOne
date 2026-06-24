-- Event templates · part 2/3 — entities, RLS, scope trigger + audit (86exyp8gn).
--
-- Named, reusable setups per event-type (e.g. "Lofi — normaal" 1200, "Lofi — open
-- air" 1800). A template is venue-scoped and MANAGED by an admin OR an organizer of
-- the venue (organizes_event_at_venue — the same authority as the address book,
-- 20260615130000). It captures a tier set (child rows, the guest_tiers shape), a hard
-- capacity (part 1), and default event settings: allow_uncheck (tri-state), a
-- landing-active default, and an auto-lock OFFSET (a template can't store an absolute
-- instant). Part 3 seeds a new event from a template. Creating the event itself stays
-- admin-only (see part 3) — only template management is opened to organizers.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.event_templates (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  name text not null,
  -- Hard total capacity seeded onto events.capacity (part 1). NULL = no cap.
  capacity integer check (capacity is null or capacity > 0),
  -- Default per-event settings, mirroring the event columns they seed:
  --   allow_uncheck tri-state: true=on, false=off, null=inherit venue default (#3)
  allow_uncheck boolean,
  --   landing-active default for a freshly-seeded event (#28)
  landing_active boolean not null default false,
  --   auto-lock OFFSET in minutes relative to event start (negative = before doors);
  --   converted to events.auto_lock_at on create. NULL = no scheduled lock.
  auto_lock_offset_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, name)
);

create index event_templates_venue_id_idx on public.event_templates (venue_id);

-- A tier inside a template — the guest_tiers shape minus event_id/occupancy. venue_id
-- is denormalized (set_template_tier_scope below) so the generic audit_trigger can
-- scope the row and RLS keys off one indexed column; it always equals the parent's
-- venue. on delete cascade (templates carry no audit-critical guest history, unlike
-- guest_tiers which is restrict): dropping a template drops its tiers.
create table public.event_template_tiers (
  id uuid primary key default public.uuid_generate_v7(),
  template_id uuid not null references public.event_templates (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete restrict,
  name text not null,
  description text,
  color text,
  max_guests integer check (max_guests is null or max_guests > 0),
  aliases text[] not null default '{}',
  -- Deterministic seeding order (templates have no occupancy to sort by).
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, name)
);

create index event_template_tiers_template_id_idx on public.event_template_tiers (template_id);

create trigger set_updated_at before update on public.event_templates
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.event_template_tiers
  for each row execute function public.set_updated_at();

-- Grants mirror guest_tiers: authenticated CRUD through RLS, no anon ever.
grant select, insert, update, delete on table public.event_templates to authenticated;
grant select, insert, update, delete on table public.event_template_tiers to authenticated;

-- ---------------------------------------------------------------------------
-- RLS — read by any venue member or a venue-organizer; write by admin OR a
-- venue-organizer (organizes_event_at_venue). Mirrors the contacts policies
-- (20260615130000), but templates carry no PII so all members may also read.
-- ---------------------------------------------------------------------------
alter table public.event_templates enable row level security;
alter table public.event_template_tiers enable row level security;

create policy event_templates_select on public.event_templates
  for select to authenticated
  using (public.is_venue_member(venue_id) or public.organizes_event_at_venue(venue_id));

create policy event_templates_insert on public.event_templates
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

create policy event_templates_update on public.event_templates
  for update to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  )
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

create policy event_templates_delete on public.event_templates
  for delete to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

-- event_template_tiers: same authority, keyed off the denormalized venue_id (set by
-- the BEFORE trigger to the parent template's venue — see below).
create policy event_template_tiers_select on public.event_template_tiers
  for select to authenticated
  using (public.is_venue_member(venue_id) or public.organizes_event_at_venue(venue_id));

create policy event_template_tiers_insert on public.event_template_tiers
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

create policy event_template_tiers_update on public.event_template_tiers
  for update to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  )
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

create policy event_template_tiers_delete on public.event_template_tiers
  for delete to authenticated
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    or public.organizes_event_at_venue(venue_id)
  );

-- ---------------------------------------------------------------------------
-- Scope trigger — stamp venue_id from the parent template (mirrors
-- set_checkin_scope, 20260622140000), but ALWAYS overwrites (not just when null):
-- a tier's venue is definitionally the template's venue, so a client-supplied
-- venue_id must never stand — otherwise a forged value could satisfy the INSERT
-- WITH CHECK against a venue the caller controls while the row belongs to another
-- venue's template. BEFORE-ROW runs before the WITH CHECK, so the corrected venue_id
-- is what the policy (and audit) sees. SECURITY DEFINER reads the template past RLS.
-- ---------------------------------------------------------------------------
create or replace function public.set_template_tier_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.venue_id into new.venue_id
  from public.event_templates t
  where t.id = new.template_id;
  return new;
end;
$$;

revoke execute on function public.set_template_tier_scope() from public, anon;

create trigger event_template_tiers_set_scope
  before insert or update on public.event_template_tiers
  for each row execute function public.set_template_tier_scope();

-- ---------------------------------------------------------------------------
-- Audit (#4): the generic trigger scopes both tables via venue_id (its `else`
-- branch for venue-scoped rows); action is create/update/delete. No change to
-- audit_trigger() itself — both tables carry venue_id.
-- ---------------------------------------------------------------------------
create trigger audit_event_templates
  after insert or update or delete on public.event_templates
  for each row execute function public.audit_trigger();

create trigger audit_event_template_tiers
  after insert or update or delete on public.event_template_tiers
  for each row execute function public.audit_trigger();
