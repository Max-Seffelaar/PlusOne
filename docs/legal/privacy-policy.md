# PLUSONE — Privacy Policy

> **DRAFT v0.2 — 24 September 2026 — NOT LEGALLY REVIEWED.**
> Rewritten from v0.1 (9 July 2026) against the code on `main` and the native-app plans (Fase 17). A Dutch lawyer must review this text before it is published at `https://plus-one.io/legal#privacy`. Bracketed placeholders `[like this]` must be completed first; the open list is in `docs/legal/README.md`.

**Last updated:** [date of publication] · **Version:** [1.0]

---

## 1. Who we are

PLUSONE is a guest list platform for venues, clubs and event organizers. It is operated by:

- **Legal entity:** [PlusOne V.O.F. / PlusOne B.V.] ("**PLUSONE**", "**we**", "**us**")
- **Chamber of Commerce (KvK):** [KvK number]
- **Registered address:** [street, postal code, city], the Netherlands
- **Privacy contact:** [privacy@plus-one.io]

This policy applies to:

- our website **plus-one.io**;
- the PLUSONE application at **app.plus-one.io**, whether you use it in a browser, as an installed web app, or as the **PLUSONE app for iOS and Android** (the same application in a native shell, see section 12);
- the **door mode** of the application, used at the entrance of an event to check guests in;
- the **public guest pages**: the request page a venue shares for an event (`app.plus-one.io/e/…`), the status page a guest receives after requesting a spot (`/r/…`), and the statistics page of a promoter (`/i/…`).

## 2. Our two roles

Under the EU General Data Protection Regulation (GDPR, in the Netherlands the AVG) we act in two different roles, and which one applies decides who you should turn to.

**PLUSONE as controller.** For everything we need to run our own business we decide why and how personal data is processed: the accounts of venue teams, our customer relationship with venues, billing, our website, support and the integrity of the platform itself (audit trail, error monitoring). Sections 3, 5 and 6 describe this.

**PLUSONE as processor.** Guest lists belong to the venue. When a venue adds a guest, imports its address book, or shares a request page for an event, the **venue is the controller** of that data and PLUSONE only processes it on the venue's behalf, under a Data Processing Agreement (DPA). **If you are a guest and want to know what a venue holds about you, correct it, or have it removed, contact the venue that runs the guest list.** We support venues in handling such requests, and we never use guest data for our own purposes. Section 4 describes this.

The rest of this policy is organized by who you are.

## 3. If you work at a venue (account holders)

Accounts are created by invitation only: a venue admin invites you by e-mail, or PLUSONE invites a venue owner directly. There is no public sign-up and no password.

**What we process**

| Category | Details |
|---|---|
| Identity and contact | First and last name, e-mail address, optionally a phone number; per venue an optional job title |
| Login and security | Six-digit one-time codes sent by e-mail; session and refresh tokens; if you choose to enable two-factor authentication, an authenticator (TOTP) enrolment |
| Roles | Your role(s) per venue (admin, user manager, finance, staff, door host) and any events you organize |
| Consent record | When you accepted the terms and which version |
| Sessions | For every active login our authentication service records the browser or device (user agent), the IP address and the time. You can see and end your own sessions; a venue admin can see and end the sessions of team members at that venue |
| Activity (audit trail) | Every relevant action you perform in the platform — adding, changing or checking in a guest, changing quotas, locking a list, changing roles — is recorded automatically: who, what, when, and what changed. A random device identifier generated in your browser is stored with door actions so a venue can tell which device performed them |
| Native app | If you enable notifications in the iOS/Android app: a push token and an optional device label (section 12) |
| Support | Your messages to us and our replies |

**Where it comes from.** The venue that invites you (your e-mail address), you (name, phone, settings), and the platform itself (sessions, activity).

**Good to know**

- Your account exists independently of any venue. If a venue removes you from its team, your account and your access to other venues are unaffected. Only you can change your own e-mail address.
- Two-factor authentication is optional for every role. We recommend it; we never require it.
- Venue admins and finance users can read the venue's audit trail, which includes your actions. This is a core anti-fraud feature of the product.
- You can ask us to delete your account once it is no longer needed for a venue you work with (section 13).

## 4. If you are a guest, requester or promoter of an event

For this data the **venue is the controller** and PLUSONE is the processor. What follows describes what the platform holds so you know what to ask the venue about.

**4.1 Guest list entries.** A venue's team can put you on the list of an event with your name; optionally an e-mail address, a phone number, a note, the number of people you bring (+1s), a guest category (tier) and your status (approved, checked in, refused, removed). Only a name is required.

**4.2 Requests through a public request page.** A venue can share a link (or QR code) where you can request a spot yourself. The form asks for your **name, e-mail address and phone number** (all three are required, so the venue can reach you about your request), the number of people you bring, an optional message, and whether you want to hear from **the venue** about upcoming nights (marketing opt-in, off by default). The venue decides on your request; its decision, an optional reason (internal to the venue) and an optional message to you are stored with it. Some links approve requests automatically within a fixed number of spots.

After submitting you receive a **personal status link**. It shows the event, your status and the number of spots; once approved it also shows the venue's address and message. The link is not sent anywhere: it is shown to you once, and only a cryptographic hash of it is stored, so nobody can reconstruct it from our database. It stays valid until the request is anonymized (section 10).

A request with an e-mail address or phone number is also added to the **venue's address book** (4.3), so the venue recognizes you the next time.

To keep these public pages free of abuse, submissions are **rate-limited** using a salted hash of your IP address that is deleted within two hours, and protected by **Cloudflare Turnstile**, a bot check that sends your IP address and browser signals to Cloudflare for the duration of the check (see our Subprocessor List). Raw IP addresses are not stored by PLUSONE. Page views of request links are counted as daily totals without cookies or any personal data. The page never reveals whether a name or e-mail address is already on a list.

**4.3 Venue address book.** Venues keep a reusable list of people they know: name; optionally e-mail address, phone number, date of birth, preferred guest category and a note. Entries come from the venue's team, from a spreadsheet the venue imports, or from your own request (4.2).

**4.4 Door records.** At the entrance the venue's door host checks you in or refuses entry. We store the time, the number of people who arrived, the team member who did it, the device used, and — for a refusal — the reason the door host typed. No ticket, QR scan, photo or location is involved: your name is the ticket.

**4.5 Promoters (influencers).** A venue can give a promoter a personal request link. For that we store the promoter's name, an optional handle, notes the venue adds, and a hashed access token for the promoter's statistics page, which shows aggregate numbers (requests, approvals, arrivals) and no guest details.

**4.6 Audit trail.** Changes to the records above are logged with before/after values so the venue can detect fraud and account for its list. Personal data inside this log is redacted when the record itself is anonymized (section 10).

**What we do not do with guest data.** We never contact guests, never send marketing, never sell or share guest data with anyone but the venue and our subprocessors, never sync it to our CRM, and never use it to build profiles. The marketing opt-in on the request form is a choice between you and the venue: PLUSONE only stores it.

## 5. If you visit our website or use the app in a browser

**Cookies and storage we use.** The platform works with strictly necessary cookies and browser storage only:

| Name | Type | Purpose | Lifetime |
|---|---|---|---|
| `sb-…-auth-token` | Cookie (secure, httpOnly) | Keeps you signed in to app.plus-one.io | 30 days, refreshed while you use the app |
| `po_active_venue` | Cookie (secure, httpOnly) | Remembers which venue you last worked in | 1 year |
| `plusone-device-id` | Local storage | Random identifier for this browser, stored with door actions (section 3) | Until you clear browser data |
| Door cache and outbox | IndexedDB | Lets the door work without internet (section 12) | Cleared at sign-out; entries expire after 7 days |
| Error queue | IndexedDB | Holds error reports while offline, sent when back online | Until sent |
| UI preferences | Local/session storage | Small flags such as "keep the screen awake at the door" | Session or until cleared |

**No analytics or tracking today.** We do not use analytics cookies, advertising cookies, session replay or fingerprinting on plus-one.io or in the app. If we introduce website analytics on plus-one.io (Google Analytics) or product analytics in the app (PostHog) we will use EU data residency where available, update this policy first, and ask for your consent through a cookie banner before placing any non-functional cookie.

**Bot protection on public pages.** The guest request pages use Cloudflare Turnstile (section 4.2), which may set its own functional cookie for the duration of the check.

**Website contact.** If you use a contact form or e-mail us from the website, we process your name, e-mail address and message to answer you.

## 6. Purposes and legal bases

| Purpose | Data | Role | Legal basis |
|---|---|---|---|
| Providing access to the platform: accounts, login codes, roles, sessions | Account holder data (section 3) | Controller | Contract with the venue (Art. 6(1)(b)); our legitimate interest in securing accounts (Art. 6(1)(f)) |
| Fraud resistance and accountability: the audit trail, device identifiers, session records | Account holder and guest data | Controller (own audit design) / processor (guest content) | Legitimate interest of PLUSONE and of venues in a guest list that cannot be tampered with unnoticed (Art. 6(1)(f)); contract |
| Subscription and billing | Venue company details, billing contact, VAT number, subscription status, payment references | Controller | Contract (Art. 6(1)(b)); tax law (Art. 6(1)(c)) |
| Customer relationship, onboarding and sales | Business contact details of venues and prospects; aggregated platform usage per venue | Controller | Legitimate interest in running and growing our business (Art. 6(1)(f)) |
| Support and correspondence | Your messages and contact details | Controller | Legitimate interest (Art. 6(1)(f)); contract |
| Keeping the platform stable and secure: error monitoring, uptime, rate limiting, bot protection | Scrubbed error reports; salted IP hashes; Turnstile checks | Controller | Legitimate interest (Art. 6(1)(f)) |
| Push notifications in the native app | Push token, device label | Controller | Your choice to enable them (Art. 6(1)(a), withdrawable in the app or OS settings) |
| Guest list management, requests, door check-in, retention | Guest, requester and promoter data (section 4) | Processor | Determined by the venue as controller (typically its legitimate interest in access control, or the guest's own request) |
| Legal obligations and disputes | Whatever a specific obligation requires | Controller | Legal obligation (Art. 6(1)(c)); legitimate interest (Art. 6(1)(f)) |

Where we rely on legitimate interest you can object (section 13). We do not make automated decisions with legal or similarly significant effects about individuals. Automatic approval of a guest request is a rule the venue configures for a link (a spot limit), not a decision about you as a person.

## 7. How we use your contact details

- **Transactional messages only.** We e-mail account holders for login codes, invitations and essential service messages (for example a security notice or a change to these terms). We do not send account holders marketing without a separate, explicit opt-in that you can withdraw at any time.
- **Guests are never contacted by PLUSONE.** The venue may contact you about your request or, if you opted in, about its upcoming nights. [Under consideration, not scheduled: an optional confirmation e-mail to a requester about the venue's decision, sent on the venue's behalf. The current product sends guests no messages at all; this policy and the Subprocessor List will be updated before that changes.]
- **Venue owners and prospects** may hear from us about the product and our commercial relationship; you can opt out at any time by replying or by e-mailing [privacy@plus-one.io].

## 8. Who receives personal data

**Subprocessors and service providers.** We use a small number of providers to host and run the platform. The current list — with the entity, purpose, data, location and transfer safeguard for each — is our **Subprocessor List** at `https://plus-one.io/legal#subprocessors`. In summary:

- database, authentication and realtime infrastructure (Supabase, EU/Ireland);
- application hosting and content delivery (Vercel, EU/Frankfurt, with a global edge network for connections);
- delivery of login and invitation e-mails (Resend, EU);
- bot protection on public pages (Cloudflare Turnstile);
- error monitoring with scrubbed reports (Sentry, EU/Germany);
- subscription billing (Stripe: SEPA Direct Debit and iDEAL; we never see or store your bank account number or card);
- business e-mail and documents (Google Workspace);
- and, once live, push notification delivery for the native app (Firebase Cloud Messaging / Apple Push Notification service) and our CRM (Attio).

**Your venue.** For guest data, the venue's team sees what its roles allow: admins and finance the full picture, staff their own guests within their quota, door hosts the door view of one event.

**Our own team.** A small number of PLUSONE operators (platform administrators) can access every venue's data to provide support and resolve incidents. Any change they make is written to the audit trail under their own name, exactly as for any other user.

**Authorities.** We disclose personal data to police, courts or supervisory authorities when we are legally required to, and we inform the venue where the data concerns its guests and the law allows it.

**Business transfer.** If PLUSONE is sold, merged or restructured, personal data may be transferred to the acquirer under confidentiality, with this policy continuing to apply. We will inform venue admins by e-mail.

**We do not sell personal data**, and we do not share it with advertising networks or data brokers.

## 9. International transfers

Personal data is stored and processed in the **European Union**: the database and authentication in Ireland (Supabase, AWS `eu-west-1`), the application in Frankfurt, Germany (Vercel `fra1`), login e-mails via Amazon SES in Ireland (Resend), and error reports in Sentry's EU region in Germany. Connections to the app pass through the provider's global network of edge locations, which may briefly process connection data (such as your IP address) outside the EU while routing your request.

Some providers are established, or have parent companies, in the United States or the United Kingdom. For those we rely on an adequacy decision of the European Commission (the EU–US Data Privacy Framework for certified US providers; the UK adequacy decision) and/or the EU Standard Contractual Clauses, recorded per provider in the Subprocessor List. Where neither applies, we do not use the provider.

## 10. How long we keep data

**Data we process as controller**

| Data | Retention |
|---|---|
| Account (name, e-mail, phone, roles, consent record) | For as long as the account exists. We delete or anonymize an account on request once it is no longer needed for a venue you work with, or after [24 months] of inactivity |
| Login codes | 10 minutes |
| Sessions | Until you sign out, the session is ended by an admin, or it expires after 30 days without use |
| Push tokens (native app) | Deleted when you sign out, disable notifications, or the token is unused for 90 days |
| Audit trail | Kept for as long as the venue exists, for fraud resistance and accountability; personal data inside entries is redacted according to the rules below when the underlying record is anonymized |
| Error reports | [90 days] in Sentry, then deleted automatically |
| Rate-limit records (salted IP hashes) | At most 2 hours |
| Billing and invoices | 7 years (Dutch fiscal retention obligation, Art. 52 AWR) |
| Customer and prospect records (CRM, invitations) | For the duration of the (prospective) customer relationship, and [24 months] after the last contact |
| Support correspondence | [2 years] after the last message |

**Guest data we process as processor**

- **The venue sets the retention period** for its guest data: between 1 and 60 months, counted from the **end of the event** (12 months in the standard setup, 24 months in the guided onboarding).
- Every night an automated job **irreversibly anonymizes** records past that period: the name is replaced by a neutral label (for example "Gast #12"), and e-mail addresses, phone numbers, notes, messages, decision texts and refusal reasons are erased. The status link of a request stops working at the same moment. Address book entries are anonymized once they are no longer linked to a retained event and have not been used for the retention period.
- The same job **rewrites the audit trail**: personal data inside historical before/after values is replaced, while the structure (who acted, when, what kind of change) is kept so the venue's accountability record stays intact.
- Aggregate statistics (attendance, +1 totals, tier occupancy, promoter funnels) survive anonymization; they no longer relate to an identifiable person.
- **Erasure on request.** A venue admin can erase a specific person **immediately**, without waiting for the retention period: one action anonymizes the address book entry, every guest list entry linked to it across the venue's events, the related refusals, and the personal data in the related audit history. Guests should address such requests to the venue; we assist as processor.
- **End of contract.** When a venue stops using PLUSONE it can export its guest data within [30 days]; after that we delete or anonymize it, unless the law requires longer storage.

## 11. Security and data breaches

**11.1 Procedures.** Security is part of how the platform is built, not a layer on top. Authorization is enforced **inside the database** on every query (row-level security): a user, even with direct API access, can only read or write data of venues and events they are a member of. Every change to guest, quota and check-in records is written to an **append-only audit trail by the database itself**; the application cannot skip or edit it. Records are never hard-deleted (destructive deletes are revoked at the database level); they are anonymized instead. Changes to security-sensitive code get an independent review before release, and automated tests block secrets from ever reaching browser code.

**11.2 Standards and encryption.** All traffic is encrypted in transit (TLS); data is encrypted at rest by our hosting providers, who hold SOC 2 and/or ISO 27001 certifications (see the Subprocessor List). Authentication is passwordless (one-time codes) with short-lived access tokens and rotating refresh tokens; two-factor authentication is available to every user. Public pages are rate-limited, bot-protected and designed not to reveal whether a person or e-mail address exists.

**11.3 Access on a need-to-know basis.** Within a venue, access follows roles. Within PLUSONE, only named platform administrators can access customer data, for support and incident response, and their changes are audited under their own name. Error reports sent to our monitoring provider are scrubbed before they leave the platform: no request contents, cookies, headers, query strings, e-mail addresses or phone numbers; a user appears only as a random internal ID. Session replay is off.

**11.4 Storage.** Production data lives in the EU (section 9), with automated backups managed by our database provider. Door devices keep a temporary local copy of one event's list so the door keeps working when the connection drops; section 12 explains what that copy contains and when it is wiped.

**11.5 Data breaches.** If we discover a breach of security that affects personal data, we contain it, investigate it and record it. As processor we notify the affected venues **without undue delay and at the latest within [48 hours]** of becoming aware, with what we know at that point, so they can meet their own obligations. As controller we notify the Dutch supervisory authority within 72 hours where the GDPR requires it, and the people affected where the breach is likely to result in a high risk to them.

## 12. Door devices and the native apps

**Offline door mode.** When a door host opens an event at the door, the guest list of that event is copied to the device so check-ins keep working without internet, and actions performed offline are queued and sent when the connection returns. That local copy contains, per guest: name, phone number (shown on screen as the last four digits only), the note, the number of +1s, category and status, plus the event's check-ins and refusals (including the typed reason) and the names of the team members involved. **E-mail addresses are deliberately never copied to the device.** Only the events actually opened on that device are stored, entries expire after 7 days, and everything is wiped when the user signs out. Because a device could be lost, every team member has a personal login, sessions are short-lived, and a venue admin can remotely end any session; the device then deletes its copy the next time it connects.

**The PLUSONE app for iOS and Android** is the same application in a native shell and processes the same data. The app additionally processes:

- **Push notifications (optional).** If you turn notifications on, the app registers a push token with Firebase Cloud Messaging (Google) — on iOS delivered through the Apple Push Notification service — and we store that token together with the login session it belongs to and an optional device label you can set. Notifications are limited to the working of the platform (for example a new guest request or a quota request for a venue you work at). The message that passes through Google and Apple contains only internal identifiers and the kind of event, never a guest's name or contact details; the visible text is generic (for example "New guest request") [and may name the event — decision pending]. The app fetches the details from PLUSONE only after you tap the notification. The token is deleted when you sign out, when a venue admin ends your session, when you disable notifications, or after 90 days without use.
- **No advertising or tracking identifiers.** The app does not read the advertising ID of your device (IDFA/AAID), does not track you across apps or websites, and contains no analytics or advertising SDK. The app's data-collection labels in the App Store and Google Play are derived from this policy.
- **App stores.** Apple and Google process your download and any crash report you send them under their own privacy policies; PLUSONE receives no personal data from the stores.

## 13. Your rights

Under the GDPR you have the right to access your personal data, to have it corrected or erased, to restrict or object to its processing, to receive it in a portable format, and to withdraw consent where processing is based on consent. You also have the right to lodge a complaint with the **Autoriteit Persoonsgegevens** (autoriteitpersoonsgegevens.nl) or the supervisory authority of the EU member state where you live or work.

- **Guests, requesters and promoters:** exercise your rights with the **venue** that manages the event; it is the controller. If you contact us directly we will refer you to the venue without undue delay and support it in responding.
- **Account holders, venue contacts and prospects:** e-mail [privacy@plus-one.io]. We may ask you to confirm your identity from the e-mail address on file. We respond within one month; for complex requests we may extend this by two months and will tell you why.

## 14. Children

PLUSONE is a business tool. Account holders must be at least 16 years old. Age policies for events and their guests are set and enforced by the venue; PLUSONE does not knowingly process children's data for its own purposes.

## 15. Changes to this policy

We may update this policy when the platform or the law changes. The current version, with its date, is always at `https://plus-one.io/legal#privacy`. For material changes we notify venue admins by e-mail before they take effect and, where the change concerns the app, ask account holders to accept the updated terms at their next login.

## 16. Contact

[PlusOne V.O.F. / B.V.] · [address] · KvK [number]
Privacy questions and requests: [privacy@plus-one.io]
General support: [support@plus-one.io]
