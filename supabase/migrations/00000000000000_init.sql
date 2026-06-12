-- Enable required extensions
create extension if not exists "uuid-ossp";

-- UUID v7 generation function (for client-generated offline-capable entities)
create or replace function uuid_generate_v7()
returns uuid
as $$
select encode(
  set_byte(
    set_byte(
      overlay(uuid_send(gen_random_uuid())
        placing substring(int8send(floor((extract(epoch from clock_timestamp()) * 1000))::bigint), 3)
        from 1 for 6
      ),
      6, (get_byte(uuid_send(gen_random_uuid()), 6) & 15) | 0x70
    ),
    8, (get_byte(uuid_send(gen_random_uuid()), 8) & 63) | 0x80
  ),
  'hex'
)::uuid;
$$ language sql;

-- === ENUMS ===
create type event_status as enum ('draft', 'open', 'live', 'closed');
create type guest_status as enum ('pending', 'approved', 'denied', 'checked_in', 'refused', 'removed');
create type venue_role as enum ('admin', 'user_manager', 'finance', 'staff', 'doorhost');
create type note_priority as enum ('none', 'low', 'high');
create type guest_source as enum ('app', 'landing', 'door');
create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'comped');

-- === USERS & AUTH ===
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_users_email on users(email);

alter table users enable row level security;
create policy users_select_own on users
  for select using (auth.uid() = id);
create policy users_select_in_venue on users
  for select using (
    exists (
      select 1 from venue_memberships vm
      where vm.user_id = users.id
        and vm.user_id = auth.uid()
    )
  );

-- === VENUES (MULTI-TENANT) ===
create table venues (
  id uuid primary key default uuid_generate_v7(),
  slug text unique not null,
  name text not null,
  description text,
  owner_id uuid not null references users(id) on delete restrict,
  retention_days int default 365,
  stripe_customer_id text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_venues_owner_id on venues(owner_id);
create index idx_venues_slug on venues(slug);

alter table venues enable row level security;
create policy venues_select_if_member on venues
  for select using (
    exists (
      select 1 from venue_memberships
      where venue_id = venues.id and user_id = auth.uid()
    )
  );

-- === VENUE MEMBERSHIPS ===
create table venue_memberships (
  id uuid primary key default uuid_generate_v7(),
  venue_id uuid not null references venues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  roles venue_role[] not null default array[]::venue_role[],
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(venue_id, user_id)
);

create index idx_venue_memberships_user_id on venue_memberships(user_id);
create index idx_venue_memberships_venue_id on venue_memberships(venue_id);

alter table venue_memberships enable row level security;
create policy venue_memberships_select on venue_memberships
  for select using (
    auth.uid() = user_id
    or auth.uid() in (
      select user_id from venue_memberships
      where venue_id = venue_memberships.venue_id and 'admin'::venue_role = any(roles)
    )
  );

-- === EVENTS ===
create table events (
  id uuid primary key default uuid_generate_v7(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  date date not null,
  status event_status default 'draft'::event_status,
  landing_slug text,
  landing_active boolean default false,
  list_locked boolean default false,
  locked_by uuid references users(id) on delete set null,
  locked_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(venue_id, landing_slug)
);

create index idx_events_venue_id on events(venue_id);
create index idx_events_status on events(status);
create index idx_events_date on events(date);

alter table events enable row level security;
create policy events_select_if_member on events
  for select using (
    exists (
      select 1 from venue_memberships
      where venue_id = events.venue_id and user_id = auth.uid()
    )
  );

-- === EVENT ORGANIZERS ===
create table event_organizers (
  id uuid primary key default uuid_generate_v7(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamp with time zone default now(),
  unique(event_id, user_id)
);

create index idx_event_organizers_event_id on event_organizers(event_id);
create index idx_event_organizers_user_id on event_organizers(user_id);

alter table event_organizers enable row level security;

-- === GUEST TIERS ===
create table guest_tiers (
  id uuid primary key default uuid_generate_v7(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  description text,
  color text,
  max_count int,
  aliases text[] default array[]::text[],
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(event_id, name)
);

create index idx_guest_tiers_event_id on guest_tiers(event_id);

alter table guest_tiers enable row level security;
create policy guest_tiers_select_if_member on guest_tiers
  for select using (
    exists (
      select 1 from events e
      join venue_memberships vm on vm.venue_id = e.venue_id
      where e.id = guest_tiers.event_id and vm.user_id = auth.uid()
    )
  );

-- === GUESTS (core entity, soft-delete only) ===
create table guests (
  id uuid primary key default uuid_generate_v7(),
  event_id uuid not null references events(id) on delete cascade,
  tier_id uuid references guest_tiers(id) on delete set null,
  name text not null,
  email text,
  phone text,
  plus_ones int default 0,
  note text,
  note_priority note_priority default 'none'::note_priority,
  note_acknowledged_by uuid references users(id) on delete set null,
  note_acknowledged_at timestamp with time zone,
  added_by uuid not null references users(id) on delete restrict,
  source guest_source default 'app'::guest_source,
  status guest_status default 'pending'::guest_status,
  anonymized_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_guests_event_id_status on guests(event_id, status);
create index idx_guests_event_id on guests(event_id);
create index idx_guests_status on guests(status);
create index idx_guests_added_by on guests(added_by);

alter table guests enable row level security;
create policy guests_default_deny on guests
  for all using (false);

-- === GUEST REQUESTS (landingpage submissions) ===
create table guest_requests (
  id uuid primary key default uuid_generate_v7(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  message text,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamp with time zone,
  decision text check (decision in ('approved', 'denied')),
  reason text,
  created_at timestamp with time zone default now()
);

create index idx_guest_requests_event_id on guest_requests(event_id);
create index idx_guest_requests_created_at on guest_requests(created_at);

alter table guest_requests enable row level security;
create policy guest_requests_default_deny on guest_requests
  for all using (false);

-- === QUOTAS (user per venue) ===
create table quotas (
  id uuid primary key default uuid_generate_v7(),
  venue_id uuid not null references venues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  default_count int not null default 5,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(venue_id, user_id)
);

create index idx_quotas_user_id on quotas(user_id);
create index idx_quotas_venue_id on quotas(venue_id);

alter table quotas enable row level security;
create policy quotas_default_deny on quotas
  for all using (false);

-- === EVENT QUOTAS (override per event) ===
create table event_quotas (
  id uuid primary key default uuid_generate_v7(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  override_count int,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(event_id, user_id)
);

create index idx_event_quotas_event_id on event_quotas(event_id);
create index idx_event_quotas_user_id on event_quotas(user_id);

alter table event_quotas enable row level security;
create policy event_quotas_default_deny on event_quotas
  for all using (false);

-- === QUOTA REQUESTS ===
create table quota_requests (
  id uuid primary key default uuid_generate_v7(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  requested_count int not null,
  requested_by uuid not null references users(id) on delete restrict,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamp with time zone,
  decision text check (decision in ('approved', 'denied')),
  reason text,
  created_at timestamp with time zone default now(),
  unique(event_id, user_id, created_at)
);

create index idx_quota_requests_event_id on quota_requests(event_id);
create index idx_quota_requests_user_id on quota_requests(user_id);
create index idx_quota_requests_requested_by on quota_requests(requested_by);

alter table quota_requests enable row level security;
create policy quota_requests_default_deny on quota_requests
  for all using (false);

-- === CHECK-INS (offline-capable, unique per guest) ===
create table check_ins (
  id uuid primary key default uuid_generate_v7(),
  guest_id uuid not null references guests(id) on delete cascade,
  checked_by uuid not null references users(id) on delete restrict,
  server_timestamp timestamp with time zone default now(),
  client_timestamp timestamp with time zone,
  device_id text,
  plus_ones_arrived int default 0,
  offline_synced boolean default false,
  unique(guest_id),
  created_at timestamp with time zone default now()
);

create index idx_check_ins_guest_id on check_ins(guest_id);
create index idx_check_ins_checked_by on check_ins(checked_by);
create index idx_check_ins_server_timestamp on check_ins(server_timestamp);

alter table check_ins enable row level security;
create policy check_ins_default_deny on check_ins
  for all using (false);

-- Revoke DELETE for authenticated role on check_ins
revoke delete on check_ins from authenticated;

-- === REFUSALS ===
create table refusals (
  id uuid primary key default uuid_generate_v7(),
  guest_id uuid not null references guests(id) on delete cascade,
  refused_by uuid not null references users(id) on delete restrict,
  reason text,
  server_timestamp timestamp with time zone default now(),
  client_timestamp timestamp with time zone,
  device_id text,
  created_at timestamp with time zone default now()
);

create index idx_refusals_guest_id on refusals(guest_id);
create index idx_refusals_refused_by on refusals(refused_by);

alter table refusals enable row level security;
create policy refusals_default_deny on refusals
  for all using (false);

-- Revoke DELETE for authenticated role on refusals
revoke delete on refusals from authenticated;

-- === AUDIT LOG (via triggers, immutable) ===
create table audit_log (
  id uuid primary key default uuid_generate_v7(),
  venue_id uuid not null references venues(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  actor_id uuid not null references users(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  device_id text,
  created_at timestamp with time zone default now()
);

create index idx_audit_log_venue_id_created_at on audit_log(venue_id, created_at);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);
create index idx_audit_log_actor_id on audit_log(actor_id);

alter table audit_log enable row level security;
create policy audit_log_default_deny on audit_log
  for all using (false);

-- Revoke DELETE for authenticated role on audit_log
revoke delete on audit_log from authenticated;

-- === SUBSCRIPTIONS (billing) ===
create table subscriptions (
  id uuid primary key default uuid_generate_v7(),
  venue_id uuid not null unique references venues(id) on delete cascade,
  status subscription_status default 'comped'::subscription_status,
  plan_id text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_subscriptions_venue_id on subscriptions(venue_id);
create index idx_subscriptions_stripe_customer_id on subscriptions(stripe_customer_id);

alter table subscriptions enable row level security;
create policy subscriptions_default_deny on subscriptions
  for all using (false);

-- === SEED DATA ===
-- Create test users (these will be linked to auth.users in actual app flow, but for testing we insert placeholders)
insert into users (id, email, display_name) values
  ('00000000-0000-0000-0000-000000000001', 'admin1@plusone.test', 'Alice Admin'),
  ('00000000-0000-0000-0000-000000000002', 'usermgr@plusone.test', 'Bob User Manager'),
  ('00000000-0000-0000-0000-000000000003', 'finance@plusone.test', 'Carol Finance'),
  ('00000000-0000-0000-0000-000000000004', 'organizer@plusone.test', 'Dan Organizer'),
  ('00000000-0000-0000-0000-000000000005', 'staff@plusone.test', 'Eve Staff'),
  ('00000000-0000-0000-0000-000000000006', 'doorhost@plusone.test', 'Frank Doorhost'),
  ('00000000-0000-0000-0000-000000000007', 'admin2@plusone.test', 'Grace Admin 2')
on conflict (id) do nothing;

-- Create 2 venues
insert into venues (id, slug, name, owner_id, retention_days) values
  ('10000000-0000-0000-0000-000000000001', 'club-midnight', 'Club Midnight', '00000000-0000-0000-0000-000000000001', 365),
  ('10000000-0000-0000-0000-000000000002', 'sunset-lounge', 'Sunset Lounge', '00000000-0000-0000-0000-000000000007', 90)
on conflict (slug) do nothing;

-- Create venue memberships for venue 1
insert into venue_memberships (venue_id, user_id, roles) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', array['admin']),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', array['user_manager']),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', array['finance']),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', array['staff']),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', array['doorhost'])
on conflict (venue_id, user_id) do nothing;

-- Create venue memberships for venue 2
insert into venue_memberships (venue_id, user_id, roles) values
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000007', array['admin']),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', array['organizer', 'staff'])
on conflict (venue_id, user_id) do nothing;

-- Create quotas for users at venue 1
insert into quotas (venue_id, user_id, default_count) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 50),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 20),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 0),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 10),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 15)
on conflict (venue_id, user_id) do nothing;

-- Create subscriptions
insert into subscriptions (venue_id, status) values
  ('10000000-0000-0000-0000-000000000001', 'active'),
  ('10000000-0000-0000-0000-000000000002', 'comped')
on conflict (venue_id) do nothing;

-- Create 1 event with status 'open'
insert into events (id, venue_id, name, date, status, landing_slug, landing_active) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Summer Party 2026', '2026-06-14', 'open'::event_status, 'summer-party-2026', true)
on conflict (venue_id, landing_slug) do nothing;

-- Add organizer to event
insert into event_organizers (event_id, user_id) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004')
on conflict (event_id, user_id) do nothing;

-- Create guest tiers for the event
insert into guest_tiers (id, event_id, name, description, color, max_count, aliases) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'VIP', 'VIP with bottle service', '#B5A6FF', 50, array['vip', 'fles', 'champagne']),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Regular', 'Regular entry', '#0B0B0D', 200, array['regular', 'regular']),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Plus One', 'Plus one guest', '#E8E4FF', 100, array['plus', '+1', 'plusone'])
on conflict (event_id, name) do nothing;

-- Create 30 guests for the event (mix of statuses)
insert into guests (id, event_id, tier_id, name, email, phone, plus_ones, added_by, source, status, created_at) values
  -- 10 VIP guests (approved/pending)
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'John Smith', 'john@example.com', '+31612345678', 0, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'approved'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Jane Doe', 'jane@example.com', '+31612345679', 1, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'approved'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Michael Johnson', null, null, 0, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Sarah Williams', 'sarah@example.com', null, 2, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'approved'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'David Brown', null, null, 0, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Lisa Anderson', 'lisa@example.com', '+31687654321', 1, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'checked_in'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Thomas Miller', null, null, 0, '00000000-0000-0000-0000-000000000004', 'landing'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Emma Taylor', 'emma@example.com', '+31698765432', 0, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'refused'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Christopher Martin', null, null, 1, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'denied'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Jennifer Garcia', 'jen@example.com', null, 0, '00000000-0000-0000-0000-000000000001', 'door'::guest_source, 'checked_in'::guest_status, now()),

  -- 10 Regular guests
  ('40000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Robert Wilson', null, null, 0, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'approved'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Maria Rodriguez', 'maria@example.com', '+31645678901', 1, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'approved'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Andrew Lee', null, null, 0, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Patricia Harris', 'patricia@example.com', null, 0, '00000000-0000-0000-0000-000000000006', 'door'::guest_source, 'checked_in'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'James Clark', null, null, 2, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'denied'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Linda White', 'linda@example.com', '+31656789012', 0, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Mark Thompson', null, null, 1, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'refused'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Nancy Jackson', 'nancy@example.com', null, 0, '00000000-0000-0000-0000-000000000006', 'landing'::guest_source, 'checked_in'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Paul Davis', null, null, 0, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Sandra Moore', 'sandra@example.com', '+31667890123', 0, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'approved'::guest_status, now()),

  -- 10 Plus One guests
  ('40000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Kevin Lewis', null, null, 0, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'approved'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Stephanie Walker', 'steph@example.com', '+31678901234', 1, '00000000-0000-0000-0000-000000000006', 'app'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Daniel Hall', null, null, 0, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'checked_in'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000024', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Rachel Allen', 'rachel@example.com', null, 0, '00000000-0000-0000-0000-000000000001', 'landing'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Matthew Young', null, null, 1, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'refused'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Susan Hernandez', 'susan@example.com', '+31689012345', 0, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'denied'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Steven King', null, null, 0, '00000000-0000-0000-0000-000000000006', 'door'::guest_source, 'checked_in'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000028', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Karen Wright', 'karen@example.com', null, 1, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'pending'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000029', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Brian Lopez', null, null, 0, '00000000-0000-0000-0000-000000000001', 'app'::guest_source, 'approved'::guest_status, now()),
  ('40000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Angela Scott', 'angela@example.com', '+31690123456', 0, '00000000-0000-0000-0000-000000000005', 'app'::guest_source, 'pending'::guest_status, now())
on conflict do nothing;

-- Revoke DELETE permissions for guests (hard delete prevention)
revoke delete on guests from authenticated;
