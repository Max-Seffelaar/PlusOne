-- z8uq9m0gvy — close the `auto_approved` enumeration oracle in
-- submit_guest_request.
--
-- Found in the fresh-session review of PR #276 (pre-existing there, recorded as
-- a follow-up). `submit_guest_request` is SECURITY DEFINER and granted to
-- `anon`, so it is reachable straight off the public key + a link slug. On a
-- link with `auto_approve = true` and an unlocked list it returned
-- `auto_approved = false` EXACTLY when the submitted e-mail already had an
-- approved request on that event:
--
--   1 victim signs up (fresh)        -> status=ok  auto_approved=true
--   2 attacker retries that e-mail   -> status=ok  auto_approved=false
--   3 attacker tries unknown address -> status=ok  auto_approved=true
--
-- That is a yes/no answer to "is this named person on the list for this
-- event?", which CLAUDE.md's security checklist forbids outright ("public
-- endpoints ... never reveal whether a guest/e-mail exists") and which is
-- AVG-relevant: it confirms a named individual's attendance at a party.
-- `p_ip_hash` is a function ARGUMENT, so a direct PostgREST caller chooses its
-- own throttle bucket and has no effective rate limit on probing.
--
-- The function already committed to indistinguishability for the neighbouring
-- cases — the fullness branch is commented "full: stays pending,
-- indistinguishable for the requester" and the block header says "#28: link
-- config/fullness is not enumerable". The already-approved branch was the one
-- place that commitment was not kept, so this is the function being made
-- consistent with its own contract, not a new rule.
--
-- THE FIX: `auto_approved` now reports the requester's STANDING ("you hold an
-- approved spot for this event") rather than "this call inserted a row". Those
-- coincide for a first-time submitter and came apart for a repeat one.
--
-- Two details that make it a fix rather than a reshuffle:
--   * the new arm is reached from BOTH repeat shapes — a fresh pending row and
--     the silent-dedup path (v_request_id null). Covering only the first moves
--     the oracle one probe later: probe an e-mail twice and the second call
--     dedups and answers `false` again.
--   * everything now hangs off the single `not v_locked` gate, so a locked list
--     still answers `false` to every e-mail alike (#23/#28) — the fix does not
--     make lock state identity-dependent.
--
-- NOT changed: no approval behaviour moves. No guest row is created that was
-- not created before, no request is decided that was not decided before, and
-- the deliberate "a re-submit lands as a NEW pending row so staff can judge the
-- repeat manually" behaviour is untouched. The change is to the reported bit
-- only.
--
-- KNOWN RESIDUALS (documented, not silently claimed away — see
-- docs/security-audit.md 4A):
--   * an e-mail with an UNDECIDED pending request on the event still answers
--     `false` where a stranger gets `true`, because its submission genuinely
--     stays pending. Closing that means auto-deciding a request that arrived
--     through another (possibly manual-review) link — a workflow change, not a
--     reporting one, so it is left for an explicit decision.
--   * on a link that is AT CAPACITY, an already-approved e-mail answers `true`
--     where a stranger gets `false`. Capacity is enforced by AFTER-INSERT
--     triggers while `guests_event_contact_uidx` rejects the duplicate at index
--     time, so the full/approved combination cannot be made to answer alike
--     without duplicating the three capacity rules inside this function.
--
-- Body = 20260819110000_landing_contact_required.sql with the auto-approve
-- block restructured and `v_already` added. Everything else — validation, the
-- throttle-first ordering, link resolution, silent dedup + status-token
-- rotation, contact capture — is byte-for-byte unchanged.
-- supabase/canonical/submit_guest_request.sql is updated in the same PR
-- (K10 drift guard, tests/unit/canonical-functions.test.ts).

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
  v_already    boolean;
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
  --
  -- z8uq9m0gvy: `auto_approved` reports the REQUESTER'S STANDING — "you hold an
  -- approved spot for this event" — not whether THIS particular call did the
  -- inserting. Those two read the same for a first-time submitter and came
  -- apart for a repeat one, which is what made this endpoint an oracle; see the
  -- long comment on the `elsif` below.
  if v_link.auto_approve then
    -- Serialize concurrent auto-approvals on the same link (the max/tier
    -- triggers recompute from committed state; the row lock closes the
    -- read-committed race for this hot path).
    perform 1 from public.request_links rl where rl.id = v_link.id for update;

    select e.list_locked into v_locked
    from public.events e where e.id = v_link.event_id;

    -- A locked list takes no automatic additions (#23). The insert AND the
    -- answer both hang off this single check, so a locked list replies `false`
    -- to every e-mail alike — lock state stays a property of the event, never
    -- of who is asking (#28).
    if not v_locked then
      -- Does this person already hold an approved request on this event? A
      -- decided request frees the dedup key, so a re-submit lands as a NEW
      -- pending row; that row is deliberate (staff judge the repeat manually)
      -- and this flag only stops us approving the same person a second time.
      v_already := v_key is not null and exists (
        select 1 from public.guest_requests gr
        where gr.event_id = v_link.event_id
          and gr.dedupe_key = v_key
          and gr.status = 'approved'
      );

      if v_request_id is not null and not v_already then
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

      elsif v_already then
        -- The one place this function used to break its own #28 promise. On an
        -- auto-approve link with an unlocked list the answer was `false`
        -- EXACTLY when the submitted e-mail already had an approved request —
        -- so an anonymous caller could ask "is this named person on the list
        -- for this event?" and read a reliable yes/no off the response, which
        -- is precisely what the CLAUDE.md rule "public endpoints never reveal
        -- whether a guest/e-mail exists" forbids. `p_ip_hash` is an argument,
        -- so a direct PostgREST caller picks its own throttle bucket and probes
        -- as often as it likes.
        --
        -- `true` is honest — they ARE on the list, and the landing page's "say
        -- your name at the door" is the correct thing to tell them — and it is
        -- the same answer a stranger gets under the same link + lock state, so
        -- there is nothing left to compare.
        --
        -- Note this arm is reached from BOTH shapes of repeat submission: with
        -- a fresh pending row (v_request_id set), and via the silent-dedup path
        -- above (v_request_id null, a pending row was already there). Covering
        -- only the first would move the oracle one probe later rather than
        -- close it — a deduped second probe would answer `false` again.
        --
        -- What this does NOT change: the new pending row still lands and still
        -- waits for staff. The requester is told about their spot, not about
        -- the bookkeeping.
        v_auto := true;
      end if;
    end if;
  end if;

  return jsonb_build_object('status', 'ok', 'auto_approved', v_auto);
end;
$$;

-- `create or replace` preserves privileges, but the grant is restated so this
-- migration is self-contained and readable next to 20260819110000.
revoke execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date, text)
to anon, authenticated, service_role;
