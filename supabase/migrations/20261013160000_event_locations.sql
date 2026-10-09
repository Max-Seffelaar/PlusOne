-- Event locations (z8uq9m444c, onboarding programme Oct 2026, wave D task 3b).
--
-- Decision Max 2026-10-07 (spec #48(c) revised, #53(c)): the share link
-- (/e/[slug]) and the guest status page (/r/[token]) ALWAYS show the event's
-- own location (name + address), never the company address. The event address
-- is deliberately public: it is what the share link is for. A company saves
-- several locations and picks one per event (or types a one-off); the event
-- keeps a COPY in events.location_name/location_address, so editing or
-- archiving a saved location never changes an existing event.
--
-- 1. public.company_locations — saved locations per company (venue).
--    Read: members of the venue (is_venue_member; a platform admin via its
--    last disjunct, #49). Write: admin only (has_venue_role admin). No DELETE
--    for any app role: a location is archived (archived_at), never removed —
--    events hold their own copy, so nothing references a row. venue_id is
--    immutable (column-level UPDATE grant leaves it out); id, archived_at and
--    the timestamps are server-set on insert. Grant matrix below: revoke
--    first, then grant.
--    Length caps keep a formatted copy ("line, postcode city") within the
--    200-char events.location_address cap: 120 + 2 + 16 + 1 + 60 = 199.
--
-- 2. Seed: one saved location per existing company that has an address, from
--    the company address (name = the company name). New companies start empty;
--    the event form then prefills from the company address (app side).
--
-- 3. Backfill: every existing event without its own location gets the company's
--    name + address, once (decision Max 2026-10-07: not live yet, the testing
--    organizers don't use it). From here on every event carries its own
--    location. No location column is audited (audit_events fires on lock /
--    allow_uncheck / default_member_quota only), and no status changes.
--
-- 4. get_request_status (SECURITY DEFINER, anon) returns the event's own
--    location_name / location_address for every FOUND token, every state,
--    mirrors included: the same two fields get_landing_event already hands
--    any holder of the share link, so the status page discloses nothing the
--    link did not. The company address (venues.address_line/postal_code/city)
--    is no longer read by this function at all. EXPAND–CONTRACT: the three
--    venue_* keys stay in the payload, always null, so the app version
--    deployed before this migration (which reads them) renders no address and
--    does not fail its parse; a later migration drops the keys once the new
--    app is live. Every found payload keeps one identical key set (#48(c)).
--    Signature, throttle ('st:', 15 min / 30), mirror handling, state gating
--    of count/message and the grants are unchanged.

-- ---------------------------------------------------------------------------
-- 1. company_locations
-- ---------------------------------------------------------------------------

create table public.company_locations (
  id           uuid primary key default public.uuid_generate_v7(),
  venue_id     uuid not null references public.venues (id) on delete restrict,
  name         text not null
    check (char_length(btrim(name)) between 1 and 120 and name = btrim(name)),
  address_line text check (address_line is null or char_length(address_line) <= 120),
  postal_code  text check (postal_code is null or char_length(postal_code) <= 16),
  city         text check (city is null or char_length(city) <= 60),
  country      text check (country is null or char_length(country) <= 60),
  place_id     text check (place_id is null or char_length(place_id) <= 300),
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.company_locations is
  'Saved locations per company (z8uq9m444c). Members read, admins write, archive '
  'instead of delete. An event stores a COPY (events.location_name/'
  'location_address), never a reference.';

create index company_locations_venue_idx
  on public.company_locations (venue_id, created_at)
  where archived_at is null;

create trigger set_updated_at before update on public.company_locations
  for each row execute function public.set_updated_at();

alter table public.company_locations enable row level security;

create policy company_locations_select on public.company_locations
  for select to authenticated
  using (public.is_venue_member(venue_id));

create policy company_locations_insert on public.company_locations
  for insert to authenticated
  with check (public.has_venue_role(venue_id, array['admin']::public.venue_role[]));

create policy company_locations_update on public.company_locations
  for update to authenticated
  using (public.has_venue_role(venue_id, array['admin']::public.venue_role[]))
  with check (public.has_venue_role(venue_id, array['admin']::public.venue_role[]));

-- Grant matrix: revoke first, then grant. anon nothing; authenticated reads,
-- INSERTs the content columns only (id, archived_at and the timestamps are
-- server-set: created_at orders the default location, so a client may not
-- backdate a row to the front) and UPDATEs the editable columns only
-- (venue_id is immutable); no DELETE, no TRUNCATE.
revoke all on table public.company_locations from public, anon, authenticated;
grant select on table public.company_locations to authenticated;
grant insert (venue_id, name, address_line, postal_code, city, country, place_id)
  on table public.company_locations to authenticated;
grant update (name, address_line, postal_code, city, country, place_id, archived_at)
  on table public.company_locations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Seed: one saved location per company with an address
-- ---------------------------------------------------------------------------

insert into public.company_locations (venue_id, name, address_line, postal_code, city, country)
select v.id,
       left(btrim(v.name), 120),
       nullif(left(btrim(coalesce(v.address_line, '')), 120), ''),
       nullif(left(btrim(coalesce(v.postal_code, '')), 16), ''),
       nullif(left(btrim(coalesce(v.city, '')), 60), ''),
       nullif(left(btrim(coalesce(v.country, '')), 60), '')
from public.venues v
where btrim(coalesce(v.name, '')) <> ''
  and (btrim(coalesce(v.address_line, '')) <> '' or btrim(coalesce(v.city, '')) <> '');

-- ---------------------------------------------------------------------------
-- 3. Backfill: events without their own location get the company's, once
-- ---------------------------------------------------------------------------
-- Same format as the app helper formatVenueAddress: "line, postcode city".

update public.events e
set location_name = left(btrim(v.name), 120),
    location_address = nullif(left(concat_ws(', ',
        nullif(btrim(coalesce(v.address_line, '')), ''),
        nullif(btrim(concat_ws(' ',
          nullif(btrim(coalesce(v.postal_code, '')), ''),
          nullif(btrim(coalesce(v.city, '')), ''))), '')
      ), 200), '')
from public.venues v
where v.id = e.venue_id
  and btrim(coalesce(e.location_name, '')) = ''
  and btrim(coalesce(e.location_address, '')) = '';

-- ---------------------------------------------------------------------------
-- 4. get_request_status: the event's location, never the company address
-- ---------------------------------------------------------------------------

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
      case when v_approved then v_row.decision_message end,
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
  '(every state), and on approval the confirmed count + venue message (never '
  'for a mirror token). Never the company address (z8uq9m444c); the venue_* '
  'keys are always null pending their drop.';

-- Grants unchanged by CREATE OR REPLACE; restated as in 20260706103000 so this
-- file is the matrix of record: anon, authenticated, service_role; not PUBLIC.
revoke execute on function public.get_request_status(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_request_status(text, text)
to anon, authenticated, service_role;
