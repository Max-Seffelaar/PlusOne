-- Fase 8 — Publieke aanvraagflow: landingpage → goedkeuring → gast (decisions
-- #12/#28/#31, spec §6 landingpage).
--
-- The DB foundation already exists from earlier fases:
--   * events.landing_slug / landing_active + the anon column-subset grant and the
--     events_select_landing policy (fase 1/2) — anon may read an event ONLY while
--     its landing link is active.
--   * guest_requests table + guest_requests_insert_public (anon may file a pending
--     request to an active event) + guest_requests_decide (admin/organizer decide)
--     (fase 1/2).
--   * The quota engine already excludes source='landing' from personal quota but
--     counts it toward tier-max (#31), and the audit triggers cover guests
--     (fase 3/7).
--
-- This migration adds what the public flow needs ON TOP of that boundary:
--   1. guest_requests.plus_ones        — the "+N" from the form (#9).
--   2. guest_requests.dedupe_key       — silent duplicate detection (#28).
--   3. landing_request_throttle        — per-IP rate-limit state (#28), server-
--                                        managed; never touched by anon directly.
--   4. submit_guest_request()          — the hardened anon submission path:
--                                        rate-limit + silent dedup + no event
--                                        enumeration. RLS stays the hard boundary;
--                                        this RPC is the abuse-prevention layer.
--   5. approve_guest_request()         — atomic: insert the guest (source=landing,
--                                        #31) AND mark the request approved, re-
--                                        checking admin/organizer like the RLS it
--                                        bypasses (mirrors approve_quota_request).
--   6. audit trigger on guest_requests — decisions (approve/deny) land in the
--                                        audit log, like quota_requests (#4/#15).
--
-- Errors reuse the established custom SQLSTATEs: 45002 (tier full), 45003
-- (request already handled), 42501 (no rights). Messages are Dutch UI copy.

-- ---------------------------------------------------------------------------
-- 1/2. guest_requests: the "+N" and the dedup key
-- ---------------------------------------------------------------------------

alter table public.guest_requests
  add column plus_ones integer not null default 0 check (plus_ones >= 0),
  -- Normalised contact fingerprint (email, else phone-digits) the submit RPC
  -- fills; NULL for name-only requests (those are never auto-deduped, two
  -- distinct people may share a name). See submit_guest_request().
  add column dedupe_key text;

comment on column public.guest_requests.plus_ones is
  'Hoeveel personen extra de aanvrager meeneemt (#9). Bij goedkeuring 1:1 naar de gast gekopieerd.';
comment on column public.guest_requests.dedupe_key is
  'Genormaliseerde contact-vingerafdruk (e-mail of telefoon-cijfers) voor stille dubbel-detectie (#28). NULL = naam-only, niet gededupliceerd.';

-- One open (pending) request per (event, contact). A decided request frees the
-- key, so someone may legitimately re-apply after a denial. Partial: name-only
-- requests (dedupe_key NULL) are never blocked.
create unique index guest_requests_dedupe_idx
  on public.guest_requests (event_id, dedupe_key)
  where status = 'pending' and dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- 3. Per-IP rate-limit state (#28)
-- ---------------------------------------------------------------------------
-- Fixed-window counter keyed by a SALTED hash of the client IP (the app hashes
-- the IP before it ever reaches the DB — no raw PII stored, CLAUDE.md §security).
-- Written EXCLUSIVELY by submit_guest_request() (SECURITY DEFINER); anon and
-- authenticated have no privileges on it at all. service_role keeps full access
-- for ops/cleanup (e.g. e2e reset) — the table holds no guest data.

create table public.landing_request_throttle (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.landing_request_throttle enable row level security;
-- No policies → default-deny for anon/authenticated even though they also hold
-- no table privilege. Defense in depth.

revoke all on table public.landing_request_throttle from anon, authenticated, service_role;
grant select, insert, update, delete on table public.landing_request_throttle to service_role;

-- ---------------------------------------------------------------------------
-- 4. Hardened public submission (#12/#28)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can consult/maintain the throttle table and insert the
-- request atomically, regardless of the caller's (anon) privileges. It returns a
-- coarse status the app maps to copy; it NEVER reveals whether a guest/e-mail
-- already exists (#28, no enumeration):
--   'ok'            — accepted, OR silently de-duplicated (indistinguishable).
--   'rate_limited'  — too many requests from this IP in the window.
--   'closed'        — the landing link is not active (covers "does not exist"
--                     and "deactivated" identically → no slug enumeration).
--   'invalid'       — input failed the minimal server-side guard.
--
-- Rate limit: WINDOW_MIN minutes / MAX_PER_WINDOW requests per ip_hash.

create or replace function public.submit_guest_request(
  p_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_plus_ones integer,
  p_motivation text,
  p_ip_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_min   constant integer := 10;   -- fixed-window length (minutes)
  max_per_win  constant integer := 10;    -- max submissions per window per IP
  v_event_id   uuid;
  v_name       text := nullif(btrim(p_full_name), '');
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := nullif(btrim(p_phone), '');
  v_phone_dig  text;
  v_motivation text := nullif(btrim(p_motivation), '');
  v_plus       integer := least(greatest(coalesce(p_plus_ones, 0), 0), 20);
  v_key        text;
  v_count      integer;
begin
  -- Minimal server-side guard (the app's Zod schema is the primary one).
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    return 'invalid';
  end if;
  if v_motivation is not null and char_length(v_motivation) > 1000 then
    v_motivation := left(v_motivation, 1000);
  end if;

  -- Resolve the event by slug, but ONLY while its landing link is open. A
  -- closed/unknown slug is indistinguishable → no enumeration (#28).
  select e.id into v_event_id
  from public.events e
  where e.landing_slug = p_slug
    and e.landing_active
    and e.status <> 'closed';
  if v_event_id is null then
    return 'closed';
  end if;

  -- Rate limit per IP (fixed window). Atomic upsert; the window resets once it
  -- has elapsed. A null ip_hash (no client IP) skips throttling — it cannot be
  -- bucketed — but every real request from the app carries one.
  if p_ip_hash is not null then
    insert into public.landing_request_throttle as t (ip_hash, window_started_at, request_count)
    values (p_ip_hash, now(), 1)
    on conflict (ip_hash) do update
      set request_count = case
            when t.window_started_at < now() - make_interval(mins => window_min) then 1
            else t.request_count + 1
          end,
          window_started_at = case
            when t.window_started_at < now() - make_interval(mins => window_min) then now()
            else t.window_started_at
          end,
          updated_at = now()
    returning t.request_count into v_count;

    if v_count > max_per_win then
      return 'rate_limited';
    end if;
  end if;

  -- Dedup fingerprint: e-mail, else phone digits. Name-only stays NULL (never
  -- auto-deduped). Phone normalised to digits so "06 12" == "0612".
  v_phone_dig := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
  v_key := coalesce(v_email, v_phone_dig);

  -- Insert. The partial unique index makes a second identical PENDING request a
  -- unique_violation, which we swallow → the caller cannot tell "new" from
  -- "duplicate" (#28). Race-proof: the index, not a read-then-write, decides.
  begin
    insert into public.guest_requests
      (event_id, full_name, email, phone, plus_ones, motivation, dedupe_key)
    values
      (v_event_id, v_name, v_email, v_phone, v_plus, v_motivation, v_key);
  exception when unique_violation then
    null; -- silent dedup
  end;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Atomic approval (#12/#31)
-- ---------------------------------------------------------------------------
-- Approve = create the guest AND flip the request to approved, in one tx, so a
-- tier-full failure (45002) rolls back BOTH (the request stays pending). The
-- guest is source='landing' → outside the approver's personal quota (#31), but
-- the AFTER trigger still enforces tier-max. SECURITY DEFINER, so it re-checks
-- admin/organizer itself (the RLS it bypasses). Denials need no RPC — admins
-- update the row directly under guest_requests_decide.

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
  v_req     public.guest_requests;
  v_venue   uuid;
  v_guest_id uuid;
begin
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Aanvraag niet gevonden.';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003', message = 'Deze aanvraag is al afgehandeld.';
  end if;

  -- #12 / role matrix §2: admin (venue) or organizer (this event) only.
  v_venue := public.event_venue(v_req.event_id);
  if not (
    public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
    or public.is_event_organizer(v_req.event_id)
  ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator van dit event mag aanvragen goedkeuren.';
  end if;

  -- The tier must belong to THIS event (the composite FK enforces it too, but a
  -- pre-check gives clean Dutch copy instead of a raw FK violation).
  if not exists (
    select 1 from public.guest_tiers gt
    where gt.id = p_tier_id and gt.event_id = v_req.event_id
  ) then
    raise exception using errcode = '23514', message = 'Kies een geldige tier voor dit event.';
  end if;

  -- Create the guest. added_by = the approver (the "toegevoegd door" in the
  -- audit log / door card), source='landing' so it never charges their quota
  -- (#31). The enforce_guest_quota AFTER trigger still applies tier-max → a full
  -- tier raises 45002 and the whole approval rolls back. audit_guests logs the
  -- 'create'.
  insert into public.guests
    (event_id, tier_id, full_name, email, phone, plus_ones, added_by, source, status)
  values
    (v_req.event_id, p_tier_id, v_req.full_name, v_req.email, v_req.phone,
     v_req.plus_ones, (select auth.uid()), 'landing', 'approved')
  returning id into v_guest_id;

  -- Flip the request → approved. Fires audit_guest_requests ('approve').
  update public.guest_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id;

  return v_guest_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Audit the request decision (#4/#15)
-- ---------------------------------------------------------------------------
-- Extend the generic audit_trigger() so guest_requests joins the event-scoped
-- branch and maps a status change to 'approve'/'deny' (exactly like
-- quota_requests). Additive CREATE OR REPLACE — the body is the fase-3 function
-- with guest_requests woven in. Anon SUBMISSIONS are intentionally NOT audited
-- (the trigger fires on UPDATE only, like the events lock/unlock trigger): the
-- log stays "wie deed wat", focused on staff decisions.

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_entity_id uuid := (v_row ->> 'id')::uuid;
  v_event_id uuid;
  v_venue_id uuid;
  v_action text;
  v_diff jsonb;
begin
  -- Venue/event scope of the audited row.
  case tg_table_name
    when 'guests', 'guest_tiers', 'event_quotas', 'quota_requests', 'guest_requests' then
      v_event_id := (v_row ->> 'event_id')::uuid;
    when 'check_ins', 'refusals' then
      select g.event_id into v_event_id
      from public.guests g
      where g.id = (v_row ->> 'guest_id')::uuid;
    when 'events' then
      v_event_id := v_entity_id;
      v_venue_id := (v_row ->> 'venue_id')::uuid;
    else -- quotas, venue_memberships: venue-scoped rows
      v_venue_id := (v_row ->> 'venue_id')::uuid;
  end case;

  if v_venue_id is null and v_event_id is not null then
    select e.venue_id into v_venue_id from public.events e where e.id = v_event_id;
  end if;

  -- Action name (see vocabulary in the fase-3 header comment).
  if tg_table_name = 'events' then
    v_action := case when (v_new ->> 'list_locked')::boolean then 'lock' else 'unlock' end;
  elsif tg_op = 'INSERT' then
    v_action := case tg_table_name
      when 'check_ins' then 'check_in'
      when 'refusals' then 'refuse'
      when 'quotas' then 'quota_grant'
      when 'event_quotas' then 'quota_grant'
      else 'create'
    end;
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
  else
    v_action := 'update';
    if tg_table_name = 'guests' then
      if (v_old ->> 'status') is distinct from (v_new ->> 'status') then
        v_action := case v_new ->> 'status'
          when 'checked_in' then 'check_in'
          when 'refused' then 'refuse'
          when 'removed' then 'delete' -- soft delete (#21)
          else 'update'
        end;
      elsif (v_old ->> 'tier_id') is distinct from (v_new ->> 'tier_id') then
        v_action := 'tier_change';
      end if;
    elsif tg_table_name = 'quotas'
      and (v_new ->> 'default_count')::int > (v_old ->> 'default_count')::int then
      v_action := 'quota_grant';
    elsif tg_table_name = 'event_quotas'
      and (v_new ->> 'quota_override')::int > (v_old ->> 'quota_override')::int then
      v_action := 'quota_grant';
    elsif tg_table_name in ('quota_requests', 'guest_requests')
      and (v_old ->> 'status') is distinct from (v_new ->> 'status') then
      v_action := case v_new ->> 'status'
        when 'approved' then 'approve'
        when 'denied' then 'deny'
        else 'update'
      end;
    end if;
  end if;

  -- Diff. Full snapshot on create/delete; changed fields only on update.
  if tg_op = 'UPDATE' then
    v_diff := public.audit_changed(v_old, v_new);
    if v_diff is null then
      return null; -- nothing changed (idempotent outbox replay, #25)
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := jsonb_build_object('before', null, 'after', v_new);
  else
    v_diff := jsonb_build_object('before', v_old, 'after', null);
  end if;

  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  values
    (auth.uid(), v_venue_id, v_event_id, tg_table_name, v_entity_id, v_action, v_diff,
     coalesce(public.request_device_id(), v_row ->> 'device_id'));

  return null;
end;
$$;

-- Only the DECISION (status change) is audited, not the anon submission.
create trigger audit_guest_requests
  after update on public.guest_requests
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Privileges — match the fase-7 pattern: revoke the implicit PUBLIC EXECUTE,
-- then grant only the intended surface.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text),
  public.approve_guest_request(uuid, uuid)
from public, anon, authenticated, service_role;

-- The public landing form (anon) and any signed-in visitor may submit.
grant execute on function
  public.submit_guest_request(text, text, text, text, integer, text, text)
to anon, authenticated, service_role;

-- Self-guarded (admin/organizer re-checked inside); safe to expose to callers.
grant execute on function public.approve_guest_request(uuid, uuid)
to authenticated, service_role;
