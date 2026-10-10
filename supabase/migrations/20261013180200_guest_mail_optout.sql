-- Gastcommunicatie F, PR 6a (z8uq9m2vpy): opt-out, per-mail links, and the
-- guest-mail job.
--
--   1. guest_mail_optouts: "Don't want updates from {company}? Unsubscribe."
--      One row per company per address HASH (sha256 of the trimmed, lower-case
--      address, the mail_log hash). The guest stays on the list; every later
--      guest mail from that company to that address is skipped at send time.
--   2. guest_mail_links: the per-mail bearer links, sha256 only (the /r/[token]
--      rule: the server never keeps a usable token). Minted by the job for
--      each mail it sends:
--        status       /s/<token>: the guest's status page + .ics; expires one
--                     day after the event
--        unsubscribe  /u/<token>: opt out of this company; 180 days
--        reply        the opaque part of the sender noreply+<key>@plus-one.io:
--                     lets the inbound handler answer a reply with the
--                     company's contact address; 90 days
--   3. The job: guest_mails_claim (pick due rows, re-check every fact, write
--      mail_log, mint links, return what the renderer needs) and
--      guest_mails_settle. Two ways in, both service_role:
--        * in-process, right after the action that queued the mail (Next's
--          after(): outside the request path, the response has gone);
--        * pg_cron every minute -> guest_mails_tick() -> pg_net POST with a
--          single-use token to /api/webhooks/guest-mails -> guest_mails_begin
--          (the billing-mail/platform-digest pattern; see 20261012160000 for
--          why a single-use token and not a static secret). The safety net
--          for a lost after() and for debounced rows.
--      Rows are claimed FOR UPDATE SKIP LOCKED, so the two never mail twice.
--   4. Public RPCs (anon + authenticated, the /r/[token] rules): throttled on
--      the bound 'st' prefix (the status-page budget, shared with
--      get_request_status: 30 calls per 15 minutes per IP, honoured only with
--      the trust header), minimal payload, one neutral answer for invalid,
--      expired, anonymized and throttled:
--        get_guest_status(token_hash, ip_hash)
--        unsubscribe_guest_mail(token_hash, ip_hash)
--   5. resolve_guest_mail_reply + consume_guest_mail_autoreply (service_role):
--      the inbound handler's lookup and its per-sender / global budget.
--
-- Budgets (constants below; raise them with the Resend plan): at most
-- guest_mail_venue_daily_cap() guest mails per company and
-- guest_mail_daily_cap() overall per UTC day; at most 100 rows per company per
-- run, so one company's 25 000-guest event never starves another company's
-- confirmation. Over budget, rows simply wait.
--
-- CONFIG: one Vault secret, nothing hard-coded:
--   plusone_guest_mails_url   https://app.plus-one.io/api/webhooks/guest-mails
-- Unset (every local stack, CI) => the cron path SLEEPS; the in-process path
-- still drains the queue where guest mail is active (src/features/mail/config.ts).

-- ---------------------------------------------------------------------------
-- 0. Budgets
-- ---------------------------------------------------------------------------

create or replace function public.guest_mail_venue_daily_cap()
returns integer language sql immutable set search_path = '' as $$ select 1000 $$;

create or replace function public.guest_mail_daily_cap()
returns integer language sql immutable set search_path = '' as $$ select 5000 $$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.guest_mail_optouts (
  venue_id uuid not null references public.venues (id) on delete cascade,
  email_hash text not null
    constraint guest_mail_optouts_hash_check check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (venue_id, email_hash)
);

comment on table public.guest_mail_optouts is
  'Guest mail opt-outs per company (20261013180200): sha256 of the address, '
  'never the address. Written only by unsubscribe_guest_mail. No app-role grants.';

alter table public.guest_mail_optouts enable row level security;

create table public.guest_mail_links (
  token_hash text primary key
    constraint guest_mail_links_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  kind text not null
    constraint guest_mail_links_kind_check check (kind in ('status', 'unsubscribe', 'reply')),
  venue_id uuid not null references public.venues (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  guest_id uuid references public.guests (id) on delete cascade,
  guest_request_id uuid references public.guest_requests (id) on delete cascade,
  email_hash text not null
    constraint guest_mail_links_email_hash_check check (email_hash ~ '^[0-9a-f]{64}$'),
  mail_log_id uuid references public.mail_log (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint guest_mail_links_status_guest check (kind <> 'status' or guest_id is not null)
);

comment on table public.guest_mail_links is
  'Per-mail bearer links for guest mail (20261013180200): status page, '
  'unsubscribe, reply key. sha256 only. Written only by guest_mails_claim. '
  'No app-role grants.';

create index guest_mail_links_expires_idx on public.guest_mail_links (expires_at);
create index guest_mail_links_guest_idx on public.guest_mail_links (guest_id) where guest_id is not null;
create index guest_mail_links_mail_log_idx on public.guest_mail_links (mail_log_id) where mail_log_id is not null;

alter table public.guest_mail_links enable row level security;

create table public.guest_mail_tokens (
  token_hash bytea primary key,
  created_at timestamptz not null default now()
);

comment on table public.guest_mail_tokens is
  'Single-use invocation tokens for the guest-mail job (20261013180200): '
  'sha256 only, 10-minute lifetime, consumed by guest_mails_begin. No '
  'app-role grants.';

alter table public.guest_mail_tokens enable row level security;

-- No policies on any of the three: RLS on + no grants = closed.

-- ---------------------------------------------------------------------------
-- 2. Helpers (owner-only)
-- ---------------------------------------------------------------------------

create or replace function public.guest_mail_email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex') $$;

-- A URL-safe bearer token (32 random bytes, base64url, no padding) — the
-- shape submitGuestRequest mints for /r/[token].
create or replace function public.guest_mail_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

-- The reply key: 20 random bytes as lower-case hex. Hex because an e-mail
-- local part may be lower-cased in transit; 'noreply+' + 40 = 48 characters,
-- inside the 64 a local part allows.
create or replace function public.guest_mail_new_reply_key()
returns text
language sql
volatile
set search_path = ''
as $$ select encode(extensions.gen_random_bytes(20), 'hex') $$;

create or replace function public.guest_mail_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

-- The moment after which a guest mail about this event is pointless.
create or replace function public.guest_mail_event_end(p_starts timestamptz, p_ends timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select coalesce(p_ends, p_starts + interval '12 hours') $$;

-- Guest mails counted against a budget today (UTC): failed attempts do not
-- count (nothing left the building, the 20261011120000 stance).
create or replace function public.guest_mail_sent_today(p_venue_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int
    from public.mail_log m
   where m.type like 'guest\_%'
     and m.status <> 'failed'
     and (p_venue_id is null or m.venue_id = p_venue_id)
     and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

-- ---------------------------------------------------------------------------
-- 3. guest_mails_claim — the job's core (service_role)
-- ---------------------------------------------------------------------------
-- Returns { now, mails: [ … ] }, one entry per mail to send now:
--   { queue_id, mail_log_id, type, to, first_name, remark,
--     event:   { id, name, starts_at, ends_at, location_name, location_address,
--                house_rules, updated_at },
--     company: { name, contact_email },
--     spot:    { plus_ones, tier_name, price_cents } | null,
--     plus_ones: integer | null,             -- the guest's current +N (removal mail)
--     asked_people: integer | null,          -- request_partly only
--     links:   { status, unsubscribe, reply } }  -- RAW tokens, mail body only
-- Every row it looks at is re-checked against the current database state; a
-- row that no longer fits is settled as skipped with a reason code and its
-- note dropped. Rows of a company without a contact address are left pending
-- (they go once the company adds one, or expire with the event).
create or replace function public.guest_mails_claim(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 0), 500);
  -- Budgets are read once per run. Two concurrent runs (an after() drain and
  -- the cron) can each spend the full remainder, so a cap can be passed by up
  -- to one run's claim (review N1). Accepted at these caps: they guard against
  -- runaway volume, not an exact count.
  v_global_left integer := public.guest_mail_daily_cap() - public.guest_mail_sent_today(null);
  v_venue_left jsonb := '{}'::jsonb;
  v_left integer;
  v_row record;
  v_ctx record;
  v_tier_name text;
  v_tier_price integer;
  v_email text;
  v_name text;
  v_hash text;
  v_skip text;
  v_spot boolean;
  v_log uuid;
  v_status_token text;
  v_unsub_token text;
  v_reply_key text;
  v_asked integer;
  v_mails jsonb := '[]'::jsonb;
begin
  -- Rows left 'sending' by a run that died mid-way: the outcome is unknown,
  -- so they are never retried (no double mail); their note goes.
  update public.guest_mail_queue q
     set status = 'failed', reason = 'unknown_outcome', remark = null, updated_at = now()
   where q.status = 'sending'
     and q.claimed_at < now() - interval '15 minutes';

  -- Pending rows of an ended event: too late for any of them.
  update public.guest_mail_queue q
     set status = 'skipped', reason = 'expired', remark = null, updated_at = now()
    from public.events e
   where e.id = q.event_id
     and q.status = 'pending'
     and public.guest_mail_event_end(e.starts_at, e.ends_at) < now();

  -- p_limit 0: housekeeping only (the route when mail is not configured).
  if v_global_left <= 0 or v_limit = 0 then
    return jsonb_build_object('now', now(), 'mails', '[]'::jsonb);
  end if;

  for v_row in
    with due as (
      select q.id,
             row_number() over (partition by q.venue_id order by q.send_after, q.id) as rn
        from public.guest_mail_queue q
        join public.venues v on v.id = q.venue_id
       where q.status = 'pending'
         and q.send_after <= now()
         and v.contact_email is not null
    )
    select q.*
      from public.guest_mail_queue q
      join due d on d.id = q.id
     where d.rn <= 100
     order by q.send_after, q.id
     limit v_limit
     for update of q skip locked
  loop
    exit when v_global_left <= 0;

    -- Per-company budget, computed once per company per run.
    if not v_venue_left ? v_row.venue_id::text then
      v_venue_left := v_venue_left || jsonb_build_object(
        v_row.venue_id::text,
        public.guest_mail_venue_daily_cap() - public.guest_mail_sent_today(v_row.venue_id));
    end if;
    v_left := (v_venue_left ->> v_row.venue_id::text)::int;
    if v_left <= 0 then
      continue; -- stays pending until tomorrow (or expires with the event)
    end if;

    select e.id as event_id, e.name as event_name, e.starts_at, e.ends_at,
           e.location_name, e.location_address, e.house_rules, e.updated_at as event_updated_at,
           e.cancelled_at,
           v.name as company_name, v.contact_email,
           g.status as guest_status, g.email as guest_email, g.full_name as guest_name,
           g.plus_ones, g.tier_id, g.anonymized_at as guest_anonymized,
           r.status as request_status, r.email as request_email, r.full_name as request_name,
           r.anonymized_at as request_anonymized,
           sr.plus_ones as source_plus_ones
      into v_ctx
      from public.events e
      join public.venues v on v.id = e.venue_id
      left join public.guests g on g.id = v_row.guest_id
      left join public.guest_requests r on r.id = v_row.guest_request_id
      left join public.guest_requests sr on sr.id = v_row.source_request_id
     where e.id = v_row.event_id;

    v_skip := null;
    v_spot := v_row.type in ('guest_on_list', 'guest_plus_ones', 'guest_event_changed',
                             'guest_reminder', 'guest_request_approved', 'guest_request_partly');
    if v_row.guest_id is not null then
      v_email := v_ctx.guest_email;
      v_name := v_ctx.guest_name;
      if v_ctx.guest_anonymized is not null then v_skip := 'anonymized'; end if;
    else
      v_email := v_ctx.request_email;
      v_name := v_ctx.request_name;
      if v_ctx.request_anonymized is not null then v_skip := 'anonymized';
      elsif v_ctx.request_status is distinct from 'denied' then v_skip := 'not_declined';
      end if;
    end if;

    if v_skip is null and nullif(btrim(coalesce(v_email, '')), '') is null then
      v_skip := 'no_email';
    end if;
    if v_skip is null then
      if v_row.type = 'guest_event_canceled' then
        if v_ctx.cancelled_at is null then v_skip := 'not_canceled'; end if;
      elsif v_ctx.cancelled_at is not null then
        v_skip := 'event_canceled';
      elsif v_row.type = 'guest_removed' then
        if v_ctx.guest_status is distinct from 'removed' then v_skip := 'not_removed'; end if;
      elsif v_spot and not public.guest_mail_has_spot(v_ctx.guest_status) then
        v_skip := 'no_spot';
      end if;
    end if;
    if v_skip is null then
      v_hash := public.guest_mail_email_hash(v_email);
      if exists (select 1 from public.guest_mail_optouts o
                  where o.venue_id = v_row.venue_id and o.email_hash = v_hash) then
        v_skip := 'opted_out';
      end if;
    end if;

    if v_skip is not null then
      update public.guest_mail_queue q
         set status = 'skipped', reason = v_skip, remark = null, updated_at = now()
       where q.id = v_row.id;
      continue;
    end if;

    insert into public.mail_log (type, venue_id, recipient_hash)
    values (v_row.type, v_row.venue_id, v_hash)
    returning id into v_log;

    v_status_token := case when v_spot then public.guest_mail_new_token() end;
    v_unsub_token := public.guest_mail_new_token();
    v_reply_key := public.guest_mail_new_reply_key();

    if v_status_token is not null then
      insert into public.guest_mail_links
        (token_hash, kind, venue_id, event_id, guest_id, email_hash, mail_log_id, expires_at)
      values
        (public.guest_mail_token_hash(v_status_token), 'status', v_row.venue_id, v_row.event_id,
         v_row.guest_id, v_hash, v_log,
         public.guest_mail_event_end(v_ctx.starts_at, v_ctx.ends_at) + interval '1 day');
    end if;
    insert into public.guest_mail_links
      (token_hash, kind, venue_id, event_id, guest_id, guest_request_id, email_hash, mail_log_id, expires_at)
    values
      (public.guest_mail_token_hash(v_unsub_token), 'unsubscribe', v_row.venue_id, v_row.event_id,
       v_row.guest_id, v_row.guest_request_id, v_hash, v_log, now() + interval '180 days'),
      (public.guest_mail_token_hash(v_reply_key), 'reply', v_row.venue_id, v_row.event_id,
       v_row.guest_id, v_row.guest_request_id, v_hash, v_log, now() + interval '90 days');

    update public.guest_mail_queue q
       set status = 'sending', claimed_at = now(), attempts = q.attempts + 1,
           mail_log_id = v_log, updated_at = now()
     where q.id = v_row.id;

    v_tier_name := null;
    v_tier_price := null;
    if v_spot then
      select t.name, t.door_price_cents into v_tier_name, v_tier_price
        from public.guest_tiers t where t.id = v_ctx.tier_id;
    end if;
    v_asked := case when v_row.type = 'guest_request_partly' and v_ctx.source_plus_ones is not null
                    then v_ctx.source_plus_ones + 1 end;

    v_mails := v_mails || jsonb_build_object(
      'queue_id', v_row.id,
      'mail_log_id', v_log,
      'type', v_row.type,
      'to', btrim(v_email),
      'first_name', nullif(split_part(btrim(coalesce(v_name, '')), ' ', 1), ''),
      'remark', v_row.remark,
      'event', jsonb_build_object(
        'id', v_ctx.event_id,
        'name', v_ctx.event_name,
        'starts_at', v_ctx.starts_at,
        'ends_at', v_ctx.ends_at,
        'location_name', nullif(btrim(coalesce(v_ctx.location_name, '')), ''),
        'location_address', nullif(btrim(coalesce(v_ctx.location_address, '')), ''),
        'house_rules', v_ctx.house_rules,
        'updated_at', v_ctx.event_updated_at),
      'company', jsonb_build_object('name', v_ctx.company_name, 'contact_email', v_ctx.contact_email),
      'spot', case when v_spot then jsonb_build_object(
        'plus_ones', v_ctx.plus_ones,
        'tier_name', v_tier_name,
        'price_cents', v_tier_price) end,
      'plus_ones', case when v_row.guest_id is not null then v_ctx.plus_ones end,
      'asked_people', v_asked,
      'links', jsonb_build_object(
        'status', v_status_token,
        'unsubscribe', v_unsub_token,
        'reply', v_reply_key)
    );

    v_global_left := v_global_left - 1;
    v_venue_left := jsonb_set(v_venue_left, array[v_row.venue_id::text], to_jsonb(v_left - 1));
  end loop;

  return jsonb_build_object('now', now(), 'mails', v_mails);
end;
$$;

comment on function public.guest_mails_claim(integer) is
  'Guest-mail job (service_role): claim due queue rows (skip locked), re-check '
  'each against the database, write mail_log, mint the per-mail links and '
  'return what the renderer needs, raw tokens included. Budgets per company '
  'and per day; rows of a company without a contact address wait.';

-- ---------------------------------------------------------------------------
-- 4. guest_mails_settle (service_role)
-- ---------------------------------------------------------------------------
-- p_results: [{ queue_id, ok, provider_message_id?, error_code? }]. Only rows
-- in 'sending' move. A failure the provider answered (429 rate limit or
-- quota, 5xx provider down: it refused, nothing went out) goes back to
-- pending with a backoff, at most three attempts. A timeout or network error
-- is NOT retried: the batch may have been accepted before the answer was
-- lost, and a retry claims a new mail_log id, so a new Idempotency-Key that
-- Resend can't dedupe (up to 100 guests mailed twice). Same rule as a stale
-- 'sending' row (unknown_outcome): never mailed twice beats never missed.
-- Anything else fails for good. The note is dropped once a row is final.
-- Returns the number of rows settled.
create or replace function public.guest_mails_settle(p_results jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_row record;
  v_ok boolean;
  v_code text;
  v_count integer := 0;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'results must be an array' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    select q.id, q.mail_log_id, q.attempts into v_row
      from public.guest_mail_queue q
     where q.id = (v_item ->> 'queue_id')::uuid
       and q.status = 'sending'
     for update;
    if not found then
      continue;
    end if;

    v_ok := coalesce((v_item ->> 'ok')::boolean, false);
    v_code := case when v_ok then null
                   else coalesce(nullif(v_item ->> 'error_code', ''), 'provider_rejected') end;
    if v_code is not null and v_code !~ '^[a-z_]{1,40}$' then
      v_code := 'provider_rejected';
    end if;

    if v_row.mail_log_id is not null then
      perform public.record_mail_send_result(
        v_row.mail_log_id,
        case when v_ok then 'sent' else 'failed' end,
        case when v_ok then nullif(v_item ->> 'provider_message_id', '') end,
        v_code);
    end if;

    if v_ok then
      update public.guest_mail_queue q
         set status = 'sent', reason = null, remark = null, updated_at = now()
       where q.id = v_row.id;
    elsif v_code in ('rate_limited', 'daily_quota_exceeded', 'monthly_quota_exceeded',
                     'provider_unavailable')
          and v_row.attempts < 3 then
      update public.guest_mail_queue q
         set status = 'pending', reason = v_code,
             send_after = now() + make_interval(mins => 5 * v_row.attempts),
             updated_at = now()
       where q.id = v_row.id;
    else
      update public.guest_mail_queue q
         set status = 'failed', reason = v_code, remark = null, updated_at = now()
       where q.id = v_row.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.guest_mails_settle(jsonb) is
  'Guest-mail job (service_role): settle claimed rows as sent/failed (and '
  'mail_log with them); a refusal the provider answered (429/5xx) retries up '
  'to three attempts; a timeout or network error never retries (unknown outcome).';

-- ---------------------------------------------------------------------------
-- 5. Cron path: begin (token) + kick + tick
-- ---------------------------------------------------------------------------

create or replace function public.guest_mails_begin(p_token text, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.guest_mail_tokens t
  where t.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and t.created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.guest_mails_claim(p_limit);
end;
$$;

comment on function public.guest_mails_begin(text, integer) is
  'Guest-mail job route (service_role): consume a single-use invocation token '
  '(42501 otherwise), then claim like guest_mails_claim.';

create or replace function public.guest_mails_setting(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_name is distinct from 'plusone_guest_mails_url' then
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

create or replace function public.kick_guest_mails()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := public.guest_mails_setting('plusone_guest_mails_url');
  v_token text;
begin
  if v_url is null then
    return false;
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.guest_mail_tokens (token_hash)
  values (extensions.digest(v_token, 'sha256'));
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 55000)'
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-guest-mails-token', v_token);
  return true;
exception when others then
  raise warning 'guest mails kick failed: % (%)', sqlerrm, sqlstate;
  return false;
end;
$$;

-- The cron entry point (every minute): housekeeping, then kick only when a
-- row is due (an empty queue costs one index probe, no HTTP call).
create or replace function public.guest_mails_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.guest_mail_tokens t
  where t.created_at < now() - interval '10 minutes';

  -- Expired links, bounded per tick.
  delete from public.guest_mail_links l
  where l.token_hash in (
    select x.token_hash from public.guest_mail_links x
     where x.expires_at < now()
     limit 5000);

  -- Settled queue rows older than 180 days (no address, no note left).
  delete from public.guest_mail_queue q
  where q.id in (
    select x.id from public.guest_mail_queue x
     where x.status in ('sent', 'failed', 'skipped', 'canceled')
       and x.created_at < now() - interval '180 days'
     limit 5000);

  if not exists (
    select 1 from public.guest_mail_queue q
     where q.status = 'pending' and q.send_after <= now()
  ) then
    return false;
  end if;
  return public.kick_guest_mails();
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Public: status page + unsubscribe (anon + authenticated)
-- ---------------------------------------------------------------------------

-- The guest's status page (/s/[token]) and its .ics. One neutral
-- {found:false} for invalid, expired, anonymized and throttled tokens. A
-- found token gets: the state of the spot, the first name, the count and the
-- tier (only while the spot holds), the event facts, and the company's
-- guest-facing contact. No phone/e-mail of the guest, no note, no other guest.
create or replace function public.get_guest_status(p_token_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_state text;
begin
  if p_token_hash is null
     or not public.consume_public_throttle('st:' || p_ip_hash, 15, 30) then
    return jsonb_build_object('found', false);
  end if;

  select g.status as guest_status, g.full_name, g.plus_ones, g.anonymized_at,
         t.name as tier_name, t.door_price_cents,
         e.id as event_id, e.name as event_name, e.starts_at, e.ends_at,
         e.location_name, e.location_address, e.house_rules, e.cancelled_at,
         e.updated_at as event_updated_at,
         v.name as company_name, v.contact_email, v.website, v.contact_channels
    into v_s
    from public.guest_mail_links l
    join public.guests g on g.id = l.guest_id
    join public.guest_tiers t on t.id = g.tier_id
    join public.events e on e.id = l.event_id
    join public.venues v on v.id = l.venue_id
   where l.token_hash = p_token_hash
     and l.kind = 'status'
     and l.expires_at > now();

  if not found or v_s.anonymized_at is not null then
    return jsonb_build_object('found', false);
  end if;

  v_state := case
    when v_s.cancelled_at is not null then 'canceled'
    when v_s.guest_status = 'checked_in' then 'checked_in'
    when v_s.guest_status = 'approved' then 'on_list'
    else 'off_list'
  end;

  return jsonb_build_object(
    'found', true,
    'state', v_state,
    'first_name', nullif(split_part(btrim(coalesce(v_s.full_name, '')), ' ', 1), ''),
    'plus_ones', case when v_state in ('on_list', 'checked_in') then v_s.plus_ones end,
    'tier_name', case when v_state in ('on_list', 'checked_in') then v_s.tier_name end,
    'price_cents', case when v_state in ('on_list', 'checked_in') then v_s.door_price_cents end,
    'event', jsonb_build_object(
      'id', v_s.event_id,
      'name', v_s.event_name,
      'starts_at', v_s.starts_at,
      'ends_at', v_s.ends_at,
      'location_name', nullif(btrim(coalesce(v_s.location_name, '')), ''),
      'location_address', nullif(btrim(coalesce(v_s.location_address, '')), ''),
      'house_rules', case when v_state in ('on_list', 'checked_in') then v_s.house_rules end,
      'updated_at', v_s.event_updated_at),
    'company', jsonb_build_object(
      'name', v_s.company_name,
      'contact_email', v_s.contact_email,
      'website', nullif(btrim(coalesce(v_s.website, '')), ''),
      'channels', v_s.contact_channels)
  );
end;
$$;

comment on function public.get_guest_status(text, text) is
  'Public guest status page (/s/[token]): throttled on the bound st prefix, '
  'minimal payload, {found:false} for anything not a live status token.';

-- One-click opt-out (/u/[token], also RFC 8058 List-Unsubscribe-Post).
-- Answers {ok:true} for a valid AND for an invalid or expired token, so the
-- route cannot be used to test tokens or addresses; {ok:false} only when
-- throttled (which says nothing about the token). Idempotent.
-- The throttle is spent only on a MISS. RFC 8058 one-click POSTs come from
-- the mailbox provider's servers (a few Google/Yahoo egress IPs carry every
-- Gmail user's opt-out), so a per-IP budget on hits would silently drop real
-- opt-outs after the 30th in 15 minutes, and the provider does not retry. A
-- live token is 256 random bits: throttling hits buys nothing against
-- guessing, while throttling misses still caps a scanner.
create or replace function public.unsubscribe_guest_mail(p_token_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
begin
  if p_token_hash is not null then
    select l.venue_id, l.email_hash into v_link
      from public.guest_mail_links l
     where l.token_hash = p_token_hash
       and l.kind = 'unsubscribe'
       and l.expires_at > now();
    if found then
      insert into public.guest_mail_optouts (venue_id, email_hash)
      values (v_link.venue_id, v_link.email_hash)
      on conflict (venue_id, email_hash) do nothing;
      return jsonb_build_object('ok', true);
    end if;
  end if;

  if not public.consume_public_throttle('st:' || p_ip_hash, 15, 30) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.unsubscribe_guest_mail(text, text) is
  'Public opt-out (/u/[token]): records the company + address hash of a live '
  'unsubscribe token. {ok:true} whether or not the token was valid; '
  '{ok:false} only when a miss is throttled (hits never spend the budget: '
  'one-click POSTs share the mailbox provider''s IPs).';

-- ---------------------------------------------------------------------------
-- 7. Inbound auto-reply (service_role)
-- ---------------------------------------------------------------------------

-- noreply+<key>@…: the company behind the mail that key went out with.
-- {found:false} for an unknown or expired key.
create or replace function public.resolve_guest_mail_reply(p_reply_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r record;
begin
  if p_reply_key is null or p_reply_key !~ '^[0-9a-f]{40}$' then
    return jsonb_build_object('found', false);
  end if;
  select v.name, v.contact_email into v_r
    from public.guest_mail_links l
    join public.venues v on v.id = l.venue_id
   where l.token_hash = public.guest_mail_token_hash(p_reply_key)
     and l.kind = 'reply'
     and l.expires_at > now();
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'company', v_r.name, 'contact_email', v_r.contact_email);
end;
$$;

comment on function public.resolve_guest_mail_reply(text) is
  'Inbound handler (service_role): company name + contact address behind a '
  'reply key, or {found:false}.';

-- The auto-reply budget: one per sender address per 24 hours, and at most
-- 200 per hour overall. The sender key is hashed HERE (server-derived): this
-- function is service_role only and never takes a client-chosen bucket.
create or replace function public.consume_guest_mail_autoreply(p_sender text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text;
begin
  if nullif(btrim(coalesce(p_sender, '')), '') is null then
    return false;
  end if;
  v_sender := public.guest_mail_email_hash(p_sender);
  if not public.consume_public_throttle('arpall:global', 60, 200) then
    return false;
  end if;
  return public.consume_public_throttle('arp:' || v_sender, 1440, 1);
end;
$$;

comment on function public.consume_guest_mail_autoreply(text) is
  'Inbound handler (service_role): true when an auto-reply to this sender is '
  'within budget (1 per sender per 24 h, 200 per hour overall).';

-- ---------------------------------------------------------------------------
-- 8. Grant matrix — revoke first, then grant
-- ---------------------------------------------------------------------------

revoke all on table public.guest_mail_optouts from anon, authenticated, service_role;
revoke all on table public.guest_mail_links from anon, authenticated, service_role;
revoke all on table public.guest_mail_tokens from anon, authenticated, service_role;

revoke execute on function
  public.guest_mails_claim(integer),
  public.guest_mails_settle(jsonb),
  public.guest_mails_begin(text, integer),
  public.resolve_guest_mail_reply(text),
  public.consume_guest_mail_autoreply(text)
from public, anon, authenticated;

grant execute on function
  public.guest_mails_claim(integer),
  public.guest_mails_settle(jsonb),
  public.guest_mails_begin(text, integer),
  public.resolve_guest_mail_reply(text),
  public.consume_guest_mail_autoreply(text)
to service_role;

revoke execute on function
  public.get_guest_status(text, text),
  public.unsubscribe_guest_mail(text, text)
from public;

grant execute on function
  public.get_guest_status(text, text),
  public.unsubscribe_guest_mail(text, text)
to anon, authenticated;

revoke execute on function
  public.guest_mail_venue_daily_cap(),
  public.guest_mail_daily_cap(),
  public.guest_mail_email_hash(text),
  public.guest_mail_new_token(),
  public.guest_mail_new_reply_key(),
  public.guest_mail_token_hash(text),
  public.guest_mail_event_end(timestamptz, timestamptz),
  public.guest_mail_sent_today(uuid),
  public.guest_mails_setting(text),
  public.kick_guest_mails(),
  public.guest_mails_tick()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. pg_cron — every minute
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-guest-mails',
        '* * * * *',
        'select public.guest_mails_tick();');
      raise notice 'pg_cron: scheduled plusone-guest-mails (every minute).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.guest_mails_tick() by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.guest_mails_tick() by other means.';
  end if;
end;
$$;
