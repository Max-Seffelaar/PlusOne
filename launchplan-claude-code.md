# PLUSONE — Launch-sessie · plan (STAP 0 statusrapport + STAP 1–4 uitvoering)

> Bron: planning/handoff-sessie 2026-06-17. Dit document is de repo-library-kopie van het launch-plan.
> Bouwen gebeurt in **losse sessies per ClickUp-taak** (lijst `901818739469`); elke [Claude]-taak
> draagt zijn uitvoer-prompt uit DEEL D. Werkwijze v2: één taak = één sessie.

> **⚠️ SUPERSEDED / UITKOMST (2026-06-21).** Dit plan beschreef een **viewport-switch met twee surfaces**
> (desktop `(app)` + mobiel `po /app`, "Strategy A", dispatcher). Die richting is **verlaten**: de twee
> UI's zijn samengevoegd tot **één responsieve surface** — de `po`-app op `/app` (`ResponsiveShell`:
> bottom-tabs <1024px, sidebar ≥1024px). Het desktop-`(app)`-dashboard is **uitgefaseerd** (routes
> redirecten naar `/app`; alleen `/eventday` blijft als losse cockpit). Gemerged via **PR #50**.
> Desktop-layouts gedaan voor Home, Gastenlijst, Statistieken, Audit, Events en Gebruikers; resterend =
> `/eventday` vouwen in de desktop-Deur, tablet-polish (641–1023px), `/app` deep-linking. Lees alle
> "Strategy A / viewport-switch / dispatcher / desktop-`(app)`"-passages hieronder als **historie** —
> de actuele architectuur staat in **CLAUDE.md** (§ "One responsive surface") en **spec-beslissing #41**.

## Context

Doel: in één traject zo ver mogelijk richting launch. Voordat er code wijzigt is de werkelijke stand
bepaald: code ↔ ClickUp ↔ CLAUDE.md/spec. Dit document bevat het STAP 0-statusrapport, de
scherm-inventaris, de ontwerp-briefs, de beslissingen, en het volledige implementatieplan STAP 1–4.

---

## 1. Kernbevinding

Het project is **verder dan het geheugen suggereert**, maar er zijn vandaag **twee parallelle UI's,
geen één responsive codebase**:

- **Desktop-product** = `src/app/(app)/` (sidebar-shell `DashSidebar`). Volledig **live** op Supabase:
  dashboard, events (+detail/new/guests/requests), admin (stats/overview/audit/team/venue/sessions),
  profiel. Vaste sidebar — **niet responsive** naar telefoon-breedte.
- **Mobiele PWA** = `/app` → `<PlusOneApp>` (`src/components/po/app.tsx`). Bestand-header: *"this is the
  navigable mock… later phases swap the stack for the App Router."* Leest mock uit `@/lib/po/data`;
  check-in is in-memory. **Alleen Statistieken** is live bedraad.
- **`src/features/po/`** (de "PoLiveProvider"-laag uit het geheugen) **bestaat niet** op deze branch.
- **Deur** (`/door/[eventId]`) en **landing** (`/e/[slug]`) zijn live, mobiel-first. De deur is **af**.
- **Middleware** stuurt elke login naar `/dashboard` (desktop) — op telefoon land je nu op de krappe
  desktop-UI.

**Gevolg:** "identiek desktop ↔ mobiel" is een architectuurkeuze, geen styling-pass. Backend + desktop
zijn klaar; de mobiele schermen zijn mock die op de bestaande live-actielaag bedraad moet worden.

---

## 2. Reconciliatie-rapport (ClickUp ↔ code)

Backend, RLS, audit, quota-engine, deur-PWA, landing, stats en AVG-anonimisering zijn in de code
aanwezig en getest (28 migraties t/m `20260617030000`, pgTAP + Vitest). Desktop is daarop live bedraad;
de mobiele `po`-schermen worden sindsdien per scherm live bedraad (zie de inventaris hieronder — de meeste kern-schermen zijn inmiddels live).

| Gebied (ClickUp) | ClickUp | Code | Verdict |
|---|---|---|---|
| Fase 1 schema | complete | 28 migraties, UUIDv7, soft-delete | ✅ |
| Fase 2 RLS | complete | `rls_policies.sql` + `rls.test.sql` | ✅ |
| Fase 3 audit-triggers | complete | append-only verhard | ✅ |
| Fase 4 auth | complete | OTP/MFA/invites/sessies live; **"30 dagen" niet gebouwd** | 🟡 |
| Fase 5 venue/user | complete | desktop live | ✅ (mobiel mock) |
| Fase 6 events/tiers/lock | complete | status-machine + lock-RLS | ✅ (mismatch #1) |
| Fase 7 gasten/quota | complete | quota-engine DB-enforced, parser | ✅ (mobiel mock) |
| Fase 8 landing | complete | rate-limit + anti-enumeratie | ✅ |
| Fase 9 deur-PWA | complete | offline/outbox/realtime/void | ✅ |
| Fase 10 audit/stats | complete | desktop + mobiel Statistieken live | ✅ (mismatch #2) |
| Fase 11 AVG | complete | `run_privacy_retention` + redactie | ✅ (mismatch #3) |
| Fase 12 security/e2e/launch | to do | geen audit-doc/e2e | ❌ launch-blok |
| Fase 13 Stripe | to do | `subscriptions` + stub; geen adapter | 🟡 optioneel MVP |

**Mismatches:** (1) "Event kopiëren/template" = complete maar geen feature gevonden → verifiëren/heropenen.
(2) "Statistieken-aggregatie" = in progress maar af → sluiten. (3) "AVG-job (auto)" = to do maar
`run_privacy_retention` + pg_cron bestaan → herlabelen "cron op prod verifiëren".

---

## 3. Scherm-inventaris (desktop × mobiel)

✅ aanwezig & compleet · 🟡 deels/onaf · ❌ niet aanwezig.

| # | Scherm/flow | Route | Desktop | Mobiel | Data | Wat ontbreekt |
|---|---|---|---|---|---|---|
| 1 | Login / OTP | `/login` | ✅ | ✅ | live | UI-bugs (ClickUp) |
| 2 | MFA enroll/verify | `/mfa/*` | ✅ | ✅ | live | — |
| 3 | Onboarding | `/onboarding` | ✅ | ✅ | live | — |
| 4 | Dashboard-home | `/dashboard` | ✅ | ✅ (S11) | desktop live · mobiel live | desktop KPI-dashboard (aparte taak) |
| 5 | Events-lijst | `/events` | ✅ | 🟡 mock | desktop live | mobiel live |
| 6 | Event-detail/beheer | `/events/[id]` | ✅ | 🟡 EventBeheer stub | desktop live | mobiel live + afmaken |
| 7 | Event aanmaken | `/events/new` | ✅ | 🟡 mock | desktop live | mobiel live |
| 8 | Gastenlijst + quota + quick-add | `/events/[id]/guests` | ✅ | 🟡 mock | desktop live | mobiel live (kern!) |
| 9 | Aanvragen | `/events/[id]/requests` | ✅ | ✅ | live beide | ✅ mobiel live (PR #43) |
| 10 | Adresboek/contacten + vaste | — | ❌ | 🟡 mock | backend live, geen UI | live UI beide |
| 11 | Import (CSV/telefoon) | — | ❌ | 🟡 stub | backend live | live import-UI |
| 12 | Statistieken | `/admin/stats`,`/admin/overview` | ✅ | ✅ | live beide | charts polish |
| 13 | Audit-log + geschiedenis | `/admin/audit` | ✅ | ✅ | live beide | ✅ mobiel live (PR #44) |
| 14 | Gebruikers/rollen | `/admin/team` | ✅ | 🟡 Rollen stub | desktop live | mobiel + afmaken |
| 15 | Venue-instellingen | `/admin/venue` | ✅ | 🟡 stub | desktop live | mobiel afmaken |
| 16 | Sessies / remote logout | `/admin/sessions` | ✅ | ❌ | desktop live | mobiel scherm |
| 17 | Profiel | `/settings/profile` | ✅ | 🟡 partial | desktop live | mobiel afmaken |
| 18 | Venue-switcher | sidebar | ✅ | 🟡 mock | desktop live | mobiel live |
| 19 | Deur check-in (PWA) | `/door/[id]` | 🟡 picker | ✅ offline | live mobiel | — (af) |
| 20 | Deurtaken + push | — | ❌ | 🟡 mock | mock | live taken + push |
| 21 | Publieke landing | `/e/[slug]` | ✅ | ✅ | live | — (af) |
| 22 | Billing/allowance | `/admin/venue` | 🟡 | 🟡 stub | stub | Fase 13 |

**(a) Eén formaat:** alleen-desktop-live: 4–9, 14, 15, 17, 18; geen mobiel ontwerp: 13, 16. Alleen-mobiel
(by design): 19, 21. **(b) Geen live UI op beide:** adresboek/import (10/11), mobiel
sessies (16). **(c) Onaf/stub:** EventBeheer, Aanvragen, VenueSettings, Import, Rollen, Billing, Profile,
Contacten.

---

## 4. Designsysteem (huisstijl)

Bron: `tailwind.config.ts` + `src/lib/po/theme.ts` + `src/components/po/kit.tsx`/`icon.tsx`.

- **Kleuren:** bg `#0B0B0D`, surfaces `#161618`/`#1E1E21`; tekst wit, dim `.58`/faint `.40`/ghost `.26`;
  lijnen `.10`/`.06`. Accent `acc #B5A6FF`, `acc-soft #C9BEFF`, `acc-dim rgba(181,166,255,.16)`,
  on-acc `#16132B`. Auth-gradient `radial-gradient(120% 80% at 50% 0%, #1a1830, #0B0B0D 55%)`.
- **Typografie:** display **Bricolage Grotesque** (18–52px), body **Hanken Grotesk** (11.5–17px);
  `text-label` 12px/700/0.04em uppercase.
- **Radii:** btn/field 14px, card 20px, sheet 26px.
- **Kit:** `Avatar, Pill, RoleChip, StatusDot, PayChip, Btn, Field, Stepper, Label, Row, Top, IconBtn,
  Scroll, Toggle/ToggleRow, Note, Empty, MiniChip` + desktop `DCard/DBtn`; 51 icons.
- **Motion:** entrance-up `translateY(24px)→0`, opacity altijd 1, 0.4s `cubic-bezier(.16,1,.3,1)`,
  achter `prefers-reduced-motion`. Hover `brightness(1.07)`, press `scale(.975)`.

---

## 4b. ONTWERP-BRIEFS — standalone, klaar voor Claude Design

> Plak per brief in Claude Design. Verwijs naar de huisstijl in §4. Lever **desktop én mobiel**. Alle
> data bestaat al live in de backend.

**0 · Responsive navigatie-shell (fundament).** Eén app die op breed de desktop-sidebar (`DashSidebar`:
logo, venue-switcher, rol-nav, user-menu) toont en op smal (<1024px) omschakelt naar mobiele
onderbalk-tabs (Events · Gasten/Deur · Stats · Meer + venue-switcher in sheet). Acties identiek;
tap ≥44px, veilige insets, geen horizontale scroll. Lever breed (≥1280px) + smal (≤390px).

**1 · Mobiel Dashboard-home (KPI's).** Na login op telefoon een live overzicht: actief event-kaart
(naam/datum/status/aanwezig-aangemeld), KPI-tegels (aanwezig, open aanvragen-badge, quota-resterend),
snelle acties (Nieuwe gast, Open deur, Aanvragen). Data: `event_stats_summary`, requests,
`event_quota_status`.

**2 · Mobiel Audit-log + per-gast geschiedenis.** "Wat is hier gebeurd?" (admin/finance, AAL2):
chronologische vertaalde zinnen, filters (event/user/gast/actie) als sheet, per-gast tijdlijn. Data:
`audit_feed`/`fetchAuditFeed`.

**3 · Aanvragen/goedkeuringen — afgemaakt.** Inbox i.p.v. wireframe: open aanvragen (naam, +N, motivatie,
tijd, herkomst), Goedkeuren (tier-picker → gast, source=landing) / Afwijzen met reden; badge; lege
staat. Data: `guest_requests` + `approveGuestRequest`/`denyGuestRequest`. Geen quota-impact tonen (#31).

**4 · Adresboek/contacten + vaste gasten + import.** Beheer-UI voor de contacten-backend: zoekbare
lijst (naam, laatste 4 cijfers, "vast", voorkeur-tier), detail, CSV/telefoon-import met preview +
dedup, "voeg toe aan event" (respecteert handmatige verwijdering). Data: `contacts`, `upsert_contacts`,
`sync_permanent_guests_into_event`, `add_contact_to_event`.

**5 · Venue-instellingen mobiel.** venue-naam, AVG-bewaartermijn (1–60 mnd), default-quota,
bedrijfsgegevens (company/btw/locatie als volledig adres), billing read-only. AAL2 waar gevoelig.

**6 · Gebruikers + rollen mobiel.** ledenlijst met rol-chips, uitnodigen (e-mail + rollen + quotum), rol
wijzigen (AAL2, escalatie-guard), lid verwijderen met uitleg. Data: `venue_memberships`, invite-actions.

**7 · Sessies/security mobiel.** eigen + (admin) andermans sessies; remote logout. Data:
`list_own_sessions`/`admin_list_user_sessions` + revoke-RPC's. AAL2.

**8 · EventBeheer mobiel (event-dag cockpit).** status-overgangen (open→live→closed met rol-regels),
lijst-lock-toggle + banner, live aanwezig/aangemeld, snel in-/uitchecken. Data: status-machine,
`setLockAction`, `event_stats_summary`.

**9 · Profiel mobiel.** eigen naam/e-mail wijzigen (e-mail met herbevestiging), MFA-status, uitloggen.
Data: profile-actions. Hergebruik `Row`/`Field`/`Btn`.

---

## Beslissingen (Max, 2026-06-17)
1. **Architectuur = Strategy A (viewport-switch, één codebase).** Desktop → desktopdesign; mobiel
   (incl. entree) → `po`-app-vorm; beide via dezelfde live `src/features/*`-acties. Design + wiring
   herbruikbaar voor een latere native/web-app (#37).
2. **Live DB = direct naar prod**, per migratie expliciet bevestigen. Geen preview-branch.
3. **Scope = alles:** STAP 1 → 2 → 3 → 3.5 → 4, gate per fase.
4. **Lokale Supabase = skip voor STAP 1–2:** alleen prod-creds; Docker-stack pas bij STAP 4-tests.
5. **ClickUp = volledige structuur + reconcile** met [Max]/[Claude]/[Design]-prefix en S-ID's.
6. **Planning/handoff-sessie, geen code:** CLAUDE.md bijgewerkt, dit plan in de repo, ClickUp gevuld;
   bouwen in losse sessies per ClickUp-taak.

---

# DEEL B — Implementatieplan (STAP 1–4)

Per fase: bouwen → samenvatting + wat Max test → **akkoord** → door. Kleine commits. Geen secrets in
repo/client-bundle. Live DB nooit destructief zonder bevestiging per actie.

## Fase 1 — Live op prod (STAP 1) · sequentieel
1. **Env (plain namen, geverifieerd):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   server-only `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (ref `tolxwgqhppdcvnogdpel`). NIET de
   `_STAGING`/`_PROD`-namen uit `.env.example`.
2. **Link + diff (read-only):** `supabase link` + `supabase migration list --linked` → pending set.
3. **Push direct naar prod, per migratie bevestigd:** flag of een migratie bestaande data raakt; meeste
   additief; prod leeg → laag risico. PITR vooraf noteren.
4. **Smoke-test:** `getUser()`, één RLS-read, ≥1 venue + admin?
5. **Seed indien leeg:** idempotent, gelogd (1 venue + 1 admin), geen hard-delete. Gate → Fase 2.

## Fase 2 — Eerste login desktop (STAP 2) · sequentieel
1. OTP/MFA e2e tegen prod, juiste redirect (test met seed-admin).
2. "30 dagen onthouden" (open taak): persistente sessie, refresh-rotation, Capacitor-proof.
3. UI-bugs ("Knoppen zichtbaar maken", "Login Scherm desktop", "Feedback" ×4): code lezen, context
   vragen bij twijfel. Gate → Fase 3.

## Fase 3 — Viewport-switch + pariteit (STAP 3) · sequentieel · grootste blok
**Architectuur:** mock = directe imports → live-wiring = import→hook + id-passing (`stats.tsx` is
template). Nieuwe laag `src/features/po/` (adapters/keys/queries/hooks/mutations/PoLiveProvider):
React Query reads + bestaande server-actions voor writes; queries client-agnostisch. Viewport-switch op
**1024px** (server UA-hint + client `matchMedia`); post-login dispatcher `/app` vs `/dashboard`
(middleware). Deur-tab hergebruikt `DoorProvider` in-place. Realtime alleen in de deur. Type-ripple:
`Guest.id` number→string.

**Substappen (gate per batch, ≤390px én ≥1280px):** 3.0 types/UA · 3.1 viewport-switch shell · 3.2
features/po-skelet · 3.3 Events+detail · 3.4 Gastenlijst+add · 3.5 Deur-tab via DoorProvider · 3.6
Aanvragen · 3.7 Settings-cluster · 3.8 nieuwe mobiele schermen (Audit/Sessies/Dashboard) · 3.9
Capacitor-pass. Mobiele principes overal. Parallel: Max levert de Claude Design-ontwerpen (§4b).

## Fase 4 — Snelheid (STAP 3.5) · meten parallel · fixes sequentieel
1. Baseline: Lighthouse/Web Vitals desktop+mobiel op gastenlijst/event-dag/deur; query-timings
   check-in + lijst-laden; bundle/route → top-3/5 kiezen.
2. Fixes: netwerk-rondjes/optimistic/N+1/indexen (EXPLAIN ANALYZE)/realtime payload/code-splitting/
   virtualisatie/debounce. Hermeet per fix (vóór/na). Check-in <100ms gevoeld op throttled 4G.

## Fase 5 — Launch-afronding (STAP 4 / Fase 12)
- **Tests (alleen bestaande features):** volledige suite + aanvaller + secret-grep CI; anonimisering;
  log-vertaling/aggregaties; deur-PWA. Uitstellen: Stripe/ticketing/deurtaken-push (features bestaan
  nog niet).
- **Security-audit** → `docs/security-audit.md` + aanvaller-tests. **e2e Playwright** kernflow.
  **Go/no-go** → `docs/launch.md` (Supabase/Vercel/PITR/monitoring/domein).

---

## Schermen ↔ sessies ↔ ontwerpen (traceability-matrix)

Eén stabiel **scherm-ID (S0–S13)** in inventaris, ontwerp-taak, bouw-taak en sessie. ClickUp-naam:
bouw `S5 · [Claude] Aanvragen — sessie 3.6`; ontwerp `S5 · [Design] Aanvragen` (dependency: ontwerp
blokkeert bouw).

| ID | Scherm | Bouw-sessie | Ontwerp Max? (brief) | po-ontwerp bestaat? |
|----|--------|-------------|----------------------|---------------------|
| — | Types + UA (infra) | 3.0 | nee | n.v.t. |
| **S0** | Responsive nav-shell | 3.1 | ja (§4b#0) | deels |
| — | `features/po` (infra) | 3.2 | nee | n.v.t. |
| **S1** | Events lijst + detail | 3.3 | nee | ✅ |
| **S2** | Gastenlijst + add | 3.4 | nee | ✅ |
| **S3** | Adresboek + Import | 3.4/3.8 | ja (§4b#4) | deels |
| **S4** | Deur-tab | 3.5 | nee | ✅ |
| **S5** | Aanvragen | 3.6 | ja (§4b#3) | ✅ live (PR #43) |
| **S6** | Gebruikers + Rollen | 3.7 | ja (§4b#6) | stub |
| **S7** | Profiel + Sessies | 3.7 | ja (§4b#9,#7) | partial |
| **S8** | Venue-instellingen | 3.8 | ja (§4b#5) | stub |
| **S9** | EventBeheer/Edit/Tiers | 3.8 | ja (§4b#8) | stub |
| **S10** | Mobiel Audit-log | 3.9 | ja (§4b#2) | ✅ live (PR #44) |
| **S11** | Mobiel Dashboard-home | 3.9 | ja (§4b#1) | ✅ live (mobiel, `start`-tab) |
| **S12** | Billing (read-only) | 3.10 | nee | stub |
| **S13** | Desktop Event-dag cockpit (snel in-/uitchecken) | — | ja (Claude) | ✅ live |

**Route = parallel.** Kan meteen (ontwerp-onafhankelijk): 3.0 + 3.2 (infra), dan S1/S2/S4.
Ontwerp-track Max: S0 → S5 → S3 → S6/S7 → S8/S9 → S10/S11. Elk ontwerp deblokkeert zijn bouw-sessie.

---

## Kritieke bestanden (uitvoering)
- `src/components/po/app.tsx` — nav-stack + mock-seeding; wrap in `PoLiveProvider`, id-passing.
- `src/components/po/context.tsx` — `PoApp`-contract; deur-state verwijderen; `Set<number>`→`Set<string>`.
- `src/features/stats/{po-adapter.ts,data.ts}` + `src/components/po/screens/stats.tsx` — live-wiring-template.
- `src/app/(app)/events/[eventId]/guests/page.tsx` — guests-`select` om te liften.
- `src/features/door/DoorProvider.tsx` — deur-laag voor hergebruik.
- `src/middleware.ts` — post-login redirect-target voor de dispatcher.
- `src/lib/supabase/{client,server,service}.ts` — env-var-namen.

---

## DEEL D — Uitvoer-prompts per [Claude]-subtaak

Gedeelde preamble (impliciet boven elke prompt): *Lees CLAUDE.md, `gastenlijst-app-spec.md` (#38/#40)
en Werkwijze v2. Architectuur = Strategy A (viewport-switch; desktop `(app)` breed, `po` smal; één live
datalaag via `src/features/*`). Behoud de component-API; `stats.tsx` is het template. Security-checklist
op elk pad. DoD: `pnpm lint && pnpm test` groen (+ `supabase db reset && supabase test db` bij DB-werk),
nageklikt op ≤390px én ≥1280px, kleine commits, NL UI / Engelse code. Sluit af met samenvatting + open
vragen.*

**STAP 1.3** Link CLI aan prod + read-only `supabase migration list --linked`; rapporteer de pending set
in volgorde, per migratie wat ze doet + of ze data raakt. Push nog niets.
**STAP 1.4** Per pending migratie: toon, vraag go, `supabase db push`; stop bij fout; bevestig schema=lokaal.
**STAP 1.5** Smoke-test prod (`getUser()`, RLS-read, venue+admin?); seed indien leeg (idempotent, gelogd).
**STAP 2.1** OTP/MFA e2e tegen prod werkend + redirect; fix breuken; bewijs met preview-tools.
**STAP 2.2** "30 dagen onthouden" op login (persistente sessie, refresh-rotation, Capacitor-proof) + doc.
**STAP 2.3** Login-UI-bugs uit ClickUp lezen, reproduceren, fixen; vóór/na-screenshots.
**STAP 3.0** `Guest.id` number→string + `context.tsx` `Set<string>` + `Taken`-sort; `src/lib/ua.ts` + test.
**STAP 3.1** Viewport-switch: server UA-hint + client `matchMedia(1024)`; post-login dispatcher; middleware.
**STAP 3.2** `src/features/po/` (adapters+test/keys/queries/hooks/mutations/PoLiveProvider); wrap po-shell.
**STAP 3.3** Events/EventView/PastEvent live via `usePoEvents()`; mock-imports weg; id-passing.
**STAP 3.4** Lift guests-`select` → `features/po/queries.ts`; Lijst/QuickAdd/BulkPaste/Contacten/Vaste +
`usePoAddGuest` (optimistic + eigen invalidate).
**STAP 3.5** Deur-tab via `DoorProvider`/`useDoor()`; prototype-deurstate verwijderen; niet uitlinken.
**STAP 3.6** Aanvragen live: quota → `decideQuotaRequest`; landing → `approve/denyGuestRequest`.
**STAP 3.7** Settings-stubs af + live: Gebruikers/Profile+sessies/VenueSettings/Rollen/EventBeheer/Import/Billing.
**STAP 3.8** Nieuwe mobiele schermen: Audit-log, Sessies, (optioneel) Dashboard-home — po-stijl.
**STAP 3.9** Capacitor-readiness pass: geen browser-only API; `/app` standalone; backbutton noteren.
**STAP 3.5a** Performance-baseline (Lighthouse/Web Vitals + query-timings) → top-3/5; STOP en overleg.
  → ✅ done 2026-06-21 → `perf-baseline-3.5a.md` (incl. stress test @1500 + realtime + 500-org schaal-fit). Top-5 + MVP-cut staan als subtaken onder 3.5b (ClickUp `86exzefv8`). Twee bugs vóór de polish: reads kappen af op 1000 rijen (#0a) en realtime dropt boven `eventsPerSecond:10` (#0b).
**STAP 3.5b** Fixes per knelpunt + hermeten (vóór/na); throttled 4G eindrapport.
  → ✅ done 2026-06-22 → de zes code-fixes (#0a/#0b ranged reads + realtime-throttle; #1a/#1b virtualisatie + debounce; #2a/#2b code-split + first-paint/CLS) gemerged via **PR #53** (correctheid + deur) en **PR #54** (polish). Vóór/na in `perf-baseline-3.5a.md`. Resterend van STAP 3.5 = **#3 schaal-track** (realtime→Broadcast, polling/caching, tier/pooling, kostenmodel, hosted load-test) — aparte sessie, géén MVP-blocker.
**STAP 4.1** Uitvoerbare test-suites (geen niet-bestaande features) sequentieel draaien + rapporteren.
**STAP 4.2** Security-audit → `docs/security-audit.md` + aanvaller-tests.
**STAP 4.3** e2e Playwright kernflow (invite→login→event→gasten→lock→deur offline→audit→stats).
**STAP 4.4** Go/no-go → `docs/launch.md`.
