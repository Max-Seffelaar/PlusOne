# Betaalplan — Fase 14: deurbetalingen & betaalplatform (eigen Stripe-account, Tap to Pay, wekelijkse uitbetaling)

> Status: **besloten in hoofdlijnen 2026-10-11 (Max, drie rondes dezelfde dag); vier restpunten in §9.** **Herzien 2026-10-12 (office-hours + CEO-review, §10; design-doc `docs/designs/fase-14-deurbetalingen-office-hours.md`, APPROVED):** v1 = aanpak C — P1 betaalkern → P2 één betaling per gastrij op twee oppervlakken (deur-QR + maillink), géén open shop (P2b) → P4a ledger + weekstaat + handmatige SEPA → eerste live euro → P3 Tap to Pay zodra entitlement + store; P4b/P2b/P6 later. Waar §1–§9 en §10 verschillen, geldt §10. Grondslag: spec-beslissing **#34** (deurbetalingen route A/B/C), **#37** (native) en **#62** (geldstroom, type-model, fee-model, uitbetaling). Native laag = `capacitor-plan-claude-code.md` §4 golf 6 (beslissing 17). ClickUp: [86exxuuu7](https://app.clickup.com/t/86exxuuu7) (Fase 14) en [86exyp8rc](https://app.clickup.com/t/86exyp8rc) (backlog kassamodule).
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
| `payment_fee_rules` | §3 — **niet in v1 (D19, 2026-10-12):** de ondergrens is een constante in `src/features/payments/`, de company-ophoging zijn twee kolommen op `company_payout_accounts` (`service_fee_fixed_cents`, `service_fee_bp`, CHECK ≤ 300 / ≤ 260); deze tabel komt expand-only bij P4b/P6 | Audit-trigger (geldconfiguratie); CHECK op de onder-/bovengrens van de gastfee. |
| `tier_capacity` | **P2b, niet in v1 (D13, 2026-10-12).** één rij per tier (en per request-link): `capacity`, `sold`, `held`; `shop_holds` met `expires_at` per klik op + | De O(1)-teller voor de shop (§4 "Route A en de shop"); holds verlopen lazy + pg_cron; de capaciteits-triggers 45005/45006 lezen dezelfde teller. Geen grant voor `anon`; de shop reserveert via een SECURITY DEFINER-RPC met de publieke throttle. |
| `entry_payments` | `id` (PSP-rijen: server-default UUID; **cash-rijen: client-side UUIDv7 via de outbox met één smalle RLS-insertpolicy**, D16.1), `venue_id`, `event_id`, `guest_id`, **`heads`** (hoofden per betaalmoment, D15.2), **`pay_token`** (opaak, event-einde + 24 u; server- of client-gemint, D15.1/D16.2), **`payer_email`** (uit Checkout, RLS event-scope, in de AVG-anonimisatie), snapshot van tier + fees, `provider`, `method`, `provider_payment_id`, `amount_cents` (C), `company_amount_cents` (B), `status` (`requires_payment` → `processing` → `succeeded` \| `failed` \| `canceled` → `refunded` \| `partially_refunded` \| `disputed`; plus vlaggen `needs_review`, `needs_refund`, `over_ceiling`, §10), `provider_fee_cents` (uit `balance_transaction`, later gevuld), `created_by`, `paid_at`, `receipt_email_sent_at`, `override_by`/`override_reason`, `payout_run_id` | **In de audit-triggerset** (regel #4: domein- én gelddata). RLS: zie `check_ins` (event-scope), doorhost/organizer/admin lezen; alleen de server schrijft status. Idempotent op `(provider, provider_payment_id)`; `cash` heeft een eigen idempotency-key van de client. |
| `company_ledger` | per company een rekening-courant: regels voor inkoop B (credit), abonnement (debet, met Stripe-factuur-id), refund-kosten, chargebacks, correcties, uitbetaling; `issuer`-entiteit, `balance_transaction_id` waar van toepassing | Append-only; het saldo per company is de som; bron voor de wekelijkse run, de afrekening en het blended-rate-rapport. |
| `payout_runs` + `payout_run_items` | per week één run: status (`draft` → `approved` → `exported` → `paid`), per company het saldo, de SEPA-batch (pain.001) als bestand, de self-billing-factuur en de afrekening als documenten; een negatief saldo levert geen item maar een open vordering (en, boven een drempel, een iDEAL-betaalverzoek) | Alleen platform-admin; goedkeuring door Max vóór export ("controle en pressie", besluit 18). |

**Uitbetalingsrun (de voorzet, besluit 18).** Elke maandag 09:00: (1) de run verzamelt per company alle `entry_payments` met `succeeded`/`refunded` sinds de vorige run en de open ledger-posten; (2) saldo = Σ inkoop B − Σ vorderingen (abonnement, refund-kosten, chargebacks); (3) Max keurt de run goed in de Platform-tab (per company zichtbaar: saldo, aantal betalingen, open disputes); (4) export van één SEPA-batch (pain.001.001.03) voor de bank plus per company de self-billing-inkoopfactuur en de afrekening via de documentengine en de teammail; (5) na de bankbevestiging `paid`. Negatief saldo: de company ziet het in Settings → Payments en krijgt een iDEAL-betaalverzoek (Stripe hosted invoice, besluit 20) of het wordt ingehouden op de volgende run. Het bedrag van een run is nooit groter dan het saldo op de PlusOne-balans min een reserve voor disputes (instelling, platform-admin).

**Deurflow (route C) en de outbox-invariant (#25).** Betalen is **online-only** (Stripe: offline mode is niet compatibel met Tap to Pay). De deur toont bij een betaalde tier de bestaande `pay`-vlag (`src/features/door/model.ts`) als "€X te betalen"; **Charge** = server action → PaymentIntent (card_present, ons account) → de native plugin int → webhook `payment_intent.succeeded` (op het **bestaande** endpoint `POST /api/webhooks/stripe`, zelfde `stripe_webhook_events`-ledger) → `entry_payments.status = succeeded` → realtime zet de vlag uit → de check-in zelf blijft een **outbox-write**, onveranderd. **Herzien 2026-10-12 (D15.1/D15.2, §10):** de QR is `/pay/[token]?heads=k` met een vooraf gemint token uit de deur-snapshot en werkt dus zonder netwerk op het toestel van de doorhost; een check-in van hoofden waarvoor dít toestel nog geen bevestigde betaling heeft krijgt de outbox-uitkomst **"nog niet bevestigd"** (online eerst tot 10 s wachten op realtime), afgestemd bij sync (webhook wint), apart van de **geaudite override** (admin/organisator, reden verplicht, bewust gratis binnenlaten); cash (company-breed aan) gaat via de outbox. Betaling per hoofden die nú binnenkomen; meerdere betalingen per gastrij.

**Route A (QR/iDEAL, web) en de shop (besluit 17, instellingen besluit 22, ronde 5).** **Herzien 2026-10-12 (D13/L4, §10): in v1 alleen de betaling per gastrij — deur-QR én maillink zijn hetzelfde `/pay/[token]`-object, lekvrij omdat het aan één naam hangt; walk-in-verkoop = quick-add + dezelfde betaling (D14.3); betaalmethoden iDEAL + alle kaarten + wallets, disputes als P2-acceptatie-eis (D14.4). De shop hieronder (holds, oversell, sold-out, Queue-it) is fase P2b met een eigen spec-besluit tegen #10 en wordt pas gebouwd als een venue erom vraagt.** Zelfde PaymentIntent met iDEAL/kaart/wallets op ons account via **Stripe Checkout** (hosted; de minimale geldigheid van 30 minuten is geen probleem, want late betalingen vangen we zelf af, zie het beleid hieronder), redirect via `/pay/[token]` (token gehasht, zelfde throttle-familie als `/r`), QR in de mobiele deur én in de cockpit. **Shop op `/e/[slug]`:** een link of tier kan op "betaal om op de lijst te komen" staan.
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
| P2 | Route A: betaling per gastrij (deur-QR + maillink) | ≥5 | 2–3 (P2-deur + P2-geld) | P1 | **Herzien 2026-10-12 (§10).** Vooraf gemint `/pay/[token]` in de deur-snapshot (en client-gemint bij quick-add), QR `?heads=k` in deur + cockpit, maillink in de goedkeuringsmail en `/r/[token]`, Checkout op ons account (iDEAL + kaarten + wallets), plafond per gastrij bij aanmaak én webhook, webhook → `succeeded` → vlag uit, uitkomst "nog niet bevestigd" + afstemming, walk-in = quick-add + betaling, bon van PlusOne via de gastmail-wachtrij (`payer_email`), refund met de twee opties, dubbel-betaald-refund met `needs_refund`-fallback, disputes (webhook + €20-regel), noodrem. Geen shop, geen `tier_capacity`. Werkt in PWA én shell, ook op iPad. |
| P2b | Open shop op `/e/[slug]` | later, op aanvraag | 2 | P2 + spec-besluit tegen #10 | Reservering bij de "+" (`tier_capacity`, lazy expiry + pg_cron), late-betaling-beleid met oversell-percentage, sold-out-blok, handmatig uitverkocht; zie §4 "Route A en de shop" en spec #62(h). Niet in v1 (D13). |
| P3a | Tap to Pay-plugin (native + web-seam) | ≥5 | 2 | P1, P0-entitlement (dev), Capacitor golf 6 | Zie `capacitor-plan-claude-code.md` §4. Connection-token-route, Location per company-locatie, card-present PaymentIntent op ons account, oude-shell-detectie, Android `minSdk` 26. |
| P3b | Tap to Pay store-kant | ≥5 | ½ + Max | P3a | Distribution-entitlement, Codemagic, How-to-Tap-overlay, store-declaraties en review-notes, device-test op een release-build. |
| P4a | Ledger, weekstaat, handmatige uitbetaling | ≥5 | 1–2 | P1, §3-akkoord accountant/jurist (gate vóór het ontwerp bevriest) | **Herzien 2026-10-12 (D13, §10).** `company_ledger` (append-only), `payout_runs` (draft → approved → paid), Platform-tab-goedkeuring die een payout-ledgerregel schrijft (actor, bedrag, weekstaat-id, bankreferentie), weekstaat + self-billing-inkoopfactuur als eenvoudige PDF, saldo in Settings → Payments, deuromzet per event op Stats; Max voert de SEPA-overboekingen handmatig uit (houdbaar tot ~10 companies). Vóór de eerste live euro. |
| P4b | Uitbetaalautomatisering | zodra 10 companies een uitbetaling krijgen óf na 500 betaalde entrees | 2 | P4a | pain.001-batch, abonnement verrekenen (`send_invoice` + `paid_out_of_band`, iDEAL bij negatief saldo), volledige documentengine, blended-rate-rapport, retry-wachtrij voor gefaalde refunds, `payment_fee_rules`-tabel. Zie `TODOS.md`. |
| P5 | Disputes en operations — **opgegaan in P2 (D14.4, 2026-10-12)**; taak `z8uq9m4a7p` wordt herbestemd tot het P4b-besluit over blokkeren of een companyfee per methode op basis van de blended rate | — | — | P2 | `charge.dispute.created` → vordering in de ledger (bedrag + €20 excl. btw, besluit 29), bewijs automatisch aanleveren via de disputes API (check-in, bon, reservering), `charge.dispute.closed` → vordering vervalt bij winst, dispute-status in Settings → Payments, Platform-tab-overzicht, handmatige correcties, dispute-reserve. |
| P6 | Tweede, goedkopere PSP | ≥5, na validatie | 1–2 | P4 | Besluit 23: Stripe is om te valideren, te duur voor groei. **Shortlist klaar (2026-10-11, `docs/psp-shortlist-2026-10.md`):** echte SDK's voor iPhone én Android in NL hebben alleen Stripe, Adyen, Pay.nl en SumUp; Mollie, Viva, Worldline, Rabo, CCV, Buckaroo, MultiSafepay en CM.com zijn app-only en vallen af voor Tap to Pay. Offertes bij **Pay.nl** (goedkoopste gepubliceerde iDEAL €0,19 en SoftPOS €0,09, gratis uitbetaling; SDK alleen voor "select partners" + licentie) en **Adyen** (IC++, maandminimum ongepubliceerd); SumUp alleen als Tap-to-Pay-partner naast een iDEAL-PSP. Rekenvoorbeeld op 2.400 trx/maand: Stripe ≈ €880, Pay.nl ≈ €420. Dan de adapter achter `PaymentProvider`; fee-regels per provider zijn er al. |
| P7 | Wachtkamer voor peak sales | ≥25 | extern | P2 | **Queue-it** (besluit 33, ±€15k/jaar volgens Max) vóór `/e/[slug]` en de reserveer-RPC, token-validatie server-side, per company een eigen wachtrij-ontwerp, gecachete publieke pagina, load-test; de v1-tellers blijven ongewijzigd. **Besluit 30: inhuur/partner, geen Claude Code-sessie.** |

**Volgorde (besluit 13, herzien 2026-10-12 — D13):** P1 → P2 (betaling per gastrij, incl. disputes; web, ook iPad) → P4a (zonder ledger en mandaat geen uitbetaling, dus vóór de eerste live betaling) → **eerste live euro bij LOFI/Maassilo + meting van één avond** → P3a/P3b zodra het Apple-entitlement en de store-goedkeuring binnen zijn → P4b/P2b/P6 op hun triggers. **Tot de eerste live euro ≈ 6–7 sessies** (P1 2, P2 2–3, P4a 1–2) plus de P0-wachtklokken (Stripe-meeting met schriftelijke bevestiging, jurist, accountant, bank); realistisch eind november / december 2026. Eerste live betaling pas als P1, P2 én P4a live zijn, de jurist/accountant akkoord zijn en de machtiging in de voorwaarden staat.

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

0. **Open vragen uit de review van 2026-10-12** staan in het design-doc (`docs/designs/fase-14-deurbetalingen-office-hours.md` §Open Questions): letterlijke vraag per venue, ticketdocument-vlag per tickettype, Stripe-meeting + schriftelijke bevestiging (MCC, reserve, uitbetaaltermijn, Maestro contactloos, Android-tablets), jurist over afzondering van venue-geld, deur-UI voor de hoofden-keuze, Maestro/tablet-devicetest in P3a.
1. **PSP-keuze** (shortlist in `docs/psp-shortlist-2026-10.md`): voorstel offertes bij **Pay.nl en Adyen**, met de elf offertevragen uit §4 van dat document; SumUp alleen als Max een aparte Tap-to-Pay-partner naast een iDEAL-PSP wil (twee ledgers). Niet geverifieerd en dus in de offerte te vragen: Pay.nl chargeback-fee en refund-beleid, Adyen maandminimum, EUR-fixed-fee en chargeback-fee, SumUp iDEAL-tarief; de Capacitor-bridge per SDK is niet beoordeeld.

## 10. CEO-review 2026-10-12 (gstack `/plan-ceo-review`, modus HOLD SCOPE) — werkdocument

> Bron: office-hours van dezelfde dag, design-doc **APPROVED**: `docs/designs/fase-14-deurbetalingen-office-hours.md` (cross-session-kopie in `~/.gstack/projects/Max-Seffelaar-PlusOne/`). Dit hoofdstuk is het reviewverslag; de wijzigingen aan §1–§9 die eruit volgen staan onder "Gevolgen" in het design-doc en worden pas doorgevoerd na de review (aparte PR op `claude/86exxuuu7-fase14-ceo-review`).

### 10.1 Besluitenledger

| ID / owner | Contract en bewijs | Current | Proposed | Status | Goedkeuring en scope |
|---|---|---|---|---|---|
| L1 Max | Aanpak voor v1 (design-doc §Recommended Approach) | plan §6: P1→P2 (QR+shop)→P4→P3 | C: P1→P2 (betaling per gastrij, geen shop)→P4a (ledger, weekstaat, factuur, handmatige SEPA)→live→P3a/b→P4b/P2b | approved | D13 = C; scope = v1-volgorde en P4-splitsing |
| L2 Max | Besluit 16 (eigen Stripe-account, geen Connect) | besluit 16 | second opinion: Connect Express voor v1 | approved (gehouden) | D12 = B; P0 houdt de drie bewijsstukken als open vragen 4/5 |
| L3 Max | Route B (losse smart reader) | Capacitor-plan §5 "niet nu" | definitief uit; Tap to Pay native = product, QR = brug | approved | premisse 5 / D10 |
| L4 Max | P2-scope | QR + shop op /e/[slug] | één getokeniseerde betaling per gastrij op twee oppervlakken; shop = P2b met eigen spec-besluit tegen #10 | approved | D13 + premisse 3 |
| L5 Max | Walk-in-verkoop | niet in plan | in v1: quick-add + betaling per rij; #10-grens in spec #62 | approved | D14.3 |
| L6 Max | Betaalmethoden v1 | "iDEAL/kaart/wallets" impliciet | iDEAL + alle kaarten + wallets; disputes = P2-acceptatie-eis (P5 vervalt als fase) | approved | D14.4 |
| L7 Max | Eenheid van betaling | per gastrij (impliciet) | hoofden die nú binnenkomen; meerdere betalingen per rij; `entry_payments.heads` | approved | D14.2 / D15.2 |
| L8 Max | Offline deur | "offline alleen via override" | vooraf gemint `/pay/[token]` in de deur-snapshot + uitkomst "nog niet bevestigd" naast override | approved | D14.1 / D15.1 |
| L9 Max | Cash-schrijfpad | `entry_payments` server-only | cash via outbox, client-side UUIDv7, smalle RLS-insert | approved | D16.1 |
| L10 Max | Token voor rijen ná event-start | niet gedefinieerd | client-gegenereerd in de outbox-payload | approved | D16.2 |
| L11 Max | Design-doc | DRAFT | APPROVED | approved | D17 (geen voorkeur = aanbevolen A) |
| L12 Max | Spec #62 verouderde tekst: (a) "transfer reversal" (Connect-restant), (b) `company_payment_accounts` ≠ plan `company_payout_accounts`, (c) `vat_type` "alleen platform-admin" ≠ plan "automatisch", (h) shop als P2b | spec regel 80 | corrigeren in de opvolg-PR | approved | D17 (design-doc "Gevolgen" goedgekeurd) → taak T12 |
| L13 Max | ClickUp: P4 `z8uq9m4a7n` splitsen in P4a/P4b, P5 `z8uq9m4a7p` herbestemmen, P2b-taak nieuw, `86exxuuu7`/`86exyp8rc` hertaggen ≥5 (status staat op "25 clients") | tags milestone-25 | bijwerken | approved | D17 (design-doc "Dependencies/ClickUp" goedgekeurd) → taak T13; uitvoering door Max |
| L14 Max | `payment_fee_rules` als tabel in P1 | plan §3/§4: tabel per provider × methode × drager | v1: ondergrens als constante + twee company-kolommen; tabel bij P4b/P6 | approved | D19 = B (Max 2026-10-12); scope: P1-datamodel; besluiten 4/11 ongewijzigd |

### 10.2 Step 0A — premisse-challenge

- **Echte probleem:** aan de deur is niet traceerbaar wie betaalde, mensen komen onbetaald binnen, er zijn geen records van wie wanneer kwam, en pin-transacties worden overgetypt of niet geïnd (Max, design-doc §Problem Statement).
- **Doel:** eerste live betaling bij LOFI of Maassilo met "betaald" op de gastrij, een weekstaat die op de cent klopt, en de meting van één avond (sec/entree, afhaak, onbevestigd/override).
- **Niets-doen-kosten:** vier prospects (LOFI, Boothstock, Solar, Maassilo) houden het losse kastje; PlusOne blijft een lijst-tool zonder geldstroom; de USP "iedere scanner een verkoper" blijft een belofte.
- **Lost het plan de pijn direct op of een proxy?** De betaling per gastrij (P2 nieuw) raakt de pijn direct. De oorspronkelijke P2-shop (holds, oversell, 100k, Queue-it) loste een proxy op (peak sales) waar geen van de vier om vroeg: uit v1 (L4). Tap to Pay (P3) lost de tweede helft van de pijn op (het kastje weg) en volgt het entitlement.

### 10.3 Step 0B — hergebruik van bestaande code (reality-rows)

| Subprobleem | Bestaand | Receipt |
|---|---|---|
| Deur-vlag "te betalen" | `pay: boolean` inert | `src/features/door/model.ts:41-42` |
| Deel-check-in / hoofden | `check_ins.plus_ones_arrived` absoluut, "Check in +1 more" | `supabase/migrations/20260613000000_full_schema.sql` (kolom `plus_ones_arrived integer not null default 0`); `src/features/door/outbox/gateway.ts:31-38` |
| KvK/btw op company | `venues.kvk_number`, `venues.vat_number` (optioneel) | `supabase/migrations/20260615190000_venue_company_profile_quota.sql:26-27` |
| PSP-seam-patroon | `BillingProvider` + stub | `src/features/billing/provider.ts:52-56` |
| Webhook + idempotentie | `POST /api/webhooks/stripe`, `stripe_webhook_events` | `src/app/api/webhooks/stripe/route.ts`, `src/features/billing/stripe-webhook.ts` |
| Publieke pagina's | `/e/[slug]`, `/r/[token]` | `src/app/e/[slug]/page.tsx`, `src/app/r/[token]/page.tsx` |
| Capaciteit | triggers 45005/45006 | `supabase/migrations/20260624090000_event_capacity.sql` |
| Gastmail-wachtrij | types, opt-out, contact-channels | `supabase/migrations/20261013180000_guest_mail_types.sql` e.v. |
| pg_cron | aanwezig | `supabase/migrations/20260812120000_landing_throttle_cleanup_cron.sql` |
| Tierprijs | `guest_tiers.door_price_cents`, `vat_percent` | `supabase/migrations/20260624180000_tier_door_price.sql`, `20260706140000_tier_vat_percent.sql` |

Niets wordt herbouwd; `entry_payments`, `company_payout_accounts`, `company_ledger`, `payout_runs`, `/pay/[token]` en `src/features/payments/` zijn nieuw (`git ls-files src/features/payments src/app/pay` is leeg).

REALITY: premise-table finding 15 claims; verified=11 (receipts hierboven + Stripe-webhookbestanden); re-measure before gate=2 (Stripe NL-tarieven §2 regel 73-77 en Apple/Stripe Tap to Pay-eisen, beide "gecontroleerd 2026-10-11", vandaag niet opnieuw); unverified=2 (Stripe Checkout-sessiegrens 30 min–24 u; "vier venues vroegen erom" is user-stated) `payments-plan-claude-code.md:73-77`
REALITY: already-done pass `git log origin/main --grep "entry_payments|PaymentProvider|payout|Tap to Pay|tier_capacity"` levert alleen docs-commits (dbc400f6, ab9d800b, c5123179); geen code voor P1 bestaat `src/features/door/model.ts:41`
REALITY: surface-check pass pnpm-scripts `db:test`, `e2e:smoke`, `qa:flows`, `dev:mfa`, `db:fresh`, `e2e:layout` bestaan in `package.json`; routes `/e/[slug]`, `/r/[token]`, `/api/webhooks/stripe` bestaan; `/pay/[token]` bestaat niet (gepland); `checkout.sessions.expire` is een Stripe-API-call, niet in de repo, vandaag niet tegen de Stripe-docs geverifieerd `package.json:28`
REALITY: binding-decisions finding besluiten 1–33 (§0) en spec #62 gelden; vandaag gelogd: 10d9adc6 (aanpak C), 989e0e5c (besluit 16 gehouden), 247bce3c (route B uit), 85efed3d (deurregels D14/D15), 24cc454e (cash outbox, client-token); overruled default opnieuw aanwezig: spec #62(a) "verhaalbaar via transfer reversal" is Connect-taal die besluit 16 tegenspreekt `gastenlijst-app-spec.md:80`
REALITY: numbers pass marge per methode op €25 opnieuw afgeleid uit §2-invoer [measured: formule §2 regel 92]: iDEAL €0,46, EER-kaart/wallet €0,11, niet-EER −€0,31; "9–11 sessies" (§6) en "6–7 sessies tot live" (design-doc) [estimated]; Connect ±€160/maand bij 5 venues [estimated door de second opinion uit §2 regel 80]; Stripe-tarieven [re-measure before gate] `payments-plan-claude-code.md:88-92`
REALITY: deferred-asks finding ClickUp 86exxuuu7 vraagt: (1) "Statistieken: deuromzet per event" — in §4 Rapportage/P4, maar niet in P4a van het design-doc → opnemen in P4a (GROUP BY-RPC, klein); (2) "check-in zonder betaling alleen via override" — bewust vervangen door override + "nog niet bevestigd" (L8); (3) route B "voor venues met veel deurverkoop" — bewust afgewezen (L3); (4) "pas bouwen als venues er concreet om vragen" — vervuld (vier namen); (5) taakstatus "25 clients"/tag milestone-25 ≠ plan ≥5 — hertag open (L13) `payments-plan-claude-code.md:177`
REALITY: pr-count finding geen `.gstack/ship-policy.json` → default één PR per golf; plan: één ClickUp-taak → één PR (§6 regel 161); het design-doc splitst P2 in P2-deur/P2-geld en P4 in P4a/P4b → 2 extra PR's; kosten = per PR een fresh-session review (high-risk) en de ClickUp-taken splitsen (L13); gebruikersreferenties (`z8uq9m4a7m`, `z8uq9m4a7n`) blijven geldig als parent `payments-plan-claude-code.md:161`

### 10.4 Step 0C — droomtoestand

```
  CURRENT STATE                    THIS PLAN (v1, aanpak C)                12-MONTH IDEAL
  gastenlijst + los pinkastje      betaling per gastrij (QR + maillink),   één telefoon per doorhost: lijst,
  handmatig afvinken, geen         ledger + weekstaat + self-billing,      Tap to Pay, cash, walk-in; wekelijkse
  records wie betaalde      --->   handmatige SEPA, disputes in P2,  --->  batch + netting + documentengine;
  (LOFI, Maassilo, Boothstock,     Tap to Pay zodra entitlement + store;   P2b-shop alleen waar gevraagd; tweede
  Solar vragen erom)               geen shop                                PSP; blended rate stuurt de fee
```
Het plan beweegt richting het ideaal zonder dat P4b/P2b/P6 herbouw vragen (ledger, token, hoofden en fee-snapshot zijn er al).

### 10.5 Step 0G — HOLD SCOPE-checks

1. **Complexiteit:** P1 raakt meer dan 8 bestanden (5 nieuwe tabellen + migraties, `src/features/payments/` met provider, adapter, stub, fee-engine, server actions; door-model + snapshot; Settings → Payments; webhook) en meer dan 2 nieuwe services (PaymentProvider, fee-engine, token-minter). Uitdaging: minder bewegende delen met hetzelfde doel? Kandidaat: `payment_fee_rules` (tabel per provider × methode × drager) is in v1 niet nodig; de ondergrens is een constante en de company-ophoging zijn twee kolommen. → L14/D19.
2. **Minimum voor het doel (eerste live euro + meting):** P1 (entry_payments met `heads`/`payer_email`/token, company_payout_accounts met vat_type/IBAN/mandaat/cash-vlag, PaymentProvider + Stripe-adapter + stub, fee-snapshot, KvK/btw verplicht + privépersoon-vinkje, override, cash via outbox) → P2-deur (token-mint bij goedkeuring/event-start/quick-add, QR met `?heads=k`, `/pay/[token]`, Checkout, webhook, plafond per rij, "nog niet bevestigd", afstemming) → P2-geld (refunds a/b, dubbel-betaald-refund, disputes, bon via wachtrij) → P4a (ledger, weekstaat + self-billing-PDF, payout-ledgerregel bij goedkeuring, saldo in Settings, deuromzet per event op Stats).
3. **Invarianten die blijven:** RLS als grens; audit-triggers op `entry_payments`, `company_ledger`, `payout_runs` en de geldkolommen van `company_payout_accounts`; bedragen server-side; check-in blijft outbox; geen PII in URL's (`/pay/[token]` opaak, `?heads=k` is geen PII); service_role alleen in webhook + payout-RPC; stripe-confinement-guard verbreed in dezelfde PR; grant-matrix revoke-then-grant per nieuwe tabel; pgTAP allowed + denied per rol.

### 10.6 Step 0I — temporele ondervraging (voor de bouwer van P1/P2)

```
  UUR 1 (fundament):   migraties: welke kolommen client-geschreven mogen zijn (alleen cash-rijen en het token
                       van een quick-add); grant-matrix; audit-triggerset uitbreiden; typed insert-paden.
  UUR 2-3 (kern):      plafond per gastrij (betaald + open sessies) atomair in Postgres, niet in TS;
                       webhook-idempotentie op (provider, provider_payment_id) én op de rij; refund-route
                       bij overschrijding; token-levensduur event-einde + 24 u met event-tijdzone (#26).
  UUR 4-5 (integratie): deur-snapshot krijgt token + betaalde hoofden; outbox-uitkomst "nog niet bevestigd"
                       als nieuw kind met afstemming bij replay; realtime op entry_payments (RLS-filter!);
                       quick-add-payload met token; cockpit-QR; mail-template met /pay/[token].
  UUR 6+ (polish/tests): pgTAP: doorhost mag alleen cash inserten; replay muteert niets; plafond onder
                       concurrency (db:test:concurrency); flow-test deur-QR + maillink tegelijk;
                       guard: geen `stripe` buiten billing/payments; e2e: offline QR tonen.
```
Blokkers voor haalbaarheid: Stripe's schriftelijke antwoord en de jurist vóór het ontwerp van P4a bevriest (design-doc §Dependencies); Apple-entitlement voor P3a. Effort (human / CC): P1 ~3 wk / 2 sessies; P2 ~4 wk / 2–3 sessies; P4a ~2 wk / 1–2 sessies.

### 10.7 currentDecision (L14)

Commitment comparison:

```text
Commitment                         | Source/approval or pending | Current (plan)                      | A (tabel nu)        | B (constante + 2 kolommen, tabel later)
Ondergrens €0,25 + 2 %             | besluit 11, approved       | platform-default-rij in tabel       | zelfde              | constante in code + CHECK op kolommen
Company-ophoging tot €3,00 + 2,6 % | besluit 11, approved       | override-rij per company            | zelfde              | 2 kolommen op company_payout_accounts
Companyfee per methode (default 0) | besluit 4, approved        | rij per provider × methode × drager | zelfde              | niet in v1; komt met de tabel bij P4b/P6
Audit op fee-configuratie          | regel #4, approved         | trigger op tabel                    | zelfde              | trigger op company_payout_accounts (al in set)
Snapshot op entry_payments         | §3, approved               | ja                                  | ja                  | ja
Multi-PSP-fee per methode          | besluit 4, approved        | tabel                               | tabel               | pending tot P4b/P6 (expand-only)
```

Question: D19 — L14: `payment_fee_rules`-tabel in P1 bouwen, of uitstellen tot P4b/P6?
Project: PlusOne, branch claude/86exxuuu7-fase14-ceo-review, HOLD SCOPE.
ELI10: Het plan zet alle fee-logica in één tabel per provider × methode × drager, met platform-defaults en company-overrides. In v1 is er één provider, één gastfee met ondergrens en ophoging, en een companyfee die op €0 staat. Een constante plus twee kolommen op de company-rij doet hetzelfde met minder bewegende delen; de tabel komt expand-only zodra een tweede PSP of een fee per methode nodig is (P4b/P6).
Stakes if we pick wrong: A = een extra geaudite tabel, RLS en Settings-UI in de high-risk P1 voor configuratie die niemand in v1 aanraakt; B = bij P6 alsnog de tabel, met migratie van twee kolommen (klein, expand-only).
Recommendation: B omdat HOLD SCOPE minder bewegende delen vraagt waar het doel gelijk blijft; de snapshot op entry_payments maakt de latere migratie pijnloos.
Completeness: A=9/10, B=8/10
Pros / cons:
A) Tabel nu, zoals het plan
  ✅ Besluit 4 (fee per methode/PSP) staat vanaf dag 1 in het datamodel
  ✅ Geen tweede migratie bij P6
  ❌ Extra tabel + RLS + audit + UI in de high-risk P1 voor configuratie die v1 niet gebruikt
B) Constante + twee company-kolommen; tabel bij P4b/P6 (recommended)
  ✅ P1 kleiner en makkelijker te reviewen; dezelfde fee-uitkomst en dezelfde snapshot
  ✅ Expand-only later: kolommen blijven, tabel komt ernaast
  ❌ Besluit 4 is tot P6 alleen "voorbereid" in de snapshot, niet in een tabel
Net: datamodel-compleetheid nu tegen een kleinere P1.
Header: Fee-tabel
A) Tabel nu
Zoals plan §3/§4: `payment_fee_rules` met platform-defaults en company-overrides, geaudit, CHECK op grenzen. Effort M, risk medium.
B) Constante + 2 kolommen (recommended)
Ondergrens in code; `service_fee_fixed_cents`/`service_fee_bp` op `company_payout_accounts` met CHECK; tabel expand-only bij P4b/P6. Effort S, risk low.

**Antwoord D19 (Max, 2026-10-12): B.** L14 → approved: ondergrens als constante in `src/features/payments/`, `service_fee_fixed_cents`/`service_fee_bp` op `company_payout_accounts` (CHECK ≤ 300 / ≤ 260, geaudit), `payment_fee_rules` expand-only bij P4b/P6; fee-snapshot op `entry_payments` blijft. Scope: alleen P1-datamodel; besluit 4 en 11 ongewijzigd.

### 10.8 Section 1 — Architecture Review

**Current scope:** modus HOLD SCOPE (D18, Max). Accepted: L1–L11, L14 (zie 10.1). Pending: L12 (spec #62-correcties), L13 (ClickUp-splitsing). Rejected: route B (L3), Connect Express voor v1 (L2), shop in v1 (L4), "betaald"-knop zonder geldstroom (D7).

```
  SYSTEEM (nieuw = ★)
  ┌───────────────────────── client (PWA / Capacitor-shell) ─────────────────────────┐
  │ Deur (DoorProvider, outbox, IDB-snapshot)   Settings→Payments★   Platform-tab★    │
  │   ├─ check-in (+ "nog niet bevestigd"★, override)     IBAN/mandaat/cash/fee-kolommen │
  │   ├─ quick-add (+ client-token★)                      payout-runs goedkeuren★       │
  │   ├─ cash-betaling★ (outbox-kind)                                                   │
  │   └─ QR = /pay/[token]?heads=k★ (uit snapshot)                                      │
  └───────────┬───────────────────────────────┬──────────────────────────┬─────────────┘
              │ outbox-upsert (RLS)           │ server actions (RLS)     │ anon GET/POST
  ┌───────────▼───────────────────────────────▼──────────────────────────▼─────────────┐
  │ Next.js server: src/features/payments/★                                            │
  │   PaymentProvider★ ──► StripeAdapter★ / Stub★        /pay/[token]★ (throttle, Zod)  │
  │   token-mint★ (approval, snapshot-fetch, quick-add)   createPaySession★ ──► RPC    │
  │   webhook POST /api/webhooks/stripe (bestaand) + payment_intent.*, checkout.*,      │
  │   charge.refunded, charge.dispute.*★ ──► stripe_webhook_events (bestaand) ──► RPC   │
  └───────────┬────────────────────────────────────────────────────────────────────────┘
  ┌───────────▼────────────────────────── Postgres (RLS = grens) ──────────────────────┐
  │ guests ── guest_tiers(door_price_cents) ── check_ins(plus_ones_arrived, ★unconfirmed/override heads) │
  │ entry_payments★ (heads, snapshot, token, payer_email, status)  ──► audit_log (trigger) │
  │ company_payout_accounts★ (vat_type, IBAN, mandaat, cash, fee-kolommen)              │
  │ company_ledger★ (append-only) ◄── payout_runs★ ◄── Platform-tab-RPC (is_platform_admin) │
  │ guest_mail_queue (bestaand) ◄── bon★ ; pg_cron (bestaand) ◄── expire-sessions★       │
  └────────────────────────────────────────────────────────────────────────────────────┘
          │ Stripe (Checkout, PaymentIntents, Refunds, Disputes, webhooks)  │ Bank (handmatig, P4a)
```

**Dataflows (vier paden per flow).**

F1 Deur-QR → betaling
```
  happy: doorhost kiest k → QR /pay/[token]?heads=k (offline ok) → gast opent → server: token geldig? rij betaalbaar?
         plafond (betaald + open ≤ 1+N)? → Checkout-sessie (bedrag server-side) → gast betaalt → webhook
         → entry_payments.succeeded → realtime/sync → deur toont betaald(k) → check-in k hoofden
  nil:   token ontbreekt/onbekend → 404 "link niet geldig" (geen onderscheid bestaat/niet, throttle)
  empty: heads=0 of leeg → default k=1 (maillink) / weigeren aan de deur (k ≥ 1 verplicht, Zod)
  error: Stripe create-session faalt → 503 "probeer opnieuw", geen entry_payments-rij in processing;
         webhook faalt → Stripe retry; ledger-event blijft 'failed' zichtbaar in Platform-tab
```
F2 Maillink → vooruitbetaling: zelfde als F1 met k gekozen door de gast; nil = rij nog niet goedgekeurd → "nog niet gesynchroniseerd/nog niet goedgekeurd"; error = token verlopen (event-einde + 24 u) → "betaal aan de deur".

F3 Cash (outbox)
```
  happy: doorhost kiest cash + k → outbox-kind entry_payment_cash {id uuidv7, guest_id, heads, client_ts}
         → replay: INSERT via RLS-insertpolicy (method=cash, deurrechten, event-lid) → BEFORE INSERT-trigger
         zet amount uit tier + fee-kolommen (client levert géén bedrag) → audit → ledger bij sync
  nil:   company cash uit → UI toont geen cash-optie; replay van een oude payload → trigger weigert (cash_payments_enabled=false) → outbox-item 'rejected', deur toont het
  empty: k=0 → Zod weigert client-side; trigger CHECK heads ≥ 1
  error: replay-conflict (rij bestaat, idempotent upsert) → no-op; RLS denied (rol weg) → 'rejected' + melding
```
F4 P4a wekelijkse run: happy = Σ ledger per company → draft → platform-admin approve (payout-regel + weekstaat + factuur-PDF) → Max boekt → 'paid'; nil = geen betalingen die week → run zonder items, geen documenten; empty = saldo 0 of negatief → geen uitbetaling, vordering blijft; error = PDF/mail faalt → run blijft 'approved', retry-knop, geen 'paid' zonder bankreferentie.

F5 Refund/dispute: happy = company kiest a/b → `refunds.create` → webhook charge.refunded → status + ledger-correctie; dispute.created → vordering + bewijs-upload; dispute.closed won → vordering vervalt. nil = refund op rij zonder succeeded → UI biedt het niet aan, server weigert. error = Stripe refund faalt (saldo, netwerk) → zie D20.2.

**Toestandsmachines.**
```
  entry_payments.status:
   requires_payment ─► processing ─► succeeded ─► refunded | partially_refunded | disputed ─► (won) succeeded
        │                 │                                                             └► (lost) charged_back
        └► canceled       └► failed ─► requires_payment (nieuwe sessie)
   cash: INSERT direct succeeded (geen processing). Verboden: succeeded ─► requires_payment; refunded ─► succeeded
   (CHECK + trigger op transities; alleen de webhook-RPC en de refund-RPC muteren status).

  pay-token: minted ─► (gebruikt, n×) ─► expired (event_end + 24 u) ; nooit hergebruik over rijen; revoke bij rij 'removed'.

  payout_runs: draft ─► approved ─► paid ; approved ─► draft (afkeuren, geaudit); nooit paid ─► draft.

  check-in-uitkomst per hoofd: covered_paid | unconfirmed | override ; unconfirmed ─► covered_paid bij afstemming;
   unconfirmed blijft 'te betalen' op de rij als de webhook minder hoofden meldt.
```

**Koppeling:** nieuw is de koppeling deur ↔ `entry_payments` (snapshot + realtime) en gastrij ↔ token. Gerechtvaardigd: de gastrij ís de eenheid. Vermijd koppeling van `check_ins` aan Stripe-ids: de deur kent alleen `entry_payments.status/heads`, nooit de PSP.
**Schaal:** 10×: realtime-events op `entry_payments` per event zijn klein (≤ gasten); `/pay/[token]` is per-gast-verkeer, geen piek (geen shop). 100×: plafond-RPC serialiseert per gastrij (row lock op `guests.id`), niet per event: geen hot row. Weekstaat = GROUP BY over `company_ledger` per company (index op `(venue_id, created_at)`).
**Single points of failure:** Stripe-webhook-levering (mitigatie: 60 s-sync + Stripe-retries + handmatige "sync met Stripe"-knop in de Platform-tab); het goedkeuren van runs door een platform-admin (Max of Joeri, beiden `is_platform_admin()`; runbook).
**Security-architectuur (per nieuwe mutatie):** `createPaySession` (anon, token = capability, Zod, throttle, RPC toetst rij/plafond/event-tijd); cash-insert (doorhost, RLS smal, trigger zet bedrag); webhook (signature, service_role, ledger-idempotentie); refund-RPC (admin/finance van de company, RLS); payout-approve-RPC (`is_platform_admin()`, SECURITY DEFINER, audit); IBAN-kolom-grant (admin/finance eigen company).
**Productiefouten per integratiepunt:** Stripe 5xx bij sessie-aanmaak → gast ziet "probeer opnieuw", doorhost ziet niets kapot; webhook 30 min vertraagd → deur werkt op "nog niet bevestigd", afstemming later; pg_cron expire-job stil → sessies verlopen zelf na 24 u (Stripe), plafond telt open sessies tot dan (acceptabel, zichtbaar in Platform-tab); mailqueue down → bon later, status niet geblokkeerd.
**Rollback:** `payments_enabled=false` per company verbergt Charge/QR en weigert nieuwe sessies binnen één request; lopende sessies lopen af; cash-outbox blijft registreren; ledger blijft consistent. Migraties zijn expand-only (nieuwe tabellen/kolommen), code-rollback via Vercel-redeploy in minuten. Platform-brede noodrem: zie D20.1.

**Bevindingen Section 1:**
- **WARNING S1-1** token-mint-mechanisme voor "alle betaalbare rijen bij event-start" is niet gekozen. Aanbeveling (implementatiekeuze, owner P2-bouwer, geen cron nodig): mint bij goedkeuring (mail) én lui bij het ophalen van de deur-snapshot (server vult ontbrekende tokens voor betaalbare rijen van dat event) én client-side bij quick-add (L10). Pending, geen beslissing van Max nodig.
- **WARNING S1-2** `entry_payments` moet in de realtime-publicatie met RLS-filter per event; de deur abonneert per event zoals op `guests`. Owner P2.
- **OK S1-3** plafond per gastrij atomair in Postgres (row lock op `guests.id` in de sessie-RPC; webhook-RPC toetst opnieuw): vereiste van L7/R2-2, geen nieuwe keuze.
- **WARNING S1-4** outbox-payloadversie: nieuwe kinds (`entry_payment_cash`) en nieuwe velden op check-in (unconfirmed/override heads) vragen een `v`-veld + tolerante replay voor oude app-versies (remote-URL-shell kan een oude bundle draaien). Owner P1/P2; expand–contract.
- **OK S1-5** betaling op een rij die intussen `removed` is: webhook zet `succeeded` + markeert `needs_review`; company ziet het in Settings → Payments en kiest refund a/b (gedekt door de refund-regel, L-refund).
- **D20.1** platform-brede noodrem naast de company-vlag (zie 10.11).
- **D20.2** wat als de automatische refund (dubbel betaald / plafond) bij Stripe faalt (zie 10.11).

### 10.9 Section 2 — Error & Rescue Map

```
  METHOD/CODEPATH                    | WHAT CAN GO WRONG                           | EXCEPTION CLASS
  -----------------------------------|---------------------------------------------|-------------------------
  mintPayToken (approval/snapshot)   | DB-fout; rij niet betaalbaar; dubbel minten | DbError; NotPayable; UniqueViolation
  GET /pay/[token]                   | onbekend/verlopen token; rij removed; event voorbij; throttle | TokenNotFound; TokenExpired; RowRemoved; EventEnded; RateLimited
  createPaySession (RPC + Stripe)    | plafond vol; open sessie bestaat; Stripe 5xx/timeout; Stripe 429; ongeldige heads | CeilingReached; OpenSessionExists; StripeAPIError; StripeRateLimit; ZodError
  webhook checkout.session.completed | ongeldige signature; replay; rij onbekend; plafond overschreden; bedrag ≠ snapshot | SignatureInvalid; DuplicateEvent; UnknownSession; CeilingExceeded; AmountMismatch
  webhook payment_intent.payment_failed | —                                         | (status → failed)
  autoRefundOverpayment              | Stripe refund faalt (saldo/netwerk); al gerefund | StripeAPIError; AlreadyRefunded
  enqueueReceipt                     | geen payer_email; queue-insert faalt         | NoRecipient; DbError
  outbox replay entry_payment_cash   | RLS denied; cash uit; tier zonder prijs; duplicate | PermissionDenied(42501); CheckViolation; NotPayable; no-op
  outbox replay check-in (unconfirmed/override) | oude server zonder kolommen; heads > plafond | UndefinedColumn(42703) (expand–contract!); CheckViolation
  reconcileAfterSync                 | webhook meldt minder hoofden dan ingecheckt  | (geen exception: verschil blijft 'te betalen')
  refundRpc (a/b)                    | rol onvoldoende; status niet refundable; Stripe faalt | PermissionDenied; InvalidTransition; StripeAPIError
  webhook charge.dispute.created/closed | onbekende charge; bewijs-upload faalt    | UnknownCharge; StripeAPIError
  approvePayoutRun (RPC)             | geen platform-admin; run niet draft; saldo < reserve | PermissionDenied; InvalidTransition; ReserveBreach
  renderStatementPdf                 | render faalt; storage faalt                  | PdfError; StorageError
  pg_cron expireStaleSessions        | Stripe 5xx; job stil                         | StripeAPIError; (geen signaal)

  EXCEPTION CLASS       | RESCUED? | RESCUE ACTION                                            | USER SEES
  ----------------------|----------|----------------------------------------------------------|---------------------------
  TokenNotFound/Expired | Y        | 404/410 generiek, log token-hash + ip                    | "Deze betaallink is niet (meer) geldig; meld je bij de entree"
  RowRemoved/EventEnded | Y        | 410, geen sessie                                         | idem
  RateLimited           | Y        | 429 + Retry-After                                        | "Even wachten"
  CeilingReached        | Y        | hergebruik open sessie of 409                            | "Al betaald / al in behandeling"
  StripeAPIError (create)| Y       | 1 retry met idempotency-key, dan 503, geen rij in processing | "Probeer het opnieuw"
  StripeRateLimit       | Y        | backoff 2×, dan 503                                      | idem
  SignatureInvalid      | Y        | 400, log, geen verwerking                                | —
  DuplicateEvent        | Y        | ledger no-op (bestaand patroon)                          | —
  CeilingExceeded (webhook) | Y    | status succeeded + flag over_ceiling → autoRefund         | mail "dubbel betaald, komt terug"
  AmountMismatch        | Y ← fix  | status succeeded + needs_review, alert Platform-tab      | geen; admin ziet het
  AutoRefund StripeAPIError | GAP → D20.2 | zie beslissing                                     | —
  NoRecipient           | Y        | geen bon; weekstaat toont bedrag                         | —
  PermissionDenied (cash)| Y       | outbox-item 'rejected' met reden (bestaand patroon)      | deur: "cash niet toegestaan"
  UndefinedColumn (oude server) | Y ← expand–contract | migratie vóór deploy; replay tolerant      | —
  InvalidTransition     | Y        | 409, log actor + from/to                                 | "Niet mogelijk in deze status"
  ReserveBreach         | Y        | run blijft draft; melding met tekort                     | Platform-tab: "reserve te laag"
  PdfError/StorageError | Y        | run blijft approved; retry-knop; alert                   | Platform-tab: "document mislukt"
  expire-job stil       | N (bewust) | Stripe verloopt sessies zelf na 24 u; plafond telt ze tot dan | niets; Platform-tab toont #open sessies
```
Geen catch-all; elke rescue logt actor, rij-id, event-id en Stripe-id (nooit payer_email of IBAN in logs).

### 10.10 Section 3 — Security & Threat Model

| Dreiging | Kans | Impact | Gemitigeerd? |
|---|---|---|---|
| Token raden/enumereren op `/pay/[token]` | L | M | Ja: ≥128-bit random, generieke 404, throttle per token-hash én ip (zelfde familie als `/r`) |
| `?heads=k` manipuleren (meer hoofden dan plafond, negatief, niet-numeriek) | M | M | Ja: Zod, server-cap op 1+N−gedekt, bedrag server-side |
| Client stuurt bedrag mee (cash-outbox) | M | H | Ja: trigger BEFORE INSERT zet bedrag uit tier + fee-kolommen en weigert een afwijkend client-bedrag; kolom `amount_cents` niet in de client-insert-kolommen (kolom-grant) |
| Doorhost schrijft cash op andermans event / andere methode | M | H | Ja: RLS-insert alleen `method='cash'`, deurrechten op dat event, `venue_id`/`event_id` server-afgeleid; pgTAP allowed+denied |
| Webhook-replay / vervalst event | L | H | Ja: signature over raw body, `stripe_webhook_events`-ledger, RPC idempotent op (provider, provider_payment_id) |
| Dubbele betaling via twee oppervlakken | M | M | Ja: plafond per gastrij bij aanmaak én webhook + autorefund (D20.2 voor de faalroute) |
| IBAN-lek via brede SELECT | L | H | Ja: kolom-grant, alleen admin/finance eigen company, nooit in logs/exports |
| Mandaat "geaccepteerd" door niet-admin | L | H | Ja: server action met rolcheck admin, `mandate_accepted_by/at` + terms-versie, geaudit |
| Payout-RPC door niet-platform-admin | L | H | Ja: SECURITY DEFINER met `is_platform_admin()`, audit, run-statusmachine |
| Platform-admin keurt verkeerd bedrag goed | M | M | Deels: tweede paar ogen is proces (Joeri), reserve-check; weekstaat-PDF als bewijs |
| Client-gegenereerd token (L10) te zwak/hergebruikt | M | M | Ja (eis): `crypto.getRandomValues` 128 bit, UNIQUE, server weigert hergebruik, token nooit in logs |
| PII: `payer_email`, voornaam op `/pay/[token]`, dispute-bewijs naar Stripe | M | M | Deels: RLS event-scope; pagina toont alleen voornaam/event/bedrag; **vereist: `payer_email` in de bestaande AVG-anonimisatie (pg_cron) en Stripe als subverwerker in v1.1 (al in checklist §7)** |
| PII in URL | L | M | Ja: token opaak; `heads` is geen PII |
| Token in IndexedDB op gedeeld toestel | M | M | Ja: `plusone-session-*`/IDB is sessie-gebonden en wordt gewist bij sign-out (bestaande regel 86ey9e9mn); token geeft alleen "deze rij betalen" |
| Nieuwe dependency | — | — | Geen in P1/P2 (Stripe SDK bestaat; QR client-side met een bestaande of 0-dep lib → check bij P2) |
| Injectie (SQL/template) | L | H | Ja: typed client/RPC-params, Zod; mail via bestaande templates |

**Bevindingen Section 3:** **CRITICAL (vereist, geen keuze):** (a) bedrag nooit uit de client, ook niet voor cash (trigger + kolom-grant); (b) `payer_email` opnemen in de AVG-anonimisatiecron en de retentie-tekst; (c) token-entropie en UNIQUE voor client-gegenereerde tokens; (d) pgTAP allowed+denied voor elke nieuwe policy (CLAUDE.md DoD 3). Alle vier zijn gedekt door bestaande invarianten (CLAUDE.md security-checklist, AVG-retentie, DoD) en worden als P1/P2-acceptatie-eisen in de taken opgenomen.

### 10.11 currentDecision (L15, L16)

| ID / owner | Contract en bewijs | Current | Proposed | Status | Goedkeuring en scope |
|---|---|---|---|---|---|
| L15 Max | Noodrem voor betalingen (Section 1 rollback) | alleen `payments_enabled` per company (plan §4) | + platform-brede server-side schakelaar | approved | D20.1 = B (Max 2026-10-12); scope: env-schakelaar in sessie-RPC, Charge, mint, refund + runbook |
| L16 Max | Faalroute van de automatische refund bij dubbel betaald / plafond (Section 2 GAP) | niet gedefinieerd | handmatig met zichtbaarheid, of retry-wachtrij | approved (shortcut 7/10) | D20.2 = A (Max 2026-10-12); upgrade bij P4b of >3 rijen/week; decision 24329554 |

Commitment comparison L15:
```text
Commitment                              | Source/approval or pending | Current               | A (company-vlag)   | B (+ platform-schakelaar)
Company kan betalingen uitzetten        | plan §4, approved          | payments_enabled      | zelfde             | zelfde
Alle venues tegelijk stilleggen         | pending                    | per company handmatig | per company        | één env-var, server-side gelezen in sessie-RPC/Charge/mint/refund
Cash-outbox blijft werken               | L9, approved               | ja                    | ja                 | ja
Lopende Checkout-sessies                | §4, approved               | lopen af              | lopen af           | lopen af; webhook verwerkt nog
Migratie nodig                          | —                          | —                     | nee                | nee (env) 
```
Question: D20.1 — L15: platform-brede noodrem naast de company-vlag?
Project: PlusOne, branch claude/86exxuuu7-fase14-ceo-review, HOLD SCOPE.
ELI10: Als er iets mis is met geld (verkeerde fee, dubbele boekingen, Stripe-incident) wil je in één minuut álle nieuwe betalingen stoppen zonder per company te klikken. Een server-side schakelaar (env-var, gelezen in de sessie-RPC, Charge, token-mint en refund) doet dat; cash via de outbox en de check-in blijven werken, lopende sessies lopen af en de webhook verwerkt ze nog netjes.
Stakes if we pick wrong: zonder schakelaar is een incident bij 5 venues 5 handmatige acties en bij 25 een avond werk; met schakelaar één Vercel-env-wijziging.
Recommendation: B omdat Prime Directive 5 (runbooks/alerts zijn launch-scope) en de dunne marge een snelle noodrem vragen; kosten: één env-var en één check in vier codepaden.
Completeness: A=7/10, B=9/10
Pros / cons:
A) Alleen de company-vlag (zoals het plan)
  ✅ Niets extra's te bouwen of te documenteren
  ✅ Fijnmazig: één company uit, de rest door
  ❌ Platform-incident = per company handmatig uitzetten; geen snelle stop
B) Company-vlag + platform-brede env-schakelaar (recommended)
  ✅ Eén handeling stopt alle nieuwe sessies, Charges, mints en refunds; cash en check-in blijven werken
  ✅ Geen migratie; runbook-regel in `docs/runbook.md`
  ❌ Eén extra vertakking in vier codepaden en een test per pad
Net: fijnmazigheid blijft; de vraag is of er daarnaast één grote rode knop komt.
Header: Noodrem
A) Alleen company-vlag
`payments_enabled` per company, zoals plan §4. Effort S (nul extra), risk medium bij een platform-incident.
B) + platform-schakelaar (recommended)
Env `PAYMENTS_KILL_SWITCH`, server-side gelezen in sessie-RPC, Charge, token-mint, refund; cash/check-in ongemoeid; runbook-regel + test per pad. Effort S, risk low.

Commitment comparison L16:
```text
Commitment                                   | Source/approval or pending | Current | A (handmatig + zichtbaar)                         | B (retry-wachtrij)
Gast krijgt dubbel betaald bedrag terug      | L7/R2-2, approved          | —       | ja, door Max in het Stripe-dashboard binnen de SLA | ja, automatisch na retry
Zichtbaarheid van de open refund             | pending                    | —       | rij `needs_refund` + Platform-tab-lijst + Sentry-alert | idem + retry-status
Webhook charge.refunded sluit de rij         | §3, approved               | —       | ja                                                | ja
Nieuwe infrastructuur                        | —                          | —       | geen                                              | actietabel + cron/route die Stripe aanroept
Schaalt voorbij ~10 venues                   | —                          | —       | nee (handwerk)                                    | ja
```
Question: D20.2 — L16: als de automatische refund (dubbel betaald / plafond) bij Stripe faalt?
Project: PlusOne, branch claude/86exxuuu7-fase14-ceo-review, HOLD SCOPE.
ELI10: De webhook ziet een tweede geslaagde betaling boven het plafond en start een refund. Stripe kan dat weigeren (netwerk, saldo, al gerefund). Dan staat er geld van een gast bij ons zonder dat iemand het ziet, tenzij we het expliciet zichtbaar maken. Twee smaken: de rij markeren en Max doet de refund in het Stripe-dashboard (webhook sluit de rij), of een retry-wachtrij die het zelf blijft proberen.
Stakes if we pick wrong: A zonder zichtbaarheid = stille schuld aan een gast; B = extra actietabel en een proces dat Stripe aanroept, in de high-risk P2.
Recommendation: A omdat het volume in v1 klein is en de zichtbaarheid (flag + lijst + alert) het eigenlijke gat dicht; B wordt het opwaarderingspad bij P4b wanneer de batch-automatisering er toch komt. Dit is een bewuste shortcut (7/10): wordt gelogd met het upgrade-trigger.
Completeness: A=7/10, B=9/10
Pros / cons:
A) Handmatig met harde zichtbaarheid (recommended)
  ✅ Geen nieuwe infrastructuur in P2; Platform-tab-lijst + Sentry-alert + rijstatus maken het onmisbaar
  ✅ Webhook `charge.refunded` sluit de rij automatisch zodra Max refundt
  ❌ Handwerk; gast wacht op een mens; schaalt niet voorbij ~10 venues
B) Retry-wachtrij
  ✅ Zelfherstellend; geen gast die op Max wacht
  ✅ Zelfde mechaniek later herbruikbaar voor disputes-bewijs en batch
  ❌ Actietabel + cron/route die Stripe aanroept, in de high-risk P2; meer tests
Net: zichtbaarheid nu tegen automatisering nu.
Header: Refund faalt
A) Handmatig + zichtbaar (recommended)
`needs_refund`-status, Platform-tab-lijst, Sentry-alert; Max refundt in Stripe; webhook sluit de rij. Effort S, risk low. Upgrade naar B bij P4b of >10 venues.
B) Retry-wachtrij
Actietabel + cron/route, 3 pogingen met backoff, daarna A. Effort M, risk medium.

**Antwoorden D20 (Max, 2026-10-12):** D20.1 = B → L15 approved (platform-brede env-schakelaar `PAYMENTS_KILL_SWITCH` naast `payments_enabled`; scope: vier codepaden + runbook-regel). D20.2 = A → L16 approved als bewuste shortcut 7/10 (`needs_refund` + Platform-tab-lijst + Sentry-alert; upgrade naar retry-wachtrij bij P4b of >3 rijen/week; gelogd in de gstack-decisionlog; code krijgt een `gstack-shortcut(dec-…)`-marker).

### 10.12 Section 4 — Data Flow & Interaction Edge Cases

F1/F2 `/pay/[token]` → sessie:
```
  INPUT token,heads ─► VALIDATION ─► TRANSFORM ─► PERSIST ─► OUTPUT
   │ nil token ─► 404 generiek        │ amount = heads × door_price_cents (nu, niet bij mint)
   │ garbage/te lang ─► 400 generiek  │   + fee(constante + company-kolommen), btw 9 %, gesnapshot
   │ heads leeg ─► 1 (mail) / 400 (deur)│ │ Stripe timeout ─► 503, GEEN rij (rij pas na sessie-id)
   │ heads > cap ─► cap (mail) / 409 (deur)│ conflict: open sessie ─► hergebruik (zelfde URL)
   │ token verlopen ─► 410              │ stale: tierprijs gewijzigd ná sessie ─► sessie houdt zijn bedrag (Stripe), nieuwe sessie nieuwe prijs
   │ rij removed ─► 410                 │ encoding: token base64url, heads integer, geen vrije tekst
   │ kill switch / payments_enabled=false ─► 503 "tijdelijk niet mogelijk"
```
F3 cash-outbox: INPUT {uuidv7, guest_id, heads, client_ts} → RLS + trigger (bedrag, cash aan, prijs > 0) → PERSIST succeeded → ledger bij sync. Shadow: dubbele replay → no-op; rij removed intussen → insert geweigerd, outbox 'rejected' met reden; event voorbij → toegestaan (cash is al ontvangen), gemarkeerd `late`.
F4 run: INPUT week + venue → ledger-GROUP BY → draft; shadow: negatief saldo → geen item, vordering zichtbaar; reserve-tekort → draft blijft; PDF-fout → approved zonder paid.

**Async-ordering — invariant:** per gastrij geldt op elk moment `paid_heads + heads_van_open_sessies ≤ 1 + plus_ones` bij sessie-aanmaak, en `paid_heads + heads_van_deze_betaling ≤ 1 + plus_ones` bij de webhook (open sessies tellen bij de webhook níét mee, anders wordt een legitieme tweede betaling ten onrechte gerefund).
```
  tijd │ A: deur-sessie k=2 (RPC)        │ B: maillink k=2 (RPC)           │ shared: paid / open   (N=1 → plafond 2)
  t1   │ SELECT guests FOR UPDATE ─┐     │                                 │ 0 / 0
  t2   │ open=0 → maak sessie A ──┘      │ wacht op lock                   │ 0 / 2
  t3   │ commit                          │ lock → open=2 → cap 0 → hergebruik A of 409 │ 0 / 2
  omgekeerde volgorde: symmetrisch (B eerst, A hergebruikt B).  Uitgesloten schema: beide sessies vóór enige lock
  — onmogelijk door de row lock in dezelfde RPC-transactie (mechanisme, geen aanname).
  webhooks: W_A succeeded → paid 2 → W_B kan niet bestaan (geen sessie B); als N intussen verlaagd is (organisator)
  → webhook-check faalt → succeeded + over_ceiling → autorefund (L16-route) + needs_review voor de company.
```
Regressiebewijs: pgTAP in `db:test:concurrency` met twee sessies die na de SELECT pauzeren (pg_advisory/`pg_sleep`-stappen zoals de bestaande quota-concurrencytest), beide volgordes; webhook-fixture met N-verlaging tussen aanmaak en succeeded.

| Interactie | Randgeval | Afgehandeld? | Hoe |
|---|---|---|---|
| Charge-knop | dubbel tikken | Ja | idempotent: zelfde open sessie, zelfde QR |
| Charge-knop | k wijzigen na tonen QR | Ja | nieuwe QR; oude URL krijgt server-cap; al geopende sessie houdt oude k |
| `/pay/[token]` | gast navigeert weg / terug-knop | Ja | sessie blijft 30 min; heropenen = zelfde sessie; succes-pagina leest status uit DB |
| `/pay/[token]` | trage verbinding gast | Ja | Checkout is Stripe-hosted; onze pagina is klein; retry-knop |
| Deur | gast betaalt nádat doorhost override gaf | Ja | betaling blijft; override blijft geaudit; company ziet beide, kan refunden |
| Deur | webhook-achterstand | Ja | "nog niet bevestigd" na 10 s; afstemming later |
| Deur | 0 betaalbare rijen / tier zonder prijs | Ja | geen Charge-knop; gedrag van vandaag |
| Deur | 2.000 gasten | Ja | snapshot +~60 B/gast (token + status), geen extra query per gast (view met GROUP BY) |
| Outbox | replay van cash op een inmiddels `removed` rij | Ja | insert geweigerd, item 'rejected' met reden, deur toont het |
| Webhook | duplicaat / out-of-order (succeeded vóór processing) | Ja | ledger + statusmachine accepteert succeeded vanuit requires_payment |
| Refund | twee keer klikken | Ja | InvalidTransition 409 |
| Run | twee platform-admins keuren tegelijk goed | Ja | statusovergang met `WHERE status='draft'` → tweede krijgt 409 |
| Maillink | gast betaalt ná event-einde + 24 u | Ja | 410; eerder geopende sessie kan nog slagen → normale verwerking, company refund-keuze |

Geen onafgehandelde randgevallen gevonden; de twee contractpunten (webhook-telling zonder open sessies; `late`-markering voor cash na event-einde) zijn nieuw t.o.v. het design-doc en gaan als P2-acceptatie-eis mee (geen nieuwe keuze: ze volgen uit L7/L9).

### 10.13 Section 5 — Code Quality Review

- **Structuur:** `src/features/payments/` spiegelt `src/features/billing/` (provider.ts, stripe-adapter.ts, stub, config.ts, schemas.ts, actions.ts, webhook-handlers.ts). Eén webhook-route blijft (`src/app/api/webhooks/stripe/route.ts`): signature-verificatie één keer, daarna een handler-map `{ 'checkout.session.completed': …, 'charge.dispute.created': … }` per module; geen tweede route, geen tweede ledger.
- **Duplicatie (flag):** geldberekening mag maar op één plek bestaan. Cash (trigger) én PSP-sessie (RPC) hebben hetzelfde bedrag nodig → één SQL-functie `payment_amount_for(p_tier_id, p_heads, p_venue_id)` (prijs + fee-kolommen + btw) die zowel de sessie-RPC als de BEFORE INSERT-trigger aanroept; TypeScript rekent nooit met geld (alleen tonen). Vermijdt de klassieke drift tussen app en DB.
- **Naamgeving:** `entry_payments` (plan), `heads` (telt personen, niet "quantity"), `vat_type` 1|3, `needs_refund`/`needs_review` als expliciete statussen, `pay_token` (niet "code").
- **Foutpatronen:** Section 2; geen catch-all; Stripe-fouten via de adapter naar een smal `PaymentError`-type met `kind`.
- **Randgevallen:** tijdzone van event-einde (#26) uit de event-rij, niet uit de server; `heads` als integer 1..50 met CHECK; bedrag in centen, nooit float.
- **Over-engineering vermeden:** D19 (fee-tabel), L16 (geen retry-wachtrij), geen shop. **Onder-engineering bewaakt:** plafond in de DB, niet in TS; token-expiry server-side.
- **Complexiteit:** webhook-dispatch > 5 branches → tabelgestuurd; `createPaySession` splitst validatie (pure functie, unit-test) van I/O.

### 10.14 Section 6 — Test Review

```
  NIEUW                                  | TESTTYPE          | HAPPY                         | FAIL                                   | EDGE
  ---------------------------------------|-------------------|-------------------------------|----------------------------------------|---------------------------
  migraties + grant-matrix               | pgTAP (grant_matrix.test.sql bestaand) | tabellen dicht voor anon | authenticated zonder expliciete grant → 403 | nieuwe kolommen op user-tabellen zonder grant
  RLS entry_payments SELECT              | pgTAP allowed+denied | doorhost eigen event leest   | ander event / andere venue → 0 rijen     | platform-admin leest alles
  RLS entry_payments INSERT (cash)       | pgTAP               | doorhost cash eigen event     | method='card' → 42501; ander event → 42501; staff zonder deurrechten → 42501 | amount meegegeven → trigger overschrijft/weigert
  payment_amount_for + trigger           | pgTAP               | 2 hoofden × €25 + fee = exact | tier zonder prijs → exception           | fee-kolommen op max; btw-afronding
  plafond-RPC                            | pgTAP + concurrency | 2 van 2 → sessie              | 3e hoofd → CeilingReached               | twee sessies tegelijk (beide volgordes)
  webhook-RPC apply_entry_payment_update | vitest (fixture-events) + pgTAP | succeeded zet status + ledger | replay muteert niets; bedrag ≠ snapshot → needs_review | N verlaagd → over_ceiling + needs_refund-pad
  autoRefund                             | vitest (stub provider) | refund aangemaakt           | Stripe-fout → needs_refund + alert       | al gerefund → no-op
  /pay/[token] route                     | vitest + e2e        | geldig → redirect Checkout    | onbekend/verlopen → 404/410 generiek; throttle → 429 | heads > cap → cap; kill switch → 503
  token-mint (approval / snapshot / quick-add) | vitest + pgTAP | token aanwezig in snapshot    | dubbel minten → UNIQUE, idempotent      | client-token te kort → geweigerd
  deur: QR offline + "nog niet bevestigd" | tests/flows (qa:flows) + DoorProvider.test | QR zichtbaar zonder netwerk; check-in met uitkomst | sync met minder hoofden → 'te betalen' blijft | override + betaling beide
  outbox-kind entry_payment_cash         | DoorProvider.test + replay.test | replay insert             | rejected-pad met reden                   | oude payload zonder `v`
  bon via gastmail-wachtrij              | actions.guest-mail.test | enqueue na succeeded        | geen payer_email → geen enqueue, geen fout | cash → geen bon
  refund a/b RPC                         | pgTAP + vitest      | status + ledger-correctie     | rol finance van andere company → 42501  | partial na full → 409
  disputes webhook                       | vitest fixtures     | vordering geboekt             | closed won → vordering vervalt          | onbekende charge → log + 200
  P4a run + payout-regel                 | pgTAP + vitest      | draft→approved→paid, saldo daalt | reserve-tekort → draft                | twee approvers → één wint
  stripe-confinement-guard               | vitest (bestaand)   | payments-map toegestaan       | import elders → faal                    | dynamische import
  no-PII-in-logs                         | vitest (grep-guard, nieuw) | log-helper filtert payer_email/IBAN | —                                 | —
```
Assertiecheck (selectie): plafond: `assert count(open+paid) ≤ 1+N` na twee gelijktijdige RPC's; verwerpt "beide sessies aangemaakt"; no_claim=Stripe's eigen gedrag (gestubde provider; pgTAP zonder Stripe). Cash-RLS: `assert insert as doorhost method='card' raises 42501`; no_claim=none beyond protects. Webhook-replay: `assert ledger onveranderd na tweede identieke event`; no_claim=echte Stripe-signature (fixture met test-secret). Offline-QR: `assert QR-element aanwezig met netwerk uit (Playwright offline)`; no_claim=echte iDEAL-betaling.
**2 uur 's nachts-test:** de concurrency-plafondtest + webhook-replay. **Vijandige QA:** twee telefoons, één gast, maillink + deur-QR tegelijk, N verlagen tijdens de betaling, kill switch halverwege. **Chaos:** webhook 30 min geblokkeerd (Stripe CLI), expire-job uit, Stripe 5xx bij sessie-aanmaak.
**Piramide:** veel pgTAP/vitest, enkele flow-tests, één e2e-smoke (offline QR). **Flakiness:** tijd (token-expiry, 10 s-wachttijd) via geïnjecteerde klok; Stripe via stub + fixtures; volgorde via expliciete pauzes. **Load:** plafond-RPC 200 gelijktijdige calls op één rij (lock-serialisatie) en 2.000 rijen snapshot-ophalen < 1 s lokaal (hosted meten zoals de realtime-loadtest).
Geen LLM/prompt-wijzigingen.

### 10.15 Section 7 — Performance Review

- **N+1:** deur-snapshot haalt betaalde/open hoofden per gast via één view `guest_payment_summary` (GROUP BY guest_id) gejoind op de bestaande snapshot-query; nooit per gast een query. Weekstaat: één GROUP BY op `company_ledger`.
- **Indexen:** `entry_payments(guest_id)`, `(event_id, status)`, UNIQUE `(provider, provider_payment_id)`, UNIQUE `pay_token`, `(venue_id, created_at)`; `company_ledger(venue_id, created_at)`, `(payout_run_id)`; `payout_runs(venue_id, period_start)`.
- **Geheugen:** snapshot +~60 B/gast; 2.000 gasten = +120 KB in IDB; ledger-rijen klein.
- **Caching:** tierprijs/fee binnen de RPC (één SELECT); geen app-cache voor geld.
- **Jobs:** expire-sessions elke 10 min, worst case = aantal open sessies (tientallen), 1 Stripe-call per sessie, retry volgende run.
- **Trage paden (p99 schatting):** `/pay` sessie-aanmaak 1,5 s (Stripe-call); webhook-RPC 50 ms; weekstaat 200 ms bij 25 venues. 
- **Pool:** +1 cron, webhook-bursts klein; Supabase-pool volstaat.

### 10.16 Section 8 — Observability & Debuggability

- **Logs (gestructureerd, geen PII):** entry_payment_id, guest_id, event_id, venue_id, stripe-ids, actor, from/to-status, reden bij reject; op entry/exit van sessie-aanmaak, webhook-handler, refund, run-overgangen, outbox-replay van cash.
- **Metrics (per event/dag, uit de DB, geen extra systeem):** sessies aangemaakt/voltooid/verlopen (afhaak), tijd webhook→status (latency), check-ins per uitkomst (betaald/onbevestigd/override), needs_refund/needs_review-aantal, open sessies, ledger-saldo per company, run-status.
- **Alerts (Sentry, bestaand):** signature-fouten > 3/uur; elke `AmountMismatch`; elke `needs_refund`; expire-job heartbeat > 1 u stil; reserve-tekort; webhook-event 'failed' in de ledger.
- **Dashboards dag 1 (Platform-tab):** open sessies, needs_review/needs_refund-lijst, failed webhook events, saldo per company, laatste run, kill-switch-status.
- **Debuggability:** elke rij draagt Stripe-ids en snapshot; `audit_log` before/after op entry_payments/ledger/runs → een melding 3 weken later is reconstrueerbaar uit DB + Stripe-dashboard zonder app-logs.
- **Admin-tooling:** "sync met Stripe" (één sessie/PaymentIntent opnieuw ophalen), run afkeuren, needs_refund afhandelen (status na dashboard-refund via webhook).
- **Runbooks (docs/runbook.md, launch-scope):** webhook-uitval; dubbel betaald; dispute binnen; run klopt niet met bank; kill switch aan/uit; Maestro-pas geweigerd aan de deur.

**Bevindingen Section 8:** **WARNING S8-1** een expire-job die stil valt geeft nu geen signaal (Section 2) → heartbeat-metric + alert is vereist (geen nieuwe keuze: Prime Directive 1, zero silent failures). **OK** overige: alles bovenstaand is launch-scope in de taken.

### 10.17 Section 9 — Deployment & Rollout Review

- **Migratiesafety:** alles expand-only: nieuwe tabellen (`entry_payments`, `company_payout_accounts`, `company_ledger`, `payout_runs`), nieuwe nullable kolommen (`check_ins.unconfirmed_heads`, `override_heads`, default 0), geen rename/drop; `check_ins`-ALTER met default is een snelle metadata-wijziging op Postgres ≥ 11. Grant-matrix revoke-then-grant per object. `supabase db reset` + `pnpm db:test` vóór de push (CLAUDE.md prod-push-flow).
- **Feature flags:** `payments_enabled` per company (default false; alleen type 3) + `PAYMENTS_KILL_SWITCH` (L15). Eerste live company = LOFI of Maassilo alleen; de rest blijft uit tot de meting van één avond.
- **Rollout-volgorde:** migreren → deployen (CLAUDE.md expand–contract). De oude client (remote-URL-shell met oude bundle) stuurt check-in-payloads zonder `v` → server behandelt als v1; de oude snapshot-lezer negeert onbekende velden (token, betaalde hoofden). Nieuwe client tegen oude server bestaat niet (server deployt eerst), maar de outbox kan een payload met `v=2` vasthouden tot de nieuwe server er is → replay is tolerant (S1-4).
- **Rollback:** (1) kill switch aan (1 min, Vercel-env); (2) `payments_enabled=false` voor de pilot-company; (3) code-rollback via Vercel-redeploy van de vorige build; (4) migraties blijven staan (expand-only, ongebruikt); (5) open sessies lopen af in Stripe; webhook blijft events accepteren en loggen. Geen datamigratie terug nodig.
- **Risico-venster bij deploy:** tussen migratie en deploy bestaan tabellen zonder code: ongevaarlijk (dicht voor anon, geen flag aan).
- **Omgevingspariteit:** geen staging (CLAUDE.md). Volgorde: lokale stack + Stripe test mode → prod met test-keys op één pilot-company (test-mode-demo voor de vier prospects) → live keys. Risico expliciet: de eerste live euro is op prod; mitigatie = één company, kill switch, needs_review-lijst.
- **Post-deploy-check:** eerste 5 min: webhook-endpoint antwoordt 200 op een Stripe-testevent, `/pay/<onbekend>` geeft 404, deur-snapshot laadt met token-veld, Platform-tab toont kill-switch-status. Eerste uur: geen 42501-piek op `entry_payments`, geen failed webhook-events, Sentry stil.
- **Smoke:** `pnpm e2e:smoke` + nieuwe spec: `/pay/<random>` → 404; snapshot-API bevat `pay_token` voor een betaalbare seed-rij.

### 10.18 Section 10 — Long-Term Trajectory Review

- **Schuld (bewust):** handmatige SEPA (P4a → P4b), handmatige refund-afhandeling (L16), fee als constante (L14), weekstaat als eenvoudige PDF (documentengine later). Alle vier met een benoemd upgrade-moment.
- **Padafhankelijkheid:** `entry_payments.heads` + snapshot + token zijn de eenheden waar P2b (shop), P3 (Tap to Pay: zelfde rij, andere `method`) en P6 (tweede PSP: `provider`-kolom) op bouwen; geen herbouw voorzien. Eén risico: als later per hoofd gefactureerd moet worden (per persoon een bon), moet `heads` worden uitgesplitst; nu bewust niet (D15.2).
- **Kennisconcentratie:** design-doc + dit hoofdstuk + runbook-regels; de bouwer van P1 heeft alles in drie bestanden. Na de review §10 samenvouwen in §1–§9 (T12), anders leest een nieuwe engineer twee waarheden.
- **Omkeerbaarheid: 3/5.** Flags uit = slapend systeem; tabellen blijven (append-only geld); juridische constructie (type 3, mandaat) is de echte one-way door, niet de code.
- **Ecosysteem-fit:** spiegelt `src/features/billing/`, outbox-patroon van `check_ins`, RPC-patroon van quota's, grant-matrix-regel. 
- **1-jaarsvraag:** ja, mits T12 (docs samenvouwen) en de naamgeving (`heads`, `needs_refund`) consequent blijft.

### 10.19 Section 11 — Design & UX Review (UI-scope aanwezig)

**IA aan de deur:** eerst de naam en status (bestaand), dan "€X te betalen · k" als badge op de rij, dan één knop **Charge** → sheet: hoofden-stepper (default = wie meekomt), groot QR, regel "Kan de gast niet scannen? Toon link", optioneel **Cash** (alleen als aan), live "Betaald ✓ (k)" zodra bevestigd, anders na 10 s de keuze "Inchecken, nog niet bevestigd" of (admin) "Override". Op `/pay/[token]`: venue-naam, voornaam, event, aantal (aanpasbaar omlaag), bedrag incl. "Servicekosten", knop Betalen (Stripe-hosted), daarna "Je staat op de lijst, meld je bij de entree".

| Feature | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL |
|---|---|---|---|---|---|
| Charge-sheet | QR-skeleton (token komt uit snapshot: vrijwel nooit) | tier zonder prijs: geen knop | geen token (rij nog niet gesynct): "nog niet beschikbaar" + opnieuw | Betaald ✓ (k) | 2 van 4 betaald: badge "2/4 betaald" |
| `/pay/[token]` | spinner tot sessie | — | 404/410/429/503 met één zin en "meld je bij de entree" | "Je staat op de lijst" | aantal verlaagd door cap: toont nieuw aantal vóór betalen |
| Settings → Payments | skeleton | "Betalingen staan uit" + uitleg type 3 | opslaan mislukt: inline | saldo + laatste weekstaat | mandaat ontbreekt: knop geblokkeerd met reden |
| Platform-tab runs/needs_* | skeleton | "Geen openstaande posten" | RPC-fout inline | run goedgekeurd → payout-regel | reserve-tekort: run blijft draft met bedrag |

**Journey (emotionele boog):** doorhost: twee tikken, nooit wachten op netwerk, nooit uitleggen; gast: vertrouwen door venue-naam + eigen naam + exact bedrag en een bekende Stripe-pagina; admin: één weekstaat die klopt. **AI-slop-risico:** een generiek "payments dashboard" in de Platform-tab; houd het bij de bestaande kit (`kit.tsx`), lavender-accent, één lijst per zorg (open sessies, needs_review). **DESIGN.md:** `design-system.md` (Bricolage/Hanken, #0B0B0D, #B5A6FF); de Charge-sheet volgt de bestaande deur-sheets. **Responsief:** deur phone-first, iPad = QR-pad, cockpit (desktop) toont dezelfde QR groot; `/pay` is mobiel. **Toegankelijkheid:** QR + kopieerbare link, tap-targets ≥ 44 px (touch-density-guard), contrast op het bedrag, screenreader-label "Betaal €X voor k personen".

```
  deur-rij ─► [Charge] ─► sheet(k, QR, cash?) ─► gast scant ─► /pay ─► Stripe Checkout ─► succes-pagina
     │                        │                                                       │
     │                        └─► 10 s geen bevestiging ─► [Inchecken, nog niet bevestigd] ─► sync ─► ✓ / 'te betalen'
     └─► (admin) [Override, reden] ─► check-in
  maillink: goedkeuringsmail ─► /pay (k kiezen) ─► Checkout ─► "Je staat op de lijst" ─► deur ziet ✓
```
Aanbeveling: **`/plan-design-review`** vóór P2 voor de Charge-sheet en `/pay` (deursnelheid en vertrouwen zijn hier het product); na P2 `/design-review` op de live schermen.

### 10.20 NOT in scope

Uitgesteld (gaan naar TODOS.md): `payment_fee_rules`-tabel (D19 B, bij P4b/P6); retry-wachtrij voor gefaalde refunds (D20.2 A, bij P4b of >3 rijen/week); pain.001-batch, abonnement-netting, volledige documentengine, blended-rate-rapport (P4b, D13); open shop met holds/oversell/sold-out/Queue-it (P2b, eigen spec-besluit tegen #10, D13); tweede PSP (P6, na validatie).
Afgewezen: Stripe Connect Express voor v1 (D12 B: controle, multi-PSP, type 3); losse smart reader / route B (premisse 5: één toestel); gratis "betaald"-knop zonder geldstroom (D7: geld moet door PlusOne); per-hoofd-betaalrijen vooraf (D15.2 B); walk-in alleen online (D16.2 B); cash alleen online (D16.1 B).

### 10.21 What already exists

Zie 10.3: deur-vlag `pay`, `check_ins.plus_ones_arrived` (deel-check-in), `venues.kvk_number/vat_number`, `BillingProvider`-patroon + stub, webhook-route + `stripe_webhook_events`, `/e/[slug]` + `/r/[token]` + throttle-familie, capaciteitstriggers, gastmail-wachtrij, pg_cron, `guest_tiers.door_price_cents/vat_percent`, audit-triggerset, grant-matrix-test, outbox-replay met rejected-pad. Alles wordt hergebruikt; niets herbouwd.

### 10.22 Dream state delta

Na v1 (P1 + P2 + P4a) staat PlusOne op "één telefoon per doorhost: lijst + betaling via QR, cash, walk-in; weekstaat die klopt"; het 12-maandsbeeld (Tap to Pay native, batch + netting + documentengine, shop waar gevraagd, tweede PSP) vraagt geen wijziging van `entry_payments`, token, hoofden of ledger. Afstand: P3a/P3b (entitlement + store), P4b, P2b, P6.

### 10.23 Error & Rescue Registry

Zie 10.9 (volledig). Samenvatting: 15 codepaden, 20 exception-klassen; 19 rescued met gedefinieerde gebruikerstekst; 1 bewust niet-gerescued (stilvallende expire-job) met heartbeat-alert als vereiste (S8-1); de refund-faalroute is door D20.2 van GAP naar rescued (zichtbaar) gegaan.

### 10.24 Failure Modes Registry

```
  CODEPATH                    | FAILURE MODE                    | RESCUED? | TEST? | USER SEES?                 | LOGGED?
  ----------------------------|---------------------------------|----------|-------|----------------------------|--------
  /pay/[token]                | onbekend/verlopen token         | Y        | Y     | generieke 404/410          | Y
  /pay/[token]                | throttle                        | Y        | Y     | 429                        | Y
  createPaySession            | Stripe 5xx/timeout              | Y        | Y     | "probeer opnieuw"          | Y
  createPaySession            | plafond vol / open sessie       | Y        | Y     | hergebruik / 409           | Y
  createPaySession            | kill switch / payments uit      | Y        | Y     | 503 "tijdelijk niet"       | Y
  webhook                     | signature / replay              | Y        | Y     | —                          | Y
  webhook                     | bedrag ≠ snapshot               | Y        | Y     | admin: needs_review        | Y + alert
  webhook                     | over_ceiling                    | Y        | Y     | mail dubbel betaald        | Y
  autoRefund                  | Stripe weigert                  | Y (L16)  | Y     | admin: needs_refund + alert| Y
  outbox cash replay          | RLS/CHECK weigert               | Y        | Y     | deur: rejected + reden     | Y
  outbox check-in replay      | oude server zonder kolommen     | Y (volgorde) | Y | —                         | Y
  reconcile                   | webhook < ingecheckt            | Y        | Y     | rij 'te betalen'           | Y
  refund a/b                  | rol / status / Stripe           | Y        | Y     | 409 / inline fout          | Y
  dispute webhook             | onbekende charge                | Y        | Y     | —                          | Y
  approvePayoutRun            | reserve / status / rol          | Y        | Y     | Platform-tab melding       | Y
  renderStatementPdf          | render/storage                  | Y        | Y     | retry-knop                 | Y + alert
  expire-sessions cron        | job stil                        | Y (heartbeat, S8-1) | Y | Platform-tab #open   | Y + alert
  token-mint on snapshot      | DB-fout                         | Y        | Y     | Charge: "nog niet beschikbaar" | Y
```
0 rijen met RESCUED=N ∧ TEST=N ∧ Silent → **0 CRITICAL GAPS** (mits T7, T9 landen).

### 10.25 Diagrams

Geproduceerd in dit hoofdstuk: systeemarchitectuur (10.8), dataflows F1–F5 met schaduwpaden (10.8/10.12), toestandsmachines (10.8), async-schedule (10.12), deploy-volgorde en rollback (10.17, tekstueel genummerd), gebruikersflow (10.19), droomtoestand (10.4). **Stale-audit:** het design-doc-fasediagram klopt na D19/D20 (geen fee-tabel genoemd, noodrem is tekst); plan §1–§9 bevatten geen ASCII-diagrammen, wel tabellen die T12 bijwerkt (§4 tabel `entry_payments`, §6 fasering).

### 10.26 Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship. (P1 blokkeert de eerste live euro; P2 zelfde branch/fase; P3 follow-up.)

- [ ] **T1 (P1, human: ~1d / CC: ~20min)** — P1 migraties — één SQL-functie `payment_amount_for(tier_id, heads, venue_id)` + BEFORE INSERT-trigger op `entry_payments` die het bedrag zet en een client-bedrag weigert; TS rekent nooit met geld
  - Surfaced by: Section 3 (CRITICAL a) + Section 5 (duplicatie)
  - Files: `supabase/migrations/<new>_entry_payments.sql`, `src/features/payments/schemas.ts`
  - Verify: pgTAP: insert met afwijkend `amount_cents` → overschreven/geweigerd; 2 × €25 + fee exact
- [ ] **T2 (P1, human: ~1d / CC: ~20min)** — P2 sessie-RPC — plafond per gastrij met `SELECT … FOR UPDATE` op `guests.id`; webhook-RPC telt `paid + deze` (open sessies niet); over_ceiling → autorefund-pad
  - Surfaced by: Section 4 (async-ordering), Section 1 S1-3
  - Files: `supabase/migrations/<new>_pay_session_rpc.sql`, `src/features/payments/stripe-webhook-handlers.ts`
  - Verify: `pnpm db:test:concurrency` nieuwe test beide volgordes; vitest fixture N-verlaging
- [ ] **T3 (P1, human: ~½d / CC: ~15min)** — RLS — insert-policy `entry_payments` alleen `method='cash'`, deurrechten op event, server-afgeleide `venue_id/event_id`; pgTAP allowed + denied per rol
  - Surfaced by: Section 3 (dreiging cash op andermans event), L9
  - Files: migratie, `supabase/tests/database/entry_payments.test.sql`
  - Verify: `pnpm db:test -- supabase/tests/database/entry_payments.test.sql`
- [ ] **T4 (P1, human: ~1d / CC: ~20min)** — token — `pay_token` UNIQUE, 128-bit, expiry = event-einde + 24 u in event-tijdzone; mint bij goedkeuring, lui bij snapshot-fetch, client-token bij quick-add geaccepteerd en gevalideerd
  - Surfaced by: Section 3 (entropie), Section 1 S1-1, L10
  - Files: migratie, `src/features/payments/token.ts`, `src/features/door/queries.ts`, `src/features/door/outbox/gateway.ts`
  - Verify: vitest token-lengte/entropie; pgTAP UNIQUE; flow-test QR offline
- [ ] **T5 (P1, human: ~½d / CC: ~15min)** — outbox — `v`-veld op payloads, nieuw kind `entry_payment_cash`, `unconfirmed_heads`/`override_heads` op check-in, tolerante replay
  - Surfaced by: Section 1 S1-4, Section 9
  - Files: `src/features/door/outbox/types.ts`, `replay.ts`, `gateway.ts`, `DoorProvider.test.tsx`
  - Verify: replay-tests oude payload zonder `v`; rejected-pad met reden
- [ ] **T6 (P1, human: ~2h / CC: ~10min)** — noodrem — `PAYMENTS_KILL_SWITCH` gelezen in sessie-RPC-wrapper, Charge-action, mint, refund; runbook-regel
  - Surfaced by: L15 / D20.1
  - Files: `src/features/payments/config.ts`, `actions.ts`, `docs/runbook.md`
  - Verify: vitest per pad met env gezet → 503/geen mint
- [ ] **T7 (P1, human: ~½d / CC: ~15min)** — statussen — `needs_refund`, `needs_review`, `over_ceiling`-vlag; Platform-tab-lijst; Sentry-alert; webhook `charge.refunded` sluit `needs_refund`; `gstack-shortcut(dec-24329554)`-marker
  - Surfaced by: L16 / D20.2, Section 2 AmountMismatch
  - Files: migratie, `src/features/payments/stripe-webhook-handlers.ts`, `src/components/po/screens/platform/*`
  - Verify: vitest: Stripe-refund-fout → needs_refund + alert; pgTAP transities
- [ ] **T8 (P2, human: ~½d / CC: ~10min)** — realtime — `entry_payments` in de publicatie; deur abonneert per event; `guest_payment_summary`-view in de snapshot
  - Surfaced by: Section 1 S1-2, Section 7 (N+1)
  - Files: migratie (publication + view), `src/features/door/queries.ts`, `src/lib/supabase/realtime-throttle.ts`
  - Verify: `door-render-isolation.test.tsx` groen; flow-test: betaald-vlag binnen 5 s
- [ ] **T9 (P2, human: ~2h / CC: ~10min)** — cron — expire-stale-sessions elke 10 min + heartbeat-metric/alert
  - Surfaced by: Section 2 (bewust niet-gerescued), Section 8 S8-1
  - Files: migratie (pg_cron), `src/app/api/cron/payments-expire/route.ts` of edge function, Sentry-config
  - Verify: test: job markeert heartbeat; alert bij > 1 u stil (handmatig getest)
- [ ] **T10 (P2, human: ~2h / CC: ~10min)** — AVG — `payer_email` in de anonimisatiecron + retentietekst
  - Surfaced by: Section 3 (PII)
  - Files: `supabase/migrations/<new>_payments_retention.sql` (uitbreiding van `20260614230000_privacy_anonymization.sql`), `src/lib/legal.ts`-verwijzing
  - Verify: pgTAP: na retentievenster is `payer_email` null
- [ ] **T11 (P2, human: ~2h / CC: ~10min)** — Stats — deuromzet per event (bruto/fee/netto) als GROUP BY-RPC in P4a
  - Surfaced by: reality-row deferred-asks (ClickUp 86exxuuu7 punt 5)
  - Files: migratie (RPC, SECURITY INVOKER), `src/components/po/screens/stats.tsx`
  - Verify: pgTAP: RPC rol-relatief; UI toont de regel
- [ ] **T12 (P2, human: ~3h / CC: ~20min)** — docs — plan §4/§6 splitsen (P2/P2b, P4a/P4b, P5 → P2), §4-tabel `entry_payments` (cash client-side), §10 samenvouwen; spec #62 (a)(b)(c)(h) + hybride ticketdocument + #10-grens; CLAUDE.md-bullet; Capacitor-plan §5 route B bevestigd; changelog
  - Surfaced by: L12, design-doc "Gevolgen"
  - Files: `payments-plan-claude-code.md`, `gastenlijst-app-spec.md`, `CLAUDE.md`, `capacitor-plan-claude-code.md`, `docs/changelog.md`
  - Verify: `tests/unit/claude-md-references.test.ts` groen; `pnpm test`
- [ ] **T13 (P2, human: ~30min / CC: ~5min)** — ClickUp — P4 `z8uq9m4a7n` → P4a/P4b, P5 `z8uq9m4a7p` herbestemd, nieuwe P2b-taak, hertag `86exxuuu7`/`86exyp8rc` naar ≥5
  - Surfaced by: L13, reality-row pr-count
  - Files: to be determined (ClickUp)
  - Verify: taken zichtbaar met juiste tags en dependencies
- [ ] **T14 (P3, human: ~1d / CC: ~20min)** — QA — `tests/flows/door-payment.flow.ts` (QR offline, "nog niet bevestigd", cash) + `flows.mjs`-registratie; smoke `/pay/<random>` → 404
  - Surfaced by: Section 6, Section 9
  - Files: `tests/flows/door-payment.flow.ts`, `tests/flows/flows.mjs`, `tests/e2e/*.spec.ts`
  - Verify: `pnpm qa:flows door-payment`; `pnpm e2e:smoke`
- [ ] **T15 (P3, human: ~2h / CC: n.v.t.)** — P3a device-test — Maestro contactloos op Tap to Pay (NL) en een Android-tablet met NFC tegen Stripe's apparaatlijst
  - Surfaced by: open vraag 11 (Max, 2026-10-12)
  - Files: to be determined (`docs/native/*` runbook)
  - Verify: betaling met echte Maestro-pas en Debit Mastercard op een release-build

_No new tasks from Section 10 (trajectory): schuld is bewust en gelogd._

### 10.27 TODOS.md

Aangemaakt (`TODOS.md`, repo-root) met de vijf al-besloten uitstellingen, zonder nieuwe vragen (elk antwoord staat in het ledger): fee-regels-tabel (D19 B), retry-wachtrij refunds (D20.2 A), P4b uitbetaalautomatisering (D13), P2b open shop (D13/premisse 3), P6 tweede PSP (besluit 23). Geen nieuwe TODO-voorstellen uit de secties: alles wat gevonden is, is óf vereiste correctheid/operabiliteit (taken T1–T15) óf al uitgesteld.

### 10.28 Outside Voice

Codex: niet geïnstalleerd (preflight `CODEX_MODE: not_installed`). Native fallback vereist `TaskOutput` in de tooldefinities van deze sessie; die ontbreekt → onbeschikbaar-pad: geen reviewer gestart, geen clean-credit. Gelogd als `codex-plan-review` status `unavailable`, `outside_status: unavailable`. Let op: de **office-hours** van vandaag kreeg wél een onafhankelijke koude lezing (Claude-subagent, zie design-doc §Cross-Model Perspective); die telt niet als outside coverage voor déze review.

### 10.29 Approval readiness

Gecontroleerd per rij: L1 D13=C · L2 D12=B · L3 premisse 5/D10 · L4 D13 + premisse 3 · L5 D14.3=B · L6 D14.4=B · L7 D14.2/D15.2=A · L8 D14.1/D15.1=A · L9 D16.1=A · L10 D16.2=A · L11 D17 (geen voorkeur = aanbevolen A) · L12 D17 (Gevolgen) → T12 · L13 D17 (Dependencies) → T13 · L14 D19=B · L15 D20.1=B · L16 D20.2=A (shortcut, gelogd). Elke taak T1–T15 past binnen de scope van precies één van deze antwoorden of een bestaande invariant (CLAUDE.md security-checklist, AVG-retentie, DoD, Prime Directive 1/5). Afgewezen en uitgestelde items staan buiten de taken (10.20, 10.27).

**Approval readiness: PASS** (L1–L16).

### 10.30 Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | HOLD SCOPE (D18, Max)                       |
  | System Audit         | docs-only PR #465 gemerged; niets gebouwd;  |
  |                      | spec #62 draagt Connect-restanten; ClickUp  |
  |                      | Fase 14 nog op milestone-25                 |
  | Step 0               | office-hours vooraf (design-doc APPROVED);  |
  |                      | aanpak C; 16 ledger-rijen, alle approved    |
  | Section 1  (Arch)    | 7 issues found (2 → beslissingen L15/L16)   |
  | Section 2  (Errors)  | 20 error paths mapped, 1 GAP → resolved L16 |
  | Section 3  (Security)| 13 threats, 0 unmitigated High; 4 CRITICAL  |
  |                      | vereisten als taken (T1,T3,T4,T10)          |
  | Section 4  (Data/UX) | 14 edge cases mapped, 0 unhandled           |
  | Section 5  (Quality) | 2 issues found (geldlogica één plek; dispatch)|
  | Section 6  (Tests)   | Diagram produced, 0 gaps (headers in T2,T3, |
  |                      | T14)                                        |
  | Section 7  (Perf)    | 0 issues found (indexen + view gespecificeerd)|
  | Section 8  (Observ)  | 1 gap found (heartbeat → T9)                |
  | Section 9  (Deploy)  | 2 risks flagged (geen staging; oude client) |
  | Section 10 (Future)  | Reversibility: 3/5, debt items: 4 (bewust)  |
  | Section 11 (Design)  | 0 issues; /plan-design-review aanbevolen    |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (11 items: 5 deferred, 6 rejected)  |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 20 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 18 total, 0 CRITICAL GAPS                   |
  | TODOS.md updates     | 5 items (alle al besloten; geen nieuwe)     |
  | Scope proposals      | 0 proposed, 0 accepted (HOLD SCOPE)         |
  | CEO plan             | skipped by mode                             |
  | Outside voice        | codex: unavailable (not installed; native   |
  |                      | fallback zonder TaskOutput)                 |
  | Lake Score           | 0/1 (D13: C gekozen, B was 10/10)           |
  | Diagrams produced    | 7 (architectuur, dataflows, state machines, |
  |                      | async-schedule, deploy/rollback, userflow,  |
  |                      | droomtoestand)                              |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows (PLAN_REALITY complete), 2 unverified |
  +====================================================================+
```

### 10.31 Unresolved Decisions

Geen onbeantwoorde vragen; D17 kwam terug als "geen voorkeur" en is als de aanbevolen optie (A, goedkeuren) verwerkt en zo in het ledger genoteerd. Open **vragen** (geen reviewbeslissingen) staan in het design-doc §Open Questions: 1 (quotes per venue), 3 (ticketdocument-vlag), 4 (Stripe-bevestiging), 5 (jurist afzondering), 8 (deur-UI hoofden), 11 (Maestro/tablet-test); eigenaar Max/P0.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | mode: HOLD SCOPE, 0 critical gaps (16 ledger rows approved, 15 tasks T1–T15, 5 deferred items in TODOS.md) |
| Outside Review | codex (`/plan-ceo-review` outside voice) | Independent 2nd opinion | 1 | UNAVAILABLE | no completed external review: Codex not installed; native fallback unavailable (no TaskOutput in this session) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** provider codex, phase plan-review, unavailable (not installed; native fallback skipped: TaskOutput capability missing); 0 findings, no clean-review credit. Note: the office-hours design doc of 2026-10-12 did receive an independent cold read by a Claude subagent (same harness; recorded in the design doc), which does not count as outside coverage for this plan review.
- **VERDICT:** CEO CLEARED (HOLD SCOPE, 0 unresolved, 0 critical gaps) — eng review required.

NO UNRESOLVED DECISIONS
