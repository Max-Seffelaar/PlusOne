# PLUSONE — Subprocessor List

> **DRAFT v0.1 — 9 July 2026 — NOT LEGALLY REVIEWED.**
> This draft must be reviewed by a Dutch lawyer before publication. Bracketed placeholders `[like this]` must be completed first.

**Last updated:** [date of publication]

PLUSONE ([PlusOne V.O.F. / B.V.], KvK [number]) engages the following subprocessors to provide the PLUSONE guest list platform. This list forms **Annex 2 of our Data Processing Agreement (DPA)**. Customers with a signed DPA are notified of changes as described at the bottom of this page.

## Current subprocessors

These subprocessors are engaged for every customer.

| Subprocessor | Entity | Purpose | Personal data involved | Data location | Safeguards |
|---|---|---|---|---|---|
| **Supabase** | Supabase, Inc. (US) | Database (PostgreSQL), authentication, realtime infrastructure | All platform data, including guest data processed on behalf of venues and user account data | **EU — Ireland** (AWS `eu-west-1`) | DPA; SCCs for the US entity; SOC 2 Type II; data stored and processed in the EU |
| **Vercel** | Vercel, Inc. (US) | Application hosting and delivery (Next.js) | Personal data in transit through the application; server logs (scrubbed of personal data) | **EU — Frankfurt, Germany** (`fra1` compute region) | DPA; SCCs / EU–US Data Privacy Framework; SOC 2 Type II |
| **Stripe** | Stripe Payments Europe, Ltd. (IE) | Subscription billing and payment processing (SEPA Direct Debit, iDEAL) | Venue billing contact details, payment and mandate data. **No guest data.** | EU; limited transfers to Stripe, Inc. (US) | DPA; SCCs / EU–US Data Privacy Framework; PCI DSS Level 1 |
| **Sentry** | Functional Software, Inc. (US) | Error and performance monitoring | Scrubbed technical error reports: internal user ID (random UUID) only — no names, e-mail addresses, IP addresses, request contents or query strings; session replay disabled | **EU — Germany** (Sentry EU data residency, `de.sentry.io`) | DPA; SCCs / EU–US Data Privacy Framework; EU region storage |
| **Google Workspace** | Google Ireland Ltd. (IE) | Business e-mail, documents and internal operations | Correspondence with venue staff, billing contacts and prospects. **No guest data.** | EU/US (Google infrastructure) | DPA (Cloud Data Processing Addendum); SCCs / EU–US Data Privacy Framework; ISO 27001 |

## Planned subprocessors

These services are on our roadmap and are **not yet active**. Each will be added to the list above — with notice to customers per the change procedure below — before it processes any personal data.

| Subprocessor | Purpose | Personal data involved (planned) | Planned data location |
|---|---|---|---|
| **Attio** (Attio Ltd., UK) | Customer relationship management | Venue team business contact details (name, business e-mail, role) and aggregated, non-personal usage metrics per venue. **No guest data will ever be synced.** | EU/UK (UK adequacy decision) |
| **Google Analytics** (Google Ireland Ltd.) | Website analytics | Pseudonymized usage data of website visitors; deployed only behind a consent banner where required | EU/US |
| **PostHog** (PostHog, Inc.) | Product analytics | Pseudonymized in-app usage events for platform users (venue staff); opt-out respected. **No guest data.** | EU region planned |
| **Resend** (Plus Five Five, Inc., US) | Transactional e-mail (branded notifications) | Recipient name and e-mail address of transactional messages | US/EU — to be confirmed before activation |

## Services that do not process personal data

| Service | Purpose | Why it is not a subprocessor |
|---|---|---|
| **Better Stack** (Better Stack, Inc.) | Uptime monitoring | Only calls a public, unauthenticated health endpoint of the platform; no personal data is sent to or stored by the service |

## Changes to this list

We will notify customers (venue admin contacts, by e-mail) at least **30 days** before authorizing a new subprocessor that will process guest data. Customers may object on reasonable, data-protection-related grounds as set out in the DPA. The current version of this list is always available at [URL].
