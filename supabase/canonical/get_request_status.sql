-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20260918174500_partial_approval_decision_message.sql:286.

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

  -- 1. The submitter's own row (the fresh-submission path).
  select gr.full_name, gr.status, gr.plus_ones,
         gr.approved_plus_ones, gr.decision_message,
         e.name as event_name, e.starts_at, e.ends_at,
         v.address_line, v.postal_code, v.city
  into v_row
  from public.guest_requests gr
  join public.events e on e.id = gr.event_id
  join public.venues v on v.id = e.venue_id
  where gr.status_token_hash = p_token_hash
    and gr.anonymized_at is null;

  -- 2. z8uq9m0h2v — a mirror: the token of a submission that was silently
  --    deduped against the row it points at. It answers with the name and
  --    plus-ones THAT caller submitted, never the row's own: the caller proved
  --    they know an e-mail address, which is not proof they are the person
  --    behind it. The request's live `status` is what the dedup premise does
  --    justify handing over, and is the only field taken from the row.
  --    z8uq9m0hw6: for the same reason a mirror never gets the approved count
  --    or the venue message — both were decided for the row's own submitter.
  if not found then
    select m.full_name, gr.status, m.plus_ones,
           null::integer as approved_plus_ones, null::text as decision_message,
           e.name as event_name, e.starts_at, e.ends_at,
           v.address_line, v.postal_code, v.city
    into v_row
    from public.guest_request_status_mirrors m
    join public.guest_requests gr on gr.id = m.request_id
    join public.events e on e.id = gr.event_id
    join public.venues v on v.id = e.venue_id
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
      case when v_approved and v_row.approved_plus_ones < v_row.plus_ones
           then v_row.approved_plus_ones end,
    'decision_message',
      case when v_approved then v_row.decision_message end,
    'venue_address_line',
      case when v_approved then nullif(btrim(v_row.address_line), '') end,
    'venue_postal_code',
      case when v_approved then nullif(btrim(v_row.postal_code), '') end,
    'venue_city',
      case when v_approved then nullif(btrim(v_row.city), '') end
  );
end;
$$;
