# Google Play Console — store listing draft

App name: **PlusOne**
Category: **Business** (Events isn't a Play category; Business is the closest fit for a venue-staff tool)
Support URL: `https://plus-one.io`
Privacy policy URL: `https://plus-one.io/legal#privacy`

Tone: `tone-of-voice.md` — confident, nightlife-native, no filler. Content matches what the app does today: guest lists, quotas, approvals, offline door check-in, push for approvals. <!-- valid only once N5 (#349) is merged and verified on device --> No ticketing, no outbound invites (CLAUDE.md decision #36) — never claim either.

---

## Dutch (primary)

**Short description** (≤80 chars, currently 63)

> Gastenlijsten, quota en check-in aan de deur. Alles in PlusOne.

**Full description** (≤4000 chars)

> Zet ze op de lijst. Wij doen de deur.
>
> PlusOne is de gastenlijst-app voor clubs, venues en events. Eén plek voor de gastenlijst, de quota per host en de check-in aan de deur — ook zonder verbinding.
>
> **Gastenlijst, altijd actueel**
> Voeg gasten toe met naam en +N, geef ze een tier (VIP, All Access, Artist, Pers, Crew, Gast), en zie in één oogopslag wie er onderweg is en wie al binnen is.
>
> **Quota die zichzelf bewaken**
> Elke host krijgt een toegewezen aantal gasten per event. PlusOne rekent +N automatisch mee en blokkeert wie over zijn quotum gaat — de organisatie stelt de grenzen in, niet de host.
>
> **Aanvragen, geregeld met één tik**
> Gasten sturen een aanvraag, hosts vragen extra quotum — beide landen in de 'Requests'-tab. Goedkeuren of afwijzen kost één tik, met een pushmelding zodra er iets wacht. <!-- valid only once N5 (#349) is merged and verified on device -->
>
> **De deur werkt altijd**
> Check-in blijft werken zonder internet: elke actie gaat in de wachtrij en synct zodra de verbinding terug is. Geen wifi aan de deur, geen probleem.
>
> **Alles op naam, alles gelogd**
> Geen QR-codes, geen screenshots — check-in loopt op naam. Elke toevoeging, wijziging en check-in wordt gelogd: wie, wat en wanneer.
>
> **Voor elk team**
> Rollen per venue (admin, organisator, host, doorhost), meerdere venues per account, en een gastenlijst die op slot kan zodra de deur opengaat.
>
> PlusOne is invite-only — accounts komen van je organisatie, niet van een open registratie.

---

## English

**Short description** (≤80 chars, currently 61)

> Guest lists, quotas and door check-in. Everything in PlusOne.

**Full description** (≤4000 chars)

> Put them on the list. We run the door.
>
> PlusOne is the guest list app for clubs, venues and events. One place for the guest list, per-host quotas and door check-in — even offline.
>
> **A guest list that stays current**
> Add guests by name with a +N, assign a tier (VIP, All Access, Artist, Press, Crew, Guest), and see at a glance who's on the way and who's already in.
>
> **Quotas that enforce themselves**
> Every host gets an assigned number of guests per event. PlusOne counts +N automatically and stops anyone going over their quota — the organization sets the limits, not the host.
>
> **Approvals in one tap**
> Guests send requests, hosts ask for more quota — both land in the Requests tab. Approve or decline in one tap, with a push notification the moment something's waiting. <!-- valid only once N5 (#349) is merged and verified on device -->
>
> **The door always works**
> Check-in keeps working without a connection: every action queues and syncs the moment you're back online. No wifi at the door, no problem.
>
> **Everything by name, everything logged**
> No QR codes, no screenshots — check-in runs on name. Every add, edit and check-in is logged: who, what, when.
>
> **Built for the whole team**
> Per-venue roles (admin, organizer, host, doorhost), multiple venues per account, and a guest list you can lock the moment the door opens.
>
> PlusOne is invite-only — accounts come from your organization, not an open sign-up.

---

## What's new (initial release)

**NL:** Eerste release van PlusOne voor Android: gastenlijst, quota, aanvragen en offline check-in aan de deur.

**EN:** First release of PlusOne for Android: guest lists, quotas, approvals and offline door check-in.

## Data safety form (Play Console)

Mirror `/privacy` from L1 once live. Cross-checked against `docs/legal/privacy-policy.md` (v0.2, §§3–4, 8, 12) and `docs/legal/subprocessors.md` — keep this table in sync with those if either changes.

| Data type | Collected | Shared | Purpose | Optional | Encrypted in transit | Deletion |
|---|---|---|---|---|---|---|
| Personal info — name, e-mail address, phone number (account holder) | Yes | No | App functionality (account, invites, roles) | Phone optional; name/e-mail required for an invited account | Yes (HTTPS/TLS) | On request once the account is no longer needed for a venue (`privacy-policy.md` §13); no in-app self-service (invite-only) — via support |
| Personal info — guest name, phone, e-mail; App activity — other user-generated content (staff-entered notes) | Yes | No — processed only on the venue's behalf (data processor, see `docs/legal/data-processing-agreement.md`) | App functionality (guest list, quotas, door check-in) | Phone/e-mail/notes optional; name required | Yes (HTTPS/TLS) | Per venue-configured AVG retention (1–60 months from event end), or immediately via admin "forget contact" (AVG art. 17) |
| Device or other IDs — push token <!-- valid only once N5 (#349) is merged and verified on device --> | Yes, once notifications are enabled | Yes — with Firebase Cloud Messaging (Google) / APNs (Apple); token only, never guest data | App functionality (approval/request alerts) | Yes — opt-in, off by default | Yes (HTTPS/TLS) | Deleted on sign-out, on disabling notifications, or after 90 days unused |
| App info and performance — crash logs, diagnostics | Yes | Yes — with Sentry (EU, Germany) | App functionality (stability/debugging) — never analytics or advertising | No — no user-facing toggle | Yes (HTTPS/TLS) | Per Sentry's configured retention window (see subprocessors list) |
| Device or other IDs — IP address | Not stored by PlusOne application code or by Sentry (`sendDefaultPii: false`, request data stripped in `beforeSend`); Vercel's edge/function logs process it only transiently for hosting and abuse prevention | No | App functionality (hosting, rate limiting) | No | Yes (HTTPS/TLS) | Short-lived hosting logs only — not retained by the app |

No data sold, no advertising ID use, no third-party ticketing/marketing data sharing (decision #36/#10 — no outbound invites), no third-party analytics SDKs (confirmed against `src/` and `docs/legal/subprocessors.md` §C, where Google Analytics/PostHog are listed as planned, not active).

## Export compliance

HTTPS-only (standard TLS via Supabase/Vercel) — exempt from US export-compliance documentation requirements.
