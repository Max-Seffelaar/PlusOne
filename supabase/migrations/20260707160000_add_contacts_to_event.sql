-- Feedback 1/7 T12 follow-up (#3): after importing contacts, add the whole batch
-- to an event in one step — "which event do you want to add these people to?".
--
-- Two changes:
--   1) upsert_contacts now also returns `ids` — every contact touched by the
--      import (inserted, updated, or already-present), so the app can offer to
--      add exactly those people to an event (name-only rows have no dedup key,
--      so the app can't re-derive them client-side — the RPC must hand them back).
--   2) add_contacts_to_event(event, ids[], tier?) — the bulk sibling of
--      add_contact_to_event: resolves the tier per contact (or takes an override,
--      which is the "which tier?" question the UI asks), inserts each as an
--      idempotent guest, and returns {added, already, skipped}.
--
-- Both are SECURITY DEFINER and self-guard admin/organizer + list-lock, exactly
-- like the single add_contact_to_event. No new table, no RLS change.

-- 1) upsert_contacts: identical body + capture every touched id in the return ---
create or replace function public.upsert_contacts(p_venue_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  int := 0;
  v_ids      uuid[] := '{}';
  v_ins_id   uuid;
  elem        jsonb;
  v_name      text;
  v_email_raw text;
  v_phone_raw text;
  v_email_norm text;
  v_phone_dig text;
  v_birth     date;
  v_role      public.contact_role;
  v_existing  public.contacts;
  v_new_email text;
  v_new_phone text;
  v_new_birth date;
  v_new_role  public.contact_role;
begin
  if p_venue_id is null then
    raise exception using errcode = 'P0002', message = 'Locatie niet gevonden.';
  end if;

  -- Self-guard: only an admin or organizer of this venue may import.
  if not (
       public.has_venue_role(p_venue_id, '{admin}'::public.venue_role[])
       or public.organizes_event_at_venue(p_venue_id)
     ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator mag contacten importeren.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'Ongeldige import-data.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception using errcode = '22023', message = 'Te veel rijen in één import (max 2000).';
  end if;

  for elem in select * from jsonb_array_elements(p_rows)
  loop
    begin
      v_name := nullif(btrim(elem ->> 'full_name'), '');
      if v_name is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_email_raw := nullif(btrim(elem ->> 'email'), '');
      v_phone_raw := nullif(btrim(elem ->> 'phone'), '');
      v_email_norm := nullif(lower(coalesce(v_email_raw, '')), '');
      v_phone_dig := nullif(regexp_replace(coalesce(v_phone_raw, ''), '[^0-9]', '', 'g'), '');
      v_birth := case
        when (elem ->> 'birthdate') ~ '^\d{4}-\d{2}-\d{2}$' then (elem ->> 'birthdate')::date
        else null
      end;
      v_role := case
        when (elem ->> 'preferred_role') in ('vip', 'all_access', 'artist', 'press', 'crew', 'guest')
          then (elem ->> 'preferred_role')::public.contact_role
        else null
      end;

      v_existing := null;
      if v_email_norm is not null then
        select * into v_existing from public.contacts
         where venue_id = p_venue_id and anonymized_at is null and email_norm = v_email_norm
         limit 1;
      end if;
      if v_existing.id is null and v_phone_dig is not null then
        select * into v_existing from public.contacts
         where venue_id = p_venue_id and anonymized_at is null and phone_norm = v_phone_dig
         limit 1;
      end if;

      if v_existing.id is not null then
        v_new_email := coalesce(v_existing.email, v_email_raw);
        v_new_phone := coalesce(v_existing.phone, v_phone_raw);
        v_new_birth := coalesce(v_existing.birthdate, v_birth);
        v_new_role := coalesce(v_existing.preferred_role, v_role);

        if v_new_email is distinct from v_existing.email
           or v_new_phone is distinct from v_existing.phone
           or v_new_birth is distinct from v_existing.birthdate
           or v_new_role is distinct from v_existing.preferred_role then
          update public.contacts
             set email = v_new_email,
                 phone = v_new_phone,
                 birthdate = v_new_birth,
                 preferred_role = v_new_role
           where id = v_existing.id;
          v_updated := v_updated + 1;
        else
          v_skipped := v_skipped + 1;  -- already present, nothing to add
        end if;
        v_ids := v_ids || v_existing.id;  -- touched either way → addable to an event
      else
        insert into public.contacts
          (venue_id, full_name, email, phone, birthdate, preferred_role, source, created_by)
        values
          (p_venue_id, v_name, v_email_raw, v_phone_raw, v_birth, v_role, 'import', (select auth.uid()))
        returning id into v_ins_id;
        v_ids := v_ids || v_ins_id;
        v_inserted := v_inserted + 1;
      end if;
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'ids', to_jsonb(v_ids)
  );
end;
$$;

revoke execute on function public.upsert_contacts(uuid, jsonb) from public, anon;
grant execute on function public.upsert_contacts(uuid, jsonb) to authenticated, service_role;

-- 2) add_contacts_to_event — bulk add a set of contacts to one event ------------
-- Mirrors add_contact_to_event per contact: resolves the tier (explicit override
-- or the contact's preferred_role → this event's tier), clears a prior "respect
-- the removal" exclusion, and inserts an idempotent 'approved' guest. The quota
-- trigger charges 1 slot per contact (no plus-ones on a bulk import add).
-- Returns {added, already, skipped}: added = new guest inserted, already = the
-- contact was already a live guest, skipped = not found / no tier resolvable.
create or replace function public.add_contacts_to_event(
  p_event_id uuid,
  p_contact_ids uuid[],
  p_tier_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid := public.event_venue(p_event_id);
  v_added int := 0;
  v_already int := 0;
  v_skipped int := 0;
  v_cid uuid;
  v_contact public.contacts;
  v_tier uuid;
  v_guest_id uuid;
begin
  if v_venue is null then
    raise exception using errcode = 'P0002', message = 'Event niet gevonden.';
  end if;

  -- List must accept writes (not locked/closed).
  if not public.can_write_guests(p_event_id) then
    raise exception using errcode = '42501',
      message = 'Je mag geen gasten toevoegen aan dit event.';
  end if;

  -- Contacts are admin/organizer/finance territory (contacts_select RLS) and this
  -- is the post-import "add these people" step — so, unlike the single
  -- add_contact_to_event, restrict the BULK add to an admin of the venue or an
  -- organizer of THIS event. Staff/doorhost can't browse contacts, so they have
  -- no business mass-adding them.
  if not (
       public.has_venue_role(v_venue, '{admin}'::public.venue_role[])
       or public.is_event_organizer(p_event_id)
     ) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin of organisator mag contacten toevoegen.';
  end if;

  -- Validate an explicit tier override belongs to this event.
  if p_tier_id is not null and not exists (
       select 1 from public.guest_tiers gt where gt.id = p_tier_id and gt.event_id = p_event_id
     ) then
    raise exception using errcode = 'P0002', message = 'Tier hoort niet bij dit event.';
  end if;

  foreach v_cid in array coalesce(p_contact_ids, '{}'::uuid[])
  loop
    select * into v_contact from public.contacts where id = v_cid;
    if v_contact.id is null or v_contact.venue_id <> v_venue or v_contact.anonymized_at is not null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_tier := coalesce(p_tier_id, public.resolve_tier_for_contact(p_event_id, v_contact.preferred_role));
    if v_tier is null then
      v_skipped := v_skipped + 1;  -- event has no tiers to place them in
      continue;
    end if;

    -- Deliberate add overrides a prior removal-exclusion.
    delete from public.contact_event_exclusions
     where event_id = p_event_id and contact_id = v_cid;

    insert into public.guests
      (event_id, tier_id, full_name, email, phone, plus_ones, contact_id, added_by, source, status)
    values
      (p_event_id, v_tier, v_contact.full_name, v_contact.email, v_contact.phone,
       0, v_contact.id, (select auth.uid()), 'app', 'approved')
    on conflict (event_id, contact_id) where contact_id is not null and status <> 'removed'
      do nothing
    returning id into v_guest_id;

    if v_guest_id is null then
      v_already := v_already + 1;  -- already a live guest on this event
    else
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'already', v_already, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.add_contacts_to_event(uuid, uuid[], uuid) from public, anon;
grant execute on function public.add_contacts_to_event(uuid, uuid[], uuid) to authenticated, service_role;
