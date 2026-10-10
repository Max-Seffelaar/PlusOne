-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20261013160000_event_locations.sql:140.

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
