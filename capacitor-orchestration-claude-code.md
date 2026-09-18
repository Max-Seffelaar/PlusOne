# Capacitor-orchestratie — Fase 17 in golven draaien

> Status: **klaar voor gebruik (2026-09-18)**. Hoort bij `capacitor-plan-claude-code.md` (het *wat*); dit document is het *hoe*: welke sessies, welke prompts, welk model, welke gates. Epic: [86exxuvye](https://app.clickup.com/t/86exxuvye).

## 0. De drie antwoorden

**Eén orchestrator per golf, niet één voor het hele programma.** De golven uit het plan (§4) worden gescheiden door dingen die alleen Max kan doen: PR's testen en mergen, de Android-debugbuild draaien, TestFlight installeren, accounts aanvragen. Een orchestrator die het hele traject overspant zit wekenlang te wachten, verliest context en cache, en gaat "alvast" dingen doen die op de vorige golf horen te wachten. Een golf-orchestrator start met een schone lei, weet precies welke PR's gemerged zijn, en eindigt als de golf-exit-criteria gehaald zijn. Vijf golven = vijf orchestrator-sessies (golf 5 is klein).

**De orchestrator bouwt niets zelf.** Hij brieft workers, bewaakt de constraints (één DB-eigenaar, migratie-timestamps, gedeelde bestanden, review gates), leest de PR's adversarieel, en levert Max per PR de test-handoff. Elke worker is een eigen sessie op één ClickUp-taak met een eigen branch en PR — precies zoals de `clickup-task`-skill het al voorschrijft. Dat houdt de bestaande hooks en gates intact zonder uitzonderingen.

**Model: orchestrator op Fable, workers op Opus, mechanisch werk op Sonnet.** Dat is de bestaande routing uit CLAUDE.md ("Fable voor beslissingen & planning, Opus voor bouwen, Sonnet voor mechanische uitvoering") en hij klopt hier precies: de orchestrator neemt weinig maar zware beslissingen (scope-conflicten, is deze PR goed genoeg, welke worker eerst) en leest diffs adversarieel — dat is judgment, geen volume. De workers produceren het volume. Sonnet alleen voor S2 (icons/splash/metadata) en de changelog-syncs. De reviewer-sessies voor de high-risk PR's (N2, S3) draaien óók op Fable: die moeten iets vinden wat de bouwer gemist heeft.

## 1. Mechaniek

- **Orchestrator-sessie:** Claude Code (web of lokaal), gestart met de prompt uit §3 en het golf-blok uit §4. Rename: `/rename Fase 17 — orchestrator golf <n>`.
- **Workers:** aparte Claude Code-sessies. Voorkeur: de orchestrator spawnt ze zelf via Claude Code Remote (`create_session` met `source_url` = de repo, `prompt` = de ingevulde worker-brief uit §5, `permission_mode` **nooit** `plan` — dat blokkeert op een goedkeuring die niemand geeft). Fallback: Max plakt de brief zelf in een nieuwe sessie. Beide werken; in het eerste geval kan de orchestrator ook `get_session`/`list_events` gebruiken om voortgang te zien.
- **Per worker:** één ClickUp-taak, branch `claude/<taskid>-<slug>`, PR-titel met de taak-id, `clickup-task`-skill van pickup tot end-of-session-comment. De worker zet zijn eigen ClickUp-status; de orchestrator zet alleen comments op de epic.
- **Merges zijn van Max.** Branch protection staat aan; de orchestrator merged niet en vraagt er ook niet om — hij levert per PR een oordeel ("klaar voor jouw test-handoff" / "niet mergen, want …") en de test-handoff-vragen.
- **Wat een remote container níét kan:** geen Supabase CLI, geen Docker → geen `db:test`, geen `db reset`, geen e2e. Voor N2 en S3 betekent dat: de worker schrijft pgTAP en migraties, maar **CI is de DB-gate**, niet de lokale stack. De worker zegt dat expliciet in de PR-body. Wil Max lokaal draaien, dan geldt de één-DB-eigenaar-regel uit CLAUDE.md: één sessie tegelijk reset.
- **Migratie-timestamps worden door de orchestrator vooraf toegewezen** (niet door workers gekozen), zodat parallelle PR's nooit botsen. Golf 1 reserveert:
  - N2: `20260925120000_push_tokens_outbox.sql`, `20260925120100_push_dispatch_wiring.sql`, `20260925120200_push_tokens_revoke_on_logout.sql`
  - S3: geen migratie (route + seedscript); als er tóch een nodig blijkt: `20260925130000_*`.
  De orchestrator checkt bij start `git ls-files supabase/migrations | grep 20260925` tegen `origin/main`.
- **Gedeelde bestanden — wie wacht op wie:**
  - `kit.tsx`, `src/app/layout.tsx`, `app.tsx`: N1 → N3 → N5, strikt sequentieel.
  - De zes clipboard-call-sites (`landing.tsx`, `influencer-stats.tsx`, `events/edit.tsx`, `promotion/roster.tsx`, `promotion/create-link-flow.tsx`, `promotion/event-links.tsx`): N1 raakt ze; T1 blijft er in golf 1 vanaf en rebased op `main` nadat N1 gemerged is.
  - `shell.tsx` + screens: T1. N1 raakt `shell.tsx` niet (safe-area zit er al in).
  - `src/features/auth/session-actions.ts` + migraties: N2. S3 blijft uit `session-actions.ts`.
  - `next.config.js`: N1 schrijft alleen commentaar (CSP-notes); N3 mag pas wijzigen als de bridge geblokt wordt.
- **Review gates:** N2 en S3 zijn high-risk (RLS/triggers/`SECURITY DEFINER`, een prod-login-route). De worker schrijft de security-research-prompt in de PR-body (CLAUDE.md-regel, ongevraagd). De **orchestrator spawnt daarna een aparte reviewer-sessie** (§6) — niet zichzelf, niet de worker. Pas na een schone reviewer-ronde gaat de PR naar Max.
- **Test-handoff:** elke UI-PR (N1, T1, N5, S2) eindigt met de per-screen-handoff uit CLAUDE.md. De orchestrator bundelt die per golf in één bericht aan Max, genummerd, zodat Max "1 ✅, 2 ❌ — …" kan antwoorden.

## 2. Golf-overzicht

| Golf | Workers (parallel) | Wacht op | Exit-criterium |
|---|---|---|---|
| 1 | N1, N2, S3, T1, L1 | niets | N1 gemerged (blokkeert golf 2); N2/S3 door reviewer-ronde en bij Max ter test; T1/L1 mogen doorlopen in golf 2 |
| 2 | N3 | N1 gemerged | N3 gemerged **en** Max' Android-debugbuild werkt: login, server action, deur-offline, externe link, back-button |
| 3 | N4, N5, S2, S4, S1a | N3 gemerged; S1a ook M2 | N5 push werkt op Android; S1a-build op Play internal; N4-besluit in het plandoc |
| 4 | S5-Android | golf 3 + T1 + L1 | Play-submissie ingediend |
| 5 | S1b → S5-iOS | M1 + M3 | TestFlight-build getest op iPhone én iPad; App Store-submissie ingediend |

Golf 1 heeft vijf workers; drie tegelijk is het realistische maximum als Max ze ook moet testen. Aanbevolen start: **N1 + N2 + S3** direct, T1 en L1 zodra er ruimte is (ze blokkeren pas golf 4).

## 3. Orchestrator-prompt (copy-paste, één per golf)

Vul `<GOLF>` in en plak het golf-blok uit §4 eronder.

```
Je bent de orchestrator voor Fase 17 (native apps) golf <GOLF> van PlusOne Guestlist.
Model: Fable. Je bouwt zelf NIETS — je brieft, bewaakt, reviewt en rapporteert.

Lees eerst, in deze volgorde, en niets anders vóór je iets doet:
1. CLAUDE.md (de invarianten; de Capacitor-checklist en de review gates zijn bindend)
2. capacitor-plan-claude-code.md (§2 beslissingen, §4 fasering + golven, §8 review)
3. capacitor-orchestration-claude-code.md (dit is je werkinstructie; §1 mechaniek, §5 worker-brief, §6 reviewer-brief)
4. .claude/skills/clickup-task/SKILL.md (de workers volgen dit; jij zet alleen epic-comments)
5. De ClickUp-epic 86exxuvye + de taken van deze golf (clickup_get_task met description)

Startcheck (rapporteer het resultaat in één blok aan Max vóór je workers spawnt):
- Zijn de PR's van de vorige golf gemerged? (git fetch origin main; controleer de deliverables in de code, niet alleen de ClickUp-status.)
- Staat een taak van deze golf al op planning/in progress met een andere sessie erop? Dan die taak overslaan en melden.
- Migratie-timestamps van deze golf vrij op origin/main? (git ls-files supabase/migrations | grep <datum>)
- Welke M-taken (Max' accounts) zijn nog open en blokkeren ze iets in deze golf?

Daarna, per worker uit het golf-blok:
- Vul de worker-brief uit §5 van het orchestratie-doc in (taak-id, branch, model, toegewezen timestamps, verboden bestanden, deps) en spawn de sessie via create_session (permission_mode nooit 'plan'; model per brief). Lukt spawnen niet, geef Max de ingevulde brief om te plakken.
- Volg de sessie. Grijp in (interrupt_session + send_message) als een worker buiten zijn scope gaat, een verboden bestand aanraakt, een guard uitzet, of een timestamp verzint.

Per opgeleverde PR:
- Lees de diff zelf, adversarieel: wat zou CI afkeuren, welke CLAUDE.md-regel wordt geschonden, waar is de Capacitor-checklist niet toegepast, waar wordt een guard verzwakt? Bevindingen gaan als review-comment op de PR (met de Claude Code-footer), niet als chat.
- High-risk PR (N2, S3): spawn de reviewer-sessie uit §6. Pas na een schone ronde gaat de PR naar Max.
- Oordeel aan Max in één regel per PR: "klaar voor je test-handoff" of "niet mergen, want …", plus de genummerde test-handoff-vragen (UI-PR's).

Harde regels:
- Merge nooit zelf en vraag er niet om; Max merged na zijn test.
- Één DB-eigenaar: remote containers hebben geen Supabase-stack — CI is de DB-gate. Zeg dat in elk PR-oordeel voor N2/S3.
- Geen model-namen in commits, PR-titels of -bodies.
- Elke wijziging aan het plandoc of CLAUDE.md gaat in een eigen kleine PR van jou, nooit in een worker-PR.

Einde van de golf (exit-criterium uit §2 gehaald, of Max zegt stop):
- Epic-comment op 86exxuvye: wat gemerged, wat open, wat geblokkeerd en waarop, wat golf <GOLF+1> nodig heeft van Max.
- Changelog-entry in docs/changelog.md (nieuwste bovenaan) met dezelfde inhoud, in een eigen docs-PR.
- Laatste bericht aan Max: de exacte startvoorwaarden voor de volgende golf.
```

## 4. Golf-blokken (plak onder de orchestrator-prompt)

### Golf 1

```
GOLF 1 — parallel, geen deps. Start N1 + N2 + S3 direct; T1 en L1 als er testcapaciteit is.

N1  86ey6bfam  Webview-prep fixes                Opus    branch claude/86ey6bfam-webview-prep
    Raakt: kit.tsx (copyText, openExternal), de 6 clipboard-call-sites, screens/onboarding.tsx, src/app/layout.tsx (viewport-fit), next.config.js (alleen commentaar), CLAUDE.md-checklist (alleen verifiëren, staat al).
    Verboden: shell.tsx, app.tsx, alles onder src/features/.
N2  86ey6bfbe  Push-backend                      Opus    branch claude/86ey6bfbe-push-backend
    Timestamps: 20260925120000_push_tokens_outbox, 20260925120100_push_dispatch_wiring, 20260925120200_push_tokens_revoke_on_logout.
    Raakt: supabase/migrations, supabase/tests/database (pgTAP allowed+denied per rol, grant_matrix-allowlist), supabase/functions/push-dispatch, src/features/auth/session-actions.ts, src/lib/database.types.ts.
    Verboden: src/features/notifications/provider.ts (dat is N5), alle UI.
    High-risk → reviewer-sessie verplicht. CI is de DB-gate (geen lokale stack in de container).
S3  86ey6bfug  Review-login + demo-venue         Opus    branch claude/86ey6bfug-review-login
    Raakt: src/app/auth/review-login/route.ts (model: dev-login/route.ts), scripts/seed-demo-venue.*, docs (runbook-sectie), tests.
    Verboden: src/app/auth/dev-login/route.ts wijzigen, session-actions.ts, migraties (tenzij onvermijdelijk → 20260925130000_*).
    High-risk → reviewer-sessie verplicht. Security-checklist volledig in de PR-body.
T1  z8uq9m0fzj Tablet-layouts 641–1023px         Opus    branch claude/z8uq9m0fzj-tablet-layouts
    Raakt: shell.tsx, screens/*, design-system.md (breakpoint-beslissing).
    Verboden: de 6 clipboard-call-sites en kit.tsx tot N1 gemerged is; daarna rebase op main.
L1  86ey1vbrj  Legal-pagina's live               Opus    branch claude/86ey1vbrj-legal-pages
    Raakt: src/app/(legal)/privacy, /terms (of de route-structuur die past), docs/legal/*, src/lib/legal.ts (alleen defaults), env-docs.
    Verboden: de teksten inhoudelijk herschrijven — Max' juridische check gaat vóór publicatie; de worker levert de pagina's + een lijst open placeholders uit docs/legal/README.md.

Exit: N1 gemerged. N2 en S3 door de reviewer-ronde en bij Max ter test. T1/L1 mogen doorlopen.
```

### Golf 2

```
GOLF 2 — één worker; wacht op N1 gemerged (controleer copyText/openExternal in kit.tsx op origin/main).

N3  86ey6bfdm  Capacitor-scaffold + Android      Opus    branch claude/86ey6bfdm-capacitor-scaffold
    Raakt: capacitor.config.ts, android/, ios/ (TARGETED_DEVICE_FAMILY 1,2), package.json (@capacitor/core, cli, app, browser, status-bar, splash-screen), app.tsx (backButton → router.back(), exit op /app-root), src/lib/platform.ts (alleen als isNativeShell() aanpassing nodig is), next.config.js (alleen bij bewezen bridge-block: hash/nonce, nooit unsafe-inline), plandoc (WKAppBoundDomains-beslissing).
    Verboden: src/features/**, migraties, service-worker.js.
    Let op: openExternal() uit N1 krijgt hier zijn @capacitor/browser-tak.

Exit: N3 gemerged EN Max meldt dat de Android-debugbuild werkt (login via OTP, een server action, deur-offline, externe link opent in systeembrowser, back-button retraces en exit alleen op root). Zonder die melding is golf 3 niet gestart.
```

### Golf 3

```
GOLF 3 — parallel; wacht op N3 gemerged + Max' debugbuild-bevestiging. S1a wacht ook op M2 (Play org-account).

N4  86ey6bfe8  Deur cold-start-spike             Fable   branch claude/86ey6bfe8-door-coldstart-spike
    Geen productiecode. Deliverable = besluit + onderbouwing in het plandoc (drie varianten: remote-URL accepteren / deur-route lokaal bundelen / App-Bound Domains + SW-shell). Max test op zijn Android-build; de worker schrijft het testscript.
N5  86ey6bfkb  Push-client + CapacitorPushProvider  Opus  branch claude/86ey6bfkb-push-client
    Raakt: src/features/notifications/provider.ts (+ capacitor-adapter), permission-card (Home/Approvals) + Settings-toggle, server action voor registratie (session_id uit JWT), sign-out-device.ts (unregister vóór IDB-clear), tap-navigatie.
    Verboden: migraties (N2 is de bron), app.tsx buiten de tap-navigatie-hook.
S2  86ey6bft8  Icons/splash/store-metadata       Sonnet  branch claude/86ey6bft8-store-assets
    Raakt: @capacitor/assets-output onder android/ en ios/, store-metadata-map in de repo.
    Verboden: alles buiten assets/metadata.
S4  86ey6bfxa  App links (alleen /auth/*)        Opus    branch claude/86ey6bfxa-app-links
    Raakt: route handlers voor /.well-known/apple-app-site-association + assetlinks.json, appUrlOpen-listener.
    Verboden: /e/* claimen (beslissing 11), auth-routes zelf wijzigen.
S1a 86ey6bfpy  Android-build + Codemagic         Opus + Max  branch claude/86ey6bfpy-codemagic-android
    Raakt: codemagic.yaml, docs (release-runbook). Secrets alleen in Codemagic, nooit in de repo.

Exit: N5 push werkt end-to-end op Max' Android (alle drie use-cases); S1a-build staat op Play internal; N4-besluit staat in het plandoc.
```

### Golf 4 en 5

```
GOLF 4 — S5-Android (86ey6bfyj, Opus + Max). Wacht op golf 3 + T1 + L1 gemerged. Deliverable: Play data-safety-form, review-notes, staged rollout ingediend. Exit: submissie ingediend; review-iteraties lopen door in dezelfde orchestrator.

GOLF 5 — S1b (z8uq9m0gvn, Opus + Max) → S5-iOS. Wacht op M1 (Apple org) + M3 (APNs-key). Deliverable: iOS-workflow in codemagic.yaml, TestFlight, push geverifieerd op iPhone én iPad, App Store-submissie met de 4.2-verdediging. Exit: ingediend; iteraties in dezelfde orchestrator.
```

## 5. Worker-brief (template — de orchestrator vult in)

```
Je bouwt ClickUp-taak <TASK-ID> — "<TASK-NAAM>" voor PlusOne Guestlist, als onderdeel van Fase 17 golf <GOLF>.
Model: <Opus|Sonnet|Fable>. Branch: <BRANCH>. Werk uitsluitend op die branch.

Volg de clickup-task-skill vanaf stap 0 (pickup-comment, status, session-marker, end-of-session-comment). De taakbeschrijving in ClickUp is de opdracht van record; capacitor-plan-claude-code.md §4 is de context. Bij conflict tussen die twee of met de code: stoppen en melden, niet kiezen.

Scope-hek (van de orchestrator, bindend):
- Raakt: <bestandslijst>
- Verboden: <bestandslijst> — raak je die toch nodig, stop en meld het aan de orchestrator vóór je verder gaat.
- Migratie-timestamps (indien van toepassing): <lijst>. Geen andere. Check ze eerst tegen origin/main.
- Deps: <wat al gemerged moet zijn>; controleer dat in de code op origin/main, niet in ClickUp.

Regels die hier extra tellen:
- CLAUDE.md is bindend: de Capacitor-checklist per scherm, de security-checklist per route/action, de grant matrix per nieuwe tabel, geen bare JSX.Element, Engelse UI-copy via src/lib/i18n/en.ts.
- Deze container heeft geen Supabase-stack: db:test/db reset/e2e draaien hier niet. Schrijf de pgTAP/migraties, laat CI ze draaien, en zeg in de PR-body precies wat je NIET lokaal kon draaien.
- Verzwak nooit een guard, test of config om iets groen te krijgen. De weigering is het signaal.
- Geen model-namen in commits/PR. Conventional commits, kleine commits per logische stap.
- High-risk surface (RLS/triggers/SECURITY DEFINER/service_role/auth-route)? Dan schrijf je ongevraagd de security-research-prompt in de PR-body: threat model, de relevante code inline, concrete aanvalsvragen voor precies wat jij veranderde.

Definition of done voor deze worker:
1. Draft-PR open met de taak-id in de titel, body volgens de repo-conventie, CI groen (lint-and-test).
2. UI-werk: per-screen test-handoff onderaan je laatste bericht (dev-login-link + 10–15 genummerde ja/nee-vragen).
3. docs/changelog.md-entry (nieuwste bovenaan) + end-of-session-comment op de ClickUp-taak; status blijft 'in progress' tot Max gemerged en getest heeft.
4. Laatste bericht: wat gebouwd, wat niet, wat de orchestrator moet weten (afwijkingen van de brief, ontdekte problemen buiten scope — die meld je, je lost ze niet op).
```

## 6. Reviewer-brief (fresh session, high-risk PR's — N2, S3)

```
Je reviewt PR #<NR> ("<TITEL>") van PlusOne Guestlist als onafhankelijke, verse sessie. Model: Fable. Je hebt de PR niet gebouwd en hebt geen belang bij het goedkeuren ervan.

Lees CLAUDE.md (security-checklist, review gates, grant matrix, non-negotiables) en de security-research-prompt in de PR-body. Voer daarna uit:
1. /code-review high op de PR.
2. /security-review op de branch.
3. De aanvalsvragen uit de PR-body één voor één, met de code erbij: kan een authenticated user zonder membership iets lezen/schrijven? Kan een gerevoceerde sessie nog pushen of ontvangen? Is de route echt 404 zonder env-secret, ook bij een lege string? Wat gebeurt er bij replay/dubbel-insert? Waar zit service_role en waarom?
Alle bevindingen als review-comments op de PR met de Claude Code-footer; blokkerend = "Request changes". Geen bevindingen = één approve-comment met wat je concreet geprobeerd hebt. Geen fixes pushen; de bouwer of de orchestrator handelt ze af.
```

## 7. Wat Max doet, per golf

| Golf | Max |
|---|---|
| vóór 1 | D-U-N-S + Apple org-account (M1), Play org-account (M2), Firebase-project (M3) aanvragen. Dit is de kritieke keten; niets in de code haalt het in. |
| 1 | Per PR: test-handoff beantwoorden, mergen. N2/S3 pas mergen na de reviewer-ronde. Juridische check op de L1-pagina's. |
| 2 | Android-debugbuild draaien op de Windows-machine en de vijf checks uit het golf-2-exit bevestigen. |
| 3 | Push testen op de eigen Android; Play-listing + screenshots (M4, na T1). |
| 4 | Play data-safety-form; submissie. |
| 5 | APNs-key uploaden zodra Apple klaar is; TestFlight op iPhone + iPad; App Store-submissie; review-iteraties. |

## 8. Kosten-indicatie en wanneer je afwijkt

Een orchestrator-sessie op Fable is goedkoop in tokens (lezen + oordelen, weinig output). De workers op Opus zijn de kostenpost, en die zijn er sowieso — orchestratie voegt vooral de reviewer-sessies toe (twee in golf 1). Wijk af van dit document als: een worker-scope te groot blijkt (splits de taak in ClickUp, nooit in de PR), Max' testcapaciteit onder de drie parallelle PR's zakt (dan seriëel), of een M-taak langer duurt dan verwacht (dan schuift golf 5, de rest niet).
