-- S1.1 — "Uitchecken toestaan" als company-default, overrulebaar per event.
--
-- Decision (Max, 22 jun 2026): until now ANY door-scoped user could reverse a
-- check-in (soft void, #3) at the door / cockpit, always. Make it a setting:
--   * venues.allow_uncheck  — company-wide default (default TRUE: keep today's
--     behaviour, opt-out).
--   * events.allow_uncheck  — per-event override; NULL = inherit the venue default.
-- Effective value = COALESCE(events.allow_uncheck, venues.allow_uncheck, true).
--
-- Enforced in the DATABASE, not just the UI (CLAUDE.md: RLS is the boundary): a
-- RESTRICTIVE update policy on check_ins rejects the void transition (voided_at
-- null -> not null) when uncheck is off, while re-checkin (revive) and partial
-- top-ups stay allowed. The cockpit/door additionally hide the affordance.
--
-- Audited (#4/#15): the new columns flip a fraud-relevant control, so both the
-- venue default and the per-event override land in the audit log via the generic
-- JSONB-diff trigger. The trigger function + the events trigger are widened here
-- (events were previously audited ONLY on list_locked); venues gain a trigger.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.venues
  add column allow_uncheck boolean not null default true;

comment on column public.venues.allow_uncheck is
  'Company-wide default: may a check-in be reversed (uitchecken / soft void, #3) at the door & cockpit? Overridable per event via events.allow_uncheck. Effective value = coalesce(events.allow_uncheck, this, true).';

alter table public.events
  add column allow_uncheck boolean;

comment on column public.events.allow_uncheck is
  'Per-event override for uitchecken (soft void, #3). NULL inherits the venue default (venues.allow_uncheck). Effective value = coalesce(this, venues.allow_uncheck, true).';

-- ---------------------------------------------------------------------------
-- Effective-setting resolver (COALESCE event override -> venue default -> true)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER + empty search_path, mirroring guest_event / can_check_in: it
-- is called from an RLS policy, so it must resolve the event + venue regardless
-- of the caller's row visibility. A missing event yields NULL -> the policy reads
-- it as "not allowed" (deny is the safe direction).

create or replace function public.event_allows_uncheck(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(e.allow_uncheck, v.allow_uncheck, true)
  from public.events e
  join public.venues v on v.id = e.venue_id
  where e.id = p_event_id;
$$;

revoke execute on function public.event_allows_uncheck(uuid) from public, anon;
grant execute on function public.event_allows_uncheck(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — reject the void transition when uncheck is disabled
-- ---------------------------------------------------------------------------
-- A void is an UPDATE that sets voided_at (null -> not null). The existing
-- permissive update policies (check_ins_update_own_device / _door) decide WHO may
-- update; this RESTRICTIVE policy is AND-ed on top and constrains the resulting
-- row: any update that leaves the row voided must be allowed by the effective
-- setting. Re-checkin (revive: voided_at -> null) and partial top-ups (voided_at
-- stays null) always pass, so disabling uncheck blocks ONLY the reversal. INSERT
-- (the original check-in) is untouched — it is governed by check_ins_insert.

create policy check_ins_void_requires_uncheck on public.check_ins
  as restrictive
  for update to authenticated
  using (true)
  with check (
    voided_at is null
    or public.event_allows_uncheck(public.guest_event(guest_id))
  );

-- ---------------------------------------------------------------------------
-- Audit — widen events coverage + add venues; relabel the events action
-- ---------------------------------------------------------------------------
-- The generic audit_trigger() hard-coded events -> lock/unlock (it only ever ran
-- for the list_locked trigger). Widen it: derive lock/unlock only when list_locked
-- actually flipped, otherwise a plain 'update' (carries the JSONB diff, e.g.
-- allow_uncheck). Add a venues scope branch (a venues row's own id IS the venue
-- id — there is no venue_id column, so the generic `else` would log NULL scope and
-- the row would never surface in the venue-scoped audit feed).

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
    when 'venues' then
      -- A venues row's own id is the venue id (no venue_id column).
      v_venue_id := v_entity_id;
    else -- quotas, venue_memberships: venue-scoped rows
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

-- Events: keep the fase-3 audit_events_lock trigger (lock/unlock) untouched and
-- add a sibling that fires on allow_uncheck. Leaving audit_events_lock in place
-- avoids churning the existing trigger; the widened audit_trigger() labels each
-- correctly (lock/unlock when list_locked flips, else a plain 'update'). The only
-- double-log case is a simultaneous list_locked + allow_uncheck change — which the
-- UI never does (separate controls) and which would harmlessly record both.
create trigger audit_events_allow_uncheck
  after update on public.events
  for each row
  when (old.allow_uncheck is distinct from new.allow_uncheck)
  execute function public.audit_trigger();

-- Venues: previously unaudited. Scope this trigger to the fraud-relevant toggle
-- only (the rest of venue settings stays out of the audit log, as before).
create trigger audit_venues_allow_uncheck
  after update on public.venues
  for each row
  when (old.allow_uncheck is distinct from new.allow_uncheck)
  execute function public.audit_trigger();
