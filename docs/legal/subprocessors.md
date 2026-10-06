# PlusOne — Subprocessor List

**Last updated:** 2026-10-06 · **Version:** 1.1

PlusOne (The Operators, a sole proprietorship (eenmanszaak) registered with the Dutch Chamber of Commerce under number 99992841, owner Max Merlijn Seffelaar) uses the providers below to run the PlusOne platform (plus-one.io, app.plus-one.io and the PlusOne apps for iOS and Android). This list is **Annex 2 of our Data Processing Agreement (DPA)** and is referenced by our Privacy Policy (`https://plus-one.io/legal#privacy`).

"Guest data" means the personal data venues manage in PlusOne (guest lists, requests, address books, door records), for which the venue is controller and PlusOne is processor. "Controller-side data" means data PlusOne processes for its own business (team accounts, billing, correspondence, prospects).

## A. Subprocessors that process guest data

Engaged for every venue. Each is bound by a data processing agreement and holds the certifications listed.

| Subprocessor | Entity | Purpose | Personal data involved | Data location | Transfer safeguard | Certifications |
|---|---|---|---|---|---|---|
| **Supabase** | Supabase Pte. Ltd. (Singapore), 65 Chulia Street #38-02/03, OCBC Centre, Singapore 049513 | Database (PostgreSQL), authentication, realtime updates, scheduled jobs, backups | All platform data: guest data, address books, door records, audit trail, team accounts and sessions, salted IP hashes for rate limiting | **EU — Ireland** (AWS `eu-west-1`) | Data stored and processed in the EU; EU Standard Contractual Clauses incorporated in Supabase's DPA (v1, effective 1 August 2026) | SOC 2 Type 2; ISO/IEC 27001:2022 |
| **Vercel** | Vercel, Inc. (US) | Application hosting and delivery (Next.js), web application firewall and rate limiting on public pages | Personal data in transit through the application; connection metadata (IP address, request path) in short-lived edge and function logs | **EU — Frankfurt, Germany** (`fra1` compute region); a global edge network routes connections | EU–US Data Privacy Framework; SCCs | SOC 2 Type 2; ISO/IEC 27001:2022 |
| **Sentry** | Functional Software, Inc. (US) | Error and performance monitoring | Scrubbed technical error reports: internal user ID (random UUID), venue ID, role, screen name; no names, e-mail addresses, phone numbers, request contents, cookies, headers or query strings; session replay disabled; IP storage disabled in the project settings | **EU — Germany** (Sentry EU data residency, `de.sentry.io`) | EU–US Data Privacy Framework; SCCs | SOC 2 Type II; ISO 27001 |
| **Cloudflare Turnstile** | Cloudflare, Inc. (USA), 101 Townsend Street, San Francisco, CA 94107 | Bot protection on the public guest request pages (`app.plus-one.io/e/…`) | For the duration of a check: the requester's IP address, browser and device signals, and a challenge token. No form contents. Nothing is stored by PlusOne | Cloudflare global network, incl. EU points of presence | EU SCCs (+ UK/Swiss addenda) in Cloudflare's Customer DPA (v6.4, effective 3 April 2026) and the EU-US Data Privacy Framework where applicable | SOC 2 Type II; ISO 27001 |
| **Anthropic** | Anthropic Ireland, Limited (Dublin, Ireland; CRO 760497) for EEA customers; parent Anthropic, PBC (USA) | Engineering and support tooling (Claude Code with MCP connectors to our infrastructure providers); incidental access to production data during support requests and incident response | Whatever the support case requires; typically schema, logs and aggregates; guest rows only for a specific support case or incident | US | Anthropic's DPA (effective 24 February 2025) incorporating the 2021 EU SCCs (Modules 2 and 3) plus UK and Swiss addenda; no training on customer data by default | SOC 2 Type 2; ISO/IEC 27001:2022; ISO/IEC 42001:2023 |
| **Resend** | Plus Five Five, Inc. (Resend, US) | Transactional e-mail to guests **on the venue's behalf**: confirmation of the venue's decision on a request submitted through a request page. Mail is transported by Amazon Web Services (Amazon SES) as Resend's sub-provider. Added to this section on 2026-10-06 with the 30-day notice of section E; no guest e-mail is sent before that notice period has ended | Requester's e-mail address and name, the event name, the venue's decision and its optional message to the requester, delivery status. No marketing | **EU — Ireland** (Amazon SES `eu-west-1`); sending domain `plus-one.io` | EU–US Data Privacy Framework; SCCs | SOC 2 Type II |

## B. Subprocessors that process controller-side data only

These providers never receive guest data. They are listed for transparency and because they process personal data of venue team members, billing contacts and prospects.

| Subprocessor | Entity | Purpose | Personal data involved | Data location | Transfer safeguard | Certifications |
|---|---|---|---|---|---|---|
| **Resend** | Plus Five Five, Inc. (Resend, US) | Delivery of login codes, invitations and other transactional e-mail to team members (as the SMTP provider of our authentication service); mail is transported by Amazon Web Services (Amazon SES) as Resend's sub-provider | Recipient e-mail address, message subject and body (a one-time code or link), delivery status | **EU — Ireland** (Amazon SES `eu-west-1`); sending domain `plus-one.io` (the apex domain, not a subdomain) | EU–US Data Privacy Framework; SCCs | SOC 2 Type II |
| **Stripe** | Stripe Payments Europe, Ltd. (IE) | Subscription billing, hosted checkout and customer portal (SEPA Direct Debit, iDEAL), invoices and dunning | Venue company name, billing e-mail address, EU VAT number, subscription and payment status; the bank account and mandate live only at Stripe. **PlusOne stores no IBAN or card details** | EU; limited transfers to Stripe, Inc. (US) for fraud prevention and support | EU–US Data Privacy Framework; SCCs | PCI DSS Level 1; SOC 2 |
| **Google Workspace** | Google Ireland Ltd. (IE) | Business e-mail, calendar and documents of the PlusOne team | Correspondence with venue team members, billing contacts and prospects; internal documents | EU/US (Google infrastructure; EU data regions where configured) | EU–US Data Privacy Framework; SCCs (Cloud Data Processing Addendum) | ISO 27001; SOC 2 |
| **Attio** | Attio Ltd. (UK) | Customer relationship management, used manually by the PlusOne team; no automated sync from the app | Venue company records and business contact details of venue owners and prospects entered by hand (name, e-mail address, role, venue). **Guest data is never entered or synced** | EU/UK | UK adequacy decision | ISO/IEC 27001:2022 |
| **Slack** | Slack Technologies Ltd. (IE) | Internal team communication and a weekly digest of platform activity, used manually by the PlusOne team; no automated sync from the app | Aggregate counts per venue and venue names only (confirmed 2026-10-05); no personal data | EU/US | EU–US Data Privacy Framework; SCCs | SOC 2 Type II; ISO/IEC 27001:2022; ISO/IEC 27017; ISO/IEC 27018 |

## C. Planned subprocessors (not yet active)

Each of these will be moved to section A or B — with notice to venues per section E where guest data is involved — **before** it processes any personal data.

| Subprocessor | Entity | Purpose | Personal data involved (planned) | Planned location | Planned safeguard |
|---|---|---|---|---|---|
| **Firebase Cloud Messaging** (with the Apple Push Notification service for iOS) | Google Ireland Ltd. / Google LLC; Apple Distribution International Ltd. | Delivery of push notifications to the PlusOne app for iOS and Android | Push token bound to a login session, optional device label, and the notification itself: the push payload carries only an id and a kind (for example, that a guest request was created), never a guest's name or contact details; the visible notification text is generic, e.g. "New guest request". The visible text never shows the event name; details appear only after the tap. | Google and Apple global infrastructure | EU–US Data Privacy Framework; SCCs |
| **Google Analytics** | Google Ireland Ltd. (IE) | Website analytics for plus-one.io (marketing site only, not the app) | Pseudonymized usage data of website visitors; deployed only behind a consent banner | EU/US | EU–US Data Privacy Framework; SCCs |
| **PostHog** | PostHog, Inc. (US) | Product analytics in the app for team members (screen views, feature usage) | Pseudonymized in-app usage events of account holders; **no guest data** | EU region (Frankfurt) | EU–US Data Privacy Framework; SCCs |

## D. Services that are not subprocessors

These services are part of how we build and operate PlusOne but do not process personal data on our behalf.

| Service | Purpose | Why it is not a subprocessor |
|---|---|---|
| **Better Stack** (uptime monitoring) | Pings the public health endpoint `app.plus-one.io/api/health` every minute and alerts the PlusOne team | The endpoint returns only a status ("ok" / "error"); no personal data is sent or stored |
| **Apple App Store, Google Play** (app distribution) | Distribution of the PlusOne app for iOS and Android | Independent controllers for your download, store account and any crash report you send them; PlusOne receives no personal data from the stores |
| **Codemagic** (native build pipeline) | Builds and signs the iOS/Android app shell | Builds from source code and signing certificates only; no access to the database or to user data |
| **GitHub** (source code and CI) | Source code hosting and automated tests | Tests run against a local database with fictitious seed data; no production data |

## E. Changes to this list

We notify venues (venue admin contacts, by e-mail) at least **30 days** before a new subprocessor starts processing guest data (section A). Venues may object on reasonable, data-protection-related grounds as set out in the DPA. Changes to sections B–D, and the activation of a planned item that involves no guest data, are published on this page without a separate notice. The current version of this list is always available at `https://plus-one.io/legal#subprocessors`.

**Version history**

| Version | Date | Change |
|---|---|---|
| 0.3 | 2026-10-05 | Anthropic added to A (engineering and support tooling); Attio and Slack moved from C to B (in use by the team, manual, no sync from the app); Resend sender domain `plus-one.io`; push text never shows the event name; entity details filled in |
| 1.0 | 2026-10-06 | First published version (after legal review) |
| 1.1 | 2026-10-06 | Resend added to A for the guest confirmation e-mail on the venue's behalf (30-day notice per section E; activation no earlier than the end of that period); certifications filled in for Supabase, Vercel, Resend, Attio and Slack |
