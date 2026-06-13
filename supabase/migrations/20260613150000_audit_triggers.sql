-- Fase 3 — Audit log via Postgres-triggers (decisions #4/#15, spec §3).
--
-- Scope of this migration:
--   * public.audit_changed(): JSONB diff with ONLY the changed fields
--     (updated_at excluded as trigger noise); NULL when nothing changed.
--   * public.request_device_id(): device id from the x-device-id request
--     header, falling back to a device_id JWT claim.
--   * public.audit_trigger(): one generic SECURITY DEFINER trigger function
--     that resolves venue/event scope, derives the action name and inserts
--     the audit row. App roles hold NO insert privilege on audit_log — the
--     definer (owner) is the only writer, so the log cannot be forged or
--     bypassed, not even by service_role.
--   * Triggers on guests, guest_tiers, quotas, event_quotas, quota_requests,
--     check_ins, refusals, venue_memberships, and on events ONLY for the
--     list_locked transition (lock/unlock, decision #23).
--   * Append-only hardening: fase 1 already revoked DELETE for every role
--     and granted authenticated SELECT only; service_role kept INSERT/UPDATE
--     from the blanket grant — revoked here. Remaining writer: the table
--     owner, which is also the path the anonymization job (#29) will use to
--     scrub diffs of anonymized guests.
--
-- Derived action vocabulary (spec §3: create/update/delete/check_in/refuse/
-- quota_grant/…):
--   guests.status     -> checked_in = 'check_in', refused = 'refuse',
--                        removed = 'delete' (soft delete, #21)
--   guests.tier_id    -> changed = 'tier_change'
--   events.list_locked-> 'lock' / 'unlock'
--   quotas / event_quotas -> INSERT or raise = 'quota_grant'
--   quota_requests.status -> 'approve' / 'deny'
--   check_ins INSERT  -> 'check_in'; refusals INSERT -> 'refuse'
--   everything else   -> 'create' / 'update' / 'delete'
-- An UPDATE that changes nothing (idempotent outbox replay, #25) logs nothing.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Diff of two row snapshots: {before, after} restricted to changed keys.
-- updated_at is excluded — set_updated_at bumps it on every write, which
-- would turn no-op replays into noise entries.
create or replace function public.audit_changed(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when count(*) = 0 then null
    else jsonb_build_object(
      'before', jsonb_object_agg(t.key, p_old -> t.key),
      'after',  jsonb_object_agg(t.key, p_new -> t.key))
  end
  from (
    select key from jsonb_object_keys(p_old) as o (key)
    union
    select key from jsonb_object_keys(p_new) as n (key)
  ) as t
  where t.key <> 'updated_at'
    and (p_old -> t.key) is distinct from (p_new -> t.key);
$$;

-- Device id of the current request: PostgREST exposes headers and JWT claims
-- as GUCs. Outside an API request (seed, jobs) both are absent -> NULL.
create or replace function public.request_device_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-device-id',
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'device_id'
  );
$$;

-- ---------------------------------------------------------------------------
-- Generic audit trigger
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: the function inserts as the table owner, the only role
-- holding INSERT on audit_log. RLS on the source tables has already been
-- evaluated by the time an AFTER ROW trigger fires.

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
    when 'guests', 'guest_tiers', 'event_quotas', 'quota_requests' then
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

  -- Action name (see vocabulary in the header comment).
  if tg_table_name = 'events' then
    -- Only the lock/unlock transition is audited on events; the trigger's
    -- WHEN clause guarantees list_locked actually flipped.
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
    elsif tg_table_name = 'quota_requests'
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
     -- Request context wins; door rows carry their own device as fallback.
     coalesce(public.request_device_id(), v_row ->> 'device_id'));

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger audit_guests
  after insert or update or delete on public.guests
  for each row execute function public.audit_trigger();

create trigger audit_guest_tiers
  after insert or update or delete on public.guest_tiers
  for each row execute function public.audit_trigger();

create trigger audit_quotas
  after insert or update or delete on public.quotas
  for each row execute function public.audit_trigger();

create trigger audit_event_quotas
  after insert or update or delete on public.event_quotas
  for each row execute function public.audit_trigger();

create trigger audit_quota_requests
  after insert or update or delete on public.quota_requests
  for each row execute function public.audit_trigger();

create trigger audit_check_ins
  after insert or update or delete on public.check_ins
  for each row execute function public.audit_trigger();

create trigger audit_refusals
  after insert or update or delete on public.refusals
  for each row execute function public.audit_trigger();

create trigger audit_venue_memberships
  after insert or update or delete on public.venue_memberships
  for each row execute function public.audit_trigger();

-- Events: ONLY lock/unlock is an audit action (#23); other event edits are
-- not in scope for the audit log.
create trigger audit_events_lock
  after update on public.events
  for each row
  when (old.list_locked is distinct from new.list_locked)
  execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Append-only hardening (verify of fase 1/2 + close the service_role gap)
-- ---------------------------------------------------------------------------
-- State after fase 1: DELETE/TRUNCATE revoked for every app role including
-- service_role; authenticated = SELECT only (RLS: admin/finance + AAL2);
-- anon = nothing. The blanket fase-1 grant left service_role with
-- INSERT/UPDATE — revoked here: triggers are the only writers (#4), and
-- UPDATE for the AVG scrub (#29) belongs to the table owner alone.

revoke insert, update on table public.audit_log from service_role;

-- Trigger/helper functions are not callable by app roles (default EXECUTE
-- for PUBLIC is stripped). Trigger execution itself does not require
-- EXECUTE at DML time — it is checked when CREATE TRIGGER runs (as owner).
revoke execute on function
  public.audit_trigger(),
  public.audit_changed(jsonb, jsonb),
  public.request_device_id()
from public, anon, authenticated, service_role;
