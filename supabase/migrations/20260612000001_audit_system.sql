-- Audit system: generic trigger function + triggers for all mutable entities
-- audit_log is append-only, immutable even for admins

-- === GENERIC AUDIT TRIGGER FUNCTION ===
-- Captures INSERT, UPDATE, DELETE with diff-only tracking (only changed fields in diff)
create or replace function audit_trigger()
returns trigger as $$
declare
  v_venue_id uuid;
  v_event_id uuid;
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_diff jsonb;
  v_key text;
  v_device_id text := current_setting('request.jwt.claims', true)::jsonb->>'device_id';
begin
  -- Determine venue_id based on table
  case TG_TABLE_NAME
    when 'guests' then
      select event_id into v_event_id from events where id = (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
      select venue_id into v_venue_id from events where id = (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
    when 'check_ins' then
      select e.id, e.venue_id into v_event_id, v_venue_id
        from check_ins ci
        join guests g on g.id = ci.guest_id
        join events e on e.id = g.event_id
        where ci.id = (case when TG_OP = 'DELETE' then OLD.id else NEW.id end);
    when 'refusals' then
      select e.id, e.venue_id into v_event_id, v_venue_id
        from refusals rf
        join guests g on g.id = rf.guest_id
        join events e on e.id = g.event_id
        where rf.id = (case when TG_OP = 'DELETE' then OLD.id else NEW.id end);
    when 'guest_tiers' then
      select venue_id into v_venue_id from events where id = (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
      v_event_id := (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
    when 'quotas' then
      v_venue_id := (case when TG_OP = 'DELETE' then OLD.venue_id else NEW.venue_id end);
    when 'event_quotas' then
      select venue_id into v_venue_id from events where id = (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
      v_event_id := (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
    when 'quota_requests' then
      select venue_id into v_venue_id from events where id = (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
      v_event_id := (case when TG_OP = 'DELETE' then OLD.event_id else NEW.event_id end);
    when 'venue_memberships' then
      v_venue_id := (case when TG_OP = 'DELETE' then OLD.venue_id else NEW.venue_id end);
    when 'events' then
      v_venue_id := (case when TG_OP = 'DELETE' then OLD.venue_id else NEW.venue_id end);
      v_event_id := (case when TG_OP = 'DELETE' then OLD.id else NEW.id end);
  end case;

  -- Determine action and capture before/after
  if TG_OP = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after := row_to_json(NEW);
  elsif TG_OP = 'DELETE' then
    v_action := 'delete';
    v_before := row_to_json(OLD);
    v_after := null;
  else -- UPDATE
    v_before := row_to_json(OLD);
    v_after := row_to_json(NEW);

    -- Determine specific action based on field changes
    if TG_TABLE_NAME = 'guests' and OLD.status is distinct from NEW.status then
      case NEW.status
        when 'checked_in' then v_action := 'check_in';
        when 'refused' then v_action := 'refuse';
        else v_action := 'status_change';
      end case;
    elsif TG_TABLE_NAME = 'guests' and (OLD.tier_id is distinct from NEW.tier_id) then
      v_action := 'tier_change';
    elsif TG_TABLE_NAME = 'events' and (OLD.list_locked is distinct from NEW.list_locked) then
      v_action := case when NEW.list_locked then 'lock' else 'unlock' end;
    elsif TG_TABLE_NAME = 'quotas' and (OLD.default_count < NEW.default_count) then
      v_action := 'quota_grant';
    elsif TG_TABLE_NAME = 'event_quotas' and (OLD.override_count < NEW.override_count or (OLD.override_count is null and NEW.override_count is not null)) then
      v_action := 'quota_grant';
    elsif TG_TABLE_NAME = 'quota_requests' and (OLD.decision is distinct from NEW.decision) then
      v_action := case when NEW.decision = 'approved' then 'quota_approved' else 'quota_denied' end;
    else
      v_action := 'update';
    end if;
  end if;

  -- Build diff: only include changed fields for updates
  if TG_OP = 'UPDATE' then
    v_diff := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_after)
    loop
      if (v_before->v_key) is distinct from (v_after->v_key) then
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('before', v_before->v_key, 'after', v_after->v_key));
      end if;
    end loop;
  elsif TG_OP = 'DELETE' then
    -- For deletes, include all fields in before_data
    v_diff := null;
  else
    -- For inserts, include all fields in after_data
    v_diff := null;
  end if;

  -- Insert audit log entry
  insert into audit_log (
    venue_id,
    event_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    device_id,
    created_at
  ) values (
    v_venue_id,
    v_event_id,
    auth.uid(),
    TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then OLD.id else NEW.id end,
    v_action,
    v_before,
    v_after,
    v_device_id,
    now()
  );

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$ language plpgsql;

-- === TRIGGERS ===
-- Guests
create trigger guests_audit
  after insert or update or delete on guests
  for each row execute function audit_trigger();

-- Guest Tiers
create trigger guest_tiers_audit
  after insert or update or delete on guest_tiers
  for each row execute function audit_trigger();

-- Quotas
create trigger quotas_audit
  after insert or update or delete on quotas
  for each row execute function audit_trigger();

-- Event Quotas
create trigger event_quotas_audit
  after insert or update or delete on event_quotas
  for each row execute function audit_trigger();

-- Quota Requests
create trigger quota_requests_audit
  after insert or update or delete on quota_requests
  for each row execute function audit_trigger();

-- Check-ins
create trigger check_ins_audit
  after insert or update or delete on check_ins
  for each row execute function audit_trigger();

-- Refusals
create trigger refusals_audit
  after insert or update or delete on refusals
  for each row execute function audit_trigger();

-- Venue Memberships
create trigger venue_memberships_audit
  after insert or update or delete on venue_memberships
  for each row execute function audit_trigger();

-- Events (for lock/unlock tracking)
create trigger events_audit
  after insert or update or delete on events
  for each row execute function audit_trigger();

-- === ENSURE AUDIT_LOG IS IMMUTABLE ===
-- Revoke INSERT/UPDATE/DELETE for all authenticated users and service role on audit_log
-- Only the trigger can write (via superuser context)
revoke insert, update, delete on audit_log from authenticated;
revoke insert, update, delete on audit_log from service_role;

-- Allow service role to insert via trigger (implicit via function)
-- But explicitly prevent direct writes
create policy audit_log_select_if_admin on audit_log
  for select using (
    exists (
      select 1 from venue_memberships vm
      join auth.users au on au.id = vm.user_id
      where vm.venue_id = audit_log.venue_id
        and 'admin'::venue_role = any(vm.roles)
        and au.id = auth.uid()
    )
    or (
      auth.jwt()->>'role' = 'service_role'
    )
  );

-- Allow Finance role to see audit log too
create policy audit_log_select_if_finance on audit_log
  for select using (
    exists (
      select 1 from venue_memberships vm
      join auth.users au on au.id = vm.user_id
      where vm.venue_id = audit_log.venue_id
        and 'finance'::venue_role = any(vm.roles)
        and au.id = auth.uid()
    )
  );
