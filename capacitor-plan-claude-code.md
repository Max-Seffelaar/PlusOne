# Capacitor-plan — Fase 17: Native apps (App Store + Play Store)

> Status: **start akkoord (2026-09-17)** — plan opgesteld 2026-07-06, op 2026-09-17 opnieuw getoetst tegen de code (§8) en aangescherpt met vier beslissingen van Max (§2, 9–12).
> ClickUp-epic: [86exxuvye](https://app.clickup.com/t/86exxuvye) — de fases M1–M4 / N1–N5 / S1–S5 / T1 / L1 hieronder bestaan als losse taken in de lijst.
> Grondslag: spec-beslissing **#37** (native is gepland, geen optie) en **#30** (notificaties = fase 2). Architectuurmodel: **remote-URL Capacitor-wrap** (beslist 2026-06-20) — de native webview laadt de live Vercel-app, server actions blijven werken, geen write-path-rewrite.

**Besluiten Max (2026-07-06):** beide stores in één v1-traject · native push (FCM/APNs) **moet** in v1 zitten · Apple-account/D-U-N-S bestaat nog niet → direct starten (langste doorlooptijd, los van tractie).

**Besluiten Max (2026-09-17):** v1 = volgens plan incl. push (bevestigd) · **iPhone + iPad** in v1 → tablet-layouts worden een harde S5-dependency (T1) · **Android eerst**, iOS zodra het Apple-account er is (S1 gesplitst) · de legal-pagina's (`/privacy`, `/terms`) staan nog niet live → harde S5-dependency (L1).

---

## 1. Waar we staan (readiness-audit 2026-07-06, herzien 2026-09-17)

De codebase is **~85% wrap-klaar; geen blockers** voor het remote-URL-model. Kolom "2026-09-17" = geverifieerd tegen `main` op die datum (zie §8 voor de check per claim).

| Gebied | Status | Toelichting |
|---|---|---|
| Auth | ✅ webview-safe | OTP + magic-link via `/auth/confirm?token_hash=…` en `/auth/callback` (pure HTTP-redirects, geen popups), `@supabase/ssr`-cookies, e-mailtemplates op `{{ .SiteURL }}`. Geen social login → Apple's "Sign in with Apple"-eis (4.8) is niet van toepassing. |
| Deur offline | ✅ | IndexedDB (TanStack-persister + outbox in `src/features/door/`), nergens SW-afhankelijk; sign-out wist IDB én de sessie-cache (`signOutDevice`). |
| PWA-shell / SW | ✅ | Manifest compleet (maskable icons 192/512). De SW wordt **alleen op `/door`** geregistreerd (`src/app/door/register-sw.tsx`), nooit onder `/app`. In WKWebView draaien service workers alleen met **App-Bound Domains** (`WKAppBoundDomains` in Info.plist) — een N3-keuze, geen blocker: niets hangt van de SW af. |
| Backbutton | ⚠️ voorbereid | G1 (real per-screen URLs, `src/components/po/routes.ts`) verving de oude in-memory stack + `history-nav.ts` (verwijderd) door de Next.js router zelf — elke `nav.push`/`setTab`/overlay-open is nu een echte `router.push`. Hook-point voor N3: `@capacitor/app`'s `backButton`-listener → `router.back()` (of `window.history.back()`), met een exit-regel op de `/app`-root (`pathname === '/app'` → app minimaliseren i.p.v. verder terug). Nog niet bedraad (N3) |
| Safe-area | ⚠️ bijna | `env(safe-area-inset-bottom)` zit al in `shell.tsx`; `viewport-fit=cover` ontbreekt nog in de `viewport`-export van `src/app/layout.tsx` (N1) |
| Notifications | ⚠️ alleen seam | `src/features/notifications/provider.ts` = `NoopNotificationProvider` (interface `isSupported/requestPermission/register/unregister`, transport-enum `web-push | fcm | apns`); geen tokens-tabel, geen dispatch, geen adapter (N2+N5) |
| Externe links | ⚠️ N1 | `target="_blank"` in `src/components/po/screens/onboarding.tsx` (voorwaarden/privacy). Capacitor laadt een `_blank`-navigatie standaard **in dezelfde webview** — de gebruiker zit dan op een externe pagina zonder terug-knop (iOS). Fix: één `openExternal(url)`-helper in de kit die op `isNativeShell()` `@capacitor/browser` gebruikt, anders `window.open`. |
| Clipboard | ⚠️ N1 | Zes losse `navigator.clipboard`-aanroepen (`landing.tsx`, `influencer-stats.tsx`, `events/edit.tsx`, `promotion/roster.tsx`, `promotion/create-link-flow.tsx`, `promotion/event-links.tsx`), deels zonder guard/feedback. Eén `copyText()`-kit-helper met fallback + zichtbare feedback (FE-regel: primitive in de kit). |
| CSP | ⚠️ N3 | Globale CSP in `next.config.js` (`default-src 'self'`, `frame-ancestors 'none'`); prod-`script-src` draagt al `'unsafe-inline'` (Next-bootstrap, tot een nonce-migratie) — correctie 2026-09-24 uit N1, juli/september noemde hem ten onrechte nonce/hash-strikt. Op iOS injecteert Capacitor de bridge als `WKUserScript` (buiten de pagina-CSP); op Android via HTML-injectie die **wél** onder `script-src` valt. Pas aanpassen als de Android-debugbuild de bridge blokkeert; nooit met `'unsafe-inline'` — dan een hash/nonce voor het bridge-script. |
| Sentry | ✅ webview | `@sentry/nextjs` is live (client + server + edge), dus webview-fouten komen al binnen. Native-shell-crashes (buiten de webview) niet — `@sentry/capacitor` is expliciet **niet** v1. |
| Legal | 🔶 L1 | `src/lib/legal.ts` linkt naar `https://plus-one.io/legal#terms` en `#privacy` (de marketingsite, repo Plus-One.io, domeinbesluit 2026-09-18); de getoetste teksten staan daar nog niet (drafts in `docs/legal/`, v0.2 in review). Beide stores eisen een live privacy-policy-URL bij submissie, en de consent-gate in de app linkt er al naartoe → [86ey1vbrj](https://app.clickup.com/t/86ey1vbrj) is een harde S5-dependency. |
| Account-verwijdering | ℹ️ S5 | Apple 5.1.1(v) / Play eisen in-app account-deletion **alleen** als de app zelf accounts laat aanmaken. PlusOne is invite-only (geen in-app signup) → formeel vrijgesteld; er is wel een admin-"forget contact" (AVG art. 17, `forget_contact`-RPC) voor gasten. Review-notes noemen dit expliciet + een support-mailadres voor gebruikers-verwijdering. Geen bouwwerk. |
| Store-risico's | 🔶 | Apple **Guideline 4.2** (webview-wrapper-afwijzing) → verdediging = push + offline deur; review-**demo-login** nodig (app is invite-only; dev-login is hard non-prod-gated) → S3. iPad in v1 (beslissing 10) → reviewer test óók op iPad → T1. |

## 2. Kernbeslissingen

Eén keuze per punt; alternatief in één regel.

1. **Push-transport: FCM HTTP v1 only.** FCM levert aan Android én iOS (APNs onder water) — één API, één credential (Firebase service-account-JSON in Edge Function-secrets). *Alt: directe APNs = tweede credential + codepad zonder winst op deze schaal.*
2. **Géén web-push-adapter in v1.** `'web-push'` blijft in het transport-enum en de provider-seam; alleen de Capacitor-adapter wordt gebouwd. *Alt: web-push voor de browser-PWA nu = twee transports pre-tractie; iOS web-push vereist bovendien een home-screen-install die niemand doet.*
3. **Dispatch: DB AFTER-triggers → `notification_outbox` → pg_net → `push-dispatch` Edge Function.** Triggers missen geen codepad (guest requests komen via de publieke landing-route én po-schermen binnen); de outbox geeft observability + pg_cron-retry; FCM-secrets blijven uit Vercel. *Alt: Edge Function vanuit server actions aanroepen = mist insert-paden en verplaatst FCM-creds naar Vercel.*
4. **Push v1-use-cases = de approvals-loop, beide richtingen:** (a) staff-quota-request aangemaakt → push naar approvers; (b) landing-page-guest-request → push naar approvers; (c) request beslist → push naar de aanvrager. Samen met de offline deur is dit de Apple 4.2-"meerwaarde"-verdediging. *Event-reminders/list-lock-warnings vereisen scheduled sends → expliciet later.*
5. **Cloud-CI: Codemagic.** First-class Capacitor-support, managed iOS-signing + TestFlight/Play-publishing vanuit YAML — geen Mac nodig (Max werkt op Windows). Het gratis tier (500 macOS-min/mnd op 2026-07-06) **opnieuw checken bij S1**; prijswijzigingen zijn geen reden om van tool te wisselen zolang het onder de kosten van een Mac blijft. *Alt: GitHub Actions macOS-runners (goedkoper bij volume, maar handmatige fastlane); Ionic Appflow uitgesloten (EOL aangekondigd).*
6. **Review/demo-account: prod `review-login`-route + geïsoleerde demo-venue.** "PlusOne Demo"-tenant in prod met fake seed-data en één demo-user; route naar model van `src/app/auth/dev-login/route.ts` maar prod-safe: gated op een `REVIEW_LOGIN_CODE`-env-secret (per submissie geroteerd; unset ⇒ 404), hard-gescoped op uitsluitend de demo-user, rate-limited, geaudit. Invite-only + passwordless blijven intact. *Alt: auth-hook met vast OTP voor het demo-adres = magic string in het auth-pad, moeilijker te scopen.*
7. **Deep links blokkeren auth niet.** Native login = het bestaande getypte 6-cijfer-OTP, volledig in-webview. Universal links / app links (AASA + `assetlinks.json` op het Vercel-domein) zijn ship-time-polish zodat magic-link/invite-mails de app openen (S4). **Consequentie zonder S4:** een invitee die de invite-link op de telefoon tikt logt in Safari/Chrome in (eigen cookie-jar) en moet in de app alsnog via OTP inloggen — acceptabel voor v1, in de onboarding-copy benoemen.
8. **`android/` + `ios/` worden gecommit in de repo.** Standaard Capacitor-praktijk; onder het remote-URL-model is de churn minimaal. `ios/` wordt op Windows gegenereerd (`npx cap add ios` werkt zonder Mac); `pod install`/SPM-resolve gebeurt pas in Codemagic (S1b).
9. **Android eerst, iOS zodra het Apple-account er is (2026-09-17).** Zelfde werk, andere volgorde: S1 is gesplitst in S1a (Android → Play internal/closed test, kan zonder Apple) en S1b (iOS → TestFlight). Venues zien eerder iets; de iOS-wachttijd ligt buiten onze invloed. *Alt: beide tegelijk = alles wacht op Apple.*
10. **iPhone + iPad in v1 (2026-09-17).** Daarmee zijn de tablet-layouts (641–1023px, tot nu "remaining polish") een harde vereiste vóór S5: Apple test op iPad en eist iPad-screenshots. Nieuwe taak T1. *Alt: iPhone-only (`TARGETED_DEVICE_FAMILY=1`) had T1 en de iPad-screenshots vermeden.*
11. **App links claimen alleen `/auth/*`, nooit `/e/*` (2026-09-17, correctie op de S4-scope van juli).** `/e/[slug]` is de gasten-landing: een promotor mét de app die zijn eigen gastenlink opent moet de publieke pagina in de browser zien, niet in de app-shell. AASA/assetlinks beperken tot `/auth/confirm` en `/auth/callback`.
12. **Externe links gaan via `@capacitor/browser` in de native shell (2026-09-17).** Eén kit-helper; `target="_blank"` in de `po`-surface is daarmee verboden (CLAUDE.md-checklist). *Alt: `allowsBackForwardNavigationGestures` aanzetten = swipe-terug, maar geen zichtbare uitweg en geen Android-equivalent.*
13. **App-id = `app.plusone.guestlist` op beide platforms (2026-09-24, vastgelegd bij de Firebase-registratie in M3).** Bewust een vaste string, niet afgeleid van een domein (de domeinen zijn `plus-one.io` / `app.plus-one.io`, besluit 2026-09-18; een koppelteken mag niet in een Android-`applicationId`-segment, dus reverse-DNS van het echte domein kan niet 1-op-1); alleen letters en punten, zodat dezelfde string als Android `applicationId`, iOS `PRODUCT_BUNDLE_IDENTIFIER` én Capacitor `appId` dient. Permanent zodra de eerste build in Play/App Store Connect staat — nooit meer wijzigen. Firebase kent twee apps onder dit id (Android nu, iOS in de tweede helft van M3). `google-services.json` (Android) en `GoogleService-Info.plist` (iOS) mogen in de repo (client-identifiers, geen geheimen; door package-name/bundle-id gebonden) en landen in N3 onder `android/app/` resp. `ios/App/App/`. Het Firebase **service-account-JSON** (FCM HTTP v1, voor N2) is wél een geheim: wachtwoordmanager → Supabase Edge Function-secrets, nooit Vercel, nooit de repo.
14. **De deurvariant volgt touch óf breedte, niet alleen breedte (2026-09-24, Max, uit T1).** De chrome-breakpoint blijft 1024px (T1, `design-system.md` "Breakpoints & tablet"), maar de Deur-tab kiest de offline-outbox-deur (`DoorProvider`, #25) bij `(pointer: coarse)` **of** een viewport <1024px; de online-only Event-dag-cockpit alleen bij muis/trackpad ≥1024px. Zo krijgt een iPad in landscape aan de deur altijd de outbox. Uitvoering = N6 (na N3, raakt `app.tsx`). *Alt: alleen breedte = iPad landscape aan de deur zonder offline-garantie.*

## 3. Push-architectuur (richting voor N2/N5)

### Schema-sketch

```sql
create table push_tokens (
  id uuid primary key default gen_random_uuid(),   -- online-only: geen UUIDv7 nodig
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,        -- auth-session-id uit de JWT-claim, server-side gestampt
  transport text not null check (transport in ('web-push','fcm','apns')),
  token text not null,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (transport, token)
);
```

- **Grant matrix (sinds `20260917100000`):** `revoke all … from anon, authenticated` eerst, dan `grant select, insert, update, delete on push_tokens to authenticated` — `delete` is hier terecht (eigen device-rij, owner-only RLS) en moet op de allowlist in `grant_matrix.test.sql`. `notification_outbox` krijgt **géén** grant aan `authenticated` (alleen triggers + service_role/Edge Function lezen hem).
- **RLS:** owner-only (`user_id = auth.uid()`) op alle verbs; pgTAP allowed + denied per rol.
- **Remote logout invalideert push** (eis uit de epic): geen cross-schema-FK naar `auth.sessions`; in plaats daarvan de bestaande RPC's **`revoke_own_session` + `admin_revoke_session`** (`src/features/auth/session-actions.ts`, migraties `20260624160000`/`20260702120000`) uitbreiden met `delete from push_tokens where session_id = …`.
- **Hygiëne:** prune op FCM-`UNREGISTERED`-responses + pg_cron-TTL-sweep (`last_seen_at` > 90 dagen). Bewust **niet** in de audit-trigger-set (device-plumbing, geen domeindata) — vastleggen in de spec-decision-table.
- **FCM-credential:** het Firebase service-account-JSON leeft uitsluitend als Supabase Edge Function-secret **`FCM_SERVICE_ACCOUNT_JSON`** (de complete JSON als één waarde; Max zet hem via Dashboard → Project Settings → Edge Functions → Secrets, of `supabase secrets set` vanuit de gelinkte main-checkout). Daarnaast **`FCM_PROJECT_ID`** (het Firebase-project-id, geen geheim maar handig als losse secret). Nooit in Vercel: de Next.js-app stuurt geen push, alleen de Edge Function, en zo blijft de credential buiten elke Vercel-bundle en -log. N2 leest exact deze namen.
- **Outbox:** `notification_outbox` (payload, doelgroep-query-resultaat, status, attempts, last_error); AFTER-triggers op `quota_requests` en `guest_requests` vullen hem; pg_net roept de Edge Function; pg_cron veegt retryables.
- **Client:** runtime-adapterselectie in `provider.ts` — `Capacitor.isNativePlatform()` → `CapacitorPushProvider` (via `@capacitor/push-notifications`), anders Noop. Permission-prompt **contextueel, nooit bij launch**: dismissible card op Home/Approvals voor approver-rollen + één toggle in Settings → Notificaties. Registratie via server action die `session_id` uit de JWT stampt; sign-out roept `unregister()` aan **vóór** de bestaande IDB-clear; token-refresh → upsert; notification-tap → approvals-scherm via `router.push(screenPath(…))`.

## 4. Fasering

Effort in Claude Code-sessies (de werkeenheid van dit project: één ClickUp-taak → één PR die Max test en merged). Sinds 2026-09-17 is alles **NOW**; de SHIP-tag blijft staan voor wat pas zin heeft zodra een store-account er is.

### Track M — Max, handmatig, parallel — start direct

| # | Tag | Inhoud |
|---|-----|--------|
| M1 | NOW | **D-U-N-S** aanvragen (gratis, 1–2 wk; welke bedrijfsentiteit PlusOne draagt is een M1-beslissing) → **Apple Developer org-account** (€99/jr; org-verificatie 1–2 wk extra, incl. telefonische check). Langste doorlooptijd van het hele traject. |
| M2 | NOW | **Google Play Console org-account** ($25 eenmalig; een org-account vermijdt de regel voor nieuwe personal accounts — **20 testers, 14 dagen** closed test vóór productie; Play vraagt ook D-U-N-S). |
| M3 | NOW | **Firebase-project** aanmaken (gratis — deblokkeert de echte send-test van N2); **APNs-key** uploaden zodra het Apple-account er is. |
| M4 | SHIP | Store-listing NL, screenshots (**iPhone 6,7" + iPad 13"** — beslissing 10), privacy nutrition labels + Play data-safety (spiegelen `/privacy` uit L1), export compliance (HTTPS-only → exempt), Codemagic-account + App Store Connect API-key. |

### Dev-track

| # | Fase | Tag | Effort | Deps | Deliverable |
|---|------|-----|--------|------|-------------|
| N1 | Webview-prep fixes | NOW | 1 | — | `copyText()`-kit-helper (6 call sites), `openExternal()`-kit-helper (`@capacitor/browser` op native; `onboarding.tsx`), `viewport-fit=cover` in de `viewport`-export van `src/app/layout.tsx`, CSP-wrap-notes in `next.config.js`, CLAUDE.md-checklist-regel "geen `target=_blank`", sanity-pass op de checklist over de bestaande schermen. |
| N2 | Push-backend | NOW | 2 | M3 (alleen voor echte send) | Migraties `push_tokens` + `notification_outbox` (mét grant matrix, §3), AFTER-triggers op `quota_requests`/`guest_requests`, pg_net-wiring, revocatie-RPC-uitbreiding, `supabase/functions/push-dispatch` (FCM v1 + token-pruning), pg_cron-retry, pgTAP, types regenereren. Pipeline **live-maar-slapend**, testbaar tegen gemockte FCM. High-risk surface → fresh-session `/code-review` + `/security-review`. |
| N3 | Capacitor-scaffold + Android | NOW | 1–2 | N1 | `capacitor.config.ts` met `server.url` = prod, `android/`+`ios/` gecommit (iOS: `TARGETED_DEVICE_FAMILY` 1,2 — iPad erin, beslissing 10), `@capacitor/app` backButton → `router.back()` met exit op `/app`-root, statusbar/splash-basis, safe-area-check, `WKAppBoundDomains`-keuze vastleggen, CSP-fix alleen als de Android-bridge geblokt wordt (hash/nonce, nooit `unsafe-inline`). **Android-debugbuild op Max' Windows-machine valideert het hele model** (auth, server actions, deur-offline, externe links, back-button). |
| N4 | Deur cold-start-spike | NOW | 1 | N3 | Schriftelijke go/no-go: is remote-URL cold-start-offline acceptabel voor de deur, of bundelen we alleen de (al client-side) deur-route lokaal? Neem de App-Bound-Domains-optie (SW-shell-cache in WKWebView) mee als derde variant. Geen productiecode. |
| N5 | Push-client + native adapter | NOW | 1 | N2+N3 | `CapacitorPushProvider`, runtime-selectie, permission-UX, register/unregister-lifecycle, tap-navigatie. Werkende push op Android; iOS volgt in S1b. |
| T1 | Tablet-layouts 641–1023px | SHIP | 2–3 | — | Beslissing 10. Elk `po`-scherm bruikbaar op iPad portrait + landscape; `ResponsiveShell`-breakpoint-beslissing vastleggen; Deur-tab op tablet eerst. Levert de iPad-screenshots voor M4. → [z8uq9m0fzj](https://app.clickup.com/t/z8uq9m0fzj) |
| L1 | Legal-pagina's live | SHIP | 1 | — | `plus-one.io/legal` (tabs `#terms`, `#privacy`, `#subprocessors`, `#dpa`, `#guest-terms`) in de Plus-One.io-repo, content uit `docs/legal/` (v0.2-herziening: ClickUp z8uq9m0w3t + z8uq9m0w3u), live pas na Max' juridische check; app-kant: link naar de gastvoorwaarden op `/e/[slug]` + `TERMS_VERSION` ophogen (na N1). → [86ey1vbrj](https://app.clickup.com/t/86ey1vbrj) (bestaand, prod-ready-programma). |
| S1a | Android-build + cloud-CI | SHIP | 1 + Max | M2, N3 | `codemagic.yaml` Android-workflow, upload-key beheer, **Play internal track → closed test**; buildnummer = CI-runnummer. Push (N5) end-to-end op een echte Android. Kan zonder Apple-account. |
| S1b | iOS-build | SHIP | ½ + Max | M1, M3, N3, S1a | iOS-workflow in dezelfde `codemagic.yaml`, managed signing, **TestFlight**; APNs-via-FCM geverifieerd op een echte iPhone én iPad. → [z8uq9m0gvn](https://app.clickup.com/t/z8uq9m0gvn) |
| S2 | Icons/splash/store-wiring | SHIP | 1 | N3 | `@capacitor/assets` vanuit het bestaande maskable 512-icoon, store-metadata in repo, screenshots (Max, na T1). |
| S3 | Review-login + demo-venue | SHIP | 1 | vóór S5 | Env-gated `review-login`-route + demo-tenant-seedscript, geaudit, security-checklist toegepast. High-risk surface → fresh-session `/security-review`. |
| N6 | Deurvariant op touch óf <1024px | NOW | ½–1 | N3, T1 | Beslissing 14: de Deur-tab kiest de outbox-deur bij `pointer: coarse` of <1024px, de cockpit alleen bij fijne pointer ≥1024px; `door-branch.tsx`/`DoorRoute.tsx`/`app.tsx`, geen hydration-flip die `DoorProvider` remount, `door-render-isolation` blijft groen. ClickUp-taak: [aan te maken] |
| S4 | Universal links / app links | SHIP | 1 | M1, N3 | AASA + `assetlinks.json` route handlers op het domein, **alleen `/auth/*`** (beslissing 11), `appUrlOpen`-listener → in-app-nav. |
| S5 | Submissie + 4.2-verdediging | SHIP | 1 + Max | alles, incl. T1 + L1 | Review-notes (push + offline deur + demo-creds + account-deletion-toelichting), Play data-safety-form, staged rollout, review-responses (reken op iteraties). Android-submissie kan vóór iOS (beslissing 9). |

**Totaal ≈ 13–15 sessies** (was 10–12; +T1, +L1, N1 iets zwaarder). Kritieke pad naar de App Store: M1 → S1b → S5-iOS; naar Play: N1 → N3 → N5 → S1a → S5-Android, zonder Apple-wachttijd.

### Parallel-golven (2026-09-17)

| Golf | Parallel | Wacht op |
|---|---|---|
| 1 | N1, N2, S3, T1, L1 | niets (N2 en S3 niet tegelijk tegen de lokale stack resetten — één DB-eigenaar) |
| 2 | N3 | N1 gemerged; Max: Android-debugbuild |
| 3 | N4, N5, N6, S2, S4, S1a | N3 gemerged (S1a ook M2; N6 ook T1) |
| 4 | S5-Android | alles behalve S1b |
| 5 | S1b → S5-iOS | M1 + M3 |

N1, N3 en N5 raken alle drie `app.tsx`/root layout → bewust sequentieel. Max is de bottleneck tussen golven (test-handoff + merge per PR): twee à drie parallelle sessies per golf is realistisch.

## 5. Wat we bewust NIET nu doen

Web-push-adapter · scheduled/reminder-pushes · notification-preferences-matrix (één toggle volstaat) · Tap to Pay (#34 route C — vereist eerst deze store-aanwezigheid) · ops-module-push (#35) · de volledige app lokaal bundelen · billing/IAP/checkout in de app (CLAUDE.md-regel, Apple IAP) · een store-staging-omgeving · widgets/live activities · per-device push-analytics · `@sentry/capacitor` (native-shell-crashes) · in-app account-deletion-flow (invite-only, zie §1) · een minimum-versie/kill-switch voor de shell (remote-URL: een deploy ís de update).

## 6. Release-checklist (draft — afvinken in S5)

- [ ] Apple + Play **org**-accounts actief
- [ ] Firebase-project + APNs-key geüpload
- [ ] Push end-to-end geverifieerd op TestFlight + Play internal (alle drie use-cases)
- [ ] Remote logout killt push-tokens (handmatige test)
- [ ] Android-backbutton: retraces de nav-stack, exit alleen op stack-root
- [ ] Safe-area correct op notch-device (statusbar + home-indicator)
- [ ] Externe links (voorwaarden/privacy) openen in de systeembrowser, niet in de webview
- [ ] iPad portrait + landscape: elk scherm bruikbaar (T1); iPad-screenshots in de listing
- [ ] Deur-cold-start-besluit (N4) geïmplementeerd of expliciet geaccepteerd
- [ ] `REVIEW_LOGIN_CODE` gezet + demo-venue geseed; creds in de review-notes
- [ ] `/privacy` + `/terms` live (L1); privacy nutrition labels + Play data-safety ↔ die pagina's consistent
- [ ] Account-deletion-toelichting (invite-only, support-adres) in de review-notes
- [ ] Export compliance beantwoord (HTTPS-only → exempt)
- [ ] Geen billing-UI bereikbaar in de app (`isNativeShell()`-seam gecontroleerd op elke purchase-affordance)
- [ ] NL-listings compleet (beschrijving, screenshots, keywords)
- [ ] Versioning vast: buildnummer = CI-runnummer
- [ ] Offline-banner-gedrag bij mid-session-netwerkverlies gecheckt in de webview
- [ ] CLAUDE.md + spec #37 bijgewerkt; ClickUp-taken dicht

## 7. Kritieke bestanden

- `src/features/notifications/provider.ts` — de seam waar alle push-werk aan hangt
- `src/features/auth/session-actions.ts` — revocatie-RPC's uitbreiden voor token-invalidatie
- `src/components/po/app.tsx` — backButton-wiring-target (G1: `useRouter()`/`router.back()`; `history-nav.ts` bestaat niet meer, verwijderd toen elk scherm een echte URL kreeg)
- `src/components/po/kit.tsx` — nieuwe helpers `copyText()` + `openExternal()` (N1)
- `src/lib/platform.ts` — `isNativeShell()`, de runtime-seam voor billing-hide, externe links en push-adapterselectie
- `src/lib/legal.ts` — `TERMS_URL`/`PRIVACY_URL` (L1)
- `src/app/layout.tsx` — `viewport`-export (`viewport-fit=cover`, N1)
- `src/app/door/register-sw.tsx` — de enige SW-registratie; App-Bound-Domains-vraag (N3/N4)
- `next.config.js` — CSP/headers bij wrap + AASA/assetlinks-serving
- `src/app/auth/dev-login/route.ts` — template voor de prod review-login-route
- `supabase/templates/` — e-mail-deep-links (`{{ .SiteURL }}`)
- `public/manifest.json` + `public/service-worker.js` — bestaande PWA-shell (blijft; webview registreert de SW gewoon niet als hij niet kan)

## 8. Review 2026-09-17 — plan getoetst tegen de code

Aanleiding: Max wilde weten of het plan goed genoeg is om te starten. Antwoord: **ja, met de correcties hierboven.** Per claim uit de audit van juli:

| Claim (juli) | Bevinding (september) | Verwerkt in |
|---|---|---|
| Auth webview-safe | Klopt: `/auth/confirm` + `/auth/callback` route handlers, cookie-sessie, geen popups; middleware 91 regels zonder browser-aannames. | — |
| Clipboard-fallback in `events.tsx` | Verouderd: `events.tsx` heeft geen clipboard meer, wel zes andere bestanden zonder gedeelde helper. | N1 |
| `viewport-fit=cover` ontbreekt | Klopt nog steeds (`src/app/layout.tsx`). | N1 |
| Backbutton via `history-nav.ts` (ClickUp-tekst N3) | Verouderd: bestand is weg sinds G1; plandoc was al bijgewerkt, ClickUp-taak niet. | N3 (ClickUp bijgewerkt) |
| CSP-check bij wrap | Aangescherpt: Android-injectie valt onder `script-src`. **Correctie 2026-09-24 (N1):** prod-`script-src` bevat al `'unsafe-inline'`, dus de bridge wordt naar verwachting niet geblokt; "strikte CSP bevestigd" was onjuist. | N3 |
| Push-seam bestaat | Klopt: `NoopNotificationProvider`; `revoke_own_session`/`admin_revoke_session` bestaan. | — |
| Niet in het plan: externe links | Nieuw: `target="_blank"` in onboarding vangt de gebruiker in de webview. | N1, beslissing 12 |
| Niet in het plan: SW in WKWebView | Nieuw: SW alleen op `/door`; WKWebView vereist App-Bound Domains. | N3, N4 |
| Niet in het plan: legal-pagina's | Nieuw: `/privacy`/`/terms` bestaan niet; harde store-eis. | L1 |
| Niet in het plan: iPad | Nieuw: Max kiest iPad in v1 → tablet-layouts verplicht. | T1, beslissing 10 |
| Niet in het plan: grant matrix | Nieuw sinds migratie `20260917100000`: nieuwe tabellen starten dicht. | N2 (§3) |
| S4 claimt ook `/e/[slug]` | Fout: gastenlanding hoort niet in de app-shell. | Beslissing 11 |
| Play: 12 testers/14 dagen | Onjuist: de regel voor nieuwe personal accounts is 20 testers. Org-account (M2) omzeilt hem sowieso. | M2 |
| Sentry | Niet genoemd; is live in de webview. Native-shell-crashes bewust niet v1. | §1, §5 |
| Account-deletion (Apple 5.1.1(v)) | Niet genoemd; invite-only → vrijgesteld, wel toelichten in review-notes. | §1, §6 |

Niet opnieuw getoetst (hosted-only of pas bij S1 meetbaar): Codemagic-prijzen, Apple/Play-doorlooptijden, iOS-cookie-persistentie in WKWebView (verwacht: persistent via `WKHTTPCookieStore`; verifiëren op TestFlight).
