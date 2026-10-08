# Onboarding-programma oktober 2026 — sequentieel draaien zonder orchestrator

> Status: **concept, wacht op wave 0 (spikes)**. Dit is het *hoe* bij het plan-doc "PlusOne — Onboarding feedback plan (okt 2026)" (Claude Docs, https://claude.ai/code/artifact/79de5608-f9a8-4cc6-ac07-047ff333f9a9) en de ClickUp-taken in lijst 901818739469. Bron: Joeri's onboarding-walkthrough en de besluiten van Max op 2026-10-06. Zelfde mechaniek als `capacitor-orchestration-claude-code.md`, met één verschil: er loopt niets parallel, dus er is geen orchestrator-sessie. Dit document ís de orchestrator.

## 0. De drie antwoorden

**Eén voor één als default, parallel per golf waar bestanden niet overlappen (§2b, herzien 2026-10-06 avond).** Oorspronkelijke redenering: Max merget, test en doet de externe stappen (Stripe, Google, Resend, Supabase-template), dus hij is de bottleneck, niet de bouwcapaciteit. Parallel bouwen levert hier alleen merge-conflicten op (Venue → Company raakt elke string in elke screen; A en G zitten allebei in de onboarding-wizard; C en B in dezelfde event-screens) en botst met de één-DB-eigenaar-regel. Sequentieel vervalt dat allemaal. Een orchestrator die tussen twee sequentiële taken zit te wachten verbrandt alleen context. Daarom: Max plakt per taak de ingevulde worker-brief uit §4 in een nieuwe sessie, na de merge van de vorige. De reviewer-sessies (§5) blijven, want die zijn de review gate uit CLAUDE.md.

**Wave 0 is een spike-sessie, geen bouwsessie.** Vijf vragen bepalen de bouw van D, E, A en F en zijn uit de code alleen niet te beantwoorden. Eén Opus-sessie beantwoordt ze, schrijft de antwoorden in §9 van dit document en als comment op de betreffende taak, en levert geen PR behalve dit document. Pas daarna start taak 1.

**Model: alles op Opus, de copy-sweep en Sentry-hygiene op Sonnet (besluit Max 2026-10-06: Fable kost te veel tokens voor orchestratie en review).** Wijkt daarmee af van de standaardrouting in CLAUDE.md; Fable alleen nog waar een worker-brief het expliciet vraagt voor een RPC-ontwerp. Venue → Company is grotendeels mechanisch (strings), maar de event-locatie erin is een migratie plus adapter; daarom Opus met de instructie om de sweep zelf niet te "verbeteren".

## 1. Mechaniek

- **Eén worker tegelijk.** Een nieuwe sessie per taak, gestart met de brief uit §4. Rename: `/rename <exacte taaknaam>`. De worker volgt de `clickup-task`-skill van pickup tot end-of-session-comment en zet zijn eigen ClickUp-status.
- **Volgende taak pas na merge.** De worker rebased niet op open PR's; hij start op `origin/main` waar de vorige taak al in zit. Dat is de hele reden voor de volgorde in §2.
- **Max merget.** Branch protection staat aan. De worker levert een draft-PR, CI groen, test-handoff. Max test, antwoordt "1 ✅, 2 ❌ — …", merget, en doet de prod-push van migraties vanuit de linked main-checkout (CLAUDE.md "Prod-push flow"). Pas dan de volgende brief.
- **Stack in de sessie:** remote container → `pnpm stack` (eerste keer circa 5 minuten); laptop → de lopende lokale stack. Vóór een pgTAP-run `pnpm db:fresh`, en alleen als niemand anders op die stack test.
- **Migratie-timestamps zijn hier toegewezen** (§3), niet door workers gekozen. De worker checkt zijn timestamps tegen `origin/main` vóór de eerste push: `git ls-files supabase/migrations | grep 202610`. Op 2026-10-06 bestaan `20261006120000` t/m `20261006170000`; alles hieronder ligt daarna.
- **Gedeelde bestanden:** omdat er niets parallel loopt, is er geen wachtlijst. Wel een scope-hek per taak (§4), zodat een worker geen werk van een latere taak alvast meeneemt. Buiten het hek = stoppen en melden in de PR, niet bouwen.
- **Review gates:** P1 (layout en middleware = auth), D (RLS op `check_ins`), G (billing, service-role-RPC's, platform-RPC's), F (webhook, mail-infra, publieke afmeld-route), E en Q (SECURITY DEFINER-RPC's met quota-math), P2 (middleware, RLS, service worker) en de invite-metadata in A zijn high-risk. De worker schrijft ongevraagd de security-research-prompt in de PR-body; Max start daarna de reviewer-sessie uit §5 vóór hij merget.
- **Copy:** nieuwe strings komen uit `docs/copy-prompt.md`. UI-taken: de worker genereert per nieuwe string drie varianten, kiest er één, en zet de drie plus zijn keuze in de PR-body onder "Copy choices"; Max kan in de test-handoff een andere kiezen. Mails (A en F): de copy wordt **vóór** de taak gekozen in een aparte sessie (§6), zodat de worker definitieve teksten krijgt.
- **Visueel bewijs per PR (QA-0):** elke UI-taak voegt een flow toe in `tests/flows/` en draait de flow-harness (`scripts/flow-shots/`): screenshots per stap per device, inclusief de native-shell-simulatie, als CI-artifact met contact sheet in de PR. De test-handoff-vragen die een machine kan beantwoorden staan als asserts in die flow; de handoff in de PR markeert per vraag ✅ automatisch / 👁 screenshot / 🖐 handmatig. Max kijkt naar de contact sheet en beantwoordt alleen de 🖐-vragen. §2 krijgt per taak een link naar het laatste bewijs.
- **Spec en CLAUDE.md:** elke taak die een beslissing herziet (#10, #32, #40, terminologie) werkt `gastenlijst-app-spec.md` in dezelfde PR bij. CLAUDE.md alleen als een invariant verandert (bijv. "één plan", "venue heet company in de UI", "gastmail is toegestaan"). `docs/changelog.md` per taak, nieuwste bovenaan.

## 2. Volgorde en exit-criteria

| # | Taak | ClickUp | Model | Wacht op | Exit-criterium | Bewijs |
|---|---|---|---|---|---|---|
| 0 | Spikes | geen (dit doc §9) | Opus | niets | §9 ingevuld; comments op D, E, A, F; Max' open besluiten uit §9 beantwoord | — |
| 0a | QA-0 flow-screenshots + handoff-automatisering | zie ClickUp "QA-0" | Opus | 0b (P1 gaat voor: snelheid is de acute pijn) | gemerged; `pnpm qa:flows onboarding` geeft vier varianten met contact sheet; CI-job + PR-comment; native-shell-guard als vaste flow | draft-PR van `claude/qa-0-flow-shots` → CI-job `flow-shots` → artifact `flow-contact-sheets` + sticky PR-comment |
| 0b | Snelheid P1 (quick wins) | z8uq9m2xyn | Opus | 0 | gemerged; prod-push (index + invites-policy); layout ≤ 2 roundtrips; geen `revalidatePath` meer in po-mutaties; terugkeer naar een tab zonder server-fetch | — |
| 0c | Notificaties N1 (push bundelen) | z8uq9m2yvk | Opus | 0b | gemerged; prod-push; 30 aanvragen in 2 minuten geven 10 directe pushes en daarna één per uur met het aantal | — |
| 0d | Crew-bug (bestaand account als crew) | z8uq9m2yvp | Opus | 0b | gemerged; `staff@` (bestaand account) is als crew toe te voegen aan een event van de andere seed-company en ziet alleen dat event | — |
| 0e | Mail-infra F0 (Resend + team-invite mails) | z8uq9m2yvt | Opus | 0d; Max: Resend-key | gemerged; prod-push; team-invite naar een bestaand account en crew-toevoeging geven een echte mail (geen magic link meer); webhook idempotent | — |
| 0f | Sentry-hygiene S1 | zie ClickUp "Sentry-hygiene S1" | Sonnet | 0b | gemerged; verwachte gebruikersfouten (42501, exists, validatie, already_handled, billing_*) komen niet meer in Sentry; Supabase-fouten hebben een leesbare titel en `code`-tag; EvalError-bron bekend | — |
| 0g | Last-admin-guard (bug: eigenaar kan zichzelf verwijderen) | n.n.b. | Opus | 0b | gemerged; prod-push; de laatste admin van een company kan zichzelf niet verwijderen of degraderen, ook niet via de API; knop verborgen in Team |
| 1 | Venue → Company | z8uq9m2vqc | Opus | 0 | gemerged; `pnpm e2e:layout` groen; geen "venue" meer zichtbaar in de UI; event met eigen locatie zichtbaar op de eventkaart | — |
| 2 | Billing G | z8uq9m2vrz | Opus | 1 | gemerged; prod-push; onboarding zonder plan/betaalstap; Platform-tab kan trial verlengen en "always free" zetten; native toont alleen status en de neutrale zin (e2e-guard native-shell groen); Max' Stripe-stappen (§6) klaar vóór de env-vars live gaan | — |
| 2b | Platform R | z8uq9m2ybj | Opus | 2 | gemerged; prod-push; invite-rij toont company-chip met Switch, events, status, activiteit; Overview toont status-tellingen, MRR/ARR, trial-funnel, gebruik; manager@ ziet niets | — |
| 2c | Billing-mails B1 | z8uq9m2z19 | Opus | 0e, 2, 2b; copy gekozen | gemerged; prod-push; seed-trials op dag 7/12/14/21 krijgen elk precies één mail per run; Platform-tab toont de tijdlijn per company | — |
| 3 | Onboarding A | z8uq9m2vg5 | Opus | 2 | gemerged; comped-invite werkt end-to-end; Places op het adresveld; één DPA-checkbox; nieuwe invite-mail in Mailpit en in prod gezien | — |
| 3b | Event-locaties L (opgeslagen locaties per company; publiek altijd de event-locatie) | n.n.b. | Opus | 3 | gemerged; prod-push; deellink en statuspagina tonen altijd de event-locatie, nooit het companyadres; per event een opgeslagen locatie kiezen | — |
| 4 | Check-in D | z8uq9m2vg6 | Opus | 0 (ontwerp), 1 | gemerged; groep-knop en per-persoon-knop; doorhost kan niet uitchecken tenzij de setting aan staat, ook niet via de API | — |
| 5 | Event C + Dashboard B | z8uq9m2vg7 + z8uq9m2vg8 | Opus | 1 | één PR, twee taken; gemerged; test-handoff beantwoord | — |
| 5b | Share-import S2 (deel vanuit WhatsApp/Mail/Notes/Excel naar PlusOne) | n.n.b. | Opus | 1 | gemerged; een gedeelde tekst uit WhatsApp landt op Paste a list met event- en tier-keuze, +N en e-mail herkend, telling "6 entries = 9 guests (2 with email)"; werkt als Android-PWA en in de Android-shell; iOS Share Extension naar het Capacitor-programma |
| 6 | Gastcommunicatie F | z8uq9m2vpy | Opus | 1, 2 (company-contact zit in settings), copy gekozen | gemerged; prod-push; een handmatig toegevoegde gast met e-mail krijgt binnen een minuut "You're on the list"; afmeldlink werkt; bounce-webhook idempotent | — |
| 7 | Requests E | z8uq9m2vga | Opus | 6 | gemerged; prod-push; splitsen, inkorten, deels afwijzen met verplichte opmerking; statusmail via F | — |
| 8 | Quota-aanvraag Q | z8uq9m2xyp | Opus | 7 | gemerged; prod-push; aanvrager ziet de beslissing op Home; akkoord met gast-gegevens zet de gast op de lijst | — |
| 9 | Snelheid P2 | z8uq9m2xz2 | Opus | 8, of eerder als Max na P1 nog traagheid ziet | per PR gemerged; tab-wissel zonder server-fetch; 300-events-seed laadt alleen het venster | — |
| 10 | Analytics PH (PostHog, plan in docs/posthog-implementation-plan.md) | nog aan te maken | Opus | 9; Max' go | PR 1 foundation + PR 2 instrumentation gemerged; cookie-banner op publieke routes; opt-out in Profile; subprocessor PostHog van C naar A; geen PII in events (lint-test) | — |
| ∥ | Legal | z8uq9m2vh6 | Opus | niets (andere repo) | documenten op eenmanszaak; Google en Resend op de subprocessorlijst; `TERMS_VERSION` gebumpt als de tekst materieel wijzigt | — |

Taak 5 combineert C en B omdat ze dezelfde event- en dashboard-screens raken; de worker houdt beide ClickUp-taken bij (comment op allebei, zoals de skill voorschrijft).

## 2b. Golven (herzien 2026-10-06 avond: wél parallel waar de bestanden niet overlappen)

De sequentiële regel uit §0 blijft de default, maar met twintig taken en ADE over ruim een week is "één voor één" te traag. Wat parallel kan, is wat elkaars bestanden niet raakt; de scope-hekken in §4 zijn daarvoor de grens. Eén orchestrator-sessie voor alle golven (Opus; prompt in §2c, golf-blokken in §2d); de stand leeft in deze tabel, niet in de sessie.

| Golf | Parallel | Wacht op | Waarom dit samen kan |
|---|---|---|---|
| A | Spikes (0) · Snelheid P1 (0b) · Notificaties N1 (0c) · Sentry-hygiene S1 (0f) · QA-0 (0a) · Legal | niets | P1 = layout/hooks/actions; N1 = migraties + push-dispatch; S1 = capture.ts + error-handlers; QA-0 = scripts/tests/CI; Legal = andere repo. Geen overlap. S1 blijft uit PoLiveProvider behalve de twee error-handlers. |
| B | Venue → Company (1) · Mail-infra F0 (0e) · Crew-bug (0d) | A gemerged (P1 raakt `events/actions.ts`) | De sweep raakt strings en screens; F0 is nieuwe mail-code + webhook; de crew-bug zit in één action. F0 raakt `events/actions.ts` alleen voor de crew-mail-aanroep en rebased na de crew-bug. |
| C | Billing G (2) · Check-in D (4) | B gemerged | G = billing/onboarding/platform-venues; D = door + check_ins-RLS + één toggle in Company settings. Twee reviewer-sessies. |
| D | Platform R (2b) · Onboarding A (3) · Event C + Dashboard B (5) | C gemerged | R = platform-schermen + RPC's; A = invites/VenueStep/Places; C+B = event- en dashboard-screens. A raakt VenueStep, G heeft de wizard al vereenvoudigd. |
| E | Billing-mails B1 (2c) · Gastcommunicatie F (6) | D gemerged | B1 = billing-templates + job + platform-tijdlijn; F = gastmail + settings + prefs. Beide op F0. |
| F | Requests E (7) → Quota Q (8) → Snelheid P2 (9) → Analytics PH (10) | E gemerged | E en Q delen de request-RPC's; P2 raakt navigatie en RLS; PostHog raakt root-layout, consent-copy, settings en de service worker en komt daarom na P2. Niet ADE-kritiek: Platform R levert de funnel-cijfers uit de eigen database. |

### Status golf A (orchestrator, 2026-10-06)

| Taak | PR | Status | Prod |
|---|---|---|---|
| 0 Spikes (§9) + seed-fix | [#402](https://github.com/Max-Seffelaar/PlusOne/pull/402) | gemerged | n.v.t. (docs + seed) |
| 0f Sentry-hygiene S1 | [#404](https://github.com/Max-Seffelaar/PlusOne/pull/404) | gemerged, na orchestrator-review (2 fixes: online-TypeError niet als netwerk taggen; 23502/23514 blijven gerapporteerd) | n.v.t.; Max checkt over een week in Sentry of de vier gebruikersfout-issues wegblijven |
| 0c Notificaties N1 | [#405](https://github.com/Max-Seffelaar/PlusOne/pull/405) | gemerged, na reviewer-ronde (2 should-fix verwerkt: complete alleen eigen claim, lock_timeout 2s → directe push) | `20261007110000` op prod, `push-dispatch` v2 gedeployd (geverifieerd) |
| 0a QA-0 | [#406](https://github.com/Max-Seffelaar/PlusOne/pull/406) | gemerged; `flow-shots`-job draait vanaf nu op elke UI-PR | n.v.t. |
| 0b Snelheid P1 | [#408](https://github.com/Max-Seffelaar/PlusOne/pull/408) | gemerged (`a3613ad`), na reviewer-ronde (3 should-fix verwerkt: count weer `exact`, vastgepinde gastenlijst wacht op zijn event, onboarding-embed los van de membership-lijst; plus badge voor platform-admin). Layout: 16 → 6 Supabase-calls in 2 golven, 1 GoTrue. | Max: prod-push `20261007100100` + `20261007100200`; daarna Vercel P75 `/app` meten (vóór 508 ms, doel ≤ 200 ms) |
| ∥ Legal | andere repo | niet gevolgd in deze sessie | — |

Besluiten Max na de spikes (2026-10-06): geen gate-fix in taak 2; taak 4 kapt een te hoog deuraantal af op het maximum (niet weigeren); taak 7: een approver kiest voorlopig uit alle tiers van het event (besluit 18 heeft geen basis in het datamodel); taak 3 gebruikt de template-route voor de invite-mail (geen hook); de Places-key wordt beperkt op de Places API + quota + budget-alert (geen referrer-restrictie, server-key). Alle 13 trialing venues in prod staan sinds 2026-10-06 op `comped` (runbook `docs/stripe-setup.md` §5, 13 audit-rijen).

Lessen golf A voor de volgende orchestrator:
- Workers openen draft-PR's; Max ziet drafts niet makkelijk. De orchestrator zet een PR op ready-for-review zodra zijn oordeel "klaar" is en geeft de link.
- GitHub draait geen CI op een PR met een merge-conflict. Bij parallelle PR's conflicteert `docs/changelog.md` na elke merge: de orchestrator merget `origin/main` in de resterende branches (beide entries houden) direct na elke merge.
- `pnpm test` = vitest watch-mode: workers draaien `CI=1 pnpm test` in de voorgrond.
- Een worker die "klaar" lijkt kan alleen lokaal gecommit hebben: controleer `git ls-remote` en de PR, niet de sessiestatus. De orchestrator wacht met een achtergrond-watcher op branch-pushes en PR-subscriptions, niet op Max.
- ClickUp-ID's voor QA-0 en S1 stonden niet in de repo; zet taak-ID's in §2 vóór de golf start.
- P2-notities uit de P1-review staan in `docs/perf-audit-2026-10.md` (eigen organizer-wijziging ververst de layout niet; single-event headcount met `p_since`; staff-gastenvenster loopt bij 30k gasten in de statement-timeout, ook op main).
- Follow-ups (geen golf-A-scope): `po/mutations.ts` gooit `new Error(res.message)` en verliest de MutationError-`code` (S1 matcht daarom op copy; een `MutationFailure extends Error { code }` maakt dat overbodig); `pnpm dev:mfa` brengt de gedropte `set_venue_plan(uuid,text,boolean)`-overload terug en breekt de plan-stap lokaal (QA-0-vondst); P1 liet `usePoEvents`-staleTime staan omdat guest-mutaties `poKeys.events` niet invalideren (P2).

### Status golf B (orchestrator, 2026-10-07; loopt nog)

| Taak | PR | Status | Prod |
|---|---|---|---|
| 1 Venue → Company | [#414](https://github.com/Max-Seffelaar/PlusOne/pull/414) | gemerged (`0ab6f36`); handoff 14 ✅ | `20261007120000` op prod (geverifieerd) |
| 1 follow-up A | [#417](https://github.com/Max-Seffelaar/PlusOne/pull/417) | gemerged (`fd685e6`): Company-veld uit New event, magic-link-copy "company" (Max plakte het dashboardtemplate), flow Q16 | n.v.t. |
| 1 follow-up B | [#419](https://github.com/Max-Seffelaar/PlusOne/pull/419) | gemerged (`7821f4b`): templates bewaren de event-locatie; handoff 15 ✅ | `20261007135000` op prod (geverifieerd) |
| 0e Mail-infra F0 | [#413](https://github.com/Max-Seffelaar/PlusOne/pull/413) | gemerged (`ba0bdfa`) na drie schone reviewer-rondes; handoff 5 ✅ 6 ✅ 7 ✅ | `20261007130000` op prod (geverifieerd); env-vars in Vercel |
| 0d Crew-bug | [#412](https://github.com/Max-Seffelaar/PlusOne/pull/412) | gemerged (`fb6158b`) na drie reviewer-rondes: crew via uitnodiging + expliciet accepteren (banner + onboarding-stap), login accepteert nooit crew, geen 60-s-orakel, "Waiting to accept" met intrekken, quota bij her-invite; handoff 19 ✅ 20 ✅ 22 ✅ 23 ✅, 21 = nieuw adres krijgt nog de Supabase-mail (→ vervolg B) | `20261007140000` op prod (geverifieerd, versie 87e370f) |
| 0d vervolg A | volgt | in bouw (0d-worker): team- én crew-invites nooit meer bij login accepteren; Accept/Decline per invite (Home + onboarding), `declined_at`; decline-mail aan de uitnodiger (ingetypt e-mailadres, nooit profielnaam) + bevestiging aan de weigeraar in de app én per mail; Team → External crew krijgt Manage (quota per event + Remove from crew); verouderde comments | `20261007150000` vóór merge pushen, merge direct erna |
| 0d vervolg B | volgt | na vervolg A (zelfde worker, raakt ook `invite-mail.ts`): één uitnodigingsmail voor iedereen, nieuw adres via `generateLink` + onze Resend-template i.p.v. de Supabase-mail | evt. `20261007170000` |
| docs | [#415](https://github.com/Max-Seffelaar/PlusOne/pull/415), [#420](https://github.com/Max-Seffelaar/PlusOne/pull/420) | gemerged | n.v.t. |

Incident golf B (2026-10-07, ~09:15–09:25 UTC): de prod-push voor #414 werd per ongeluk vanaf de branch van #413 gedaan, waarna #414 gemerged werd zonder `…120000` op prod; Events/Home/event-edit gaven ~10 min 42703 tot de push met `--include-all`. Les: bij "prod-push vóór merge" eerst `git branch --show-current` + `supabase db push --dry-run` lezen (de lijst moet exact de migratie van díe PR bevatten), en de orchestrator verifieert `schema_migrations` op prod vóór hij merget.

Besluiten Max 2026-10-07 (golf B, vervolg): uitnodigingen worden nooit impliciet geaccepteerd, ook team-invites niet (reviewronde 3 vond dat een willekeurige company iemand via een team-invite bij de volgende login zonder toestemming binnenhaalde en dan naam + telefoon zag; staat op prod tot vervolg A live is); Accept/Decline per invite; bij decline een mail aan de uitnodiger ("X heeft de uitnodiging niet geaccepteerd; per ongeluk? nodig opnieuw uit via dezelfde route") en een bevestiging aan de weigeraar ("per ongeluk? neem contact op met wie je uitnodigde"); de harde deletes in de cleanup van lokale QA-flows zijn een bewuste uitzondering op "no hard deletes in test helpers"; één uitnodigingsmail voor nieuw en bestaand (vervolg B, nog in golf B; gevolg voor taak 3 zie golf D); Team → External crew moet bewerkbaar zijn (quota + verwijderen).

Besluiten Max 2026-10-07 (golf B): geen `/code-review ultra`, één reviewer-sessie per high-risk PR; crew-invites volgens (a) met de regel "gegevens pas zichtbaar als ze zijn ingevuld, de gebruiker is toegevoegd én de uitnodiging is geaccepteerd"; de banner blijft (geen auto-accept); mail-cap 25 per company per dag; Resend Pro pas bij meer tractie (Max houdt het quotum in de gaten); testmails via de echte route na de merge van #413; event-locatie zie §7 en taak 3b (golf D).

Volgorde rest golf B: 0d vervolg A (`…150000`) → 0d vervolg B; telkens eerst prod-push (pas na groen licht van de orchestrator, met de sha), dan merge. #419 en #412 zijn gemerged. Les 2026-10-07: de prod-push van `…140000` kwam vóór het groene licht; omdat die versie al gereviewd en groen was, is #412 op precies die sha gemerged en gaat het vervolgwerk in een nieuwe migratie (een toegepaste migratie wordt nooit meer bewerkt). De orchestrator vergelijkt vóór de merge de functies op prod met de branch-head. Golf C mag parallel starten (besluit Max 2026-10-07): geen bestandsoverlap met #419/#412; golf-C-migraties (`20261008…`, `20261010…`) liggen ná die van golf B, maar mergen ze eerder, dan vraagt de push van `…135000`/`…140000` `--include-all`.

Open follow-ups uit golf B (geen golf-B-scope): door-header toont de event-locatie (taak 4); quick-add/bulk-add/profile-sheets tonen de companynaam i.p.v. de event-locatie; `can_view_profile` laat crew-relaties telefoon en `is_platform_admin` zien (apart ticket); `resend_webhook_events` opschonen (> 30 dagen, taak 2c); Type-veld in Company settings (kleine vervolgtaak); hint onder het locatieveld ("Empty means your company address…") aanpassen in taak 3b; footer-tagline "venues & events" in de Supabase-templates in taak 3 (na vervolg B alleen nog relevant voor de login-code-mail en de fallback); PM429 recipient/venue onderscheiden via een eigen SQLSTATE of HINT i.p.v. de RAISE-tekst (nieuwe migratie op `log_mail_attempt`); twee smalle rest-orakels (cap die precies tijdens de verzending geraakt wordt, alleen bij een race met Resend aan; Supabase's uurlimiet, ook op main): bewust gelaten zodat "Invite sent" nooit liegt.

Regels bij parallel werk: elke worker in een eigen container (eigen stack) of, op Max' laptop, één tegelijk; migratie-timestamps uit §3, nooit zelf gekozen; wie buiten zijn scope-hek moet, stopt en meldt; de orchestrator bundelt de test-handoffs per golf in één bericht aan Max.

### Status golf C (orchestrator, 2026-10-07/08; afgerond)

Gestart parallel aan de rest van golf B, besluit Max 2026-10-07. ClickUp was de hele golf onbereikbaar (daglimiet): geen comments of statussen; dit blok en de PR-bodies zijn het verslag. Exit-criterium gehaald: beide gemerged en geprod-pusht; de Platform-tab kan een trial verlengen en "Always free" zetten; de native-shell-guard is groen; een doorhost kan niet uitchecken zonder de setting, ook niet via de API.

| Taak | PR | Status | Prod |
|---|---|---|---|
| 2 Billing G | [#422](https://github.com/Max-Seffelaar/PlusOne/pull/422) | gemerged (`e1d1428`, 2026-10-08), na orchestrator-review, reviewer-ronde en delta-review. Orchestrator-review: New company-scherm toonde in de shell nog betaalcopy (weg, e2e-guard uitgebreid), seed-plan-ids naar `pro`, restricted-key-rechten in `docs/stripe-setup.md`. Reviewer-blocker: `set_venue_plan` accepteerde alleen `pro` en brak daarmee de live app tussen prod-push en merge; nu worden `indie`/`premium`/`pro` geaccepteerd en als `pro` opgeslagen. Trial-cap 730 dagen. Max' Stripe-sandboxtest vond een bug die sinds fase 13 bestond: Checkout weigerde (400) omdat tax-ID-collection zonder adres op de customer niet mag. Fix: `billing_address_collection: 'required'` en `customer_update.address: 'auto'`; daarna een betaling met adres en SEPA-mandaat bevestigd. `pnpm db:test` 89 bestanden / 2239 asserts. Handoff: 12, 13, 15 ✅; 14 (native, echt toestel) ✅ leeg. | `20261008120000`, `…120100`, `…120200` op prod (2026-10-07) |
| 4 Check-in D | [#423](https://github.com/Max-Seffelaar/PlusOne/pull/423) | gemerged (`7f4e7e5`, 2026-10-08), na orchestrator-review, reviewer-ronde en delta-review. Orchestrator-review: `client_timestamp` werd blind vertrouwd (een geplante toekomst-stempel bevroor een rij, ook tegen een admin-undo); nu clamp op `now()` en alleen void/revive geordend. Reviewer-blockers, opgelost: `guest_id` kon worden verplaatst (verkapte undo en cap-omzeiling), en een tik ging verloren tijdens de drain. Een stale void/revive geeft nu `PO409` (geen stille no-op); coalescen alleen binnen dezelfde actor. Besluit Max: backfill `allow_uncheck = false` ook voor bestaande companies (A). Spec-beslissing #55 (#54 = Ticketing 0, #424). Handoff 1–13 ✅. | `20261010120000`, `…120100` op prod (2026-10-07) |

Prod-push: de vijf migraties in één keer gepusht vanaf een lokale combinatie (G + D + de crew-migratie die al op prod stond). Vooraf groen: `pnpm db:test` op die gecombineerde set (88 bestanden / 2166 asserts, orchestrator-container). Na de merges heeft main exact de 144 migraties van prod (geverifieerd in `schema_migrations`), dus `db push` vanaf main zegt weer "up to date".

Stripe (§6, Max 2026-10-07): live én sandbox ingericht:
- product Pro met lookup keys `pro_monthly`/`pro_yearly` en BTW 21% exclusive;
- Portal: wisselen maand/jaar en opzeggen per periode-einde;
- dunning: Smart Retries 2 weken, daarna cancel;
- klantmails, inclusief de factuurmail, en branding;
- restricted key zonder View-only;
- webhook met zes events (incl. `customer.subscription.created`).

`STRIPE_PRICE_PREMIUM_MONTHLY` stond nooit in Vercel.

Lessen golf C:
- **Een poort is een checkout.** Max' lokale test liep twee keer tegen een oude server uit een andere map (`plusone-test`) op poort 7000. Herkenbaar aan copy die nergens meer bestaat ("Basic", "Venue"). Eerst `git log -1` en de poort uit `pnpm dev` controleren.
- **Een sandboxtest met echte Stripe-sleutels vindt wat de stub niet kan.** De adres-bug zat sinds fase 13 in main. Plan die test vóór de merge van elke billing-PR.
- **Een prod-push vóór de merge maakt main tijdelijk ongeldig voor `db push`.** Dat werd verergerd doordat golf B parallel migraties op prod zette. Combineer de branches lokaal om in één keer te pushen, en merge daarna zo snel mogelijk.
- **Parallelle golven geven per merge een changelog-conflict.** Elke worker moest drie keer main mergen. Bij parallel werk: de PR's direct na elkaar mergen.
- **Een reviewer-sessie op hetzelfde GitHub-account kan geen "Request changes" of "Approve" geven.** De oordeelregel staat bovenaan de comment.

**Voor golf D (gevonden bij de afronding, 2026-10-08):**
- **Tijdstempels.** Prod en main hebben al `20261011120000_mail_failed_rows_free` (golf B, #430). De gereserveerde golf-D-slots in §3 zijn ouder: 2b `20261008130000`, 3 `20261009120000`/`…120100`, 3b `20261009130000`. Een oudere migratie na een nieuwere pushen kan alleen met `supabase db push --include-all`. Advies: de golf-D-orchestrator geeft vóór het spawnen nieuwe slots ná `20261011120000` (bijv. `20261012…`) en werkt §3 bij in zijn eigen docs-PR. Kan dat niet, dan bij elke push eerst een dry-run die exact de migraties van die PR toont, en dan `--include-all`.
- **Invite-link maximaal 24 uur.** Supabase staat op `Email OTP Expiration` niet meer toe dan 86400 s; 7 dagen kan dus niet. Taak 3 bouwt daarom de knop "Resend invite" in de Platform-tab (los eindje 10).
- **Max heeft al gedaan:** `GOOGLE_PLACES_API_KEY` staat in Vercel, beperkt tot Places API (New), met usage alerts. De quota zijn niet aanpasbaar op het gratis proefaccount; de throttle in taak 3 vangt dat op.
- **Nog open bij Max:** de copy van de invite-mail (company- en team-variant; de worker mag ook drie varianten voorstellen), en na de merge van taak 3 de template-HTML in Supabase plakken.

Open follow-ups uit golf C (niet blokkerend):
- `set_venue_plan` de oude plannamen weer laten weigeren in een latere migratie (de contract-stap).
- Billing toont voor een betalende company de huidige Stripe-prijs, niet de gefactureerde; uit het subscription item lezen vóór de eerste prijswijziging.
- Foutcopy "up to two years" tegenover de 730-dagen-cap, en geen maximum op de datumkiezer.
- Een online undo van een device met achterlopende klok krijgt `PO409` met de melding "changed on another device".
- Ongebruikte cockpit-strings in `cockpit.ts`; het label van de per-event-undo-toggle is ongewijzigd.
- Insert van een al-gevoide check-in wordt nu geweigerd: noteren in de spec bij #55 als die vraag terugkomt.

## 2c. Orchestrator-prompt (één sessie voor het hele programma)

Besluit Max 2026-10-06: **één orchestrator-sessie werkt alle golven A–F af**, geen nieuwe sessie per golf. De prijs daarvan is bekend (een sessie die dagen leeft, verliest context en betaalt elke hervatting opnieuw); de prompt vangt dat zo op: de stand leeft in §2b van dit document, niet in het geheugen van de sessie; de orchestrator wacht op Max' bericht in plaats van zichzelf wakker te maken; en als de sessie verloren gaat, start Max een nieuwe met exact dezelfde prompt en leest die in §2b waar het programma staat. **Aanbevolen gebruik: per golf een verse sessie met deze zelfde prompt** (context en kosten blijven klein; de prompt vindt zelf de lopende golf), met bovenaan één regel welke golf het is. Rename: `/rename Onboarding okt 2026 — orchestrator golf <X>`.

```
Je bent de orchestrator voor het hele onboarding-programma oktober 2026 van PlusOne Guestlist: golven A tot en met F, in één sessie.
Model: Opus. Je bouwt zelf NIETS — je brieft, bewaakt, reviewt en rapporteert.

Lees eerst, in deze volgorde, en niets anders vóór je iets doet:
1. CLAUDE.md (de invarianten; security-checklist, review gates, grant matrix, prod-push-flow en de Capacitor-checklist zijn bindend)
2. onboarding-orchestration-claude-code.md (je werkinstructie: §1 mechaniek, §2b golven en stand, §2d golf-blokken, §3 timestamps, §4 worker-briefs, §5 reviewer-gate, §6 wat Max doet, §7 besluiten, §9 spike-antwoorden en losse eindjes)
3. docs/perf-audit-2026-10.md (P1 en P2) en docs/posthog-implementation-plan.md (PH), pas wanneer die golf aan de beurt is
4. .claude/skills/clickup-task/SKILL.md (de workers volgen dit; jij zet alleen comments op de taken van de lopende golf, met mate: de koppeling heeft een daglimiet van ~100 calls voor alle sessies samen). Is ClickUp onbereikbaar, dan slaan jij en de workers alle ClickUp-stappen over (geen comments, geen status, geen .claude/clickup-session.json) en is §2b plus de PR-body het verslag.

Waar sta je? Bepaal het uit de code en §2b, nooit uit je geheugen:
- `git fetch origin main` en lees §2b: de eerste golf waarvan het exit-criterium (§2d) niet gehaald is, is de lopende golf.
- Loopt die golf al in een andere orchestrator-sessie (Max zegt het, of er zijn open PR's met de taak-ids van die golf die jij niet kent)? Neem die niet over tenzij Max het zegt; wacht op het overdrachtsbericht en begin bij de golf erna.
- Doe dit bij ELKE hervatting van de sessie (elk bericht van Max na een pauze): fetch, §2b lezen, open PR's van de lopende golf ophalen met gh. Wat je over eerdere golven denkt te weten, controleer je in de code.

Per golf, in volgorde A → B → C → D → E → F:

Startcheck (één blok aan Max vóór je workers spawnt):
- Zijn de PR's van de vorige golf gemerged? Controleer de deliverables in de code (git show origin/main:<pad>), niet een status.
- Staat een taak van deze golf al op planning/in progress met een andere sessie erop, of is er al een open PR met het taak-id (gh pr list --search)? Dan die taak overslaan en melden.
- Migratie-timestamps van deze golf vrij op origin/main? (git ls-files supabase/migrations | grep 202610)
- Welke stappen uit §6 voor deze golf heeft Max nog niet gedaan, en welke worker blokkeert dat? Start de rest.

Daarna, per worker uit het golf-blok in §2d:
- Vul de worker-brief uit §4 in (algemeen blok + taakblok: taak-id, branch, model, toegewezen timestamps, Raakt/Verboden, deps) en spawn de sessie via create_session (permission_mode nooit 'plan'; model per brief). Lukt spawnen niet, geef Max de ingevulde brief om te plakken.
- Geef elke worker de omgevingsregels mee: dependencies via `node scripts/session-setup.mjs install`; een remote container heeft na `pnpm stack` zijn eigen Supabase-stack, een worker op Max' laptop deelt de stack met anderen en reset dan nooit zonder het te melden; de volledige suite precies één keer vlak voor de laatste push als `CI=1 pnpm test`, in de voorgrond (bare `pnpm test` is vitest in watch-mode en hangt in een sessie: golf A verloor er een worker door); vóór de push `origin/main` in de branch mergen (merge commit; `docs/changelog.md` conflicteert bij elke parallelle PR: beide entries houden, de eigen bovenaan); geen zelfgeplande wake-ups; UI-werk levert de flow-harness-output (QA-0) in de PR.
- Volg de sessie. Grijp in (interrupt_session + send_message) als een worker buiten zijn scope-hek gaat, een verboden bestand aanraakt, een guard verzwakt, een timestamp verzint, of ClickUp-calls blijft doen terwijl de koppeling offline is.
- Houd je eigen context schoon: lees geen worker-transcripties, alleen hun eindrapport; plak geen diffs in de chat; per PR hooguit tien regels samenvatting.

Per opgeleverde PR:
- Lees de diff zelf, adversarieel (gh pr diff, lokaal): wat zou CI afkeuren, welke CLAUDE.md-regel wordt geschonden, waar is de scope overschreden, waar wordt een guard verzwakt, zit er PII in logs of URL's? Bevindingen gaan als review-comment op de PR (met de Claude Code-footer), niet als chat.
- Screenshots (vanaf golf B): elke UI-PR levert de flow-harness-output: contact sheet per device inclusief de native-shell-simulatie, link naar het CI-artifact in de PR-body, rapport met ✅/❌ per assert. Bekijk de contact sheets zelf, stap voor stap op 390, 1280 en native-shell; vergelijk met het klaar-als uit de brief en met de contact sheets van de vorige golf (regressie). Een UI-PR zonder flow is niet klaar. In golf A geldt dit alleen voor QA-0 zelf; P1 levert de Network-screenshot uit het meetplan.
- High-risk PR (gemarkeerd in het golf-blok): spawn de reviewer-sessie uit §5 (fresh session: `/code-review high` + `/security-review` + aanvalsvragen, CLAUDE.md "Review gates"). Geen `/code-review ultra` (besluit Max 2026-10-06). Pas na een schone ronde wordt de PR gemerged.
- Oordeel aan Max in één regel per PR: "klaar voor je test-handoff" of "niet mergen, want …", plus de genummerde handoff-vragen (UI-PR's), gemarkeerd ✅ automatisch / 👁 screenshot NN (nummer uit de contact sheet) / 🖐 handmatig. Max kijkt naar de contact sheet en beantwoordt alleen de 🖐-vragen.

Wachten op Max (dit is hoe je dagen overbrugt zonder tokens te verbranden):
- Als alle PR's van de golf een oordeel hebben en je wacht op merges, prod-pushes of §6-stappen: schrijf eerst de stand naar §2b (docs-PR: per taak PR-nummer, status, contact-sheet-link, wat open is) en eindig dan je beurt met één blok "WACHT OP MAX:" dat precies opsomt wat je nodig hebt (welke PR's mergen, welke migraties prod-pushen, welke §6-stappen, welke antwoorden). Daarna niets: geen wake-ups plannen, geen polling, geen CI-eigenaarschap. Max antwoordt met "merged #…", "klaar: …" of "stop", en jij gaat verder bij "Waar sta je?".
- Komt een worker klaar terwijl je wacht, dan krijg je dat bericht; behandel die PR en eindig opnieuw met het WACHT OP MAX-blok.

Harde regels:
- Mergen doet de orchestrator (besluit Max 2026-10-06, golf A): pas als de verplichte CI (`lint-and-test`) groen is op de huidige head, er geen conflict is, en bij high-risk na een schone reviewer-ronde. Controleer de merge daarna op GitHub. Max doet de prod-push van migraties (en Edge Function-deploys) vanuit de linked main-checkout; geef hem de exacte stappen en verifieer daarna via Supabase (schema_migrations, functieversie).
- Één DB-eigenaar: CI blijft de merge-gate. Zeg in elk PR-oordeel voor een migratie-PR of de worker `pnpm db:test` lokaal groen had, en zo niet, waarom CI dat dan dekt.
- Geen model-namen in commits, PR-titels of -bodies.
- Elke wijziging aan dit document, de spec of CLAUDE.md gaat in een eigen kleine docs-PR van jou, nooit in een worker-PR. De §2b-stand is zo'n docs-PR; Max merget hem samen met de rest.
- Hooguit drie workers tegelijk op Max' laptop-stack; remote containers tellen niet mee.
- Als deze sessie te lang wordt of context verliest, zeg dat tegen Max: hij start een nieuwe sessie met dezelfde prompt en jij hebt §2b al bijgewerkt zodat die naadloos verder kan.

Einde van een golf (exit-criterium uit §2d gehaald):
- §2b bijwerken en een changelog-entry in docs/changelog.md (nieuwste bovenaan): wat gemerged, wat open, wat geblokkeerd en waarop (één docs-PR).
- ClickUp-comment op elke taak van de golf als de koppeling het toelaat.
- Eén bericht aan Max: golf <X> klaar, dit zijn de startvoorwaarden voor golf <X+1> (merges, §6-stappen, open punten). Ga daarna direct door met de startcheck van de volgende golf; wat van Max moet komen, staat in het WACHT OP MAX-blok.

Einde van het programma (golf F klaar): retro-entry in docs/changelog.md (wat werkte, wat niet, wat de volgende keer anders moet), §2b volledig, laatste bericht aan Max met de open restpunten (Dependabot-PR's, ClickUp-ids, PostHog-vervolg). Dan stop je.
```

## 2d. Golf-blokken (de orchestrator leest ze zelf uit dit document)

Per worker: code · ClickUp-id · naam · model · branch · timestamps · Raakt · Verboden · markering. Wie toch per golf een losse sessie wil, plakt de prompt uit §2c met het blok van die golf eronder. "n.n.b." = ClickUp-id nog niet bekend (koppeling was offline; de orchestrator maakt de taak aan en vult het id in).

### Golf A

```
GOLF A — parallel, geen deps. Start alles tegelijk; de spike-sessie reset de gedeelde laptop-stack als eerste en meldt wanneer hij klaar is.

SP  (geen taak)  Spikes wave 0                      Opus    branch claude/spikes-wave0
    Deliverable: §9 van dit document ingevuld (zes antwoorden + consequentie, SQL-schetsen voor 2, 3, 6) + seed-fix Sanne/Pim met groene pnpm db:test; comments op D, E, A, F.
    Verboden: productiecode, elke andere PR dan de docs-PR op §9.
0a  n.n.b.       QA-0 flow-screenshots + handoff    Opus    branch claude/qa0-flow-shots
    Raakt: scripts/flow-shots/** (seed onboarding.mjs bestaat), tests/flows/**, de workflow-file (job flow-shots naast layout-suite, via scripts/session-setup.mjs), package.json (alleen script qa:flows), CLAUDE.md (alleen "Per-screen test handoff"), docs/changelog.md.
    Verboden: app-code; een tweede install-pad; guards verzwakken. tests/unit/claude-md-references.test.ts blijft groen.
0b  z8uq9m2xyn   Snelheid P1 quick wins             Opus    branch claude/z8uq9m2xyn-perf-p1
    Timestamps: 20261007100000_guests_venue_created_idx, 20261007100100_invites_select_initplan.
    Raakt: next.config.js (staleTimes), src/app/app/layout.tsx, src/lib/auth/{context,memberships,onboarding,guards}.ts, src/features/{guests,events,contacts,quotas,requests,venues}/actions.ts (alleen revalidatePath-regels), app-screens.tsx, app-chrome.tsx, app-client.tsx, src/features/po/hooks.ts + queries.ts, docs/perf-audit-2026-10.md (status per finding).
    Verboden: src/features/door/**, public/service-worker.js, middleware, RLS behalve invites_select, screens-copy, pushState-navigatie. Begint met meten (vóór/na-telling in de PR-body).
    High-risk (layout/middleware = auth) → reviewer-sessie verplicht.
0c  z8uq9m2yvk   Notificaties N1 push bundelen      Opus    branch claude/z8uq9m2yvk-push-bundling
    Timestamp: 20261007110000_notification_throttle.
    Raakt: de migratie, supabase/functions/push-dispatch/**, src/features/notifications/payload.ts, pgTAP + vitest.
    Verboden: UI, mail (taak 6), src/features/door/**.
    High-risk (trigger + service-role-dispatch) → reviewer-sessie verplicht.
0f  n.n.b.       Sentry-hygiene S1                  Sonnet  branch claude/sentry-hygiene-s1
    Raakt: src/lib/observability/**, de twee error-handlers in PoLiveProvider.tsx, src/lib/db-errors.ts, minimale wijziging in src/features/po/mutations.ts (code doorgeven), sentry.*.config.ts (alleen netwerk-ruis), docs/runbook.md.
    Verboden: gedrag voor de gebruiker; fouten verbergen die een bug kunnen zijn; database.
L   z8uq9m2vh6   Legal (eenmanszaak, subprocessors) Opus + Max/Joeri — andere repo (Plus-One.io); jij volgt alleen.

Exit: P1, N1, S1 en QA-0 gemerged; P1 en N1 door Max geprod-pusht; §9 ingevuld door de spike-sessie. Legal mag doorlopen.
```

### Golf B

```
GOLF B — parallel; wacht op golf A gemerged (P1 raakt events/actions.ts; QA-0 levert de handoff-conventie).

0d  z8uq9m2yvp   Crew-bug bestaand account          Opus    branch claude/z8uq9m2yvp-crew-existing-account
    Raakt: src/features/events/actions.ts (alleen inviteExternalCrew), src/components/po/screens/events/crew.tsx, i18n, events/actions.test.ts + crew.demo-refusal.test.tsx, gastenlijst-app-spec.md (#24).
    Verboden: invite-mail.ts, platform-invites, alles buiten crew; geen mail (komt uit 0e).
    High-risk (service-role-lookup in een auth-pad) → reviewer-sessie verplicht.
0e  z8uq9m2yvt   Mail-infra F0 + team-invite mails  Opus    branch claude/z8uq9m2yvt-mail-infra
    Timestamp: 20261007130000_mail_log.
    Raakt: src/features/mail/** (nieuw), src/app/api/webhooks/resend/route.ts (nieuw), src/features/auth/invite-mail.ts (bestaand-account-tak), src/features/events/actions.ts (alleen de crew-mail-aanroep; rebase na 0d), .env.example, docs/mail-deliverability.md, docs/legal/README.md, tests.
    Verboden: gastmail, notificatie-voorkeuren, digest (taak 6); Supabase-templates (taak 3); src/features/door/**.
    High-risk (webhook + service-role-verzending) → reviewer-sessie verplicht. Max vooraf: RESEND_API_KEY, RESEND_WEBHOOK_SECRET, copy voor drie team-mails.
0g  n.n.b.       Last-admin-guard                   Opus    branch claude/last-admin-guard
    Timestamp: 20261007140000_last_admin_guard. Raakt: de migratie (trigger + pgTAP), src/features/venues/actions.ts (removeMemberAction en updateMemberRolesAction: nette fout vóór de DB-weigering), src/features/venues/components/RemoveMemberButton.tsx en settings/team.tsx (knop/rol-wissel verborgen voor de laatste admin), i18n, tests.
    Verboden: invites, crew, alles buiten memberships. HIGH-RISK (trigger op een auth-tabel).
1   z8uq9m2vqc   Venue → Company                    Opus    branch claude/z8uq9m2vqc-company-rename
    Timestamp: 20261007120000_event_location.
    Raakt: src/lib/i18n/**, screens (alleen strings), settings/venue*.tsx (Type-veld), events/edit.tsx (locatie), src/features/po/adapters.ts + queries.ts, src/features/events/actions.ts + schemas (location), database.types.ts, gastenlijst-app-spec.md, design-system.md, copy-deck.md.
    Verboden: src/features/billing/**, src/features/onboarding/** (behalve de string "venue"), src/features/door/**, src/features/auth/**, andere migraties. Geen gedragswijzigingen tijdens de sweep.

Exit: alle drie gemerged; pnpm e2e:layout groen; geen zichtbare "venue" meer in de UI; team-invite naar een bestaand account geeft een echte mail.
```

### Golf C

```
GOLF C — parallel; wacht op golf B gemerged. Twee reviewer-sessies.

2   z8uq9m2vrz   Billing G                          Opus    branch claude/z8uq9m2vrz-billing-pro
    Timestamps: 20261008120000_single_plan_pro, 20261008120100_billing_interval, 20261008120200_platform_trial_override.
    Raakt: src/features/billing/**, src/features/onboarding/** (PlanStep/BetalingStep weg), src/lib/auth/onboarding.ts, settings/billing.tsx + settings.tsx, platform-venues.tsx (+ hooks/mutations voor trial/always free), kit.tsx (BillingLockNote), i18n settings + platform, docs/stripe-setup.md, .env.example, gastenlijst-app-spec.md (#32), tests incl. billing.native.test.tsx, native-store-tax.test.tsx, stripe-*.test.ts, pgTAP stripe_billing + platform_billing; nieuwe e2e native-shell-guard in e2e:smoke.
    Verboden: src/features/platform/invite-actions.ts (comped-invite is taak 3), src/features/door/**, screens buiten settings/platform. Native blijft PR #387: geen prijs, knop, URL of copy-link.
    High-risk (billing, service-role-RPC's, platform-RPC's) → reviewer-sessie verplicht. Max vooraf: Stripe-dashboard (product Pro, lookup keys pro_monthly/pro_yearly, BTW, portal, dunning, webhook); env-vars pas ná de merge.
4   z8uq9m2vg6   Check-in D                         Opus    branch claude/z8uq9m2vg6-checkin-group
    Timestamps: 20261010120000_checkin_absolute_count_guard, 20261010120100_door_checkout_permission.
    Raakt: src/features/door/** (model, outbox, components, offline), de twee migraties, settings/venue*.tsx (toggle), i18n door + settings, pgTAP check_ins_*, door-render-isolation.test.tsx (blijft groen).
    Verboden: alles buiten door/settings; geen server action voor check-in of undo (outbox, #25).
    High-risk (RLS op check_ins) → reviewer-sessie verplicht. Ontwerp uit spike 2 (§9).

Exit: beide gemerged en geprod-pusht; Platform-tab kan trial verlengen en "always free" zetten; native-shell-guard groen; doorhost kan niet uitchecken zonder de setting, ook niet via de API.
```

### Golf D

```
GOLF D — parallel; wacht op golf C gemerged (set_venue_comped, listPrices, billing_interval, trial_ends_at bestaan).

2b  z8uq9m2ybj   Platform R                         Opus    branch claude/z8uq9m2ybj-platform-overview
    Timestamp: 20261008130000_platform_overview_rpcs.
    Raakt: platform.tsx, platform-venues.tsx, nieuw platform-overview.tsx, routes.ts + nav-map.ts, src/features/po/ (platform hooks/queries/adapters), billing/provider.ts (alleen listPrices gebruiken), i18n platform, platform-*.visibility.test.tsx, pgTAP platform_overview, tests/e2e/layout (scherm toevoegen); dagelijkse digest via de mail-infra uit 0e.
    Verboden: billing-actions, onboarding, door, alles wat gast-rijen leest (alleen aggregaten).
    High-risk (SECURITY DEFINER-aggregaten over alle venues) → reviewer-sessie verplicht.
3   z8uq9m2vg5   Onboarding A                       Opus    branch claude/z8uq9m2vg5-onboarding
    Timestamp: 20261009120000_platform_invite_comped.
    Raakt: src/features/platform/invite-actions.ts + platform-screens (comped), src/features/auth/invite-mail.ts (metadata kind/invited_by/company), docs/email-templates/invite.html (nieuw), supabase/config.toml (invite-template), VenueStep.tsx (DPA-checkbox, Places), src/app/api/places/route.ts + src/lib/places/** (nieuw), events/edit.tsx (Places op de locatie), docs/legal/README.md, .env.example (GOOGLE_PLACES_API_KEY), gastenlijst-app-spec.md (#40).
    Verboden: src/features/billing/** behalve het aanroepen van set_venue_comped; door; requests. Spike 4 negatief → geen hook-route, template statisch, melden.
    High-risk (invite-metadata, publieke proxy) → reviewer-sessie verplicht. Max vooraf: Google Cloud-project + Places-key, Supabase invite-expiry 7 dagen, template geplakt na de merge, copy.
    LET OP (besluit Max 2026-10-07, golf B): team- en crew-uitnodigingen naar een nieuw adres gaan na 0d vervolg B niet meer via de Supabase-template maar via `generateLink` + onze eigen Resend-mail (zelfde mail voor nieuw en bestaand). De orchestrator van golf D legt Max bij de start voor om de company-tak (platform-invite) op dezelfde manier te bouwen i.p.v. via de Supabase-template uit spike 9.4; dan vervalt het plakken van het invite-template (§6) en raakt taak 3 `invite-mail.ts` alleen nog voor de platform-invite.
3b  n.n.b.       Event-locaties L                   Opus    branch claude/event-locations
    Timestamp: 20261009130000_event_locations. Start na de merge van 3 (gebruikt de Places-component).
    Raakt: migratie, settings/venue.tsx (sectie Locations), events/edit.tsx (locatie kiezen), src/features/po/adapters.ts (resolveEventLocation zonder company-fallback in publieke weergave), src/app/e/[slug]/**, src/features/requests/status-view.ts + statuspagina, i18n, tests, tests/flows, gastenlijst-app-spec.md (#48(c) herzien).
    Verboden: billing, door (door-header zit in taak 4), invite-mail, andere migraties.
    High-risk (get_request_status = SECURITY DEFINER, anon) → reviewer-sessie verplicht. Besluit Max 2026-10-07, zie §7 "Event-locatie (herzien)".
5   z8uq9m2vg7 + z8uq9m2vg8   Event C + Dashboard B  Opus  branch claude/z8uq9m2vg7-event-screens
    Raakt: home.tsx, events/*.tsx, settings/quota.tsx, settings/team.tsx (invite-sheet exporteren), templates.tsx (terugknop-bug), i18n, bijbehorende tests, tests/flows.
    Verboden: src/features/**, migraties, door. Eén PR, beide taken bijgehouden.

5b  n.n.b.       Share-import S2                    Opus    branch claude/share-import-s2
    Raakt (web-kant): public/manifest.json (share_target), nieuw scherm 'share' in routes.ts/nav-map.ts + src/components/po/screens/share.tsx (landt op Paste a list met event- en tier-keuze; accepteert tekst uit de query én uit geheugen via een `shareInbox`-store), src/features/guests/bulk-paste-parser (uitbreiding: e-mail per regel, tab/komma uit Excel, kopregel overslaan; hergebruik quick-add-parser voor +N en contacts/import/parse voor e-mail), de telling in de preview, tests/flows (share-flow), i18n.
    Verboden: alles native (Android-intent en iOS Share Extension = S6 in capacitor-plan-claude-code.md §4, zelfde plugin `PlusOneShareInbox`; gaat mee in de eerstvolgende store-build nadat dit live is), server-side opslag van de gedeelde tekst (alles client-side tot de import), src/features/door/**.
    Geen migratie. Sequentieel na taak 5 (zelfde guests-screens) of in dezelfde worker als 5.

Exit: alle vijf gemerged (2b, 3, 3b, 5, 5b); test-handoffs beantwoord; comped-invite werkt end-to-end; deellink en statuspagina tonen altijd de event-locatie en nooit het companyadres; Overview toont de cijfers; een WhatsApp-tekst gedeeld naar PlusOne staat na twee tikken op de lijst.
```

### Golf E

```
GOLF E — parallel; wacht op golf D gemerged (mail-infra, platform-schermen, settings-structuur).

2c  z8uq9m2z19   Billing-mails B1                   Opus    branch claude/z8uq9m2z19-billing-mails
    Timestamp: 20261008140000_billing_mail_types.
    Raakt: src/features/mail/templates/billing-*.tsx (nieuw), src/features/billing/mail-schedule.ts (nieuw, puur + tests), de geplande job, src/features/billing/stripe-webhook.ts (payment_failed/canceled → mail), Platform R-schermen (tijdlijn + Overview-telling), i18n platform, pgTAP + vitest.
    Verboden: checkout/portal-code, onboarding, gastmail.
    High-risk (service-role-job + webhook) → reviewer-sessie verplicht. Max vooraf: copy voor zeven templates, dagen bevestigd, Stripe-dunning-mails uit.
6   z8uq9m2vpy   Gastcommunicatie F                 Opus    branch claude/z8uq9m2vpy-guest-mail
    Timestamps: 20261013120000_guest_mail_types, 20261013120100_company_contact_channels, 20261013120200_guest_mail_optout, 20261013120300_notification_prefs.
    Raakt: src/features/mail/** (types, templates, queue), src/app/u/[token]/route.ts (nieuw), guests/contacts/events/requests-actions (mail-hooks), settings/venue*.tsx (contact), events/* (checkbox Send confirmation, Send reminder), Profile (notification prefs), i18n, docs/legal/README.md, gastenlijst-app-spec.md (#10), tests.
    Verboden: src/features/door/** (de deur stuurt nooit mail en wacht nooit op mail), billing.
    High-risk (publieke afmeld-route, service-role-verzending, prefs-RLS) → reviewer-sessie verplicht. Max vooraf: copy gekozen.

Exit: beide gemerged en geprod-pusht; een handmatig toegevoegde gast met e-mail krijgt binnen een minuut "You're on the list"; afmeldlink werkt; billing-tijdlijn zichtbaar in Platform.
```

### Golf F

```
GOLF F — sequentieel: 7 → 8 → 9 → 10. Wacht op golf E gemerged.

7   z8uq9m2vga   Requests E                         Opus    branch claude/z8uq9m2vga-request-split
    Timestamp: 20261015120000_request_decision_split. Ontwerp uit spike 3 (§9).
    Raakt: de migratie, src/features/requests/**, src/features/po/ (requests hooks/mutations/adapters), de approve-sheet, de statusmail-aanroep uit taak 6, pgTAP guest_requests_decide, gastenlijst-app-spec.md.
    Verboden: door, billing, onboarding. High-risk (SECURITY DEFINER met quota-math) → reviewer-sessie.
8   z8uq9m2xyp   Quota-aanvraag Q                   Opus    branch claude/z8uq9m2xyp-quota-flow
    Timestamp: 20261016120000_quota_request_guest_payload. Wacht op 7.
    Raakt: de migratie, src/features/quotas/**, src/features/po/ (quota hooks/mutations/adapters + Updates-kaart), home.tsx, quota-formulier en beslis-sheet, i18n, pgTAP quota_requests_*, gastenlijst-app-spec.md.
    Verboden: guest_requests (taak 7), door, billing, mail (bestaande push volstaat). High-risk → reviewer-sessie.
9   z8uq9m2xz2   Snelheid P2                        Opus    per punt een PR; timestamps 20261017120000_rls_set_based_helpers, 20261017120100_check_ins_update_policy_merge. Wacht op 8, of eerder op aanwijzing van Max.
    High-risk per PR (middleware getClaims, RLS, service worker) → reviewer-sessie per PR. Max vooraf voor getClaims: asymmetrische JWT-signing-keys.
10  n.n.b.       Analytics PH (PostHog)             Opus    drie PR's volgens docs/posthog-implementation-plan.md (foundation, instrumentation, docs). Wacht op 9 en Max' go.
    Max vooraf: PostHog-project + key; cookie-banner-copy; subprocessor C → A in de legal-ronde.

Exit: alles gemerged; programma afgerond; retro-entry in docs/changelog.md.
```

## 3. Migratie-timestamps (gereserveerd)

| Taak | Bestand | Inhoud |
|---|---|---|
| 0b | `20261007100100_guests_venue_created_idx.sql` (was `…100000`, dat slot bleek bezet door `contacts_freeze_anonymized`) | index `guests(venue_id, created_at desc, id desc)` |
| 0b | `20261007100200_invites_select_initplan.sql` | `invites_select` met `(select auth.uid())` (advisor auth_rls_initplan) |
| 0c | `20261007110000_notification_throttle.sql` | `notification_throttle`, `notification_outbox.collapse_key` + `deliver_after`, trigger-telling (>10 in 60 min → 24 uur per uur bundelen) |
| 0g | `20261007160000_last_admin_guard.sql` (was `…140000`; dat slot is sinds 2026-10-07 bezet door `crew_invites` op prod) | BEFORE DELETE/UPDATE-trigger op `venue_memberships`: weigert als de rij de laatste admin van de venue is (delete, of roles zonder admin); pgTAP allowed/denied |
| 1 | `20261007120000_event_location.sql` | `events.location_name text`, `events.location_address text` (nullable, expand-only); geen RLS-wijziging |
| 2 | `20261008120000_single_plan_pro.sql` | `update subscriptions set plan_id = 'pro'`; `create_venue_with_owner` zet `plan_id = 'pro'`; `set_venue_plan` blijft bestaan maar accepteert alleen `pro` |
| 2 | `20261008120100_billing_interval.sql` | `subscriptions.billing_interval text check in ('month','year')` nullable; `apply_stripe_subscription_update` krijgt `p_billing_interval` |
| 2 | `20261008120200_platform_trial_override.sql` | `subscriptions.trial_ends_at timestamptz` nullable; RPC's `set_venue_trial_end`, `set_venue_comped` (SECURITY DEFINER, `is_platform_admin()`), grants, pgTAP |
| 2b | `20261008130000_platform_overview_rpcs.sql` | `platform_invite_overview()` + companies per invite; `platform_subscription_counts()`, `platform_usage_30d()`, trial-funnel-RPC; alle SECURITY DEFINER met `is_platform_admin()` binnenin |
| 2c | `20261008140000_billing_mail_types.sql` | zeven `mail_log.type`-waarden, unique `(venue_id, type)` voor trial-mails, `subscriptions.billing_mails_paused`, RPC `platform_billing_mail_timeline` |
| 3 | `20261009120000_platform_invite_comped.sql` | `platform_invites.comped boolean not null default false`; `create_venue_with_owner` roept `set_venue_comped` aan als de invite comped is |
| 3 | `20261009120100_places_throttle.sql` | throttle-wrapper voor de Places-proxy + grant + pgTAP allowed/denied (spike 9.6) |
| 3b | `20261009130000_event_locations.sql` | `company_locations` (opgeslagen locaties per company) + RLS + grant matrix; `get_request_status` geeft de event-locatie terug i.p.v. het companyadres (expand: companyadres-kolommen pas in een latere migratie droppen); zie taak 3b |
| 4 | `20261010120000_checkin_absolute_count_guard.sql` | check `plus_ones_arrived <= guest.plus_ones` (trigger); stale-guard op `client_timestamp` in de check-in-RPC |
| 4 | ~~`20261010120100_door_checkout_permission.sql`~~ | **Vervalt (spike 9.2):** uitchecken bestaat al als `venues.allow_uncheck` + `events.allow_uncheck` + RESTRICTIVE policy `check_ins_void_requires_uncheck`; taak 4 maakt die rolafhankelijk binnen `20261010120000` of een `…120100`-slot met die inhoud. |
| 0e | `20261007130000_mail_log.sql` | `mail_log` (append-only, type + ontvanger-hash + status + provider-id, geen inhoud), `resend_webhook_events`-ledger, grant matrix |
| 0d | `20261007140000_crew_invites.sql` | crew-only uitnodigingen (`invites` zonder venue-rol, met event_ids + crew-quotum), `accept_pending_invites` maakt dan alleen event_organizers/event_quotas, SECURITY DEFINER-RPC voor de eigen openstaande uitnodigingen (companynaam + eventnamen voor de banner); besluit (a), 2026-10-07; op prod |
| 0d vervolg A | `20261007150000_explicit_invite_accept.sql` | `accept_pending_invites()` accepteert niets meer; accept per invite-id; `decline_my_invite` + `invites.declined_at` (grant matrix); de no-arg `accept_my_invites()` blijft werken tot de nieuwe code live is (expand–contract) |
| 0d vervolg B | `20261007170000_invite_mail_types.sql` (alleen als nodig) | extra `mail_log.type` voor de uniforme uitnodigingsmail |
| 6 | `20261013120000_guest_mail_types.sql` | nieuwe `mail_log.type`-waarden voor gastmail; geen nieuwe tabel |
| 6 | `20261013120100_company_contact_channels.sql` | `venues.contact_email` (verplicht vóór eerste live event, afgedwongen in de publish-actie, niet als NOT NULL), `venues.contact_channels jsonb` |
| 6 | `20261013120200_guest_mail_optout.sql` | `contact_mail_optout` (per contact per venue, publieke token-route), RLS |
| 6 | `20261013120300_notification_prefs.sql` | `user_profiles.notification_prefs jsonb` (+ kolom-grant), `notification_outbox.channel` ('push' \| 'email'), triggers zetten een rij per kanaal per voorkeur |
| 7 | `20261015120000_request_decision_split.sql` | RPC `decide_guest_request(p_request_id, p_decision jsonb)`: inkorten, splitsen over tiers, deels afwijzen, verplichte opmerking; atomair; audit |
| 8 | `20261016120000_quota_request_guest_payload.sql` | `quota_requests.guest_payload jsonb`, `seen_at`, verplichte reden bij `declined`; `approve_quota_request` maakt de gast aan in dezelfde transactie; RLS voor `seen_at` |
| 9 | `20261017120000_rls_set_based_helpers.sql` | set-based policies i.p.v. per-rij helper-ketens (audit #13); pgTAP per rol |
| 9 | `20261017120100_check_ins_update_policy_merge.sql` | de twee permissive UPDATE-policies op `check_ins` samenvoegen (advisor) |

Een worker die een extra migratie nodig heeft, gebruikt de volgende `…1xx`-slot van zijn eigen dag en meldt het in de PR.

## 4. Worker-briefs (ingevuld; Max plakt ze één voor één)

Algemeen blok, bovenaan elke brief:

```
Je bouwt ClickUp-taak <ID> — "<NAAM>" voor PlusOne Guestlist, taak <N> van het onboarding-programma oktober 2026.
Model: <Opus|Sonnet>. Branch: claude/<ID>-<slug>. Werk uitsluitend op die branch, gestart vanaf origin/main.

Lees eerst, in deze volgorde: CLAUDE.md; onboarding-orchestration-claude-code.md (§1, §3, jouw brief in §4, §9 spike-antwoorden); de ClickUp-taak met alle comments (de comments bevatten de latere besluiten en gaan vóór de beschrijving); tone-of-voice.md en docs/copy-prompt.md als je strings toevoegt.

Volg de clickup-task-skill vanaf stap 0. Bij conflict tussen taak, dit document en de code: stoppen en melden, niet kiezen.

Regels die hier extra tellen:
- CLAUDE.md is bindend: security-checklist per route/action, grant matrix per nieuwe tabel, expand–contract, geen bare JSX.Element, Engelse UI-copy via src/lib/i18n, Capacitor-checklist per scherm.
- Migratie of pgTAP in je diff? `pnpm db:fresh` daarna `pnpm db:test` vóór je laatste push; staart van de output in de PR-body; zeg wat je NIET lokaal kon draaien.
- Verzwak nooit een guard, test of config om iets groen te krijgen.
- Draai de volledige `pnpm test` precies één keer, vlak voor je laatste push. Geen zelfgeplande wake-ups; na je laatste push ben je klaar.
- Nieuwe strings: drie varianten via docs/copy-prompt.md, jouw keuze, alle drie in de PR-body onder "Copy choices".
- High-risk surface? Security-research-prompt in de PR-body, ongevraagd.

Definition of done: draft-PR met taak-id in de titel, CI groen; UI: een flow in tests/flows/ voor wat je veranderde, de flow-harness gedraaid (contact sheet als CI-artifact, link in de PR-body) en de test-handoff onderaan je laatste bericht met per vraag ✅ automatisch / 👁 screenshot NN / 🖐 handmatig (streef naar ≤ 3 handmatige); docs/changelog.md-entry; spec bijgewerkt als een beslissing wijzigt; end-of-session-comment op de taak; status blijft 'in progress' tot Max gemerged en getest heeft.
```

### Taak 0a — QA-0 (ClickUp "QA-0", Opus)

```
Scope-hek:
- Raakt: scripts/flow-shots/** (seed: onboarding.mjs bestaat), tests/flows/** (nieuw), playwright.layout.config.ts (device-matrix hergebruiken, niet dupliceren), .github/workflows (job flow-shots naast layout-suite), package.json (script qa:flows), .gitignore (flow-screenshots/), CLAUDE.md "Per-screen test handoff", dit document §2 (kolom Bewijs).
- Verboden: app-code; geen guard verzwakken; geen tweede install/suite-pad naast scripts/session-setup.mjs.
- Deps: wave 0.

Wat je bouwt: de taakbeschrijving. Eerste flows: onboarding (vier varianten, al werkend) en de native-shell-guard. Handoff-conventie documenteren met de onboarding-flow als voorbeeld (≥ 8 asserts uit de bestaande handoff-vragen).

Klaar als: zie de taak; plus: een PR die alleen README raakt draait géén flows (pad-match werkt).
```

### Taak 0b — Snelheid P1 (z8uq9m2xyn, Opus; layout en middleware = auth → reviewer)

```
Scope-hek:
- Raakt: next.config.js (staleTimes), src/app/app/layout.tsx, src/lib/auth/{context,memberships,onboarding,guards}.ts (cache() + Promise.all), src/features/{guests,events,contacts,quotas,requests,venues}/actions.ts (alleen revalidatePath-regels verwijderen), src/components/po/app-screens.tsx + app-chrome.tsx + app-client.tsx, src/features/po/hooks.ts + queries.ts (usePoEvents staleTime, single-event read, badge-count, count:'planned'), de twee migraties 20261007100000/100100, docs/changelog.md, docs/perf-audit-2026-10.md (status per punt).
- Verboden: src/features/door/**, public/service-worker.js, middleware.ts (dat is P2), RLS-policies behalve invites_select, screens-copy, alles wat gedrag verandert. Geen pushState-navigatie (P2).
- Deps: wave 0 klaar. Geen andere.

Wat je bouwt: de punten 1 (alleen staleTimes), 2, 3, 4 (alleen AppScreens + single-event read + staleTime), 5 (alleen de badge-telling + rol-gate), 7, 8 en de invites-advisor uit docs/perf-audit-2026-10.md. Lees dat document eerst; het bevat de file:line-verwijzingen. Alles gedragsbehoudend.

Klaar als:
- Eén /app-document-load doet ≤ 2 Supabase-roundtrips in de layout (tel ze lokaal met request-logging en zet vóór/na in de PR-body).
- `grep -rn revalidatePath src/features/{guests,events,contacts,quotas,requests,venues}` levert alleen consent/profiel op.
- Terugkeren naar een bezochte tab binnen 5 minuten: geen server-fetch (Network-screenshot).
- Badge voor staff/doorhost doet geen requests-query; voor admin één head-count.
- `pnpm test`, `pnpm e2e:smoke`, door-render-isolation, app-shell-no-ssr-suspense, `pnpm db:test` groen.

Test-handoff: manager@ → Home → Events → Guests → terug naar Home (snelheid, geen flikkering), gast toevoegen/bewerken (geen volledige herlaad), badge-telling klopt.
```

### Taak 0c — Notificaties N1 (z8uq9m2yvk, Opus; trigger + service-role-dispatch → reviewer)

```
Scope-hek:
- Raakt: supabase/migrations/20261007110000_notification_throttle.sql, supabase/functions/push-dispatch/** (samenvoegen per collapse_key, uurlijkse kick), src/features/notifications/payload.ts (digest-payload), pgTAP notification_outbox_*, vitest op de dispatcher.
- Verboden: UI (geen scherm verandert), mail (dat is taak 6), src/features/door/**.
- Deps: taak 0b gemerged.

Wat je bouwt: de taakbeschrijving. Regel: per company en per soort, meer dan 10 nieuwe binnen 60 minuten → 24 uur lang hooguit één push per uur per approver met het aantal; quota_request_decided nooit bundelen.

Klaar als: 30 aanvragen in 2 minuten op het seed-event geven 10 directe outbox-rijen en 20 met één collapse_key; de kick stuurt één payload "20 new requests"; pgTAP dekt venster, drempel, 24-uur-einde en dedupe; bestaande push-tests groen.
```

### Taak 0d — Crew-bug (z8uq9m2yvp, Opus; service-role-lookup → reviewer)

```
Scope-hek:
- Raakt: src/features/events/actions.ts (alleen inviteExternalCrew), de crew-invite-sheet onder src/components/po/screens/events/crew.tsx (foutmelding weg, succes-copy), src/lib/i18n, tests (events/actions.test.ts crew-cases, crew.demo-refusal.test.tsx), gastenlijst-app-spec.md (#24).
- Verboden: invite-mail.ts, platform-invites, alles buiten crew. Geen mail versturen (komt in taak 6 als template team_added_to_event).
- Deps: taak 0b gemerged (die raakt dezelfde actions.ts).

Wat je bouwt: de taakbeschrijving. Kern: in de alreadyRegistered-tak het account opzoeken via de service-client op user_profiles (gedocumenteerde uitzondering; de admin-check ervoor blijft de boundary) en daarna exact het bestaande pad: event_organizers via de user-scoped client, quota, revalidate. Geen venue-membership (#24).

Klaar als: vitest nieuw/bestaand/niet-admin; crew-user ziet alleen de gekozen events; test-handoff met staff@ als bestaand account.
```

### Taak 0g — Last-admin-guard (ClickUp n.n.b., Opus; trigger op venue_memberships → reviewer)

```
Scope-hek:
- Raakt: supabase/migrations/20261007160000_last_admin_guard.sql, supabase/tests/database/last_admin_guard.test.sql, src/features/venues/actions.ts (alleen removeMemberAction + updateMemberRolesAction), src/features/venues/components/RemoveMemberButton.tsx, src/components/po/screens/settings/team.tsx (alleen de verberg-conditie), src/lib/i18n settings-surface, gastenlijst-app-spec.md (#24 verfijning).
- Verboden: invites, crew, platform, alles buiten venue_memberships.
- Deps: taak 0b gemerged.

Bug (Max, 2026-10-07): een company-eigenaar kan zichzelf uit zijn company verwijderen; daarna heeft de company geen admin meer en kan niemand nog iemand uitnodigen. Max deed dit per ongeluk bij "Giorke Kantoor".

Wat je bouwt:
1. Database is de boundary: BEFORE DELETE en BEFORE UPDATE OF roles op public.venue_memberships weigeren (raise met een eigen SQLSTATE, bijv. 'P0LA1', en een duidelijke message) als de rij de laatste membership met 'admin' in roles van die venue is. Platform-admins krijgen GEEN uitzondering (een company zonder admin is nooit de bedoeling); het demo-venue-trigger-patroon uit 20260925150000 is het voorbeeld.
2. Server actions: removeMemberAction en updateMemberRolesAction geven de nette fout terug ("You're the only admin. Make someone else admin first.") en mappen de SQLSTATE in db-errors.ts.
3. UI: in Team is "Remove" en de admin-rol-wissel verborgen voor de laatste admin (zelf én door anderen), met een hint waarom.
4. Spec #24: "een company houdt altijd minstens één admin; de laatste admin kan zichzelf niet verwijderen of degraderen".

Klaar als:
- pgTAP: laatste admin delete → geweigerd; laatste admin roles zonder admin → geweigerd; tweede admin aanwezig → beide toegestaan; niet-admin-rij verwijderen → toegestaan; via de REST-API als venue-admin dezelfde weigering (RLS laat de delete toe, de trigger weigert).
- Vitest op de actions; `pnpm db:test` groen.
- Test-handoff: manager@ in de seed-company (enige admin) ziet geen Remove bij zichzelf; na een tweede admin wel.
```

### Taak 0e — Mail-infra F0 (z8uq9m2yvt, Opus; webhook + service-role-verzending → reviewer)

```
Scope-hek:
- Raakt: src/features/mail/** (nieuw), src/app/api/webhooks/resend/route.ts (nieuw), middleware-exempt voor /api/webhooks/ (bestaat), src/features/auth/invite-mail.ts (bestaand-account-tak), src/features/events/actions.ts (crew-mail-aanroep), migratie 20261007130000, .env.example, docs/mail-deliverability.md, docs/legal/README.md, tests (vitest provider/stub/guard, pgTAP mail_log + ledger, webhook-replay).
- Verboden: gastmail, notificatie-voorkeuren, digest (taak 6); Supabase-templates (taak 3); src/features/door/**.
- Deps: taak 0d gemerged; Max: RESEND_API_KEY + webhook-secret (lokaal zonder key = stub).

Wat je bouwt: de taakbeschrijving. Provider achter een interface zoals billing; verzending best effort en nooit in het deur-pad; drie templates met door Max gekozen copy.

Klaar als: zie de taak; plus de vitest-guard dat `resend` alleen onder src/features/mail/ wordt geïmporteerd.
```

### Taak 0f — Sentry-hygiene S1 (ClickUp "Sentry-hygiene S1", Sonnet)

```
Scope-hek:
- Raakt: src/lib/observability/capture.ts (+ test), src/features/po/PoLiveProvider.tsx (alleen de error-handlers), src/lib/db-errors.ts (MutationError-vorm herkennen), sentry.*.config.ts (ignoreErrors/beforeSend alleen voor netwerk-ruis), docs/runbook.md (Sentry-triage-paragraaf).
- Verboden: alles wat gedrag voor de gebruiker verandert; geen fouten verbergen die een bug zijn.
- Deps: taak 0b.

Wat je bouwt (triage 2026-10-06, 11 open issues in 14 dagen):
1. Verwachte gebruikersfouten niet rapporteren: een MutationError met een bekende code (42501 "You don't have rights", 'exists', 'invalid_input', 'already_handled', 'billing_*', validatie zoals "Start it with https://") is een breadcrumb, geen exception. Vier van de elf issues zijn dit.
2. Supabase PostgrestError-objecten ("Object captured as exception with keys: code, details, hint, message", 38 events) worden een Error met message + code-tag + hint in extra, zodat de titel leesbaar is en groepering klopt. Daarna de 34-events-burst van 6 dagen geleden terugvinden en benoemen.
3. Netwerk-ruis: "Load failed", "Failed to fetch", AuthRetryableFetchError bij navigator.onLine === false blijven weg (bestaat deels); online wél rapporteren maar met tag network.
4. EvalError (CSP blokkeert unsafe-eval, 19 events, 0 users): de stack in Sentry lezen en de bron benoemen (derde partij of eigen dependency); alleen filteren als het aantoonbaar extern is.
5. Android: "PlusOnePushConfig(.then()) is not implemented on android" komt uit een Android-build zonder de plugin-registratie en/of van vóór de thenable-fix in capacitor-provider.ts. Niet hier oplossen: in de PR-body vaststellen welke build in review staat en het aan het Capacitor-programma (S5-Android) doorgeven.

Klaar als: vitest op capture.ts voor elke categorie; na een week geen van de vier gebruikersfout-issues meer nieuw in Sentry; runbook beschrijft wat wel en niet in Sentry hoort.
```

### Taak 1 — Venue → Company (z8uq9m2vqc, Opus)

```
Scope-hek:
- Raakt: src/lib/i18n/** (alle surfaces), alle screens onder src/components/po/screens/ (alleen strings en labels), src/components/po/screens/settings/venue*.tsx (Type-veld), src/components/po/screens/events/edit.tsx (locatie-velden), src/features/po/adapters.ts + queries.ts (location), src/features/events/actions.ts + schemas (location), supabase/migrations/20261007120000_event_location.sql, src/lib/database.types.ts, gastenlijst-app-spec.md, design-system.md, copy-deck.md, docs/changelog.md.
- Verboden: src/features/billing/**, src/features/onboarding/** (behalve de string "venue" → "company" in bestaande copy), src/features/door/**, src/features/auth/**, alles onder supabase/migrations behalve je eigen bestand. Geen gedragswijzigingen tijdens de sweep: als een scherm "verbeterd" kan worden, noteer het in de PR en laat het staan.
- Deps: geen.

Wat je bouwt:
1. Sweep: elke gebruikerszichtbare "venue"/"Venue" wordt "company"/"Company" (incl. "Switch venue", "Venue settings", "New venue", mails, lege staten). Identifiers, tabellen, routes en `venue_id` blijven. Hardcoded strings die je tegenkomt verhuizen naar src/lib/i18n. Let op meervoud, bezitsvorm en zinsbouw; geen zoek-en-vervang zonder te lezen.
2. "Venue type" wordt "Type" met opties Club, Festival, Bar, Venue, Organizer (bestaande waarden blijven geldig; "Venue" en "Organizer" komen erbij).
3. Locatie per event: optionele `location_name` + `location_address` op events; formulier toont standaard het company-adres als placeholder; eventkaart, event-detail, de publieke request-pagina (/e/[slug]) en de door-header tonen de event-locatie als die gezet is, anders het company-adres. Places-autocomplete komt in taak 3; jij bouwt een gewoon tekstveld.
4. Tests: `tests/unit/no-mock-data-imports.test.ts` en `pnpm e2e:layout` groen; een unit-test op de adapter (locatie-fallback); snapshot van de i18n-catalogus zodat de sweep reviewbaar is.

Klaar als:
- `grep -rn -i "venue" src/lib/i18n/` levert alleen nog identifiers of de Type-optie "Venue" op.
- Een event met eigen locatie toont die op eventkaart, detail en /e/[slug]; een event zonder toont het company-adres.
- `supabase db reset` + `pnpm db:test` groen; `pnpm e2e:layout` groen op alle vijf devices.
- Spec: terminologie-paragraaf toegevoegd ("company" in de UI, `venues` in het datamodel; beslissing Max + Joeri 2026-10-06).

Test-handoff: manager@ → More, Switch company, Company settings, Events → nieuw event met locatie, publieke request-pagina van dat event.
```

### Taak 2 — Billing G (z8uq9m2vrz, Opus; high-risk → reviewer)

```
Scope-hek:
- Raakt: src/features/billing/**, src/features/onboarding/** (PlanStep/BetalingStep verwijderen, wizard-stappen), src/lib/auth/onboarding.ts, src/components/po/screens/settings/billing.tsx + settings.tsx (More-rij), src/components/po/screens/platform-venues.tsx (+ hooks/mutations voor de twee platform-acties), src/components/po/kit.tsx (BillingLockNote zonder CTA in de shell), src/lib/i18n/surfaces/settings.ts + platform.ts, de drie migraties 20261008*, src/lib/database.types.ts, docs/stripe-setup.md, .env.example, gastenlijst-app-spec.md (#32), tests (billing.native.test.tsx, native-store-tax.test.tsx, stripe-*.test.ts, pgTAP stripe_billing + nieuw platform_billing).
- Verboden: src/features/platform/invite-actions.ts (comped-invite is taak 3), src/features/door/**, screens buiten settings/platform.
- Deps: taak 1 gemerged (strings zeggen al "company").

Wat je bouwt (zie de taak-comments voor de details):
1. Eén plan Pro: PLAN_IDS = ['pro']; datamigratie; create_venue_with_owner zet plan_id = 'pro'; getOnboardingState kent geen stap 'plan' meer; wizard = Welkom → Company → Team in browser én shell (TrialStartStep mag blijven als vangnet of vervallen; motiveer).
2. Prijzen live uit Stripe via lookup keys pro_monthly/pro_yearly (BillingProvider.listPrices, server-side cache, stub geeft null); korting berekend; geen bedragen of price-ids in code of env; `config.ts` zonder priceIds; misconfiguratie-guard verhuist naar de eerste checkout.
3. Maand/jaar-keuze bij "Set up payment"; webhook schrijft billing_interval; Billing toont "€X / month|year" en "Renews".
4. Creditcard in payment_method_types; finance-rol in callerIsVenueAdmin (hernoem naar callerMayManageBilling).
5. Platform-tab per venue: "Trial until <datum>" en "Always free" via set_venue_trial_end / set_venue_comped; trialEndsAt() en de gate lezen de override; "Always free" uit = trialing met override vandaag + 14d.
6. Native: PR #387 blijft de norm. Plannaam + status + "Trial ends in N days." + "Subscription changes aren't available in the app."; geen prijs, geen knop, geen URL, geen copy-link, geen verwijzing naar de browser (Apple 3.1.3(f): geen call-to-action buiten de app). BillingLockNote in de shell zonder knop. Nieuwe e2e-guard "native-shell" in pnpm e2e:smoke (Playwright, addInitScript met window.androidBridge): /onboarding zonder plan/betaalstap; /app en /app/billing zonder "€", "Set up payment", "Manage", URL of link.
7. Gate-check uit §9 (spike): als de spike een bug vond, fix die hier eerst in een eigen commit.

Klaar als:
- Nieuwe owner in de browser: Welkom → Company → Team, ziet nergens een plan of prijs; More → Billing toont "Pro · Trial ends in 14 days" en de twee intervals met bedragen uit Stripe (lokaal: stub → "price shown at checkout").
- Zelfde flow in de native-shell-tests: geen Billing-rij, geen scherm, geen prijs.
- Platform-admin (admin@ na `pnpm dev:mfa`) zet een venue op "Always free" en terug; audit_log toont beide rijen op zijn uid; venue-admin krijgt 42501 op dezelfde RPC (pgTAP).
- `pnpm db:test` groen, stripe-webhook-tests groen met billing_interval; `tests/unit/service-worker-cache-scope.test.ts` ongewijzigd groen.
- Spec #32 herzien: één plan Pro (maand/jaar, 20% jaarkorting), creditcard erbij, prijzen via lookup keys, platform-override; `docs/stripe-setup.md` §1 en §2 herschreven.

Test-handoff: admin@ en finance@ → More → Billing; nieuwe company via More → Switch company → New company; Platform-tab → venue → trial/always free.
```

### Taak 2b — Platform R (z8uq9m2ybj, Opus; SECURITY DEFINER-aggregaten → reviewer)

```
Scope-hek:
- Raakt: supabase/migrations/20261008130000_platform_overview_rpcs.sql, src/components/po/screens/platform.tsx + platform-venues.tsx + nieuw platform-overview.tsx, src/components/po/routes.ts + nav-map.ts (nieuw scherm 'platformoverview'), src/features/po/ (hooks/queries/adapters voor platform), src/features/billing/provider.ts (alleen listPrices() hergebruiken), src/lib/i18n/surfaces/platform.ts, tests (platform-*.visibility.test.tsx, pgTAP platform_overview), tests/e2e/layout (scherm toevoegen).
- Verboden: billing-actions, onboarding, door, alles wat gast-rijen leest (alleen aggregaten).
- Deps: taak 2 gemerged (billing_interval, listPrices, trial_ends_at bestaan).

Wat je bouwt: zie de taakbeschrijving (scope A per invite, scope B Overview). MRR = maandbetalers × maandprijs + jaarbetalers × jaarprijs / 12, excl. BTW, uit eigen records; label dat in de UI. De omzetkaart alleen in de browser (isNativeShell()).

Klaar als:
- Seed: Overview toont 2 companies in de juiste statussen; MRR 0 met de stub; admin@ (na pnpm dev:mfa) ziet het scherm, manager@ niet (RPC 42501, scherm rendert niets).
- Invite met aangemaakte company toont de chip; Switch schrijft een platform_access_log-rij.
- pgTAP groen; pnpm e2e:layout groen met het nieuwe scherm in de matrix.

Test-handoff: admin@ → Platform → Overview; Platform → Invites → chip → Switch; Platform → Venues.
```

### Taak 2c — Billing-mails B1 (z8uq9m2z19, Opus; service-role-job → reviewer)

```
Scope-hek:
- Raakt: src/features/mail/templates/billing-*.tsx (nieuw), src/features/billing/mail-schedule.ts (nieuw: welke mail is vandaag verschuldigd, pure functie + tests), de geplande job (zelfde mechanisme als taak 6/0c), src/features/billing/stripe-webhook.ts (payment_failed/canceled → mail), migratie 20261008140000, Platform R-schermen (tijdlijn per company, Overview-telling), src/lib/i18n/surfaces/platform.ts, pgTAP + vitest.
- Verboden: checkout/portal-code, onboarding, gastmail.
- Deps: taak 0e, 2 en 2b gemerged; Max: copy voor zeven templates gekozen (§6).

Wat je bouwt: de taakbeschrijving (schema dag 0/7/12/14/21 + payment_failed + canceled; comped en gepauzeerd nooit; override verschuift de dagen mee; idempotent via mail_log).

Klaar als: zie de taak. De schema-functie is puur en getest op alle dagen, de override en een gemiste dag.
```

### Taak 3 — Onboarding A (z8uq9m2vg5, Opus; invite-metadata = high-risk → reviewer)

```
Scope-hek:
- Raakt: src/features/platform/invite-actions.ts + platform-screens (comped-vinkje), src/features/auth/invite-mail.ts (metadata kind/invited_by/company), docs/email-templates/invite.html (nieuw), supabase/config.toml ([auth.email.template.invite]), src/features/onboarding/components/steps/VenueStep.tsx (DPA-checkbox i.p.v. Terms+Privacy; Places-autocomplete), src/app/api/places/route.ts (nieuw, proxy), src/lib/places/** (nieuw), src/components/po/screens/events/edit.tsx (dezelfde autocomplete op de event-locatie uit taak 1), migratie 20261009120000, docs/legal/README.md (Google als subprocessor), .env.example (GOOGLE_PLACES_API_KEY), gastenlijst-app-spec.md (#40 consent-paragraaf).
- Verboden: src/features/billing/** behalve het aanroepen van set_venue_comped; door; requests.
- Deps: taak 2 gemerged (set_venue_comped bestaat; wizard zonder plan-stap). Max: Google Cloud-project + Places-key in Vercel (§6); Supabase invite-template geplakt (§6); copy gekozen (§6).

Wat je bouwt:
1. Platform-invite met "comped"-optie; create_venue_with_owner zet de venue comped als de invite dat zegt (migratie); zichtbaar in de Platform-tab.
2. Eén akkoord per moment: VenueStep toont alleen de DPA-checkbox ("I accept the Data Processing Agreement on behalf of {company}"); Terms+Privacy blijven op /consent. venues.terms_accepted_* blijft de opslag (hernoem niet; documenteer in de spec dat het de DPA-acceptatie is).
3. Invite-mail: metadata kind/invited_by/company op beide invite-paden; template met {{ if eq .Data.kind "company" }}-tak volgens §9 (spike 4). Als §9 zegt dat de voorwaarde niet rendert: bouw NIET de hook-route; meld het en laat het template statisch met alleen invited_by.
   HERZIEN (2026-10-07, zie golf D): team- en crew-uitnodigingen lopen na 0d vervolg B al via `generateLink` + Resend. Bevestig bij de start met Max of de company-tak ook die route krijgt (voorkeur: ja, één mailpad); dan geen Supabase-template en geen metadata in `data`.
4. Places: server-route die Places API (New) Autocomplete + Place Details proxiet met session tokens; key alleen server-side; rate limit per user (bestaande throttle-helper); client-component op VenueStep, Company settings en event-locatie; zonder key valt het veld terug op gewoon typen.

Klaar als:
- Platform-invite met comped → nieuwe owner doorloopt Welkom → Company → Team en ziet in More → Billing "Always free"; audit_log toont set_venue_comped op de uitnodiger.
- Invite-mail in Mailpit toont de company-tak met de naam van de uitnodiger; team-invite toont de team-tak.
- Zonder GOOGLE_PLACES_API_KEY werkt het adresveld als tekstveld; met key vult één selectie naam + adres; de key staat niet in de client-bundle (secret-grep-guard uitbreiden).
- /consent vraagt Terms+Privacy, VenueStep alleen de DPA; pgTAP op create_venue_with_owner met comped.

Test-handoff: admin@ (platform) → Platform → Invite met comped; de uitgenodigde via Mailpit; manager@ → Company settings → adres via Places.
```

### Taak 3b — Event-locaties L (ClickUp n.n.b., Opus; SECURITY DEFINER → reviewer)

```
Scope-hek:
- Raakt: supabase/migrations/20261009130000_event_locations.sql, src/components/po/screens/settings/venue.tsx (sectie Locations: lijst, toevoegen met de Places-component uit taak 3, bewerken, archiveren), src/components/po/screens/events/edit.tsx (locatie kiezen uit de opgeslagen locaties of eenmalig invullen), src/features/po/adapters.ts + queries.ts, src/features/events/actions.ts + schemas (location), src/features/venues/actions.ts + schemas (locations), src/app/e/[slug]/**, src/features/requests/status-view.ts + de publieke statuspagina, src/lib/i18n, src/lib/database.types.ts, pgTAP, vitest, tests/flows, gastenlijst-app-spec.md (#48(c) herzien + beslistabel), docs/changelog.md.
- Verboden: src/features/billing/**, src/features/door/** (door-header = taak 4), src/features/auth/**, invite-mail, andere migraties.
- Deps: taak 3 gemerged (Places-component + proxy); taak 1 gemerged (events.location_name/location_address).

Besluit Max (2026-10-07), bindend:
- De deellink (/e/[slug]) en de statuspagina tonen ALTIJD de locatie van het event (naam + adres). Het companyadres wordt daar nooit getoond. Event-locatie en companyadres mogen gelijk zijn, maar wat zichtbaar is, is altijd het adres van het event. Het event-adres is bewust publiek (het is een deellink); dit vervangt de oude regel uit #48(c) "adres pas na goedkeuring".
- Een company kan meerdere locaties opslaan en kiest er per event één (of vult eenmalig een andere in).

Wat je bouwt:
1. `company_locations` (venue_id, name, address_line, postal_code, city, country, place_id nullable, archived_at): RLS lezen voor leden van de venue, schrijven alleen admin; grant matrix (revoke eerst, dan grant); pgTAP allowed/denied per rol.
2. Event-formulier: kies een opgeslagen locatie (default: de eerste/standaardlocatie, bij een nieuwe company gevuld vanuit het companyadres) of vul eenmalig in. Opgeslagen wordt altijd een kopie op het event (`location_name`/`location_address`), zodat het wijzigen of archiveren van een opgeslagen locatie geen bestaande events verandert.
3. Publiek: /e/[slug] en de statuspagina tonen alleen de event-locatie. `get_request_status` (SECURITY DEFINER, anon) geeft de event-locatie terug; de app leest de companyadres-kolommen niet meer (expand–contract: droppen in een latere migratie). Bestaande events zonder locatie: de migratie vult `location_name`/`location_address` eenmalig vanuit het companyadres (besluit Max 2026-10-07: nog niet live, de testende organisatoren gebruiken het niet, dus geen risico). Daarna heeft elk event een eigen locatie; een nieuw event krijgt de standaardlocatie voorgevuld.
4. Tests: pgTAP op company_locations en de nieuwe get_request_status-signature (exacte kolommen, SECURITY DEFINER + search_path, grants, geen companyadres in de output); vitest op de adapter; flow: Company settings → locatie toevoegen → event met die locatie → /e/[slug] en de goedgekeurde statuspagina tonen de event-locatie.
5. Deploy-volgorde in de PR-body: prod-push vóór merge als de app de nieuwe kolommen/RPC-output leest.

Klaar als: een company met twee opgeslagen locaties kiest per event een locatie; /e/[slug] en de statuspagina tonen die en nooit het companyadres; bestaande events zijn eenmalig gevuld vanuit het companyadres; reviewer-ronde schoon; spec #48(c) herzien.

Test-handoff: admin@ → Company settings → Locations (twee toevoegen) → nieuw event met de tweede locatie → deellink → aanvraag goedkeuren → statuspagina.
```

### Taak 4 — Check-in D (z8uq9m2vg6, Opus; RLS → reviewer)

```
Scope-hek:
- Raakt: src/features/door/** (model, outbox, components, offline), supabase/migrations/20261010120000 + 20261010120100, src/components/po/screens/settings/venue*.tsx (toggle "Door hosts can undo check-ins"), src/lib/i18n/surfaces/door.ts + settings.ts, pgTAP (check_ins_*), src/components/po/door-render-isolation.test.tsx (blijft groen).
- Verboden: alles buiten door/settings; geen server action voor check-in of undo (outbox, #25).
- Deps: §9 spike 2 (absolute-count-ontwerp) en taak 1.

Wat je bouwt:
1. Check-in-UI: primaire knop "Check in all (N)" (N = 1 + plus_ones), secundaire knop "Check in 1" die het absolute aantal met één verhoogt en de stand toont (3/4). De vraag "hoeveel personen" vervalt.
2. Outbox: upsert op dezelfde check_ins.id met plus_ones_arrived + client_timestamp; server-RPC negeert oudere client_timestamp; maximum 1 + plus_ones afgedwongen in de database.
3. Uitchecken: venue-setting doorhost_can_check_out (default false); RLS/RPC weigert een undo van een doorhost zonder die setting; admin/manager altijd; de outbox-replay van een geweigerde undo wordt netjes afgevoerd (geen eindeloze retry) en gemeld in de door-UI.

Klaar als:
- pgTAP: replay van hetzelfde outbox-item muteert niet; oudere timestamp genegeerd; boven maximum geweigerd; doorhost undo geweigerd met setting uit en toegestaan met setting aan; manager altijd; audit-rijen aanwezig.
- Offline-scenario in de e2e-smoke of een unit-test op de outbox: twee tikken offline, online = één rij met het laatste absolute aantal.
- Deur-variant op <1024px en op fine-pointer ≥1024px (cockpit) allebei aangepast; hit-targets ≥44px (touch-density-test).

Test-handoff: door@ → Check-in op het seed-event; manager@ → Company settings → toggle; door@ opnieuw.
```

### Taak 5 — Event C + Dashboard B (z8uq9m2vg7 + z8uq9m2vg8, Opus)

```
Scope-hek:
- Raakt: src/components/po/screens/home.tsx (requests lege staat), events/*.tsx (Add guest-knop, Tasks-tab weg, gastdetail Edit-knop, tijdkiezer, tier-stap), settings/quota.tsx (Invite team member), settings/team.tsx (invite-sheet exporteren voor hergebruik), src/lib/i18n/surfaces/*, bijbehorende tests.
- Verboden: features/**, migraties, door.
- Deps: taak 1.

Wat je bouwt: de punten uit beide taakbeschrijvingen plus de comments "Invite team member" en de terugknop-bug op de template-editor (templates.tsx: een useEffect in de lijst pusht de editor opnieuw na back; vervang de auto-open door een lege-staat-knop). Eén PR, beide ClickUp-taken bijgehouden.

Klaar als:
- Alle punten zichtbaar op 390px en 1280px; `pnpm e2e:layout` groen; hit-targets ≥44px.
- Requests-blok: 0 requests en geen request-link → kaart met "Create request link"; mét data → bestaand blok (unit-test op de conditie).
- Tijdkiezer zonder afgekapte tekst op 390px (screenshot in de PR).
- "Invite team member" alleen voor admin/user_manager; invite landt in `invites` + audit.

Test-handoff: manager@ → Home, Events → nieuw event → tier-stap, event openen → Add guest, gastdetail, Quota per event.
```

### Taak 5b — Share-import S2 (ClickUp n.n.b., Opus)

```
Scope-hek:
- Raakt: public/manifest.json (Web Share Target: method GET, params text/title/url → /app/share), src/components/po/routes.ts + nav-map.ts (screen 'share', bookmarkbaar, G1), src/components/po/screens/share.tsx (nieuw: toont de gedeelde tekst, kiest event (default: eerstvolgende) en tier, hergebruikt de bestaande Paste a list-preview en import; leest de tekst uit de query óf uit een in-memory `shareInbox`-store die de native plugin uit S6 later vult), src/features/guests/ (paste-parser: per regel naam + optioneel +N (quick-add-parser) + optioneel e-mail of telefoon (contacts/import/parse), tab- en komma-gescheiden regels uit Excel/Sheets, kopregel "Name/Email" overslaan), de preview-telling ("6 entries = 9 total guests (2 with email)"), tests/flows/share, i18n guests-surface. src/features/notifications is NIET het pad (dit is geen push).
- Verboden: alles native (android/, ios/, Capacitor-plugins): dat is S6 in capacitor-plan-claude-code.md §4 (plugin `PlusOneShareInbox` voor Android ACTION_SEND én de iOS Share Extension), in de eerstvolgende store-build nadat deze taak live is; de gedeelde tekst server-side opslaan of loggen (namen en e-mails = PII; alles blijft client-side tot de bestaande import-actie); src/features/door/**; wijzigingen aan de import-RPC.
- Deps: taak 1 (strings), bij voorkeur na taak 5 (zelfde guests-screens).

Wat je bouwt: de drie stappen uit de concurrent-screenshots van 2026-10-07: (1) delen vanuit WhatsApp/Mail/Notes/Excel via de OS-share-sheet, (2) PlusOne kiezen, (3) landen op Paste a list met de tekst al ingevuld, event- en tier-keuze, de telling, en de bestaande Import-knop. Op Android werkt dit meteen als geïnstalleerde PWA via share_target; in de native shells (Android intent, iOS Share Extension) via S6 uit het Capacitor-programma, dat dezelfde /app/share-route gebruikt. De gedeelde tekst mag nooit in een URL naar de server lekken: share_target met GET levert de tekst in de query, dus de /app/share-route is client-only (ssr:false zoals de shell), leest de query, en vervangt de URL meteen via history.replaceState zonder de tekst (geen PII in URL's, CLAUDE.md).

Klaar als:
- Android (Chrome, geïnstalleerde PWA): tekst delen vanuit WhatsApp → PlusOne in de share-sheet → Paste a list met de tekst, event en tier → Import; de URL bevat daarna geen tekst meer.
- Desktop/elke browser: /app/share?text=… met een plakvoorbeeld landt op Paste a list; de in-memory store-route is unit-getest (S6 vult hem later).
- Parser-tests: "Milan Hendriks +2" = 1 gast met 2 extra; "Fleur Janssen fleur@example.com" = gast met e-mail; "Name<tab>email" uit Sheets; kopregel overgeslagen; telling klopt.
- Flow in tests/flows/share met de native-shell-variant; geen request bevat de gedeelde tekst behalve de bestaande import-actie.

Test-handoff: manager@ op Android → delen vanuit WhatsApp; op desktop → /app/share?text= met een plakvoorbeeld.
```

### Taak 6 — Gastcommunicatie F (z8uq9m2vpy, Opus; webhook + publieke route → reviewer)

```
Scope-hek:
- Raakt: src/features/mail/** (nieuw: provider-interface + Resend-adapter + templates + queue), src/app/api/webhooks/resend/route.ts (nieuw), src/app/u/[token]/route.ts (afmelden, publiek, rate-limited), de drie migraties 20261013*, src/features/guests/actions.ts + contacts/actions.ts + requests-approve (hooks die een mail inplannen), src/features/events/actions.ts (tijd/locatie-wijziging, annulering → updates), src/components/po/screens/settings/venue*.tsx (contact-e-mail + kanalen), events/* (checkbox "Send confirmation" bij toevoegen; "Send reminder" voor platform-admin achter flag), src/lib/i18n, docs/legal/README.md (Resend gastmail actief), gastenlijst-app-spec.md (#10), tests (vitest op templates/queue, pgTAP op mail_log en optout, webhook-replay).
- Verboden: src/features/door/** (de deur stuurt nooit mail en wacht nooit op mail), billing.
- Deps: taak 0e (mail-infra, mail_log, webhook bestaan), taak 1 (event-locatie), taak 2 (settings-structuur); copy gekozen (§6).

Wat je bouwt (taakbeschrijving + comments zijn leidend):
1. Hergebruik de provider en mail_log uit taak 0e; voeg alleen gast- en teamnotificatie-types toe.
2. Verzenden server-side, nooit in het request-pad van de deur; bulk via wachtrij + batch-API; per-company rate limit; mail_log zonder inhoud/PII.
3. Triggers: toevoegen (alle paden), +N-wijziging, tijd/locatie-wijziging, annulering, verwijderen (verplichte opmerking), request-besluit (de RPC uit taak 7 roept dit later aan; jij levert de functie).
4. Company-contact: contact_email verplicht vóór "publish/live" van het eerste event (afgedwongen in de actie met een duidelijke fout), kanalen optioneel; reply-to = contact_email; afzender "{Company} via PlusOne".
5. Afmelden per company via token-route; respecteren bij elke verzending; gast blijft op de lijst.
6. Reminder: "Send reminder" per event, alleen is_platform_admin(), achter env-flag GUEST_REMINDER_ENABLED.
7. .ics-bijlage; huisregels-veld per event.
8. Teammails (comment op de taak, Max 06-10-2026): elke gastenlijst-aanvraag direct (met de bundel-regel uit taak 0c), quota-aanvraag direct, besluit terug naar de aanvrager, dagelijkse samenvatting 09:00 van wat open staat. Voorkeuren per gebruiker in Profile (push aan/uit; e-mail direct / dagelijks / uit), afmeldlink per teammail. notification_outbox krijgt een channel; migratie 20261013120300.

Klaar als:
- Lokaal (stub) laat de mail_log elke trigger zien met type en status; met test-key komt de mail aan.
- Teammail: een aanvraag op het seed-event geeft een mail_log-rij team_request per approver; de dagelijkse samenvatting geeft niets bij een lege set; prefs-RLS alleen eigen rij (pgTAP).
- Webhook: signature-check, replay geeft 200 zonder mutatie (pgTAP zoals stripe_webhook_events).
- Afmeldlink: geldig token → optout-rij, ongeldig → generiek 200 zonder informatie-lek; rate limit.
- Publish zonder contact_email → fout met uitleg; met → ok.
- Spec #10 herzien; legal README: Resend gastmail actief.

Test-handoff: manager@ → Company settings → contact; event → gast toevoegen met e-mail → Mailpit/Resend; +N wijzigen; gast verwijderen met opmerking.
```

### Taak 7 — Requests E (z8uq9m2vga, Opus; SECURITY DEFINER → reviewer)

```
Scope-hek:
- Raakt: supabase/migrations/20261015120000_request_decision_split.sql, src/features/requests/** (actions, schemas), src/features/po/ (hooks/mutations/adapters voor requests), src/components/po/screens/aanvragen*/requests* (approve-sheet met inkorten, splitsen per tier, deels afwijzen, opmerking), src/features/mail (alleen aanroepen van de status-mailfunctie uit taak 6), pgTAP (guest_requests_decide), gastenlijst-app-spec.md.
- Verboden: door, billing, onboarding.
- Deps: taak 6 (statusmail), §9 spike 3 (datamodel).

Wat je bouwt: één RPC die een aanvraag atomair afhandelt volgens een jsonb-besluit ({approved: [{tier_id, plus_ones}], declined: n, note}), met quota-check per aangemaakte gast (1 + N), verplichte opmerking bij declined > 0 of bij inkorten, audit per gast en op de aanvraag; de UI-sheet erbovenop; de statusmail via taak 6.

Klaar als:
- pgTAP: splitsen maakt N gasten met de juiste tiers en +N; quota-overschrijding rolt alles terug; opmerking verplicht; staff zonder rechten geweigerd; audit-rijen.
- Stats tellen het afgewezen deel als decline.
- Mail-log toont één statusmail per besluit.

Test-handoff: manager@ → Requests → aanvraag +3 → 1 Backstage, 1 Guest, 1 afwijzen met opmerking.
```

### Taak 8 — Quota-aanvraag Q (z8uq9m2xyp, Opus; SECURITY DEFINER → reviewer)

```
Scope-hek:
- Raakt: supabase/migrations/20261016120000_quota_request_guest_payload.sql, src/features/quotas/** (request + approve actions, schemas), src/features/po/ (hooks/mutations/adapters voor quota-requests en de Updates-kaart), src/components/po/screens/home.tsx (Updates-kaart), het quota-aanvraagformulier en de quota-beslis-sheet (Requests → Quota-tab), src/lib/i18n, pgTAP (quota_requests_*), gastenlijst-app-spec.md.
- Verboden: guest_requests (taak 7), door, billing, mail (de native push bestaat al; geen nieuwe push-soort).
- Deps: taak 7 gemerged.

Wat je bouwt: zie de taakbeschrijving. Kern: (1) Updates-kaart op Home voor de aanvrager, met verplichte reden bij afwijzen; (2) optionele gast-payload bij de aanvraag, zichtbaar voor de admin; (3) approve_quota_request maakt bij een payload de gast aan in dezelfde transactie via het bestaande add-guest-pad (quota-math, audit en lock-regels blijven gelden), op naam van de aanvrager; mislukt dat, dan rolt alles terug met een duidelijke fout.

Klaar als (pgTAP + vitest):
- Akkoord met payload: quotum +n én één gast met juiste tier en +N, added_by = aanvrager, audit-rijen voor beide, request fulfilled.
- Akkoord zonder payload: alleen quotum. Payload boven het nieuwe quotum: alles teruggedraaid.
- Afwijzen zonder reden: geweigerd. Aanvrager leest alleen eigen requests en zet alleen eigen seen_at.
- Home toont de kaart na een beslissing en niet meer na "Got it" of na toevoegen.

Test-handoff: staff@ → Requests → Quota → aanvraag +2 met gastnaam; manager@ → beslist; staff@ → Home.
```

### Taak 9 — Snelheid P2 (z8uq9m2xz2, Opus; middleware, RLS, service worker → reviewer per PR)

```
Scope-hek: per punt uit docs/perf-audit-2026-10.md één PR (pushState; windowing + Home-base-query; requests-lijst; Regulars-RPC; cockpit-patch; SW-timeout; middleware getClaims; RLS set-based + check_ins-policy-merge; klein). Migraties 20261017120000/120100. De deur-navigatie blijft buiten de pushState-PR tot de door-guards groen zijn op de rest.
Deps: taak 8, of eerder op aanwijzing van Max. Voor getClaims: Max bevestigt asymmetrische JWT-signing-keys in het Supabase-dashboard.
Klaar als: zie de taakbeschrijving (Network-screenshot tab-wissel; 300-events-seed laadt alleen het venster; pgTAP allowed/denied; SW-guards groen).
```

## 5. Reviewer-gate (taken 0b, 0c, 0d, 0e, 2, 2b, 2c, 3, 4, 6, 7, 8, 9)

Eén laag vóór de merge, precies zoals CLAUDE.md "Review gates" het vraagt: **de fresh reviewer-sessie hieronder** (`/code-review high` + `/security-review` + de aanvalsvragen die specifiek zijn voor wat er veranderde). Geen `/code-review ultra` (besluit Max 2026-10-06, golf A: niet nodig, CLAUDE.md vraagt het niet). Niet-high-risk PR's: blokkerende CI is de vloer, plus de eigen diff-lezing van de orchestrator. De bouwer verwerkt blokkerende en should-fix-punten in dezelfde branch en resolvet de threads; daarna merget de orchestrator.

### Reviewer-brief (fresh session)

```
Je reviewt PR #<NR> ("<TITEL>") van PlusOne Guestlist als onafhankelijke, verse sessie. Model: Opus. Je hebt de PR niet gebouwd.

Lees CLAUDE.md (security-checklist, review gates, grant matrix, non-negotiables, de Capacitor-checklist) en de security-research-prompt in de PR-body. Voer uit:
1. /code-review high op de PR.
2. /security-review op de branch.
3. De aanvalsvragen uit de PR-body één voor één, met de code erbij. Standaardvragen per taak:
   - Billing (2): kan een venue-admin set_venue_comped of set_venue_trial_end aanroepen? Overschrijft een webhook ooit comped of de override? Lekt een prijs of knop in de native shell (test de guards zelf)? Kan een finance-rol van venue X een portal van venue Y openen?
   - Onboarding (3): kan iemand zonder platform-admin een comped-invite maken? Is de Places-key server-only, ook in een preview-build? Wat doet de template met metadata die HTML bevat (invited_by)?
   - Check-in (4): kan een doorhost via de REST-API een undo doen met de setting uit? Kan een replay met oudere client_timestamp een hoger aantal terugzetten? Kan plus_ones_arrived boven 1 + plus_ones komen via een directe upsert?
   - Mail (6): kan een venue-lid mail_log van een andere venue lezen? Replay van het Resend-webhook? Afmeld-token raden of enumereren? Stuurt de deur ooit mail of wacht hij op mail? Is er PII in logs of URL's?
   - Requests (7): kan de RPC quota omzeilen via een negatieve plus_ones of een tier van een andere venue? Is de opmerking echt verplicht in de database, niet alleen in de UI?
   - Snelheid P1 (0b): overleeft een via cache() gedeelde getUser een binnen hetzelfde request ingetrokken sessie? Blijft de volgorde consent → MFA → app exact gelijk? Lekt de badge-count iets aan staff/doorhost?
   - Quota (8): kan de aanvrager via de payload een tier van een andere venue of een plus_ones boven het quotum laten aanmaken? Kan iemand anders seen_at of de payload van een ander wijzigen? Blijft de list-lock gelden bij auto-add?
   - Snelheid P2 (9): laat getClaims een verlopen of ingetrokken token door waar getUser dat niet deed? Geven de set-based policies exact dezelfde allowed/denied-matrix per rol (pgTAP diff)? Verandert de SW-timeout de PII-scoping van de caches?
Alle bevindingen als review-comments op de PR; blokkerend = "Request changes". Geen bevindingen = één approve-comment met wat je concreet geprobeerd hebt. Geen fixes pushen.
```

## 6. Wat Max doet, en wanneer

| Wanneer | Max |
|---|---|
| vóór wave 0 | Antwoord op de open besluiten in §9 (deep link, phone-opt-in, seed-reset). Nu meteen: de 11 trialing venues op `comped` via `docs/stripe-setup.md` §5; mailbox support@plus-one.io aanmaken; Supabase Auth invite-expiry naar 7 dagen; Stripe-dashboard factuur- en betaalbevestigingsmails aan. |
| vóór taak 2 | Stripe-dashboard op de eenmanszaak: product Pro met prijzen `pro_monthly` en `pro_yearly` (jaar = 12 × maand × 0,8), test én live; BTW-tarief; Customer Portal (betaalmethode, facturen, wisselen maand/jaar, opzeggen per periode-einde); dunning; webhook-endpoint; branding. Checklist: ClickUp 86ey6bga8. Env-vars pas ná de merge van taak 2 zetten. |
| vóór taak 2c | Copy kiezen voor de zeven billing-mails (trial dag 0/7/12/14/21, betaling mislukt, opgezegd); dagen in het schema bevestigen of aanpassen. Stripe-dashboard: eigen dunning-mails uit (wij sturen `billing_payment_failed`), facturen/bevestigingen aan. |
| vóór taak 3 | Google Cloud-project (zelfde als Android), billing aan, Places API (New), key beperkt tot `app.plus-one.io` + Places → `GOOGLE_PLACES_API_KEY` in Vercel. Invite-mail-copy kiezen (copy-sessie met `docs/copy-prompt.md`, twee takken: company en team). Na de merge: template-HTML uit `docs/email-templates/invite.html` in Supabase → Authentication → Emails → Invite user plakken. |
| vóór taak 0e | Resend (spike 9.5): **(1)** Dashboard → Billing: welk plan? Op Free (100/dag, 3.000/maand) deelt de login-OTP het quotum met alle app-mail; vóór 0e live gaat → **Pro** (≈ $20/maand, 50k/maand, geen daglimiet). **(2)** API Keys → nieuwe key, permissie **Sending access**, domein **`plus-one.io`** (niet de SMTP-key hergebruiken; die blijft alleen in Supabase) → `RESEND_API_KEY` in Vercel (Production, server-only). **(3)** Domains → `plus-one.io` staat op Verified in **hetzelfde** Resend-account als die key. **(4)** Webhooks → endpoint `https://app.plus-one.io/api/webhooks/resend`, events `email.delivered`, `email.bounced`, `email.complained` (+ `email.delivery_delayed`) → signing secret als `RESEND_WEBHOOK_SECRET`. Pas zetten ná de merge van 0e. **(5)** Bevestigen dat batch-verzending en webhooks in het plan zitten (volgens de prijspagina: alle plannen). Copy kiezen voor de drie team-invite-mails (team join bestaand account, crew added, resend). |
| vóór taak 6 | Mail-copy kiezen: zes templates (on the list, +N gewijzigd, tijd/locatie gewijzigd, geannuleerd, verwijderd, reminder) plus de drie statusmails uit taak 7 (voorstel v1 staat als comment op z8uq9m2vga). |
| vóór taak 0b | Supabase-dashboard: Auth DB connection strategy naar percentage. Vercel: checken of Fluid compute aan staat (cold starts). Voor P2 later: staan asymmetrische JWT-signing-keys aan? |
| per taak | Test-handoff beantwoorden, reviewer-sessie starten bij 0b/2/3/4/6/7/8/9, mergen, prod-push van migraties vanuit de linked main-checkout. |
| na taak 2 | De vier… drie env-vars live zetten; test-mode-verificatie uit `docs/stripe-setup.md` §3; venues die gratis blijven via Platform-tab op "Always free". |
| parallel | Legal (z8uq9m2vh6) in de Plus-One.io-repo; `TERMS_VERSION` bumpen als de tekst materieel wijzigt. |

## 7. Besluiten van 2026-10-06 (compact, zodat niets verloren gaat)

| Onderwerp | Besluit | Raakt spec |
|---|---|---|
| Plan | Eén plan Pro, altijd 14 dagen gratis; maand of jaar (20% korting, vooraf) | #32 |
| Prijzen | Nooit in code of env; Stripe lookup keys `pro_monthly`/`pro_yearly`, live opgehaald en gecachet | #32 |
| Betaalmethoden | SEPA, iDEAL, creditcard | #32 |
| Billing-rechten | admin én finance | #32 |
| Native billing | Status + neutrale zin (PR #387): plannaam, status, "Subscription changes aren't available in the app."; geen prijs, knop, URL of copy-link. Netflix-stijl afgewezen (call-to-action, Apple 3.1.3(f) / Play). Uitleg over billing gaat via mail en website | #32 (f), #37 |
| Trial-beheer | Platform-admin: "Trial until <datum>" en "Always free" per venue, RPC + audit; vervangt SQL-runbook | #32 (d) |
| Onboarding | Welkom → Company → Team; geen plan- of betaalstap; trial start stil | #40 |
| ADE | Comped via de platform-invite | #40 (b) |
| Consent | Account = Terms + Privacy; company-aanmaak = alleen DPA | #40 consent |
| Terminologie | "Company" in de UI; `venues` in het datamodel; Type = Club/Festival/Bar/Venue/Organizer | nieuw |
| Event-locatie | Optioneel per event, standaard company-adres; Places-autocomplete op beide | nieuw |
| Invite-mail | Supabase blijft de afzender; één template met company/team-tak op metadata; geen misbruik van andere templates | #20 |
| Gastmail | Toegestaan: transactioneel over de eigen lijstplek; verplichte opmerking bij verwijderen/afwijzen; company-contact verplicht; afmelden per company; reminder alleen platform-admin (test) | #10 herzien |
| Check-in | Groep-eerst; één rij per gast met absoluut aantal; uitchecken per venue instelbaar (RLS) | #22/#25 |
| Requests | Inkorten, splitsen over tiers, deels afwijzen, verplichte opmerking; statusmail | #10, nieuw |
| Legal | Eenmanszaak, geen BV/VOF | legal docs |
| Last-admin-guard | Een company houdt altijd minstens één admin; de laatste admin kan zichzelf niet verwijderen of degraderen (trigger, niet alleen UI) | #24 |
| Share-import | Delen vanuit WhatsApp/Mail/Notes/Excel naar PlusOne landt op Paste a list met event- en tier-keuze; +N en e-mail herkend. Web-kant hier (5b); native share-sheet op Android én iOS = S6 in het Capacitor-programma. Timing (Max 2026-10-07, na een test van de concurrent: hun share-knop verschijnt niet in WhatsApp of Instagram op Android, dus marketing, geen werkende feature): niet naar voren trekken; 5b blijft in golf D en S6 komt in de eerste build ná de store-goedkeuring; gedeelde tekst nooit in URL of server-log | #33, #37 |
| Quota-aanvraag | Melding terug op Home (reden verplicht bij afwijzen); gast optioneel meegeven; akkoord zet de gast direct op de lijst | nieuw |
| Deep link | Event van een andere company: uitleg + "Switch to {company}", nooit stil wisselen | nieuw |
| Opt-out via telefoon | Matchend nummer mag "Keep me posted" uitzetten (alleen uit, audit); restrisico geaccepteerd | nieuw |
| Snelheid | Audit `docs/perf-audit-2026-10.md`; P1 quick wins nu, P2 later of bij aanhoudende traagheid | — |
| Billing-mails | Trial dag 0/7/12/14/21, betaling mislukt, opgezegd, via Resend; nooit bij comped of gepauzeerd; facturen blijven van Stripe; tijdlijn per company in de Platform-tab | #32 |
| Team-invite mail (herzien 2026-10-07) | Bestaand account krijgt "X invited you to join Y" en crew "X invited you to the crew for Z … accept in the app" via Resend (taak 0e, 0d); geen magic-link-mail meer als uitnodiging. Nieuwe accounts krijgen na 0d vervolg B dezelfde Resend-mail (generateLink), niet meer de Supabase-template | #20, #24 |
| Uitnodiging accepteren (2026-10-07) | Geen enkele uitnodiging wordt bij login geaccepteerd; altijd expliciet per invite (Accept/Decline). Decline → mail aan de uitnodiger met het ingetypte adres + bevestiging aan de weigeraar (app + mail) | #24 |
| Notificaties | Push bundelen per company en per soort (>10 in 60 min → 24 uur één per uur met aantal). Teammail via Resend: aanvraag direct (gebundeld), quota direct, besluit naar aanvrager, dagelijkse samenvatting; voorkeuren per gebruiker, afmeldlink | nieuw |
| Platform | Per invite: company-chip met Switch, events, status, activiteit. Overview: companies per status, MRR/ARR uit eigen DB × Stripe-prijzen (excl. kortingen/dunning, gelabeld), trial-funnel, gebruik 30 dagen. Direct na Billing G | #49 |
| PostHog | Plan gemerged (PR #108, docs/posthog-implementation-plan.md). Bouw als laatste taak van golf F, niet vóór ADE; consent-gated, opt-out in Profile, subprocessor C → A bij de code | #49, legal |
| Event-locatie (herzien 2026-10-07) | Deellink en statuspagina tonen altijd de locatie van het event, nooit het companyadres (mogen gelijk zijn, maar zichtbaar is het event-adres). Het event-adres is publiek; vervangt "adres pas na goedkeuring". Meerdere opgeslagen locaties per company, per event kiezen; bestaande events eenmalig gevuld vanuit het companyadres. Bouw in taak 3b (golf D) | #48(c) herzien, nieuw |
| Crew-uitnodiging (2026-10-07) | Bestaand en nieuw account worden crew via een uitnodiging die geaccepteerd moet worden; gegevens pas zichtbaar als ze zijn ingevuld, de gebruiker is toegevoegd én de uitnodiging is geaccepteerd. Banner op Home blijft (geen auto-accept) | #24 |
| Mail-limiet (2026-10-07) | Per adres 1 mail per 60 s; per company 25 uitnodigingsmails per dag (team + crew, Supabase-invite + Resend-teammail); daarboven weigert de actie met een melding naar support. Resend Pro pas bij meer tractie | #20 |
| Review (2026-10-07) | Geen `/code-review ultra`; één verse reviewer-sessie per high-risk PR, zoals CLAUDE.md | — |
| Werkwijze | Sequentieel, geen orchestrator; dit document is de orchestrator | — |
| Sentry | Alleen onverwachte fouten rapporteren; gebruikersfouten zijn breadcrumbs; Supabase-fouten met leesbare titel; Android-pushfouten horen bij het Capacitor-programma | — |
| Testen | Elke UI-PR levert flow-screenshots per device (incl. native-shell) als CI-artifact en automatiseert de handoff-vragen die kunnen; Max beantwoordt alleen de rest (QA-0, vóór alle bouwtaken) | — |

## 8. Kosten en wanneer je afwijkt

Bouw-, spike-, reviewer- en orchestrator-sessies allemaal op Opus (Sonnet voor de sweep en S1), een paar korte copy-sessies. Eén orchestrator per golf (§2b) in plaats van per taak. Wijk af als een taak te groot blijkt (splits in ClickUp, nooit in de PR), als Max' Stripe- of Google-stappen de volgorde ophouden (dan taak 4 of 5 naar voren halen; die hangen alleen van taak 1), of als een spike in §9 een ander ontwerp afdwingt (dan eerst dit document bijwerken, dan pas de brief plakken).

## 9. Wave 0 — spikes (Opus-sessie; vult deze sectie in)

Prompt voor de spike-sessie:

```
Je doet wave 0 van het onboarding-programma oktober 2026 voor PlusOne Guestlist. Model: Opus. Je bouwt niets en opent geen PR behalve een docs-PR op onboarding-orchestration-claude-code.md §9. Lees CLAUDE.md en dit document. Beantwoord de zes vragen hieronder uit de code en de lokale stack (pnpm stack / lokale stack, pnpm db:fresh), schrijf per vraag het antwoord plus consequentie in §9, en zet hetzelfde als comment op de genoemde ClickUp-taak.
```

1. **Gate (taak 2).** Reproduceer lokaal: zet `subscriptions.created_at` van de seed-venue 15 dagen terug, log in als manager@, maak een event. Verwacht: `billing_trial_expired`. Vuurt de gate niet, zoek waarom (RLS op `subscriptions`? `maybeSingle()` null? pad via RPC dat de gate omzeilt?). Antwoord: zie 9.1 hieronder.
2. **Absolute check-in-aantal (taak 4).** Bevestig dat de outbox één item per check-in-id kan upserten met een nieuw `plus_ones_arrived` en `client_timestamp`, en ontwerp de stale-guard in de bestaande check-in-RPC. Lever de SQL-schets voor `20261010120000`. Antwoord: zie 9.2 hieronder.
3. **Request-splitsing (taak 7).** Lees `approve_guest_request` en het `guest_requests`-schema; ontwerp `decide_guest_request(jsonb)` met de quota-trigger erin: welke tabellen, welke audit-rijen, hoe stats het afgewezen deel tellen. Lever de SQL-schets voor `20261015120000`. Antwoord: zie 9.3 hieronder.
4. **Invite-template-voorwaarde (taak 3).** Zet lokaal in `supabase/config.toml` een invite-template met `{{ if eq .Data.kind "company" }}` en verstuur een invite met `data: { kind: 'company', invited_by: 'Max' }`; bekijk Mailpit. Rendert de voorwaarde en de metadata? Controleer ook of HTML in `invited_by` ge-escaped wordt. Antwoord: zie 9.4 hieronder.
5. **Resend-infra (taak 6).** Bevestig welk domein en welke afzender nu via SMTP lopen (docs/mail-deliverability.md, docs/legal/README.md), of een API-key los van de SMTP-credentials nodig is, en of de Resend batch-API en webhooks beschikbaar zijn op het huidige plan. Lever de lijst voor Max in §6. Antwoord: zie 9.5 hieronder.
6. **Places-proxy (taak 3).** Ontwerp de server-route: Autocomplete (New) + Place Details met session tokens, field mask beperkt tot adrescomponenten, rate limit via de bestaande throttle-helper, foutpad zonder key. Schat de kosten bij 100 onboardings per maand. Antwoord: zie 9.6 hieronder.

### 9.0 Spike-resultaten (wave 0, 2026-10-06, Opus)

Lokale stack in een remote container: `node scripts/session-setup.mjs install`, `pnpm stack`, `pnpm db:fresh` (reset klaar 19:52 UTC), daarna aan het eind `supabase db reset` + `pnpm db:test` met de seed-fix (staart in de PR-body). Experimenten draaiden tussen die twee resets en zijn met de tweede weggegooid. ClickUp was offline (daglimiet): de antwoorden staan alleen hier, niet als comment op D, E, A en F. **De volgende sessie die ClickUp heeft, zet ze er alsnog op** (per vraag het blok hieronder).

**Bevinding buiten de vragen (voor de orchestrator, §3):** `20261007100000` is op main al bezet door `20261007100000_contacts_freeze_anonymized.sql`. De reservering voor taak 0b (`20261007100000_guests_venue_created_idx.sql`) botst daarmee; 0b moet naar een vrije slot (bijv. `20261007100200` / `…100300`). Ik heb §3 niet aangepast (orchestrator-gebied).

#### 9.1 Gate (taak 2)

**Antwoord:** de gate werkt; de reproductie zoals voorgeschreven kán hem niet laten vuren, om twee redenen die in de seed zitten, niet in de code.

Gemeten door de echte server action `createEvent` (`src/features/events/actions.ts`) met de sessie-cookies van de gebruiker aan te roepen (dev-login, daarna `POST /app` met de `Next-Action`-id):

| # | Toestand `subscriptions` | Gebruiker | Resultaat |
|---|---|---|---|
| S1 | Club Vesper (seed): `comped`, `created_at` −15 d | admin@ | `ok: true` (event aangemaakt) |
| S1 | idem | manager@ | `42501` "You don't have rights for this." |
| S2 | Club Vesper: `trialing`, geen Stripe-sub, `created_at` −15 d | admin@ | `billing_trial_expired` |
| S2 | idem | manager@ | `billing_trial_expired` |
| S3 | De Marktzaal (seed, `trialing`): `created_at` −15 d | admin@ | `billing_trial_expired` |
| S4 | idem + `stripe_subscription_id` gezet | admin@ | `ok: true` (Stripe's klok, bewust) |
| S5 | `created_at` −2 d, `current_period_end` gisteren | admin@ | `ok: true` (gate leest `created_at`, niet `current_period_end`) |

Waarom S1 niet vuurt: (a) de seed-venue Club Vesper is `comped` en comped blokkeert nooit (`billingBlockReason`, `src/features/billing/plans.ts`); alleen De Marktzaal is `trialing`, en daar is alleen admin@ lid. (b) manager@ is `user_manager`, geen admin, en `events_insert_admin` laat alleen admins events maken; de gate loopt vóór de insert, dus bij een niet-comped verlopen trial krijgt manager@ `billing_trial_expired` in plaats van 42501 (cosmetisch: hij mocht het toch niet). Geen van de verdachten speelt: `subscriptions_select_member` laat elk lid lezen (dus `maybeSingle()` is niet null voor een lid), en er is geen RPC die events aanmaakt buiten de gate (`create_event_from_template` zit achter `assertVenueBillingActive` in `createEventFromTemplate`). Het edit-scherm (`/app/events/new`) toont de knop ook bij een geblokkeerde venue (geen `useBillingBlocked` daar); de server weigert netjes.

Prod (alleen aggregaten, geen rijen): 13 × `trialing` zonder Stripe-sub (plan `indie` 7, `premium` 3, `null` 3), waarvan **6 ouder dan 14 dagen → die zijn nu geblokkeerd** voor nieuwe events, invites en import. 4 × `comped`. Niemand heeft een `stripe_subscription_id`.

**Consequentie voor taak 2:** geen gate-fix nodig. Wel: (1) de "Trial until <datum>"-override moet in `billingBlockReason` én in `toPoSubscription.trialEndsAt` dezelfde bron lezen (`coalesce(trial_ends_at, created_at + 14 d)`), anders lopen server en UI uiteen; (2) pgTAP/unit-test op een niet-comped seed-venue, want de primaire seed-venue is comped; (3) neem de 42501-volgorde mee (rolcheck vóór de billing-gate) als je de actie toch aanraakt; (4) Max: de 6 verlopen trials blokkeren nu al; het runbook (`docs/stripe-setup.md` §5, §9 los eindje 4) is daarmee urgent, niet "nu meteen als het uitkomt".

#### 9.2 Absoluut check-in-aantal (taak 4)

**Antwoord: ja, upsert op `check_ins.id` werkt vandaag al voor een doorhost**, zonder RPC. Er ís geen check-in-RPC: check-ins zijn een directe insert/update op `check_ins` (RLS `check_ins_insert` / `check_ins_update_door`, trigger `cap_check_in_arrivals`); de enige RPC is `check_out_guest`. De stale-guard hoort dus in een BEFORE UPDATE-trigger, niet in een RPC.

Gemeten als door@ via PostgREST (`upsert(..., { onConflict: 'id' })`) op Juri (plus_ones 2):

| Stap | Payload | Rij daarna | Audit |
|---|---|---|---|
| 1 eerste tik | arrived 0, ts 22:00:01 | 0, ts :01 | `check_in` |
| 2 tweede tik | arrived 1, ts :05 | 1, ts :05 | `update` |
| 3 replay van 2 | identiek | 1, ts :05 | geen rij (diff leeg) |
| 4 oud item komt laat | arrived 0, ts :01 | **1, ts :01** | `update` (alleen ts) |
| 5 boven max | arrived 5, ts :09 | 2 (afgekapt) | `update` |
| ander device, ander id | insert | `23505 check_ins_guest_id_key` → `duplicate` (bestaand gedrag) | — |

Dus: monotoon + cap houden het aantal al goed bij herordening (stap 4), maar een oud item zet `client_timestamp` terug en schrijft een zinloze audit-rij. "Boven maximum" wordt nu **afgekapt, niet geweigerd**. Twee echte gaten bij upsert: PostgREST zet in de ON CONFLICT-update **alle** meegestuurde kolommen, dus een "+1" van collega B op de rij van A zou `checked_by` naar B herschrijven (de actor-guard staat dat toe als B deur-rechten heeft) en daarmee de first-wins-identiteit (#11) en de instroom-bucket breken. Void en revive schrijven geen `client_timestamp`, dus een oude revive kan na een nieuwere void van een collega de gast weer binnenzetten.

SQL-schets `20261010120000_checkin_absolute_count_guard.sql`:

```sql
-- Stale-guard + identity pin for the absolute-count upsert (taak 4).
-- Runs BEFORE the cap trigger (name sorts first): a stale write must be dropped
-- before any clamp/monotonic logic, and must not reach the audit trigger.
create or replace function public.check_in_stale_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Client writes only (same discriminator as guard_check_in_actor_change):
  -- check_out_guest / retention / seeds run as owner and are not outbox replays.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- 1. Stale: an outbox item older than what the row already reflects is a
  --    no-op. Returning OLD writes an identical row, so the audit trigger (diff
  --    only) logs nothing and the client sees success = synced.
  if new.client_timestamp is not null
     and old.client_timestamp is not null
     and new.client_timestamp < old.client_timestamp then
    return old;
  end if;
  -- 2. First-wins identity (#11): an upsert re-sends checked_by/checked_at/
  --    device_id/offline_synced/synced_by. Only a revive (voided -> active) may
  --    move them; every other update keeps the original arrival.
  if not (old.voided_at is not null and new.voided_at is null) then
    new.checked_by     := old.checked_by;
    new.checked_at     := old.checked_at;
    new.device_id      := old.device_id;
    new.offline_synced := old.offline_synced;
    new.synced_by      := old.synced_by;
  end if;
  return new;
end;
$$;

create trigger check_ins_a_stale_guard
  before update on public.check_ins
  for each row execute function public.check_in_stale_guard();

-- Cap: keep the clamp (see consequence 2); unchanged function, re-stated only
-- if the worker decides to reject instead:
--   if new.plus_ones_arrived > v_allotment then
--     raise exception using errcode = '23514', message = 'More people than this guest may bring.';
--   end if;
```

**Consequentie voor taak 4:** (1) brief §4 zegt "server-RPC negeert oudere client_timestamp": wordt "BEFORE UPDATE-trigger"; geen RPC, geen server action (#25 blijft). (2) Max-besluit nodig of de brief-eis "boven maximum geweigerd" blijft. Advies: **afkappen houden** (invariant `arrived ≤ plus_ones` staat al in de DB): een geweigerde offline-replay wordt `error`/dead-letter en verliest een echte deuractie wanneer een admin intussen `plus_ones` verlaagde. pgTAP toetst dan "nooit boven het maximum" in plaats van "geweigerd". (3) De outbox stuurt `client_timestamp` ook mee op void en revive (de payloads hebben het al, de gateway schrijft het niet), anders dekt de guard ze niet. (4) `check_in` en `check_in_topup` worden één soort (upsert op id); `dedup.ts hasOpenCheckIn` blokkeert dan niet meer de tweede tik maar coalesceert pending items met hetzelfde id (laatste wint = "twee tikken offline, online één rij"). Een "+1" op een gast die een ander device incheckte heeft het id van die rij nodig (uit de snapshot); zonder id blijft de bestaande top-up-by-guest_id. (5) **Uitchecken bestaat al als setting:** `venues.allow_uncheck` (default true) + `events.allow_uncheck` (override) + RESTRICTIVE policy `check_ins_void_requires_uncheck` (`20260622000000`), rol-agnostisch. Taak 4 moet die **rolafhankelijk** maken (doorhost/crew alleen met de setting aan; admin/user_manager altijd) in plaats van een nieuwe `venues.settings->'door'`-sleutel te introduceren; de `venues.settings`-route uit §3 (`20261010120100`) vervalt. Default moet dan naar false voor doorhosts (besluit "default false"), wat het gedrag voor bestaande venues verandert: noemen in de changelog. `check_out_guest` erft de policy automatisch (SECURITY INVOKER). (6) Besluit 17 (doorhost verhoogt `plus_ones` binnen het quotum van de toevoeger) is een `guests`-update: `enforce_guest_quota` rekent op `added_by`, dus dat klopt al; wel pgTAP voor doorhost-update van `plus_ones` (zit buiten `check_ins`).

#### 9.3 Request-splitsing (taak 7)

**Antwoord:** "inkorten" bestaat al: `approve_guest_request(p_request_id, p_tier_id, p_plus_ones, p_message)` (`20260919090000`) keurt goed voor minder plus-ones, slaat `approved_plus_ones` en `decision_message` op de request op, en maakt één `guests`-rij met source `landing`. Afwijzen is nu een directe UPDATE via RLS `guest_requests_decide` (deny-only, `20260919150000`) met interne `decision_reason`. Nieuw zijn alleen **splitsen over tiers** en **deels afwijzen met verplichte opmerking**. Quota hoeft niet "erin": de bestaande triggers vuren per geïnserte gast (capaciteit 45005 telt 1+plus_ones, link-max 45006 telt koppen, tier-max 45002 telt **rijen**, persoonlijk quotum wordt voor `landing` nooit belast, #31). Eén transactie, dus één mislukte rij rolt de hele beslissing terug.

Tabellen: `guest_requests` (status, `approved_plus_ones` = goedgekeurde koppen − 1, `decision_message`, `decision_reason`), `guests` (één rij per toewijzing), plus één nieuwe kolom `guests.guest_request_id` zodat de splitsing herleidbaar is (deur kan groeperen, stats kunnen tellen). Audit: één `insert`-rij per gast (trigger op `guests`) + één `approve`/`deny`-rij op `guest_requests` met de diff (`approved_plus_ones`, `decision_message`, `decision_reason`). Stats voor het afgewezen deel: **geen nieuwe tabel**; afgewezen koppen = `(1 + plus_ones) − (1 + coalesce(approved_plus_ones, plus_ones))` voor approved en `1 + plus_ones` voor denied; uit te rekenen in `event_link_funnel` / een request-stats-RPC (SECURITY INVOKER, GROUP BY in SQL).

SQL-schets `20261015120000_request_decision_split.sql`:

```sql
-- Expand: link guest rows to the request they came from (nullable, no rewrite).
alter table public.guests
  add column guest_request_id uuid references public.guest_requests (id) on delete restrict;
create index guests_guest_request_id_idx on public.guests (guest_request_id)
  where guest_request_id is not null;

-- The guest-facing message becomes mandatory on any (partial) denial, so it must
-- be allowed on a denied row too (today: approved only).
alter table public.guest_requests drop constraint guest_requests_decision_message_check;
alter table public.guest_requests add constraint guest_requests_decision_message_check check (
  decision_message is null
  or (status in ('approved', 'denied')
      and char_length(decision_message) between 1 and 280
      and decision_message ~ '[^[:space:]]')
);
-- get_request_status must then return decision_message for denied too (same PR).

-- p_decision = {
--   "allocations": [ { "tier_id": uuid, "heads": int>=1 }, ... ],  -- may be []
--   "message": text,          -- to the guest; REQUIRED when heads < requested
--   "reason":  text | null    -- internal (#43(f)); stays out of guest-facing output
-- }
create function public.decide_guest_request(p_request_id uuid, p_decision jsonb)
returns uuid[]          -- created guest ids, [] on a full denial
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws         constant text := E' \t\n\r\f\x0B';
  v_req      public.guest_requests;
  v_event    uuid;
  v_alloc    jsonb;
  v_total    integer := 0;
  v_req_tot  integer;
  v_message  text := nullif(btrim(p_decision ->> 'message', ws), '');
  v_reason   text := nullif(btrim(p_decision ->> 'reason', ws), '');
  v_ids      uuid[] := '{}';
  v_id       uuid;
  v_first    boolean := true;
begin
  -- Same authz + lock dance as approve_guest_request (unlocked read, role check,
  -- FOR UPDATE re-read, P0002 on moved/anonymized, 45003 when not pending).
  select * into v_req from public.guest_requests where id = p_request_id;
  if v_req.id is null or v_req.anonymized_at is not null then
    raise exception using errcode = 'P0002', message = 'Request not found.';
  end if;
  if not (public.has_venue_role(public.event_venue(v_req.event_id), '{admin}')
          or public.is_event_organizer(v_req.event_id)) then
    raise exception using errcode = '42501', message = 'Only an admin or organizer may decide.';
  end if;
  v_event := v_req.event_id;
  select * into v_req from public.guest_requests where id = p_request_id for update;
  if v_req.event_id is distinct from v_event or v_req.anonymized_at is not null then
    raise exception using errcode = 'P0002', message = 'Request not found.';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003', message = 'This request was already decided.';
  end if;

  v_req_tot := 1 + v_req.plus_ones;
  for v_alloc in select * from jsonb_array_elements(coalesce(p_decision -> 'allocations', '[]'))
  loop
    if (v_alloc ->> 'heads')::int < 1 then
      raise exception using errcode = '23514', message = 'Each part needs at least one person.';
    end if;
    -- Decision 18: approver picks the tier. No per-tier right exists today, so
    -- "tiers he has rights to" = every tier of THIS event for admin/organizer.
    if not exists (select 1 from public.guest_tiers t
                   where t.id = (v_alloc ->> 'tier_id')::uuid and t.event_id = v_req.event_id) then
      raise exception using errcode = '23514', message = 'Pick a valid tier for this event.';
    end if;
    v_total := v_total + (v_alloc ->> 'heads')::int;
  end loop;
  if v_total > v_req_tot then
    raise exception using errcode = '23514', message = 'More people than requested.';
  end if;
  if v_total < v_req_tot and v_message is null then
    raise exception using errcode = '23514', message = 'Add a message when you decline (part of) a request.';
  end if;
  if char_length(v_message) > 280 then
    raise exception using errcode = '23514', message = 'Keep the message to 280 characters.';
  end if;

  if v_req.request_link_id is not null then  -- G1: serialize link-max
    perform 1 from public.request_links rl where rl.id = v_req.request_link_id for update;
  end if;

  -- One guest row per allocation. The first carries the requester's contact
  -- details; later parts carry the name only (autolink would otherwise try to
  -- dedup the same e-mail/phone twice). Every row fires 45001/45002/45005/45006.
  for v_alloc in select * from jsonb_array_elements(coalesce(p_decision -> 'allocations', '[]'))
  loop
    insert into public.guests
      (event_id, tier_id, full_name, email, phone, plus_ones,
       added_by, source, status, request_link_id, guest_request_id)
    values
      (v_req.event_id, (v_alloc ->> 'tier_id')::uuid, v_req.full_name,
       case when v_first then v_req.email end, case when v_first then v_req.phone end,
       (v_alloc ->> 'heads')::int - 1,
       (select auth.uid()), 'landing', 'approved', v_req.request_link_id, v_req.id)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_first := false;
  end loop;

  -- One UPDATE = one audit row with the whole decision in the diff.
  update public.guest_requests
     set status            = case when v_total > 0 then 'approved' else 'denied' end::public.request_status,
         decided_by        = (select auth.uid()),
         decided_at        = now(),
         decided_via       = 'manual',
         approved_plus_ones = case when v_total > 0 then v_total - 1 end,
         decision_message  = v_message,
         decision_reason   = v_reason
   where id = p_request_id;
  return v_ids;
end;
$$;
revoke execute on function public.decide_guest_request(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.decide_guest_request(uuid, jsonb) to authenticated;
```

**Consequentie voor taak 7:** (1) nieuwe functienaam, dus geen overload-probleem (PGRST203) met de gedeployde `approve_guest_request`; die blijft bestaan (expand–contract) en kan later een wrapper worden. (2) De `decision_message`-CHECK verruimen is een gedragswijziging van #43(f) (bericht ook bij afwijzen, naar de gast): spec-update + `get_request_status` laat het bericht bij `denied` zien, de interne `decision_reason` nooit. De `guard`-trigger op `guest_requests` (client mag counts/message niet schrijven) blijft ongewijzigd geldig, want de RPC is SECURITY DEFINER. (3) Splitsen = meerdere tier-entries (45002 telt rijen) en twee deurregels met dezelfde naam; de deur/gastenlijst moet `guest_request_id` groeperen of een "deel 2/2"-label tonen. (4) Besluit 18 "tiers waar hij rechten op heeft": er bestaat geen tier-recht in het datamodel; nu = alle tiers van het event. Een echt tier-recht is een eigen besluit. (5) Retentie (`run_privacy_retention`) moet `decision_message` ook op denied rijen wissen (nu alleen approved). (6) Statusmail via F leest `status` + `approved_plus_ones` + `decision_message`; HTML-escapen (kolomcomment zegt het al).

#### 9.4 Invite-template-voorwaarde (taak 3)

**Antwoord: ja, alles rendert, en HTML wordt ge-escaped.** Lokaal getest met een tijdelijke blok in `supabase/templates/invite.html` (via `[auth.email.template.invite]` in `config.toml`), GoTrue herstart, `auth.admin.inviteUserByEmail(email, { data })`, uitgelezen via de Mailpit-API. Daarna teruggezet (niet in de PR).

| `data` | Gerenderd |
|---|---|
| `{ kind: 'company', invited_by: 'Max', company: 'Club Vesper' }` | `[COMPANY-BRANCH by Max for Club Vesper]` |
| `{ kind: 'team', invited_by: 'Max' }` | `[TEAM-BRANCH by Max]` |
| `{ full_name: 'spike' }` (geen kind) en geen `data` | `[TEAM-BRANCH by ]`: geen fout, ontbrekende sleutel = lege string, else-tak |
| `invited_by: '<b>Max</b><script>alert(1)</script>"&\''`, `company: '<a href="https://evil.test">Win</a>'` | `&lt;b&gt;Max&lt;/b&gt;&lt;script&gt;…&#34;&amp;&#39;` en `&lt;a href=&#34;…&#34;&gt;Win&lt;/a&gt;`: volledig ge-escaped (Go `html/template`) |

Ook het **onderwerp** ondersteunt de voorwaarde (`subject = "{{ if eq .Data.kind \"company\" }}{{ .Data.invited_by }} invited you to set up {{ .Data.company }}{{ else }}…{{ end }}"`), maar wordt óók HTML-ge-escaped: `Max & <Joeri>` / `Club "Vesper"` kwam aan als `Max &amp; &lt;Joeri&gt; invited you to set up Club &#34;Vesper&#34;`. Een onderwerpregel is platte tekst, dus dat staat er letterlijk zo in de inbox.

**Consequentie voor taak 3:** de template-route werkt; geen hook-route nodig. (1) Gebruik metadata alleen in de body, of in het onderwerp alleen met een vaste tekst per tak (geen namen; "&" in "Bar & Grill" breekt anders zichtbaar). (2) Zet `kind` als eerste vergelijking en laat de else-tak de veilige standaardtekst zijn: een invite zonder metadata (resend van een oud pad) valt dan netjes terug. (3) Securityreview-punt: `data` overschrijft `raw_user_meta_data` van een bestaand onbevestigd account (F5 in `invite-mail.ts`), en gebruikers kunnen hun eigen `user_metadata` later wijzigen. `kind`/`invited_by`/`company` zijn alleen weergave op verzendmoment en mogen nergens als autorisatie gelezen worden (comped komt uit `platform_invites.comped`, niet uit metadata). Platform-invites geven nu bewust géén `data` mee (`seedName: false`); voor `kind`/`invited_by` moet dat een expliciete, minimale payload worden zonder `full_name`. (4) Prod: het template staat in het Supabase-dashboard, niet in `config.toml`; Max plakt het na de merge (§6 staat al zo).

#### 9.5 Resend-infra (taak 6, en 0e)

**Antwoord:** Prod-auth-mail loopt via Resend als Supabase custom SMTP: host `smtp.resend.com:465`, afzender **`PlusOne <noreply@plus-one.io>`**, domein de apex **`plus-one.io`**, geverifieerd (SPF/DKIM/DMARC `p=none`), regio eu-west-1 (`docs/mail-deliverability.md`; bevestigd in `docs/legal/README.md`, F3 gesloten). Resend staat sinds subprocessorlijst 1.1 al in sectie A (gastdata), dus juridisch is gastmail gedekt.

API-key: **ja, een aparte key.** Het SMTP-wachtwoord ís een Resend API-key, maar `docs/mail-deliverability.md` § Secret handling zegt dat die alleen in Supabase en de wachtwoordmanager staat en nooit in Vercel. Voor app-verzending (0e, 6, 2c) dus een tweede key met **Sending access, beperkt tot `plus-one.io`**, in Vercel als `RESEND_API_KEY` (server-only, secret-grep-guard uitbreiden). Losse rotatie; een gelekte app-key raakt de login-OTP niet. Die doc-regel moet in taak 0e worden bijgewerkt ("twee keys, elk met eigen plek").

Plan: niet uit de code te halen. Volgens Resend's prijspagina (okt 2026) hebben alle plannen batch-verzending (`POST /emails/batch`, max 100 per call), webhooks en API-key-permissies; Free = 3.000 mails/maand, **100/dag**, 1 domein, 1 webhook-endpoint; Pro ≈ $20/maand, 50.000/maand, geen daglimiet. **Kritiek:** login-OTP's tellen mee in hetzelfde account. Op Free gaat met gastmail (taak 6), team-mails (0e) en billing-mails (2c) de daglimiet van 100 al bij één drukke avond op, en dan faalt óók de login (zelfde account, zelfde quotum). Dat raakt de deur.

**Consequentie voor taak 6 en 0e:** (1) verzendcode verwacht een daglimiet-fout van Resend (429 / `daily_quota_exceeded`) en logt die in `mail_log` als `failed`, nooit retry-storm. (2) Batch-API per event voor "You're on the list"-golven; idempotency-key per `mail_log`-rij. (3) Afzender gastmail volgens §9 eindje 13: `"{Company} via PlusOne" <noreply@plus-one.io>` + `reply_to` company-contact; geen nieuw domein, dus geen DNS-werk. (4) Webhook: één endpoint (Free-limiet), signature via Svix-headers, idempotent via `resend_webhook_events` (zoals Stripe). Checklist voor Max staat in §6, rij "vóór taak 0e".

#### 9.6 Places-proxy (taak 3)

**Antwoord (ontwerp):**

- **Route** `src/app/api/places/route.ts`, `runtime = 'nodejs'`, twee acties op één route met Zod-discriminated union: `{ op: 'autocomplete', input, sessionToken }` en `{ op: 'details', placeId, sessionToken }`. Valt automatisch achter de middleware-auth (alleen `/api/webhooks/` is vrijgesteld); in de route toch `supabase.auth.getUser()` (checklist), anders 401.
- **Autocomplete (New):** `POST https://places.googleapis.com/v1/places:autocomplete` met header `X-Goog-Api-Key` (server-only `GOOGLE_PLACES_API_KEY`) en `X-Goog-FieldMask: suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat`; body `{ input, sessionToken, languageCode: 'en', includedRegionCodes: ['nl','be','de'] }` (lijst = productbesluit). Antwoord naar de client: alleen `placeId`, `mainText`, `secondaryText`.
- **Place Details (New):** `GET https://places.googleapis.com/v1/places/{placeId}?sessionToken=…` met `X-Goog-FieldMask: addressComponents,formattedAddress` (eventueel `location`): allemaal **Essentials**-SKU. **Niet** `displayName` vragen: dat is de duurdere Pro-SKU. De naam ("vult naam + adres") komt gratis uit de gekozen autocomplete-suggestie (`structuredFormat.mainText`). De route mapt `addressComponents` naar `address_line` / `postal_code` / `city` / `country` (bestaande `venues`-velden) en geeft alleen die terug.
- **Session token:** client maakt per invoerveld-focus een UUIDv4 (`crypto.randomUUID()` met fallback, webview-safe), stuurt hem bij elke autocomplete-call mee en bij de ene details-call; daarna een nieuwe. Debounce 250 ms, minimaal 3 tekens.
- **Rate limit:** `consume_public_throttle` is intern (execute ingetrokken voor alle app-rollen); het patroon is een eigen SECURITY DEFINER-wrapper zoals `consume_platform_invite_throttle`: `consume_places_throttle()` → `consume_public_throttle('plc:' || auth.uid(), 10, 120)` (120 calls / 10 min per gebruiker), `auth.uid()` null → 42501. Server-afgeleide sleutel, dus geen `p_ip_hash`-prefix en niet in de prefix-lijst van `public-throttle-prefixes.test.ts`. Dit vraagt een extra migratie: taak 3 krijgt slot `20261009120100_places_throttle.sql`. Throttled → 429 `{ ok:false }`, client toont gewoon het tekstveld.
- **Foutpad zonder key:** `GOOGLE_PLACES_API_KEY` ontbreekt → route geeft `200 { enabled: false }` (geen 500, geen Sentry-event), client rendert het gewone tekstveld; Google-fout/timeout (3 s `AbortSignal.timeout`) → `{ ok:false }`, generieke melding, details alleen in serverlog, nooit de invoertekst loggen (kan een adres = PII zijn). Key nooit in `NEXT_PUBLIC_*`; secret-grep-guard krijgt `GOOGLE_PLACES_API_KEY` erbij.
- **Capacitor:** alleen `fetch` naar de eigen origin, geen Google-JS-SDK, geen popup: werkt in de webview.

**Kosten bij 100 onboardings/maand:** ~100 sessies op VenueStep + ~100 in Company settings/event-locatie ≈ 200–300 sessies, elk ~6–10 autocomplete-calls (debounced) + 1 details-call ≈ 2.000–3.000 Autocomplete-requests + 200–300 Details-Essentials. Volgens Google's sessiebilling worden per sessie hooguit de eerste 12 autocomplete-calls los geteld plus de afsluitende Essentials-details. Met de maandelijkse gratis tegoeden per SKU (Essentials ≈ 10.000 calls/maand) is dat **€0**; zonder gratis tegoed ruwweg 3.000 × ~$2,8/1000 + 300 × ~$5/1000 ≈ **$10/maand**. Exacte prijzen en gratis caps checkt Max bij het aanmaken van de key (niet geverifieerd in deze sessie). Zet in Google Cloud een budget-alert (€10) en een quotum per minuut op de key.

**Consequentie voor taak 3:** (1) extra migratie `20261009120100_places_throttle.sql` (wrapper + grant + pgTAP allowed/denied); (2) "met key vult één selectie naam + adres": naam uit de suggestie, niet uit Details (prijs); (3) Google moet op de subprocessorlijst (staat al in de legal-taak); (4) de key-restrictie "`app.plus-one.io` + Places" uit §6 werkt niet voor een server-key (HTTP-referrer-restricties gelden alleen voor browser-calls): Max beperkt de key op **API (Places API (New))** en eventueel op Vercel-egress-IP's niet (die wisselen); dus API-restrictie + quota + budget-alert, geen referrer.

**Niet geverifieerd in deze sessie:** het actuele Resend-plan van het account (dashboard), de exacte Google-prijzen/gratis caps, en of het prod-dashboardtemplate dezelfde Go-templating gebruikt als de lokale GoTrue (zelfde GoTrue, dus verwacht ja; Max ziet het bij de eerste test-invite in prod).


Losse eindjes, beantwoord door Max op 2026-10-06 (avond):

| # | Vraag | Besluit |
|---|---|---|
| 1 | Wat vóór ADE | Alles; volgorde §2 blijft, P1 eerst. Realistisch halen de eerste vijf tot zeven taken ADE; de rest loopt door. |
| 2 | Store-apps | Staan in review; TestFlight/intern testen als fallback. ADE kan op de PWA. |
| 3 | Gratis op ADE | Per company handmatig (Platform-tab "Always free" uit taak 2; tot dan het SQL-runbook). |
| 4 | Bestaande trial-venues | Allemaal "always free" tot we het aanpassen. Actie Max: runbook `docs/stripe-setup.md` §5 voor de 11 trialing venues (gelogd via de audit-trigger). |
| 5 | Testrommel in prod | Negeren. |
| 6 | Jaarplan opzeggen | Geen restitutie standaard; wie wil, meldt zich. Portal: opzeggen per periode-einde. |
| 7 | Btw buiten NL | Later; nu vast 21%. |
| 8 | Billing-mails naar | Admins + finance-rol. Facturen: Stripe stuurt ze zelf naar het factuur-e-mailadres van de company (`venues.finance_email`, al een veld in Company settings en bij checkout het Stripe-customer-e-mailadres); Max zet in het Stripe-dashboard "Emails → facturen en betaalbevestigingen" aan. Geen eigen factuurmail. |
| 9 | Meerdere companies per eigenaar | Elk een eigen abonnement en trial, zoals nu. |
| 10 | Invite-link | Geldigheid naar 7 dagen + resend in Platform (taak 3; Supabase-dashboard: Auth → invite expiry). |
| 11 | Taal | Alleen Engels. |
| 12 | Platform-admins | Max en Joeri. |
| 13 | Afzender gastmail | "{Company} via PlusOne" vanaf plus-one.io, reply-to het company-adres; geen eigen domein. |
| 14 | Zonder e-mail | Alleen mail; geen SMS/WhatsApp. |
| 15 | Grondslag gastmail | Zit in de legal-taak (gastvoorwaarden + request-pagina noemen de mail). |
| 16 | Crew en uitchecken | Zelfde regel als staff: alleen met de venue-setting aan. |
| 17 | Extra persoon aan de deur | Doorhost mag het aantal verhogen binnen het quotum van wie de gast toevoegde (taak 4). |
| 18 | Tier bij splitsen | Alleen de approver kiest, uit tiers waar hij rechten op heeft. |
| 19 | Platform-digest | Ja, dagelijks naar Max en Joeri (taak 2b, via de mail-infra uit 0e). |
| 20 | Support | support@plus-one.io in elke mail-footer; Max beantwoordt. Actie Max: mailbox aanmaken. |

Open besluiten voor Max (uit een andere sessie, 2026-10-06), vóór wave 0 te beantwoorden:

- **Seed-data (Sanne/Pim-verwisseling):** de fix raakt drie pgTAP-bestanden en vereist een `supabase db reset` lokaal. Aanbeveling: gewoon doen in wave 0; lokale testdata is per definitie weggooibaar. **Antwoord (Max, 2026-10-06): ja, reset mag.** Wave 0 fixt de seed en de drie pgTAP-bestanden in de docs-PR van §9. **Gedaan (wave 0):** de ingecheckte seed-gast `cc..02` heet nu "Pim Scholten" met Pims telefoonnummer, zodat de autolink-trigger hem aan Pims eigen contact `c0..03` koppelt; de handmatige `update … set contact_id` die Sanne aan Pim hing is weg. Aantallen, tiers en check-ins zijn ongewijzigd, dus in `analytics`, `contacts.rls` en `permanent` veranderen alleen comments en assert-labels. Sanne en Anouk (permanent) staan vóór de permanent-sync op geen enkele lijst.
- **Deep link naar een event van een andere company:** automatisch wisselen van company, of een scherm "Dit event hoort bij {company}. Switch?" Aanbeveling: uitleggen + knop, nooit stil wisselen (platform-access-log en audit willen een bewuste actie). **Antwoord (Max, 2026-10-06): uitleg + knop "Switch to {company}".** Hoort bij taak 5 (event-screens): een deep link naar een event van een andere company waar de gebruiker lid van is toont die kaart; geen lid → het bestaande "niet gevonden"-pad, zonder te verraden dat het event bestaat.
- **Telefoon-gematchte opt-in:** mag een gast met een matchend telefoonnummer de "Keep me posted" van een bestaand contact uitzetten? Aanbeveling: nee, alleen via de afmeldlink uit taak 6 of door het team; een telefoonnummer is geen bewijs van identiteit. **Antwoord (Max, 2026-10-06): ja, een matchend telefoonnummer mag de voorkeur uitzetten.** Geaccepteerd restrisico: wie het nummer van een contact kent, kan diens updates uitzetten; het kan alleen uit, nooit aan, en de wijziging landt in de audit log met bron "guest request". Hoort bij taak 6 (opt-out) en wordt in de spec als beslissing opgenomen.
- **Poort 7000:** werkproces, geen code. CLAUDE.md "Een poort is een checkout" dekt het: vóór een test `git branch --show-current` in de map die de poort serveert. Antwoord: ___
