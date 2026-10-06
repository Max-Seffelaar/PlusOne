-- Notificaties N1 (z8uq9m2yvk) — bundle approval pushes under load.
--
-- Rule (onboarding plan okt 2026, §3/§4 taak 0c): per company (venue) and per
-- kind, more than 10 new requests within 60 minutes switches that
-- (venue, kind) to bundling for 24 hours: each approver then gets at most one
-- push per hour, carrying the count. `quota_request_decided` (the requester's
-- answer) is never bundled.
--
-- Shape:
--   * notification_throttle — one row per (venue, kind): when bundling began
--     and when it ends. Doubles as the per-(venue, kind) lock that makes the
--     threshold count race-free under concurrent inserts.
--   * notification_outbox.collapse_key + deliver_after — a bundled row is
--     queued 'pending' with next_attempt_at = deliver_after (the end of its
--     hourly slot), so nothing claims it before then. All rows of one slot
--     share one collapse_key.
--   * claim_push_outbox() claims a due slot as ONE row per recipient (the
--     newest member's payload + "count"), and complete_push_outbox() settles
--     every member of that slot with it. The RPC signatures and return shape
--     are unchanged (expand–contract: the deployed push-dispatch keeps
--     working and sends its single-request copy until it is redeployed with
--     the digest copy).
--   * "Hourly kick": no new schedule. deliver_after lands on the slot end and
--     the existing 2-minute plusone-push-outbox-sweep (20260925120100) wakes
--     push-dispatch as soon as a row is due. The insert-time kick now skips
--     rows that are not due yet, so a bundled insert no longer wakes the
--     function for nothing.
--
-- Counting: distinct source requests of that (venue, kind) in the outbox over
-- the last 60 minutes, bundled ones included. A request with no recipient
-- queues no row and so is not counted: nobody would have been pushed for it.
-- After the 24 hours a still-busy venue crosses the threshold on its next
-- request and bundles for another 24 hours; a quiet one is back to direct.
--
-- Payload stays ids-only (decision #50): the digest adds a number, never a
-- name. Delivery plumbing, not domain data: outside the audit-trigger set,
-- like the outbox itself.

-- ── notification_throttle ────────────────────────────────────────────────────
create table public.notification_throttle (
  venue_id uuid not null references public.venues (id) on delete cascade,
  kind text not null check (kind in ('quota_request_created', 'guest_request_created')),
  -- Start of the current/last bundling period; anchors the hourly slots.
  throttled_at timestamptz,
  throttled_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (venue_id, kind),
  check ((throttled_at is null) = (throttled_until is null)),
  check (throttled_until is null or throttled_until > throttled_at)
);

comment on table public.notification_throttle is
  'Push bundling state per (venue, kind) (N1, z8uq9m2yvk): >10 new requests in 60 min ⇒ 24 h of at most one push per hour per approver. Written only by the SECURITY DEFINER enqueue triggers; no app-role grants. Delivery plumbing: not audited.';

alter table public.notification_throttle enable row level security;
-- Grant matrix: closed to every app role (no policies, no grants), exactly
-- like notification_outbox. service_role keeps its defaults.
revoke all on table public.notification_throttle from anon, authenticated;

-- ── notification_outbox: bundling columns ────────────────────────────────────
alter table public.notification_outbox
  add column collapse_key text check (collapse_key is null or char_length(collapse_key) <= 200),
  add column deliver_after timestamptz;

alter table public.notification_outbox
  add constraint notification_outbox_collapse_shape
  check ((collapse_key is null) = (deliver_after is null));

-- Threshold count: (venue, kind) over the last hour.
create index notification_outbox_venue_kind_created_idx
  on public.notification_outbox (venue_id, kind, created_at);
-- Claiming a whole slot.
create index notification_outbox_collapse_idx
  on public.notification_outbox (collapse_key, recipient_user_id)
  where collapse_key is not null;

-- ── Bundling decision ───────────────────────────────────────────────────────
-- Returns (null, null) for a direct push, else the slot's collapse_key and
-- deliver_after. Locks the (venue, kind) throttle row for the rest of the
-- transaction, so two concurrent requests count each other (READ COMMITTED:
-- the waiter's next statement sees the first one's committed rows).
-- p_source is excluded from the count, so a replayed insert of a request that
-- is already queued never counts itself twice.
create or replace function public.notification_bundle_slot(
  p_venue uuid,
  p_kind text,
  p_source uuid
)
returns table (collapse_key text, deliver_after timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_at timestamptz;
  v_until timestamptz;
  v_recent integer;
  v_slot bigint;
begin
  if p_kind not in ('quota_request_created', 'guest_request_created') then
    return query select null::text, null::timestamptz;
    return;
  end if;

  -- Take the (venue, kind) lock without writing a tuple on every request:
  -- create the row once, then lock it. A wait longer than lock_timeout (the
  -- function attribute below) degrades to a direct push instead of failing
  -- the request (#50: broken push plumbing never costs the request).
  begin
    insert into public.notification_throttle (venue_id, kind)
    values (p_venue, p_kind)
    on conflict (venue_id, kind) do nothing;

    select t.throttled_at, t.throttled_until into v_at, v_until
    from public.notification_throttle t
    where t.venue_id = p_venue and t.kind = p_kind
    for update;
  exception when lock_not_available then
    return query select null::text, null::timestamptz;
    return;
  end;

  if v_until is null or v_until <= now() then
    select count(distinct o.source_id)::integer into v_recent
    from public.notification_outbox o
    where o.venue_id = p_venue
      and o.kind = p_kind
      and o.created_at > now() - interval '60 minutes'
      and o.source_id <> p_source;

    -- This request is number v_recent + 1; more than 10 ⇒ bundle.
    if v_recent + 1 <= 10 then
      return query select null::text, null::timestamptz;
      return;
    end if;

    v_at := now();
    v_until := now() + interval '24 hours';
    update public.notification_throttle t
    set throttled_at = v_at, throttled_until = v_until, updated_at = now()
    where t.venue_id = p_venue and t.kind = p_kind;
  end if;

  -- Hourly slots anchored at the start of the bundling period: slot n covers
  -- [at + n h, at + (n+1) h) and is delivered at its end.
  v_slot := floor(extract(epoch from (now() - v_at)) / 3600)::bigint;
  return query select
    'digest:' || p_kind || ':' || p_venue || ':'
      || floor(extract(epoch from v_at))::bigint || ':' || v_slot,
    v_at + make_interval(hours => (v_slot + 1)::int);
end;
$$;

revoke execute on function public.notification_bundle_slot(uuid, text, uuid) from public, anon, authenticated, service_role;

-- ── Enqueue triggers (20260925120000), now bundling the two "created" kinds ──
-- Unchanged otherwise: same recipients, same dedupe keys, same failure
-- isolation. quota_request_decided keeps its direct path.

create or replace function public.enqueue_quota_request_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_after timestamptz;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'pending' then
        select s.collapse_key, s.deliver_after into v_key, v_after
        from public.notification_bundle_slot(new.venue_id, 'quota_request_created', new.id) s;

        insert into public.notification_outbox
          (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload,
           collapse_key, deliver_after, next_attempt_at)
        select
          'quota_request_created', new.id, new.venue_id, m.user_id,
          'quota_request_created:' || new.id,
          jsonb_build_object(
            'kind', 'quota_request_created',
            'venue_id', new.venue_id,
            'event_id', new.event_id,
            'request_id', new.id),
          v_key, v_after, coalesce(v_after, now())
        from public.venue_memberships m
        where m.venue_id = new.venue_id
          and m.roles @> '{admin}'::public.venue_role[]
          and m.user_id <> new.user_id
        on conflict (dedupe_key, recipient_user_id) do nothing;
      end if;
    elsif new.status is distinct from old.status and new.status <> 'pending' then
      -- Never bundled: the requester waits for exactly this answer.
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
declare
  v_key text;
  v_after timestamptz;
begin
  begin
    -- Only a request that actually lands in the inbox: an auto-approved one
    -- (request link with auto_approve) is inserted already decided.
    if new.status = 'pending' then
      select s.collapse_key, s.deliver_after into v_key, v_after
      from public.notification_bundle_slot(new.venue_id, 'guest_request_created', new.id) s;

      insert into public.notification_outbox
        (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload,
         collapse_key, deliver_after, next_attempt_at)
      select
        'guest_request_created', new.id, new.venue_id, r.user_id,
        'guest_request_created:' || new.id,
        jsonb_build_object(
          'kind', 'guest_request_created',
          'venue_id', new.venue_id,
          'event_id', new.event_id,
          'request_id', new.id),
        v_key, v_after, coalesce(v_after, now())
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

-- ── Insert-time kick: only for rows that are due now ────────────────────────
-- A bundled row waits for its slot end; the 2-minute sweep wakes the function
-- then.
create or replace function public.notification_outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from new_rows where status = 'pending' and next_attempt_at <= now()) then
    perform public.kick_push_dispatch();
  end if;
  return null;
exception when others then
  raise warning 'push dispatch kick trigger failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

revoke execute on function public.notification_outbox_kick() from public, anon, authenticated, service_role;

-- ── Claim: one row per due slot per recipient ───────────────────────────────
-- Same signature and return shape as 20260925120100. A due row that belongs
-- to a slot pulls in every other due member of that slot for that recipient
-- (even beyond p_limit), so a slot is never split within one claim. The slot
-- is returned once: the newest member's id and payload, plus "count" (the
-- number of requests in it). complete_push_outbox() on that id settles the
-- whole slot.
create or replace function public.claim_push_outbox(p_token text, p_limit integer default 200)
returns table (
  id uuid,
  kind text,
  payload jsonb,
  attempts integer,
  tokens jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Consume: a null token matches nothing, an expired one is left for the sweep.
  delete from public.push_dispatch_tokens t
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select o.id, o.collapse_key, o.recipient_user_id
    from public.notification_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.next_attempt_at
    limit least(greatest(coalesce(p_limit, 200), 1), 200)
    for update skip locked
  ),
  slot_members as (
    select o.id
    from public.notification_outbox o
    where o.status = 'pending'
      and o.next_attempt_at <= now()
      and o.collapse_key is not null
      and (o.collapse_key, o.recipient_user_id) in (
        select d.collapse_key, d.recipient_user_id from due d where d.collapse_key is not null)
    for update skip locked
  ),
  claimed as (
    update public.notification_outbox o
    set status = 'sending', attempts = o.attempts + 1, locked_at = now()
    where o.id in (select due.id from due union select slot_members.id from slot_members)
    returning o.id, o.kind, o.payload, o.attempts, o.recipient_user_id, o.collapse_key
  ),
  grouped as (
    -- Direct rows: one group each.
    select c.id, c.kind, c.payload, c.attempts, c.recipient_user_id
    from claimed c
    where c.collapse_key is null
    union all
    -- A slot: the newest member (UUIDv7 ids are time-ordered) speaks for it.
    (select distinct on (c.collapse_key, c.recipient_user_id)
      c.id, c.kind,
      c.payload || jsonb_build_object(
        'count', count(*) over (partition by c.collapse_key, c.recipient_user_id)),
      max(c.attempts) over (partition by c.collapse_key, c.recipient_user_id),
      c.recipient_user_id
    from claimed c
    where c.collapse_key is not null
    order by c.collapse_key, c.recipient_user_id, c.id desc)
  )
  select
    g.id, g.kind, g.payload, g.attempts,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'token', t.token))
      from public.push_tokens t
      where t.user_id = g.recipient_user_id
        and t.transport = 'fcm'
        and exists (select 1 from auth.sessions s where s.id = t.session_id)
    ), '[]'::jsonb)
  from grouped g;
end;
$$;

-- ── Complete: settle the whole slot ──────────────────────────────────────────
-- Same signature and outcomes as 20260925120100. For a slot's representative
-- the update covers every member of that slot for that recipient that is
-- currently 'sending' (they were claimed together); attempts/backoff are
-- computed per row, so a retried slot stays together on the next claim.
create or replace function public.complete_push_outbox(
  p_id uuid,
  p_outcome text,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_key text;
  v_recipient uuid;
  v_locked_at timestamptz;
begin
  if p_outcome not in ('sent', 'skipped', 'retry', 'failed') then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;

  select o.collapse_key, o.recipient_user_id, o.locked_at into v_key, v_recipient, v_locked_at
  from public.notification_outbox o
  where o.id = p_id and o.status = 'sending';
  if not found then
    -- Same contract as before: only a row currently 'sending' moves.
    return null;
  end if;

  update public.notification_outbox o
  set status = case
                 when p_outcome = 'retry' and o.attempts >= 5 then 'failed'
                 when p_outcome = 'retry' then 'pending'
                 else p_outcome
               end,
      next_attempt_at = case
                          when p_outcome = 'retry'
                            then now() + make_interval(mins => power(2, least(o.attempts, 10))::int)
                          else o.next_attempt_at
                        end,
      last_error = left(p_error, 500),
      locked_at = null,
      sent_at = case when p_outcome = 'sent' then now() else o.sent_at end
  where o.status = 'sending'
    and (o.id = p_id
         or (v_key is not null
             and o.collapse_key = v_key
             and o.recipient_user_id = v_recipient
             -- Only this claim's members (one now() per claim): a slot
             -- member another invocation holds is that invocation's to settle.
             and o.locked_at = v_locked_at));

  select o.status into v_status
  from public.notification_outbox o
  where o.id = p_id;
  return v_status;
end;
$$;

revoke execute on function public.claim_push_outbox(text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.complete_push_outbox(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_push_outbox(text, integer) to service_role;
grant execute on function public.complete_push_outbox(uuid, text, text) to service_role;
