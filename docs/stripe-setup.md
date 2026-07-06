# Stripe Billing — setup-runbook (fase 13, beslissing #32)

Alles wat NIET in code leeft: de Stripe-dashboard-configuratie, de env-vars en
het handmatige test-mode-script. De code (adapter, webhook, checkout) staat in
`src/features/billing/` en is **prod-inert zolang de env-vars ontbreken** — de
app draait dan op de stub-provider (trial/comped blijft gewoon werken).

## 1. Dashboard-checklist (Max, eenmalig)

Volgorde is bewust: SEPA-activatie heeft dagen doorlooptijd — start die eerst.

1. **Account**: Stripe-account op de NL-entiteit, KYC afronden.
2. **Betaalmethoden**: **SEPA-incasso activatie aanvragen** (Stripe-review,
   duurt enkele dagen) en **iDEAL** aanzetten. Kaarten uitzetten — de checkout
   stuurt toch alleen `sepa_debit` + `ideal` (afgedwongen in de adapter).
3. **Product + prijs**: product "PlusOne Premium" met een maandprijs
   (bedrag excl. BTW; besluit prijs vóór livegang — de code kent geen bedragen).
   Maak de prijs in **test- én live-mode** en zet beide `price_…`-ids in de env
   (`STRIPE_PRICE_PREMIUM_MONTHLY`). Gratis (Indie) en "op aanvraag" (Pro)
   hebben bewust géén price-id → geen checkout-pad.
4. **BTW**: tax rate **21% NL BTW, exclusive** aanmaken → `txr_…`-id in
   `STRIPE_TAX_RATE_ID`. (Stripe Tax is bewust niet gebruikt: alle klanten zijn
   NL B2B; 0,5% fee onnodig.)
5. **Customer portal** (Settings → Billing → Customer portal): betaalmethode
   wijzigen + factuurhistorie aan; opzeggen = **aan het einde van de periode**.
6. **Dunning** (Settings → Billing → Automatic collection): Smart Retries,
   venster ~2 weken, final action **"Cancel subscription"**. Dit ÍS de
   14-dagen-grace uit het plan: mislukte incasso → `past_due` (banner in de
   app) → na de retries → `customer.subscription.deleted` → `canceled`.
7. **Webhook-endpoint**: `https://<prod-domein>/api/webhooks/stripe` met exact
   deze events: `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Signing secret → `STRIPE_WEBHOOK_SECRET`
   (Vercel env).
8. **Branding**: logo + lavendel-accent, e-mailbonnen op NL/EN, factuur-
   nummering en eigen BTW-nummer op de facturen.

## 2. Env-vars

| Var | Waar | Betekenis |
|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel (live) / `.env.local` (test) | Zonder deze key is billing volledig uit (stub). |
| `STRIPE_WEBHOOK_SECRET` | idem | Signing secret van het endpoint (of van `stripe listen` lokaal). |
| `STRIPE_PRICE_PREMIUM_MONTHLY` | idem | Price-id; bepaalt welk plan een checkout-knop krijgt. |
| `STRIPE_TAX_RATE_ID` | idem | 21%-tax-rate, op elke subscription toegepast. |

Geen publishable key nodig: Checkout en Portal zijn Stripe-hosted redirects.

## 3. Lokaal testen (test-mode)

```bash
# 1. dev-server + webhook-forwarding
pnpm dev                       # poort 7000 (of per-worktree poort)
stripe listen --forward-to localhost:7000/api/webhooks/stripe
# → zet het geprinte whsec_… in .env.local als STRIPE_WEBHOOK_SECRET

# 2. .env.local aanvullen met test-keys
#    STRIPE_SECRET_KEY=sk_test_… / STRIPE_PRICE_PREMIUM_MONTHLY=price_… (test)

# 3. checkout doorlopen (dev-login als admin/manager, Billing-scherm)
#    - iDEAL: testbank kiezen → betaling slagen
#    - SEPA: test-IBAN NL39RABO0300065264
#    → verwacht: subscriptions.status flipt (webhook), scherm toont ACTIVE

# 4. dunning simuleren
stripe trigger invoice.payment_failed   # → PAST DUE-banner
```

**Verificatiepunt iDEAL→SEPA-mandaat (hét integratierisico):** doorloop stap 3
één keer met iDEAL op een subscription **mét trial** en controleer in het
Stripe-dashboard dat er een SEPA Direct Debit-mandaat aan de customer hangt en
dat de subscription op `trialing` staat met de juiste `trial_end`. Werkt dat,
dan is de hele keten (iDEAL-bevestiging → mandaat → incasso bij verlenging) goed.

## 4. Replay-/idempotency-check

Stuur hetzelfde event twee keer (`stripe events resend evt_…` of replay in het
dashboard): de tweede levert HTTP 200 met body `replay` op en muteert niets —
de `stripe_webhook_events`-ledger (migratie `20260706120000`) borgt dit; bewezen
in `supabase/tests/database/stripe_billing.test.sql`.

## 5. Comped-venues (pilots) — handmatig, gelogd

```sql
update public.subscriptions
set status = 'comped', updated_at = now()
where venue_id = '<venue-uuid>';
```

- Uit te voeren als table-owner (Studio/SQL-editor of `supabase db query`).
- De audit-trigger op `subscriptions` logt de wijziging (actor `null` =
  wij/handmatig).
- Een `comped`-status wordt **nooit** door een webhook overschreven
  (guard in `apply_stripe_subscription_update`).
- **Vóór de uitrol van trial-nudge/gating (PR 2/3): zet bestaande pilot-venues
  op `comped`** — hun `created_at` ligt meer dan 14 dagen terug, anders vallen
  ze direct in de verlopen-trial-blokkade.

## 6. Geen kaart-/IBAN-data bij ons (verificatie by design)

Wij slaan uitsluitend `stripe_customer_id` en `stripe_subscription_id` op
(subscriptions-tabel). Betaalgegevens leven bij Stripe (hosted Checkout +
Portal); facturen idem. De secret-grep-test bewaakt dat de Stripe-SDK alleen
onder `src/features/billing/` geïmporteerd wordt.
