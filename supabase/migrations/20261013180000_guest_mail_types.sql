-- Gastcommunicatie F, PR 6a (z8uq9m2vpy): guest mail types + the guest-mail queue.
--
-- Guests get transactional mail about their own spot on a list (spec #10,
-- revised): "You're on the list", +N changed, event details changed, event
-- canceled, removed (with the team's note), the platform-admin reminder, and
-- the three request decisions. Copy v3 (docs/copy-review/guest-mails.html).
--
-- What this migration adds:
--   1. mail_log.type gains nine guest_* types, ADDITIVELY: the constraint
--      becomes the union of what it allows when this runs, every type known
--      on main and in the open PRs (platform_invite 20261013130000,
--      platform_digest #440 20261013150000, seven billing_* #446
--      20261013170000) and the guest types. Merge order cannot drop a type.
--   2. Guest mail stays OUT of the invitation limits, exactly like billing
--      mail: mail_venue_cap_reached no longer counts guest_* rows (an event
--      change to 150 guests must never eat a company's 25 invites a day), and
--      log_mail_attempt's 60-second recipient window neither counts nor
--      applies to them. log_mail_attempt refuses guest_* (and billing_*):
--      guest mail has its own write path (guest_mails_claim, 20261013180200)
--      with its own per-company and global budgets.
--   3. guest_mail_queue: one row per guest per mail. NO address, no name, no
--      content: the row points at the guest (or the request, for a decline)
--      and the facts are read again when the mail is rendered, so a mail
--      always carries the CURRENT spot, time and place. The only free text is
--      the team's note (remark), which is NULLed as soon as the row settles.
--   4. Two enqueue RPCs, service_role only, called by the server actions AFTER
--      the user-scoped mutation succeeded (that mutation, under RLS, is the
--      authorization; same stance as sendTeamMail). They derive everything
--      from the database: the caller cannot choose a recipient, only a guest
--      or an event, and only a type that fits the guest's current state.
--        enqueue_guest_mail(guest, type, remark, actor, delay)
--        enqueue_event_mail(event, type, remark, actor, delay)
--        enqueue_request_declined_mail(request, remark, actor)
--   5. event_guest_mail_status(event): per guest the latest guest mail and its
--      delivery status, for the guest list's "no confirmation" marker. Ids and
--      statuses only.
--
-- The door never reaches any of this: nothing under src/features/door calls
-- an enqueue RPC, and the queue is drained by a separate job (20261013180200),
-- never in a request path.

-- ---------------------------------------------------------------------------
-- 1. mail_log type — additive
-- ---------------------------------------------------------------------------
-- Additive, not a hard-coded list (orchestrator, 2026-10-10): the new
-- constraint is the union of (a) whatever the constraint allows when this
-- migration runs (so a type a later-merged predecessor added survives), (b)
-- every type known on main and in the open golf-E PRs (so a type a
-- predecessor dropped by accident comes back: #440 once lost
-- 'platform_invite') and (c) the nine guest types.

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
      'team_join', 'team_added_to_event', 'team_resend', 'auth_invite',
      'team_invite_declined', 'team_invite_declined_confirm',
      'platform_invite',
      'platform_digest',
      'billing_trial_day0', 'billing_trial_day7', 'billing_trial_day12',
      'billing_trial_ended', 'billing_trial_day21',
      'billing_payment_failed', 'billing_canceled',
      'guest_on_list', 'guest_plus_ones', 'guest_event_changed',
      'guest_event_canceled', 'guest_removed', 'guest_reminder',
      'guest_request_approved', 'guest_request_partly', 'guest_request_declined'
    ]) as t
    order by t);

  alter table public.mail_log drop constraint if exists mail_log_type_check;
  execute format(
    'alter table public.mail_log add constraint mail_log_type_check check (type = any (%L::text[]))',
    v_types);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Billing and guest mail outside the invitation limits
-- ---------------------------------------------------------------------------
-- Bodies are the union of every live rule: 20261011120000 (failed rows free),
-- 20261013150000 (platform_digest rows never start a recipient window, #440),
-- 20261013170000 (billing mails out, #446) plus the guest_ predicate; signatures,
-- security, search_path and grants unchanged (create or replace keeps the ACL).

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
     and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

comment on function public.mail_venue_cap_reached(uuid) is
  'True when the venue sent mail_venue_daily_cap() invitation mails (failed '
  'attempts excluded since 20261011120000, billing mails since 20261013170000, '
  'guest mails since 20261013180000) in the current UTC day. service_role only.';

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
  -- Billing and guest mails have their own paths and never come here.
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

  -- Serialise concurrent sends to one recipient so two parallel calls can't
  -- both pass the window check.
  perform pg_advisory_xact_lock(hashtextextended('mail_log:' || coalesce(p_recipient_hash, ''), 0));

  -- The decline mails are exempt from the window and do not start one. A
  -- failed attempt (nothing went out) does not start one either, and neither
  -- does the platform digest (20261013150000), a billing or a guest mail.
  if p_type not in ('team_invite_declined', 'team_invite_declined_confirm')
     and exists (
       select 1 from public.mail_log m
        where m.recipient_hash = p_recipient_hash
          and m.type not in ('team_invite_declined', 'team_invite_declined_confirm', 'platform_digest')
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
  'platform_digest row does not count, 20261013150000; '
  'billing mails neither count nor pass here, 20261013170000; guest mails '
  'neither, 20261013180000) and a venue past mail_venue_daily_cap() for the '
  'UTC day.';

-- ---------------------------------------------------------------------------
-- 3. The queue
-- ---------------------------------------------------------------------------

create table public.guest_mail_queue (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  -- Exactly one target: the guest row, or (a declined request has no guest)
  -- the request row.
  guest_id uuid references public.guests (id) on delete cascade,
  guest_request_id uuid references public.guest_requests (id) on delete cascade,
  -- The request an approval mail answers (guest_request_approved/_partly):
  -- where "you asked for 5" comes from. Not a target, just the source.
  source_request_id uuid references public.guest_requests (id) on delete set null,
  type text not null
    constraint guest_mail_queue_type_check
    check (type in (
      'guest_on_list', 'guest_plus_ones', 'guest_event_changed',
      'guest_event_canceled', 'guest_removed', 'guest_reminder',
      'guest_request_approved', 'guest_request_partly', 'guest_request_declined'
    )),
  -- The team's own words, shown as "Note from the team". Free text, so it is
  -- NULLed the moment the row settles (sent, failed for good, skipped).
  remark text
    constraint guest_mail_queue_remark_check
    check (remark is null or char_length(remark) between 1 and 500),
  status text not null default 'pending'
    constraint guest_mail_queue_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'canceled')),
  -- Why a row was skipped or canceled: a short machine code, never text.
  reason text
    constraint guest_mail_queue_reason_check
    check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  attempts smallint not null default 0,
  mail_log_id uuid references public.mail_log (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_mail_queue_one_target check ((guest_id is null) <> (guest_request_id is null)),
  constraint guest_mail_queue_declined_target check (
    (type = 'guest_request_declined') = (guest_request_id is not null)
  ),
  constraint guest_mail_queue_source_request check (
    source_request_id is null or type in ('guest_request_approved', 'guest_request_partly')
  )
);

comment on table public.guest_mail_queue is
  'Guest mails waiting for the guest-mail job (20261013180000): one row per '
  'guest per mail, no address or name, the facts are read at send time. '
  'Written only by the enqueue RPCs and the job RPCs (service_role). No '
  'app-role grants.';

-- One pending row per guest per type: a second enqueue (an edit within the
-- debounce window) moves send_after instead of queueing a second mail.
create unique index guest_mail_queue_pending_guest_idx
  on public.guest_mail_queue (guest_id, type)
  where status = 'pending' and guest_id is not null;
create unique index guest_mail_queue_pending_request_idx
  on public.guest_mail_queue (guest_request_id, type)
  where status = 'pending' and guest_request_id is not null;
-- The job's scan.
create index guest_mail_queue_due_idx
  on public.guest_mail_queue (send_after)
  where status in ('pending', 'sending');
create index guest_mail_queue_event_idx on public.guest_mail_queue (event_id, created_at desc);
create index guest_mail_queue_venue_idx on public.guest_mail_queue (venue_id, created_at desc);
create index guest_mail_queue_mail_log_idx on public.guest_mail_queue (mail_log_id)
  where mail_log_id is not null;

alter table public.guest_mail_queue enable row level security;
-- No policies: RLS on + no grants = closed. event_guest_mail_status is the
-- only read path for app roles.

-- ---------------------------------------------------------------------------
-- 4. Enqueue — service_role only
-- ---------------------------------------------------------------------------

-- A guest still holds a spot when approved or checked in. pending/denied/
-- refused/removed hold none.
create or replace function public.guest_mail_has_spot(p_status public.guest_status)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status in ('approved', 'checked_in') $$;

-- Per-guest mails. Returns the queue row id, or NULL when nothing was queued
-- (no address, anonymized, a canceled or ended event, or the state does not
-- fit the type). Raises 22023 for a type that is not per guest, and for a
-- removal without a note (the note is mandatory: copy v3, decision Max).
--
-- Ordering rules, so a guest never gets a confusing sequence:
--   * removed while the confirmation is still pending: the pending mails are
--     canceled and NO removal mail goes out (they never heard they were on);
--   * +N changed while the confirmation is still pending: nothing new, the
--     confirmation renders the current count at send time;
--   * the same mail queued again before it went: one row, send_after moves
--     (the debounce: an admin tapping +1 three times sends one mail).
create or replace function public.enqueue_guest_mail(
  p_guest_id uuid,
  p_type text,
  p_remark text default null,
  p_actor uuid default null,
  p_delay_seconds integer default 0,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest record;
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
  v_after timestamptz := now() + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 0), 0), 900));
  v_id uuid;
begin
  if p_type not in ('guest_on_list', 'guest_plus_ones', 'guest_removed',
                    'guest_request_approved', 'guest_request_partly') then
    raise exception 'not a per-guest mail type' using errcode = '22023';
  end if;
  if p_type = 'guest_removed' and v_remark is null then
    raise exception 'a removal mail needs a note' using errcode = '22023';
  end if;
  if v_remark is not null and char_length(v_remark) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  if (p_type in ('guest_request_approved', 'guest_request_partly')) <> (p_request_id is not null) then
    raise exception 'an approval mail names its request, no other mail does' using errcode = '22023';
  end if;

  -- Serialise enqueues for one guest (two quick edits from two devices).
  perform pg_advisory_xact_lock(hashtextextended('guest_mail:' || coalesce(p_guest_id::text, ''), 0));

  select g.id, g.venue_id, g.event_id, g.status, g.email, g.anonymized_at,
         e.cancelled_at, coalesce(e.ends_at, e.starts_at + interval '12 hours') as ends_at
    into v_guest
    from public.guests g
    join public.events e on e.id = g.event_id
   where g.id = p_guest_id;

  if not found
     or v_guest.anonymized_at is not null
     or nullif(btrim(coalesce(v_guest.email, '')), '') is null
     or v_guest.cancelled_at is not null
     or v_guest.ends_at < now() then
    return null;
  end if;

  if p_type = 'guest_removed' then
    if v_guest.status <> 'removed' then
      return null;
    end if;
    update public.guest_mail_queue q
       set status = 'canceled', reason = 'removed_before_send', remark = null, updated_at = now()
     where q.guest_id = p_guest_id
       and q.status = 'pending'
       and q.type in ('guest_on_list', 'guest_request_approved', 'guest_request_partly',
                      'guest_plus_ones', 'guest_reminder', 'guest_event_changed');
    -- Nothing ever reached them about this spot: no removal mail either.
    if not exists (
      select 1 from public.guest_mail_queue q
       where q.guest_id = p_guest_id
         and q.status in ('sending', 'sent')
         and q.type in ('guest_on_list', 'guest_request_approved', 'guest_request_partly',
                        'guest_plus_ones', 'guest_reminder', 'guest_event_changed')
    ) then
      return null;
    end if;
  else
    if not public.guest_mail_has_spot(v_guest.status) then
      return null;
    end if;
  end if;

  -- The request must be approved and for this guest's event.
  if p_request_id is not null and not exists (
    select 1 from public.guest_requests r
     where r.id = p_request_id
       and r.event_id = v_guest.event_id
       and r.status = 'approved'
  ) then
    return null;
  end if;

  if p_type = 'guest_plus_ones' then
    select q.id into v_id
      from public.guest_mail_queue q
     where q.guest_id = p_guest_id
       and q.status = 'pending'
       and q.type in ('guest_on_list', 'guest_request_approved', 'guest_request_partly');
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.guest_mail_queue as q
    (venue_id, event_id, guest_id, source_request_id, type, remark, send_after, created_by)
  values
    (v_guest.venue_id, v_guest.event_id, p_guest_id, p_request_id, p_type, v_remark, v_after, p_actor)
  on conflict (guest_id, type) where status = 'pending' and guest_id is not null
  do update set send_after = excluded.send_after,
                remark = coalesce(excluded.remark, q.remark),
                source_request_id = coalesce(excluded.source_request_id, q.source_request_id),
                updated_at = now()
  returning q.id into v_id;
  return v_id;
end;
$$;

comment on function public.enqueue_guest_mail(uuid, text, text, uuid, integer, uuid) is
  'Server actions (service_role), after the user-scoped mutation succeeded: '
  'queue one per-guest mail. Derives venue, event and eligibility from the '
  'database; NULL when nothing was queued. Removal needs a note.';

-- Per-event mails: one queue row per guest who holds a spot and has an
-- address. Returns how many rows were queued or moved.
--   * canceled: every pending mail of the event is canceled first.
--   * changed: guests whose confirmation is still pending get nothing new
--     (it renders the new details); a pending change mail moves send_after.
--   * reminder: guests whose confirmation is still pending are skipped too.
-- An ended event queues nothing.
create or replace function public.enqueue_event_mail(
  p_event_id uuid,
  p_type text,
  p_remark text default null,
  p_actor uuid default null,
  p_delay_seconds integer default 0
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
  v_after timestamptz := now() + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 0), 0), 900));
  v_count integer;
begin
  if p_type not in ('guest_event_changed', 'guest_event_canceled', 'guest_reminder') then
    raise exception 'not a per-event mail type' using errcode = '22023';
  end if;
  if v_remark is not null and char_length(v_remark) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('guest_mail_event:' || coalesce(p_event_id::text, ''), 0));

  select e.id, e.venue_id, e.cancelled_at,
         coalesce(e.ends_at, e.starts_at + interval '12 hours') as ends_at
    into v_event
    from public.events e
   where e.id = p_event_id;

  if not found or v_event.ends_at < now() then
    return 0;
  end if;

  if p_type = 'guest_event_canceled' then
    if v_event.cancelled_at is null then
      return 0;
    end if;
    update public.guest_mail_queue q
       set status = 'canceled', reason = 'event_canceled', remark = null, updated_at = now()
     where q.event_id = p_event_id
       and q.status = 'pending'
       and q.type <> 'guest_event_canceled';
  elsif v_event.cancelled_at is not null then
    return 0;
  end if;

  insert into public.guest_mail_queue as q
    (venue_id, event_id, guest_id, type, remark, send_after, created_by)
  select g.venue_id, g.event_id, g.id, p_type, v_remark, v_after, p_actor
    from public.guests g
   where g.event_id = p_event_id
     and public.guest_mail_has_spot(g.status)
     and g.anonymized_at is null
     and nullif(btrim(coalesce(g.email, '')), '') is not null
     and (p_type = 'guest_event_canceled' or not exists (
       select 1 from public.guest_mail_queue p
        where p.guest_id = g.id
          and p.status = 'pending'
          and p.type in ('guest_on_list', 'guest_request_approved', 'guest_request_partly')
     ))
  on conflict (guest_id, type) where status = 'pending' and guest_id is not null
  do update set send_after = excluded.send_after,
                remark = coalesce(excluded.remark, q.remark),
                updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.enqueue_event_mail(uuid, text, text, uuid, integer) is
  'Server actions (service_role): queue an event-wide guest mail (details '
  'changed, canceled, reminder) for every guest with a spot and an address. '
  'Returns the number of rows queued or moved; 0 for an ended event.';

-- The one mail without a guest row: a whole request declined (task 7 calls
-- this from its decision RPC's action; the note is mandatory). Returns the
-- queue row id or NULL (no address, anonymized, not declined, ended event).
create or replace function public.enqueue_request_declined_mail(
  p_request_id uuid,
  p_remark text,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
  v_id uuid;
begin
  if v_remark is null then
    raise exception 'a decline mail needs a note' using errcode = '22023';
  end if;
  if char_length(v_remark) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;

  select r.id, r.venue_id, r.event_id, r.status, r.email, r.anonymized_at,
         coalesce(e.ends_at, e.starts_at + interval '12 hours') as ends_at
    into v_req
    from public.guest_requests r
    join public.events e on e.id = r.event_id
   where r.id = p_request_id;

  if not found
     or v_req.status <> 'denied'
     or v_req.anonymized_at is not null
     or nullif(btrim(coalesce(v_req.email, '')), '') is null
     or v_req.ends_at < now() then
    return null;
  end if;

  insert into public.guest_mail_queue as q
    (venue_id, event_id, guest_request_id, type, remark, created_by)
  values
    (v_req.venue_id, v_req.event_id, p_request_id, 'guest_request_declined', v_remark, p_actor)
  on conflict (guest_request_id, type) where status = 'pending' and guest_request_id is not null
  do update set remark = excluded.remark, updated_at = now()
  returning q.id into v_id;
  return v_id;
end;
$$;

comment on function public.enqueue_request_declined_mail(uuid, text, uuid) is
  'Request decisions (service_role): queue the decline mail for a denied '
  'request with an address. The note is mandatory (22023 without one).';

-- ---------------------------------------------------------------------------
-- 5. Read path for the guest list (authenticated)
-- ---------------------------------------------------------------------------
-- Per guest of the event: the newest guest mail row and where it stands
-- (pending/sending/sent/delivered/bounced/complained/failed/skipped/canceled).
-- Ids and statuses only. Members of the event's company and the event's
-- organizers; everyone else gets 42501.
create or replace function public.event_guest_mail_status(p_event_id uuid)
returns table (guest_id uuid, type text, status text)
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
  select distinct on (q.guest_id)
         q.guest_id,
         q.type,
         case when q.status = 'sent' and m.status is not null and m.status <> 'queued'
              then m.status else q.status end
    from public.guest_mail_queue q
    left join public.mail_log m on m.id = q.mail_log_id
   where q.event_id = p_event_id
     and q.guest_id is not null
   order by q.guest_id, q.created_at desc, q.id desc;
end;
$$;

comment on function public.event_guest_mail_status(uuid) is
  'Guest list (members/organizers of the event, 42501 otherwise): per guest '
  'the newest guest mail and its status. Ids and statuses only.';

-- ---------------------------------------------------------------------------
-- 6. Grant matrix — revoke first, then grant
-- ---------------------------------------------------------------------------

revoke all on table public.guest_mail_queue from anon, authenticated, service_role;

revoke execute on function
  public.enqueue_guest_mail(uuid, text, text, uuid, integer, uuid),
  public.enqueue_event_mail(uuid, text, text, uuid, integer),
  public.enqueue_request_declined_mail(uuid, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.enqueue_guest_mail(uuid, text, text, uuid, integer, uuid),
  public.enqueue_event_mail(uuid, text, text, uuid, integer),
  public.enqueue_request_declined_mail(uuid, text, uuid)
to service_role;

revoke execute on function public.event_guest_mail_status(uuid) from public, anon, service_role;
grant execute on function public.event_guest_mail_status(uuid) to authenticated;

revoke execute on function public.guest_mail_has_spot(public.guest_status)
  from public, anon, authenticated, service_role;
