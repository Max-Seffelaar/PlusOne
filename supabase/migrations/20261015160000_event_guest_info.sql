-- Guest info + live calendar link (z8uq9m4a5n; decision Max 2026-10-11).
--
-- Events get one free-text field for guests: parking, entrance, dress code.
-- It is shown in the guest mails with a spot ("Good to know"), on the status
-- page (/s/[token]) and in the calendar description (.ics and the Google
-- link). The Google link in a mail now points at /s/[token]/google, which
-- reads the CURRENT event on every click, so a later location or time edit
-- reaches it (the static send-time URL is what Max saw empty).
--
-- What this migration does:
--   1. events.guest_info: nullable, 1..1000 characters, no control characters
--      except tab, LF and CR (newlines are allowed: the renderers turn them
--      into <br> / escaped \n, never raw markup). Explicit column grants for
--      authenticated (the 20261013180500 contact_email pattern); RLS on events
--      decides which rows, anon holds nothing.
--   2. audit_events (the ONE consolidated events trigger, 20260708100000) also
--      fires when guest_info changes. The WHEN clause is the
--      20261015140000_location_audit one (#467, merges before this) plus
--      guest_info; on a branch without #467 it is still valid, since
--      location_name/location_address exist since 20261007120000.
--      audit_trigger() itself is unchanged (K10).
--   3. get_guest_status and guest_mails_claim return event.guest_info. Each
--      body is the latest one on main word for word (get_guest_status:
--      20261013180500, guest_mails_claim: 20261015120000) plus two added lines:
--      the column in the context select and the key in the event object.
--      get_guest_status gates it like house_rules (only while the spot holds:
--      on_list / checked_in). Signatures, security, search_path, throttle,
--      token gate and grants unchanged (create or replace keeps the ACL;
--      restated below).
--   No mail is queued by this column: updateEvent queues "New details for …"
--   only for a start-time or location change (src/features/events/actions.ts).
--   Templates do not carry guest_info (like house_rules and contact_email);
--   a template-created event gets it through the form's follow-up update.

-- ---------------------------------------------------------------------------
-- 1. events.guest_info
-- ---------------------------------------------------------------------------

alter table public.events
  add column guest_info text
    constraint events_guest_info_check
    check (guest_info is null or (
      char_length(guest_info) between 1 and 1000
      and guest_info !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    ));

comment on column public.events.guest_info is
  'Free text for guests (parking, entrance, dress code): guest mails with a '
  'spot, the status page and the calendar description (z8uq9m4a5n). Newlines '
  'allowed, other control characters refused. Changes are audited via '
  'audit_events.';

-- Grant matrix (explicit; the table-level grants already cover these). The
-- RLS policies on events decide which rows; anon holds nothing.
revoke all (guest_info) on public.events from anon;
grant select (guest_info) on public.events to authenticated;
grant insert (guest_info) on public.events to authenticated;
grant update (guest_info) on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- 2. audit_events: guest_info changes are audited
-- ---------------------------------------------------------------------------

drop trigger audit_events on public.events;

create trigger audit_events
  after update on public.events
  for each row
  when (
    old.list_locked is distinct from new.list_locked
    or old.allow_uncheck is distinct from new.allow_uncheck
    or old.default_member_quota is distinct from new.default_member_quota
    or old.location_name is distinct from new.location_name
    or old.location_address is distinct from new.location_address
    or old.guest_info is distinct from new.guest_info
  )
  execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 3. Readers: get_guest_status + guest_mails_claim return guest_info
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
  v_tiers jsonb;
  v_parts_of uuid;
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
           e.guest_info,
           e.cancelled_at,
           v.name as company_name, coalesce(e.contact_email, v.contact_email) as contact_email,
           g.status as guest_status, g.email as guest_email, g.full_name as guest_name,
           g.plus_ones, g.tier_id, g.anonymized_at as guest_anonymized,
           g.guest_request_id as guest_request_id,
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
    -- z8uq9m2vga: every part of the decision, so one mail names them all. A
    -- request split over tiers made one guest per part (guest_request_id);
    -- the decision, reminder and event-changed mails list every part, any
    -- other mail with a spot is that one guest's spot. Stable order: the
    -- part that carries the requester's address first (the one the mail is
    -- queued on), then by tier name. Not created_at/id: every part of one
    -- decision shares now(), and uuid_generate_v7 is not monotonic within a
    -- millisecond.
    v_tiers := null;
    if v_spot then
      -- The decision mail names its request; a later reminder or
      -- event-changed mail to a split guest uses the guest's own request
      -- (review S3), so every mail about that spot shows every part.
      v_parts_of := case
        when v_row.type in ('guest_request_approved', 'guest_request_partly')
          then v_row.source_request_id
        when v_row.type in ('guest_reminder', 'guest_event_changed')
          then v_ctx.guest_request_id
      end;
      if v_parts_of is not null then
        select jsonb_agg(jsonb_build_object(
                 'tier_name', t.name,
                 'people', 1 + g.plus_ones,
                 'price_cents', t.door_price_cents)
               order by (g.email is null), t.name, g.id)
          into v_tiers
          from public.guests g
          join public.guest_tiers t on t.id = g.tier_id
         where g.guest_request_id = v_parts_of
           and public.guest_mail_has_spot(g.status);
      end if;
      if v_tiers is null then
        v_tiers := jsonb_build_array(jsonb_build_object(
          'tier_name', v_tier_name,
          'people', v_ctx.plus_ones + 1,
          'price_cents', v_tier_price));
      end if;
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
        'guest_info', nullif(btrim(coalesce(v_ctx.guest_info, '')), ''),
        'updated_at', v_ctx.event_updated_at),
      'company', jsonb_build_object('name', v_ctx.company_name, 'contact_email', v_ctx.contact_email),
      'spot', case when v_spot then jsonb_build_object(
        'plus_ones', v_ctx.plus_ones,
        'tier_name', v_tier_name,
        'price_cents', v_tier_price) end,
      'plus_ones', case when v_row.guest_id is not null then v_ctx.plus_ones end,
      'asked_people', v_asked,
      'tiers', v_tiers,
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
  'venues.contact_email) (20261013180500). Since z8uq9m2vga each payload with '
  'a spot carries `tiers`: every part of a split request (decision, reminder, '
  'event-changed mails), else the one guest''s spot. Since z8uq9m4a5n the '
  'event object carries guest_info.';

revoke execute on function public.guest_mails_claim(integer) from public, anon, authenticated;
grant execute on function public.guest_mails_claim(integer) to service_role;

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
         e.guest_info,
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
      'guest_info', case when v_state in ('on_list', 'checked_in') then nullif(btrim(coalesce(v_s.guest_info, '')), '') end,
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
  'Public guest status page (/s/[token]) and its .ics / Google link: throttled '
  'on the bound st prefix, minimal payload, {found:false} for anything not a '
  'live status token. house_rules and guest_info only while the spot holds.';

revoke execute on function public.get_guest_status(text, text) from public;
grant execute on function public.get_guest_status(text, text) to anon, authenticated;
