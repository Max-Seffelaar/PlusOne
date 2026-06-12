# Gastenlijst SaaS — Bouwplan & Claude Code prompts

## Werkwijze v2 (herzien)

- **Eén fase = één ClickUp-taak = één (of enkele) Claude Code-sessie(s).** Plak de prompt, review tegen de Definition of Done, vink de test-subtaak af, plak Claude's eindsamenvatting als comment.
- **Altijd live:** elke merge naar main deployt automatisch naar staging (echte Vercel + echte Supabase Frankfurt, identiek aan productie). **Een fase is pas klaar als hij op staging draait en op een telefoon is aangeklikt.** Productie blijft leeg tot de pilotvenue.
- **Fases 1–3 zijn backend-only** (schema, RLS, audit) — geen schermen, zichtbaarheid via pgTAP. Dit fundament wordt nooit "per scherm" gebouwd; security achteraf toevoegen is hoe lekken ontstaan.
- **Fases 4–10 zijn verticale plakken, scherm-eerst:** (1) bouw eerst het scherm uit het PLUSONE-design (of design-sprint-output; ontbreekt een ontwerp, dan design-system.md als enige bron), met tijdelijke mock-data; (2) bouw de backend eronder; (3) koppel en verwijder de mocks; (4) deploy naar staging en klik het na. Zo is er elke fase iets zichtbaars en testbaar.
- Niet door naar de volgende fase zolang de tests van de vorige niet groen zijn én de staging-deploy niet werkt.

---

## Fase 0 — Scaffold & infrastructuur

```
Lees CLAUDE.md en docs/spec.md volledig voordat je begint.

Zet het project op:
1. Next.js 15 (App Router, TypeScript strict), Tailwind, shadcn/ui, pnpm. PWA-basis (manifest, service worker placeholder via next-pwa of eigen SW).
2. Supabase: initialiseer `supabase/` met CLI, configureer voor een project in eu-central-1. Maak src/lib/supabase met aparte browser-client, server-client en (server-only) service-client met duidelijke "server-only" guard.
3. Vercel: vercel.json met region fra1, security headers (CSP, HSTS, X-Frame-Options DENY, Referrer-Policy), en een .env.example met alle benodigde variabelen + comment per variabele.
4. Tooling: ESLint, Prettier, Vitest, Playwright, pgTAP-testsetup via supabase test. CI-script (GitHub Actions) dat lint, typecheck, unit tests en supabase db reset + db tests draait.
5. Lege feature-mappen volgens de structuur in CLAUDE.md.

Geen features bouwen. Definition of Done uit CLAUDE.md geldt. Richt de configuratie in op TWEE omgevingen: staging en productie (twee Supabase-projecten, twee Vercel-environments, gescheiden env vars) — alle ontwikkeling en tests draaien tegen staging. Sluit af met een samenvatting + exacte stappen die ik handmatig moet doen (Supabase-projecten aanmaken, Vercel koppelen, env vars zetten).
```

**Handmatig (Max):** Supabase-project aanmaken in Frankfurt, Vercel-project koppelen aan repo met region fra1, env vars invullen, GitHub-repo aanmaken.

---

## Fase 1 — Databaseschema (migratie 1)

```
Lees CLAUDE.md en docs/spec.md (§3 datamodel, beslissingen #21–#26).

Schrijf de eerste Supabase-migratie met het volledige schema:
- Alle tabellen uit §3: users-profiel (gekoppeld aan auth.users), venues, venue_memberships (roles als enum-array), events (incl. status-enum, landing_slug, landing_active, list_locked/locked_by/locked_at), event_organizers, guest_tiers, guests (incl. status-enum met removed, anonymized_at), guest_requests, quotas, event_quotas, quota_requests, check_ins, refusals, audit_log, subscriptions (status-enum incl. comped — beslissing #32; Stripe-velden nullable, koppeling komt in fase 13).
- UUIDv7 als PK overal (pg_uuidv7 of een uuid_generate_v7() functie); FK's met ON DELETE-gedrag dat soft-delete respecteert (RESTRICT, geen CASCADE op gastdata).
- REVOKE DELETE op guests/check_ins/refusals voor authenticated.
- Indexen op de query-paden: guests(event_id, status), check_ins(guest_id) UNIQUE, audit_log(venue_id, created_at), venue_memberships(user_id).
- Seed-script met 2 venues, users in alle 6 rollen, 1 event met tiers en 30 gasten.
- Genereer database.types.ts.

Nog GEEN RLS-policies (volgende fase), maar zet RLS wel alvast AAN op elke tabel met een default-deny. Test: supabase db reset slaagt, seed laadt.
```

---

## Fase 2 — RLS-policies + tests (het securityhart)

```
Lees CLAUDE.md (RLS is de security boundary) en de rollenmatrix in docs/spec.md §2.

Schrijf RLS-policies die de rollenmatrix exact implementeren:
- Helper-functies (security definer, stable): user_venue_roles(venue_id), is_event_organizer(event_id), has_aal2().
- Per tabel policies voor SELECT/INSERT/UPDATE per rol. Let op de subtiele gevallen: staff ziet alleen eigen gasten; finance is venue-breed read-only; organisator alleen eigen events; doorhost leest de hele eventlijst maar muteert alleen check-ins/refusals en gasten binnen eigen quotum; lijst-lock (beslissing #23) blokkeert staff-mutaties; quota-verhogingen en rolwijzigingen vereisen AAL2.
- E-mailwijziging alleen door de user zelf (beslissing #24).

Schrijf pgTAP-tests die voor ELKE policy zowel het toegestane als het geweigerde pad bewijzen, per rol, inclusief: cross-venue-lek (user van venue A probeert gasten van venue B te lezen), staff die andermans gast wijzigt, mutatie op een gelockte lijst, quota-grant zonder AAL2. Minimaal 40 testcases. Alles groen bij supabase db reset && supabase test db.
```

---

## Fase 3 — Audit-triggers

```
Lees CLAUDE.md (audit via triggers) en docs/spec.md §3.

Bouw het audit-systeem:
- Generieke trigger-functie die op INSERT/UPDATE/DELETE een audit_log-rij schrijft: actor (auth.uid()), venue_id, event_id, entity_type, entity_id, action, JSONB-diff (alleen gewijzigde velden), timestamp, device_id (uit een request-header/claim indien aanwezig).
- Triggers op guests, guest_tiers, quotas, event_quotas, quota_requests, check_ins, refusals, venue_memberships en op de lock/unlock van events.
- Afgeleide acties benoemen: status->checked_in = "check_in", tier-wijziging = "tier_change", list_locked-wijziging = "lock"/"unlock", quota-verhoging = "quota_grant".
- audit_log is append-only: geen UPDATE/DELETE mogelijk, ook niet voor admins (REVOKE + geen policies).
- pgTAP-tests: elke mutatiesoort produceert exact de juiste log-entry met correcte diff; log-entries zijn onverwijderbaar.
```

---

## Fase 4 — Auth: OTP, invite-only, MFA, sessiebeheer

> **Werkwijze v2:** scherm eerst (uit design/design-system.md, met mock-data) → backend eronder → koppelen, mocks weg → deploy naar staging → live aanklikken op telefoon. Voeg aan de prompt toe: "Werk scherm-eerst volgens Werkwijze v2 bovenaan dit document en eindig met een werkende staging-deploy."

```
Lees CLAUDE.md §Auth en beslissing #20/#24 in docs/spec.md.

Bouw de volledige auth-laag:
1. Login-flow: e-mail OTP (6 cijfers), nette Nederlandse UI, rate-limit-feedback. Password-auth uitgeschakeld — documenteer welke Supabase-dashboardinstellingen ik moet zetten (signups uit, OTP aan, token-levensduur).
2. Invite-flow: admin/user manager nodigt uit per e-mail; invite maakt user + membership met rollen; accepteren = eerste OTP-login. Invites verlopen na 7 dagen.
3. MFA: TOTP-enrollment-flow (QR), verplicht afgedwongen bij eerste login voor admin/finance; AAL2-check als middleware-helper voor gevoelige routes én al afgedwongen in RLS (fase 2).
4. Sessiebeheer-scherm voor admins: per user actieve sessies/devices zien en op afstand uitloggen.
5. Profiel: user kan alleen eigen naam/e-mail wijzigen (e-mail met herbevestiging).
6. Middleware die elke route beschermt; publieke uitzonderingen expliciet gewhitelist (login, landingpages).

Pas de security-checklist uit CLAUDE.md toe op elk pad. Playwright-tests voor: login, invite-accept, MFA-enrollment, geweigerde toegang zonder AAL2.
```

---

## Fase 5 — Venue- & userbeheer

> **Werkwijze v2:** scherm eerst (uit design/design-system.md, met mock-data) → backend eronder → koppelen, mocks weg → deploy naar staging → live aanklikken op telefoon. Voeg aan de prompt toe: "Werk scherm-eerst volgens Werkwijze v2 bovenaan dit document en eindig met een werkende staging-deploy."

```
Lees CLAUDE.md en docs/spec.md §2 (rollenmatrix), beslissing #24.

Bouw het venue-dashboard voor Admin/User Manager:
- Venue-instellingen (naam, AVG-bewaartermijn in maanden).
- Userbeheer: ledenlijst met rollen, uitnodigen (fase 4-flow), rollen wijzigen (AAL2), membership verwijderen — met expliciete bevestiging en de uitleg dat alleen de toegang tot déze venue vervalt.
- Default-quota per user instellen (tabel quotas).
- Multi-venue switcher in de navigatie voor users met meerdere memberships.
- Finance-rol: zelfde schermen read-only.

Server Components + Server Actions, Zod op elke mutatie, security-checklist op elk pad. Vitest voor de action-logica, Playwright voor de happy path per rol.
```

---

## Fase 6 — Events, tiers & lijst-lock

> **Werkwijze v2:** scherm eerst (uit design/design-system.md, met mock-data) → backend eronder → koppelen, mocks weg → deploy naar staging → live aanklikken op telefoon. Voeg aan de prompt toe: "Werk scherm-eerst volgens Werkwijze v2 bovenaan dit document en eindig met een werkende staging-deploy."

```
Lees docs/spec.md §3 en beslissingen #8, #23, #26.

Bouw eventbeheer:
- Event CRUD (Admin): naam, datum/tijd (start kan over middernacht lopen — alles hangt aan het event, niet de kalenderdag), status draft/open/live/closed met expliciete overgangen en wie die mag zetten.
- Organisator-toewijzing: bestaande user of invite koppelen aan event (event_organizers).
- Tier-beheer (Admin + organisator van dat event): naam, beschrijving, kleur, optioneel max-aantal.
- Lijst-lock: knop "lijst vergrendelen/ontgrendelen" voor Admin/organisator, duidelijke banner op alle gastenlijst-schermen wanneer gelockt; mutatiepogingen door staff tonen een nette melding. Lock/unlock verschijnt in het audit log (fase 3-trigger).
- Landing_slug-generatie + landing_active-toggle (de pagina zelf is fase 8).

Tests: statusovergangen, lock-gedrag per rol (e2e), tier-max.
```

---

## Fase 7 — Gastenlijst, quota-engine & verzoekflow

> **Werkwijze v2:** scherm eerst (uit design/design-system.md, met mock-data) → backend eronder → koppelen, mocks weg → deploy naar staging → live aanklikken op telefoon. Voeg aan de prompt toe: "Werk scherm-eerst volgens Werkwijze v2 bovenaan dit document en eindig met een werkende staging-deploy."

```
Lees docs/spec.md beslissingen #4, #5, #9, #21, #22 en de quota-paragraaf in §3.

Dit is de kern. Bouw:
1. Gastenlijst-CRUD per event via QUICK ADD (beslissing #33), niet via een formulier:
   - Eén invulveld dat vrije tekst lokaal en deterministisch parseert: "Juri Braakman +2" → naam + plus_ones; "Juri Braakman VIP" of "... fles" → tier via aliassen. Patronen voor +N: "+2", "plus 2", "plus twee", "p2" (NL-getalwoorden t/m tien). Tier-matching op guest_tiers.aliases (door organisator beheerbaar in tier-beheer) met lichte fuzzy-matching ("flesje" → "fles"), langste match wint.
   - Drie gevallen, expliciet: (a) alleen een naam → default-tier, geen vraag; (b) herkende woorden → directe match; (c) ONHERKENDE extra woorden → inline vraag met tikbare chips: "'X' herken ik niet — bedoel je [tier A] · [Regular] · [hoort bij de naam]?". Nooit stilletjes naar de default-tier bij onherkende woorden; Enter werkt pas na een keuze.
   - Live preview-chips onder het veld vóór Enter: "Juri Braakman · VIP fles op tafel · +2 (3 plekken van je quotum)". Chips zijn tikbaar om te corrigeren. Naam-only input werkt ook gewoon.
   - Bulk-paste: meerdere regels plakken → previewtabel (naam/tier/+N per regel, totale quotum-impact); regels met onherkende woorden geel gemarkeerd en per regel te bevestigen via dezelfde chips, de rest gaat in één bevestiging door. Quotum-overschrijding blokkeert de hele batch met duidelijke melding.
   - Parser als pure, los geteste functie (Vitest, incl. randgevallen als namen met "plus" of tier-woorden erin); herbruikbaar in de deur-app (fase 9, ter-plekke-toevoegen).
   - Daarnaast een klassiek bewerk-formulier voor wijzigen van bestaande gasten. Verwijderen = status removed. Staff ziet/bewerkt alleen eigen gasten; organisator/admin alles van het event.
2. Quota-engine in de database: verbruik = Σ(1 + plus_ones) over niet-removed/denied gasten per user per event; default uit quotas, override uit event_quotas. Een INSERT/UPDATE die het quotum overschrijdt faalt met een duidelijke constraint/trigger-fout. Removal geeft de plek alleen terug zolang event.status != live (beslissing #22) — verbruik telt removed-gasten mee zodra het event live is of was.
3. Quotumteller in de UI: "8 van 10 over voor dit event".
4. Verzoekflow: staff vraagt X extra plekken aan met motivatie; admin ziet badge + lijst met open verzoeken, keurt goed (AAL2) of wijst af met reden; goedkeuring schrijft event_quotas-override. Alles in het audit log.
5. VIP/tier-wijziging van een bestaande gast: toegestaan volgens rollenmatrix, gelogd als tier_change.

pgTAP voor alle quota-randgevallen (+N, removal vóór/na live, override, tier-max). Vitest voor de UI-logica. Dit is de fase met de meeste fraudegevoelige logica — wees paranoïde.
```

---

## Fase 8 — Landingpage & goedkeuringsflow

> **Werkwijze v2:** scherm eerst (uit design/design-system.md, met mock-data) → backend eronder → koppelen, mocks weg → deploy naar staging → live aanklikken op telefoon. Voeg aan de prompt toe: "Werk scherm-eerst volgens Werkwijze v2 bovenaan dit document en eindig met een werkende staging-deploy."

```
Lees docs/spec.md beslissingen #12, #28 en §6 (landingpage).

Bouw de publieke aanvraagflow:
- Publieke route /e/[landing_slug]: eventnaam, datum, formulier (naam verplicht; e-mail, telefoon, +N, motivatie optioneel). Werkt alleen bij landing_active = true, anders nette "aanvragen gesloten"-pagina.
- Bescherming: rate limiting per IP (Vercel/Upstash of equivalent), honeypot-veld, dubbele-aanvraag-detectie (zelfde naam+e-mail voor zelfde event → melding "al aangevraagd" zonder te lekken wat er in het systeem staat). Geen enumeratie mogelijk.
- Goedkeuringsscherm voor admin + organisator: open aanvragen met badge, goedkeuren (kiest tier → wordt gast met source=landing) of afwijzen met reden. Geen quotum-impact: aanvragen tellen pas na goedkeuring, en goedkeuring telt op het quotum van de goedkeurder NIET — landingpage-gasten vallen buiten persoonlijke quota, wel binnen tier-max. Leg deze keuze vast in docs/spec.md als beslissing #31.
- Bevestigingspagina "je aanvraag is in behandeling" (geen statustracking voor de gast in MVP).

Security-checklist: dit is je enige publieke schrijfpad — behandel het als vijandig terrein. Playwright: aanvraag → goedkeuring → gast op lijst.
```

---

## Fase 9 — Deur-app (PWA, offline, sync)

> **Werkwijze v2:** scherm eerst (uit design/design-system.md, met mock-data) → backend eronder → koppelen, mocks weg → deploy naar staging → live aanklikken op telefoon. Voeg aan de prompt toe: "Werk scherm-eerst volgens Werkwijze v2 bovenaan dit document en eindig met een werkende staging-deploy."

```
Lees docs/spec.md §4 (sync-gedrag, Eventix-model) en beslissingen #10, #11, #25, #27.

Bouw de doorhost-ervaring als offline-first PWA-route:
1. Event openen → volledige lijst + tiers + check-in-status naar IndexedDB (TanStack Query persist).
2. Zoeken/filteren 100% lokaal, fuzzy (typo-tolerant), zoekbalk-first UI, grote tikdoelen. Gast-kaart: naam, tier-kleur, +N, toegevoegd-door, laatste 4 cijfers telefoon (beslissing #27).
3. Check-in: één tik + bevestiging, plus_ones_arrived invullen; weiger-flow met verplichte reden; ter plekke toevoegen binnen eigen quotum.
4. Outbox: mutaties offline opslaan (client-UUIDv7), optimistische UI, automatische replay bij reconnect, idempotente upserts. Dubbele check-in: server unique constraint wint, duplicaat wordt lokaal gemarkeerd en is zichtbaar in audit log.
5. Sync-statusbalk permanent: groen live (Realtime-kanaal), oranje "laatste sync X min", rood + waarschuwing na 10 min, force-sync-knop. Delta-sync bij elke visibilitychange/focus.
6. Realtime: check-ins van collega-doorhosts binnen ~1s zichtbaar.

Playwright met network-throttling/offline-emulatie: offline inchecken → reconnect → server-state klopt → audit log klopt. Dit is de meest kritieke UX van het product; test op een echte telefoon-viewport.
```

---

## Fase 10 — Audit-log-weergave & statistieken

> **Werkwijze v2:** scherm eerst (uit design/design-system.md, met mock-data) → backend eronder → koppelen, mocks weg → deploy naar staging → live aanklikken op telefoon. Voeg aan de prompt toe: "Werk scherm-eerst volgens Werkwijze v2 bovenaan dit document en eindig met een werkende staging-deploy."

```
Lees docs/spec.md beslissingen #15, #17, #26 en §6 (statistieken).

Bouw voor Admin (en Finance read-only):
1. Audit-log-scherm: chronologisch, filters op event/user/gast/actiesoort, diffs vertaald naar leesbare Nederlandse zinnen ("Max heeft Juri verplaatst van Regular naar VIP — za 23:14"). Per gast een "geschiedenis"-tab die alle entries van die gast toont — dé "wat is hier gebeurd?"-view.
2. Statistieken per event: instroomgrafiek (check-ins per kwartier), aangemeld vs. aanwezig per tier, no-shows, toevoegingen per user, weigeringen met redenen. Alles op event-niveau (beslissing #26).
3. Venue-overzicht: zelfde metrics geaggregeerd over een periode.
4. Staff ziet hier niets van; alleen de eigen quotumteller uit fase 7 (beslissing #17).

Gebruik database-views/functies voor de aggregaties (geen client-side rekenwerk over duizenden rijen). Charts met een lichte library (bijv. recharts). Read-only = ook echt read-only in RLS.
```

---

## Fase 11 — AVG: anonimisering & bewaartermijn

```
Lees docs/spec.md beslissingen #16, #29.

Bouw de privacy-laag:
1. Geplande job (pg_cron of Supabase scheduled Edge Function) die dagelijks gasten ouder dan de venue-bewaartermijn anonimiseert: naam → "Gast #<volgnr>", e-mail/telefoon → NULL, anonymized_at gezet. Idem voor guest_requests en refusal-redenen met PII.
2. Audit-log-schoning voor geanonimiseerde gasten: diffs behouden structuur maar PII-velden worden geredigeerd. Append-only blijft gelden — schoning gebeurt via een aparte, gelogde redactie-functie, niet via UPDATE-rechten voor users.
3. Instelbare bewaartermijn per venue (al in fase 5-UI), default 12 maanden, minimum 1 maand.
4. docs/privacy.md: verwerkingsregister-aanzet, datastromen, bewaartermijnen, sub-processors (Supabase Frankfurt, Vercel fra1) — als basis voor de verwerkersovereenkomst richting venues.

pgTAP: anonimisering raakt exact de juiste rijen, statistieken blijven kloppen (aantallen intact), audit log bevat geen PII meer voor geanonimiseerde gasten.
```

---

## Fase 12 — Security-audit, e2e & launch-checklist

```
Lees CLAUDE.md volledig, met nadruk op de security-checklist.

Voer een volledige audit uit en repareer wat je vindt:
1. Loop ELKE route, server action en edge function langs de security-checklist; maak een tabel (pad → checks → status) in docs/security-audit.md.
2. Probeer als aanvaller: cross-venue-toegang met een geldig token, staff die quota omzeilt via directe API-calls, mutaties op gelockte lijsten, replay van outbox-requests, IDOR op gast-IDs, landingpage-spam, service-role key in client-bundle (bundle-analyse).
3. Draai de volledige test-suite + Playwright e2e over de kernflows: invite → login → event → gasten → lock → deur-app offline check-in → audit log → statistieken.
4. Performance: deur-app lijst van 500 gasten moet instant zoeken; Lighthouse PWA-score ≥ 90.
5. Launch-checklist in docs/launch.md: Supabase-instellingen (signups uit, OTP, token-TTL, MFA), Vercel-instellingen (region, headers, env), backups/PITR aan, monitoring (Sentry of equivalent), domein + SSL.

Niets is "klaar" zolang er een rode regel in de audit-tabel staat.
```

---

## Fase 13 — Stripe Billing (optioneel voor MVP, na fase 12)

> Voorbereiding zit al in fase 1: de `subscriptions`-tabel + toegangscheck op status, met handmatige `comped`-status zodat pilots zonder billing kunnen draaien. Deze fase bouwt alleen de Stripe-koppeling.

```
Lees CLAUDE.md §Billing en docs/spec.md beslissing #32.

Bouw de Stripe Billing-integratie achter de bestaande abstractielaag:
1. BillingProvider-interface in src/features/billing/ met een StripeAdapter. Geen enkele feature buiten deze map importeert Stripe.
2. Producten/prijzen: maak een setup-script (of documenteer dashboard-stappen) voor de plannen; plan_id's in een config, niet hardcoded.
3. Checkout: Stripe Checkout-sessie per venue met UITSLUITEND SEPA Direct Debit + iDEAL als payment methods, klantgegevens (bedrijfsnaam, btw-nummer) vooringevuld, success/cancel-routes.
4. Webhook-handler (route handler, Node runtime): signature-verificatie, idempotency via opgeslagen event-IDs, verwerkt checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted → schrijft uitsluitend naar de subscriptions-tabel. Dit is een gedocumenteerde service-role-uitzondering; pas de security-checklist toe.
5. Customer portal: knop in venue-instellingen → Stripe Billing Portal (betaalmethode, facturen, opzeggen).
6. Toegangsgating: trialing/active/comped = volledig; past_due = banner + grace period van 14 dagen; canceled = venue-adminfeatures geblokkeerd, data intact, deur-app van reeds geplande events blijft werken.
7. comped-status handmatig instelbaar door ons (gelogd in audit log).

Tests: webhook-replay (zelfde event 2x = geen dubbele mutatie), elke statusovergang → juiste toegang (Vitest), Playwright met Stripe test mode: checkout → active, mislukte incasso → past_due-banner. Geen kaart-/IBAN-gegevens in onze database — verifieer.
```

**Handmatig (Max):** Stripe-account (NL-entiteit), SEPA-incasso activeren (vereist review door Stripe), iDEAL aanzetten, webhook-endpoint + secret configureren, plannen/prijzen aanmaken, btw-instellingen (21% NL B2B).

---

## Vaste reviewroutine per fase (Max)

1. Prompt plakken in Claude Code, laten draaien.
2. De **test-subtaak** van de fase uitvoeren: Claude Code de tests laten schrijven én draaien, daarna zelf `pnpm lint && pnpm test && supabase db reset && supabase test db` (en waar van toepassing `pnpm e2e`) draaien — groen of niet door. Subtaak pas afvinken als alles groen is.
3. Staging-deploy openen op je telefoon en de fase live naklikken.
4. Diff reviewen met de bril: "kan een rol hier iets wat de matrix verbiedt?"
5. Claude's eindsamenvatting als comment in de ClickUp-taak, taak afvinken.
6. Bij twijfel of scope-creep: eerst spec bijwerken, dan pas bouwen.
