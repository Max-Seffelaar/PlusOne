# PLUSONE — Privacy Policy

> **DRAFT v0.1 — 9 July 2026 — NOT LEGALLY REVIEWED.**
> This draft must be reviewed by a Dutch lawyer before publication and before any customer signs. Bracketed placeholders `[like this]` must be completed first.

**Last updated:** [date of publication]

---

## 1. Who we are

PLUSONE is a guest list management platform for venues and event organizers ("**PLUSONE**", "**we**", "**us**"). The platform is operated by:

- **Legal entity:** [PlusOne V.O.F. / PlusOne B.V.]
- **Chamber of Commerce (KvK):** [KvK number]
- **Registered address:** [address]
- **Contact for privacy matters:** [privacy@ e-mail address]

This privacy policy explains how we handle personal data in connection with the PLUSONE platform (the web application, the door check-in app, and public guest request pages) and our business operations.

## 2. Our two roles: controller and processor

PLUSONE processes personal data in two distinct legal roles under the EU General Data Protection Regulation (GDPR / AVG):

1. **PLUSONE as processor.** Guest data — the names and contact details of people on a guest list — is entered into the platform by or on behalf of a **venue**. For that data, the **venue is the data controller** and PLUSONE is the **data processor**: we only process guest data on the venue's instructions, under a Data Processing Agreement (DPA). **If you are a guest and want to know how your data is used, exercise your rights, or have your data removed, please contact the venue that manages the guest list you are on.** We support venues in handling such requests (see section 8).

2. **PLUSONE as controller.** For everything needed to run our own business — staff user accounts, billing, our website, customer relationship management, and support — PLUSONE decides the purposes and means of processing and acts as the **data controller**.

Part A below covers the data we process as controller; Part B covers guest data we process as processor on behalf of venues.

---

## Part A — Data we process as controller

## 3. Categories of data, purposes and legal bases

### 3.1 Platform user accounts (venue staff, organizers, door hosts)

Accounts are created by invitation only. For each user we process:

- Name, e-mail address, and optionally a phone number and job title;
- Authentication data: one-time login codes (e-mail OTP), session and refresh tokens, and — if the user voluntarily enables two-factor authentication — a TOTP enrolment;
- Role assignments per venue and per event (e.g. admin, staff, door host);
- Acceptance of terms (timestamp and version);
- Activity records in the audit log (which actions a user performed in the platform — see section 3.5).

**Purpose:** providing access to the platform, securing accounts, enforcing role-based permissions, and fraud prevention.
**Legal basis:** performance of the contract with the venue (Art. 6(1)(b) GDPR) and our legitimate interest in securing the platform (Art. 6(1)(f)).

A user account exists independently of any single venue: removing a user from one venue does not delete the account or affect their access at other venues. Only the user can change their own e-mail address.

### 3.2 Billing and subscription data

For paying venues we process the venue's business details, the billing contact's name and e-mail address, subscription status, and Stripe reference IDs (`customer` and `subscription` identifiers). Payment is handled entirely by **Stripe** (SEPA Direct Debit and iDEAL). **We never store bank account numbers, IBANs, or card details** — those stay with Stripe.

**Purpose:** invoicing and subscription management.
**Legal basis:** performance of contract (Art. 6(1)(b)) and legal (tax) obligations (Art. 6(1)(c)).

### 3.3 Prospects and customer relationship management

We keep business contact details of (prospective) customers — venue name, contact person, business e-mail address, phone number, and the status of our commercial relationship — in our CRM system. Once our CRM integration (Attio) is live, this also includes aggregated, non-personal platform usage indicators per venue (e.g. number of events in the last 30 days). **No guest data is ever synced to our CRM.**

**Purpose:** sales, onboarding, and account management.
**Legal basis:** legitimate interest in operating and growing our business (Art. 6(1)(f)).

### 3.4 Support and correspondence

When you contact us, we process your contact details and the content of the correspondence (e-mail via Google Workspace).

**Purpose:** answering questions and providing support.
**Legal basis:** legitimate interest (Art. 6(1)(f)) or performance of contract (Art. 6(1)(b)).

### 3.5 Platform integrity: audit log and error monitoring

- **Audit log.** Every relevant action in the platform (adding, changing or checking in a guest, changing quotas, locking a list, changing roles, billing status changes) is recorded automatically at the database level: who did what, when, and what changed. This log is append-only and cannot be edited by anyone, including us through the application. Purpose: fraud resistance and accountability — core features of the product. Legal basis: legitimate interest (Art. 6(1)(f)) and performance of contract.
- **Error monitoring (Sentry).** When a technical error occurs we send a scrubbed error report to Sentry (EU data residency, Germany). Reports are aggressively filtered before sending: no request bodies, no cookies, no headers, no query strings, no IP addresses, no e-mail addresses or phone numbers; a user is identified by a random internal ID only. Session replay is disabled. Legal basis: legitimate interest in a stable, secure service (Art. 6(1)(f)).
- **Uptime monitoring (Better Stack).** Our uptime monitor only calls a public health endpoint and processes no personal data.

### 3.6 Website visitors and cookies

The PLUSONE application uses only **functional cookies and storage** that are strictly necessary to operate the service:

- Authentication/session cookies (keeping you logged in securely);
- Local storage on door devices for offline operation (see section 12).

We currently use **no analytics or tracking cookies**. If we introduce analytics (Google Analytics and/or product analytics such as PostHog are planned), we will do so with EU data residency where available, update this policy, and — where legally required — ask for consent via a cookie banner before placing non-functional cookies.

---

## Part B — Guest data we process on behalf of venues

## 4. What guest data the platform holds

Venues use PLUSONE to manage guest lists for their events. Depending on what the venue or the guest provides, the platform processes:

| Category | Fields |
|---|---|
| Guest list entries | Full name; optionally e-mail address, phone number, and a note; number of accompanying guests (+1s); guest tier/category; status (pending, approved, denied, checked in, refused, removed) |
| Public guest requests | Full name; optionally e-mail address, phone number and motivation, submitted by the guest via a public request page or personal invite link; explicit marketing opt-in choice; decision and decision reason |
| Venue address book (contacts) | Full name; optionally e-mail address, phone number, birthdate, note, preferred tier — reusable across the venue's events |
| Door records | Check-in time, number of guests arrived, device identifier, the staff member who performed the check-in; refusals with time and reason |
| Audit trail | Before/after snapshots of changes to the records above (redacted after the retention period — see section 5) |

Guest data enters the platform in two ways: **(a)** venue staff add guests directly, and **(b)** guests submit their own details through a public request page or personal invite link for a specific event. Public submissions are protected against abuse (rate limiting per hashed IP — raw IP addresses are not stored — and anti-enumeration measures) and only become guest list entries after the venue approves them (unless the venue has enabled auto-approval for a specific link).

**Marketing:** if a guest ticks the explicit marketing opt-in when submitting a request, the venue (not PLUSONE) may use the provided contact details for its own marketing. PLUSONE itself never contacts guests.

## 5. Retention and anonymization of guest data

- Retention is **configured per venue** (1–60 months; **default 12 months**), anchored to the **end date of the event** — not the date a record was created.
- An automated job runs **daily** and **irreversibly anonymizes** expired records: names are replaced with a neutral label (e.g. "Gast #12"), and e-mail addresses, phone numbers, notes, motivations and refusal reasons are erased. Status-check links for guest requests are revoked at the same time.
- Anonymization also **rewrites the audit log**: personal data inside historical before/after snapshots is redacted while the non-personal structure (who acted, when, what type of change) is preserved for fraud prevention and accountability.
- Address book contacts are anonymized once they are no longer linked to any retained event and have been inactive for the retention period.
- Non-personal statistics (attendance counts, +1 totals, tier occupancy) survive anonymization; they can no longer be linked to a person.

## 6. Erasure on request (right to be forgotten)

Venues can erase a specific person **immediately, without waiting for the retention period**, using the built-in "forget" function. This anonymizes the person's address book entry, every guest list entry linked to them across the venue's events, refusal records, and all personal data in the related audit history, in one irreversible operation. Guests should direct erasure requests to the venue; we assist the venue as processor (see our DPA).

---

## 7. Recipients and subprocessors

We do not sell personal data. We share personal data only with:

- **Subprocessors** that host or support the platform (Supabase, Vercel, Stripe, Sentry, Google Workspace, and planned additions). The current list, including regions and safeguards, is maintained in our **Subprocessor List** ([link to subprocessor page]).
- **Government or judicial authorities**, where we are legally required to do so.
- **A prospective acquirer** of our business, under confidentiality obligations, if PLUSONE is ever sold or merged.

## 8. International transfers

The platform's primary data storage and hosting are in the **European Union**: the database and authentication run in Ireland (Supabase, AWS `eu-west-1`), the application is served from Frankfurt, Germany (Vercel `fra1`), and error monitoring uses Sentry's EU region (Germany). Where a subprocessor's parent entity is established outside the EEA (e.g. US-based providers), transfers are safeguarded by the **EU Standard Contractual Clauses** and, where applicable, an adequacy decision such as the EU–US Data Privacy Framework. Details per subprocessor are in the Subprocessor List.

## 9. Security

Key measures include:

- Row-level security enforced **in the database** as the hard authorization boundary — every query is checked against the user's venue memberships and roles;
- Passwordless authentication (e-mail one-time codes), invite-only accounts, optional two-factor authentication (TOTP), short-lived access tokens with refresh rotation, and admin-controlled remote logout of devices;
- Encryption in transit (TLS) and at rest;
- An append-only, trigger-based audit log that cannot be bypassed by the application;
- Soft-deletion only — destructive deletes are revoked at the database level;
- Aggressive scrubbing of personal data from error reports and logs (no personal data in URLs or logs);
- Rate limiting and anti-enumeration protection on all public endpoints.

## 10. Your rights

Under the GDPR you have the right to access, rectify, and erase your personal data, to restrict or object to processing, to data portability, and to withdraw consent where processing is based on consent.

- **Guests:** exercise these rights with the **venue** that manages your data (the controller). We support the venue in responding.
- **Platform users, billing contacts, prospects:** contact us at [privacy@ e-mail address]. We respond within one month.

You also have the right to lodge a complaint with the Dutch supervisory authority, the **Autoriteit Persoonsgegevens** (autoriteitpersoonsgegevens.nl), or the supervisory authority of your EU member state.

## 11. Retention as controller

| Data | Retention |
|---|---|
| User accounts | For as long as the account exists; accounts can be deleted on request once no longer linked to active obligations |
| Audit log entries | Retained for platform integrity; personal data inside entries is redacted per the guest retention rules (Part B) |
| Billing records | 7 years (Dutch fiscal retention obligation) |
| CRM / prospect data | For the duration of the (prospective) relationship; removed on request |
| Support correspondence | Up to 2 years after the last contact |

## 12. Offline door devices

The door check-in app is built to keep working when the internet connection drops. For that purpose the guest list of the active event is cached locally on the door device and check-ins are queued locally until connectivity returns. Mitigations: every staff member uses a personal login, sessions are short-lived, an admin can remotely log out any device, and the local cache is cleared on logout.

## 13. Children

PLUSONE is a business tool. We do not knowingly process children's data for our own purposes; age policies for events and their guests are the responsibility of the venue.

## 14. Changes to this policy

We may update this policy from time to time. The current version is always available at [URL]. For material changes we will notify venue admins by e-mail.

## 15. Contact

Questions about privacy: [privacy@ e-mail address].
