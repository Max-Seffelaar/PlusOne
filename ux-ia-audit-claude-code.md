# UX/IA-audit & plan — dubbele functionaliteit en misplaatste menu's (8 juli 2026)

> **Opdracht:** dezelfde functionaliteit is op meerdere plekken bereikbaar en overzichten staan niet
> waar je ze zoekt; maak de app eenduidiger zonder functionaliteit te verliezen. **Dit doc is het
> plan — er is niets gebouwd, ook de "absolute wins" niet.**
>
> **Methode:** (1) volledige codebase-mapping van alle po-schermen, nav-registratie en entry-points
> (elke `nav.push`-callsite geteld), (2) live browser-walkthrough op de lokale stack met **alle zes
> seed-rollen** (admin, user_manager, finance, staff, doorhost, organizer) op 1280px én 375px,
> inclusief edge cases (eigen-request approven, gast-profiel als doorhost, `/door` als organizer),
> (3) kruisverwijzing met de ClickUp-lijst `901818739469`.
>
> **Relatie tot eerdere docs:** dit bouwt voort op `ia-audit-claude-code.md` (23 juni) en
> `ux-walkthrough-2026-07-02.md`. §0 zet de status van de juni-aanbevelingen; alles daarna is de
> stand van **vandaag** (na T9-fold, Guests-tab, Engelse UI, Promotion/Influencers F1+F2).

---

## §0 — Status van de juni-IA-audit (wat is al opgelost, wat niet)

| Juni-item | Status vandaag |
|---|---|
| T1 Guests als eigen tab | ✅ Gedaan (`GuestsTab`, PR #91) |
| T2 Tab-vs-push-asymmetrie weg | ❌ **Erger geworden**: `NAV_PUSHED` in `app.tsx:649` groeide van 2 naar **5** items (stats, gebruikers, aanvragen, promo, contacten) |
| T3 More herindelen in secties | ✅ Gedaan (Account / Insights / This venue / Team & access / Switch venue) |
| T4 Home ↔ Analytics scheiden | ✅ Grotendeels (Stats heet Analytics, zit in Insights) |
| T5 Venue-schermen consolideren | 🟡 Half: VenueSwitch heeft "Manage"-knop, maar venue-switch blijft dubbel (header + More-rij) |
| T6 Sessies disambigueren | ✅ Gedaan ("Your devices" in Profile · "Sessions & security" apart) |
| T7 Engels | ✅ Gedaan (i18n-catalogus; restjes → T13) |
| T8/T9 Deur-unificatie fase 1+2 | ✅ Gedaan (Door-tab met segmenten; cockpit = desktop-Door, `/eventday` weg) |
| T10 `/door` → deep-link die de Door-modus mount | ❌ Niet gedaan: `/door/[eventId]` is nog een **eigen component-boom** (`DoorShell` + PhoneFrame) naast de po Door-tab |
| T11 Contacts + Regulars samenvoegen | 🟡 Anders opgelost: Regulars = filter in Guests-tab. Maar het oude `Vaste`-scherm bestaat nog als **onbereikbaar wees-scherm** (0 callsites voor `nav.push('vaste')`, case in `app.tsx:529`) |
| T12 EventBeheer-hub → Events | ❌ Niet gedaan: "Events & tiers" is nog een parallelle event-lijst in More |
| T17 Add-guests unificeren | ❌ Niet gedaan (Quick-add, Bulk, Door-AddOnSpot, Contacts-add, Import-add = 5 flows) |
| T18 State-aware Event (detail+recap) | ❌ Niet gedaan; plus nieuwe inconsistentie (zie K-14) |
| T19 Import in Contacts | 🟡 Half: Contacts heeft een import-icoon, maar Import is óók nog een More-peer-rij |

**Nieuw sinds juni** (niet in die audit): Promotion-cluster (Promo / Links / Influencers / publieke
`/i/[token]`), Event templates, Crew-scherm, Regulars-filter — samen +6 schermen, allemaal in de
More-hub of als sidebar-push erbij gehangen. De boom is dus verder gegroeid in precies het patroon
dat de juni-audit als probleem benoemde.

---

## §1 — Inventarisatie: alle surfaces en wat ze doen

**Shell:** één responsive `/app` (mobiel <1024px bottom-tabs · desktop ≥1024px sidebar), in-memory
nav-stack, geen per-scherm URL's. Buiten de shell: `/door(+/[eventId])`, publiek `/e/[slug]`,
`/i/[token]`, `/r/[token]`, auth (`/login`, `/mfa/*`, `/consent`, `/onboarding`).

### Tabs (roots)
| Surface | Doet | Rollen |
|---|---|---|
| **Home** (`home.tsx`) | Pulse-tegels (open requests / quota requests / live events), combo-graph, upcoming+past event-kaarten met 5 acties (Open/Door/Requests/Edit/Lock), "New guest"-picker | allen (data via RLS) |
| **Events** (`events.tsx`) | Upcoming/Past-lijst → EventView of PastEvent; "New event" (admin), "Add guest" | allen |
| **Guests** (`guests/index.tsx` GuestsTab) | Venue-breed gastoverzicht, event-scope-chips, Regulars-filter, multi-select (mark regular / change tier / add to event); add-knoppen **alleen** bij enkel-event-scope | allen (staff: eigen) |
| **Door** (mobiel `door.tsx` / desktop `EventDayCockpit`) | Mobiel: offline outbox check-in + Tasks-segment + AddOnSpot. Desktop: online cockpit met approvals-panel, tier-bars, arrivals-chart, lock-toggle | admin/doorhost (`canWorkDoor`) |
| **More** (`settings.tsx` Meer) | Hub met 18 rijen in 5 secties (zie §2-D) | allen (rijen per rol) |

### Gepushte schermen (31 cases in `app.tsx`)
| Cluster | Schermen |
|---|---|
| Event | EventView · EventEdit (create+edit) · Tiers · Crew · PastEvent · EventBeheer-hub · Templates · TemplateEdit · Links |
| Gasten | Lijst (per-event) · QuickAdd · BulkPaste · Contacten · ContactProfile (gast én contact) · Vaste (wees) |
| Insights | Stats/Analytics · Aanvragen/Requests · AuditLog · Promo · Influencers |
| Beheer | Gebruikers/Team · Rollen (default quota) · Allowance ("Quota per event", **mock**) · VenueSettings · VenueSwitch · VenueCreate · Profile · Billing · Import · AdminSessions |

### Losse routes
| Route | Doet | Let op |
|---|---|---|
| `/door` + `/door/[eventId]` | Standalone deur-app: **zelfde** CheckInList/Taken/GuestDetail/AddOnSpot-componenten als de Door-tab, maar in een eigen `DoorShell` met PhoneFrame, **mock-statusbalk "9:41"** en eigen tab-bar | enige deur-ingang voor organizers; nergens vanuit `/app` gelinkt. **Besluit 8/7: de dubbele implementatie wordt geschrapt (G2)** — de *URL* blijft bestaan als deep-link/PWA-ingang (bookmark op deur-devices, Capacitor-deep-link, organizer-toegang), maar hij mount voortaan dezelfde Door-modus als de tab; de aparte `DoorShell`-boom + mock-statusbalk verdwijnen |
| `/e/[slug]` `/i/[token]` `/r/[token]` | Publiek: request-form, influencer-stats, gast-status | buiten scope van dit plan |

---

## §1b — Rollenmatrix: wat mag welk user-type (toegevoegd op verzoek Max, 8/7)

Zes user-types: **vijf venue-rollen** (een user kan er meerdere tegelijk hebben) + de **organizer**,
die géén venue-rol is maar een *externe* per-event-toekenning (`event_organizers` — "External crew"
in de Team-UI). Bron: `src/features/auth/roles.ts` + `src/features/venues/access.ts` (spiegelen
1-op-1 de RLS-policies) + live geverifieerd per rol.

Legenda: **✓** = mag · **👁** = alleen lezen · **eigen** = alleen eigen items · **—** = mag niet
(en hoort het dan ook niet als actieve knop te zien) · **°** = besluit 8/7, nog te bouwen.

| Actie | Admin | User manager | Finance | Staff | Door host | Organizer (extern, per event) |
|---|---|---|---|---|---|---|
| **EVENTS** | | | | | | |
| Events + recap bekijken | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Event aanmaken (ook uit template) | ✓ | — | — | — | — | — |
| Event bewerken (details, tiers, links, crew-rij) | ✓ | — | 👁 | — | — | ✓ eigen event |
| Event annuleren / heropenen | ✓ | — | — | — | — | — |
| Templates beheren | ✓ | — | — | — | — | ✓ |
| **GASTEN** | | | | | | |
| Gastenlijst zien | ✓ alle | — (ziet er 0) | 👁 alle | eigen | ✓ alle | ✓ eigen event |
| Gast toevoegen (quick/bulk) | ✓ zonder limiet | — | — | ✓ binnen eigen quota | ✓ binnen eigen quota | ✓ zonder limiet, eigen event |
| Gast bewerken / tier wijzigen / verwijderen | ✓ alle | — | — | eigen | aan de deur | ✓ eigen event |
| Extra quota-slots aanvragen | n.v.t. (exempt) | — | — | ✓ | ✓ | n.v.t. (exempt) |
| Contacts (adresboek) + Regulars beheren | ✓ | — | ✓ | — | — | 👁 + add-to-event |
| Import (CSV/plak/telefoon) | ✓ | — | ✓ | — | — | — |
| Contact vergeten (AVG) | ✓ | — | — | — | — | — |
| **DEUR** | | | | | | |
| Check-in / weigeren / terugdraaien / taken | ✓ | — | — | — | ✓ | ✓ eigen event ° (RLS staat het al toe; de UI-route is K-6/M2) |
| Add on the spot | ✓ | — | — | — | ✓ binnen quota | ✓ eigen event |
| Lijst locken / unlocken | ✓ | — | — | — | — | ✓ eigen event |
| **REQUESTS** | | | | | | |
| Landing-/quota-requests beslissen | ✓ | — | — | — | — | ✓ eigen event |
| Requests-inbox inzien | ✓ | — | 👁 zonder knoppen ° (besloten 8/7: finance = alles read-only) | eigen status ° | — | ✓ eigen event |
| **INZICHT** | | | | | | |
| Analytics | ✓ | — | ✓ | — | — | — |
| Promotion-dashboard | ✓ | — | ✓ | — | — | — ° (besluit 8/7: alleen venue-leden; extern alleen per-event Links) |
| Request-links per event beheren | ✓ | — | 👁 | — | — | ✓ eigen event |
| Influencer-roster + stats-tokens | ✓ | — | — | — | — | — |
| Audit log | ✓ | — | ✓ | — | — | — |
| **BEHEER** | | | | | | |
| Team zien | ✓ | ✓ | 👁 | — | — | — |
| Leden uitnodigen / rollen wijzigen / verwijderen | ✓ | ✓ (géén admin-rol uitdelen) | — | — | — | — |
| External crew beheren (incl. crew-quota) | ✓ | — | — | — | — | — |
| Default quota per lid instellen | ✓ | — | 👁 | — | — | — |
| Per-event quota instellen | ✓ | — | 👁 | — | — | — |
| Venue settings (naam, AVG, BTW/KVK) | ✓ | — | 👁 | — | — | — |
| Billing lezen | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Billing checkout / portal | ✓ (alleen browser, nooit native) | — | — | — | — | — |
| Team-devices remote uitloggen | ✓ | — | — | — | — | — |
| Eigen profiel + eigen sessies + MFA | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Venue switchen / nieuwe venue aanmaken | ✓ | ✓ | ✓ | ✓ | ✓ | switch ✓ / create ✓ |

**Waar de UI vandaag van deze matrix afwijkt** (de rechten-knelpunten uit §3):
staff ziet actieve Approve/Deny op requests (K-4) · finance ziet beslis-knoppen (K-5) ·
user_manager krijgt "New guest" + RLS-nullen als "0" (K-7) · doorhost ziet request-tegels en loopt
dood op gast-profielen (K-8) · organizer mist elke deur-route in `/app` (K-6) · organizer krijgt de
"Events & tiers"-beheerhub te zien waarin hij niets kan (K-3).

---

## §2 — Duplicatiekaart

Per functionaliteit: waar hij zit, en of de dubbeling bewust is of gegroeid.

### A. Vijf sidebar-items zijn óók More-rijen (desktop toont alles dubbel)
De desktop-sidebar (`app.tsx:661-684`) heeft 10 items; **Contacts, Requests, Analytics, Promotion en
Team** zijn daar pushes (geen tabs) én staan **nogmaals** als rij in de More-hub. Plus een More-rij
"Event Day" die gewoon `nav.setTab('deur')` doet — de Door-tab die al in de balk staat.
*Oordeel: gegroeid.* Elke feature-PR (T10 Contacts, F2 Promotion, T9-badge Requests) hing zijn
scherm op twee plekken zonder de andere op te ruimen. De `currentKey`-kludge (`app.tsx:650`) die de
juni-audit al noemde, dekt nu 5 items.

### B. Twee gastenlijsten: GuestsTab × Lijst
`GuestsTab` (tab, venue-breed met scope-chips) en `Lijst` (push vanuit EventView, per-event) tonen
dezelfde kolommen, dezelfde multi-select-acties, dezelfde add-knoppenrij — via gedeelde componenten
(`GuestCardList`/`GuestTable`), maar met dubbel bedrade wiring en één verschil: tier-change kan in
GuestsTab alleen bij enkel-event-scope. *Oordeel: half bewust* (Lijst is ouder; GuestsTab kwam er in
PR #91 naast), maar voor de gebruiker zijn het twee ingangen naar hetzelfde roster.

### C. Vijf manieren om een gast toe te voegen
1. **QuickAdd** (vanuit Events-knop, Home "New guest"-picker, GuestsTab/Lijst, cockpit "Add guest");
2. **BulkPaste**; 3. **Door-AddOnSpot** (eigen component, zelfde parser); 4. **Contacts → add-to-event**
(twee sheets: `AddToEventSheet` voor één, `BulkAddToEventSheet` voor N — bijna identiek);
5. **Import → AddImportedToEvent**. Parser en quota-logica zijn gedeeld (bewust, goed); de **schil**
eromheen is 5× anders. *Oordeel: gegroeid; juni-item T17/A1/A6 was hiervoor al voorgesteld.*

### D. Quota-bewerking op 4 plekken, waarvan 1 mock
1. Team → "Default quota per member" (Rollen-scherm, live); 2. EventEdit → per-event
quota-stepper (live); 3. Crew → per-persoon quota (live); 4. **More → "Quota per event"
(Allowance) = 100% prototype-mockdata** — toont event "FRENZY" met niet-bestaande teamleden
(live geverifieerd; = Review 7/7 **K1**). *Oordeel: 1-3 bewust gelaagd, 4 is een vergeten stub die
voor admin én finance gewoon in het menu staat.*

### E. Per-event statistieken op 3 plekken
EventView onderaan ("Activity": BY TIER / BY MEMBER / LOG) ≈ Analytics per-event drill-down
(tier-breakdown + ADDED BY) ≈ cockpit (tier-bars + arrivals). Het **volledige audit-log** staat
bovendien integraal onder EventView (40+ regels bij het seed-event) terwijl er een eigen Audit-scherm
is met filters. *Oordeel: bewust toegevoegd per feedbackronde (86ey21vnd), maar zonder dedupe —
EventView is er extreem lang van geworden.*

### F. Requests bereikbaar via 6 ingangen met 3 verschillende gates
Sidebar (alleen `admin`, `app.tsx:660`) · More-rij (`isAdmin || canManageTemplates`) · Home
pulse-tegels (**iedereen**) · Home event-kaart-badges (iedereen) · EventView "3 open requests"-knop ·
cockpit approvals-panel (admin/organizer). *Oordeel: gegroeid; de gate verschilt per ingang* — zie
K-4/K-5.

### G. Promotion-cluster: setup en resultaten gesplitst over 3 schermen
**Links** (per-event, setup: maken/pauzeren/QR — funnel **zonder** checked-in) × **Promo** (venue-breed,
resultaten: funnel mét checked-in + leaderboards + óók een create-link-modal) × **Influencers**
(roster + stats-tokens, alleen via More, admin-only). Drie bijna identieke tier-picker-sheets
(Approvals-assign, Links-edit, Promo-create). *Oordeel: bewuste scheiding setup/resultaat, maar de
create-flow is gedupliceerd en een organizer ziet alleen de setup-helft (K-6).*

### H. Venue-switch: 3 ingangen
Header-venuenaam · More-headerkaart · More-rij "Venues" — alle drie → `venueswitch`. Bij 1 venue
blijft de rij "1 venue · switch" staan. *Oordeel: gegroeid.*

### I. Deur: nog steeds 2 component-bomen voor dezelfde taak
De po Door-tab en `/door/[eventId]` mounten dezelfde onderdelen, maar `DoorShell` heeft een eigen
frame, eigen tab-bar, eigen overlay-state en een mock-statusbalk. De desktop-cockpit is bewust
anders (online, approvals), maar mist Refuse, reverse-check-in, Tasks en AddOnSpot die mobiel wél
heeft — deels bewust, deels gat (zie K-13). i18n heeft er twee namespaces voor (`door.*` vs
`cockpit.*`) met dubbele filter-labels.

---

## §3 — Knelpunten (concreet, met onderbouwing)

### Nav-structuur
- **K-1 · Desktop-sidebar = 10 items, 5 gedragstypes door elkaar.** Tabs (wissen stack), pushes
  (stapelen), en een More-tab. Terug-gedrag verschilt dus per sidebar-item; de `NAV_PUSHED`-kludge
  houdt de highlight kunstmatig kloppend (`app.tsx:649-650`). Mobiel heeft een ánder skelet (5 tabs,
  rest onder More) — het "één vaste nav"-principe uit de juni-audit is verder weggezakt.
- **K-2 · More toont op desktop 6 rijen die al in de sidebar staan** (Analytics, Promotion,
  Requests, Team, Contacts, Event Day→Door). Voor een nieuwe gebruiker lijkt de app daardoor twee
  keer zo groot als hij is.
- **K-3 · "Events & tiers" (EventBeheer) is een parallelle event-lijst.** Zelfde events als de
  Events-tab, maar kaart-tap → *edit* i.p.v. *view*. Bovendien krijgt een **organizer** de rij te
  zien (gate `isAdmin || canManageTemplates`, `settings.tsx:238`) terwijl de "New event"-CTA erin
  admin-only is: een beheer-hub waarin hij niets kan beheren.

### Rechten: tonen-en-blokkeren i.p.v. role-hide
- **K-4 · Staff kan zijn éigen quota-request openen mét actieve Approve/Deny-knoppen.** Live
  getest als `staff@`: Home-tegel "QUOTA REQUESTS 1" → Requests → eigen verzoek → "Approve +3" →
  pas dán *"You don't have rights for this (or MFA is required)"*. RLS houdt (goed), maar de UI
  biedt een staff-lid aan zijn eigen verzoek goed te keuren, en de foutcopy noemt MFA ten onrechte.
- **K-5 · Finance ziet dezelfde actieve Approve/Decline-knoppen** op alle requests, terwijl
  beslissen admin/organizer-only is. Zelfde patroon; en omgekeerd **ontbreekt** de Requests-rij in
  háár More-hub (gate `isAdmin || canManageTemplates`) terwijl de Home-tegel haar er wél heenbrengt —
  dezelfde functie is per ingang anders gegate (§2-F).
- **K-6 · Organizer heeft geen enkele in-app route naar een deur-oppervlak.** Geen Door-tab
  (`showDoor = canWorkDoor(roles)`, organizer is geen venue-rol — `app.tsx:288-290`), geen "Event
  Day"-rij, geen link op EventView. `/door/[eventId]` accepteert hem wél (live geverifieerd) — maar
  alleen wie de URL kent. De persoon die het event draait kan de deur dus alleen via een geheime URL
  bedienen.
- **K-7 · user_manager: "New guest" op Home → opgetuigde doodloper.** Picker → QuickAdd toont
  *tegelijk* "Your quota · 5 of 5 left" én "You don't have rights to add guests to this event"
  (live geverifieerd als `manager@`). Ook toont haar Home "0 ON THE LIST" op een event met 37
  gasten — een RLS-nul gepresenteerd als feit.
- **K-8 · Doorhost: gast-tap in Guests-tab → "This contact isn't available, or you don't have
  access to it."** De tab toont haar alle 29 gasten, maar elk contact-gelinkt profiel is een
  doodloper (contacts-RLS). Ook staan op haar Home request-tegels die voor haar rol altijd 0 zijn.
- **K-9 · Doorhost-More toont "Event Day · Live command screen for tonight"** — op mobiel opent
  die rij gewoon de Door-tab die al in de tabbalk staat; de cockpit bestaat alleen ≥1024px.

### Cijfers die per oppervlak verschillen
- **K-10 · Cockpit telt anders dan de rest.** Zelfde event, zelfde moment (live gemeten):
  mobiele deur **33 people on the way + 4 inside = 37** en EventView **"37 people on the list"**,
  maar de cockpit zegt **"TURNOUT 4 / 38 people" en 34 on the way**. Welke telregel precies afwijkt
  (refused-behandeling, partial-party, +1-telling) is nog niet uitgezocht — de fix is hoe dan ook
  dat álle oppervlakken één gedeelde selector gebruiken (zie de canonieke telregels onder §5.2).
  Precies het vertrouwensprobleem dat T9 voor de request-badge oploste, maar dan voor headcounts.
- **K-11 · Twee persoons-vocabulaires.** Contacts gebruikt een eigen rolchip-taxonomie
  (GUEST / VIP / ALL ACCESS / ARTIST / PRESS / CREW) die niet overeenkomt met de venue-tiernamen;
  dezelfde persoon heet "GUEST" in Contacts en "Regular" op de lijst. (Guests-tab-variant hiervan =
  Review 7/7 **K11**; wortel = één `tierRole`, FE-2.)

### Dode/mock/rommel-oppervlakken
- **K-12 · "Quota per event" (Allowance) serveert mockdata in het menu van admin én finance**
  (§2-D; = ClickUp K1). IA-vraag bovenop de bug: het scherm is überhaupt dubbelop met de per-event
  stepper in EventEdit.
- **K-13 · `/door` standalone**: eigen boom met **mock-statusbalk "9:41"** (prototype-artefact) op
  een productie-route; en de cockpit mist Refuse / reverse-check-in / Tasks / AddOnSpot die mobiel
  wél heeft — een desktop-deurgebruiker kan een vergissing niet terugdraaien zonder telefoon te
  pakken.
- **K-14 · Vaste-scherm is een wees** (0 callsites, case blijft in `app.tsx`) — dode UI-code naast
  het levende Regulars-filter.

### Kleinere frictie & consistentie
- **K-15 · Past-event gedraagt zich per ingang anders:** Events-tab-tap → recap (PastEvent), maar
  Home-kaart "Edit" → volledig EventEdit-formulier op een afgelopen event (`home.tsx:690`).
- **K-16 · Add-guest is onvindbaar op "All events"-scope:** de Guests-tab toont add-knoppen alleen
  ná event-scoping; op de default-scope is er geen enkele add-affordance (live geverifieerd), terwijl
  Home en Events wél directe knoppen hebben.
- **K-17 · Naamloze icoon-knoppen op sleutelplekken:** EventView-edit (tandwiel) en de
  GuestsTab-header-add hebben geen label/aria-label, terwijl de rest van de app expliciete knoppen
  kreeg na Joeri's feedback (T3-patroon).
- **K-18 · Copy-restjes:** audit-log rendert onvertaald *"System create on request_links"*
  (mapping ontbreekt in `translate.ts`); Promo toont letterlijke kickers **"SECTION 1" / "SECTION 1 ·
  UNATTRIBUTED" / "SECTION 2"**; BY MEMBER formatteert "20(27 ppl)" zonder spatie; Billing en
  Analytics delen hetzelfde `spark`-icoon.
- **K-19 · EventEdit gebruikt "Request links" voor twee dingen:** de sectiekop (landing-toggle +
  slug + auto-close) én een rij eronder met exact dezelfde naam die naar het Links-beheer pusht.
- **K-20 · Links-kaarten missen de checked-in-uitkomst** die Promo en de publieke influencer-pagina
  wél tonen — wie links beheert ziet de conversie niet zonder naar Promo te springen.

---

## §4 — Voorstel nieuwe informatiearchitectuur (als geheel)

De juni-boom (Home · Events · Guests · Door · More) blijft het skelet — die is grotendeels
gerealiseerd en goed. Wat ontbreekt is **discipline op drie assen**:

**Principe 1 — één bestemming, één plek (+ hooguit contextuele shortcuts).**
Elk scherm heeft precies één structurele plek: óf sidebar/tab, óf More-sectie — nooit beide.
Contextuele ingangen (event-kaart → Requests van dát event) blijven, maar generieke dubbelingen
verdwijnen.

```
STRUCTUREEL (mobiel = 5 tabs; desktop = dezelfde boom, More-secties opengeklapt in de sidebar)
├─ Home       nu/vandaag: pulse, event-kaarten, New guest
├─ Events     lijst → Event (state-aware view/recap) → edit · tiers · crew · links · requests(event)
├─ Guests     venue-roster (scope-chips, Regulars-filter) → profiel · quick-add · bulk · Contacts
├─ Door       responsief: mobiel outbox-deur · desktop cockpit; /door/[id] = deep-link op dezelfde modus
└─ More
   ├─ Account        Profile
   ├─ Insights       Analytics (event-first: kies event → zelfde per-event-statsview als op het event;
   │                  venue-KPI's zoals retentie komen later) · Promotion (met Links + Influencers als sub) ·
   │                  Audit log · Requests
   ├─ This venue     Venue settings · Templates · Billing · Import(→ of sub van Contacts)
   ├─ Team & access  Team (met default-quota) · Sessions & security
   └─ Switch venue   (alleen >1 venue; anders verbergen)
```

Concreet te schrappen als eigen bestemming: **EventBeheer** (acties de Events-lijst in),
**Allowance** (per-event quota woont in EventEdit), **Vaste** (dood), **"Event Day"-More-rij**
(Door ís de tab), **Influencers als losse More-rij** (wordt sub-tab van Promotion), en de dubbele
sidebar/More-vermeldingen.

**Principe 2 — rollen verbergen acties, nooit halve schermen.**
Zelfde boom voor iedereen, maar: geen actieve knoppen die gegarandeerd op een RLS-fout lopen
(K-4/K-5/K-7), geen tegels die voor een rol altijd 0 zijn (K-8), en rollen met een taak krijgen een
route naar die taak (organizer → Door, K-6). Requests krijgt één gate-definitie: *zien* =
admin/finance/organizer(+eigen-status voor staff), *beslissen* = admin/organizer — en álle zes
ingangen volgen die ene definitie. Voor staff wordt Requests een "jouw aanvragen"-statuslijst in
plaats van een approval-inbox.

**Principe 3 — één definitie per cijfer.**
Head-/guest-counts en attendance komen uit één gedeelde selector (zoals `isOpenGuestRequest` dat na
T9 voor de badge doet), zodat deur, cockpit, EventView en Analytics nooit meer van elkaar afwijken
(K-10). Idem één persoons-vocabulaire (tiernaam) op lijst, deur, contacts en profiel (K-11, FE-2).

**Deur-eindbeeld (juni-T10 afmaken):** `/door/[eventId]` wordt een dunne route die de po
Door-modus mount (outbox ongemoeid); DoorShell/PhoneFrame/mock-statusbalk verdwijnen. Cockpit en
mobiele deur delen bewust een feature-matrix: Refuse + reverse-check-in komen naar desktop, Tasks
als paneel of expliciet "mobiel-only" gedocumenteerd.

---

## §5 — Prioritering

### 5.1 Absolute wins (geen breaking-risico, herstellen designconsistentie)
*Strikt gehouden; bij twijfel doorgeschoven naar 5.2. Nog niet bouwen — pas na akkoord.*

| # | Win | Bewijs/plek |
|---|---|---|
| W1 | Promo-kickers "SECTION 1/2 (· UNATTRIBUTED)" vervangen door echte sectienamen | `promo.tsx`, live gezien |
| W2 | Aria-label + tooltip op de naamloze icoon-knoppen (EventView-edit, GuestsTab-add) — zelfde patroon als de expliciete knoppen elders | K-17 |
| W3 | Audit-vertaling voor `request_links`-acties ("System create on request_links") | `features/audit/translate.ts`; kan meeliften op **T13** (in progress) |
| W4 | Spatie-fix "20(27 ppl)" in BY MEMBER | `events.tsx` Activity |
| W5 | Eigen icoon voor Billing (nu zelfde `spark` als Analytics) | `settings.tsx:262` |
| W6 | i18n: dubbele filter-labels `door.*`/`cockpit.*` naar één gedeelde set (alleen catalogus-interne dedupe, geen zichtbare wijziging) | agent-bevinding §2-I |

### 5.2 Middelgroot — mét besluiten van Max (8/7)

| # | Verbetering | Besluit 8/7 |
|---|---|---|
| M1 | **Show-and-block weg op Requests**: knoppen verbergen voor rollen zonder beslisrecht; foutcopy zonder onterecht MFA-excuus (K-4/K-5) | ✅ Akkoord. Staff krijgt **alleen een status-weergave van z'n eigen aanvragen** (geen venue-inbox); **finance = alles read-only** (inbox zichtbaar, géén beslis-knoppen — besloten 8/7) |
| M2 | **Organizer → Door** (K-6) | ✅ Akkoord: **volwaardige Door-tab** voor de event-organizer. Géén losse "Open door"-knop — die is eerder bewust geschrapt (T6) en komt niet terug |
| M3 | **Doorhost-doodlopers**: gast-profiel als name-only weergave i.p.v. foutscherm; request-tegels verbergen voor rollen zonder request-zicht (K-8) | ✅ Akkoord |
| M4 | **Headcount-definitie gelijktrekken**: één gedeelde selector voor alle oppervlakken (K-10) | ✅ Akkoord + definitie **hieronder vastgelegd** zodat het niet meer mis kan gaan |
| M5 | **Sidebar/More dedupe**: de 6 dubbele More-rijen op desktop weg; Requests-gate overal gelijk (K-2, §2-F) | ✅ Akkoord |
| M6 | **EventView slanker** (§2-E) | ✅ Akkoord, in deze vorm: **"View activity →" navigeert naar de Audit-pagina, automatisch voorgefilterd op dat event**; het inline LOG verdwijnt van EventView (te druk, audit is voor de meeste gebruikers niet belangrijk). **Per-event-stats (BY TIER / BY MEMBER, besluit 8/7): wonen op het event** (EventView/recap = de "event-home"). Het **Analytics-scherm blijft bestaan maar wordt event-first**: je kiest eerst een event en landt dan op *dezelfde* per-event-statsview (één gedeeld component — géén tweede render, anders bouwen we de duplicatie van §2-E opnieuw). De huidige venue-brede koppen (avg. attendance e.d.) vervallen voorlopig; venue-KPI's (retentie, vergelijkingen tussen events) komen pas terug als ze echt iets zeggen |
| M7 | **EventBeheer opheffen** (K-3) — er zijn nu twee event-lijsten: de Events-tab (kaart-tap = bekijken) én More → "Events & tiers" (zelfde events, kaart-tap = bewerken). De tweede lijst gaat weg; de Events-tab krijgt een edit-actie op de kaart. Niemand verliest iets | ✅ Akkoord (8/7): **tweede lijst weg** (verwijderen, incl. de More-rij) |
| M8 | **"Quota per event" (Allowance) live bedraden** (K-12, ClickUp K1) | ✅ Besluit: **live bedraden** (niet schrappen). NB: per-event quota instellen kán vandaag al — venue-breed default in EventEdit ("Default quota per member") en per persoon via quota-request-approval of Crew; wat ontbreekt is dít scherm: per-event **per-teamlid** overrides in één overzicht. Dat wordt nu echt gebouwd |
| M9 | **user_manager-doodloper**: "New guest" verbergen voor rollen zonder guest-write; RLS-nullen als "—" i.p.v. "0" (K-7) | ✅ Akkoord |
| M10 | **Add-guest óók op "All events"-scope** in de Guests-tab: de knop altijd tonen; op "All events" opent hij eerst de bestaande event-picker (zoals Home's "New guest") en daarna de gewone add-flow (K-16) | ✅ Akkoord (8/7) |
| M11 | **Past events op Home beperken** (K-15, herzien) | ✅ Besluit aangepast: Home toont alleen de events van de **afgelopen week**; alles ouder woont uitsluitend onder Events → Past-filter. Past events **blijven gewoon bewerkbaar** en de recap krijgt ook **"Save as template"** (zie §7-besluit) |
| M12 | **Venue-switch één ingang** (header-picker); More-rij weg, "1 venue"-rij verbergen (§2-H) | ✅ Akkoord + **na een switch land je direct op Home van de nieuwe venue**, niet terug op de switcher (subsumeert ClickUp C24: `clearNavState` vóór de reload) |
| M13 | **EventEdit "Request links"-sectie hernoemen** zodat de term niet dubbel is met de Links-beheerrij (K-19) | ✅ Akkoord; naam wordt Engels, voorstel **"Sign-up link"** |
| M14 | **Links-kaarten + checked-in** (zelfde funnel als Promo) (K-20) | ✅ Akkoord |
| M15 | **Vaste-scherm + dode case verwijderen** (K-14) | ✅ Akkoord |
| M16 | **`/door` mock-statusbalk "9:41" weg** (K-13; check PWA-safe-area; vervalt grotendeels vanzelf bij G2) | ✅ Akkoord |
| M17 | **"Event Day"-More-rij weg/hernoemen** (K-9; desktop-rij vervalt bij M5) | ✅ Akkoord |

#### Canonieke telregels (vastgelegd bij M4-akkoord, 8/7 — geldt voor élk oppervlak)

Eén gedeelde selector (client + waar nodig dezelfde formule in SQL-views) levert deze getallen;
géén scherm telt ooit zelf:

- **On the list** = som van `1 + plus_ones` over alle gasten van het event met status ≠ `removed`
  en ≠ `refused` (in **heads**, plus-ones inbegrepen).
- **Inside** = aantal ingecheckte heads (bij partial check-in tellen alleen de daadwerkelijk
  ingecheckte heads).
- **On the way** = On the list − Inside.
- **Refused/Bounced** telt in géén van de bovenstaande mee; het is uitsluitend het aparte cijfer.
- **Attendance / turnout** = Inside ÷ On the list (0% bij lege lijst).
- Waar zowel *gasten* (rijen) als *heads* (mensen) getoond worden, worden ze altijd expliciet
  gelabeld ("24 guests · 33 people") — nooit door elkaar.

Deur (mobiel), cockpit, EventView, Home-kaarten, Analytics en de publieke statuspagina gebruiken
deze definities. Bij de bouw van M4 wordt de afwijkende cockpit-telling (K-10) tegen deze regels
uitgezocht en gelijkgetrokken; de regels verhuizen dan ook naar `gastenlijst-app-spec.md`
(decision-tabel) zodat ze vastliggen.

### 5.3 Grote herstructurering — mét besluiten van Max (8/7)

| # | Voorstel | Besluit 8/7 |
|---|---|---|
| G1 | **Eén canoniek nav-model + `/app` deep-linking** (juni-T2+T14; K-1). *In gewone taal: de hele app leeft nu op één URL (`/app`); schermen bestaan alleen in het geheugen van de browser-tab. Daardoor (a) kun je geen scherm delen/bookmarken ("stuur me de link van dat event" kan niet), (b) moesten sidebar-items als Analytics/Team als "nep-tabs" worden vastgeplakt met een trucje in de code, en (c) gedraagt terug/highlight zich per item nét anders. Het voorstel: elk scherm krijgt een echte URL (`/app/events/[id]`, `/app/analytics`, …). Dan wordt de sidebar gewoon een lijst links, verdwijnt het trucje, werkt de terugknop overal hetzelfde, en zijn schermen deelbaar — ook nodig voor de native app (deep links, Fase 17 S4). **Bonus (Max 8/7): echte URL's = betere tracking** — pageviews/funnels per scherm worden zinvol i.p.v. één ongedifferentieerde `/app`-hit* | ✅ Akkoord (8/7). **Koppeling PostHog-plan:** het PostHog-plan (PR #108, nog open) koos `screen_viewed`-events *omdat* `/app` één URL is (besluit 3 aldaar; `capture_pageview: false`). Afspraak: `screen_viewed` blijft het canonieke event (werkt vóór én na G1), maar het PostHog-plan mag niet op "single-URL" gebouwd worden — na G1 krijgt elk event de echte pathname mee en kunnen pageviews desgewenst aan. Comment op PR #108 geplaatst zodat de PostHog-sessie dit weet |
| G2 | **Deur-consolidatie afronden**: `/door/[id]` wordt een dunne route die exact de po Door-modus mount; de dubbele `DoorShell`-boom (+ mock-statusbalk) wordt **geschrapt** — antwoord op Max' vraag "kunnen we er niet één schrappen": ja, dít schrapt hem, alleen de URL blijft (PWA/bookmark/organizer-ingang) | ✅ Akkoord. Plus besluit vraag 3: **cockpit krijgt volledige deur-pariteit** (Refuse, reverse-check-in, Tasks, Add-on-spot — gelijk aan de deur-functionaliteit) |
| G3 | **Promotion-domein hergroeperen**: Promo + Links + Influencers → één Promotion-gebied (venue-overzicht · per-event · roster); create-link-flow één component (§2-G) | ✅ Akkoord. Gating-besluit (vraag 6): **alleen venue-leden** zien het Promotion-dashboard; een externe organizer (event-scoped) niet — die houdt alleen het per-event Links-beheer van zíjn event |
| G4 | **Guests/Lijst-fusie + één persoonsmodel**: Lijst wordt de event-gescopete staat van de Guests-tab; één vocabulaire/rolchip; profiel role-aware (K-11, §2-B/C; bouwt op FE-1/FE-2/FE-3) | ✅ Akkoord |

**Aanbevolen volgorde (alles akkoord, 8/7):** W1–W6 in één kleine PR → M1+M9+M3
(rechten-hygiëne, één thema) → M5+M7+M12+M15+M17 (menu-opruiming) → M4 (telregels) +
M6+M10+M11+M13+M14 (event-detail, guests & promotie-polish) → M2 (organizer-Door; kan ook met G2
mee) → M8 (Allowance live, eigen taak met migratie-check) → M16+G2 samen (deur) → G1 (canonieke
nav + URL's; vóór de Capacitor-wrap, en vóór/samen met de PostHog-bouw i.v.m. de
tracking-koppeling) → G3/G4.

---

## §6 — Kruisverwijzing ClickUp-lijst `901818739469`

**Al gedekt door bestaande open taken (géén nieuwe taak aanmaken):**

| Bevinding hier | Bestaande taak |
|---|---|
| Allowance = mock (K-12) | **K1** `86ey6xf4p` (dit plan stelt bovenop: scherm schrappen, M8) |
| "Gast"-rolchips / vocabulaire (K-11, deels) | **K11** `86ey6xf7t` + **FE-2** `86ey6ypfw` (single tierRole) |
| Copy-restjes (K-18, W3/W4) | **T13** `86ey4j1q2` (in progress) — W3/W4 kunnen daarop meeliften |
| Dubbele sheets/primitieven (§2-C/G tier-pickers) | **FE-4** `86ey6ypju` (kit-dedup) · **FE-3** `86ey6yphp` (fetcher-dedup) |
| 2000-regel schermbestanden (events/settings/guests) | **FE-5** `86ey6ypkp` |
| Stale AAL2-gate op AdminSessions | **K7** `86ey6xf6q` |
| Analytics stille nullen bij fetch-fout | **C25** `86ey6xeu9` |
| switchToVenue zonder catch/clearNavState | **C24** `86ey6xerx` |
| AddOnSpot lege naam | **C12** `86ey6xe8a` |
| Venue-switcher toont mock-naam tijdens laden | **K2** `86ey6xf8t` |
| Dode pre-login mock-authflow | **K6** `86ey6xfbx` (Vaste-wees M15 is een *aanvullende* dode-code-vondst, zelfde geest) |
| Deur-taken + push (Tasks-toekomst) | `86exyp8mm` |
| Home/Guests/Requests breken bij ~205 events (reads) | **SCALE-5** `86ey6yaph` |

**Nieuw (nog nergens in de lijst):** K-1/K-2 sidebar-More-duplicatie + `NAV_PUSHED`-persistentie ·
K-3 EventBeheer-parallellijst (juni-T12 is nooit ClickUp geworden) · K-4/K-5 show-and-block op
Requests (RLS houdt; dit is de UX-kant, niet gedekt door Review-7/7 P0) · K-6 organizer-deur-gat ·
K-7 user_manager-doodloper + RLS-nullen · K-8 doorhost-profiel-doodloper · K-9/M17 Event-Day-rij ·
K-10 cockpit-headcount-afwijking · K-13 mock-statusbalk + cockpit-feature-gaten (Refuse/reverse) ·
K-14 Vaste-wees · K-15 past-event-Edit-inconsistentie · K-16 add-guest onvindbaar op All-events ·
K-17 naamloze icoon-knoppen · K-19 dubbele "Request links"-term · K-20 Links zonder checked-in ·
W1/W5/W6.
*Afspraak uit de opdracht: geen duplicaten toevoegen — er zijn dus **geen** ClickUp-taken
aangemaakt; dat gebeurt pas na akkoord op de prioritering.*

---

## §7 — Besluitenlog 8/7 + resterende open punten

### Beslist (Max, 8/7)
- **Rollenmatrix toegevoegd** als §1b (op verzoek).
- **W1–W6, M1–M6, M8, M9, M11–M17, G2, G3, G4: akkoord** (details/verfijningen in de tabellen).
- Vraag 1 · staff & Requests → **alleen eigen aanvragen-status**, geen venue-inbox.
- Vraag 2 · organizer & Door → **volwaardige Door-tab**; geen losse "Open door"-knop (die is
  eerder bewust geschrapt, T6).
- Vraag 3 · cockpit → **volledige pariteit met de deur-functionaliteit** (Refuse, reverse, Tasks,
  Add-on-spot komen naar desktop).
- Vraag 5 · past events → **blijven bewerkbaar** ná afloop, en de recap krijgt **"Save as
  template"**. Op Home staan alleen de past events van de **afgelopen week**; ouder = alleen
  Events → Past (M11).
- Vraag 6 · Promotion-gating → organizer is inderdaad een **externe** user (event-scoped
  "External crew"); het Promotion-dashboard is **alleen voor venue-leden**; extern alleen
  per-event Links.
- M4-telregels → **vastgelegd in dit doc** (onder §5.2); verhuizen bij de bouw ook naar de
  spec-decision-tabel.

### Tweede besluitronde (Max, 8/7 — later op de dag)
- **G1: akkoord**, met toevoeging dat echte URL's ook **betere tracking** opleveren; het
  **PostHog-plan wordt bijgewerkt** zodat die sessie weet dat de single-URL-aanname vervalt
  (comment op PR #108; `screen_viewed` blijft het canonieke event, werkt vóór én na G1).
- **M7: akkoord — tweede event-lijst weg** (verwijderen, incl. More-rij).
- **M8: bevestigd** (live bedraden).
- **M10: akkoord.**
- **Vraag 4 · Analytics: besloten.** Er zijn nu geen venue-analytics die we willen tonen; dat is
  voor later (retentie, vergelijkingen). De per-event-analytics wonen onder **Events / de
  event-home**; het **Analytics-scherm blijft** en wordt **event-first** (eerst event kiezen →
  zelfde per-event-view, één gedeeld component). Uitwerking in de M6-rij.
- **Vraag 2 · badges/Check-in-sneltoetsen: staan laten** — misverstand opgehelderd, all good.

### Derde besluitronde (Max, 8/7) — plan compleet
- **Analytics-model (M6-uitwerking): akkoord.**
- **Finance = alles read-only** — inbox zichtbaar zonder beslis-knoppen. Daarmee is **alles beslist**;
  er zijn geen open punten meer.

### ClickUp-taken (klaargezet 8/7, lijst `901818739469` — volgorde = bouwvolgorde)

| Taak | Dekt | ID |
|---|---|---|
| UX/IA 8/7 — W1-W6: Consistency-wins (één kleine PR) | W1–W6 | `86ey7dz69` |
| UX/IA 8/7 — Rechten-hygiëne: role-hide i.p.v. show-and-block | M1+M9+M3 | `86ey7dz91` |
| UX/IA 8/7 — Menu-opruiming | M5+M7+M12+M15+M17 | `86ey7dzb6` |
| UX/IA 8/7 — M4: Canonieke telregels + één headcount-selector | M4 (K-10) | `86ey7dzdc` |
| UX/IA 8/7 — M6: Event-stats naar event-home + Analytics event-first | M6 | `86ey7dzmp` |
| UX/IA 8/7 — Guests & event-polish | M10+M11+M13+M14 | `86ey7dzpk` |
| UX/IA 8/7 — M2: Door-tab voor event-organizers | M2 (K-6) | `86ey7dzqv` |
| UX/IA 8/7 — M8: "Quota per event" live bedraden | M8 (implementeert Review-K1) | `86ey7dzt6` |
| UX/IA 8/7 — G2: Deur-consolidatie afronden | G2+M16 | `86ey7dzzg` |
| UX/IA 8/7 — G1: Canonieke nav + /app deep-linking | G1 | `86ey7e024` |
| UX/IA 8/7 — G3: Promotion-domein hergroeperen | G3 | `86ey7e03j` |
| UX/IA 8/7 — G4: Guests/Lijst-fusie + één persoonsmodel | G4 | `86ey7e079` |

Kruisverwijzingen geplaatst zodat niets dubbel loopt: comment op Review-**K1** `86ey6xf4p`
("live bedraden — niet verwijderen in de P5-purge; loopt via M8-taak") en op **C24** `86ey6xerx`
(overlap met M12: wie eerst bouwt, de ander bouwt voort). W3/W4 kunnen meeliften op **T13**
`86ey4j1q2` (i18n-sweep, in progress). Werkwijze blijft: **één ClickUp-taak per sessie**, elke
taak verwijst naar de betreffende secties van dit doc als bron van waarheid.
