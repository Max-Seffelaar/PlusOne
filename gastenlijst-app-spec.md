# Gastenlijst SaaS — Functionele & Technische Spec v1

*Status: concept op basis van requirements-sessie 12 juni 2026*

---

## 1. Productdefinitie

Multi-tenant SaaS voor gastenlijstbeheer bij venues (clubs, zalen, horeca). Honderden venues, tientallen evenementen per venue per maand, 50–150 gasten per evenement. Staat volledig los van ticketingsystemen. Kernwaarden: **fraudebestendigheid** (alles gelogd, eigenaar ziet alles), **snelheid aan de deur** (offline-tolerant inchecken) en **quota-beheer** (personeel krijgt een beperkt aantal gastenlijstplekken).

### Vastgestelde beslissingen

| # | Beslissing |
|---|---|
| 1 | SaaS, multi-tenant. Eén user kan bij meerdere venues werken (membership-model, geen aparte accounts). |
| 2 | Geen koppeling met ticketingsystemen **in de kernwerking** — de gastenlijst werkt altijd standalone. Datamigratie uit Excel/WhatsApp is nice-to-have, geen vereiste. *(Geamendeerd door #36: fase 3 voegt optionele read-only connectors toe.)* |
| 3 | Accounts en rollen worden beheerd door **Admin** en **User Manager**. Eén persoon kan meerdere rollen hebben. |
| 4 | Quota per persoon (default), tijdelijk verhoogbaar door Admin. Verhoging = aparte log-entry + expliciete goedkeuring. |
| 5 | Personeel kan vanuit de app **meer plekken aanvragen**; Admin keurt goed of wijst af. |
| 6 | Externe organisator = user-account waaraan een event wordt toegewezen. Ziet voor dat event alles: aantallen, rapportages én namen. |
| 7 | Finance ziet alles, inclusief namen ("geen geheimen"), maar read-only. |
| 8 | Gast-tiers werken als tickettypes per event: bijv. "VIP + fles op tafel", "2x VIP", "regular". Organisator definieert tiers zelf. |
| 9 | +1's mogen anoniem ("Jan +2"), maar meer data = beter → velden optioneel, niet verplicht. |
| 10 | Doorhost kan weigeren mét reden, en ter plekke toevoegen — maar alleen binnen eigen quotum. |
| 11 | Dubbel inchecken wordt voorkomen zolang er sync is. Bij offline devices is dubbele entry geaccepteerd risico; verantwoordelijkheid venue. Sync moet zo snel mogelijk zijn. |
| 12 | Landingpage = unieke link per event. Goedkeuring aanvragen door event-organisator én venue-admins. |
| 13 | Uitnodigingen worden niet vanuit de app verstuurd; alles leeft in de app. Deelbare link volstaat. |
| 14 | Offline: "trage 4G overleven" is de lat. Eventix-model: volledige lijst lokaal bij openen event, sync bij elke schermactivatie, zichtbare sync-status, force-sync mogelijk, waarschuwing bij >10 min geen sync. |
| 15 | Audit log = simpel en leesbaar: wie deed wat met welke gast, wanneer. Geen actieve alerting in v1. |
| 16 | AVG: best practices (bewaartermijnen, verwerkersovereenkomst, dataminimalisatie). |
| 17 | Barman ziet alleen eigen voortgang: "8 van 10 over voor dit event". Geen conversiestatistieken voor staff. |
| 18 | **Later:** permanente member-QR (wallet, Soho House-stijl) — fraudegevoeligheid vereist eigen ontwerp (roterende codes / foto). |
| 19 | **Niet bouwen:** no-show → quota-feedback, uitnodigingen versturen vanuit app. |
| 20 | **Authenticatie:** Supabase Auth, passwordless-first (e-mail OTP), invite-only accounts, verplichte MFA voor Admin/Finance, passkeys zodra Supabase-support stable is. Zie §5. |
| 21 | **Soft delete, nooit hard delete.** Gasten krijgen status `removed`; data blijft staan tot AVG-anonimisering, zodat het audit log altijd compleet is. |
| 22 | **Quota-semantiek:** "Jan +2" telt als 3 plekken. Verwijdering geeft de plek alleen terug zolang het event nog niet live is (anti-hergebruik-fraude). |
| 23 | **Lijst-lock:** een event-lijst kan vergrendeld worden (door Admin/organisator, typisch bij deuropening). Vergrendeld = staff kan niet meer muteren; alleen Admin, organisator en doorhost (binnen quotum, aan de deur) kunnen nog wijzigen. |
| 24 | **User ≠ venue.** Users bestaan los van venues/events en krijgen toegang via memberships en event-scopes. Verwijdering bij venue A raakt alleen die membership — toegang tot venue B of andere events blijft werken. E-mailadres wijzigt alleen de user zelf, nooit een venue-admin. |
| 25 | **Client-generated UUID's** voor alle entiteiten die offline kunnen ontstaan (gasten, check-ins, weigeringen). Vereiste voor de offline outbox; vanaf dag één in het schema. |
| 26 | **Eventdag ≠ kalenderdag.** Alle statistieken, quota en logs hangen aan het event, niet aan de kalenderdatum. Check-in om 01:00 hoort bij het event van zaterdagavond. |
| 27 | **Disambiguatie aan de deur:** gast-kaart toont altijd *toegevoegd door* + tier + laatste 4 cijfers telefoonnummer (indien bekend); zoeken is fuzzy en lokaal. |
| 28 | **Landingpage-bescherming:** rate limiting, dubbele-aanvraag-detectie, en de aanvraaglink is per event deactiveerbaar zonder het event te sluiten. |
| 29 | **Anonimisering:** na de bewaartermijn wordt een gast "Gast #X"; alle audit-log-entries blijven intact en verwijzen naar het geanonimiseerde record. |
| 30 | **Notificaties (mail/push) = fase 2.** MVP werkt met in-app-meldingen (badge bij openstaande quota-verzoeken en aanvragen). |
| 31 | **Landingpage-gasten vallen buiten persoonlijke quota** (wel binnen tier-max): een goedkeuring telt niet op het quotum van de goedkeurder. |
| 32 | **Billing: Stripe Billing-abonnementen, optioneel voor MVP.** Betaalmethoden: SEPA-incasso + iDEAL (geen creditcard als default). Stripe achter een eigen abstractielaag: de database kent alleen `subscriptions` met een status; Stripe is implementatiedetail, zodat een latere switch (bijv. Mollie bij groot volume) beperkt blijft tot de adapter. Customer portal, dunning en facturen via Stripe. |
| 33 | **Quick add: één slim invulveld i.p.v. een formulier.** Vrije tekst als "Juri Braakman +2" of "Juri Braakman VIP fles" wordt lokaal (deterministisch, offline-proof) geparseerd naar naam + plus_ones + tier. Tiers krijgen door de organisator beheerbare aliassen ("vip", "fles", "champagne"); lichte fuzzy-matching op aliassen. Live preview-chips tonen de interpretatie + quotum-impact vóór Enter. Drie gevallen: alleen naam = default-tier zonder vraag; herkende woorden = directe match; **onherkende extra woorden = inline vraag** ("'X' herken ik niet — bedoel je [tier A] · [Regular] · [hoort bij de naam]?") — nooit stilletjes naar Regular. Bulk-paste: meerdere regels (WhatsApp-lijst) plakken → previewtabel, twijfelregels geel gemarkeerd en per regel te bevestigen, de rest in één bevestiging door. |
| 34 | **Deurbetalingen (fase 2/3, geen MVP):** route A eerst — QR-betaling via Stripe Checkout (iDEAL/Apple Pay op de telefoon van de gast), werkt in de PWA zonder hardware; route B optioneel — Stripe Terminal smart reader via server-driven API; route C later — Tap to Pay op de telefoon van de doorhost, vereist een native schil (Capacitor) + Stripe Terminal SDK + Apple-goedkeuring. Voorbereiding nu beperkt tot: optionele `door_price` per tier, `entry_payments` als latere entiteit, en check-in-flow die een "betaling vereist"-status kan afdwingen. Geen architectuurwijziging nodig. |
| 35 | **Ops-module (fase 3-backlog):** taken & meldingen voor de eventavond (doorhost/floor manager/eigenaar): taak aanmaken ("backstage mixers"), urgentie, toewijzen, push-melding, afvinken — WhatsApp/porto-vervanger. Hergebruikt bestaande rollen, events, Realtime en push-infra; bewust ná het winnen van de gastenlijst-usecase. Porto-transcriptie + dashboard = toekomstvisie, apart traject (privacy/AVG). |
| 36 | **Ticketing-connectors (fase 3, read-only — amendeert #2):** per venue een OAuth/API-key-koppeling met ticketingplatforms (eerst Weeztix/Eventix en Stager — publieke API's; Ticketmaster/Paylogic alleen indien partnertoegang). Connector-framework met één interface + adapter per platform; keys versleuteld in Supabase Vault. Gesynchroniseerde events komen binnen als voorstellen die de admin activeert, nooit automatisch live. Plus fuzzy match gastenlijst ↔ ticketkopers: toevoeging van een naam die al een ticket heeft → directe melding aan de toevoeger + conflict-vlag in het audit log. AVG: alleen genormaliseerde naam + ordernummer opslaan, zelfde bewaartermijn/anonimisering als gastdata. |
| 37 | **Native apps zijn gepland, geen optie.** MVP draait als PWA in de browser; daarna gaat dezelfde codebase via een Capacitor-schil naar de App Store en Play Store (geen aparte native codebase). Ontgrendelt: betrouwbare push (FCM/APNs), Tap to Pay (#34 route C), store-aanwezigheid. Bouwregels vanaf dag één: geen browser-only API's zonder fallback (alles moet in een native webview werken), notificaties achter een abstractielaag (web-push ↔ native push als adapters), auth-flows en deep links webview-proof. |
| 38 | **Designsysteem = PLUSONE** (Claude Design handoff, bundle in `docs/design/`, samenvatting in `docs/design-system.md`). Bijna-zwart `#0B0B0D`, hoog contrast wit, één lavendel-accent `#B5A6FF`, Bricolage Grotesque + Hanken Grotesk, initialen-avatars, warme microcopy. Prototype is visuele bron van waarheid; bij conflict met de spec wint de spec. Werknaam product: **PLUSONE**. |
| 39 | **Deur-UX uit het design (MVP, fase 9):** ingecheckte gasten verdwijnen niet maar dimmen en zakken naar onderen achter een "AL BINNEN"-divider; toggle Beide/Onderweg/Ingecheckt. Gast-detail toont een **logboek** (toegevoegd door/wanneer, ingecheckt hoe laat/door wie — per-gast-weergave van het audit log). Notities met **prioriteitsvlag** triggeren een "Let op!"-popup die expliciet afgevinkt moet worden ("Gezien & opgepakt"); het afvinken wordt gelogd. **Taken-tab** met per-gast-opdrachten, prioriteit, tellers en badge zit in het MVP; losse taken zonder gast blijven ops-module fase 3 (#35). |
| 40 | **Onboarding & self-service venue-creatie.** **(a) Self-service venue-aanmaak:** iedere ingelogde user mag zelf een nieuwe venue/company aanmaken via een eenmalig aanmaakscherm (bedrijfsgegevens + AVG-bewaartermijn); na aanmaken is die user automatisch **Admin** van die venue. Heropent géén publieke signup — account-creatie blijft invite-only (#3/#20); self-service betreft alleen het *aanmaken van een venue* door een al-geauthenticeerde user. **(b) Platform super-admin:** een platform-rol (bóven de venue-rollen, = wij) die in **elke** venue alles kan uitvoeren. Gemodelleerd als globale vlag op de user (bv. `is_platform_admin`), afgedwongen in RLS (nooit via de service-role) en volledig in het audit log; géén zevende `venue_membership`-rol. Een super-admin kan bij het uitnodigen markeren dat de uitgenodigde na de eerste OTP-login direct in de venue-aanmaakflow belandt (bootstrap van een nieuwe venue-eigenaar). **(c) Abonnement per venue:** elke (zelf-)aangemaakte venue krijgt een eigen `subscriptions`-record met een nieuwe initiële **onboarding-status** ("bedrijfs-/facturatiegegevens nog in te vullen"); de owner laat **per venue** zijn gegevens achter voordat de venue actief wordt (exacte enum-waarde i.s.m. #32 in de billing-fase; `comped` blijft mogelijk voor pilots). **(d) Niet in MVP (backlog):** géén bevestiging naar landingpage-aanvragers (#30) en géén first-run/intro-schermen — we leunen op de sterke lege-staten in het bestaande design. |

---

## 2. Rollenmatrix

Rollen worden toegekend **per venue** (membership). Eén user kan per venue meerdere rollen hebben, en bij meerdere venues verschillende rollen.

| Capability | Admin | User Manager | Finance | Organisator (per event) | Staff (barman e.d.) | Doorhost |
|---|---|---|---|---|---|---|
| Venue-instellingen beheren | ✅ | — | — | — | — | — |
| Users uitnodigen / rollen toekennen | ✅ | ✅ | — | — | — | — |
| Quota instellen & verhogen | ✅ | — | — | — | — | — |
| Quota-verzoeken goedkeuren | ✅ | — | — | — | — | — |
| Events aanmaken | ✅ | — | — | — | — | — |
| Tiers definiëren (per toegewezen event) | ✅ | — | — | ✅ | — | — |
| Gasten toevoegen/wijzigen/verwijderen | ✅ | — | — | ✅ (eigen event) | ✅ (binnen quotum) | ✅ (binnen quotum) |
| Aanvragen via landingpage goedkeuren | ✅ | — | — | ✅ (eigen event) | — | — |
| Inchecken / weigeren | ✅ | — | — | ✅ (eigen event) | — | ✅ |
| Volledige gastenlijst inzien (alle namen) | ✅ | — | ✅ (read-only) | ✅ (eigen event) | alleen eigen gasten | ✅ (event-lijst) |
| Statistieken & rapportages | ✅ | — | ✅ | ✅ (eigen event) | alleen eigen quotum-stand | — |
| Audit log inzien | ✅ | — | ✅ | — | — | — |

Opmerkingen:
- **Quotum geldt per user, niet per rol.** Default-quotum op user-niveau, overschrijfbaar per event. Een doorhost die ter plekke toevoegt, trekt van zijn eigen quotum.
- **Organisator** is geen aparte accountsoort maar een gewone user met de rol `organizer` gescoped op één of meer events. Toegang vervalt logisch zodra het event is afgesloten (account blijft bestaan, scope verdwijnt).
- **Finance** is venue-breed read-only over alle events, inclusief namen en audit log.

---

## 3. Datamodel (entiteiten)

```
users                 — auth-identiteit (Supabase Auth), naam, e-mail
                        (e-mail alleen door user zelf wijzigbaar — beslissing #24)
venues                — tenant; naam, slug, instellingen, AVG-bewaartermijn
venue_memberships     — user ↔ venue, roles[] (admin, user_manager, finance, staff, doorhost)
events                — venue, naam, datum, status (draft/open/live/closed),
                        landing_slug (unieke aanvraaglink), landing_active (bool),
                        list_locked (bool) + locked_by + locked_at — beslissing #23
event_organizers      — user ↔ event (externe of interne organisator-scope)
guest_tiers           — per event: naam ("VIP fles op tafel"), beschrijving, kleur,
                        max_aantal (optioneel), aliases (text[] voor de
                        quick-add parser — beslissing #33)
guests                — event, tier, naam, e-mail*, telefoon*, plus_ones (int),
                        note (tekst) + note_priority (none/low/high) +
                        note_acknowledged_by/at (— "Let op!"-flow, #39),
                        added_by (user), source (app / landing / door),
                        status (pending / approved / denied / checked_in /
                        refused / removed) — soft delete, beslissing #21,
                        anonymized_at (AVG, beslissing #29)
                        * optioneel — dataminimalisatie, maar invulbaar
guest_requests        — landingpage-aanvragen vóór goedkeuring: event, naam,
                        contactgegevens, motivatie, beslist_door, beslissing, reden
quotas                — user ↔ venue: default_aantal
event_quotas          — user ↔ event: override + verbruik (berekend uit guests;
                        1 + plus_ones per gast — beslissing #22)
quota_requests        — user vraagt X extra voor event Y; status, beslist_door,
                        beslissing, reden → eigen audit-entry
check_ins             — guest, checked_by, timestamp (server) + client_timestamp,
                        device_id, plus_ones_arrived (int), offline_synced (bool)
refusals              — guest, refused_by, reden, timestamp
audit_log             — actor, venue, event, entity_type, entity_id, action
                        (create/update/delete/check_in/refuse/quota_grant/…),
                        diff (before/after JSONB), timestamp, device_id
subscriptions         — venue ↔ plan: status (trialing/active/past_due/canceled),
                        plan_id, current_period_end, stripe_customer_id,
                        stripe_subscription_id — beslissing #32; de app leest
                        ALLEEN deze tabel voor toegang, nooit Stripe direct
fixed_members [later] — venue-leden met permanente toegang + QR/wallet-pass
entry_payments [later]— deurbetalingen per gast: bedrag, methode (qr/reader/
                        tap_to_pay), stripe_payment_intent_id, status — #34;
                        guest_tiers krijgt t.z.t. een optionele door_price
ops_tasks [later]     — avond-taken: event, titel, urgentie, toegewezen_aan,
                        status, push-melding — ops-module #35
ticket_integrations   — [later] venue ↔ platform (weeztix/stager/…): OAuth-tokens/
                        API-key versleuteld in Vault, sync-status — #36
external_events       — [later] opgehaalde events als voorstel: platform, externe
                        ID, naam, datum, status (proposed/linked/ignored) — #36
ticket_matches        — [later] fuzzy match gast ↔ ticketkoper: guest_id,
                        genormaliseerde naam, ordernummer, confidence,
                        conflict-vlag → audit log — #36
```

**Billing-abstractie (beslissing #32):** toegang van een venue hangt af van `subscriptions.status`, gevuld door Stripe-webhooks (checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted). Het schema en de toegangscheck worden in het MVP al meegebouwd (met een handmatige/`comped`-status zodat venues zonder billing live kunnen); de Stripe-koppeling zelf is fase 13.

**ID-strategie (beslissing #25):** alle primary keys zijn UUIDv7, gegenereerd op de client voor entiteiten die offline kunnen ontstaan (`guests`, `check_ins`, `refusals`). De offline outbox kan daardoor records aanmaken zonder server-roundtrip; sync is een idempotente upsert.

**Quota-handhaving (beslissing #22):** verbruik = som van (1 + plus_ones) over alle niet-`removed`/niet-`denied` gasten van die user voor dat event. Een verwijdering verlaagt het verbruik alleen zolang `events.status ≠ live` — daarna blijft de plek geteld, zodat toevoegen→binnenlaten→verwijderen→hergebruiken onmogelijk is.

*Implementatie (fase 7, migratie `20260613180000_quota_engine.sql`):*
- **Wie telt mee:** handhaving geldt alleen voor **staff** en **doorhost**. Admin (venue) en organisator (event) voegen toe zonder persoonlijke limiet — de rollenmatrix §2 geeft hun gast-schrijfrechten zonder "binnen quotum"-kwalificatie. Zij zijn *quota-exempt* en worden niet opgeteld.
- **Landingpage-gasten (#31):** `source = 'landing'` telt **niet** op het persoonlijke quotum (een goedkeuring belast de goedkeurder niet), **wel** op tier-max.
- **Live-regel deterministisch:** twee nieuwe kolommen — `events.went_live_at` (eenmalig gezet bij de eerste overgang naar `live`, nooit gewist) en `guests.removed_at` (gezet bij soft-delete). Een `removed` gast telt mee als `removed_at >= went_live_at`. Beide gebruiken `clock_timestamp()` (echte wandklok), zodat verwijderingen en go-live ook binnen één transactie correct geordend zijn.
- **Tier-max (#8):** `guest_tiers.max_guests` begrenst het aantal **gast-entries** in een tier (geen plekken/slots — kolomnaam is *guests*; tiers gedragen zich als tickettypes). `removed`/`denied` tellen niet mee; de live-regel geldt hier niet (tier-max is een lijst-capaciteitsgrens, geen anti-fraude-regel).
- **Afdwinging:** een `AFTER ROW`-trigger op `guests` blokkeert alleen een *netto verhoging* (insert, plus_ones omhoog, un-remove, tier-wissel naar een vollere tier). Verlagen/verwijderen mag altijd, ook als de user al over zijn limiet zit. Fouten: SQLSTATE `45001` (quotum vol), `45002` (tier vol).
- **Verzoekflow (#4/#5):** `quota_requests` krijgt een `motivation`-kolom. Goedkeuren loopt via `approve_quota_request(request_id)` (SECURITY DEFINER, her-checkt admin + AAL2): zet de `event_quotas`-override atomically op *huidig effectief quotum + gevraagde extra* en markeert het verzoek `approved`. Afwijzen = directe RLS-update met reden. Dubbele goedkeuring faalt met SQLSTATE `45003`.
- **UI-teller (#17):** `event_quota_status(event_id)` (caller-scoped RPC) levert quota/consumed/remaining/exempt voor "8 van 10 over".

**Aanvraagflow landingpage (beslissingen #12/#28/#31).** *Implementatie (fase 8, migraties `20260614100000_landing_request_flow.sql` + `20260614110000_landing_marketing_phone.sql`):*
- **Publieke route** `/e/[landing_slug]`: server-component die het event via de anon-RLS-grens ophaalt (`events_select_landing` geeft alleen een actief landing-event terug, met een vaste kolom-subset). Geen rij → één generieke "aanvragen gesloten"-pagina die onbekende én gedeactiveerde links identiek behandelt (**geen enumeratie**, #28).
- **Indienen** loopt via `submit_guest_request(slug, naam, e-mail, telefoon, +N, motivatie, ip_hash)` (SECURITY DEFINER, uitvoerbaar door `anon`). Het retourneert een grove status (`ok`/`rate_limited`/`closed`/`invalid`) die nooit verraadt of een gast/e-mail al bestaat. Bescherming: **rate limiting per IP** (vast venster, `landing_request_throttle`, gevoed met een in de app *gesalte* IP-hash zodat er geen herleidbare PII wordt opgeslagen), **stille dubbel-detectie** (partieel-unieke index op `(event_id, dedupe_key)` voor open aanvragen; een dubbele aanvraag levert dezelfde `ok` op), en een **honeypot**-veld dat de server-action stil laat slagen. RLS blijft de harde grens — dit is de misbruik-preventielaag erbovenop.
- **Goedkeuren** loopt via `approve_guest_request(request_id, tier_id)` (SECURITY DEFINER, her-checkt admin/organisator): maakt **atomically** de gast aan (`source = 'landing'`, `added_by` = de goedkeurder) én zet het verzoek op `approved`. Een volle tier (`45002`) rolt beide terug — het verzoek blijft `pending`. Landingpage-gasten vallen **buiten** het persoonlijke quotum van de goedkeurder (#31) maar tellen **wel** mee in de tier-max; de `enforce_guest_quota`-trigger handhaaft dat. Afwijzen met reden = directe RLS-update; een al-afgehandelde aanvraag faalt met `45003`.
- **Beslissingen worden geaudit:** een trigger op `guest_requests` (alleen bij statuswijziging, niet bij de anonieme indiening) logt **approve**/**deny**, naast de **create** op `guests` bij goedkeuring.
- **Telefoon mét landcode + toestemming (fase 8b):** het formulier verzamelt telefoon altijd als **E.164** (landcode-selector, default 🇳🇱 +31; "06 12 34 56 78" → `+31612345678`) met **inline-validatie** op e-mail én nummer; zonder geldige landcode/nummer wordt niet ingediend. Een opt-in **`guest_requests.marketing_opt_in`** legt expliciete AVG-toestemming vast om de gegevens voor marketing te gebruiken (#16) — default `false`, alleen `true` bij aanvinken. De E.164-telefoon reist mee naar de gast bij goedkeuring.

**Lijst-lock (beslissing #23):** bij `list_locked = true` weigert RLS alle mutaties op `guests` door users met alleen de staff-rol. Admin, organisator en doorhost (ter plekke, binnen quotum) behouden schrijfrechten. Lock/unlock is een eigen audit-actie.

**Event-statusmachine (`events.status`, uitwerking fase 6, migratie `20260613200000_event_management.sql`):** de status volgt een vaste machine `draft → open → live → closed`, in de database afgedwongen met een trigger (SQLSTATE `45004` bij een ongeldige overgang). Toegestane vooruit-overgangen (admin **én** organisator): draft→open (publiceren), draft→closed (concept laten vervallen), open→live (deur open), open→closed (annuleren vóór live), live→closed (afsluiten). Correctie-overgangen draaien terug en zijn **admin-only**: open→draft (depubliceren), live→open (live terugdraaien), closed→open (heropenen). Alle overige sprongen (bv. draft→live) worden geweigerd. `went_live_at` wordt bij de eerste overgang naar `live` gezet en blijft permanent — het voedt de quota-live-regel (#22), dus "live gaan" is bewust een gecontroleerde stap. De `landing_slug` wordt automatisch uit de naam gegenereerd wanneer hij leeg blijft (uniek gemaakt met een random suffix; een BEFORE-INSERT-trigger) en is daarna door admin/organisator aanpasbaar; `landing_active` is los van de status deactiveerbaar (#28). Tier-max (#8) wordt al door de quota-engine (#22, SQLSTATE `45002`) gehandhaafd.

**Anonimisering (beslissing #29):** een geplande job vervangt na de venue-bewaartermijn naam/e-mail/telefoon door `Gast #<volgnr>` en zet `anonymized_at`. Audit-log-entries blijven staan; de diffs van geanonimiseerde gasten worden mee-geschoond (namen eruit, structuur intact).

### Audit log: implementatie
Niet in applicatiecode, maar via **Postgres-triggers** op `guests`, `quotas`, `event_quotas`, `guest_tiers` en `check_ins`. Elke mutatie schrijft automatisch een rij met de oude en nieuwe waarden (JSONB-diff) en de `auth.uid()` van de actor. Voordelen: kan nooit omzeild worden, ook niet door een bug of een directe database-aanpassing, en kost geen extra applicatielogica. De log-weergave in de app vertaalt de diffs naar leesbare zinnen: *"Max heeft Juri verplaatst van Regular naar VIP — gisteren 22:14"*.

*Uitwerking (fase 3, uitgebreid in fase 8):* de trigger-set dekt naast bovenstaande tabellen ook `quota_requests`, `guest_requests` (fase 8, alleen de beslissing — niet de anonieme indiening), `refusals`, `venue_memberships` en de lock/unlock van `events`. Afgeleide acties: gast-status → `checked_in` = **check_in**, → `refused` = **refuse**, → `removed` = **delete** (soft delete, #21); tier-wijziging = **tier_change**; `list_locked` aan/uit = **lock**/**unlock**; quota-toekenning of -verhoging = **quota_grant**; beslissing op een quota- of landingpage-verzoek = **approve**/**deny**; overig = create/update/delete. De UPDATE-diff bevat alleen de gewijzigde velden (`updated_at` uitgezonderd); een UPDATE die niets wijzigt (idempotente outbox-replay, #25) logt niets. `device_id` komt uit de `x-device-id` request-header, anders uit een `device_id`-JWT-claim, anders uit het `device_id`-veld van de rij zelf (deur-apparaten). Het log is append-only: geen enkele app-rol (ook `service_role` niet) heeft INSERT/UPDATE/DELETE op `audit_log` — de SECURITY DEFINER-triggerfunctie is de enige schrijver; de latere AVG-schoning van diffs (#29) loopt via de table owner.

### Dubbel-incheck-preventie
`check_ins` krijgt een unique constraint op `guest_id`. Online: tweede device krijgt direct "al ingecheckt om 23:41 door Lisa". Offline: beide check-ins worden lokaal opgeslagen; bij sync wint de eerste (server-timestamp), de tweede wordt gemarkeerd als duplicaat en zichtbaar in het log. Geaccepteerd restrisico conform beslissing #11.

---

## 4. Techstack & sync-architectuur

| Laag | Keuze | Waarom |
|---|---|---|
| Frontend | **Next.js 15 (App Router) als PWA** | Eén codebase voor admin-dashboard én deur-app; installeerbaar op homescreen; geen app-store-frictie voor honderden venues. |
| Hosting | **Vercel, regio fra1 (Frankfurt)** | EU-hosting, edge-snelheid, jouw bekende workflow. |
| Database + Auth + Realtime | **Supabase (eu-west-1, Ierland)** | Postgres met Row Level Security voor multi-tenancy, triggers voor audit log, Realtime-subscriptions voor live check-in-status, EU + verwerkersovereenkomst standaard. *(Oorspronkelijk eu-central-1 Frankfurt; bestaand project in eu-west-1 akkoord bevonden 13-06-2026 — beide EU/AVG-conform.)* |
| Offline/cache | **TanStack Query + IndexedDB-persist** | Lijst lokaal beschikbaar, mutaties in een outbox-queue. |
| Realtime sync | **Supabase Realtime** op `guests` en `check_ins` per event | Meerdere doorhosts zien elkaars check-ins binnen ~1 sec. |

**Waarom geen Firebase:** Firestore's offline-cache is goed, maar het relationele rollen/quota/audit-model past slecht op een documentmodel, RLS-achtige security wordt complex in security rules, en de AVG-positie van Supabase-Frankfurt is eenvoudiger te verantwoorden richting venues.

### Sync-gedrag deur-app (Eventix-model)
1. **Event openen** → volledige gastenlijst + tiers + check-in-status worden gedownload en in IndexedDB gezet.
2. **Elke schermactivatie** (visibilitychange / focus) → delta-sync.
3. **Realtime-kanaal** actief zolang er verbinding is → check-ins van collega's verschijnen direct.
4. **Sync-statusbalk** permanent zichtbaar: groen "live", oranje "laatste sync 4 min geleden", rood + waarschuwing bij >10 min, altijd een **force-sync-knop**.
5. **Mutaties offline** (check-in, weigering, gast toevoegen) → lokale outbox, optimistische UI, automatische replay bij verbinding, conflicten gemarkeerd in audit log.
6. Zoeken en filteren gebeurt **altijd lokaal** — ook met perfecte verbinding. Zo is de deur-flow nooit afhankelijk van netwerklatentie.

---

## 5. Authenticatie & sessiebeheer

**Uitgangspunt: minimaal lek-oppervlak.** Geen wachtwoorden opslaan, geen extra auth-partij in de keten, autorisatie afgedwongen in de database.

### Keuze: Supabase Auth, passwordless-first

| Aspect | Beslissing | Rationale |
|---|---|---|
| Provider | **Supabase Auth** (geen Clerk/Auth0) | Zit al in de stack, draait in Frankfurt naast de database, sessie-tokens koppelen direct aan Row Level Security. Eén partij = één DPA = minder lek-oppervlak. |
| Primaire login | **E-mail OTP** (6-cijferige code) | Geen wachtwoord-hashes opgeslagen → niets te lekken, geen credential stuffing, geen wachtwoorddeling onder personeel. OTP werkt betrouwbaarder dan magic links in een PWA (verkeerde browser-context). |
| Registratie | **Invite-only** | Accounts worden uitsluitend aangemaakt via uitnodiging door Admin/User Manager. Geen open signup → geen fake accounts. |
| Admin & Finance | **Verplichte MFA (TOTP-app)** | Via Supabase native MFA. In RLS wordt afgedwongen (AAL2) dat quota-verhogingen, rolwijzigingen en audit-log-inzage alleen werken met een MFA-geverifieerde sessie. Gestolen mailbox alléén is dan niet genoeg. |
| Passkeys | **Roadmap, zodra stable** | Supabase passkeys zijn sinds mei 2026 in beta (experimentele API). Phishing-resistent einddoel; toevoegen is straks een uitbreiding, geen verbouwing. |

### Hardening
- **Korte sessie-tokens met refresh-rotatie** — een gestolen token is snel waardeloos.
- **Sessiebeheer-scherm voor Admins**: per user alle ingelogde devices zichtbaar + remote logout. Cruciaal als een doorhost zijn telefoon kwijtraakt op een eventavond.
- **Rate limiting** op OTP-aanvragen (anti-abuse en anti-enumeratie).
- **Service-role key nooit in de frontend**; alle client-toegang loopt via RLS.
- Persoonlijke logins op de deur-app, óók op een gedeeld venue-device — anders is het audit log waardeloos ("wie heeft ingecheckt?").

---

## 6. Schermen (high-level)

**Venue-dashboard (Admin / Finance):** eventoverzicht, userbeheer + rollen, quota-beheer, openstaande quota-verzoeken, audit log met filters (per event / per user / per gast), statistieken.

**Event-beheer (Admin / Organisator):** tiers definiëren, gastenlijst beheren, landingpage-link delen, aanvragen goedkeuren/afwijzen, live check-in-voortgang.

**Staff-view (barman):** quick-add-veld als hoofdinteractie ("Juri Braakman +2" → preview-chips → Enter), bulk-paste voor WhatsApp-lijsten, alleen "mijn gasten" voor dit event + quotumteller ("8 van 10 over") + knop "extra plekken aanvragen".

**Deur-app (Doorhost):** zoekbalk-first, grote tikdoelen, gast-kaart met tier-kleur en +N, swipe/tik om in te checken, weiger-flow met verplichte reden, ter-plekke-toevoegen (binnen quotum), sync-statusbalk.

**Landingpage (publiek):** per-event aanvraagformulier (naam verplicht, rest optioneel), bevestigingsscherm "je aanvraag is in behandeling".

**Statistieken:** check-ins per kwartier (instroomgrafiek), aanwezig vs. aangemeld per tier, no-shows, toevoegingen per user, weigeringen.

---

## 7. MVP-afbakening

### MVP (fase 1)
- Multi-venue accountstructuur met memberships en de zes rollen
- Auth: e-mail OTP, invite-only, MFA voor Admin/Finance, sessiebeheer + remote logout
- Events + zelf te definiëren gast-tiers
- Gastenlijst-CRUD met quota-handhaving en quota-verzoekflow
- Lijst-lock per event + in-app-meldingen (badges) voor openstaande verzoeken
- Landingpage per event + goedkeuringsflow (rate limiting, deactiveerbare link)
- Deur-app (PWA) met offline cache, outbox, realtime sync en sync-statusbalk
- Weigeren met reden, ter plekke toevoegen binnen quotum
- Audit log via database-triggers + leesbare log-weergave
- Basisstatistieken (instroom, aanwezig/aangemeld, per-user-toevoegingen)
- AVG-basis: bewaartermijn per venue instelbaar, automatische anonimisering van gastdata na X maanden, verwerkersovereenkomst-template
- Billing-voorbereiding: `subscriptions`-tabel + toegangscheck op status (venues draaien in MVP op handmatige/`comped`-status; geen Stripe-koppeling nodig om live te gaan)

### Fase 2
- Stripe Billing-integratie (beslissing #32): Checkout met SEPA-incasso + iDEAL, webhooks → subscriptions-status, customer portal, dunning
- Deurbetalingen route A (beslissing #34): QR-betaling via Stripe Checkout aan de deur, "betaling vereist"-status in check-in-flow
- Notificaties via e-mail en web-push (quota-verzoeken, aanvraag-goedkeuringen)
- Permanente member-lijst met QR in Apple/Google Wallet (roterende codes tegen screenshot-fraude — eigen ontwerptraject)
- Import-tools (Excel/CSV-mapping)
- Geavanceerde rapportages / export voor Finance
- Per-event-QR voor reguliere gasten op de aanvraagbevestiging

### Fase 3 (backlog)
- Native apps (beslissing #37): Capacitor-schil om de bestaande codebase → App Store + Play Store, native push via FCM/APNs, basis voor Tap to Pay
- Deurbetalingen route B/C (beslissing #34): Stripe Terminal smart reader (server-driven, werkt vanuit de PWA) en/of Tap to Pay op de telefoon van de doorhost (Capacitor-schil + Terminal SDK + Apple-goedkeuringstraject)
- Ops-module (beslissing #35): avond-taken met urgentie, toewijzing en push-meldingen voor doorhost/floor manager/eigenaar — WhatsApp/porto-vervanger
- Ticketing-connectors (beslissing #36): read-only event-sync via OAuth/API-key (eerst Weeztix/Eventix en Stager) + fuzzy match gastenlijst ↔ ticketkopers met conflict-vlag
- Toekomstvisie: porto-transcriptie + dashboard (apart traject, privacy/AVG-ontwerp vereist)

### Bewust niet
- Ticketing-integraties in de kernwerking (connectors zijn fase 3, zie #36)
- Uitnodigingen versturen (mail/WhatsApp) vanuit de app
- No-show → quota-feedback

---

## 8. Open punten voor de volgende sessie

1. **Pricing/packaging** — per venue per maand? Per event? Limieten per tier?
2. ~~**Onboarding-flow** — self-service signup voor venues of sales-assisted?~~ → **Opgelost in #40:** self-service venue-creatie door geauthenticeerde users + super-admin-invite die direct naar de venue-aanmaakflow leidt. Account-creatie blijft invite-only.
3. **Naam + domein** — werknaam is **PLUSONE** (uit het design, #38); domein nog te kiezen en naam definitief te bevestigen.
4. **Wie checkt +N's?** Nu: doorhost vult `plus_ones_arrived` in bij check-in. Akkoord?
5. **Branding per venue** op de landingpage (logo/kleuren) — MVP of fase 2?
