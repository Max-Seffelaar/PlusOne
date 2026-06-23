# IA- & Menustructuur-audit — PlusOne Gastenlijst

> Eerlijke informatie-architectuur-audit van de hele app: alle schermen één voor één beoordeeld en
> onderling vergeleken, daaruit één canonieke menustructuur afgeleid, plus een herorden-plan voor de
> laatste puntjes. Code is de bron van waarheid (de docs lopen achter). Besluit-kader: zie de keuzetabel
> in `.claude/plans/wise-seeking-gosling.md`. **Dit doc wijzigt geen code.**

## §1 — Context & scope

De app is functioneel grotendeels af (~32 schermen/surfaces, live bedraad), maar de IA is organisch
gegroeid en voelt onlogisch. Drie structurele problemen (uitgewerkt in §3):

1. **Drift** tussen het gedocumenteerde plan en de bouw.
2. **Twee navigatie-paradigma's** door elkaar (echte tabs naast als-tab-vermomde pushes).
3. **Zes overlap-clusters** waar schermen elkaar overlappen.

**Scope:** alle surfaces — de `/app` responsive shell (alle tabs + pushed screens), de `/eventday`-cockpit,
de `/door/[eventId]`-route, de publieke landing `/e/[slug]`, en auth/onboarding.

**Leidende besluiten (Max):** één vaste nav-skelet voor álle rollen (rechten verbergen alleen acties/toegang,
nooit de structuur) · vers afleiden (niet vastzitten aan S0–S13) · labels mee, **in het Engels** (hele UI naar
Engels, EN als default + voorlopig enige locale) · pragmatische mix binnen de guardrails · pre-pilot framing
met moeite/risico per voorstel.

**Guardrails (hard):** Capacitor-proof · max ~5 bottom-tabs · de offline-deur-outbox (`DoorProvider`) blijft
ongemoeid · modals als bottom-sheets.

**Rollen (let op):** venue-rollen zijn `admin · user_manager · finance · staff · doorhost`. **`organizer`/
organisator is géén venue-rol maar event-scoped** (`event_organizers`). Capability-bron: `src/features/auth/roles.ts`
+ `access.ts` (`venueCapabilities`, `hasDashboardAccess`, `canWorkDoor`, `canManageGuests`).

## §2 — Inventaris: alle schermen/surfaces

| # | Scherm | Pad | Taak (1 zin) | Rol(len) | Data | Huidige plek |
|---|---|---|---|---|---|---|
| 1 | Home / Start | `screens/home.tsx` | Live overzicht actief event (opkomst, tiles, quick-actions) | allen | live | tab `start` |
| 2 | Events-lijst | `screens/events.tsx` `Events()` | Komende/verlopen events als kaarten | allen | live | tab `events` |
| 3 | Event-detail | `events.tsx` `EventView()` | Live stats + acties per event | allen | live | push `event` |
| 4 | Event bewerken/maken | `events.tsx` `EventEdit()` | Formulier event-instellingen | admin/org | form | push `eventedit` |
| 5 | Tiers & aliassen | `events.tsx` `Tiers()` | Per-event tier-CRUD | admin/org | live | push `tiers` |
| 6 | Verlopen event (recap) | `events.tsx` `PastEvent()` | Opkomst-recap na afloop | allen | snapshot | push `pastevent` |
| 7 | Events-beheer-hub | `events.tsx` `EventBeheer()` | Admin-lijst events (edit/recap/nieuw) | admin | live | push `eventbeheer` |
| 8 | Gastenlijst | `screens/guests.tsx` `Lijst()` | Gast-roster: filter/zoek/+toevoegen | allen (RLS: staff=eigen) | live | push `lijst` |
| 9 | Gast-detail | `guests.tsx` `Guest()` | Read-only logboek per gast | allen | mirror | push `guest` |
| 10 | Quick-add | `guests.tsx` `QuickAdd()` | Vrij-parse één gast (+N, tier) | admin/staff/door | live | push `quickadd` |
| 11 | Bulk-paste | `guests.tsx` `BulkPaste()` | Meerdere gasten plakken | admin/staff/door | live | push `bulk` |
| 12 | Adresboek | `guests.tsx` `Contacten()` | Venue-contacten herbruiken | admin/finance/org | live | push `contacten` (via Meer) |
| 13 | Permanente gasten | `guests.tsx` `Vaste()` | Vaste gasten op elke lijst | admin/org | live | push `vaste` (via Meer) |
| 14 | Deur — Check-in | `screens/door.tsx` → `CheckInList` | Offline check-in/weigeren, status-filter | admin/doorhost | outbox+RT | tab `deur` |
| 15 | Deur — Taken | `door.tsx` → `Taken` | Per-gast taken/flags afvinken | admin/doorhost | outbox+RT | tab `taken` |
| 16 | Event-dag cockpit | `(app)/eventday` → `EventDayCockpit` | Desktop live check-in + approvals + quota | admin/org/finance | RQ+RT | losse route `/eventday` |
| 17 | Deur-app (standalone) | `door/[eventId]` → `DoorShell` | Volledige deur-app (Check-in/Taken + frame) | admin/doorhost | outbox+RT | losse route `/door/[id]` |
| 18 | Aanvragen | `screens/approvals.tsx` | Inbox: landing-aanvragen + quota-verzoeken | admin/org/finance | live | push `aanvragen` (via Meer) |
| 19 | Audit log | `screens/audit.tsx` | Onveranderlijk logboek (MFA/AAL2) | admin/finance | snapshot | push `audit` (via Meer) |
| 20 | Statistieken | `screens/stats.tsx` | Venue-brede KPI's + per-event drill-down | admin/finance | snapshot | push `stats` (sidebar/Meer) |
| 21 | Profiel | `screens/settings.tsx` `Profile()` | Eigen naam/e-mail + eigen sessies | allen | live | push `profile` (via Meer) |
| 22 | Gebruikers | `settings.tsx` `Gebruikers()` | Teamleden, rollen, uitnodigen | admin/user_manager/finance | live | push `gebruikers` (sidebar/Meer) |
| 23 | Rollen-uitleg | `settings.tsx` `Rollen()` | Read-only rol-capabilities | allen | statisch | push `rollen` |
| 24 | Toelage / quota | `settings.tsx` `Allowance()` | Default gasten-per-event per teamlid | admin (edit)/finance (lees) | live | push `allowance` (via Meer) |
| 25 | Venue-instellingen | `settings.tsx` `VenueSettings()` | Naam, AVG-retentie, BTW/KVK, billing-mail | admin (edit)/finance (lees) | live | push `venuesettings` (via Meer) |
| 26 | Venue-switch | `settings.tsx` `VenueSwitch()` | Actieve venue kiezen | multi-venue | server | push `venueswitch` (header/Meer) |
| 27 | Billing | `settings.tsx` `Billing()` | Abonnement + facturen (Stripe-portal) | admin (read-only allen) | live | push `billing` (via Meer) |
| 28 | Import | `settings.tsx` `Import()` | CSV/plak/telefoon-contacten | admin/manager | form | push `import` (via Meer) |
| 29 | Admin-sessies | `screens/admin-sessions.tsx` | Apparaten teamleden remote uitloggen (AAL2) | admin | live | push `adminsessions` (via Meer) |
| 30 | Venue aanmaken | `screens/onboarding.tsx` `VenueCreate()` | Onboarding nieuwe venue | nieuwe user | form | push `venuecreate` |
| 31 | Auth-flow | `screens/auth.tsx` | Welcome/Login/OTP/MFA/Invite | anoniem | — | pre-shell |
| 32 | Landing | `landing.tsx` + `/e/[slug]` | Publiek gast-aanvraagformulier | publiek | live | losse route |
| — | Meer (hub) | `settings.tsx` `Meer()` | Settings-hub (route naar 18–29) | allen | — | tab `meer` |

## §3 — Huidige IA (as-is) + de structurele problemen

### As-is nav-boom

```
/app  (ResponsiveShell — mobiel <1024px bottom-tabs · desktop ≥1024px sidebar)
├── start  "Start"        → Home (1)
├── events "Events"       → Events-lijst (2) → push: event(3) → lijst(8)/eventedit(4)/tiers(5)/pastevent(6)
├── deur   "Check-in"     → CheckInList (14)        [alleen admin/doorhost]
├── taken  "Taken"        → Taken (15)              [alleen admin/doorhost]
├── (stats "Statistieken" → Stats (20))   ← desktop sidebar-ITEM, maar technisch een PUSH; mobiel niet in balk
├── (gebruikers "Gebruikers" → Gebruikers(22)) ← idem: sidebar-item maar PUSH; mobiel niet in balk
└── meer   "Meer"         → Meer-hub (settings) → push: stats(20)/audit(19)/aanvragen(18)/profile(21)/
                              eventbeheer(7)/venueswitch(26)/venuesettings(25)/gebruikers(22)/adminsessions(29)/
                              allowance(24)/vaste(13)/contacten(12)/import(28)/billing(27)

Losse surfaces (buiten de shell):
/eventday        → EventDayCockpit (16)      desktop, géén outbox
/door/[eventId]  → DoorShell (17)            mobiel, mét outbox
/e/[slug]        → Landing (32)              publiek
auth/onboarding  → (31)(30)
```

### Probleem 1 — Drift plan ↔ bouw
Docs beloven mobiele tabs *Events · Gasten/Deur · Stats · Meer*. De build heeft **Start · Events · Deur · Taken
· Meer**. Gevolgen: **Stats zit niet in de mobiele balk**, **Gastenlijst is geen tab** (alleen via event → lijst,
diep weggestopt), en **"Taken" is een tab die in geen enkel plan voorkomt**.

### Probleem 2 — Twee navigatie-paradigma's door elkaar
`start/events/deur/taken/meer` zijn échte tabs (wissen de nav-stack via `setTab`). **Statistieken** en
**Gebruikers** zijn op desktop sidebar-items maar technisch *pushes* (`nav.push`) — op mobiel zitten ze niet in
de balk en bereik je ze alleen diep via Meer. Een kludge in `app.tsx` (`currentKey = top?.name === 'stats' ? …`)
laat de sidebar tóch oplichten. Twee items gedragen zich dus anders dan de rest, en mobiel/desktop hebben een
ánder skelet — precies wat Max' "één vaste nav"-regel verbiedt.

### Probleem 3 — Zes overlap-clusters
| Cluster | Schermen | Verwarring | Prioriteit (Max) |
|---|---|---|---|
| **A. Vier deur-surfaces** | Deur-tab (14) · Taken-tab (15) · cockpit (16) · /door (17) | Vier ingangen voor één check-in-taak | **Hoog** |
| **B. Now × History** | Home (1) × Statistieken (20) | Twee dashboards, zelfde look, andere cijfers | **Hoog** |
| **C. Versnipperd beheer** | Adresboek (12)×Vaste (13) · Venue maken (30)/instellen (25)/switch (26) · Sessies in Profiel (21)×Admin-sessies (29) · diepe Meer | "Waar staat dit? waarom 3×?" | **Hoog** |
| D. Lijst × Aanvragen | Gastenlijst (8) × Aanvragen (18) | "Staat-ie op de lijst of nog in aanvraag?" | Laag |
| E. Drie event-surfaces | Events-lijst (2) × detail (3) × eventbeheer-hub (7) | Admin heeft een parallelle event-lijst | Midden |
| F. Tab vs push | (zie Probleem 2) | Inconsistent gedrag stats/gebruikers | Hoog |

## §4 — Ideale IA: één canonieke nav

**Principe:** één IA-boom, **responsieve onthulling**. De vijf bestemmingen + de boom zijn identiek voor élke rol;
alleen de *hoeveelheid die je direct ziet* verschilt per schermbreedte:
- **Mobiel (<1024px):** 5 bottom-tabs — Home · Events · Guests · Door · More. `More` is de overflow-hub met de 5 secties.
- **Desktop (≥1024px):** de sidebar **promoot de More-secties tot gegroepeerde sidebar-items** (er is verticale ruimte) —
  zo zie je op desktop méér in één oogopslag, zónder een ander skelet. Elk sidebar-item is een echte bestemming; niets
  is "tab op desktop / push op mobiel" (dát was Probleem 2). De mobiele `More`-tab is simpelweg de ingeklapte vorm van
  de onderste sidebar-groepen — deterministisch, geen ad-hoc kludge.

Rechten verbergen/disablen alleen ítems en acties — nooit de boom zelf.

```
TAB 1  Home      → live "nu": actief-event-kaart (grote "Open Door"-CTA bij live event), KPI-tiles,
                    quick-actions, requests-badge. (= huidige Home; Stats verhuist eruit, zie Cluster B)
TAB 2  Events    → events-lijst → event-detail (stats, requests, "Open Door") → edit/tiers/recap.
                    De admin "eventbeheer-hub" (7) smelt hierin — geen parallelle lijst meer.
TAB 3  Guests    → de gastenlijst als eersterangs bestemming (nu begraven!). Zoek/filter/+toevoegen
                    (quick-add, bulk), gast-detail, en "Contacts" (12+13 samengevoegd, Regular-toggle) als sub.
TAB 4  Door      → ÉÉN responsieve live-check-in (vervangt 14+15+16+17). Mobiel = offline shell met
                    segmenten Check-in / Tasks (DoorProvider/outbox ongemoeid); desktop = cockpit-layout.
                    /door/[id] blijft als deep-link die deze Door-modus mount; /eventday vervalt als losse UX.
TAB 5  More      → settings/beheer-hub, heringedeeld in benoemde secties (zie onder).
```

**Desktop-sidebar (≥1024px) — More-secties gepromoot tot groepen (Max: "desktop mag groter"):**
```
[venue switcher]
— Main —      Home · Events · Guests · Door
— Insights —  Analytics · Requests · Audit log
— Manage —    Team · Quota · Venue settings · Billing
[user-menu onderaan: Profile · Switch venue · Log out]
```
Mobiel klapt "Insights / Manage / user-menu" samen onder de `More`-tab. Zelfde boom, andere onthulling.

**More — heringedeelde hub (lost Cluster C op):**
```
More
├── Account            → Profile (eigen gegevens + JOUW apparaten/sessies)            [allen]
├── This venue         → Venue settings (naam, AVG, BTW/KVK) · Quota/Allowances · Billing · Import   [admin; finance read-only]
├── Team & access      → Team (leden, rollen, uitnodigen) · Roles & permissions (info) ·
│                         Team sessions & security (admin remote-logout)              [admin/user_manager; finance lees]
├── Insights           → Analytics (= Stats, hernoemd) · Audit log · Requests         [admin/finance; Requests ook org]
└── Switch venue       → venue-picker (alleen bij >1 venue)                           [multi-venue]
```

### Rechten-overlay (skelet invariant — alleen zichtbaarheid/acties verschillen)

| Tab / item | admin | user_manager | finance | staff | doorhost | organizer (event) |
|---|---|---|---|---|---|---|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Events | ✓ volledig | ✓ lezen | ✓ lezen | ✓ lezen | ✓ lezen | ✓ eigen event edit |
| Guests | ✓ alle | – leeg | ✓ lezen | ✓ eigen (quota) | ✓ alle | ✓ eigen event |
| └ Contacts/Regulars | ✓ | – | ✓ lezen | – | – | ✓ |
| **Door** | ✓ acties | read-only headcount\* | read-only\* | read-only\* | ✓ acties | ✓ acties |
| └ Add on the spot | ✓ | – | – | ✓ (eigen quota) | ✓ (eigen quota) | ✓ |
| More › Account | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| More › This venue | ✓ edit | – | lezen | – | – | – |
| More › Team & access | ✓ | ✓ (geen admin-rol toekennen) | lezen | – | – | – |
| More › Insights (Analytics/Audit) | ✓ (AAL2 audit) | – | ✓ (AAL2 audit) | – | – | – |
| More › Insights › Requests | ✓ | – | ✓ | – | – | ✓ eigen event |

\* **Open beslissing (door speed):** Door is voor iedereen zichtbaar (invariant skelet), maar voor niet-deur-rollen
read-only (alleen koppen/headcount). Alternatief als dat te veel ruis is: Door tonen maar disabled met "geen
deur-toegang". Doorhosts **landen** by default direct in Door voor het live event (landing-keuze, geen skelet-wijziging)
→ behoudt door-speed.

## §5 — Per-scherm verdict

| # | Scherm | Verdict | Nieuwe plek / actie |
|---|---|---|---|
| 1 | Home | **Behouden + herscope** | Tab Home = "nu/vandaag"; haal venue-brede analytics eruit (link naar Analytics) |
| 2 | Events-lijst | Behouden | Tab Events (root) |
| 3 | Event-detail | Behouden | onder Events; voeg "Open Door"-CTA + requests toe |
| 4 | Event bewerken | Behouden | onder Events (detail → edit) |
| 5 | Tiers | Behouden | onder Events (detail → tiers) |
| 6 | Verlopen event | Behouden | onder Events |
| 7 | Events-beheer-hub | **Samenvoegen → Events** | schrappen als apart scherm; admin-acties in Events-lijst |
| 8 | Gastenlijst | **Verplaatsen → eigen tab** | Tab Guests (root) — nu eersterangs |
| 9 | Gast-detail | Behouden | onder Guests en onder Door (gedeeld) |
| 10 | Quick-add | Behouden | onder Guests (+ in Door als "Add on the spot") |
| 11 | Bulk-paste | Behouden | onder Guests |
| 12 | Adresboek | **Samenvoegen** | met 13 → één "Contacts" (Regular-toggle), onder Guests |
| 13 | Permanente gasten | **Samenvoegen → Contacts** | wordt een filter/toggle in Contacts |
| 14 | Deur — Check-in | **Samenvoegen → Door** | wordt "Check-in"-segment van Tab Door |
| 15 | Deur — Taken | **Samenvoegen → Door** | wordt "Tasks"-segment van Tab Door |
| 16 | Event-dag cockpit | **Samenvoegen → Door (desktop)** | desktop-variant van Tab Door; `/eventday` route vervalt |
| 17 | Deur-app standalone | **Behouden als deep-link** | `/door/[id]` mount de Door-modus (PWA-entry); geen aparte UX |
| 18 | Aanvragen | **Verplaatsen** | More › Insights › Requests + Home-tile + Event-detail-badge |
| 19 | Audit log | Verplaatsen | More › Insights (AAL2) |
| 20 | Statistieken | **Hernoemen → Analytics + verplaatsen** | More › Insights; lost Cluster B/F op |
| 21 | Profiel | **Behouden → Profile + herscope** | More › Account; sessies = "jouw apparaten" |
| 22 | Gebruikers | **Hernoemen → Team + verplaatsen** | More › Team & access (geen sidebar-special-case meer) |
| 23 | Rollen-uitleg | Behouden | More › Team & access › Roles & permissions |
| 24 | Toelage/quota | **Hernoemen → Quota** | More › This venue |
| 25 | Venue-instellingen | Behouden | More › This venue |
| 26 | Venue-switch | **Herpositioneren** | header-picker + More › Switch venue (niet 3 peer-items) |
| 27 | Billing | Behouden | More › This venue |
| 28 | Import | Behouden | More › This venue |
| 29 | Admin-sessies | **Hernoemen → Team sessions** | More › Team & access (scope-naam "team" ipv "jouw") |
| 30 | Venue aanmaken | Behouden | onboarding-flow + actie in Switch venue |
| 31 | Auth-flow | Behouden | pre-shell |
| 32 | Landing | Behouden | publiek; alleen vertalen |

**Dekking:** 32/32 schermen hebben een verdict. Netto: **−6 losse schermen** (7,13 samengevoegd; 14–17 → 1 Door;
16,17 als variant/deep-link), **+1 tab** (Guests), en de stats/gebruikers-asymmetrie verdwijnt.

## §6 — Overlap-resoluties (de drie prioriteits-pijnen)

### A. De vier deur-surfaces → één responsieve "Door"
De data-laag is al gedeeld (14, 15, 17 draaien op dezelfde `DoorProvider`/outbox; alleen 16 cockpit gebruikt
React Query online). Resolutie:
- **Eén Tab "Door"** met segmenten **Check-in / Tasks** (14+15 zitten al naast elkaar — alleen samenvoegen onder
  één tab i.p.v. twee).
- **Desktop = cockpit-layout** van dezelfde tab (16 wordt de brede variant); de losse `/eventday`-route vervalt.
- **`/door/[id]` blijft** als deep-link/PWA-entry die exact de Door-modus mount (geen aparte component-boom).
- **Outbox ongemoeid** (guardrail). Mobiel blijft offline-first; desktop-cockpit blijft online.
- **Design-basis (Max):** de **`/eventday`-cockpit is de visuele basis** voor Door op desktop — niet de mobiele
  deur-shell; mobiel erft dezelfde taal, compacter.
- Fasering: (1) 14+15 → Door-met-segmenten [klein]; (2) `/eventday` → desktop-Door [groot]; (3) `/door` → deep-link.

### B. Home (now) × Statistieken (history)
Geen merge — verschillende behoeftes/rollen. Wel **scherp scheiden + hernoemen**:
- **Home** = live, één actief event, realtime "wat gebeurt er nú" (allen).
- **Analytics** (= Stats hernoemd) = venue-breed, historisch, meerdere events, snapshot/rapportage (admin/finance),
  in More › Insights. Home krijgt een "View analytics →"-link. Kill de "waarom andere cijfers?"-verwarring door
  framing **Now vs Reports**.

### C. Versnipperd beheer → benoemde More-secties
- **Contacts + Regulars** → één scherm met Regular-toggle (verifieer of beide dezelfde contact-backing delen; zo niet,
  migratie-noot). Onder Guests.
- **Venue maken/instellen/switch** → niet 3 peer-items: *switch* = header-picker, *settings* = detail in This venue,
  *create* = actie binnen Switch venue.
- **Sessies ×2** → behoud beide maar disambigueer: Account = "jouw apparaten"; Team sessions = "team-apparaten"
  (More › Team & access).
- **Diepe Meer** → 5 benoemde secties met kop i.p.v. één lange platte lijst.

## §6b — Verdere bundel-kansen (kritische pass, op verzoek van Max)

Bovenop §5/§6 — alles wat we nog méér kunnen samenvoegen:

| # | Bundel | Waarom | Verdict |
|---|---|---|---|
| A1 | **Quick-add + Bulk-paste → één "Add guests"** (modus single / plak-meerdere) | zelfde parser/quota/dedup-engine, twee ingangen | **sterk** — samenvoegen |
| A2 | **Event-detail + Verlopen-recap → één state-aware "Event"** | zelfde entiteit, alleen status upcoming/live/closed | **sterk** — één statusgestuurd scherm |
| A3 | **Import → actie binnen Contacts** | import vult het adresboek; sub-actie, geen peer-menu-item | **sterk** |
| A4 | **Roles-uitleg → contextpaneel in Team** | read-only info hoort waar je rollen toekent | midden — inline i.p.v. apart scherm |
| A5 | **Quota/Allowance → tonen binnen Team** | quotum is een eigenschap per teamlid | midden — caveat: venue-default-deel blijft This venue |
| A6 | **Add-guest-patroon unificeren** (QuickAdd ≈ Door's AddOnSpot) | beide "typ naam +N tier", zelfde `parse.ts` | **sterk** — één gedeelde component, twee contexten |

Netto bovenop §5: nog eens ~4–5 losse `push`-schermen verdwijnen of worden contextueel. Dit duwt de IA naar
**minder schermen, meer status-/context-gestuurde surfaces** — precies de ontrommeling die je wilt.

## §7 — Label-voorstellen (NL → EN)

**Navigatie-skelet:** `Start → Home` · `Events → Events` · *(nieuw)* `Guests` · `Deur/Taken → Door`
(segmenten **Check-in / Tasks**) · `Meer → More`.

**Schermen / secties:** Gastenlijst → **Guest list** · Gast → **Guest** · Quick-add → **Quick add** ·
Bulk → **Paste list** · Adresboek → **Contacts** · Permanente gasten → **Regulars** (toggle) ·
Aanvragen → **Requests** · Statistieken → **Analytics** · Audit log → **Audit log** ·
Gebruikers → **Team** · Rollen → **Roles & permissions** · Toelage → **Quota** ·
Venue beheren → **Venue settings** · Venues/wisselen → **Switch venue** · Venue aanmaken → **New venue** ·
Profiel → **Profile** · Abonnement & facturen → **Billing** · Importeren → **Import** ·
Sessies & beveiliging → **Team sessions** · Events & tiers → **Events** · Verlopen event → **Event recap**.

**More-secties:** Jouw bedrijf → **This venue** · (nieuw) **Account / Team & access / Insights / Switch venue**.

**Domein-termen (consistent houden):** Guest list · Check-in · Door · Tier · Plus-ones (+N) · Quota · Requests ·
Regulars · On the way / Checked in · Refuse.

## §8 — Engelse-vertaling-workstroom

**Eerst tone-of-voice (Max, 2026-06-23):** vóór de vertaling schrijven we één **tone-of-voice / copy-guide (Engels)**
(eigen doc, herbruikbaar buiten de app) zodat alle gegenereerde copy consistent en on-brand is. De catalogus is het
*waar*, de tone-of-voice het *hoe*. Dit is een **prerequisite** voor T7/T13.

**Aanpak:** introduceer één **gecentraliseerde message-catalogus** (bv. `messages/en.ts` of `next-intl` met `en`
als default). Engels is nu de enige locale, maar **geen inline-literals meer** — zo is een 2e taal later een
vertaalbestand, geen refactor (sluit aan op #37 Capacitor + de billing-abstractie: "leg de naad nu").

**Sequencing (belangrijk):** vertaal **ná** de structuur-wijzigingen, op de schermen die blijven bestaan. Vertaal
géén `vaste`/`eventbeheer` los — die smelten samen. Volgorde: nav-skelet & titels eerst (klein, hoge zichtbaarheid),
dan per scherm de body-copy.

**Copy-volume per scherm (uit de inventaris):**
| Scherm | Volume | Let op |
|---|---|---|
| Gast-detail | **Zwaar** (~25) | logboek-zinnen, taak-statussen, weiger-flow — context-gevoelig |
| Landing | Midden-zwaar (~15) | form-labels + validatie + dynamische copy |
| More/Settings | Midden-zwaar | veel rij-titels + subs + lege-staat-teksten |
| Deur Check-in | Midden (~20) | segment/stat-labels ("koppen", "nog aan de deur") |
| Add on the spot | Licht-midden (~8) | quota-teksten + quick-add-instructie |
| Taken / Door-shell / Home | Licht | filter-labels, groet, "Terug" |

Ruwe schatting deur-surfaces alleen: **~80–100 zichtbare strings**; hele app vermoedelijk enkele honderden.

**Niet vergeten:** datum-/tijdformaat NL→EN (Home-groet, event-tijden) · quick-add-parser (`src/lib/po/parse.ts`,
#33) checken op NL-tokens · `ROLE_LABELS` (Beheerder/Personeel/Deurhost…) mee vertalen · validatie-/toast-teksten.

**Docs die de conventie moeten bijwerken:** `CLAUDE.md` ("Dutch UI copy, English code" → "English UI copy") ·
`gastenlijst-app-spec.md` (UI-copy-noten) · `design-system.md` (eventuele copy) · de launchplan-briefs.

## §9 — Oud → nieuw map + doc/S-ID-updates

| Oud (S-ID / route) | Nieuw |
|---|---|
| S11 Dashboard-home | **Home** (tab, herscoped naar "now") |
| S1 Events + S9 EventBeheer | **Events** (tab; hub samengevoegd) |
| S2 Gastenlijst + S3 Adresboek | **Guests** (tab) + **Contacts** (merge Adresboek+Permanente gasten) |
| S4 Deur-tab + S13 Cockpit + /door + Taken | **Door** (tab, responsive; cockpit = desktop-variant; /door = deep-link) |
| S5 Aanvragen | **More › Insights › Requests** (+ Home-tile) |
| S10 Audit | **More › Insights › Audit log** |
| Stats | **More › Insights › Analytics** |
| S6 Gebruikers+Rollen | **More › Team & access** |
| S7 Profiel+Sessies | **More › Account** (jouw apparaten) + **Team sessions** (team) |
| S8 Venue-instellingen + S12 Billing | **More › This venue** |
| Venue-switch/create | header-picker + **More › Switch venue** |

**Te updaten:** launchplan-claude-code.md (S-inventaris hernummeren naar de 5-tab-structuur) · gastenlijst-app-spec.md
(decision-tabel: nav + UI-taal) · CLAUDE.md (#38 "two-then-one surface" → 5-tab-skelet; "Dutch UI" → "English UI") ·
de memory-notes die naar oude tab-namen verwijzen.

## §10 — Geprioriteerde takenlijst (ClickUp-klaar)

Moeite **S/M/L** · risico **laag/midden/hoog**. "Nu" = pre-pilot, lage-risico helderheids-winst. "Later" = grotere
refactor, na de pilot of apart ingepland.

**T0 (prerequisite, nu eerst):** schrijf de **tone-of-voice / copy-guide (Engels)** — gate voor T7 (nav→Engels) &
T13 (volledige vertaling). Moeite S-M · risico laag.

**NU (lage-risico, hoge helderheid):**
| # | Taak | Scope | Moeite | Risico |
|---|---|---|---|---|
| T1 | **Guests als eigen tab** | gastenlijst (8) uit de event-push lichten → top-level tab; sub: detail/quick-add/bulk | M | laag-midden |
| T2 | **Tab-vs-push-asymmetrie weg** | Stats/Gebruikers normale More-pushes; verwijder sidebar-special-case + `currentKey`-kludge in `app.tsx` | S-M | laag |
| T3 | **More herindelen in 5 secties** | Account / This venue / Team & access / Insights / Switch venue + koppen | M | laag-midden |
| T4 | **Home ↔ Analytics scheiden** | Stats → "Analytics" naar More › Insights; Home = "now" + "View analytics →" | S | laag |
| T5 | **Venue-schermen consolideren** | switch=header-picker, settings=detail, create=actie — niet 3 peer-items | S-M | laag |
| T6 | **Sessies disambigueren** | Account="jouw apparaten" · Team sessions="team-apparaten" + hernoemen | S | laag |
| T7 | **Nav-skelet + titels naar Engels** | message-catalogus opzetten + nav/skelet/titels als eerste vertaalpass | M | laag |

**LATER / OPTIONEEL (grotere refactor):**
| # | Taak | Scope | Moeite | Risico |
|---|---|---|---|---|
| T8 | **Deur-unificatie fase 1** | Deur+Taken → één Door-tab met segmenten Check-in/Tasks | M | midden |
| T9 | **Deur-unificatie fase 2** | `/eventday`-cockpit → desktop-variant van Door; losse route vervalt | L | midden-hoog |
| T10 | **Deur-unificatie fase 3** | `/door/[id]` → deep-link die Door-modus mount (outbox ongemoeid) | M | midden |
| T11 | **Contacts + Regulars samenvoegen** | één Contacts-scherm met Regular-toggle (data-backing verifiëren) | M | midden |
| T12 | **EventBeheer-hub → Events** | admin-acties in de Events-lijst; parallelle lijst schrappen | M | midden |
| T13 | **Volledige Engelse vertaling** | alle resterende copy via catalogus (~enkele honderden strings) | L | laag-midden |
| T14 | **/app deep-linking** | Capacitor-veilige per-scherm URLs (enabelt T10) | M | midden |
| T15 | **Tablet-layouts (641–1023px)** | nieuwe 5-tab-skelet op tablet | M | midden |
| T16 | **Docs/spec/S-IDs bijwerken** | launchplan/spec/CLAUDE.md/memory naar nieuwe structuur + EN-conventie | S | laag |
| T17 | **Add-guests unificeren (A1+A6)** | Quick-add + Bulk-paste → één "Add guests"; gedeelde add-component met Door's AddOnSpot | M | midden |
| T18 | **State-aware Event (A2)** | Event-detail + Verlopen-recap → één statusgestuurd Event-scherm | M | midden |
| T19 | **Import in Contacts (A3)** | Import wordt sub-actie binnen Contacts i.p.v. peer-menu-item | S-M | laag-midden |

**Aanbevolen eerste sprint:** T1–T4 + T7 (skelet recht, Guests zichtbaar, More opgeruimd, Home/Analytics helder,
Engels begonnen) — allemaal laag risico, samen lossen ze Probleem 1, 2 en pijn B/C grotendeels op. Pijn A
(deur-unificatie) is de grote brok en hoort in een eigen sessie (T8→T10).

## §11 — Open beslissingen voor Max

1. **Door-zichtbaarheid voor niet-deur-rollen** (§4): read-only headcount, of disabled-met-uitleg? (Door-speed via
   role-based landing blijft hoe dan ook overeind.)
2. **Home-naam:** "Home" of "Today"/"Overview"? (Analytics neemt de "stats"-lading over.)
3. **Account vs Profile** als label voor scherm 21.
4. **Pilot-taal-toets:** Engelse deur-copy testen op NL-sprekende staff/doorhosts i.v.m. door-speed (kernwaarde).
