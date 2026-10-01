# PlusOne — Data Processing Agreement (Verwerkersovereenkomst)

> **DRAFT v0.1.1 — 24 September 2026 — NOT LEGALLY REVIEWED.**
> v0.1 (9 July 2026) amended only where it conflicted with Terms of Service v0.2 (definitions, support access by Platform Administrators, data export on termination). Annex 2 is maintained by the Subprocessor List and was not touched here. This draft must be reviewed by a Dutch lawyer before any customer signs. Bracketed placeholders `[like this]` must be completed first.

This Data Processing Agreement ("**DPA**") forms part of the agreement between:

1. **[PlusOne V.O.F. / PlusOne B.V.]**, registered with the Dutch Chamber of Commerce under number [KvK number], with registered address at [address] ("**PlusOne**" or "**Processor**"); and
2. The customer identified in the applicable order form or online subscription ("**Customer**" or "**Controller**"),

together the "**Parties**", and supplements the PlusOne Terms of Service or other written agreement between the Parties (the "**Agreement**").

## 1. Definitions

Terms such as "personal data", "processing", "controller", "processor", "data subject", "personal data breach" and "supervisory authority" have the meanings given in Regulation (EU) 2016/679 ("**GDPR**"). Capitalized terms not defined here (including "Customer Content", "Event", "Guest", "Native App", "Platform Administrator", "Request Link", "User" and "Venue") have the meaning given in the PlusOne Terms of Service. "**Guest Data**" means personal data of Guests (persons on a guest list, persons who request a spot via a Request Link, and persons checked in or refused at the door) and of address book contacts that the Customer, its Users, or data subjects via the Customer's Request Links enter into the Service; Guest Data is part of Customer Content. "**Subprocessor**" means a third party engaged by PlusOne to process Guest Data on the Customer's behalf.

## 2. Subject matter, roles, and scope

2.1. PlusOne provides a guest list management platform, including guest list administration, Request Links with public request and status pages, door check-in (including offline operation, in the browser and in the Native Apps), quota and tier management, statistics and audit logging (the "**Service**"), as described in the Terms of Service.

2.2. For **Guest Data**, the Customer is the **controller** and PlusOne is the **processor**. PlusOne processes Guest Data exclusively on behalf of and for the purposes of the Customer.

2.3. For personal data that PlusOne processes for its own purposes — user account management, authentication, billing, customer relationship management, scrubbed error diagnostics and platform security/audit integrity — PlusOne acts as an **independent controller**, as described in the PlusOne Privacy Policy. Such processing is outside the scope of this DPA.

2.4. The details of the processing (nature, purpose, duration, data categories, data subjects) are set out in **Annex 1**.

## 3. Duration

This DPA applies for as long as PlusOne processes Guest Data under the Agreement and, thereafter, until all Guest Data has been deleted or anonymized in accordance with clause 11.

## 4. Instructions

4.1. PlusOne processes Guest Data only on the Customer's documented instructions, including with regard to transfers to third countries, unless required to do so by EU or member state law; in that case PlusOne informs the Customer of that legal requirement before processing, unless the law prohibits this.

4.2. The Agreement, this DPA, and the Customer's configuration of the Service (including the venue retention period, guest request link settings, role assignments, and use of the erasure function) constitute the Customer's complete documented instructions. Additional instructions require written agreement of both Parties.

4.3. PlusOne informs the Customer immediately if, in its opinion, an instruction infringes the GDPR or other applicable data protection law.

4.4. **Support access.** The Customer instructs PlusOne that its Platform Administrators may access Guest Data in the Customer's Venue, including by making changes, to the extent reasonably necessary to provide support requested by the Customer, to investigate and resolve incidents and defects, and to protect the security and integrity of the Service. Such access is limited to the purpose at hand, is subject to clause 5 (confidentiality), and every change made through it is recorded in the append-only audit log under the identity of the PlusOne operator concerned, where the Customer can see it. PlusOne does not use this access to take decisions about Guests on the Customer's behalf.

## 5. Confidentiality

PlusOne ensures that every person authorized to process Guest Data (including its own personnel) is bound by a contractual or statutory duty of confidentiality.

## 6. Security (Art. 32 GDPR)

6.1. PlusOne implements and maintains appropriate technical and organizational measures to protect Guest Data, as set out in **Annex 3**. Core measures include: database-enforced row-level security as the authorization boundary, encryption in transit and at rest, an append-only audit trail written by database triggers, passwordless invite-only authentication with optional two-factor authentication, EU-only hosting regions, and automated retention/anonymization.

6.2. PlusOne may update the measures in Annex 3 from time to time, provided the overall level of protection is not reduced.

## 7. Subprocessors

7.1. The Customer grants PlusOne **general written authorization** to engage Subprocessors. The Subprocessors authorized at the date of this DPA are listed in **Annex 2** (the PlusOne Subprocessor List, maintained at [URL]).

7.2. PlusOne will notify the Customer (by e-mail to the venue admin contact) at least **30 days** before authorizing a new Subprocessor that will process Guest Data. The Customer may object within that period on reasonable, data-protection-related grounds. If the Parties cannot resolve the objection in good faith, the Customer may terminate the affected part of the Agreement; PlusOne will refund any prepaid fees for the period after termination. Continued use of the Service after the notice period constitutes acceptance.

7.3. PlusOne imposes on each Subprocessor, by contract, data protection obligations that are materially equivalent to those in this DPA, and remains fully liable to the Customer for the performance of each Subprocessor's obligations.

## 8. International transfers

8.1. Guest Data is stored and processed within the **European Union** (database and authentication in Ireland; application hosting in Frankfurt, Germany; error monitoring in Sentry's EU region, Germany).

8.2. Where a Subprocessor or its parent entity is established outside the EEA, PlusOne ensures a valid transfer mechanism under Chapter V GDPR (an adequacy decision, such as the EU–US Data Privacy Framework, and/or the EU Standard Contractual Clauses), as recorded per Subprocessor in Annex 2.

## 9. Assistance to the Customer

9.1. **Data subject rights (Art. 12–23).** Taking into account the nature of the processing, PlusOne assists the Customer with appropriate technical and organizational measures in fulfilling data subject requests. The Service provides self-service tooling for this purpose, including:
  - full visibility of a data subject's records via the venue address book and audit log;
  - the built-in **erasure function** ("forget contact"): a venue admin can irreversibly anonymize a person's address book entry, all linked guest list entries across the venue's events, refusal records, and the personal data inside the related audit history, in one operation, without waiting for the retention period;
  - configurable retention with automatic anonymization (Annex 1, section E).

  If a data subject request cannot be fulfilled through the Service, PlusOne provides reasonable further assistance on request. If a data subject contacts PlusOne directly about Guest Data, PlusOne will refer the data subject to the Customer without undue delay and will not respond substantively except on the Customer's instruction or where legally required.

9.2. **Security, breach notification, DPIAs (Art. 32–36).** PlusOne assists the Customer, insofar as reasonably possible and taking into account the nature of the processing and the information available to PlusOne, in complying with its obligations regarding security, personal data breach notification, data protection impact assessments, and prior consultation of the supervisory authority.

## 10. Personal data breach

10.1. PlusOne notifies the Customer **without undue delay, and in any event within 48 hours**, after becoming aware of a personal data breach affecting Guest Data.

10.2. The notification includes, to the extent known: the nature of the breach, the categories and approximate number of data subjects and records concerned, the likely consequences, the measures taken or proposed, and a contact point. Information may be provided in phases as it becomes available.

10.3. PlusOne documents all personal data breaches affecting Guest Data and cooperates with the Customer's reporting obligations towards the supervisory authority and data subjects. Notifying the Customer is not an acknowledgement of fault or liability.

## 11. Deletion and return at end of the Agreement

11.1. During the term, the Customer controls retention through the venue retention setting (1–60 months per event; default 12 months) and the erasure function.

11.2. Upon termination of the Agreement, PlusOne will, on the Customer's written request made within **30 days** after termination, provide an **export** of the Customer's non-anonymized Guest Data in a structured, commonly used, machine-readable format (such as CSV or JSON). After this period, PlusOne deletes or irreversibly anonymizes all Guest Data, unless EU or member state law requires longer storage. Non-personal, aggregated statistics (e.g. attendance counts) may be retained, as they no longer relate to an identifiable person. Guest Data that was already anonymized under clause 11.1 before the request cannot be restored.

11.3. On written request, PlusOne confirms in writing that deletion/anonymization has been completed.

## 12. Audits

12.1. PlusOne makes available to the Customer all information reasonably necessary to demonstrate compliance with Art. 28 GDPR, including summaries of relevant third-party certifications and audit reports of its Subprocessors (e.g. SOC 2, ISO 27001).

12.2. The Customer may, at most **once per year** and with at least **30 days'** written notice, conduct (or mandate an independent auditor bound by confidentiality to conduct) an audit of PlusOne's compliance with this DPA. Audits take place during business hours, must not unreasonably disrupt PlusOne's operations, and each Party bears its own costs. Where an audit concerns infrastructure operated by a Subprocessor, PlusOne may satisfy the audit by providing that Subprocessor's current audit reports and certifications.

12.3. If an audit reveals material non-compliance, PlusOne will remedy it without undue delay at its own cost.

## 13. Liability

The liability of each Party under this DPA is governed by the limitations and exclusions of liability in the Agreement, except where mandatory law (including Art. 82 GDPR) provides otherwise.

## 14. Miscellaneous

14.1. In case of conflict between this DPA and the Agreement regarding the processing of Guest Data, this DPA prevails.

14.2. If any provision of this DPA is held invalid, the remainder stays in force; the Parties will replace the invalid provision with a valid one that most closely reflects its intent.

14.3. This DPA is governed by **Dutch law**. Disputes are submitted to the competent court identified in the Agreement.

---

# Annex 1 — Details of the processing

**A. Subject matter and nature of the processing**
Hosting, storage, display, modification, transmission, and automated retention/anonymization of Guest Data as part of the operation of the PlusOne guest list platform, including: guest list administration; intake of guest requests via Request Links (public request pages and personal invite links) and display of the request status to the requester on a token-protected status page; approval workflows; door check-in and refusal registration (including offline caching on door devices with deferred synchronization, in the browser and in the Native Apps); quota and tier management; statistics; append-only audit logging of all changes; and support access by Platform Administrators under clause 4.4.

**B. Purpose of the processing**
Enabling the Customer to manage guest lists for its events: maintaining lists, deciding on guest requests, controlling access at the door, enforcing staff quotas, and auditing changes for fraud prevention.

**C. Categories of data subjects**
- Guests on the Customer's guest lists;
- Persons who submit a guest request via the Customer's public request pages or personal invite links;
- Persons in the Customer's venue address book (contacts);
- (As context in audit records:) the Customer's staff members who perform actions in the platform.

**D. Categories of personal data**

| Data subject | Data |
|---|---|
| Guests | Full name; optionally e-mail address, phone number, note; number of accompanying guests; tier/category; list status; source of entry |
| Guest requesters | Full name; optionally e-mail address, phone number, motivation; marketing opt-in choice; decision and decision reason; hashed status token |
| Address book contacts | Full name; optionally e-mail address, phone number, birthdate, note, preferred tier |
| Door records | Check-in timestamp, party size arrived, device identifier, acting staff member; refusal timestamp and reason |
| Audit trail | Actor, action, timestamp, and before/after values of changed records (personal data within these values is redacted upon anonymization) |

No special categories of personal data (Art. 9 GDPR) are intended to be processed. The Customer instructs its staff and guests not to enter such data in free-text fields (notes, motivations, refusal reasons).

**E. Duration of the processing and retention**
Processing continues for the duration of the Agreement. Guest Data is retained per event for the venue-configured retention period (1–60 months after the event ends; default 12 months), after which an automated daily job irreversibly anonymizes it: names are replaced by neutral labels, contact details and free-text fields are erased, status tokens are revoked, and personal data inside historical audit records is redacted while non-personal audit structure is preserved. Address book contacts are anonymized when no longer linked to retained events and inactive for the retention period. Earlier erasure is available at any time through the built-in erasure function. End-of-contract handling is described in clause 11.

---

# Annex 2 — Authorized Subprocessors

The authorized Subprocessors, including entity, purpose, data location and transfer safeguards, are listed in the **PlusOne Subprocessor List** at [URL], version dated [date]. At the date of this DPA the Subprocessors processing Guest Data are:

| Subprocessor | Purpose | Location of Guest Data |
|---|---|---|
| Supabase, Inc. | Database, authentication, realtime infrastructure | EU — Ireland (AWS `eu-west-1`) |
| Vercel, Inc. | Application hosting and delivery | EU — Frankfurt, Germany (`fra1`) |
| Functional Software, Inc. (Sentry) | Error monitoring (scrubbed reports; internal user ID only, no guest personal data by design) | EU — Germany |

Stripe and Google Workspace process only PlusOne's own controller-side data (billing, correspondence) and no Guest Data; they are listed in the Subprocessor List for transparency.

---

# Annex 3 — Technical and organizational measures (Art. 32 GDPR)

**Access control and authorization**
- Row-level security enforced in the database on every table; authorization is checked at the database layer against venue membership and role for every query — application-layer checks are supplementary, not the boundary.
- Role-based access (multiple roles per user per venue); event-scoped access for external organizers; list-lock mechanism restricting staff mutations.
- Invite-only account creation; passwordless authentication via e-mail one-time codes; optional TOTP two-factor authentication; short-lived access tokens with refresh token rotation; per-user session overview with admin-initiated remote logout.
- Administrative (service-level) credentials exist only in server-side code; automated tests block them from ever reaching client code.

**Data protection by design**
- Data minimization: only a name is required for a guest entry; all other guest fields are optional.
- Client-side no-PII rules: no personal data in URLs, query strings, or logs.
- Public endpoints protected by rate limiting (using salted IP hashes; raw IP addresses are not stored) and anti-enumeration responses.
- Error reports are scrubbed before leaving the platform: request contents, cookies, headers, query strings, IP addresses, e-mail addresses and phone numbers are removed; users appear as random internal IDs; session replay is disabled.

**Integrity and auditability**
- Append-only audit log written by database triggers (cannot be bypassed by application code), recording actor, action, timestamp and before/after values for all guest, quota, tier, check-in and membership changes.
- Hard deletes are revoked at the database level; records are soft-deleted (status change) so history stays auditable.
- Idempotent write operations for offline synchronization (no duplicate or lost door mutations).

**Retention and erasure**
- Automated daily anonymization job per the venue retention setting (Annex 1.E), including structure-preserving redaction of audit history.
- Built-in immediate erasure function for data subject requests (Art. 17 GDPR).

**Infrastructure**
- All primary data storage and processing in EU regions (Ireland, Frankfurt); encryption in transit (TLS) and at rest.
- Hosting on ISO 27001 / SOC 2 certified infrastructure providers (see Subprocessor List).
- Daily automated database backups by the hosting provider; documented backup-restore procedure and incident runbook.
- Uptime monitoring with immediate escalation to on-call personnel.

**Organizational**
- Confidentiality obligations for all personnel with data access.
- Documented incident-response runbook, including personal data breach escalation (clause 10).
- Independent review (code review and security review) required before changes to security-critical surfaces (authorization policies, authentication, audit triggers, billing webhooks).

---

**Signatures**

| | PlusOne (Processor) | Customer (Controller) |
|---|---|---|
| Name | | |
| Title | | |
| Date | | |
| Signature | | |
