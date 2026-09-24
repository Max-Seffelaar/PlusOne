# Legal documents — DRAFTS

English-language legal drafts for the paid product, grounded in the actual dataflows of the codebase (retention job `run_privacy_retention`, `forget_contact`, RLS boundary, audit triggers, Sentry scrubbing, Stripe billing, Resend auth mail, Cloudflare Turnstile, the offline door cache, platform admins #49) and the native-app plans (`capacitor-plan-claude-code.md`).

| File | Version | What | Publishes to |
|---|---|---|---|
| `privacy-policy.md` | **v0.2** (2026-09-24, ClickUp `z8uq9m0w3t`) | Dual-role privacy policy, organized per audience (venue team · guests/requesters/promoters · website visitors), incl. door devices and the native apps | `https://plus-one.io/legal#privacy` (marketing site, repo `Plus-One.io`) + Drive `02_Legal/Privacy_AVG_GDPR` |
| `subprocessors.md` | **v0.2** (2026-09-24, `z8uq9m0w3t`) | Subprocessor list: A guest-data (Supabase, Vercel, Sentry, Cloudflare Turnstile) · B controller-side (Resend/SES, Stripe, Google Workspace) · C planned (FCM/APNs, Attio, guest mail, GA, PostHog, Slack) · D not subprocessors (Better Stack, stores, Codemagic, GitHub) · E 30-day notice | `https://plus-one.io/legal#subprocessors` + Drive |
| `data-processing-agreement.md` | v0.1 (2026-07-09, `86ey7q7c2`) — being revised in `z8uq9m0w3u` | Art. 28 GDPR DPA with Annex 1 (processing details), Annex 2 (subprocessors — must mirror `subprocessors.md`, see delta below), Annex 3 (TOMs) | Signed per customer; `https://plus-one.io/legal#dpa` + Drive |
| `terms-of-service.md` | v0.1 (2026-07-09, `86ey7q7c2`) — being revised in `z8uq9m0w3u` | B2B Terms of Service | `https://plus-one.io/legal#terms` + Drive |

The URL convention (`/legal` page on plus-one.io, tab picked by the hash) is fixed in `src/lib/legal.ts` (`TERMS_URL`, `PRIVACY_URL`, `TERMS_VERSION`). The app itself runs on `app.plus-one.io`. The retired pre-2026-09-18 domain must not appear anywhere (`tests/unit/claude-md-references.test.ts` guards CLAUDE.md; grep `docs/legal` by hand).

## Status: DRAFT — not legally reviewed

**Hard requirement: a Dutch lawyer must review the final versions before any customer signs or the documents are published.** Draft cheap with Claude, validate once with a human. Publication of the privacy policy is also a hard dependency for the app-store submission (Fase 17 L1, ClickUp `86ey1vbrj`): both stores require a live privacy URL, and the store data-collection labels (M4/S5) are derived from §12 of the policy.

## Placeholders to fill before lawyer review

Identity (all four docs):
- [ ] Legal entity name + form (V.O.F. / B.V.)
- [ ] KvK number, registered address
- [ ] Contact mailboxes: `privacy@plus-one.io` and `support@plus-one.io` (create them in Google Workspace, or name the addresses that exist)

Privacy policy v0.2 (`[…]` in the text):
- [ ] §10 account inactivity deletion period (draft: 24 months) — does an inactive-account cleanup exist? It does not on `main`; either build it or drop the sentence
- [ ] §10 Sentry error-report retention (draft: 90 days — confirm the project's retention setting)
- [ ] §10 CRM/prospect retention after last contact (draft: 24 months) and support correspondence (draft: 2 years)
- [ ] §10 export window at end of contract (draft: 30 days — must match DPA §11.2)
- [ ] §11.5 processor breach-notification deadline (draft: 48 hours — must match DPA §10.1)
- [ ] §12 push notifications: the payload is **ids + kind only** (N2, PR #336 — no names or e-mails; the device fetches details after the tap) and the text now says so. Still open: whether the **event name** may appear in the visible notification text — decision for N5, and the M4/S5 store labels depend on it
- [ ] §7 the guest confirmation e-mail (`86ey6bn05`) is **under consideration, not scheduled** (CLAUDE.md rule 10 / spec #40(d): the MVP sends guests nothing) — keep the bracketed sentence and the "under consideration" row in subprocessors §C until a decision, then rewrite or drop
- [ ] §14 minimum age for account holders (draft: 16)

Subprocessor list v0.2:
- [ ] Confirm every vendor's contracting entity and certifications against its current DPA page (Supabase, Vercel, Sentry, Cloudflare, Resend, Stripe, Google, Attio, PostHog, Slack) — the repo names no entities; v0.2 carries general-knowledge values
- [ ] Sentry: confirm "Prevent Storing of IP Addresses" is on in the project settings (the code scrubs `event.request`/`event.user`, but Sentry derives `user.geo` from the connecting IP after `beforeSend`)
- [ ] Resend sending domain: still `theoperators.nl` (borrowed, `docs/mail-deliverability.md`); the PlusOne subdomain is F3 (`86ey6b3hv`). Publish with whichever is live
- [ ] Google Workspace: confirm it is the live mailbox provider (task `86ey7q7c2` said "we gaan Google Workspace gebruiken"; the repo only evidences a Drive mirror) and whether EU data regions are configured
- [ ] Slack digest: confirm the digest carries no personal data before it goes live (`docs/attio-crm-plan.md` phase 03)

## Questions for Max / the lawyer

1. **Turnstile is a subprocessor for guest data** (the requester's IP address and browser signals go to Cloudflare on `/e/*`). v0.1 did not list it. Agree with listing it under A, or would the lawyer classify Cloudflare as an independent controller for the bot check?
2. **Sessions screen shows colleagues' IP addresses.** `admin_list_user_sessions` returns `ip` + `user_agent` to venue admins (`src/features/po/adapters.ts:942`). The policy discloses it (§3). Keep, or mask the IP in the UI?
3. **Platform admins (#49)** have cross-venue read+write for support; writes are audited, reads are not. The policy says so (§8, §11.3). Is that disclosure enough, or does the lawyer want a support-access clause in the DPA (time-boxed, on request) as the Attio plan once proposed?
4. **Developer tooling that reads production data.** Claude Code sessions have read prod state through the Supabase, Resend and Sentry MCP connectors (`docs/changelog.md`, mail-deliverability check). That puts production personal data in front of Anthropic's API under Anthropic's commercial terms. Either add Anthropic as a subprocessor (purpose: engineering support tooling) or forbid prod-data access via MCP in the operating rules. Decision needed; nothing in v0.2 mentions it yet.
5. **Attio People sync** will process the name and e-mail of every team member, incl. staff/door accounts that often use private addresses (`docs/attio-crm-plan.md`). Legitimate interest with an opt-out, or consent? The lawyer decides; the policy currently lists it as planned under legitimate interest (§6).
6. **Marketing opt-in on the request form** is stored but never shown to the venue and cannot be exported. Is it honest to call it a "choice between you and the venue" while the venue cannot act on it? Either surface it in the inbox/export, or drop the checkbox until it is usable.
7. **Guest-facing notice on `/e/[slug]`.** The public form shows a one-line privacy note and links to no policy, and never names the venue as controller (only "the organizer of this event"). Art. 13 information is the venue's duty, but the page is ours. Recommendation: add a "How your details are used" link (to `#privacy` §4 and the venue's own notice) and name the venue. Code change outside this task.
8. **Minimum age** for account holders: 16 (Dutch AVG consent age) or 18 (door work at clubs)?
9. **Brand casing.** This PR writes "PlusOne"; the terms PR (#334) and the v0.1 DPA write "PLUSONE". Pick one for all four documents (and the legal entity line) — the marketing site and app UI use "PlusOne".

## Code follow-ups the policy text assumes (not built on `main`)

The v0.2 text describes the intended behaviour. Each item below is a place where the code on `main` falls short of the text; either fix the code or soften the text before publication.

- **`guest_requests` anonymization is incomplete.** `run_privacy_retention()` nulls name, e-mail, phone, motivation, decision fields and the status token, but leaves `birthdate`, `marketing_opt_in` and `dedupe_key` (the lowercased e-mail or the phone digits, in plain text) in place. Policy §10 says e-mail addresses and phone numbers are erased. Fix: null `dedupe_key` and `birthdate` in the same step (the dedupe index is only needed while the request is live).
- **`forget_contact()` does not reach landing requests** (header comment of `20260624120000`): a person's `guest_requests` rows survive an immediate-erasure request until the nightly sweep. Policy §10 says "every guest list entry linked to it"; requests should be included.
- **`check_ins.device_id` and `audit_log.device_id`** are never anonymized. Random UUIDs, not PII on their own, but they link door actions across events. Accepted as-is in v0.2 (§3 discloses the identifier); note it in the DPA Annex 1 or scrub at anonymization.
- **No retention for `audit_log` rows or for the diffs of `invites` (e-mail), `influencers` (name, handle, notes), `venue_memberships` (job title) and `platform_invites` (e-mail, note).** Policy §10 says the audit trail is kept for the life of the venue with personal data redacted "when the underlying record is anonymized" — true for guests/contacts/requests, not for those four tables, which are never anonymized. Decide: add them to the retention job, or state their retention explicitly.
- **`platform_invites` (prospect e-mail + free-text note) has no retention** (#49 open point). Policy §10 promises [24 months] after last contact. Needs a sweep, or a manual runbook step.
- **Inactive-account deletion** (§10, [24 months]) does not exist. Build it or drop it.
- **`retention_months` changes are not audited** (only `allow_uncheck` on `venues` is). Cheap to add to the venues audit trigger; worth it because retention is a controller instruction under the DPA.
- **Native app (Fase 17):** the "no advertising ID / no analytics SDK" commitment in §12 has no line in the plan yet. N3/N5 must verify that `@capacitor/push-notifications` + `firebase-messaging` is pulled in **without** Firebase Analytics/Crashlytics, and M4/S5 must copy the §12 statements into the store labels. Push-token retention (sign-out, admin revoke, 90-day TTL, FCM `UNREGISTERED` prune) matches plan §3 and PR #336 — keep them aligned. Note for N5: `signOutDevice` does not delete tokens server-side; N5 must call `unregister()` before the IDB wipe or policy §12's "deleted when you sign out" is only true via the revoke path.
- **Sentry offline queue** (IndexedDB) is not cleared by `signOutDevice` (`plusone-door` DB, Cache Storage and the outbox are). Scrubbed events only, so no guest PII, but the policy's "everything is wiped at sign-out" (§12) is about the door copy; keep it that way or add the queue to the wipe.

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

## DPA Annex 2 delta (for the `z8uq9m0w3u` session — do not edit here)

`data-processing-agreement.md` Annex 2 lists Supabase, Vercel and Sentry as guest-data subprocessors and mentions Stripe/Google Workspace as controller-side. To stay consistent with `subprocessors.md` v0.2 it must:

1. **Add Cloudflare, Inc. (Turnstile)** to the guest-data table: purpose "bot protection on public guest request pages", location "Cloudflare global network", data "requester IP address and browser signals during the check; nothing stored".
2. **Add Resend (Plus Five Five, Inc.) — with Amazon SES `eu-west-1` as sub-provider — to the controller-side sentence** next to Stripe and Google Workspace (auth mail to team members; no guest data). It is active, not planned.
3. **Add the planned guest-data items with the 30-day-notice hook:** Firebase Cloud Messaging / APNs (push content may reference a guest request) and the Resend guest confirmation mail (`86ey6bn05`). Attio, GA, PostHog and Slack are controller-side only and need no notice.
4. Point the `[URL]` for the list at `https://plus-one.io/legal#subprocessors`.
5. §8.1 (transfers) should add "login e-mail delivery via Amazon SES in Ireland" and the Vercel edge-network caveat used in policy §9.
6. §11.2 (export within 30 days): there is **no self-service export on `main`** (CSV exists only as an import). Either the DPA promises an export "on request, delivered by PlusOne", or an export feature is built before the first DPA is signed.

## Stale statements noticed in other docs (out of scope here, for whoever owns them)

- `docs/ARCHITECTURE.md` line ~20: "Supabase (eu-central-1, Frankfurt)" — the project is `eu-west-1` (Ireland).
- `docs/runbook.md` lines ~21/81: "default Supabase SMTP" — prod mail goes through Resend as custom SMTP (`docs/mail-deliverability.md`).
- `docs/auth-setup.md` line 3: "MFA-mandatory" — optional for all roles since `20260702120000`.
- `docs/uptime-setup.md`: the health probe queries `request_links` head-only, not `venues`.
- `docs/privacy.md` §5/§6: says MFA is mandatory for admin/finance and lists only Supabase/Vercel/Stripe as subprocessors (missing Sentry, Resend, Turnstile).
- `docs/changelog.md` 2026-07-09 legal entry: lists Resend as "planned"; it has been the live auth-mail provider since at least July.
