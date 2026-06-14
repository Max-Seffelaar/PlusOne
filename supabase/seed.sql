-- Seed data for local development — applied by `supabase db reset`.
-- Contents: 2 venues, 6 users covering all six roles (admin, user_manager,
-- finance, organizer, staff, doorhost), 1 event with 3 tiers and 30 guests in
-- mixed statuses, plus quotas, open requests and subscriptions.
--
-- Runs as superuser: RLS is bypassed here by design. Fixed UUIDs use valid
-- v7-shaped values so seeded data sorts like production data.

-- ---------------------------------------------------------------------------
-- Auth users (local only — direct insert into auth schema)
-- ---------------------------------------------------------------------------
-- Passwordless project (decision #20): encrypted_password stays empty; the
-- token columns get '' because GoTrue chokes on NULL string scans.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'admin@plusone.test',     'Max de Vries'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'manager@plusone.test',   'Noor van Dijk'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'finance@plusone.test',   'Femke Bos'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'organizer@plusone.test', 'Yusuf Demir'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'staff@plusone.test',     'Tom Bakker'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'door@plusone.test',      'Lisa van den Berg')
) as u (id, email, full_name);

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
select
  u.id, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', u.id::text, now(), now(), now()
from auth.users as u
where u.email like '%@plusone.test';

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

insert into public.user_profiles (id, full_name, email)
select u.id, u.raw_user_meta_data ->> 'full_name', u.email
from auth.users as u
where u.email like '%@plusone.test';

-- ---------------------------------------------------------------------------
-- Venues + subscriptions (decision #32: access is read from subscriptions)
-- ---------------------------------------------------------------------------

insert into public.venues (id, name, slug, retention_months) values
  ('aa000000-0000-7000-8000-000000000001', 'Club Vesper',  'club-vesper',  12),
  ('aa000000-0000-7000-8000-000000000002', 'De Marktzaal', 'de-marktzaal', 12);

insert into public.subscriptions (venue_id, status, plan_id, current_period_end) values
  ('aa000000-0000-7000-8000-000000000001', 'comped',   'pilot', null),
  ('aa000000-0000-7000-8000-000000000002', 'trialing', 'basic', now() + interval '14 days');

-- ---------------------------------------------------------------------------
-- Memberships — Lisa holds two roles (decision #8); Max is admin at both
-- venues (decision #1); organizer Yusuf has NO membership, only an event
-- scope (decisions #6/#24).
-- ---------------------------------------------------------------------------

insert into public.venue_memberships (venue_id, user_id, roles) values
  ('aa000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '{admin}'),
  ('aa000000-0000-7000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '{user_manager}'),
  ('aa000000-0000-7000-8000-000000000001', '33333333-3333-4333-8333-333333333333', '{finance}'),
  ('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', '{staff}'),
  ('aa000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', '{doorhost,staff}'),
  ('aa000000-0000-7000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '{admin}');

-- ---------------------------------------------------------------------------
-- Event (crosses midnight — decision #26) + tiers (decision #8/#33)
-- ---------------------------------------------------------------------------

insert into public.events (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active) values
  ('ee000000-0000-7000-8000-000000000001',
   'aa000000-0000-7000-8000-000000000001',
   'PLUSONE Launch Night',
   '2026-06-20 23:00:00+02', '2026-06-21 05:00:00+02',
   'open', 'plusone-launch-night', true);

insert into public.event_organizers (event_id, user_id) values
  ('ee000000-0000-7000-8000-000000000001', '44444444-4444-4444-8444-444444444444');

insert into public.guest_tiers (id, event_id, name, description, color, max_guests, aliases) values
  ('dd000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
   'Regular', null, '#8A8A93', null, '{}'),
  ('dd000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
   'VIP', null, '#B5A6FF', null, '{vip}'),
  ('dd000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
   'VIP + fles op tafel', 'Tafelservice met fles', '#D4AF7A', 10, '{fles,champagne,vip fles}');

-- ---------------------------------------------------------------------------
-- Quotas (decision #4/#22): Tom default 10 at the venue, overridden to 12 for
-- this event; Lisa (doorhost) 5 for door-adds. One open quota request (#5).
-- ---------------------------------------------------------------------------

insert into public.quotas (venue_id, user_id, default_count) values
  ('aa000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 10),
  ('aa000000-0000-7000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 5);

insert into public.event_quotas (event_id, user_id, quota_override) values
  ('ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 12);

insert into public.quota_requests (event_id, user_id, requested_extra) values
  ('ee000000-0000-7000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 3);

-- ---------------------------------------------------------------------------
-- Guests — 30 total: 8 hand-picked (checked in / refused / removed / pending /
-- door-add / priority note) + 22 bulk. Tom's non-removed guests consume
-- 10 of his 12 slots (1 + plus_ones each — decision #22).
-- ---------------------------------------------------------------------------

insert into public.guests
  (id, event_id, tier_id, full_name, email, phone, plus_ones,
   note, note_priority, added_by, source, status)
values
  -- Quick-add poster child (decision #33) with a "Let op!"-note (decision #39)
  ('cc000000-0000-7000-8000-000000000001', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000003', 'Juri Braakman', null, '+31612345678', 2,
   'Tafel bij de DJ-booth reserveren', 'high',
   '11111111-1111-4111-8111-111111111111', 'app', 'approved'),
  -- Checked in (see check_ins below)
  ('cc000000-0000-7000-8000-000000000002', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000002', 'Sanne Mulder', null, '+31687654321', 1,
   null, 'none', '11111111-1111-4111-8111-111111111111', 'app', 'checked_in'),
  ('cc000000-0000-7000-8000-000000000003', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Daan Visser', null, null, 0,
   null, 'none', '11111111-1111-4111-8111-111111111111', 'app', 'checked_in'),
  ('cc000000-0000-7000-8000-000000000004', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Esra Yilmaz', null, null, 0,
   null, 'none', '11111111-1111-4111-8111-111111111111', 'app', 'checked_in'),
  -- Refused at the door (see refusals below)
  ('cc000000-0000-7000-8000-000000000005', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Bram de Groot', null, null, 1,
   null, 'none', '55555555-5555-4555-8555-555555555555', 'app', 'refused'),
  -- Soft-deleted (decision #21); event is 'open', so the slots were freed (#22)
  ('cc000000-0000-7000-8000-000000000006', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Pieter Smit', null, null, 2,
   null, 'none', '55555555-5555-4555-8555-555555555555', 'app', 'removed'),
  -- Landing request staged by the organizer, awaiting approval (decision #12)
  ('cc000000-0000-7000-8000-000000000007', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Aïcha Benali', 'aicha@example.test', null, 0,
   null, 'none', '44444444-4444-4444-8444-444444444444', 'landing', 'pending'),
  -- Added at the door by the doorhost, within her own quota (decision #10)
  ('cc000000-0000-7000-8000-000000000008', 'ee000000-0000-7000-8000-000000000001',
   'dd000000-0000-7000-8000-000000000001', 'Joep van Leeuwen', null, '+31698765432', 1,
   null, 'none', '66666666-6666-4666-8666-666666666666', 'door', 'approved');

-- 22 bulk guests: first 6 by staff (Tom), the rest by admin (Max).
insert into public.guests
  (event_id, tier_id, full_name, phone, plus_ones, added_by, source, status)
select
  'ee000000-0000-7000-8000-000000000001',
  case when n.ord % 5 = 0
    then 'dd000000-0000-7000-8000-000000000002'  -- VIP
    else 'dd000000-0000-7000-8000-000000000001'  -- Regular
  end::uuid,
  n.full_name,
  case when n.ord % 3 = 0 then format('+31612345%s', lpad(n.ord::text, 3, '0')) end,
  case when n.ord % 4 = 1 then 1 else 0 end,
  case when n.ord <= 6
    then '55555555-5555-4555-8555-555555555555'  -- Tom (staff)
    else '11111111-1111-4111-8111-111111111111'  -- Max (admin)
  end::uuid,
  'app', 'approved'
from unnest(array[
  'Femke Aalders', 'Daniël Verhoeven', 'Sterre Kuipers', 'Mees van Houten',
  'Lotte de Wit', 'Sven Hoekstra', 'Nina Driessen', 'Ruben Cornelissen',
  'Isa van der Laan', 'Thijs Brouwer', 'Mila Schouten', 'Jesse Dijkstra',
  'Roos Hendriks', 'Finn van Egmond', 'Eva Postma', 'Lars Willems',
  'Saar van Beek', 'Niek Koster', 'Julia Smeets', 'Teun Geurts',
  'Yara van Loon', 'Casper Mol'
]) with ordinality as n (full_name, ord);

-- ---------------------------------------------------------------------------
-- Check-ins (unique per guest — double-check-in prevention) and one refusal
-- ---------------------------------------------------------------------------

insert into public.check_ins
  (guest_id, checked_by, checked_at, client_timestamp, device_id, plus_ones_arrived, offline_synced)
values
  ('cc000000-0000-7000-8000-000000000002', '66666666-6666-4666-8666-666666666666',
   '2026-06-20 23:41:00+02', '2026-06-20 23:41:00+02', 'door-ipad-01', 1, false),
  -- Recorded offline, synced later: client stamp precedes the server stamp
  ('cc000000-0000-7000-8000-000000000003', '66666666-6666-4666-8666-666666666666',
   '2026-06-20 23:57:00+02', '2026-06-20 23:55:00+02', 'door-ipad-01', 0, true),
  -- After midnight, still this event (decision #26)
  ('cc000000-0000-7000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   '2026-06-21 00:12:00+02', null, null, 0, false);

insert into public.refusals (guest_id, refused_by, reason, refused_at, device_id) values
  ('cc000000-0000-7000-8000-000000000005', '66666666-6666-4666-8666-666666666666',
   'Agressief gedrag bij de deur', '2026-06-21 00:03:00+02', 'door-ipad-01');

-- ---------------------------------------------------------------------------
-- Landing-page requests (decision #12/#28): two open, one decided
-- ---------------------------------------------------------------------------

insert into public.guest_requests (event_id, full_name, email, phone, motivation) values
  ('ee000000-0000-7000-8000-000000000001', 'Robin Castelijns', 'robin@example.test', null,
   'Vrienden van de DJ'),
  ('ee000000-0000-7000-8000-000000000001', 'Sofia Marin', null, '+31611122233', null);

insert into public.guest_requests
  (event_id, full_name, status, decided_by, decided_at, decision_reason)
values
  ('ee000000-0000-7000-8000-000000000001', 'Kevin de Lange', 'denied',
   '11111111-1111-4111-8111-111111111111', now(), 'Lijst zit vol voor deze avond');

-- ---------------------------------------------------------------------------
-- LOCAL-ONLY MFA fast-path (development convenience — NOT a security feature).
-- ===========================================================================
-- 🚨 DEV BACKDOOR — verify absent / remove before go-live. Checklist:
--    docs/launch.md → "Remove / verify-absent: the local dev fast-login".
--    Guarded by tests/unit/no-dev-backdoor.test.ts (blocks it from migrations).
-- ===========================================================================
-- admin & finance must reach AAL2 (decision #20). Without a verified factor the
-- app pins them at /mfa/enroll on every reset. Here we pre-seed a *verified*
-- TOTP factor with a FIXED, well-known dev secret so they skip enrollment and
-- only step up at /mfa/verify.
--
-- `pnpm dev:code` prints both a fresh e-mail OTP (minted via the local GoTrue
-- admin API) and the current MFA code (this secret), so local login needs
-- neither Inbucket nor a phone authenticator.
--
-- This runs ONLY on local `supabase db reset`. The secret is plaintext base32
-- (local GoTrue has no encryption key) and is meaningless against a real
-- project. NEVER replicate this factor to staging/production. The other four
-- roles need no MFA, so the e-mail code alone logs them in.
insert into auth.mfa_factors
  (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values
  ('ff000000-0000-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Local Dev', 'totp', 'verified', now(), now(), 'PLUSONELOCALADMINDEVSECRET234567'),
  ('ff000000-0000-7000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'Local Dev', 'totp', 'verified', now(), now(), 'PLUSONELOCALADMINDEVSECRET234567')
on conflict (id) do nothing;
