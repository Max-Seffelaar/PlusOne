-- Event locations follow-up (z8uq9m49k2): audit trail on location changes +
-- the contract step for get_request_status.
--
-- 1. Audit (CLAUDE.md rule 4: audit via triggers, never app code). The event
--    location is a public address since #452 (spec #58), so changing it is
--    audited like the other public-facing event settings:
--    a. audit_events (the ONE consolidated events trigger, 20260708100000)
--       now also fires when location_name or location_address changes. Same
--       generic public.audit_trigger(): actor = auth.uid(), action 'update',
--       diff = the changed columns only (audit_changed, updated_at excluded).
--       A location edit made together with a name/time edit lands as one row
--       with all changed columns, exactly like a lock + allow_uncheck edit.
--    b. company_locations gets the standard AFTER INSERT/UPDATE/DELETE audit
--       trigger: create = full snapshot, update (incl. archive/un-archive) =
--       changed columns, delete = full snapshot (no app role can delete, but
--       the owner could; never unaudited). The row is venue-scoped through
--       its venue_id column, which audit_trigger's default branch reads.
--    c. audit_feed gains one trailing column, location_name: the saved
--       location's CURRENT name for a company_locations row (joined on
--       entity_id). An update diff holds only the changed columns, so an
--       archive (archived_at only) would otherwise read "archived a saved
--       location" with no way to tell which (#467 test 10). The view stays
--       security_invoker: the join reads under the caller's RLS
--       (company_locations_select = venue members, archived rows included),
--       and only admin/finance read audit rows at all. CREATE OR REPLACE
--       with the column appended keeps the grants of 20260917100000.
--    audit_trigger() itself is NOT redefined (canonical body unchanged, K10).
--    No backfill of history: changes before this migration are not in the
--    log, as with every audit trigger added later.
--
-- 2. Contract (expand–contract of 20261013160000): get_request_status no
--    longer returns the venue_address_line / venue_postal_code / venue_city
--    keys, always null since #452. No deployed code reads them: the app
--    adapter (src/features/requests/status-view.ts) ignores them since #452
--    and its Zod schema treats every key as optional, so the app deployed
--    before this migration parses the new payload unchanged. Every found
--    payload still has one identical key set. Signature, throttle, mirror
--    handling, state gating and grants are unchanged; the body is otherwise
--    byte-for-byte the 20261015120000 one (task 7: the venue note also on a
--    declined request), supabase/canonical updated.

-- ---------------------------------------------------------------------------
-- 1a. events: location changes are audited
-- ---------------------------------------------------------------------------

drop trigger audit_events on public.events;

create trigger audit_events
  after update on public.events
  for each row
  when (
    old.list_locked is distinct from new.list_locked
    or old.allow_uncheck is distinct from new.allow_uncheck
    or old.default_member_quota is distinct from new.default_member_quota
    or old.location_name is distinct from new.location_name
    or old.location_address is distinct from new.location_address
  )
  execute function public.audit_trigger();

comment on column public.events.location_name is
  'Per-event location name (z8uq9m2vqc; public on /e/[slug] and /r/[token] since z8uq9m444c). Changes are audited via audit_events (z8uq9m49k2).';
comment on column public.events.location_address is
  'Per-event location address (z8uq9m2vqc; public on /e/[slug] and /r/[token] since z8uq9m444c, never the company address). Changes are audited via audit_events (z8uq9m49k2).';

-- ---------------------------------------------------------------------------
-- 1b. company_locations: every write is audited
-- ---------------------------------------------------------------------------

create trigger audit_company_locations
  after insert or update or delete on public.company_locations
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 2. get_request_status without the venue_* keys (contract)
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
      -- z8uq9m2vga: the venue note on a declined request too (mandatory on
      -- any decline). Own token only: the mirror branch selects null for it.
      case when v_row.status in ('approved', 'denied') then v_row.decision_message end,
    'location_name', nullif(btrim(v_row.location_name), ''),
    'location_address', nullif(btrim(v_row.location_address), '')
  );
end;
$$;

comment on function public.get_request_status(text, text) is
  'Guest status page (/r/[token]). Throttled st: 30/15 min. Found payload: '
  'status, own name + plus-ones, event name/times, the event''s own location '
  '(every state), and on approval the confirmed count + venue message (never '
  'for a mirror token). Never the company address (z8uq9m444c); the legacy '
  'venue_* keys are gone since z8uq9m49k2.';

revoke execute on function public.get_request_status(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_request_status(text, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1c. audit_feed: the saved location's name for company_locations rows
-- ---------------------------------------------------------------------------
-- Body = 20260706104000 verbatim plus the last column and its join.

create or replace view public.audit_feed
with (security_invoker = on)
as
with base as (
  select
    a.id, a.actor_id, a.venue_id, a.event_id, a.entity_type, a.entity_id,
    a.action, a.diff, a.device_id, a.created_at,
    case
      when a.entity_type = 'guests' then a.entity_id
      when a.entity_type in ('check_ins', 'refusals')
        then coalesce(a.diff -> 'after' ->> 'guest_id', a.diff -> 'before' ->> 'guest_id')::uuid
    end as rel_guest_id,
    case
      when a.entity_type in ('quotas', 'event_quotas', 'quota_requests', 'venue_memberships')
        then coalesce(a.diff -> 'after' ->> 'user_id', a.diff -> 'before' ->> 'user_id')::uuid
    end as rel_user_id,
    case
      when a.entity_type = 'guest_requests' then a.entity_id
    end as rel_request_id,
    case
      when a.entity_type = 'company_locations' then a.entity_id
    end as rel_location_id,
    (a.diff -> 'before' ->> 'tier_id')::uuid as old_tier_id,
    (a.diff -> 'after' ->> 'tier_id')::uuid as new_tier_id
  from public.audit_log a
)
select
  b.id, b.actor_id, b.venue_id, b.event_id, b.entity_type, b.entity_id,
  b.action, b.diff, b.device_id, b.created_at,
  b.rel_guest_id as guest_id,
  b.rel_user_id as subject_user_id,
  actor.full_name as actor_name,
  g.full_name as guest_name,
  subj.full_name as subject_name,
  ot.name as old_tier_name,
  nt.name as new_tier_name,
  ev.name as event_name,
  gr.full_name as request_name,
  cl.name as location_name
from base b
left join public.user_profiles actor on actor.id = b.actor_id
left join public.guests g on g.id = b.rel_guest_id
left join public.user_profiles subj on subj.id = b.rel_user_id
left join public.guest_tiers ot on ot.id = b.old_tier_id
left join public.guest_tiers nt on nt.id = b.new_tier_id
left join public.events ev on ev.id = b.event_id
left join public.guest_requests gr on gr.id = b.rel_request_id
left join public.company_locations cl on cl.id = b.rel_location_id;
