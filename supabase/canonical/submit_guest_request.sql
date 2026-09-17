-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20260819110000_landing_contact_required.sql:32.

create or replace function public.submit_guest_request(
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
  -- One emptiness rule for every free-text field (86eyke279). The single-arg
  -- btrim() this function used before strips ASCII SPACE only, so a phone of
  -- E'\t' survived it as a "value" — exactly the kind of input a hand-rolled
  -- client sends and a browser never does. Naming the whitespace set makes
  -- '', '   ' and E'\t\n' provably identical here, independent of collation
  -- (unlike [[:space:]], whose membership is ctype-dependent).
  ws           constant text := E' \t\n\r\f\x0B';
  v_link       public.request_links;
  v_venue      uuid;
  v_name       text    := nullif(btrim(p_full_name, ws), '');
  v_email      text    := nullif(lower(btrim(p_email, ws)), '');
  v_phone      text    := nullif(btrim(p_phone, ws), '');
  v_phone_dig  text;
  v_motivation text    := nullif(btrim(p_motivation, ws), '');
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

  -- 86eyke279 — both contact fields must be PRESENT. NULL, '' and
  -- whitespace-only are one and the same case: nothing the venue can reach.
  if v_email is null or v_phone is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- ...and USABLE. A required field that accepts 'x' is theatre: the point of
  -- the rule is a working channel, not a filled box. These checks are
  -- deliberately LOOSER than the app's Zod schema (EMAIL_RE / E.164) —
  -- everything the client accepts passes here, so a stricter client can never
  -- be silently overruled by the database, while a raw anon caller still can't
  -- store junk. The phone shape is the app's own E.164 rule: it is what the
  -- form already emits, and a number without a country code is unreachable
  -- from a Dutch door phone anyway. v_email also gets an explicit length cap
  -- (matching Zod's `.max(254)`) — unlike phone, the shape regex alone puts no
  -- upper bound on it, and this is an anon write path: a multi-KB "e-mail"
  -- would otherwise sit in the table (up to ~2.7KB, the dedupe index's row-size
  -- ceiling) or blow past that ceiling and 500 the whole request (86eyke279).
  if char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
     or v_phone !~ '^\+[1-9][0-9]{1,14}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Both guards sit BEFORE the throttle, exactly where the pre-existing name
  -- check sits, and that placement is load-bearing for #28: they are decided
  -- purely from the caller's own arguments, before any slug, link or row of
  -- ours is read. An 'invalid' answer therefore echoes back only what the
  -- caller already sent and discloses nothing about which events, links or
  -- guests exist — so it is safe to answer it without spending throttle
  -- budget. Moving them below the throttle would buy nothing (an attacker
  -- probing for slugs sends well-formed contact details anyway) and would make
  -- a malformed retry cost a legitimate visitor their quota.

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
