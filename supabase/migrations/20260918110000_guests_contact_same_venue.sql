-- K5 (ADE UX round, ClickUp z8uq9m0g0j) — guests.contact_id must point at a
-- contact of the guest's OWN venue, and never at an anonymized one.
--
-- WHY NOW. Item K of docs/plan-ade-ux-round-2026-09-17.md lets the app send a
-- contact_id along with a name-only quick-add / paste-a-list row ("same as
-- contact X?"). The app-layer half of that (S3/K4) verifies the id through
-- search_contacts_for_reuse() before inserting — but an app-layer check is
-- convenience, not security (CLAUDE.md #1). Until now NOTHING in the database
-- constrained guests.contact_id:
--
--   * the FK is a bare single-column reference to contacts(id) — it says the
--     contact exists, nothing about WHOSE it is;
--   * every legitimate writer happens to be safe (add_contact_to_event /
--     add_contacts_to_event compare v_contact.venue_id <> v_venue explicitly;
--     guests_autolink_contact, promote_guest_to_contact, mark_guest_regular and
--     sync_permanent_guests_into_event only ever SELECT contacts filtered by
--     `venue_id = <the event's venue> and anonymized_at is null`) — but that is
--     a property of five function bodies, not of the table;
--   * guests_insert / guests_update (20260613120000, 20260623140200) say nothing
--     about contact_id at all, and `authenticated` holds a plain table-level
--     INSERT/UPDATE grant on public.guests.
--
-- So a staff member with the anon key and raw PostgREST access could, today,
-- POST /rest/v1/guests for an event they legitimately write to while carrying a
-- contact_id belonging to ANOTHER venue. That row then joins the foreign
-- contact into this venue's reads: the person profile (fetchContactProfile /
-- guestsForContact, src/features/po/queries.ts) resolves a guest's contact_id
-- and shows the contact's history, and search_contacts_for_reuse()'s
-- `count(distinct g.event_id)` — a SECURITY DEFINER projection over ALL guests
-- rows regardless of venue — would start counting another tenant's events into
-- that contact's "X times on a list" number. Same shape as the forged
-- request_link_id hole closed by 20260810100000, one column over.
--
-- This migration makes the database the boundary it is supposed to be: the
-- contact must exist, belong to the guest's venue, and not be anonymized.
--
-- ---------------------------------------------------------------------------
-- DESIGN NOTES — the four things a reviewer should check
-- ---------------------------------------------------------------------------
--
-- 1. THE VENUE AUTHORITY IS THE ROW'S EVENT, NOT new.venue_id.
--    guests.venue_id is server-derived — but by public.set_event_scope(), which
--    runs from the `guests_set_scope` BEFORE trigger (20260708120000, made an
--    unconditional overwrite by 20260713160000). BEFORE row triggers fire in
--    ALPHABETICAL order of trigger name, and `guests_contact_same_venue` sorts
--    BEFORE `guests_set_scope`. At the moment this guard runs, new.venue_id is
--    therefore still whatever the client sent. Trusting it would hand the
--    attacker the bypass on a plate: forge venue_id = <the foreign contact's
--    venue>, pass this check, and let set_event_scope quietly rewrite venue_id
--    back to the real one afterwards — a cross-tenant link that looks clean.
--    So we resolve the venue the same way set_event_scope does, from the row's
--    event: public.event_venue(new.event_id). The two are equal by construction
--    once all BEFORE triggers have run, which makes this guard independent of
--    trigger ordering rather than quietly dependent on it.
--
-- 2. SECURITY DEFINER IS REQUIRED, AND IS NOT A WIDENING.
--    contacts_select (20260615130000) is admin/finance/organizer only — staff
--    and doorhost cannot read public.contacts at all. A SECURITY INVOKER guard
--    would see zero rows for a perfectly legitimate staff quick-add carrying a
--    contact_id and reject it, i.e. it would break the very feature it guards.
--    This is exactly why guests_autolink_contact is DEFINER too. The function
--    reads two rows, compares them and returns; it discloses nothing (see 4)
--    and writes nothing.
--
-- 3. TWO TRIGGERS WITH `when` CLAUSES, NOT ONE `update of contact_id`.
--    The plan said "BEFORE INSERT OR UPDATE OF contact_id". `update of <col>`
--    keys on the columns NAMED IN THE STATEMENT, not on the value that actually
--    changed, which gets it wrong in both directions:
--      a) MISSES a real change — guests_autolink_contact fires on
--         `before insert or update of email, phone` and ASSIGNS new.contact_id
--         during an `update guests set email = …`. That statement names no
--         contact_id, so an `update of contact_id` guard would never see the
--         link it just created. (Safe today — autolink only ever picks a
--         same-venue, non-anonymized contact — but a guard that depends on
--         another trigger staying correct is not a boundary.)
--      b) FIRES ON A NON-CHANGE — any UPDATE that merely mentions contact_id
--         would re-validate an existing link. That matters because the AVG
--         paths (run_privacy_retention step 6, forget_contact step 5) anonymize
--         a CONTACT and deliberately keep the guest rows linked to it. Under a
--         value-blind guard those historical guests would become unwritable:
--         a door check-in failing because the guest once exercised their right
--         to be forgotten. Expand–contract says a new constraint must not break
--         rows the deployed app already wrote, so only a CHANGE is validated.
--    Hence: one function, two triggers, each with a `when` clause — and the
--    UPDATE variant can reference OLD, which a combined INSERT-OR-UPDATE
--    trigger's `when` clause may not ("INSERT trigger's WHEN condition cannot
--    reference OLD values"). Both names sort after
--    `autolink_contact_before_ins_upd`, so whatever autolink assigns is
--    validated in the same statement.
--    Not `create constraint trigger`: those must be AFTER and exist to be
--    deferrable, neither of which we want — this rejects the row before the
--    audit trigger (#4) records it, exactly like every other guard on this
--    table.
--
-- 4. ONE MESSAGE FOR ALL THREE FAILURES — no existence oracle.
--    "doesn't exist", "belongs to another venue" and "anonymized" are
--    indistinguishable to the caller, so this path cannot be used to probe
--    another venue's contact ids. Generic errcode 23514 (check_violation) with
--    no hint and no ids, matching enforce_request_link_max's cross-venue
--    rejection (20260810100000). Raised BEFORE the FK gets to speak, so a
--    random uuid fails the same way a foreign one does.
--
-- NO EXEMPTION FOR NON-CLIENT ROLES. guard_guest_added_by_change
-- (20260819100000) skips `current_user not in ('authenticated','anon')` because
-- legitimate DEFINER paths must be able to do what clients may not. There is no
-- such path here: every SECURITY DEFINER writer of contact_id already filters on
-- venue + anonymized_at (listed above), and supabase/seed.sql's one explicit
-- `update guests set contact_id = c0..03` is same-venue and live. So the guard
-- holds for every writer — RPCs, seed, fixtures and superuser included — and a
-- future RPC that gets this wrong fails loudly instead of writing a cross-tenant
-- row.
--
-- GRANT MATRIX: this migration creates no table and no view, so there is no
-- table grant matrix to state. It creates one function, which by default would
-- carry EXECUTE for PUBLIC; the revoke below closes that. Nothing is granted
-- back: it is reachable only as a trigger, and a trigger function's EXECUTE
-- privilege is checked when the trigger is CREATED, never when it fires (same
-- posture as record_permanent_exclusion / enforce_request_link_max).
--
-- NO TYPE REGEN: no column is added, dropped or renamed, so
-- src/lib/database.types.ts is unchanged.

create or replace function public.guests_contact_same_venue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue   uuid;
  v_contact public.contacts;
begin
  -- Unlinked guest: nothing to validate. This is the common case (name-only
  -- quick-add, and every guest autolink decided not to link) and the `when`
  -- clauses below already filter it out — kept so the function is correct on
  -- its own, independent of how it is wired.
  if new.contact_id is null then
    return new;
  end if;

  -- See design note 1: the event, never new.venue_id.
  v_venue := public.event_venue(new.event_id);

  select c.* into v_contact from public.contacts c where c.id = new.contact_id;

  -- v_venue is null only when event_id points at no event — the FK will reject
  -- that at end of statement anyway; `is distinct from` makes it fail here
  -- instead of silently passing a null comparison.
  if v_venue is null
     or v_contact.id is null
     or v_contact.venue_id is distinct from v_venue
     or v_contact.anonymized_at is not null then
    raise exception using errcode = '23514',
      message = 'Contact not found in this venue.';
  end if;

  return new;
end;
$$;

comment on function public.guests_contact_same_venue() is
  'Tenant guard for guests.contact_id (#1): the linked contact must exist, belong to the venue of the guest''s own event (resolved via event_venue, never the client-supplied guests.venue_id) and not be anonymized. SECURITY DEFINER because staff/doorhost cannot SELECT contacts under RLS. Fails generic 23514 for all three cases so it cannot be used to probe another venue''s contact ids.';

-- Internal trigger function only — never callable as an RPC.
revoke execute on function public.guests_contact_same_venue()
  from public, anon, authenticated, service_role;

-- Only a CHANGE to a non-null contact_id is validated (design note 3).
drop trigger if exists guests_contact_same_venue on public.guests;
create trigger guests_contact_same_venue
  before insert on public.guests
  for each row
  when (new.contact_id is not null)
  execute function public.guests_contact_same_venue();

drop trigger if exists guests_contact_same_venue_update on public.guests;
create trigger guests_contact_same_venue_update
  before update on public.guests
  for each row
  when (new.contact_id is not null and new.contact_id is distinct from old.contact_id)
  execute function public.guests_contact_same_venue();
