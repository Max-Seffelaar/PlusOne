# Betaalplan — Fase 14: deurbetalingen & betaalplatform (eigen Stripe-account, Tap to Pay, wekelijkse uitbetaling)

> Status: **besloten in hoofdlijnen 2026-10-11 (Max, drie rondes dezelfde dag); vier restpunten in §9.** Grondslag: spec-beslissing **#34** (deurbetalingen route A/B/C), **#37** (native) en **#62** (geldstroom, type-model, fee-model, uitbetaling). Native laag = `capacitor-plan-claude-code.md` §4 golf 6 (beslissing 17). ClickUp: [86exxuuu7](https://app.clickup.com/t/86exxuuu7) (Fase 14) en [86exyp8rc](https://app.clickup.com/t/86exyp8rc) (backlog kassamodule).
> Milestone: **≥5** (Max 2026-10-11: "hiermee kunnen we beginnen met +5 klanten"). De store-golf 6 van het Capacitor-plan (Tap to Pay native) volgt daarmee ook ≥5; de share sheet (S6) staat los van dit plan.

**Besluiten Max 2026-10-11, ronde 1 (gesprek over de geldstroom):**
1. **PlusOne is merchant of record** voor deurbetalingen en later mogelijk andere betalingen; het risico (chargebacks, refunds) nemen we bewust (Eventix-ervaring).
2. **Geen kaarttoeslag** (PSD2-toeslagverbod). Wél een algemene **servicefee** die iedereen betaalt, los van de betaalmethode, als eigen regel op de bon; nooit "betaalkosten" of "kaartkosten".
3. **Btw op de servicefee = het tarief van het ticket** (9 % bij evenementen met artistieke input), zoals bij Eventix; §3 legt vast hoe dat klopt (type 3).
4. **Flexibiliteit:** verschillende PSP's voor verschillende betalingen, en per betaalmethode een ander tarief kunnen rekenen. Duurzaam genoeg om later een volledig ticketingsysteem te dragen.
5. Backend gedeeld tussen route A (QR) en route C (Tap to Pay); plugin-laag, store-regels en legal zoals in de review van 2026-10-11.

**Ronde 2 (whiteboard, drie foto's, Eventix-model):**
6. **Type 3 is de default:** de company verkoopt het ticket aan PlusOne, PlusOne verkoopt het in eigen naam aan de gast; alles tegen het tickettarief (9 %). Type 1 (agent) is de fallback; type 2 (MOSS, buitenland) blijft op de muur staan, niet voor v1. Uitwerking §3.
7. **EH = de toekomstige holding van PlusOne;** die werkt op dividend (ronde 3, punt 9), dus geen intercompany-leg in het product, alleen een `issuer`-entiteit op documenten.
8. **Refunds:** PlusOne heeft de dienst al geleverd. De company kiest: alleen het ticketbedrag terug (PlusOne houdt service- en transactiekosten) of alles terug (die kosten zijn dan voor de company). PlusOne zit nooit met een gat.
9. **KvK- en btw-nummer verplicht bij het aanmaken van een company**; anders het vinkje "ik ben een privépersoon". `venues.kvk_number`/`vat_number` bestaan al (nu optioneel). **Een overstap naar type 3 is onomkeerbaar.**
10. "UL" op het whiteboard = NL; "laatste payouts" en de shop-tekening (foto 3) negeren.

**Ronde 3 (antwoorden op de tien open punten):**
11. **Fee-schema:** default **€0,25 + 2,0 % excl. btw** aan de gast. De company mag de servicefee zelf ophogen: vast bedrag **€0,25 → €3,00**, percentage **2,0 % → 2,6 %**; het deel boven de PlusOne-ondergrens is voor de company. Geen aparte companyfee per betaalmethode in v1 (de fee-regels houden die mogelijkheid, default €0).
12. **Milestone ≥5.**
13. **Volgorde: P1 betaalkern → P2 QR/iDEAL (werkt in de browser, geen native app nodig) → P3 Tap to Pay (native).**
14. **Cash** als betaalmethode, alleen als de company dit **company-breed** aanzet.
15. **Whitelist automatisch:** KvK + geldig btw-nummer = type 3.
16. **Geen Stripe Connect, geen connected accounts.** PlusOne is merchant of record zolang dat kan: alle betalingen landen op het eigen Stripe-account van PlusOne, de company **machtigt PlusOne** om de uitbetaling te doen én de gelden van PlusOne (fees, abonnement, refunds, chargebacks) direct in te houden.
17. **Shop:** een gast moet via de publieke pagina (de influencer-/deellink, `/e/[slug]`) direct kunnen betalen als de company dat wil. De gast krijgt **geen ticket**, alleen de bevestiging dat hij op de gastenlijst staat.
18. **Uitbetaling wekelijks**, door PlusOne zelf; dat houdt controle en pressie. PlusOne maakt de voorzet voor het proces (§4 "Uitbetalingsrun").
19. **Holding op dividend**: akkoord.
20. **Stripe Billing (abonnement) gaat mee in de verrekening.** Een company die de app gebruikt maar niets verkoopt gaat in de min en betaalt met iDEAL, of we houden het in op de volgende uitbetaling. **Bon aan de gast:** bij een betaling kan de doorhost in het dashboard een e-mailadres toevoegen; is er een e-mailadres bekend, dan krijgt de gast altijd direct de bon.

**Ronde 4 (antwoorden op de vier restpunten):**
21. **Abonnement verrekenen via Stripe** (`send_invoice` + `paid_out_of_band`, §3): akkoord.
22. **Shop-instellingen per company:** reserveringstermijn instelbaar, default **8 minuten** (15 is veel te lang); de betaaltermijn apart instelbaar; een betaling die pas ná de termijn slaagt → **automatische refund** of toelaten (instelling); **toelaten tot de max óf overselling toestaan** (instelling). Belangrijk voor **peak sales**: binnen 4 minuten alles geregistreerd en de betalingen vastgezet.

**Ronde 5 (antwoorden op de vier restpunten):**
23. **Betalingen in v1 alleen voor type-3-companies: akkoord.** **Stripe is om te starten en te valideren; voor groei zoeken we een goedkopere PSP** (Stripe is veel te duur). P6 krijgt daarmee prioriteit zodra de deurbetalingen gevalideerd zijn; de `PaymentProvider`-seam is daarvoor.
24. **Vrijstellingen op de whitelist: handmatige goedkeuring** door een platform-admin.
25. **Shop: de reservering start bij de "+".** Elke klik op + reserveert in de database en controleert of er daadwerkelijk nog plek is; daarna gegevens, daarna betalen. De infra moet met **100k mensen in de shop** blijven werken.
26. **Ghost-betalingen vangen we zelf af.** Betalingen komen gewoon binnen; op basis van de company-instellingen staan we overselling toe tot een zekere hoogte, of niet. Reden (praktijk): bij een piek is een groot deel van de reserveringen nooit afgemaakt en blokkeert dat de mensen in de shop; alles draait om niet-afgerekende orders zo snel mogelijk terug in de shop krijgen. Timing uit ervaring: 90 % van de betalingen binnen ±1,5 minuut, 5 % binnen 5 minuten, daarna een lange staart → de vraag per company is "altijd doorlaten, of tot X % oversold?". De fijnere logica (een groep die onderling al betaald heeft en zijn holds eerder vrijgeeft) komt met het ticketingsysteem, in overleg met de organisatie, niet nu. Stripe Checkout (hosted, minimaal 30 min) is daarmee prima; geen Payment Element nodig.

**Ronde 6:**
27. **Default oversell 5 %: akkoord.** Plus: **zodra we 100 % zeker weten dat het uitverkocht is, moet een blok mogelijk zijn** — anders verwerken we te veel transacties en kosten de refunds geld. En we moeten goed bedenken hoe we dit met de klant bespreken (uitleg van de afweging bij het aanzetten van de shop). Uitwerking §4.
28. **PSP-onderzoek:** een sub-agent mag uitzoeken welke partijen het beste aansluiten (loopt; resultaat in `docs/psp-shortlist-2026-10.md`, P6).
29. **Chargebacks:** we doen ons best om elke chargeback aan te vechten; verliezen we hem, dan brengen we de kosten in rekening bij de klant: de klant betaalt de refund (het betwiste bedrag) én de chargeback-kosten van **€20 excl. btw**. Dit is de marktstandaard. Uitwerking §3 en §4.
30. **Wachtkamer (P7):** "hier hebben we echte devs voor nodig" — P7 wordt niet in Claude Code-sessies gebouwd maar is een inhuur-/partnerpost bij ≥25.

**Ronde 7:**
31. **Handmatig "uitverkocht" per tier.** Een tier/ticket moet met de hand op sold out gezet kunnen worden; daarna kan hij in de shop niet meer gereserveerd worden en ziet iedereen die op de "+" klikt direct "uitverkocht". Alleen met de hand weer open.
32. **`accept_always` alleen door platform-admins.** Zulke sales gaan altijd samen met de klant en hebben meer voeten in de aarde dan je zou denken.
33. **Wachtkamer = waarschijnlijk Queue-it**, goed geïmplementeerd zodat companies hun eigen wachtrij kunnen ontwerpen; kosten volgens Max ±€15k per jaar (indicatie, niet geverifieerd). Blijft P7, ≥25, externe devs.

---

## 1. Geldstroom

Eén betaling aan de deur, stap voor stap. Alles loopt op **één Stripe-account van PlusOne**; er is geen connected account en geen transfer.

1. De doorhost tikt **Charge** bij een gast met een betaalde tier (of de gast betaalt zelf via de QR of de shop, §4). De server (nooit de client) berekent het bedrag: ticketprijs uit `guest_tiers.door_price_cents` + de servicefee uit de fee-regels (§3), en maakt een **PaymentIntent op ons account**. In het type-model is dit bedrag C: de verkoop van PlusOne aan de gast.
2. De gast betaalt (Tap to Pay op de telefoon van de doorhost, iDEAL of wallet via QR op de eigen telefoon, of cash als de company dat aan heeft).
3. Stripe boekt het bedrag minus Stripe-kosten op de PlusOne-balans. Het grootboek (§4) boekt per betaling: verkoop C aan de gast, inkoop B van de company (ticketprijs + het deel van de servicefee dat boven onze ondergrens aan de company toekomt), onze marge (C − B), de werkelijke PSP-kosten uit `balance_transaction`.
4. **Wekelijks** (§4 "Uitbetalingsrun") rekent PlusOne per company af: alle inkopen B van die week, minus wat de company aan PlusOne verschuldigd is (abonnement, refund-kosten, chargebacks, overige vorderingen). Positief saldo → SEPA-overboeking vanaf de PlusOne-bankrekening; negatief saldo → de company betaalt met iDEAL of het wordt ingehouden op de volgende uitbetaling.
5. **Refund:** op ons account, met de twee opties uit §3; het fee-deel van een volledige refund wordt een vordering op de company. **Dispute:** Stripe debiteert bedrag + €20 van onze balans; de ledger boekt het als vordering op de company, verrekend in de eerstvolgende run.

**Waarom dit zonder Connect kan, en waar de grens ligt.** In **type 3** verkoopt PlusOne het ticket in eigen naam: het geld van de gast is PlusOne-omzet en de wekelijkse uitbetaling is het betalen van een inkoopfactuur. Dat is handel, geen betaaldienst, en het zijn onze eigen transacties op ons Stripe-account. In **type 1** (agent) int PlusOne namens een ander en betaalt door: dat is precies waar PSD2 (derdengelden, uitzondering handelsagent) én Stripe's voorwaarden (betalingen voor derden verwerken vereist Connect) gaan wringen. Daarom **voorstel: in v1 alleen betalingen voor type-3-companies** (whitelist); een privépersoon of niet-gewhiteliste company kan de gastenlijst gebruiken maar geen betaalde tiers aanzetten, tot jurist en accountant het agentpad hebben goedgekeurd. §9 punt 1.

**Terminal-objecten** staan op ons account: één Terminal **Location** per `company_locations`-rij (#58) die aan de deur gebruikt wordt (Tap to Pay vraagt een `locationId`), de **connection token** maken wij server-side met de `location`-parameter zodat een telefoon van company A nooit readers van B ziet, en de Apple Tap to Pay-voorwaarden accepteert PlusOne één keer.

## 2. Kosten en marge (Stripe NL, publieke tarieven gecontroleerd 2026-10-11)

| Post | Tarief |
|---|---|
| Terminal / card-present, EER-kaart | 1,4 % + €0,10 |
| Terminal / card-present, niet-EER-kaart | 2,9 % + €0,10 |
| **Tap to Pay (iPhone of Android), opslag** | **+ €0,10 per autorisatie** (optionele P2PE + €0,05) |
| Online kaart, standaard EER | 1,5 % + €0,25 (premium EER 2,8 %, UK 2,5 %, internationaal 3,15 %) |
| iDEAL | €0,29 per betaling |
| Chargeback | €20 ontvangen; €20 extra bij handmatig betwisten, terug bij winst; het bedrag zelf komt van onze balans |
| Refund | geen refund-fee, maar de verwerkingskosten van de oorspronkelijke betaling komen **niet** terug |
| Uitbetaling aan de company | eigen SEPA-batch vanaf de PlusOne-bank, ±€0,10–0,30 per overboeking per week per company; geen Connect-kosten meer (was €2 per actief account per maand + 0,25 % + €0,10 per payout) |

Brutomarge per ticket voor PlusOne, excl. btw, met de gastfee van besluit 11 (€0,25 + 2 %; wat de company er zelf bovenop zet gaat naar de company en verandert onze marge niet), 9 % btw op de fee, Stripe-percentage over het hele bedrag incl. fee:

| Ticket | A) €0,25 + 2 %, Tap to Pay EER | B) idem, niet-EER-kaart | C) idem, iDEAL/QR | D) €0,35 + 2 % | E) €0,25 + 2,5 % |
|---|---|---|---|---|---|
| €10 | €0,10 | −€0,05 | €0,16 | €0,20 | €0,15 |
| €15 | €0,13 | −€0,10 | €0,26 | €0,23 | €0,21 |
| €25 | €0,19 | −€0,20 | €0,46 | €0,29 | €0,31 |
| €40 | €0,27 | −€0,34 | €0,76 | €0,37 | €0,47 |
| €60 | €0,39 | −€0,54 | €1,16 | €0,49 | €0,68 |

(Formule: fee − PSP(ticket + fee × 1,09); PSP = 1,4 % + €0,10 + €0,10 Tap to Pay voor EER, 2,9 % + €0,20 niet-EER, €0,29 iDEAL. Vóór chargebacks en refunds; bankkosten van de wekelijkse uitbetaling zijn per ticket verwaarloosbaar.)

**Lezing bij het gekozen schema (A):** zonder Connect-kosten komt Tap to Pay op €0,10–0,39 per ticket uit; één chargeback op een ticket van €25 kost nog steeds de marge van ±240 tickets, en een niet-EER-kaart blijft verliesgevend. **iDEAL/QR is bij elke ticketprijs het goedkoopst** en is daarom terecht de eerste betaalmethode (besluit 13). Het blended-rate-rapport (§4) per company per maand stuurt het schema na 2–3 maanden bij; de fee-regels houden een companyfee per methode klaar (default €0) voor als de mix veel niet-EER-kaarten blijkt te bevatten.

## 3. Fee-model en btw

**Drie types (whiteboard Max 2026-10-11, model uit zijn Eventix-tijd).** Actoren: gast (B), company (O), PlusOne (EX), later de holding (EH). A, B en C zijn de leveringen in de keten, van boven naar beneden.

| Type | Keten | Btw-effect | Bij PlusOne |
|---|---|---|---|
| 1 "default" (agent) | PlusOne factureert de company voor de dienst (B, 21 %); de company verkoopt het ticket incl. servicekosten aan de gast (C, tickettarief) | de servicekosten volgen het ticket omdat de company de verkoper is; onze fee aan de company is 21 % | fallback voor een company buiten de whitelist; **in v1 zonder betalingen** (voorstel §1, §9 punt 1) |
| 2 "MOSS" | PlusOne verkoopt de servicefee rechtstreeks aan de gast (B, OSS-tarief van het land van de gast); de company verkoopt het ticket (C) | buitenlandcase ("Jaap: bij MOSS ook buitenland") | **geparkeerd**, v1 is NL-only; de groene annotaties op het whiteboard horen hierbij |
| 3 (commissionair) | de company verkoopt het ticket aan PlusOne (B, 9 % of vrijgesteld); PlusOne verkoopt het ticket in eigen naam aan de gast (C, 9 %, servicekosten inbegrepen) | **alles 9 %**; de marge van PlusOne is C − B, zonder eigen fee-factuur aan de company | **default, automatisch bij KvK + geldig btw-nummer** |

- **Whitelist, automatisch (besluit 15):** NL-company met KvK-nummer en geldig btw-nummer → `vat_type = 3`. Vrijstellingen (btw-vrijgestelde stichting e.d.) zijn een handmatige goedkeuring door een platform-admin in de Platform-tab (§9 punt 2). Een privépersoon (besluit 9) heeft geen btw-nummer en blijft type 1. **Geen mengvorm per event, geen overgangsperiode**, en **onomkeerbaar**: een CHECK/trigger weigert 3 → 1.
- **Servicefee aan de gast (besluit 11):** gelijk voor elke betaalmethode (PSD2). Platform-ondergrens €0,25 + 2,0 %; de company mag in Settings → Payments ophogen tot €3,00 + 2,6 %; het deel boven de ondergrens is voor de company en zit in type 3 in de inkoopprijs B. Op de bon staat één regel "Servicekosten" (incl. btw tegen het tickettarief).
- **Fee-regels, één tabel.** `payment_fee_rules`: platform-defaults (`venue_id is null`) en per company een override; per `provider` × `method` (`card_present`, `ideal`, `card`, `wallet`, `cash`) × `bearer` (`guest` | `company`): `fixed_cents`, `percent_bp`, met voor de gastfee de ondergrens/bovengrens uit besluit 11 als CHECK. Platform-defaults alleen door `is_platform_admin()`, company-overrides door admin/finance van de company binnen de grenzen; beide geaudit. De companyfee per methode bestaat (besluit 4) met default €0.
- **Bedragen altijd server-side** uit tier + fee-regels; de client stuurt alleen `guest_id`/`entry_payment_id`. Fee-regels en tierprijs worden **gesnapshot** op `entry_payments`, zodat een latere tariefwijziging een oude betaling niet herschrijft.
- **Cash (besluit 14):** alleen als `venues.cash_payments_enabled` aan staat (company-breed, admin); een cash-betaling maakt dezelfde `entry_payments`-rij (`method = 'cash'`, geen PSP, `succeeded` direct, geaudit op de doorhost) en telt mee in de inkoop B van de company; de servicefee geldt ook bij cash (PSD2: gelijke fee) en wordt verrekend in de wekelijkse run.
- **Facturen in type 3:** de gast krijgt een bon van PlusOne (9 %); de company levert aan PlusOne via een **self-billing-inkoopfactuur per wekelijkse uitbetaling** (besluit 18), 9 % of vrijgesteld. In type 1 is het een 21 %-factuur van PlusOne aan de company (niet in v1).
- **Documenten uit onze eigen engine, niet uit Stripe (ronde 3, punt 10):** Stripe kent bij Tap to Pay alleen een kale ontvangstmail, kan geen self-billing-factuur maken en geen wekelijkse afrekening met verrekening. Eén documentengine van PlusOne voor de bon aan de gast, de self-billing-inkoopfactuur, de wekelijkse afrekening en de type-1-feefactuur, met doorlopende nummering per `issuer`, btw-regels en PDF-archief; Stripe's receipt-mails uit, Checkout `invoice_creation` uit. Juridisch: self-billing vraagt een afspraak in de voorwaarden ("factuur uitgereikt door de afnemer") en beide btw-nummers op het document; de bon aan de gast is B2C, een vereenvoudigde factuur volstaat.
- **Bon aan de gast (besluit 20):** verstuurd via de gastmail-wachtrij (#13 herzien) zodra `entry_payments` op `succeeded` staat én de gast een e-mailadres heeft. Het betaalscherm van de doorhost heeft een optioneel e-mailveld dat via het bestaande, geaudite gast-update-pad op de gastrij landt; daarna volgt de bon automatisch. Nooit vanaf het deurpad zelf; de server action enqueue't na de webhook.
- **Stripe Billing in de verrekening (besluit 20):** het abonnement blijft in Stripe Billing (plan, trial, factuur, entitlement via webhook, ongewijzigd), maar de **inning** verandert voor een company met uitbetalingen: de abonnementsfactuur gaat op `collection_method = send_invoice`, de wekelijkse run verrekent het openstaande bedrag met de uitbetaling en meldt de factuur bij Stripe als `paid_out_of_band`; dekt het saldo het niet, dan blijft de Stripe-factuur open en betaalt de company hem via de hosted-invoice-pagina met iDEAL, of hij wordt ingehouden op de volgende uitbetaling. Een company zonder verkopen betaalt dus gewoon de Stripe-factuur zoals nu. Besloten (ronde 4, punt 21).
- **Refunds (besluit 8):** de company beslist (admin of finance) en kiest **(a) alleen het ticketbedrag** terug (PlusOne houdt servicefee én transactiekosten) of **(b) alles** terug (service- en transactiekosten voor de company). Op ons account is dat één `refunds.create` met het gekozen bedrag; bij (b) boekt de ledger onze fee plus de niet-terugkomende Stripe-kosten als vordering op de company, verrekend in de volgende run. `entry_payments` → `refunded`/`partially_refunded`; de gast terug naar "te betalen" of `removed`, keuze van de company.
- **Chargebacks (besluit 29, marktstandaard):** PlusOne vecht elke chargeback aan (Stripe disputes API; de check-in-rij van de gast is het bewijs dat de dienst geleverd is, plus de bon en de reservering). Verliezen we, dan draagt de company de kosten: het betwiste bedrag én de chargeback-kosten van **€20 excl. btw** (doorbelast met 21 %, als service-regel op de afrekening), beide als vordering in `company_ledger`, verrekend in de volgende run. Winnen we, dan vervalt de vordering (Stripe geeft de betwistingskosten terug bij winst). De company ziet elke dispute en zijn status in Settings → Payments; de voorwaarden leggen dit vast (§7).
- **Holding (besluit 7 + 19):** dividend-only, dus geen intercompany-leg. Elke bon, factuur en afrekening draagt wel een `issuer`-entiteit (nu The Operators, later de werkmaatschappij) zodat de ene overstap naar een B.V. geen datamodelwijziging vraagt.
- **Accountant en jurist vóór P4:** bevestigen de type-3-constructie (verkoop in eigen naam, 9 % op C, self-billing B), de machtiging in de voorwaarden (uitbetalen, inhouden), het agentpad van type 1 (PSD2-handelsagent, Stripe-voorwaarden) en de consumentenverplichting die PlusOne als verkoper draagt bij een afgelast event.

## 4. Architectuur

**Provider-seam.** `src/features/payments/` met een `PaymentProvider`-interface naast `BillingProvider` (`src/features/billing/provider.ts`), gekozen per `(provider, method)` uit de fee-regels: `createDoorPayment({ entryPaymentId, method })` → `{ clientSecret | hostedUrl }`, `createConnectionToken({ locationId })`, `refund({ entryPaymentId, amountCents })`, `feesFor(paymentId)` → werkelijke PSP-kosten. Stripe-adapter in dezelfde map; de **stripe-confinement-guard** (`src/features/billing/stripe-confinement.test.ts`) krijgt `features/payments` als tweede toegestane map **in dezelfde PR** die de adapter maakt, nooit eerder. Zonder `STRIPE_SECRET_KEY` een stub (zoals billing).

**Multi-PSP-regel (besluit 4 + 16).** Omdat PlusOne zelf uitbetaalt, hoeft een PSP geen split-settlement te bieden: elke PSP die het geld op een PlusOne-account laat landen past (Stripe nu; Pay.nl, Mollie of Adyen later). Het grootboek is van PlusOne en PSP-onafhankelijk; een adapter levert betaling, refund en werkelijke kosten. Per betaalmethode kan dus een andere PSP gelden (besluit 4).

**Tabellen (migraties in P1; grant-matrix per tabel, RLS allowed + denied per rol in pgTAP):**

| Tabel | Rol | Bijzonderheden |
|---|---|---|
| `company_payout_accounts` | `venue_id`, `iban`, `account_holder`, `verified_at`, `verified_by`; whitelist: `vat_type` (1 \| 3; 2 gereserveerd), `vat_exempt_code`; `payments_enabled` (alleen bij type 3), `cash_payments_enabled`; `mandate_accepted_at`/`by` (de machtiging uit besluit 16, geaccepteerd door een admin van de company) | Alleen admin/finance van de company lezen en de IBAN zetten; `verified_*` en `vat_exempt_code` alleen door `is_platform_admin()`; `vat_type` automatisch bij KvK + geldig btw-nummer (trigger), 3 → 1 geweigerd. IBAN is geen kaartgegeven maar wél gevoelig: eigen kolom-grant, nooit in logs. |
| `payment_fee_rules` | §3 | Audit-trigger (geldconfiguratie); CHECK op de onder-/bovengrens van de gastfee. |
| `tier_capacity` | één rij per tier (en per request-link): `capacity`, `sold`, `held`; `shop_holds` met `expires_at` per klik op + | De O(1)-teller voor de shop (§4 "Route A en de shop"); holds verlopen lazy + pg_cron; de capaciteits-triggers 45005/45006 lezen dezelfde teller. Geen grant voor `anon`; de shop reserveert via een SECURITY DEFINER-RPC met de publieke throttle. |
| `entry_payments` | `id` (server-default UUID, online-only, zoals `push_tokens`), `venue_id`, `event_id`, `guest_id`, snapshot van tier + fees, `provider`, `method`, `provider_payment_id`, `amount_cents` (C), `company_amount_cents` (B), `status` (`requires_payment` → `processing` → `succeeded` \| `failed` \| `canceled` → `refunded` \| `partially_refunded` \| `disputed`), `provider_fee_cents` (uit `balance_transaction`, later gevuld), `created_by`, `paid_at`, `receipt_email_sent_at`, `override_by`/`override_reason`, `payout_run_id` | **In de audit-triggerset** (regel #4: domein- én gelddata). RLS: zie `check_ins` (event-scope), doorhost/organizer/admin lezen; alleen de server schrijft status. Idempotent op `(provider, provider_payment_id)`; `cash` heeft een eigen idempotency-key van de client. |
| `company_ledger` | per company een rekening-courant: regels voor inkoop B (credit), abonnement (debet, met Stripe-factuur-id), refund-kosten, chargebacks, correcties, uitbetaling; `issuer`-entiteit, `balance_transaction_id` waar van toepassing | Append-only; het saldo per company is de som; bron voor de wekelijkse run, de afrekening en het blended-rate-rapport. |
| `payout_runs` + `payout_run_items` | per week één run: status (`draft` → `approved` → `exported` → `paid`), per company het saldo, de SEPA-batch (pain.001) als bestand, de self-billing-factuur en de afrekening als documenten; een negatief saldo levert geen item maar een open vordering (en, boven een drempel, een iDEAL-betaalverzoek) | Alleen platform-admin; goedkeuring door Max vóór export ("controle en pressie", besluit 18). |

**Uitbetalingsrun (de voorzet, besluit 18).** Elke maandag 09:00: (1) de run verzamelt per company alle `entry_payments` met `succeeded`/`refunded` sinds de vorige run en de open ledger-posten; (2) saldo = Σ inkoop B − Σ vorderingen (abonnement, refund-kosten, chargebacks); (3) Max keurt de run goed in de Platform-tab (per company zichtbaar: saldo, aantal betalingen, open disputes); (4) export van één SEPA-batch (pain.001.001.03) voor de bank plus per company de self-billing-inkoopfactuur en de afrekening via de documentengine en de teammail; (5) na de bankbevestiging `paid`. Negatief saldo: de company ziet het in Settings → Payments en krijgt een iDEAL-betaalverzoek (Stripe hosted invoice, besluit 20) of het wordt ingehouden op de volgende run. Het bedrag van een run is nooit groter dan het saldo op de PlusOne-balans min een reserve voor disputes (instelling, platform-admin).

**Deurflow (route C) en de outbox-invariant (#25).** Betalen is **online-only** (Stripe: offline mode is niet compatibel met Tap to Pay). De deur toont bij een betaalde tier de bestaande `pay`-vlag (`src/features/door/model.ts`) als "€X te betalen"; **Charge** = server action → PaymentIntent (card_present, ons account) → de native plugin int → webhook `payment_intent.succeeded` (op het **bestaande** endpoint `POST /api/webhooks/stripe`, zelfde `stripe_webhook_events`-ledger) → `entry_payments.status = succeeded` → realtime zet de vlag uit → de check-in zelf blijft een **outbox-write**, onveranderd. Een gast met "te betalen" kan offline **niet** worden ingecheckt, behalve via de **geaudite override** (admin/organisator, reden verplicht) of als cash (company-breed aan).

**Route A (QR/iDEAL, web) en de shop (besluit 17, instellingen besluit 22, ronde 5).** Zelfde PaymentIntent met iDEAL/kaart/wallets op ons account via **Stripe Checkout** (hosted; de minimale geldigheid van 30 minuten is geen probleem, want late betalingen vangen we zelf af, zie het beleid hieronder), redirect via `/pay/[token]` (token gehasht, zelfde throttle-familie als `/r`), QR in de mobiele deur én in de cockpit. **Shop op `/e/[slug]`:** een link of tier kan op "betaal om op de lijst te komen" staan.
- **De reservering start bij de "+" (besluit 25).** Elke klik op + reserveert één plek atomair: `UPDATE tier_capacity SET held = held + 1 WHERE sold + held < capacity RETURNING …` op één rij per tier (en per request-link), nooit een COUNT over gasten onder druk; "−" geeft direct vrij. Daarna gegevens (naam, e-mail), daarna Checkout. Een hold heeft een `expires_at` (`shop_hold_minutes`, default 8, per company). **Vrijgave zo snel mogelijk** (dat is het hele spel bij een piek): lazy bij elke reserveer-poging (verlopen holds worden eerst teruggeteld) én door pg_cron elke 30 s.
- **Late betalingen (besluit 26):** geen harde klok op de betaalpagina. Slaagt een betaling nadat de hold verlopen is, dan beslist `shop_late_payment_policy`: `oversell_percent` (default, `shop_oversell_percent` default **5 %**, besluit 27: toelaten zolang `sold ≤ capacity × (1 + p)`, anders automatische refund), `refund` (harde max), `accept_always` (alleen door een platform-admin te zetten, besluit 32: zulke sales gaan altijd samen met de klant). Timing uit Max' ervaring: 90 % binnen ±1,5 minuut, 5 % binnen 5 minuten, daarna een lange staart; 8 minuten dekt de kop, het beleid de staart. Een refund gaat met de bestaande mechaniek plus de mail "je plek was al weg, het bedrag komt terug".
- **Handmatig uitverkocht (besluit 31):** `guest_tiers.shop_sold_out` (+ `_at`/`_by`, geaudit via de bestaande `guest_tiers`-trigger), te zetten door admin/organisator in de tier-editor en in de cockpit. De reserveer-RPC weigert elke nieuwe hold op die tier, `/e/[slug]` toont "uitverkocht" op de "+" zonder reload (de teller-RPC geeft de vlag mee, realtime op de publieke pagina), lopende holds en betalingen lopen gewoon af. Alleen met de hand weer open; verlopen holds openen een handmatig gesloten tier nooit.
- **Het sold-out-blok (besluit 27): refunds kosten geld, dus zodra het zeker uitverkocht is stoppen we de instroom in plaats van achteraf te refunden.** Drie lagen: (1) **geen nieuwe holds** zodra `sold + held ≥ capacity × (1 + p)`: de "+" geeft "uitverkocht", er wordt geen Checkout-sessie meer gemaakt; (2) **een verlopen hold waarvan de tier intussen vol is, sluit zijn Checkout-sessie actief** via Stripe's `checkout.sessions.expire` (kan zolang de sessie `open` is), zodat de gast niet meer kán betalen en er niets te refunden valt; is de tier nog niet vol, dan blijft de sessie open en wordt een late betaling gewoon toegelaten; (3) alleen een betaling die al `processing` was op het moment van sluiten (iDEAL-redirect onderweg) kan nog slagen, en die valt onder het oversell-beleid. Zo blijft de refund-staart beperkt tot wat technisch niet te stoppen is.
- **Het gesprek met de klant (besluit 27):** de shop-instellingen zijn geen vinkjes maar een keuze die we uitleggen bij het aanzetten: strikte max = een paar late betalers krijgen hun geld terug (en wij houden de Stripe-kosten als verlies); 5 % oversell = minder refunds, hooguit 5 % extra binnen; altijd toelaten = nooit een refund, geen bovengrens. Eén uitlegscherm in Settings → Payments met deze drie regels en de default (5 %), plus dezelfde tekst in de onboarding-copy (`copy-deck.md`, P2).
- **Webhook:** `payment_intent.succeeded` → hold naar `sold`, gastrij `confirmed`, bon via de gastmail-wachtrij. **Geen ticket, geen QR-code voor de gast:** alleen "je staat op de lijst" (statuspagina `/r/[token]`), de deur ziet "betaald". Holds tellen nooit in de headcount (#44), wél in de capaciteit; de triggers 45005/45006 blijven de waarheid voor handmatige adds en lezen dezelfde teller.
- **Schaal (Max: 100k mensen in de shop).** Het tellermodel is O(1) per klik en houdt duizenden klikken per seconde op Postgres; de publieke pagina is statisch met een gecachete "nog N plekken"-teller; rate limits per IP via de bestaande throttle. **100k gelijktijdige bezoekers vraagt daarbovenop een wachtkamer aan de rand**, waarschijnlijk **Queue-it** (besluit 33): de Queue-it-connector vóór `/e/[slug]` en de reserveer-RPC, server-side validatie van het Queue-it-token zodat de database alleen toegelaten bezoekers ziet, en per company een eigen wachtrij-ontwerp. Dat is P7 (≥25, externe devs), niet v1. De datamodelkeuzes van v1 (tellers, lazy expiry, korte holds) zijn er al op gebouwd, zodat de wachtkamer er later vóór kan zonder herbouw.
- **Later, met het ticketingsysteem (Max: nu niet):** de "laat die vier tickets maar zitten"-logica, waarbij een groep die onderling al betaald heeft zijn holds eerder vrijgeeft, en per-company afspraken over de staart.

**Security (checklist CLAUDE.md op elk pad).** Bedrag en fee uitsluitend server-side; `getUser()` + `can_write_guests`/doorhost-rol per `event_id`; Zod op elke input; connection-token-route alleen voor leden met deurrechten van die company en altijd met `location`; webhook-signature over de raw body; geen PII in URL's (`/pay/[token]` is een opaak token); IBAN alleen via de user-scoped client met kolom-grant; `service_role` alleen in de webhook-handler (gedocumenteerd, zoals de billing-webhook) en in de uitbetalingsrun (platform-admin-RPC, SECURITY DEFINER met `is_platform_admin()`). **High-risk surface** → fresh-session `/code-review` + `/security-review`, security-research-prompt in de PR-body.

**Rapportage.** `venue_event_headcounts`-stijl GROUP BY-RPC voor deuromzet per event (bruto, fees, netto) op het Stats-scherm; per company per maand de blended rate (§2); Platform-tab: saldo per company, open disputes, runs. Nooit rijen naar de client sommen (CLAUDE.md schaalregel).

## 5. Native laag (route C)

Staat in `capacitor-plan-claude-code.md` §2 beslissing 17 en §4 golf 6 (P3a/P3b): plugin `@capacitor-community/stripe-terminal` (Tap to Pay-discovery met `locationId`; Android `minSdkVersion` 24 → 26; `MODIFY_AUDIO_SETTINGS`; alleen de permissies die Tap to Pay nodig heeft), Apple-entitlement `com.apple.developer.proximity-reader.payment.acceptance` (development → distribution), de verplichte "How to Tap"-overlay, device-grenzen (iPhone XS+, **iPhone-only**: de iPad-deur blijft route A; Android 13+, GMS, bootloader locked, **Developer options uit** → Max' debug-toestel kan Tap to Pay niet testen), Codemagic (entitlement + profiel), store-declaraties (Play "Financial features" en Apple App Privacy opnieuw beantwoorden; Apple 3.1.3(e): fysieke dienst, geen IAP) en de carve-out op de store-tax-guards.

## 6. Fasering

Effort in Claude Code-sessies (één ClickUp-taak → één PR). Dezelfde orchestratie-mechaniek als `capacitor-orchestration-claude-code.md` (orchestrator per golf, worker-brief, reviewer-brief voor high-risk).

| # | Fase | Milestone | Effort | Deps | Deliverable |
|---|---|---|---|---|---|
| P0 | Voorbereiding (Max) | ≥5 | — | — | Stripe Terminal activeren op ons account (test mode eerst); **Apple Tap to Pay development-entitlement aanvragen** (Account Holder, langste doorlooptijd); accountant + jurist (§3 laatste bullet); bankrekening met SEPA-batch-upload. |
| P1 | Betaalkern (high-risk) | ≥5 | 2 | P0 (test mode) | Migraties §4 (incl. grant-matrix, audit, pgTAP), `PaymentProvider` + Stripe-adapter + stub, fee-engine met snapshot en company-ophoging, KvK/btw verplicht + privépersoon-vinkje in wizard en Settings (expand-only), automatische whitelist, IBAN + machtiging in Settings → Payments, `entry_payments` live in de deur-snapshot ("€X te betalen"), geaudite override, cash company-breed. Nog geen online betaalmethode. |
| P2 | Route A: QR / iDEAL + shop | ≥5 | 2 | P1 | Checkout op ons account, `/pay/[token]`, QR in deur + cockpit, shop op `/e/[slug]` met reservering bij de "+" (`tier_capacity`, lazy expiry + pg_cron), late-betaling-beleid met oversell-percentage, webhook → `succeeded` → vlag uit, bon van PlusOne via de gastmail-wachtrij (e-mailveld in het betaalscherm), refund met de twee opties. Werkt in PWA én shell, ook op iPad. |
| P3a | Tap to Pay-plugin (native + web-seam) | ≥5 | 2 | P1, P0-entitlement (dev), Capacitor golf 6 | Zie `capacitor-plan-claude-code.md` §4. Connection-token-route, Location per company-locatie, card-present PaymentIntent op ons account, oude-shell-detectie, Android `minSdk` 26. |
| P3b | Tap to Pay store-kant | ≥5 | ½ + Max | P3a | Distribution-entitlement, Codemagic, How-to-Tap-overlay, store-declaraties en review-notes, device-test op een release-build. |
| P4 | Wekelijkse uitbetalingsrun, afrekening, verrekening | ≥5 | 2 | P1, §3-akkoord accountant/jurist | `company_ledger`, `payout_runs`, Platform-tab-goedkeuring, SEPA-batch-export, self-billing-inkoopfactuur + afrekening uit de documentengine, abonnement verrekenen (`send_invoice` + `paid_out_of_band`, iDEAL bij negatief saldo), blended-rate-rapport, deuromzet per event op Stats, saldo in Settings → Payments. |
| P5 | Disputes en operations | ≥5 | 1 | P2 | `charge.dispute.created` → vordering in de ledger (bedrag + €20 excl. btw, besluit 29), bewijs automatisch aanleveren via de disputes API (check-in, bon, reservering), `charge.dispute.closed` → vordering vervalt bij winst, dispute-status in Settings → Payments, Platform-tab-overzicht, handmatige correcties, dispute-reserve. |
| P6 | Tweede, goedkopere PSP | ≥5, na validatie | 1–2 | P4 | Besluit 23: Stripe is om te valideren, te duur voor groei. **Shortlist klaar (2026-10-11, `docs/psp-shortlist-2026-10.md`):** echte SDK's voor iPhone én Android in NL hebben alleen Stripe, Adyen, Pay.nl en SumUp; Mollie, Viva, Worldline, Rabo, CCV, Buckaroo, MultiSafepay en CM.com zijn app-only en vallen af voor Tap to Pay. Offertes bij **Pay.nl** (goedkoopste gepubliceerde iDEAL €0,19 en SoftPOS €0,09, gratis uitbetaling; SDK alleen voor "select partners" + licentie) en **Adyen** (IC++, maandminimum ongepubliceerd); SumUp alleen als Tap-to-Pay-partner naast een iDEAL-PSP. Rekenvoorbeeld op 2.400 trx/maand: Stripe ≈ €880, Pay.nl ≈ €420. Dan de adapter achter `PaymentProvider`; fee-regels per provider zijn er al. |
| P7 | Wachtkamer voor peak sales | ≥25 | extern | P2 | **Queue-it** (besluit 33, ±€15k/jaar volgens Max) vóór `/e/[slug]` en de reserveer-RPC, token-validatie server-side, per company een eigen wachtrij-ontwerp, gecachete publieke pagina, load-test; de v1-tellers blijven ongewijzigd. **Besluit 30: inhuur/partner, geen Claude Code-sessie.** |

**Volgorde (besluit 13):** P1 → P2 op het web (geen store-cyclus, de goedkoopste methode, ook iPad) → P4 (zonder P4 geen uitbetaling, dus P4 vóór de eerste live betaling) → P3a/P3b zodra P1 gemerged is en de dev-entitlement binnen is. **Totaal ≈ 9–11 sessies** plus de Apple-wachttijd. Eerste live betaling pas als P1, P2 én P4 live zijn en de machtiging in de voorwaarden staat.

**ClickUp (aangemaakt 2026-10-11, lijst `901818739469`):** P0 `z8uq9m4a7h` · P1 `z8uq9m4a7j` · P2 `z8uq9m4a7m` · P3a `z8uq9m4a7e` · P3b `z8uq9m4a7g` · P4 `z8uq9m4a7n` · P5 `z8uq9m4a7p` · P6 `z8uq9m4a7q` · P7 `z8uq9m4a7r`; afhankelijkheden P0 → P1 → {P2 → P5, P7; P4 → P6}, P1 + S6 + S1b → P3a → P3b. De oude Fase 14-taken `86exxuuu7` en `86exyp8rc` staan nog op ≥25 (hertag is aan Max).

## 7. Store-, legal- en finance-checklist

- [ ] Accountant: type-3-constructie (verkoop in eigen naam, 9 % op C, self-billing B per week), vrijstellingen op de whitelist, de consumentenverplichting van PlusOne als verkoper, de behandeling van cash (omzet van PlusOne, inkoop van de company) — **vóór P4**.
- [ ] Jurist: de **machtiging** (uitbetalen namens de company, inhouden van abonnement, fees, refund-kosten en chargebacks), het agentpad van type 1 (PSD2-handelsagent, Stripe-voorwaarden) en of v1 daarom type-3-only moet zijn (§9 punt 1) — **vóór P1 live**.
- [ ] Voorwaarden (company): type 1/3 en de whitelist, de onomkeerbare overstap, fee-schema met ophoging, self-billing-mandaat, wekelijkse uitbetaling en verrekening, de twee refund-opties en wie de kosten draagt, **chargebacks: aangevochten door PlusOne, bij verlies bedrag + €20 excl. btw voor de company** (besluit 29), de shop-instellingen en het oversell-/blokbeleid, cash-regels.
- [ ] Guest Terms + Privacy + Subprocessors v1.1: PlusOne als verkoper van het ticket (type 3), Stripe voor gastbetalingen (kaartgegevens nooit bij PlusOne; Tap to Pay-SDK verwerkt ze op het toestel), servicefee-disclosure, refund-beleid, "geen ticket, wel een plek op de lijst"; `TERMS_VERSION` ophogen.
- [ ] Stripe: het businessmodel melden als "verkoop van eigen tickets" (type 3), Terminal-aankondigingslijst abonneren (device-eisen wijzigen), Radar-regels voor card-present; de abonnementsfacturen op `send_invoice` voor companies met uitbetalingen.
- [ ] Play: "Financial features"-declaratie opnieuw (`docs/store/play-review-notes.md` zegt nu "geen"); Apple App Privacy opnieuw tegen Stripe's SDK-guidance; review-notes: fysieke dienst (3.1.3(e)), Tap to Pay als 4.2-meerwaarde.
- [ ] CLAUDE.md-carve-out: store-tax = SaaS-billing; deurbetalingen aan de company zijn toegestaan in de shell; de `PURCHASE_COPY`-regexen in de store-tax-guards blijven tot billing/onboarding beperkt en de deur krijgt een eigen guard.
- [ ] Bij ≥25: een stichting derdengelden of bankgarantie voor het tegenpartijrisico van de companies op de wekelijkse saldi (nu bewust niet).

## 8. Kritieke bestanden

- `src/features/billing/provider.ts` + `stripe-confinement.test.ts` — het voorbeeld voor de `PaymentProvider`-seam en de guard die mee moet
- `src/features/billing/stripe-webhook.ts` + `src/app/api/webhooks/stripe/` — het bestaande endpoint dat `payment_intent.*` en `charge.dispute.*` erbij krijgt
- `src/features/billing/stripe-adapter.ts` — de abonnementsfactuur krijgt `send_invoice` + `paid_out_of_band` (P4)
- `src/features/door/model.ts` — de `pay`-vlag die live gaat
- `src/features/door/DoorProvider.tsx` — ongewijzigd: de check-in blijft outbox, de betaling niet
- `src/features/venues/schemas.ts` + `VenueSettingsForm.tsx` — KvK/btw verplicht, privépersoon-vinkje, cash-schakelaar, IBAN + machtiging
- `supabase/migrations/20260624180000_tier_door_price.sql` + `20260706140000_tier_vat_percent.sql` — de bestaande tierprijs en btw-kolommen
- `src/features/guests/` gastmail-templates (6a) — de bon
- `src/app/e/` + `src/app/r/` — de shop op de publieke pagina en de statuspagina
- `docs/store/play-review-notes.md`, `docs/store/play-store-listing.md` — declaraties die veranderen
- `capacitor-plan-claude-code.md` §2 17, §4 golf 6 — de native laag

## 9. Nog open voor Max

Besloten in ronde 5: alleen type 3 in v1 (de typen 1 zijn de privépersoon en de KvK-zonder-btw, waarbij PlusOne namens een ander zou innen; pas open na de jurist), vrijstellingen handmatig, reservering bij de "+", late betalingen via het oversell-beleid, Stripe Checkout (geen Payment Element).

Ronde 6: default oversell 5 % besloten, sold-out-blok en klantgesprek toegevoegd (§4), chargeback-regel toegevoegd (§3), PSP-onderzoek gestart (`docs/psp-shortlist-2026-10.md`), P7 is een inhuurpost. Ronde 7: handmatig uitverkocht per tier, `accept_always` alleen platform-admins, wachtkamer = Queue-it.

1. **PSP-keuze** (shortlist in `docs/psp-shortlist-2026-10.md`): voorstel offertes bij **Pay.nl en Adyen**, met de elf offertevragen uit §4 van dat document; SumUp alleen als Max een aparte Tap-to-Pay-partner naast een iDEAL-PSP wil (twee ledgers). Niet geverifieerd en dus in de offerte te vragen: Pay.nl chargeback-fee en refund-beleid, Adyen maandminimum, EUR-fixed-fee en chargeback-fee, SumUp iDEAL-tarief; de Capacitor-bridge per SDK is niet beoordeeld.
