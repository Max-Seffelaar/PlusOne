-- Requests-epic F1 · part 4/4 — Public RPCs: submission via request links (incl.
-- auto-approve), landing resolution, pageview recording, guest status page.
--
-- /e/[slug] now resolves against request_links.slug (ONE namespace: default
-- links mirror events.landing_slug, so every existing URL keeps working). All
-- anon surfaces follow the #28 discipline — throttle FIRST, unknown/closed/
-- paused/expired indistinguishable, silent dedup — now extended to link slugs
-- and status tokens.
--
--   * submit_guest_request(...) → jsonb   — resolves the LINK (not the event),
--     stamps attribution + the status-token hash, and AUTO-APPROVES when the
--     link says so: guards fall back to a plain pending request (the requester
--     never learns why), the guest is created with added_by NULL (system,
--     #4/#15) and the request is decided decided_via='auto'.
--   * approve_guest_request(...)          — copies attribution onto the guest;
--     45006 (link full) now rolls back a manual approval atomically like 45002.
--   * get_landing_event(p_slug)           — anon-safe landing payload (replaces
--     the page's direct events read; also fixes the cancelled_at gate that the
--     20260625100000 rewrite had regressed to status<>'closed').
--   * record_link_pageview(p_slug, ip)    — funnel step 1, cookie-less counter.
--   * get_request_status(p_token_hash,ip) — the /r/[token] payload: minimal, no
--     contact data, no decision reason (Max 6 jul 2026: reden blijft intern).

-- ---------------------------------------------------------------------------
-- 0. Drop the stale legacy overloads
-- ---------------------------------------------------------------------------
-- 20260624200000 recreated the old 7-arg submit signature (CREATE OR REPLACE on
-- an already-replaced signature = a new overload) — dead since the app calls the
-- full signature. Remove it and the 9-arg text-returning version this migration
-- replaces.

drop function if exists
  public.submit_guest_request(text, text, text, text, integer, text, text);
drop function if exists
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date);

-- ---------------------------------------------------------------------------
-- 1. Submission via a request link (+ auto-approve)
-- ---------------------------------------------------------------------------

create function public.submit_guest_request(
  p_slug              text,
  p_full_name         text,
  p_email             text,
  p_phone             text,
  p_plus_ones         integer,
  p_motivation        text,
  p_ip_hash           text,
  p_marketing_opt_in  boolean,
  p_birthdate         date default null,
  p_status_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link       public.request_links;
  v_venue      uuid;
  v_name       text    := nullif(btrim(p_full_name), '');
  v_email      text    := nullif(lower(btrim(p_email)), '');
  v_phone      text    := nullif(btrim(p_phone), '');
  v_phone_dig  text;
  v_motivation text    := nullif(btrim(p_motivation), '');
  v_plus       integer := least(greatest(coalesce(p_plus_ones, 0), 0), 20);
  v_marketing  boolean := coalesce(p_marketing_opt_in, false);
  v_key        text;
  v_contact_id uuid;
  v_request_id uuid;
  v_auto       boolean := false;
  v_locked     boolean;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_motivation is not null and char_length(v_motivation) > 1000 then
    v_motivation := left(v_motivation, 1000);
  end if;

  -- Rate limit FIRST (every attempt burns quota — slug probing included, #28).
  if not public.consume_public_throttle('req:' || p_ip_hash, 15, 5) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- Resolve the LINK, only while open (per-link active/expiry AND the event
  -- master switch + not cancelled). Unknown, paused, expired and deactivated
  -- are indistinguishable (#28).
  select rl.* into v_link
  from public.request_links rl
  where rl.slug = p_slug
    and public.request_link_open(rl);
  if v_link.id is null then
    return jsonb_build_object('status', 'closed');
  end if;

  -- Dedup fingerprint: e-mail, else phone digits (name-only stays NULL).
  v_phone_dig := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  v_key := coalesce(v_email, v_phone_dig);

  -- Insert. A duplicate PENDING request (same event + fingerprint, any link)
  -- trips the partial unique index; we then ROTATE the existing row's status
  -- token to the fresh one, so the caller always walks away with a working
  -- status URL and cannot tell "new" from "duplicate" (#28). The earlier URL of
  -- the same person stops working — acceptable, it is the same requester.
  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation,
       marketing_opt_in, dedupe_key, birthdate, request_link_id, status_token_hash)
    values
      (v_link.event_id, v_name, v_email, v_phone, v_plus, v_motivation,
       v_marketing, v_key, p_birthdate, v_link.id, p_status_token_hash)
    returning id into v_request_id;
  exception when unique_violation then
    if p_status_token_hash is not null then
      update public.guest_requests
      set status_token_hash = p_status_token_hash
      where event_id = v_link.event_id
        and dedupe_key = v_key
        and status = 'pending';
    end if;
    v_request_id := null; -- silent dedup: nothing more to do (no double auto-approve)
  end;

  -- #8: capture into the venue address book (unchanged from 20260625100000).
  if v_email is not null or v_phone_dig is not null then
    v_venue := public.event_venue(v_link.event_id);
    begin
      v_contact_id := null;
      if v_email is not null then
        select id into v_contact_id from public.contacts
         where venue_id = v_venue and anonymized_at is null and email_norm = v_email
         limit 1;
      end if;
      if v_contact_id is null and v_phone_dig is not null then
        select id into v_contact_id from public.contacts
         where venue_id = v_venue and anonymized_at is null and phone_norm = v_phone_dig
         limit 1;
      end if;

      if v_contact_id is not null then
        update public.contacts set
          email     = coalesce(email,     v_email),
          phone     = coalesce(phone,     v_phone),
          birthdate = coalesce(birthdate, p_birthdate)
        where id = v_contact_id;
      else
        insert into public.contacts
          (venue_id, full_name, email, phone, birthdate, source, created_by)
        values
          (v_venue, v_name, v_email, v_phone, p_birthdate, 'guest_request', null);
      end if;
    exception when unique_violation then
      null; -- concurrent capture; ignore
    end;
  end if;

  -- Auto-approve (link opt-in; CHECK guarantees a pinned tier). Every guard
  -- falls back to a PLAIN PENDING request — the submission never fails and the
  -- requester never learns why (#28: link config/fullness is not enumerable).
  if v_request_id is not null and v_link.auto_approve then
    -- Serialize concurrent auto-approvals on the same link (the max/tier
    -- triggers recompute from committed state; the row lock closes the
    -- read-committed race for this hot path).
    perform 1 from public.request_links rl where rl.id = v_link.id for update;

    select e.list_locked into v_locked
    from public.events e where e.id = v_link.event_id;

    -- A locked list takes no automatic additions (#23); and someone whose
    -- earlier request on this event was already approved is not silently
    -- approved twice (a decided request frees the dedup key, so a re-submit
    -- lands as a NEW pending row — staff can judge the repeat manually).
    if not v_locked
       and (v_key is null or not exists (
         select 1 from public.guest_requests gr
         where gr.event_id = v_link.event_id
           and gr.dedupe_key = v_key
           and gr.status = 'approved'
       )) then
      begin
        -- added_by NULL = the system decided (#4/#15); guests_added_by_check
        -- allows it exactly for this shape. Tier-max (45002), link-max (45006)
        -- and event capacity (45005) all roll back just this block.
        insert into public.guests
          (event_id, tier_id, full_name, email, phone, plus_ones,
           added_by, source, status, request_link_id)
        values
          (v_link.event_id, v_link.tier_id, v_name, v_email, v_phone, v_plus,
           null, 'landing', 'approved', v_link.id);

        update public.guest_requests
        set status = 'approved',
            decided_via = 'auto',
            decided_at = now()
        where id = v_request_id;

        v_auto := true;
      exception when sqlstate '45002' or sqlstate '45005' or sqlstate '45006' then
        null; -- full: stays pending, indistinguishable for the requester
      end;
    end if;
  end if;

  return jsonb_build_object('status', 'ok', 'auto_approved', v_auto);
end;
$$;

revoke execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Manual approval carries the attribution
-- ---------------------------------------------------------------------------
-- Body = 20260621120000 (re-approve allowed) + request_link_id copied onto the
-- guest. 45006 (link full) now also rolls back the whole approval, exactly like
-- 45002 — the request stays as it was.

create or replace function public.approve_guest_request(
  p_request_id uuid,
  p_tier_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req      public.guest_requests;
  v_venue    uuid;
  v_guest_id uuid;
begin
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;
  if v_req.status = 'approved' then
    raise exception using errcode = '45003', message = 'Deze aanvraag staat al op de lijst.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  if not exists (
    select 1 from public.guest_tiers gt
    where gt.id = p_tier_id and gt.event_id = v_req.event_id
  ) then
    raise exception using errcode = '23514', message = 'Kies een geldige tier voor dit event.';
  end if;

  -- Create the guest with the request's link attribution. added_by = the
  -- approver (#31: source='landing' never charges their quota); tier-max
  -- (45002) and link-max (45006) roll the whole approval back.
  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones,
     added_by, source, status, request_link_id)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_req.plus_ones, (select auth.uid()), 'landing', 'approved', v_req.request_link_id)
  returning id into v_guest_id;

  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decided_via = 'manual',
      decision_reason = null
  where id = p_request_id;

  return v_guest_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Landing resolution for /e/[slug] (anon-safe)
-- ---------------------------------------------------------------------------
-- Replaces the page's direct events read: the page resolves the LINK (any slug
-- in the one namespace) and gets the display subset back. Empty result covers
-- unknown/paused/expired/deactivated/cancelled identically (#28). The legacy
-- events_select_landing policy stays in place for compat; the app no longer
-- uses it.

create function public.get_landing_event(p_slug text)
returns table (
  event_name text,
  starts_at  timestamptz,
  via_label  text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.name,
    e.starts_at,
    -- Subtle provenance for the page ("via Jayden"); NULL on the default link.
    case when rl.is_default then null
         else coalesce(i.name, rl.label) end
  from public.request_links rl
  join public.events e on e.id = rl.event_id
  left join public.influencers i on i.id = rl.influencer_id
  where rl.slug = p_slug
    and public.request_link_open(rl);
$$;

revoke execute on function public.get_landing_event(text)
from public, anon, authenticated, service_role;
grant execute on function public.get_landing_event(text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Pageview recording (funnel step 1)
-- ---------------------------------------------------------------------------
-- Called server-side from the landing page render (no client beacon, no
-- cookies; works in the Capacitor webview). Generous window: a venue's door
-- WiFi NATs many phones behind one IP. Unknown/closed slugs return silently —
-- no signal, and the throttle burns first so slug probing costs budget (#28).

create function public.record_link_pageview(p_slug text, p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_id uuid;
begin
  if not public.consume_public_throttle('pv:' || p_ip_hash, 15, 60) then
    return;
  end if;

  select rl.id into v_link_id
  from public.request_links rl
  where rl.slug = p_slug
    and public.request_link_open(rl);
  if v_link_id is null then
    return;
  end if;

  insert into public.request_link_pageviews_daily as pv
    (request_link_id, day, views)
  values (v_link_id, (now() at time zone 'Europe/Amsterdam')::date, 1)
  on conflict (request_link_id, day) do update
    set views = pv.views + 1,
        updated_at = now();
end;
$$;

revoke execute on function public.record_link_pageview(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_link_pageview(text, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Guest status page /r/[token]
-- ---------------------------------------------------------------------------
-- Token-capability read: minimal payload, no contact data, no motivation, no
-- decision reason (Max 6 jul 2026: de afwijsreden blijft intern). Unknown,
-- revoked and anonymized tokens return the identical {found:false} — and so
-- does a rate-limited probe (a legit guest re-opening their own URL stays far
-- under the window).

-- VOLATILE (not stable): the throttle consumption inside writes a counter row.
create function public.get_request_status(p_token_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if p_token_hash is null
     or not public.consume_public_throttle('st:' || p_ip_hash, 15, 30) then
    return jsonb_build_object('found', false);
  end if;

  select gr.full_name, gr.status, gr.plus_ones, e.name as event_name, e.starts_at
  into v_row
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  where gr.status_token_hash = p_token_hash
    and gr.anonymized_at is null;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'status', v_row.status,
    'full_name', v_row.full_name,
    'plus_ones', v_row.plus_ones,
    'event_name', v_row.event_name,
    'starts_at', v_row.starts_at
  );
end;
$$;

revoke execute on function public.get_request_status(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_request_status(text, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Tighten the compat direct-insert policy (attribution is not forgeable)
-- ---------------------------------------------------------------------------
-- The app path is the RPC; this policy only governs raw API inserts. A directly
-- inserted request may carry a request_link_id ONLY when the caller can see
-- that link (RLS on request_links inside the subquery) and it belongs to the
-- same event and is open. anon holds a table grant on request_links but NO
-- select policy → sees zero rows → may only file un-attributed requests, as
-- before. Funnel stats stay honest.

grant select on table public.request_links to anon;
grant execute on function public.request_link_open(public.request_links)
to anon, authenticated;

alter policy guest_requests_insert_public on public.guest_requests
  with check (
    status = 'pending'
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.landing_active and e.cancelled_at is null
    )
    and (
      request_link_id is null
      or exists (
        select 1 from public.request_links rl
        where rl.id = request_link_id
          and rl.event_id = guest_requests.event_id
          and public.request_link_open(rl)
      )
    )
  );
