-- Requests E (z8uq9m2vga): decide a landing request in one atomic step —
-- trim it, split it over tiers, decline (part of) it with a mandatory note.
-- Design: onboarding-orchestration §9.3 (spike 3); decisions Max 2026-10-06
-- (an approver picks from every tier of the event) and the task comment
-- "bij afwijzen of deels afwijzen is de opmerking verplicht, en die gaat altijd
-- mee in de mail".
--
-- WHAT THIS ADDS
--
--   1. guests.guest_request_id — which request a guest row came from. A split
--      decision makes several rows for one request; this keeps them
--      traceable (audit, stats, the decision mail, idempotent replay). Only a
--      SECURITY DEFINER path may set it: authenticated holds a table-wide
--      INSERT/UPDATE on guests, so a guard trigger refuses the column from
--      client roles (same shape as guard_guest_request_decision_fields).
--   2. guest_requests.decision_message may now sit on a DENIED row too: the
--      note to the guest is mandatory on any (partial) decline and is what the
--      decline mail and the status page show. The internal decision_reason of
--      the old deny path stays internal.
--   3. decide_guest_request(p_request_id, p_decision jsonb) → jsonb.
--        p_decision = { "approved": [ { "tier_id": uuid, "plus_ones": int }, … ],
--                       "declined": int,      -- people declined, >= 0
--                       "note":     text }    -- to the guest; required when declined > 0
--      Every person of the request is accounted for exactly once:
--        Σ (1 + plus_ones) + declined = 1 + request.plus_ones.
--      One guest row per part (one part per tier), each through the normal
--      guests triggers: capacity 45005, link-max 45006, tier-max 45002 (rows),
--      audit 'insert' per guest. One UPDATE on the request = one audit row
--      ('approve' or 'deny') with the approved count and the note in the diff.
--      Any failure rolls the whole decision back: a half-decided request
--      never exists.
--      Returns { outcome: approved|partly|declined, guest_ids: [...],
--      replay: bool }. A repeated call with the SAME decision on a request it
--      already decided returns the original result with replay = true and
--      changes nothing (a double tap, a retried action), so the caller queues
--      the decision mail only once. A different decision on a decided request
--      is 45003, except re-approving a declined one (#12 "add anyway").
--   4. get_request_status shows the note on a declined request too (own
--      token only; a mirror gets no decision, as before).
--   5. request_decision_counts(venue, event?) — people asked / approved /
--      declined / waiting, aggregated in SQL (SECURITY INVOKER, RLS-scoped).
--      The declined part of a partly approved request counts as declined.
--   6. submit_guest_request: the auto-approve branch links the guest to its
--      request and queues the approval mail itself (enqueue_guest_mail, 6a).
--      It cannot hand the guest id back to the caller: the anon endpoint
--      answers a fresh and a repeat submitter alike (#28, z8uq9m0gvy), and a
--      guest id only on the fresh one would be exactly the oracle that
--      function closed. The server action only drains the queue.
--   7. guest_mails_claim (6a) gains a `tiers` array, so the one decision mail
--      names every part of a split (orchestrator decision 2026-10-10), and so
--      does every later reminder / event-changed mail to a split guest
--      (review S3).
--
-- THE NOTE IS MANDATORY IN THE DATABASE, ON EVERY PATH (review S1/S2):
--   * request_note_is_blank(text): NULL, whitespace (NBSP included), control,
--     zero-width, bidi and other invisible characters only = no note. Used by
--     decide_guest_request and by a CHECK, so an "invisible" note can never be
--     stored (NOT VALID: new writes only, existing rows are not re-validated).
--   * guard_guest_request_decision_note (BEFORE UPDATE): a transition to
--     'denied', or to 'approved' with fewer plus-ones than asked, without a
--     visible note is refused (23514), whatever path writes it: this RPC,
--     approve_guest_request, or the RLS deny update. Only the transition is
--     checked, so declined rows already on prod without a note stay valid.
--
-- EXPAND–CONTRACT: new column (nullable, no rewrite), a looser status CHECK, a
-- NOT VALID note CHECK, a transition trigger, new functions, two bodies
-- replaced behind unchanged signatures. A plain approve_guest_request (the
-- cockpit) keeps working. What stops working, on purpose: a decline or a
-- trimmed approval without a note. The app in this PR sends every decline
-- through decide_guest_request with a note (Requests and the cockpit), so the
-- RLS deny policy is now unused; dropping it is the contract step.

-- ---------------------------------------------------------------------------
-- 1. guests.guest_request_id
-- ---------------------------------------------------------------------------

alter table public.guests
  add column guest_request_id uuid references public.guest_requests (id) on delete restrict;

comment on column public.guests.guest_request_id is
  'The landing request this guest row was created from (z8uq9m2vga). Several '
  'rows share one when a decision split the request over tiers. Set only by '
  'decide_guest_request / submit_guest_request (SECURITY DEFINER); client '
  'roles can neither set nor change it (guard_guest_request_link).';

create index guests_guest_request_id_idx on public.guests (guest_request_id)
  where guest_request_id is not null;

create or replace function public.guard_guest_request_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Inside a SECURITY DEFINER function current_user is the owner, so the
  -- decision RPCs pass; every PostgREST write runs as authenticated/anon.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.guest_request_id is not null)
     or (tg_op = 'UPDATE' and new.guest_request_id is distinct from old.guest_request_id) then
    raise exception using errcode = '42501',
      message = 'The request link of a guest is set by the request decision only.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_guest_request_link() from public, anon, authenticated;

create trigger guests_guard_request_link
  before insert or update of guest_request_id on public.guests
  for each row execute function public.guard_guest_request_link();

-- ---------------------------------------------------------------------------
-- 2. decision_message on a declined request; the note is mandatory
-- ---------------------------------------------------------------------------

-- True when a note shows nothing to the guest: NULL, or only whitespace
-- (NBSP included), control characters, zero-width, bidi or other invisible
-- format characters (review S1: "\u200b" or chr(1) passed as a note).
create or replace function public.request_note_is_blank(p_note text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_note is null
      or regexp_replace(
           p_note,
           '[[:space:][:cntrl:]\u0080-\u009f\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0]',
           '', 'g') = '';
$$;

comment on function public.request_note_is_blank(text) is
  'z8uq9m2vga: true when a request note shows nothing (NULL, whitespace, '
  'control, zero-width, bidi or other invisible characters only).';

revoke execute on function public.request_note_is_blank(text) from public, anon, authenticated, service_role;
-- The CHECK and the guard trigger evaluate it as the writing role (the RLS
-- deny path writes as authenticated). Pure and data-free, so safe to grant.
grant execute on function public.request_note_is_blank(text) to authenticated, service_role;

alter table public.guest_requests drop constraint guest_requests_decision_message_check;
alter table public.guest_requests add constraint guest_requests_decision_message_check check (
  decision_message is null
  or (
    status in ('approved', 'denied')
    and char_length(decision_message) between 1 and 280
    and decision_message ~ '[^[:space:]]'
  )
);

-- A stored note is always visible. NOT VALID: checked on every new write,
-- existing rows are not re-validated (expand–contract on prod data).
alter table public.guest_requests add constraint guest_requests_decision_message_visible
  check (decision_message is null or not public.request_note_is_blank(decision_message)) not valid;

-- Every path that declines (part of) a request needs a visible note. Checked
-- on the transition only, so a declined row from before this rule, without a
-- note, stays as it is (and retention, which nulls the note, never changes
-- the status). AFTER, not BEFORE: RLS (WITH CHECK) and the column grants
-- judge a client write first, so a forged write still fails as 42501 and
-- only an otherwise allowed decline without a note fails here.
create or replace function public.guard_guest_request_decision_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.request_note_is_blank(new.decision_message)
     and (
       (new.status = 'denied' and old.status is distinct from 'denied')
       or (new.status = 'approved' and old.status is distinct from 'approved'
           and new.approved_plus_ones is not null
           and new.approved_plus_ones < new.plus_ones)
     ) then
    raise exception using errcode = '23514',
      message = 'Add a note when you decline (part of) a request.';
  end if;
  return null;
end;
$$;

revoke execute on function public.guard_guest_request_decision_note() from public, anon, authenticated;

create trigger guest_requests_guard_decision_note
  after update of status, approved_plus_ones, decision_message on public.guest_requests
  for each row execute function public.guard_guest_request_decision_note();

comment on column public.guest_requests.decision_message is
  'Plain-text note from the venue to the requester (z8uq9m0hw6; since '
  'z8uq9m2vga also on a declined request, where it is mandatory). Shown on '
  '/r/[token] (own token only) and in the decision mail. Nulled by the '
  'retention job. Untrusted plain text: every HTML consumer must escape it.';

-- ---------------------------------------------------------------------------
-- 3. decide_guest_request
-- ---------------------------------------------------------------------------

create or replace function public.decide_guest_request(p_request_id uuid, p_decision jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws          constant text := E' \t\n\r\f\x0B';
  uuid_re     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_req       public.guest_requests;
  v_event     uuid;
  v_parts     jsonb;
  v_part      jsonb;
  v_tier      uuid;
  v_plus      integer;
  v_tiers     uuid[] := '{}';
  v_pluses    integer[] := '{}';
  v_declined  integer;
  v_approved  integer := 0;
  v_note      text;
  v_outcome   text;
  v_ids       uuid[] := '{}';
  v_id        uuid;
  v_first     boolean := true;
  v_existing  uuid[];
begin
  -- Unlocked read: just enough to know whose request this is. An anonymized
  -- request is gone (#29), like in approve_guest_request.
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null or v_req.anonymized_at is not null then
    raise exception using errcode = 'P0002', message = 'Request not found.';
  end if;

  -- Same gate as approve_guest_request and the guest_requests_decide policy:
  -- an admin of the event's company or an organizer of the event.
  if not (
    public.has_venue_role(public.event_venue(v_req.event_id), '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Only an admin or an organizer of this event can decide requests.';
  end if;

  -- Authorized: lock the row and re-read what may have changed meanwhile.
  v_event := v_req.event_id;
  select * into v_req from public.guest_requests where id = p_request_id for update;
  if v_req.id is null
     or v_req.anonymized_at is not null
     or v_req.event_id is distinct from v_event then
    raise exception using errcode = 'P0002', message = 'Request not found.';
  end if;

  -- ── Parse the decision (after the role check: an outsider learns nothing) ─
  if p_decision is null or jsonb_typeof(p_decision) <> 'object' then
    raise exception using errcode = '22023', message = 'Send a decision.';
  end if;
  v_parts := coalesce(p_decision -> 'approved', '[]'::jsonb);
  if jsonb_typeof(v_parts) <> 'array' or jsonb_array_length(v_parts) > 21 then
    raise exception using errcode = '22023', message = 'Send the approved parts as a list.';
  end if;

  for v_part in select value from jsonb_array_elements(v_parts)
  loop
    if jsonb_typeof(v_part) <> 'object'
       or jsonb_typeof(v_part -> 'tier_id') is distinct from 'string'
       or (v_part ->> 'tier_id') !~ uuid_re
       or jsonb_typeof(v_part -> 'plus_ones') is distinct from 'number'
       or (v_part ->> 'plus_ones') !~ '^[0-9]{1,2}$' then
      raise exception using errcode = '22023', message = 'Each part needs a tier and a whole number of plus-ones.';
    end if;
    v_tier := (v_part ->> 'tier_id')::uuid;
    v_plus := (v_part ->> 'plus_ones')::integer;
    if v_tier = any (v_tiers) then
      raise exception using errcode = '23514', message = 'Use each tier once.';
    end if;
    -- Decision Max 2026-10-06: the approver picks from every tier of THIS
    -- event (no per-tier right exists). Never a tier of another event.
    if not exists (
      select 1 from public.guest_tiers t where t.id = v_tier and t.event_id = v_req.event_id
    ) then
      raise exception using errcode = '23514', message = 'Pick a valid tier for this event.';
    end if;
    v_tiers := v_tiers || v_tier;
    v_pluses := v_pluses || v_plus;
    v_approved := v_approved + 1 + v_plus;
  end loop;

  if jsonb_typeof(coalesce(p_decision -> 'declined', '0'::jsonb)) <> 'number'
     or coalesce(p_decision ->> 'declined', '0') !~ '^[0-9]{1,2}$' then
    raise exception using errcode = '22023', message = 'Declined must be a whole number of people.';
  end if;
  v_declined := coalesce(p_decision ->> 'declined', '0')::integer;

  -- Every person of the request exactly once: never more than asked for
  -- (no quota bypass by inflating a part), never someone left undecided.
  if v_approved + v_declined <> 1 + v_req.plus_ones then
    raise exception using errcode = '23514',
      message = 'The approved and declined people must add up to the request.';
  end if;

  if p_decision ? 'note' and jsonb_typeof(p_decision -> 'note') not in ('string', 'null') then
    raise exception using errcode = '22023', message = 'The note is text.';
  end if;
  v_note := nullif(btrim(p_decision ->> 'note', ws), '');
  -- Invisible-only text (control, zero-width, bidi, NBSP…) is no note (S1).
  if public.request_note_is_blank(v_note) then
    v_note := null;
  end if;
  if v_declined > 0 and v_note is null then
    raise exception using errcode = '23514',
      message = 'Add a note when you decline (part of) a request.';
  end if;
  if char_length(v_note) > 280 then
    raise exception using errcode = '23514', message = 'Keep the note to 280 characters.';
  end if;

  v_outcome := case when v_approved = 0 then 'declined'
                    when v_declined > 0 then 'partly'
                    else 'approved' end;

  -- ── Already decided: a replay of the same decision, or 45003 ──────────────
  if v_req.status = 'approved' then
    -- The same decision again = the same parts (tier, plus-ones) on the rows
    -- this request created, the same approved count and the same note.
    -- Same order as the first call returned them: the part with the
    -- requester's address first (parts share now(); v7 ids are not monotonic).
    select array_agg(g.id order by (g.email is null), g.id) into v_existing
      from public.guests g
     where g.guest_request_id = p_request_id;
    if v_existing is not null
       and v_req.approved_plus_ones is not distinct from (v_approved - 1)
       and v_req.decision_message is not distinct from v_note
       and (select array_agg(g.tier_id::text || ':' || g.plus_ones order by g.tier_id, g.plus_ones)
              from public.guests g where g.guest_request_id = p_request_id)
           = (select array_agg(t::text || ':' || p order by t, p)
                from unnest(v_tiers, v_pluses) as x(t, p)) then
      return jsonb_build_object('outcome', v_outcome, 'guest_ids', to_jsonb(v_existing), 'replay', true);
    end if;
    raise exception using errcode = '45003', message = 'This request was already decided.';
  end if;

  if v_req.status = 'denied' and v_approved = 0 then
    if v_req.decision_message is not distinct from v_note then
      return jsonb_build_object('outcome', 'declined', 'guest_ids', '[]'::jsonb, 'replay', true);
    end if;
    raise exception using errcode = '45003', message = 'This request was already decided.';
  end if;
  -- pending, or denied and now (partly) approved after all (#12): decide.

  -- G1: serialize concurrent decisions on one link before the inserts; the
  -- link-max trigger (45006) recomputes from committed state.
  if v_req.request_link_id is not null then
    perform 1 from public.request_links rl where rl.id = v_req.request_link_id for update;
  end if;

  -- One guest row per part. The first carries the requester's contact details
  -- (and so gets the decision mail); later parts carry the name only, so the
  -- address book and every later guest mail see one person, not two. added_by
  -- = the approver; source 'landing' never charges their quota (#31).
  for i in 1 .. coalesce(array_length(v_tiers, 1), 0)
  loop
    insert into public.guests
      (event_id, tier_id, full_name, email, phone, plus_ones,
       added_by, source, status, request_link_id, guest_request_id)
    values
      (v_req.event_id, v_tiers[i], v_req.full_name,
       case when v_first then v_req.email end,
       case when v_first then v_req.phone end,
       v_pluses[i], (select auth.uid()), 'landing', 'approved',
       v_req.request_link_id, v_req.id)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_first := false;
  end loop;

  -- One UPDATE with the status flip = one audit row ('approve'/'deny') whose
  -- diff carries the approved count and the note.
  update public.guest_requests
     set status             = case when v_approved > 0 then 'approved' else 'denied' end::public.request_status,
         decided_by         = (select auth.uid()),
         decided_at         = now(),
         decided_via        = 'manual',
         decision_reason    = null,
         approved_plus_ones = case when v_approved > 0 then v_approved - 1 end,
         decision_message   = v_note
   where id = p_request_id;

  return jsonb_build_object('outcome', v_outcome, 'guest_ids', to_jsonb(v_ids), 'replay', false);
end;
$$;

comment on function public.decide_guest_request(uuid, jsonb) is
  'Requests E (z8uq9m2vga): decide a landing request atomically. p_decision = '
  '{approved: [{tier_id, plus_ones}], declined: n, note}. Parts + declined must '
  'add up to the request; a note is required when declined > 0. One guest per '
  'part (every cap trigger fires per row), one audited request update. Admin '
  'of the company or organizer of the event. Same decision again = replay '
  '(no change); another decision on a decided request = 45003, except '
  're-approving a declined one.';

revoke execute on function public.decide_guest_request(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_guest_request(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_request_status — the note on a declined request too
-- ---------------------------------------------------------------------------
-- Body = 20261013160000 with one change: decision_message is returned for
-- 'denied' as well as 'approved' (own token only; the mirror branch selects
-- null for it, unchanged). The confirmed count stays approved-only.

create or replace function public.get_request_status(p_token_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      record;
  v_approved boolean;
begin
  if p_token_hash is null
     or not public.consume_public_throttle('st:' || p_ip_hash, 15, 30) then
    return jsonb_build_object('found', false);
  end if;

  -- 1. The submitter's own row (the fresh-submission path). The confirmed
  --    count is the recorded approved one, or — for an approval that predates
  --    the column, or an auto-approval — the requested one, which is exactly
  --    what those paths put on the guest. No venues join: the company address
  --    is never part of this payload (z8uq9m444c).
  select gr.full_name, gr.status, gr.plus_ones,
         coalesce(gr.approved_plus_ones, gr.plus_ones) as approved_plus_ones,
         gr.decision_message,
         e.name as event_name, e.starts_at, e.ends_at,
         e.location_name, e.location_address
  into v_row
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  where gr.status_token_hash = p_token_hash
    and gr.anonymized_at is null;

  -- 2. z8uq9m0h2v — a mirror: the token of a submission that was silently
  --    deduped against the row it points at. It answers with the name and
  --    plus-ones THAT caller submitted, never the row's own; the request's live
  --    `status` is the only field taken from the row. z8uq9m0hw6: a mirror gets
  --    nothing the venue decided on approval (no confirmed count, no message).
  --    The event location is no decision: it is on the share link the mirror
  --    caller submitted through, so a mirror gets it like everyone else.
  if not found then
    select m.full_name, gr.status, m.plus_ones,
           null::integer as approved_plus_ones, null::text as decision_message,
           e.name as event_name, e.starts_at, e.ends_at,
           e.location_name, e.location_address
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

  v_approved := v_row.status = 'approved';

  return jsonb_build_object(
    'found', true,
    'status', v_row.status,
    'full_name', v_row.full_name,
    'plus_ones', v_row.plus_ones,
    'event_name', v_row.event_name,
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'approved_plus_ones',
      case when v_approved then v_row.approved_plus_ones end,
    'decision_message',
      -- z8uq9m2vga: the venue note on a declined request too (mandatory on
      -- any decline). Own token only: the mirror branch selects null for it.
      case when v_row.status in ('approved', 'denied') then v_row.decision_message end,
    'location_name', nullif(btrim(v_row.location_name), ''),
    'location_address', nullif(btrim(v_row.location_address), ''),
    -- Contract pending: always null since z8uq9m444c. Kept so the app version
    -- deployed before this migration parses the payload; dropped later.
    'venue_address_line', null,
    'venue_postal_code', null,
    'venue_city', null
  );
end;
$$;

comment on function public.get_request_status(text, text) is
  'Guest status page (/r/[token]). Throttled st: 30/15 min. Found payload: '
  'status, own name + plus-ones, event name/times, the event''s own location '
  '(every state), on approval the confirmed count, and the venue note on an '
  'approved or declined request (z8uq9m2vga) — never for a mirror token. Never '
  'the company address (z8uq9m444c); the venue_* keys are always null pending '
  'their drop.';

revoke execute on function public.get_request_status(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_request_status(text, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. request_decision_counts — people asked / approved / declined / waiting
-- ---------------------------------------------------------------------------
-- People, not rows (same unit as the Promotion funnel since 20261013120000).
-- A partly approved request counts its declined part as declined:
--   approved request: approved = 1 + coalesce(approved_plus_ones, plus_ones),
--                     declined = plus_ones - coalesce(approved_plus_ones, plus_ones)
--   denied request:   declined = 1 + plus_ones
--   pending request:  waiting  = 1 + plus_ones
-- SECURITY INVOKER: guest_requests RLS decides which requests a caller sees,
-- so the numbers are role-relative (staff/doorhost see none → zeros).
-- Filtered by venue_id in SQL (denormalized since 20260708120000), never an
-- id list.

create or replace function public.request_decision_counts(p_venue_id uuid, p_event_id uuid default null)
returns table (
  requested_heads bigint,
  approved_heads  bigint,
  declined_heads  bigint,
  waiting_heads   bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(1 + gr.plus_ones), 0)::bigint,
    coalesce(sum(case when gr.status = 'approved'
                      then 1 + coalesce(gr.approved_plus_ones, gr.plus_ones) end), 0)::bigint,
    coalesce(sum(case when gr.status = 'approved'
                      then gr.plus_ones - coalesce(gr.approved_plus_ones, gr.plus_ones)
                      when gr.status = 'denied' then 1 + gr.plus_ones end), 0)::bigint,
    coalesce(sum(case when gr.status = 'pending' then 1 + gr.plus_ones end), 0)::bigint
  from public.guest_requests gr
  where gr.venue_id = p_venue_id
    and (p_event_id is null or gr.event_id = p_event_id);
$$;

comment on function public.request_decision_counts(uuid, uuid) is
  'Requests E (z8uq9m2vga): people asked / approved / declined / waiting for a '
  'company (optionally one event). The declined part of a partly approved '
  'request counts as declined. SECURITY INVOKER: RLS-scoped, role-relative.';

revoke execute on function public.request_decision_counts(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_decision_counts(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. submit_guest_request — the auto-approved guest gets its request + mail
-- ---------------------------------------------------------------------------
-- Body = 20260918160000 with two changes, both in the auto-approve insert:
--   * the guest row carries guest_request_id (= the request just inserted);
--   * after the request flips to approved, the approval mail is queued
--     through 6a's enqueue_guest_mail (it derives address and eligibility
--     from the database, and returns NULL for a guest without an address).
--     Its own sub-block: a queue problem never fails or un-approves the
--     submission. Nothing about the queue reaches the caller, so the answer
--     stays identical for a fresh and a repeat submitter (#28).

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
  v_guest_id   uuid;
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
             added_by, source, status, request_link_id, guest_request_id)
          values
            (v_link.event_id, v_link.tier_id, v_name, v_email, v_phone, v_plus,
             null, 'landing', 'approved', v_link.id, v_request_id)
          returning id into v_guest_id;

          update public.guest_requests
          set status = 'approved',
              decided_via = 'auto',
              decided_at = now()
          where id = v_request_id;

          v_auto := true;
        exception when sqlstate '45002' or sqlstate '45005' or sqlstate '45006' then
          null; -- full: stays pending, indistinguishable for the requester
        end;

        -- z8uq9m2vga: the approval mail (6a queue), queued here because the
        -- anon caller never gets the guest id (#28). Best effort and silent:
        -- a queue problem never fails or un-approves the submission, and
        -- nothing about it reaches the answer.
        if v_auto then
          begin
            perform public.enqueue_guest_mail(
              v_guest_id, 'guest_request_approved', null, null, 0, v_request_id);
          exception when others then
            null;
          end;
        end if;

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

-- Grants unchanged by CREATE OR REPLACE; restated as the matrix of record
-- (20260706103000: anon + authenticated + service_role, not PUBLIC).
revoke execute on function public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date, text)
from public, anon, authenticated, service_role;
grant execute on function public.submit_guest_request(text, text, text, text, integer, text, text, boolean, date, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. guest_mails_claim — one decision mail names every part of a split
-- ---------------------------------------------------------------------------
-- Orchestrator decision 2026-10-10 (option a): this migration redefines
-- guest_mails_claim, and only that 6a function. Body = the latest one on
-- main, taken over word for word, plus ONE addition: a `tiers` array in each
-- payload with a spot, [{tier_name, people, price_cents}]. For
-- guest_request_approved/_partly it lists every live guest the decision
-- created (guests.guest_request_id = the queue row's source request), and for
-- guest_reminder/guest_event_changed every live guest of the guest's own
-- request (review S3), so a split mail says "Regular: 2 people, VIP: 1
-- person" and the right total; for every other mail (and a guest without a
-- request) it is the one guest's spot, length 1. The context select also
-- reads g.guest_request_id for this. `spot` stays as it was, so the
-- deployed job keeps parsing the payload. Signature, security, search_path
-- and grants unchanged (create or replace keeps the ACL; restated below).

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
  'and per day; rows of a company without a contact address wait. Since '
  'z8uq9m2vga each payload with a spot carries `tiers`: every part of a split '
  'request decision, else the one guest''s spot.';

revoke execute on function public.guest_mails_claim(integer) from public, anon, authenticated;
grant execute on function public.guest_mails_claim(integer) to service_role;
