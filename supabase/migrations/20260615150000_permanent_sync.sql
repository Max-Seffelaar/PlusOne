-- Sessie C — Permanente gasten: sync, tier-mapping & "respect the removal" (#11).
--
-- Pieces:
--   * contact_event_exclusions — remembers a MANUAL removal of an auto-added
--     permanent guest so a later re-sync does NOT re-add them (decision this
--     session: "respect the removal"). Written by a trigger on guests; cleared
--     by a deliberate manual re-add.
--   * resolve_tier_for_contact() — maps a contact's preferred_role to a tier of
--     THIS event (by name/alias), falling back to the event's default tier.
--   * sync_permanent_guests_into_event() — idempotent: inserts the venue's
--     permanent contacts as source='permanent' guests, skipping exclusions and
--     contacts already on the list. Re-runnable. Self-guards admin/organizer +
--     list-lock.
--   * add_contact_to_event() — deliberate manual add from the address book;
--     clears any exclusion, resolves (or takes) a tier, inserts source='app'.
--
-- Why a sync RPC and not an events-insert trigger: a new event has NO tiers at
-- insert time, so resolve_tier_for_contact would return null and place nobody.
-- The correct precondition is "tiers exist", so the app calls this after tiers
-- are saved, plus a manual re-sync button.

-- ---------------------------------------------------------------------------
-- Exclusions table
-- ---------------------------------------------------------------------------

create table public.contact_event_exclusions (
  event_id uuid not null references public.events (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  excluded_at timestamptz not null default now(),
  excluded_by uuid references public.user_profiles (id) on delete set null,
  primary key (event_id, contact_id)
);

alter table public.contact_event_exclusions enable row level security;

-- Read-only for managers/organizers (to surface "uitgesloten van dit event" in
-- a later UI). All writes go through the trigger + RPCs below (SECURITY DEFINER),
-- so no direct INSERT/UPDATE/DELETE grant to app roles.
revoke all on table public.contact_event_exclusions from anon, authenticated, service_role;
grant select on table public.contact_event_exclusions to authenticated, service_role;

create policy contact_event_exclusions_select on public.contact_event_exclusions
  for select to authenticated
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    or public.is_event_organizer(event_id)
  );

-- ---------------------------------------------------------------------------
-- Exclusion trigger — record a manual removal of a permanent guest
-- ---------------------------------------------------------------------------
-- Fires only when a guest flips INTO 'removed'. The WHEN clause keeps it off the
-- hot path for every other guest write. SECURITY DEFINER so it can write the
-- exclusions table (which has no app-role DML grant).

create or replace function public.record_permanent_exclusion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'permanent' and new.contact_id is not null then
    insert into public.contact_event_exclusions (event_id, contact_id, excluded_by)
    values (new.event_id, new.contact_id, (select auth.uid()))
    on conflict (event_id, contact_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger record_permanent_exclusion
  after update on public.guests
  for each row
  when (new.status = 'removed' and old.status is distinct from 'removed')
  execute function public.record_permanent_exclusion();

revoke execute on function public.record_permanent_exclusion() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tier mapping — contact preferred_role -> a tier of this event
-- ---------------------------------------------------------------------------
-- 1) match by tier name or alias (case-insensitive; 'all_access' -> 'all access');
-- 2) else the event's default tier (named 'Regular', else first by created_at);
-- 3) else null -> caller skips (no tier to place a guest in yet).

create or replace function public.resolve_tier_for_contact(p_event_id uuid, p_role public.contact_role)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select gt.id
      from public.guest_tiers gt
      where gt.event_id = p_event_id
        and p_role is not null
        and (
          lower(gt.name) = p_role::text
          or lower(gt.name) = replace(p_role::text, '_', ' ')
          or exists (
            select 1 from unnest(gt.aliases) a
            where lower(btrim(a)) = p_role::text
               or lower(btrim(a)) = replace(p_role::text, '_', ' ')
          )
        )
      order by gt.created_at
      limit 1
    ),
    (
      select gt.id from public.guest_tiers gt
      where gt.event_id = p_event_id and lower(gt.name) = 'regular'
      order by gt.created_at limit 1
    ),
    (
      select gt.id from public.guest_tiers gt
      where gt.event_id = p_event_id
      order by gt.created_at limit 1
    )
  );
$$;

revoke execute on function public.resolve_tier_for_contact(uuid, public.contact_role) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sync_permanent_guests_into_event — idempotent house-guest sync
-- ---------------------------------------------------------------------------

create or replace function public.sync_permanent_guests_into_event(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid := public.event_venue(p_event_id);
  v_actor uuid := (select auth.uid());
  v_added int := 0;
  v_tier uuid;
  c record;
begin
  if v_venue is null then
    raise exception using errcode = 'P0002', message = 'Event niet gevonden.';
  end if;

  -- Only an admin of the venue or an organizer of the event may sync, and only
  -- while the list accepts writes (#23 list-lock / closed honoured).
  if not (
       public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
       or public.is_event_organizer(p_event_id)
     ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator mag permanente gasten synchroniseren.';
  end if;
  if not public.can_write_guests(p_event_id) then
    raise exception using errcode = '42501',
      message = 'De gastenlijst is vergrendeld of gesloten.';
  end if;

  for c in
    select * from public.contacts
    where venue_id = v_venue and is_permanent and anonymized_at is null
  loop
    -- Respect a manual removal (decision: exclusions block re-add).
    if exists (
      select 1 from public.contact_event_exclusions x
      where x.event_id = p_event_id and x.contact_id = c.id
    ) then
      continue;
    end if;

    v_tier := public.resolve_tier_for_contact(p_event_id, c.preferred_role);
    if v_tier is null then
      continue;  -- event has no tiers yet → nothing to place them in
    end if;

    insert into public.guests
      (event_id, tier_id, full_name, email, phone, contact_id, added_by, source, status)
    values
      (p_event_id, v_tier, c.full_name, c.email, c.phone, c.id, v_actor, 'permanent', 'approved')
    on conflict (event_id, contact_id) where contact_id is not null and status <> 'removed'
      do nothing;

    if found then
      v_added := v_added + 1;
    end if;
  end loop;

  return v_added;
end;
$$;

revoke execute on function public.sync_permanent_guests_into_event(uuid) from public, anon;
grant execute on function public.sync_permanent_guests_into_event(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- add_contact_to_event — deliberate manual add from the address book
-- ---------------------------------------------------------------------------
-- Used by the Adresboek "+" button. Clears any "respect the removal" exclusion
-- (a deliberate re-add is intent to include), resolves the tier (or takes an
-- explicit one), and inserts a normal source='app' guest (so it counts personal
-- quota for staff, exempt for admin/organizer — the quota trigger decides).
-- SECURITY DEFINER: replicates the guests_insert RLS guard (can_write_guests +
-- forced added_by) since it writes past RLS.

create or replace function public.add_contact_to_event(
  p_contact_id uuid,
  p_event_id uuid,
  p_tier_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid := public.event_venue(p_event_id);
  v_contact public.contacts;
  v_tier uuid;
  v_guest_id uuid;
begin
  if v_venue is null then
    raise exception using errcode = 'P0002', message = 'Event niet gevonden.';
  end if;

  select * into v_contact from public.contacts where id = p_contact_id;
  if v_contact.id is null or v_contact.venue_id <> v_venue or v_contact.anonymized_at is not null then
    raise exception using errcode = 'P0002', message = 'Contact niet gevonden in deze locatie.';
  end if;

  if not public.can_write_guests(p_event_id) then
    raise exception using errcode = '42501',
      message = 'Je mag geen gasten toevoegen aan dit event.';
  end if;

  -- A deliberate manual add overrides a prior "respect the removal" exclusion.
  delete from public.contact_event_exclusions
   where event_id = p_event_id and contact_id = p_contact_id;

  v_tier := coalesce(p_tier_id, public.resolve_tier_for_contact(p_event_id, v_contact.preferred_role));
  if v_tier is null then
    raise exception using errcode = 'P0002', message = 'Geen tier beschikbaar voor dit event.';
  end if;

  insert into public.guests
    (event_id, tier_id, full_name, email, phone, contact_id, added_by, source, status)
  values
    (p_event_id, v_tier, v_contact.full_name, v_contact.email, v_contact.phone,
     v_contact.id, (select auth.uid()), 'app', 'approved')
  on conflict (event_id, contact_id) where contact_id is not null and status <> 'removed'
    do nothing
  returning id into v_guest_id;

  -- Already on the list (idempotent): return the existing live guest id.
  if v_guest_id is null then
    select id into v_guest_id from public.guests
     where event_id = p_event_id and contact_id = p_contact_id and status <> 'removed'
     limit 1;
  end if;

  return v_guest_id;
end;
$$;

revoke execute on function public.add_contact_to_event(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_contact_to_event(uuid, uuid, uuid) to authenticated, service_role;
