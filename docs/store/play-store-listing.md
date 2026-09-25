# Google Play Console — store listing draft

App name: **PlusOne**
Category: **Business** (Events isn't a Play category; Business is the closest fit for a venue-staff tool)
Support URL: `https://www.plus-one.io`
Privacy policy URL: `https://www.plus-one.io/legal#privacy`

Tone: `tone-of-voice.md` — confident, nightlife-native, no filler. Content matches what the app does today: guest lists, quotas, approvals, offline door check-in, push for approvals. No ticketing, no outbound invites (CLAUDE.md decision #36) — never claim either.

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
> Gasten sturen een aanvraag, hosts vragen extra quotum — beide landen in de Aanvragen-tab. Goedkeuren of afwijzen kost één tik, met een pushmelding zodra er iets wacht.
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
> Guests send requests, hosts ask for more quota — both land in the Requests tab. Approve or decline in one tap, with a push notification the moment something's waiting.
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

Mirror `/privacy` from L1 once live. At minimum: collects account info (email), guest data entered by venue staff (name, tier, plus-ones — processed as a data processor on behalf of the venue, see `docs/legal/data-processing-agreement.md`), and device push tokens. No data sold, no advertising ID use, no third-party ticketing/marketing data sharing (decision #36/#10 — no outbound invites). Data is encrypted in transit (HTTPS/TLS to Supabase `eu-west-1`). Account/guest data deletion: in-app for guests (admin "forget contact", AVG art. 17); account deletion via support (invite-only, no in-app self-signup — see `capacitor-plan-claude-code.md` §1 "Account-verwijdering").

## Export compliance

HTTPS-only (standard TLS via Supabase/Vercel) — exempt from US export-compliance documentation requirements.
