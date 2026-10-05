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
> Gasten sturen een aanvraag, hosts vragen extra quotum — beide landen in de 'Requests'-tab. Goedkeuren of afwijzen kost één tik, met een pushmelding zodra er iets wacht.
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

## Data safety form (Play Console) — question by question

**Where:** Play Console → PlusOne → **Policy and programs → App content → Data safety** → *Start*. The click path is in `play-console-checklist.md`; this section is the *answers*. Written against `docs/legal/privacy-policy.md` **v0.2** (§§3, 4, 8, 10, 12, 13) and `docs/legal/subprocessors.md`. If either changes, re-check this section in the same PR. Play's form labels drift a little over time; if a label differs, pick the option whose *meaning* matches the answer here.

> **BLOCKED until L1:** the form ends with the privacy policy URL check. Submit it only once `https://www.plus-one.io/legal#privacy` shows the lawyer-approved v0.2 text, not the draft.

### How Play defines "collected" and "shared" (this decides most answers)

- **Collected** = data leaves the device to us or to a service that works for us. Data that stays on the phone (the door's IndexedDB copy, the CSV that's parsed in the browser) isn't "collected" by itself; it becomes collected the moment the rows are sent to our backend.
- **Shared** = handed to a **third party**. Google lists exceptions: data passed to a **service provider** that processes it on our behalf (Supabase, Vercel, Sentry, Firebase Cloud Messaging, Resend) is **not** "sharing". The same goes for data a user deliberately sends to someone else in the app. That's why every row below says **Shared: No**. *(This corrects the S2 draft, which marked Sentry and FCM as "shared".)*
- Guest data (names and contact details of guests) is entered **in the app** by venue staff, so it is user data the app collects, even though the venue is the GDPR controller (policy §2, §4). Play has no "processor" exception. Declare it.

### Step 1 — Data collection and security

| # | Play question | Answer | Why (policy section) |
|---|---|---|---|
| 1 | Does your app collect or share any of the required user data types? | **Yes** | Accounts, guest lists, push token, crash reports (§3, §4, §12). |
| 2 | Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS/TLS only, to Supabase, Vercel, Sentry and FCM (§11.2). The webview only loads `https://app.plus-one.io`. |
| 3 | Which methods of account creation does your app support? | **Username and other authentication** (e-mail address + 6-digit one-time code). *Not* "password", *not* OAuth. | Passwordless e-mail OTP, invite-only (§3; CLAUDE.md "Auth"). Accounts are created **inside the app** when a venue admin invites someone. That's why we don't pick "My app does not allow users to create an account". |
| 4 | Delete account URL | **`https://www.plus-one.io/delete-account`** *(live; in-app path Profile → Delete account, see "Account deletion" below)* | §13: account holders e-mail the privacy address; we delete once the account isn't needed for a venue (§10). |
| 5 | Do you provide a way for users to request that some or all of their data is deleted, without deleting their account? | **No** *(optional question)* | Partial deletion for account holders runs through the same support request. Guests go to the venue (§13). The venue admin's "forget contact" (§10) is a feature for the venue, not a self-service path for the user. Answer **Yes** only if Max wants the same URL to cover it. |

### Step 2 — Data types (tick exactly these)

| Play category → data type | Tick? | What it is in PlusOne |
|---|---|---|
| Personal info → **Name** | ✅ | Account holder's name (§3); guest/address-book names entered by staff (§4.1, §4.3) |
| Personal info → **Email address** | ✅ | Account e-mail (§3); optional guest/contact e-mail (§4.1, §4.3) |
| Personal info → **User IDs** | ✅ | Internal account UUID (audit trail, Sentry's user id — §3, §11.3) |
| Personal info → **Phone number** | ✅ | Optional for account holders and guests (§3, §4.1) |
| Personal info → **Other info** | ✅ | Address-book date of birth, job title, guest tier/+N (§3, §4.3) |
| Personal info → Address, race/ethnicity, political/religious beliefs, sexual orientation | ❌ | Not collected |
| Financial info (any) | ❌ | The native shell shows billing **read-only** with no checkout or payment entry (CLAUDE.md "Billing", `isNativeShell()`). Card/IBAN never reach us anyway (§8). |
| Health and fitness | ❌ | — |
| Messages (emails, SMS, other in-app messages) | ❌ | No messaging between users. Notes and decision messages are declared under "Other user-generated content". |
| Photos and videos / Audio / Files and docs | ❌ | No camera, mic or file upload. The CSV contact import is parsed on the device and only its rows go to the backend (those are declared as Name/Email/Phone/Other info). |
| Calendar / Contacts | ❌ | The app never reads the phone's calendar or address book. "Contacts" in PlusOne is the venue's own list, entered or imported by staff, already declared above. |
| App activity → App interactions | ❌ | No usage analytics, no screen tracking (§5 "No analytics or tracking today") |
| App activity → In-app search history / Installed apps | ❌ | Door search is local-only (CLAUDE.md "What NOT to do") |
| App activity → **Other user-generated content** | ✅ | Staff notes on guests, refusal reasons, decision messages to requesters (§4.1, §4.2, §4.4) |
| App activity → **Other actions** | ✅ | The audit trail: who added, changed or checked in which guest, and when (§3 "Activity", §4.6) |
| Web browsing | ❌ | — |
| App info and performance → **Crash logs** | ✅ | Sentry error reports, scrubbed (§11.3; subprocessors: Sentry EU) |
| App info and performance → **Diagnostics** | ✅ | Same Sentry reports carry diagnostic context (release, route, timings) |
| App info and performance → Other app performance data | ❌ | — |
| Device or other IDs | ✅ | Push token (FCM) and optional device label (§12); the random door device id `plusone-device-id` stored with door actions (§3, §5); the login session record with user agent + IP address (§3 "Sessions") |
| Location (approximate / precise) | ❌ | No GPS. The session IP is stored for security, never used to work out a location. |

### Step 3 — Per data type (Play asks the same 4 questions for each ticked type)

Columns: **Collected/Shared** · **Processed ephemerally?** · **Required or optional?** · **Purposes** (Play's list: App functionality, Analytics, Developer communications, Advertising or marketing, Fraud prevention/security/compliance, Personalization, Account management).

| Data type | Collected / Shared | Ephemeral? | Required / optional | Purposes to tick |
|---|---|---|---|---|
| Name | Collected · **not shared** | No | **Required** (an account needs a name; a guest entry needs a name) | App functionality, Account management |
| Email address | Collected · not shared | No | **Required** (login is by e-mail code) | App functionality, Account management |
| User IDs | Collected · not shared | No | Required | App functionality, Account management, Fraud prevention/security/compliance |
| Phone number | Collected · not shared | No | **Optional** | App functionality |
| Other info | Collected · not shared | No | Optional | App functionality |
| Other user-generated content | Collected · not shared | No | Optional | App functionality |
| Other actions | Collected · not shared | No | **Required** (the audit trail can't be switched off; it's a core anti-fraud feature, §3) | App functionality, Fraud prevention/security/compliance |
| Crash logs | Collected · not shared | No | **Required** (no user toggle) | Analytics *(see note)*, App functionality |
| Diagnostics | Collected · not shared | No | Required | Analytics *(see note)*, App functionality |
| Device or other IDs | Collected · not shared | No | **Required**: the session record and the door device id are part of signing in and using the door. The push token alone is opt-in, but Play asks per type, not per item, so the strictest member decides. | App functionality, Fraud prevention/security/compliance, Account management |

**Note on "Analytics":** Play's *Analytics* purpose explicitly includes "monitoring app performance / diagnosing crashes". That's what Sentry does, so we tick it, and that keeps us honest under Play's definitions. It does **not** contradict the policy's "no analytics" (§5), which means product and usage analytics (no PostHog/GA). Never tick *Advertising or marketing* or *Personalization*.

### Step 4 — Security practices (last page)

| Question | Answer |
|---|---|
| Data is encrypted in transit | Yes (same as Step 1 Q2) |
| Users can request that data be deleted | Yes, through the delete-account URL / privacy address (§13) |
| Committed to the Play Families Policy | **No**. Not a children's app (see `play-review-notes.md` → Target audience). |
| Independent security review (MASA) | **No**. Optional badge, not done. |

### Account deletion — decided: `https://www.plus-one.io/delete-account` (live), in-app Profile → Delete account (live)

*The text below is the original recommendation, kept for the reasoning; the anchor and the "app-code change" it mentions were superseded by what shipped.*

Play requires a delete-account web link for every app where accounts can be created in the app. PlusOne accounts are invite-only, but the invite happens **in the app** (a venue admin invites by e-mail), so we treat the requirement as applying. The capacitor plan (§1 "Account-verwijdering") calls us exempt; that was written with Apple's rule in mind (in-app *sign-up*). Play's form asks for the URL regardless.

Recommended (no build work):

1. A short section on the marketing site's legal page, anchor **`#delete-account`**: `https://www.plus-one.io/legal#delete-account` (repo Plus-One.io, not this repo). Proposed text:
   > **Delete your PlusOne account.** E-mail **[privacy@plus-one.io]** from the address you sign in with, subject "Delete my account". We confirm within one month (GDPR art. 12). We delete your name, phone number and sign-in details and end every session and push registration. The venue's audit trail of your actions is kept as privacy policy §10 describes. *(Exact wording for the lawyer: §10 says "delete or anonymize" without saying what happens to the audit entries of a deleted account.)* Guest-list entries belong to the venue: ask the venue, it can erase you right away.
2. Fallback if Max doesn't want a new anchor: use `https://www.plus-one.io/legal#privacy` itself. §13 already names the address. Play accepts that only if the page **clearly** explains the steps, and a reviewer has to scroll to §13 to find them, so the anchor is safer.
3. Open questions for Max: (a) is `privacy@plus-one.io` a real mailbox that someone reads? (b) section or anchor? (c) **Play's policy also asks for an in-app path** to request deletion (e.g. Profile → "Delete account" that opens the URL above via `openExternal()`). That's an **app-code change** (`src/**`), so it's out of scope here and becomes its own task if Max agrees. Without it there's a real risk of a policy rejection.

### Cross-check against privacy policy v0.2 — inconsistencies found (reported, policy not edited)

- **IP address.** The S2 draft said IP is "not stored by PlusOne". Policy §3 "Sessions" says our auth service records IP + user agent per login. These answers follow the policy: declared under *Device or other IDs*.
- **Door device id** (`plusone-device-id`, §3/§5) was missing from the S2 table. Now declared.
- **"Shared" with Sentry/FCM.** The S2 draft said yes. Under Play's service-provider exception it's **no**. The policy's wording ("recipients", §8) is fine either way.
- **Push text, §12:** "[and may name the event — decision pending]". `supabase/functions/push-dispatch/dispatch.ts` sends only generic texts ("New guest request", "New quota request", …) and never an event name. The lawyer can resolve that bracket to "never names the event".
- **§1 entity** is still "[PlusOne V.O.F. / PlusOne B.V.]". The decision (Max, 2026-09-25) is **The Operators** (eenmanszaak), KvK **99992841**. The Play developer/organization profile must use the same entity.
- **§14:** account holders must be **16+**. Play target audience is set to **18+** (see review notes). That's stricter, so not a conflict, but the lawyer may want them aligned.
- **Policy URL host:** the policy says `https://plus-one.io/legal#privacy`, the store uses `https://www.plus-one.io/legal#privacy`. The apex redirects to `www` (CLAUDE.md "Env & prod-push"), so both work. Paste the `www` form, which avoids a redirect for Play's crawler.

No data sold, no advertising ID, no third-party analytics or ads SDKs, no ticketing/marketing data sharing (decisions #36/#10; `docs/legal/subprocessors.md` §C lists GA/PostHog as planned, not active).

## Export compliance

Not a Play Console question (Apple only). For the App Store: HTTPS-only (standard TLS via Supabase/Vercel), so exempt.
