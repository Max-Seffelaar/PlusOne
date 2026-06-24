# Privacy & gegevensbescherming — PLUSONE Gastenlijst

> **Status:** aanzet / werkdocument. Dit is de inhoudelijke basis voor de
> **verwerkersovereenkomst** (art. 28 AVG) richting venues en voor ons
> verwerkingsregister (art. 30 AVG). Het is geen juridisch eindproduct — laat de
> definitieve verwerkersovereenkomst en sub-verwerkerslijst juridisch toetsen
> voordat ze aan venues worden voorgelegd.
>
> Verwijst naar beslissingen #16 (AVG-best-practices) en #29 (anonimisering) uit
> `gastenlijst-app-spec.md`, en naar de security-checklist in `CLAUDE.md`.

---

## 1. Rolverdeling onder de AVG

| Partij | Rol (AVG) | Toelichting |
|---|---|---|
| **De venue** (club/zaal) | **Verwerkingsverantwoordelijke** | Bepaalt doel en middelen: wie op de gastenlijst staat, welke gegevens worden gevraagd, hoe lang ze worden bewaard (binnen onze grenzen). |
| **PLUSONE** (wij) | **Verwerker** | Leveren het platform en verwerken persoonsgegevens uitsluitend in opdracht van de venue. |
| Gasten, aanvragers, personeel | **Betrokkenen** | Hun persoonsgegevens worden verwerkt. |
| Supabase, Vercel (en later Stripe) | **Sub-verwerkers** | Zie §6. |

Gevolg: tussen elke venue en ons hoort een **verwerkersovereenkomst**. Dit
document levert de inhoud (doelen, categorieën, bewaartermijnen, beveiliging,
sub-verwerkers) waarop die overeenkomst leunt.

---

## 2. Verwerkingsregister (aanzet, art. 30 AVG)

Per verwerkingsdoel: betrokkenen, categorieën persoonsgegevens, grondslag,
bewaartermijn, ontvangers. De grondslag wordt formeel door de **venue** als
verantwoordelijke bepaald; onderstaande is de praktische default.

| # | Verwerkingsdoel | Betrokkenen | Categorieën persoonsgegevens | Grondslag (default) | Bewaartermijn |
|---|---|---|---|---|---|
| 1 | **Gastenlijstbeheer** | Gasten + hun +1's | Naam; *optioneel* e-mail, telefoon; aantal +1's; tier; vrije notitie | Gerechtvaardigd belang venue (toegangsbeheer) | `retention_months` na het event (default 12 mnd), dan anonimisering (§4) |
| 2 | **Landingpage-aanvragen** | Aanvragers | Naam; *optioneel* e-mail, telefoon, motivatie; beslissing + reden | Toestemming/aanvraag betrokkene | Idem (event-geankerd), dan anonimisering |
| 3 | **Deur: check-in & weigering** | Gasten | Check-in-tijd, door wie, device; weigerreden (vrije tekst) | Gerechtvaardigd belang (toegangscontrole, anti-fraude) | Idem; weigerreden wordt geredigeerd bij anonimisering |
| 4 | **Toegang & personeelsbeheer** | Users (staff, admins, organisatoren) | Naam, e-mail (auth-identiteit), rollen, ingelogde sessies/devices | Uitvoering overeenkomst venue ↔ user | Zolang account/membership bestaat; verwijderen membership ≠ verwijderen user (#24) |
| 5 | **Auditlog (fraudebestrijding)** | Gasten + actoren | Actor, actie, before/after-diff, tijdstip, device | Gerechtvaardigd belang (fraudebestendigheid, #1/#4/#15) | Append-only; **PII in diffs wordt geschoond** zodra de gast wordt geanonimiseerd (§4) |
| 6 | **Billing** *(fase 2)* | Venue-contactpersoon | Facturatiegegevens via Stripe (geen gast-PII) | Uitvoering overeenkomst | Conform fiscale bewaarplicht; bij Stripe (§6) |

**Dataminimalisatie (#9, #16):** e-mail en telefoon van gasten zijn altijd
*optioneel* — "meer data = beter, maar niet verplicht". +1's mogen volledig
anoniem ("Jan +2"). We slaan geen bijzondere categorieën persoonsgegevens op en
vragen er niet om.

---

## 3. Datastromen

Waar persoonsgegevens binnenkomen, stromen en rusten:

1. **Invoer**
   - Staff/organisator voegt gasten toe (quick-add, beslissing #33) → Supabase Postgres.
   - Publiek vult de **landingpage** in (anon, rate-limited, #28) → `guest_requests`.
   - Doorhost checkt in / weigert aan de deur → `check_ins` / `refusals`.
2. **Opslag (at rest)** — Supabase Postgres (EU, §6). **Row Level Security** is de
   beveiligingsgrens (#1): een gebruiker kan nooit buiten zijn memberships lezen
   of schrijven, ook niet met directe API-toegang.
3. **Deur-app (lokaal/offline, #14)** — bij het openen van een event wordt de
   **volledige gastenlijst lokaal in IndexedDB** op het device gezet, met een
   offline outbox voor mutaties. *Persoonsgegevens rusten dus ook lokaal op
   deur-devices.* Mitigaties: persoonlijke login per medewerker (ook op gedeelde
   devices), korte access-tokens met rotatie, en **remote logout** door admins
   als een device kwijtraakt (§5 van de spec). De lokale cache is gekoppeld aan
   het geopende event.
4. **Realtime** — check-in-status synchroniseert tussen deur-devices via Supabase
   Realtime (alleen status, binnen de RLS-scope van het event).
5. **Geen uitgaande kanalen** — de app verstuurt **geen** uitnodigingen of
   berichten via mail/WhatsApp (#10/#13). Geen PII in URLs, query-strings of logs
   (security-checklist, `CLAUDE.md`).

---

## 4. Bewaartermijnen & anonimisering (beslissing #16/#29)

- **Per venue instelbaar:** `venues.retention_months` — **default 12 maanden,
  minimum 1 maand**. Alleen een venue-**admin** kan dit wijzigen (afgedwongen in
  RLS). De instel-UI komt in **fase 5**; het databaseveld en de logica bestaan al.
- **Event-geankerd (#26):** de termijn loopt vanaf het **event**, niet de
  kalenderdatum waarop de rij is aangemaakt — data wordt bewaard tot `retention_months`
  ná het event (`coalesce(events.ends_at, starts_at)`), het moment waarop ze niet
  langer nodig is.
- **Dagelijkse, in-database job** (`public.run_privacy_retention()`, gepland via
  **pg_cron**; draait als table-owner, niet via de service-role). Per verlopen event:
  - **Gasten:** naam → `Gast #<volgnr>` (stabiel, per-event volgnummer op
    aanmaakvolgorde), e-mail/telefoon/notitie → `NULL`, `anonymized_at` gezet.
  - **Landingpage-aanvragen (`guest_requests`):** naam → `Aanvraag #<volgnr>`,
    e-mail/telefoon/motivatie/beslis-reden → `NULL`, `anonymized_at` gezet.
  - **Weigeringen (`refusals`):** de vrije-tekst `reason` (kan een naam bevatten)
    wordt vervangen door `[verwijderd na bewaartermijn]`, `anonymized_at` gezet.
  - **Auditlog:** zie hieronder.
- **De job raakt uitsluitend PII-velden + `anonymized_at` aan** — nooit
  status/plus_ones/tier/removed_at. Daardoor blijven quota- en tier-**statistieken
  invariant** (een geanonimiseerd record telt exact even zwaar mee als daarvoor).
- **Onomkeerbaar.** Originele namen/contactgegevens worden overschreven, niet
  gearchiveerd.

**Soft delete vs. anonimisering.** Een gast verwijderen (#21) zet alleen
`status = 'removed'`: de gast blijft op de lijst staan zodat het auditlog compleet
blijft. Pas ná de bewaartermijn verdwijnt de PII via anonimisering. Hard delete is
op databaseniveau ingetrokken voor alle app-rollen — ook de service-role kan een
gast-, check-in-, weiger- of auditrij niet fysiek verwijderen.

**Auditlog-schoning met behoud van structuur.** Het auditlog is append-only en
onomzeilbaar (#4) — geen enkele app-rol (ook `service_role` niet) mag het muteren.
De AVG-schoning van diffs loopt daarom via een **aparte, gelogde redactie-functie**
(`public.redact_anonymized_audit_pii`) die als **table-owner** draait — de enige
schrijver náást de trigger. Die functie:
- vervangt de PII-waarden in bestaande diffs (naam → het geanonimiseerde handvat,
  e-mail/telefoon/notitie/reason → `null`/marker) **zonder de diff-structuur te
  veranderen** — de sleutels blijven staan, alleen de waarden zijn geschoond;
- schrijft per geanonimiseerde gast één `anonymize`-entry, zodat de redactie zelf
  in het log is vastgelegd (append-only blijft gelden — we voegen alleen een
  registratie toe).

---

## 5. Beveiliging (samenvatting)

Volledige checklist: `CLAUDE.md` (§Security checklist). Kernpunten:

- **RLS als security boundary (#1):** elke tabel default-deny; app-laag-checks zijn
  gemak, geen beveiliging.
- **Authenticatie (#20, spec §5):** passwordless e-mail-OTP, **invite-only**,
  **verplichte MFA (TOTP)** voor admin/finance, korte access-tokens met
  refresh-rotatie, sessiebeheer + remote logout.
- **Auditlog via triggers (#4):** append-only, onomzeilbaar, geen schrijfrechten
  voor app-rollen.
- **Versleuteling:** in transit via TLS; at rest via de managed opslag van
  Supabase/Vercel.
- **Service-role key** uitsluitend server-side; nooit in client-bundles. Geen PII
  in logs of URLs. Publieke endpoints (landingpage) zijn rate-limited en lekken
  niet of een e-mail/gast al bestaat.

---

## 6. Sub-verwerkers

Alle huidige sub-verwerkers zijn **EU-resident**; er is geen structurele doorgifte
van persoonsgegevens buiten de EER in de kern van het product.

| Sub-verwerker | Dienst | Regio | Opmerking |
|---|---|---|---|
| **Supabase** | Database (Postgres), Auth, Realtime, Edge Functions | **eu-west-1 (Ierland, EU)** | Zie correctie-noot hieronder. Standaard Supabase-DPA. Alle gast- en gebruikers-PII rust hier. |
| **Vercel** | Hosting & edge (Next.js PWA) | **fra1 (Frankfurt, EU)** | Vercel-DPA. Geen PII in de app-logs; edge serveert alleen de applicatie. |
| **Stripe** *(fase 2)* | Billing/abonnementen | EU | Alleen **venue-facturatiegegevens**, geen gast-PII. Betaalgegevens (SEPA/iDEAL) blijven bij Stripe; wij slaan geen IBAN/kaartdata op (#32). |

> **Correctie-noot (regio Supabase).** De oorspronkelijke opdracht noemde
> "Supabase **Frankfurt**". De feitelijke projectregio is **eu-west-1 (Ierland)**:
> het bestaande Supabase-project draait daar en is op **2026-06-13** EU/AVG-conform
> akkoord bevonden (oorspronkelijk was eu-central-1/Frankfurt beoogd; beide zijn
> EU-regio's). Dit document volgt de feitelijke region — leg de juiste regio vast
> in de verwerkersovereenkomst. Bron: `CLAUDE.md` (Stack) en `gastenlijst-app-spec.md` §4.

---

## 7. Rechten van betrokkenen

Verzoeken (inzage, rectificatie, verwijdering, bezwaar) lopen via de **venue** als
verwerkingsverantwoordelijke; wij faciliteren als verwerker.

- **Inzage/rectificatie:** een admin/organisator kan gastgegevens inzien en
  corrigeren binnen zijn scope.
- **Verwijdering vóór de bewaartermijn (recht op vergetelheid, art. 17):** een gast
  op `removed` zetten (soft delete) haalt hem alleen van de actieve lijst — de PII
  blijft tot de bewaartermijn. Voor een echt wisverzoek kan een **admin** een
  adresboek-contact **direct anonimiseren op verzoek** via `public.forget_contact()`
  (knop "Forget this person" in het adresboek, po Gasten → Adresboek): het contact
  én al diens gekoppelde gasten/weigeringen binnen de venue worden meteen
  geanonimiseerd, ongeacht de bewaartermijn. Vereist **admin** (admin is een
  MFA-verplichte rol, dus geen extra MFA-stap per actie); onomkeerbaar; de actie +
  de audit-redactie worden zelf in het log vastgelegd. Het verzoek loopt via de
  venue als verwerkingsverantwoordelijke.
- **Auditlog:** blijft bestaan voor fraudebestrijding (gerechtvaardigd belang #1/#4),
  maar de PII erin wordt bij anonimisering geschoond — er blijft dus geen naam/contact
  van de betrokkene in het log staan.
- **Dataportabiliteit/export** (Finance-export): **fase 2**.

---

## 8. Datalekken

Als verwerker melden wij beveiligingsincidenten met (mogelijke) impact op
persoonsgegevens **zo snel mogelijk** aan de betrokken venue(s) als
verwerkingsverantwoordelijke (art. 33 AVG). De venue beoordeelt of melding aan de
Autoriteit Persoonsgegevens en/of betrokkenen vereist is. Het meldproces en de
contactgegevens horen in de verwerkersovereenkomst.

---

## 9. Open punten / TODO

- [ ] Verwerkersovereenkomst-**template** opstellen en juridisch laten toetsen
  (op basis van dit document).
- [x] **Vervroegde anonimisatie op verzoek** — geïmplementeerd als
  `public.forget_contact(uuid)` (migratie `20260624120000`, admin self-guard; admin
  is MFA-verplicht, dus geen extra AAL2-stap per actie).
  Wist één adresboek-contact + al diens gekoppelde gasten/weigeringen direct, vóór de
  bewaartermijn; auditdiffs worden structuurbehoudend geschoond. Open vervolg:
  hetzelfde op gast-niveau voor gasten zónder contact-koppeling, en het meenemen van
  losse `guest_requests` (nu nog gedekt door de nachtelijke window-sweep).
- [ ] **Export voor betrokkenenrechten** (inzage/portabiliteit) — fase 2.
- [ ] **Fase-5-UI** voor `retention_months` in venue-instellingen (veld + logica
  bestaan al; zie `src/components/po/screens/settings.tsx`).
- [ ] Actuele **DPA-versies en sub-verwerkerslijsten** van Supabase en Vercel
  vastleggen en periodiek herzien.
- [ ] Beslissen over **cookie-/analytics-beleid** (analytics staat lokaal uit;
  bevestig voor productie).
