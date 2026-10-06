-- z8uq9m2x43 — forgotten contacts are read-only (B1 follow-up, #29).
--
-- Max, 2026-10-06, after the B1 test pass: "When a user is forgotten we should
-- not add them to an event. Because we do not know who they are and edit is
-- also bullshit."
--
-- WHAT WAS ALREADY TRUE (verified against origin/main, no change needed):
--   * contacts_update RLS (20260615130000) has `anonymized_at is null` in both
--     USING and WITH CHECK — a raw PostgREST PATCH on an anonymized contact
--     already updates 0 rows, and an app role can never SET anonymized_at.
--   * Every contact → guest path refuses an anonymized contact:
--       - add_contact_to_event / add_contacts_to_event: explicit
--         `v_contact.anonymized_at is not null` check (single = P0002 refuse,
--         bulk = counted in `skipped`, the rest of the batch goes on);
--       - sync_permanent_guests_into_event / guests_autolink_contact /
--         promote_guest_to_contact / mark_guest_regular / upsert_contacts /
--         submit_guest_request: only ever SELECT contacts with
--         `anonymized_at is null`;
--       - the table-level backstop: guests_contact_same_venue (20260918110000)
--         rejects (generic 23514) any INSERT, contact_id change or event move
--         that links a guest to an anonymized contact — so a raw POST
--         /rest/v1/guests carrying a forgotten contact's id is refused too.
--
-- WHAT WAS NOT: the freeze lived only in RLS. The SECURITY DEFINER writers
-- (upsert_contacts, submit_guest_request's address-book capture,
-- mark_guest_regular, …) bypass RLS, so "frozen" was a property of each of
-- their bodies filtering `anonymized_at is null`, not of the table — the gap
-- 20260918110000 closed for guests.contact_id, one table over. And an app role
-- could INSERT a contact that is born anonymized (contacts_insert says nothing
-- about anonymized_at): a row that keeps whatever PII it was given forever,
-- because both the retention sweep and forget_contact skip anonymized rows.
--
-- THIS MIGRATION — one BEFORE INSERT OR UPDATE guard on public.contacts,
-- mirroring guard_platform_invite_update from B1 (20261006120000):
--   1. An anonymized row is frozen for EVERY role, SECURITY DEFINER bodies
--      included. Safe for the two legitimate anonymizers: run_privacy_retention
--      step 6 selects `where r.anonymized_at is null` and forget_contact step 5
--      runs only `if v_already is null` — neither ever revisits an anonymized
--      contact. (guests.contact_id is ON DELETE SET NULL, but contacts has no
--      DELETE grant for any role; created_by is ON DELETE RESTRICT — so no FK
--      action ever UPDATEs a contact behind our back.)
--   2. The anonymize transition (anonymized_at null → set) is the owner's job
--      only — current_user is the function owner inside the SECURITY DEFINER
--      retention/forget routines; every API request runs as anon /
--      authenticated / service_role — and it must null every PII column
--      (email, phone, birthdate, note) without touching identity columns.
--   3. An INSERT from an API role may not carry anonymized_at.
--
-- Errors are generic 42501, like the platform_invites guard. No RPC signature
-- changes; database.types.ts is unaffected.
--
-- Known, accepted race: a SECURITY DEFINER writer that read a contact as live
-- and then UPDATEs it after a concurrent forget committed (READ COMMITTED
-- re-reads the row, but its `where id = …` has no anonymized_at predicate) now
-- fails with 42501 instead of writing PII back into a forgotten row. That is
-- the point: a landing submission colliding with the erasure of the same person
-- in the same instant errors once rather than resurrecting their e-mail.

create or replace function public.guard_contact_anonymized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.anonymized_at is not null
       and current_user in ('authenticated', 'anon', 'service_role') then
      raise exception 'contacts are anonymized by the retention job or forget_contact only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.anonymized_at is not null then
    raise exception 'a forgotten contact cannot be changed'
      using errcode = '42501';
  end if;

  if new.anonymized_at is not null then
    if current_user in ('authenticated', 'anon', 'service_role')
       or new.email is not null
       or new.phone is not null
       or new.birthdate is not null
       or new.note is not null
       or new.id is distinct from old.id
       or new.venue_id is distinct from old.venue_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'contacts are anonymized by the retention job or forget_contact only'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_contact_anonymized() is
  'BEFORE INSERT/UPDATE guard on contacts (z8uq9m2x43, #29): an anonymized '
  '(forgotten) contact is frozen for every role, SECURITY DEFINER bodies '
  'included; the anonymize transition (PII nulled, identity kept) is admitted '
  'only from the owner-run retention job / forget_contact; an API role cannot '
  'insert a contact that is born anonymized.';

-- Trigger function only — never callable as an RPC.
revoke execute on function public.guard_contact_anonymized()
  from public, anon, authenticated, service_role;

-- SECURITY INVOKER on purpose (current_user must be the real caller, as in
-- guard_platform_invite_update). The name sorts before set_updated_at, so a
-- refused write never even gets its updated_at bumped; either way it runs
-- before the audit_contacts AFTER trigger, so a refused write is never audited.
drop trigger if exists contacts_guard_anonymized on public.contacts;
create trigger contacts_guard_anonymized
  before insert or update on public.contacts
  for each row execute function public.guard_contact_anonymized();
