# Plan — Gasten & adresboek (Sessie C+D)

> **Status (2026-06-16):** Sessie C — de hele **backend** voor #8/#10/#11 + AVG-retentie — is **gemerged op `main`** via PR [#18](https://github.com/Max-Seffelaar/PlusOne/pull/18) (squash `7330648`).
> Dit document is de **handoff voor Sessie D** (de UI-wiring). Herbruik het als startpunt: wat nog moet staat in **"UI wiring"**, **"Session D — deferred"** en **"Open items"**.
> ⚠️ Sessie D heeft een ontdekte randvoorwaarde: het `/app`-prototype is nog een pure client-mock zónder auth/live-data-laag — die fundering moet eerst gebouwd worden (zie "Session D — deferred").

---

## Context

Three ClickUp tasks from the 15 jun feedback-meeting all sit on one missing foundation — a venue-level **address book (`contacts`)** that the backend doesn't have yet:

- **#11 Permanente gasten** ([86exyp8mc](https://app.clickup.com/t/86exyp8mc)) — "Vaste" guests that auto-appear on every new event. UI exists (`Vaste()` in `src/components/po/screens/guests.tsx`), backend doesn't.
- **#10 CSV / telefooncontacten-import** ([86exyp8m2](https://app.clickup.com/t/86exyp8m2)) — the existing Import screen (`Import()` in `src/components/po/screens/settings.tsx`) is mock; put it on a real backend with idempotent upserts + dedupe on email/phone.
- **#8 Guest-request → adresboek-capture** ([86exyp8jd](https://app.clickup.com/t/86exyp8jd)) — the public request form should capture naam/e-mail/telefoon/**geboortedatum** into the address book so the venue can re-add people later + get stats. (Confirmation e-mail stays parked — outbound, spec #10.)

**Outcome:** a `contacts` table (the spine), permanent-guest auto-sync, idempotent import, and request-capture — all wired under the existing prototype screens (design source of truth; preserve the component API, don't rebuild). The keystone is a new `guests.contact_id` link that powers idempotent auto-add, the "X× op een lijst" stat, and address-book reuse.

## Status — Session C backend COMPLETE & MERGED (PR #18, 2026-06-16)

All backend for #11, #10, #8 + contacts AVG-retention landed and is green:
`supabase db reset` + `supabase test db` PASS, Vitest 205 pass, `pnpm lint` + `tsc` clean. CI green, squash-merged `7330648`.

- **9 migrations** `20260615100000`–`20260615180000`. NB: migration 3 (`contacts_rls`) and 4 (`guests_contact_link`) were **swapped** during build — the reuse-search RPC (a `language sql` function) references `guests.contact_id`, so the column must exist first. Final order: `…120000_guests_contact_link`, `…130000_contacts_rls`.
- **`src/features/contacts/`** — schemas, queries (incl. `getReuseContacts` RPC path), actions (`upsert/toggle/sync/addToEvent/import`), `import/parse.ts`.
- **`src/features/requests/`** — birthdate through schema/action/inbox + page.
- **Tests** — `contacts.rls`, `permanent`, `contacts.dedup`, `contacts.capture`, `contacts.privacy` pgTAP + `import/parse.test.ts` Vitest. (`landing.test`/`privacy.test` left untouched; capture/anonymization got their own focused files.)
- `database.types.ts` regenerated; `tables.test.sql` updated for the two new tables + new submit signature; door `contact_id` literals fixed.

**Session D (UI) — deferred, with a discovered prerequisite:** the `/app` prototype is a pure client-side mock (no auth, no Supabase, seeded from `@/lib/po/data`). The `src/features/po/` live-provider this plan originally assumed **does not exist**. So Session D must first BUILD that foundation (auth gate on `/app`, current-venue resolution, server-hydration into `PoProvider`, optimistic server-action plumbing) before wiring Contacten/Vaste/Import/counts/birthdate. Per user (2026-06-16), deferred to its own session.

## Decisions locked

**From the user:**
1. **Address book access** = *staff reuse, PII for managers*. The Contacten **reuse list** (name + role + event-count only — the current UI renders no PII) is available to staff/doorhost via a minimal SECURITY DEFINER RPC; **direct `contacts` reads (PII), editing, and the Import screen are admin/organizer only** (finance read).
2. **#10 phone-contacts** = *paste + CSV now, contacts best-effort*. Wire `Plak lijst` + `CSV` to real upserts; gate the `Contacten` chip behind a Contact-Picker capability check with a manual fallback; full native deferred to the Capacitor wrap (decision #37).
3. **Permanent re-add** = *respect the removal*. A manual removal of an auto-added permanent guest is remembered per-event (`contact_event_exclusions`); re-sync skips it; a deliberate manual re-add clears it.

**Engineering defaults:**
- Single `contacts` table with an `is_permanent` boolean (mirrors mock `Contact.vast`), not a separate permanent table — one PII surface to govern.
- Permanent guests are **house-exempt** from personal quota (new `guest_source = 'permanent'` contributes 0 in `guest_personal_contribution`) but still count tier-max. `added_by` = the admin/organizer who ran the sync.
- **Tier mapping** for auto-add: contact stores a `preferred_role`; resolve to a per-event tier by name/alias match, fall back to the event's default tier (named `Regular`, else first by `created_at`). No cross-event "tier kind".
- **#8 capture on submit** (value exists the moment someone asks); `approve_guest_request` back-fills `guests.contact_id`.

## Data model (as built)

```sql
alter type public.guest_source add value 'permanent';   -- own migration (PG forbids add+use in one txn)
create type public.contact_role   as enum ('vip','all_access','artist','press','crew','guest');
create type public.contact_source as enum ('manual','import','guest_request');

create table public.contacts (
  id            uuid primary key default public.uuid_generate_v7(),
  venue_id      uuid not null references public.venues (id) on delete restrict,
  full_name     text not null,
  email         text,
  phone         text,
  birthdate     date,                              -- #8
  preferred_role public.contact_role,              -- drives tier mapping
  note          text,
  is_permanent  boolean not null default false,    -- #11
  email_norm    text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone_norm    text generated always as (nullif(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '')) stored,
  source        public.contact_source not null default 'manual',
  anonymized_at timestamptz,
  created_by    uuid references public.user_profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- dedup: one live contact per (venue,email) and (venue,phone), normalised, ignoring anonymized
create unique index contacts_venue_email_uidx on public.contacts (venue_id, email_norm) where email_norm is not null and anonymized_at is null;
create unique index contacts_venue_phone_uidx on public.contacts (venue_id, phone_norm) where phone_norm is not null and anonymized_at is null;

alter table public.guests add column contact_id uuid references public.contacts (id) on delete set null;
create unique index guests_event_contact_uidx on public.guests (event_id, contact_id) where contact_id is not null and status <> 'removed';

create table public.contact_event_exclusions (
  event_id uuid not null references public.events (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  excluded_at timestamptz not null default now(),
  excluded_by uuid references public.user_profiles (id) on delete set null,
  primary key (event_id, contact_id)
);
```

**RPCs (all SECURITY DEFINER, self-guarded):** `search_contacts_for_reuse(venue, q)` (staff reuse, PII-free), `sync_permanent_guests_into_event(event)`, `add_contact_to_event(contact, event, tier?)`, `upsert_contacts(venue, jsonb)` (import), `resolve_tier_for_contact` (internal). `submit_guest_request`/`approve_guest_request` recreated for #8. `run_privacy_retention` + `redact_anonymized_contact_audit_pii` for AVG.

## Migrations (final order)

| File | Purpose | Task |
|------|---------|------|
| `20260615100000_guest_source_permanent.sql` | `'permanent'` enum value (own file). | #11 |
| `20260615110000_contacts_table.sql` | enums + `contacts` + norm cols + dedup indexes + triggers + grants + RLS on. | #11 |
| `20260615120000_guests_contact_link.sql` | `guests.contact_id` + partial unique index. | #11 |
| `20260615130000_contacts_rls.sql` | RLS policies + `search_contacts_for_reuse` RPC. | #11 |
| `20260615140000_quota_permanent_exempt.sql` | `guest_personal_contribution` + `enforce_guest_quota` exempt `permanent`. | #11 |
| `20260615150000_permanent_sync.sql` | exclusions table + trigger + `resolve_tier_for_contact` + `sync_…` + `add_contact_to_event`. | #11 |
| `20260615160000_contacts_import.sql` | `upsert_contacts` bulk RPC. | #10 |
| `20260615170000_guest_request_birthdate.sql` | birthdate + recreate submit/approve with capture/backfill. | #8 |
| `20260615180000_contacts_anonymization.sql` | contacts sweep in `run_privacy_retention` + audit redaction. | privacy |

## Backend code (built) — `src/features/contacts/` + `requests/`

- **`schemas.ts`** — `upsertContactSchema`, `togglePermanentSchema`, `importContactsSchema` (≤2000 rows), `syncPermanentSchema`, `addContactToEventSchema`, `contactRole`.
- **`queries.ts`** — `getContacts`, `getReuseContacts` (RPC), `getPermanentContacts`, `getContactCounts`.
- **`actions.ts`** — `upsertContact`, `toggleContactPermanent`, `importContacts`, `syncPermanentGuests`, `addContactToEvent`.
- **`import/parse.ts`** — `normalizeEmail`, `normalizePhoneToDigits` (match DB `[^0-9]`), `parseCsv`, `parsePastedList`, `dedupeWithin`, `mapRole`, `parseDate`.
- **`requests/`** — `birthdate` in `submitGuestRequestSchema` + action + `PendingGuestRequest` + inbox render + requests page select.

## UI wiring — Session D (NOT built yet; preserve the mock component API)

The prototype (`app.tsx` → `PoProvider`) seeds state from module-level mock arrays. To go live without changing screen signatures: move the `contacts` source + `vast`/`toggleVast` into context fed by a **server-hydrated wrapper** at `/app` (`src/app/app/page.tsx`), and make `toggleVast`/add/import real mutations (optimistic, rollback on `!ok`). Extend `po/types.ts` `Contact` with `id: string`.

- **`Contacten()`** (`guests.tsx:519`) — star → `toggleContactPermanent` (managers); `+` → `addContactToEvent`; `upload` IconBtn → `nav.push('import')` (hidden for staff); role-gate the star/upload affordances. Staff get the PII-free reuse list via `getReuseContacts`.
- **`Vaste()`** (`guests.tsx:563`) — live permanent list; close → `toggleContactPermanent(false)`; add a "Voeg toe aan dit event" / re-sync button → `syncPermanentGuests`.
- **`Import()`** (`settings.tsx:582`) — `Plak lijst` → `parsePastedList`, `CSV` → file input → `parseCsv`, live `BESTAAT AL`/`NIEUW` badges → `importContacts` (toast `{inserted, updated, skipped}`); `Contacten` chip capability-gated; `Vorig event` deferred.
- **Settings `Meer` counts** (`settings.tsx:56-57`) — from `getContactCounts`.
- **Landing birthdate (#8)** — optional `LField type="date"` "Geboortedatum (optioneel)" in `LandingForm`, bound into `SubmitGuestRequestInput.birthdate`.
- **Sync trigger point (#11)** — call `syncPermanentGuests` from the tier-creation action after tiers are saved, plus the manual re-sync button.

## Verification (end-to-end, for Session D)

1. `supabase db reset` + `supabase test db` green; `pnpm lint` + `tsc` clean.
2. Local app (`pnpm dev:code`, dev-login as **admin**): star a contact → appears under Vaste; event with tiers → permanent guest auto-added; remove → re-sync does NOT re-add; manual `+` re-adds. Import paste + CSV → preview badges → toast; re-import → idempotent. Landing submit with birthdate → contact appears; approve → guest carries `contact_id`.
3. Dev-login as **staff** → Adresboek reuse list works (names only); Import/upload hidden; Network panel shows the reuse RPC, never a raw `contacts` select.

## Open items (non-blocking)

- **AVG / birthdate consent** — DOB is PII; default is optional, restricted visibility, same retention. Confirm whether legal wants a dedicated consent line or DOB treated as sensitive (AAL2).
- **Contact retention anchor** — default anonymizes a contact once no still-retained event links it AND it's inactive ≥ `retention_months`. Confirm, or add a separate `contact_retention_months`.
- **`guest_tiers.is_default`** — tier-mapping fallback currently guesses ("Regular" else first). Consider an explicit default-tier flag later.
- Pre-existing, unrelated: `events.test.sql` declares `plan(46)` but runs 36.
