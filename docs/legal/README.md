# Legal documents — DRAFTS

English-language legal drafts for the paid product, grounded in the actual dataflows of the codebase (retention job `run_privacy_retention`, `forget_contact`, RLS boundary, audit triggers, Sentry scrubbing, Stripe billing, Resend auth mail, Cloudflare Turnstile, the offline door cache, platform admins #49) and the native-app plans (`capacitor-plan-claude-code.md`).

| File | Version | What | Publishes to |
|---|---|---|---|
| `privacy-policy.md` | **v0.3** (2026-10-05, `z8uq9m2hm1`) | Dual-role privacy policy, organized per audience (venue team · guests/requesters/promoters · website visitors), incl. door devices and the native apps | `https://plus-one.io/legal#privacy` (marketing site, repo `Plus-One.io`) + Drive `02_Legal/Privacy_AVG_GDPR` |
| `subprocessors.md` | **v0.3** (2026-10-05, `z8uq9m2hm1`) | Subprocessor list: A guest-data (Supabase, Vercel, Sentry, Cloudflare Turnstile, Anthropic) · B controller-side (Resend/SES, Stripe, Google Workspace, Attio, Slack) · C planned (FCM/APNs, guest mail, GA, PostHog) · D not subprocessors (Better Stack, stores, Codemagic, GitHub) · E 30-day notice | `https://plus-one.io/legal#subprocessors` + Drive |
| `data-processing-agreement.md` | **v0.3** (2026-10-05, `z8uq9m2hm1`) | Art. 28 GDPR DPA with Annex 1 (processing details), Annex 2 (subprocessors — mirrors `subprocessors.md`), Annex 3 (TOMs) | Signed per customer; `https://plus-one.io/legal#dpa` + Drive |
| `terms-of-service.md` | **v0.3** (2026-10-05, `z8uq9m2hm1`) | B2B Terms of Service | `https://plus-one.io/legal#terms` + Drive |
| `guest-terms.md` | **v0.3** (2026-10-05) — the text lands with A2 (`z8uq9m2hm2`); the file still reads v0.2 until then | Short consumer terms for guests and requesters on the public request/status pages; Dutch version `guest-terms.nl.md` comes with A2 | `https://plus-one.io/legal#guest-terms` + Drive |

Publication (Legal v0.3 golf D, `z8uq9m2hm7`) happens after the lawyer's OK and turns every document into "Version 1.0, [publication date]"; until then the repo holds drafts v0.3.

The URL convention (`/legal` page on plus-one.io, tab picked by the hash) is fixed in `src/lib/legal.ts` (`TERMS_URL`, `PRIVACY_URL`, `TERMS_VERSION`). The app itself runs on `app.plus-one.io`. The retired pre-2026-09-18 domain must not appear anywhere (`tests/unit/claude-md-references.test.ts` guards CLAUDE.md; grep `docs/legal` by hand)..

## Status: DRAFT — not legally reviewed

**Hard requirement: a Dutch lawyer must review the final versions before any customer signs or the documents are published.** Draft cheap with Claude, validate once with a human. Publication of the privacy policy is also a hard dependency for the app-store submission (Fase 17 L1, ClickUp `86ey1vbrj`): both stores require a live privacy URL, and the store data-collection labels (M4/S5) are derived from §12 of the policy.

## Placeholders to fill before lawyer review

Decided and filled in for v0.3 (2026-10-05, `legal-v03-plan-claude-code.md` §7.1):
- [x] Entity: The Operators, sole proprietorship (eenmanszaak), owner Max Merlijn Seffelaar, KvK 99992841, Goirkestraat 74-14, 5048 GM Tilburg (all docs)
- [x] Mailboxes `privacy@`, `support@`, `legal@plus-one.io` — **create them (or name the addresses that exist) before publication**
- [x] Brand casing: PlusOne in all documents (decided 2026-09-24)
- [x] Court: Rechtbank Zeeland-West-Brabant (ToS 20.2, DPA 14.3); cap floor EUR 5,000 (ToS 14.2, lawyer may adjust); support first response within 24 hours, every day (ToS 11.4); pricing URL `https://www.plus-one.io/pricing` (must exist); English prevails for ToS/DPA, Dutch for the Guest Terms (lawyer confirms wording)
- [x] Retention: Sentry 30 days; Supabase backups 7 days; inactive accounts "on request"; audit records of accounts/memberships/invites/promoters kept for the life of the venue; `platform_invites` 24 months after last contact
- [x] Push text never shows the event name (D12); Resend sender domain is the apex `plus-one.io` (D13)

Still open — `[…]` in the text:
- [ ] Privacy §10 CRM/prospect retention after last contact (draft: 24 months) and support correspondence (draft: 2 years) — until the lawyer has seen them
- [ ] Privacy §10 / DPA 11.2 / ToS 16.5 export window at end of contract (draft: 30 days) and Privacy §11.5 / DPA 10.1 breach-notification deadline (draft: 48 hours) — the two documents must match
- [ ] ToS notice periods (draft values accepted unless the lawyer says otherwise): price change [30] days (7.5), partner arrangement early end [30] days (7.8), restricted-state termination [90] + [30] days (16.2), terms change [30] days (18.1), confidentiality survival [2] years (13.3); 11.1 optional SLA reference
- [ ] Privacy §7 the guest confirmation e-mail (`86ey6bn05`) is **under consideration, not scheduled** (CLAUDE.md rule 10 / spec #40(d)) — keep the bracketed sentence and the "under consideration" row in subprocessors §C until a decision
- [ ] **Anthropic** (new in v0.3): contracting entity, DPA/commercial-terms link, transfer safeguard (EU–US DPF / SCCs) and certifications — `[verify]` in `subprocessors.md` section A (the DPA Annex 2 row mirrors it)
- [ ] **Cap fallback for a data breach** (new): decided *not* to be in the ToS; Max and Joeri fix the amount (plan §7.3 proposes 3× annual fee, minimum EUR 25,000) as an addendum template, below the insured sum
- [ ] **Backups** (new): confirm the Supabase plan really retains 7 days of backups (stated in DPA 11.4/Annex 1.E/Annex 3 and Privacy §11.4)
- [ ] Partner/pilot terms (ToS 7.8) and PlusOne's right to terminate for convenience (ToS 16.2) were written from decisions 12 and 14 of the plan; the external reviewer's wording was not in the repo — compare and swap in if it differs
- [ ] Insurance: AVB/BAV with cyber and data-breach cover before the first paying customer (plan §7.2); confidentiality agreement with Joeri (DPA §5)

Subprocessor list v0.3:
- [ ] Confirm every vendor's contracting entity and certifications against its current DPA page (Supabase, Vercel, Sentry, Cloudflare, Resend, Stripe, Google, Attio, Slack, and Anthropic — see above); the repo names no entities and the list carries general-knowledge values
- [ ] Sentry: confirm "Prevent Storing of IP Addresses" is on in the project settings (the code scrubs `event.request`/`event.user`, but Sentry derives `user.geo` from the connecting IP after `beforeSend`); screenshot to Drive `02_Legal/`
- [ ] Resend sender: the decision is the apex `plus-one.io`, no subdomain. `docs/mail-deliverability.md` still records the 2026-07-09 state (a borrowed domain of another brand); confirm the live SMTP sender is already `@plus-one.io` and close or reword F3 `86ey6b3hv`
- [ ] Google Workspace: confirm it is the live mailbox provider and whether EU data regions are configured

## Questions for Max / the lawyer

1. **Turnstile is a subprocessor for guest data** (the requester's IP address and browser signals go to Cloudflare on `/e/*`). Listed under A in v0.2/v0.3. Agree, or would the lawyer classify Cloudflare as an independent controller for the bot check?
2. **Sessions screen shows colleagues' IP addresses.** `admin_list_user_sessions` returns `ip` + `user_agent` to venue admins (`src/features/po/adapters.ts:942`). The policy discloses it (§3). Keep, or mask the IP in the UI?
3. [x] **Platform admins (#49)** — decided 2026-10-05: lightweight variant. Venue-switch by a platform admin is logged in `platform_access_log` (B3, `z8uq9m2hm5`), not visible to the customer, shared on request (DPA 4.4, ToS 10.3, Privacy §8). The heavy variant (DB-enforced support sessions) is backlog ≥25.
4. [x] **Developer tooling that reads production data** — decided 2026-10-05: Anthropic becomes a subprocessor (section A). Working rule in CLAUDE.md via B3: schema, logs, advisors and aggregates by default; guest rows only for a concrete support ticket or incident, with a `platform_access_log` row or ClickUp reference.
5. **Attio** now runs by hand (no automated sync from the app) and is listed under B. A People sync would need a legal-basis decision again (legitimate interest with opt-out, or consent) — the lawyer decides before any sync is built.
6. [x] **Marketing opt-in on the request form** — decided 2026-10-05: the checkbox stays; `marketing_opt_in` is in the export and becomes visible on the request card and contact detail (E1, `z8uq9m2hm6`). The text stays because it becomes true.
7. [x] **Guest-facing notice on `/e/[slug]`** — decided 2026-10-05: acceptance line above the submit button plus the venue name instead of "the organizer of this event" (B2, `z8uq9m2hm4`).
8. [x] **Minimum age** for account holders — decided 2026-10-05: 16 stays (GDPR consent age; a 17-year-old door or cloakroom helper is lawful work; guest age is venue policy).

## Code follow-ups the policy text assumes

The v0.3 text describes the intended behaviour; each item below is a place where `main` falls short until the named task lands. Either the task ships or the text is softened before publication.

- **`guest_requests` anonymization is incomplete** → B1 (`z8uq9m2hm3`): `run_privacy_retention()` must also null `dedupe_key` and `birthdate`.
- **`forget_contact()` does not reach landing requests** → B1 (`z8uq9m2hm3`): DPA 9.1, Privacy §10 and ToS 9.6 say requests are included.
- **`platform_invites` has no retention** → B1: sweep at 24 months after last contact (Privacy §10).
- **Platform admin access to a venue is not logged** → B3 (`z8uq9m2hm5`): `platform_access_log` on every venue switch (DPA 4.4, ToS 10.3, Privacy §8).
- **No self-service export** → E1 (`z8uq9m2hm6`): DPA 11.3, ToS 9.5/16.5 and Privacy §10 say the customer can export during the term; CSV exists only as an import on `main`.
- **Request page** → B2 (`z8uq9m2hm4`): venue name, Guest Terms acceptance line, links.
- **`check_ins.device_id` / `audit_log.device_id`** — accepted as-is (2026-10-05): disclosed in DPA Annex 1.D ("random browser identifier, not anonymized"). No code.
- **Inactive-account deletion** — decided (2026-10-05): no sweep; the text says "on request".
- **Audit diffs of `invites`, `venue_memberships`, `influencers`** — decided: kept for the life of the venue and deleted with it (Privacy §10, DPA Annex 1.E/3). No anonymization.
- **`retention_months` changes are not audited** (only `allow_uncheck` on `venues` is). Cheap to add to the venues audit trigger; worth it because retention is a controller instruction under the DPA. Not scheduled.
- **Native app (Fase 17):** the "no advertising ID / no analytics SDK" commitment in §12 has no line in the plan yet. N3/N5 must verify that `@capacitor/push-notifications` + `firebase-messaging` is pulled in **without** Firebase Analytics/Crashlytics, and M4/S5 must copy the §12 statements into the store labels. Push-token retention (sign-out, admin revoke, 90-day TTL, FCM `UNREGISTERED` prune) matches plan §3 and PR #336 — keep them aligned. N5 must call `unregister()` before the IDB wipe or §12's "deleted when you sign out" is only true via the revoke path, and the push text never shows the event name (D12).
- **Sentry offline queue** (IndexedDB) is not cleared by `signOutDevice` (`plusone-door` DB, Cache Storage and the outbox are). Scrubbed events only, so no guest PII; §12's "everything is wiped at sign-out" is about the door copy.

## Keep in sync with the code

These documents state facts about the system. If any of the following change, update the docs in the same PR:

- retention: `venues.retention_months` (1–60, DB default 12, settings UI 6/12/24, onboarding wizard 24), anchor `coalesce(events.ends_at, starts_at)`, job `plusone-privacy-retention` daily 03:30 UTC, labels `Gast #n` / `Aanvraag #n` / `Contact #n`, refusal marker, audit-diff redaction, status-token revocation
- `forget_contact` scope
- door cache contents (`DOOR_GUEST_SELECT` in `src/features/door/queries.ts` — no e-mail; full phone), 7-day `maxAge`, wipe on sign-out (`src/features/auth/sign-out-device.ts`)
- cookies/storage: `sb-<ref>-auth-token` (30 d), `po_active_venue` (365 d), `plusone-device-id`, IndexedDB `plusone-door`, SW caches
- public form fields (name, e-mail, phone required since `20260819110000`; motivation, +N, marketing opt-in; honeypot; Turnstile), throttle windows (15 min, cleanup after 2 h), status link `/r/[token]` (sha256 only, no expiry)
- subprocessor set or regions (Supabase eu-west-1, Vercel fra1, Sentry de.sentry.io, Resend/SES eu-west-1)
- payment methods (SEPA + iDEAL), what is sent to Stripe (company name, finance e-mail, VAT id, venue id), trial length (14 days), soft-block behaviour (door never gated)
- e-mail: Resend as Supabase custom SMTP; any new outbound mail (guest confirmations `86ey6bn05`) → policy §7 + subprocessors C→B
- push: `push_tokens` schema and retention (`capacitor-plan-claude-code.md` §3, built in PR #336: 90-day TTL, revoke-on-logout, `device_label` ≤120 chars), outbox payload = ids + kind only
- analytics: still none in code; GA (site) / PostHog (app) are consent-gated plans
- export (E1): the self-service export function, its roles (admin only), files and the `export` audit action — DPA 11.3, ToS 9.5/16.5, Privacy §10
- `platform_access_log` (B3): what is logged and who can read it — DPA 4.4, ToS 10.3, Privacy §8
- `GUEST_TERMS_URL` in `src/lib/legal.ts` (B2/D) and the Guest Terms acceptance line on `/e/[slug]`
- Attio and Slack are manual today (subprocessors B); the moment either gets code (a sync, a webhook), re-check the row and the Privacy §8 summary in the same PR. PostHog and FCM/APNs stay in C until their code lands

## DPA Annex 2 delta

Done in v0.3: Turnstile and Anthropic are in the DPA Annex 2 table, Resend/SES in the controller-side sentence, the planned FCM/APNs and guest-mail items carry the 30-day-notice hook, the list URL points at `https://plus-one.io/legal#subprocessors`, §8.1 has the SES and edge-network sentences, and §11 has the self-service export. Keep Annex 2 and `subprocessors.md` in step (see below).

## Stale statements noticed in other docs (out of scope here, for whoever owns them)

- `docs/ARCHITECTURE.md` line ~20: "Supabase (eu-central-1, Frankfurt)" — the project is `eu-west-1` (Ireland).
- `docs/runbook.md` lines ~21/81: "default Supabase SMTP" — prod mail goes through Resend as custom SMTP (`docs/mail-deliverability.md`).
- `docs/auth-setup.md` line 3: "MFA-mandatory" — optional for all roles since `20260702120000`.
- `docs/uptime-setup.md`: the health probe queries `request_links` head-only, not `venues`.
- `docs/privacy.md` §5/§6: says MFA is mandatory for admin/finance and lists only Supabase/Vercel/Stripe as subprocessors (missing Sentry, Resend, Turnstile).
- `docs/changelog.md` 2026-07-09 legal entry: lists Resend as "planned"; it has been the live auth-mail provider since at least July.
