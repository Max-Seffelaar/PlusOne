-- z8uq9m0h2v — the two blockers from the fresh-session security review of
-- PR #300, fixed in the PR rather than recorded as residuals.
--
-- The review rebuilt the stack from scratch (stock PG 16.13 + a platform shim,
-- all 104 migrations clean, pgTAP through this repo's own plan/run gate),
-- reproduced 59 files / 1202 assertions and 144 / 1493 exactly, got 14
-- assertions to go red on reverting the function body, and could not break the
-- mirror on any of the six attack questions it was handed. The design in
-- 20260918140000 stands. What it found was an input that function never bounds,
-- and a retention edge its own cleanup step could not reach.
--
-- ---------------------------------------------------------------------------
-- F-1 (BLOCKING, introduced by 20260918140000) — the error-message channel
-- ---------------------------------------------------------------------------
-- `p_status_token_hash` is anon-controlled, unbounded `text`, and lands in a
-- unique btree index on BOTH paths. Past the ~2704-byte index-row ceiling
-- postgres raises 54000 — and since the mirror exists, the two paths name
-- DIFFERENT indexes in the message:
--
--   len=2700 DEDUP -> 54000 index row size 2816 … "guest_request_status_mirrors_token_idx"
--   len=2700 FRESH -> 54000 index row size 2816 … "guest_requests_status_token_idx"
--
-- Pre-20260918140000 both paths hit the same index and the error was identical,
-- so this is a regression, not an inheritance. SQLSTATE is 54000 on both sides;
-- the differentiator is the message text, which PostgREST forwards verbatim in
-- its 500 body. One unauthenticated call, one bit: "does this e-mail already
-- have a pending request on this event?" — the exact oracle class the mirror
-- design was chosen to avoid.
--
-- Reproduced on the local stack before fixing, with the index names above.
-- Note the reproduction only works with INCOMPRESSIBLE input: repeat('A', 5000)
-- never reaches the ceiling because pglz compresses it inside the index tuple.
-- A length-based test that used a repeated character would pass vacuously.
--
-- FIX: cap the argument, with the other argument-only guards above the
-- throttle, exactly as 86eyke279 already caps `v_email` for this same
-- index-row-size reason in this same function. Neither path can now reach the
-- ceiling, so neither can raise, so there is nothing left to compare.
--
-- ---------------------------------------------------------------------------
-- F-2 (BLOCKING, introduced by 20260918140000) — mirrors no sweep would reach
-- ---------------------------------------------------------------------------
-- `run_privacy_retention` step 2b deleted only `m.request_id = any(v_request_ids)`
-- — the requests THAT run had just anonymized. But step 2 clears neither
-- `status` nor `dedupe_key`, so an anonymized request stays `pending` with its
-- fingerprint intact and keeps tripping `guest_requests_dedupe_idx`. A later
-- submission on the same e-mail therefore lands on the dedup branch and writes
-- a fresh mirror — carrying THAT caller's real name and plus-ones — against a
-- request that will never be anonymized again, so step 2b never sees it.
--
-- Reproduced on the local stack before fixing:
--
--   retention run #1                  | requests_anonymized = 1
--   request after anonymize           | pending | anon=t | dedupe_key=f2v@x.test
--   late probe on the same e-mail     | {"status":"ok","auto_approved":false}
--   mirror rows                       | tok-f2-late | "Late Caller Name" | 3
--   retention run #2                  | 0 0 0 0
--   mirror rows after run #2          | 1 | Late Caller Name
--
-- Preconditions are ordinary, not exotic: an event past the venue's
-- `retention_months` (12) whose landing link was never switched off —
-- `request_link_open()` has no date check at all, so such a link stays open by
-- default. Not a disclosure (`get_request_status` refuses an anonymized
-- request, confirmed live: {"found": false}) — a pure AVG retention gap in a
-- PII store that is one migration old.
--
-- FIX, both halves, because neither alone is enough:
--   * the sweep now drives off `anonymized_at` instead of the run's id list, so
--     it is self-healing and cleans orphans already written;
--   * the dedup branch refuses to mirror onto an anonymized request at all, so
--     it stops producing them.
--
-- WHAT THE SECOND HALF DOES NOT CHANGE (checked, not assumed): a mirror on an
-- anonymized request was already unreadable — `get_request_status` filters
-- `gr.anonymized_at is null` — so that token answered {"found": false} before
-- this migration and answers {"found": false} after it. Verified live on both
-- bodies. The caller-visible behaviour is identical; only the garbage stops.
--
-- ---------------------------------------------------------------------------
-- F-3 (NIT) — 20260918140000's header over-claimed, and is corrected in place
-- ---------------------------------------------------------------------------
-- That header said, twice and unqualified, that deduped and fresh submissions
-- are byte-identical "on every read before a staff decision". True on
-- manual-review links; FALSE on an auto-approve link below capacity, where a
-- deduped probe answers `auto_approved:false` / `pending` and a fresh one
-- answers `true` / `approved`. The split is inherited from 20260918100000 —
-- the review confirmed it pre-fix — and `docs/security-audit.md` §4A already
-- described it correctly, so the two documents disagreed. The migration is not
-- applied anywhere (this PR is unmerged), so the claim is scoped in place
-- there; the assertions that pin it are added in landing.test.sql here.
--
-- ---------------------------------------------------------------------------
-- F-4 (INFORMATIONAL, pre-existing) — left open, deliberately, and written down
-- ---------------------------------------------------------------------------
-- Past the retention window, on an event whose link is still open, the dedup
-- path IS oracle (a): a taken (anonymized) address answers {"found": false}
-- where a fresh one answers {"found": true}. The review confirmed the identical
-- split pre-fix, so it is not introduced by either migration, and this one does
-- not widen it. The structural answer is to make `request_link_open()` close a
-- link once its event is past the venue's retention window — which would close
-- F-2's precondition and F-4 together, and is a behaviour change to the public
-- landing surface that deserves its own task rather than a rider on a security
-- fix. Recorded in docs/security-audit.md §4A.
--
-- EXPAND–CONTRACT: two function bodies replaced behind unchanged signatures.
-- No schema change, no column or table touched. The deployed app calls both
-- RPCs with unchanged arguments and reads unchanged result keys.

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

  -- z8uq9m0h2v F-1 — the status-token hash is anon-controlled, UNBOUNDED text
  -- and lands in a unique BTREE index on both paths. Past that index's
  -- ~2704-byte row ceiling postgres raises 54000, and since 20260918140000 the
  -- two paths write to DIFFERENT indexes, so the error MESSAGE names which
  -- branch ran ("guest_request_status_mirrors_token_idx" vs
  -- "guest_requests_status_token_idx"). SQLSTATE is 54000 either way, but
  -- PostgREST forwards postgres' message/detail verbatim in its 500 body — so
  -- that difference is a one-call "does this e-mail already have a pending
  -- request?" oracle, in exactly the class 20260918140000 set out not to
  -- create. Found by the fresh-session security review of PR #300.
  --
  -- Capping the argument closes it at the source: neither path can reach the
  -- ceiling, so neither can raise. This is the same rule 86eyke279 already
  -- applies to v_email a few lines up, for the same index-row-size reason. The
  -- app sends a 64-char sha256 hex; 128 leaves headroom for a format change.
  --
  -- The cap is on char_length, deliberately: a byte-size test would be fooled
  -- the way a naive REPRODUCTION is — repeat('A', 5000) never reaches the
  -- ceiling because pglz compresses it inside the index tuple, so only
  -- incompressible input (random base64) triggers the raise.
  if p_status_token_hash is not null and char_length(p_status_token_hash) > 128 then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- The guards above all sit BEFORE the throttle, exactly where the pre-existing
  -- name check sits, and that placement is load-bearing for #28: they are decided
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
        and gr.status = 'pending'
        -- z8uq9m0h2v F-2: retention anonymizes a request but leaves it
        -- `pending` with its dedupe_key intact, so it keeps occupying the
        -- partial unique index and later submissions keep landing here. A
        -- mirror on such a row is unreadable by construction
        -- (get_request_status refuses an anonymized request), so writing one
        -- only parks a fresh caller's real name in a table no retention run
        -- would ever reach again. Skipping the write changes nothing the
        -- caller can observe: with or without it that token answers
        -- {"found": false}. Verified on the live stack both ways.
        and gr.anonymized_at is null;
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

  -- 2b. z8uq9m0h2v — drop the status-token mirrors of every ANONYMIZED request,
  --     not just the ones step 2 touched on this run. A mirror holds a name and
  --     plus-ones supplied by the caller of a deduped submission; step 2 nulls
  --     the request's own `status_token_hash`, and this is the matching
  --     revocation for the mirrored one.
  --
  --     Scoping this to `any(v_request_ids)` — what 20260918140000 shipped —
  --     left a hole the fresh-session security review of PR #300 reproduced:
  --     step 2 clears neither `status` nor `dedupe_key`, so an anonymized
  --     request stays `pending` with its fingerprint and keeps catching later
  --     submissions on the dedup branch. Those wrote a mirror carrying the new
  --     caller's real name against a request already anonymized — which this
  --     step, looking only at ids from its own run, never saw again. Retention
  --     run #2 reported `0 0 0 0` and the name survived indefinitely.
  --
  --     Driving the delete off `anonymized_at` instead of the run's id list
  --     makes the sweep self-healing: it cleans orphans written before this
  --     migration as well as any a future path manages to create.
  delete from public.guest_request_status_mirrors m
  using public.guest_requests gr
  where gr.id = m.request_id
    and gr.anonymized_at is not null;

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
