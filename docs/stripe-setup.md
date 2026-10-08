# Stripe Billing — setup-runbook (fase 13, beslissing #32)

Alles wat NIET in code leeft: de Stripe-dashboard-configuratie, de env-vars en
het handmatige test-mode-script. De code (adapter, webhook, checkout) staat in
`src/features/billing/` en is **prod-inert zolang de env-vars ontbreken** — de
app draait dan op de stub-provider (trial/comped blijft gewoon werken).

## 1. Dashboard-checklist (Max, eenmalig)

Volgorde is bewust: SEPA-activatie heeft dagen doorlooptijd — start die eerst.

1. **Account**: Stripe-account op de NL-entiteit, KYC afronden.
2. **Betaalmethoden**: **SEPA-incasso activatie aanvragen** (Stripe-review,
   duurt enkele dagen), **iDEAL** en **kaarten** aanzetten. De checkout stuurt
   precies `card` + `sepa_debit` + `ideal` (afgedwongen in de adapter,
   besluit 2026-10-06).
3. **Product + twee prijzen (Billing G: één plan, Pro)**: product "PlusOne Pro"
   met twee terugkerende prijzen, bedragen excl. BTW:
   - maandprijs, recurring `month`, **lookup key `pro_monthly`**;
   - jaarprijs, recurring `year`, vooraf, 20% onder 12 × de maandprijs,
     **lookup key `pro_yearly`**.
   De app leest ze live op lookup key (10 min cache per server) en berekent de
   jaarkorting zelf uit de twee bedragen; er gaat **geen price-id en geen
   bedrag** in code of env. Een prijs wisselen = in het dashboard een nieuwe
   prijs aanmaken en de lookup key overzetten ("transfer lookup key"). Doe dit
   in **test- én live-mode**. Een lookup key die ontbreekt (of een prijs met
   het verkeerde interval) laat de eerste checkout voor dat interval weigeren
   met een `console.error` ("stripe checkout misconfigured"); het Billing-
   scherm toont dan "Price shown at checkout".
4. **BTW**: tax rate **21% NL BTW, exclusive** aanmaken → `txr_…`-id in
   `STRIPE_TAX_RATE_ID`. (Stripe Tax is bewust niet gebruikt: alle klanten zijn
   NL B2B; 0,5% fee onnodig.)
5. **Customer portal** (Settings → Billing → Customer portal): betaalmethode
   wijzigen + factuurhistorie aan; opzeggen = **aan het einde van de periode**.
6. **Dunning** (Settings → Billing → Automatic collection): Smart Retries,
   venster ~2 weken, final action **"Cancel subscription"**. Dit ÍS de
   14-dagen-grace uit het plan: mislukte incasso → `past_due` (banner in de
   app) → na de retries → `customer.subscription.deleted` → `canceled`.
7. **Webhook-endpoint**: `https://app.plus-one.io/api/webhooks/stripe` met exact
   deze events: `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`
   (`created` is nieuw in Billing G: een checkout met resterende trial krijgt
   anders pas na de trial een periode-einde en interval). Signing secret → `STRIPE_WEBHOOK_SECRET`
   (Vercel env).
8. **Branding**: logo + lavendel-accent, e-mailbonnen op NL/EN, factuur-
   nummering en eigen BTW-nummer op de facturen.
9. **API-key: een restricted key (`rk_…`), geen secret key.** Developers → API
   keys → *Create restricted key*, in test- én live-mode, en zet die als
   `STRIPE_SECRET_KEY`. Precies deze rechten, al het andere op **None** (ook
   niet "Read" of "View-only" op alles):
   - **Customers: Write** (find-or-create van de customer bij checkout);
   - **Checkout Sessions: Write** (hosted Checkout);
   - **Customer portal: Write** (portal-sessie);
   - **Prices: Read** (de twee Pro-prijzen op lookup key).
   De webhook gebruikt de key niet voor API-calls (alleen de signing secret), en
   een gelekte restricted key kan geen refunds, payouts of klantdata buiten
   deze vier resources aanraken. Weigert Stripe een call met
   `permission_error`, voeg dan alleen dát recht toe en zet het hier bij.

## 2. Env-vars

| Var | Waar | Betekenis |
|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel (live) / `.env.local` (test) | Restricted key `rk_…` met de vier rechten uit §1.9. Zonder deze key is billing volledig uit (stub). |
| `STRIPE_WEBHOOK_SECRET` | idem | Signing secret van het endpoint (of van `stripe listen` lokaal). |
| `STRIPE_TAX_RATE_ID` | idem | 21%-tax-rate, op elke subscription toegepast. |

Geen publishable key en **geen price-ids** nodig: Checkout en Portal zijn
Stripe-hosted redirects, de prijzen komen via de lookup keys uit §1.3.
`STRIPE_PRICE_PREMIUM_MONTHLY` is vervallen; verwijder hem uit Vercel na de
merge van Billing G (hij wordt nergens meer gelezen). **Env-vars pas ná de
merge zetten**: zonder `STRIPE_SECRET_KEY` blijft prod op de stub.

## 3. Lokaal testen (test-mode)

```bash
# 1. dev-server + webhook-forwarding
pnpm dev                       # poort 7000 (of per-worktree poort)
stripe listen --forward-to localhost:7000/api/webhooks/stripe
# → zet het geprinte whsec_… in .env.local als STRIPE_WEBHOOK_SECRET

# 2. .env.local aanvullen met test-keys
#    STRIPE_SECRET_KEY=sk_test_… (prijzen: lookup keys pro_monthly/pro_yearly in test-mode)

# 3. checkout doorlopen (dev-login als admin@ of finance@, More → Billing,
#    Monthly of Yearly kiezen → Set up payment)
#    - iDEAL: testbank kiezen → betaling slagen
#    - SEPA: test-IBAN NL39RABO0300065264
#    - kaart: 4242 4242 4242 4242
#    → verwacht: subscriptions.status + billing_interval via webhook, scherm
#      toont "€X / month|year" en "Renews <datum>"

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

## 5. Trial verlengen en "Always free" — via de Platform-tab

Vervangt het SQL-runbook (Billing G). Platform-admin (Max, Joeri): **Platform →
Companies → company-kaart**:

- **Always free** aan = `comped`: blokkeert nooit, wordt nooit door een webhook
  overschreven. Uit = een nieuwe trial van 14 dagen vanaf vandaag.
- **Trial until** + "Set trial end" = trialing tot het einde van die dag
  (Amsterdam), van vandaag tot maximaal twee jaar vooruit.

Onder de motorkap `set_venue_comped` / `set_venue_trial_end` (migratie
`20261008120200`): SECURITY DEFINER met `is_platform_admin()` binnenin, een
venue-admin/finance/manager krijgt 42501. Elke wijziging landt in `audit_log`
op de uid van de platform-admin (audit-trigger op `subscriptions`). Een
company met een Stripe-subscription heeft geen knoppen (de RPC's weigeren met
55000): die beheer je in het Stripe-dashboard.

Openstaande actie (§9 los eindje 4): de bestaande trialing companies op prod
via deze knoppen op "Always free" zetten, niet meer via SQL.

## 6. Geen kaart-/IBAN-data bij ons (verificatie by design)

Wij slaan uitsluitend `stripe_customer_id` en `stripe_subscription_id` op
(subscriptions-tabel). Betaalgegevens leven bij Stripe (hosted Checkout +
Portal); facturen idem. De secret-grep-test bewaakt dat de Stripe-SDK alleen
onder `src/features/billing/` geïmporteerd wordt.
