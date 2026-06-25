-- Promote a guest → contact on UPDATE (extends 20260622130100).
--
-- Today guests_autolink_contact() only fires BEFORE INSERT, so a name-only guest
-- that LATER gets an e-mail or phone added — the "Save as contact" action on the
-- new unified person profile — never reaches the venue address book. The function
-- already handles the update case correctly: it no-ops when contact_id is already
-- set, and otherwise dedups + creates + back-links from new.email / new.phone with
-- the same normalised keys as every other contact path. So we only need to widen
-- the trigger to also fire when the e-mail or phone changes.
--
-- Scoped to `of email, phone` so the common guest updates (plus_ones, status, note,
-- tier) never pay for the function — only a contact-detail edit can promote.
-- BEFORE (like the insert variant) so the audited row already carries contact_id
-- and the auto-contact shares the guest's transaction (no orphan on a later failure).

drop trigger if exists autolink_contact_before_insert on public.guests;

create trigger autolink_contact_before_ins_upd
  before insert or update of email, phone on public.guests
  for each row execute function public.guests_autolink_contact();
