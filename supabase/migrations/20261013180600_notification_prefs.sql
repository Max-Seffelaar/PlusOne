-- Gastcommunicatie F, PR 6b (z8uq9m2vpy): team mail + notification preferences.
--
-- Decision Max 2026-10-06 (comment on the task): team members get mail through
-- the same Resend infra as guests, with preferences per user.
--   * every guest-list request straight to the approvers, with the push
--     bundle rule (>10 in 60 min -> one mail per hour with the count);
--   * a quota request straight to the admins;
--   * the decision back to the requester;
--   * a daily summary at 09:00 Europe/Amsterdam of what is still open, per
--     approver; no mail when nothing is open.
-- Preferences in Profile, an unsubscribe link in every team mail.
--
-- What this migration adds:
--   1. mail_log.type gains team_request / team_quota / team_decision /
--      team_digest, additively (same DO block as 20261013180000). They stay
--      out of the invitation limits (60 s recipient window, 25/day company
--      cap): the bundle rule and the preferences bound their volume, and a
--      burst of requests must never block an invite (or the other way round).
--      log_mail_attempt refuses them: team mails go through team_mails_claim.
--   2. user_notification_prefs (one row per user, validated inline, defaults
--      applied on read). Its own table, not a user_profiles column: app roles
--      hold a table-level SELECT on user_profiles, so a new column there would
--      be readable on every profile RLS shows (a colleague's), and a column
--      revoke cannot narrow a table grant. This table has RLS on and no grants
--      at all; the user reads and writes their own row only, through
--      my_notification_prefs / set_my_notification_prefs.
--   3. notification_outbox.channel ('push' | 'email', existing rows push).
--      The enqueue triggers write one row per recipient per channel, per that
--      recipient's preferences; the email rows reuse the push bundle slot
--      (collapse_key / deliver_after). The push dispatcher only ever claims
--      push rows; its sweep only un-sticks push rows (a stuck email row is an
--      unknown outcome, never re-sent).
--   4. The email job: team_mails_claim (merges a bundle slot into one mail,
--      re-checks preference, access and the request at send time, writes
--      mail_log, mints the unsubscribe token) + team_mails_settle, and the
--      daily summary in the same claim between 09:00 and 11:59 Amsterdam,
--      once per user per day (team_digest_deliveries). Kicked by the outbox
--      insert trigger and a one-minute pg_cron tick through the Vault secret
--      plusone_team_mails_url, the single-use-token pattern of guest mail.
--   5. unsubscribe_team_mail (anon, /n/[token]): turns that mail's kind off.
--      The bound 'st' throttle is spent only on a miss (same rule as
--      unsubscribe_guest_mail after review S3).
--
-- Never in the door path: requests and quota come from their own screens.

-- ---------------------------------------------------------------------------
-- 1. mail_log types (additive) + out of the invitation limits
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_types text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'mail_log_type_check'
     and c.conrelid = 'public.mail_log'::regclass;

  select array_agg(m[1]) into v_types
    from regexp_matches(coalesce(v_def, ''), '''([a-z0-9_]+)''', 'g') as m;

  v_types := array(
    select distinct t from unnest(coalesce(v_types, '{}'::text[]) || array[
      'team_request', 'team_quota', 'team_decision', 'team_digest'
    ]) as t
    order by t);

  alter table public.mail_log drop constraint if exists mail_log_type_check;
  execute format(
    'alter table public.mail_log add constraint mail_log_type_check check (type in (%s))',
    (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_types) as t));
end;
$$;

-- Bodies: the live 20261013180000 ones plus the four team notification types.
create or replace function public.mail_venue_cap_reached(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= public.mail_venue_daily_cap()
    from public.mail_log m
   where m.venue_id = p_venue_id
     and m.status <> 'failed'
     and m.type not like 'billing\_%'
     and m.type not like 'guest\_%'
     and m.type not in ('team_request', 'team_quota', 'team_decision', 'team_digest')
     and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

comment on function public.mail_venue_cap_reached(uuid) is
  'True when the venue sent mail_venue_daily_cap() invitation mails (failed '
  'attempts excluded since 20261011120000, billing mails since 20261013170000, '
  'guest mails since 20261013180000, team notification mails since '
  '20261013180600) in the current UTC day. service_role only.';

create or replace function public.log_mail_attempt(
  p_type text,
  p_venue_id uuid,
  p_recipient_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Billing, guest and team notification mails have their own paths.
  if p_type like 'billing\_%' then
    raise exception 'billing mails go through log_billing_mail' using errcode = '22023';
  end if;
  -- The nine guest types only: an unknown guest_* type still falls through to
  -- the type check constraint (23514), like any other unknown type.
  if p_type in ('guest_on_list', 'guest_plus_ones', 'guest_event_changed',
                'guest_event_canceled', 'guest_removed', 'guest_reminder',
                'guest_request_approved', 'guest_request_partly', 'guest_request_declined') then
    raise exception 'guest mails go through guest_mails_claim' using errcode = '22023';
  end if;
  if p_type in ('team_request', 'team_quota', 'team_decision', 'team_digest') then
    raise exception 'team notification mails go through team_mails_claim' using errcode = '22023';
  end if;

  -- Serialise concurrent sends to one recipient so two parallel calls can't
  -- both pass the window check.
  perform pg_advisory_xact_lock(hashtextextended('mail_log:' || coalesce(p_recipient_hash, ''), 0));

  -- The decline mails are exempt from the window and do not start one. A
  -- failed attempt (nothing went out) does not start one either, and neither
  -- does the platform digest (20261013150000), a billing, a guest or a team
  -- notification mail.
  if p_type not in ('team_invite_declined', 'team_invite_declined_confirm')
     and exists (
       select 1 from public.mail_log m
        where m.recipient_hash = p_recipient_hash
          and m.type not in ('team_invite_declined', 'team_invite_declined_confirm', 'platform_digest',
                             'team_request', 'team_quota', 'team_decision', 'team_digest')
          and m.type not like 'billing\_%'
          and m.type not like 'guest\_%'
          and m.status <> 'failed'
          and m.created_at > now() - public.mail_recipient_window()
     ) then
    raise exception 'mail throttled: recipient' using errcode = 'PM429';
  end if;

  if p_venue_id is not null and public.mail_venue_cap_reached(p_venue_id) then
    raise exception 'mail throttled: venue daily cap' using errcode = 'PM429';
  end if;

  insert into public.mail_log (type, venue_id, recipient_hash)
  values (p_type, p_venue_id, p_recipient_hash)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_mail_attempt(text, uuid, text) is
  'Mail sender (service_role): record a queued send and return its id '
  '(= the Resend Idempotency-Key). Refuses (PM429) a second mail to the same '
  'recipient within mail_recipient_window() (the two decline mail types are '
  'exempt, 20261007150100; failed attempts do not count, 20261011120000; a '
  'platform_digest row does not count, 20261013150000; billing mails neither '
  'count nor pass here, 20261013170000; guest mails neither, 20261013180000; '
  'team notification mails neither, 20261013180600) and a venue past '
  'mail_venue_daily_cap() for the UTC day. Check constraints validate the input.';

-- ---------------------------------------------------------------------------
-- 2. Notification preferences
-- ---------------------------------------------------------------------------
-- Shape (every key optional; a missing key takes its default):
--   { "requests":  { "push": bool, "email": "immediate" | "daily" | "off" },
--     "quota":     { "push": bool, "email": "immediate" | "daily" | "off" },
--     "decisions": { "push": bool, "email": bool },
--     "digest":    bool }
-- Defaults: push on, email immediate for requests and quota, decision mail
-- on, daily summary on. "daily" = no mail per request, only in the summary.
-- The check is inline SQL on purpose: a function in a CHECK runs with the
-- privileges of whoever inserts the row (the auth signup trigger included).

create table public.user_notification_prefs (
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  notification_prefs jsonb not null default '{}'::jsonb
    constraint user_notification_prefs_check check (
      jsonb_typeof(notification_prefs) = 'object'
      and pg_column_size(notification_prefs) <= 1024
      and (notification_prefs - array['requests', 'quota', 'decisions', 'digest']) = '{}'::jsonb
      and (not notification_prefs ? 'digest'
           or jsonb_typeof(notification_prefs -> 'digest') = 'boolean')
      and (not notification_prefs ? 'requests' or (
           jsonb_typeof(notification_prefs -> 'requests') = 'object'
           and ((notification_prefs -> 'requests') - array['push', 'email']) = '{}'::jsonb
           and (not (notification_prefs -> 'requests') ? 'push'
                or jsonb_typeof(notification_prefs -> 'requests' -> 'push') = 'boolean')
           and (not (notification_prefs -> 'requests') ? 'email'
                or (notification_prefs -> 'requests' ->> 'email') in ('immediate', 'daily', 'off'))))
      and (not notification_prefs ? 'quota' or (
           jsonb_typeof(notification_prefs -> 'quota') = 'object'
           and ((notification_prefs -> 'quota') - array['push', 'email']) = '{}'::jsonb
           and (not (notification_prefs -> 'quota') ? 'push'
                or jsonb_typeof(notification_prefs -> 'quota' -> 'push') = 'boolean')
           and (not (notification_prefs -> 'quota') ? 'email'
                or (notification_prefs -> 'quota' ->> 'email') in ('immediate', 'daily', 'off'))))
      and (not notification_prefs ? 'decisions' or (
           jsonb_typeof(notification_prefs -> 'decisions') = 'object'
           and ((notification_prefs -> 'decisions') - array['push', 'email']) = '{}'::jsonb
           and (not (notification_prefs -> 'decisions') ? 'push'
                or jsonb_typeof(notification_prefs -> 'decisions' -> 'push') = 'boolean')
           and (not (notification_prefs -> 'decisions') ? 'email'
                or jsonb_typeof(notification_prefs -> 'decisions' -> 'email') = 'boolean')))
    ),
  updated_at timestamptz not null default now()
);
alter table public.user_notification_prefs enable row level security;

comment on table public.user_notification_prefs is
  'Team notification preferences per kind (requests, quota, decisions) and the '
  'daily summary; no row or a missing key = the defaults (20261013180600). '
  'No app-role grants: read/write only through my_notification_prefs / '
  'set_my_notification_prefs (own row) and unsubscribe_team_mail (token).';

-- The stored object with every default filled in.
create or replace function public.notification_prefs_effective(p_prefs jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'requests', '{"push": true, "email": "immediate"}'::jsonb || coalesce(p_prefs -> 'requests', '{}'::jsonb),
    'quota', '{"push": true, "email": "immediate"}'::jsonb || coalesce(p_prefs -> 'quota', '{}'::jsonb),
    'decisions', '{"push": true, "email": true}'::jsonb || coalesce(p_prefs -> 'decisions', '{}'::jsonb),
    'digest', coalesce(p_prefs -> 'digest', 'true'::jsonb));
$$;

create or replace function public.my_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null
              else public.notification_prefs_effective(coalesce(
                (select n.notification_prefs from public.user_notification_prefs n
                  where n.user_id = auth.uid()), '{}'::jsonb)) end;
$$;

comment on function public.my_notification_prefs() is
  'The caller''s own notification preferences, defaults filled in (null for anon).';

-- Replace the caller's preferences. The input is merged over the defaults and
-- stored complete; the CHECK rejects anything off-shape (23514).
create or replace function public.set_my_notification_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception 'preferences must be an object' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_profiles p where p.id = auth.uid()) then
    raise exception 'no profile' using errcode = '42501';
  end if;
  insert into public.user_notification_prefs as n (user_id, notification_prefs, updated_at)
  values (auth.uid(), public.notification_prefs_effective(p_prefs), now())
  on conflict (user_id) do update
     set notification_prefs = excluded.notification_prefs, updated_at = now()
  returning public.notification_prefs_effective(n.notification_prefs) into v_out;
  return v_out;
end;
$$;

comment on function public.set_my_notification_prefs(jsonb) is
  'Store the caller''s own notification preferences (complete object, defaults '
  'for missing keys). Own row only: there is no user argument.';

-- ---------------------------------------------------------------------------
-- 3. notification_outbox.channel + per-preference fan-out
-- ---------------------------------------------------------------------------

alter table public.notification_outbox
  add column channel text not null default 'push'
    constraint notification_outbox_channel_check check (channel in ('push', 'email'));

alter table public.notification_outbox
  drop constraint notification_outbox_dedupe_key_recipient_user_id_key;
alter table public.notification_outbox
  add constraint notification_outbox_dedupe_recipient_channel_key
  unique (dedupe_key, recipient_user_id, channel);

create index notification_outbox_email_due_idx
  on public.notification_outbox (next_attempt_at)
  where status = 'pending' and channel = 'email';

comment on column public.notification_outbox.channel is
  'push (the push dispatcher) or email (the team mail job), one row per '
  'recipient per channel per preference (20261013180600).';

-- Enqueue triggers: the 20261007110000 bodies (same recipients, dedupe keys,
-- bundle slot, failure isolation), now one row per recipient per channel the
-- recipient wants. The slot is decided once per request and shared by both
-- channels, so a bundled hour is one push and one mail.

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
           collapse_key, deliver_after, next_attempt_at, channel)
        select
          'quota_request_created', new.id, new.venue_id, r.user_id,
          'quota_request_created:' || new.id,
          jsonb_build_object(
            'kind', 'quota_request_created',
            'venue_id', new.venue_id,
            'event_id', new.event_id,
            'request_id', new.id),
          v_key, v_after, coalesce(v_after, now()), ch.channel
        from (
          select m.user_id, public.notification_prefs_effective(coalesce(p.notification_prefs, '{}'::jsonb)) as prefs
          from public.venue_memberships m
          left join public.user_notification_prefs p on p.user_id = m.user_id
          where m.venue_id = new.venue_id
            and m.roles @> '{admin}'::public.venue_role[]
            and m.user_id <> new.user_id
        ) r
        cross join (values ('push'), ('email')) as ch(channel)
        where (ch.channel = 'push' and (r.prefs -> 'quota' ->> 'push')::boolean)
           or (ch.channel = 'email' and r.prefs -> 'quota' ->> 'email' = 'immediate')
        on conflict (dedupe_key, recipient_user_id, channel) do nothing;
      end if;
    elsif new.status is distinct from old.status and new.status <> 'pending' then
      -- Never bundled: the requester waits for exactly this answer.
      insert into public.notification_outbox
        (kind, source_id, venue_id, recipient_user_id, dedupe_key, payload, channel)
      select
        'quota_request_decided', new.id, new.venue_id, old.user_id,
        'quota_request_decided:' || new.id || ':' || new.status,
        jsonb_build_object(
          'kind', 'quota_request_decided',
          'venue_id', new.venue_id,
          'event_id', new.event_id,
          'request_id', new.id,
          'status', new.status),
        ch.channel
      from (
        select public.notification_prefs_effective(coalesce(
          (select p.notification_prefs from public.user_notification_prefs p where p.user_id = old.user_id),
          '{}'::jsonb)) as prefs
      ) r
      cross join (values ('push'), ('email')) as ch(channel)
      where new.decided_by is distinct from old.user_id
        and ((ch.channel = 'push' and (r.prefs -> 'decisions' ->> 'push')::boolean)
          or (ch.channel = 'email' and (r.prefs -> 'decisions' ->> 'email')::boolean))
      on conflict (dedupe_key, recipient_user_id, channel) do nothing;
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
         collapse_key, deliver_after, next_attempt_at, channel)
      select
        'guest_request_created', new.id, new.venue_id, r.user_id,
        'guest_request_created:' || new.id,
        jsonb_build_object(
          'kind', 'guest_request_created',
          'venue_id', new.venue_id,
          'event_id', new.event_id,
          'request_id', new.id),
        v_key, v_after, coalesce(v_after, now()), ch.channel
      from (
        select a.user_id, public.notification_prefs_effective(coalesce(p.notification_prefs, '{}'::jsonb)) as prefs
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
        ) a
        left join public.user_notification_prefs p on p.user_id = a.user_id
      ) r
      cross join (values ('push'), ('email')) as ch(channel)
      where (ch.channel = 'push' and (r.prefs -> 'requests' ->> 'push')::boolean)
         or (ch.channel = 'email' and r.prefs -> 'requests' ->> 'email' = 'immediate')
      on conflict (dedupe_key, recipient_user_id, channel) do nothing;
    end if;
  exception when others then
    raise warning 'push enqueue skipped for guest_request %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3b. The push dispatcher keeps to push rows
-- ---------------------------------------------------------------------------
-- claim_push_outbox: the 20261007110000 body with channel = 'push' in the two
-- row sources (due + slot_members); nothing else changed.

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
      and o.channel = 'push'
    order by o.next_attempt_at
    limit least(greatest(coalesce(p_limit, 200), 1), 200)
    for update skip locked
  ),
  slot_members as (
    select o.id
    from public.notification_outbox o
    where o.status = 'pending'
      and o.next_attempt_at <= now()
      and o.channel = 'push'
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

-- push_outbox_sweep: the 20260925120100 body with channel = 'push' on the
-- un-stick and on the due count. A stuck email row is the team mail claim's
-- (failed as unknown_outcome, never re-sent).
create or replace function public.push_outbox_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due integer;
begin
  update public.notification_outbox o
  set status = case when o.attempts >= 5 then 'failed' else 'pending' end,
      last_error = coalesce(o.last_error, 'stuck in sending'),
      locked_at = null
  where o.status = 'sending' and o.locked_at < now() - interval '5 minutes'
    and o.channel = 'push';

  -- Tokens of kicks that never reached the function (or were never used).
  delete from public.push_dispatch_tokens t
  where t.created_at < now() - interval '10 minutes';

  select count(*)::integer into v_due
  from public.notification_outbox o
  where o.status = 'pending' and o.next_attempt_at <= now()
    and o.channel = 'push';

  if v_due > 0 then
    perform public.kick_push_dispatch();
  end if;
  return v_due;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The team mail job
-- ---------------------------------------------------------------------------

-- Single-use tokens for the pg_net kick (same pattern as guest mail).
create table public.team_mail_tokens (
  token_hash bytea primary key,
  created_at timestamptz not null default now()
);
alter table public.team_mail_tokens enable row level security;

-- Unsubscribe links: sha256 (hex) of the per-mail token, the user and the
-- kind the link turns off.
create table public.team_mail_links (
  token_hash text primary key
    constraint team_mail_links_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  pref text not null
    constraint team_mail_links_pref_check check (pref in ('requests', 'quota', 'decisions', 'digest')),
  mail_log_id uuid references public.mail_log (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.team_mail_links enable row level security;
create index team_mail_links_expires_idx on public.team_mail_links (expires_at);

-- One daily summary per user per Amsterdam day.
create table public.team_digest_deliveries (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  local_date date not null,
  mail_log_id uuid references public.mail_log (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table public.team_digest_deliveries enable row level security;

-- An open request is pending on an event that is not cancelled and not over.
-- Users due a summary on p_today: summary on, some kind not off, at least one
-- open item they decide on, and no summary yet today.
create or replace function public.team_digest_due(p_today date, p_limit integer)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.user_profiles p
    cross join lateral (select public.notification_prefs_effective(coalesce(
      (select n.notification_prefs from public.user_notification_prefs n where n.user_id = p.id),
      '{}'::jsonb)) as e) x
   where p.email is not null
     and (x.e ->> 'digest')::boolean
     and not exists (select 1 from public.team_digest_deliveries d
                      where d.user_id = p.id and d.local_date = p_today)
     and (
       (x.e -> 'requests' ->> 'email' <> 'off' and exists (
          select 1
            from public.guest_requests r
            join public.events e on e.id = r.event_id
           where r.status = 'pending'
             and e.cancelled_at is null
             and public.guest_mail_event_end(e.starts_at, e.ends_at) > now()
             and (exists (select 1 from public.venue_memberships m
                           where m.venue_id = e.venue_id and m.user_id = p.id
                             and m.roles @> '{admin}'::public.venue_role[])
                  or exists (select 1 from public.event_organizers o
                              where o.event_id = e.id and o.user_id = p.id))))
       or (x.e -> 'quota' ->> 'email' <> 'off' and exists (
          select 1
            from public.quota_requests q
            join public.events e on e.id = q.event_id
            join public.venue_memberships m
              on m.venue_id = q.venue_id and m.user_id = p.id
             and m.roles @> '{admin}'::public.venue_role[]
           where q.status = 'pending'
             and q.user_id <> p.id
             and e.cancelled_at is null
             and public.guest_mail_event_end(e.starts_at, e.ends_at) > now()))
     )
   order by p.id
   limit greatest(coalesce(p_limit, 0), 0);
$$;

-- The summary body for one user: per company, per event, the open counts.
-- No guest data at all (no names), only counts, event names and times.
create or replace function public.team_digest_items(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prefs as (
    select public.notification_prefs_effective(coalesce(
      (select n.notification_prefs from public.user_notification_prefs n where n.user_id = p_user),
      '{}'::jsonb)) as e
  ),
  open_requests as (
    select e.venue_id, e.id as event_id, count(*)::int as n
      from public.guest_requests r
      join public.events e on e.id = r.event_id
     where r.status = 'pending'
       and e.cancelled_at is null
       and public.guest_mail_event_end(e.starts_at, e.ends_at) > now()
       and (select e2.e -> 'requests' ->> 'email' from prefs e2) <> 'off'
       and (exists (select 1 from public.venue_memberships m
                     where m.venue_id = e.venue_id and m.user_id = p_user
                       and m.roles @> '{admin}'::public.venue_role[])
            or exists (select 1 from public.event_organizers o
                        where o.event_id = e.id and o.user_id = p_user))
     group by e.venue_id, e.id
  ),
  open_quota as (
    select q.venue_id, q.event_id, count(*)::int as n
      from public.quota_requests q
      join public.events e on e.id = q.event_id
      join public.venue_memberships m
        on m.venue_id = q.venue_id and m.user_id = p_user
       and m.roles @> '{admin}'::public.venue_role[]
     where q.status = 'pending'
       and q.user_id <> p_user
       and e.cancelled_at is null
       and public.guest_mail_event_end(e.starts_at, e.ends_at) > now()
       and (select e2.e -> 'quota' ->> 'email' from prefs e2) <> 'off'
     group by q.venue_id, q.event_id
  ),
  per_event as (
    select coalesce(r.venue_id, q.venue_id) as venue_id,
           coalesce(r.event_id, q.event_id) as event_id,
           coalesce(r.n, 0) as requests, coalesce(q.n, 0) as quota
      from open_requests r
      full join open_quota q on q.event_id = r.event_id
  )
  select coalesce(jsonb_agg(c order by c ->> 'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', v.id,
               'name', v.name,
               'events', jsonb_agg(jsonb_build_object(
                 'id', e.id, 'name', e.name, 'starts_at', e.starts_at,
                 'requests', pe.requests, 'quota', pe.quota) order by e.starts_at)) as c
        from per_event pe
        join public.venues v on v.id = pe.venue_id
        join public.events e on e.id = pe.event_id
       group by v.id, v.name
    ) x;
$$;

-- Claim due team mails. Returns { now, mails: [...] }, each mail:
--   { queue_ids, mail_log_id, type, to, first_name, link: {token, pref},
--     company {id, name}, event {id, name, starts_at} | null, count,
--     request {first_name, plus_ones} | null, quota {requester, extra} | null,
--     decision {status, extra} | null, digest [...] | null, local_date | null }
-- Re-checked at send time: the recipient's preference, their access (still
-- admin / organizer), the request still pending (a single mail), an address.
-- Anything that fails a check is settled 'skipped' with the reason.
create or replace function public.team_mails_claim(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 0), 500);
  v_mails jsonb := '[]'::jsonb;
  v_g record;
  v_rep record;
  v_user record;
  v_ids uuid[];
  v_prefs jsonb;
  v_type text;
  v_pref text;
  v_skip text;
  v_count integer;
  v_log uuid;
  v_token text;
  v_extra jsonb;
  v_event jsonb;
  v_local timestamp := now() at time zone 'Europe/Amsterdam';
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_digest jsonb;
  v_du uuid;
begin
  -- A row left 'sending' (the job died after the provider call, or before
  -- settle): unknown outcome, never re-sent.
  update public.notification_outbox o
     set status = 'failed', last_error = 'unknown_outcome', locked_at = null
   where o.channel = 'email' and o.status = 'sending'
     and o.locked_at < now() - interval '15 minutes';

  if v_limit = 0 then
    return jsonb_build_object('now', now(), 'mails', '[]'::jsonb);
  end if;

  for v_g in
    with due as (
      select o.id, o.collapse_key, o.recipient_user_id, o.next_attempt_at
        from public.notification_outbox o
       where o.channel = 'email' and o.status = 'pending' and o.next_attempt_at <= now()
       order by o.next_attempt_at
       limit v_limit
       for update skip locked
    )
    select coalesce(d.collapse_key, d.id::text) as grp, d.recipient_user_id, min(d.next_attempt_at) as first_due
      from due d
     group by 1, 2
     order by 3
  loop
    -- Every due member of this group (a slot is never split), claimed.
    with m as (
      select o.id
        from public.notification_outbox o
       where o.channel = 'email' and o.status = 'pending' and o.next_attempt_at <= now()
         and o.recipient_user_id = v_g.recipient_user_id
         and (o.id::text = v_g.grp or o.collapse_key = v_g.grp)
       for update skip locked
    ), upd as (
      update public.notification_outbox o
         set status = 'sending', attempts = o.attempts + 1, locked_at = now()
       where o.id in (select m.id from m)
      returning o.id
    )
    select array_agg(upd.id order by upd.id) into v_ids from upd;
    if v_ids is null then
      continue;
    end if;

    -- The newest member speaks for the group (UUIDv7 ids are time-ordered).
    select o.kind, o.venue_id, o.source_id, o.payload into v_rep
      from public.notification_outbox o
     where o.id = v_ids[array_length(v_ids, 1)];

    select p.id, p.email, p.first_name, p.full_name,
           public.notification_prefs_effective(coalesce(n.notification_prefs, '{}'::jsonb)) as prefs
      into v_user
      from public.user_profiles p
      left join public.user_notification_prefs n on n.user_id = p.id
     where p.id = v_g.recipient_user_id;

    v_type := case v_rep.kind
                when 'guest_request_created' then 'team_request'
                when 'quota_request_created' then 'team_quota'
                else 'team_decision' end;
    v_pref := case v_rep.kind
                when 'guest_request_created' then 'requests'
                when 'quota_request_created' then 'quota'
                else 'decisions' end;
    v_skip := null;
    v_count := array_length(v_ids, 1);

    if v_user.id is null or v_user.email is null then
      v_skip := 'no_address';
    elsif v_pref in ('requests', 'quota') and v_user.prefs -> v_pref ->> 'email' <> 'immediate' then
      v_skip := 'pref_off';
    elsif v_pref = 'decisions' and not (v_user.prefs -> 'decisions' ->> 'email')::boolean then
      v_skip := 'pref_off';
    elsif v_pref = 'requests' and not (
        exists (select 1 from public.venue_memberships m
                 where m.venue_id = v_rep.venue_id and m.user_id = v_user.id
                   and m.roles @> '{admin}'::public.venue_role[])
        or exists (select 1 from public.event_organizers o
                    where o.event_id = (v_rep.payload ->> 'event_id')::uuid and o.user_id = v_user.id)) then
      v_skip := 'no_access';
    elsif v_pref = 'quota' and not exists (
        select 1 from public.venue_memberships m
         where m.venue_id = v_rep.venue_id and m.user_id = v_user.id
           and m.roles @> '{admin}'::public.venue_role[]) then
      v_skip := 'no_access';
    end if;

    -- How many of the group's requests are still open (a single mail about a
    -- request decided in the meantime is pointless).
    if v_skip is null and v_pref = 'requests' then
      select count(*)::int into v_count
        from public.notification_outbox o
        join public.guest_requests r on r.id = o.source_id
       where o.id = any (v_ids) and r.status = 'pending';
    elsif v_skip is null and v_pref = 'quota' then
      select count(*)::int into v_count
        from public.notification_outbox o
        join public.quota_requests q on q.id = o.source_id
       where o.id = any (v_ids) and q.status = 'pending';
    end if;
    if v_skip is null and v_count = 0 then
      v_skip := 'already_decided';
    end if;

    if v_skip is not null then
      update public.notification_outbox o
         set status = 'skipped', last_error = v_skip, locked_at = null
       where o.id = any (v_ids);
      continue;
    end if;

    select jsonb_build_object('id', e.id, 'name', e.name, 'starts_at', e.starts_at,
                              'company', jsonb_build_object('id', v.id, 'name', v.name))
      into v_event
      from public.events e
      join public.venues v on v.id = e.venue_id
     where e.id = (v_rep.payload ->> 'event_id')::uuid;

    v_extra := '{}'::jsonb;
    if v_pref = 'requests' and v_count = 1 then
      select jsonb_build_object('request', jsonb_build_object(
               'first_name', nullif(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), ''),
               'plus_ones', r.plus_ones))
        into v_extra
        from public.notification_outbox o
        join public.guest_requests r on r.id = o.source_id
       where o.id = any (v_ids) and r.status = 'pending'
       limit 1;
    elsif v_pref = 'quota' then
      select jsonb_build_object('quota', jsonb_build_object(
               'requester', coalesce(nullif(btrim(coalesce(up.full_name, '')), ''), 'A team member'),
               'extra', q.requested_extra))
        into v_extra
        from public.quota_requests q
        left join public.user_profiles up on up.id = q.user_id
       where q.id = v_rep.source_id;
    else
      select jsonb_build_object('decision', jsonb_build_object(
               'status', q.status, 'extra', q.requested_extra))
        into v_extra
        from public.quota_requests q
       where q.id = v_rep.source_id;
    end if;

    insert into public.mail_log (type, venue_id, recipient_hash)
    values (v_type, v_rep.venue_id,
            encode(extensions.digest(lower(btrim(v_user.email)), 'sha256'), 'hex'))
    returning id into v_log;

    v_token := public.guest_mail_new_token();
    insert into public.team_mail_links (token_hash, user_id, pref, mail_log_id, expires_at)
    values (public.guest_mail_token_hash(v_token), v_user.id, v_pref, v_log, now() + interval '180 days');

    v_mails := v_mails || jsonb_build_array(jsonb_build_object(
      'queue_ids', to_jsonb(v_ids),
      'mail_log_id', v_log,
      'type', v_type,
      'to', v_user.email,
      'first_name', nullif(btrim(coalesce(v_user.first_name,
                      split_part(btrim(coalesce(v_user.full_name, '')), ' ', 1))), ''),
      'link', jsonb_build_object('token', v_token, 'pref', v_pref),
      'company', v_event -> 'company',
      'event', v_event - 'company',
      'count', v_count) || coalesce(v_extra, '{}'::jsonb));
  end loop;

  -- The daily summary: 09:00 to 11:59 Amsterdam, once per user per day.
  if v_local::time >= time '09:00' and v_local::time < time '12:00' then
    for v_du in select d.user_id from public.team_digest_due(v_today, v_limit) d
    loop
      insert into public.team_digest_deliveries (user_id, local_date)
      values (v_du, v_today)
      on conflict do nothing;
      if not found then
        continue;
      end if;

      select p.id, p.email, p.first_name, p.full_name into v_user
        from public.user_profiles p where p.id = v_du;
      v_digest := public.team_digest_items(v_du);
      if v_user.email is null or jsonb_array_length(v_digest) = 0 then
        continue;
      end if;

      insert into public.mail_log (type, venue_id, recipient_hash)
      values ('team_digest', null, encode(extensions.digest(lower(btrim(v_user.email)), 'sha256'), 'hex'))
      returning id into v_log;
      update public.team_digest_deliveries d set mail_log_id = v_log
       where d.user_id = v_du and d.local_date = v_today;

      v_token := public.guest_mail_new_token();
      insert into public.team_mail_links (token_hash, user_id, pref, mail_log_id, expires_at)
      values (public.guest_mail_token_hash(v_token), v_du, 'digest', v_log, now() + interval '180 days');

      v_mails := v_mails || jsonb_build_array(jsonb_build_object(
        'queue_ids', '[]'::jsonb,
        'mail_log_id', v_log,
        'type', 'team_digest',
        'to', v_user.email,
        'first_name', nullif(btrim(coalesce(v_user.first_name,
                        split_part(btrim(coalesce(v_user.full_name, '')), ' ', 1))), ''),
        'link', jsonb_build_object('token', v_token, 'pref', 'digest'),
        'local_date', v_today,
        'digest', v_digest));
    end loop;
  end if;

  return jsonb_build_object('now', now(), 'mails', v_mails);
end;
$$;

comment on function public.team_mails_claim(integer) is
  'Team mail job (service_role): claim due email outbox rows (a bundle slot = '
  'one mail), re-check preference, access and the request at send time, write '
  'mail_log, mint the unsubscribe link; plus the daily summary between 09:00 '
  'and 11:59 Amsterdam, once per user per day.';

-- p_results: [{ mail_log_id, queue_ids: [uuid], ok, provider_message_id?, error_code? }]
-- A refusal the provider answered (429, quota, 5xx) goes back to pending (up
-- to three attempts) and a summary may go again the same day; a timeout or
-- network error is final (the mail may have gone out: never mailed twice).
create or replace function public.team_mails_settle(p_results jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_ok boolean;
  v_code text;
  v_log uuid;
  v_ids uuid[];
  v_retry boolean;
  v_count integer := 0;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'results must be an array' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_log := nullif(v_item ->> 'mail_log_id', '')::uuid;
    v_ok := coalesce((v_item ->> 'ok')::boolean, false);
    v_code := case when v_ok then null
                   else coalesce(nullif(v_item ->> 'error_code', ''), 'provider_rejected') end;
    if v_code is not null and v_code !~ '^[a-z_]{1,40}$' then
      v_code := 'provider_rejected';
    end if;
    v_retry := not v_ok and v_code in ('rate_limited', 'daily_quota_exceeded',
                                       'monthly_quota_exceeded', 'provider_unavailable');
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_ids
      from jsonb_array_elements_text(coalesce(v_item -> 'queue_ids', '[]'::jsonb)) x;

    if v_log is not null then
      perform public.record_mail_send_result(
        v_log,
        case when v_ok then 'sent' else 'failed' end,
        case when v_ok then nullif(v_item ->> 'provider_message_id', '') end,
        v_code);
      -- A summary that the provider refused may go again within the window.
      if v_retry then
        delete from public.team_digest_deliveries d where d.mail_log_id = v_log;
      end if;
    end if;

    update public.notification_outbox o
       set status = case
                      when v_ok then 'sent'
                      when v_retry and o.attempts < 3 then 'pending'
                      else 'failed' end,
           next_attempt_at = case when not v_ok and v_retry and o.attempts < 3
                                  then now() + make_interval(mins => 5 * o.attempts)
                                  else o.next_attempt_at end,
           last_error = v_code,
           locked_at = null,
           sent_at = case when v_ok then now() else o.sent_at end
     where o.id = any (v_ids)
       and o.channel = 'email'
       and o.status = 'sending';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.team_mails_settle(jsonb) is
  'Team mail job (service_role): settle claimed mails (mail_log + outbox rows). '
  'A refusal the provider answered retries up to three attempts; a timeout or '
  'network error never retries.';

create or replace function public.team_mails_begin(p_token text, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_mail_tokens t
   where t.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
     and t.created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.team_mails_claim(p_limit);
end;
$$;

comment on function public.team_mails_begin(text, integer) is
  'The cron route (service_role): consume the single-use kick token, then claim.';

create or replace function public.team_mails_setting(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_name is distinct from 'plusone_team_mails_url' then
    return null;
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into v using p_name;
  exception when others then
    return null;
  end;
  return nullif(v, '');
end;
$$;

-- Fire-and-forget: pg_net queues the request in this transaction and sends it
-- after commit. Never raises. No Vault secret: nothing happens.
create or replace function public.kick_team_mails()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := public.team_mails_setting('plusone_team_mails_url');
  v_token text;
begin
  if v_url is null then
    return false;
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.team_mail_tokens (token_hash) values (extensions.digest(v_token, 'sha256'));
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-team-mails-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000);
  return true;
exception when others then
  raise warning 'team mail kick failed: % (%)', sqlerrm, sqlstate;
  return false;
end;
$$;

-- Every minute: housekeeping, then a kick only when something is due (an
-- email row, or a summary in its window).
create or replace function public.team_mails_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := now() at time zone 'Europe/Amsterdam';
begin
  delete from public.team_mail_tokens t where t.created_at < now() - interval '10 minutes';
  delete from public.team_mail_links l where l.expires_at < now();
  delete from public.team_digest_deliveries d where d.local_date < (v_local::date - 30);

  if exists (select 1 from public.notification_outbox o
              where o.channel = 'email' and o.status = 'pending' and o.next_attempt_at <= now())
     or (v_local::time >= time '09:00' and v_local::time < time '12:00'
         and exists (select 1 from public.team_digest_due(v_local::date, 1))) then
    return public.kick_team_mails();
  end if;
  return false;
end;
$$;

-- Insert-time kick: the push dispatcher for due push rows, the team mail job
-- for due email rows. A bundled row waits for its slot end; the sweep and the
-- tick wake the jobs then.
create or replace function public.notification_outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from new_rows
              where status = 'pending' and next_attempt_at <= now() and channel = 'push') then
    perform public.kick_push_dispatch();
  end if;
  if exists (select 1 from new_rows
              where status = 'pending' and next_attempt_at <= now() and channel = 'email') then
    perform public.kick_team_mails();
  end if;
  return null;
exception when others then
  raise warning 'notification kick trigger failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Unsubscribe (public, /n/[token])
-- ---------------------------------------------------------------------------
-- Turns the kind of the mail the token came with off. {ok:true} for a valid
-- and an invalid token alike; the bound 'st' throttle is spent only on a miss
-- (one-click POSTs come from the mailbox provider's shared IPs).
create or replace function public.unsubscribe_team_mail(p_token_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
  v_prefs jsonb;
begin
  if p_token_hash is not null then
    select l.user_id, l.pref into v_link
      from public.team_mail_links l
     where l.token_hash = p_token_hash
       and l.expires_at > now();
    if found then
      v_prefs := public.notification_prefs_effective(coalesce(
        (select n.notification_prefs from public.user_notification_prefs n where n.user_id = v_link.user_id),
        '{}'::jsonb));
      v_prefs := case v_link.pref
                   when 'requests' then jsonb_set(v_prefs, '{requests,email}', '"off"')
                   when 'quota' then jsonb_set(v_prefs, '{quota,email}', '"off"')
                   when 'decisions' then jsonb_set(v_prefs, '{decisions,email}', 'false')
                   else jsonb_set(v_prefs, '{digest}', 'false') end;
      insert into public.user_notification_prefs as n (user_id, notification_prefs, updated_at)
      values (v_link.user_id, v_prefs, now())
      on conflict (user_id) do update
         set notification_prefs = excluded.notification_prefs, updated_at = now();
      return jsonb_build_object('ok', true);
    end if;
  end if;

  if not public.consume_public_throttle('st:' || p_ip_hash, 15, 30) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.unsubscribe_team_mail(text, text) is
  'Public team mail opt-out (/n/[token]): turns the kind of that mail off for '
  'its recipient. {ok:true} whether or not the token was valid; {ok:false} '
  'only when a miss is throttled.';

-- ---------------------------------------------------------------------------
-- Grant matrix
-- ---------------------------------------------------------------------------

revoke all on table public.team_mail_tokens from anon, authenticated, service_role;
revoke all on table public.team_mail_links from anon, authenticated, service_role;
revoke all on table public.team_digest_deliveries from anon, authenticated, service_role;

revoke all on table public.user_notification_prefs from anon, authenticated, service_role;

revoke execute on function
  public.notification_prefs_effective(jsonb),
  public.team_digest_due(date, integer),
  public.team_digest_items(uuid),
  public.team_mails_setting(text),
  public.kick_team_mails(),
  public.team_mails_tick(),
  public.notification_outbox_kick(),
  public.enqueue_quota_request_push(),
  public.enqueue_guest_request_push(),
  public.push_outbox_sweep()
  from public, anon, authenticated, service_role;

revoke execute on function
  public.team_mails_claim(integer),
  public.team_mails_settle(jsonb),
  public.team_mails_begin(text, integer),
  public.my_notification_prefs(),
  public.set_my_notification_prefs(jsonb),
  public.unsubscribe_team_mail(text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  public.team_mails_claim(integer),
  public.team_mails_settle(jsonb),
  public.team_mails_begin(text, integer)
  to service_role;
grant execute on function
  public.my_notification_prefs(),
  public.set_my_notification_prefs(jsonb)
  to authenticated;
grant execute on function public.unsubscribe_team_mail(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cron
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-team-mails',
        '* * * * *',
        'select public.team_mails_tick();');
      raise notice 'pg_cron: scheduled plusone-team-mails (every minute).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.team_mails_tick() by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.team_mails_tick() by other means.';
  end if;
end;
$$;
