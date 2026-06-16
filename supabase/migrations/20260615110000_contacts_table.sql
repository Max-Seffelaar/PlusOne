-- Sessie C — Adresboek (contacts): the venue-level contact directory behind the
-- "Gasten & adresboek" tasks (#8 request-capture, #10 import, #11 permanent guests).
--
-- One PII surface to govern: a venue's saved people (name / e-mail / phone /
-- birthdate), reusable across events. A boolean is_permanent marks contacts that
-- auto-sync onto every new event (#11; mirrors the prototype's Contact.vast).
--
-- This migration creates the table, its normalised dedup keys (#10) and triggers.
-- RLS is ENABLED here with NO policies (default-deny); policies + the staff
-- reuse-search RPC land in 20260615120000. The guests.contact_id keystone link
-- lands in 20260615130000.
--
-- Decisions honoured: UUIDv7 client-generatable PK (#25); soft-delete/anonymise
-- only — no DELETE grant (#21/#29); audit via the generic trigger (#4); explicit
-- GRANT matrix independent of environment defaults.

-- ---------------------------------------------------------------------------
-- Enums (English code). contact_role mirrors the prototype's Role union and is
-- a PREFERENCE hint that drives per-event tier mapping (20260615150000) — not a
-- security construct. contact_source records how the contact was captured.
-- ---------------------------------------------------------------------------

create type public.contact_role as enum ('vip', 'all_access', 'artist', 'press', 'crew', 'guest');
create type public.contact_source as enum ('manual', 'import', 'guest_request');

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  full_name text not null,
  email text,
  phone text,                                    -- stored E.164 as provided
  birthdate date,                                -- #8 (DATE: a birthday has no timezone)
  preferred_role public.contact_role,            -- nullable; drives tier mapping
  note text,
  is_permanent boolean not null default false,   -- #11; auto-sync onto every event
  -- Normalised dedup keys (#10). Generated + stored, never written by the app;
  -- the unique indexes below are the race-proof authority for dedupe. The phone
  -- normalisation ([^0-9] strip) is reused verbatim by submit_guest_request and
  -- the import RPC so request-capture and import agree on what is "the same".
  email_norm text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone_norm text generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored,
  source public.contact_source not null default 'manual',
  anonymized_at timestamptz,                     -- AVG marker, mirrors guests.anonymized_at (#29)
  created_by uuid references public.user_profiles (id) on delete restrict,  -- null for anon request-capture
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Dedup + lookup indexes
-- ---------------------------------------------------------------------------
-- One live contact per (venue, e-mail) and per (venue, phone), normalised,
-- ignoring anonymised rows (so an AVG-scrubbed contact frees its slot). Partial
-- on *_norm is not null so name-only contacts never collide with each other.

create unique index contacts_venue_email_uidx on public.contacts (venue_id, email_norm)
  where email_norm is not null and anonymized_at is null;
create unique index contacts_venue_phone_uidx on public.contacts (venue_id, phone_norm)
  where phone_norm is not null and anonymized_at is null;

create index contacts_venue_permanent_idx on public.contacts (venue_id) where is_permanent;
create index contacts_venue_unanon_idx on public.contacts (venue_id) where anonymized_at is null;

-- ---------------------------------------------------------------------------
-- Triggers — updated_at + generic audit (#4). contacts is venue-scoped, so the
-- generic audit_trigger's else-branch resolves venue_id from the row directly;
-- no change to that function is needed. Actions: create / update / delete.
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create trigger audit_contacts
  after insert or update or delete on public.contacts
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- RLS — ON, no policies yet = default-deny (policies in 20260615120000).
-- ---------------------------------------------------------------------------

alter table public.contacts enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges — explicit matrix. No DELETE for any role: the address book is
-- soft-delete/anonymise only (#21/#29); removal is the owner-run AVG scrub
-- (20260615180000), never an app DELETE.
-- ---------------------------------------------------------------------------

revoke all on table public.contacts from anon, authenticated, service_role;
grant select, insert, update on table public.contacts to authenticated, service_role;
