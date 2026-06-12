-- Fase 1 — Full database schema
-- Spec: gastenlijst-app-spec.md §3 (datamodel), decisions #20–#33.
--
-- Scope of this migration:
--   * Real UUIDv7 generator (replaces the v4 placeholder from the init migration).
--   * All §3 MVP tables, enums, constraints and indexes.
--   * RLS ENABLED on every table with NO policies yet → default-deny for anon/authenticated.
--     Policies land in a follow-up migration; service_role bypasses RLS for server-side code.
--   * DELETE/TRUNCATE revoked for app roles on guest data (decision #21) and audit_log (decision #4).
-- NOT in this migration (follow-up tasks): RLS policies, audit triggers (#4),
-- quota-enforcement trigger (#22), list-lock enforcement (#23), anonymization job (#29).

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- True UUIDv7 (48-bit unix-ms timestamp + random), sortable and client-generatable
-- offline (decision #25). Replaces the init-migration placeholder that returned v4.
create or replace function public.uuid_generate_v7()
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
begin
  -- Start from a v4 UUID (correct variant bits), overlay the ms timestamp in the
  -- first 48 bits, then flip the version nibble from 0100 (v4) to 0111 (v7).
  return encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Venue-scoped roles (decision #3/#8). Organizer is NOT a venue role: it is an
-- event scope via event_organizers (decision #6).
create type public.venue_role as enum ('admin', 'user_manager', 'finance', 'staff', 'doorhost');

create type public.event_status as enum ('draft', 'open', 'live', 'closed');

-- Soft delete via status 'removed' (decision #21); anonymization keeps the row (#29).
create type public.guest_status as enum ('pending', 'approved', 'denied', 'checked_in', 'refused', 'removed');

create type public.guest_source as enum ('app', 'landing', 'door');

-- "Let op!"-flow on guest notes (decision #39).
create type public.note_priority as enum ('none', 'low', 'high');

-- Shared lifecycle for guest_requests and quota_requests (decisions #5/#12).
create type public.request_status as enum ('pending', 'approved', 'denied');

-- Entitlement source of truth (decision #32). 'comped' = manually enabled by us.
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'comped');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- App-side profile for an auth identity. PK mirrors auth.users.id (the one
-- deliberate exception to UUIDv7 PKs — identity is owned by Supabase Auth).
-- Users exist independently of venues (decision #24); e-mail is only ever
-- changed by the user themselves (enforced in RLS/app layer later).
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null,
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.venues (
  id uuid primary key default public.uuid_generate_v7(),
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}'::jsonb,
  -- AVG retention before guest anonymization (decision #16/#29), per venue.
  retention_months integer not null default 12 check (retention_months between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- user ↔ venue with a roles ARRAY: one user can hold multiple roles per venue
-- (decision #8) and memberships at multiple venues (decision #1).
create table public.venue_memberships (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  roles public.venue_role[] not null check (array_length(roles, 1) >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, user_id)
);

create index venue_memberships_user_id_idx on public.venue_memberships (user_id);

-- Stats/quota/logs hang on the event, never the calendar day (decision #26):
-- starts_at/ends_at are timestamptz so an event can cross midnight.
create table public.events (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.event_status not null default 'draft',
  -- Unique public request link; deactivatable without closing the event (decision #28).
  landing_slug text not null unique,
  landing_active boolean not null default false,
  -- List lock (decision #23). Lock/unlock becomes its own audit action later.
  list_locked boolean not null default false,
  locked_by uuid references public.user_profiles (id) on delete restrict,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (not list_locked or (locked_by is not null and locked_at is not null))
);

create index events_venue_id_status_idx on public.events (venue_id, status);

-- Organizer scope: a plain user assigned to one or more events (decision #6).
-- No venue membership required — external organizers exist (decision #24).
create table public.event_organizers (
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null references public.events (id) on delete restrict,
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index event_organizers_user_id_idx on public.event_organizers (user_id);

-- Ticket-type-like tiers per event (decision #8); aliases feed the quick-add
-- parser (decision #33).
create table public.guest_tiers (
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null references public.events (id) on delete restrict,
  name text not null,
  description text,
  color text,
  max_guests integer check (max_guests is null or max_guests > 0),
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name),
  -- Composite FK target so guests can prove tier and guest share the same event.
  unique (id, event_id)
);

-- Guest rows are soft-delete only (status 'removed', decision #21) and are kept
-- after anonymization (decision #29). A guest with plus_ones = N consumes
-- 1 + N quota slots (decision #22) — consumption is always computed from this
-- table, never stored.
create table public.guests (
  -- Client-generated offline via the outbox (decision #25); default covers
  -- server-side creation.
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null references public.events (id) on delete restrict,
  tier_id uuid not null,
  full_name text not null,
  email text,
  phone text,
  plus_ones integer not null default 0 check (plus_ones >= 0),
  note text,
  note_priority public.note_priority not null default 'none',
  note_acknowledged_by uuid references public.user_profiles (id) on delete restrict,
  note_acknowledged_at timestamptz,
  added_by uuid not null references public.user_profiles (id) on delete restrict,
  source public.guest_source not null default 'app',
  status public.guest_status not null default 'approved',
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Tier must belong to the same event as the guest.
  foreign key (tier_id, event_id) references public.guest_tiers (id, event_id) on delete restrict
);

create index guests_event_id_status_idx on public.guests (event_id, status);
-- Quota consumption is summed per (event, adder) — decision #22.
create index guests_event_id_added_by_idx on public.guests (event_id, added_by);

-- Public landing-page requests awaiting a decision (decision #12). Approval may
-- create a guests row; denial keeps only this record.
create table public.guest_requests (
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null references public.events (id) on delete restrict,
  full_name text not null,
  email text,
  phone text,
  motivation text,
  status public.request_status not null default 'pending',
  decided_by uuid references public.user_profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

create index guest_requests_event_id_status_idx on public.guest_requests (event_id, status);

-- Default guest-list slots per user per venue (decision #4 of the role matrix;
-- quota is per user, not per role).
create table public.quotas (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  default_count integer not null default 0 check (default_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, user_id)
);

-- Per-event override of the venue default. Consumption is NOT stored here —
-- it is computed from guests (decision #22).
create table public.event_quotas (
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null references public.events (id) on delete restrict,
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  quota_override integer not null check (quota_override >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- Staff asks for extra slots; admin decides (decision #5). Gets its own audit
-- entry once audit triggers land.
create table public.quota_requests (
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null references public.events (id) on delete restrict,
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  requested_extra integer not null check (requested_extra > 0),
  status public.request_status not null default 'pending',
  decided_by uuid references public.user_profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

create index quota_requests_event_id_status_idx on public.quota_requests (event_id, status);

-- One check-in per guest, ever: UNIQUE(guest_id) is the double-check-in
-- prevention from §3. Offline devices may both record one locally; on sync the
-- first (server timestamp) wins, the duplicate surfaces in the audit log (#11).
create table public.check_ins (
  -- Client-generated offline (decision #25).
  id uuid primary key default public.uuid_generate_v7(),
  guest_id uuid not null unique references public.guests (id) on delete restrict,
  checked_by uuid not null references public.user_profiles (id) on delete restrict,
  checked_at timestamptz not null default now(),
  client_timestamp timestamptz,
  device_id text,
  plus_ones_arrived integer not null default 0 check (plus_ones_arrived >= 0),
  offline_synced boolean not null default false,
  created_at timestamptz not null default now()
);

-- Refusal at the door, reason mandatory (decision #10). Multiple refusals per
-- guest stay on record — history is never overwritten.
create table public.refusals (
  -- Client-generated offline (decision #25).
  id uuid primary key default public.uuid_generate_v7(),
  guest_id uuid not null references public.guests (id) on delete restrict,
  refused_by uuid not null references public.user_profiles (id) on delete restrict,
  reason text not null,
  refused_at timestamptz not null default now(),
  client_timestamp timestamptz,
  device_id text,
  created_at timestamptz not null default now()
);

create index refusals_guest_id_idx on public.refusals (guest_id);

-- Append-only audit trail (decision #4/#15). Rows are written exclusively by
-- database triggers in a follow-up migration — never by app code. actor_id is
-- null for system actions (e.g. the anonymization job, #29).
create table public.audit_log (
  id uuid primary key default public.uuid_generate_v7(),
  actor_id uuid references public.user_profiles (id) on delete restrict,
  venue_id uuid references public.venues (id) on delete restrict,
  event_id uuid references public.events (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  diff jsonb,
  device_id text,
  created_at timestamptz not null default now()
);

create index audit_log_venue_id_created_at_idx on public.audit_log (venue_id, created_at);
-- Per-guest logboek in the guest detail view (decision #39).
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- Entitlement per venue (decision #32). The app reads ONLY this table for
-- access gating; Stripe state flows in via webhooks (fase 13). 'comped' lets
-- pilot venues run without billing.
create table public.subscriptions (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null unique references public.venues (id) on delete restrict,
  status public.subscription_status not null,
  plan_id text,
  current_period_end timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.venues
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.venue_memberships
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.guest_tiers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.guests
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.quotas
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.event_quotas
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — ON everywhere, no policies yet = default-deny
-- ---------------------------------------------------------------------------

alter table public.user_profiles enable row level security;
alter table public.venues enable row level security;
alter table public.venue_memberships enable row level security;
alter table public.events enable row level security;
alter table public.event_organizers enable row level security;
alter table public.guest_tiers enable row level security;
alter table public.guests enable row level security;
alter table public.guest_requests enable row level security;
alter table public.quotas enable row level security;
alter table public.event_quotas enable row level security;
alter table public.quota_requests enable row level security;
alter table public.check_ins enable row level security;
alter table public.refusals enable row level security;
alter table public.audit_log enable row level security;
alter table public.subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges — explicit matrix, independent of environment defaults
-- ---------------------------------------------------------------------------
-- Default ACLs differ between local and hosted Supabase, so we reset to zero
-- and grant exactly the intended surface. RLS (default-deny, policies in a
-- later migration) scopes rows on top of these table-level ceilings.

revoke all on all tables in schema public from anon, authenticated, service_role;

-- service_role: server-side only (Edge Functions / Route Handlers). Full DML,
-- EXCEPT hard delete of guest data and audit history (decisions #21/#4) —
-- anonymization (#29) is an UPDATE, never a DELETE, so even service code
-- physically cannot hard-delete. Membership/scope/config rows may be deleted.
grant select, insert, update, delete on all tables in schema public to service_role;
revoke delete on table public.guests, public.check_ins, public.refusals, public.audit_log from service_role;
revoke update on table public.check_ins, public.refusals from service_role;

-- authenticated: read/write through RLS, soft-delete model — no DELETE on
-- anything that carries history. DELETE only on assignment/config rows
-- (memberships, organizer scopes, tiers, quotas), where removal is a real
-- domain action (decision #24) and the audit log records it (#4).
grant select, insert, update on table public.user_profiles to authenticated;
grant select, update on table public.venues to authenticated;
grant select, insert, update, delete on table public.venue_memberships to authenticated;
grant select, insert, update on table public.events to authenticated;
grant select, insert, delete on table public.event_organizers to authenticated;
grant select, insert, update, delete on table public.guest_tiers to authenticated;
grant select, insert, update on table public.guests to authenticated;
grant select, insert, update on table public.guest_requests to authenticated;
grant select, insert, update, delete on table public.quotas to authenticated;
grant select, insert, update, delete on table public.event_quotas to authenticated;
grant select, insert, update on table public.quota_requests to authenticated;
grant select, insert, update on table public.check_ins to authenticated;
grant select, insert on table public.refusals to authenticated;
grant select on table public.audit_log to authenticated;          -- written by triggers only (#4)
grant select on table public.subscriptions to authenticated;      -- written by billing webhooks only (#32)

-- anon: landing page only (decision #12/#28) — look up an event by slug and
-- file a request. Nothing else, ever.
grant select on table public.events to anon;
grant insert on table public.guest_requests to anon;

-- Column DEFAULTs run as the inserting role, so app roles need EXECUTE on the
-- UUID generator; trigger function granted alongside.
grant execute on function public.uuid_generate_v7() to anon, authenticated, service_role;
grant execute on function public.set_updated_at() to anon, authenticated, service_role;
