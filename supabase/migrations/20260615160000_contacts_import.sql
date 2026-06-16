-- Sessie C — Adresboek-import (#10): idempotent bulk upsert with dedupe.
--
-- The Import screen (paste / CSV / phone-contacts) commits through this one RPC.
-- It is idempotent (re-importing the same file changes nothing) and dedupes on
-- e-mail then phone, using the SAME normalisation as the contacts generated
-- columns and submit_guest_request — so import, request-capture and the unique
-- indexes all agree on what "the same contact" is.
--
-- Merge policy: fill blanks only, NEVER overwrite existing data (a re-import must
-- not wipe a known e-mail/phone with a sparser row). full_name is kept as-is.
-- Returns {inserted, updated, skipped} for the toast. SECURITY DEFINER, self-
-- guarded to admin/organizer (mirrors the contacts_insert RLS it writes past).
-- Per-row exception handling: a unique-collision on one row is counted as
-- skipped, never aborts the whole batch.

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

  -- Self-guard: only an admin or organizer of this venue may import (the RLS
  -- this DEFINER function writes past).
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
      -- Same normalisation as the contacts generated columns + submit_guest_request.
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

      -- Dedup lookup: e-mail first, else phone digits. Name-only rows have no
      -- key → always inserted (two distinct people may share a name).
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
        -- Merge: fill blanks only.
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
      else
        insert into public.contacts
          (venue_id, full_name, email, phone, birthdate, preferred_role, source, created_by)
        values
          (p_venue_id, v_name, v_email_raw, v_phone_raw, v_birth, v_role, 'import', (select auth.uid()));
        v_inserted := v_inserted + 1;
      end if;
    exception
      when unique_violation then
        -- A concurrent insert or an in-batch e-mail/phone collision on update:
        -- count as skipped rather than aborting the whole import.
        v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.upsert_contacts(uuid, jsonb) from public, anon;
grant execute on function public.upsert_contacts(uuid, jsonb) to authenticated, service_role;
