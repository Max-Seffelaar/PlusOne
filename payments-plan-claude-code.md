# Betaalplan — Fase 14: deurbetalingen & betaalplatform (Stripe Connect, Tap to Pay)

> Status: **concept 2026-10-11, wacht op akkoord Max op de open punten in §9.** Grondslag: spec-beslissing **#34** (deurbetalingen route A/B/C) en **#37** (native), nieuw **#61** (geldstroom + fee-model, deze sessie). Native laag = `capacitor-plan-claude-code.md` §4 golf 6 (beslissing 17). ClickUp: [86exxuuu7](https://app.clickup.com/t/86exxuuu7) (Fase 14) en [86exyp8rc](https://app.clickup.com/t/86exyp8rc) (backlog kassamodule) — beide nu getagd ≥25; §9 vraagt Max het milestone opnieuw vast te stellen.
> Milestone (voorstel): **Now** — Max wil de native app bouwen mét betalen aan de deur; de backend (§6 P1–P2) werkt ook in de browser-PWA.

**Besluiten Max 2026-10-11 (gesprek over de geldstroom):**
1. **PlusOne blijft merchant of record** voor deurbetalingen en later mogelijk andere betalingen; het risico (chargebacks, refunds) nemen we bewust (Eventix-ervaring).
2. **Stripe Connect met destination charges:** de betaling komt binnen op het PlusOne-platformaccount, onze fee blijft direct op onze balans, de rest gaat meteen naar het connected account van de company — nooit wachten op ons geld. Payouts van de company dagelijks; Instant Payouts (1 %) optioneel, doorbelast.
3. **Geen kaarttoeslag** (PSD2-toeslagverbod, Max kent de regels). Wél een algemene **servicefee** die iedereen betaalt, los van de betaalmethode, als eigen regel op de bevestiging; niet "betaalkosten" of "kaartkosten" noemen.
4. **Fee-voorstel Max:** €0,20–0,30 per ticket excl. btw + 2 % van de orderwaarde. §2 toetst dit aan de echte Stripe-tarieven.
5. **Btw op de servicefee = het tarief van het ticket** (9 % bij evenementen met artistieke input), zoals bij Eventix. §3 noemt de fiscale voorwaarde die daarbij hoort.
6. **Flexibiliteit:** verschillende PSP's voor verschillende betalingen, en per betaalmethode een ander tarief aan de company kunnen rekenen. Duurzaam genoeg om later een volledig ticketingsysteem te dragen.
7. Backend gedeeld tussen route A (QR) en route C (Tap to Pay); plugin-laag, store-regels en legal zoals in de review van 2026-10-11 ("duidelijk").

---

## 1. Geldstroom

Eén betaling aan de deur, stap voor stap (Stripe-termen; gecontroleerd tegen de Connect-documentatie op 2026-10-11):

1. De doorhost tikt **Charge** bij een gast met een betaalde tier. De server (nooit de client) berekent het bedrag uit `guest_tiers.door_price_cents` plus de fee-regels (§3) en maakt een **PaymentIntent op het platformaccount** met `transfer_data[destination] = acct_<company>` en `application_fee_amount = <onze fee>`. **`on_behalf_of` laten we weg**: dan is het platform de "business of record" (Stripe: "If `on_behalf_of` is omitted, the platform is the business of record for the payment"). Voor Terminal is `on_behalf_of` alleen verplicht als platform en connected account in een ander land zitten; v1 is NL-only.
2. De gast betaalt (Tap to Pay op de telefoon van de doorhost, of iDEAL/wallet via QR op de eigen telefoon).
3. Stripe boekt het volledige bedrag naar de **pending balance van de company** en haalt onze `application_fee_amount` terug naar het platform; **de Stripe-kosten, refunds en chargebacks worden van de platformbalans afgeschreven** (Stripe: "Your account balance is debited for the cost of the Stripe fees, refunds, and chargebacks"). Onze fee komt beschikbaar op het normale payout-schema van het platform.
4. De company krijgt haar deel via haar eigen payout-schema (dagelijks, instelbaar per account; Instant Payout als optie met de 1 %-opslag doorbelast).
5. **Refund** vanuit de app: altijd met `reverse_transfer = true` (anders houdt de company het geld en betaalt het platform de refund); `refund_application_fee` is een beleidskeuze per geval (§9). **Dispute:** Stripe debiteert bedrag + €20 van het platform; wij reverse'n de transfer naar de company (webhook `charge.dispute.created`), `debit_negative_balances = true` op elk connected account, en de voorwaarden geven ons dat recht (§7).

**Connected accounts: Express** (voorstel). Stripe-hosted onboarding en KYC, de company heeft een Express-dashboard voor eigen payouts, wij bepalen payout-schema en fees. Onboarding alleen in de **browser** (Settings → Payments, admin + finance), nooit in de native shell: geen store-regel verbiedt het, maar het is een Stripe-hosted flow met identiteitscontrole die op desktop hoort — dezelfde lijn als Billing.

**Terminal-objecten bij destination charges** staan op het platformaccount: één Terminal **Location** per `company_locations`-rij (#58) die aan de deur gebruikt wordt, de **connection token** maken wij server-side met de platform-key en de `location`-parameter (zodat een telefoon van company A nooit readers van B ziet), en de Apple Tap to Pay-voorwaarden accepteert het **platformaccount één keer** (niet elke company) — simpeler dan in de review van 2026-10-11 stond.

## 2. Kosten en marge (Stripe NL, publieke tarieven gecontroleerd 2026-10-11)

| Post | Tarief |
|---|---|
| Terminal / card-present, EER-kaart | 1,4 % + €0,10 |
| Terminal / card-present, niet-EER-kaart | 2,9 % + €0,10 |
| **Tap to Pay (iPhone of Android), opslag** | **+ €0,10 per autorisatie** (optionele P2PE + €0,05) |
| Online kaart, standaard EER | 1,5 % + €0,25 (premium EER 2,8 %, UK 2,5 %, internationaal 3,15 %) |
| iDEAL | €0,29 per betaling |
| Connect, platform bepaalt de fees | €2 per actief account per maand + 0,25 % + €0,10 per payout |
| Instant Payouts | 1 % van het volume, min. €0,50 (door te belasten) |
| Chargeback | €20 ontvangen; €20 extra bij handmatig betwisten, terug bij winst; het bedrag zelf komt van de platformbalans |
| Refund | geen refund-fee, maar de verwerkingskosten en Connect-kosten van de oorspronkelijke betaling komen **niet** terug |

Het geplakte advies in het gesprek miste de Tap to Pay-opslag en de Connect-kosten, en rekende de servicefee niet mee in de grondslag van het Stripe-percentage. Met die drie erbij, fee aan de gast excl. btw, 9 % btw op de fee, Connect geamortiseerd op ±0,25 % + €0,03 per ticket:

| Ticket | A) €0,25 + 2 %, Tap to Pay EER | B) idem, niet-EER-kaart | C) idem, iDEAL/QR (route A) | D) €0,35 + 2 %, TtP EER | E) €0,25 + 2,5 %, TtP EER | F) €0,25 + 2 % gast **+ €0,15/tx company**, TtP EER |
|---|---|---|---|---|---|---|
| €10 | €0,05 | −€0,11 | €0,11 | €0,15 | €0,10 | €0,20 |
| €15 | €0,06 | −€0,17 | €0,19 | €0,16 | €0,14 | €0,21 |
| €25 | €0,10 | −€0,29 | €0,37 | €0,19 | €0,22 | €0,25 |
| €40 | €0,14 | −€0,47 | €0,63 | €0,24 | €0,34 | €0,29 |
| €60 | €0,21 | −€0,72 | €0,98 | €0,31 | €0,50 | €0,36 |

(Brutomarge per ticket excl. btw, vóór chargebacks, refunds en de €2/maand per actief account. Formule: fee − PSP(ticket + fee × 1,09) − (0,25 % × ticket + €0,03); PSP = 1,4 % + €0,10 + €0,10 Tap to Pay voor EER, 2,9 % + €0,20 niet-EER, €0,29 iDEAL.)

**Lezing:**
- Max' voorstel (A) komt uit de kosten, maar houdt per Tap to Pay-ticket **€0,05–0,21** over, ±0,4 % van de ticketprijs. Eén chargeback op een ticket van €25 (€20 fee + €25 weg) kost dan de marge van **±470 tickets**. Dat is te dun om "het risico nemen" te dragen.
- Niet-EER-kaarten (toeristen, ADE) zijn bij A **verliesgevend**; een kaartsoort-afhankelijke fee aan de gast mag niet (PSD2), dus dat verlies hoort in de company-fee of in de marge.
- **iDEAL/QR (route A) is bij elke ticketprijs goedkoper dan Tap to Pay** (vast €0,29 tegen €0,20 + 1,4 %); bij €25 scheelt het €0,27 per ticket. Route A is dus geen "fallback" maar de marge-motor, en een reden om per betaalmethode een ander companytarief te kunnen rekenen (besluit 6).
- **Advies: twee lagen (F).** Een zichtbare servicefee aan de gast (€0,25 + 2 %, gelijk voor elke methode — PSD2-proof) **plus een company-transactiefee per betaalmethode** die van de payout wordt verrekend (netting) en maandelijks gefactureerd (21 % btw, B2B). Richtwaarde: card-present €0,15/tx, iDEAL €0,00–0,05/tx, niet-EER-opslag 1,5 % op de company. Dan ligt de marge op €0,20–0,36 per Tap to Pay-ticket en absorbeert een chargeback ±180 tickets. Eén blended-rate-rapport per company per maand (werkelijke Stripe-kosten uit `balance_transaction` tegenover onze fees) stuurt de tarieven na 2–3 maanden bij.

## 3. Fee-model en btw

- **Twee fee-dragers, één tabel.** `payment_fee_rules`: platform-defaults (`venue_id is null`) met per company een override; per `provider` × `method` (`card_present`, `ideal`, `card`, `wallet`, later `cash`) × `bearer` (`guest` | `company`): `fixed_cents`, `percent_bp`, `vat_mode` (`follows_tier` | fixed %), geldig-van/tot. Gemuteerd door admin/finance van PlusOne in de Platform-tab (geaudit, zoals `set_venue_comped`); een company ziet haar eigen tarieven read-only in Settings → Payments.
- **De gast-servicefee** staat als eigen regel op de deur-kassabon en de ontvangstmail: "Servicekosten €0,55 (incl. 9 % btw)", nooit "kaartkosten". Hetzelfde bedrag bij elke betaalmethode.
- **De company-transactiefee** verschijnt nooit bij de gast; zij wordt van het transfer-bedrag ingehouden (`application_fee_amount` = gastfee + companyfee) en staat op het maandoverzicht en de fee-factuur van de company (§6 P4).
- **Bedragen altijd server-side** uit tier + fee-regels; de client stuurt alleen `guest_id`/`entry_payment_id`. Fee-regels en tierprijzen worden **gesnapshot** op `entry_payments` (ticket, gastfee, companyfee, btw-%), zodat een latere tariefwijziging een oude betaling niet herschrijft.
- **Btw-voorwaarde (accountant, vóór P4):** "servicefee tegen het tickettarief" werkt alleen als de fee fiscaal bij de hoofdprestatie hoort — in de Eventix-constructie omdat de fee namens de organisator aan de bezoeker in rekening wordt gebracht. Als PlusOne de fee als **eigen dienst** aan de bezoeker levert, is het 21 %; levert PlusOne het ticket **in eigen naam** (commissionair), dan is de héle ticketomzet PlusOne-omzet tegen 9 % en de company levert aan PlusOne. "Merchant of record voor de betaling" (besluit 1) is niet hetzelfde als "verkoper van het ticket"; de constructie bepaalt wie wie factureert (gast ↔ company ↔ PlusOne) en dus het datamodel van P4. **Vastleggen met de accountant vóór de factuur- en statementbouw**, niet erna.

## 4. Architectuur

**Provider-seam.** `src/features/payments/` met een `PaymentProvider`-interface naast `BillingProvider` (`src/features/billing/provider.ts`), gekozen per `(provider, method)` uit de fee-regels: `createDoorPayment({ entryPaymentId, method })` → `{ clientSecret | hostedUrl }`, `createConnectionToken({ locationId })`, `refund({ entryPaymentId, amountCents, reverseTransfer, refundApplicationFee })`, `onboardCompany(venueId)` → hosted-onboarding-URL, `accountStatus(venueId)`. Stripe-adapter in dezelfde map; de **stripe-confinement-guard** (`src/features/billing/stripe-confinement.test.ts`) krijgt `features/payments` als tweede toegestane map **in dezelfde PR** die de adapter maakt, nooit eerder. Zonder `STRIPE_SECRET_KEY` een stub (zoals billing).

**Multi-PSP-regel (duurzaam, besluit 6).** Een PSP-adapter is alleen toegestaan als de PSP zelf **sub-merchant-onboarding en split-settlement** biedt (Stripe Connect, Mollie Connect, Adyen for Platforms, Pay.nl-partnermodel): het geld van de company gaat van de PSP naar de company, **PlusOne betaalt nooit uit van een eigen bankrekening** — anders houden wij derdengelden en zitten we in vergunningsplichtig gebied. Het grootboek (`payment_ledger`) is van PlusOne en PSP-onafhankelijk; de PSP levert alleen de werkelijke kosten per betaling.

**Tabellen (migraties in P1; grant-matrix per tabel, RLS allowed + denied per rol in pgTAP):**

| Tabel | Rol | Bijzonderheden |
|---|---|---|
| `company_payment_accounts` | `venue_id`, `provider`, `external_account_id` (`acct_…`), `onboarding_status`, `charges_enabled`, `payouts_enabled`, `payout_schedule`, `terminal_location_id` per `company_locations`-rij | Alleen admin/finance van de company lezen; schrijven uitsluitend via server (webhook `account.updated` + onboarding-RPC). Geen platform-admin-RLS-uitzondering nodig: #49 dekt lezen al. |
| `payment_fee_rules` | §3 | Audit-trigger (geldconfiguratie); platform-defaults alleen door `is_platform_admin()`. |
| `entry_payments` | `id` (server-default UUID, online-only, zoals `push_tokens`), `venue_id`, `event_id`, `guest_id`, snapshot van tier + fees, `provider`, `method`, `provider_payment_id`, `amount_cents` (wat de gast betaalde), `status` (`requires_payment` → `processing` → `succeeded` \| `failed` \| `canceled` → `refunded` \| `partially_refunded` \| `disputed`), `provider_fee_cents` (uit `balance_transaction`, later gevuld), `created_by`, `paid_at`, `override_by`/`override_reason` | **In de audit-triggerset** (regel #4: dit is domein- én gelddata, anders dan `push_tokens`). RLS: zie `check_ins` (event-scope), doorhost/organizer/admin lezen; alleen de server schrijft status. Idempotent op `(provider, provider_payment_id)`. |
| `payment_ledger` | per betaling de regels gross / gastfee / companyfee / PSP-kosten / transfer / refund / reversal, met `balance_transaction_id` | Append-only; bron voor statements (P4) en de blended-rate-rapportage. |
| `payment_statements` | per company per maand: totalen + factuurnummer van de fee-factuur | P4. |

**Deurflow (route C) en de outbox-invariant (#25).** Betalen is **online-only** (Stripe: offline mode is niet compatibel met Tap to Pay). De deur toont bij een betaalde tier de bestaande `pay`-vlag (`src/features/door/model.ts`) als "€X te betalen"; **Charge** = server action → PaymentIntent (card_present, destination charge) → de native plugin int → webhook `payment_intent.succeeded` (op het **bestaande** platform-webhook-endpoint `POST /api/webhooks/stripe`, zelfde `stripe_webhook_events`-ledger; destination-charge-events komen op het platformaccount binnen) → `entry_payments.status = succeeded` → realtime zet de vlag uit → de check-in zelf blijft een **outbox-write**, onveranderd. Een gast met "te betalen" kan offline **niet** worden ingecheckt, behalve via de **geaudite override** (admin/organisator, reden verplicht; Fase 14-prompt) — of als **cash** (§9). Alleen `account.updated` van connected accounts vraagt een **tweede, Connect-endpoint** (`/api/webhooks/stripe-connect`, eigen secret).

**Route A (QR/iDEAL, web).** Zelfde PaymentIntent met `payment_method_types` iDEAL/kaart/wallets via Stripe Checkout (destination charge), publieke pagina `/pay/[token]` (token gehasht, verloopt met het event, zelfde throttle-familie als `/r`), QR in de mobiele deur én in de cockpit, de statuspagina van de gast krijgt een "Pay now"-knop vóór het event (optioneel, §9). Zelfde webhook, zelfde `entry_payments`-rij.

**Bon en mail.** De gast krijgt een ontvangstmail via de **gastmail-wachtrij** (#13 herzien: transactioneel over de eigen plek), met ticketregel, servicefee-regel incl. btw, en het contactadres van het event; nooit vanaf het deurpad (de server action enqueue't na de webhook). Stripe's eigen receipt-mail staat uit (dubbel).

**Security (checklist CLAUDE.md op elk pad).** Bedrag en fee uitsluitend server-side; `getUser()` + `can_write_guests`/doorhost-rol per `event_id`; Zod op elke input; connection-token-route alleen voor leden met deurrechten van die company en altijd met `location`; webhook-signature over de raw body; Connect-endpoint apart; geen PII in URL's (`/pay/[token]` is een opaak token); `service_role` alleen in de twee webhook-handlers (gedocumenteerd, zoals de billing-webhook). **High-risk surface** → fresh-session `/code-review` + `/security-review`, security-research-prompt in de PR-body.

**Rapportage.** `venue_event_headcounts`-stijl GROUP BY-RPC voor deuromzet per event (bruto, fees, netto) op het Stats-scherm; per company per maand de blended rate (§2). Nooit rijen naar de client sommen (CLAUDE.md schaalregel).

## 5. Native laag (route C)

Staat in `capacitor-plan-claude-code.md` §2 beslissing 17 en §4 golf 6 (P3a/P3b): plugin `@capacitor-community/stripe-terminal` (Tap to Pay-discovery met `locationId`; Android `minSdkVersion` 24 → 26; `MODIFY_AUDIO_SETTINGS`; alleen de permissies die Tap to Pay nodig heeft), Apple-entitlement `com.apple.developer.proximity-reader.payment.acceptance` (development → distribution), de verplichte "How to Tap"-overlay, device-grenzen (iPhone XS+, **iPhone-only**: de iPad-deur blijft route A; Android 13+, GMS, bootloader locked, **Developer options uit** → Max' debug-toestel kan Tap to Pay niet testen), Codemagic (entitlement + profiel), store-declaraties (Play "Financial features" en Apple App Privacy opnieuw beantwoorden; Apple 3.1.3(e): fysieke dienst, geen IAP) en de carve-out op de store-tax-guards.

## 6. Fasering

Effort in Claude Code-sessies (één ClickUp-taak → één PR). Dezelfde orchestratie-mechaniek als `capacitor-orchestration-claude-code.md` (orchestrator per golf, worker-brief, reviewer-brief voor high-risk).

| # | Fase | Tag | Effort | Deps | Deliverable |
|---|---|---|---|---|---|
| P0 | Stripe- en Apple-voorbereiding (Max) | NOW | — | — | Connect + Terminal activeren op het platformaccount (test mode eerst), Connect-webhook-secret, **Apple Tap to Pay development-entitlement aanvragen** (Account Holder; langste doorlooptijd), accountant-gesprek over §3. |
| P1 | Betaalkern (high-risk) | NOW | 2 | P0 (test mode) | Migraties §4 (incl. grant-matrix, audit, pgTAP), `PaymentProvider` + Stripe-adapter + stub, fee-engine met snapshot, Express-onboarding in Settings → Payments (browser), Connect-webhook `account.updated`, `entry_payments` live in de deur-snapshot ("€X te betalen"-vlag), geaudite override. Nog geen betaalmethode. |
| P2 | Route A: QR / iDEAL | NOW | 1–2 | P1 | Checkout-destination-charge, `/pay/[token]`, QR in deur + cockpit, webhook → `succeeded` → vlag uit, ontvangstmail via de gastmail-wachtrij, refund vanuit de app met `reverse_transfer`. Werkt in PWA én shell, ook op iPad. |
| P3a | Tap to Pay-plugin (native + web-seam) | NOW | 2 | P1, P0-entitlement (dev), Capacitor golf 6 | Zie `capacitor-plan-claude-code.md` §4. Connection-token-route, Location per company-locatie, card-present PaymentIntent, oude-shell-detectie (`PlusOnePushConfig`-patroon), Android `minSdk` 26. |
| P3b | Tap to Pay store-kant | SHIP | ½ + Max | P3a | Distribution-entitlement, Codemagic (entitlement + profiel + IPA-check), How-to-Tap-overlay, store-declaraties en review-notes, device-test op een release-build. |
| P4 | Statements en facturatie | NOW | 1–2 | P1, §3-akkoord accountant | Maandoverzicht per company (bruto, gastfees, companyfees, PSP-kosten, netto, btw), fee-factuur (21 %) genetted, Instant Payout-optie met opslag, blended-rate-rapport, deuromzet per event op Stats. |
| P5 | Disputes en operations | ≥5 | 1 | P2 | `charge.dispute.created` → transfer reversal, `debit_negative_balances`, Platform-tab-overzicht van betalingen/disputes, handmatige refund-regels. |
| P6 | Tweede PSP | ≥25 | 2 | P4 | Alleen een PSP met split-settlement (§4-regel); fee-regels per provider zijn er dan al. |

**Volgorde:** P1 → P2 → P4 op het web (geen store-cyclus, marge-motor eerst), P3a parallel aan P2 zodra P1 gemerged is en de dev-entitlement binnen is. S6 (share sheet) loopt in Capacitor golf 6 naast P3a. **Totaal ≈ 7–9 sessies** plus de Apple-wachttijd.

## 7. Store-, legal- en finance-checklist

- [ ] Accountant: btw-constructie §3 (agent vs. commissionair; 9 % op de servicefee), facturatierichting gast ↔ company ↔ PlusOne — **vóór P4**.
- [ ] Voorwaarden (venue): fee-schema per methode, netting, payout-schema, Instant Payout-opslag, ons recht op transfer reversal bij refunds/chargebacks, `debit_negative_balances`.
- [ ] Guest Terms + Privacy + Subprocessors v1.1: Stripe nu ook voor gastbetalingen (kaartgegevens nooit bij PlusOne; Tap to Pay-SDK verwerkt ze op het toestel), servicefee-disclosure, refund-beleid; `TERMS_VERSION` ophogen.
- [ ] Play: "Financial features"-declaratie opnieuw (`docs/store/play-review-notes.md` zegt nu "geen"); Apple App Privacy opnieuw tegen Stripe's SDK-guidance; review-notes: fysieke dienst (3.1.3(e)), Tap to Pay als 4.2-meerwaarde.
- [ ] CLAUDE.md-carve-out: store-tax = SaaS-billing; deurbetalingen aan de company zijn toegestaan in de shell; de `PURCHASE_COPY`-regexen in de store-tax-guards blijven tot billing/onboarding beperkt en de deur krijgt een eigen guard.
- [ ] Stripe: Apple Acceptance Platform-voorwaarden (platform), Terminal-aankondigingslijst abonneren (device-eisen wijzigen), Radar-regels voor card-present.

## 8. Kritieke bestanden

- `src/features/billing/provider.ts` + `stripe-confinement.test.ts` — het voorbeeld voor de `PaymentProvider`-seam en de guard die mee moet
- `src/features/billing/stripe-webhook.ts` + `src/app/api/webhooks/stripe/` — het bestaande endpoint dat `payment_intent.*` erbij krijgt; het Connect-endpoint komt ernaast
- `src/features/door/model.ts` — de `pay`-vlag die live gaat
- `src/features/door/DoorProvider.tsx` — ongewijzigd: de check-in blijft outbox, de betaling niet
- `supabase/migrations/20260624180000_tier_door_price.sql` + `20260706140000_tier_vat_percent.sql` — de bestaande tierprijs en btw-kolommen
- `src/features/guests/` gastmail-templates (6a) — de ontvangstmail
- `docs/store/play-review-notes.md`, `docs/store/play-store-listing.md` — declaraties die veranderen
- `capacitor-plan-claude-code.md` §2 17, §4 golf 6 — de native laag

## 9. Open besluiten voor Max

1. **Fee-schema:** F (gastfee €0,25 + 2 % én companyfee per methode) of alleen een hogere gastfee (D/E)? Richtwaarden companyfee: card-present €0,15, iDEAL €0,00–0,05, niet-EER +1,5 %.
2. **Milestone** voor Fase 14: Now (voorstel) — en de twee ClickUp-taken van ≥25 naar Now.
3. **Volgorde:** P1 → P2 (QR) → P3 (Tap to Pay), zoals voorgesteld, of P3 vóór P2?
4. **Cash** als geregistreerde methode (`entry_payments.method = 'cash'`, geen PSP, wel fee aan de company?) of alleen de geaudite override?
5. **Refund-beleid:** servicefee mee terug (`refund_application_fee`) bij een refund binnen X uur, of nooit?
6. **Express** connected accounts (voorstel) of Custom (eigen onboarding-UI, meer werk, geen Express-dashboard)?
7. **"Pay now" op de statuspagina** vóór het event (voorverkoop-light) in P2, of pas later?
8. **Instant Payouts** aanbieden in v1 (opslag 1 % + marge) of pas na P4?
