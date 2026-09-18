-- z8uq9m0h2v — stop the silent-dedup path from handing a caller-chosen status
-- token to somebody else's pending request.
--
-- THE BUG (HIGH, anon-reachable, live on prod, pre-existing — found by the
-- fresh-session review of PR #296 but not caused by it; recorded as an open
-- residual in docs/security-audit.md 4A).
--
-- `submit_guest_request` is SECURITY DEFINER and granted to `anon`, so it is
-- reachable with nothing but the public anon key and a link slug. On the
-- silent-dedup path — a submission that matches an existing PENDING request on
-- the same event — it rotated that row's `status_token_hash` to the value the
-- CALLER passed in `p_status_token_hash`. The caller chooses that value.
--
-- Reproduced end-to-end against the local stack over plain PostgREST, anon key
-- only:
--
--   1 victim submits (manual-review link, token V)
--       -> {"status":"ok","auto_approved":false}
--   2 get_request_status(V)
--       -> {"found":true,"status":"pending","full_name":"Victim Vandermeer",
--           "plus_ones":2,"event_name":"PLUSONE Launch Night", ...}
--   3 attacker submits the VICTIM'S E-MAIL with attacker-chosen token A
--       -> {"status":"ok","auto_approved":false}       (silent dedup)
--   4 get_request_status(A)
--       -> {"found":true,"status":"pending","full_name":"Victim Vandermeer",
--           "plus_ones":2,"event_name":"PLUSONE Launch Night", ...}
--   5 get_request_status(V)
--       -> {"found":false}
--
-- One unauthenticated call: an existence oracle, disclosure of a named
-- individual's attendance + plus-ones (AVG-relevant), and a denial of service
-- on the victim's own status URL. `p_ip_hash` is an ARGUMENT, so a direct
-- PostgREST caller picks its own throttle bucket and has no effective limit on
-- probing addresses.
--
-- ---------------------------------------------------------------------------
-- WHY NOT THE TWO OBVIOUS FIXES
-- ---------------------------------------------------------------------------
-- (a) "Ignore p_status_token_hash on the dedup branch." Closes the disclosure
--     and the DoS — and opens a clean one-call enumeration oracle in their
--     place, which is exactly the trade 20260918100000 made in the
--     neighbouring block and had to be written up as a swap. After (a):
--
--       fresh e-mail  -> my chosen token resolves      {"found":true,...}
--       taken e-mail  -> my chosen token resolves not  {"found":false}
--
--     One call each way, no staff involvement, no timing analysis. That is a
--     strictly better oracle than the one 4A already documents for
--     auto-approve links, and it would be NEW on manual-review links, where
--     `auto_approved` is constant `false` and no e-mail oracle exists today.
--     It is not blunted by an oracle elsewhere either: `anon` holds no INSERT
--     on `guest_requests` since 20260707170000 (verified in the catalog while
--     writing this), so the partial dedupe index is not reachable as a
--     409-vs-201 probe by an anonymous caller.
--
-- (b) "Accept it only when status_token_hash is null." Same oracle as (a) in
--     the normal case (the app always sends a hash, so the stored one is never
--     null), AND it still hands the caller a live URL onto somebody else's row
--     in the case it does allow — a request row whose token is null is still
--     a real person's name, plus-ones and event. It narrows the hole; it does
--     not close it.
--
-- ---------------------------------------------------------------------------
-- THE FIX: the caller's token addresses the caller's OWN submission, always
-- ---------------------------------------------------------------------------
-- The rotation becomes an ADDITIVE, identity-scoped binding. On dedup the
-- existing row is not touched at all; instead the caller's token hash is
-- recorded in a new side table together with the name and plus-ones THAT
-- CALLER submitted, pointing at the deduped-against request:
--
--   public.guest_request_status_mirrors (request_id pk, token_hash uq,
--                                        full_name, plus_ones, created_at)
--
-- `get_request_status` resolves a token against `guest_requests` first (the
-- submitter's own row, unchanged) and falls back to the mirror. A mirror
-- answers with the MIRROR'S name and plus-ones and the request's live status.
-- So:
--
--   * the victim's own status URL keeps working          (DoS closed)
--   * the attacker reads back the name and plus-ones THEY submitted, never the
--     victim's                                            (disclosure closed)
--   * a fresh submission and a deduped one return a byte-identical payload at
--     submit time and on every read before a staff decision — same keys, same
--     status `pending`, same event, the caller's own identity in both
--                                                          (no oracle swap)
--
-- Why the mirror stores the caller's name instead of reading it off the row:
-- that IS the whole fix. Anything computed from the existing row leaks the
-- existing row. The premise of the silent dedup is "same e-mail = same
-- person"; an e-mail address is not proof of identity, so the deduped caller
-- is granted what that premise can justify (the request's STATUS, which is
-- what they came for) and refused what it cannot (somebody else's identity).
--
-- Bounded by construction: `request_id` is the primary key, so one mirror per
-- pending request, last writer wins. An anonymous prober cannot grow the table
-- past one row per pending request, and it holds nothing it was not handed by
-- the same caller in the same call.
--
-- Not reachable except through these two SECURITY DEFINER functions: RLS on,
-- zero policies, zero grants to `anon` and `authenticated` (grant matrix
-- below), so neither role can read a mirror even though `authenticated` can
-- read the request it points at.
--
-- ---------------------------------------------------------------------------
-- KNOWN RESIDUAL (not claimed away — mirrored in docs/security-audit.md 4A)
-- ---------------------------------------------------------------------------
-- A mirror reports the DEDUPED-AGAINST request's live status. Before a staff
-- decision that is `pending` for fresh and mirrored tokens alike, so the probe
-- itself learns nothing. AFTER a decision the two can come apart: a mirror
-- shows the verdict staff gave the VICTIM's request, while a fresh submission
-- shows the verdict they gave the attacker's own. An attacker who submits
-- obvious junk, waits for the event, and polls can read an `approved` as
-- evidence that the address belongs to someone who was let in.
--
-- That residual is deliberate, and the alternative was weighed: freezing a
-- mirror at `pending` forever removes it and installs the mirror image of it
-- ("still pending long after the event" ⇒ mirror ⇒ the address is taken),
-- while also breaking the legitimate re-submitter, whose second URL would
-- never show their approval. What is left is delayed, requires a staff
-- decision the attacker cannot trigger, is probabilistic, and yields no name,
-- no plus-ones and no denial of service — where the bug it replaces was
-- instant, certain, and gave all three.
--
-- One more, stated rather than hidden: `get_request_status` still checks
-- `guest_requests.status_token_hash` before the mirror, so a token that is
-- both a mirror and some row's real token resolves to the row. Reaching that
-- requires supplying a hash equal to the sha256 of another requester's
-- 256-bit token, i.e. already holding the secret. The mirror write refuses
-- such a hash anyway (the `not exists` guard below), so it cannot be set up
-- from the anon side.
--
-- EXPAND–CONTRACT: additive only. New table, two function bodies replaced
-- behind their existing signatures, no column dropped or renamed. The
-- currently deployed app calls `submit_guest_request` and
-- `get_request_status` with unchanged argument lists and reads unchanged
-- result keys, so it keeps working across the deploy in both directions.

-- ---------------------------------------------------------------------------
-- 1. The mirror table
-- ---------------------------------------------------------------------------

create table if not exists public.guest_request_status_mirrors (
  request_id uuid        primary key references public.guest_requests(id) on delete restrict,
  token_hash text        not null,
  full_name  text        not null,
  plus_ones  integer     not null default 0,
  created_at timestamptz not null default now(),
  constraint guest_request_status_mirrors_plus_ones_check check (plus_ones >= 0)
);

comment on table public.guest_request_status_mirrors is
  'z8uq9m0h2v — status token of a SILENTLY DEDUPED landing submission, bound to '
  'the name/plus-ones that caller supplied. Never the deduped-against row''s own '
  'identity: that is the vulnerability this table exists to close. Written and '
  'read only by submit_guest_request / get_request_status (SECURITY DEFINER).';

create unique index if not exists guest_request_status_mirrors_token_idx
  on public.guest_request_status_mirrors (token_hash);

alter table public.guest_request_status_mirrors enable row level security;

-- No policies on purpose: every legitimate reader and writer is a SECURITY
-- DEFINER function owned by postgres, which bypasses RLS. An empty policy set
-- with RLS on means any direct API access reads zero rows even if a grant is
-- ever added by accident.

-- Grant matrix (CLAUDE.md: revoke first, then grant; never `on all tables`).
-- Since 20260917100000 a new object starts closed, so this revoke is
-- belt-and-braces and the absence of a matching grant is the actual rule:
--   anon          — nothing (it reaches this table only via the two RPCs)
--   authenticated — nothing (staff read the REQUEST, never the mirror)
--   service_role  — defaults, as everywhere else
revoke all on table public.guest_request_status_mirrors from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. submit_guest_request — dedup writes a mirror instead of rotating
-- ---------------------------------------------------------------------------
-- Unchanged from 20260918100000 except the `exception when unique_violation`
-- block (and the two `declare`s it needs). Everything the caller can observe
-- from the RETURN value is identical, including the z8uq9m0gvy standing
-- semantics of `auto_approved` and the `v_request_id := null` that keeps the
-- dedup path out of the auto-approve insert.

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
  v_dup_id     uuid;
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
  -- trips the partial unique index; the caller still walks away with a working
  -- status URL and cannot tell "new" from "duplicate" (#28) — see the dedup
  -- branch for how that is done without touching the existing row.
  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation,
       marketing_opt_in, dedupe_key, birthdate, request_link_id, status_token_hash)
    values
      (v_link.event_id, v_name, v_email, v_phone, v_plus, v_motivation,
       v_marketing, v_key, p_birthdate, v_link.id, p_status_token_hash)
    returning id into v_request_id;
  exception when unique_violation then
    -- z8uq9m0h2v. This used to be:
    --
    --     update public.guest_requests
    --     set status_token_hash = p_status_token_hash
    --     where event_id = ... and dedupe_key = ... and status = 'pending';
    --
    -- i.e. it pointed a CALLER-CHOSEN token at a row belonging to whoever owns
    -- that e-mail address, and orphaned that person's own status URL in the
    -- same statement. See the header for the full reproduction.
    --
    -- Now: the existing row is never written to. The caller's token is bound
    -- to the name and plus-ones THEY just submitted, so their status URL
    -- resolves — with their own identity on it, exactly as a fresh submission
    -- would answer — while the existing requester keeps theirs.
    --
    -- Resolve the duplicate EXPLICITLY rather than re-using the old blind
    -- UPDATE's predicate: this exception also fires for a collision on
    -- guest_requests_status_token_idx, where there is no pending duplicate at
    -- all and the old statement quietly matched zero rows. Being explicit
    -- keeps that case from writing a mirror onto an unrelated request.
    v_dup_id := null;
    if v_key is not null then
      select gr.id into v_dup_id
      from public.guest_requests gr
      where gr.event_id = v_link.event_id
        and gr.dedupe_key = v_key
        and gr.status = 'pending';
    end if;

    if v_dup_id is not null
       and p_status_token_hash is not null
       -- Never let a mirror shadow, or be shadowed by, a real status token.
       -- Only reachable by a caller who already holds another requester's
       -- token; refusing it here means it cannot be set up from the anon side
       -- at all.
       and not exists (
         select 1 from public.guest_requests gr2
         where gr2.status_token_hash = p_status_token_hash
       )
    then
      begin
        insert into public.guest_request_status_mirrors
          (request_id, token_hash, full_name, plus_ones)
        values
          (v_dup_id, p_status_token_hash, v_name, v_plus)
        on conflict (request_id) do update
          set token_hash = excluded.token_hash,
              full_name  = excluded.full_name,
              plus_ones  = excluded.plus_ones,
              created_at = now();
      exception when unique_violation then
        -- token_hash already taken by another mirror. Nothing to report: the
        -- caller's URL simply will not resolve, which needs a 256-bit
        -- collision or a token the caller already had.
        null;
      end;
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
        -- your name at the door" is the correct thing to tell them — and BELOW
        -- CAPACITY it is the same answer a stranger gets under the same link +
        -- lock state, so there is nothing left to compare.
        --
        -- AT CAPACITY it is NOT the same answer: the stranger's insert above is
        -- rejected by the capacity triggers and leaves `v_auto` false, while
        -- this arm skips the insert and reports `true`. That regime is a live
        -- oracle introduced here; it is recorded as such in the header and in
        -- docs/security-audit.md §4A rather than glossed as pre-existing.
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

-- ---------------------------------------------------------------------------
-- 3. get_request_status — resolve the token, then the mirror
-- ---------------------------------------------------------------------------
-- Same signature, same grants, same keys in the payload. The only change is
-- the second lookup and where `full_name`/`plus_ones` come from on it.

create or replace function public.get_request_status(p_token_hash text, p_ip_hash text)
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

  -- 1. The submitter's own row (the fresh-submission path, unchanged).
  select gr.full_name, gr.status, gr.plus_ones, e.name as event_name, e.starts_at
  into v_row
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  where gr.status_token_hash = p_token_hash
    and gr.anonymized_at is null;

  -- 2. z8uq9m0h2v — a mirror: the token of a submission that was silently
  --    deduped against the row it points at. It answers with the name and
  --    plus-ones THAT caller submitted, never the row's own: the caller proved
  --    they know an e-mail address, which is not proof they are the person
  --    behind it. The request's live `status` is what the dedup premise does
  --    justify handing over, and is the only field taken from the row.
  if not found then
    select m.full_name, gr.status, m.plus_ones, e.name as event_name, e.starts_at
    into v_row
    from public.guest_request_status_mirrors m
    join public.guest_requests gr on gr.id = m.request_id
    join public.events e on e.id = gr.event_id
    where m.token_hash = p_token_hash
      and gr.anonymized_at is null;
  end if;

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

-- ---------------------------------------------------------------------------
-- 4. run_privacy_retention — a mirror is PII and expires with its request
-- ---------------------------------------------------------------------------
-- Unchanged from 20260706101000 except step 2b. `get_request_status` already
-- refuses an anonymized request, so the mirror is unreachable the moment the
-- request is anonymized; deleting it is about not KEEPING a name past the
-- venue's retention window (#29), not about access.

create or replace function public.run_privacy_retention()
returns table (
  guests_anonymized   integer,
  requests_anonymized integer,
  refusals_redacted   integer,
  audit_rows_redacted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest_ids   uuid[];
  v_request_ids uuid[];
  v_contact_ids uuid[];
  v_guests   integer := 0;
  v_requests integer := 0;
  v_refusals integer := 0;
  v_audit    integer := 0;
begin
  -- 1. Anonymize eligible guests (event-anchored). Stats stay invariant.
  with old_events as (
    select e.id as event_id
    from public.events e
    join public.venues v on v.id = e.venue_id
    where coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
  ),
  ranked as (
    select g.id, g.anonymized_at,
           row_number() over (partition by g.event_id order by g.created_at, g.id) as volgnr
    from public.guests g
    join old_events oe on oe.event_id = g.event_id
  ),
  upd as (
    update public.guests g
    set full_name = 'Gast #' || rk.volgnr,
        email = null,
        phone = null,
        note = null,
        anonymized_at = now()
    from ranked rk
    where g.id = rk.id
      and rk.anonymized_at is null
    returning g.id
  )
  select coalesce(array_agg(id), '{}') into v_guest_ids from upd;
  v_guests := coalesce(array_length(v_guest_ids, 1), 0);

  -- 2. Anonymize eligible landing requests + REVOKE their status tokens (F1).
  with old_events as (
    select e.id as event_id
    from public.events e
    join public.venues v on v.id = e.venue_id
    where coalesce(e.ends_at, e.starts_at) < now() - make_interval(months => v.retention_months)
  ),
  ranked as (
    select gr.id, gr.anonymized_at,
           row_number() over (partition by gr.event_id order by gr.created_at, gr.id) as volgnr
    from public.guest_requests gr
    join old_events oe on oe.event_id = gr.event_id
  ),
  upd as (
    update public.guest_requests gr
    set full_name = 'Aanvraag #' || rk.volgnr,
        email = null,
        phone = null,
        motivation = null,
        decision_reason = null,
        status_token_hash = null,
        anonymized_at = now()
    from ranked rk
    where gr.id = rk.id
      and rk.anonymized_at is null
    returning gr.id
  )
  select coalesce(array_agg(id), '{}') into v_request_ids from upd;
  v_requests := coalesce(array_length(v_request_ids, 1), 0);

  -- 2b. z8uq9m0h2v — drop the status-token mirrors of the requests that step 2
  --     just anonymized. A mirror holds a name and plus-ones supplied by the
  --     caller of a deduped submission; step 2 nulls the request's own
  --     `status_token_hash`, and this is the matching revocation for the
  --     mirrored one, so no landing-page identity outlives the venue's
  --     retention window on either side of the pair.
  delete from public.guest_request_status_mirrors m
  where m.request_id = any(v_request_ids);

  -- 3. Redact refusal reasons of the just-anonymized guests.
  update public.refusals
  set reason = '[verwijderd na bewaartermijn]',
      anonymized_at = now()
  where guest_id = any(v_guest_ids)
    and anonymized_at is null;
  get diagnostics v_refusals = row_count;

  -- 4. Scrub the guests/refusals audit diffs + append per-guest 'anonymize'.
  v_audit := public.redact_anonymized_audit_pii(v_guest_ids);

  -- 5. Record the request anonymizations (guest_requests aren't otherwise audited).
  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  select
    null, e.venue_id, gr.event_id, 'guest_requests', gr.id, 'anonymize',
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'anonymized_at', to_jsonb(gr.anonymized_at),
        'redacted_fields', '["full_name","email","phone","motivation","decision_reason","status_token_hash"]'::jsonb)),
    null
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  where gr.id = any(v_request_ids);

  -- 6. Anonymize eligible address-book contacts (VENUE-anchored). A contact is
  --    eligible when it is inactive past the venue window AND no longer linked to
  --    any guest on a still-retained event. volgnr ranks over the FULL venue
  --    contact set so 'Contact #n' is stable and collision-free across runs.
  with ranked as (
    select c.id, c.venue_id, c.anonymized_at, c.updated_at,
           row_number() over (partition by c.venue_id order by c.created_at, c.id) as volgnr
    from public.contacts c
  ),
  eligible as (
    select r.id, r.volgnr
    from ranked r
    join public.venues v on v.id = r.venue_id
    where r.anonymized_at is null
      and r.updated_at < now() - make_interval(months => v.retention_months)
      and not exists (
        select 1
        from public.guests g
        join public.events e on e.id = g.event_id
        where g.contact_id = r.id
          and coalesce(e.ends_at, e.starts_at) >= now() - make_interval(months => v.retention_months)
      )
  ),
  upd as (
    update public.contacts c
    set full_name = 'Contact #' || el.volgnr,
        email = null,
        phone = null,
        birthdate = null,
        note = null,
        anonymized_at = now()
    from eligible el
    where c.id = el.id
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_contact_ids from upd;

  -- 7. Scrub the contacts audit diffs + append per-contact 'anonymize'. Counted
  --    into the audit total so the summary reflects all redacted rows.
  v_audit := v_audit + public.redact_anonymized_contact_audit_pii(v_contact_ids);

  return query select v_guests, v_requests, v_refusals, v_audit;
end;
$$;
