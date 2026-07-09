# Legal documents — DRAFTS

English-language legal drafts for the paid product (Prod-ready 9/7 — task 11, ClickUp `86ey7q7c2`), grounded in the actual dataflows of the codebase (retention job `run_privacy_retention`, `forget_contact`, RLS boundary, audit triggers, Sentry scrubbing, Stripe billing).

| File | What | Publishes to |
|---|---|---|
| `privacy-policy.md` | Dual-role privacy policy (PLUSONE as controller for accounts/billing/CRM; as processor for guest data) | Website + Drive `02_Legal/Privacy_AVG_GDPR` |
| `data-processing-agreement.md` | Art. 28 GDPR DPA (verwerkersovereenkomst) with Annex 1 (processing details), Annex 2 (subprocessors), Annex 3 (TOMs) | Signed per customer; Drive `02_Legal/Privacy_AVG_GDPR` |
| `subprocessors.md` | Subprocessor list: current (Supabase, Vercel, Stripe, Sentry, Google Workspace) + planned (Attio, GA, PostHog, Resend) + no-PII tools (Better Stack); 30-day change notice | Website + Drive `02_Legal/Privacy_AVG_GDPR` |
| `terms-of-service.md` | B2B Terms of Service (trial, Stripe billing, fair use, liability cap, data export, Dutch law) | Website + Drive `02_Legal/Terms_and_Conditions` |

## Status: DRAFT — not legally reviewed

**Hard requirement (per task): a Dutch lawyer must review the final versions before any customer signs or the documents are published.** Draft cheap with Claude, validate once with a human.

## Placeholders to fill before lawyer review

- [ ] Legal entity name + form (V.O.F. / B.V.) — all four docs
- [ ] KvK number, registered address — all four docs
- [ ] Privacy / support / legal contact e-mail addresses
- [ ] Website / pricing / policy URLs (domain not yet chosen)
- [ ] Competent court district (ToS §17)
- [ ] Bracketed notice periods to confirm (30 days price change / terms change, 2-year confidentiality)
- [ ] Support response targets (ToS §9.3)

## Keep in sync with the code

These documents state facts about the system. If any of the following change, update the docs in the same PR: retention defaults/range (`venues.retention_months`, 1–60, default 12), anonymization job behaviour, `forget_contact` scope, subprocessor set or regions (Supabase eu-west-1, Vercel fra1, Sentry EU/de), payment methods (SEPA + iDEAL), trial length (14 days), soft-block behaviour (door of planned events never gated).
