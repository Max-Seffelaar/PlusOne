# PLUSONE — Subprocessor List

> **DRAFT v0.2 — 24 September 2026 — NOT LEGALLY REVIEWED.**
> Rewritten from v0.1 (9 July 2026) against the code on `main` and the native-app plans. A Dutch lawyer must review this text before it is published at `https://plus-one.io/legal#subprocessors`. Bracketed placeholders `[like this]` must be completed first; the open list is in `docs/legal/README.md`.

**Last updated:** [date of publication] · **Version:** [1.0]

PLUSONE ([PlusOne V.O.F. / B.V.], KvK [number]) uses the providers below to run the PLUSONE platform (plus-one.io, app.plus-one.io and the PLUSONE apps for iOS and Android). This list is **Annex 2 of our Data Processing Agreement (DPA)** and is referenced by our Privacy Policy (`https://plus-one.io/legal#privacy`).

"Guest data" means the personal data venues manage in PLUSONE (guest lists, requests, address books, door records), for which the venue is controller and PLUSONE is processor. "Controller-side data" means data PLUSONE processes for its own business (team accounts, billing, correspondence, prospects).

## A. Subprocessors that process guest data

Engaged for every venue. Each is bound by a data processing agreement and holds the certifications listed.

| Subprocessor | Entity | Purpose | Personal data involved | Data location | Transfer safeguard | Certifications |
|---|---|---|---|---|---|---|
| **Supabase** | Supabase, Inc. (US) [confirm contracting entity] | Database (PostgreSQL), authentication, realtime updates, scheduled jobs, backups | All platform data: guest data, address books, door records, audit trail, team accounts and sessions, salted IP hashes for rate limiting | **EU — Ireland** (AWS `eu-west-1`) | Data stored and processed in the EU; SCCs for the US entity | SOC 2 Type II; HIPAA-capable; [confirm current] |
| **Vercel** | Vercel, Inc. (US) | Application hosting and delivery (Next.js), web application firewall and rate limiting on public pages | Personal data in transit through the application; connection metadata (IP address, request path) in short-lived edge and function logs | **EU — Frankfurt, Germany** (`fra1` compute region); a global edge network routes connections | EU–US Data Privacy Framework; SCCs | SOC 2 Type II; ISO 27001 [confirm] |
| **Sentry** | Functional Software, Inc. (US) | Error and performance monitoring | Scrubbed technical error reports: internal user ID (random UUID), venue ID, role, screen name; no names, e-mail addresses, phone numbers, request contents, cookies, headers or query strings; session replay disabled; IP storage disabled in the project settings [verify] | **EU — Germany** (Sentry EU data residency, `de.sentry.io`) | EU–US Data Privacy Framework; SCCs | SOC 2 Type II; ISO 27001 |
| **Cloudflare Turnstile** | Cloudflare, Inc. (US) [confirm EU contracting entity] | Bot protection on the public guest request pages (`app.plus-one.io/e/…`) | For the duration of a check: the requester's IP address, browser and device signals, and a challenge token. No form contents. Nothing is stored by PLUSONE | Cloudflare global network, incl. EU points of presence | EU–US Data Privacy Framework; SCCs | SOC 2 Type II; ISO 27001 |

## B. Subprocessors that process controller-side data only

These providers never receive guest data. They are listed for transparency and because they process personal data of venue team members, billing contacts and prospects.

| Subprocessor | Entity | Purpose | Personal data involved | Data location | Transfer safeguard | Certifications |
|---|---|---|---|---|---|---|
| **Resend** | Plus Five Five, Inc. (Resend, US) | Delivery of login codes, invitations and other transactional e-mail to team members (as the SMTP provider of our authentication service); mail is transported by Amazon Web Services (Amazon SES) as Resend's sub-provider | Recipient e-mail address, message subject and body (a one-time code or link), delivery status | **EU — Ireland** (Amazon SES `eu-west-1`); sending domain [plus-one.io subdomain — today `theoperators.nl`, see README] | EU–US Data Privacy Framework; SCCs | SOC 2 Type II [confirm] |
| **Stripe** | Stripe Payments Europe, Ltd. (IE) | Subscription billing, hosted checkout and customer portal (SEPA Direct Debit, iDEAL), invoices and dunning | Venue company name, billing e-mail address, EU VAT number, subscription and payment status; the bank account and mandate live only at Stripe. **PLUSONE stores no IBAN or card details** | EU; limited transfers to Stripe, Inc. (US) for fraud prevention and support | EU–US Data Privacy Framework; SCCs | PCI DSS Level 1; SOC 2 |
| **Google Workspace** | Google Ireland Ltd. (IE) | Business e-mail, calendar and documents of the PLUSONE team | Correspondence with venue team members, billing contacts and prospects; internal documents | EU/US (Google infrastructure; EU data regions where configured [confirm]) | EU–US Data Privacy Framework; SCCs (Cloud Data Processing Addendum) | ISO 27001; SOC 2 |

## C. Planned subprocessors (not yet active)

Each of these will be moved to section A or B — with notice to venues per section E where guest data is involved — **before** it processes any personal data. The Resend row below is the exception: it is listed only because a guest-facing confirmation e-mail has been raised as an idea, not because it is on the roadmap — see the row for why.

| Subprocessor | Entity | Purpose | Personal data involved (planned) | Planned location | Planned safeguard |
|---|---|---|---|---|---|
| **Firebase Cloud Messaging** (with the Apple Push Notification service for iOS) | Google Ireland Ltd. / Google LLC; Apple Distribution International Ltd. | Delivery of push notifications to the PLUSONE app for iOS and Android | Push token bound to a login session, optional device label, and the notification itself: the push payload carries only an id and a kind (for example, that a guest request was created), never a guest's name or contact details; the visible notification text is generic, e.g. "New guest request". [Whether the event name may also appear in that visible text — decision pending] | Google and Apple global infrastructure | EU–US Data Privacy Framework; SCCs |
| **Attio** | Attio Ltd. (UK) | Customer relationship management | Venue company records and the business contact details of venue team members (name, e-mail address, role, venue, account creation date) plus aggregated, non-personal usage indicators per venue. **Guest data is never synced** | EU/UK | UK adequacy decision |
| **Resend** (under consideration, not a scheduled item) | see section B | Transactional e-mail to guests on the venue's behalf, e.g. confirmation of the venue's decision on a request — the MVP sends guests no notification, so this is not on the roadmap | Requester's e-mail address and the decision message | EU — Ireland | as section B |
| **Google Analytics** | Google Ireland Ltd. (IE) | Website analytics for plus-one.io (marketing site only, not the app) | Pseudonymized usage data of website visitors; deployed only behind a consent banner | EU/US | EU–US Data Privacy Framework; SCCs |
| **PostHog** | PostHog, Inc. (US) | Product analytics in the app for team members (screen views, feature usage) | Pseudonymized in-app usage events of account holders; **no guest data** | EU region (Frankfurt) | EU–US Data Privacy Framework; SCCs |
| **Slack** | Slack Technologies Ltd. (IE) | Internal weekly digest of platform activity to the PLUSONE team | Aggregate counts per venue and venue names; no personal data expected [confirm digest content before go-live] | EU/US | EU–US Data Privacy Framework; SCCs |

## D. Services that are not subprocessors

These services are part of how we build and operate PLUSONE but do not process personal data on our behalf.

| Service | Purpose | Why it is not a subprocessor |
|---|---|---|
| **Better Stack** (uptime monitoring) | Pings the public health endpoint `app.plus-one.io/api/health` every minute and alerts the PLUSONE team | The endpoint returns only a status ("ok" / "error"); no personal data is sent or stored |
| **Apple App Store, Google Play** (app distribution) | Distribution of the PLUSONE app for iOS and Android | Independent controllers for your download, store account and any crash report you send them; PLUSONE receives no personal data from the stores |
| **Codemagic** (native build pipeline) | Builds and signs the iOS/Android app shell | Builds from source code and signing certificates only; no access to the database or to user data |
| **GitHub** (source code and CI) | Source code hosting and automated tests | Tests run against a local database with fictitious seed data; no production data |

## E. Changes to this list

We notify venues (venue admin contacts, by e-mail) at least **30 days** before a new subprocessor starts processing guest data (section A). Venues may object on reasonable, data-protection-related grounds as set out in the DPA. Changes to sections B–D, and the activation of a planned item that involves no guest data, are published on this page without a separate notice. The current version of this list is always available at `https://plus-one.io/legal#subprocessors`.

**Version history**

| Version | Date | Change |
|---|---|---|
| [1.0] | [publication] | First published version |
