-- S2.1 — Auto-contact (part 1/2): a new contact_source for contacts that the
-- address book grows automatically when a guest is added to an event gastenlijst
-- (quick-add #33, bulk-paste, landing-approve). Distinct from 'manual' (a
-- deliberate address-book entry), 'import' (the bulk RPC) and 'guest_request'
-- (the public landing form), so the audit/provenance stays legible.
--
-- This MUST be its own migration: Postgres forbids using a freshly ADDed enum
-- value in the same transaction that added it, and 20260622130100 references
-- 'guest_list' in the auto-link trigger function. Splitting the ALTER TYPE into
-- this file commits the value before that function is created.

alter type public.contact_source add value if not exists 'guest_list';
