-- Gastcommunicatie F, PR 6c (z8uq9m2vpy): a contact address per event.
--
-- Decision Max 2026-10-10 (orchestration §2b): every event carries the
-- address guests see in their mails and reply to. It is REQUIRED when an
-- event is created or saved, typed by the organiser (never pre-filled), and
-- checked server-side (syntax + a DNS domain check, fail-open). The
-- requirement lives in the create/update actions and the form, not in a NOT
-- NULL: existing events keep NULL (expand-contract) and fall back to the
-- company address (venues.contact_email, 20261013180100) until edited.
--
-- What this migration does:
--   1. events.contact_email: nullable, the same strict check as
--      venues.contact_email (no header syntax), explicit column grants.
--      Who may edit an event (RLS events_update_admin_organizer / insert
--      admin) may set it; anon gets nothing (default ACL).
--   2. guest_mails_claim, get_guest_status, resolve_guest_mail_reply read
--      coalesce(events.contact_email, venues.contact_email): reply-to,
--      footer, status page and auto-reply all use the event address, else
--      the company one. The "wait in the queue without a contact address"
--      rule now means: no event address AND no company address.
--      Bodies are the live 20261013180200 ones with only those reads changed;
--      signatures, security, search_path and grants are unchanged
--      (create or replace keeps the ACL).
-- Templates never store a contact address (the organiser types it per
-- event), so create_event_from_template and the template tables are untouched.

-- ---------------------------------------------------------------------------
-- 1. events.contact_email
-- ---------------------------------------------------------------------------

alter table public.events
  add column contact_email text
    constraint events_contact_email_check
    check (contact_email is null or (
      char_length(contact_email) between 3 and 254
      and contact_email ~ '^[^@\s<>",;:]+@[^@\s<>",;:]+\.[^@\s<>",;:]+$'
    ));

comment on column public.events.contact_email is
  'Where guests reach the organiser of this event: reply-to, mail footer, '
  'status page, auto-reply (20261013180500). Required by the create/update '
  'actions; NULL on older events, which fall back to venues.contact_email.';

-- Grant matrix (explicit; the table-level grants already cover these). The
-- RLS policies on events decide which rows; anon holds nothing.
grant select (contact_email) on public.events to authenticated;
grant insert (contact_email) on public.events to authenticated;
grant update (contact_email) on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Readers: event address, else company address
-- ---------------------------------------------------------------------------

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
        join public.events e on e.id = q.event_id
       where q.status = 'pending'
         and q.send_after <= now()
         and coalesce(e.contact_email, v.contact_email) is not null
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
           v.name as company_name, coalesce(e.contact_email, v.contact_email) as contact_email,
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
  'and per day; rows whose event has no contact address (and no company '
  'fallback) wait. Contact = coalesce(events.contact_email, '
  'venues.contact_email) (20261013180500).';

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
         v.name as company_name, coalesce(e.contact_email, v.contact_email) as contact_email,
         v.website, v.contact_channels
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
  select v.name, coalesce(e.contact_email, v.contact_email) as contact_email into v_r
    from public.guest_mail_links l
    join public.venues v on v.id = l.venue_id
    join public.events e on e.id = l.event_id
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
