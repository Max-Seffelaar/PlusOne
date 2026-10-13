# TODOS

Deferred work with an owner and an upgrade trigger. Format: `~/.claude/skills/gstack/review/TODOS-format.md`. Shipped history stays in `docs/changelog.md`; this file holds only what is deliberately postponed.

## Payments (Fase 14)

### Fee rules table per provider × method × bearer

**What:** Replace the v1 fee constant + two company columns (`service_fee_fixed_cents`, `service_fee_bp` on `company_payout_accounts`) with the `payment_fee_rules` table from `payments-plan-claude-code.md` §3/§4 (platform defaults, company overrides, company fee per method).

**Why:** Decision 4 (a different fee per payment method and per PSP) needs a per-provider × method × bearer row once a second PSP (P6) or a method-specific company fee exists; v1 has one provider and a €0 company fee, so the table would be dead configuration in the high-risk P1.

**Context:** CEO review 2026-10-12, D19 = B (Max). The fee snapshot on `entry_payments` already records what was charged, so the migration is expand-only: add the table beside the columns, read the table first, fall back to the columns, then drop the columns in a later migration. Start in `src/features/payments/` fee engine + a migration under `supabase/migrations/`.

**Effort:** M (human) / S (CC + gstack)
**Priority:** P2
**Depends on:** P4b (blended-rate report) or P6 (second PSP), whichever comes first

### Retry queue for failed automatic refunds

**What:** An action table + cron/route that retries a failed Stripe refund (over-ceiling / double payment) three times with backoff before falling back to the manual `needs_refund` path.

**Why:** v1 handles a failed automatic refund manually with hard visibility (`needs_refund` status, Platform tab list, Sentry alert; Max refunds in the Stripe dashboard). That is a deliberate shortcut (completeness 7/10): a guest waits for a human.

**Context:** CEO review 2026-10-12, D20.2 = A (Max); gstack decision `24329554-e105-4bb1-be25-abc1d134e693`; the P2 code carries a `gstack-shortcut(dec-24329554)` marker at the fallback. Upgrade trigger: P4b (batch automation lands anyway) or the first week with more than 3 `needs_refund` rows. Reuse the dispatch pattern of `supabase/migrations/20260925120100_push_dispatch_wiring.sql`.

**Effort:** M (human) / S (CC + gstack)
**Priority:** P2
**Depends on:** P2 live; P4b

### P4b — payout automation

**What:** pain.001 SEPA batch export, subscription netting (`send_invoice` + `paid_out_of_band`), the full document engine (receipt, self-billing invoice, weekly statement with continuous numbering per issuer), blended-rate report per company per month.

**Why:** P4a ships the ledger, the weekly statement and the self-billing invoice as a simple PDF with manual SEPA transfers by Max; that holds until ~10 companies receive payouts. Beyond that the manual run is the bottleneck and the margin decision (block or surcharge non-EEA cards) needs the blended-rate numbers.

**Context:** CEO review 2026-10-12, approach C (D13). `company_ledger` and `payout_runs` already carry the payout ledger line per approval, so P4b automates what P4a books. Trigger: 10 companies with a payout or 500 paid entries, whichever first. ClickUp: split of `z8uq9m4a7n`.

**Effort:** L (human) / M (CC + gstack)
**Priority:** P2
**Depends on:** P4a live; accountant sign-off on the self-billing flow

### P2b — open shop on `/e/[slug]`

**What:** Pay-to-join on the public page with the O(1) tier counter (`tier_capacity`), 8-minute holds, lazy + pg_cron release, late-payment policy with oversell percentage, sold-out block, manual sold-out per tier; later Queue-it (P7).

**Why:** The four prospects asked for door payment on one device and prepayment on a named, non-leaking link; nobody asked for an open shop. The shop is ticketing-shaped and needs its own spec decision against #10 (no ticketing in the core).

**Context:** CEO review 2026-10-12, D13 + premise 3 (Max). The v1 data model (payment per guest row, `heads`, fee snapshot, token) does not block it; `tier_capacity`, holds and oversell settings are explicitly not built in v1. Full design is already in `payments-plan-claude-code.md` §4 "Route A en de shop" and spec #62(h); it moves to a P2b section when a venue asks.

**Effort:** L (human) / M (CC + gstack)
**Priority:** P3
**Depends on:** a venue asking for it; a spec decision that draws the #10 boundary

### P6 — second, cheaper PSP

**What:** A second `PaymentProvider` adapter (Pay.nl or Adyen per `docs/psp-shortlist-2026-10.md`) behind the same seam, per payment method.

**Why:** Decision 23: Stripe is for starting and validating; too expensive at scale (≈ €880 vs ≈ €420 per month at 2,400 transactions in the shortlist's example).

**Context:** Quotes to request from Pay.nl and Adyen with the eleven questions in the shortlist §4; the Stripe meeting (P0) covers the same questions for the baseline. The fee rules table (above) lands with or before this.

**Effort:** M (human) / M (CC + gstack)
**Priority:** P3
**Depends on:** P4a live and the first-euro measurement; the fee rules table

### Light variant of the public pages (`/pay`, `/r`)

**What:** A `prefers-color-scheme: light` variant of the public token pages (`/pay/[token]`, `/r/[token]`): a light token set beside the near-black one in `design-system.md`, applied only to the public landing frame.

**Why:** The approval mail link is opened at home in daylight; the pages are dark because the use scene that matters most is a doorway at night. A dark page in bright light is readable (contrast ≥ 7:1) but less comfortable, and the mail-link drop-off is unmeasured.

**Context:** Design review 2026-10-13 (plan §12, Pass 6, D11.4 = A, Max). `/r` has been dark since launch without complaints. Building it means a second visual truth for public pages and a new token set, so it waits for evidence.

**Effort:** M (human) / S (CC + gstack)
**Priority:** P3
**Depends on:** the first-euro measurement — upgrade trigger: mail-link Checkout drop-off above 10 %

## Completed

_(none yet)_
