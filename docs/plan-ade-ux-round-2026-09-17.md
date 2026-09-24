# ADE UX round — Joeri's feedback of 17 Sept 2026

**Status:** planned 17/9 (this document) → to be built by ONE orchestrated session. The
copy-paste prompt for that session is `docs/prompts/ade-ux-round-orchestrator.md`.
**Milestone:** Now — the ADE campaign (Joeri offers the app free to ADE events; the
onboarding has to explain itself).
**ClickUp:** `z8uq9m0g0j` (umbrella task: one session, two PRs).
**Branch:** `claude/ade-ux-round-z8uq9m0g0j` (+ `…-db` for the migration PR).
**Sources:** Fathom recap "Max <> Joeri" 17/9 (call 825503844) · Max's decisions in the
planning session of 17/9 · screenshots taken on the fixture backend (`pnpm dev:fake`).

Every "Today" line below was verified in the code on 17/9 (file + approximate line).
Every "Decision" line is Max's answer. If the code you find contradicts a "Today" line,
stop that item and report the conflict — do not improvise a different feature.

## Ground rules (restated from CLAUDE.md because sub-agents only see this file)

- English UI copy lives ONLY in `src/lib/i18n/` (surfaces per screen), voice per
  `tone-of-voice.md`: sentence case, numerals, no em-dash, glossary terms exact
  (Guest · +N · Check-in · Tier · Request · Regular · On the way · Inside).
- New UI primitive → `src/components/po/kit.tsx` (or `shell.tsx`), exported, reused.
- One canonical domain type + ONE adapter per entity (`src/features/po/adapters.ts`),
  screen shapes are projections; one `format.ts` for display helpers.
- Screen files stay under ~800 LOC. Already at/over the line: `home.tsx` 840,
  `EventDayCockpit.tsx` 1151, `guests/index.tsx` 785, `events/edit.tsx` 760 — extract
  new pieces into sibling files, never grow these.
- `import type { JSX } from 'react'` — never a bare `JSX.Element`.
- Door writes go through the outbox or not at all. Nothing in this round adds an
  outbox op kind; door-side edits that need the server are online-only and say so.
- Never weaken or skip a guard test to get CI green. No new dependencies.
- Capacitor checklist (CLAUDE.md) for every touched screen: webview-safe, no
  browser-only API without fallback, tap targets ≥ 44 px, safe-area tolerant.
- Reads via React Query hooks in `src/features/po/hooks.ts`; online writes via the
  existing server actions in `src/features/*` (Zod-validated, `getUser()`-verified).

## Fixture backend for looking at screens (no docker needed)

`pnpm dev:fake` starts `scripts/dev/fake-supabase.mjs` (:55421) and `next dev` (:7100)
pointed at it; `pnpm shot <name> <path> [desktop|mobile] [email]` logs in through the
app's own `/auth/dev-login` and writes `.screenshots/<name>.png`. Fixture ids:

| what                                                               | id                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| event FRENZY (tonight, 23:00, 20 guests, 3 inside, 1 open request) | `c0000000-0000-4000-8000-000000000001`                                    |
| event Saturday Sessions (next week)                                | `c0000000-0000-4000-8000-000000000002`                                    |
| event Opening Night (past, closed)                                 | `c0000000-0000-4000-8000-000000000003`                                    |
| guest Liam Smit +2, via request link                               | `d0000000-0000-4000-8000-000000000004`                                    |
| users                                                              | `manager@plusone.test` (admin), `staff@plusone.test`, `door@plusone.test` |

It is a viewing harness, not a test double: no RLS, realtime is a 404, writes only
mutate memory. Proof of behaviour stays with vitest, pgTAP and the e2e suite.

## Items

### A · "New event" on Home

- **Decision:** add it next to "New guest", desktop + mobile; hidden for roles that
  cannot create events (admin only today).
- **Today:** `src/components/po/screens/home.tsx` header renders only `t.home.newGuest`
  (~line 600–610). `t.home.createEvent` ("Create an event") is used only in the
  empty state (~line 395–408). The Events tab already has "New event".
- **Spec:** left of "New guest", `Btn kind="ghost" icon="cal"` with the existing label
  `t.home.newEvent` ("New event" — same glossary term as the Events tab) →
  `nav.push('eventedit', { isNew: true })`, rendered only when `isAdmin`. Mobile: both
  buttons on one row under the greeting (wrap allowed, ≥ 44 px tap height). Empty
  state unchanged.
- **Tests:** lint/type-check; screenshot desktop + mobile, admin + staff (hidden).

### B · Venue above Name in the event form

- **Decision:** Venue first.
- **Today:** `src/components/po/screens/events/edit.tsx` ~475–480 renders Name, then
  the read-only Venue field.
- **Spec:** swap the two blocks (create and edit). Name keeps autofocus.

### C · End date/time auto-fill + a date picker you never page through

- **Decision:** end = start date + doors time + 6 h, as the standard. And picking a
  date must not mean clicking through 4–5 months; a typed/selected date must land
  exactly.
- **Today:** `edit.tsx` never derives the end fields — `setEndDateStr` has one caller,
  the hydrate effect (~233). `src/components/po/datetime-field.tsx` `DateField` opens
  `src/components/po/daypicker.tsx` (react-day-picker) with `defaultMonth={selected}`
  and prev/next arrows only — no month/year dropdown. While the popover is open, typed
  text is not reflected until Enter/blur (screenshot 17/9: input "17-10-2026", calendar
  still on September, and a click in the calendar would override the typed date). The
  End date picker opens on today's month when empty, even when a start date is set.
- **Spec:**
  - C1 derive: pure helper `deriveEnd(dateStr, timeStr, hours = 6)` →
    `{ endDateStr, endTimeStr }` in `src/features/events/derive-end.ts`, unit-tested
    (23:00 → next day 05:00; 16:00 → same day 22:00; a DST-change date; empty input →
    empty). Form: while the user has not touched an end field (`endTouched === false`),
    every change of start date/time re-derives both end fields; the first manual edit
    of an end field sets `endTouched = true`; "Clear" on End date sets it back to
    following. Edit mode: an event loaded with `ends_at` starts as touched (never
    silently rewrite a stored end).
  - C2 calendar: `captionLayout="dropdown"` with month + year selects (range: current
    year −1 … +3), styled like the kit (dark surface, lavender selected, ≥ 44 px
    controls on touch). `DateField` gains `anchor?: string` (YYYY-MM-DD): when `value`
    is empty the calendar opens on the anchor's month — End date and Auto-close are
    anchored to the start date. Desktop typing: parse on every keystroke
    (`parseTypedDate`); when the text parses, the calendar's `month` follows it and the
    day highlights; commit stays on Enter/blur; invalid text still reverts.
  - C3 the "Today" / "Clear" footer stays.
- **Tests:** unit for `deriveEnd`; DateField unit test that a typed valid date moves the
  visible month (query the caption); screenshots: New event with a date + doors picked
  (End filled), picker open showing the dropdowns.

### D · "i" explainer beside Sign-up link

- **Decision:** yes. The toggle's default (off) is not decided — leave it.
- **Today:** `edit.tsx` ~585–596: label `t.events.landingPage` ("Sign-up link") +
  toggle "Sign-up link active / Guests can request a spot through the link." + the
  `/e/<slug>` row once saved.
- **Spec:** new kit primitive `InfoTip` (a 44×44 "i" icon button that opens a small
  popover on desktop / bottom sheet on touch with a title and 2–3 sentences; closes on
  Escape, outside tap, or its own close; `aria-describedby` wiring). Place it beside the
  "Sign-up link" label. Copy in `src/lib/i18n/surfaces/events.ts`, draft (final wording
  per `tone-of-voice.md`): title "What the sign-up link does"; body "Every event gets a
  public page at /e/<slug>. Guests fill in their name and plus-ones, you approve them
  under Requests, and approved guests land on the list. Copy or share the link from
  Request links once the event is saved."
- **Tests:** unit render test for `InfoTip` (open, Escape closes, aria).

### E · Hide the alias feature (keep the data and the parser)

- **Decision:** hide it everywhere for now so it can return later with more users and a
  better design.
- **Today:** alias UI in `src/components/po/screens/events/tiers.tsx` (banner
  `t.events.aliasesNote` ~142, the per-tier ALIASES block ~185–221, the create-form
  field ~285–286), in `src/components/po/screens/guests/_shared.tsx` (inline
  create-a-tier form: name/color/price/alias), and in `templates.tsx` (verify). The
  quick-add parser (`src/features/guests/quick-add-parser.ts` ~148) matches tier NAMES
  as well as aliases, so hiding aliases does not break "Juri +2 vip".
- **Spec:** one flag `export const TIER_ALIASES_UI = false` in
  `src/features/guests/tiers.ts` with a comment (why hidden, how to re-enable); every
  alias render site checks it. Forms must NOT overwrite stored aliases: when the UI is
  off, create sends `aliases: []` and update omits `aliases` entirely.
- **Tests:** a vitest rendering the create-tier form with the flag off asserts no alias
  label/field; parser tests untouched (they must stay green).

### F · Tier name placeholder "Backstage" → "Guest"

- **Decision:** the example in the placeholder becomes "Guest".
- **Today:** `src/lib/i18n/surfaces/events.ts` `tierNamePlaceholder: 'Name, e.g. "Backstage"'`
  (verify that `tiers.tsx`, `guests/_shared.tsx` and `templates.tsx` all read this key).
- **Spec:** `'Name, e.g. "Guest"'`. Update `copy-deck.md` if it lists the string.

### G · Banner above the email/phone fields in quick-add

- **Decision:** a small banner just above the email field: add email + phone so the
  guest is saved as a contact and the address book stays clean.
- **Today:** `src/components/po/screens/guests/quick-add.tsx` ~380–410 renders the two
  inputs (placeholders `contactEmailPlaceholder` / `contactPhonePlaceholder`).
  `t.guests.add.contactPromptHint` ("Optional. Saves them to your contacts…") exists in
  the catalogue but has NO render site.
- **Spec:** a kit `Note` (icon "contact") directly above the email field. Draft copy:
  "Optional: add an email or phone number and they're saved to your contacts, so next
  time they're one tap away and your list stays clean." Retire the unused
  `contactPromptHint` key (one key, one meaning). The door's AddOnSpot: only if it has
  the same fields (verify); otherwise skip.

### H · Upcoming vs past in the Guests tab chip row

- **Decision:** split (Max's screenshot: seven events in one row, past mixed with
  upcoming).
- **Today:** `src/components/po/screens/guests/index.tsx` `GuestsTab` ~224–250 renders
  `[All events][every event…] | [☆ Regulars]`; events already carry
  `when: 'upcoming' | 'past'` (~136).
- **Spec:** chips = All events → upcoming events (soonest first) → divider → a "Past ▾"
  chip that toggles the past-event chips inline (most recent first, cap 12, "Show all"
  when more); selecting a past chip keeps the group open; the Regulars filter stays
  last. No persistence. Mobile: same row with horizontal scroll (exists). The
  pinned-event mode (pushed from an event) is unchanged.

### I · Tier colour on avatars, everywhere

- **Decision:** avatar fill = the guest's tier colour, everywhere; inside guests dimmed.
- **Today:** `kit.tsx` `Avatar` has only `accent?: boolean`. `list-shared.tsx` (2
  sites), `guests/index.tsx` bulk preview (~654) and door `GuestDetail.tsx` (~89) pass
  `accent={role === 'VIP'}` → lavender for VIP-type tiers regardless of the tier's real
  colour (the fixture VIP tier is mint), dark for everyone else. Door `CheckInList.tsx`
  avatars (~327, ~375) carry no colour at all. Mobile guest rows paint the whole row in
  the tier colour (keep that).
- **Spec:** `Avatar` gains `color?: string` (fill = colour, ink = `tierInk(colour)` from
  `src/lib/po/tier-colors.ts`, transparent border) and `dim?: boolean` (low-alpha tint
  - white ink, same recipe the cockpit uses for inside rows). `accent` stays for
    non-guest uses. Replace every `accent={… === 'VIP'}` with `color={tierColor}`
    (+ `dim` when the guest is inside); door list rows too. Cockpit rows already use the
    tier fill — leave them.
- **Tests:** `Avatar` render test (colour → style, ink contrast helper called).

### J · Guest source on the row and on the profile

- **Decision:** both.
- **Today:** the DB has `guests.source` (app | landing | door | permanent),
  `request_link_id` and `added_by`; the po fetchers (`fetchGuests`,
  `fetchVenueGuestsWindow`, `PROFILE_APPEARANCE_SELECT` in `src/features/po/queries.ts`)
  do not select them. The profile shows "Added to FRENZY · Door" in Activity; the door
  overlay shows "Via request link".
- **Spec:** extend the guest selects + `toPoGuest` (the one adapter) with `source`,
  `addedByName` (embed `added_by_profile:user_profiles!guests_added_by_fkey(full_name)`,
  the same embed `fetchRecapGuests` uses) and `linkLabel` (embed
  `request_links(label, is_default, influencers(name))`; null for the default link).
  Display helper `guestSourceLabel(g)` in `src/features/po/format.ts`:
  landing → "Sign-up link" (+ " · {label or influencer}" when not the default link);
  app → "Added by {first name}"; door → "At the door by {first name}"; permanent →
  "Regular". Row: second line (table: under the name; card: subline). Profile: in the
  Events card next to the status pill. Verify RLS lets staff read co-members'
  `user_profiles.full_name` through the embed (the Team list already does); if not,
  fall back to "Added by a colleague" — never widen a policy for this.

### K · Name-only guests link to a same-name contact (quick-add AND paste a list)

- **Decision:** yes — when a guest is added by name only and the venue has a contact
  with the same name, offer the link (pre-selected, one tap to undo). Paste-list rows
  get the same treatment.
- **Today:** auto-linking (`guests_autolink_contact` trigger) is deliberately
  email/phone only; name-only guests never link (the duplicate trap on import, decided
  earlier — keep the trigger as is). Staff cannot SELECT `contacts` under RLS, but
  `search_contacts_for_reuse(p_venue_id, p_query)` (SECURITY DEFINER, member-gated,
  narrow projection: id, full_name, preferred_role, event_count, limit 50) is callable
  by every member. `addGuestSchema` / `bulkAddSchema` (`src/features/guests/schemas.ts`)
  have no `contactId`. There is NO database guard that `guests.contact_id` belongs to
  the guest's venue — only the `add_contact_to_event` RPC checks it.
- **Spec:**
  - K1 matcher: `matchContactByName(name, contacts)` in
    `src/features/guests/contact-match.ts`: normalize (trim, collapse whitespace,
    lower-case, strip diacritics via NFD), exact equality; exactly one match → the id;
    0 or ≥ 2 → none. Unit tests: diacritics, double spaces, case, two same-name
    contacts → none.
  - K2 quick-add: once a name is parsed without email/phone, query
    `search_contacts_for_reuse(venueId, name)` (React Query, keyed by the normalized
    name, debounced 250 ms) and run K1. A match renders a chip under the parsed chips:
    "Same as contact {name}" (pre-selected) with a "Not the same" toggle; Enter adds
    with `contactId`. Copy in `src/lib/i18n/surfaces/guests.ts`.
  - K3 paste a list: in the `BulkPaste` preview (`guests/index.tsx` ~492+), rows with
    no email/phone run K1 against `search_contacts_for_reuse(venueId, name)` per
    distinct name (batched, max 6 in flight); matched rows show a "contact" mini-chip
    with a toggle (default on); ambiguous rows show "2 contacts with this name" and stay
    unlinked. The insert plan passes `contactId` per row.
  - K4 server: `addGuestSchema` + `bulkAddSchema` gain `contactId: uuid.optional()`;
    `addGuest` / `addGuestsBulk` verify each id through
    `search_contacts_for_reuse(<event's venue>)` (the id must be in the result;
    otherwise a generic "Couldn't link the contact" error) and insert `contact_id`.
    Idempotency unchanged (client UUIDv7 ids). The autolink trigger already leaves a
    pre-set `contact_id` alone.
  - K5 database (own PR, high-risk): constraint trigger `guests_contact_same_venue`
    BEFORE INSERT OR UPDATE OF contact_id ON guests — the contact must exist, belong to
    the guest's venue (`venue_id` is server-derived on the row) and not be anonymized;
    otherwise `raise exception`. pgTAP: allowed (same venue), denied (other venue),
    denied (anonymized contact), and the existing autolink / promote /
    `add_contact_to_event` / permanent-sync paths still pass. Unique migration
    timestamp (check `git ls-files supabase/migrations | grep <date>` against
    `origin/main`); no type regen (no new columns). Review gates: fresh-session
    `/code-review` + `/security-review`, and the proactive security-research prompt in
    the PR body (CLAUDE.md "Review gates").
  - Door AddOnSpot: unchanged (no contact matching at the door; offline path).

### L · Rename Door → Check-in

- **Decision:** rename the tab, the sidebar entry and the desktop page title. Keep
  "Doors 23:00", door price and the doorhost role as they are. "Outline Door button"
  from the action items was not decided → out of scope.
- **Today:** `src/lib/i18n/en.ts` `nav.door: 'Door'` is used by
  `src/components/po/shell.tsx:18` (mobile tab) and `src/components/po/app.tsx:958`
  (sidebar); `src/lib/i18n/surfaces/cockpit.ts` `pageTitle: 'Event day'`;
  `screens/door.tsx:209` already shows `nav.checkin`. `copy-deck.md` lists "Door" as a
  glossary term.
- **Spec:** `nav.door` → `'Check-in'` (the key name stays), `cockpit.pageTitle` →
  `'Check-in'`; the cockpit subtitle keeps the event name. Update `copy-deck.md`, and any
  unit/e2e selector that looks for the literal "Door" tab text (grep
  `getByText('Door'`, `name: /Door/`, `'Door'` in `tests/`).

### M · Edit +N from the guest profile and the door overlay

- **Decision:** yes; quota and list-lock rules stay enforced by the database.
- **Today:** `src/components/po/screens/guests/profile.tsx` ~478 renders "+N" as a
  static `MiniChip`; the only +N edit paths are quick-add's duplicate flow and
  `AddToEventSheet` for saved contacts (`profile-sheets.tsx` `submitAdjust` →
  `usePoUpdateGuest` → server action `updateGuest`). Door overlay
  `src/features/door/components/GuestDetail.tsx` ~80–81: `IconBtn name="dots"` has no
  handler. The outbox has no guest-update op (kinds: `check_in`, `refusal`, `add_guest`).
- **Spec:**
  - M1 profile: the +N chip becomes a button (and a "Add plus-ones" ghost button when 0) → `PlusOnesSheet` (kit `Stepper`, 0…10, shows the slot cost and the quota line
    from `usePoQuota`) → `usePoUpdateGuest`. Quota/lock errors surface as returned.
    Extract the sheet into `profile-sheets.tsx` (or a new sibling) — `profile.tsx` must
    not grow past 800.
  - M2 door overlay: the "…" button opens an actions sheet with "Edit plus-ones" (the
    same sheet, online-only: disabled with "Needs a connection" while the door sync
    reports offline — the outbox is NOT extended). Desktop cockpit: only if a guest
    overlay already exists there; otherwise skip and say so.
- **Tests:** unit for the sheet's slot math (reuse `totalSlots`); mutation test that
  `updateGuest` is called with the new total; door test that the action is disabled
  offline.

### N · "Paste a list" as a real button

- **Decision:** a labelled button, not an icon nobody recognises.
- **Today:** quick-add `Top right={<IconBtn name="paste" …/>}` (`quick-add.tsx` ~320);
  the event guest list already shows a "Paste list" button; the venue-wide Guests tab
  has only "Add guest".
- **Spec:** quick-add: `Btn kind="ghost" icon="paste"` "Paste a list" under the event
  picker (desktop: may sit in the header) → `nav.push('bulk', { id })`; remove the icon
  button. Guests tab: "Paste a list" ghost button beside "Add guest" (desktop + mobile)
  → bulk scoped to the selected event, else the picker.

### O · Fully-inside guests get a static badge in the cockpit

- **Decision:** static badge.
- **Today:** `src/features/po/eventday/EventDayCockpit.tsx` ~890 renders
  `ChkBtn kind="in" active={isIn}` as a fully active button for inside guests (it
  doubles as the top-up entry); a tap on a complete party only toasts
  `t.cockpit.toastFullyInside`.
- **Spec:** `fully` → replace the ✓ button with a non-interactive `InsideBadge` (check
  icon + "Inside", `aria-label` "Inside since {time}", no press animation, default
  cursor, same 40 px footprint so rows don't jump); `partial` → keep ✓ as the top-up
  button with the count in its title ("2 of 3 inside · add more"); ✗ unchanged. Remove
  the now-unreachable toast branch. Mobile door list: verify parity (dimmed row + check
  badge) — no change expected. Extract the badge into `eventday/` sibling file; the
  cockpit file must not grow.
- **Tests:** cockpit unit test: inside guest → no button titled `checkInTitle`, badge
  present; partial party → button present.

## Execution — one session, six streams, two PRs

Streams run as parallel sub-agents, each in its own git worktree, with file ownership
so merges stay mechanical:

| stream             | items                             | owns                                                                                                                                                                                       |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1 Events form     | A, B, C, D                        | `home.tsx`, `events/edit.tsx`, `datetime-field.tsx`, `daypicker.tsx`, `kit.tsx` (InfoTip), `features/events/derive-end.ts`, i18n `home.ts`, `events.ts`, shared datetime copy              |
| S2 Tiers           | E, F                              | `events/tiers.tsx`, `guests/_shared.tsx`, `templates.tsx`, `features/guests/tiers.ts`, i18n `events.ts` (placeholder only), `copy-deck.md` (tier line)                                     |
| S3 Add guest       | G, K1–K4, N (quick-add)           | `quick-add.tsx`, `guests/index.tsx` BulkPaste half, `features/guests/{schemas,actions,contact-match}.ts`, `features/po/hooks.ts` (contact-by-name query), i18n `guests.ts`                 |
| S4 Lists & profile | H, I (app), J, M1, N (Guests tab) | `guests/index.tsx` GuestsTab half, `list-shared.tsx`, `profile.tsx`, `profile-sheets.tsx`, `kit.tsx` (Avatar), `features/po/{queries,adapters,format}.ts`, i18n `guests.ts`                |
| S5 Door & cockpit  | L, M2, O, I (door files)          | `shell.tsx`, `app.tsx`, `EventDayCockpit.tsx` + new `eventday/` sibling, `door/components/{GuestDetail,CheckInList}.tsx`, i18n `en.ts`, `cockpit.ts`, `door.ts`, `copy-deck.md` (glossary) |
| S6 Database (PR 2) | K5                                | `supabase/migrations/`, `supabase/tests/`                                                                                                                                                  |

- Merge order into the task branch: S2 → S1 → S5 → S4 → S3 (S3 and S4 both touch
  `guests/index.tsx` and `guests.ts`; S3 rebases onto the merged S4).
- After every merge: `pnpm lint && pnpm type-check && pnpm vitest run` — fix before the
  next merge. pgTAP, the concurrency suite and e2e cannot run in a web container: the
  PR says so explicitly, never claims them.
- Visual check: `pnpm dev:fake` + `pnpm shot` for every touched screen, desktop and
  mobile, admin and staff where rights differ; look at every image; attach to the PR.
- PR 1 (draft): `feat(ux): ADE UX round — Joeri feedback 17/9, items A–O (z8uq9m0g0j)`.
  PR 2 (draft, high-risk): `feat(db): guests.contact_id must belong to the guest's venue (z8uq9m0g0j)`
  with the security-research prompt in the body.
- Bookkeeping: `docs/changelog.md` entry (newest first); ClickUp end-of-session comment
  (Dutch: changes, PR links, real test results, what Max must do); marker synced; the
  task stays `in progress` until merged + tested.
- Hand-off to Max: per-screen test handoff (dev-login links to the LOCAL stack +
  numbered yes/no questions), grouped per stream.

## Risk register

- K5 is the only migration and the only high-risk surface: keep it in its own PR so
  PR 1 is not held by the review gates.
- C2: react-day-picker's dropdown caption renders native `<select>`s — style them
  through the kit (dark background, readable options) and check them on a phone
  viewport (the native picker UI is acceptable on touch).
- J: the `user_profiles` embed may be empty for staff under RLS → the fallback label,
  never a policy change.
- File-size line: `home.tsx`, `EventDayCockpit.tsx`, `guests/index.tsx`, `edit.tsx`
  are at or over 800 LOC — every addition there is an extraction into a sibling file.
- The fixture backend shows every role every row (no RLS): permission questions in the
  handoff must be answered on the local stack, not on `pnpm dev:fake`.
