-- Canonical body (K10 drift guard, see supabase/canonical/README.md).
-- Newest source: supabase/migrations/20260706100000_influencers_request_links.sql:482.

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
    when 'guests', 'guest_tiers', 'event_quotas', 'quota_requests', 'guest_requests', 'request_links' then
      v_event_id := (v_row ->> 'event_id')::uuid;
    when 'check_ins', 'refusals' then
      select g.event_id into v_event_id
      from public.guests g
      where g.id = (v_row ->> 'guest_id')::uuid;
    when 'events' then
      v_event_id := v_entity_id;
      v_venue_id := (v_row ->> 'venue_id')::uuid;
    when 'venues' then
      -- A venues row's own id is the venue id (no venue_id column).
      v_venue_id := v_entity_id;
    else -- quotas, venue_memberships, influencers: venue-scoped rows
      v_venue_id := (v_row ->> 'venue_id')::uuid;
  end case;

  if v_venue_id is null and v_event_id is not null then
    select e.venue_id into v_venue_id from public.events e where e.id = v_event_id;
  end if;

  -- Action name (see vocabulary in the fase-3 migration header).
  if tg_table_name = 'events' then
    -- Lock/unlock only when list_locked actually flipped; other event audits
    -- (e.g. allow_uncheck) are a plain 'update' carrying the JSONB diff.
    if (v_old ->> 'list_locked') is distinct from (v_new ->> 'list_locked') then
      v_action := case when (v_new ->> 'list_locked')::boolean then 'lock' else 'unlock' end;
    else
      v_action := 'update';
    end if;
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
     -- Request context wins; door rows carry their own device as fallback.
     coalesce(public.request_device_id(), v_row ->> 'device_id'));

  return null;
end;
$$;
