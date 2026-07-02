# UX-walkthrough — 2 juli 2026 (browser-verificatie, lokale stack)

Alle hoofdpaden live doorlopen met browser-control op de lokale dev-server (poort 7000, verse worktree-install), met de seed-gebruikers admin@ (Max de Vries), door@ (Lisa van den Berg) en staff@ (Tom Bakker), op 1280px én 375px. Doel: verwarringspunten vinden — gesplitst in (a) live-bevestigingen/verscherpingen van de bestaande Feedback-1/7-taken en (b) nieuwe bevindingen.

Testdata achtergelaten in de lokale DB: event "UX Walkthrough Night", gast "UX Test Persoon +2" (nu VIP), Casper Mol ingecheckt. Verdwijnt bij de eerstvolgende `pnpm db:fresh`.

---

## A. Live bevestigd + verscherpt (bestaande taken)

### T1 — Onboarding/auth
- **Landing bevestigd** ("Open the app" / "Landing page (demo)").
- **NIEUW: de demo-link is kapot.** `Landing page (demo)` wijst naar `/e/frenzy-x4k9` → "The list is closed. This sign-up link isn't active anymore." Een prospect die klikt ziet een foutpagina. Verwijderen (stond al in T1) is dus ook een bug-fix.
- **Logout bevestigd visueel:** profiel toont 12+ sessies; elke sessie heeft "Log out" **behalve de huidige** ("Active now" — geen knop). Onderaan alleen "Log out everywhere". Geen enkele "sign out dit apparaat".
- **NIEUW: sessie-rommel.** Alle rijen heten identiek "Chrome · Windows · 172.18.0.1" — 12 stuks, niet te onderscheiden, geen "this device"-markering. Elke OTP-login mint een nieuwe sessie → dit groeit in prod ook vol. Aanbeveling voor T1(a): huidige sessie duidelijk markeren + stale sessies groeperen/opruimen (bv. "11 older sessions · log out all").
- Eén sessie heet alleen "Browser" (UA-parse-fallback) — zelfde hoek als de Edge/Chrome-labelbug.
- **NIEUW (voor T1c): stale MFA-badges.** More-menu toont "Audit log · MFA" en "Sessions & security · MFA" — audit is al role-only (sinds 24/6), en met MFA-optioneel kloppen deze badges straks nergens meer. Meenemen in T1(c).

### T2 — Event-create
- **Na-opslaan-navigatie bevestigd:** "Create event" → je staat terug op Home; het event staat wel in de lijst maar de flow is weg.
- Native date/time inputs bevestigd (desktop).
- **NIEUW (klein):** de event-view van een vers event leidt met live-avond-stats (On the way 0 / Inside 0 / Attendance 0%) en heeft géén setup-nudge ("add tiers", "share link") — de weg naar tiers loopt via een tandwiel-icoon. Aanvulling op T2: overweeg op een tier-loos event een setup-blok bovenaan de event-view.
- **Copy-jargon:** de rij heet "Tiers & aliases — Feed the quick-add". Een nieuwe venue-eigenaar kent "aliases" noch "quick-add".

### T3 — Tiers
- **De add-tier-affordance is live gereproduceerd als onvindbaar:** lege staat zegt "No tiers yet. Add one like 'VIP'" maar de enige actieknop is een **naamloos icoontje rechtsboven** (Joeri's "nu kan ik niks doen… jawel, rechtsboven"). T3's expliciete knoppen lossen dit op; maak van de lege staat ook een klikbare CTA.
- 6 kleuren geteld (incl. grijs) → +5 klopt met het plan.
- Editor-velden bevestigd: NAME / COLOR / MAX (optional) / DOOR PRICE (optional, "Free — e.g. 25") / ALIASES.

### T5 — Deur
- **Sticky exact omgekeerd, gemeten:** na 600px scrollen staat de search op y=-333 (weg) en plakken de filter-chips op y=215. Precies wat Joeri beschreef.
- **Filter-reset gereproduceerd + mechanisme gevonden:** filter "On the way" → gast openen → "Check in · 1 person" → terug op de lijst staat de filter op "All". Oorzaak: check-in loopt via een **gepusht Guest-scherm; de pop remount de lijst** → lokale filter-state reset. (Dus niet realtime/refetch.) Bevestigt de T5-fix: state naar de provider.
- **Tier-hardcode op z'n lelijkst:** de filter-chips tonen **"Regular | VIP | VIP"** — twee identieke VIP-chips (tiers "VIP" en "VIP + fles op tafel" krijgen hetzelfde `tierRole`-label). Niet te onderscheiden welke je filtert.
- Positief: deurlijst is alfabetisch, toont ••last-4, event-picker vooraf werkt ("Pick an event — which event are you working the door for?"), party-size-stepper + Refuse in het gast-scherm werken.

### T6 — Event Day
- **Navigatie-val bevestigd:** cockpit rendert **zonder sidebar en zonder enige terug-knop** (knoppen: alleen "Switch event / Open door app / List open" + filters). Wie hier landt kan alleen via browser-back of URL weg.
- **NIEUW: derde tier-vocabulaire.** De cockpit-tierfilter toont "All tiers | Regular | VIP + fles op tafel" — de "VIP"-tier **ontbreekt** hier. Zelfde event, drie schermen, drie verschillende tier-lijsten (add-flow: alle 3 correct · deur: VIP dubbel · cockpit: VIP weg). Alles zelfde root cause (T5-fix), maar test alle drie de oppervlakken expliciet.

### T7 — Home
- "New guest"-picker bevestigd **zonder zoekveld** ("Add guest to…" toont alleen de events).
- **NIEUW: "New event" is zichtbaar voor staff** en leidt naar een opgetuigde doodloper: het volledige formulier met "Only admins can create events." en een disabled knop. T7 haalt de knop van Home; het principe: role-hide i.p.v. tonen-en-blokkeren.
- **NIEUW (klein):** header-label "2 today"/"3 today" (naast de venuenaam) — onduidelijk of dit events of gasten telt (het zijn events).

### T8 — Team & crew
- Bevestigd: Team toont alleen venue-members; open invite (venue-type) verschijnt wél, maar heeft alleen **"Revoke"** — geen "Resend", geen accepted-status. Geen external-crew-sectie.

### T9 — Requests
- **NIEUW & belangrijker dan de badge: de tellers spreken elkaar tegen.** Home-kaart zegt "OPEN REQUESTS 1", het Requests-scherm zegt "No requests right now. The line's clear." (er is wel "DECLINED · 1"). Eén van de twee telt verkeerd (vermoedelijk telt Home declined/stale mee). Dit ondermijnt precies het vertrouwen dat de T9-badge moet geven → als repro-case in T9 opnemen: **badge en scherm moeten dezelfde bron/definitie gebruiken.**
- **NIEUW (copy):** er lekt een spec-verwijzing in de UI: *"Guest-list requests fall outside your own quota **(#31)**."* — interne besluitnummers horen niet in klant-copy (→ T13-sweep).

### T10 — Settings
- Sidebar-footer toont bij een gevuld profiel al "Max de Vries · Admin · MFA" — de e-mail die Joeri zag is de **fallback zonder naam** (T1 lost de wortel op). Maar de footer is **niet klikbaar** (geen button, cursor:auto) → T10's klik-naar-profiel bevestigd.
- **NIEUW: placeholder-als-label-patroon.** De company-velden (Company name, KVK (8 digits), VAT number, Billing email, adres) hebben géén zichtbare labels — eenmaal ingevuld zie je alleen een icoon + waarde en moet je raden wat "34567890" is. De KvK-icoon-klacht (#41) is een symptoom hiervan; de fix is persistente labels boven de velden (patroon bestaat elders al: NAME/DATE/DOORS).

### T11 — Guests
- **De "moet refreshen"-bug is preciezer dan gedacht:** na Change tier → VIP toont **het profiel zelf** nog "Regular" (de sheet sluit, niets verandert zichtbaar → voelt als mislukt). De tab-lijst ving het bij terug-navigatie wél op (remount = refetch). Fix-verscherping: de change-tier-mutatie moet óók de **person-profile-key** invalideren, niet alleen venueGuests.
- Kleur-dots ontbreken bevestigd (TIER-kolom is tekst).
- **NIEUW: dubbele naamgeving op één scherm.** De tabel (en de profiel-headerchip) tonen "GAST" — het hardcoded `tierRole`-label, bovendien **onvertaald Nederlands** — terwijl dezelfde gast in de add-flow en op de profiel-eventrij "Regular" heet. Zelfde gast, twee namen, één scherm.
- **NIEUW: sortering.** De Guests-tab sorteert oudste-eerst; een net toegevoegde gast staat onzichtbaar onderaan (viel alleen via zoeken te vinden). Nieuwste-eerst (of alfabetisch met "just added" bovenaan) past beter bij de workflow "toevoegen → controleren".
- **NIEUW (klein):** de ADDED-kolom rendert "—27 Jun" (em-dash tegen de datum geplakt — lege added-by + datum zonder spatie).

### T13 — Copy
- Concreet gevonden in deze sessie: **"GAST"** (tierRole-label, NL), spec-ref **"(#31)"** in requests-copy, jargon "Tiers & aliases — feed the quick-add". De sweep heeft dus ook de *gegenereerde* labels (tierRole) als bron, niet alleen statische strings.

---

## B. Nieuwe bevindingen zonder bestaande taak

| # | Bevinding | Ernst | Voorstel |
|---|-----------|-------|----------|
| N1 | **Breakpoint is mount-only.** Op 1280px bleef de mobiele shell staan tot een reload; pas na refresh verscheen de sidebar. Een iPad die tussen portrait/landscape roteert (of een window dat resized) houdt de verkeerde layout. Raakt ook T6 (iPad = doelgroep cockpit). | Middel | Klein taakje of bij T6: resize/rotation-listener op de shell-breakpoint. |
| N2 | **Requests-teller inconsistent** (Home zegt 1 open, scherm zegt 0) — zie T9 hierboven. | Middel-hoog (vertrouwen) | In T9 opnemen (zelfde bron voor badge én lijst). |
| N3 | **"No personal quota"** als quota-label voor admin in de add-sheet. Bedoeld: "geen limiet voor jou" — leest als "je hebt geen quota (0)". Staff-versie is wél helder ("Your quota · 7 of 15 left"). | Laag | Copy: "No limit for your role" o.i.d. — kan in T13 of T7. |
| N4 | **Nav-state niet user-gescoped:** na user-switch (dev-login) opent de app op het scherm van de vórige gebruiker (sessionStorage `po:nav-state`). In prod zeldzaam (gedeeld apparaat aan de deur!), aan de deur niet ondenkbaar. | Laag | Nav-state keyen op user-id; kan mee in T1(a). |
| N5 | Positieven om te bewaren: quick-add toont tier-chips zodra je typt ("Which tier for this guest?"); add-sheet blijft open met "JUST ADDED · 1"; inline tier-create op tier-loos event werkt; role-gating van sidebar/cockpit-panelen klopt (staff geen Door/Event Day, door@ geen Requests/Analytics/Team); mobiel 375px zonder horizontale scroll. | — | Niet slopen bij de refactors; expliciet in de test-handoffs houden. |

---

## C. Aanbevolen verwerking

1. **T1** aanvullen: demo-link = kapot (dode slug), sessie-lijst dedupe/"this device", stale "· MFA"-badges in More, nav-state per user.
2. **T2** aanvullen: setup-nudge op tier-loos event (klein), copy "Tiers & aliases".
3. **T5/T6** test-handoff: tier-weergave op **drie** oppervlakken controleren (add-flow, deur-chips, cockpit-chips) — nu drie verschillende vocabulaires.
4. **T7** aanvullen: role-hide "New event" (staff-doodloper), "N today"-label verduidelijken.
5. **T9** aanvullen: teller-consistentie Home ↔ Requests-scherm (repro: declined request telt mogelijk mee als open).
6. **T10** aanvullen: persistente labels op company-velden (placeholder-as-label-antipatroon) — vervangt de losse KvK-icoon-fix.
7. **T11** aanvullen: change-tier moet ook de profiel-query invalideren; sortering Guests-tab nieuwste-eerst; "—datum"-artefact.
8. **T13** bronnen: tierRole-labels ("GAST"), "(#31)"-lek.
9. **Nieuw klein taakje** (of bij T6): responsive breakpoint reageert niet op resize/rotatie.
