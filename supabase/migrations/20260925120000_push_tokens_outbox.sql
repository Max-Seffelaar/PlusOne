-- Fase 17 N2 (86ey6bfbe) 1/3 — push_tokens + notification_outbox + the
-- approvals-loop enqueue triggers.
--
-- Design of record: capacitor-plan-claude-code.md §2 (decisions 1–4, 13) and
-- §3 (push architecture). This migration only STORES; dispatch (pg_net → the
-- push-dispatch Edge Function, pg_cron retry/TTL) is 20260925120100, and the
-- remote-logout hook is 20260925120200.
--
-- Both tables are device/delivery plumbing, not domain data: they are
-- deliberately OUTSIDE the audit-trigger set (rule #4 covers guests, quotas,
-- event_quotas, guest_tiers, check_ins) and a hard DELETE on push_tokens is the
-- intended domain action (an unregistered device row), not a soft-delete
-- violation (#21). Recorded in the spec decision table.

-- ── push_tokens ──────────────────────────────────────────────────────────────
-- One row per device registration. Online-only (registered from a live
-- session), so gen_random_uuid() — no client-side UUIDv7 needed (#25 is for
-- offline-creatable rows).
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- auth session id from the JWT `session_id` claim. The default means a
  -- client never has to send one; push_tokens_stamp() below overwrites
  -- whatever an end-user write carries anyway. No FK into auth.sessions
  -- (cross-schema coupling to a GoTrue-owned table); revocation deletes by
  -- value instead (20260925120200) and dispatch only ever delivers to tokens
  -- whose session still exists (20260925120100).
  session_id uuid not null default (nullif(auth.jwt() ->> 'session_id', ''))::uuid,
  transport text not null check (transport in ('web-push', 'fcm', 'apns')),
  token text not null check (char_length(token) between 1 and 4096),
  device_label text check (device_label is null or char_length(device_label) <= 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (transport, token)
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);
create index push_tokens_session_id_idx on public.push_tokens (session_id);
create index push_tokens_last_seen_at_idx on public.push_tokens (last_seen_at);

comment on table public.push_tokens is
  'Device push registrations (Fase 17 N2). Owner-only RLS; session_id stamped from the JWT; deleted on revoke_own_session/admin_revoke_session and by the 90-day TTL sweep. Device plumbing: not audited, hard delete intended.';

-- Session binding + device handover. SECURITY DEFINER because the INSERT
-- branch removes a row owned by ANOTHER user: possession of the device token
-- wins (orchestrator decision 2026-09-24, spec #50). An FCM/APNs token only
-- exists inside the app on that one device, so whoever registers it from a
-- live session of their own is the device's current user — the shared door
-- tablet case, where the previous user's session row may linger for days
-- after they walked away (GoTrue deletes timeboxed sessions lazily). The
-- delete is narrow: same (transport, token) only, never another row of the
-- previous owner, and only after the caller's identity checks below passed.
--
-- Stamping applies to end-user JWTs only (auth.uid() not null). service_role
-- and the table owner (migrations, seed, pgTAP fixtures) write as given.
create or replace function public.push_tokens_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_sid is null then
    raise exception 'push token requires a session' using errcode = '42501';
  end if;
  new.session_id := v_sid;

  if tg_op = 'INSERT' then
    -- Checked here, not only by the INSERT policy (which runs after this
    -- trigger): the handover delete below must never run for a forged owner.
    if new.user_id is distinct from (select auth.uid()) then
      raise exception 'push token owner must be the caller' using errcode = '42501';
    end if;
    new.created_at := now();
    new.last_seen_at := now();
    delete from public.push_tokens p
    where p.transport = new.transport
      and p.token = new.token
      and p.user_id <> new.user_id;
  else
    -- Identity of the row is not the client's to rewrite.
    new.id := old.id;
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.push_tokens_stamp() from public, anon, authenticated, service_role;

create trigger push_tokens_stamp
  before insert or update on public.push_tokens
  for each row execute function public.push_tokens_stamp();

alter table public.push_tokens enable row level security;

-- Owner-only on every verb. Deliberately WITHOUT the is_platform_admin()
-- disjunct (#49): a device token is a personal delivery address, not venue
-- data, and support never needs to read or write one.
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_tokens_insert_own on public.push_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy push_tokens_update_own on public.push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Grant matrix (convention since 20260917100000): revoke first, then open
-- exactly what the flow needs. DELETE is intended (unregister on sign-out,
-- N5) and allowlisted in grant_matrix.test.sql.
revoke all on table public.push_tokens from anon, authenticated;
grant select, insert, update, delete on table public.push_tokens to authenticated;

-- ── notification_outbox ──────────────────────────────────────────────────────
-- One row per (notification, recipient). Written only by the triggers below
-- (SECURITY DEFINER), read/advanced only by the service_role RPCs in
-- 20260925120100. No app role holds anything on it.
--
-- The payload carries ids and a kind, never names/e-mails: it travels to
-- Google (FCM) and Apple (APNs), and the device resolves the rest after the
-- tap under its own RLS.
create table public.notification_outbox (
  id uuid primary key default public.uuid_generate_v7(),
  kind text not null check (kind in (
    'quota_request_created', 'guest_request_created', 'quota_request_decided')),
  source_id uuid not null,
  venue_id uuid not null references public.venues (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  -- Idempotency: one row per (event-in-the-world, recipient). A re-fired
  -- trigger or a replayed statement lands on the unique key and is dropped.
  dedupe_key text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dedupe_key, recipient_user_id)
);

create index notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at)
  where status = 'pending';
create index notification_outbox_sending_idx
  on public.notification_outbox (locked_at)
  where status = 'sending';
create index notification_outbox_created_at_idx on public.notification_outbox (created_at);

comment on table public.notification_outbox is
  'Push outbox (Fase 17 N2): filled by AFTER triggers on quota_requests/guest_requests, drained by the push-dispatch Edge Function via service_role RPCs. No anon/authenticated grants. Delivery plumbing: not audited.';

alter table public.notification_outbox enable row level security;
-- No policies: RLS on + zero grants = closed to every app role. service_role
-- keeps its defaults (trusted server role, bypasses RLS by design).
revoke all on table public.notification_outbox from anon, authenticated;

-- ── Enqueue triggers (the approvals loop, decision 4) ───────────────────────
-- (a) staff quota request created  → the venue's admins (who can approve it:
--     approve_quota_request is admin-only)
-- (b) guest request created        → the venue's admins + that event's
--     organizers (approve_guest_request's exact gate)
-- (c) quota request decided        → the requester AS FILED (old.user_id:
--     authenticated still holds a table-wide UPDATE on quota_requests and the
--     decide policy does not pin user_id, so new.user_id is client-writable;
--     narrowing that column grant is a separate task)
--
-- Recipients are resolved from venue_memberships/event_organizers of the
-- ROW's venue/event directly — never through has_venue_role()/is_*() helpers,
-- which read auth.uid() and carry the platform-admin bypass (#49). A member of
-- another venue can therefore never be a recipient.
--
-- A guest request's "requester" is a public applicant without an account, so
-- there is no push target for its decision; the applicant keeps the existing
-- status page (/r/[token]).
--
-- Failure isolation: the whole body runs in its own exception block. Broken
-- push plumbing costs a notification (warning in the Postgres log), never the
-- request itself.

create or replace function public.enqueue_quota_request_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'pending' then
        insert into public.notification_outbox
          (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload)
        select
          'quota_request_created', new.id, new.venue_id, m.user_id,
          'quota_request_created:' || new.id,
          jsonb_build_object(
            'kind', 'quota_request_created',
            'venue_id', new.venue_id,
            'event_id', new.event_id,
            'request_id', new.id)
        from public.venue_memberships m
        where m.venue_id = new.venue_id
          and m.roles @> '{admin}'::public.venue_role[]
          and m.user_id <> new.user_id
        on conflict (dedupe_key, recipient_user_id) do nothing;
      end if;
    elsif new.status is distinct from old.status and new.status <> 'pending' then
      insert into public.notification_outbox
        (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload)
      select
        'quota_request_decided', new.id, new.venue_id, old.user_id,
        'quota_request_decided:' || new.id || ':' || new.status,
        jsonb_build_object(
          'kind', 'quota_request_decided',
          'venue_id', new.venue_id,
          'event_id', new.event_id,
          'request_id', new.id,
          'status', new.status)
      where new.decided_by is distinct from old.user_id
      on conflict (dedupe_key, recipient_user_id) do nothing;
    end if;
  exception when others then
    raise warning 'push enqueue skipped for quota_request %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

create or replace function public.enqueue_guest_request_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    -- Only a request that actually lands in the inbox: an auto-approved one
    -- (request link with auto_approve) is inserted already decided.
    if new.status = 'pending' then
      insert into public.notification_outbox
        (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload)
      select
        'guest_request_created', new.id, new.venue_id, r.user_id,
        'guest_request_created:' || new.id,
        jsonb_build_object(
          'kind', 'guest_request_created',
          'venue_id', new.venue_id,
          'event_id', new.event_id,
          'request_id', new.id)
      from (
        select m.user_id
        from public.venue_memberships m
        where m.venue_id = new.venue_id
          and m.roles @> '{admin}'::public.venue_role[]
        union
        select o.user_id
        from public.event_organizers o
        join public.events e on e.id = o.event_id
        where o.event_id = new.event_id
          and e.venue_id = new.venue_id
      ) r
      on conflict (dedupe_key, recipient_user_id) do nothing;
    end if;
  exception when others then
    raise warning 'push enqueue skipped for guest_request %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke execute on function public.enqueue_quota_request_push() from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_guest_request_push() from public, anon, authenticated, service_role;

create trigger quota_requests_enqueue_push
  after insert or update of status on public.quota_requests
  for each row execute function public.enqueue_quota_request_push();

create trigger guest_requests_enqueue_push
  after insert on public.guest_requests
  for each row execute function public.enqueue_guest_request_push();
