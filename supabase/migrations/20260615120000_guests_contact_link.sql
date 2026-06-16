-- Sessie C — guests.contact_id: the keystone link between an event guest and a
-- venue address-book contact (#8/#10/#11).
--
-- One nullable FK delivers all three features:
--   * idempotent permanent auto-add — at most one LIVE guest per (event, contact);
--   * the "X× op een lijst" stat — count(distinct event_id) per contact;
--   * reuse-from-address-book — a guest added from a contact carries its id.
--
-- on delete set null (not cascade): contacts are soft-deleted/anonymised, never
-- hard-deleted, but if one ever were, guest history must survive with the link
-- nulled rather than the guest row vanishing.

alter table public.guests
  add column contact_id uuid references public.contacts (id) on delete set null;

create index guests_contact_id_idx on public.guests (contact_id);

-- At most one live guest per (event, contact). Partial on status <> 'removed' so
-- a soft-removed guest frees the slot (re-add is allowed), and on contact_id is
-- not null so manually-typed guests (no contact) never collide.
create unique index guests_event_contact_uidx
  on public.guests (event_id, contact_id)
  where contact_id is not null and status <> 'removed';
