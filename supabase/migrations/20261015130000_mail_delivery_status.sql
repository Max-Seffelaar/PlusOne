-- Guest mail delivery status, resend, bounce rule, platform mail log and test
-- mails (ClickUp z8uq9m49k1, decisions Max 2026-10-11).
--
--   1. mail_log.is_test / test_by: a platform admin's test mail is logged like
--      any other mail (Resend webhook statuses included), marked as a test,
--      and never counts toward a company's or the overall guest/team budget,
--      nor starts the invite recipient window.
--   2. guest_confirmation_state(guest): per guest the state of the
--      confirmation ("You're on the list" or the approval mail): not sent,
--      queued, sent, delivered, bounced, complained, failed, opted out; and
--      whether a resend is allowed. Any bounce or complaint at the address
--      the guest has now: no resend until the address is changed (decision 3,
--      a database rule).
--      event_guest_mail_status(event) (20261013180000, no app caller yet) is
--      redefined on top of it: one row per guest with a spot and an address,
--      only the guests the caller may see (the guests_select predicate).
--   3. resend_guest_confirmation(guest, actor) (service_role, after the
--      action proved through RLS that the caller may edit the guest): queue
--      the original confirmation type again through enqueue_guest_mail. Same
--      queue, same budgets; a second click while one is queued returns that
--      row; at most 3 resends per guest per UTC day (guest_confirmation_resends).
--   4. Platform mail log (is_platform_admin() only): platform_mail_log() lists
--      every outgoing mail with type, company, event (where known), time,
--      status, test flag and a MASKED address; platform_reveal_mail_recipient()
--      shows the full address only with a ticket reference and writes a
--      platform_access_log row (CLAUDE.md decision 8). platform_access_log
--      .venue_id becomes nullable (a digest or a platform invite has no
--      company); expand-only.
--   5. log_platform_test_mail(): the test mail's mail_log row, only to a
--      current platform admin's sign-in address (platform_test_mail_recipients),
--      within its own small limit (10 per platform admin, 30 overall per UTC
--      day).
--
--   0. guest_mail_email_hash trims every whitespace character, not only
--      spaces (review #463): an address stored as E'\ta@x' or 'a@x\n' by a
--      raw-API editor hashed differently from 'a@x' and reopened the resend
--      after a bounce. The set is exactly what JS String.prototype.trim()
--      strips, so recipientHash (src/features/mail/send.ts) keeps agreeing.
--      For an address without such characters the hash is unchanged, so the
--      hashes already stored (mail_log, opt-outs) need no backfill.
--
-- guest_mails_claim is not touched (task 7 redefines it).

-- ---------------------------------------------------------------------------
-- 0. Address hash: trim all whitespace, like recipientHash
-- ---------------------------------------------------------------------------

-- create or replace keeps the owner-only ACL from 20261013180200.
create or replace function public.guest_mail_email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(lower(regexp_replace(
    p_email,
    '^[\t\n\v\f\r    -     　﻿]+'
    '|[\t\n\v\f\r    -     　﻿]+$',
    '', 'g')), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- 1. Test mails in mail_log
-- ---------------------------------------------------------------------------

alter table public.mail_log
  add column is_test boolean not null default false,
  add column test_by uuid references auth.users (id) on delete set null,
  add constraint mail_log_test_by_check check ((test_by is null) or is_test);

comment on column public.mail_log.is_test is
  'A platform admin''s test mail (20261015130000): logged and tracked like any '
  'mail, outside every company and overall budget.';

create index mail_log_test_created_idx on public.mail_log (test_by, created_at desc) where is_test;

-- Budgets and the recipient window leave test mails out. Bodies as live
-- (20261013180200 / 20261013180600) plus `and not m.is_test`.
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
     and not m.is_test
     and (p_venue_id is null or m.venue_id = p_venue_id)
     and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

create or replace function public.team_mail_sent_today(p_venue_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int
    from public.mail_log m
   where m.type in ('team_request', 'team_quota', 'team_decision', 'team_digest')
     and m.status <> 'failed'
     and not m.is_test
     and (p_venue_id is null or m.venue_id = p_venue_id)
     and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

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
  -- notification mail, or a platform admin's test mail (20261015130000).
  if p_type not in ('team_invite_declined', 'team_invite_declined_confirm')
     and exists (
       select 1 from public.mail_log m
        where m.recipient_hash = p_recipient_hash
          and m.type not in ('team_invite_declined', 'team_invite_declined_confirm', 'platform_digest',
                             'team_request', 'team_quota', 'team_decision', 'team_digest')
          and m.type not like 'billing\_%'
          and m.type not like 'guest\_%'
          and m.status <> 'failed'
          and not m.is_test
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

-- ---------------------------------------------------------------------------
-- 2. The confirmation state per guest
-- ---------------------------------------------------------------------------
-- state (the newest confirmation: "You're on the list" or the approval mail):
--   not_sent    an address, but no confirmation went out (never queued, the
--               "Send confirmation" switch was off, skipped or canceled)
--   queued      waiting in the queue or being sent
--   sent        handed to the provider, no delivery report (yet)
--   delivered   the provider reports delivery
--   bounced     the receiving server refused it
--   complained  the guest marked it as spam
--   failed      the provider refused it, or the outcome is unknown
--   opted_out   the guest stopped this company's mail (never resent)
-- needs_new_address: ANY confirmation to this guest bounced or was marked as
-- spam at the address the guest has now (same normalised hash), whatever the
-- newest state is (review #463: bounce, change to a bad address that fails,
-- change back must not reopen the resend).
-- can_resend: the event is still ahead and not cancelled, the guest holds a
-- spot, has an address, has not opted out, no bounce at this address, fewer
-- than guest_confirmation_resend_daily_cap() resends today, and the state is
-- not_sent, failed, or bounced/complained at an address since changed.

-- Resends per guest (review #463: at most 3 a day, in the database).
create table public.guest_confirmation_resends (
  id uuid primary key default public.uuid_generate_v7(),
  guest_id uuid not null references public.guests (id) on delete cascade,
  queue_id uuid references public.guest_mail_queue (id) on delete set null,
  actor uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.guest_confirmation_resends is
  'One row per "Resend confirmation" (20261015130000): the daily cap per '
  'guest. Written only by resend_guest_confirmation. No app-role grants.';
create index guest_confirmation_resends_guest_idx
  on public.guest_confirmation_resends (guest_id, created_at desc);
alter table public.guest_confirmation_resends enable row level security;
-- No policies: RLS on + no grants = closed.

create or replace function public.guest_confirmation_resend_daily_cap()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

create or replace function public.guest_confirmation_state(p_guest_id uuid)
returns table (
  state text,
  mail_type text,
  can_resend boolean,
  needs_new_address boolean,
  source_request_id uuid,
  remark text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_g record;
  v_q record;
  v_hash text;
  v_state text;
  v_open boolean;
  v_bounced_here boolean;
  v_resends integer;
begin
  select g.id, g.venue_id, g.status, g.email, g.anonymized_at,
         e.cancelled_at, coalesce(e.ends_at, e.starts_at + interval '12 hours') as ends_at
    into v_g
    from public.guests g
    join public.events e on e.id = g.event_id
   where g.id = p_guest_id;
  if not found or v_g.anonymized_at is not null
     or nullif(btrim(coalesce(v_g.email, '')), '') is null then
    return;
  end if;
  v_hash := public.guest_mail_email_hash(v_g.email);

  select q.type, q.status, q.reason, q.source_request_id, q.remark, m.status as log_status
    into v_q
    from public.guest_mail_queue q
    left join public.mail_log m on m.id = q.mail_log_id
   where q.guest_id = p_guest_id
     and q.type in ('guest_on_list', 'guest_request_approved', 'guest_request_partly')
   order by q.created_at desc, q.id desc
   limit 1;

  v_bounced_here := exists (
    select 1
      from public.guest_mail_queue q
      join public.mail_log m on m.id = q.mail_log_id
     where q.guest_id = p_guest_id
       and q.type in ('guest_on_list', 'guest_request_approved', 'guest_request_partly')
       and m.status in ('bounced', 'complained')
       and m.recipient_hash = v_hash);

  if exists (select 1 from public.guest_mail_optouts o
              where o.venue_id = v_g.venue_id and o.email_hash = v_hash) then
    v_state := 'opted_out';
  elsif v_q.type is null then
    v_state := 'not_sent';
  elsif v_q.status in ('pending', 'sending') then
    v_state := 'queued';
  elsif v_q.status = 'sent' then
    v_state := case v_q.log_status
                 when 'delivered' then 'delivered'
                 when 'bounced' then 'bounced'
                 when 'complained' then 'complained'
                 when 'failed' then 'failed'
                 else 'sent' end;
  elsif v_q.status = 'failed' then
    v_state := 'failed';
  elsif v_q.status = 'skipped' and v_q.reason = 'opted_out' then
    v_state := 'opted_out';
  else
    v_state := 'not_sent';
  end if;

  select count(*)::int into v_resends
    from public.guest_confirmation_resends r
   where r.guest_id = p_guest_id
     and r.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  v_open := v_g.cancelled_at is null
            and v_g.ends_at > now()
            and public.guest_mail_has_spot(v_g.status);

  state := v_state;
  mail_type := v_q.type;
  source_request_id := v_q.source_request_id;
  remark := v_q.remark;
  needs_new_address := v_bounced_here;
  can_resend := v_open
    and not v_bounced_here
    and v_resends < public.guest_confirmation_resend_daily_cap()
    and v_state in ('not_sent', 'failed', 'bounced', 'complained');
  return next;
end;
$$;

comment on function public.guest_confirmation_state(uuid) is
  'Owner-only helper (20261015130000): the state of a guest''s confirmation '
  'mail and whether it may be sent again. Any bounce or complaint at the '
  'address the guest has now blocks a resend until the address changes; at '
  'most guest_confirmation_resend_daily_cap() resends per guest per UTC day.';

-- The guest list read. Redefined: the 20261013180000 version (newest mail of
-- any type) had no app caller. SECURITY DEFINER for the queue and mail_log
-- reads, so it repeats the guests_select policy (20260708120000) as its row
-- filter: a caller gets exactly the guests RLS shows them (review #463;
-- mail_delivery_status.test.sql compares the two for every seed role).
drop function public.event_guest_mail_status(uuid);

create function public.event_guest_mail_status(p_event_id uuid)
returns table (guest_id uuid, type text, status text, can_resend boolean, needs_new_address boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
begin
  select e.venue_id into v_venue from public.events e where e.id = p_event_id;
  if v_venue is null
     or not (public.is_venue_member(v_venue) or public.is_event_organizer(p_event_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select g.id, s.mail_type, s.state, s.can_resend, s.needs_new_address
    from public.guests g
    cross join lateral public.guest_confirmation_state(g.id) s
   where g.event_id = p_event_id
     and public.guest_mail_has_spot(g.status)
     -- = guests_select
     and (
       public.has_venue_role(g.venue_id, '{admin,finance,doorhost}'::public.venue_role[])
       or public.is_event_organizer(g.event_id)
       or (
         public.has_venue_role(g.venue_id, '{staff}'::public.venue_role[])
         and g.added_by = (select auth.uid())
       )
     );
end;
$$;

comment on function public.event_guest_mail_status(uuid) is
  'Guest list (members/organizers of the event, 42501 otherwise): per guest '
  'the caller may see (the guests_select predicate) with a spot and an '
  'address, the state of their confirmation mail and whether it may be sent '
  'again (20261015130000). Ids and states only.';

-- ---------------------------------------------------------------------------
-- 3. Resend
-- ---------------------------------------------------------------------------
-- The server action first proves through the caller's own session that they
-- may edit this guest (can_edit_guest below: RLS decides), then calls this
-- with the service client. It re-queues the ORIGINAL confirmation type: an
-- approval mail keeps its request (split tiers, "you asked for N"); its note
-- is only there while the original row has not settled (the queue NULLs a
-- remark the moment a row settles), so a resend usually goes without it. An
-- approval whose request is no longer approved falls back to "You're on the
-- list". Errors:
--   PMB01  bounced or complained at the address the guest has now
--   PM429  the daily resend cap for this guest is reached
--   22023  nothing to resend (sent or delivered, opted out, no spot, the
--          event is over or cancelled, no address)

create or replace function public.resend_guest_confirmation(p_guest_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('guest_mail:' || coalesce(p_guest_id::text, ''), 0));

  select * into v_s from public.guest_confirmation_state(p_guest_id);
  if v_s.state is null then
    raise exception 'nothing to resend' using errcode = '22023';
  end if;

  -- A second click while one is queued: that row, nothing new.
  if v_s.state = 'queued' then
    select q.id into v_id
      from public.guest_mail_queue q
     where q.guest_id = p_guest_id
       and q.status in ('pending', 'sending')
       and q.type in ('guest_on_list', 'guest_request_approved', 'guest_request_partly')
     order by q.created_at desc
     limit 1;
    return v_id;
  end if;

  if v_s.needs_new_address then
    raise exception 'the address bounced: change it first' using errcode = 'PMB01';
  end if;
  if (select count(*) from public.guest_confirmation_resends r
       where r.guest_id = p_guest_id
         and r.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
     >= public.guest_confirmation_resend_daily_cap() then
    raise exception 'resend limit reached' using errcode = 'PM429';
  end if;
  if not v_s.can_resend then
    raise exception 'nothing to resend' using errcode = '22023';
  end if;

  if v_s.mail_type in ('guest_request_approved', 'guest_request_partly') and v_s.source_request_id is not null then
    v_id := public.enqueue_guest_mail(p_guest_id, v_s.mail_type, v_s.remark, p_actor, 0, v_s.source_request_id);
  end if;
  if v_id is null then
    v_id := public.enqueue_guest_mail(p_guest_id, 'guest_on_list', null, p_actor, 0, null);
  end if;
  if v_id is null then
    raise exception 'nothing to resend' using errcode = '22023';
  end if;

  insert into public.guest_confirmation_resends (guest_id, queue_id, actor)
  values (p_guest_id, v_id, p_actor);
  return v_id;
end;
$$;

comment on function public.resend_guest_confirmation(uuid, uuid) is
  'Server action (service_role), after can_edit_guest() held for the caller: '
  'queue the original confirmation again (same queue, same budgets). PMB01 '
  'while it bounced at the address the guest has now; PM429 past 3 resends '
  'per guest per day; 22023 when there is nothing to resend.';

-- Can the caller edit this guest? The answer of RLS itself (guests_update and
-- every guard trigger on it, list lock included), not a copy of the policy:
-- a no-op update is tried inside a subtransaction and always rolled back, so
-- nothing is written (no audit row either). SECURITY INVOKER.
create or replace function public.can_edit_guest(p_guest_id uuid)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_ok boolean := false;
begin
  begin
    update public.guests g set email = g.email where g.id = p_guest_id returning true into v_ok;
    raise exception 'probe' using errcode = 'P0PRB';
  exception
    when sqlstate 'P0PRB' then null;
    when others then v_ok := false;
  end;
  return coalesce(v_ok, false);
end;
$$;

comment on function public.can_edit_guest(uuid) is
  'True when the caller''s own session may update this guest (RLS and guard '
  'triggers decide). Writes nothing: the probe update is always rolled back.';

-- ---------------------------------------------------------------------------
-- 4. Platform mail log
-- ---------------------------------------------------------------------------

alter table public.platform_access_log alter column venue_id drop not null;
comment on column public.platform_access_log.venue_id is
  'The company accessed; null for an access that belongs to no company (a '
  'mail log address of a digest or platform invite, 20261015130000).';

-- The current address behind a mail, only when it is still the address the
-- mail went to (its hash matches); null otherwise or when no source links it
-- (team invites keep no link). Owner-only.
create or replace function public.mail_log_recipient(p_mail_log_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_email text;
begin
  select m.recipient_hash into v_hash from public.mail_log m where m.id = p_mail_log_id;
  if v_hash is null then
    return null;
  end if;

  select coalesce(g.email, r.email) into v_email
    from public.guest_mail_queue q
    left join public.guests g on g.id = q.guest_id
    left join public.guest_requests r on r.id = q.guest_request_id
   where q.mail_log_id = p_mail_log_id
   limit 1;
  if v_email is null then
    select p.email into v_email
      from public.team_mail_links l join public.user_profiles p on p.id = l.user_id
     where l.mail_log_id = p_mail_log_id limit 1;
  end if;
  if v_email is null then
    select p.email into v_email
      from public.team_digest_deliveries d join public.user_profiles p on p.id = d.user_id
     where d.mail_log_id = p_mail_log_id limit 1;
  end if;
  if v_email is null then
    select p.email into v_email
      from public.billing_mail_deliveries d join public.user_profiles p on p.id = d.recipient_id
     where d.mail_log_id = p_mail_log_id limit 1;
  end if;
  if v_email is null then
    select p.email into v_email
      from public.platform_digest_deliveries d join public.user_profiles p on p.id = d.recipient_id
     where d.mail_log_id = p_mail_log_id limit 1;
  end if;

  if v_email is null or public.guest_mail_email_hash(v_email) <> v_hash then
    return null;
  end if;
  return lower(btrim(v_email));
end;
$$;

-- "lotte@gmail.com" -> "l***@g***.com". Owner-only.
create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(split_part(p_email, '@', 1), 1) || '***@'
         || left(split_part(p_email, '@', 2), 1) || '***'
         || coalesce('.' || nullif(regexp_replace(split_part(p_email, '@', 2), '^.*\.', ''), split_part(p_email, '@', 2)), '')
  end
$$;

-- p_filters: { venue_id?, type?, status?, test? } ; newest first.
create or replace function public.platform_mail_log(
  p_limit integer default 50,
  p_offset integer default 0,
  p_venue_id uuid default null,
  p_type text default null,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select count(*)::int into v_total
    from public.mail_log m
   where (p_venue_id is null or m.venue_id = p_venue_id)
     and (p_type is null or m.type = p_type)
     and (p_status is null or m.status = p_status);

  select coalesce(jsonb_agg(x.row order by x.created_at desc, x.id desc), '[]'::jsonb) into v_rows
    from (
      select m.created_at, m.id, jsonb_build_object(
               'id', m.id,
               'type', m.type,
               'status', m.status,
               'error_code', m.error_code,
               'is_test', m.is_test,
               'created_at', m.created_at,
               'updated_at', m.updated_at,
               'venue_id', m.venue_id,
               'venue_name', v.name,
               'event_id', e.id,
               'event_name', e.name,
               'recipient', public.mask_email(public.mail_log_recipient(m.id))) as row
        from public.mail_log m
        left join public.venues v on v.id = m.venue_id
        left join lateral (
          select q.event_id from public.guest_mail_queue q where q.mail_log_id = m.id limit 1
        ) gq on true
        left join public.events e on e.id = gq.event_id
       where (p_venue_id is null or m.venue_id = p_venue_id)
         and (p_type is null or m.type = p_type)
         and (p_status is null or m.status = p_status)
       order by m.created_at desc, m.id desc
       limit v_limit offset v_offset
    ) x;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

comment on function public.platform_mail_log(integer, integer, uuid, text, text) is
  'Platform tab (is_platform_admin() only, 42501 otherwise): every outgoing '
  'mail, newest first, with type, company, event where known, status, test '
  'flag and a MASKED address (20261015130000). The full address only through '
  'platform_reveal_mail_recipient.';

-- The full address for one mail, for a concrete support ticket (decision 8):
-- a ticket reference is required and every reveal writes a
-- platform_access_log row naming the mail. Null when the address changed
-- since or no source links it (the row is written all the same).
create or replace function public.platform_reveal_mail_recipient(p_mail_log_id uuid, p_ticket text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket text := btrim(coalesce(p_ticket, ''));
  v_venue uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(v_ticket) < 3 or char_length(v_ticket) > 200 or v_ticket ~ '[[:cntrl:]]' then
    raise exception 'a ticket reference is required' using errcode = '22023';
  end if;
  select m.venue_id into v_venue from public.mail_log m where m.id = p_mail_log_id;
  if not found then
    raise exception 'no such mail' using errcode = '22023';
  end if;

  insert into public.platform_access_log (admin_id, venue_id, reason)
  values ((select auth.uid()), v_venue, 'mail_recipient ' || p_mail_log_id || ': ' || v_ticket);

  return public.mail_log_recipient(p_mail_log_id);
end;
$$;

comment on function public.platform_reveal_mail_recipient(uuid, text) is
  'Platform admin: the full address of one logged mail, for a support ticket. '
  'Requires a ticket reference; always writes a platform_access_log row '
  '(reason "mail_recipient <id>: <ticket>"). 20261015130000.';

-- ---------------------------------------------------------------------------
-- 5. Test mails
-- ---------------------------------------------------------------------------

create or replace function public.platform_test_mail_limit()
returns integer language sql immutable set search_path = '' as $$ select 10 $$;

create or replace function public.platform_test_mail_daily_cap()
returns integer language sql immutable set search_path = '' as $$ select 30 $$;

-- Who a test mail may go to (review #463, decision orchestrator 2026-10-11):
-- the sign-in address of a current platform admin, nobody else, so a test
-- can never be used to mail an outsider from our domain. Platform admins only.
create or replace function public.platform_test_mail_recipients()
returns table (user_id uuid, email text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select p.id, lower(btrim(u.email::text)), p.full_name
    from public.user_profiles p
    join auth.users u on u.id = p.id
   where p.is_platform_admin
     and nullif(btrim(coalesce(u.email::text, '')), '') is not null
   order by p.full_name nulls last, u.email;
end;
$$;

comment on function public.platform_test_mail_recipients() is
  'Platform admin: the sign-in addresses a test mail may go to (every current '
  'platform admin). 20261015130000.';

-- The test mail's log row (the caller's own session, platform admins only),
-- only to a current platform admin's sign-in address (22023 otherwise),
-- within 10 per admin and 30 overall per UTC day. PM429 over the limit.
create or replace function public.log_platform_test_mail(p_type text, p_recipient_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_id uuid;
begin
  if v_uid is null or not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.user_profiles p
      join auth.users u on u.id = p.id
     where p.is_platform_admin
       and public.guest_mail_email_hash(u.email::text) = p_recipient_hash
  ) then
    raise exception 'a test mail goes to a platform admin only' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_test_mail', 0));
  if (select count(*) from public.mail_log m
       where m.is_test and m.test_by = v_uid and m.created_at >= v_day) >= public.platform_test_mail_limit()
     or (select count(*) from public.mail_log m
          where m.is_test and m.created_at >= v_day) >= public.platform_test_mail_daily_cap() then
    raise exception 'test mail limit reached' using errcode = 'PM429';
  end if;

  -- The type check constraint refuses an unknown type (23514).
  insert into public.mail_log (type, venue_id, recipient_hash, is_test, test_by)
  values (p_type, null, p_recipient_hash, true, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_platform_test_mail(text, text) is
  'Platform admin: log a test mail (is_test, no company) before it is sent, '
  'to a platform admin''s sign-in address only; its own limit (10 per admin, '
  '30 overall per UTC day), outside every company and overall budget '
  '(20261015130000).';

-- ---------------------------------------------------------------------------
-- Grant matrix (functions; no new tables)
-- ---------------------------------------------------------------------------

revoke all on table public.guest_confirmation_resends from anon, authenticated, service_role;

revoke execute on function
  public.guest_confirmation_resend_daily_cap(),
  public.platform_test_mail_recipients(),
  public.guest_confirmation_state(uuid),
  public.mail_log_recipient(uuid),
  public.mask_email(text),
  public.platform_test_mail_limit(),
  public.platform_test_mail_daily_cap(),
  public.resend_guest_confirmation(uuid, uuid),
  public.event_guest_mail_status(uuid),
  public.can_edit_guest(uuid),
  public.platform_mail_log(integer, integer, uuid, text, text),
  public.platform_reveal_mail_recipient(uuid, text),
  public.log_platform_test_mail(text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.resend_guest_confirmation(uuid, uuid) to service_role;
grant execute on function
  public.event_guest_mail_status(uuid),
  public.can_edit_guest(uuid),
  public.platform_mail_log(integer, integer, uuid, text, text),
  public.platform_reveal_mail_recipient(uuid, text),
  public.platform_test_mail_recipients(),
  public.log_platform_test_mail(text, text)
  to authenticated;
