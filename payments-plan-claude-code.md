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

**Herzien 2026-10-13 (design-review, §12):** de IA-zin, de statetabel, de journey-regel en het diagram hierboven zijn uitgewerkt en op punten vervangen in §12 (volgorde bedrag → QR → hoofden; geen zichtbare 10 s-timer; Charge als primaire knop; bedrag als anker op `/pay`; de doorhost bepaalt k, de gast betaalt alleen; organisatiekant toont alleen ticketbedragen). Bij conflict wint §12.

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

## 11. Eng-review 2026-10-12 (gstack `/plan-eng-review`) — werkdocument

> **Target (vast):** `docs/designs/fase-14-deurbetalingen-office-hours.md` (APPROVED) + §10 van dit plan (CEO-review, HOLD SCOPE, taken T1–T15). **Report file:** dit plan (geselecteerd plan, optie 2 van het write-beleid). Branch `claude/86exxuuu7-fase14-ceo-review`, PR #478. Vraagnummering van de eng-review start opnieuw bij D1 (skill-regel); de CEO-review-vragen D1–D22 blijven in §10.

### 11.1 Voorbereiding

- **Retrospectief (git log op de genoemde bestaande paden):** `src/features/door/outbox` + `DoorProvider.tsx` dragen tien `fix(door)`-commits rond idempotentie, stale guards en IndexedDB (373b43e1, 3b89f5c7, 7d976aa9, 986f78d3, ccb3c186, dbc0509f…): elke outbox-wijziging kreeg nazorg uit een fresh-session review. `src/features/billing` + webhook: drie security/ordering-fixes (7a3eeefc UUID-guard, 50c4d4eb, 16a05988 event-ordering). Geen reverts. Conclusie: outbox-kinds en webhook-handlers zijn de twee plekken waar P1/P2 het meest kunnen misgaan; beide krijgen in deze review extra tests en een reviewer-sessie.
- **Prior learnings toegepast:** `plusone-shared-checkout-branch-can-switch-under-you` (9/10, vandaag): branch + HEAD vóór elke commit controleren; `bash-heredoc-long-dutch-text-fails-use-write-then-cat` (8/10).
- **Testframework (CLAUDE.md):** Vitest (unit), Playwright (e2e/layout/flows), pgTAP via `pnpm db:test`; concurrency = Node-scripts met twee `pg`-sessies (`scripts/quota-trigger-concurrency-test.mjs`, `package.json:29`), niet pgTAP.

### 11.2 Scope Challenge A — beoordeling

**Wat lost elk deelprobleem al op (receipts, verified 2026-10-12):**

| Deelprobleem | Bestaand | Receipt |
|---|---|---|
| Outbox-dispatch en foutklassen | `replayEntry` switch per kind; `classifyError`: 23505 → duplicate/synced, 45001/45002/45005 → error met DB-tekst, 23503/42501/23514/23502 → error (terminaal), onbekende code → pending (max 5 pogingen) | `src/features/door/outbox/replay.ts:75-97, 147-233` |
| Outbox-envelope | `OUTBOX_BUSTER = 'door-outbox-v1'`; mismatch → hele wachtrij gedropt; geen payload-versie | `src/features/door/outbox/persistence.ts:14, 121` |
| Quick-add aan de deur | outbox-kind `add_guest` met client-side `guests.id`, `source:'door'` | `src/features/door/DoorProvider.tsx:735-755`, `replay.ts:217-231` |
| Deur-snapshot | `fetchDoorSnapshot`: events, venues, guests (DOOR_GUEST_SELECT), guest_tiers *, check_ins *, refusals *; IDB-cache buster `door-snapshot-v2` | `src/features/door/queries.ts:66-71, 151-206`, `offline/persister.ts:21-26` |
| Realtime deur | kanaal `door:${eventId}`, `postgres_changes` op `check_ins` en `guests` met `event_id=eq.` | `src/features/door/sync/useDoorSync.ts:181-205`; publicatie alleen die twee tabellen: `supabase/migrations/20260614000000_realtime_door.sql:31,38` |
| Publieke token-pagina | sha256 van het token inline; `get_request_status(p_token_hash, p_ip_hash)` SECURITY DEFINER met `consume_public_throttle('st:'||ip,15,30)` | `src/app/r/[token]/page.tsx:38-42`; `supabase/migrations/20261015140000_location_audit.sql:77-88`; throttle-functie `20261006170000_public_throttle_bind_raw_callers.sql:93` |
| Capaciteit/quota | `enforce_event_capacity` (45005, advisory lock 3), `enforce_guest_quota` (45001/45002), `enforce_request_link_max` (45006) | `20260624090000_event_capacity.sql:69-109`, `20260714100000_quota_capacity_trigger_locking.sql:69-140`, `20260706101000_request_link_attribution.sql:196-205` |
| Check-in-triggers | `cap_check_in_arrivals` (monotoon, gecapt op allotment), `check_ins_a_stale_guard` | `20260617020000_check_in_void.sql:34`, `20261010120000_checkin_absolute_count_guard.sql:43-139` |
| Audit-triggerset | `public.audit_trigger()`, patroon `create trigger audit_X after insert or update on public.X for each row execute function public.audit_trigger();` | `20260613150000_audit_triggers.sql:83, 189-218`; recentste toevoeging `20261015140000_location_audit.sql:69` |
| Grant-matrix-test | catalog-driven; alleen anon-SELECT- en authenticated-DELETE-allowlists; een authenticated INSERT-policy vraagt geen registratie, wel `plan(N)` bij extra asserts | `supabase/tests/database/grant_matrix.test.sql:23, 44-46, 94-102` |
| AVG-anonimisatie | `run_privacy_retention()` nult guests.email/phone/note e.a.; cron `plusone-privacy-retention` 03:30 | `20260614230000_privacy_anonymization.sql:181-253, 324-327`; laatste definitie `20261006120000_retention_requests_complete.sql:284` |
| Gastmail-wachtrij | `guest_mail_queue`; `enqueue_guest_mail(p_guest_id, p_type, p_remark, p_actor, p_delay_seconds, p_request_id)`: de rij wijst naar gast/aanvraag, draagt geen adres | `20261013180000_guest_mail_types.sql:188, 286-294`; helper `src/features/mail/guest-queue.ts:79-111` |
| Stripe-confinement | `ALLOWED_DIR = path.join('features','billing')` (één string) | `src/features/billing/stripe-confinement.test.ts:21-27` |
| Webhook | één route, signature over raw body, `handleStripeWebhook` → RPC `apply_stripe_subscription_update`, ledger `stripe_webhook_events`, ordering-guard op `event.created` | `src/app/api/webhooks/stripe/route.ts:8-19`, `src/features/billing/stripe-webhook.ts:1-27` |
| Events-tijd | `starts_at timestamptz not null`, `ends_at timestamptz` nullable (`ends_at > starts_at`); **geen tijdzonekolom**; 'Europe/Amsterdam' 15× hardcoded in migraties | `20260613000000_full_schema.sql:118-134`; `20260708110000_fix_landing_slug_amsterdam_day.sql:31` |
| Company-locaties | `company_locations(id, venue_id, name, address_line, …)`; events kopiëren `location_name/address` | `20261013160000_event_locations.sql:61-74`, `20261007120000_event_location.sql:30-31` |

**Minimum voor het doel:** zoals §10.5 punt 2 (P1 → P2-deur → P2-geld → P4a). Niets daarvan is zonder blokkade uitstelbaar; de uitstelbare delen staan al in `TODOS.md`.

**Complexiteit (geteld, [estimated]):** P1 + P2 raken ≈ 24–30 bestanden: migraties 5–6 (tabellen, RLS, triggers, RPC, realtime-publicatie, retention), `src/features/payments/` 7–9, deur 6 (`queries.ts`, `model.ts`, `outbox/types.ts`, `replay.ts`, `gateway.ts`, `DoorProvider.tsx`, `sync/useDoorSync.ts`), app-routes 2 (`/pay/[token]`, webhook-route), schermen 3 (Settings → Payments, Platform-tab, deur-Charge-sheet), mail 1–2, tests 8–10. Nieuwe services/klassen: `PaymentProvider` + `StripeAdapter`/stub, sessie-RPC, token-mint, SQL-geldfunctie = 4. **Gate (≥ 8 bestanden of ≥ 2 nieuwe services) slaat aan → B.**

**Search check (WebSearch, Aside niet beschikbaar):** Stripe Checkout `expires_at` 30 min–24 u, default 24 u, `POST /v1/checkout/sessions/{id}/expire`, event `checkout.session.expired` **[Layer 1, geverifieerd 2026-10-12]**. Row lock in een SECURITY DEFINER-RPC voor het plafond: bestaand patroon in dit repo (advisory locks in de quota/capaciteitstriggers) **[Layer 1]**. Realtime-publicatie uitbreiden: bestaand patroon (`20260614000000`) **[Layer 1]**. Geen afwijking van standaardpraktijk; geen eureka.

**TODOS-kruisverwijzing:** `TODOS.md` (5 items) blokkeert niets in P1/P2; "fee rules table" past bewust niet in deze PR (D19); geen nieuwe TODO's uit deze beoordeling.
**Completeness:** volledige RLS-allowed+denied, concurrency-proef en replay-tests zijn CC-goedkoop en vereist (DoD 3/4).
**Distributie:** web via Vercel (bestaand); native (P3) later via Codemagic; geen nieuw artefact in P1/P2.

**Reality-rows (eng):**

REALITY: premise-table pass 17 interface-claims geverifieerd met file:line in de tabel hierboven (Explore + handmatige reads); unverified=0 in deze fase; cited baseline: Stripe NL-tarieven [re-measure before gate] `src/features/door/outbox/replay.ts:75-97`
REALITY: already-done pass `git log origin/main --grep "entry_payments|PaymentProvider|payout|pay_token"` levert alleen de docs-commits van vandaag (b8b2334d, fee29970) en #465; geen code `src/features/door/outbox/types.ts:8-16`
REALITY: surface-check finding `pnpm db:test:concurrency` is géén pgTAP maar `scripts/quota-trigger-concurrency-test.mjs` + `scripts/last-admin-concurrency-test.mjs`; §10.14 noemde "pgTAP + concurrency" → T2 krijgt een nieuw Node-script; `pnpm db:test`, `qa:flows`, `e2e:smoke` bestaan; route `/pay` bestaat niet (gepland) `package.json:29`
REALITY: binding-decisions pass branch-scope leeg; repo-scope besluiten van vandaag (10d9adc6, 989e0e5c, 247bce3c, 85efed3d, 24cc454e, 24329554, 17b8ed11, 96377dc5) gelden en worden niet heropend; geen overruled default opnieuw aangetroffen `payments-plan-claude-code.md:216-233`
REALITY: numbers pass bestandstelling 24–30 [estimated]; sessies P1 2 / P2 2–3 / P4a 1–2 [estimated, §10]; Checkout-grenzen 30 min–24 u [measured: Stripe-docs 2026-10-12]; marge-cijfers [measured: §2-formule] `payments-plan-claude-code.md:92`
REALITY: deferred-asks pass identiek aan §10.3 (ClickUp 86exxuuu7: deuromzet per event → T11; override-only → bewust vervangen L8; route B → afgewezen L3; hertag → T13); geen nieuwe weglatingen `payments-plan-claude-code.md:177`
REALITY: pr-count finding geen `.gstack/ship-policy.json`; eng-review bevestigt de splitsing P2-deur / P2-geld (twee PR's) omdat de outbox-wijzigingen (deur) en de webhook/refund-handlers (geld) elk een eigen fresh-session review + `/security-review` vragen (CLAUDE.md review gates) `payments-plan-claude-code.md:161`
REALITY: transaction-semantics pass geen driver-, pool- of protocolwijziging (geen crash-robot-rerun nodig); de plafond-RPC gebruikt `select … for update` binnen één transactie zoals de bestaande quota-locks `supabase/migrations/20260714100000_quota_capacity_trigger_locking.sql:69`
REALITY: prior-art pass geen vendored of gepatchte dependency in P1/P2; upstream `stripe` SDK ongewijzigd (adopt), API-versie gepind in `STRIPE_API_VERSION` (`stripe` bestaat al; `@capacitor-community/stripe-terminal` is P3a) `src/features/billing/stripe-adapter.ts:124`
REALITY: contract-assumptions pass geen aannames uit een ander repo; het enige externe contract is de Stripe-API (versie gepind in `src/features/billing/config.ts`, opnieuw te checken vóór P1) `package.json:17`
REALITY: dependency-fallback pass P2 zonder P4a = test-mode-demo (geen live euro); P1 zonder Stripe-antwoord = modelonafhankelijke delen (tabellen, seam, IBAN); P3a zonder entitlement = niets `docs/designs/fase-14-deurbetalingen-office-hours.md:163`
REALITY: obligation-tiers pass must-ship (P1-PR): T1–T7 + SC-1/2/3/9/11 hieronder; next PR (P2-geld): T8–T11; deferred: `TODOS.md` (5); budget: één high-risk PR ≤ ~1.500 regels incl. tests, anders splitsen `payments-plan-claude-code.md:833`

### 11.3 Scope Challenge B — structuur (gate aangeslagen)

Geen feature-cuts voorgesteld (HOLD SCOPE; de scope is in §10 besloten en wordt hier niet heropend). Structuurvraag verplicht: zie D1 hieronder.

#### Decision ledger (eng)

### R1: Bestandsindeling P1/P2 — oorspronkelijke of kleinere opstelling
Finding: SC-0, structuur, confidence 8/10, `payments-plan-claude-code.md:126-137` + `docs/designs/fase-14-deurbetalingen-office-hours.md:85-113`, reviewer eng
Plan baseline: §4 tabellen `company_payout_accounts`, `payment_fee_rules` (vervallen, D19), `tier_capacity` (P2b), `entry_payments`, `company_ledger`, `payout_runs` + `payout_run_items`; §10.13 module `src/features/payments/` (provider, stripe-adapter, stub, config, schemas, actions, webhook-handlers) + TS fee-engine + token-minter; goedgekeurd via D13/D19 (scope), structuur zelf nooit apart besloten
Runtime evidence: geen code; bestaande patronen: `src/features/billing/` (provider/adapter/stub/config/schemas/actions/stripe-webhook), outbox-kinds in `types.ts`/`replay.ts`/`gateway.ts`
Comparison grid:
```text
Commitment                                   | Source/approval | Current (plan)                              | A Original arrangement                      | B Smaller arrangement
Feature-lijst v1 (L1–L16)                    | §10, approved   | vast                                        | vast                                        | vast
Tabellen                                     | §4/D13/D19      | 4 + payout_run_items                        | zelfde                                      | 4 tabellen; ledgerregels dragen payout_run_id (geen items-tabel)
Geldberekening                               | §10.13 T1       | SQL-functie + TS fee-engine (tonen)         | SQL-functie + TS fee-engine                 | alleen SQL `payment_amount_for`; TS toont bedragen uit de DB
Token-mint                                   | L8/L10, T4      | aparte token-service                        | `token.ts` module + aanroepen in approval/snapshot | zelfde `token.ts`, maar mint in de snapshot-RPC (SQL) + approval-action; geen aparte service
Webhook                                      | §10.13          | handler-map in payments, bestaande route    | zelfde                                      | zelfde
Module `src/features/payments/`              | §10.13          | 7–9 bestanden                               | 7–9                                         | 6 (provider, stripe-adapter+stub, config, schemas, actions, webhook-handlers; token.ts klein)
Tests, RLS, audit, grant-matrix              | DoD, approved   | volledig                                    | volledig                                    | volledig
Pending remedies not decided here            | —               | R2 (bon-aflevering), SC-1/2/3/5/9/11        | pending                                     | pending
```
Question D1:
D1 — R1: bestandsindeling voor P1/P2: oorspronkelijke opstelling of kleinere?
Project/branch/task: PlusOne `claude/86exxuuu7-fase14-ceo-review`, eng-review Fase 14, HOLD SCOPE.
ELI10: P1 + P2 raken naar schatting 24–30 bestanden en voegen 4 nieuwe services toe, dus de complexiteitsgate slaat aan. Dezelfde features en dezelfde contracten kunnen met minder bewegende delen: geen `payout_run_items`-tabel (de ledgerregel draagt `payout_run_id`), geen TypeScript-fee-engine (één SQL-functie rekent, TS toont), token-mint in de snapshot-RPC en de approval-action in plaats van een losse service. Alles wat in §10 is goedgekeurd blijft gelijk; dit gaat alleen over waar de code en tabellen staan.
Stakes if we pick wrong: A = twee plekken die geld rekenen (TS en SQL) en een extra tabel in een high-risk PR; B = minder flexibiliteit als later een items-tabel of een TS-berekening toch nodig blijkt (expand-only toe te voegen).
Recommendation: B omdat "geld rekent op één plek" (§10.13) en "zo min mogelijk bewegende delen in P1" (HOLD SCOPE) precies dit zijn; de latere uitbreidingen zijn expand-only.
Note: options differ in kind, not coverage — no completeness score.
Pending remedies not decided here: R2, SC-1, SC-2, SC-3, SC-5, SC-9, SC-11.
Pros / cons:
A) Original arrangement
  ✅ Volgt het plan §4 letterlijk; items-tabel maakt per-run-rapportage triviaal
  ✅ TS-fee-engine maakt bedragen tonen zonder DB-roundtrip mogelijk
  ❌ Twee geldberekeningen (TS + SQL) die uit elkaar kunnen lopen; extra tabel + RLS + audit in de high-risk PR
B) Smaller arrangement (recommended)
  ✅ Eén geldberekening in SQL, door sessie-RPC én cash-trigger gebruikt; TS kan niet afwijken
  ✅ Vier tabellen in plaats van vijf; token-mint zonder extra service; kleinere reviewlast
  ❌ Bedragen tonen vraagt een DB-call (de snapshot draagt ze al); items-tabel later alsnog toevoegen als per-run-detail nodig is
Net: zelfde features; minder plekken waar geld fout kan gaan tegen iets minder vrijheid later.
Header: Opstelling
Options:
A) Original arrangement
Tabellen: company_payout_accounts, entry_payments, company_ledger, payout_runs + payout_run_items. Module src/features/payments/: provider.ts, stripe-adapter.ts, stub.ts, config.ts, schemas.ts, actions.ts, fee-engine.ts, token-service.ts, webhook-handlers.ts. Effort: human ~+1 d / CC ~+15 min; risk medium.
B) Smaller arrangement (recommended)
Tabellen: company_payout_accounts, entry_payments, company_ledger, payout_runs (ledgerregel draagt payout_run_id). SQL: payment_amount_for(), mint_pay_token() in de snapshot-RPC. Module src/features/payments/: provider.ts, stripe-adapter.ts (+stub), config.ts, schemas.ts, actions.ts, token.ts (klein), webhook-handlers.ts. Effort: human baseline / CC baseline; risk low.

State: approved
Actual answer: A) Original arrangement (D1, Max 2026-10-12)
Accepted scope: bestandsindeling per plan §4/§10.13: tabellen company_payout_accounts, entry_payments, company_ledger, payout_runs + payout_run_items; module src/features/payments/ met provider.ts, stripe-adapter.ts, stub.ts, config.ts, schemas.ts, actions.ts, fee-engine.ts (alleen tonen; het ladende bedrag komt uit de SQL-functie payment_amount_for, T1 blijft), token-service.ts, webhook-handlers.ts. Geen feature-wijziging; pending remedies R2–R4 en SC-3/5/8/9/10/11 blijven zoals genoteerd.
History: —

**Scope record (B):** feature answers: geen cuts voorgesteld (HOLD SCOPE, §10); structure: A (D1, Max 2026-10-12, oorspronkelijke opstelling); accepted scope: tabellen `company_payout_accounts`, `entry_payments`, `company_ledger`, `payout_runs`, `payout_run_items` + module `src/features/payments/` zoals §10.13, met T1 (bedrag uitsluitend uit `payment_amount_for` in SQL; `fee-engine.ts` toont) onverminderd; pending remedies: R2, R3, R4, SC-3, SC-5, SC-8, SC-9, SC-10, SC-11. **Scope Challenge result: scope accepted as-is** (MODE = FULL_REVIEW).

### 11.4 Scope Challenge C — bevindingen tegen de code

| # | Sev | Conf | Bevinding | Bewijs | Dispositie |
|---|---|---|---|---|---|
| SC-1 | P1 | 9/10 | **Een verlaten Checkout-sessie blokkeert de deur tot 24 u.** Stripe-sessies verlopen standaard na 24 u (min 30 min); de plafondregel telt open sessies mee en "hergebruikt de open sessie". Gast opent de maillink (k=1), haakt af; aan de deur vraagt de doorhost k=2 → gedekt = 1 → cap 1 → "al in behandeling". Bij +0 is de cap 0: deur dicht. | Stripe-docs 2026-10-12 (expires_at 30 min–24 u, default 24 u; `POST /v1/checkout/sessions/{id}/expire`); design-doc regel "Plafond per gastrij" (`docs/designs/fase-14-deurbetalingen-office-hours.md:123`) | → R2 (vraag) |
| SC-2 | P1 | 9/10 | **"Event-einde + 24 u" is ongedefinieerd:** `events.ends_at` is nullable en er is geen tijdzonekolom; 'Europe/Amsterdam' staat 15× hardcoded in SQL. | `supabase/migrations/20260613000000_full_schema.sql:118-134`; `20260708110000_fix_landing_slug_amsterdam_day.sql:31` | → R3 (vraag) |
| SC-3 | P1 | 9/10 | **Outbox-versie zit in de envelope, niet in de payload; een buster-bump dropt de hele wachtrij** (`persistence.ts:121`, bewust: comment regel 36 zegt dat de buster daarom níét gebumpt wordt). T5 moet dus: `v` als optioneel veld per entry, `OUTBOX_BUSTER` ongewijzigd, nieuwe kinds additief, en `replayEntry` krijgt een `default:` die een onbekende kind `pending` houdt (rollback naar een oude bundle mag queued cash niet weggooien). | `src/features/door/outbox/persistence.ts:14, 36, 121`; `replay.ts:147-233` (geen default-tak) | vereist onder T5 (L9/L10); geen nieuwe keuze |
| SC-4 | P1 | 8/10 | **De bon naar `payer_email` heeft geen afleverpad:** `guest_mail_queue`-rijen wijzen alleen naar een gast of aanvraag en dragen geen adres; `enqueue_guest_mail(p_guest_id, p_type, …)` mailt naar `guests.email`. | `supabase/migrations/20261013180000_guest_mail_types.sql:188, 286-294`; `src/features/mail/guest-queue.ts:79-111` | → R4 (vraag) |
| SC-5 | P2 | 8/10 | **Nieuwe SQLSTATE-codes voor cash-weigeringen vallen in `pending` (5 pogingen) in plaats van direct `error` met reden**, tenzij ze aan `classifyError` worden toegevoegd (bestaand: 45001/45002/45005 → error; 42501 terminaal). Cash-trigger krijgt eigen codes (voorstel 45007 betalingen uit / tier niet betaalbaar; 45008 rij niet meer betaalbaar) en `classifyError` kent ze. | `src/features/door/outbox/replay.ts:28, 75-97` | vereist onder L9/T3+T5; geen nieuwe keuze |
| SC-6 | P2 | 8/10 | **Concurrency-proef hoort in `scripts/*-concurrency-test.mjs` (twee `pg`-sessies), niet in pgTAP**; §10.14/T2 zei "pgTAP + concurrency". | `package.json:29`; `scripts/quota-trigger-concurrency-test.mjs:1-30` | feitelijke correctie T2 (verify-regel) |
| SC-7 | P3 | 8/10 | Snapshot-shape verandert (entry_payments + tokens) → `DOOR_CACHE_BUSTER` 'door-snapshot-v2' → v3 is prima (alleen cache); níét de outbox-buster. | `src/features/door/offline/persister.ts:21-26` | noot bij T8 |
| SC-8 | P2 | 8/10 | **Realtime-publicatie bevat alleen `check_ins` en `guests`;** `useDoorSync` abonneert per tabel met `event_id=eq.`; `entry_payments` moet in de publicatie en krijgt een derde `.on()`; `entry_payments.event_id` NOT NULL + index is daarvoor voorwaarde. | `20260614000000_realtime_door.sql:31,38`; `src/features/door/sync/useDoorSync.ts:181-205` | vereist onder T8; geen nieuwe keuze |
| SC-9 | P1 | 8/10 | **`override_heads` op een check-in is nu client-geschreven;** niets server-side beperkt het tot admin/organisator. Nodig: BEFORE INSERT/UPDATE-trigger op `check_ins` die `override_heads > 0` alleen toestaat als `auth.uid()` admin/organisator van dat event is (zelfde rolhelpers als `can_write_guests`), plus `override_reason` verplicht; pgTAP denied voor doorhost. | `src/features/door/outbox/gateway.ts:91-95` (upsert op `id` vanaf de client); `20260617020000_check_in_void.sql:34` (cap-trigger patroon) | vereist (security-invariant, CLAUDE.md "RLS is the boundary"); nieuwe sub-taak T16 |
| SC-10 | P3 | 9/10 | `stripe-confinement.test.ts` heeft één `ALLOWED_DIR`-string → array van toegestane mappen in dezelfde PR als de adapter. | `src/features/billing/stripe-confinement.test.ts:21-27` | onder T1-PR; geen nieuwe keuze |
| SC-11 | P2 | 8/10 | **Sla de token-hash op, niet het token:** `/r/[token]` hasht sha256 inline en zoekt op `status_token_hash` (en kreeg daar al een security-fix voor, 07db03ce). Het rauwe token leeft alleen in de deur-snapshot/QR en de mail; `entry_payments.pay_token_hash` UNIQUE; client-gegenereerde tokens (L10) worden bij sync door de server gehasht (trigger). | `src/app/r/[token]/page.tsx:38-42`; `20261015140000_location_audit.sql:77-88`; commit 07db03ce | vereist onder T4 (bestaand patroon, defence in depth); geen nieuwe keuze |

Prior learning applied: `plusone-shared-checkout-branch-can-switch-under-you` (9/10, 2026-10-12) bij de PR-stappen; geen eerdere learning raakt deze bevindingen.

### R2: Checkout-sessieduur en hergebruik bij een ander aantal hoofden
Finding: SC-1, P1, confidence 9/10, `docs/designs/fase-14-deurbetalingen-office-hours.md:123`, reviewer eng
Plan baseline: L7/R2-2 (D14.2/D15.2, Max): gedekt = betaald + open sessies; nieuwe hoofden ≤ 1 + N − gedekt, anders "de open sessie hergebruiken"; sessieduur niet gespecificeerd (Stripe-default 24 u)
Runtime evidence: Stripe `expires_at` 30 min–24 u, default 24 u; `checkout.sessions.expire` beschikbaar; `checkout.session.expired`-event (Stripe-docs 2026-10-12)
Comparison grid:
```text
Commitment                                        | Source/approval          | Current (plan)                      | A (30 min + expire bij ander k)                               | B (30 min, hergebruik ongeacht k)
Plafond per gastrij bij aanmaak                   | L7/R2-2, approved        | betaald + open ≤ 1+N                | zelfde                                                        | zelfde
Plafond bij webhook (betaald + deze)              | §10.12, approved         | ja                                  | zelfde                                                        | zelfde
Sessieduur                                        | pending                  | Stripe-default 24 u                 | expires_at = +30 min (Stripe-minimum)                         | expires_at = +30 min
Open sessie met ander aantal hoofden              | pending                  | hergebruiken (k van de oude sessie) | server verloopt de oude sessie actief en maakt een nieuwe met k | hergebruiken: gast betaalt het oude aantal
Open sessie met hetzelfde aantal hoofden          | L7, approved             | hergebruiken                        | hergebruiken                                                  | hergebruiken
Verlopen sessie                                   | §10.9 (expire-job), approved | pg_cron elke 10 min               | Stripe verloopt zelf na 30 min; `checkout.session.expired` ruimt op; cron blijft vangnet | zelfde
```
Question D2:
D2 — R2: sessieduur 30 minuten en een open sessie met een ander aantal hoofden actief verlopen?
Project/branch/task: PlusOne `claude/86exxuuu7-fase14-ceo-review`, eng-review Fase 14.
ELI10: Een Checkout-sessie leeft standaard 24 uur. Omdat open sessies meetellen in het plafond, kan een gast die de maillink opende en afhaakte de deur een hele dag blokkeren: de doorhost vraagt 2 hoofden, de oude sessie dekt er 1, en bij een gast zonder +N is het plafond zelfs 0. De oplossing: sessies van 30 minuten (Stripe-minimum) én, als er al een open sessie is met een ánder aantal, die sessie actief verlopen en een nieuwe maken met het gevraagde aantal. Dezelfde aantallen = gewoon hergebruiken.
Stakes if we pick wrong: zonder dit staat een gast tot 24 u "in behandeling" en kan de deur niet innen; met alleen 30 min blijft de deur tot een half uur dicht na een verlaten maillink.
Recommendation: A omdat de deur nooit mag wachten op een sessie die de gast al heeft verlaten; actief verlopen kost één Stripe-call en de `expired`-webhook ruimt de oude op.
Completeness: A=10/10, B=7/10
Pros / cons:
A) 30 min + expire-and-recreate bij een ander aantal (recommended)
  ✅ Deur-QR wint altijd van een verlaten maillink; plafond blijft exact (de verlopen sessie telt niet meer mee)
  ✅ `checkout.session.expired` is het natuurlijke opruimsignaal; cron wordt vangnet in plaats van hoofdpad
  ❌ Eén extra Stripe-call op het pad "ander aantal"; een gast die de oude tab nog open heeft ziet "sessie verlopen" en moet opnieuw scannen
B) 30 min, hergebruik ongeacht aantal
  ✅ Eenvoudiger: nooit een sessie actief verlopen
  ✅ Minder Stripe-calls
  ❌ Tot 30 min lang betaalt de gast het oude aantal of ziet de deur "al in behandeling"
Net: exact plafond en een deur die nooit wacht, tegen één extra Stripe-call.
Header: Sessieduur
Options:
A) 30 min + expire bij ander k (recommended)
`expires_at = now + 30 min` op elke sessie; bij een aanvraag met een ander aantal hoofden: `checkout.sessions.expire` op de open sessie, dan een nieuwe; webhook `checkout.session.expired` zet de rij terug op `requires_payment`. Effort: human ~½ d / CC ~15 min; risk low.
B) 30 min, altijd hergebruiken
`expires_at = now + 30 min`; open sessie wordt hergebruikt ongeacht het gevraagde aantal. Effort: human ~2 h / CC ~5 min; risk medium (deur wacht tot 30 min).

State: approved
Actual answer: A) 30 min + expire bij ander k (D2, Max 2026-10-12)
Accepted scope: elke Checkout-sessie krijgt expires_at = now + 30 min; bij een aanvraag met een ander aantal hoofden verloopt de server de open sessie (checkout.sessions.expire) en maakt een nieuwe; gelijk aantal = hergebruik; webhook checkout.session.expired zet de rij terug op requires_payment; pg_cron-expire-job blijft vangnet. Plafondregels L7/R2-2 ongewijzigd. Gaat in T2 (sessie-RPC) en T9 (cron als vangnet).
History: —

### R3: Vervaldatum van het betaaltoken zonder `ends_at` en zonder tijdzonekolom
Finding: SC-2, P1, confidence 9/10, `supabase/migrations/20260613000000_full_schema.sql:118-134`, reviewer eng
Plan baseline: L8/D15.1 (Max): token leeft tot event-einde + 24 u in de event-tijdzone (#26). Na D3 (Max: "Ends at moet altijd verplicht zijn bij het aanmaken van het evenement, dus we dekken dat hiermee af of niet?") heropend met de feiten hieronder.
Runtime evidence: `ends_at` is NIET verplicht in de app: `endsAt: isoDateTime.nullable().optional()` (`src/features/events/schemas.ts:88, 109, 407`), create schrijft `ends_at: endsAt ?? null` (`src/features/events/actions.ts:143`), update laat het weg als undefined (`:205`), template-RPC `p_ends_at` optioneel (`:1115`); DB-kolom nullable met CHECK `ends_at > starts_at`; geen migratie zet NOT NULL; 'Europe/Amsterdam' 15× hardcoded in SQL.
Comparison grid:
```text
Commitment                                   | Source/approval | Current (code)                      | A (fallback start + 12 u)                 | B (verplicht alleen bij betaalde tiers)       | C (verplicht voor elk event, eigen PR)
Token verloopt bij event-einde + 24 u        | L8, approved    | ongedefinieerd bij null ends_at     | coalesce(ends_at, starts_at + 12 h)       | ends_at gegarandeerd zodra een prijs bestaat  | ends_at gegarandeerd altijd
ends_at verplicht in de app                  | pending (Max)   | nee (optional in 3 schema's)        | nee                                       | alleen via trigger bij prijs > 0              | ja: Zod required, formulier verplicht, template-RPC required
DB-kolom                                     | pending         | nullable                            | nullable                                  | nullable + trigger                            | backfill (starts_at + 12 h) daarna NOT NULL (expand–contract, aparte migratie)
Tijdzone                                     | #26, approved   | constante in SQL                    | constante Europe/Amsterdam                | zelfde                                        | zelfde
Scope                                        | HOLD SCOPE      | —                                   | binnen P2                                 | binnen P1 (trigger) + tier-editor-validatie   | aparte kleine PR vóór P1 (raakt event-form, wizard, templates, 3 schema's, 1 migratie)
Bestaande events zonder eindtijd             | —               | ~? (onbekend aantal, prod)          | onaangeraakt                              | kunnen geen prijs aanzetten tot aangevuld     | backfill zet starts_at + 12 h; organisator kan corrigeren
```
Question D5:
D5 — R3 (heropend): eindtijd altijd verplicht maken, of alleen afdekken voor betalingen?
Project/branch/task: PlusOne `claude/86exxuuu7-fase14-ceo-review`, eng-review Fase 14.
ELI10: Je zei dat de eindtijd altijd verplicht hoort te zijn bij het aanmaken van een event. Dat is vandaag niet zo: in drie Zod-schema's is `endsAt` optioneel, de create-action schrijft `null`, en de databasekolom is nullable. Dus nee, het is nu niet afgedekt. Drie wegen: (A) alleen een fallback in de betaal-SQL (start + 12 u), (B) verplicht zodra een tier een prijs heeft, of (C) jouw regel: verplicht voor élk event, met een backfill (start + 12 u) voor bestaande events en daarna NOT NULL, als eigen kleine PR vóór P1. Tijdzone blijft in alle gevallen de constante Europe/Amsterdam.
Stakes if we pick wrong: A laat een gat voor meerdaagse events; C raakt elk event-formulier, de onboarding-wizard en de template-RPC (buiten Fase 14) en vraagt een backfill op prod.
Recommendation: C omdat het jouw productregel is, een eindtijd ook kalender en mails helpt, en de betaal-SQL dan nooit hoeft te gokken; als eigen kleine PR zodat P1 er niet zwaarder van wordt. Bewijs dat A toch beter is: prod heeft veel events zonder eindtijd en organisatoren willen die niet invullen.
Completeness: A=7/10, B=9/10, C=10/10
Pros / cons:
A) Alleen fallback in de betaal-SQL
  ✅ Nul wijzigingen buiten Fase 14; één coalesce
  ✅ Werkt voor clubnachten
  ❌ Meerdaags event zonder eindtijd: token verloopt te vroeg; jouw regel blijft onwaar in de code
B) Verplicht alleen bij betaalde tiers
  ✅ Dwingt een eindtijd precies waar geld in het spel is; geen backfill
  ✅ Blijft binnen P1 (trigger + tier-editor-validatie)
  ❌ Twee regimes: gratis events mogen zonder eindtijd, betaalde niet; organisator ziet de eis pas bij het aanzetten van een prijs
C) Verplicht voor elk event, eigen PR vóór P1 (recommended)
  ✅ Eén regel overal: formulier, wizard, templates, DB NOT NULL; betaal-SQL rekent zonder fallback
  ✅ Helpt kalender (.ics einde) en de "meld je bij de entree"-mails
  ❌ Aparte PR met backfill op prod (expand–contract); bestaande events krijgen start + 12 u en moeten eventueel gecorrigeerd worden
Net: jouw regel netjes in de code tegen een kleine extra PR buiten Fase 14.
Header: Eindtijd
Options:
A) Alleen fallback
`coalesce(ends_at, starts_at + interval '12 hours')` in de betaal-SQL; verder niets. Effort: human ~1 h / CC ~5 min; risk low.
B) Verplicht bij prijs
Trigger: prijs > 0 vereist `events.ends_at`; tier-editor + event-form valideren. Effort: human ~½ d / CC ~15 min; risk low.
C) Verplicht voor elk event, eigen PR (recommended)
Zod `endsAt` required in create/update/template-schema's, formulier + wizard verplicht, template-RPC `p_ends_at` required, migratie: backfill `starts_at + 12 h` → NOT NULL (expand–contract). Effort: human ~1 d / CC ~30 min; risk low–medium (backfill op prod).

State: approved
Actual answer: C) Verplicht voor elk event, eigen PR (D5, Max 2026-10-12)
Accepted scope: eindtijd verplicht voor elk event: Zod endsAt required in create/update/template-schema's (src/features/events/schemas.ts:88,109,407), event-form + onboarding-wizard verplicht veld, template-RPC p_ends_at required, migratie backfill ends_at = starts_at + 12 h voor bestaande rijen gevolgd door NOT NULL (expand–contract, twee migraties), tijdzone-constante Europe/Amsterdam; eigen kleine PR vóór P1 (nieuwe taak T18); de betaal-SQL rekent daarna zonder fallback. Buiten Fase 14-scope, door Max expliciet gevraagd.
History: D3 (2026-10-12) bood A (fallback) en B (verplicht bij prijs); Max antwoordde met de vraag of ends_at niet al verplicht is bij aanmaken. Feitencheck: niet verplicht (schemas.ts:88/109/407, actions.ts:143). Heropend als D5 met optie C.

### R4: Bon naar `payer_email` — afleverpad in de gastmail-wachtrij
Finding: SC-4, P1, confidence 8/10, `supabase/migrations/20261013180000_guest_mail_types.sql:188, 286-294`, reviewer eng
Plan baseline: besluit 20 + §10 "Bon" (approved): Checkout int het e-mailadres van de betaler, landt op `entry_payments.payer_email`, bon via de gastmail-wachtrij; de wachtrij kent echter alleen een gast-/aanvraagpointer en mailt naar `guests.email`
Runtime evidence: `guest_mail_queue` draagt geen adres (`:188`); `enqueue_guest_mail(p_guest_id, p_type, …)` (`:286-294`); helper `queueGuestMails` in `src/features/mail/guest-queue.ts:79`
Comparison grid:
```text
Commitment                                   | Source/approval    | Current (plan)                     | A (pointer naar entry_payment in de wachtrij) | B (payer_email kopiëren naar guests.email als leeg)
Bon gaat naar het adres dat de betaler invulde | besluit 20, approved | ja                                | ja: nieuw mailtype `payment_receipt`, kolom `entry_payment_id` op de wachtrij (expand-only), resolver leest `payer_email` | alleen als `guests.email` leeg was; anders naar het bestaande gastadres
PII op de gastrij                            | AVG-regels, approved | payer_email niet op de gastrij    | blijft zo                                     | payer_email wordt gast-e-mail (ook in exports, lijsten, retentie)
Opt-out/retentie                             | bestaand (guest_mail_optout, retention) | —                | nieuwe type valt onder dezelfde opt-out en retentie (payer_email in anonimisatie, T10) | bestaand pad
Wijziging in de wachtrij                     | —                  | geen                               | 1 kolom + 1 type + resolver                    | geen
```
Question D4:
D4 — R4: hoe komt de bon bij het adres dat de betaler in Checkout invulde?
Project/branch/task: PlusOne `claude/86exxuuu7-fase14-ceo-review`, eng-review Fase 14.
ELI10: Het plan zegt: de bon gaat via de gastmail-wachtrij naar het adres uit Checkout. Maar die wachtrij kent alleen "mail de gast", en een gastrij aan de deur heeft vaak géén e-mail. Óf de wachtrij leert een betaling kennen (nieuw mailtype met een pointer naar de betaling; het adres blijft op de betaling, niet op de gast), óf we kopiëren het Checkout-adres naar de gastrij als die nog leeg is (simpel, maar dan wordt een betaaladres stilzwijgend het gastadres in lijsten, exports en retentie).
Stakes if we pick wrong: A = één kolom en één mailtype extra in P2-geld; B = een gast krijgt een adres dat hij alleen voor een betaling gaf, en de company ziet het in de lijst.
Recommendation: A omdat het adres van een betaler een ander doel heeft dan het adres van een gast (AVG-doelbinding) en de wachtrij expand-only kan groeien; B lekt een betaaladres de gastenlijst in.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Wachtrij-pointer naar de betaling (recommended)
  ✅ Adres blijft op `entry_payments` (RLS event-scope, eigen retentie), nooit in gastenlijst of export
  ✅ Zelfde opt-out en retry-mechaniek als alle gastmails; één kolom, één type, één resolver
  ❌ Kleine schemawijziging aan de wachtrij + template-registratie
B) Kopiëren naar `guests.email` als leeg
  ✅ Geen wijziging aan de wachtrij; bestaande `guest_on_list`-mechaniek
  ✅ Gast is daarna ook bereikbaar voor andere gastmails
  ❌ Betaaladres wordt gastadres in lijsten/exports/retentie zonder dat de gast dat koos; conflict als de gast al een ander adres had
Net: één expand-only kolom tegen een stille vermenging van betaal- en gastgegevens.
Header: Bon-aflevering
Options:
A) Pointer in de wachtrij (recommended)
`guest_mail_queue.entry_payment_id` (nullable, FK), mailtype `payment_receipt`, resolver leest `entry_payments.payer_email`; opt-out en retentie zoals bestaand. Effort: human ~½ d / CC ~15 min; risk low.
B) Kopiëren naar guests.email
Bij `succeeded` en lege `guests.email`: zet `payer_email` op de gastrij (geaudit) en gebruik `enqueue_guest_mail`. Effort: human ~1 h / CC ~5 min; risk medium (doelbinding).

State: approved
Actual answer: A) Pointer in de wachtrij (D4, Max 2026-10-12)
Accepted scope: guest_mail_queue.entry_payment_id (nullable FK, expand-only), mailtype payment_receipt, resolver leest entry_payments.payer_email; opt-out en retentie zoals bestaand; payer_email in de anonimisatiecron (T10). Nieuwe sub-taak T17 (P2-geld). Besluit 20 ongewijzigd.
History: —

**Scope Challenge C — disposities:** SC-1 accepted (D2 = A); SC-2 accepted (D5 = C, eigen PR T18); SC-3 accepted (vereist onder T5); SC-4 accepted (D4 = A, T17); SC-5 accepted (vereist onder T3/T5); SC-6 feitelijke correctie T2; SC-7 noot bij T8; SC-8 accepted (vereist onder T8); SC-9 accepted (vereist, T16); SC-10 accepted (T1-PR); SC-11 accepted (vereist onder T4). Geen afgewezen of uitgestelde bevindingen. **Scope Challenge result: scope accepted as-is.**

### 11.5 Section 1 — Architecture review (eng)

Bevindingen (meest ernstig eerst):

- `[P1] (confidence: 9/10) src/features/door/outbox/replay.ts:147-233 + persistence.ts:14,121` — geen `default:`-tak in `replayEntry` en de envelope-buster dropt bij mismatch de hele wachtrij; een rollback naar een oudere bundle met een `entry_payment_cash`-entry in IDB zou die entry óf stil negeren óf (bij een buster-bump) alle queued deur-schrijfacties weggooien. Remedie (accepted, SC-3/T5): nieuwe kinds additief, buster ongewijzigd, `default:` → entry blijft `pending` met `message: 'unknown kind'`, zichtbaar in de sync-balk.
- `[P1] (confidence: 9/10) design-doc regel "Bon" + Section 4 hieronder` — **`payer_email` op `entry_payments` lekt via realtime naar het deurtoestel:** `postgres_changes` levert de hele rij aan elke subscriber die de rij mag lezen (RLS filtert rijen, geen kolommen); de deur abonneert per event (`useDoorSync.ts:181-205`) en zou dus het betaaladres van elke gast binnenkrijgen en in de IDB-snapshot persisteren. → R5/D6 (vraag): apart tabel voor het betaaladres zonder deur-grant.
- `[P1] (confidence: 8/10) src/features/door/outbox/gateway.ts:91-95 + 20261010120000_checkin_absolute_count_guard.sql:43-139` — de check-in is een client-upsert met absolute aantallen onder een stale-guard; `unconfirmed_heads`/`override_heads` mogen daarom níét door de client worden geleverd. Remedie (accepted, verfijning van L8/T5/T16): de BEFORE-trigger berekent `unconfirmed_heads = greatest(0, heads − paid_heads − override_heads)` zelf uit `entry_payments`; de client stuurt alleen `override_heads` (+ reden), en de trigger weigert `override_heads > 0` zonder admin/organisator-rol (SC-9). Zo is er geen manipuleerbaar veld.
- `[P1] (confidence: 9/10) Stripe-docs 2026-10-12` — SC-1 (24 u-sessie blokkeert de deur): accepted via D2 = A.
- `[P1] (confidence: 9/10) full_schema.sql:118-134` — SC-2 (`ends_at` nullable): accepted via D5 = C (T18, vóór P1).
- `[P2] (confidence: 8/10) 20260614000000_realtime_door.sql:31,38` — SC-8 publicatie: accepted onder T8; `entry_payments.event_id` NOT NULL + index `(event_id)` is voorwaarde voor het `event_id=eq.`-filter.
- `[P2] (confidence: 8/10) src/features/billing/stripe-webhook.ts:1-27` — één route, maar `handleStripeWebhook` is billing-specifiek (mapt subscription-events naar één RPC). Remedie (accepted, §10.13): de route blijft, de signature-verificatie wordt één gedeelde stap, daarna een handler-map per `event.type` waarin billing en payments elk hun handlers registreren; onbekende types → 200 + log (bestaand gedrag behouden; regressietest).
- `[P2] (confidence: 8/10) 20261006170000_public_throttle_bind_raw_callers.sql:93` — `/pay/[token]` hergebruikt `consume_public_throttle` met twee sleutels: `'pay:' || ip_hash` (30/15 min) én `'payt:' || token_hash` (10/15 min), binnen de SECURITY DEFINER-RPC zoals `get_request_status` (`20261015140000:77-88`). Geen nieuwe keuze.
- `[P2] (confidence: 7/10) src/features/door/queries.ts:151-206` — de snapshot-query wordt één tabel groter; de RLS-SELECT-policy op `entry_payments` voor de deur spiegelt `check_ins` (event-scope via dezelfde rolhelper). Accepted onder T3/T8.
- **Grenzen en koppeling:** nieuw is alleen deur ↔ `entry_payments` (snapshot + realtime) en gastrij ↔ token; de deur kent geen Stripe-id's. **SPOF:** webhook-levering (Stripe-retries + 60 s-sync + "sync met Stripe"-knop), platform-admin-goedkeuring van runs (Max/Joeri). **Productiefout per nieuw pad:** zie §10.8/§10.9; eng voegt toe: realtime-token verloopt tijdens een lange deurdienst → bestaand `realtime.setAuth(token)`-pad bij token-refresh (useDoorSync.ts:59) dekt het; test toevoegen.
- **Distributie:** geen nieuw artefact (web); native P3 later.

Dispositions: A-realtime-PII → pending R5/D6; alle overige accepted onder bestaande antwoorden (T2/T3/T5/T8/T16/T18) of feitelijke verfijning.

### 11.6 Section 2 — Code quality review (eng)

- `[P2] (confidence: 8/10) D1 = A (TS fee-engine voor tonen) + T1 (SQL rekent)` — twee implementaties van dezelfde formule. Vereist bewijs (geen nieuwe keuze: volgt uit D1's "alleen tonen" + T1): een contracttest die `feeEngine.quote(x)` vergelijkt met `select payment_amount_for(...)` voor een matrix (prijs 0/€10/€25/€60; hoofden 1/2/5; ophoging 0/max; afronding). Draait in `pnpm db:test`-omgeving als vitest met de lokale stack, of als pgTAP met de verwachte waarden uit één gedeelde fixture-tabel.
- `[P2] (confidence: 8/10) src/features/door/outbox/replay.ts:75-97` — `classifyError` matcht deels op tekst (`check_ins_void_requires_uncheck` in de 42501-boodschap). Nieuwe weigeringen krijgen numerieke SQLSTATE's (45007 "payments disabled / tier not payable", 45008 "row no longer payable", 45009 "override not allowed") en worden op code geklasseerd; geen tekst-matching erbij.
- `[P2] (confidence: 8/10) src/features/door/queries.ts:201-206` — `check_ins *` / `guest_tiers *`: voor `entry_payments` een **expliciete kolomlijst** in de deur-query (id, guest_id, heads, status, pay_token, amount_cents) en nooit `*`, zodat een latere kolom nooit per ongeluk in de snapshot/IDB belandt. Samen met R5.
- `[P3] (confidence: 9/10) src/features/billing/stripe-confinement.test.ts:21` — `ALLOWED_DIR` string → array (SC-10).
- **Shared-code (rubriek):** token-hashing. Callers: `src/app/r/[token]/page.tsx:38-42` (bestaand, inline `createHash('sha256')`) + de voorgestelde `/pay/[token]`-pagina (plan-caller, aanname). Gedrag identiek (sha256 hex van een opaak token; ip-hash via `landingClientIpHash`). Helper `hashPublicToken(raw)` in `src/features/requests/` (naast `ip-hash.ts`), 5 regels; verwijdert ~4 regels in `/r`, voegt ~6 toe, bespaart netto 0 regels maar garandeert dat beide tokenfamilies op dezelfde manier hashen (betrouwbaarheid). Blast radius: beide publieke pagina's. → R6/D7 (vraag: extraheren of niet).
- **Foutafhandeling/randgevallen:** §10.9 dekt de klassen; eng voegt toe: `heads` als integer met CHECK 1..50 én Zod `int().min(1).max(50)`; `expires_at` in UTC uit `now()`; event-einde na D5 altijd aanwezig.
- **Schuld/fragiliteit:** de handmatige SEPA (P4a) en `needs_refund` zijn bewust (D13/D20.2); de TS-fee-engine is de enige nieuwe duplicatie en krijgt zijn contracttest.
- **Diagrammen in geraakte bestanden:** `src/features/door/outbox/types.ts` draagt een docblock-model van kinds en statussen → uitbreiden met `entry_payment_cash` en de uitkomstvelden in dezelfde PR (CLAUDE.md: diagram mee in de commit).

Dispositions: contracttest → accepted (vereist onder D1/T1, nieuwe sub-taak T20); SQLSTATE-codes → accepted (T3/T5); kolomlijst → accepted (T8); confinement → accepted (T1); hashing-helper → pending R6/D7.

### 11.7 Section 3 — Test review (eng)

Testframework: Vitest + Playwright + pgTAP (`pnpm db:test`), concurrency via Node-scripts (CLAUDE.md, `package.json:28-29`). Concrete bestanden gelezen: `replay.ts`, `gateway.ts`, `types.ts`, `stripe-webhook.ts`, `route.ts`, `queries.ts` (zie 11.2).

```
CODE PATHS (gepland; bestaande tests waar genoemd)                      USER FLOWS
[+] supabase: entry_payments + triggers + RPC's                         [+] Deur: Charge → QR → betaald → check-in
  ├── payment_amount_for()           [GAP] pgTAP matrix (T1/T20)            ├── [GAP] [→E2E] QR offline tonen (flows, T14)
  ├── cash BEFORE INSERT (bedrag, 45007/45008) [GAP] pgTAP (T1/T3)           ├── [GAP] [→E2E] betaald binnen 5 s via realtime (T8/T14)
  ├── RLS entry_payments SELECT/INSERT [GAP] pgTAP allowed+denied (T3)        ├── [GAP] "nog niet bevestigd" na 10 s + afstemming (T5/T14)
  ├── create_pay_session RPC (plafond, lock, 30 min, expire bij ander k) [GAP] pgTAP + scripts/pay-ceiling-concurrency-test.mjs (T2)
  ├── apply_entry_payment_update RPC (idempotent, over_ceiling, needs_review) [GAP] vitest fixtures + pgTAP (T2/T7)
  ├── check-in trigger: unconfirmed berekend, override role-check (45009) [GAP] pgTAP denied doorhost (T16)
  ├── mint_pay_token (UNIQUE, hash, client-token adoptie) [GAP] pgTAP (T4)    [+] Maillink: goedkeuring → /pay → Checkout → "je staat op de lijst"
  ├── realtime-publicatie entry_payments [GAP] e2e via flows (T8)             ├── [GAP] [→E2E] k kiezen ≤ plafond; verlopen token → 410 (T14)
  └── retention: payer_email genuld [GAP] pgTAP (T10)                         └── [GAP] dubbel: maillink + deur-QR tegelijk → één betaling (T2, flows)
[+] src/features/payments/                                              [+] Settings → Payments / Platform-tab
  ├── provider/stripe-adapter/stub  [GAP] vitest (patroon provider.test.ts)   ├── [GAP] mandaat alleen admin; IBAN kolom-grant (pgTAP, T3)
  ├── fee-engine (tonen) ↔ SQL       [GAP] contracttest (T20)                 └── [GAP] run approve → payout-ledgerregel; tweede approver 409 (pgTAP, P4a)
  ├── webhook-handlers (map; onbekend type → 200) [GAP] vitest + regressie bestaand stripe-webhook.test.ts
  ├── actions: createPaySession, charge, refund [GAP] vitest (getUser, Zod, kill switch)
  └── token.ts (entropie 128 bit)   [GAP] vitest
[+] src/features/door/outbox                                            [+] Error states
  ├── types/replay: kind entry_payment_cash, default-tak, v-veld [GAP] replay.test.ts uitbreiden (REGRESSIE: bestaande kinds)   ├── [GAP] /pay 404/410/429/503-teksten (vitest route)
  ├── classifyError 45007/45008/45009 [GAP] replay.test.ts                                                                    ├── [GAP] Stripe 5xx bij sessie → "probeer opnieuw" (stub)
  └── gateway.insertCashPayment      [GAP] DoorProvider.test.tsx (fake gateway)                                               └── [GAP] needs_refund-lijst + alert (vitest)
[+] src/app/pay/[token]              [GAP] vitest + e2e smoke (`/pay/<random>` → 404, T14)
[+] guest_mail_queue: payment_receipt + entry_payment_id [GAP] actions.guest-mail.test + pgTAP enqueue (T17)
[+] events.ends_at NOT NULL (T18, eigen PR) [GAP] pgTAP backfill + schemas.test (REGRESSIE: create/update/template zonder eindtijd → 400)

COVERAGE: 0/31 paths tested (0%, alles nieuw)  |  Code paths: 0/20  |  User flows: 0/11
QUALITY: n.v.t. (geen bestaande tests voor nieuwe paden)  |  GAPS: 31 (6 E2E/flows, 0 eval)
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke | [→E2E] = integration/flow test
```

**Regressierisico (IRON RULE):** T5 raakt `OutboxKind`, `replayEntry` en `classifyError`; T16 raakt de check-in-trigger-keten (`check_ins_a_stale_guard`, `cap_check_in_arrivals`). Bestaand gedrag dat beschermd blijft: alle acht bestaande kinds replayen ongewijzigd (incl. `check_in_topup`-legacy, `check_in_void` met `checkInId`, `duplicate`-pad op 23505); check-in-upsert met absolute aantallen, stale-guard en cap. Aanvaardingsasserts: `replay.test.ts` + `DoorProvider.test.tsx` + bestaande pgTAP-check-in-tests blijven groen zonder wijziging van verwachte waarden; nieuwe velden default 0. Dit is een exact bestaand contract (z8uq9m2vg6) en wordt zonder nieuwe vraag meegenomen (T5/T16 verify-regels).

**Testdiepte Stripe-integratie:** vitest met stub-provider + gesigneerde fixture-events dekt de logica; de echte Stripe-koppeling (Checkout-redirect, webhook-levering, `sessions.expire`) is in CI niet te draaien zonder sleutel. → R7/D8 (vraag: alleen stub+fixtures in CI met een handmatige test-mode-run vóór de eerste live euro, of Stripe CLI in een optionele CI-job).

Value cards (selectie, volledig in het Test Plan-artefact): plafond-concurrency `Value: protects=per gastrij nooit meer gedekte hoofden dan 1+N; fails_when=row lock ontbreekt of webhook telt open sessies mee; why_new=geen bestaande test raakt entry_payments; seam=none; no_claim=Stripe's eigen gedrag (stub)`. Cash-RLS `Value: protects=doorhost kan alleen cash op eigen event inserten; fails_when=policy te breed of trigger laat client-bedrag door; why_new=nieuwe tabel; seam=none; no_claim=none beyond protects`. Outbox-regressie `Value: protects=acht bestaande kinds replayen identiek; fails_when=default-tak of type-wijziging verandert dispatch; why_new=bestaande tests dekken geen nieuwe kind; seam=none; no_claim=echte IDB (fake store)`.

Tests made obsolete by this plan: geen.

Dispositions: regressiecontract → accepted (bestaand, carry forward); nieuwe tests per GAP → accepted als vereist bewijs onder de goedgekeurde regels (T1–T17, T20); Stripe-testdiepte → pending R7/D8.

### 11.8 Section 4 — Performance review (eng)

- `[P2] (confidence: 8/10) src/features/door/queries.ts:151-206` — snapshot: `entry_payments` per event via één query met expliciete kolommen (geen view nodig voor v1: ≤ betalingen per event, honderden rijen); index `(event_id, status)`. Scale: 2.000 gasten × ~1,2 betalingen ≈ 2.400 rijen × ~120 B ≈ 300 KB extra in IDB [estimated]. Acceptabel; bij > 5.000 rijen de GROUP BY-view uit §10.15.
- `[P2] (confidence: 8/10)` — realtime: elke statuswijziging op `entry_payments` is één event naar de deur-subscribers van dat event; piek ≈ aantal betalingen per minuut (tientallen) ≪ `REALTIME_EVENTS_PER_SECOND` 200 (`src/lib/supabase/client.ts:27-28`).
- `[P3] (confidence: 7/10)` — `/pay`-RPC: `select … for update` op één gastrij; geen hot row (per gast); Stripe-call ~400 ms p50 / 1,5 s p99 [estimated]; throttle-insert in `landing_request_throttle` zoals `/r`.
- `[P3] (confidence: 7/10)` — webhook-RPC: één rij-update + ledger-insert; geen N+1; `payout_runs`-GROUP BY op `company_ledger(venue_id, created_at)`.
- `[P3] (confidence: 7/10)` — cron expire-sessions: worst case = open sessies (tientallen) × 1 Stripe-call per 10 min; met 30-min-sessies (D2) vooral vangnet.
- Geen onbegrensde queries, geen whole-file loads, geen blocking calls zonder timeout (Stripe-SDK timeout zoals billing). Geen caching nodig voor geld.

Dispositions: geen nieuwe keuzes; indexen en kolomlijst zijn accepted onder T1/T8.

### R5: Waar leeft `payer_email` — op `entry_payments` of in een aparte tabel zonder deur-grant
Finding: A-realtime-PII, P1, confidence 9/10, `src/features/door/sync/useDoorSync.ts:181-205` + `20260614000000_realtime_door.sql:31,38`, reviewer eng
Plan baseline: design-doc "Bon" (approved, besluit 20): `payer_email` op `entry_payments` (RLS event-scope); D4 = A: wachtrij-pointer leest `payer_email`
Runtime evidence: `postgres_changes` levert hele rijen aan subscribers die de rij mogen lezen; de deur abonneert per event en persisteert payloads in IDB (`persister.ts:21-26`); kolom-grants beperken REST-selects, niet de realtime-payload (aanname, [re-measure before gate]: Supabase-docs/test met kolom-revoke)
Comparison grid:
```text
Commitment                              | Source/approval | Current (design-doc)                 | A (aparte tabel entry_payment_receipts)                 | B (op entry_payments, deur-select zonder kolom)
Bon naar payer_email (D4 = A)           | approved        | ja                                   | ja: resolver leest entry_payment_receipts               | ja
Deur ontvangt payer_email via realtime  | pending         | ja (hele rij)                        | nee: tabel niet gepubliceerd, geen deur-grant           | ja via realtime-payload, tenzij kolom-grant het blokkeert (ongetest)
Deur-snapshot bevat payer_email         | pending         | ja tenzij expliciete select          | nee (tabel niet geselecteerd)                           | nee (expliciete kolomlijst, SC-Q3)
Retentie (T10)                          | approved        | payer_email genuld                   | rij in entry_payment_receipts genuld/verwijderd         | kolom genuld
Schema                                  | —               | 1 kolom                              | 1 tabel (entry_payment_id PK, payer_email, sent_at), grant alleen service/admin-finance | 1 kolom + kolom-grant + realtime-test
```
Question D6:
D6 — R5: betaaladres in een aparte tabel zonder deur-grant, of op `entry_payments` met kolom-grant?
Project/branch/task: PlusOne `claude/86exxuuu7-fase14-ceo-review`, eng-review Fase 14.
ELI10: De deur luistert realtime naar `entry_payments` per event en bewaart die rijen in IndexedDB op het deurtoestel. Realtime stuurt hele rijen; RLS filtert welke rijen, niet welke kolommen. Staat `payer_email` op die tabel, dan belandt het betaaladres van elke gast op elk deurtoestel. Twee wegen: het adres in een eigen tabel (`entry_payment_receipts`) die niet gepubliceerd is en geen deur-grant heeft, of op `entry_payments` laten en vertrouwen op een kolom-grant plus een expliciete select, met een test die bewijst dat realtime het dan niet meestuurt.
Stakes if we pick wrong: B zonder sluitende test = PII van betalers op gedeelde deurtablets (en in de AVG-retentie van de snapshot); A = één tabel extra in de high-risk P1.
Recommendation: A omdat "niet gepubliceerd en geen grant" bewijsbaar is met de bestaande grant-matrix-test, terwijl B op een realtime-eigenschap leunt die we eerst zouden moeten meten.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Aparte tabel `entry_payment_receipts` (recommended)
  ✅ Betaaladres komt structureel nooit in realtime-payload of deur-snapshot; grant-matrix-test bewijst het
  ✅ Retentie en bon-resolver (D4) werken op één kleine tabel
  ❌ Eén tabel extra (PK = entry_payment_id, payer_email, receipt_sent_at) in P1
B) Kolom op `entry_payments` + kolom-grant + expliciete select
  ✅ Geen extra tabel
  ✅ Simpelere resolver
  ❌ Veiligheid hangt af van realtime-gedrag bij kolom-grants dat nu niet getest is; één `select *` ergens en het lekt
Net: een kleine tabel die het lek structureel onmogelijk maakt tegen een aanname die eerst gemeten moet worden.
Header: Betaaladres
Options:
A) Aparte tabel (recommended)
`entry_payment_receipts(entry_payment_id PK FK, payer_email, receipt_sent_at)`; niet in de realtime-publicatie; grant alleen service-role + admin/finance eigen company; retentie nult de rij; D4-resolver leest hier. Effort: human ~½ d / CC ~10 min; risk low.
B) Kolom + kolom-grant
`entry_payments.payer_email` met `revoke select(payer_email)` voor de deurrollen; expliciete kolomlijst in de snapshot; realtime-test die bewijst dat het veld ontbreekt. Effort: human ~½ d / CC ~15 min; risk medium.

State: approved
Actual answer: A) Aparte tabel (D6, Max 2026-10-13)
Accepted scope: nieuwe tabel entry_payment_receipts(entry_payment_id PK FK, payer_email, receipt_sent_at), niet in de realtime-publicatie, grant alleen service-role + admin/finance van de eigen company (kolom-grant), geaudit, retentie nult de rij (T10 verplaatst hierheen); payer_email verdwijnt van entry_payments; de D4-resolver (payment_receipt) leest hier. Nieuwe sub-taak T19; design-doc 'Bon' en premisse 3 worden hierop aangepast.
History: —

### R6: Token-hashing als gedeelde helper voor `/r` en `/pay`
Finding: Q-shared-code, P3, confidence 8/10, `src/app/r/[token]/page.tsx:38-42`, reviewer eng
Plan baseline: SC-11 accepted (hash opslaan, niet het token); hoe `/pay` hasht is implementatie
Runtime evidence: `/r` hasht inline (`createHash('sha256')`), geen helper; `landingClientIpHash()` bestaat wel als helper (`src/features/requests/ip-hash.ts:49`)
Comparison grid:
```text
Commitment                         | Source/approval | Current                 | A (helper hashPublicToken, beide callers) | B (geen extractie; /pay kopieert de 3 regels)
Beide pagina's hashen sha256-hex   | SC-11, approved | /r inline               | één functie, twee callers                 | twee kopieën
Regels                             | —               | —                       | −4 +6 (netto +2), 1 test                  | +3 in /pay
Betrouwbaarheid                    | —               | —                       | gelijke hashing gegarandeerd              | drift mogelijk bij latere wijziging
Blast radius                       | —               | —                       | beide publieke pagina's                   | geen
```
Question D7:
D7 — R6: token-hashing extraheren naar één helper voor `/r` en `/pay`?
Project/branch/task: PlusOne `claude/86exxuuu7-fase14-ceo-review`, eng-review Fase 14.
ELI10: De bestaande statuspagina hasht een token met drie regels inline; de nieuwe betaalpagina moet precies hetzelfde doen. Eén kleine helper naast `ip-hash.ts` maakt drift onmogelijk; het kost netto twee regels en één test, en raakt de bestaande pagina (klein regressierisico, bestaande e2e dekt `/r`).
Stakes if we pick wrong: zonder helper kunnen de twee hashes later uit elkaar lopen (bijv. een salt in de ene pagina); met helper raak je een werkende publieke pagina voor nul functionele winst.
Recommendation: A omdat het de rubriek haalt (twee callers, identiek gedrag, betrouwbaarheidswinst) en de wijziging aan `/r` triviaal en gedekt is.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Helper `hashPublicToken` (recommended)
  ✅ Eén plek voor de hashing van alle publieke tokens; test eenmalig
  ✅ `/pay` en `/r` kunnen niet uit elkaar lopen
  ❌ Raakt `/r/[token]/page.tsx` in de P2-PR (bestaande e2e dekt het)
B) Geen extractie
  ✅ `/r` ongemoeid in deze fase
  ✅ Minder diff
  ❌ Twee kopieën van security-relevante code
Net: twee regels netto tegen één bron van waarheid voor token-hashing.
Header: Hash-helper
Options:
A) Helper extraheren (recommended)
`src/features/requests/public-token.ts` → `hashPublicToken(raw: string): string` (sha256 hex); `/r` en `/pay` gebruiken hem; vitest met vector. Effort: human ~30 min / CC ~5 min; risk low.
B) Geen extractie
`/pay` kopieert de drie regels; `/r` blijft zoals het is. Effort: nul; risk low (drift later).

State: approved
Actual answer: A) Helper extraheren (D7, Max 2026-10-13)
Accepted scope: src/features/requests/public-token.ts met hashPublicToken(raw) (sha256 hex); /r/[token]/page.tsx en /pay/[token] gebruiken hem; vitest met vaste vector; bestaande e2e op /r blijft het regressiebewijs. Sub-taak T22 (P2-deur-PR).
History: —

### R7: Testdiepte van de Stripe-integratie
Finding: T-stripe-depth, P2, confidence 8/10, `src/features/billing/stripe-webhook.test.ts` (bestaand patroon: fixtures), reviewer eng
Plan baseline: DoD 4 (unit tests op DB-staat), CLAUDE.md "Stub provider zonder STRIPE_SECRET_KEY"; geen keuze over echte Stripe in CI
Runtime evidence: billing-webhook is getest met fixture-events (`stripe-webhook.test.ts`); CI heeft geen Stripe-sleutel; lokale stack + Stripe test mode is handmatig
Comparison grid:
```text
Commitment                                  | Source/approval | Current (billing-patroon)        | A (stub + fixtures in CI; handmatige test-mode-run vóór live, in runbook) | B (+ optionele CI-job met Stripe CLI en test-key)
Logica getest zonder Stripe                 | DoD 4, approved | ja                               | ja                                                                        | ja
Echte Checkout + webhook-levering getest    | pending         | handmatig                        | handmatig, afgevinkt in `docs/runbook.md` vóór de eerste live euro        | automatisch in een niet-vereiste CI-job (secret in GitHub)
Secret in CI                                | security, approved | geen                          | geen                                                                      | STRIPE test-key als GitHub-secret (test mode)
Onderhoud                                   | —               | —                                | nul                                                                       | Stripe CLI-versie, flaky netwerk, extra job
```
Question D8:
D8 — R7: Stripe alleen via stub + fixtures in CI, met een handmatige test-mode-run vóór live, of ook een optionele CI-job met de Stripe CLI?
Project/branch/task: PlusOne `claude/86exxuuu7-fase14-ceo-review`, eng-review Fase 14.
ELI10: De betaallogica (plafond, webhook-verwerking, refunds) testen we zonder Stripe: stub-provider en gesigneerde fixture-events, zoals billing nu. De echte koppeling (redirect naar Checkout, levering van webhooks, `sessions.expire`) kan alleen met een Stripe-sleutel. Óf we doen die ronde handmatig in test mode vóór de eerste live euro en vinken hem af in het runbook, óf we zetten een optionele CI-job op met de Stripe CLI en een test-key als secret.
Stakes if we pick wrong: A mist een regressie in de echte koppeling tot iemand handmatig test; B brengt een secret en een flaky netwerk-job in CI voor 5 venues.
Recommendation: A omdat het het bestaande billing-patroon volgt, geen secret in CI zet en de handmatige run precies één keer per fase nodig is; B pas als de betaalcode vaker verandert dan één keer per maand.
Completeness: A=8/10, B=10/10
Pros / cons:
A) Stub + fixtures in CI, handmatige test-mode-run vóór live (recommended)
  ✅ Geen secret in CI; zelfde patroon als `stripe-webhook.test.ts`; snel en deterministisch
  ✅ Runbook-checklist dwingt de echte ronde af vóór de eerste live euro en vóór P3
  ❌ Een regressie in de echte Stripe-koppeling valt pas op bij de handmatige ronde
B) + optionele CI-job met Stripe CLI
  ✅ Echte webhook-levering en Checkout-aanmaak elke PR gecontroleerd
  ✅ Vangt API-versie-drift automatisch
  ❌ Test-key als GitHub-secret, Stripe CLI-onderhoud, netwerk-flakiness in een niet-vereiste job
Net: deterministische CI plus één handmatige ronde, tegen automatische dekking met een secret en onderhoud.
Header: Stripe-tests
Options:
A) Stub + fixtures, handmatig vóór live (recommended)
Vitest met stub-provider en fixture-events (gesigneerd met test-secret); `docs/runbook.md` krijgt de test-mode-checklist (Checkout, webhook, expire, refund, dispute) die vóór de eerste live euro en vóór P3 wordt afgevinkt. Effort: human ~½ d / CC ~15 min; risk low.
B) + optionele CI-job
Als A plus een niet-vereiste GitHub-job met Stripe CLI (`stripe listen`/`trigger`) en een test-key-secret. Effort: human ~1 d / CC ~30 min; risk medium (secret, flakiness).

State: approved
Actual answer: A) Stub + fixtures, handmatig vóór live (D8, Max 2026-10-13)
Accepted scope: CI: vitest met stub-provider en met het test-secret gesigneerde fixture-events (patroon stripe-webhook.test.ts); docs/runbook.md krijgt een Stripe-test-mode-checklist (Checkout-redirect, webhook-levering, sessions.expire, refund, dispute) die vóór de eerste live euro en vóór P3 wordt afgevinkt (sub-taak T23). Geen Stripe-secret in CI.
History: —

**Antwoorden D2–D8 (Max, 2026-10-12/13):** D2 = A (30-min-sessies, expire-and-recreate bij ander k), D4 = A (wachtrij-pointer `entry_payment_id`, mailtype `payment_receipt`), D5 = C (`ends_at` verplicht voor elk event, eigen PR T18), D6 = A (`entry_payment_receipts` apart, niet gepubliceerd), D7 = A (`hashPublicToken`-helper), D8 = A (stub + fixtures in CI, handmatige Stripe-test-mode-ronde vóór live). Alle rijen R1–R7 approved; geen shortcut ≤ 7/10 gekozen.

### 11.9 Outside Voice

Codex niet geïnstalleerd; native fallback vereist `TaskOutput`, niet beschikbaar in deze sessie → onbeschikbaar-pad, gelogd als `codex-plan-review` `unavailable` (tweede record vandaag). Geen clean-credit, geen cross-model-vergelijking.

### 11.10 TODOS.md

Geen nieuwe voorstellen: elke eng-bevinding is óf vereiste correctheid onder een goedgekeurde regel (taken hieronder) óf al besloten. `TODOS.md` ongewijzigd (5 items).

### 11.11 Approval readiness (eng)

R1 D1=A · R2 D2=A · R3 D5=C · R4 D4=A · R5 D6=A · R6 D7=A · R7 D8=A. Vereist bewijs zonder nieuwe vraag: SC-3/SC-5 (T5), SC-8 (T8), SC-9 (T16), SC-10 (T1), SC-11 (T4), contracttest fee (T20), regressiecontract outbox/check-in (bestaand z8uq9m2vg6, carry forward). Geen uitgestelde of afgewezen remedies. **Approval readiness: PASS** (R1–R7).

### 11.12 NOT in scope (eng)

- Items-tabel weglaten / TS-fee-engine schrappen: niet gekozen (D1 = A), geen uitstel maar afgewezen voorstel.
- Stripe CLI in CI: niet gekozen (D8), kan later als de betaalcode vaker wijzigt.
- `payer_email` kopiëren naar de gastrij: afgewezen (D4/D6, doelbinding).
- Eindtijd alleen bij betaalde tiers: afgewezen (D5), de regel geldt voor elk event.
- Shop/P2b, P4b, P6, retry-wachtrij, fee-tabel: al in `TODOS.md` (CEO-review), ongewijzigd.

### 11.13 What already exists (eng)

Zie 11.2: outbox-dispatch en foutklassen, snapshot + IDB-persister, realtime-kanaal per event, publieke throttle + token-hashing, capaciteits-/quota-triggers met advisory locks, check-in-triggers, audit-triggerpatroon, grant-matrix-test, anonimisatiecron, gastmail-wachtrij + RPC's, één Stripe-webhook-route met ledger. Alles wordt hergebruikt; herbouwd wordt niets. Gedeelde code: `hashPublicToken` (D7) is de enige extractie; `/r` migreert mee.

### 11.14 Diagrammen (eng-aanvullingen)

```
  SESSIE-LEVENSCYCLUS (D2)
  Charge(k) ──► open sessie voor rij? ──nee──► create(expires=+30m, heads=k) ──► QR/redirect
                       │ja
                       ├─ zelfde k ──► hergebruik URL
                       └─ ander k  ──► sessions.expire(oud) ──► create(k) ──► webhook expired(oud) → rij requires_payment

  CHECK-IN-TRIGGER (A4/SC-9)
  client upsert {id, guest_id, plus_ones_arrived, override_heads?, override_reason?}
     ──► stale_guard ──► cap_arrivals ──► NEW: payment_coverage():
           paid = Σ heads(entry_payments succeeded) ; heads_in = 1 + plus_ones_arrived
           override_heads > 0 ? require role admin/organizer (else 45009) : 0
           unconfirmed_heads := greatest(0, heads_in − paid − override_heads)   (server-berekend, nooit client)

  BON (D4/D6)
  webhook succeeded ──► entry_payment_receipts(payer_email) ──► guest_mail_queue{entry_payment_id, type=payment_receipt}
     ──► resolver leest receipts (niet guests.email) ──► mail ──► receipt_sent_at ; retentie nult payer_email

  WORKTREES/LANES
  T18 (ends_at) ─► Lane A: DB (migraties, RLS, triggers, RPC's, publicatie, pgTAP, types regen)
                      ├─► Lane B: src/features/payments + webhook + /pay + hashPublicToken   (P2-deur/P2-geld)
                      ├─► Lane C: door (outbox kinds, snapshot, sync, Charge-sheet, DoorProvider)
                      └─► Lane D: mail (payment_receipt, queue-pointer) + Settings/Platform-schermen
```
Inline-diagrammen vereist in: `src/features/door/outbox/types.ts` (kind/status-model, bijwerken), nieuwe migratie `entry_payments` (statusmachine als commentaar), `src/features/payments/webhook-handlers.ts` (handler-map).

### 11.15 Failure modes (eng-aanvullingen op §10.24)

```
  CODEPATH                         | FAILURE MODE                                  | RESCUED? | TEST? | USER SEES?                  | LOGGED?
  ---------------------------------|-----------------------------------------------|----------|-------|-----------------------------|--------
  create_pay_session               | verlaten sessie met ander k blokkeert plafond | Y (D2)   | Y     | nieuwe QR werkt direct      | Y
  replayEntry (oude bundle)        | onbekende kind na rollback                    | Y (default: pending) | Y | sync-balk: "wacht op update" | Y
  check-in trigger                 | client stuurt override zonder rol             | Y (45009)| Y     | deur: "override niet toegestaan" | Y + audit
  realtime entry_payments          | betaaladres in payload                        | Y (D6: aparte tabel) | Y (grant-matrix) | —              | —
  useDoorSync                      | realtime-token verlopen tijdens dienst        | Y (setAuth bij refresh) | Y (nieuw) | niets; 60 s-sync vangt | Y
  token expiry                     | event zonder eindtijd                         | Y (D5: NOT NULL) | Y | —                          | —
  fee-engine (TS) vs SQL           | afwijkend getoond bedrag                      | Y (T20 contracttest) | Y | —                        | —
  receipt resolver                 | queue-rij zonder receipts-rij                 | Y (skip + log) | Y  | geen bon; weekstaat toont | Y + alert
```
0 rijen RESCUED=N ∧ TEST=N ∧ Silent → **0 critical gaps**.

### 11.16 Worktree-parallelisatie

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T18 ends_at verplicht | `src/features/events/`, `src/components/po/screens/events/`, onboarding, `supabase/migrations/` | — |
| Lane A: DB-kern (P1) | `supabase/migrations/`, `supabase/tests/database/`, `scripts/*-concurrency-test.mjs`, `src/lib/database.types.ts` | T18 |
| Lane B: payments-module + webhook + /pay | `src/features/payments/`, `src/features/billing/stripe-webhook*`, `src/app/pay/`, `src/app/api/webhooks/stripe/`, `src/features/requests/public-token.ts` | Lane A |
| Lane C: deur | `src/features/door/` (outbox, queries, sync, DoorProvider), `src/components/po/screens/` (Charge-sheet, cockpit) | Lane A |
| Lane D: mail + schermen | `src/features/mail/`, `src/lib/i18n/`, Settings → Payments, Platform-tab | Lane A |
| P2-geld: refunds, disputes, needs_* | `src/features/payments/`, Platform-tab, `supabase/migrations/` | B |
| P4a: ledger-UI, weekstaat-PDF, runs | `src/features/payments/`, Platform-tab, `supabase/migrations/` | A, D |

**Parallel lanes:** na T18 en Lane A kunnen B, C en D tegelijk in eigen worktrees (`isolation: "worktree"`); B en C delen alleen `database.types.ts` (uit A). **Execution order:** T18 → A (merge) → launch B + C + D → merge alle drie → P2-geld → P4a. **Conflict flags:** `src/lib/i18n/` (D en C beide strings: één catalogus-PR of sequentieel), `src/features/door/queries.ts` (alleen C), webhook-route (alleen B).

### 11.17 Implementation Tasks (eng)

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship. T1–T15 uit §10.26 blijven; hieronder de eng-aanvullingen en -correcties (ratio-aanname: tests ~50×, features ~30×, migraties ~30×).

- [ ] **T2 (correctie, P1)** — sessie-RPC: + `expires_at = now + 30 min`, expire-and-recreate bij ander k (D2); verify: `scripts/pay-ceiling-concurrency-test.mjs` (twee pg-sessies, beide volgordes) i.p.v. "pgTAP concurrency"; fixture `checkout.session.expired`.
- [ ] **T5 (correctie, P1)** — outbox: `v` als optioneel veld per entry, `OUTBOX_BUSTER` ongewijzigd (guard-test die de constante pint), `default:`-tak → `pending` + `unknown kind`; SQLSTATE 45007/45008/45009 in `classifyError`; docblock-model in `types.ts` bijwerken. Surfaced by: 11.5 A1, 11.6.
- [ ] **T8 (correctie, P2)** — realtime: `entry_payments` in de publicatie met `event_id` NOT NULL + index; expliciete kolomlijst in `fetchDoorSnapshot` (nooit `*`); `DOOR_CACHE_BUSTER` → v3; derde `.on()` in `useDoorSync`; test: realtime-token-refresh tijdens dienst. Surfaced by: 11.5 A2/A6, 11.6 Q3.
- [ ] **T10 (correctie, P2)** — AVG: retentie nult `entry_payment_receipts.payer_email` (niet `entry_payments`). Surfaced by: D6.
- [ ] **T16 (P1, human: ~1d / CC: ~20min)** — check-in-trigger — `payment_coverage()`: `unconfirmed_heads` server-berekend, `override_heads > 0` alleen admin/organisator (45009), `override_reason` verplicht; pgTAP allowed + denied; bestaande check-in-tests ongewijzigd groen (regressie).
  - Surfaced by: 11.5 A4 + SC-9
  - Files: `supabase/migrations/<new>_checkin_payment_coverage.sql`, `supabase/tests/database/check_ins_payment_coverage.test.sql`, `src/features/door/outbox/types.ts`
  - Verify: `pnpm db:test -- supabase/tests/database/check_ins_payment_coverage.test.sql`; `pnpm vitest run src/features/door`
- [ ] **T17 (P2, human: ~½d / CC: ~15min)** — mail — `guest_mail_queue.entry_payment_id` (nullable FK), type `payment_receipt`, resolver leest `entry_payment_receipts`; template; opt-out/retentie.
  - Surfaced by: SC-4 / D4
  - Files: `supabase/migrations/<new>_payment_receipt_mail.sql`, `src/features/mail/guest-queue.ts`, templates in `src/features/mail/`
  - Verify: vitest enqueue na `succeeded`; pgTAP: queue-rij zonder adres; Mailpit lokaal
- [ ] **T18 (P1, eigen PR vóór P1, human: ~1d / CC: ~30min)** — events — `ends_at` verplicht overal: Zod required (`schemas.ts:88,109,407`), event-form + wizard, template-RPC `p_ends_at` required, migratie backfill `starts_at + 12 h` → NOT NULL (twee migraties, expand–contract); changelog + spec-regel.
  - Surfaced by: SC-2 / D5
  - Files: `src/features/events/schemas.ts`, `src/features/events/actions.ts`, `src/components/po/screens/events/edit.tsx`, onboarding-wizard, `supabase/migrations/<new>_events_ends_at_backfill.sql` + `<new>_events_ends_at_not_null.sql`
  - Verify: `pnpm vitest run src/features/events`; pgTAP: insert zonder ends_at → 23502; `pnpm db:test`; flow `onboarding`
- [ ] **T19 (P1, human: ~½d / CC: ~10min)** — DB — `entry_payment_receipts(entry_payment_id PK FK, payer_email, receipt_sent_at)`, niet gepubliceerd, grant alleen service-role + admin/finance eigen company, audit, grant-matrix-assert.
  - Surfaced by: 11.5 A-realtime-PII / D6
  - Files: migratie, `supabase/tests/database/grant_matrix.test.sql` (plan(N) bump), `src/features/payments/webhook-handlers.ts`
  - Verify: `pnpm db:test -- supabase/tests/database/grant_matrix.test.sql`; realtime-publicatie bevat de tabel niet (pgTAP op `pg_publication_tables`)
- [ ] **T20 (P1, human: ~½d / CC: ~10min)** — tests — contracttest `fee-engine.quote()` ≡ `payment_amount_for()` over een matrix (prijs/hoofden/ophoging/afronding) vanuit één fixture.
  - Surfaced by: 11.6 Q1 / D1
  - Files: `src/features/payments/fee-engine.test.ts`, `supabase/tests/database/payment_amount.test.sql`, gedeelde fixture `tests/fixtures/payment-amounts.json`
  - Verify: beide suites groen op dezelfde fixture
- [ ] **T22 (P2, human: ~30min / CC: ~5min)** — requests — `hashPublicToken()` in `src/features/requests/public-token.ts`; `/r` en `/pay` gebruiken hem; vector-test.
  - Surfaced by: 11.6 shared-code / D7
  - Files: `src/features/requests/public-token.ts`, `src/app/r/[token]/page.tsx`, `src/app/pay/[token]/page.tsx`
  - Verify: vitest vector; bestaande e2e op `/r` groen
- [ ] **T23 (P2, human: ~2h / CC: ~10min)** — runbook — Stripe-test-mode-checklist (Checkout, webhook, expire, refund, dispute, kill switch) vóór de eerste live euro en vóór P3; geen secret in CI.
  - Surfaced by: 11.7 / D8
  - Files: `docs/runbook.md`
  - Verify: checklist afgevinkt door Max vóór `payments_enabled` op de eerste company
- [ ] **T24 (P1, human: ~½d / CC: ~15min)** — webhook — handler-map per `event.type` achter de bestaande signature-stap; billing-handlers ongewijzigd; onbekend type → 200 + log; regressietest op de bestaande billing-fixtures.
  - Surfaced by: 11.5 A-webhook
  - Files: `src/features/billing/stripe-webhook.ts`, `src/features/payments/webhook-handlers.ts`, `src/features/billing/stripe-webhook.test.ts`
  - Verify: `pnpm vitest run src/features/billing src/features/payments`
- [ ] **T25 (P3, human: ~2h / CC: ~5min)** — docs — design-doc "Bon"/premisse 3 bijwerken op D6 (receipts-tabel), D2 (30-min-sessies), D5 (ends_at), D7/D8; plan §4-tabel `entry_payments` (geen `payer_email`, wel `pay_token_hash`).
  - Surfaced by: R2–R7
  - Files: `docs/designs/fase-14-deurbetalingen-office-hours.md`, `payments-plan-claude-code.md` §4
  - Verify: `tests/unit/claude-md-references.test.ts`

_No new tasks from Section 4 (performance): indexen en kolomlijst zitten in T1/T8._

JSONL-artefact: `jq` ontbreekt op deze machine → niet geschreven (waarschuwing: installeer jq voor `/autoplan`-aggregatie).

### 11.18 Unresolved decisions

Geen: R1–R7 zijn beantwoord. Open **vragen** (P0, geen reviewbeslissingen) blijven in het design-doc §Open Questions.

### 11.19 Completion summary (eng)

- Step 0: Scope Challenge — scope accepted as-is (structuur: oorspronkelijke opstelling, D1 = A)
- Reality rows: 12/12 applicable rows emitted (`PLAN_REALITY: phase=eng rows=12/12 … verdict=complete`), 2 unverified premises (Stripe NL-tarieven re-measure; venue-quotes user-stated)
- Architecture Review: 9 issues found (2 → beslissingen D2/D6; rest vereist onder bestaande antwoorden)
- Code Quality Review: 6 issues found (1 → beslissing D7)
- Test Review: diagram produced, 31 gaps identified (alle gemapt op T1–T25; Stripe-diepte D8)
- Performance Review: 5 issues found (geen nieuwe keuzes)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; native fallback without TaskOutput)
- Parallelization: 4 lanes (A sequentieel, dan B ∥ C ∥ D), 3 parallel / 2 sequential (T18, A)
- Lake Score: 4/5 (D2, D4, D5, D6 kozen de 10/10-optie; D8 koos 8/10)
- Suppressed findings (appendix): geen (geen bevindingen onder confidence 5)

## 12. Design-review 2026-10-13 (gstack `/plan-design-review`) — werkdocument

Scope (Max, D1 = A): alle zeven passes; zwaartepunt Charge-sheet (Deur-tab + cockpit) en `/pay/[token]`; Settings → Payments en de Platform-tab licht (state-tabel + kit-verwijzing). Design-system = `design-system.md`. Mockups: de gstack-designer had geen OpenAI-key (`No OpenAI API key found`, 0 van 0 afbeeldingen), dus tekst-wireframes in dit hoofdstuk. Outside voice (D2 = A): native Claude-subagent met koude lezing (Codex niet geïnstalleerd; `outside_status: unavailable`); zijn bevindingen F1–F12 zijn geverifieerd tegen de code (`GuestDetail.tsx:185–190` banner, `landing.ts:102/128`, `EventDayCockpit.tsx:835` modal 340px, `Stepper` floort op 0, `CountStepper` 32px) en hieronder per pass verwerkt.

Step 0: design-compleetheid **5/10** (regels compleet, UI één zin per oppervlak). Een 10 = per oppervlak eerst/tweede/derde, volledige stateset incl. offline/noodrem/deelbetaling/sessieverloop, de hoofden-keuze en "nog niet bevestigd" als concrete controls, QR-maat en -contrast, responsive per viewport, screenreader-labels, Engelse copy.

**Twee productregels van Max uit deze review (bindend, gelden voor elk oppervlak):**
1. **De doorhost bepaalt het aantal, de gast betaalt alleen (D9.1-correctie).** De deur-QR draagt `?heads=k`; op `/pay` kan de gast via de deur-QR níets wijzigen — geen plus/min, geen tickets wegklikken — hij ziet "2 people · €45.00" als tekst en één knop Pay. Ook de maillink heeft geen keuze (herzien door Max tijdens de mockup-review, 2026-10-13; vervangt D10.1 = A): wie online betaalt, betaalt de hele plek — alle nog ongedekte hoofden van 1 + N — omdat de organisator wil weten met hoeveel iemand komt; met 4 tickets betaal je er 4, anders kloppen de aantallen niet. Dit vervangt in het design-doc "de pagina … laat de gast k verlagen" en "via de maillink kiest de gast zelf".
2. **Aan de organisatiekant tonen we alleen wat de organisatie verdient (D9.3-correctie).** Ticket €20.00 + servicefee €2.50: de gast betaalt €22.50 op zijn eigen telefoon en bon; de doorhost, de deurlijst, Settings → Payments en de cockpit tonen €20.00 (× hoofden). PlusOne's servicefee, de ondergrens en eventuele kickbacks (de ophoging die de company houdt) verschijnen nergens in de app-UI van de organisatie, alleen op de financiële documenten (weekstaat, self-billing-factuur, uitbetalingsdocument). Eén uitzondering: de Cash-knop toont het te innen totaal (D10.3), omdat de doorhost dat geld fysiek aanneemt.

Rekenvoorbeeld in dit hoofdstuk: ticket €20.00, servicefee €2.50 per hoofd (illustratief; de echte fee volgt de ondergrens + ophoging), 2 personen → organisatiekant €40.00, gast €45.00.

### 12.1 Pass 1 — Information Architecture: 4/10 → 9/10

Gaten: het plan zette de stepper bovenaan en het bedrag nergens; Charge had geen plek naast de bestaande check-in-knoppen; de 10 s-wachttijd las als een lege sheet; `/pay` zette het bedrag op plek vijf. Besluiten (Max, 2026-10-13, alle = A):

- **D3.1 Charge-sheet-volgorde:** bedrag → QR → compacte hoofden-rij → acties. Bedrag in display 34px als anker (organisatiekant: ticket × hoofden, regel 2 hierboven), QR direct eronder, hoofden als `CountStepper`-rij (44px-hit op touch), knoppen in de `BottomBar`. Past op 390×844 zonder scrollen.
- **D3.2 Geen zichtbare timer:** de check-in-knop staat er vanaf t = 0 als `Check in 2 · not confirmed yet`; zodra realtime de betaling bevestigt flipt het label naar `Check in 2 · paid` (entrance alleen `translateY`). De 10 s uit §10.19 blijft bestaan als achtergrond-gratie op de outbox-uitkomst (webhook wint bij sync), nooit als aftelklok. Dit vervangt "na 10 s de keuze" in §10.19:701 en "online wacht de deur eerst tot 10 s" in het design-doc.
- **D3.3 Plek in de BottomBar:** op een betaalbare rij met ongedekte hoofden wordt **Charge de primaire knop** (`Charge · €40.00 · 2`, icoon `money`); de bar blijft twee knoppen hoog. `Check in all` verhuist in de Charge-sheet (als `Check in k · not confirmed yet / paid`). Zodra gedekte hoofden = hoofden buiten, keert de huidige bar terug. De gestreepte `payBanner` (`GuestDetail.tsx:185–190`, "Paid guest list. Collect payment at the door.") wordt één live regel `€20.00 per person · 2 of 4 paid` (`text-[13.5px] text-text`; niets betaald: `· nothing paid yet`; alles betaald: `Paid · 4 people` met check-icoon in accent).
- **D3.4 `/pay`-anker:** het bedrag dat de gast betaalt is de H1 (display 40px, het enige anker); venue + datum als eyebrow erboven; `2 people · Max · VIP` als sub; het aantal altijd als tekst (deur-QR: k van de doorhost; maillink: de hele plek, alle ongedekte hoofden); bedragblok met de regel "Service fee"; één knop `Pay €45.00`; PlusOne alleen in de `LandingFooter`. Hergebruikt het `/r/[token]`-frame (`LandingWrap`, `request-status.tsx`).

Wireframe Charge-sheet (390px, outbox-deur; cockpit: zie Pass 6):

```
┌ Sheet (max-w 560, rounded-sheet, bg-elev, center=false) ─────────┐
│ CHARGE · Max Seffelaar · [VIP] · 2 of 5 inside        Label 12px │
│ €40.00                                         display 34px, text │
│ 2 people · €20.00 each                         text-dim 13.5px   │
│ ┌──── witte tegel 240×240, p-4, rounded-[20px] ────┐             │
│ │               QR  (modules #0B0B0D, EC M)          │             │
│ └────────────────────────────────────────────────────┘             │
│ iDEAL · Apple Pay · Google Pay · card           text-faint 12px   │
│ Can't scan? Show link                           quiet-knop, 44px  │
│ PEOPLE PAYING NOW      [−]  2  [+]              CountStepper      │
│ ● Waiting for payment…   →   ✓ Paid · 2 people  SyncDot / text-acc│
├ BottomBar ───────────────────────────────────────────────────────┤
│ [ Check in 2 · not confirmed yet ]  →  [ Check in 2 · paid ]      │
│ [ Cash · €45.00 to collect ]   ghost, alleen als cash aan;        │
│                                 cash_fee_mode 'none': Cash · €40.00│
│ Let in free · reason               quiet, alleen admin/organizer  │
└──────────────────────────────────────────────────────────────────┘
```

Wireframe GuestDetail-BottomBar op een betaalbare rij (ongedekt > 0):

```
│ €20.00 per person · 2 of 4 paid                 text-[13.5px]     │
│ [ Charge · €40.00 · 2 ]                         primary           │
│ [ Check in one at a time  2/5 ]                 ghost (bestaand)  │
```
Een hoofd dat via "one at a time" binnenkomt zonder dekking krijgt dezelfde outbox-uitkomst "nog niet bevestigd" (toast `Checked in · not confirmed yet`, D11.2).

Wireframe `/pay/[token]?heads=2` via de deur-QR (390px; de maillink-variant toont `5 people · your whole spot` als tekst — geen stepper, herzien 2026-10-13):

```
┌ LandingWrap (px-4, kolom ≤ 390) ────────────────────────┐
│ LOFI AMSTERDAM · SAT 18 OCT                eyebrow 12px │
│ €45.00                                     display 40px │
│ 2 people · Max · [VIP]                     text-dim 15  │
│ Set by the door host                       text-faint 12│
│ ┌ bg-elev rounded-[20px] border-line ───────────────┐   │
│ │ 2 × Guest list                       €40.00       │   │
│ │ Service fee                           €5.00       │   │
│ │ Total                                €45.00       │   │
│ └───────────────────────────────────────────────────┘   │
│ [ Pay €45.00 ]                              primary 52  │
│ iDEAL · Apple Pay · Google Pay · card       text-dim 13 │
│ Secure checkout by Stripe · incl. VAT       text-dim 13 │
│ No ticket. Show this screen or your name at the door.   │
│ LandingFooter (PlusOne · Terms · Privacy)               │
└─────────────────────────────────────────────────────────┘
```

Herbeoordeling 9/10: hiërarchie en primaire actie per oppervlak staan; open blijven de chip-states op de deurrij (Pass 5) en de cockpit-variant (Pass 6).

### 12.2 Pass 2 — Interaction states: 5/10 → 9/10

De tabel in §10.19 miste offline, noodrem, al betaald, verwijderde rij, sessieverloop, "nog niet gesynchroniseerd", deelbetaling en de bron van de succes-state; de foutstates kopieerden niet het anti-enumeratiegedrag van `/r/[token]`. Besluiten (Max, 2026-10-13, alle = A): **D4.1** `/pay`-fouten neutraal behalve de noodrem; **D4.2** offline-regel in de sheet + online pauze-detectie; **D4.3** betaalde aantallen in status en knoplabels, sessieverloop onzichtbaar voor de gast; **D4.4** `Paid` alleen na serververificatie, nooit op een query-parameter.

Statetabel (wat de gebruiker ZIET; Engelse copy conform `copy-deck.md` §2 "knipoog nul"):

```
FEATURE / STATE          | WAT DE GEBRUIKER ZIET
-------------------------|------------------------------------------------------------------
Charge-sheet · loading   | QR-tegel als skeleton (bg-elev2) — komt vrijwel nooit voor: token zit in de snapshot
Charge-sheet · empty     | tier zonder prijs of payments uit: geen Charge-knop, bar van vandaag
Charge-sheet · no token  | rij nog niet gesynct én geen client-token (oude rij): tegel met klok-icoon
                         | "Not available yet · syncing" + quiet "Try again"; cash en check-in blijven
Charge-sheet · offline   | statusregel `Offline · payment confirms at next sync` (OfflineChip-stijl);
                         | QR normaal; primaire knop `Check in 2 · not confirmed yet`
Charge-sheet · paused    | online + 503 van de status-poll: `Online payment paused · cash or check in`,
                         | QR opacity .4; cash/check-in ongewijzigd (offline toestel: niet detecteerbaar — geaccepteerd)
Charge-sheet · waiting   | `● Waiting for payment…` (SyncDot, geen spinner, geen timer); knop live vanaf t = 0
Charge-sheet · success   | regel flipt naar `✓ Paid · 2 people` (text-acc, translateY-entrance);
                         | knop `Check in 2 · paid`
Charge-sheet · partial   | `Paid ✓ · 1 of 2`; primair `Check in 1 · paid`; secundair `Check in 2 · 1 not confirmed`
Charge-sheet · k changed | CountStepper wijzigt k → QR hertekent met nieuwe URL (?heads=k), bedrag = ticket × k (lokaal; geen fee-engine nodig,
                         | de organisatiekant toont alleen ticketbedragen, 12.0 regel 2); open sessie met andere k wordt server-side verlopen (eng D2)
Charge-sheet · cash      | ghost `Cash · €45.00 to collect` (cash_fee_mode 'fee') of `Cash · €40.00` ('none')
                         | → ConfirmSheet (D10.4) → toast `Cash · 2 people`
Charge-sheet · error     | outbox/replay-fout: bestaande SyncBar-foutpad; sheet toont niets extra's
Deurrij-chip             | zie Pass 5 (drie states: te betalen / deels betaald / geen chip)
-------------------------|------------------------------------------------------------------
/pay · loading           | pagina rendert server-side met bedrag; geen spinner vóór de sessie (sessie pas bij Pay-tik, Pass 7)
/pay · not synced        | klok-tegel (62px, bg-elev2) "Almost there" + "Your spot is being synced." —
                         | poll elke 3 s, max 60 s, dan "Ask the door host to try again."
/pay · 404/410/429/      | identiek en neutraal: tegel + `Nothing here.` (statusNotFoundTitle) + "Pay at the door."
      removed/refused    | (zelfde regel als request-status.tsx:48–61; geen onderscheid, geen uitleg)
/pay · 503 kill switch   | enige onderscheiden fout: "Online payment is paused." + "Pay at the door."
/pay · cap lowered       | k boven het plafond → pagina toont het nieuwe aantal vóór betalen met één regel
                         | "2 of your 3 spots are still open." (beide varianten: aantal als tekst, geen control)
/pay · already paid      | "Already paid · 2 people." + "Show this at the door." (zelfde succes-frame)
/pay · checking          | na redirect: tegel + "Checking payment…" ≤ 5 s → valt terug op "Almost there"-poll
/pay · success           | ALLEEN na serverlezing van entry_payments.status / sessie-status (nooit ?success):
                         | bg-acc check-tegel, "Paid · 2 people · 23:41", body per herkomst (Pass 3)
/pay · session expired   | onzichtbaar: dezelfde pagina; Pay maakt een nieuwe sessie (expire-and-recreate)
/pay · error (5xx)       | neutrale fout "Something went wrong. Pay at the door." + retry-knop
-------------------------|------------------------------------------------------------------
Settings → Payments      | loading skeleton · empty "Payments are off" + één alinea type 3 + `Turn on` (admin/finance)
  (licht)                | · error: FormError inline · success: saldo + laatste weekstaat als Row · partial: mandaat
                         | ontbreekt → primaire knop vervangen door RefusedAction met reden
Platform-tab (licht)     | loading skeleton · empty "No open items" (Empty) · error inline · success: run approved →
                         | payout-regel · partial: reserve-tekort → run blijft draft met bedrag; needs_refund als Row-lijst
```

Herbeoordeling 9/10: elke state heeft een uitweg naar de deur; open blijft alleen de mandaat-flow in Settings (Pass 7, licht).

### 12.3 Pass 3 — User journey & emotionele boog: 5/10 → 9/10

Het plan had één journey-zin per actor. Gaten: de succes-copy sprak de deurregel tegen ("no need to screenshot" vs. "de gast toont zijn Betaald-scherm"), de Stripe-stap was de ene lichte, naamloze pagina in een donkere flow, en de walk-in-verkoop kostte drie bewegingen. Besluiten (Max, 2026-10-13, alle = A): **D5.1** twee succes-varianten naar herkomst (deur-QR met `?heads=k`: "Show this to the door host."; maillink: "You're on the list." + bestaande `successInfo` + "Receipt sent to m•••@…"); **D5.2** Checkout-branding in het Stripe-dashboard (logo, accent `#B5A6FF`, donkere achtergrond), regelitem `LOFI Amsterdam · Sat 18 Oct · Guest list · 2 people`, statement-descriptor-suffix met de venue (`PLUSONE* LOFI`, ≤ 22 tekens totaal), bon-mail noemt venue + event als eerste regel — P2-acceptatie-eis, naast de test-mode-checklist (T23); **D5.3** `AddOnSpot` op een betaalbare tier opent de GuestDetail met de Charge-sheet al open (k = 1 + N).

Storyboard (5 s visceraal · 5 min gedrag · 5 jaar reflectief):

```
STAP | ACTOR    | DOET                                   | VOELT                    | PLAN SPECIFICEERT
-----|----------|----------------------------------------|--------------------------|------------------------------------------
 1   | doorhost | opent rij, ziet "€20.00 pp · 0 of 2 paid" | weet wat te innen         | live regel i.p.v. banner (D3.3)
 2   | doorhost | tikt Charge · €40.00 · 2                 | één tik, geen vraag       | primair in de bar; k default (Pass 7)
 3   | doorhost | draait telefoon naar de gast            | bedrag + QR groot genoeg  | 34px bedrag, 240px witte QR-tegel (D3.1, Pass 5)
 4   | gast     | scant, ziet €45.00 bij LOFI            | "juiste plek, juist bedrag" | bedrag als H1, venue eyebrow (D3.4)
 5   | gast     | tikt Pay → Stripe (donker, LOFI-regel)  | herkent de naam           | branding + regelitem (D5.2)
 6   | gast     | Apple Pay / iDEAL, terug op /pay        | "klaar"                   | Checking… ≤ 5 s → Paid (D4.4)
 7   | doorhost | ziet label flippen naar "Check in 2 · paid" | nooit gewacht          | live knop, geen timer (D3.2)
 7b  | doorhost | offline / webhook traag: gast toont scherm | geen discussie          | "Show this to the door host." (D5.1)
 8   | doorhost | tikt Check in 2 · paid                  | af                        | outbox-write zoals vandaag
 9   | walk-in  | Add on the spot → sheet opent direct    | verkoop in één beweging   | D5.3
10   | gast     | 5 min: bon-mail "LOFI · Sat 18 Oct"     | bewijs in de inbox        | payment_receipt (T17), venue eerst
11   | gast     | weken later: afschrift "PLUSONE* LOFI"  | geen verrassing, geen dispute | descriptor-suffix (D5.2)
12   | admin    | weekstaat klopt op de cent              | vertrouwen in PlusOne     | P4a (licht in deze review)
```

Breekpunten die blijven: de gast heeft netwerk nodig (festival-gate meet apart, design-doc premisse 7); een offline toestel plus noodrem is op het toestel onzichtbaar (D4.2, geaccepteerd).

Herbeoordeling 9/10.

### 12.4 Pass 4 — AI-slop-risico: 6/10 → 9/10

Classificatie: Charge-sheet, GuestDetail, Settings → Payments en Platform-tab = **OPERATE** (app-UI-regels); `/pay/[token]` = publieke transactiepagina (operate: de gast rondt één taak af). Hard-rejection-check: generiek kaartgrid nee; gestapelde kaarten als UI — risico in Settings/Platform (hieronder weggenomen); kop zonder actie nee (bedrag + Pay); herhaalde stemming nee; carrousel nee; **onthemed browser surface** (standaard Stripe Checkout) → opgelost met D5.2; **klein laag-contrast type** (fee-regel) → `--dim` ≥ 13px (D3.4). Litmus na de besluiten: merk herkenbaar JA (sheet: kit-tokens; `/pay`: de venue is het merk, PlusOne in de footer) · één anker JA (het bedrag) · scanbaar op koppen JA (bedrag, QR, knop) · één taak per sectie JA (cash en override zijn eigen sheets) · kaarten nodig JA (alleen de QR-tegel en het bedragblok) · beweging verbetert hiërarchie JA (alleen de paid-flip, D6.2) · premium zonder schaduwen JA.

Besluiten (Max, 2026-10-13):
- **D6.1 = A, met aanvulling van Max:** Settings → Payments en de Platform-tab krijgen de vorm van `billing.tsx` (`Top`, één display-getal, `Label` + `Row`-lijsten), geen StatTile-grid. **Max' eis voor Settings → Payments (bindend voor P4a):** bovenaan moet in één blik staan (1) **wanneer de eerstvolgende uitbetaling is**, (2) **welk bedrag wordt uitbetaald** en (3) **hoeveel de kosten zijn** die ervan afgaan — als consolidatie: geïnde ticketbedragen − refunds/chargebacks − verrekend abonnement = uitbetaling (het "uitbetalingsdocument" dat overblijft). **Regel 2 uit 12.0 geldt hier:** PlusOne's servicefee is geen kostenpost van de organisatie en staat nergens in dit scherm; een eventuele kickback zit in het uitbetaalde bedrag maar wordt in de app nooit als regel getoond, alleen op de documenten. Daaronder **alle financiële documenten onder elkaar** (weekstaat, self-billing-inkoopfactuur, uitbetalingsdocument, later bonnen/creditnota's), elk **in PDF te bekijken én te downloaden** in de app — via de kit-helpers `openExternal()`/`downloadFile()` (native shell: Capacitor-browser; nooit `target="_blank"`). Wireframe:

```
┌ Top: Payments ─────────────────────────────────────────────┐
│ NEXT PAYOUT · MON 20 OCT                        Label      │
│ €1,284.50                                       display 34 │
│ collected €1,420.00 · refunds −€40.00 · subscription −€95.50│
│ (text-dim 13.5; tabular-nums)                              │
│ DOCUMENTS                                       Label      │
│ Row  Weekly statement · 13–19 Oct        [view] [download] │
│ Row  Self-billing invoice · SB-2026-0042 [view] [download] │
│ Row  Payout statement · 20 Oct           [view] [download] │
│ SETTINGS                                        Label      │
│ Row  Mandate · signed 2 Oct by Max                   chev   │
│ ToggleRow  Cash at the door   (géén fee-regel: D11.1)      │
└────────────────────────────────────────────────────────────┘
```
  De document-engine zelf (nummering, issuer-entiteit) blijft P4a/P4b; deze review legt alleen vast wat de admin ziet en dat elk document bekeken én gedownload kan worden.
- **D6.2 = A:** precies één bewegingsmoment: bij bevestiging schuift de statusregel `✓ Paid · 2 people` in met `translateY(6px→0)` 180 ms ease-out (bestaande `po-anim-*`-klasse), het knoplabel wisselt zonder animatie; de wacht-dot is statisch (`SyncDot`, geen pulse); de `/pay`-succes-tegel gebruikt dezelfde entrance; niets anders beweegt; alles achter `prefers-reduced-motion`.

Herbeoordeling 9/10: geen hard rejections meer; open blijft de visuele uitwerking van het documentenblok (P4a).

### 12.5 Pass 5 — Design-system-alignment: 6/10 → 9/10

Het plan verwees naar `design-system.md` en "de bestaande deur-sheets", maar legde geen tokens, componenten of maten vast; "groot QR" en "badge op de rij" waren geen spec; de geldnotatie was impliciet NL terwijl de UI Engels is. Besluiten (Max, 2026-10-13, alle = A): **D7.1** `PayChip` wordt één kit-chip met drie states; **D7.2** `QrTile` als kit-primitive (SVG, offline gerenderd); **D7.3** `formatMoney(cents)` → `€52.50`, altijd twee decimalen.

Token- en componentmapping (één vocabulaire met `design-system.md`; nieuwe primitives landen in `kit.tsx` in dezelfde PR, CLAUDE.md "New UI primitive → kit.tsx"):

```
ELEMENT                     | COMPONENT / TOKEN                                   | NIEUW?
----------------------------|-----------------------------------------------------|-----------------------------
Charge-sheet container      | shell `Sheet` (center=false, max-w 560, rounded-sheet, bg-elev, border-line) | nee
Kop-label "CHARGE · naam"   | kit `Label` (12px 700 uppercase, --faint) + `TierChip` (door) | nee
Bedrag                      | font-display 34px 800 tracking -0.02em text-text, tabular-nums | nee (formatMoney nieuw)
Sub "2 people · €20.00 each"| text-[13.5px] text-dim (ticketprijs, nooit de fee)   | nee
QR                          | kit `QrTile({ value, size: 240 | 320, ariaLabel })`: bg-white rounded-[20px] p-4, modules #0B0B0D, EC M, quiet zone 4 modules, SVG via `qrcode.toString({ type: 'svg' })`, memo op value, role="img" | JA (kit)
Methoden-regel              | text-[12px] text-faint                              | nee
"Can't scan? Show link"     | kit `Btn kind="quiet"` 44px, icoon `link` → `CopyableField` in een tweede `Sheet` | nee
Hoofden-rij                 | kit `CountStepper` + `min` prop (vloer 1) + `hitArea44`-ring op touch (visueel 32px, hit 44px, `touch-density.test.ts`) | kit-uitbreiding (min)
Statusregel                 | kit `SyncDot` (statisch) + text-dim; paid: `Icon check2` + text-acc; aria-live="polite" | nee
Primaire knop               | kit `Btn kind="primary" full` 52px, icoon `check`; labels `Check in {k} · not confirmed yet` / `· paid` | nee
Cash                        | kit `Btn kind="ghost" full`, icoon `money`, label `Cash · €45.00 to collect` (cash_fee_mode 'fee') of `Cash · €40.00` ('none') → shell `ConfirmSheet` (icon money, confirm "Mark as paid") | nee
Organisatiekant-bedragen    | altijd ticket × hoofden via `formatMoney`; servicefee, ondergrens en kickback nooit in de app-UI van de organisatie (12.0 regel 2) | regel
Override (admin/organizer)  | kit `Btn kind="quiet"` "Let in free · reason" → `ConfirmSheet` met `TextArea` (reden verplicht) | nee
Offline/pauze-regel         | `OfflineChip`-stijl (bestaand) / text-dim met `Icon warn`  | nee
Deurrij-chip                | kit `PayChip({ state: 'due'|'partial'|'paid', amountCents, heads, paidHeads })`: due = border-dashed border-line text-text `€50 · 2`; partial = border-line text-dim `2/4 paid`; paid = geen chip; NOOIT bg-acc/text-acc | kit-uitbreiding (vervangt boolean)
GuestDetail live regel      | text-[13.5px] text-text; vervangt `payBanner` (GuestDetail.tsx:185–190) | nee
/pay-frame                  | `LandingWrap` + `LandingFooter` + `publicRouteViewport` (zoals /r) | nee
/pay eyebrow                | `Label`-stijl 12px --faint uppercase                 | nee
/pay bedrag H1              | font-display 40px 800 tracking -0.02em, tabular-nums | nee
/pay bedragblok             | bg-elev rounded-[20px] border-line p-4; rijen text-[15px] incl. de regel "Service fee" (alleen aan de gastkant); totaal font-display 20px | nee
/pay Pay-knop               | `Btn kind="primary" full` 52px                      | nee
/pay status-tegels          | 62px rounded-[20px] bg-elev2 / bg-acc (request-status.tsx-patroon) | nee
Settings → Payments         | `Top`, display 34px getal, `Label`, `Row` (chev / view / download), `ToggleRow`, `RefusedAction` | nee
Platform-lijsten            | `Row`-lijsten per subscherm, `Empty`                  | nee
Geldnotatie                 | `formatMoney(cents)` in `src/features/payments/format.ts` → `€52.50` (altijd 2 decimalen, geen spatie); billing houdt `formatPriceAmount` | JA (payments format.ts)
Copy                        | Engels, `copy-deck.md` §2 "knipoog nul"; nieuwe keys `t.door.pay.*` en `t.landing.pay.*` (geen Nederlandse strings uit §10.19 in code) | catalogus
```

Alle bedragen in dit hoofdstuk lezen als `€45.00` (D7.3). Nieuwe kleuren, fonts of radii: geen.

Herbeoordeling 9/10: open blijft alleen de visuele vorm van het documentenblok in Settings (P4a).

### 12.6 Pass 6 — Responsive & toegankelijkheid: 4/10 → 9/10

Het plan had één regel. Besluiten (Max, 2026-10-13, beide = A): **D8.1** één `ChargeSheet`-component met twee maten (outbox-deur: bottom-sheet, QR 240; cockpit: `Sheet center` 560px, QR 320, `Btn desktop`-dichtheid, Esc sluit, Enter = primaire knop; de cockpit-rij krijgt dezelfde `PayChip`; cash in de cockpit via de bestaande online check-in-actie, want de cockpit heeft geen outbox); **D8.2** het onderstaande blok is bindend en wordt een acceptatie-item in de P2-flow onder `tests/flows/`.

Viewport-matrix (chrome op 1024, content op `md:`, dichtheid op de pointer — `design-system.md` T1):

```
VIEWPORT                     | DEUR-VARIANT        | CHARGE-SHEET                              | /pay
-----------------------------|---------------------|-------------------------------------------|----------------------------------
390 telefoon (touch)         | outbox-deur         | bottom-sheet full-width, QR 240, 52px-knoppen | één kolom, px-4, Pay 52px
768–834 iPad portrait (touch)| outbox-deur         | Sheet max-w 560 gecentreerd, QR 320; GuestDetail in de 640-kolom | zelfde kolom, gecentreerd
1024–1366 iPad landscape     | outbox-deur         | zelfde 560-sheet; sidebar-chrome; 44px blijft (pointer: coarse) | n.v.t. (gast-telefoon)
  (touch, pointer: coarse)   |                     |                                           |
≥ 1024 desktop (muis)        | cockpit             | Sheet center 560, QR 320, Btn desktop, Esc/Enter | n.v.t.
```

Toegankelijkheid (bindend):
- **Tikdoelen:** elk control ≥ 44px op touch; `CountStepper` visueel 32px met `hitArea44`-ring; "Can't scan? Show link" als 44px-quiet-knop; Pay en check-in 52px. Guard: `tests/unit/touch-density.test.ts` + layout-suite.
- **Screenreader:** `QrTile` `role="img"` aria-label `Payment QR code · {first name} · {k} people · {amount}`; statusregel `aria-live="polite"` (zegt "Paid · 2 people" bij de flip); primaire knop draagt aantal én state in de tekst zelf; stepper-knoppen `aria-label` "Fewer people"/"More people", op de cap `aria-disabled` plus de zichtbare reden "2 of your 3 spots are still open."; `/pay` Pay-knop `aria-label` "Pay €52.50 for 2 people"; de succes-tegel kondigt zich aan via dezelfde live-region.
- **Toetsenbord (cockpit, /pay op desktop):** focus gaat bij openen de sheet in (eerste control) en keert bij sluiten terug naar de aanroepende knop; Esc sluit; Enter op de primaire knop; focusvolgorde `/pay`: stepper → Pay → link in de footer.
- **Contrast:** bedragen `text-text` op `bg-elev` (> 15:1); sub-regels `text-dim` (0,58 wit ≈ 7,5:1 op #161618); `text-faint` (0,40 ≈ 4,3:1 op #161618) alleen voor ≥ 12px bold uppercase labels en de methoden-regel, nooit voor body of bedragen; QR-modules #0B0B0D op wit.
- **Zoom en tekstgrootte:** `/pay` gebruikt `publicRouteViewport` (user-scalable, WCAG 1.4.4) zoals `/r`; body ≥ 16px; bedragen `tabular-nums`.
- **Reduced motion:** `prefers-reduced-motion` schakelt de paid-flip-entrance uit (opacity blijft altijd 1).
- **Licht/donker:** `/pay` is donker zoals `/r` (gebruiksscène: deuropening, nacht); een lichte variant voor de maillink overdag staat als TODO (zie 12.9), niet in v1.

Herbeoordeling 9/10: open blijft de lichte `/pay`-variant (bewust uitgesteld).

### 12.7 Pass 7 — Open ontwerpbeslissingen (register, ongescoord)

Alle onderstaande beslissingen zijn genomen (Max, 2026-10-13); de tabel noemt per besluit wat er zonder zou gebeuren.

```
BESLISSING                                        | BESLUIT                                                     | ANDERS WAS GEBEURD
--------------------------------------------------|-------------------------------------------------------------|--------------------------------------------
Aantal op /pay via de deur-QR                     | VAST: doorhost bepaalt k, gast kan niets wijzigen (Max, D9.1-correctie) | gast klikt tickets weg; deur weet niet wat betaald is
Aantal op /pay via de maillink                    | HERZIEN (Max, mockup-review 2026-10-13): geen keuze, de gast betaalt de hele plek (alle ongedekte hoofden); D10.1 = A vervallen | organisator weet niet met hoeveel iemand komt
Moment van de Checkout-sessie                     | D10.2 = A: pas bij de Pay-tik ("Opening checkout…" ≤ 2 s); pagina rendert server-side zonder sessie | elke open van de link reserveert 30 min hoofden
Wat de organisatiekant aan bedragen ziet          | Max (D9.3-correctie): alleen ticketbedragen; fee/kickback alleen op documenten | onze marge zichtbaar in Settings en op de deur
Cash: met of zonder onze servicefee               | Max (D10.3): per company instelbaar, `cash_fee_mode` 'fee' | 'none'; bij 'fee' toont de Cash-knop het te innen totaal | óf fee uit eigen zak van de organisatie, óf gratis sluiproute
Wie zet fee-instellingen (ophoging, cash-fee)     | D11.1 = A: platform-admin in de Platform-tab via `set_company_fee_settings` (is_platform_admin(), geaudit); Settings toont alleen de cash-schakelaar | company ziet ondergrens en kickback in Settings
Cash-stap                                         | D10.4 = A: ConfirmSheet "Cash received · €… / 2 people / Mark as paid", vast serverbedrag, geen wisselgeld, geen vrij veld | kassascherm met vrij bedrag
Override                                          | D9.2 = A: alleen gerenderd voor admin/organizer als quiet-knop "Let in free · reason" → ConfirmSheet met verplichte reden | doorhost haalt een admin midden in de rij
Default hoofden + snapshot-velden                 | D9.4 = A: k = max(1, outside − paidHeads − openHeads), cap idem; model/snapshot krijgt doorPriceCents, paidHeads, openHeads, payToken (raw, alleen op het toestel), cashFeeMode; CountStepper krijgt min | default 1, extra tik per groep; velden verzonnen tijdens de bouw
"Check in one at a time" op een betaalbare rij    | D11.2 = A: blijft; elke tik boekt "not confirmed yet" + toast; chip toont deelstatus | verborgen sluiproute of gedragsbreuk
Mandaat-stap en Platform-lijsten (licht)          | D11.3 = A: defaults als P4a-startpunt — mandaat = ConfirmSheet + ConsentCheck + "Sign mandate", actor + tijdstip, Row "Mandate · signed 2 Oct by Max", zonder mandaat RefusedAction; Platform: per zorg een Row-lijst, needs_refund met "Open in Stripe" (openExternal) en automatisch "resolved" na charge.refunded; /plan-design-review opnieuw bij P4a | ad-hoc modal en een "dashboard"
Lichte /pay-variant overdag                       | D11.4 = A: TODOS.md, P3, trigger maillink-afhaak > 10 % | niet genoteerd
```

Gevolgen voor eerdere teksten (verwerkt in deze PR): design-doc "Bindende regels" (QR-regel: gast kan k niet wijzigen via de deur; sessie bij Pay-tik; fee-configuratie door platform-admin; cash-fee per company; "online wacht de deur eerst tot 10 s" → gratie op de uitkomst), plan §10.19:701 (vervangen door §12), §11 D2-tekst "sessie bij openen" → bij Pay-tik (expire-and-recreate blijft), eng T20 (de TS-fee-engine is voor de deur niet meer nodig: de organisatiekant toont ticket × k; `/pay` leest het gastbedrag server-side uit dezelfde SQL `payment_amount_for`, dus T20 krimpt tot één contracttest op dat pad), spec #62 (nieuw sub-item m).

### 12.8 NOT in scope (design)

- **Settings → Payments en Platform-tab als wireframe:** alleen vorm (billing.tsx-patroon), Max' consolidatie-eis (12.4) en de P4a-defaults (12.7); de designronde volgt bij P4a zodra jurist/accountant de mandaattekst en de documenten hebben bevestigd.
- **Refund-UI voor admin/finance** (lijst + ConfirmSheet met de twee opties ticket-only / alles): P2-geld, niet ontworpen in deze ronde; volgt dezelfde ConfirmSheet-vorm.
- **Dispute-bewijs-UI** in de Platform-tab: P2-acceptatie-eis op de webhook, UI = Row-lijst; geen eigen ontwerp.
- **Bon- en document-PDF's** (document-engine): P4a/P4b; alleen de regel "venue + event als eerste regel" (D5.2) en "bekijken én downloaden in de app" (12.4) zijn vastgelegd.
- **Tap to Pay-UI** (P3a/P3b): volgt het entitlement; de Charge-sheet krijgt daar een derde knop/pad, niet nu ontworpen.
- **Open shop** (P2b) en **lichte publieke pagina's** (TODO, D11.4).

### 12.9 What already exists (hergebruik)

`Sheet`/`ConfirmSheet`/`BottomBar` (`shell.tsx`), `GuestDetail` check-in-BottomBar (group-first, `CountPill`), `Stepper`/`CountStepper`, `PayChip` (wordt uitgebreid), `TierChip`, `SyncDot`/`OfflineChip`, `Label`/`Row`/`ToggleRow`/`Note`/`Empty`/`RefusedAction`/`ConsentCheck`/`CopyableField`, `openExternal()`/`downloadFile()`, `hitArea44`, `LandingWrap`/`LandingFooter`/`publicRouteViewport` en het not-found-patroon van `request-status.tsx`, `billing.tsx` als Settings-subscherm, Platform-tab `Row`-navigatie, `qrcode` (dependency), `formatPriceAmount` (blijft voor abonnementen), copy-deck §2 strings (`successInfo`, `statusNotFoundTitle`), de tokens en breakpoints uit `design-system.md`.

### 12.10 TODOS.md

Eén voorstel, door Max geaccepteerd (D11.4 = A): lichte variant van `/pay` en `/r` achter `prefers-color-scheme` — P3, trigger: maillink-afhaak > 10 % in de eerste-euro-meting. Toegevoegd aan `TODOS.md` onder "Payments (Fase 14)".

### 12.11 Implementation Tasks (design)

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship. T1–T25 blijven (§10.26, §11.17); hieronder de design-aanvullingen en -correcties (ratio-aanname: features ~30×, tests ~50×).

- [ ] **T20 (correctie, P1)** — de TS-fee-engine is voor de deur niet meer nodig (organisatiekant toont ticket × k, 12.0 regel 2); `/pay` leest het gastbedrag server-side via `payment_amount_for`; T20 krimpt tot de contracttest op dat ene pad (RPC-output ≡ wat de pagina toont).
- [ ] **T26 (P1, human: ~2d / CC: ~45min)** — deur — `ChargeSheet` (één component, `size: 'phone' | 'wide'`): bedrag → `QrTile` → `CountStepper` → statusregel (`aria-live`) → BottomBar (`Check in k · not confirmed yet / paid`, Cash-ghost, admin-only "Let in free"); Charge als primaire knop op een betaalbare rij; `payBanner` → live regel; `AddOnSpot` opent de sheet op een betaalbare tier; cockpit-dialoog via `Sheet center` 560.
  - Surfaced by: 12.1 D3.1–D3.3, 12.2, 12.3 D5.3, 12.6 D8.1, 12.7 D9.2/D9.4/D10.4/D11.2
  - Files: `src/features/door/components/ChargeSheet.tsx` (nieuw), `GuestDetail.tsx`, `AddOnSpot.tsx`, `CheckInList.tsx`, `src/features/po/eventday/EventDayCockpit.tsx`, `src/lib/i18n/surfaces/door.ts` (`t.door.pay.*`)
  - Verify: `pnpm qa:flows door-charge` (Q1–Q12), `pnpm vitest run src/features/door`, `door-render-isolation.test.tsx` groen
- [ ] **T27 (P1, human: ~1d / CC: ~20min)** — kit — `PayChip` met drie states (`due | partial | paid`, nooit accent), `QrTile` (SVG via `qrcode.toString`, wit, #0B0B0D, EC M, quiet zone 4, 240/320, `role="img"`), `CountStepper` `min` + `hitArea44`, `formatMoney(cents)` in `src/features/payments/format.ts` (`€52.50`, tabular-nums).
  - Surfaced by: 12.5 D7.1–D7.3
  - Files: `src/components/po/kit.tsx`, `src/components/po/kit.tap-target.test.tsx`, `src/features/payments/format.ts` + test
  - Verify: `pnpm vitest run src/components/po tests/unit/touch-density.test.ts`
- [ ] **T28 (P1, human: ~1d / CC: ~20min)** — deurmodel/snapshot — `doorPriceCents`, `paidHeads`, `openHeads`, `payToken` (raw, alleen op het toestel), `cashFeeMode` in `model.ts` + expliciete kolomlijst (hoort bij T8); `pay: boolean` wordt afgeleid; default k = max(1, outside − paid − open).
  - Surfaced by: 12.7 D9.4
  - Files: `src/features/door/model.ts`, `queries.ts`, `offline/persister.ts`, `sync/useDoorSync.ts`
  - Verify: vitest op de adapter; `DOOR_CACHE_BUSTER` bump (T8)
- [ ] **T29 (P1, human: ~2d / CC: ~45min)** — `/pay/[token]` — server-gerenderde pagina (RPC `get_pay_page`, SECURITY DEFINER, zelfde throttle als `get_request_status`, minimale payload: voornaam, venue, event, tier, ticket × k, servicefee, totaal, gedekt/plafond, status); deur-variant (`?heads=k`) en maillink-variant (k = alle ongedekte hoofden, server-side), beide zonder aantal-control; sessie-RPC pas bij Pay; states uit 12.2 (neutraal not-found, 503 apart, Almost-there-poll ≤ 60 s, already-paid, checking ≤ 5 s); succes alleen na serverlezing, copy per herkomst; `publicRouteViewport`.
  - Surfaced by: 12.1 D3.4, 12.2 D4.1/D4.3/D4.4, 12.3 D5.1, 12.7 D10.1/D10.2 + Max' regel 1
  - Files: `src/app/pay/[token]/page.tsx`, `src/components/po/pay-page.tsx`, `src/lib/i18n/surfaces/landing.ts` (`t.landing.pay.*`), migratie `get_pay_page` + pgTAP (throttle, neutrale output voor ongeldig/verwijderd)
  - Verify: `pnpm qa:flows pay-page` (Q1–Q10), pgTAP, `tests/e2e/layout` entry voor `/pay`
- [ ] **T30 (P1, human: ~1d / CC: ~25min)** — fee-instellingen platform-admin — `cash_fee_mode` ('fee' | 'none', default 'fee') naast `service_fee_fixed_cents`/`service_fee_bp` op `company_payout_accounts`; `set_company_fee_settings` (`is_platform_admin()`, geaudit); geen UPDATE-grant voor `authenticated` op die kolommen; Platform-tab company-scherm: drie `Row`s; Settings → Payments: alleen `ToggleRow Cash at the door`; `payment_amount_for` leest `cash_fee_mode` voor cash.
  - Surfaced by: 12.7 D11.1 + Max' regel 2 + D10.3
  - Files: migratie, `supabase/tests/database/company_fee_settings.test.sql` (allowed/denied), `src/components/po/screens/platform-company.tsx`, `src/components/po/screens/settings/payments.tsx` (nieuw)
  - Verify: `pnpm db:test -- …company_fee_settings.test.sql`; grant-matrix-test
- [ ] **T31 (P2, human: ~2h / CC: ~10min)** — Stripe-stap — Checkout-branding (dashboard), regelitem `{venue} · {datum} · Guest list · {k} people`, `statement_descriptor_suffix` met venue (≤ 22 tekens totaal, afkappen), bon-mail venue + event eerst; opnemen in de test-mode-checklist (T23).
  - Surfaced by: 12.3 D5.2
  - Files: `src/features/payments/stripe-adapter.ts`, `src/features/mail/` template, `docs/runbook.md`
  - Verify: test-mode-sessie toont venue in regelitem en descriptor; fixture-test op de sessie-parameters
- [ ] **T32 (P2, human: ~1d / CC: ~20min)** — a11y + flows — aria-labels (QrTile, Pay-knop, stepper), `aria-live` statusregel, focus in/uit de sheet, Esc/Enter in de cockpit, reduced-motion; flows `door-charge` en `pay-page` met de Q-nummers uit de handoff; layout-suite-entries.
  - Surfaced by: 12.6 D8.2
  - Files: `tests/flows/door-charge.flow.ts`, `tests/flows/pay-page.flow.ts`, `tests/flows/flows.mjs`, `tests/e2e/layout/`
  - Verify: `pnpm qa:flows door-charge`, `pnpm qa:flows pay-page`, `pnpm e2e:layout`
- [ ] **T33 (P2 — P4a, human: ~2d / CC: ~45min)** — Settings → Payments — kopblok "next payout · bedrag · aftrek (refunds, chargebacks, abonnement)" als consolidatie zonder PlusOne-fee; documentenlijst (weekstaat, self-billing, uitbetalingsdocument) elk met view (`openExternal`) en download (`downloadFile`); mandaat via ConfirmSheet + ConsentCheck; `/plan-design-review` opnieuw op dit scherm vóór de bouw.
  - Surfaced by: 12.4 D6.1 (Max' eis), 12.7 D11.3
  - Files: `src/components/po/screens/settings/payments.tsx`, `src/features/po/hooks` (ledger-aggregaat), document-RPC's (P4a)
  - Verify: flow `settings-payments`; handoff-vragen op view/download in de native shell (geen `target="_blank"`)

_No new tasks from Pass 4 beyond T31/T33 (slop-regels zijn vastgelegd als vorm, niet als werk)._

JSONL-artefact: `jq` ontbreekt op deze machine → niet geschreven (waarschuwing: installeer jq voor `/autoplan`-aggregatie).

### 12.12 Approved Mockups

Geen designer-afbeeldingen (geen API-key). Wel een HTML-mockup uit `/design-html` (2026-10-13, plan-driven uit de wireframes in 12.1/12.4/12.6 + `design-system.md`; zelfstandig bestand met gevendorde Pretext, mock-QR), ter review door Max — pas goedgekeurd na zijn feedback (status: v1, 0 iteraties):

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Alle frames (A–K) | `C:/Users/Maxse/.gstack/projects/Max-Seffelaar-PlusOne/designs/door-payments-20261013/finalized.html` | één pagina met 11 frames: A GuestDetail betaalbare rij · B–E Charge-sheet (waiting / paid / partial / offline) · F–J `/pay` (deur-QR, maillink = hele plek zonder stepper (herzien 2026-10-13), paid, not found, 503) · K cockpit-dialoog | bedragen €20.00 ticket / €2.50 fee pp / 2 personen; organisatiekant zonder fee; `/pay` via deur-QR zonder aantal-keuze; één bewegingsmoment (tik op de statusregel in B); cockpit-dialoog = één kolom 560 breed met QR 320 (twee kolommen bleken op 560 te smal); serve met `python -m http.server 8765` in die map |

Metadata: `finalized.json` naast het bestand. Na Max' feedback: iteraties als surgical edits in hetzelfde bestand, daarna deze tabel bijwerken naar "approved".

### 12.13 Completion summary (design)

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | design-system.md aanwezig; UI-scope: Charge-sheet (deur + cockpit), /pay, Settings → Payments (licht), Platform-tab (licht) |
  | Step 0               | 5/10; focus D1 = A (deur + /pay zwaar, rest licht) |
  | Pass 1  (Info Arch)  | 4/10 → 9/10 after fixes                            |
  | Pass 2  (States)     | 5/10 → 9/10 after fixes                            |
  | Pass 3  (Journey)    | 5/10 → 9/10 after fixes                            |
  | Pass 4  (AI Slop)    | 6/10 → 9/10 after fixes                            |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                            |
  | Pass 6  (Responsive) | 4/10 → 9/10 after fixes                            |
  | Pass 7  (Decisions)  | 12 resolved, 0 deferred                            |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                                  |
  | What already exists  | written                                            |
  | TODOS.md updates     | 1 item proposed (accepted)                         |
  | Approved Mockups     | 0 generated, 0 approved (no API key; wireframes)   |
  | Decisions made       | 29 added to plan (26 option-besluiten + 3 productregels van Max) |
  | Decisions deferred   | 0                                                  |
  | Overall design score | 4/10 → 9/10                                        |
  +====================================================================+
```

Plan is design-complete (elke pass ≥ 8). Na implementatie: `/design-review` op de live schermen (Charge-sheet, `/pay`), en `/plan-design-review` opnieuw op Settings → Payments vóór P4a.

### 12.14 Unresolved decisions

Geen. Open **vragen** (P0: jurist, accountant, Stripe-meeting) blijven in het design-doc §Open Questions; de cash-fee-afspraak per company en de kickback-afspraken zijn commerciële keuzes per company, geen reviewbeslissingen.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | mode: HOLD SCOPE, 0 critical gaps (16 ledger rows approved, 15 tasks, 5 deferred items in TODOS.md; 2026-10-12, commit 6b2200f6) |
| Outside Review | codex (`/plan-ceo-review` + `/plan-eng-review` outside voice; `/plan-design-review` design voices) | Independent 2nd opinion | 4 | UNAVAILABLE | no completed external review: Codex not installed (CEO, Eng, Design); the design round got a native in-host Claude subagent cold read instead (`design-outside-voices`, issues_found, F1–F12 applied in §12) — native is not outside coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 51 issues (9 architecture, 6 code quality, 31 test gaps, 5 performance), 0 critical gaps, 0 unresolved; all mapped to tasks T1–T25 (mode FULL_REVIEW) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 4/10 → 9/10, 29 decisions (26 option decisions D3–D11 + 3 product rules from Max), 0 unresolved, 1 TODO; text wireframes (designer had no API key); 2026-10-13, commit 2655fa12 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** provider codex — phase plan-review unavailable twice (CEO 2026-10-12, Eng 2026-10-13: not installed; native fallback skipped, TaskOutput capability missing) and phase design unavailable (2026-10-13: not installed; a native in-host Claude subagent ran instead and is logged as `design-outside-voices` with `outside_status: unavailable`). No clean-review credit from any outside phase.
- **VERDICT:** CEO + DESIGN CLEARED; ENG ISSUES OPEN (mapped work, 0 critical gaps, 0 unresolved) — eng review required: re-run `/plan-eng-review` or `/review` on the P1 PR once T18 + Lane A exist. The design decisions in §12 (fixed head count on the door QR, session on the Pay tap, ticket-only amounts on the venue side, platform-admin fee settings, `cash_fee_mode`) touch eng tasks T2, T8, T20 and T26–T33 and must be part of that re-run.

NO UNRESOLVED DECISIONS
