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

| # | Taak | ClickUp | Model | Wacht op | Exit-criterium |
|---|---|---|---|---|---|
| 0 | Spikes | geen (dit doc §9) | Opus | niets | §9 ingevuld; comments op D, E, A, F; Max' open besluiten uit §9 beantwoord |
| 0a | QA-0 flow-screenshots + handoff-automatisering | zie ClickUp "QA-0" | Opus | 0b (P1 gaat voor: snelheid is de acute pijn) | gemerged; `pnpm qa:flows onboarding` geeft vier varianten met contact sheet; CI-job + PR-comment; native-shell-guard als vaste flow |
| 0b | Snelheid P1 (quick wins) | z8uq9m2xyn | Opus | 0 | gemerged; prod-push (index + invites-policy); layout ≤ 2 roundtrips; geen `revalidatePath` meer in po-mutaties; terugkeer naar een tab zonder server-fetch |
| 0c | Notificaties N1 (push bundelen) | z8uq9m2yvk | Opus | 0b | gemerged; prod-push; 30 aanvragen in 2 minuten geven 10 directe pushes en daarna één per uur met het aantal |
| 0d | Crew-bug (bestaand account als crew) | z8uq9m2yvp | Opus | 0b | gemerged; `staff@` (bestaand account) is als crew toe te voegen aan een event van de andere seed-company en ziet alleen dat event |
| 0e | Mail-infra F0 (Resend + team-invite mails) | z8uq9m2yvt | Opus | 0d; Max: Resend-key | gemerged; prod-push; team-invite naar een bestaand account en crew-toevoeging geven een echte mail (geen magic link meer); webhook idempotent |
| 0f | Sentry-hygiene S1 | zie ClickUp "Sentry-hygiene S1" | Sonnet | 0b | gemerged; verwachte gebruikersfouten (42501, exists, validatie, already_handled, billing_*) komen niet meer in Sentry; Supabase-fouten hebben een leesbare titel en `code`-tag; EvalError-bron bekend |
| 1 | Venue → Company | z8uq9m2vqc | Opus | 0 | gemerged; `pnpm e2e:layout` groen; geen "venue" meer zichtbaar in de UI; event met eigen locatie zichtbaar op de eventkaart |
| 2 | Billing G | z8uq9m2vrz | Opus | 1 | gemerged; prod-push; onboarding zonder plan/betaalstap; Platform-tab kan trial verlengen en "always free" zetten; native toont alleen status en de neutrale zin (e2e-guard native-shell groen); Max' Stripe-stappen (§6) klaar vóór de env-vars live gaan |
| 2b | Platform R | z8uq9m2ybj | Opus | 2 | gemerged; prod-push; invite-rij toont company-chip met Switch, events, status, activiteit; Overview toont status-tellingen, MRR/ARR, trial-funnel, gebruik; manager@ ziet niets |
| 2c | Billing-mails B1 | z8uq9m2z19 | Opus | 0e, 2, 2b; copy gekozen | gemerged; prod-push; seed-trials op dag 7/12/14/21 krijgen elk precies één mail per run; Platform-tab toont de tijdlijn per company |
| 3 | Onboarding A | z8uq9m2vg5 | Opus | 2 | gemerged; comped-invite werkt end-to-end; Places op het adresveld; één DPA-checkbox; nieuwe invite-mail in Mailpit en in prod gezien |
| 4 | Check-in D | z8uq9m2vg6 | Opus | 0 (ontwerp), 1 | gemerged; groep-knop en per-persoon-knop; doorhost kan niet uitchecken tenzij de setting aan staat, ook niet via de API |
| 5 | Event C + Dashboard B | z8uq9m2vg7 + z8uq9m2vg8 | Opus | 1 | één PR, twee taken; gemerged; test-handoff beantwoord |
| 6 | Gastcommunicatie F | z8uq9m2vpy | Opus | 1, 2 (company-contact zit in settings), copy gekozen | gemerged; prod-push; een handmatig toegevoegde gast met e-mail krijgt binnen een minuut "You're on the list"; afmeldlink werkt; bounce-webhook idempotent |
| 7 | Requests E | z8uq9m2vga | Opus | 6 | gemerged; prod-push; splitsen, inkorten, deels afwijzen met verplichte opmerking; statusmail via F |
| 8 | Quota-aanvraag Q | z8uq9m2xyp | Opus | 7 | gemerged; prod-push; aanvrager ziet de beslissing op Home; akkoord met gast-gegevens zet de gast op de lijst |
| 9 | Snelheid P2 | z8uq9m2xz2 | Opus | 8, of eerder als Max na P1 nog traagheid ziet | per PR gemerged; tab-wissel zonder server-fetch; 300-events-seed laadt alleen het venster |
| ∥ | Legal | z8uq9m2vh6 | Opus | niets (andere repo) | documenten op eenmanszaak; Google en Resend op de subprocessorlijst; `TERMS_VERSION` gebumpt als de tekst materieel wijzigt |

Taak 5 combineert C en B omdat ze dezelfde event- en dashboard-screens raken; de worker houdt beide ClickUp-taken bij (comment op allebei, zoals de skill voorschrijft).

## 2b. Golven (herzien 2026-10-06 avond: wél parallel waar de bestanden niet overlappen)

De sequentiële regel uit §0 blijft de default, maar met twintig taken en ADE over ruim een week is "één voor één" te traag. Wat parallel kan, is wat elkaars bestanden niet raakt; de scope-hekken in §4 zijn daarvoor de grens. Per golf één orchestrator-sessie (Opus, prompt in §2c) zodra er drie of meer workers lopen; bij twee kan Max het zelf.

| Golf | Parallel | Wacht op | Waarom dit samen kan |
|---|---|---|---|
| A | Spikes (0) · Snelheid P1 (0b) · Notificaties N1 (0c) · Sentry-hygiene S1 (0f) · QA-0 (0a) · Legal | niets | P1 = layout/hooks/actions; N1 = migraties + push-dispatch; S1 = capture.ts + error-handlers; QA-0 = scripts/tests/CI; Legal = andere repo. Geen overlap. S1 blijft uit PoLiveProvider behalve de twee error-handlers. |
| B | Venue → Company (1) · Mail-infra F0 (0e) · Crew-bug (0d) | A gemerged (P1 raakt `events/actions.ts`) | De sweep raakt strings en screens; F0 is nieuwe mail-code + webhook; de crew-bug zit in één action. F0 raakt `events/actions.ts` alleen voor de crew-mail-aanroep en rebased na de crew-bug. |
| C | Billing G (2) · Check-in D (4) | B gemerged | G = billing/onboarding/platform-venues; D = door + check_ins-RLS + één toggle in Company settings. Twee reviewer-sessies. |
| D | Platform R (2b) · Onboarding A (3) · Event C + Dashboard B (5) | C gemerged | R = platform-schermen + RPC's; A = invites/VenueStep/Places; C+B = event- en dashboard-screens. A raakt VenueStep, G heeft de wizard al vereenvoudigd. |
| E | Billing-mails B1 (2c) · Gastcommunicatie F (6) | D gemerged | B1 = billing-templates + job + platform-tijdlijn; F = gastmail + settings + prefs. Beide op F0. |
| F | Requests E (7) → Quota Q (8) → Snelheid P2 (9) | E gemerged | E en Q delen de request-RPC's; P2 raakt navigatie en RLS, als laatste. |

Regels bij parallel werk: elke worker in een eigen container (eigen stack) of, op Max' laptop, één tegelijk; migratie-timestamps uit §3, nooit zelf gekozen; wie buiten zijn scope-hek moet, stopt en meldt; de orchestrator bundelt de test-handoffs per golf in één bericht aan Max.

## 2c. Orchestrator-prompt (copy-paste, één per golf)

Eén orchestrator per **golf**, niet per onderwerp en niet voor het hele programma. Golf B heeft A gemerged nodig, dus "alle orchestrators tegelijk" kan niet; wat wel kan is binnen een golf alle workers tegelijk, en dat is waar de winst zit. Vul `<GOLF>` in, plak de regel uit §2b eronder. Rename: `/rename Onboarding okt 2026 — orchestrator golf <GOLF>`.

```
Je bent de orchestrator voor het onboarding-programma oktober 2026 van PlusOne Guestlist, golf <GOLF>.
Model: Opus. Je bouwt zelf NIETS — je brieft, bewaakt, reviewt en rapporteert.

Lees eerst, in deze volgorde, en niets anders vóór je iets doet:
1. CLAUDE.md (invarianten, security-checklist, review gates, prod-push-flow)
2. onboarding-orchestration-claude-code.md (dit is je werkinstructie: §1 mechaniek, §2b jouw golf, §3 timestamps, §4 de briefs van jouw workers, §5 reviewer-gate, §6 wat Max doet, §7 besluiten, §9 spike-antwoorden en losse eindjes)
3. docs/perf-audit-2026-10.md als P1 of P2 in jouw golf zit
4. .claude/skills/clickup-task/SKILL.md (de workers volgen dit; jij zet alleen comments op de taken van jouw golf, met mate: de ClickUp-koppeling heeft een daglimiet van ~100 calls voor alle sessies samen)
5. De ClickUp-taken van jouw golf (clickup_get_task met description én comments — de comments bevatten de latere besluiten en gaan vóór de beschrijving)

Startcheck (rapporteer het resultaat in één blok aan Max vóór je workers spawnt):
- origin/main bevat de merges waar jouw golf op wacht (§2b "Wacht op"): controleer in de code, niet in ClickUp.
- `git ls-files supabase/migrations | grep 202610` tegen origin/main: de timestamps uit §3 voor jouw golf zijn vrij.
- Max' voorwaarden uit §6 voor jouw golf zijn gedaan (env-vars, keys, copy gekozen); zo niet, benoem precies wat ontbreekt en start alleen de workers die er niet van afhangen.
- Geen taak van jouw golf staat al op 'planning' of 'in progress' (concurrency-check uit de skill).

Workers:
- Eén sessie per taak met de ingevulde brief uit §4 (algemeen blok + taakblok), permission_mode nooit 'plan'. Branch claude/<taakid>-<slug> vanaf origin/main.
- Het scope-hek in de brief is bindend. Een worker die erbuiten moet, stopt en meldt; jij beslist (vaak: in een eigen PR na de golf).
- Review gates: voor de taken in §5 start je na de draft-PR een aparte reviewer-sessie met de brief uit §5, en je vraagt Max om `/code-review ultra <PR#> --post`. Pas na een schone ronde gaat de PR naar Max.
- Token-discipline voor jou en de workers: geen zelfgeplande wake-ups, geen CI-eigenaarschap na de laatste push, de volledige `pnpm test` precies één keer vlak voor de laatste push.

Per PR lever je Max één oordeel: "klaar voor jouw test-handoff" of "niet mergen, want …", met de handoff-vragen genummerd en gemarkeerd ✅ automatisch / 👁 screenshot / 🖐 handmatig (QA-0-conventie zodra die gemerged is; daarvóór alleen de vragen).

Einde van de golf (exit-criterium uit §2b gehaald): één bericht aan Max met per taak PR, status, wat open bleef, en wat de volgende golf moet weten; §2b in het document bijwerken met de PR-nummers; daarna stop je. Je start golf <GOLF+1> niet zelf.
```

## 3. Migratie-timestamps (gereserveerd)

| Taak | Bestand | Inhoud |
|---|---|---|
| 0b | `20261007100000_guests_venue_created_idx.sql` | index `guests(venue_id, created_at desc, id desc)` |
| 0b | `20261007100100_invites_select_initplan.sql` | `invites_select` met `(select auth.uid())` (advisor auth_rls_initplan) |
| 0c | `20261007110000_notification_throttle.sql` | `notification_throttle`, `notification_outbox.collapse_key` + `deliver_after`, trigger-telling (>10 in 60 min → 24 uur per uur bundelen) |
| 1 | `20261007120000_event_location.sql` | `events.location_name text`, `events.location_address text` (nullable, expand-only); geen RLS-wijziging |
| 2 | `20261008120000_single_plan_pro.sql` | `update subscriptions set plan_id = 'pro'`; `create_venue_with_owner` zet `plan_id = 'pro'`; `set_venue_plan` blijft bestaan maar accepteert alleen `pro` |
| 2 | `20261008120100_billing_interval.sql` | `subscriptions.billing_interval text check in ('month','year')` nullable; `apply_stripe_subscription_update` krijgt `p_billing_interval` |
| 2 | `20261008120200_platform_trial_override.sql` | `subscriptions.trial_ends_at timestamptz` nullable; RPC's `set_venue_trial_end`, `set_venue_comped` (SECURITY DEFINER, `is_platform_admin()`), grants, pgTAP |
| 2b | `20261008130000_platform_overview_rpcs.sql` | `platform_invite_overview()` + companies per invite; `platform_subscription_counts()`, `platform_usage_30d()`, trial-funnel-RPC; alle SECURITY DEFINER met `is_platform_admin()` binnenin |
| 2c | `20261008140000_billing_mail_types.sql` | zeven `mail_log.type`-waarden, unique `(venue_id, type)` voor trial-mails, `subscriptions.billing_mails_paused`, RPC `platform_billing_mail_timeline` |
| 3 | `20261009120000_platform_invite_comped.sql` | `platform_invites.comped boolean not null default false`; `create_venue_with_owner` roept `set_venue_comped` aan als de invite comped is |
| 4 | `20261010120000_checkin_absolute_count_guard.sql` | check `plus_ones_arrived <= guest.plus_ones` (trigger); stale-guard op `client_timestamp` in de check-in-RPC |
| 4 | `20261010120100_door_checkout_permission.sql` | `venues.settings->'door'->>'doorhost_can_check_out'` gelezen in de DELETE/UPDATE-policy op `check_ins` (of in de undo-RPC); pgTAP allowed/denied per rol |
| 0e | `20261007130000_mail_log.sql` | `mail_log` (append-only, type + ontvanger-hash + status + provider-id, geen inhoud), `resend_webhook_events`-ledger, grant matrix |
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
4. Places: server-route die Places API (New) Autocomplete + Place Details proxiet met session tokens; key alleen server-side; rate limit per user (bestaande throttle-helper); client-component op VenueStep, Company settings en event-locatie; zonder key valt het veld terug op gewoon typen.

Klaar als:
- Platform-invite met comped → nieuwe owner doorloopt Welkom → Company → Team en ziet in More → Billing "Always free"; audit_log toont set_venue_comped op de uitnodiger.
- Invite-mail in Mailpit toont de company-tak met de naam van de uitnodiger; team-invite toont de team-tak.
- Zonder GOOGLE_PLACES_API_KEY werkt het adresveld als tekstveld; met key vult één selectie naam + adres; de key staat niet in de client-bundle (secret-grep-guard uitbreiden).
- /consent vraagt Terms+Privacy, VenueStep alleen de DPA; pgTAP op create_venue_with_owner met comped.

Test-handoff: admin@ (platform) → Platform → Invite met comped; de uitgenodigde via Mailpit; manager@ → Company settings → adres via Places.
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

Twee lagen, allebei vóór de merge:

1. **`/code-review ultra <PR#> --post`** (Max start het; het is gebruikersgestuurd en wordt apart afgerekend). De multi-agent cloud-review leest de hele PR en post de bevindingen als één comment op de PR. De bouwer verwerkt blokkerende punten in dezelfde branch; de volgende sessie leest de comment en neemt open punten over in dit document.
2. **De security-sessie hieronder** voor de aanvalsvragen die specifiek zijn voor wat er veranderde. Ultra vindt bugs en vereenvoudigingen; de aanvalsvragen per taak vindt hij niet vanzelf.

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
| vóór taak 0e | Resend: API-key aanmaken op het bestaande domein → `RESEND_API_KEY` in Vercel; webhook-endpoint `https://app.plus-one.io/api/webhooks/resend` → `RESEND_WEBHOOK_SECRET`. Copy kiezen voor de drie team-invite-mails (team join bestaand account, crew added, resend). |
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
| Quota-aanvraag | Melding terug op Home (reden verplicht bij afwijzen); gast optioneel meegeven; akkoord zet de gast direct op de lijst | nieuw |
| Deep link | Event van een andere company: uitleg + "Switch to {company}", nooit stil wisselen | nieuw |
| Opt-out via telefoon | Matchend nummer mag "Keep me posted" uitzetten (alleen uit, audit); restrisico geaccepteerd | nieuw |
| Snelheid | Audit `docs/perf-audit-2026-10.md`; P1 quick wins nu, P2 later of bij aanhoudende traagheid | — |
| Billing-mails | Trial dag 0/7/12/14/21, betaling mislukt, opgezegd, via Resend; nooit bij comped of gepauzeerd; facturen blijven van Stripe; tijdlijn per company in de Platform-tab | #32 |
| Team-invite mail | Bestaand account krijgt "X invited you to join Y" en crew "X added you to Z" via Resend (taak 0e); geen magic-link-mail meer als uitnodiging; nieuwe accounts blijven via de Supabase-template | #20, #24 |
| Notificaties | Push bundelen per company en per soort (>10 in 60 min → 24 uur één per uur met aantal). Teammail via Resend: aanvraag direct (gebundeld), quota direct, besluit naar aanvrager, dagelijkse samenvatting; voorkeuren per gebruiker, afmeldlink | nieuw |
| Platform | Per invite: company-chip met Switch, events, status, activiteit. Overview: companies per status, MRR/ARR uit eigen DB × Stripe-prijzen (excl. kortingen/dunning, gelabeld), trial-funnel, gebruik 30 dagen. Direct na Billing G | #49 |
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

1. **Gate (taak 2).** Reproduceer lokaal: zet `subscriptions.created_at` van de seed-venue 15 dagen terug, log in als manager@, maak een event. Verwacht: `billing_trial_expired`. Vuurt de gate niet, zoek waarom (RLS op `subscriptions`? `maybeSingle()` null? pad via RPC dat de gate omzeilt?). Antwoord: ___
2. **Absolute check-in-aantal (taak 4).** Bevestig dat de outbox één item per check-in-id kan upserten met een nieuw `plus_ones_arrived` en `client_timestamp`, en ontwerp de stale-guard in de bestaande check-in-RPC. Lever de SQL-schets voor `20261010120000`. Antwoord: ___
3. **Request-splitsing (taak 7).** Lees `approve_guest_request` en het `guest_requests`-schema; ontwerp `decide_guest_request(jsonb)` met de quota-trigger erin: welke tabellen, welke audit-rijen, hoe stats het afgewezen deel tellen. Lever de SQL-schets voor `20261015120000`. Antwoord: ___
4. **Invite-template-voorwaarde (taak 3).** Zet lokaal in `supabase/config.toml` een invite-template met `{{ if eq .Data.kind "company" }}` en verstuur een invite met `data: { kind: 'company', invited_by: 'Max' }`; bekijk Mailpit. Rendert de voorwaarde en de metadata? Controleer ook of HTML in `invited_by` ge-escaped wordt. Antwoord: ___
5. **Resend-infra (taak 6).** Bevestig welk domein en welke afzender nu via SMTP lopen (docs/mail-deliverability.md, docs/legal/README.md), of een API-key los van de SMTP-credentials nodig is, en of de Resend batch-API en webhooks beschikbaar zijn op het huidige plan. Lever de lijst voor Max in §6. Antwoord: ___
6. **Places-proxy (taak 3).** Ontwerp de server-route: Autocomplete (New) + Place Details met session tokens, field mask beperkt tot adrescomponenten, rate limit via de bestaande throttle-helper, foutpad zonder key. Schat de kosten bij 100 onboardings per maand. Antwoord: ___

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

- **Seed-data (Sanne/Pim-verwisseling):** de fix raakt drie pgTAP-bestanden en vereist een `supabase db reset` lokaal. Aanbeveling: gewoon doen in wave 0; lokale testdata is per definitie weggooibaar. **Antwoord (Max, 2026-10-06): ja, reset mag.** Wave 0 fixt de seed en de drie pgTAP-bestanden in de docs-PR van §9.
- **Deep link naar een event van een andere company:** automatisch wisselen van company, of een scherm "Dit event hoort bij {company}. Switch?" Aanbeveling: uitleggen + knop, nooit stil wisselen (platform-access-log en audit willen een bewuste actie). **Antwoord (Max, 2026-10-06): uitleg + knop "Switch to {company}".** Hoort bij taak 5 (event-screens): een deep link naar een event van een andere company waar de gebruiker lid van is toont die kaart; geen lid → het bestaande "niet gevonden"-pad, zonder te verraden dat het event bestaat.
- **Telefoon-gematchte opt-in:** mag een gast met een matchend telefoonnummer de "Keep me posted" van een bestaand contact uitzetten? Aanbeveling: nee, alleen via de afmeldlink uit taak 6 of door het team; een telefoonnummer is geen bewijs van identiteit. **Antwoord (Max, 2026-10-06): ja, een matchend telefoonnummer mag de voorkeur uitzetten.** Geaccepteerd restrisico: wie het nummer van een contact kent, kan diens updates uitzetten; het kan alleen uit, nooit aan, en de wijziging landt in de audit log met bron "guest request". Hoort bij taak 6 (opt-out) en wordt in de spec als beslissing opgenomen.
- **Poort 7000:** werkproces, geen code. CLAUDE.md "Een poort is een checkout" dekt het: vóór een test `git branch --show-current` in de map die de poort serveert. Antwoord: ___
