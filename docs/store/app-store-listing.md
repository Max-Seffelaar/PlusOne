# App Store Connect — listing draft

App name: **PlusOne**
Category: **Business** (primary) — no "nightlife" category exists; Business is the closest fit for a venue-staff tool. Consider Utilities as a secondary if Apple requires one.
Support URL: `https://plus-one.io`
Privacy policy URL: `https://plus-one.io/legal#privacy`
Age rating: 17+ recommended (nightclub/alcohol-venue context — set from the standard questionnaire in App Store Connect, not decided here).

Tone: `tone-of-voice.md`. Content matches what the app does today: guest lists, quotas, approvals, offline door check-in, push for approvals. <!-- valid only once N5 (#349) is merged and verified on device --> No ticketing, no outbound invites (CLAUDE.md decision #36), no in-app billing/checkout (Apple IAP restriction, `src/lib/platform.ts` `isNativeShell()`) — never claim any of these.

---

## Dutch (primary)

**Subtitle** (≤30 chars, currently 27)

> Gastenlijst en deurcheck-in

**Promotional text** (≤170 chars, currently 148 — editable without a new build)

> Zet ze op de lijst, wij doen de deur. Quota per host, aanvragen goedkeuren, offline check-in. Geen QR, geen screenshots, gewoon je naam aan de deur.

**Description**

> Zet ze op de lijst. Wij doen de deur.
>
> PlusOne is de gastenlijst-app voor clubs, venues en events. Eén plek voor de gastenlijst, de quota per host en de check-in aan de deur — ook zonder verbinding.
>
> Gastenlijst, altijd actueel
> Voeg gasten toe met naam en +N, geef ze een tier (VIP, All Access, Artist, Pers, Crew, Gast), en zie in één oogopslag wie er onderweg is en wie al binnen is.
>
> Quota die zichzelf bewaken
> Elke host krijgt een toegewezen aantal gasten per event. PlusOne rekent +N automatisch mee en blokkeert wie over zijn quotum gaat.
>
> Aanvragen, geregeld met één tik
> Gasten sturen een aanvraag, hosts vragen extra quotum — beide landen in de 'Requests'-tab, met een pushmelding zodra er iets wacht. <!-- valid only once N5 (#349) is merged and verified on device -->
>
> De deur werkt altijd
> Check-in blijft werken zonder internet: elke actie gaat in de wachtrij en synct zodra de verbinding terug is.
>
> Alles op naam, alles gelogd
> Geen QR-codes, geen screenshots — check-in loopt op naam. Elke toevoeging, wijziging en check-in wordt gelogd.
>
> Voor elk team
> Rollen per venue (admin, organisator, host, doorhost), meerdere venues per account, en een gastenlijst die op slot kan zodra de deur opengaat.
>
> PlusOne is invite-only — accounts komen van je organisatie.

**Keywords** — App Store keyword fields are per-locale; the NL field can reuse the EN list below translated, but Apple weighs the app name/subtitle too, so keep this list tight:

> gastenlijst,deur,check-in,venue,evenement,quotum,nachtclub,vip,portier

---

## English

**Subtitle** (≤30 chars, currently 26)

> Guest lists, door check-in

**Promotional text** (≤170 chars, currently 153 — editable without a new build)

> Put them on the list, we run the door. Quotas per host, approvals in one tap, check-in that keeps working offline. No QR, no screenshots, just your name.

**Description**

> Put them on the list. We run the door.
>
> PlusOne is the guest list app for clubs, venues and events. One place for the guest list, per-host quotas and door check-in — even offline.
>
> A guest list that stays current
> Add guests by name with a +N, assign a tier (VIP, All Access, Artist, Press, Crew, Guest), and see at a glance who's on the way and who's already in.
>
> Quotas that enforce themselves
> Every host gets an assigned number of guests per event. PlusOne counts +N automatically and stops anyone going over their quota.
>
> Approvals in one tap
> Guests send requests, hosts ask for more quota — both land in the Requests tab, with a push notification the moment something's waiting. <!-- valid only once N5 (#349) is merged and verified on device -->
>
> The door always works
> Check-in keeps working without a connection: every action queues and syncs the moment you're back online.
>
> Everything by name, everything logged
> No QR codes, no screenshots — check-in runs on name. Every add, edit and check-in is logged.
>
> Built for the whole team
> Per-venue roles (admin, organizer, host, doorhost), multiple venues per account, and a guest list you can lock the moment the door opens.
>
> PlusOne is invite-only — accounts come from your organization.

**Keywords** (≤100 chars, currently 81)

> guest list,door,check-in,venue,event,quota,nightclub,vip,bouncer,rsvp,event staff

---

## What's new (initial release)

**NL:** Eerste release van PlusOne voor iOS: gastenlijst, quota, aanvragen en offline check-in aan de deur.

**EN:** First release of PlusOne for iOS: guest lists, quotas, approvals and offline door check-in.

## App Privacy (nutrition labels)

Mirror `/privacy` from L1 once live. Cross-checked against `docs/legal/privacy-policy.md` (v0.2, §§3–4, 8, 12) and `docs/legal/subprocessors.md` — keep this table in sync with those if either changes.

| Data type | Apple category | Collected | Linked to you | Used for tracking | Purpose |
|---|---|---|---|---|---|
| Account name, e-mail address, phone number | Contact Info | Yes | Yes — tied to your account | No | App Functionality |
| Guest name, phone number, e-mail address (Contact Info); staff-entered notes (Other User Content) | Contact Info + Other User Content | Yes | No — tied to the venue's guest record; processed as data processor on the venue's behalf (see `docs/legal/data-processing-agreement.md`), never used for PlusOne's own purposes | No | App Functionality |
| Device push token <!-- valid only once N5 (#349) is merged and verified on device --> | Identifiers | Yes, once notifications are enabled (opt-in, off by default) | Yes — tied to your login session | No | App Functionality |
| Crash data, performance data | Diagnostics | Yes | Yes — tied to a random internal user ID only, never your name/e-mail/phone | No | App Functionality |
| IP address | — | Not collected/stored by PlusOne's Sentry integration (`sendDefaultPii: false`, request data stripped in `beforeSend`); Vercel's hosting logs process it only transiently, not as app-collected data for this questionnaire | n/a | No | n/a |

None used for tracking (no cross-app/cross-site tracking, no ad networks, no data broker sale, no advertising identifiers — consistent with decision #36 and `docs/legal/privacy-policy.md` §12 "No advertising or tracking identifiers"). No data sold. All data encrypted in transit (HTTPS/TLS). Deletion: guest data per the venue's AVG retention window or immediately via admin "forget contact"; account deletion via support (invite-only, no in-app self-service); push token deleted on sign-out, on disabling notifications, or after 90 days unused; crash/diagnostics per Sentry's retention window (see subprocessors list).

## Review notes (draft — finalize in S5 alongside the 4.2 defense)

- App is invite-only; no public sign-up. Reviewer needs a demo login — provided by S3's env-gated review-login route + demo-tenant seed, not by this task.
- Guideline 4.2 (webview wrapper) defense: native push (FCM/APNs) <!-- valid only once N5 (#349) is merged and verified on device --> + an offline-capable door check-in flow that queues and syncs, both genuinely native-dependent behavior beyond a bare web wrapper. Until N5 ships, lead with the offline door check-in flow alone.
- No in-app account creation → Apple's in-app account-deletion requirement (5.1.1v) doesn't apply; support contact for data-deletion requests goes here once decided.
- iPad is supported in v1 (`TARGETED_DEVICE_FAMILY` 1,2) — reviewer may test on iPad; T1 (tablet layouts) must ship first.
